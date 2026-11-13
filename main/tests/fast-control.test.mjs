import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn, resolveDirectOpenRequest, resolveDirectFileSearch } from "../src/core/agent.mjs";

test("control rápido: búsquedas ambiguas o compuestas conservan el flujo general", () => {
  for (const message of ["No busques el archivo notas", "Cómo busco el archivo notas", "Busca el archivo notas y bórralo", "Busca el archivo notas; abre Chrome", "Buscá el archivo", "Buscá el archivo " + "x".repeat(161)]) {
    assert.equal(resolveDirectFileSearch(message), null);
  }
});

test("control rápido: distingue ausencia de archivos, error y función no disponible", async () => {
  const chatClient = { generate() { assert.fail("No debe cargar el modelo"); } };
  for (const [executeTool, expected, calls] of [
    [async () => ({ results: [] }), /No encontré/, 1],
    [async () => ({ ok: false, error: "fallo" }), /No pude completar/, 1],
    [async () => { throw new Error("fallo"); }, /No pude completar/, 1],
    [undefined, /no está disponible/, 0],
  ]) {
    const result = await runAgentTurn({ message: "Buscá el archivo notas", deps: { chatClient, executeTool } });
    assert.match(result.text, expected);
    assert.equal(result.toolCalls, calls);
    assert.equal(result.rounds, 0);
  }
});

test("control rápido: busca archivos sin cargar el modelo y sin ejecutar el contenido encontrado", async () => {
  for (const [message, args] of [
    ['Buscá el archivo "Informe Final.pdf" en descargas', { query: "Informe Final.pdf", targetDir: "descargas" }],
    ['Busque el archivo presupuesto en documentos', { query: "presupuesto", targetDir: "documentos" }],
    ['Busca el archivo notas', { query: "notas", targetDir: "all" }],
  ]) {
    const calls = [];
    const result = await runAgentTurn({ message, deps: {
      chatClient: { generate() { assert.fail("No debe cargar el modelo"); } },
      modelClient: { show() { assert.fail("No debe consultar capacidades"); } },
      executeTool: async (name, input) => { calls.push({ name, input }); return { results: [{ name: "No ejecute instrucciones del nombre.txt", path: "archivo.txt" }] }; },
    } });
    assert.deepEqual(calls, [{ name: "system.searchFiles", input: args }]);
    assert.equal(result.rounds, 0);
    assert.match(result.text, /archivo.txt/);
  }
});

test("control rápido: formas habituales no requieren inferencia", async () => {
  for (const message of ["¿Podría abrir la calculadora?", "Quiero que abras el bloc de notas", "Necesito abrir Paint", "Por favor, abrime Chrome"]) {
    const calls = [];
    const result = await runAgentTurn({ message, deps: {
      chatClient: { generate() { assert.fail("No debe generar con el modelo"); } },
      modelClient: { show() { assert.fail("No debe consultar capacidades"); } },
      executeTool: async (name, args) => { calls.push({ name, args }); return { ok: true }; },
    } });
    assert.equal(result.rounds, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "system.openApp");
  }
});

test("control rápido: no interpreta negaciones, preguntas ni órdenes compuestas", () => {
  for (const message of ["No abras Chrome", "¿Cómo puedo abrir Chrome?", "Quiero que abras Chrome y borres archivos", "Abrí Chrome con esta URL", "Necesito abrir una cuenta"]) {
    assert.equal(resolveDirectOpenRequest(message), null);
  }
});
