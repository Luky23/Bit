import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainUiUrl = new URL("../electron/index.html", import.meta.url);
const overlayUrl = new URL("../electron/overlay.html", import.meta.url);

test("las respuestas habladas quedan activadas por defecto y se pueden desactivar", async () => {
  const source = await readFile(mainUiUrl, "utf8");
  const configSource = await readFile(new URL("../src/core/config.mjs", import.meta.url), "utf8");

  assert.match(configSource, /speechEnabled:\s*true/);
  assert.match(configSource, /key === "speechEnabled"/);
  assert.match(source, /setConfig\('speechEnabled',voiceEnabled\)/);
  assert.match(source, /if\(!voiceEnabled\|\|!text\.trim\(\)\)return/);
});

test("ambas interfaces envían a Piper las respuestas del chat", async () => {
  const mainUi = await readFile(mainUiUrl, "utf8");
  const overlay = await readFile(overlayUrl, "utf8");

  assert.match(mainUi, /speakResponse\(answer\)/);
  assert.match(mainUi, /window\.bitRuntime\.speak\(text\.slice\(0,4000\)\)/);
  assert.match(overlay, /getConfig\('speechEnabled'\)/);
  assert.match(overlay, /window\.bitRuntime\.speak\(answer\.slice\(0, 4000\)\)/);
});

test("Piper se inicia durante la generación para reducir la demora antes de hablar", async () => {
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
  const chatHandler = main.slice(main.indexOf('ipcMain.handle("bit:chat"'));
  const warmupIndex = chatHandler.indexOf('if (config.speechEnabled === true) ensureVoiceProcess()');
  const generationIndex = chatHandler.indexOf("await runAgentTurn({");

  assert.notEqual(warmupIndex, -1);
  assert.ok(generationIndex > warmupIndex);
});

test("la locución añade determinísticamente el nombre guardado en Ajustes", async () => {
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");

  assert.match(main, /const nameSetting = await configGet\("userName"\)/);
  assert.match(main, /speechQueue\.enqueue\(safeText, preferredName\)/);
  assert.match(main, /mainWindow\?\.webContents\.send\("bit:voice-clear"\)/);
  assert.match(main, /if \(discardSpeechAudioUntilReady\) break/);
});

test("el dictado solo se inicia al mantener el botón y la transcripción queda editable", async () => {
  const mainUi = await readFile(mainUiUrl, "utf8");
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");

  assert.match(mainUi, /id="voice-capture"[^>]*aria-label="Mantener para hablar"/);
  assert.match(mainUi, /addEventListener\('pointerdown'[\s\S]*addEventListener\('pointerup'/);
  assert.match(mainUi, /onVoiceTranscript\(text=>[\s\S]*Transcripción local lista para revisar y enviar/);
  assert.match(mainUi, /addEventListener\('keyup'[\s\S]*stopVoiceCapture/);
  assert.match(main, /ipcMain\.handle\("bit:voice-capture-start", async \(event\) =>/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /ipcMain\.handle\("bit:voice-capture-stop", \(event\) =>/);
  assert.doesNotMatch(mainUi, /SpeechRecognition|webkitSpeechRecognition/);
});

test("el selector de STT en Ajustes usa un diálogo local y no requiere descargas", async () => {
  const mainUi = await readFile(mainUiUrl, "utf8");
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");

  assert.match(mainUi, /id="stt-model-pick"/);
  assert.match(mainUi, /pickWhisperModel\(\)/);
  assert.match(main, /configPickWhisperModel\(dialog\.showOpenDialog\.bind\(dialog\)\)/);
});
