import { open } from "node:fs/promises";

const MAX_HEADER_BYTES = 1024 * 1024;
const ELEMENT_BYTES = new Map([[0, 1], [1, 1], [2, 2], [3, 2], [4, 4], [5, 4], [6, 4], [7, 1], [10, 8], [11, 8], [12, 8]]);

/** Lee solamente la cabecera GGUF; nunca carga los pesos en memoria. */
export async function readGgufMetadata(filePath) {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.allocUnsafe(Math.min(size, MAX_HEADER_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    let offset = 0;
    const need = (count) => {
      if (!Number.isSafeInteger(count) || count < 0 || offset + count > bytes.length) throw new Error("Cabecera GGUF incompleta");
    };
    const u32 = () => { need(4); const value = bytes.readUInt32LE(offset); offset += 4; return value; };
    const u64 = () => { need(8); const value = Number(bytes.readBigUInt64LE(offset)); offset += 8; if (!Number.isSafeInteger(value)) throw new Error("Cabecera GGUF inválida"); return value; };
    const string = () => { const length = u64(); need(length); const value = bytes.toString("utf8", offset, offset + length); offset += length; return value; };
    const value = (type, depth = 0) => {
      if (depth > 1) throw new Error("Metadatos GGUF inválidos");
      if (type === 8) return string();
      if (type === 9) {
        const elementType = u32();
        const count = u64();
        if (count > 100_000) throw new Error("Metadatos GGUF demasiado grandes");
        for (let index = 0; index < count; index++) value(elementType, depth + 1);
        return null;
      }
      const width = ELEMENT_BYTES.get(type);
      if (!width) throw new Error("Tipo de metadato GGUF desconocido");
      need(width);
      const result = type === 4 ? bytes.readUInt32LE(offset) : type === 10 ? Number(bytes.readBigUInt64LE(offset)) : null;
      offset += width;
      return result;
    };
    need(4);
    if (bytes.toString("ascii", 0, 4) !== "GGUF") throw new Error("Archivo GGUF inválido");
    offset = 4;
    const version = u32();
    if (version < 2 || version > 3) throw new Error("Versión GGUF no compatible");
    u64(); // tensor count
    const metadataCount = u64();
    if (metadataCount > 10_000) throw new Error("Metadatos GGUF demasiado grandes");
    let architecture = "";
    let contextLength = null;
    let quantization = null;
    for (let index = 0; index < metadataCount; index++) {
      const key = string();
      const entry = value(u32());
      if (key === "general.architecture" && typeof entry === "string") architecture = entry;
      if (key.endsWith(".context_length") && Number.isSafeInteger(entry)) contextLength = entry;
      if (key === "general.file_type" && Number.isSafeInteger(entry)) quantization = entry;
    }
    return { architecture, contextLength, fileType: quantization };
  } finally {
    await handle.close();
  }
}

export function quantizationFromName(name) {
  return name.match(/(?:^|[-_.])(IQ\d(?:_[A-Z0-9]+)*|Q\d(?:_[A-Z0-9]+)*|F16|F32)(?=\.|[-_]|$)/iu)?.[1]?.toUpperCase() ?? null;
}
