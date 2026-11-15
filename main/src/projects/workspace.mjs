import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const MAX_LIST_ITEMS = 500;
const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
const BACKUP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z(?:-\d+)?\.bak$/u;

function assertProjectName(project) {
  if (typeof project !== "string" || !PROJECT_NAME_RE.test(project) || project.endsWith(".") || project.endsWith(" ")) {
    throw new Error("Nombre de proyecto no válido");
  }
  if (/^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/iu.test(project)) {
    throw new Error("El nombre de proyecto está reservado por Windows");
  }
}

function assertTextContent(content) {
  if (typeof content !== "string" || content.includes("\0")) throw new Error("Solo se admiten archivos de texto UTF-8");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES} bytes`);
}

async function readUtf8File(path, maxBytes = MAX_FILE_BYTES) {
  const buffer = await readFile(path);
  if (buffer.length > maxBytes || buffer.includes(0)) throw new Error(`El archivo no es texto UTF-8 válido o supera ${maxBytes} bytes`);
  const content = buffer.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(buffer)) throw new Error("El archivo no contiene texto UTF-8 válido");
  return content;
}

function normalizeRelativePath(filePath, { allowRoot = false } = {}) {
  if (typeof filePath !== "string" || filePath.length > 500 || filePath.includes("\0")) {
    throw new Error("Ruta de archivo no válida");
  }
  const normalized = filePath.replaceAll("\\", "/");
  if (allowRoot && (normalized === "" || normalized === ".")) return "";
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === ".." || part === ".bit-backups" || /[<>:"|?*\u0000-\u001f]/u.test(part)) ||
    parts.some((part) => part.endsWith(".") || part.endsWith(" ")) ||
    parts.some((part) => /^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/iu.test(part))
  ) {
    throw new Error("La ruta debe ser relativa, segura y estar dentro del proyecto");
  }
  return parts.join("/");
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function assertDirectory(path, { create = false } = {}) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`La ruta no es una carpeta segura: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    await mkdir(path);
  }
}

async function resolveWorkspaceRoot(root) {
  if (typeof root !== "string" || !isAbsolute(root) || root.startsWith("\\\\") || root.startsWith("//")) {
    throw new Error("Elija una carpeta local absoluta para los proyectos");
  }
  const selectedInfo = await lstat(root);
  if (selectedInfo.isSymbolicLink() || !selectedInfo.isDirectory()) {
    throw new Error("La ubicación de proyectos debe ser una carpeta local normal, no un enlace");
  }
  const canonicalRoot = await realpath(root);
  await assertDirectory(canonicalRoot);
  let current = canonicalRoot;
  while (true) {
    try {
      await lstat(join(current, ".git"));
      throw new Error("Por privacidad, no se pueden guardar proyectos dentro de un repositorio Git");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return canonicalRoot;
}

export async function validateProjectsRoot(root) {
  return resolveWorkspaceRoot(root);
}

async function ensureProject(root, project, { create = false } = {}) {
  assertProjectName(project);
  const projectPath = resolve(root, project);
  if (!isWithin(root, projectPath) || projectPath === root) throw new Error("Ruta de proyecto fuera del espacio local");
  await assertDirectory(projectPath, { create });
  return projectPath;
}

async function ensureSafePath(root, projectPath, filePath, { createParents = false } = {}) {
  const normalized = normalizeRelativePath(filePath);
  const parts = normalized.split("/");
  const target = resolve(projectPath, ...parts);
  if (!isWithin(projectPath, target) || target === projectPath) throw new Error("Ruta fuera del proyecto");

  let current = projectPath;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    await assertDirectory(current, { create: createParents });
  }
  return { target, normalized };
}

function resolveModelAssetPath(modelPath, uri) {
  if (typeof uri !== "string" || !uri || uri.startsWith("/") || uri.includes("?") || uri.includes("#")) {
    throw new Error("El glTF referencia una ruta de buffer no válida");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error("El glTF referencia una ruta de buffer mal codificada");
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(decoded) || decoded.startsWith("/") || decoded.startsWith("\\")) {
    throw new Error("Solo se admiten buffers locales dentro del proyecto");
  }
  const parts = modelPath.split("/").slice(0, -1);
  for (const part of decoded.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("El glTF intenta acceder fuera del proyecto");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return normalizeRelativePath(parts.join("/"));
}

async function ensureBackupPath(root, project, filePath) {
  const normalized = normalizeRelativePath(filePath);
  const parts = normalized.split("/");
  const backupRoot = resolve(root, ".bit-backups");
  const backupProjectRoot = join(backupRoot, project);
  await assertDirectory(backupRoot, { create: true });
  await assertDirectory(backupProjectRoot, { create: true });
  const fileName = parts.pop();
  let backupDirectory = backupProjectRoot;
  for (const part of parts) {
    backupDirectory = join(backupDirectory, part);
    await assertDirectory(backupDirectory, { create: true });
  }
  backupDirectory = join(backupDirectory, `${fileName}.versions`);
  await assertDirectory(backupDirectory, { create: true });
  if (!isWithin(backupRoot, backupDirectory)) throw new Error("Ruta de respaldo no válida");
  return backupDirectory;
}

export async function writeWorkspaceAudit(auditPath, entry, now = () => new Date()) {
  if (typeof auditPath !== "string" || !auditPath) throw new Error("No se configuró la ruta local de auditoría");
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`, "utf8");
}

async function copyVersion(source, directory, now) {
  const timestamp = now().toISOString().replaceAll(":", "-");
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const backupId = `${timestamp}${suffix}.bak`;
    try {
      await copyFile(source, join(directory, backupId), constants.COPYFILE_EXCL);
      return backupId;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("No se pudo asignar un nombre único al respaldo");
}

export function createProjectWorkspace({ root, auditPath, now = () => new Date() } = {}) {
  async function audited(action, details, operation) {
    const base = { action: `workspace.${action}`, ...details };
    await writeWorkspaceAudit(auditPath, { ...base, status: "started" }, now);
    try {
      const result = await operation();
      await writeWorkspaceAudit(auditPath, { ...base, status: "completed" }, now);
      return result;
    } catch (error) {
      try {
        await writeWorkspaceAudit(auditPath, { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) }, now);
      } catch (auditError) {
        throw new Error(`Falló la operación (${error instanceof Error ? error.message : String(error)}) y tampoco se pudo registrar el fallo (${auditError.message})`, { cause: error });
      }
      throw error;
    }
  }

  return Object.freeze({
    async listProjects() {
      return audited("list-projects", {}, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const entries = await readdir(canonicalRoot, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== ".bit-backups")
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b, "es"))
          .slice(0, MAX_LIST_ITEMS);
      });
    },

    async createProject({ project }) {
      return audited("create-project", { project }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = resolve(canonicalRoot, project);
        assertProjectName(project);
        if (!isWithin(canonicalRoot, projectPath) || projectPath === canonicalRoot) throw new Error("Ruta de proyecto fuera del espacio local");
        await mkdir(projectPath);
        return { project, created: true };
      });
    },

    async listFiles({ project, path = "" }) {
      return audited("list-files", { project, path }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const normalized = normalizeRelativePath(path, { allowRoot: true });
        const start = normalized ? await ensureSafePath(canonicalRoot, projectPath, normalized) : { target: projectPath, normalized: "" };
        const startInfo = await lstat(start.target);
        if (startInfo.isSymbolicLink() || !startInfo.isDirectory()) throw new Error("La ruta solicitada no es una carpeta segura");

        const files = [];
        async function walk(directory, prefix) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name === ".bit-backups") continue;
            const childPath = join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error(`Se bloqueó un enlace simbólico: ${entry.name}`);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(childPath, relativePath);
            else if (entry.isFile()) files.push(relativePath);
            if (files.length > MAX_LIST_ITEMS) throw new Error(`El proyecto supera el límite de ${MAX_LIST_ITEMS} archivos por consulta`);
          }
        }
        await walk(start.target, normalized);
        return files.sort((a, b) => a.localeCompare(b, "es"));
      });
    },

    async readFile({ project, path }) {
      return audited("read-file", { project, path }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path);
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("El elemento solicitado no es un archivo regular");
        if (info.size > MAX_FILE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES} bytes`);
        return { project, path: normalized, content: await readUtf8File(target) };
      });
    },

    async getFileMetadata({ project, path }) {
      return audited("get-file-metadata", { project, path }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path);
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("El elemento solicitado no es un archivo regular");
        return {
          project,
          path: normalized,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        };
      });
    },

    async readModel({ project, path }) {
      return audited("read-model", { project, path }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path);
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("El modelo solicitado no es un archivo regular");
        const extension = normalized.split(".").pop().toLowerCase();
        if (!["stl", "3mf", "obj", "glb", "gltf"].includes(extension)) throw new Error("Solo se admiten archivos STL, 3MF, OBJ, GLB y glTF");
        if (info.size > MAX_MODEL_BYTES) throw new Error(`El archivo 3D supera el límite de ${MAX_MODEL_BYTES} bytes`);
        const data = await readFile(target);
        if (data.length > MAX_MODEL_BYTES) throw new Error(`El archivo 3D supera el límite de ${MAX_MODEL_BYTES} bytes`);
        const assets = {};
        if (extension === "gltf") {
          let document;
          try {
            document = JSON.parse(data.toString("utf8"));
          } catch {
            throw new Error("El archivo glTF no contiene JSON válido");
          }
          if (!document || typeof document !== "object" || Array.isArray(document) || (document.buffers !== undefined && !Array.isArray(document.buffers))) {
            throw new Error("El glTF no contiene una lista de buffers válida");
          }
          let totalAssetBytes = data.length;
          const loadedAssets = new Set();
          for (const buffer of document.buffers || []) {
            if (!buffer || typeof buffer !== "object" || (buffer.uri !== undefined && typeof buffer.uri !== "string")) {
              throw new Error("El glTF contiene una definición de buffer no válida");
            }
            if (!buffer.uri || buffer.uri.startsWith("data:")) continue;
            if (loadedAssets.has(buffer.uri)) continue;
            const assetPath = resolveModelAssetPath(normalized, buffer.uri);
            const { target: assetTarget, normalized: safeAssetPath } = await ensureSafePath(canonicalRoot, projectPath, assetPath);
            const assetInfo = await lstat(assetTarget);
            if (assetInfo.isSymbolicLink() || !assetInfo.isFile()) {
              throw new Error(`El buffer glTF no es un archivo regular: ${safeAssetPath}`);
            }
            if (assetInfo.size > MAX_MODEL_BYTES || totalAssetBytes + assetInfo.size > MAX_MODEL_BYTES) {
              throw new Error(`Los archivos del modelo superan el límite conjunto de ${MAX_MODEL_BYTES} bytes`);
            }
            const assetData = await readFile(assetTarget);
            if (assetData.length !== assetInfo.size) throw new Error(`El buffer glTF cambió mientras se leía: ${safeAssetPath}`);
            Object.defineProperty(assets, buffer.uri, {
              value: assetData,
              enumerable: true,
              configurable: true,
              writable: true,
            });
            loadedAssets.add(buffer.uri);
            totalAssetBytes += assetData.length;
          }
        }
        return { project, path: normalized, data, assets };
      });
    },

    async createFile({ project, path, content }) {
      return audited("create-file", { project, path }, async () => {
        assertTextContent(content);
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path, { createParents: true });
        await writeFile(target, content, { encoding: "utf8", flag: "wx" });
        return { project, path: normalized, created: true, backupId: null };
      });
    },

    async updateFile({ project, path, content }) {
      return audited("update-file", { project, path }, async () => {
        assertTextContent(content);
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path);
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("Solo se pueden modificar archivos regulares existentes");
        if (info.size > MAX_FILE_BYTES) throw new Error(`El archivo original supera el límite de ${MAX_FILE_BYTES} bytes`);
        await readUtf8File(target);
        const backupDirectory = await ensureBackupPath(canonicalRoot, project, normalized);
        const backupId = await copyVersion(target, backupDirectory, now);
        await writeFile(target, content, "utf8");
        return { project, path: normalized, updated: true, backupId };
      });
    },

    async listBackups({ project, path }) {
      return audited("list-backups", { project, path }, async () => {
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const normalized = path === undefined ? "" : normalizeRelativePath(path);
        const backupsRoot = resolve(canonicalRoot, ".bit-backups", project);
        try {
          await assertDirectory(backupsRoot);
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
        const backups = [];
        async function walk(directory, prefix) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const childPath = join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error("Se bloqueó un enlace simbólico en los respaldos");
            if (entry.isDirectory()) {
              const isVersions = entry.name.endsWith(".versions");
              const originalPath = isVersions
                ? (prefix ? `${prefix}/${entry.name.slice(0, -9)}` : entry.name.slice(0, -9))
                : prefix;
              if (!normalized || originalPath === normalized) {
                if (isVersions) {
                  for (const backup of await readdir(childPath, { withFileTypes: true })) {
                    if (!backup.isFile() || !BACKUP_NAME_RE.test(backup.name)) continue;
                    const backupInfo = await stat(join(childPath, backup.name));
                    backups.push({ path: originalPath, backupId: backup.name, size: backupInfo.size });
                  }
                } else {
                  await walk(childPath, originalPath);
                }
              }
            }
          }
        }
        await walk(backupsRoot, "");
        return backups.sort((a, b) => b.backupId.localeCompare(a.backupId)).slice(0, MAX_LIST_ITEMS);
      });
    },

    async restoreBackup({ project, path, backupId }) {
      return audited("restore-backup", { project, path, backupId }, async () => {
        if (typeof backupId !== "string" || !BACKUP_NAME_RE.test(backupId)) throw new Error("Identificador de respaldo no válido");
        const canonicalRoot = await resolveWorkspaceRoot(root);
        const projectPath = await ensureProject(canonicalRoot, project);
        const { target, normalized } = await ensureSafePath(canonicalRoot, projectPath, path);
        const backupDirectory = await ensureBackupPath(canonicalRoot, project, normalized);
        const backupPath = join(backupDirectory, backupId);
        const backupInfo = await lstat(backupPath);
        if (backupInfo.isSymbolicLink() || !backupInfo.isFile()) throw new Error("No se encontró el respaldo solicitado");
        if (backupInfo.size > MAX_FILE_BYTES) throw new Error(`El respaldo supera el límite de ${MAX_FILE_BYTES} bytes`);
        const backupContent = await readUtf8File(backupPath);
        let currentInfo;
        try {
          currentInfo = await lstat(target);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        let currentBackupId = null;
        if (currentInfo) {
          if (currentInfo.isSymbolicLink() || !currentInfo.isFile()) throw new Error("Solo se puede restaurar sobre un archivo regular");
          if (currentInfo.size > MAX_FILE_BYTES) throw new Error(`El archivo actual supera el límite de ${MAX_FILE_BYTES} bytes`);
          await readUtf8File(target);
          const currentBackupDirectory = await ensureBackupPath(canonicalRoot, project, normalized);
          currentBackupId = await copyVersion(target, currentBackupDirectory, now);
        }
        await writeFile(target, backupContent, "utf8");
        return { project, path: normalized, restored: true, backupId, currentBackupId };
      });
    },
  });
}
