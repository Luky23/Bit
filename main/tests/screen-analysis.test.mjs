import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldAnalyzeScreenVisually, chooseVisionModel } from "../src/screen/screen-analysis.mjs";
import { availableOcrLanguages, cleanOcrText } from "../src/screen/tesseract-ocr.mjs";
import { analyzeImageWithVision } from "../src/screen/vision-tools.mjs";

test("la pregunta general sobre la pantalla incluye imágenes aunque haya texto", () => {
  assert.equal(shouldAnalyzeScreenVisually("¿Qué hay en la pantalla?", true), true);
  assert.equal(shouldAnalyzeScreenVisually("¿Qué dice el documento en pantalla?", true), false);
  assert.equal(shouldAnalyzeScreenVisually("¿Qué dice el documento en pantalla?", false), true);
});

test("prefiere el modelo visual que reconoció la imagen de prueba", () => {
  assert.equal(chooseVisionModel(["moondream:1.8b", "qwen2.5vl:3b"]), "qwen2.5vl:3b");
  assert.equal(chooseVisionModel(["moondream:1.8b"]), "moondream:1.8b");
});

test("el modelo visual se carga solo cuando se consulta la pantalla", async () => {
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.equal((main.match(/prewarmVisionModel/gu) || []).length, 0);
});

test("OCR usa inglés si falta el paquete de español", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bit-ocr-test-"));
  try {
    await writeFile(join(dir, "eng.traineddata"), "fixture");
    assert.equal(await availableOcrLanguages(dir), "eng");
    await writeFile(join(dir, "spa.traineddata"), "fixture");
    assert.equal(await availableOcrLanguages(dir), "spa+eng");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OCR descarta líneas de ruido sin perder las líneas legibles", () => {
  assert.equal(cleanOcrText("Hola mundo\n|||\nSegunda línea"), "Hola mundo Segunda línea");
});

test("la visión usa OCR local sin abrir una conexión HTTP", async () => {
  const result = await analyzeImageWithVision({ prompt: "¿Qué ves?", visionModel: "qwen2.5vl-mmproj.gguf", imageBase64: "aGVsbG8=", ocrText: "Texto local" });
  assert.equal(result, "Texto visible en la imagen:\nTexto local");
});

test("la visión informa el fallback si OCR no produce texto", async () => {
  await assert.rejects(
    analyzeImageWithVision({ prompt: "¿Qué ves?", visionModel: "mmproj-vision.gguf", imageBase64: "aGVsbG8=" }),
    /mmproj.*API multimodal/u,
  );
});
