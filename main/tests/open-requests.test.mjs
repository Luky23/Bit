import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn, resolveDirectOpenRequest } from "../src/core/agent.mjs";

test("apertura directa: YouTube y aplicaciones instaladas sin inferencia", async () => {
  for (const [message, name, args] of [
    ["Abrí YouTube", "system.openApp", { target: "https://www.youtube.com/", args: "" }],
    ["Poné Daddy Yankee en YouTube", "system.openApp", { target: "https://www.youtube.com/results?search_query=daddy+yankee", args: "" }],
    ["Abrí Word", "system.openInstalledApp", { name: "word" }],
    ["Abrí Visual Studio Code", "system.openInstalledApp", { name: "visual studio code" }],
    ["Poné música", "system.openApp", { target: "spotify.exe", args: "" }],
  ]) {
    const calls = [];
    const result = await runAgentTurn({ message, deps: {
      chatClient: { generate() { assert.fail("No debe llamar al modelo"); } },
      executeTool: async (tool, input) => { calls.push({ tool, input }); return { ok: true }; },
    } });
    assert.equal(result.rounds, 0);
    assert.deepEqual(calls, [{ tool: name, input: args }]);
    assert.doesNotMatch(result.text, /reproduciendo|reproduje/iu);
  }
});

test("apertura directa: no acepta comandos, URL arbitraria ni instrucciones compuestas", () => {
  for (const message of ["No abras Word", "Abre Word y borra notas", "Abre cmd.exe", "Abre powershell", "Abre https://evil.example", "Abre Word --argumento", "Abre Word; calc.exe"]) {
    assert.equal(resolveDirectOpenRequest(message), null);
  }
});
