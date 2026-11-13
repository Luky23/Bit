/** Catálogo local compartido por Ajustes y todos los consumidores del chat. */
export class ModelService {
  constructor({ ollama, llama, listGguf }) {
    this.ollama = ollama;
    this.llama = llama;
    this.listGguf = listGguf;
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
    return this.client(resolved).generate(resolved, request, options);
  }
}
