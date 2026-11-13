/** Cliente para el único servicio HTTP local permitido: Ollama en loopback. */
export class OllamaClient {
  constructor({ baseUrl = "http://127.0.0.1:11434", fetchImpl = globalThis.fetch } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      throw new Error("Ollama debe estar en loopback");
    }
    if (typeof fetchImpl !== "function") throw new Error("Ollama necesita fetch local");
    this.baseUrl = url;
    this.fetch = fetchImpl;
    this.capabilityCache = new Map();
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
    return preferred.find((name) => loadedNames.includes(name))
      ?? loadedNames[0]
      ?? preferred.find((name) => available.has(name))
      ?? installedNames[0]
      ?? null;
  }

  async status(model) {
    const models = await this.list();
    const match = models.find((entry) => entry?.name === model || entry?.model === model);
    return { requested: model, installed: match?.name ?? match?.model ?? null, exact: Boolean(match) };
  }

  async generate(model, request, { onChunk, signal } = {}) {
    const response = await this.fetch(new URL("/api/chat", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, model }),
      signal,
    });
    if (!response.ok) throw await responseError(response, "Ollama /api/chat");
    if (request?.stream !== true) return response.json();
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
  }

  async #json(path, init = {}) {
    const response = await this.fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) throw await responseError(response, `Ollama ${path}`);
    return response.json();
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
