import test from "node:test";
import assert from "node:assert/strict";
import { createVisionMessage, imageDataUrlToBase64 } from "../src/screen/vision-request.mjs";

test("la pregunta de pantalla solo acepta imágenes data URL válidas", () => {
  const image = "data:image/png;base64,aGVsbG8=";
  assert.equal(imageDataUrlToBase64(image), "aGVsbG8=");
  assert.deepEqual(createVisionMessage("¿Qué ves?", image), { role: "user", content: "¿Qué ves?", images: ["aGVsbG8="] });
  assert.equal(imageDataUrlToBase64("https://ejemplo.invalid/image.png"), null);
});

test("rechaza una captura sin pregunta", () => {
  assert.throws(() => createVisionMessage("", "data:image/png;base64,aGVsbG8="), /pregunta/);
});
