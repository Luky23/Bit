import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("release portable publica binario, SHA256 y procedencia con acciones fijadas", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /tags: \["v\*"\]/u);
  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /npm run verify/u);
  assert.match(workflow, /npm run dist:portable/u);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/u);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/u);
  assert.match(workflow, /Bit-Portable\.exe\.sha256/u);
});

test("install.ps1 limita hosts y verifica antes de mover y ejecutar", async () => {
  const script = await readFile(new URL("../../install.ps1", import.meta.url), "utf8");
  assert.match(script, /Set-StrictMode -Version Latest/u);
  assert.match(script, /SecurityProtocolType\]::Tls12/u);
  assert.match(script, /\$Uri\.Host -ne "github\.com"/u);
  const hash = script.indexOf("Get-FileHash");
  const move = script.indexOf("Move-Item");
  const start = script.indexOf("Start-Process");
  assert.ok(hash >= 0 && move > hash && start > move);
  assert.doesNotMatch(script, /Start-Process\s+(?:powershell|cmd|msiexec)/iu);
  assert.doesNotMatch(script, /Set-ExecutionPolicy|Add-MpPreference|New-ItemProperty/iu);
});

test("la apariencia usa tokens compartidos sin CDN", async () => {
  const [index, overlay, css] = await Promise.all([
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/overlay.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/hud-tokens.css", import.meta.url), "utf8"),
  ]);
  assert.match(index, /href="\.\/hud-tokens\.css"/u);
  assert.match(overlay, /href="\.\/hud-tokens\.css"/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(`${index}${overlay}${css}`, /https?:\/\/(?:fonts|cdn)\./iu);
});
