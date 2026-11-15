/** Cliente para el único servicio HTTP local permitido: Ollama en loopback. */
export class OllamaClient {
  constructor({ baseUrl = "http://127.0.0.1:11434", fetchImpl = globalThis.fetch, performanceManager } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      throw new Error("Ollama debe estar en loopback");
    }
    if (typeof fetchImpl !== "function") throw new Error("Ollama necesita fetch local");
    this.baseUrl = url;
    this.fetch = fetchImpl;
    this.performanceManager = performanceManager;
    this.capabilityCache = new Map();
    this.modelResolutionCache = new Map();
  }

  async show(model) {
    const body = await this.#json("/api/show", { method: "POST", body: JSON.stringify({ name: model }) });
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    const details = body.details ?? {};
    const result = {
      model,
      tools: capabilities.includes("tools") || /tool/iu.test(String(body.template ?? "")),
      vision: capabilities.includes("vision") || details.families?.includes?.("clip") === true,
    };
    this.capabilityCache.set(model, result);
    return result;
  }

  capabilities(model) {
    return this.capabilityCache.get(model);
  }

  async list() {
    const body = await this.#json("/api/tags");
    return Array.isArray(body.models) ? body.models : [];
  }

  async loaded() {
    const body = await this.#json("/api/ps");
    return Array.isArray(body.models) ? body.models : [];
  }

  async resolveModel(requested, fallbackCandidates = []) {
    const cacheKey = JSON.stringify([requested, fallbackCandidates]);
    const cached = this.modelResolutionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.model;
    const [loaded, installed] = await Promise.all([
      this.loaded().catch(() => []),
      this.list().catch(() => []),
    ]);
    const loadedNames = loaded.map(modelName).filter(Boolean);
    const installedNames = installed.map(modelName).filter(Boolean);
    const available = new Set(installedNames);
    const preferred = [requested, ...fallbackCandidates]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    const model = preferred.find((name) => loadedNames.includes(name))
      ?? loadedNames[0]
      ?? preferred.find((name) => available.has(name))
      ?? installedNames[0]
      ?? null;
    this.modelResolutionCache.set(cacheKey, { model, expiresAt: Date.now() + 15_000 });
    return model;
  }

  async status(model) {
    const models = await this.list();
    const match = models.find((entry) => entry?.name === model || entry?.model === model);
    return { requested: model, installed: match?.name ?? match?.model ?? null, exact: Boolean(match) };
  }

  async generate(model, request, options = {}) {
    const { managed = false, ...generationOptions } = options;
    if (this.performanceManager && !managed) {
      const streaming = request?.stream === true && typeof generationOptions.onChunk === "function";
      return this.performanceManager.run("model.generate", ({ signal, reportProgress }) => this.generate(model, request, {
        ...generationOptions,
        signal,
        managed: true,
        onChunk: typeof generationOptions.onChunk === "function"
          ? (chunk) => {
            reportProgress();
            generationOptions.onChunk(chunk);
          }
          : undefined,
      }), {
        signal: generationOptions.signal,
        priority: generationOptions.priority ?? "conversation",
        complexity: Math.max(1, Number(request?.options?.num_predict ?? 256) / 256),
        onProgress: streaming ? () => {} : undefined,
      });
    }

    return this.#generateRequest(model, request, generationOptions);
  }

  async #generateRequest(model, request, { onChunk, signal } = {}) {
    const budgets = await this.#budgets();
    const scope = this.#requestScope(signal, budgets.connectionMs);
    try {
      const response = await this.fetch(new URL("/api/chat", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, model }),
        signal: scope.signal,
      });
      scope.connected();
      if (!response.ok) throw await responseError(response, "Ollama /api/chat");
      if (request?.stream !== true) return await response.json();
      if (!response.body?.getReader) throw new Error("Ollama no devolvió un stream de respuesta");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let latest = { message: { content: "" } };
      const consume = (line) => {
        if (!line.trim()) return;
        const item = JSON.parse(line);
        latest = item;
        const chunk = typeof item?.message?.content === "string" ? item.message.content : "";
        if (chunk) {
          content += chunk;
          onChunk?.(chunk);
        }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(consume);
        }
        buffer += decoder.decode();
        consume(buffer);
        return { ...latest, message: { ...(latest.message ?? {}), content } };
      } finally {
        reader.releaseLock();
      }
    } finally {
      scope.cleanup();
    }
  }

  async #json(path, init = {}) {
    if (this.performanceManager) {
      return this.performanceManager.run("connection.local", ({ signal, budgets }) => this.#jsonRequest(path, init, signal, budgets), {
        signal: init.signal,
        priority: "conversation",
      });
    }
    return this.#jsonRequest(path, init, undefined, await this.#budgets());
  }

  async #jsonRequest(path, init, signal, budgets) {
    const scope = this.#requestScope(signal ?? init.signal, budgets.connectionMs, budgets.totalMs);
    try {
      const response = await this.fetch(new URL(path, this.baseUrl), {
        ...init,
        signal: scope.signal,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
      scope.connected();
      if (!response.ok) throw await responseError(response, `Ollama ${path}`);
      return await response.json();
    } finally {
      scope.cleanup();
    }
  }

  async #budgets() {
    if (this.performanceManager) return this.performanceManager.getBudgets("connection.local");
    return { connectionMs: 10_000, totalMs: 30_000 };
  }

  #requestScope(signal, connectionMs, totalMs = 0) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const connectionTimer = setTimeout(() => {
      controller.abort(Object.assign(new Error("Ollama no estableció la conexión local dentro del presupuesto adaptativo."), {
        code: "ADAPTIVE_CONNECTION_TIMEOUT",
      }));
    }, connectionMs);
    const totalTimer = totalMs > 0
      ? setTimeout(() => {
        controller.abort(Object.assign(new Error("Ollama superó el límite total de la operación local."), {
          code: "ADAPTIVE_TIMEOUT",
          phase: "tiempo total",
        }));
      }, totalMs)
      : null;
    return {
      signal: controller.signal,
      connected: () => clearTimeout(connectionTimer),
      cleanup: () => {
        clearTimeout(connectionTimer);
        clearTimeout(totalTimer);
        signal?.removeEventListener("abort", abort);
      },
    };
  }
}

function modelName(entry) {
  return typeof entry?.name === "string" ? entry.name : typeof entry?.model === "string" ? entry.model : "";
}

async function responseError(response, label) {
  const raw = await response.text().catch(() => "");
  let detail = raw.trim();
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      detail = typeof parsed?.error === "string" ? parsed.error : detail;
    } catch { /* El cuerpo ya contiene el detalle legible. */ }
  }
  const suffix = detail ? `: ${detail.slice(0, 2000)}` : "";
  const error = new Error(`${label} respondio ${response.status}${suffix}`);
  error.status = response.status;
  error.detail = detail;
  return error;
}
