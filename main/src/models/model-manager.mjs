import { migrateModelConfig } from "./config.mjs";

export class ModelManager {
  constructor(client, config) {
    this.client = client;
    this.config = migrateModelConfig(config);
    this.loaded = new Set();
    this.queue = Promise.resolve();
  }

  modelForRole(role) {
    return this.config[role === "heavy" ? "model" : `${role}Model`] ?? this.config.model;
  }

  async warmFast() { return this.#enqueue(() => this.#warm("fast")); }
  async warmHeavy() { return this.#enqueue(() => this.#warm("heavy")); }

  async #warm(role) {
    const model = this.modelForRole(role);
    if (!model) return { role, skipped: true };
    const settings = this.config[role];
    await this.client.generate(model, { messages: [], stream: false, options: { num_ctx: settings.context, num_predict: 1, temperature: settings.temperature }, keep_alive: settings.keepAlive, think: false });
    this.loaded.add(model);
    return { role, model, loaded: true };
  }

  async withModel(role, operation) {
    return this.#enqueue(async () => {
      const model = this.modelForRole(role);
      const settings = this.config[role];
      const capabilities = this.client.capabilities(model) ?? await this.client.show(model);
      const request = { options: { num_ctx: settings.context, num_predict: settings.numPredict, temperature: settings.temperature }, keep_alive: settings.keepAlive, think: settings.think === true };
      return operation({ model, settings, capabilities, request });
    });
  }

  #enqueue(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }
}
