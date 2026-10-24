const DAY = 86_400_000;

function dateStamp(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now).replaceAll("-", "");
}

export class ModelUpdater {
  constructor({ client, config = {}, diskSpace = async () => Number.MAX_SAFE_INTEGER, now = () => new Date(), approve = async () => false } = {}) {
    if (!client) throw new Error("client Ollama requerido");
    this.client = client;
    this.config = { enabled: false, scheduleEnabled: false, selectedTags: [], ...config };
    this.diskSpace = diskSpace;
    this.now = now;
    this.approve = approve;
  }

  canUpdate(tag) {
    return this.config.enabled === true && this.config.selectedTags.includes(tag);
  }

  async update(tag, { requiredBytes = 0, signal, onProgress } = {}) {
    if (!this.canUpdate(tag)) throw new Error("actualización no autorizada o tag no seleccionado");
    if (signal?.aborted) throw new Error("actualización cancelada");
    const available = await this.diskSpace();
    if (available < requiredBytes) throw new Error("espacio insuficiente");
    if (!await this.approve({ tag, requiredBytes })) throw new Error("actualización rechazada");

    const backup = `${tag}-respaldo-${dateStamp(this.now())}`;
    await this.client.copy(tag, backup);
    try {
      await this.client.pull(tag, { signal, onProgress });
      if (signal?.aborted) throw new Error("actualización cancelada");
      await this.#smokeTest(tag);
      return { tag, backup, rolledBack: false };
    } catch (error) {
      await this.client.copy(backup, tag);
      return { tag, backup, rolledBack: true, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async #smokeTest(tag) {
    const chat = await this.client.generate(tag, { stream: false, messages: [{ role: "user", content: "Respondé OK." }], options: { num_predict: 8 }, think: false });
    if (!chat) throw new Error("prueba de humo de chat vacía");
    const tools = await this.client.generate(tag, { stream: false, messages: [{ role: "user", content: "Usá la herramienta de prueba." }], tools: [{ type: "function", function: { name: "smoke_test", parameters: { type: "object" } } }], options: { num_predict: 16 }, think: false });
    if (!tools) throw new Error("prueba de humo de herramientas vacía");
  }
}
