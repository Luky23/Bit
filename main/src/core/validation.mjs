const SCHEMAS = Object.freeze({
  "bit:chat": {
    type: "object",
    properties: {
      model: { type: "string", maxLength: 128, pattern: "^[a-z0-9._:-]+$" },
      message: { type: "string", minLength: 1, maxLength: 8000 },
      requestId: { type: "string", minLength: 8, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
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
  "bit:voice-capture-start": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:voice-capture-stop": {
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
  },
  "bit:config-pick-projects-root": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:workspace-list-projects": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  "bit:workspace-create-project": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 }
    },
    required: ["project"],
    additionalProperties: false
  },
  "bit:workspace-list-files": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", maxLength: 500 }
    },
    required: ["project"],
    additionalProperties: false
  },
  "bit:workspace-read-file": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 500 }
    },
    required: ["project", "path"],
    additionalProperties: false
  },
  "bit:workspace-create-file": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 500 },
      content: { type: "string", maxLength: 1000000 }
    },
    required: ["project", "path", "content"],
    additionalProperties: false
  },
  "bit:workspace-update-file": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 500 },
      content: { type: "string", maxLength: 1000000 }
    },
    required: ["project", "path", "content"],
    additionalProperties: false
  },
  "bit:workspace-list-backups": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 500 }
    },
    required: ["project"],
    additionalProperties: false
  },
  "bit:workspace-restore-backup": {
    type: "object",
    properties: {
      project: { type: "string", minLength: 1, maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 500 },
      backupId: { type: "string", minLength: 1, maxLength: 80 }
    },
    required: ["project", "path", "backupId"],
    additionalProperties: false
  },
  "bit:download-asset": {
    type: "object",
    properties: {
      url: { type: "string", format: "uri", maxLength: 500 },
      destPath: { type: "string", minLength: 1, maxLength: 260 },
      expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      assetName: { type: "string", minLength: 1, maxLength: 100 }
    },
    required: ["url", "destPath", "expectedHash", "assetName"],
    additionalProperties: false
  },
  "bit:ensure-piper-model": {
    type: "object",
    properties: {
      modelName: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
      voicesDir: { type: "string", minLength: 1, maxLength: 260 }
    },
    required: ["modelName", "voicesDir"],
    additionalProperties: false
  },
  "bit:system-capture-screen": {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 8000 },
      visionModel: { type: "string", maxLength: 128 },
      maxSide: { type: "integer", minimum: 640, maximum: 1920, default: 1280 }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  "bit:system-open-app": {
    type: "object",
    properties: {
      target: { type: "string", minLength: 1, maxLength: 500 },
      args: { type: "string", maxLength: 1000, default: "" }
    },
    required: ["target"],
    additionalProperties: false
  },
  "bit:system-capture-webcam": {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 8000 }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  "bit:obsidian-search": {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 500 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
    },
    required: ["query"],
    additionalProperties: false
  },
  "bit:obsidian-graph": {
    type: "object",
    properties: {
      notePath: { type: "string", minLength: 1, maxLength: 500 },
      limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 }
    },
    required: [],
    additionalProperties: false
  },
  "bit:obsidian-read": {
    type: "object",
    properties: {
      notePath: { type: "string", minLength: 1, maxLength: 500 }
    },
    required: ["notePath"],
    additionalProperties: false
  },
  "bit:obsidian-save-memory": {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      content: { type: "string", minLength: 1, maxLength: 200000 }
    },
    required: ["title", "content"],
    additionalProperties: false
  },
  "bit:web-search": {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 300 }
    },
    required: ["query"],
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
    if (typeof value !== "number") return `${path}: se esperaba número`;
    const num = value;
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

export function toolSchemaName(toolName) {
  if (typeof toolName !== "string") throw new Error("Nombre de herramienta no válido");
  const [namespace, name, ...extra] = toolName.split(".");
  if (!namespace || !name || extra.length > 0) throw new Error("Nombre de herramienta no válido");
  const kebabName = name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
  return `bit:${namespace}-${kebabName}`;
}

export function validateToolOutput(toolName, output) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: true };
  // Si la salida no es un objeto, no hay propiedades que validar contra el schema
  if (!output || typeof output !== "object" || Array.isArray(output)) return { ok: true };
  // Validación simple: verificar que el output tenga las propiedades esperadas
  const keys = Object.keys(output);
  const allowed = new Set(Object.keys(schema.properties || {}));
  for (const key of keys) {
    if (!allowed.has(key)) return { ok: false, error: `${key}: propiedad no permitida en salida` };
  }
  // Verificar tipos básicos de propiedades requeridas
  for (const [prop, propSchema] of Object.entries(schema.properties || {})) {
    if (propSchema.required === true && !(prop in output)) return { ok: false, error: `${prop}: propiedad requerida` };
    if (prop in output) {
      const val = output[prop];
      if (propSchema.type === "string" && typeof val !== "string") return { ok: false, error: `${prop}: se esperaba string` };
      if (propSchema.type === "integer" && typeof val !== "number") return { ok: false, error: `${prop}: se esperaba número` };
      if (propSchema.type === "boolean" && typeof val !== "boolean") return { ok: false, error: `${prop}: se esperaba booleano` };
    }
  }
  return { ok: true };
}

export function getSchema(toolName) {
  return SCHEMAS[toolName] ?? null;
}

export function listSchemas() {
  return Object.keys(SCHEMAS);
}
