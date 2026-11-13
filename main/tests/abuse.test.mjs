import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateExecutionTarget } from "../src/screen/exec-tools.mjs";
import { validateToolInput, validateToolOutput } from "../src/core/validation.mjs";
import { downloadSecureAsset, isUrlAllowed } from "../src/core/downloader.mjs";
import { ObsidianVault } from "../src/obsidian/vault.mjs";

const HASH = "a".repeat(64);

test("abuso exec: shells y scripts NO deben ejecutarse", () => {
  for (const t of [
    "powershell.exe", "pwsh.exe", "cmd.exe", "regedit.exe", "script.js", "tool.py",
    "file:///C:/Users/Luca/script.js", "file://servidor/compartido/nota.txt",
  ])
    assert.equal(validateExecutionTarget(t).ok, false, t);
});
test("abuso exec: protocolos peligrosos bloqueados", () => {
  for (const t of ["ms-msdt:", "search-ms:query=x", "javascript:alert(1)"])
    assert.equal(validateExecutionTarget(t).ok, false, t);
});
test("exec: URL legítima con & debe permitirse", () => {
  assert.equal(validateExecutionTarget("[https://www.google.com/search?q=a&hl=es](https://www.google.com/search?q=a&hl=es)").ok, true);
});
test("abuso downloader: dominios engañosos", () => {
  for (const u of ["[https://github.com.evil.com/x](https://github.com.evil.com/x)", "[https://github.com@evil.com/x](https://github.com@evil.com/x)", "[http://github.com/x](http://github.com/x)"])
    assert.equal(isUrlAllowed(u), false, u);
});
test("abuso downloader: prefijo tmp-evil no es el directorio temporal", async () => {
  const dest = resolve(process.cwd(), "tmp-evil", "x.bin");
  const r = await downloadSecureAsset("[https://huggingface.co/x](https://huggingface.co/x)", dest, HASH, "x", async () => false);
  assert.ok(r.error?.includes("Ruta"), "debió rechazar la ruta antes de pedir consentimiento");
});
test("abuso validación: número como string y salida sin validar", () => {
  assert.equal(validateToolInput("bit:system-capture-screen", { prompt: "x", maxSide: "1280" }).ok, false);
  assert.equal(validateToolOutput("bit:chat", { text: 123 }).ok, false);
});
test("abuso bóveda: título con salto de línea no inyecta frontmatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bit-abuse-"));
  try {
    await mkdir(join(dir, "Bit", "Conversaciones"), { recursive: true });
    const r = await new ObsidianVault(dir).saveConversationContext("A\ntype: injected", "c");
    const txt = await readFile(r.path, "utf-8");
    assert.ok(!/\ntype: injected/.test(txt));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("bóveda: crea Bit/ si no existe (hoy falla con ENOENT)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bit-abuse-"));
  try {
    const r = await new ObsidianVault(dir).saveConversationContext("t", "c");
    assert.equal(r.ok, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});