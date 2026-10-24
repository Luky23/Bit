import test from "node:test";
import assert from "node:assert/strict";
import { defaultModelConfig, migrateModelConfig } from "../src/models/config.mjs";
import { routeRequest } from "../src/models/router.mjs";
import { normalizeModelResponse, stripThinkTags } from "../src/models/reasoning.mjs";
import { toolsForTurn } from "../src/models/prompt.mjs";
import { OllamaClient } from "../src/models/ollama-client.mjs";
import { ModelManager } from "../src/models/model-manager.mjs";

test("configuración nueva usa roles editables y think falso", () => {
  const config = defaultModelConfig();
  assert.equal(config.fastModel, "qwen2.5:3b");
  assert.equal(config.model, "qwen2.5-coder:7b");
  assert.equal(config.fast.think, false);
  assert.equal(config.heavy.context, 16384);
});

test("migra contextSize y conserva nombres configurables", () => {
  const config = migrateModelConfig({ model: "mi-modelo", contextSize: 2048, fast: { think: true } });
  assert.equal(config.fastModel, "mi-modelo");
  assert.equal(config.fast.context, 4096);
  assert.equal(config.heavy.context, 4096);
  assert.equal(config.fast.think, true);
});

test("router determinista elige liviano, pesado y visión", () => {
  const options = { fastModel: "fast", model: "heavy", visionModel: "vision" };
  assert.equal(routeRequest("hola, ¿cómo estás?", options).role, "fast");
  assert.equal(routeRequest("programá una página web", options).role, "heavy");
  assert.equal(routeRequest("señalá el botón en la pantalla", options).role, "vision");
});

test("el razonamiento separado y las etiquetas think nunca quedan visibles", () => {
  assert.equal(stripThinkTags("<think>secreto</think>Respuesta"), "Respuesta");
  assert.deepEqual(normalizeModelResponse({ thinking: "privado", response: "<think>oculto</think>visible" }), { text: "visible", reasoning: "privado", toolCalls: [] });
});

test("no se envían herramientas si el modelo no declara soporte", () => {
  const tools = [{ name: "read", readOnly: true }, { name: "code", category: "coding" }];
  assert.deepEqual(toolsForTurn(tools, { role: "heavy" }, { tools: false }), []);
  assert.deepEqual(toolsForTurn(tools, { role: "heavy" }, { tools: true }).map((x) => x.name), ["read", "code"]);
});

test("Ollama queda restringido a loopback y status compara el tag completo", async () => {
  assert.throws(() => new OllamaClient({ baseUrl: "https://example.com" }), /loopback/);
  const calls = [];
  const client = new OllamaClient({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ models: [{ name: "qwen3:14b" }] }) };
    }
  });
  assert.deepEqual(await client.status("qwen3:14b"), { requested: "qwen3:14b", installed: "qwen3:14b", exact: true });
  assert.equal((await client.status("qwen3:14b-q4")).exact, false);
  assert.equal(calls.length, 2);
});

test("pedidos concurrentes del manager se serializan", async () => {
  const order = [];
  const client = {
    capabilities: () => ({ tools: false, vision: false }),
    show: async () => ({ tools: false, vision: false }),
    generate: async () => ({})
  };
  const manager = new ModelManager(client, { fastModel: "fast", model: "heavy" });
  const first = manager.withModel("fast", async ({ model }) => { order.push(`${model}-start`); await new Promise((resolve) => setTimeout(resolve, 5)); order.push(`${model}-end`); });
  const second = manager.withModel("fast", async ({ model }) => { order.push(`${model}-second`); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["fast-start", "fast-end", "fast-second"]);
});
