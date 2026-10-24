const MAX_LINE_BYTES = 1_048_576;
const TYPES = new Set(["hello", "audio", "transcript", "speak", "stop", "error", "level", "ready"]);

export function parseVoiceLine(line) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw new Error("mensaje de voz demasiado grande");
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || !TYPES.has(value.type)) throw new Error("tipo de mensaje de voz inválido");
  if (value.type === "audio" && typeof value.pcmBase64 !== "string") throw new Error("audio sin pcmBase64");
  if (value.type === "speak" && typeof value.text !== "string") throw new Error("speak sin texto");
  return value;
}

export function encodeVoiceMessage(message) {
  const line = JSON.stringify(message);
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw new Error("mensaje de voz demasiado grande");
  parseVoiceLine(line);
  return `${line}\n`;
}

export class JsonlFramer {
  constructor() { this.buffer = ""; }
  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter(Boolean).map(parseVoiceLine);
  }
}
