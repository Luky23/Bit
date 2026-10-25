/**
 * Screen Vision Module - Captura pantalla y la analiza con modelo visual local
 * Zero-Trust: Solo localhost, captura en memoria, sin persistencia
 */

import pkg from "electron";
const { desktopCapturer } = pkg;
import { createCapturePolicy, canCapture, resizeDimensions } from "./capture-policy.mjs";
import { imageDataUrlToBase64 } from "./vision-request.mjs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Captura la pantalla principal y la devuelve como base64
 * @param {Object} options - Opciones de captura
 * @param {number} options.maxSide - Lado máximo en píxeles
 * @returns {Promise<{imageBase64: string, width: number, height: number}>}
 */
export async function captureScreenBase64({ maxSide = 1280 } = {}) {
  const policy = createCapturePolicy({ consent: true, maxSide });
  if (!canCapture(policy, "")) {
    throw new Error("La captura requiere consentimiento explícito");
  }

  const display = await import("electron").then(e => e.screen.getPrimaryDisplay());
  const dimensions = resizeDimensions(display.size.width, display.size.height, policy.maxSide);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: dimensions,
  });

  const source = sources[0];
  if (!source?.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error("Windows no devolvió una captura de pantalla");
  }

  const dataUrl = source.thumbnail.toDataURL();
  const base64 = imageDataUrlToBase64(dataUrl);
  if (!base64) {
    throw new Error("La captura de pantalla no es válida o es demasiado grande");
  }

  return {
    imageBase64: base64,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Analiza la pantalla con un modelo visual local (Ollama)
 * @param {Object} options
 * @param {string} options.prompt - Pregunta sobre la pantalla
 * @param {string} options.visionModel - Modelo a usar (ej. "llava", "qwen2.5-vl")
 * @param {number} options.maxSide - Lado máximo de captura
 * @returns {Promise<string>} Respuesta del modelo visual
 */
export async function analyzeScreenWithVision({ prompt, visionModel = "llava", maxSide = 1280 }) {
  const { imageBase64, width, height } = await captureScreenBase64({ maxSide });

  // Llamar a Ollama /api/chat con imagen
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: visionModel,
      stream: false,
      messages: [{
        role: "user",
        content: prompt.trim().slice(0, 8000),
        images: [imageBase64],
      }],
      options: { temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama vision respondió ${response.status}`);
  }

  const data = await response.json();
  return String(data.message?.content ?? "");
}

/**
 * Herramienta combinada: captura + análisis en una sola llamada
 * Usada por el LLM principal como tool `system.captureScreen`
 */
export async function captureAndAnalyze({ prompt, visionModel = "llava", maxSide = 1280 }) {
  const analysis = await analyzeScreenWithVision({ prompt, visionModel, maxSide });
  return {
    ok: true,
    analysis,
    meta: { visionModel, maxSide, timestamp: new Date().toISOString() },
  };
}