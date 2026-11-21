const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  chat: request => ipcRenderer.invoke("bit:chat", request),
  stopChat: () => ipcRenderer.invoke("bit:stop-chat"),
  screenQueryPrepared: () => ipcRenderer.invoke("bit:screen-query-prepared"),
  screenQueryClosed: () => ipcRenderer.invoke("bit:screen-query-closed"),
  onChatChunk: listener => {
    const handler = (_event, chunk) => listener(chunk);
    ipcRenderer.on("bit:chat-chunk", handler);
    return () => ipcRenderer.removeListener("bit:chat-chunk", handler);
  },
  onScreenQueryOpen: listener => {
    const handler = (_event, action) => listener(action);
    ipcRenderer.on("bit:screen-query-open", handler);
    return () => ipcRenderer.removeListener("bit:screen-query-open", handler);
  },
}));
