import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quantizationFromName, readGgufMetadata } from "../src/models/gguf-metadata.mjs";

const u32 = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const u64 = (value) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
const string = (value) => Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value)]);

test("lee arquitectura y contexto de una cabecera GGUF sin cargar pesos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-gguf-"));
  const path = join(directory, "modelo-q4_k_m.gguf");
  try {
    const header = Buffer.concat([
      Buffer.from("GGUF"), u32(3), u64(0), u64(2),
      string("general.architecture"), u32(8), string("qwen2"),
      string("qwen2.context_length"), u32(4), u32(32768),
    ]);
    await writeFile(path, header);
    assert.deepEqual(await readGgufMetadata(path), { architecture: "qwen2", contextLength: 32768, fileType: null });
    assert.equal(quantizationFromName(path), "Q4_K_M");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza archivos que no son GGUF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-gguf-"));
  const path = join(directory, "falso.gguf");
  try {
    await writeFile(path, "GGUF falso");
    await assert.rejects(() => readGgufMetadata(path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
