import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { enforceSandbox, isWithin, resolveSandboxPath, SandboxError } from "../src/core/sandbox.mjs";

async function withSandboxRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "bit-sandbox-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("resolveSandboxPath acepta una ruta relativa dentro del raíz", () =>
  withSandboxRoot((root) => {
    const resolved = resolveSandboxPath(root, "proyecto/archivo.txt");
    assert.ok(resolved.startsWith(root));
    assert.ok(resolved.endsWith(`archivo.txt`));
  }));

test("resolveSandboxPath acepta una ruta absoluta que cae dentro del raíz", () =>
  withSandboxRoot((root) => {
    const target = join(root, "notas", "memo.md");
    assert.equal(resolveSandboxPath(root, target), target);
  }));

test("resolveSandboxPath RECHAZA path traversal con ..", () =>
  withSandboxRoot((root) => {
    assert.throws(() => resolveSandboxPath(root, "../fuera.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "a/../../fuera.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "..\\fuera.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "a\\..\\..\\fuera.txt"), SandboxError);
  }));

test("resolveSandboxPath RECHAZA .. aunque la ruta normalice dentro del raíz", () =>
  withSandboxRoot((root) => {
    // "dentro/../dentro/archivo.txt" termina dentro, pero el segmento ".." se rechaza por regla.
    assert.throws(() => resolveSandboxPath(root, "dentro/../dentro/archivo.txt"), SandboxError);
  }));

test("resolveSandboxPath RECHAZA una ruta absoluta fuera del raíz", () =>
  withSandboxRoot((root) => {
    const outside = root.endsWith(sep) ? `${root}..${sep}fuera.txt` : `${root}${sep}..${sep}fuera.txt`;
    assert.throws(() => resolveSandboxPath(root, outside), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "C:\\Windows\\System32\\evil.dll"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "/etc/passwd"), SandboxError);
  }));

test("resolveSandboxPath RECHAZA escribir sobre el propio raíz", () =>
  withSandboxRoot((root) => {
    assert.throws(() => resolveSandboxPath(root, ""), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "."), SandboxError);
    assert.throws(() => resolveSandboxPath(root, root), SandboxError);
  }));

test("resolveSandboxPath RECHAZA rutas UNC, de dispositivo y streams alternos", () =>
  withSandboxRoot((root) => {
    assert.throws(() => resolveSandboxPath(root, "\\\\servidor\\share\\x.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "//servidor/share/x.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "\\\\?\\C:\\x.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, join(root, "nota.txt:stream")), SandboxError);
  }));

test("resolveSandboxPath RECHAZA variables de entorno, NUL y entradas no string", () =>
  withSandboxRoot((root) => {
    assert.throws(() => resolveSandboxPath(root, "%USERPROFILE%\\x.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "a\u0000b.txt"), SandboxError);
    assert.throws(() => resolveSandboxPath(root, null), SandboxError);
    assert.throws(() => resolveSandboxPath(root, undefined), SandboxError);
    assert.throws(() => resolveSandboxPath(root, 42), SandboxError);
    assert.throws(() => resolveSandboxPath(root, "x".repeat(2000)), SandboxError);
  }));

test("resolveSandboxPath RECHAZA un raíz inválido", () => {
  assert.throws(() => resolveSandboxPath("", "a.txt"), SandboxError);
  assert.throws(() => resolveSandboxPath("ruta/relativa", "a.txt"), SandboxError);
  assert.throws(() => resolveSandboxPath("\\\\servidor\\share", "a.txt"), SandboxError);
});

test("resolveSandboxPath es case-insensitive en Windows", { skip: process.platform !== "win32" }, () =>
  withSandboxRoot((root) => {
    const target = `${root.toUpperCase()}\\archivo.txt`;
    assert.equal(resolveSandboxPath(root, target), target);
  }));

test("isWithin distingue el propio raíz de sus descendientes", () =>
  withSandboxRoot((root) => {
    const child = join(root, "hijo");
    assert.equal(isWithin(root, root), true);
    assert.equal(isWithin(root, child), true);
    assert.equal(isWithin(child, root), false);
    assert.equal(isWithin(root, `${root}${sep}..${sep}fuera`), false);
  }));

test("enforceSandbox devuelve la ruta canónica de un archivo inexistente dentro del raíz", () =>
  withSandboxRoot(async (root) => {
    const resolved = await enforceSandbox(root, join("sub", "carpeta", "nuevo.txt"));
    assert.ok(resolved.includes("nuevo.txt"));
    assert.equal(isWithin(await import("node:fs/promises").then((fs) => fs.realpath(root)), resolved), true);
  }));

test("enforceSandbox RECHAZA escapar por symlink dentro del raíz", { skip: process.platform === "win32" }, () =>
  withSandboxRoot(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "bit-outside-"));
    try {
      await mkdir(join(root, "enlace"), { recursive: true }).catch(() => {});
      await symlink(outside, join(root, "enlace", "salida"), "dir");
      await assert.rejects(() => enforceSandbox(root, join("enlace", "salida", "evil.txt")), SandboxError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));

test("enforceSandbox RECHAZA una ruta absoluta fuera del raíz", () =>
  withSandboxRoot(async (root) => {
    await assert.rejects(() => enforceSandbox(root, "C:\\Windows\\System32\\evil.dll"), SandboxError);
    await assert.rejects(() => enforceSandbox(root, join(root, "..", "fuera.txt")), SandboxError);
  }));

test("enforceSandbox acepta escribir dentro y luego leer el archivo", () =>
  withSandboxRoot(async (root) => {
    const { writeFile: write, readFile: read, mkdir } = await import("node:fs/promises");
    const target = await enforceSandbox(root, "bit/archivo.txt");
    // El sandbox valida rutas; crear los padres es responsabilidad de file-tools.
    await mkdir(join(target, ".."), { recursive: true });
    await write(target, "hola", "utf8");
    assert.equal(await read(target, "utf8"), "hola");
    assert.equal(await enforceSandbox(root, "bit/archivo.txt"), target);
  }));

test("enforceSandbox RECHAZA un raíz inexistente", async () => {
  await assert.rejects(() => enforceSandbox(join(tmpdir(), "bit-que-no-existe-xyz"), "a.txt"));
});
