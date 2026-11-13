const MAX_LINE_BYTES = 1_048_576;
const TYPES = new Set([
  "hello", "audio", "transcript", "speak", "stop", "error", "level", "ready",
  "vad-calibrate", "vad-process", "vad-trigger", "stt-configure", "stt-start", "stt-stop"
]);

export function parseVoiceLine(line) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
    throw new Error("mensaje de voz demasiado grande");
  }
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || !TYPES.has(value.type)) {
    throw new Error("tipo de mensaje de voz inválido: " + (value?.type ?? "unknown"));
  }
  if (value.type === "audio" && typeof value.pcmBase64 !== "string") {
    throw new Error("audio sin pcmBase64");
  }
  if (value.type === "speak" && typeof value.text !== "string") {
    throw new Error("speak sin texto");
  }
  if (value.type === "vad-process" && typeof value.pcmBase64 !== "string") {
    throw new Error("vad-process sin pcmBase64");
  }
  if (value.type === "stt-configure" && (typeof value.modelPath !== "string" || !value.modelPath)) {
    throw new Error("stt-configure sin modelPath");
  }
  return value;
}

export function encodeVoiceMessage(message) {
  const line = JSON.stringify(message);
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
    throw new Error("mensaje de voz demasiado grande");
  }
  // Validar que el mensaje codificado sea parseable
  parseVoiceLine(line);
  return `${line}\n`;
}

export class JsonlFramer {
  constructor() {
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter(Boolean).map(parseVoiceLine);
  }

  flush() {
    const lines = this.buffer.split("\n").filter(Boolean);
    this.buffer = "";
    return lines.map(parseVoiceLine);
  }
}