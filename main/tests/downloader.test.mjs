import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access, readdir } from "node:fs/promises";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function responseFor(value, headers) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(value));
        controller.close();
      },
    }),
  };
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

test("downloader: no sobrescribe un archivo destino existente", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    await writeFile(dest, "contenido original");
    let fetchCalled = false;
    const result = await downloadSecureAsset(
      "https://huggingface.co/test/file",
      dest,
      sha256("nuevo contenido"),
      "test-file",
      async () => true,
      async () => { fetchCalled = true; return responseFor("nuevo contenido"); },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, "El archivo destino ya existe y no se sobrescribirá");
    assert.equal(fetchCalled, false);
    assert.equal(await import("node:fs/promises").then((fs) => fs.readFile(dest, "utf8")), "contenido original");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: descargas concurrentes usan temporales únicos y una sola gana el destino", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const content = "contenido concurrente";
    const fetchExternal = async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      return responseFor(content);
    };
    const args = ["https://huggingface.co/test/file", dest, sha256(content), "test-file", async () => true, fetchExternal];
    const [first, second] = await Promise.all([
      downloadSecureAsset(...args),
      downloadSecureAsset(...args),
    ]);

    assert.deepEqual([first.ok, second.ok].sort(), [false, true]);
    assert.equal((await import("node:fs/promises").then((fs) => fs.readFile(dest, "utf8"))), content);
    assert.deepEqual((await readdir(dir)).sort(), ["out.bin"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: rechaza una descarga que supera maxBytes y limpia el temporal", async () => {
  const dir = await createTempDir();
  try {
    const dest = join(dir, "out.bin");
    const result = await downloadSecureAsset(
      "https://huggingface.co/test/file",
      dest,
      sha256("demasiado grande"),
      "test-file",
      async () => true,
      async () => responseFor("demasiado grande"),
      4,
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes("supera el límite permitido"));
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader: valida que url, destPath y expectedHash sean strings", async () => {
  const dir = await createTempDir();
  try {
    const validHash = sha256("contenido");
    for (const [url, destPath, expectedHash] of [
      [null, join(dir, "a"), validHash],
      ["https://huggingface.co/test/file", null, validHash],
      ["https://huggingface.co/test/file", join(dir, "c"), null],
    ]) {
      const result = await downloadSecureAsset(url, destPath, expectedHash, "test", async () => true);
      assert.equal(result.ok, false);
      assert.match(result.error, /debe ser un string/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
