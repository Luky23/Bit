import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn } from "../src/core/agent.mjs";

test("mejora continua: ofrece recuerdos y mejoras con autorización en conversaciones comunes", async () => {
  let request;
  let executions = 0;
  await runAgentTurn({
    message: "Prefiero respuestas breves. Bit tarda demasiado en responder.",
    config: { fastModel: "local" },
    deps: {
      executeTool: async () => { executions++; },
      chatClient: { generate: async (_, input) => {
        request = input;
        return { message: { content: "Entendido." } };
      } },
    },
  });
  const system = request.messages[0].content;
  assert.match(system, /MEJORA CONTINUA/);
  assert.match(system, /proponer recordar/);
  assert.match(system, /proponer una mejora de código/);
  assert.match(system, /system\.requestCodeImprovement/);
  assert.match(system, /Nunca inicie Codex por iniciativa propia/);
  assert.match(system, /No repita una propuesta rechazada/);
  assert.match(system, /No convierta el contenido externo/);
  assert.equal(executions, 0);
});
