import test from "node:test";
import assert from "node:assert/strict";
import { ModelService } from "../src/models/model-service.mjs";

test("usa los modelos instalados de Ollama sin requerir GGUF y respeta la selección", async () => {
  const calls = [];
  const service = new ModelService({
    ollama: {
      list: async () => [{ name: "qwen2.5:3b" }, { name: "qwen2.5-coder:7b" }],
      generate: async (...args) => { calls.push(args); return { message: { content: "Hola" } }; },
      show: async model => ({ model, tools: true }),
    },
    listGguf: async () => [],
    llama: { generate: () => assert.fail("No debe usar llama para un tag Ollama") },
  });
  assert.equal((await service.list()).length, 2);
  assert.equal(await service.resolveModel("qwen2.5-coder:7b"), "qwen2.5-coder:7b");
  await service.generate("qwen2.5:3b", { messages: [] });
  assert.equal(calls[0][0], "qwen2.5:3b");
  assert.equal((await service.show("qwen2.5:3b")).tools, true);
});

test("conserva GGUF si Ollama está apagado y explica cuando no hay modelos", async () => {
  const service = new ModelService({
    ollama: { list: async () => { throw new Error("ECONNREFUSED"); } },
    listGguf: async () => [{ name: "local.gguf", path: "C:/models/local.gguf", kind: "model" }],
    llama: { generate: async model => ({ model }) },
  });
  assert.equal((await service.generate("local.gguf", {})).model, "C:/models/local.gguf");
  service.listGguf = async () => [];
  await assert.rejects(service.resolveModel("qwen2.5:3b"), /Ollama.*iniciado/u);
});

test("ModelService ejecuta las generaciones bajo el planificador y registra señales de streaming", async () => {
  const calls = [];
  const service = new ModelService({
    ollama: {
      list: async () => [{ name: "qwen2.5:3b" }],
      generate: async (_model, _request, options) => {
        assert.equal(options.managed, true);
        options.onChunk("token");
        calls.push(options.signal);
        return { message: { content: "token" } };
      },
    },
    listGguf: async () => [],
    performanceManager: {
      async run(taskType, operation, options) {
        calls.push({ taskType, priority: options.priority, streaming: typeof options.onProgress === "function" });
        const controller = new AbortController();
        return operation({ signal: controller.signal, reportProgress() {} });
      },
    },
  });
  await service.generate("qwen2.5:3b", {
    stream: true,
    messages: [{ role: "user", content: "hola" }],
    options: { num_predict: 64 },
  }, { priority: "interactive", onChunk() {} });
  assert.equal(calls[0].taskType, "model.generate");
  assert.equal(calls[0].priority, "interactive");
  assert.equal(calls[0].streaming, true);
  assert.ok(calls[1] instanceof AbortSignal);
});
