const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper local",
  getRuntime: () => ipcRenderer.invoke("bit:runtime"),
  listOllamaModels: () => ipcRenderer.invoke("bit:ollama-models"),
  chat: (request) => ipcRenderer.invoke("bit:chat", request),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  processDroppedFile: (request) => ipcRenderer.invoke("bit:process-dropped-file", request),
  onChatChunk: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:chat-chunk", handler);
    return () => ipcRenderer.removeListener("bit:chat-chunk", handler);
  },
  getConfig: (key) => ipcRenderer.invoke("config:get", key),
  setConfig: (key, value) => ipcRenderer.invoke("config:set", key, value),
  pickStartupSong: () => ipcRenderer.invoke("config:pickSong"),
  removeStartupSong: () => ipcRenderer.invoke("config:removeSong"),
  getStartupSong: () => ipcRenderer.invoke("boot:getSong"),
  getDailySummary: (model) => ipcRenderer.invoke("boot:getDailySummary", model),
  pickProjectsRoot: () => ipcRenderer.invoke("config:pickProjectsRoot"),
  pickVault: () => ipcRenderer.invoke("config:pickVault"),
  initializeVault: () => ipcRenderer.invoke("config:initializeVault"),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("bit:overlay-set-expanded", expanded === true),
  openMain: () => ipcRenderer.invoke("bit:open-main"),
  onFocusChatInput: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:focus-chat-input", handler);
    return () => ipcRenderer.removeListener("bit:focus-chat-input", handler);
  },
  captureScreen: () => ipcRenderer.invoke("bit:screen-capture"),
  speak: (text) => ipcRenderer.invoke("bit:speak", text),
  speakAndWait: (text) => ipcRenderer.invoke("bit:speak-and-wait", text),
  stopSpeaking: () => ipcRenderer.invoke("bit:stop-speaking"),
  startVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-start"),
  stopVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-stop"),
  pickWhisperModel: () => ipcRenderer.invoke("config:pickWhisperModel"),
  onVoiceTranscript: (listener) => {
    const handler = (_event, text) => listener(text);
    ipcRenderer.on("bit:voice-transcript", handler);
    return () => ipcRenderer.removeListener("bit:voice-transcript", handler);
  },
  onVoiceError: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on("bit:voice-error", handler);
    return () => ipcRenderer.removeListener("bit:voice-error", handler);
  },
  onVoiceAudio: (listener) => {
    const handler = (_event, chunk) => listener(chunk);
    ipcRenderer.on("bit:voice-audio", handler);
    return () => ipcRenderer.removeListener("bit:voice-audio", handler);
  },
  onVoiceClear: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:voice-clear", handler);
    return () => ipcRenderer.removeListener("bit:voice-clear", handler);
  },
  onVoiceLevel: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:voice-level", handler);
    return () => ipcRenderer.removeListener("bit:voice-level", handler);
  },
  onNetworkActivity: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:network-activity", handler);
    return () => ipcRenderer.removeListener("bit:network-activity", handler);
  },
  onOverlayDrawFrame: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:draw-frame", handler);
    return () => ipcRenderer.removeListener("bit:draw-frame", handler);
  },
  onEmergencyStop: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:emergency-stop", handler);
    return () => ipcRenderer.removeListener("bit:emergency-stop", handler);
  },
  auditObsidianVault: (vaultPath) => ipcRenderer.invoke("bit:obsidian-audit", { vaultPath }),
  saveToObsidian: (vaultPath, title, content) => ipcRenderer.invoke("bit:obsidian-save", { vaultPath, title, content }),
  downloadAsset: (url, destPath, expectedHash, assetName) => ipcRenderer.invoke("bit:download-asset", { url, destPath, expectedHash, assetName }),
  ensurePiperModel: (modelName, voicesDir) => ipcRenderer.invoke("bit:ensure-piper-model", { modelName, voicesDir }),
  captureAndAnalyzeScreen: (prompt, visionModel, maxSide) => ipcRenderer.invoke("bit:system-capture-screen", { prompt, visionModel, maxSide }),
  openApp: (target, args) => ipcRenderer.invoke("bit:system-open-app", { target, args }),
  onWebcamCaptureRequest: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("webcam:capture-request", handler);
    return () => ipcRenderer.removeListener("webcam:capture-request", handler);
  },
  sendWebcamCaptureResult: (id, dataUrl) => ipcRenderer.send(`webcam:capture-result:${id}`, { id, dataUrl }),
}));

// El receptor vive en el preload para aceptar archivos en toda la ventana,
// incluso si el HUD cambia o alguno de sus scripts falla antes de inicializarse.
if (typeof window !== "undefined" && typeof document !== "undefined") {
let dropOverlay;
let dropDialog;
let droppedFile;
let dropHost;

function acceptFileDrag(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function setDropOverlayVisible(visible) {
  if (dropOverlay) dropOverlay.style.display = visible ? "grid" : "none";
  if (dropHost) dropHost.dataset.dropState = visible ? "dragging" : "idle";
}

window.addEventListener("dragenter", (event) => {
  acceptFileDrag(event);
  setDropOverlayVisible(true);
}, true);
window.addEventListener("dragover", acceptFileDrag, true);
window.addEventListener("dragleave", (event) => {
  acceptFileDrag(event);
  if (!event.relatedTarget) setDropOverlayVisible(false);
}, true);
window.addEventListener("drop", (event) => {
  acceptFileDrag(event);
  setDropOverlayVisible(false);
  const file = event.dataTransfer?.files?.[0];
  if (dropHost) dropHost.dataset.dropFiles = String(event.dataTransfer?.files?.length ?? 0);
  if (!file || !dropDialog) return;
  let filePath;
  try { filePath = webUtils.getPathForFile(file); }
  catch (error) {
    if (dropHost) dropHost.dataset.dropError = String(error);
    return;
  }
  if (!filePath) {
    if (dropHost) dropHost.dataset.dropError = "No se recibió una ruta local";
    return;
  }
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop().toLowerCase()}` : "";
  droppedFile = { filePath, name: file.name, extension };
  dropDialog.querySelector("h2").textContent = `¿Qué desea hacer con ${file.name}?`;
  dropDialog.querySelector('[data-action="vision"]').hidden = ![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension);
  dropDialog.style.display = "grid";
  if (dropHost) dropHost.dataset.dropState = "actions";
}, true);

window.addEventListener("DOMContentLoaded", () => {
  const host = document.createElement("div");
  host.id = "bit-preload-drop-root";
  document.body.append(host);
  dropHost = host;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box;font-family:"Segoe UI",sans-serif}
    .overlay{position:fixed;inset:12px;z-index:2147483646;display:none;place-items:center;pointer-events:none;border:2px dashed #00f3ff;border-radius:22px;background:rgba(1,4,9,.85);backdrop-filter:blur(16px);box-shadow:inset 0 0 80px rgba(0,243,255,.16),0 0 50px rgba(0,243,255,.25);color:#d8fdff;font:600 15px Consolas,monospace;letter-spacing:.14em;text-align:center}
    .overlay b{display:block;margin-bottom:20px;color:#00f3ff;font-size:52px;text-shadow:0 0 18px #00f3ff}
    .modal{position:fixed;inset:0;z-index:2147483647;display:none;place-items:center;padding:22px;background:rgba(1,4,9,.76);backdrop-filter:blur(12px);color:#dcfbff}
    .dialog{width:min(570px,100%);padding:24px;border:1px solid rgba(0,243,255,.5);border-radius:18px;background:linear-gradient(145deg,rgba(8,29,40,.98),rgba(2,10,17,.98));box-shadow:0 22px 70px #000c,0 0 35px rgba(0,243,255,.18)}
    .kicker{color:#72f8ff;font:10px Consolas,monospace;letter-spacing:.2em}.dialog h2{margin:10px 0 18px;font-size:20px;font-weight:400;overflow-wrap:anywhere}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.actions button,.cancel{min-height:50px;padding:10px;border:1px solid rgba(92,236,255,.25);border-radius:10px;background:rgba(0,243,255,.07);color:#dcfbff;text-align:left;cursor:pointer}.actions button:hover,.cancel:hover{border-color:#00f3ff;background:rgba(0,243,255,.13)}.actions button[hidden]{display:none}.cancel{width:100%;margin-top:10px;text-align:center;color:#79a2aa}@media(max-width:620px){.actions{grid-template-columns:1fr}}
  `;
  dropOverlay = document.createElement("div");
  dropOverlay.className = "overlay";
  const overlayContent = document.createElement("div");
  const overlayIcon = document.createElement("b");
  overlayIcon.textContent = "⬡";
  overlayContent.append(overlayIcon, document.createTextNode("SUELTA EL ARCHIVO PARA PROCESAR EN BIT"));
  dropOverlay.append(overlayContent);

  dropDialog = document.createElement("div");
  dropDialog.className = "modal";
  const dialog = document.createElement("section");
  dialog.className = "dialog";
  const kicker = document.createElement("div");
  kicker.className = "kicker";
  kicker.textContent = "BIT / ARCHIVO DETECTADO";
  const title = document.createElement("h2");
  title.textContent = "¿Qué desea hacer con el archivo?";
  const actions = document.createElement("div");
  actions.className = "actions";
  const definitions = [
    ["summarize", "📄 Resumir contenido / Extraer texto"],
    ["edit", "✏️ Modificar o editar archivo"],
    ["vision", "👁️ Analizar con Visión de IA"],
    ["vault", "🧠 Guardar en Bóveda / Grafo de Obsidian"],
    ["attach", "💬 Adjuntar al chat para consultar"],
  ];
  for (const [action, label] of definitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    actions.append(button);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "cancel";
  cancel.textContent = "CANCELAR";
  cancel.addEventListener("click", () => { dropDialog.style.display = "none"; droppedFile = undefined; });
  actions.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !droppedFile) return;
    const file = droppedFile;
    dropDialog.style.display = "none";
    droppedFile = undefined;
    try {
      const result = await ipcRenderer.invoke("bit:process-dropped-file", { filePath: file.filePath, action: button.dataset.action });
      const chat = document.getElementById("chat");
      if (chat) {
        const message = document.createElement("div");
        message.className = "message assistant";
        message.textContent = result?.text || "Archivo procesado.";
        chat.append(message);
        chat.scrollTop = chat.scrollHeight;
      }
    } catch (error) {
      const chat = document.getElementById("chat");
      if (chat) {
        const message = document.createElement("div");
        message.className = "message error";
        message.textContent = `No pude procesar el archivo: ${error.message}`;
        chat.append(message);
      }
    }
  });
  dialog.append(kicker, title, actions, cancel);
  dropDialog.append(dialog);
  shadow.append(style, dropOverlay, dropDialog);
});
}
