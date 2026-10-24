import test from "node:test";
import assert from "node:assert/strict";
import { canCapture, createCapturePolicy, resizeDimensions, auditCapture } from "../src/screen/capture-policy.mjs";
import { dipToPhysical, physicalToDip, mapAcrossDisplay } from "../src/screen/coordinates.mjs";
import { validateOcrBoxes } from "../src/screen/ocr.mjs";

test("captura exige consentimiento y respeta exclusiones", () => {
  const policy = createCapturePolicy({ consent: true, exclusions: ["Banco"] });
  assert.equal(canCapture(policy, "Banco - cuenta"), false);
  assert.equal(canCapture(policy, "Editor"), true);
  assert.deepEqual(resizeDimensions(2560, 1440), { width: 1280, height: 720 });
  assert.equal(auditCapture({ width: 100, height: 100, hash: "abc" }).content, undefined);
});

test("mapea rectángulos DIP y píxeles físicos con escalas distintas", () => {
  assert.deepEqual(dipToPhysical({ x: 10, y: 20, width: 100, height: 50 }, 1.5), { x: 15, y: 30, width: 150, height: 75 });
  assert.deepEqual(physicalToDip({ x: 15, y: 30, width: 150, height: 75 }, 1.5), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(mapAcrossDisplay({ x: 10, y: 20, width: 100, height: 50 }, { x: 0, y: 0, scale: 1.5 }, { x: 1920, y: 0, scale: 2 }), { x: -952, y: 15, width: 75, height: 38 });
});

test("OCR solo acepta cajas dentro de la imagen", () => {
  const result = validateOcrBoxes([{ text: "OK", x: 1, y: 2, width: 10, height: 10 }, { text: "fuera", x: 95, y: 95, width: 10, height: 10 }], { width: 100, height: 100 });
  assert.deepEqual(result, [{ text: "OK", x: 1, y: 2, width: 10, height: 10 }]);
});
