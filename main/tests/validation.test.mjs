import test from "node:test";
import assert from "node:assert/strict";
import { validateToolInput, validateToolOutput, getSchema, listSchemas } from "../src/core/validation.mjs";

test("validación central: lista esquemas conocidos", () => {
  const schemas = listSchemas();
  assert.ok(schemas.includes("bit:chat"));
  assert.ok(schemas.includes("bit:screen-capture"));
  assert.ok(schemas.includes("bit:speak"));
  assert.ok(schemas.includes("bit:model-config"));
});

test("bit:chat rechaza mensaje vacío", () => {
  const result = validateToolInput("bit:chat", { message: "" });
  assert.equal(result.ok, false);
  assert.match(result.error, /mínimo 1/);
});

test("bit:chat acepta mensaje válido y un GGUF local opcional", () => {
  const result = validateToolInput("bit:chat", { message: "hola", model: "Qwen2.5-3B-Q4_K_M.gguf" });
  assert.equal(result.ok, true);
});

test("bit:chat acepta los tags locales de Ollama usados por el chat", () => {
  for (const model of ["qwen2.5:3b", "qwen2.5-coder:7b", "qwen2.5vl:3b", "moondream:1.8b"]) {
    assert.equal(validateToolInput("bit:chat", { message: "hola", model }).ok, true, model);
  }
});

test("bit:obsidian-graph valida sus parámetros y limita el tamaño de respuesta", () => {
  assert.equal(validateToolInput("bit:obsidian-graph", {}).ok, true);
  assert.equal(validateToolInput("bit:obsidian-graph", { notePath: "Bit/Inicio.md", limit: 25 }).ok, true);
  assert.equal(validateToolInput("bit:obsidian-graph", { limit: 1001 }).ok, false);
  assert.equal(validateToolInput("bit:obsidian-graph", { notePath: "", extra: true }).ok, false);
});

test("bit:chat rechaza modelo con caracteres inválidos", () => {
  const result = validateToolInput("bit:chat", { message: "hola", model: "qwen 3b" });
  assert.equal(result.ok, false);
  assert.match(result.error, /formato inválido/);
});

test("bit:chat rechaza message demasiado largo", () => {
  const long = "x".repeat(8001);
  const result = validateToolInput("bit:chat", { message: long });
  assert.equal(result.ok, false);
  assert.match(result.error, /máximo 8000/);
});

test("bit:chat rechaza imageDataUrl inválida", () => {
  const result = validateToolInput("bit:chat", { message: "hola", imageDataUrl: "https://ejemplo.invalid/img.png" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Data URL de imagen inválida/);
});

test("bit:chat acepta imageDataUrl válida", () => {
  const valid = "data:image/png;base64,aGVsbG8=";
  const result = validateToolInput("bit:chat", { message: "hola", imageDataUrl: valid });
  assert.equal(result.ok, true);
});

test("bit:chat rechaza imageDataUrl > 12 MB", () => {
  const hugeB64 = "x".repeat(17_000_000);
  const huge = `data:image/png;base64,${hugeB64}`;
  const result = validateToolInput("bit:chat", { message: "hola", imageDataUrl: huge });
  assert.equal(result.ok, false);
  assert.match(result.error, /máximo/);
});

test("bit:screen-capture acepta input vacío", () => {
  const result = validateToolInput("bit:screen-capture", {});
  assert.equal(result.ok, true);
});

test("bit:speak rechaza texto vacío", () => {
  const result = validateToolInput("bit:speak", { text: "" });
  assert.equal(result.ok, false);
});

test("bit:speak acepta texto válido", () => {
  const result = validateToolInput("bit:speak", { text: "Hola mundo" });
  assert.equal(result.ok, true);
});

test("bit:speak rechaza texto > 4000", () => {
  const result = validateToolInput("bit:speak", { text: "x".repeat(4001) });
  assert.equal(result.ok, false);
});

test("bit:overlay-set-expanded requiere expanded booleano", () => {
  assert.equal(validateToolInput("bit:overlay-set-expanded", { expanded: "sí" }).ok, false);
  assert.equal(validateToolInput("bit:overlay-set-expanded", { expanded: true }).ok, true);
  assert.equal(validateToolInput("bit:overlay-set-expanded", {}).ok, false);
});

test("bit:model-config valida estructura completa", () => {
  const good = { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", fast: { context: 8192, think: false } };
  assert.equal(validateToolInput("bit:model-config", good).ok, true);
  const bad = { fastModel: "", model: "x" };
  assert.equal(validateToolInput("bit:model-config", bad).ok, false);
});

test("validateToolOutput siempre ok (stub)", () => {
  assert.deepEqual(validateToolOutput("bit:chat", "algo"), { ok: true });
});

test("getSchema devuelve null para herramienta desconocida", () => {
  assert.equal(getSchema("no-existe"), null);
});
