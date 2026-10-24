import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapturePolicy, canCapture, resizeDimensions } from "../src/screen/capture-policy.mjs";
import { createVisionMessage } from "../src/screen/vision-request.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const previewData = join(app.getPath("appData"), "Bit Preview");
app.setPath("userData", previewData);
app.setAppUserModelId("com.bit.assistant.preview");
app.commandLine.appendSwitch("disable-spell-checking");

let mainWindow;
let overlayWindow;
let voiceProcess;
let voiceReady = false;
let voiceWaiters = [];

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

function ensureVoiceProcess() {
  if (voiceProcess && !voiceProcess.killed) return;
  const paths = voicePaths();
  voiceProcess = spawn(paths.python, [paths.sidecar, "--model", paths.model, "--config", paths.config], { shell: false, windowsHide: true });
  const reader = createInterface({ input: voiceProcess.stdout });
  reader.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "ready") { voiceReady = true; for (const waiter of voiceWaiters.splice(0)) waiter.resolve(); }
      if (message.type === "audio") mainWindow?.webContents.send("bit:voice-audio", message);
      if (message.type === "error") { voiceReady = false; for (const waiter of voiceWaiters.splice(0)) waiter.reject(new Error(message.error)); }
    } catch { /* un mensaje inválido del sidecar no rompe Bit */ }
  });
  voiceProcess.on("error", (error) => { voiceReady = false; for (const waiter of voiceWaiters.splice(0)) waiter.reject(error); });
  voiceProcess.on("exit", () => {
    voiceReady = false;
    for (const waiter of voiceWaiters.splice(0)) waiter.reject(new Error("El sidecar de Piper se cerró"));
    voiceProcess = undefined;
    reader.close();
  });
}

function waitVoiceReady() {
  if (voiceReady) return Promise.resolve();
  ensureVoiceProcess();
  return new Promise((resolve, reject) => voiceWaiters.push({ resolve, reject }));
}

ipcMain.handle("bit:runtime", () => ({ channel: "preview", privacy: "Solo localhost / 127.0.0.1", models: { fast: "qwen2.5:3b", heavy: "qwen2.5-coder:7b" }, voice: "es_ES-davefx-medium", voicePaths: voicePaths() }));

ipcMain.handle("bit:chat", async (_event, request = {}) => {
  const model = typeof request.model === "string" && request.model.length < 128 ? request.model : "qwen2.5:3b";
  const message = typeof request.message === "string" ? request.message.trim().slice(0, 8000) : "";
  if (!message) throw new Error("Escribí un mensaje");
  const userMessage = request.imageDataUrl ? createVisionMessage(message, request.imageDataUrl) : { role: "user", content: message };
  const response = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, messages: [userMessage], options: { temperature: 0.3 } }) });
  if (!response.ok) throw new Error(`Ollama respondió ${response.status}`);
  const body = await response.json();
  return { model, text: String(body.message?.content ?? "") };
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
  setOverlayExpanded(expanded === true);
  return { expanded: expanded === true };
});

ipcMain.handle("bit:open-main", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  return { ok: true };
});

ipcMain.handle("bit:screen-capture", async () => {
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
  const safeText = typeof text === "string" ? text.trim().slice(0, 4000) : "";
  if (!safeText) throw new Error("No hay texto para hablar");
  await waitVoiceReady();
  voiceProcess.stdin.write(`${JSON.stringify({ type: "speak", text: safeText })}\n`);
  return { ok: true };
});

ipcMain.handle("bit:stop-speaking", () => { if (voiceProcess && !voiceProcess.killed) voiceProcess.stdin.write('{"type":"stop"}\n'); return { ok: true }; });

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

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => callback({ cancel: !isAllowedUrl(details.url) }));
  createMainWindow();
  createOverlayWindow();
  app.on("activate", () => { if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(); if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow(); });
});

app.on("window-all-closed", () => { if (voiceProcess && !voiceProcess.killed) voiceProcess.kill(); if (process.platform !== "darwin") app.quit(); });
