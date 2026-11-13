/**
 * Sandbox de rutas para Bit (Zero-Trust, local y privado).
 *
 * `resolveSandboxPath` hace la matemática de contención de forma síncrona y pura:
 * normaliza con `path.resolve` y exige que el resultado caiga estrictamente dentro
 * del raíz elegido por el usuario.
 *
 * `enforceSandbox` agrega la verificación de enlaces: canónica el raíz y el
 * destino con `realpath` antes de validar, de modo que un symlink colocado dentro
 * del raíz no pueda apuntar hacia afuera.
 *
 * LÍMITE HONESTO: esto es una allowlist a nivel de aplicación, no un sandbox
 * operativo. Un binario de la whitelist o una acción del sistema operativo quedan
 * fuera de este control.
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_PATH_LENGTH = 1024;
const MAX_ROOT_LENGTH = 1024;

export class SandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = "SandboxError";
    this.code = "SANDBOX_DENIED";
  }
}

function assertString(value, message) {
  if (typeof value !== "string") throw new SandboxError(message);
  if (!value) throw new SandboxError(message);
  if (value.includes("\0")) throw new SandboxError("La ruta contiene caracteres nulos");
  return value;
}

/**
 * Valida el raíz del sandbox: debe ser una ruta absoluta local, sin UNC ni
 * namespaces de dispositivo de Windows.
 */
export function assertSandboxRoot(root) {
  const value = assertString(root, "No se configuró una carpeta local para trabajar");
  if (value.length > MAX_ROOT_LENGTH) throw new SandboxError("La carpeta del sandbox es demasiado larga");
  if (value.includes("%")) throw new SandboxError("La carpeta del sandbox contiene variables de entorno");
  if (value.startsWith("\\\\") || value.startsWith("//")) {
    throw new SandboxError("La carpeta del sandbox no puede ser una ruta de red (UNC)");
  }
  if (!isAbsolute(value)) {
    throw new SandboxError("La carpeta del sandbox debe ser una ruta absoluta");
  }
  const resolved = resolve(value);
  if (!isAbsolute(resolved)) throw new SandboxError("La carpeta del sandbox debe ser una ruta absoluta");
  if (resolved.startsWith("\\\\?\\") || resolved.startsWith("\\\\.\\")) {
    throw new SandboxError("Namespace de dispositivo no permitido como carpeta del sandbox");
  }
  return resolved;
}

/**
 * Determina si `child` está dentro (o es) `parent`.
 * `path.relative` en win32 compara sin distinguir mayúsculas.
 */
export function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function hasParentTraversal(rawPath) {
  return String(rawPath)
    .split(/[\\/]/u)
    .some((segment) => segment === "..");
}

function hasAlternateDataStream(resolved) {
  // "C:\dir\file.txt:stream" -> tras quitar la unidad sobra otro ":"
  const withoutDrive = resolved.replace(/^[A-Za-z]:/u, "");
  return withoutDrive.includes(":");
}

/**
 * Resuelve `targetPath` dentro de `root` y falla con `SandboxError` si escapa.
 * Síncrono y puro: no toca el disco.
 *
 * @param {string} root - Carpeta absoluta del sandbox
 * @param {string} targetPath - Ruta relativa o absoluta del archivo
 * @returns {string} Ruta absoluta normalizada dentro de `root`
 */
export function resolveSandboxPath(root, targetPath) {
  const sandboxRoot = assertSandboxRoot(root);

  if (typeof targetPath !== "string" || !targetPath) {
    throw new SandboxError("Se requiere una ruta de archivo");
  }
  if (targetPath.length > MAX_PATH_LENGTH) throw new SandboxError("La ruta del archivo es demasiado larga");
  if (targetPath.includes("\0")) throw new SandboxError("La ruta contiene caracteres nulos");
  if (targetPath.includes("%")) throw new SandboxError("La ruta contiene variables de entorno");
  if (targetPath.startsWith("\\\\") || targetPath.startsWith("//")) {
    throw new SandboxError("No se permiten rutas de red (UNC)");
  }
  if (hasParentTraversal(targetPath)) {
    throw new SandboxError("Path traversal detectado: la ruta no puede contener '..'");
  }

  const resolved = resolve(sandboxRoot, targetPath);

  if (resolved.startsWith("\\\\?\\") || resolved.startsWith("\\\\.\\")) {
    throw new SandboxError("Namespace de dispositivo no permitido");
  }
  if (hasAlternateDataStream(resolved)) {
    throw new SandboxError("No se permiten streams alternos de NTFS en la ruta");
  }
  if (resolved === sandboxRoot) {
    throw new SandboxError("La ruta apunta a la carpeta del sandbox, no a un archivo dentro de ella");
  }
  if (!isWithin(sandboxRoot, resolved)) {
    throw new SandboxError("Ruta fuera del sandbox: la operación quedó bloqueada");
  }
  return resolved;
}

/**
 * Canónica una ruta resolviendo los enlaces de los componentes que ya existen,
 * sin fallar si el archivo final todavía no existe.
 */
async function canonicalize(target) {
  const tail = [];
  let current = target;
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.slice().reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw new SandboxError(`No se pudo resolver la ruta: ${target}`);
      tail.push(basename(current));
      current = parent;
    }
  }
  throw new SandboxError(`Profundidad máxima de resolución alcanzada: ${target}`);
}

/**
 * Devuelve la forma canónica (sin enlaces) de la carpeta del sandbox.
 */
export async function canonicalSandboxRoot(root) {
  const sandboxRoot = assertSandboxRoot(root);
  try {
    return await realpath(sandboxRoot);
  } catch (error) {
    if (error?.code === "ENOENT") throw new SandboxError("La carpeta del sandbox no existe");
    throw error;
  }
}

/**
 * Valida la ruta y devuelve su forma canónica (sin symlinks) listo para leer o
 * escribir. Todo acceso a disco dentro de Bit debe pasar por acá.
 *
 * @param {string} root - Carpeta absoluta del sandbox
 * @param {string} targetPath - Ruta relativa o absoluta del archivo
 * @returns {Promise<string>} Ruta absoluta canónica dentro de `root`
 */
export async function enforceSandbox(root, targetPath) {
  const sandboxRoot = assertSandboxRoot(root);
  const canonicalRoot = await canonicalSandboxRoot(sandboxRoot);

  const resolved = resolveSandboxPath(sandboxRoot, targetPath);
  const canonicalTarget = await canonicalize(resolved);

  if (!isWithin(canonicalRoot, canonicalTarget)) {
    throw new SandboxError("La ruta resuelve fuera del sandbox (posible enlace simbólico)");
  }
  if (canonicalTarget === canonicalRoot) {
    throw new SandboxError("La ruta apunta a la carpeta del sandbox, no a un archivo dentro de ella");
  }
  return canonicalTarget;
}
