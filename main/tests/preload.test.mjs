import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createStartupGreeting } from "../electron/boot.js";

const preloadUrl = new URL("../electron/preload.cjs", import.meta.url);
const mainUrl = new URL("../electron/main.mjs", import.meta.url);
const mainUiUrl = new URL("../electron/index.html", import.meta.url);

test("el preload CommonJS expone el puente de chat por IPC", async () => {
  const source = await readFile(preloadUrl, "utf8");
  const invocations = [];
  const listeners = new Map();
  let exposedName;
  let exposedBridge;
  const contextBridge = {
    exposeInMainWorld(name, bridge) {
      exposedName = name;
      exposedBridge = bridge;
    },
  };
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args);
      return { text: "Respuesta local" };
    },
    on(channel, handler) {
      listeners.set(channel, handler);
    },
    removeListener(channel, handler) {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
    send() {},
  };

  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, "electron");
      return { contextBridge, ipcRenderer };
    },
  });

  assert.equal(exposedName, "bitRuntime");
  assert.equal(typeof exposedBridge.chat, "function");
  assert.deepEqual(await exposedBridge.chat({ message: "Hola" }), { text: "Respuesta local" });
  assert.deepEqual(invocations, [["bit:chat", { message: "Hola" }]]);
  await exposedBridge.initializeVault();
  assert.deepEqual(invocations[1], ["config:initializeVault"]);
  assert.match(source, /initializeVault:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("config:initializeVault"\)/);
  await exposedBridge.startVoiceCapture();
  await exposedBridge.stopVoiceCapture();
  await exposedBridge.pickWhisperModel();
  await exposedBridge.pickStartupSong();
  await exposedBridge.removeStartupSong();
  await exposedBridge.getStartupSong();
  await exposedBridge.getDailySummary("qwen2.5-coder:7b");
  await exposedBridge.speakAndWait("Buen día.");
  assert.deepEqual(invocations.slice(2), [
    ["bit:voice-capture-start"],
    ["bit:voice-capture-stop"],
    ["config:pickWhisperModel"],
    ["config:pickSong"],
    ["config:removeSong"],
    ["boot:getSong"],
    ["boot:getDailySummary", "qwen2.5-coder:7b"],
    ["bit:speak-and-wait", "Buen día."],
  ]);
  let transcript = "";
  const unsubscribeTranscript = exposedBridge.onVoiceTranscript((text) => { transcript = text; });
  listeners.get("bit:voice-transcript")({}, "hola Bit");
  assert.equal(transcript, "hola Bit");
  unsubscribeTranscript();

  let cleared = false;
  const unsubscribe = exposedBridge.onVoiceClear(() => { cleared = true; });
  listeners.get("bit:voice-clear")();
  assert.equal(cleared, true);
  unsubscribe();
  assert.equal(listeners.has("bit:voice-clear"), false);
});

test("las dos ventanas cargan el preload CommonJS", async () => {
  const source = await readFile(mainUrl, "utf8");
  const preloadPaths = source.match(/preload:\s*join\(here,\s*"preload\.cjs"\)/g) ?? [];

  assert.equal(preloadPaths.length, 2);
  assert.doesNotMatch(source, /preload:\s*join\(here,\s*"preload\.mjs"\)/);
});

test("la interfaz de bóveda ofrece generar el grafo tras elegirla", async () => {
  const html = await readFile(mainUiUrl, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

  assert.ok(scripts.length > 0);
  for (const [, script] of scripts) assert.doesNotThrow(() => new vm.Script(script));
  assert.match(html, /id="vault-prepare"[^>]*disabled>GENERAR GRAFO/);
  assert.match(html, /vault-prepare'\)\.onclick=prepareVault/);
  assert.match(html, /initializeVault\(\)/);
  assert.match(html, /id="startup-song-pick"/);
  assert.match(html, /id="startup-song-preview"/);
  assert.match(html, /id="startup-enabled"/);
  assert.match(html, /getStartupSong\(\)/);
  assert.match(html, /boot\(\)\.then\(\(\)=>import\('\.\/boot\.js'\)\)/);
  assert.match(html, /void import\('\.\/boot\.js'\)\.then\(\(\{runBootSequence\}\)/);
  assert.ok(html.indexOf("void import('./boot.js')") < html.indexOf("boot().then(()=>import('./boot.js'))"));
});

test("el saludo de inicio varía y evita repetir el último texto", () => {
  const morning = new Date("2026-11-03T09:00:00-03:00");
  const first = createStartupGreeting("Luca", morning, () => 0);
  const next = createStartupGreeting("Luca", morning, () => 0, first);

  assert.notEqual(first, next);
  assert.match(first, /Buenos días, Luca/u);
  assert.match(next, /Luca/u);
  assert.notEqual(
    createStartupGreeting("Luca", new Date("2026-11-03T21:00:00-03:00"), () => 0),
    first
  );
});

test("el inicio respeta volumen, duración y errores de lectura de la canción", async () => {
  const source = await readFile(new URL("../electron/boot.js", import.meta.url), "utf8");

  assert.match(source, /playSongFromBytes\(\s*bootAudioContext,\s*config\.startupStartSec/);
  assert.match(source, /songGainNode\.gain\.setValueAtTime\(volume,/);
  assert.match(source, /songSourceNode\.loop = true/);
  assert.match(source, /songSourceNode\.loopEnd = offset \+ duration/);
  assert.match(source, /if \(ctx\.state !== "running"\) await ctx\.resume\(\)/);
  assert.match(source, /const bytes = Uint8Array\.from\(result\.bytes\)/);
  assert.match(source, /if \(!result\.ok\) throw new Error\(result\.error/);
  assert.match(source, /greetingPromise = speakBootText\(greeting\)/);
  assert.match(source, /await speakBootText\(result\.summary\)/);
  assert.doesNotMatch(source, /GREETING_DELAY_MS/);
  assert.match(source, /const summaryPromise = window\.bitRuntime\.getDailySummary\(model\)/);
  assert.match(source, /if \(voiceInProgress\) duckSong\(voiceDuckLevel\)/);
  assert.ok(source.indexOf("const summaryPromise = window.bitRuntime.getDailySummary(model)") < source.lastIndexOf("await songStarted"));
  assert.match(source, /duckSong\(0,\s*FADE_OUT_MS\)/);
});

test("main precarga Piper en paralelo con la carga de la ventana", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /if \(config\.speechEnabled === true\) ensureVoiceProcess\(\);\s*session\.defaultSession\.setPermissionRequestHandler/);
});

test("main importa OllamaClient antes de construir el cliente de capacidades", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /import\s+\{\s*OllamaClient\s*\}\s+from\s+"\.\.\/src\/models\/ollama-client\.mjs"/);
  assert.match(source, /new OllamaClient\(\)/);
});

test("el resumen de inicio usa notas recientes locales y audita la lectura", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /ipcMain\.handle\("boot:getDailySummary"/);
  assert.match(source, /event\.sender !== mainWindow\.webContents/);
  assert.match(source, /collectRecentVaultNotes\(config\.vaultPath\)/);
  assert.match(source, /action: "boot\.daily-summary"/);
  assert.match(source, /ollamaClient\.generate\(model,[\s\S]*?keep_alive: 0/);
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
});

test("al cerrar Bit se descargan de memoria los modelos con keep_alive persistente", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /mainWindow\.on\("close",\s*\(event\)\s*=>\s*\{\s*if \(shutdownComplete\) return;\s*event\.preventDefault\(\);\s*app\.quit\(\);\s*\}\)/);
  assert.match(source, /modelsToUnload\.add\(modelName\)/);
  assert.match(source, /app\.on\("before-quit",\s*\(event\)\s*=>/);
  assert.match(source, /const OLLAMA_UNLOAD_TIMEOUT_MS = 30_000/);
  assert.match(source, /ollamaClient\.unload\(model,\s*\{\s*signal:\s*AbortSignal\.timeout\(OLLAMA_UNLOAD_TIMEOUT_MS\)\s*\}\)/);
  assert.match(source, /app\.quit\(\)/);
});

test("main conserva solo el contexto de clima para preguntas de ubicación de seguimiento", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /let previousWeatherQuestion = ""/);
  assert.match(source, /if \(weatherFollowUp && previousWeatherQuestion\)\s*\{\s*history\.push\(\{ role: "user", content: previousWeatherQuestion \}\)/);
  assert.match(source, /if \(isWeatherSearchRequest\(message\)\) previousWeatherQuestion = message;\s*else if \(!weatherFollowUp\) previousWeatherQuestion = ""/);
});
