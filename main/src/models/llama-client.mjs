/**
 * Adaptador local para node-llama-cpp.
 *
 * No abre sockets ni descarga binarios en tiempo de ejecución. El import es
 * dinámico para que las comprobaciones estructurales puedan ejecutarse antes de
 * que el responsable del release instale las dependencias nativas.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function abortError() {
  return new DOMException("La generación fue cancelada", "AbortError");
}

function assertModelPath(modelPath) {
  if (typeof modelPath !== "string" || !modelPath.trim()) {
    throw new Error("No hay un modelo GGUF local seleccionado");
  }
  const resolved = resolve(modelPath);
  if (!resolved.toLowerCase().endsWith(".gguf") || !existsSync(resolved)) {
    throw new Error(`El modelo GGUF local no existe: ${resolved}`);
  }
  return resolved;
}

function conversationFromMessages(messages = []) {
  const safe = Array.isArray(messages) ? messages : [];
  const system = safe.find((message) => message?.role === "system" && typeof message.content === "string")?.content ?? "";
  const turns = safe
    .filter((message) => message && message.role !== "system" && typeof message.content === "string")
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
  const user = turns.pop();
  if (!user || user.role !== "user") throw new Error("El turno local requiere un mensaje final de usuario");
  return { system, history: turns, user: user.content };
}

function historyAsPrompt(history) {
  if (history.length === 0) return "";
  return `${history.map((turn) => `${turn.role === "assistant" ? "Asistente" : "Usuario"}: ${turn.content}`).join("\n\n")}\n\n`;
}

/**
 * Cliente compatible con el contrato de chat que usa el agente.
 * LlamaModel y LlamaContext son creados por getLlama().loadModel() y
 * model.createContext(), respectivamente; LlamaChatSession genera cada turno.
 */
export class LocalLlamaClient {
  constructor({ resolveModelPath, contextSize = 4096, maxThreads = 4 } = {}) {
    if (typeof resolveModelPath !== "function") throw new Error("resolveModelPath es requerido");
    this.resolveModelPath = resolveModelPath;
    this.contextSize = contextSize;
    this.maxThreads = maxThreads;
    this.supportsNativeTools = true;
    this.runtimeByPath = new Map();
    this.serial = Promise.resolve();
  }

  async show(model) {
    const modelPath = assertModelPath(await this.resolveModelPath(model));
    return { model: modelPath, tools: true, vision: false };
  }

  capabilities() {
    return { tools: true, vision: false };
  }

  async generate(modelName, request, { onChunk, signal } = {}) {
    return this.#exclusive(async () => {
      if (signal?.aborted) throw abortError();
      const modelPath = assertModelPath(await this.resolveModelPath(modelName));
      const runtime = await this.#getRuntime(modelPath);
      const { system, history, user } = conversationFromMessages(request?.messages);
      const functions = request?.functions
        ? Object.fromEntries(Object.entries(request.functions).map(([name, definition]) => [
          name,
          runtime.defineChatSessionFunction(definition),
        ]))
        : undefined;
      const session = new runtime.LlamaChatSession({
        contextSequence: runtime.context.getSequence(),
        systemPrompt: system,
      });

      try {
        const response = await session.prompt(`${historyAsPrompt(history)}Usuario: ${user}`, {
          maxTokens: Number.isInteger(request?.options?.num_predict) ? request.options.num_predict : 256,
          temperature: Number.isFinite(request?.options?.temperature) ? request.options.temperature : 0.3,
          onTextChunk: typeof onChunk === "function" ? onChunk : undefined,
          signal,
          stopOnAbortSignal: true,
          functions,
        });
        if (signal?.aborted) throw abortError();
        return { model: modelPath, message: { content: String(response ?? "") } };
      } finally {
        session.dispose?.();
      }
    });
  }

  async dispose() {
    for (const runtime of this.runtimeByPath.values()) {
      runtime.context.dispose?.();
      runtime.model.dispose?.();
    }
    this.runtimeByPath.clear();
  }

  async #getRuntime(modelPath) {
    const current = this.runtimeByPath.get(modelPath);
    if (current) return current;

    // Un solo modelo residente: en equipos CPU con 16 GB mantener varios
    // contextos cargados agota la memoria al alternar entre roles.
    await this.dispose();

    let native;
    try {
      native = await import("node-llama-cpp");
    } catch (error) {
      throw new Error("node-llama-cpp no está instalado. El responsable del release debe ejecutar npm install después de revisar package.json.", { cause: error });
    }

    const { getLlama, LlamaModel, LlamaContext, LlamaChatSession, defineChatSessionFunction } = native;
    const llama = await getLlama({ gpu: false, build: "never", maxThreads: this.maxThreads });
    const model = await llama.loadModel({ modelPath });
    if (!(model instanceof LlamaModel)) throw new Error("node-llama-cpp no creó un LlamaModel válido");
    const context = await model.createContext({ contextSize: this.contextSize });
    if (!(context instanceof LlamaContext)) throw new Error("node-llama-cpp no creó un LlamaContext válido");
    const runtime = { model, context, LlamaChatSession, defineChatSessionFunction };
    this.runtimeByPath.set(modelPath, runtime);
    return runtime;
  }

  async #exclusive(task) {
    const previous = this.serial;
    let release;
    this.serial = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
