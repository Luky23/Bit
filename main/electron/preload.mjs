import { contextBridge, ipcRenderer } from "electron";

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
  auditObsidianVault: (vaultPath) => ipcRenderer.invoke("bit:obsidian-audit", { vaultPath }),
  saveToObsidian: (vaultPath, title, content) => ipcRenderer.invoke("bit:obsidian-save", { vaultPath, title, content })
}));
