import { join, resolve, relative, dirname, sep } from "node:path";
import { mkdir, writeFile, rename, access, constants } from "node:fs/promises";

const FORBIDDEN_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

export class ObsidianVault {
  constructor(vaultPath) {
    if (!vaultPath || typeof vaultPath !== "string") throw new Error("Ruta de bóveda requerida");
    const resolved = resolve(vaultPath);
    if (resolved !== vaultPath) throw new Error("La ruta de la bóveda debe ser absoluta");
    this.vaultPath = resolved;
    this.bitFolder = join(this.vaultPath, "Bit");
    this.conversationsFolder = join(this.bitFolder, "Conversaciones");
  }

  #assertSafePath(targetPath) {
    const resolvedTarget = resolve(targetPath);
    const resolvedBit = resolve(this.bitFolder);

    // Must be inside Bit folder
    if (!resolvedTarget.startsWith(resolvedBit + sep) && resolvedTarget !== resolvedBit) {
      throw new Error("Escritura denegada: solo se permite escribir dentro de <Vault>/Bit/");
    }

    // Check for forbidden directories in path
    const relativePath = relative(this.vaultPath, resolvedTarget);
    const pathParts = relativePath.split(sep);
    for (const part of pathParts) {
      if (FORBIDDEN_DIRS.has(part)) {
        throw new Error(`Acceso denegado: carpeta protegida "${part}"`);
      }
      if (part === "..") {
        throw new Error("Acceso denegado: ascensión de directorios no permitida");
      }
    }

    // Block hidden files/folders (starting with .)
    for (const part of pathParts) {
      if (part.startsWith(".") && part !== "..") {
        throw new Error(`Acceso denegado: archivo/carpeta oculta "${part}"`);
      }
    }
  }

  async #ensureBitFolders() {
    await mkdir(this.bitFolder, { recursive: true });
    await mkdir(this.conversationsFolder, { recursive: true });
  }

  async saveConversationContext(title, markdownContent) {
    this.#assertSafePath(this.conversationsFolder);

    // Sanitize title for filename
    const safeTitle = String(title)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 100);

    const date = new Date();
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const filename = `${dateStr}_${safeTitle}.md`;
    const filePath = join(this.conversationsFolder, filename);

    // Ensure target is within allowed folder
    this.#assertSafePath(filePath);

    // Build frontmatter
    const frontmatter = [
      "---",
      `title: ${title}`,
      `date: ${date.toISOString()}`,
      `type: bit-conversation`,
      `bit_version: 1`,
      "---",
      ""
    ].join("\n");

    const fullContent = frontmatter + markdownContent;

    // Atomic write: write to .tmp then rename
    const tmpPath = filePath + ".tmp";
    this.#assertSafePath(tmpPath);

    await writeFile(tmpPath, fullContent, "utf-8");
    await rename(tmpPath, filePath);

    return { ok: true, path: filePath, relativePath: relative(this.vaultPath, filePath) };
  }
}