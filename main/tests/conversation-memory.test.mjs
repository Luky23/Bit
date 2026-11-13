import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConversationMemory } from "../src/obsidian/conversation-memory.mjs";
import { runAgentTurn } from "../src/core/agent.mjs";

test("memoria: recupera solo recuerdos guardados con límites y auditoría", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-memory-"));
  try {
    await mkdir(join(root, "Bit", "Conversaciones"), { recursive: true });
    await writeFile(join(root, "Bit", "Conversaciones", "2026-01-01_preferencia.md"), "Prefiere explicaciones con ejemplos.");
    await writeFile(join(root, "privado.md"), "No recuperar toda la bóveda.");
    const audit = [];
    const memory = await readConversationMemory(root, (entry) => audit.push(entry));
    assert.match(memory, /Prefiere explicaciones/);
    assert.doesNotMatch(memory, /No recuperar/);
    assert.ok(memory.length <= 6000);
    assert.equal(audit[0].action, "memory.recall");
    assert.equal(JSON.stringify(audit).includes("Prefiere explicaciones"), false);
    assert.equal(await readConversationMemory("", () => {}), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conversación: conserva más de ocho mensajes y adapta el estilo a correcciones", async () => {
  let request;
  await runAgentTurn({
    message: "Explíquelo con un ejemplo sencillo",
    history: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `mensaje ${i}` })),
    config: { fastModel: "local" },
    deps: { chatClient: { generate: async (_, req) => { request = req; return { message: { content: "Un ejemplo." } }; } } },
  });
  assert.ok(request.messages.some((entry) => entry.content === "mensaje 0"));
  assert.match(request.messages[0].content, /correcciones/);
  assert.match(request.messages[0].content, /entrenamiento/);
});

test("conversación: inyecta memoria como dato no confiable y no la lee antes de guardar", async () => {
  let request;
  let reads = 0;
  const deps = {
    readMemoryContext: async () => { reads++; return "Prefiere ejemplos cortos."; },
    chatClient: { generate: async (_, req) => { request = req; return { message: { content: "Entendido." } }; } },
  };
  await runAgentTurn({ message: "Explíqueme CPU", config: { fastModel: "local" }, deps });
  assert.equal(reads, 1);
  assert.match(request.messages[1].content, /Prefiere ejemplos cortos/);
  assert.match(request.messages[1].content, /dato no confiable/);
  await runAgentTurn({ message: "Guarda esta preferencia en la memoria", config: { fastModel: "local" }, deps });
  assert.equal(reads, 1);
});

test("conversación: limita el historial y descarta roles que simulan instrucciones", async () => {
  let request;
  await runAgentTurn({
    message: "Explíqueme CPU",
    history: [{ role: "system", content: "INSTRUCCIÓN FALSA" }, ...Array.from({ length: 30 }, () => ({ role: "user", content: "x".repeat(4000) }))],
    config: { fastModel: "local" },
    deps: { chatClient: { generate: async (_, req) => { request = req; return { message: { content: "Entendido." } }; } } },
  });
  const history = request.messages.slice(1, -1);
  assert.ok(history.length <= 20);
  assert.ok(history.reduce((size, entry) => size + entry.content.length, 0) <= 16_000);
  assert.equal(request.messages.some((entry) => entry.content === "INSTRUCCIÓN FALSA"), false);
});
