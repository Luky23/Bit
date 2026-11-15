/**
 * Registro de herramientas para el LLM (Function Calling)
 * Cada herramienta tiene: nombre, descripción, schema Zod (args), y handler async
 */

import { ObsidianIndexer } from "../obsidian/indexer.mjs";
import { ObsidianVault } from "../obsidian/vault.mjs";

/**
 * Herramientas de Obsidian para memoria persistente
 * Solo lectura: search, read
 * Escritura: saveMemory pasa por la política central de permisos
 */

const obsidianIndexerCache = new Map(); // vaultPath -> ObsidianIndexer

async function getIndexer(vaultPath) {
  if (!obsidianIndexerCache.has(vaultPath)) {
    const indexer = new ObsidianIndexer(vaultPath);
    await indexer.buildIndex();
    obsidianIndexerCache.set(vaultPath, indexer);
  }
  return obsidianIndexerCache.get(vaultPath);
}

/**
 * Tool: obsidian.search
 * Busca notas en la bóveda por query (título, alias, tags)
 */
export const obsidianSearchTool = {
  name: "obsidian.search",
  description: "Busca notas en la bóveda de Obsidian del usuario. Úsala para encontrar información previa, preferencias, proyectos antiguos o cualquier dato guardado en la memoria persistente.",
  category: "memory",
  readOnly: true,
  lightweight: true,
  parameters: {
    type: "object",
    properties: {
      vaultPath: { type: "string", description: "Ruta absoluta a la bóveda de Obsidian" },
      query: { type: "string", description: "Término de búsqueda (título, alias, etiqueta o palabra clave)" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "Máximo de resultados" }
    },
    required: ["vaultPath", "query"],
    additionalProperties: false
  },
  handler: async ({ vaultPath, query, limit = 10 }) => {
    const indexer = await getIndexer(vaultPath);
    const lowerQuery = query.toLowerCase();
    const results = [];

    // Buscar por título
    for (const [title, path] of indexer.titleIndex) {
      if (title.includes(lowerQuery)) {
        results.push({ type: "title", title, path, score: 1 });
      }
    }

    // Buscar por alias
    for (const [alias, path] of indexer.aliasIndex) {
      if (alias.includes(lowerQuery)) {
        results.push({ type: "alias", alias, path, score: 0.9 });
      }
    }

    // Buscar por tags
    for (const [tag, paths] of indexer.tagIndex) {
      if (tag.includes(lowerQuery)) {
        for (const path of paths) {
          results.push({ type: "tag", tag, path, score: 0.8 });
        }
      }
    }

    // Deduplicar por path y ordenar por score
    const unique = new Map();
    for (const r of results) {
      if (!unique.has(r.path) || unique.get(r.path).score < r.score) {
        unique.set(r.path, r);
      }
    }

    return Array.from(unique.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
};

/**
 * Tool: obsidian.read
 * Lee el contenido completo de una nota
 */
export const obsidianReadTool = {
  name: "obsidian.read",
  description: "Lee el contenido completo de una nota específica de la bóveda. Úsala después de buscar para obtener el texto completo.",
  category: "memory",
  readOnly: true,
  lightweight: true,
  parameters: {
    type: "object",
    properties: {
      vaultPath: { type: "string", description: "Ruta absoluta a la bóveda de Obsidian" },
      notePath: { type: "string", description: "Ruta relativa de la nota (ej: 'Bit/Conversaciones/2026-01-15_proyecto.md')" }
    },
    required: ["vaultPath", "notePath"],
    additionalProperties: false
  },
  handler: async ({ vaultPath, notePath }) => {
    const { readFile } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");

    const root = resolve(vaultPath);
    const fullPath = join(root, notePath);

    // Seguridad: verificar que esté dentro de la bóveda
    if (!fullPath.startsWith(root + "\\") && !fullPath.startsWith(root + "/")) {
      throw new Error("Ruta fuera de la bóveda");
    }

    const content = await readFile(fullPath, "utf-8");
    return { path: notePath, content };
  }
};

/**
 * Tool: obsidian.saveMemory
 * Guarda una memoria/idea/preferencia en la bóveda mediante la política central
 * La escritura real se delega al proceso main, que aplica la política central.
 */
export const obsidianSaveMemoryTool = {
  name: "obsidian.saveMemory",
  description: "Guarda información en la bóveda local de Obsidian cuando el usuario lo solicite directamente. La política central evalúa alcance y reversibilidad y pide confirmación cuando sea necesaria.",
  category: "memory",
  readOnly: false,
  lightweight: false,
  parameters: {
    type: "object",
    properties: {
      vaultPath: { type: "string", description: "Ruta absoluta a la bóveda de Obsidian" },
      title: { type: "string", description: "Título descriptivo para la nota (ej: 'Preferencia: tema oscuro por defecto')" },
      content: { type: "string", description: "Contenido completo en markdown de lo que se debe recordar" }
    },
    required: ["vaultPath", "title", "content"],
    additionalProperties: false
  },
  handler: async ({ vaultPath, title, content }) => {
    // Esta herramienta se ejecuta vía IPC en el proceso main, que aplica la política central
    // El handler aquí es un placeholder - la ejecución real ocurre en main.mjs via IPC
    throw new Error("Esta herramienta debe ejecutarse vía IPC bit:obsidian-save");
  }
};

/**
 * Exporta todas las herramientas de memoria
 */
export const MEMORY_TOOLS = [
  obsidianSearchTool,
  obsidianReadTool,
  obsidianSaveMemoryTool
];

/**
 * Obtiene herramientas filtradas por ruta (role) y capacidades
 */
export function getToolsForRoute(route, capabilities) {
  return MEMORY_TOOLS.filter((tool) => {
    if (route === "vision") return tool.category === "screen" || tool.readOnly === true;
    if (route === "fast") return tool.lightweight === true || tool.readOnly === true;
    return tool.category === "coding" || tool.readOnly === true;
  });
}