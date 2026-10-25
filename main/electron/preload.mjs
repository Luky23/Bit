import pkg from "electron";
const { contextBridge, ipcRenderer } = pkg;

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper local",
  getRuntime: () => ipcRenderer.invoke("bit:runtime"),
  chat: (request) => ipcRenderer.invoke("bit:chat", request),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("bit:overlay-set-expanded", expanded === true),
  openMain: () => ipcRenderer.invoke("bit:open-main"),
  captureScreen: () => ipcRenderer.invoke("bit:screen-capture"),
  speak: (text) => ipcRenderer.invoke("bit:speak", text),
  stopSpeaking: () => ipcRenderer.invoke("bit:stop-speaking"),
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
  auditObsidianVault: (vaultPath) => ipcRenderer.invoke("bit:obsidian-audit", { vaultPath }),
  saveToObsidian: (vaultPath, title, content) => ipcRenderer.invoke("bit:obsidian-save", { vaultPath, title, content }),
  downloadAsset: (url, destPath, expectedHash, assetName) => ipcRenderer.invoke("bit:download-asset", { url, destPath, expectedHash, assetName }),
  ensurePiperModel: (modelName, voicesDir) => ipcRenderer.invoke("bit:ensure-piper-model", { modelName, voicesDir }),
  // Computer Use
  captureAndAnalyzeScreen: (prompt, visionModel, maxSide) => ipcRenderer.invoke("bit:system-capture-screen", { prompt, visionModel, maxSide }),
  openApp: (target, args) => ipcRenderer.invoke("bit:system-open-app", { target, args })
}));
