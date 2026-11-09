import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isUrlAllowed, downloadSecureAsset } from "../src/core/downloader.mjs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

async function calculateSha256(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function createTempDir() {
  return mkdtemp(join(tmpdir(), "bit-downloader-test-"));
}

test("downloader: isUrlAllowed bloquea dominios no permitidos", () => {
  assert.equal(isUrlAllowed("https://huggingface.co/file.onnx"), true);
  assert.equal(isUrlAllowed("https://raw.githubusercontent.com/user/repo/file"), true);
  assert.equal(isUrlAllowed("https://github.com/user/repo/file"), true);
  assert.equal(isUrlAllowed("https://cdn.jsdelivr.net/npm/file"), true);
  assert.equal(isUrlAllowed("https://evil.com/file.onnx"), false);
  assert.equal(isUrlAllowed("http://huggingface.co/file.onnx"), false); // no HTTPS
  assert.equal(isUrlAllowed("ftp://huggingface.co/file.onnx"), false); // protocolo inválido
  assert.equal(isUrlAllowed("not-a-url"), false);
});

test("downloader: calculateSha256 produce hash correcto", async () => {
  const dir = await createTempDir();
  try {
    const file = join(dir, "test.txt");
    await writeFile(file, "hello world");
    const hash = await calculateSha256(file);
    assert.equal(hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: downloadSecureAsset rechaza URL no permitida", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const result = await downloadSecureAsset(
      "https://evil.com/file",
      dest,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "test",
      async () => true // mock consent
    );
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Dominio no permitido"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: downloadSecureAsset rechaza hash inválido", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const result = await downloadSecureAsset(
      "https://huggingface.co/file",
      dest,
      "invalid-hash",
      "test",
      async () => true
    );
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Hash SHA256 inválido"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: downloadSecureAsset cancela si usuario rechaza", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const result = await downloadSecureAsset(
      "https://huggingface.co/file",
      dest,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "test",
      async () => false // mock consent denied
    );
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: downloadSecureAsset rechaza path fuera de directorio permitido", async () => {
  const dir = await createTempDir();
  try {
    // Path absoluto fuera de LOCALAPPDATA/Bit
    const dest = resolve(dir, "..", "..", "evil.exe");
    const result = await downloadSecureAsset(
      "https://huggingface.co/file",
      dest,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "test",
      async () => true
    );
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Ruta de destino no permitida"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Test de integración con mock de fetch (no hace request real)
test("downloader: downloadSecureAsset falla con hash incorrecto (mock fetch)", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const fetchExternal = async (url) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("contenido falso"));
          controller.close();
        }
      })
    });

    const result = await downloadSecureAsset(
      "https://huggingface.co/test/file",
      dest,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // hash de string vacío, no coincide
      "test-file",
      async () => true,
      fetchExternal
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Hash mismatch"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
