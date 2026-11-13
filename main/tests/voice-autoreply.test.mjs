import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Piper queda activado por defecto y se configura en tiempo real", async () => {
  const [ui, config] = await Promise.all([
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/core/config.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(config, /speechEnabled:\s*true/u);
  assert.match(ui, /'speechEnabled'/u);
  assert.match(ui, /window\.bitRuntime\.setConfig\(input\.id,value\)/u);
});

test("main encola una sola respuesta y ambos nÃºcleos reciben audio y RMS", async () => {
  const [main, ui, overlay] = await Promise.all([
    readFile(new URL("../electron/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/overlay.html", import.meta.url), "utf8"),
  ]);
  assert.match(main, /void enqueueSpeech\(answerText\)/u);
  assert.match(main, /for \(const window of \[mainWindow, overlayWindow\]\)/u);
  assert.match(ui, /onVoiceLevel/u);
  assert.match(ui, /onVoiceAudio/u);
  assert.match(overlay, /onVoiceLevel/u);
  assert.match(overlay, /onVoiceAudio/u);
});

test("el dictado se inicia al mantener y deja la transcripciÃ³n editable", async () => {
  const [ui, main] = await Promise.all([
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /id="voiceCapture"[^>]*aria-label="Mantener para dictar"/u);
  assert.match(ui, /addEventListener\('pointerdown'/u);
  assert.match(ui, /addEventListener\('pointerup'/u);
  assert.match(ui, /onVoiceTranscript/u);
  assert.match(main, /ipcMain\.handle\("bit:voice-capture-start"/u);
  assert.match(main, /ipcMain\.handle\("bit:voice-capture-stop"/u);
});
