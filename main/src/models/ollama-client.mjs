export class OllamaClient {
  constructor({ baseUrl = "http://127.0.0.1:11434", fetchImpl = globalThis.fetch } = {}) {
    const url = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error("Ollama debe estar en loopback");
    this.baseUrl = url;
    this.fetch = fetchImpl;
    this.capabilityCache = new Map();
  }

  async show(model) {
    const response = await this.fetch(new URL("/api/show", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: model }) });
    if (!response.ok) throw new Error(`Ollama /api/show: ${response.status}`);
    const body = await response.json();
    const details = body.details ?? {};
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    const result = { model, tools: capabilities.includes("tools") || /tool/i.test(String(body.template ?? "")), vision: capabilities.includes("vision") || details.families?.includes?.("clip") === true };
    this.capabilityCache.set(model, result);
    return result;
  }

  capabilities(model) { return this.capabilityCache.get(model); }

  async generate(model, request) {
    const response = await this.fetch(new URL("/api/chat", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, ...request }) });
    if (!response.ok) throw new Error(`Ollama /api/chat: ${response.status}`);
    return response.json();
  }

  async copy(source, destination) {
    return this.#jsonPost("/api/copy", { source, destination });
  }

  async pull(model, { signal, onProgress } = {}) {
    const response = await this.fetch(new URL("/api/pull", this.baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }), signal
    });
    if (!response.ok) throw new Error(`Ollama /api/pull: ${response.status}`);
    if (!response.body || typeof response.body.getReader !== "function") return response.json();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const results = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = JSON.parse(line);
        results.push(item);
        onProgress?.(item);
      }
    }
    if (buffer.trim()) results.push(JSON.parse(buffer));
    return results;
  }

  async #jsonPost(path, body) {
    const response = await this.fetch(new URL(path, this.baseUrl), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Ollama ${path}: ${response.status}`);
    return response.json();
  }

  async status(model) {
    const response = await this.fetch(new URL("/api/tags", this.baseUrl));
    if (!response.ok) throw new Error(`Ollama /api/tags: ${response.status}`);
    const body = await response.json();
    const match = (body.models ?? []).find((item) => item.name === model || item.model === model);
    return { requested: model, installed: match?.name ?? match?.model ?? null, exact: (match?.name ?? match?.model) === model };
  }
}
