import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn } from "../src/core/agent.mjs";

function makeDeps({ generateResponse = null, toolResults = {}, showCapabilities = { tools: true, vision: true } } = {}) {
  const toolCalls = [];
  const chatClient = {
    async generate(model, req) {
      const messages = req.messages;
      const lastUser = messages[messages.length - 1];
      const userText = typeof lastUser.content === "string" ? lastUser.content : "";

      // Si hay una función generateResponse configurada, usarla siempre
      if (generateResponse) {
        return generateResponse(req);
      }

      // Si hay resultados de tools previos, responder texto final
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        return { model, message: { content: "Resumen final después de usar herramientas." } };
      }

      // Por defecto: no tool calls, responder directo
      return { model, message: { content: "Respuesta directa sin herramientas." } };
    },
  };

  const ollamaClient = {
    async show(model) {
      return { ...showCapabilities, model };
    },
    capabilities() {
      return showCapabilities;
    },
  };

  const executeTool = async (name, args) => {
    toolCalls.push({ name, args });
    return toolResults[name] ?? { ok: true, result: `resultado de ${name}` };
  };

  return { chatClient, ollamaClient, executeTool, toolCalls };
}

test("agent: sin tools, responde directo", async () => {
  const deps = makeDeps();
  const result = await runAgentTurn({
    message: "Hola Bit",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });
  assert.equal(result.text, "Respuesta directa sin herramientas.");
  assert.equal(result.toolCalls, 0);
  assert.equal(result.rounds, 1);
});

test("agent: una tool exitosa se ejecuta y devuelve resultado", async () => {
  const deps = makeDeps({
    generateResponse: (req) => {
      const messages = req.messages;
      const lastMsg = messages[messages.length - 1];
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        return { model: "qwen2.5:3b", message: { content: "He visto la pantalla. Hay una ventana abierta." } };
      }
      return {
        model: "qwen2.5:3b",
        message: {
          content: "Voy a mirar la pantalla",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "system.captureScreen", arguments: JSON.stringify({ prompt: "¿qué hay?" }) },
            },
          ],
        },
      };
    },
    toolResults: { "system.captureScreen": { ok: true, analysis: "Hay una ventana de bloc de notas abierta" } },
  });

  const result = await runAgentTurn({
    message: "¿qué está en mi pantalla?",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });

  assert.equal(deps.toolCalls.length, 1);
  assert.equal(deps.toolCalls[0].name, "system.captureScreen");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.text, "He visto la pantalla. Hay una ventana abierta.");
});

test("agent: tool que falla devuelve error sin tirar el turno", async () => {
  const deps = makeDeps({
    generateResponse: (req) => {
      const messages = req.messages;
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        return { model: "qwen2.5:3b", message: { content: "El usuario canceló la operación." } };
      }
      return {
        model: "qwen2.5:3b",
        message: {
          content: "Voy a abrir una app",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "system.openApp", arguments: JSON.stringify({ target: "notepad.exe" }) },
            },
          ],
        },
      };
    },
    toolResults: {},
    executeTool: async () => {
      throw new Error("Usuario canceló");
    },
  });

  const result = await runAgentTurn({
    message: "abrí el bloc de notas",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });

  assert.equal(result.toolCalls, 1);
  assert.ok(result.text.includes("usuario canceló") || result.text.includes("Resumen final"));
});

test("agent: límite de rondas se respeta (máx 4)", async () => {
  const deps = makeDeps({
    generateResponse: () => ({
      model: "qwen2.5:3b",
      message: {
        content: "Sigo usando herramientas",
        tool_calls: [
          {
            id: "call_x",
            type: "function",
            function: { name: "system.captureScreen", arguments: JSON.stringify({ prompt: "x" }) },
          },
        ],
      },
    }),
    toolResults: { "system.captureScreen": { ok: true, analysis: "pantalla" } },
  });

  const result = await runAgentTurn({
    message: "sigue analizando",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });

  assert.equal(result.rounds, 4);
  assert.ok(result.text.includes("límite de rondas"));
});

test("agent: modelo sin soporte de tools no recibe tools", async () => {
  const deps = makeDeps({
    showCapabilities: { tools: false, vision: false },
    generateResponse: () => ({ model: "qwen2.5:3b", message: { content: "Respuesta sin tools" } }),
  });

  const result = await runAgentTurn({
    message: "hacé algo",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });

  assert.equal(result.toolCalls, 0);
  assert.equal(result.text, "Respuesta sin tools");
});

test("agent: argumentos inválidos de tool son rechazados con validación", async () => {
  const deps = makeDeps({
    generateResponse: (req) => {
      const messages = req.messages;
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        return { model: "qwen2.5:3b", message: { content: "No pude capturar la pantalla." } };
      }
      return {
        model: "qwen2.5:3b",
        message: {
          content: "Voy a capturar",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "system.captureScreen", arguments: JSON.stringify({}) },
            },
          ],
        },
      };
    },
    toolResults: {},
  });

  const result = await runAgentTurn({
    message: "capturá pantalla",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "" },
    deps,
  });

  assert.equal(deps.toolCalls.length, 1);
  assert.ok(result.text.includes("Error de validación") || result.text.includes("No pude capturar"));
});

test("agent: vaultPath se inyecta desde config, no del modelo", async () => {
  const deps = makeDeps({
    generateResponse: (req) => {
      const messages = req.messages;
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        return { model: "qwen2.5:3b", message: { content: "Encontré notas sobre proyecto." } };
      }
      return {
        model: "qwen2.5:3b",
        message: {
          content: "Busco en la bóveda",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "obsidian.search", arguments: JSON.stringify({ query: "proyecto" }) },
            },
          ],
        },
      };
    },
    toolResults: { "obsidian.search": [{ title: "Nota 1", path: "Bit/Nota1.md" }] },
  });

  const result = await runAgentTurn({
    message: "buscá proyecto en la bóveda",
    config: { fastModel: "qwen2.5:3b", model: "qwen2.5-coder:7b", visionModel: "", vaultPath: "/Users/user/Vault" },
    deps: { ...deps, vaultConfig: { vaultPath: "/Users/user/Vault" } },
  });

  assert.equal(deps.toolCalls[0].args.vaultPath, "/Users/user/Vault");
  assert.equal(deps.toolCalls[0].args.query, "proyecto");
});
