import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper sidecar configurado por ruta local"
}));
