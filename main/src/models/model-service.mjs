/** Catálogo local compartido por Ajustes y todos los consumidores del chat. */
export class ModelService {
  constructor({ ollama, llama, listGguf, performanceManager }) {
    this.ollama = ollama;
    this.llama = llama;
    this.listGguf = listGguf;
    this.performanceManager = performanceManager;
  }

  async list() {
    const [installed, gguf] = await Promise.all([
      this.ollama.list().catch(() => []),
      this.listGguf(),
    ]);
    return [
      ...installed.map(entry => ({ name: entry.name ?? entry.model, kind: "model", source: "ollama" }))
        .filter(entry => typeof entry.name === "string" && entry.name),
      ...gguf,
    ];
  }

  async resolveModel(requested = "", fallbackCandidates = []) {
    const models = (await this.list()).filter(entry => entry.kind === "model");
    const match = models.find(entry => entry.name === requested || entry.path === requested)
      ?? fallbackCandidates.map(name => models.find(entry => entry.name === name || entry.path === name)).find(Boolean)
      ?? models[0];
    if (!match) throw new Error("No hay modelos locales disponibles. Compruebe que Ollama esté iniciado y tenga modelos instalados, o seleccione un GGUF local.");
    return match.source === "ollama" ? match.name : match.path;
  }

  client(model) {
    return /\.gguf$/iu.test(model) ? this.llama : this.ollama;
  }

  async show(model) {
    return this.client(model).show(model);
  }

  async generate(model, request, options) {
    const resolved = await this.resolveModel(model);
    const client = this.client(resolved);
    if (!this.performanceManager) return client.generate(resolved, request, options);

    const { priority = "conversation", ...clientOptions } = options ?? {};
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const promptSize = messages.reduce((total, message) => (
      total + (typeof message?.content === "string" ? message.content.length : 0)
    ), 0);
    const requestedTokens = Number.isFinite(request?.options?.num_predict) ? request.options.num_predict : 256;
    const complexity = Math.max(1, promptSize / 4000 + requestedTokens / 256);
    const streaming = request?.stream === true && typeof clientOptions.onChunk === "function";

    return this.performanceManager.run("model.generate", ({ signal, reportProgress }) => client.generate(resolved, request, {
      ...clientOptions,
      signal,
      managed: true,
      onChunk: typeof clientOptions.onChunk === "function"
        ? (chunk) => {
          reportProgress();
          clientOptions.onChunk(chunk);
        }
        : undefined,
    }), {
      signal: clientOptions.signal,
      priority,
      complexity,
      onProgress: streaming ? () => {} : undefined,
    });
  }
}
