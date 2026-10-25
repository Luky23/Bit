const SCHEMAS = Object.freeze({
  "bit:chat": {
    type: "object",
    properties: {
      model: { type: "string", maxLength: 128, pattern: "^[a-z0-9._:-]+$" },
      message: { type: "string", minLength: 1, maxLength: 8000 },
      imageDataUrl: { type: "string", format: "data-url", maxLength: 12_582_912 },
      history: { type: "array", maxItems: 20, items: { type: "object" } }
    },
    required: ["message"],
    additionalProperties: false
  },
  "bit:screen-capture": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:speak": {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 4000 }
    },
    required: ["text"],
    additionalProperties: false
  },
  "bit:stop-speaking": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:overlay-set-expanded": {
    type: "object",
    properties: {
      expanded: { type: "boolean" }
    },
    required: ["expanded"],
    additionalProperties: false
  },
  "bit:open-main": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:runtime": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:model-config": {
    type: "object",
    properties: {
      fastModel: { type: "string", minLength: 1, maxLength: 128 },
      model: { type: "string", minLength: 1, maxLength: 128 },
      visionModel: { type: "string", maxLength: 128 },
      embedModel: { type: "string", maxLength: 128 },
      fast: { type: "object", properties: { context: { type: "integer", minimum: 4096, maximum: 131072 }, numPredict: { type: "integer", minimum: 0, maximum: 32768 }, temperature: { type: "number", minimum: 0, maximum: 2 }, keepAlive: { type: "string", maxLength: 32 }, think: { type: "boolean" } } },
      heavy: { type: "object", properties: { context: { type: "integer", minimum: 4096, maximum: 131072 }, numPredict: { type: "integer", minimum: 0, maximum: 32768 }, temperature: { type: "number", minimum: 0, maximum: 2 }, keepAlive: { type: "string", maxLength: 32 }, think: { type: "boolean" } } },
      vision: { type: "object", properties: { context: { type: "integer", minimum: 4096, maximum: 131072 }, numPredict: { type: "integer", minimum: 0, maximum: 32768 }, temperature: { type: "number", minimum: 0, maximum: 2 }, keepAlive: { type: "string", maxLength: 32 }, think: { type: "boolean" } } },
      embed: { type: "object", properties: { context: { type: "integer", minimum: 4096, maximum: 131072 }, numPredict: { type: "integer", minimum: 0, maximum: 32768 }, temperature: { type: "number", minimum: 0, maximum: 2 }, keepAlive: { type: "string", maxLength: 32 }, think: { type: "boolean" } } }
    },
    required: ["fastModel", "model"],
    additionalProperties: false
  },
  "bit:obsidian-audit": {
    type: "object",
    properties: {
      vaultPath: { type: "string", minLength: 1, maxLength: 260 }
    },
    required: ["vaultPath"],
    additionalProperties: false
  },
  "bit:obsidian-save": {
    type: "object",
    properties: {
      vaultPath: { type: "string", minLength: 1, maxLength: 260 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      content: { type: "string", minLength: 1, maxLength: 200000 }
    },
    required: ["vaultPath", "title", "content"],
    additionalProperties: false
  }
});

const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;

function validateFormat(value, format) {
  if (format === "data-url") {
    if (typeof value !== "string") return "Debe ser string";
    if (!DATA_URL_RE.test(value.trim())) return "Data URL de imagen inválida";
    const base64 = value.split(",")[1]?.replaceAll(/\s/g, "") ?? "";
    const bytes = Math.ceil((base64.length * 3) / 4);
    if (bytes > 12 * 1024 * 1024) return "Imagen demasiado grande (máx 12 MB)";
    return null;
  }
  return null;
}

function validateValue(value, schema, path = "") {
  if (schema.type === "string") {
    if (typeof value !== "string") return `${path}: se esperaba string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path}: mínimo ${schema.minLength} caracteres`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path}: máximo ${schema.maxLength} caracteres`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: formato inválido`;
    const fmtErr = schema.format ? validateFormat(value, schema.format) : null;
    if (fmtErr) return `${path}: ${fmtErr}`;
  } else if (schema.type === "integer" || schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return `${path}: se esperaba número`;
    if (schema.type === "integer" && !Number.isInteger(num)) return `${path}: se esperaba entero`;
    if (schema.minimum !== undefined && num < schema.minimum) return `${path}: mínimo ${schema.minimum}`;
    if (schema.maximum !== undefined && num > schema.maximum) return `${path}: máximo ${schema.maximum}`;
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") return `${path}: se esperaba booleano`;
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path}: se esperaba array`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: máximo ${schema.maxItems} items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = validateValue(value[i], schema.items, `${path}[${i}]`);
        if (err) return err;
      }
    }
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object") return `${path}: se esperaba objeto`;
    const keys = Object.keys(value);
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of keys) {
      if (!allowed.has(key) && schema.additionalProperties === false) return `${path}.${key}: propiedad no permitida`;
    }
    for (const [prop, propSchema] of Object.entries(schema.properties || {})) {
      if (propSchema.required === true || (schema.required?.includes(prop))) {
        if (!(prop in value)) return `${path}.${prop}: propiedad requerida`;
      }
      if (prop in value) {
        const err = validateValue(value[prop], propSchema, path ? `${path}.${prop}` : prop);
        if (err) return err;
      }
    }
  }
  return null;
}

export function validateToolInput(toolName, input) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: true };
  const error = validateValue(input, schema);
  return error ? { ok: false, error } : { ok: true };
}

export function validateToolOutput(toolName, output) {
  return { ok: true };
}

export function getSchema(toolName) {
  return SCHEMAS[toolName] ?? null;
}

export function listSchemas() {
  return Object.keys(SCHEMAS);
}