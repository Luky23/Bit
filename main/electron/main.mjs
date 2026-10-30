import pkg from "electron";
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session } = pkg;
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapturePolicy, canCapture, resizeDimensions } from "../src/screen/capture-policy.mjs";
import { createVisionMessage, imageDataUrlToBase64 } from "../src/screen/vision-request.mjs";
import { captureScreenBase64, analyzeScreenWithVision, captureAndAnalyze } from "../src/screen/vision-tools.mjs";
import { validateExecutionTarget, executeWithConfirmation } from "../src/screen/exec-tools.mjs";
import { validateToolInput } from "../src/core/validation.mjs";
import { runAgentTurn, AGENT_TOOLS } from "../src/core/agent.mjs";
import { configGet, configSet, configPickSong, configRemoveSong, bootGetSong, getStartupConfig } from "../src/core/config.mjs";
import { auditVaultCompatibility } from "../src/obsidian/compatibility.mjs";
import { ObsidianVault } from "../src/obsidian/vault.mjs";
import { SpeechQueue, InterruptionManager } from "../src/voice/speech.mjs";
import { encodeVoiceMessage, parseVoiceLine, JsonlFramer } from "../src/voice/protocol.mjs";
import { downloadSecureAsset, ensurePiperModel, PIPER_MODELS } from "../src/core/downloader.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const previewData = join(app.getPath("appData"), "Bit Preview");
app.setPath("userData", previewData);
app.setAppUserModelId("com.bit.assistant.preview");
app.commandLine.appendSwitch("disable-spell-checking");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-disk-cache");
app.commandLine.appendSwitch("disable-application-cache");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let overlayWindow;
let voiceProcess;
let voiceReady = false;
let voiceWaiters = [];
let voiceFramer = null;
let speechQueue = null;
let interruptionManager = null;

function voicePaths() {
  const localAppData = process.env.LOCALAPPDATA ?? join(app.getPath("home"), "AppData", "Local");
  const voiceDir = join(localAppData, "Bit", "voices");
  return {
    model: join(voiceDir, "es_ES-davefx-medium.onnx"),
    config: join(voiceDir, "es_ES-davefx-medium.onnx.json"),
    python: join(app.getAppPath(), "main", "voice-sidecar", ".venv", "Scripts", "python.exe"),
    sidecar: join(app.getAppPath(), "main", "voice-sidecar", "sidecar.py")
  };
}

function sendToSidecar(message) {
  if (voiceProcess && !voiceProcess.killed && voiceProcess.stdin) {
    try {
      voiceProcess.stdin.write(message);
    } catch {
      // Sidecar muerto, se reconectará en próximo pedido
    }
  }
}

function ensureVoiceProcess() {
  if (voiceProcess && !voiceProcess.killed) return;
  const paths = voicePaths();
  voiceProcess = spawn(paths.python, [paths.sidecar, "--model", paths.model, "--config", paths.config], { shell: false, windowsHide: true });
  voiceFramer = new JsonlFramer();
  voiceProcess.stdout.on("data", (chunk) => {
    try {
      const messages = voiceFramer.push(chunk.toString("utf8"));
      for (const message of messages) {
        handleVoiceMessage(message);
      }
    } catch {
      // Mensaje inválido, ignorar
    }
  });
  voiceProcess.stderr.on("data", (chunk) => {
    console.error("[voice-sidecar]", chunk.toString("utf8"));
  });
  voiceProcess.on("error", (error) => {
    voiceReady = false;
    for (const waiter of voiceWaiters.splice(0)) waiter.reject(error);
  });
  voiceProcess.on("exit", () => {
    voiceReady = false;
    for (const waiter of voiceWaiters.splice(0)) waiter.reject(new Error("El sidecar de Piper se cerró"));
    voiceProcess = undefined;
    voiceFramer = null;
  });
}

function handleVoiceMessage(message) {
  switch (message.type) {
    case "ready":
      voiceReady = true;
      for (const waiter of voiceWaiters.splice(0)) waiter.resolve();
      // Notificar a la cola de voz que el sidecar está listo para la siguiente oración
      speechQueue?.notifyReady();
      break;
    case "audio":
      // Enviar audio SOLO a la ventana principal si existe
      mainWindow?.webContents.send("bit:voice-audio", message);
      break;
    case "error":
      voiceReady = false;
      for (const waiter of voiceWaiters.splice(0)) waiter.reject(new Error(message.error));
      break;
    case "level":
    case "vad-trigger":
    case "transcript":
      // Reenviar al InterruptionManager
      interruptionManager?.handleVadResponse(message);
      // Reenviar a la ventana overlay para HUD/visualizador
      overlayWindow?.webContents.send("bit:voice-level", message);
      break;
  }
}

function waitVoiceReady() {
  if (voiceReady) return Promise.resolve();
  ensureVoiceProcess();
  return new Promise((resolve, reject) => voiceWaiters.push({ resolve, reject }));
}

ipcMain.handle("bit:runtime", () => {
  const validation = validateToolInput("bit:runtime", {});
  if (!validation.ok) throw new Error(validation.error);
  return ({ channel: "preview", privacy: "Solo localhost / 127.0.0.1", models: { fast: "qwen2.5:3b", heavy: "qwen2.5-coder:7b" }, voice: "es_ES-davefx-medium", voicePaths: voicePaths() });
});

ipcMain.handle("bit:chat", async (_event, request = {}) => {
  const validation = validateToolInput("bit:chat", request);
  if (!validation.ok) throw new Error(validation.error);
  const message = typeof request.message === "string" ? request.message.trim().slice(0, 8000) : "";
  if (!message) throw new Error("Escribí un mensaje");

  const config = await getStartupConfig();
  const model = typeof request.model === "string" && request.model.length < 128 ? request.model : config.model || "qwen2.5:3b";

  // Cliente de chat que envuelve Ollama /api/chat
  const chatClient = {
    async generate(modelName, req) {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelName, stream: false, ...req }),
      });
      if (!response.ok) throw new Error(`Ollama respondió ${response.status}`);
      return response.json();
    },
  };

  // OllamaClient para verificar capacidades de tools
  const ollamaClient = new OllamaClient();

  // Executor de herramientas: mapea nombres con punto a IPC handlers
  const executeTool = async (toolName, toolArgs) => {
    switch (toolName) {
      case "system.captureScreen": {
        const result = await captureAndAnalyze({
          prompt: toolArgs.prompt,
          visionModel: toolArgs.visionModel || config.visionModel || "llava",
          maxSide: toolArgs.maxSide || 1280,
        });
        return result;
      }
      case "system.openApp": {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return { ok: false, error: "Ventana principal no disponible para confirmación" };
        }
        return executeWithConfirmation({
          target: toolArgs.target,
          args: toolArgs.args || "",
          mainWindow,
        });
      }
      case "system.captureWebcam": {
        return { ok: false, error: "Captura de cámara web no implementada en este turno" };
      }
      case "obsidian.search": {
        const indexerPath = join(here, "..", "src", "obsidian", "indexer.mjs");
        const { ObsidianIndexer } = await import(indexerPath);
        const indexer = new ObsidianIndexer(config.vaultPath || "");
        await indexer.buildIndex();
        const lowerQuery = toolArgs.query.toLowerCase();
        const results = [];
        for (const [title, path] of indexer.titleIndex) {
          if (title.includes(lowerQuery)) results.push({ type: "title", title, path, score: 1 });
        }
        return results.slice(0, toolArgs.limit || 10);
      }
      case "obsidian.read": {
        const { readFile } = await import("node:fs/promises");
        const { resolve, join: pathJoin } = await import("node:path");
        const root = resolve(config.vaultPath || "");
        const fullPath = pathJoin(root, toolArgs.notePath);
        if (!fullPath.startsWith(root + "\\") && !fullPath.startsWith(root + "/")) {
          throw new Error("Ruta fuera de la bóveda");
        }
        const content = await readFile(fullPath, "utf-8");
        return { path: toolArgs.notePath, content };
      }
      case "obsidian.saveMemory": {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return { ok: false, error: "Ventana principal no disponible para confirmación" };
        }
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question",
          title: "Guardar en Obsidian",
          message: `¿Guardar "${toolArgs.title}" en la bóveda de Obsidian?`,
          detail: "La nota se guardará en <Vault>/Bit/Conversaciones/ con frontmatter estructurado.",
          buttons: ["Cancelar", "Guardar"],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (result.response === 0) {
          return { ok: false, cancelled: true };
        }
        const vault = new ObsidianVault(config.vaultPath || "");
        return await vault.saveConversationContext(toolArgs.title, toolArgs.content);
      }
      default:
        throw new Error(`Herramienta desconocida: ${toolName}`);
    }
  };

  const result = await runAgentTurn({
    message,
    history: request.history || [],
    imageDataUrl: request.imageDataUrl || null,
    config: { ...config, model },
    deps: { chatClient, ollamaClient, executeTool, vaultConfig: { vaultPath: config.vaultPath || "" } },
  });

  return { model, text: result.text, toolCalls: result.toolCalls, rounds: result.rounds };
});

function overlayBounds(expanded = false) {
  const display = screen.getPrimaryDisplay();
  const width = expanded ? 410 : 92;
  const height = expanded ? 560 : 92;
  const margin = 22;
  return { width, height, x: display.workArea.x + display.workArea.width - width - margin, y: display.workArea.y + margin };
}

function setOverlayExpanded(expanded) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(overlayBounds(expanded), true);
  overlayWindow.setAlwaysOnTop(true, "floating");
  if (expanded) overlayWindow.focus();
}

ipcMain.handle("bit:overlay-set-expanded", (_event, expanded) => {
  const validation = validateToolInput("bit:overlay-set-expanded", { expanded });
  if (!validation.ok) throw new Error(validation.error);
  setOverlayExpanded(expanded === true);
  return { expanded: expanded === true };
});

ipcMain.handle("bit:open-main", () => {
  const validation = validateToolInput("bit:open-main", {});
  if (!validation.ok) throw new Error(validation.error);
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  return { ok: true };
});

ipcMain.handle("bit:screen-capture", async () => {
  const validation = validateToolInput("bit:screen-capture", {});
  if (!validation.ok) throw new Error(validation.error);
  const policy = createCapturePolicy({ consent: true, maxSide: 1280 });
  if (!canCapture(policy, "")) throw new Error("La captura requiere consentimiento explícito");
  const wasVisible = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible();
  if (wasVisible) overlayWindow.hide();
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const display = screen.getPrimaryDisplay();
    const dimensions = resizeDimensions(display.size.width, display.size.height, policy.maxSide);
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: dimensions });
    const source = sources[0];
    if (!source?.thumbnail || source.thumbnail.isEmpty()) throw new Error("Windows no devolvió una captura de pantalla");
    return { imageDataUrl: source.thumbnail.toDataURL(), width: dimensions.width, height: dimensions.height, source: "primary-screen" };
  } finally {
    if (wasVisible) overlayWindow.showInactive();
  }
});

ipcMain.handle("bit:speak", async (_event, text) => {
  const validation = validateToolInput("bit:speak", { text });
  if (!validation.ok) throw new Error(validation.error);
  const safeText = typeof text === "string" ? text.trim().slice(0, 4000) : "";
  if (!safeText) throw new Error("No hay texto para hablar");
  await waitVoiceReady();

  // Inicializar SpeechQueue e InterruptionManager si no existen
  if (!speechQueue) {
    speechQueue = new SpeechQueue((msg) => sendToSidecar(msg), { waitForReady: true });
    interruptionManager = new InterruptionManager(speechQueue, (msg) => sendToSidecar(msg));
    interruptionManager.setEnabled(false); // VAD activado por configuración
  }

  // Encolar texto para síntesis por oraciones
  speechQueue.enqueue(safeText);
  return { ok: true };
});

ipcMain.handle("bit:stop-speaking", () => {
  const validation = validateToolInput("bit:stop-speaking", {});
  if (!validation.ok) throw new Error(validation.error);
  // Cancelar cola de voz y enviar stop al sidecar
  speechQueue?.cancel();
  if (voiceProcess && !voiceProcess.killed) voiceProcess.stdin.write('{"type":"stop"}\n');
  return { ok: true };
});

ipcMain.handle("bit:obsidian-audit", async (_event, request = {}) => {
  const validation = validateToolInput("bit:obsidian-audit", request);
  if (!validation.ok) throw new Error(validation.error);
  return auditVaultCompatibility(request.vaultPath);
});

ipcMain.handle("bit:obsidian-save", async (_event, request = {}) => {
  const validation = validateToolInput("bit:obsidian-save", request);
  if (!validation.ok) throw new Error(validation.error);

  // Show native confirmation dialog BEFORE writing
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Guardar en Obsidian",
    message: `¿Guardar "${request.title}" en la bóveda de Obsidian?`,
    detail: `La nota se guardará en <Vault>/Bit/Conversaciones/ con frontmatter estructurado.`,
    buttons: ["Cancelar", "Guardar"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  });

  if (result.response === 0) {
    return { ok: false, cancelled: true };
  }

  try {
    const vault = new ObsidianVault(request.vaultPath);
    return await vault.saveConversationContext(request.title, request.content);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Download handlers
function showDownloadConfirmation(assetName, domain) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(false);
      return;
    }
    dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Descargar archivo",
      message: `¿Descargar "${assetName}" desde ${domain}?`,
      detail: "Bit descargará el archivo y verificará su integridad (SHA256). La conexión es HTTPS directa al servidor oficial.",
      buttons: ["Cancelar", "Descargar"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    }).then((result) => resolve(result.response === 1));
  });
}

ipcMain.handle("bit:download-asset", async (_event, request = {}) => {
  const validation = validateToolInput("bit:download-asset", request);
  if (!validation.ok) throw new Error(validation.error);

  return downloadSecureAsset(
    request.url,
    request.destPath,
    request.expectedHash,
    request.assetName,
    showDownloadConfirmation
  );
});

ipcMain.handle("bit:ensure-piper-model", async (_event, request = {}) => {
  const validation = validateToolInput("bit:ensure-piper-model", request);
  if (!validation.ok) throw new Error(validation.error);

  return ensurePiperModel(request.modelName, request.voicesDir, showDownloadConfirmation);
});

// ===== CONFIG IPC HANDLERS =====

ipcMain.handle("config:get", async (_event, key) => {
  return configGet(key);
});

ipcMain.handle("config:set", async (_event, key, value) => {
  return configSet(key, value);
});

ipcMain.handle("config:pickSong", async (_event) => {
  return configPickSong(dialog.showOpenDialog.bind(dialog));
});

ipcMain.handle("config:removeSong", async (_event) => {
  return configRemoveSong();
});

ipcMain.handle("boot:getSong", async (_event) => {
  const result = await bootGetSong();
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, bytes: result.bytes, songName: result.songName };
});

// ===== WEBCAM IPC HANDLERS =====

ipcMain.handle("bit:system-capture-webcam", async (_event, request = {}) => {
  const validation = validateToolInput("bit:system-capture-webcam", request);
  if (!validation.ok) throw new Error(validation.error);

  const config = await getStartupConfig();
  if (!config.webcamEnabled) {
    return { ok: false, error: "La cámara está desactivada en Ajustes" };
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Ventana principal no disponible para captura de cámara" };
  }

  const captureId = "webcam-" + Date.now();
  const timeoutMs = 10000;

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Timeout de captura de cámara (10 s)")), timeoutMs);
  });

  const capturePromise = new Promise((resolve, reject) => {
    const handler = (_event, { id, dataUrl }) => {
      if (id !== captureId) return;
      try {
        if (!dataUrl) {
          reject(new Error("No se recibió imagen de la cámara"));
          return;
        }
        // Validar data URL
        const base64 = imageDataUrlToBase64(dataUrl);
        if (!base64) {
          reject(new Error("La imagen de la cámara no es válida"));
          return;
        }
        // Analizar con modelo de visión
        const visionModel = config.visionModel || "llava";
        const maxSide = 1280;
        resolve(captureAndAnalyze({ prompt: request.prompt, visionModel, maxSide }));
      } catch (error) {
        reject(error);
      }
    };
    ipcMain.once(`webcam:capture-result:${captureId}`, handler);
    setTimeout(() => {
      ipcMain.removeListener(`webcam:capture-result:${captureId}`, handler);
    }, timeoutMs);
  });

  // Pedir captura al renderer
  mainWindow.webContents.send("webcam:capture-request", { id: captureId, prompt: request.prompt });

  return Promise.race([capturePromise, timeoutPromise]);
});

// HUD click → open main window, hide overlay
ipcMain.on("hud-clicked", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
});

// ===== COMPUTER USE TOOLS =====

// Screen capture + vision analysis
ipcMain.handle("bit:system-capture-screen", async (_event, request = {}) => {
  const validation = validateToolInput("bit:system-capture-screen", request);
  if (!validation.ok) throw new Error(validation.error);

  try {
    const result = await captureAndAnalyze({
      prompt: request.prompt,
      visionModel: request.visionModel || "llava",
      maxSide: request.maxSide || 1280,
    });
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// App execution with confirmation
ipcMain.handle("bit:system-open-app", async (_event, request = {}) => {
  const validation = validateToolInput("bit:system-open-app", request);
  if (!validation.ok) throw new Error(validation.error);

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Ventana principal no disponible para confirmación" };
  }

  return executeWithConfirmation({
    target: request.target,
    args: request.args || "",
    mainWindow,
  });
});

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" || parsed.protocol === "data:" || ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch { return false; }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: "#07131b",
    webPreferences: {
      preload: join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(join(here, "index.html"));

  // Overlay visibility: hide when main window has focus, show when it loses focus
  mainWindow.on("focus", () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); });
  mainWindow.on("show", () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); });
  mainWindow.on("blur", () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive(); });
  mainWindow.on("hide", () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive(); });
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    ...overlayBounds(false),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlayWindow.loadFile(join(here, "overlay.html"));
  overlayWindow.once("ready-to-show", () => overlayWindow.showInactive());
  overlayWindow.on("closed", () => { overlayWindow = undefined; });
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => callback({ cancel: !isAllowedUrl(details.url) }));

  // Permisos de cámara web: solo "media" (video) para index.html propia y solo si webcamEnabled
  const config = await getStartupConfig();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    const url = webContents.getURL();
    try {
      const parsed = new URL(url);
      const isOwnPage = parsed.origin === "file://" || parsed.origin.indexOf("localhost") !== -1 || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (!isOwnPage) {
        callback(false);
        return;
      }
      callback(config.webcamEnabled === true);
    } catch {
      callback(false);
    }
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission !== "media") return false;
    return config.webcamEnabled === true;
  });

  createMainWindow();
  createOverlayWindow();
  app.on("activate", () => { if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(); if (!overlayWindow || !overlayWindow.isDestroyed()) createOverlayWindow(); });
});

app.on("window-all-closed", () => { if (voiceProcess && !voiceProcess.killed) voiceProcess.kill(); if (process.platform !== "darwin") app.quit(); });
