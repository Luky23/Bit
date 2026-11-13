import pkg from "electron";
const { contextBridge, ipcRenderer, webUtils } = pkg;

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper local",
  getRuntime: () => ipcRenderer.invoke("bit:runtime"),
  listOllamaModels: () => ipcRenderer.invoke("bit:ollama-models"),
  chat: (request) => ipcRenderer.invoke("bit:chat", request),
  stopChat: () => ipcRenderer.invoke("bit:stop-chat"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  processDroppedFile: (request) => ipcRenderer.invoke("bit:process-dropped-file", request),
  forwardDroppedFile: filePath => ipcRenderer.invoke('bit:forward-dropped-file',filePath),
  onFileDropRequested: listener => {
    const handler=(_event,data)=>listener(data);
    ipcRenderer.on('bit:file-drop-requested',handler);
    return ()=>ipcRenderer.removeListener('bit:file-drop-requested',handler);
  },
  getConfig: (key) => ipcRenderer.invoke("config:get", key),
  setConfig: (key, value) => ipcRenderer.invoke("config:set", key, value),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("bit:overlay-set-expanded", expanded === true),
  openMain: () => ipcRenderer.invoke("bit:open-main"),
  openScreenQuery: () => ipcRenderer.invoke("bit:open-screen-query"),
  toggleMain: () => ipcRenderer.invoke("bit:toggle-main"),
  quitApp: () => ipcRenderer.invoke("bit:quit-app"),
  isMainVisible: () => ipcRenderer.invoke("bit:is-main-visible"),
  captureScreen: () => ipcRenderer.invoke("bit:screen-capture"),
  speak: (text) => ipcRenderer.invoke("bit:speak", text),
  speakAndWait: (text) => ipcRenderer.invoke("bit:speak-and-wait", text),
  stopSpeaking: () => ipcRenderer.invoke("bit:stop-speaking"),
  startVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-start"),
  stopVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-stop"),
  pickWhisperModel: () => ipcRenderer.invoke("config:pickWhisperModel"),
  pickVault: () => ipcRenderer.invoke("config:pickVault"),
  initializeVault: () => ipcRenderer.invoke("config:initializeVault"),
  pickStartupSong: () => ipcRenderer.invoke("config:pickSong"),
  removeStartupSong: () => ipcRenderer.invoke("config:removeSong"),
  getStartupSong: () => ipcRenderer.invoke("boot:getSong"),
  bootGetSong: () => ipcRenderer.invoke("boot:getSong"),
  getDailySummary: (model) => ipcRenderer.invoke("boot:getDailySummary", model),
  // Archivos soltados: notifica al renderer cuando el proceso principal terminó de procesar uno.
  onFileDropped: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:file-dropped", handler);
    return () => ipcRenderer.removeListener("bit:file-dropped", handler);
  },
  onFocusChatInput: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:focus-chat-input", handler);
    return () => ipcRenderer.removeListener("bit:focus-chat-input", handler);
  },
  onVoiceAudio: (listener) => {
    const handler = (_event, chunk) => listener(chunk);
    ipcRenderer.on("bit:voice-audio", handler);
    return () => ipcRenderer.removeListener("bit:voice-audio", handler);
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
  onEmergencyStop: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:emergency-stop", handler);
    return () => ipcRenderer.removeListener("bit:emergency-stop", handler);
  },
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
  onVoiceClear: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:voice-clear", handler);
    return () => ipcRenderer.removeListener("bit:voice-clear", handler);
  },
  onDisplayCard: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("bit:display-card", handler);
    return () => ipcRenderer.removeListener("bit:display-card", handler);
  },
  onChatChunk: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:chat-chunk", handler);
    return () => ipcRenderer.removeListener("bit:chat-chunk", handler);
  },
  auditObsidianVault: (vaultPath) => ipcRenderer.invoke("bit:obsidian-audit", { vaultPath }),
  saveToObsidian: (vaultPath, title, content) => ipcRenderer.invoke("bit:obsidian-save", { vaultPath, title, content }),
  downloadAsset: (url, destPath, expectedHash, assetName) => ipcRenderer.invoke("bit:download-asset", { url, destPath, expectedHash, assetName }),
  ensurePiperModel: (modelName, voicesDir) => ipcRenderer.invoke("bit:ensure-piper-model", { modelName, voicesDir }),
  // Computer Use
  captureAndAnalyzeScreen: (prompt, visionModel, maxSide) => ipcRenderer.invoke("bit:system-capture-screen", { prompt, visionModel, maxSide }),
  openApp: (target, args) => ipcRenderer.invoke("bit:system-open-app", { target, args }),
  hudClicked: () => ipcRenderer.send("hud-clicked"),
  // Webcam
  onWebcamCaptureRequest: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("webcam:capture-request", handler);
    return () => ipcRenderer.removeListener("webcam:capture-request", handler);
  },
  sendWebcamCaptureResult: (id, dataUrl) => ipcRenderer.send(`webcam:capture-result:${id}`, { id, dataUrl }),

  // ===== GESTIÓN DINÁMICA MULTIMONITOR =====
  getConnectedDisplays: () => ipcRenderer.invoke("bit:get-connected-displays"),
  setDisplayRole: (displayId, role) => ipcRenderer.invoke("bit:set-display-role", displayId, role),
  updateDisplayLayout: () => ipcRenderer.invoke("bit:update-display-layout"),
  onDisplayChange: (listener) => {
    const handler = (_event, displays) => listener(displays);
    ipcRenderer.on("bit:display-change", handler);
    return () => ipcRenderer.removeListener("bit:display-change", handler);
  },
  onDisplayRoleAssigned: (listener) => {
    const handler = (_event, role) => listener(role);
    ipcRenderer.on("bit:display-role-assigned", handler);
    return () => ipcRenderer.removeListener("bit:display-role-assigned", handler);
  },
}));
