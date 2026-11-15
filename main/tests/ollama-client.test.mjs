import test from "node:test";
import assert from "node:assert/strict";
import { OllamaClient } from "../src/models/ollama-client.mjs";

test("Ollama: solo permite el servicio local", () => {
  assert.throws(() => new OllamaClient({ baseUrl: "https://example.com" }), /loopback/);
});

test("Ollama: reensambla la respuesta en streaming sin abrir otra conexión", async () => {
  const encoder = new TextEncoder();
  const requests = [];
  const client = new OllamaClient({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"Hola"}}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":", Luca"},"done":true}\n'));
          controller.close();
        },
      }), { status: 200 });
    },
  });
  const chunks = [];
  const result = await client.generate("qwen2.5:3b", { stream: true, messages: [] }, { onChunk: (text) => chunks.push(text) });

  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.deepEqual(chunks, ["Hola", ", Luca"]);
  assert.equal(result.message.content, "Hola, Luca");
});

test("Ollama: resuelve el modelo cargado real y conserva el detalle del error HTTP", async () => {
  const requests = [];
  const client = new OllamaClient({
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      requests.push(path);
      if (path === "/api/ps") {
        return Response.json({ models: [{ name: "qwen2.5:7b" }] });
      }
      if (path === "/api/tags") {
        return Response.json({ models: [{ name: "qwen2.5:3b" }] });
      }
      return new Response(JSON.stringify({ error: "model 'inexistente:latest' not found" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(await client.resolveModel("inexistente:latest", ["qwen2.5:3b"]), "qwen2.5:7b");
  await assert.rejects(
    client.generate("inexistente:latest", { stream: false, messages: [] }),
    /Ollama \/api\/chat respondio 500: model 'inexistente:latest' not found/u,
  );
  assert.deepEqual(requests, ["/api/ps", "/api/tags", "/api/chat"]);
});

test("Ollama: usa el presupuesto adaptativo de conexión y aborta una conexión local bloqueada", async () => {
  const budgetRequests = [];
  const client = new OllamaClient({
    performanceManager: {
      async getBudgets(taskType) {
        budgetRequests.push(taskType);
        return { connectionMs: 20, totalMs: 200 };
      },
      async run(_taskType, operation) {
        const controller = new AbortController();
        return operation({ signal: controller.signal, reportProgress() {}, budgets: { connectionMs: 20, totalMs: 200 } });
      },
    },
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await assert.rejects(client.generate("qwen2.5:3b", { stream: false, messages: [] }), error => (
    error.code === "ADAPTIVE_CONNECTION_TIMEOUT"
  ));
  assert.deepEqual(budgetRequests, ["connection.local"]);
});
