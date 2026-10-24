const DEFAULTS = Object.freeze({
  fastModel: "qwen2.5:3b",
  model: "qwen2.5-coder:7b",
  visionModel: "",
  embedModel: "",
  fast: { context: 8192, numPredict: 512, temperature: 0.7, keepAlive: "10m", think: false },
  heavy: { context: 16384, numPredict: 2048, temperature: 0.4, keepAlive: "0", think: false },
  vision: { context: 8192, numPredict: 1024, temperature: 0.2, keepAlive: "0", think: false },
  embed: { context: 4096, numPredict: 0, temperature: 0, keepAlive: "0", think: false }
});

const ROLE_KEYS = ["fast", "heavy", "vision", "embed"];
const MODEL_KEYS = ["fastModel", "model", "visionModel", "embedModel"];

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function roleConfig(input, fallback) {
  const source = input && typeof input === "object" ? input : {};
  return {
    context: Math.round(boundedNumber(source.context, fallback.context, 4096, 131072)),
    numPredict: Math.round(boundedNumber(source.numPredict, fallback.numPredict, 0, 32768)),
    temperature: boundedNumber(source.temperature, fallback.temperature, 0, 2),
    keepAlive: typeof source.keepAlive === "string" ? source.keepAlive.slice(0, 32) : fallback.keepAlive,
    think: source.think === true
  };
}

export function defaultModelConfig() {
  return structuredClone(DEFAULTS);
}

export function migrateModelConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const output = defaultModelConfig();
  for (const key of MODEL_KEYS) {
    if (typeof source[key] === "string") output[key] = source[key].trim();
  }
  // Legacy configs used model for all requests and contextSize at the root.
  if (typeof source.fastModel !== "string" && typeof source.model === "string") output.fastModel = source.model.trim();
  const legacyContext = source.contextSize;
  for (const key of ROLE_KEYS) output[key] = roleConfig(source[key], output[key]);
  if (Number.isFinite(legacyContext)) {
    const context = Math.round(boundedNumber(legacyContext, 8192, 4096, 131072));
    output.fast.context = context;
    output.heavy.context = context;
  }
  return output;
}

export function validateModelConfig(input) {
  const config = migrateModelConfig(input);
  const errors = [];
  for (const key of MODEL_KEYS) {
    if (config[key].includes("\u0000") || config[key].length > 128) errors.push(`${key} inválido`);
  }
  if (!config.fastModel) errors.push("fastModel es obligatorio");
  if (!config.model) errors.push("model es obligatorio");
  return { ok: errors.length === 0, config, errors };
}
