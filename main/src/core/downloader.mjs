/**
 * Secure Asset Downloader - Zero-Trust Download Manager
 *
 * Reglas de seguridad:
 * 1. Solo dominios en whitelist (huggingface.co, github.com, raw.githubusercontent.com)
 * 2. Consentimiento explícito del usuario via dialog nativo ANTES de descargar
 * 3. Verificación SHA256 post-descarga (stream para no saturar RAM)
 */

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink, access, constants, lstat, link } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDownloadUrlAllowed } from "../net-gateway.mjs";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 300_000;

/**
 * Verifica si una URL es segura para descargar
 * @param {string} url
 * @returns {boolean}
 */
export function isUrlAllowed(url) {
  if (typeof url !== "string") return false;
  if (url.startsWith("[") && url.includes("](")) {
    const closeBracket = url.indexOf("](");
    if (closeBracket > 0) {
      url = url.substring(closeBracket + 2);
      if (url.endsWith(")")) url = url.substring(0, url.length - 1);
    }
  }
  return isDownloadUrlAllowed(url);
}

/**
 * Calcula SHA256 de un archivo usando streams (memoria constante)
 * @param {string} filePath
 * @returns {Promise<string>} Hash en hex lowercase
 */
async function calculateSha256(filePath) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Descarga un archivo con verificación de integridad
 * @param {string} url - URL HTTPS de dominio permitido
 * @param {string} destPath - Ruta absoluta donde guardar
 * @param {string} expectedHash - SHA256 esperado (hex lowercase, 64 chars)
 * @param {string} assetName - Nombre legible para el diálogo de consentimiento
 * @param {Function} showConfirmation - Función async que muestra dialog nativo y retorna true/false
 * @returns {Promise<{ok: boolean, path?: string, error?: string, cancelled?: boolean}>}
 */
export async function downloadSecureAsset(url, destPath, expectedHash, assetName, showConfirmation, fetchExternal, maxBytes = DEFAULT_MAX_BYTES) {
  if (typeof url !== "string") {
    return { ok: false, error: "El argumento url debe ser un string" };
  }
  if (typeof destPath !== "string") {
    return { ok: false, error: "El argumento destPath debe ser un string" };
  }
  if (typeof expectedHash !== "string") {
    return { ok: false, error: "El argumento expectedHash debe ser un string" };
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return { ok: false, error: "El límite maxBytes debe ser un entero positivo" };
  }

  // Remover sintaxis de enlace markdown [texto](url) si está presente
  if (url.startsWith("[") && url.includes("](")) {
    const closeBracket = url.indexOf('](');
    if (closeBracket > 0) {
      url = url.substring(closeBracket + 2);
      if (url.endsWith(')')) {
        url = url.substring(0, url.length - 1);
      }
    }
  }

  // Validación 1: URL permitida
  if (!isUrlAllowed(url)) {
    let hostname = "inválido";
    try { hostname = new URL(url).hostname; } catch {}
    return { ok: false, error: `Dominio no permitido: ${hostname}. Solo se aceptan hosts de descarga aprobados por el gateway` };
  }

  // Validación 2: Hash formato correcto
  if (!expectedHash || expectedHash.length !== 64 || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return { ok: false, error: "Hash SHA256 inválido (debe ser 64 chars hex lowercase)" };
  }

  // Validación 3: Path absoluto y dentro de directorio permitido
  // RECHAZAR: primero verificar path traversal en la cadena original ANTES de que path.join la normalice
  if (destPath.includes("..")) {
    return { ok: false, error: "Ruta de destino no permitida (path traversal)" };
  }
  const resolvedDest = resolve(destPath);
  // Permitir descargas en AppData/Bit/ (subdirectorio específico, no cualquier cosa en LOCALAPPDATA)
  const allowedBase = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "Bit") : null;
  let pathAllowed = false;
  if (allowedBase && (resolvedDest.startsWith(allowedBase + "\\") || resolvedDest.startsWith(allowedBase + "/") || resolvedDest === allowedBase)) {
    pathAllowed = true;
  }
  // Permitir también directorio temporal del sistema para testing
  const sysTmp = tmpdir();
  if (resolvedDest.startsWith(sysTmp + sep) || resolvedDest === sysTmp) {
    pathAllowed = true;
  }
  // Permitir también directorio temporal del proyecto (cwd/tmp)
  const projTmp = resolve(process.cwd(), "tmp");
  if (resolvedDest.startsWith(projTmp + sep) || resolvedDest === projTmp) {
    pathAllowed = true;
  }
  if (!pathAllowed) {
    return { ok: false, error: "Ruta de destino no permitida (debe estar en %LOCALAPPDATA%/Bit/ o directorio temporal)" };
  }

  try {
    await lstat(destPath);
    return { ok: false, error: "El archivo destino ya existe y no se sobrescribirá" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // Validación 4: Consentimiento del usuario
  const consent = await showConfirmation(assetName, new URL(url).hostname);
  if (!consent) {
    return { ok: false, cancelled: true };
  }

  let tmpPath;
  let timeout;
  try {
    if (typeof fetchExternal !== "function") throw new Error("La descarga necesita el gateway de red");
    const abortController = new AbortController();
    timeout = setTimeout(() => abortController.abort(), DOWNLOAD_TIMEOUT_MS);
    const response = await fetchExternal(url, {
      method: "GET",
      headers: { "User-Agent": "Bit-Assistant/1.0 (secure-downloader)" },
      signal: abortController.signal,
    });

    if (!response.ok) {
      clearTimeout(timeout);
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    if (!response.body) {
      clearTimeout(timeout);
      return { ok: false, error: "Respuesta sin body" };
    }

    const contentLengthHeader = response.headers?.get?.("content-length") ?? response.headers?.["content-length"];
    const contentLength = contentLengthHeader === undefined ? null : Number(contentLengthHeader);
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > maxBytes) {
      clearTimeout(timeout);
      abortController.abort();
      return { ok: false, error: `La descarga supera el límite permitido de ${maxBytes} bytes` };
    }

    // Nombre impredecible y creación exclusiva para impedir colisiones y symlinks.
    tmpPath = `${destPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    let receivedBytes = 0;
    const limitTransform = new Transform({
      transform(chunk, encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          abortController.abort();
          callback(new Error(`La descarga supera el límite permitido de ${maxBytes} bytes`));
          return;
        }
        callback(null, chunk);
      },
    });
    const writer = createWriteStream(tmpPath, { flags: "wx", highWaterMark: 64 * 1024 });

    // Pipeline con backpressure automático
    try {
      await pipeline(response.body, limitTransform, writer);
    } finally {
      clearTimeout(timeout);
    }

    // Verificar hash
    const actualHash = await calculateSha256(tmpPath);
    if (actualHash !== expectedHash.toLowerCase()) {
      await unlink(tmpPath).catch(() => {});
      return { ok: false, error: `Hash mismatch: esperado ${expectedHash}, obtenido ${actualHash}` };
    }

    // link falla si el destino apareció durante la descarga; luego retiramos nuestro temporal.
    await link(tmpPath, destPath);
    await unlink(tmpPath);

    return { ok: true, path: destPath };
  } catch (error) {
    // Limpiar archivo temporal en caso de error
    if (timeout) clearTimeout(timeout);
    if (typeof tmpPath === "string") await unlink(tmpPath).catch(() => {});
    if (error.name === "AbortError") {
      return { ok: false, error: "Timeout de descarga (5 min)" };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Configuración de modelos Piper pre-aprobados (URLs oficiales + hashes reales)
 * Hashes calculados desde los archivos oficiales en huggingface.co/rhasspy/piper-voices
 */
export const PIPER_MODELS = {
  "es_ES-davefx-medium": {
    onnx: {
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/es_ES/davefx/medium/es_ES-davefx-medium.onnx",
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // PLACEHOLDER - actualizar con hash real
      size: 34_000_000, // ~34MB aprox
    },
    json: {
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json",
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // PLACEHOLDER - actualizar con hash real
      size: 5_000, // ~5KB aprox
    },
  },
};
const DISABLED_ASSET_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Verifica si un modelo Piper existe localmente y es válido
 * @param {string} modelName - Clave en PIPER_MODELS (ej: "es_ES-davefx-medium")
 * @param {string} voicesDir - Directorio base de voces
 * @returns {Promise<{onnx: boolean, json: boolean}>}
 */
export async function checkPiperModelExists(modelName, voicesDir) {
  const model = PIPER_MODELS[modelName];
  if (!model) return { onnx: false, json: false };

  const onnxPath = join(voicesDir, `${modelName}.onnx`);
  const jsonPath = join(voicesDir, `${modelName}.onnx.json`);

  const checkFile = async (path, expectedHash) => {
    try {
      await access(path, constants.F_OK);
      if (expectedHash === DISABLED_ASSET_HASH) return false;
      if (expectedHash) {
        const hash = await calculateSha256(path);
        return hash === expectedHash.toLowerCase();
      }
      return false;
    } catch {
      return false;
    }
  };

  return {
    onnx: await checkFile(onnxPath, model.onnx.hash),
    json: await checkFile(jsonPath, model.json.hash),
  };
}

/**
 * Descarga un modelo Piper completo si falta
 * @param {string} modelName
 * @param {string} voicesDir
 * @param {Function} showConfirmation
 * @returns {Promise<{ok: boolean, onnx?: string, json?: string, error?: string, cancelled?: boolean}>}
 */
export async function ensurePiperModel(modelName, voicesDir, showConfirmation, fetchExternal) {
  const model = PIPER_MODELS[modelName];
  if (!model) return { ok: false, error: `Modelo desconocido: ${modelName}` };
  if (Object.values(model).some((asset) => asset.hash === DISABLED_ASSET_HASH)) {
    return { ok: false, error: "La descarga de esta voz está deshabilitada hasta fijar sus hashes oficiales" };
  }

  const exists = await checkPiperModelExists(modelName, voicesDir);
  if (exists.onnx && exists.json) {
    return { ok: true, onnx: join(voicesDir, `${modelName}.onnx`), json: join(voicesDir, `${modelName}.onnx.json`) };
  }

  const results = {};
  for (const [key, asset] of Object.entries(model)) {
    const destPath = join(voicesDir, `${modelName}.onnx${key === "json" ? ".json" : ""}`);
    const result = await downloadSecureAsset(asset.url, destPath, asset.hash, `${modelName}.${key === "onnx" ? "onnx" : "json"}`, showConfirmation, fetchExternal, asset.size);
    if (!result.ok) {
      // Si falla uno, limpiar el otro si se descargó
      if (results.onnx?.ok) await unlink(results.onnx.path).catch(() => {});
      if (results.json?.ok) await unlink(results.json.path).catch(() => {});
      return { ok: false, error: result.error, cancelled: result.cancelled };
    }
    results[key] = result;
  }

  return { ok: true, onnx: results.onnx.path, json: results.json.path };
}
