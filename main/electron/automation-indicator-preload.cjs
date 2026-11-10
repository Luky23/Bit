const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitAutomation", Object.freeze({
  onCursor: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:automation-cursor", handler);
    return () => ipcRenderer.removeListener("bit:automation-cursor", handler);
  },
}));
