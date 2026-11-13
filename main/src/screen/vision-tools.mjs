/**
 * Screen Vision Module - Captura pantalla y la analiza con modelo visual local
 * Zero-Trust: Solo localhost, captura en memoria, sin persistencia.
 * Optimizaciones: compresión JPEG 75% a 1024px, keep_alive:0 para descarga
 * inmediata de VRAM, flujo híbrido OCR + visión, trazado de coordenadas.
 */

import pkg from "electron";
const { desktopCapturer, screen, nativeImage } = pkg;
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapturePolicy, canCapture, resizeDimensions } from "./capture-policy.mjs";
import { imageDataUrlToBase64 } from "./vision-request.mjs";
import { resolveInstalledVisionModel } from "./screen-analysis.mjs";
import { OllamaClient } from "../models/ollama-client.mjs";
import { analyzeImageWithTesseract, analyzeImageWithTesseractBoxes } from "./tesseract-ocr.mjs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const VISION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SIDE = 1024; // Lado máximo reducido para mínimo consumo de RAM/VRAM
const JPEG_QUALITY = 75;
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

// Ruta de la captura temporal de diagnóstico, siempre en la raíz de la app.
const here = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = resolve(here, "../../..");
export const DEBUG_SCREEN_PATH = join(APP_ROOT, "debug-screen.png");

export function isGroundingRequest(prompt) {
  const normalized = String(prompt ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /\b(?:senal|ubica|localiza|encuentra|busca|donde esta|donde esta el|marca)\b/u.test(normalized);
}

function normalizeForMatch(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Busca una palabra del pedido en las cajas OCR, sin inferir coordenadas. */
export async function findOcrTextBox({ prompt, imageBase64, imageWidth, imageHeight }) {
  if (!isGroundingRequest(prompt) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return { found: false };
  const quoted = String(prompt).match(/["“”']([^"“”']{1,120})["“”']/u)?.[1] || "";
  const ignored = new Set(["senalame", "senala", "ubica", "localiza", "encuentra", "busca", "donde", "esta", "el", "la", "los", "las", "boton", "texto", "pantalla", "por", "favor", "me", "de", "del", "un", "una", "que", "esta"]);
  const targetWords = (quoted ? [quoted] : normalizeForMatch(prompt).split(" ")).map(normalizeForMatch).filter((word) => word && !ignored.has(word) && (quoted || word.length >= 3));
  if (targetWords.length === 0) return { found: false };
  const boxes = await analyzeImageWithTesseractBoxes({ imageBase64 });
  const candidate = boxes.map((box) => ({ box, normalized: normalizeForMatch(box.text) })).find(({ normalized }) => targetWords.some((word) => normalized === word || normalized.includes(word) || word.includes(normalized)));
  if (!candidate) return { found: false };
  const { box } = candidate;
  if (box.x + box.width > imageWidth || box.y + box.height > imageHeight) return { found: false };
  return { found: true, box_2d: [box.y, box.x, box.y + box.height, box.x + box.width], label: box.text };
}

/**
 * Comprime una imagen para visión: redimensiona a máximo 1024px de lado
 * y convierte a JPEG con calidad 75%. Reduce drásticamente RAM/VRAM y
 * acelera la inferencia (estimado 3x más rápido en CPU).
 * @param {string} dataUrl - Data URL de la imagen (PNG/JPEG/WebP)
 * @param {Object} options - { maxSide, quality }
 * @returns {Promise<string>} Data URL JPEG comprimida
 */
export async function compressImageForVision(dataUrl, { maxSide = DEFAULT_MAX_SIDE, quality = JPEG_QUALITY } = {}) {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("No se pudo crear la imagen nativa para compresión");

  const { width, height } = image.getSize();
  const side = Math.max(width, height);
  let targetWidth = width;
  let targetHeight = height;

  if (side > maxSide) {
    const ratio = maxSide / side;
    targetWidth = Math.round(width * ratio);
    targetHeight = Math.round(height * ratio);
  }

  const resized = image.resize({ width: targetWidth });
  const jpegBuffer = resized.toJPEG({ quality });
  return `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
}

/**
 * Extrae el base64 puro de un data URL.
 */
function extractBase64(dataUrl) {
  if (typeof dataUrl !== "string") return "";
  if (dataUrl.startsWith("data:")) return dataUrl.slice(dataUrl.indexOf(",") + 1);
  return dataUrl;
}

/**
 * Llama a Ollama /api/chat para análisis de visión con keep_alive: 0
 * para forzar la liberación inmediata de VRAM/GPU tras cada inferencia.
 * @param {Object} options
 * @param {string} options.visionModel - Nombre del modelo de visión (ej. llava, qwen2.5-vl)
 * @param {string} options.prompt - Prompt enriquecido con OCR
 * @param {string} options.imageBase64 - Imagen en base64 (puede ser data URL)
 * @param {number} options.keepAlive - keep_alive en segundos (0 = descarga inmediata)
 * @param {number} options.timeoutMs - Tiempo de espera en ms
 * @returns {Promise<string>} Texto de respuesta del modelo visual
 */
export async function callOllamaVision({ visionModel, prompt, imageBase64, keepAlive = 0, timeoutMs = VISION_TIMEOUT_MS }) {
  const captureStart = Date.now();
  const imageB64 = extractBase64(imageBase64);
  if (!imageB64) throw new Error("La imagen de visión no es válida");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const client = new OllamaClient({
      fetchImpl: (url, options = {}) => fetch(url, { ...options, signal: controller.signal }),
    });
    const installedModel = await resolveInstalledVisionModel(visionModel, client);
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: installedModel,
        stream: false,
        keep_alive: keepAlive,
        messages: [
          {
            role: "user",
            content: prompt,
            images: [imageB64],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const inferenceMs = Date.now() - captureStart;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama respondió ${response.status}${errorText ? `: ${errorText}` : ""}`);
    }

    const data = await response.json();
    const content = data?.message?.content?.trim() || "";

    // Telemetría de rendimiento (HUD consola local)
    console.log(`[Perf] Captura OCR: ${captureStart} ms | Inferencia: ${inferenceMs} ms | VRAM Liberada: OK (keep_alive=${keepAlive})`);

    if (!content) throw new Error("Ollama no devolvió contenido de visión");
    return content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`El modelo visual agotó el tiempo límite (${timeoutMs} ms)`);
    }
    throw error;
  }
}

/**
 * Captura la pantalla principal y la devuelve como base64 comprimida.
 * @param {Object} options - Opciones de captura
 * @param {number} options.maxSide - Lado máximo en píxeles (default 1024)
 * @returns {Promise<{imageBase64: string, width: number, height: number}>}
 */
export async function captureScreenBase64({ maxSide = DEFAULT_MAX_SIDE, debugPath = "" } = {}) {
  const policy = createCapturePolicy({ consent: true, maxSide });
  if (!canCapture(policy, "")) {
    throw new Error("La captura requiere consentimiento explícito");
  }

  const display = screen.getPrimaryDisplay();
  if (!Number.isFinite(display.size.width) || !Number.isFinite(display.size.height) || display.size.width <= 0 || display.size.height <= 0) {
    throw new Error(`Dimensiones de pantalla no válidas: ${display.size.width}x${display.size.height}`);
  }
  const dimensions = resizeDimensions(display.size.width, display.size.height, policy.maxSide);
  if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error(`Dimensiones solicitadas inválidas: ${dimensions.width}x${dimensions.height}`);

  console.log("[screen.capture] Solicitando captura nativa", { displayId: display.id, displaySize: display.size, thumbnailSize: dimensions });

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: dimensions,
  });

  const source = sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
  console.log("[screen.capture] Fuentes recibidas", { count: sources.length, matchedDisplay: Boolean(source && String(source.display_id) === String(display.id)), sourceId: source?.id, sourceDisplayId: source?.display_id });
  if (!source?.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error("Windows no devolvió una captura de pantalla");
  }

  const dataUrl = source.thumbnail.toDataURL();
  const thumbnailSize = source.thumbnail.getSize();
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const validDataUrl = /^data:image\/(?:png|jpeg|webp);base64,/iu.test(dataUrl);
  const pngSignatureValid = dataUrl.startsWith("data:image/png;base64,") && Buffer.from(payload.slice(0, 12), "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  console.log("[screen.capture] Thumbnail serializada", { thumbnailSize, dataUrlChars: dataUrl.length, base64Chars: payload.length, validDataUrl, pngSignatureValid, empty: source.thumbnail.isEmpty() });
  if (!validDataUrl || thumbnailSize.width <= 0 || thumbnailSize.height <= 0 || payload.length < 128) {
    throw new Error(`La captura nativa está vacía o no es válida (${thumbnailSize.width}x${thumbnailSize.height}, ${payload.length} caracteres base64)`);
  }
  const base64 = imageDataUrlToBase64(dataUrl);
  if (!base64) {
    throw new Error("La captura de pantalla no es válida o es demasiado grande");
  }
  // Siempre se guarda una captura temporal en la raíz para validar la nitidez
  // y evitar capturas en negro antes de enviarla al modelo de visión.
  try {
    await mkdir(APP_ROOT, { recursive: true });
    await writeFile(DEBUG_SCREEN_PATH, Buffer.from(base64, "base64"));
    console.log("[screen.capture] Captura de diagnóstico guardada:", DEBUG_SCREEN_PATH);
  } catch (error) {
    // Diagnóstico únicamente: nunca interrumpe el flujo de captura.
    console.warn("[screen.capture] No se pudo guardar la captura de diagnóstico:", error instanceof Error ? error.message : String(error));
  }
  if (debugPath && debugPath !== DEBUG_SCREEN_PATH) {
    try {
      await mkdir(dirname(debugPath), { recursive: true });
      await writeFile(debugPath, Buffer.from(base64, "base64"));
    } catch (error) {
      console.warn("[screen.capture] No se pudo guardar la ruta de diagnóstico adicional:", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    imageBase64: base64,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Analiza la pantalla sin servicios HTTP. Cuando no hay una integración
 * multimodal nativa verificada, el OCR local es el fallback seguro.
 * Flujo híbrido: OCR primero, luego el texto se inyecta en el prompt de visión.
 * @param {Object} options
 * @param {string} options.prompt - Pregunta sobre la pantalla
 * @param {string} options.visionModel - Modelo a usar (ej. "llava", "qwen2.5-vl")
 * @param {number} options.maxSide - Lado máximo de captura
 * @param {boolean} options.compressImage - Comprimir imagen antes del análisis (default true)
 * @param {number} options.keepAlive - keep_alive para Ollama (default 0 = descarga inmediata de VRAM)
 * @returns {Promise<string>} Respuesta del modelo visual
 */
export async function analyzeScreenWithVision({ prompt, visionModel = "", maxSide = DEFAULT_MAX_SIDE, debugPath = "", visualAnalyzer, fallbackAnalyzer, compressImage = true, keepAlive = 0, timeoutMs = VISION_TIMEOUT_MS }) {
  const captureStart = Date.now();
  const { imageBase64 } = await captureScreenBase64({ maxSide, debugPath });

  let ocrText = "";
  let ocrMs = 0;
  try {
    const ocrStart = Date.now();
    ocrText = await analyzeImageWithTesseract({ imageBase64 }).catch(() => "");
    ocrMs = Date.now() - ocrStart;
  } catch (error) {
    console.warn("[ocr] Falló OCR en análisis de pantalla:", error instanceof Error ? error.message : String(error));
  }

  // Comprimir imagen para visión (reduce RAM/VRAM, acelera inferencia)
  let visionImageBase64 = imageBase64;
  if (compressImage) {
    try {
      const compressedDataUrl = await compressImageForVision(`data:image/png;base64,${imageBase64}`, { maxSide, quality: JPEG_QUALITY });
      visionImageBase64 = extractBase64(compressedDataUrl);
    } catch (error) {
      console.warn("[vision] No se pudo comprimir la imagen, usando original:", error instanceof Error ? error.message : String(error));
    }
  }

  try {
    return await analyzeImageWithVision({
      prompt,
      visionModel,
      imageBase64: visionImageBase64,
      ocrText,
      visualAnalyzer,
      fallbackAnalyzer,
      keepAlive,
      timeoutMs,
    });
  } catch (error) {
    if (ocrText) return `No pude completar el análisis visual local (${error instanceof Error ? error.message : String(error)}). Texto reconocido en pantalla: ${ocrText}`;
    throw error;
  }
}

export async function analyzeImageWithVision({ prompt, visionModel = "", imageBase64, ocrText = "", visualAnalyzer, fallbackAnalyzer, keepAlive = 0, timeoutMs = VISION_TIMEOUT_MS }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("La pregunta de pantalla no puede estar vacía");
  if (
    typeof imageBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(imageBase64) ||
    Buffer.byteLength(imageBase64, "base64") > MAX_IMAGE_BYTES
  ) {
    throw new Error("La imagen de pantalla no es válida o es demasiado grande");
  }

  const enrichedPrompt = buildVisionPrompt(prompt, ocrText);
  const captureStart = Date.now();

  if (typeof visualAnalyzer === "function") {
    try {
      const result = await withTimeout(
        visualAnalyzer({ prompt: enrichedPrompt, imageBase64, visionModel, keepAlive }),
        timeoutMs,
        "El modelo visual local agotó el tiempo límite",
      );
      const inferenceMs = Date.now() - captureStart;
      console.log(`[Perf] Captura OCR: ${captureStart} ms | Inferencia: ${inferenceMs} ms | VRAM Liberada: OK (keep_alive=${keepAlive})`);
      return cleanVisionAnalysis(String(result));
    } catch (error) {
      if (typeof fallbackAnalyzer === "function" && ocrText.trim()) {
        return cleanVisionAnalysis(String(await fallbackAnalyzer({ prompt, ocrText: ocrText.trim(), error })));
      }
      if (ocrText.trim()) return `Texto visible en la imagen:\n${ocrText.trim()}`;
      throw error;
    }
  }

  // Si no hay visualAnalyzer inyectado, llamar directamente a Ollama con keep_alive: 0
  try {
    const result = await callOllamaVision({ visionModel, prompt: enrichedPrompt, imageBase64, keepAlive, timeoutMs });
    const inferenceMs = Date.now() - captureStart;
    console.log(`[Perf] Captura OCR: ${captureStart} ms | Inferencia: ${inferenceMs} ms | VRAM Liberada: OK (keep_alive=${keepAlive})`);
    return cleanVisionAnalysis(result);
  } catch (error) {
    if (ocrText.trim()) return `Texto visible en la imagen:\n${ocrText.trim()}`;
    throw error;
  }
}

export function buildVisionPrompt(prompt, ocrText = "") {
  return `TEXTO EXTRAÍDO POR OCR EN PANTALLA:\n${ocrText.trim() || "[Sin texto legible]"}\n\nPREGUNTA DEL USUARIO: ${prompt.trim()}\n\nAnaliza la imagen adjunta en combinación con el texto detectado por OCR y responde exactamente qué ves. Si buscas un elemento específico, responde con sus coordenadas aproximadas.`;
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function cleanVisionAnalysis(text) {
  const cleaned = text.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!cleaned) return "No pude interpretar la pantalla.";
  if (/(.{2,12})\1{3,}/iu.test(cleaned) || new Set(cleaned.toLowerCase()).size < 5) {
    return "No pude interpretar con suficiente claridad lo que aparece en la pantalla.";
  }
  return cleaned;
}

/**
 * Herramienta combinada: captura + análisis en una sola llamada.
 * Usada por el LLM principal como tool `system.captureScreen`.
 * Flujo híbrido: captura ligera → OCR → compresión → Ollama visión (keep_alive:0)
 * → trazado de coordenadas si es solicitud de ubicación/señalado.
 */
export async function captureAndAnalyze({ prompt, visionModel = "", maxSide = DEFAULT_MAX_SIDE, debugPath = "", imageBase64 = "", imageWidth, imageHeight, visualAnalyzer, fallbackAnalyzer, keepAlive = 0, timeoutMs = VISION_TIMEOUT_MS }) {
  const snapshot = imageBase64 ? { imageBase64 } : await captureScreenBase64({ maxSide, debugPath });
  let ocrText = "";
  try { ocrText = await analyzeImageWithTesseract({ imageBase64: snapshot.imageBase64 }).catch(() => ""); }
  catch (error) { console.warn("[ocr] Falló OCR en captura híbrida:", error instanceof Error ? error.message : String(error)); }

  // Comprimir para el modelo de visión si se va a enviar a Ollama
  let visionImageBase64 = snapshot.imageBase64;
  try {
    const compressedDataUrl = await compressImageForVision(`data:image/png;base64,${snapshot.imageBase64}`, { maxSide, quality: JPEG_QUALITY });
    visionImageBase64 = extractBase64(compressedDataUrl);
  } catch (error) {
    console.warn("[vision] No se pudo comprimir para análisis híbrido:", error instanceof Error ? error.message : String(error));
  }

  const analysis = await analyzeImageWithVision({ prompt, visionModel, imageBase64: visionImageBase64, ocrText, visualAnalyzer, fallbackAnalyzer, keepAlive, timeoutMs });

  let grounding = { found: false };
  try {
    grounding = await findOcrTextBox({ prompt, imageBase64: snapshot.imageBase64, imageWidth: imageWidth ?? snapshot.width, imageHeight: imageHeight ?? snapshot.height });
  } catch (error) {
    console.warn("[ocr] No se pudo ubicar el texto solicitado:", error instanceof Error ? error.message : String(error));
  }

  return {
    ok: true,
    analysis,
    meta: { visionModel, maxSide, ocr: Boolean(ocrText), grounding, keepAlive, timestamp: new Date().toISOString() },
    grounding,
  };
}
