import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn } from "../src/core/agent.mjs";

test("navegador: abrir y buscar es una sola acción directa sin inferencia", async () => {
  for (const [message, target, query] of [
    ["Abrí Chrome y buscá temperatura en Córdoba", "chrome.exe", "temperatura en Córdoba"],
    ["Buscá recetas de pan en Firefox", "firefox.exe", "recetas de pan"],
    ["Abrí Edge y buscá cómo hacer café", "msedge.exe", "cómo hacer café"],
    ["Buscá en Google horarios del tren", "default-browser", "horarios del tren"],
  ]) {
    const calls = [];
    const url = new URL("https://www.google.com/search"); url.searchParams.set("q", query);
    const result = await runAgentTurn({ message, deps: {
      chatClient: { generate() { assert.fail("No debe esperar al modelo"); } },
      executeTool: async (name, args) => { calls.push({ name, args }); return { ok: true }; },
    } });
    assert.deepEqual(calls, [{ name: "system.openApp", args: { target, args: url.href } }]);
    assert.equal(result.rounds, 0);
  }
});
