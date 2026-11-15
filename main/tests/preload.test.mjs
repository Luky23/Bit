import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { createStartupGreeting } from "../electron/boot.js";
import { createFile } from "../src/core/file-tools.mjs";

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
  await exposedBridge.openWorkspace();
  await exposedBridge.closeWorkspace();
  await exposedBridge.showHome();
  await exposedBridge.projectSnapshot({ project: "Mark II" });
  await exposedBridge.setActiveProject("Mark II");
  await exposedBridge.readProjectFile({ project: "Mark II", path: "readme.md" });
  assert.deepEqual(invocations.slice(2), [
    ["bit:voice-capture-start"],
    ["bit:voice-capture-stop"],
    ["config:pickWhisperModel"],
    ["config:pickSong"],
    ["config:removeSong"],
    ["boot:getSong"],
    ["boot:getDailySummary", "qwen2.5-coder:7b"],
    ["bit:speak-and-wait", "Buen día."],
    ["bit:open-workspace"],
    ["bit:close-workspace"],
    ["bit:show-home"],
    ["bit:project-panel", { project: "Mark II" }],
    ["bit:project-panel-select-project", "Mark II"],
    ["bit:project-panel-read-file", { project: "Mark II", path: "readme.md" }],
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

  let projectSelection = "";
  const unsubscribeProject = exposedBridge.onProjectSelection(project => { projectSelection = project; });
  listeners.get("bit:project-selection")({}, "Mark II");
  assert.equal(projectSelection, "Mark II");
  unsubscribeProject();
  assert.equal(listeners.has("bit:project-selection"), false);

  let projectFile = null;
  const unsubscribeProjectFile = exposedBridge.onProjectFileOpen(request => { projectFile = request; });
  listeners.get("bit:project-file-open")({}, { project: "Mark II", path: "docs/readme.md" });
  assert.deepEqual(projectFile, { project: "Mark II", path: "docs/readme.md" });
  unsubscribeProjectFile();
  assert.equal(listeners.has("bit:project-file-open"), false);
});

test("las ventanas de Bit cargan puentes CommonJS con privilegio mínimo", async () => {
  const [source, indicatorPreload] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(new URL("../electron/automation-indicator-preload.cjs", import.meta.url), "utf8"),
  ]);
  const preloadPaths = source.match(/preload:\s*join\(here,\s*"preload\.cjs"\)/g) ?? [];

  assert.equal(preloadPaths.length, 2);
  assert.match(source, /preload:\s*join\(here,\s*"automation-indicator-preload\.cjs"\)/);
  assert.match(indicatorPreload, /onCursor/);
  assert.doesNotMatch(indicatorPreload, /ipcRenderer\.invoke/);
  assert.doesNotMatch(source, /preload:\s*join\(here,\s*"preload\.mjs"\)/);
});

test("los modelos GGUF se descubren sin solicitar carpetas manuales", async () => {
  const [mainSource, preloadSource, html] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(preloadUrl, "utf8"),
    readFile(mainUiUrl, "utf8"),
  ]);

  assert.doesNotMatch(mainSource, /config:pickModelDirectory/);
  assert.doesNotMatch(preloadSource, /pickModelDirectory/);
  assert.doesNotMatch(html, /cfgModelAddFolder|AGREGAR CARPETA/);
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
  assert.doesNotMatch(html, /void import\('\.\/boot\.js'\)\.then\(\(\{runBootSequence\}\)/);
  assert.equal((html.match(/runBootSequence\(\{model:/gu) ?? []).length, 1);
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
  assert.doesNotMatch(source, /await speakBootText\(result\.summary\)/);
  assert.match(source, /El resumen queda visible en la interfaz, pero no se lee/);
  assert.doesNotMatch(source, /GREETING_DELAY_MS/);
  assert.match(source, /const summaryPromise = window\.bitRuntime\.getDailySummary\(model\)/);
  assert.match(source, /if \(voiceInProgress\) duckSong\(voiceDuckLevel\)/);
  assert.ok(source.indexOf("const summaryPromise = window.bitRuntime.getDailySummary(model)") < source.lastIndexOf("await songStarted"));
  assert.match(source, /duckSong\(0,\s*FADE_OUT_MS\)/);
});

test("main precarga Piper en paralelo con la carga de la ventana", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /if \(config\.speechEnabled === true\) void ensureVoiceProcess\(\)\.catch\([\s\S]*?session\.defaultSession\.setPermissionRequestHandler/);
});

test("main usa el cliente Llama nativo con Ollama y GGUF", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /import\s+\{\s*LocalLlamaClient\s*\}\s+from\s+"\.\.\/src\/models\/llama-client\.mjs"/);
  assert.match(source, /new LocalLlamaClient\(/);
  assert.match(source, /new ModelService/);
});

test("el resumen de inicio usa notas recientes locales y audita la lectura", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /ipcMain\.handle\("boot:getDailySummary"/);
  assert.match(source, /event\.sender !== mainWindow\.webContents/);
  assert.match(source, /collectRecentVaultNotes\(config\.vaultPath\)/);
  assert.match(source, /action: "boot\.daily-summary"/);
  assert.match(source, /modelService\.generate\(localModel,/);
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
});

test("al cerrar Bit libera el motor Llama nativo", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /mainWindow\.on\("close",\s*\(event\)\s*=>\s*\{\s*if \(shutdownComplete\) return;\s*event\.preventDefault\(\);\s*app\.quit\(\);\s*\}\)/);
  assert.match(source, /app\.on\("before-quit",\s*\(event\)\s*=>/);
  assert.match(source, /await llamaClient\.dispose\(\)/);
  assert.match(source, /app\.quit\(\)/);
});

test("main conserva solo el contexto de clima para preguntas de ubicación de seguimiento", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /let previousWeatherQuestion = ""/);
  assert.match(source, /if \(weatherFollowUp && previousWeatherQuestion\)\s*\{\s*history\.push\(\{ role: "user", content: previousWeatherQuestion \}\)/);
  assert.match(source, /if \(isWeatherSearchRequest\(message\)\) previousWeatherQuestion = message;\s*else if \(!weatherFollowUp\) previousWeatherQuestion = ""/);
});

test("todo canal invocado desde el preload tiene su handler en main", async () => {
  const mainSource = await readFile(mainUrl, "utf8");
  const preloadSource = await readFile(preloadUrl, "utf8");

  const handled = new Set([...mainSource.matchAll(/ipcMain\.handle\((["'])([^"']+)\1/gu)].map((match) => match[2]));
  const invoked = [...new Set([...preloadSource.matchAll(/ipcRenderer\.invoke\("([^"]+)"/gu)].map((match) => match[1]))];

  const missing = invoked.filter((channel) => !handled.has(channel));
  assert.deepEqual(missing, [], `Canales invocados sin handler en main: ${missing.join(", ")}`);
  assert.ok(invoked.includes("bit:system-open-file"), "falta el puente para abrir archivos generados");
  assert.ok(invoked.includes("bit:system-open-app"));
});

test("todo evento bit:* suscrito en el preload tiene emisor en main", async () => {
  const [mainSource, displayManagerSource] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(new URL("../electron/display-manager.mjs", import.meta.url), "utf8"),
  ]);
  const preloadSource = await readFile(preloadUrl, "utf8");

  const sent = new Set([...`${mainSource}\n${displayManagerSource}`.matchAll(/\.send\((["'])([^"']+)\1/gu)].map((match) => match[2]));
  const subscribed = [...new Set([...preloadSource.matchAll(/ipcRenderer\.on\("([^"]+)"/gu)].map((match) => match[1]))]
    .filter((channel) => channel.startsWith("bit:"));

  const orphans = subscribed.filter((channel) => !sent.has(channel));
  assert.deepEqual(orphans, [], `Eventos suscritos sin emisor en main: ${orphans.join(", ")}`);
  assert.ok(sent.has("bit:file-created"), "main no emite el aviso de archivo generado");
  assert.ok(subscribed.includes("bit:file-created"), "el preload no expone el aviso de archivo generado");
});

test("las herramientas de archivo están registradas en el agente y en validación", async () => {
  const { AGENT_TOOLS } = await import("../src/core/agent.mjs");
  const { toolSchemaName, validateToolInput, getSchema } = await import("../src/core/validation.mjs");

  for (const name of ["system.createFile", "system.modifyFile", "system.modifyCodebase", "system.readFile", "system.searchFiles"]) {
    const tool = AGENT_TOOLS.find((entry) => entry.name === name);
    assert.ok(tool, `falta la herramienta ${name}`);
    const schemaName = toolSchemaName(name);
    assert.ok(getSchema(schemaName), `falta el esquema ${schemaName}`);
  }

  const created = AGENT_TOOLS.find((entry) => entry.name === "system.createFile");
  assert.equal(created.modifiesState, true);
  assert.equal(created.workspaceWrite, true);
  assert.equal(validateToolInput("bit:system-create-file", { path: "a.js", content: "x" }).ok, true);
  assert.equal(validateToolInput("bit:system-create-file", { path: "a.js" }).ok, false);
  assert.equal(validateToolInput("bit:system-create-file", { path: "", content: "x" }).ok, false);
  assert.equal(validateToolInput("bit:system-read-file", {}).ok, false);
  assert.equal(validateToolInput("bit:system-search-files", { query: "informe", extension: "pdf", subDir: "documentos" }).ok, true);
  assert.equal(validateToolInput("bit:system-search-files", { query: "" }).ok, false);
  assert.equal(validateToolInput("bit:system-modify-codebase", { path: "main/src/core/agent.mjs", content: "export {};", restart: true }).ok, true);
  assert.equal(validateToolInput("bit:system-modify-codebase", { path: "main/src/core/agent.mjs" }).ok, false);
  // La restricción de extensiones no vive en el esquema: la aplica file-tools
  // contra el sandbox (cubierto en file-tools.test.mjs).
  const root = await mkdtemp(join(tmpdir(), "bit-preload-check-"));
  try {
    await assert.rejects(() => createFile({ root, path: "peligroso.exe", content: "x" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
