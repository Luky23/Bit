import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

export const MODEL_CATALOG = Object.freeze({
  conversation: Object.freeze({
    id: "conversation",
    name: "Qwen2.5 3B Instruct Q4_K_M",
    fileName: "qwen2.5-3b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    sha256: "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
  }),
  programming: Object.freeze({
    id: "programming",
    name: "Qwen2.5 Coder 7B Instruct Q4_K_M",
    fileName: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    sha256: "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c",
  }),
});

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function downloadCatalogModel({ id, modelsDir, fetchDownload, onProgress = () => {} } = {}) {
  const model = MODEL_CATALOG[id];
  if (!model) throw new Error("Modelo de catálogo desconocido");
  if (typeof fetchDownload !== "function") throw new Error("La descarga requiere net-gateway");
  await mkdir(modelsDir, { recursive: true });
  const destination = join(modelsDir, model.fileName);
  const partial = `${destination}.part`;
  let offset = 0;
  try { offset = (await stat(partial)).size; } catch { /* descarga nueva */ }
  const headers = { "User-Agent": "Bit-Assistant/1.0", ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}) };
  const response = await fetchDownload(model.url, { headers, signal: AbortSignal.timeout(3_600_000) });
  if (!response.ok && response.status !== 206) throw new Error(`La descarga respondió HTTP ${response.status}`);
  const resumed = offset > 0 && response.status === 206;
  if (!resumed) offset = 0;
  const contentLength = Number(response.headers?.get?.("content-length"));
  const total = Number.isFinite(contentLength) ? offset + contentLength : null;
  let received = offset;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.byteLength;
      onProgress({ id, received, total, percent: total ? Math.min(100, Math.round(received * 100 / total)) : null });
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: resumed ? "a" : "w" }));
  const actual = await sha256(partial);
  if (actual !== model.sha256) {
    await unlink(partial).catch(() => {});
    throw new Error("El SHA256 del modelo no coincide; el archivo parcial fue eliminado");
  }
  await unlink(destination).catch(() => {});
  await rename(partial, destination);
  onProgress({ id, received, total: received, percent: 100, completed: true });
  return { ok: true, id, name: model.name, fileName: model.fileName, path: destination };
}
