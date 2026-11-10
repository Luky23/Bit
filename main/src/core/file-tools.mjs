/**
 * Herramientas de archivos de Bit (system.createFile / modifyFile / readFile).
 *
 * Todo acceso pasa obligatoriamente por `enforceSandbox`, que valida la contención
 * de la ruta y resuelve los enlaces simbólicos antes de tocar el disco.
 *
 * LÍMITE: esto escribe texto dentro de la carpeta elegida por el usuario. Bit no
 * ejecuta los archivos que crea; para eso sigue existiendo la validación de
 * `exec-tools` con su lista blanca y su confirmación.
 */

import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { canonicalSandboxRoot, enforceSandbox } from "./sandbox.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_DROPPED_FILE_BYTES = 8 * 1024 * 1024;

/** Extensiones de código y texto que Bit puede crear y leer dentro del sandbox. */
export const WRITABLE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".py", ".html", ".css", ".md", ".txt", ".csv", ".json",
]);

/** Extensiones que el sistema operativo puede abrir sin ejecutar código. */
export const OPENABLE_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json", ".pdf", ".rtf", ".doc", ".docx", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".mkv", ".mov",
]);

const DROPPED_TEXT_EXTENSIONS = new Set([
  ...WRITABLE_EXTENSIONS,
  ".ts", ".tsx", ".jsx", ".xml", ".yaml", ".yml", ".toml", ".ini", ".log", ".sql", ".sh", ".ps1",
]);
const DROPPED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".rtf", ".doc", ".docx", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
]);
const DROPPED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const DROPPED_AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);

/**
 * Lee un archivo elegido explícitamente mediante drag & drop. El contenido se
 * considera siempre dato externo no confiable. Sin parsers adicionales solo se
 * extrae texto UTF-8; los formatos binarios se adjuntan como metadatos.
 */
export async function readDroppedFile(filePath) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("La ruta del archivo debe ser absoluta");
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("La ruta soltada no corresponde a un archivo");
  if (info.size > MAX_DROPPED_FILE_BYTES) {
    throw new Error(`El archivo supera el límite local de ${MAX_DROPPED_FILE_BYTES} bytes`);
  }

  const extension = extname(filePath).toLowerCase();
  const base = { path: filePath, name: basename(filePath), extension, bytes: info.size };
  if (DROPPED_TEXT_EXTENSIONS.has(extension)) {
    if (info.size > MAX_FILE_BYTES) throw new Error(`El texto supera el límite de contexto de ${MAX_FILE_BYTES} bytes`);
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) throw new Error("El archivo de texto contiene datos binarios");
    const content = buffer.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(buffer)) throw new Error("El archivo no es texto UTF-8 válido");
    return { ...base, kind: "text", content, notice: "Texto UTF-8 extraído localmente." };
  }
  if (DROPPED_IMAGE_EXTENSIONS.has(extension)) return { ...base, kind: "image", content: null, notice: "Imagen disponible para análisis visual local." };
  if (DROPPED_DOCUMENT_EXTENSIONS.has(extension)) return { ...base, kind: "document", content: null, notice: "Este formato requiere extracción especializada no disponible sin dependencias adicionales." };
  if (DROPPED_AUDIO_EXTENSIONS.has(extension)) return { ...base, kind: "audio", content: null, notice: "Audio adjuntado; la transcripción de archivos aún no está disponible." };
  return { ...base, kind: "binary", content: null, notice: "Archivo binario adjuntado sin extracción de contenido." };
}

const BACKUP_DIR = ".bit-backups";
const RESERVED_SEGMENTS = new Set([BACKUP_DIR]);
const SEARCH_SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".venv", "venv", "dist", "build", "coverage",
  "tmp", "temp", ".tmp", ".temp", ".cache", "cache", BACKUP_DIR,
]);
const MAX_SEARCH_RESULTS = 15;
const MAX_SEARCH_DIRECTORIES = 10_000;
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();

function extensionList() {
  return [...WRITABLE_EXTENSIONS].join(" ");
}

function segmentsOf(filePath) {
  return String(filePath)
    .split(/[\\/]/u)
    .filter((segment) => segment.length > 0);
}

function assertWritableExtension(filePath) {
  const extension = extname(String(filePath)).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(extension)) {
    throw new Error(
      `Extensión no permitida: ${extension || "(sin extensión)"}. Solo se admiten: ${extensionList()}`,
    );
  }
  return extension;
}

function assertTextContent(content) {
  if (typeof content !== "string") throw new Error("El contenido debe ser texto UTF-8");
  if (content.includes("\0")) throw new Error("Solo se admiten archivos de texto UTF-8");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES} bytes`);
  return bytes;
}

/**
 * Resuelve la ruta del archivo dentro del sandbox y bloquea la carpeta de
 * respaldos, que no es editable por el modelo.
 */
async function resolveTarget(root, filePath) {
  if (segmentsOf(filePath).some((segment) => RESERVED_SEGMENTS.has(segment))) {
    throw new Error("La carpeta de respaldos de Bit no es editable");
  }
  return enforceSandbox(root, filePath);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Conserva una copia del archivo actual antes de sobrescribirlo, dentro de
 * `<root>/.bit-backups/system/<ruta>`.
 */
async function backupCurrent(root, segments, absolutePath) {
  const canonicalRoot = await canonicalSandboxRoot(root);
  const backupDirectory = join(canonicalRoot, BACKUP_DIR, "system", ...segments);
  await mkdir(backupDirectory, { recursive: true });
  const backupId = `${new Date().toISOString().replaceAll(":", "-")}.bak`;
  await copyFile(absolutePath, join(backupDirectory, backupId), constants.COPYFILE_EXCL);
  return backupId;
}

/**
 * Crea un archivo nuevo dentro del sandbox. No sobrescribe salvo `overwrite`.
 *
 * @param {{root: string, path: string, content: string, overwrite?: boolean}} params
 */
export async function createFile({ root, path, content, overwrite = false } = {}) {
  assertWritableExtension(path);
  const bytes = assertTextContent(content);
  const absolutePath = await resolveTarget(root, path);

  const existed = overwrite ? await pathExists(absolutePath) : false;
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await writeFile(absolutePath, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`El archivo ya existe: ${path}. Use modifyFile para editarlo.`);
    }
    throw error;
  }
  return { ok: true, path: String(path), absolutePath, bytes, created: !existed };
}

/**
 * Reemplaza el contenido de un archivo existente dentro del sandbox, guardando
 * antes una copia de la versión previa.
 *
 * @param {{root: string, path: string, content: string}} params
 */
export async function modifyFile({ root, path, content } = {}) {
  assertWritableExtension(path);
  const bytes = assertTextContent(content);
  const absolutePath = await resolveTarget(root, path);

  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`No existe el archivo: ${path}`);
    throw error;
  }
  if (!info.isFile()) throw new Error(`La ruta no es un archivo: ${path}`);

  const backupId = await backupCurrent(root, segmentsOf(path), absolutePath);
  await writeFile(absolutePath, content, { encoding: "utf8", flag: "w" });
  return { ok: true, path: String(path), absolutePath, bytes, backupId, previousBytes: info.size };
}

/**
 * Lee un archivo de texto dentro del sandbox. Rechaza binarios.
 *
 * @param {{root: string, path: string}} params
 */
export async function readTextFile({ root, path } = {}) {
  assertWritableExtension(path);
  const absolutePath = await resolveTarget(root, path);

  const buffer = await readFile(absolutePath);
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES} bytes`);
  if (buffer.includes(0)) throw new Error("El archivo no es texto UTF-8 válido");
  const content = buffer.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(buffer)) throw new Error("El archivo no es texto UTF-8 válido");
  return { ok: true, path: String(path), absolutePath, content, bytes: buffer.length };
}

/**
 * Indica si el sistema operativo puede abrir el archivo sin ejecutar código.
 * El código fuente se muestra en el explorador en su lugar.
 */
export function isSafeToOpenExternally(filePath) {
  return OPENABLE_EXTENSIONS.has(extname(String(filePath)).toLowerCase());
}

function normalizeSearchExtension(extension) {
  if (extension === undefined || extension === null || extension === "") return "";
  if (typeof extension !== "string") throw new Error("La extensión debe ser texto");
  const normalized = extension.trim().toLowerCase().replace(/^\.+/u, "");
  if (!/^[a-z0-9]{1,16}$/u.test(normalized)) throw new Error("La extensión no tiene un formato válido");
  return `.${normalized}`;
}

function relativeSearchPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

/**
 * Busca nombres de archivos sin salir de la carpeta local elegida para Bit.
 * Los enlaces simbólicos se validan con `enforceSandbox` antes de inspeccionarse
 * y nunca se recorren como directorios.
 *
 * @param {{query?: string, extension?: string, targetDir?: string}} params
 * @returns {Promise<{ok: true, query: string, extension: string, results: Array<{path: string, name: string, size: number, modifiedAt: string}>, truncated: boolean}>}
 */
/**
 * Busca archivos de forma recursiva y rápida sobre varios raíces del sistema
 * (Escritorio, Documentos, Descargas y el área de trabajo de Bit) sin salir de
 * cada raíz. Omite `node_modules`, `.git`, entornos virtuales y carpetas
 * temporales. No sigue enlaces simbólicos como directorios.
 *
 * @param {{query?: string, extension?: string, roots?: Array<string>}} params
 * @returns {Promise<{ok: true, query: string, extension: string, results: Array<{path: string, name: string, size: number, modifiedAt: string, root: string}>, truncated: boolean}>}
 */
export async function searchSystemFiles({ query = "", extension, roots = [] } = {}) {
  if (typeof query !== "string") throw new Error("El término de búsqueda debe ser texto");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedExtension = normalizeSearchExtension(extension);
  if (!normalizedQuery && !normalizedExtension) {
    throw new Error("Indique un nombre o una extensión para buscar");
  }

  const results = [];
  const inspectedRoots = new Set();
  let truncated = false;

  for (const root of roots) {
    if (!root || typeof root !== "string" || inspectedRoots.has(root)) continue;
    inspectedRoots.add(root);

    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      continue;
    }
    if (!rootStat?.isDirectory()) continue;

    const pendingDirectories = [root];
    let inspectedDirectories = 0;

    while (pendingDirectories.length > 0 && results.length < MAX_SEARCH_RESULTS) {
      const directory = pendingDirectories.shift();
      inspectedDirectories += 1;
      if (inspectedDirectories > MAX_SEARCH_DIRECTORIES) {
        truncated = true;
        break;
      }

      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (["EACCES", "EPERM", "ENOENT", "ENOTDIR"].includes(error?.code)) continue;
        throw error;
      }

      entries.sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
      for (const entry of entries) {
        const candidate = join(directory, entry.name);
        const directoryName = entry.name.toLocaleLowerCase();

        if (entry.isDirectory()) {
          if (!SEARCH_SKIP_DIRECTORIES.has(directoryName)) pendingDirectories.push(candidate);
          continue;
        }
        // No seguir enlaces evita ciclos y escapatoria del raíz.
        if (!entry.isFile() || entry.isSymbolicLink()) continue;

        const fileExtension = extname(entry.name).toLowerCase();
        if ((normalizedQuery && !entry.name.toLocaleLowerCase().includes(normalizedQuery))
          || (normalizedExtension && fileExtension !== normalizedExtension)) continue;

        let info;
        try {
          info = await stat(candidate);
        } catch (error) {
          if (["EACCES", "EPERM", "ENOENT", "ENOTDIR"].includes(error?.code)) continue;
          throw error;
        }
        if (!info.isFile()) continue;

        // Asegura que el archivo quede contenido en su raíz (no traversal).
        const rel = relative(root, candidate);
        if (rel.startsWith("..") || rel.startsWith(sep) || /^[a-zA-Z]:[\\/]/.test(rel)) continue;

        results.push({
          path: rel.split(sep).join("/"),
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          root,
        });
        if (results.length >= MAX_SEARCH_RESULTS) {
          truncated = pendingDirectories.length > 0;
          break;
        }
      }
    }

    if (results.length >= MAX_SEARCH_RESULTS) break;
  }

  return { ok: true, query: query.trim(), extension: normalizedExtension, results, truncated };
}

export async function searchFiles({ query = "", extension, targetDir = WORKSPACE_DIR } = {}) {
  if (typeof query !== "string") throw new Error("El término de búsqueda debe ser texto");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedExtension = normalizeSearchExtension(extension);
  if (!normalizedQuery && !normalizedExtension) {
    throw new Error("Indique un nombre o una extensión para buscar");
  }

  const root = await canonicalSandboxRoot(targetDir);
  const results = [];
  const pendingDirectories = [root];
  let inspectedDirectories = 0;
  let truncated = false;

  while (pendingDirectories.length > 0 && results.length < MAX_SEARCH_RESULTS) {
    const directory = pendingDirectories.shift();
    inspectedDirectories += 1;
    if (inspectedDirectories > MAX_SEARCH_DIRECTORIES) {
      truncated = true;
      break;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (["EACCES", "EPERM", "ENOENT", "ENOTDIR"].includes(error?.code)) continue;
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      const candidatePath = relativeSearchPath(root, candidate);
      let safePath;
      try {
        // Obligatorio incluso para directorios omitidos: bloquea traversal y
        // enlaces que apunten fuera antes de cualquier acceso posterior.
        safePath = await enforceSandbox(root, candidatePath);
      } catch (error) {
        if (error?.code === "SANDBOX_DENIED" || ["ENOENT", "ENOTDIR"].includes(error?.code)) continue;
        throw error;
      }

      const directoryName = entry.name.toLocaleLowerCase();
      if (entry.isDirectory()) {
        if (!SEARCH_SKIP_DIRECTORIES.has(directoryName)) pendingDirectories.push(safePath);
        continue;
      }
      // No seguir enlaces evita ciclos; enforceSandbox ya verificó que no salgan.
      if (!entry.isFile() || entry.isSymbolicLink()) continue;

      const fileExtension = extname(entry.name).toLowerCase();
      if ((normalizedQuery && !entry.name.toLocaleLowerCase().includes(normalizedQuery))
        || (normalizedExtension && fileExtension !== normalizedExtension)) continue;

      let info;
      try {
        info = await stat(safePath);
      } catch (error) {
        if (["EACCES", "EPERM", "ENOENT", "ENOTDIR"].includes(error?.code)) continue;
        throw error;
      }
      if (!info.isFile()) continue;
      results.push({
        path: relativeSearchPath(root, safePath),
        name: entry.name,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
      if (results.length >= MAX_SEARCH_RESULTS) {
        truncated = pendingDirectories.length > 0 || entries.indexOf(entry) < entries.length - 1;
        break;
      }
    }
  }

  return { ok: true, query: query.trim(), extension: normalizedExtension, results, truncated };
}
