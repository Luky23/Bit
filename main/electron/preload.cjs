const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper local",
  getRuntime: () => ipcRenderer.invoke("bit:runtime"),
  chat: (request) => ipcRenderer.invoke("bit:chat", request),
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
