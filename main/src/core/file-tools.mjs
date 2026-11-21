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
import { copyFile, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSandboxRoot, enforceSandbox } from "./sandbox.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_DROPPED_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_DROPPED_MODEL_BYTES = 64 * 1024 * 1024;
export const MAX_DROPPED_PREVIEW_BYTES = 16 * 1024 * 1024;
const DROPPED_MODEL_EXTENSIONS = new Set([".stl", ".3mf", ".obj", ".glb", ".gltf"]);

/** Lee un modelo elegido mediante arrastre con el mismo límite que el visor. */
export async function readDroppedModel(filePath) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("La ruta del modelo debe ser absoluta");
  const extension = extname(filePath).toLowerCase();
  if (!DROPPED_MODEL_EXTENSIONS.has(extension)) throw new Error("El archivo no es STL, 3MF, OBJ, GLB o glTF");
  const info = await lstat(filePath);
  if (!info.isFile()) throw new Error("La ruta soltada no corresponde a un archivo regular");
  if (info.size > MAX_DROPPED_MODEL_BYTES) throw new Error(`El archivo 3D supera el límite de ${MAX_DROPPED_MODEL_BYTES} bytes`);
  const data = await readFile(filePath);
  if (data.length > MAX_DROPPED_MODEL_BYTES) throw new Error(`El archivo 3D supera el límite de ${MAX_DROPPED_MODEL_BYTES} bytes`);
  const assets = {};
  if (extension === ".gltf") {
    let document;
    try { document = JSON.parse(data.toString("utf8")); }
    catch { throw new Error("El archivo glTF no contiene JSON válido"); }
    if (!document || typeof document !== "object" || Array.isArray(document) || (document.buffers !== undefined && !Array.isArray(document.buffers))) {
      throw new Error("El glTF no contiene una lista de buffers válida");
    }
    const directory = await realpath(dirname(filePath));
    let totalBytes = data.length;
    for (const buffer of document.buffers || []) {
      if (!buffer || typeof buffer !== "object" || (buffer.uri !== undefined && typeof buffer.uri !== "string")) throw new Error("El glTF contiene un buffer no válido");
      const uri = buffer.uri;
      if (!uri || uri.startsWith("data:") || Object.hasOwn(assets, uri)) continue;
      let decoded;
      try { decoded = decodeURIComponent(uri); }
      catch { throw new Error("El glTF referencia una ruta de buffer mal codificada"); }
      if (!decoded || decoded.includes("?") || decoded.includes("#") || decoded.includes("\0") || /^[a-z][a-z\d+.-]*:/iu.test(decoded) || isAbsolute(decoded) || decoded.startsWith("\\")) {
        throw new Error("El glTF referencia un buffer local no válido");
      }
      const assetPath = resolve(directory, decoded);
      const relativePath = relative(directory, assetPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error("El buffer glTF sale de la carpeta del modelo");
      const assetInfo = await lstat(assetPath);
      if (!assetInfo.isFile()) throw new Error("El buffer glTF no es un archivo regular");
      if (totalBytes + assetInfo.size > MAX_DROPPED_MODEL_BYTES) throw new Error(`Los archivos del modelo superan el límite conjunto de ${MAX_DROPPED_MODEL_BYTES} bytes`);
      const canonicalAsset = await realpath(assetPath);
      const canonicalRelative = relative(directory, canonicalAsset);
      if (!canonicalRelative || canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) throw new Error("El buffer glTF sale de la carpeta del modelo");
      const assetData = await readFile(assetPath);
      if (assetData.length !== assetInfo.size) throw new Error("El buffer glTF cambió mientras se leía");
      Object.defineProperty(assets, uri, { value: assetData, enumerable: true });
      totalBytes += assetData.length;
    }
  }
  return { name: basename(filePath), path: filePath, data, assets };
}

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
const DROPPED_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov"]);
const DROPPED_PREVIEW_MIME = Object.freeze({
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
});

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

/** Construye una vista previa local sin crear ni abrir un proyecto. */
export async function previewDroppedFile(filePath) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("La ruta del archivo debe ser absoluta");
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("La ruta soltada no corresponde a un archivo");
  if (info.size > MAX_DROPPED_PREVIEW_BYTES) throw new Error(`El archivo supera el límite de vista previa de ${MAX_DROPPED_PREVIEW_BYTES} bytes`);
  const extension = extname(filePath).toLowerCase();
  const base = { name: basename(filePath), path: filePath, extension, bytes: info.size };
  if (DROPPED_MODEL_EXTENSIONS.has(extension)) {
    return { ...base, kind: "model3d", content: null, notice: "Modelo 3D detectado; se abrirá en el visor 3D." };
  }
  if (DROPPED_TEXT_EXTENSIONS.has(extension)) {
    if (info.size > MAX_FILE_BYTES) return { ...base, kind: "text", content: null, notice: "Texto demasiado grande para mostrar completo; puede procesarse por partes." };
    const data = await readFile(filePath);
    if (data.includes(0)) return { ...base, kind: "binary", content: null, notice: "Archivo binario; se muestra su información sin ejecutar contenido." };
    return { ...base, kind: "text", content: data.toString("utf8"), notice: "Vista previa de texto local." };
  }
  if (extension === ".pdf") {
    const data = await readFile(filePath);
    let content = null;
    let pageCount = null;
    try {
      const extracted = await extractPdfData(data);
      content = extracted.content;
      pageCount = extracted.pageCount;
    } catch {
      // El visor PDF sigue disponible aunque el extractor local no pueda leer
      // un documento dañado o una variante no compatible.
      pageCount = inferPdfPageCount(data);
    }
    return {
      ...base,
      kind: "pdf",
      content,
      pageCount,
      mime: DROPPED_PREVIEW_MIME[extension],
      // El visor PDF de Chromium carga de forma fiable una ruta file:// local;
      // la data URL queda como respaldo para runtimes que no acepten file URL.
      // Fit conserva la hoja completa dentro del visor de Bit. El centrado y
      // el recorte de la barra nativa se resuelven en la superficie visual,
      // para que la página no quede ampliada ni cortada verticalmente.
      fileUrl: `${pathToFileURL(filePath).href}#page=1&view=fit&toolbar=0&navpanes=0&statusbar=0&scrollbar=0`,
      dataUrl: `data:${DROPPED_PREVIEW_MIME[extension]};base64,${data.toString("base64")}`,
      notice: content ? "Vista previa y texto extraídos localmente." : "Vista previa PDF local disponible.",
    };
  }
  if (DROPPED_PREVIEW_MIME[extension]) {
    const data = await readFile(filePath);
    return { ...base, kind: DROPPED_IMAGE_EXTENSIONS.has(extension) ? "image" : DROPPED_AUDIO_EXTENSIONS.has(extension) ? "audio" : DROPPED_VIDEO_EXTENSIONS.has(extension) ? "video" : "pdf", mime: DROPPED_PREVIEW_MIME[extension], dataUrl: `data:${DROPPED_PREVIEW_MIME[extension]};base64,${data.toString("base64")}`, notice: "Vista previa local disponible." };
  }
  if (DROPPED_DOCUMENT_EXTENSIONS.has(extension)) {
    try {
      const extracted = await readFileContent({ filePath, allowedRoots: [dirname(filePath)] });
      return { ...base, kind: "document", content: extracted.content, truncated: extracted.truncated, notice: "Vista previa de documento extraída localmente." };
    } catch (error) {
      return { ...base, kind: "document", content: null, notice: `Documento detectado. No se pudo extraer el texto localmente: ${error.message}` };
    }
  }
  return { ...base, kind: "binary", content: null, notice: "Formato reconocido como archivo local; se muestra su información sin ejecutar contenido." };
}

const BACKUP_DIR = ".bit-backups";
const RESERVED_SEGMENTS = new Set([BACKUP_DIR]);
const SEARCH_SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".venv", "venv", "dist", "build", "coverage",
  "tmp", "temp", ".tmp", ".temp", ".cache", "cache", BACKUP_DIR,
]);
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_DIRECTORIES = 10_000;
const MAX_EXTRACTED_CHARACTERS = 15_000;
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
        const relativeName = relative(root, candidate).split(sep).join("/").toLocaleLowerCase();
        if ((normalizedQuery && !entry.name.toLocaleLowerCase().includes(normalizedQuery) && !relativeName.includes(normalizedQuery))
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
          folder: dirname(rel).split(sep).join("/"),
          extension: fileExtension,
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
      const relativeName = relative(root, safePath).split(sep).join("/").toLocaleLowerCase();
      if ((normalizedQuery && !entry.name.toLocaleLowerCase().includes(normalizedQuery) && !relativeName.includes(normalizedQuery))
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
        folder: dirname(relativeSearchPath(root, safePath)),
        extension: fileExtension,
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

const CONTENT_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".csv", ".pptx", ".txt", ".md", ".py", ".js", ".mjs",
  ".html", ".css", ".json",
]);

function normalizedSearchTerm(searchTerm) {
  if (searchTerm === undefined || searchTerm === null) return "";
  if (typeof searchTerm !== "string") throw new Error("searchTerm debe ser texto");
  return searchTerm.trim();
}

function trimExtractedContent(content, searchTerm) {
  if (content.length <= MAX_EXTRACTED_CHARACTERS) return { content, truncated: false };
  const term = normalizedSearchTerm(searchTerm).toLocaleLowerCase();
  const lower = content.toLocaleLowerCase();
  const chunks = [];
  let from = 0;
  while (term && chunks.length < 8) {
    const index = lower.indexOf(term, from);
    if (index < 0) break;
    chunks.push(content.slice(Math.max(0, index - 1_200), Math.min(content.length, index + 2_800)));
    from = index + term.length;
  }
  if (chunks.length === 0) chunks.push(content.slice(0, MAX_EXTRACTED_CHARACTERS));
  return { content: chunks.join("\n\n…\n\n").slice(0, MAX_EXTRACTED_CHARACTERS), truncated: true };
}

async function authorizedFilePath(filePath, allowedRoots) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("filePath debe ser una ruta absoluta");
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) throw new Error("No hay raíces locales autorizadas para leer");
  const safeFile = await realpath(filePath);
  for (const root of allowedRoots) {
    if (typeof root !== "string" || !isAbsolute(root)) continue;
    const safeRoot = await realpath(root);
    const rel = relative(safeRoot, safeFile);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return safeFile;
  }
  throw new Error("La ruta está fuera de las carpetas locales autorizadas");
}

async function extractOfficeText(filePath, extension, buffer) {
  if (extension === ".pdf") {
    return (await extractPdfData(buffer)).content;
  }
  if (extension === ".docx") {
    const module = await import("mammoth");
    const mammoth = module.default || module;
    return String((await mammoth.extractRawText({ buffer })).value || "");
  }
  if (extension === ".xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    if (!ExcelJS) throw new Error("exceljs no está disponible");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook.worksheets.map((sheet) => {
      const rows = [];
      sheet.eachRow((row) => rows.push(row.values.slice(1).map((value) => String(value ?? "")).join("\t")));
      return `## ${sheet.name}\n${rows.join("\n")}`;
    }).join("\n\n");
  }
  if (extension === ".pptx") {
    const module = await import("officeparser");
    const parser = module.default || module;
    const parse = parser.parseOfficeAsync || parser.parseOffice;
    if (typeof parse !== "function") throw new Error("officeparser no expone una API compatible");
    if (parse.length >= 2) return await new Promise((resolveText, reject) => parse(filePath, (error, text) => error ? reject(error) : resolveText(String(text || ""))));
    return String(await parse(filePath) || "");
  }
  return buffer.toString("utf8");
}

async function extractPdfData(buffer) {
  const module = await import("pdf-parse");
  const parse = module.default || module.pdf || module;
  if (typeof parse !== "function") throw new Error("pdf-parse no expone un parser compatible");
  const parsed = await parse(buffer);
  return {
    content: String(parsed.text || ""),
    pageCount: Number.isInteger(parsed.numpages) && parsed.numpages > 0 ? parsed.numpages : null,
  };
}

function inferPdfPageCount(buffer) {
  const source = Buffer.from(buffer).toString("latin1");
  const match = source.match(/\/Type\s*\/Pages[\s\S]{0,1024}?\/Count\s+(\d+)/u);
  const count = Number(match?.[1]);
  return Number.isInteger(count) && count > 0 ? count : null;
}

/** Extrae contenido local de documentos y lo limita priorizando searchTerm. */
export async function readFileContent({ filePath, searchTerm = "", allowedRoots = [] } = {}) {
  const safePath = await authorizedFilePath(filePath, allowedRoots);
  const info = await stat(safePath);
  if (!info.isFile()) throw new Error("La ruta no corresponde a un archivo");
  const extension = extname(safePath).toLowerCase();
  if (!CONTENT_EXTENSIONS.has(extension)) throw new Error(`Formato no soportado para lectura: ${extension || "sin extensión"}`);
  const content = trimExtractedContent(await extractOfficeText(safePath, extension, await readFile(safePath)), searchTerm);
  return { ok: true, filePath: safePath, name: basename(safePath), extension, size: info.size, ...content, searchTerm: normalizedSearchTerm(searchTerm) };
}

export const universalFileReader = readFileContent;

function stlFacet(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return `facet normal ${nx / length} ${ny / length} ${nz / length}\n outer loop\n  vertex ${a.join(" ")}\n  vertex ${b.join(" ")}\n  vertex ${c.join(" ")}\n endloop\nendfacet`;
}

/** Genera STL ASCII determinista sin ejecutar scripts ni cargar dependencias nativas. */
export function createParametricStl({ shape, x, y, z, diameter, segments = 48 } = {}) {
  const height = Number(z);
  if (!Number.isFinite(height) || height <= 0) throw new Error("z debe ser mayor que cero");
  const triangles = [];
  let dimensions;
  let volume;
  if (shape === "box") {
    const width = Number(x), depth = Number(y);
    if (![width, depth].every(value => Number.isFinite(value) && value > 0)) throw new Error("Una caja requiere x e y mayores que cero");
    const hx = width / 2, hd = depth / 2;
    const v = [[-hx,0,-hd],[hx,0,-hd],[hx,0,hd],[-hx,0,hd],[-hx,height,-hd],[hx,height,-hd],[hx,height,hd],[-hx,height,hd]];
    for (const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) triangles.push([v[a],v[b],v[c]],[v[a],v[c],v[d]]);
    dimensions = { x: width, y: height, z: depth, unit: "mm" };
    volume = width * depth * height;
  } else if (shape === "cylinder") {
    const size = Number(diameter), count = Math.max(12, Math.min(128, Math.trunc(segments)));
    if (!Number.isFinite(size) || size <= 0) throw new Error("Un cilindro requiere diameter mayor que cero");
    const radius = size / 2, bottom = [0,0,0], top = [0,height,0];
    for (let index = 0; index < count; index += 1) {
      const a = index * Math.PI * 2 / count, b = (index + 1) * Math.PI * 2 / count;
      const p0=[Math.cos(a)*radius,0,Math.sin(a)*radius], p1=[Math.cos(b)*radius,0,Math.sin(b)*radius];
      const q0=[p0[0],height,p0[2]], q1=[p1[0],height,p1[2]];
      triangles.push([bottom,p1,p0],[top,q0,q1],[p0,p1,q1],[p0,q1,q0]);
    }
    dimensions = { x: size, y: height, z: size, unit: "mm" };
    volume = Math.PI * radius * radius * height;
  } else throw new Error("Forma 3D no permitida");
  return {
    content: `solid bit_parametric\n${triangles.map(points => stlFacet(...points)).join("\n")}\nendsolid bit_parametric\n`,
    metadata: { shape, dimensions, volumeMm3: volume, triangleCount: triangles.length },
  };
}
