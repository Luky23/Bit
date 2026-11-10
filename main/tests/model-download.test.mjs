import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCatalogModel, MODEL_CATALOG } from "../src/models/model-download.mjs";

test("el catálogo fija HTTPS y SHA256 para cada modelo", () => {
  for (const model of Object.values(MODEL_CATALOG)) {
    assert.match(model.url, /^https:\/\/huggingface\.co\//u);
    assert.match(model.sha256, /^[a-f0-9]{64}$/u);
    assert.match(model.fileName, /\.gguf$/u);
  }
});

test("borra la descarga si el SHA256 no coincide", async () => {
  const modelsDir = await mkdtemp(join(tmpdir(), "bit-model-"));
  try {
    const fetchDownload = async () => new Response("contenido alterado", { status: 200 });
    await assert.rejects(() => downloadCatalogModel({ id: "conversation", modelsDir, fetchDownload }), /SHA256/u);
    assert.deepEqual(await readdir(modelsDir), []);
  } finally {
    await rm(modelsDir, { recursive: true, force: true });
  }
});
