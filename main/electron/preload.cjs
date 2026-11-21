const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bitRuntime", Object.freeze({
  channel: "preview",
  privacy: "local-only",
  voice: "Piper local",
  getRuntime: () => ipcRenderer.invoke("bit:runtime"),
  getPerformanceStatus: () => ipcRenderer.invoke("bit:performance-status"),
  listOllamaModels: () => ipcRenderer.invoke("bit:ollama-models"),
  chat: (request) => ipcRenderer.invoke("bit:chat", request),
  stopChat: () => ipcRenderer.invoke("bit:stop-chat"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  processDroppedFile: (request) => ipcRenderer.invoke("bit:process-dropped-file", request),
  previewDroppedImage: (filePath) => ipcRenderer.invoke("bit:preview-dropped-image", { filePath }),
  previewDroppedFile: (filePath) => ipcRenderer.invoke("bit:preview-dropped-file", { filePath }),
  forwardDroppedFile: filePath => ipcRenderer.invoke('bit:forward-dropped-file',filePath),
  onFileDropRequested: listener => {
    const handler=(_event,data)=>listener(data);
    ipcRenderer.on('bit:file-drop-requested',handler);
    return ()=>ipcRenderer.removeListener('bit:file-drop-requested',handler);
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
  getConfig: (key) => ipcRenderer.invoke("config:get", key),
  setConfig: (key, value) => ipcRenderer.invoke("config:set", key, value),
  getActionHistory: () => ipcRenderer.invoke("permissions:get-history"),
  pickStartupSong: () => ipcRenderer.invoke("config:pickSong"),
  removeStartupSong: () => ipcRenderer.invoke("config:removeSong"),
  getStartupSong: () => ipcRenderer.invoke("boot:getSong"),
  bootGetSong: () => ipcRenderer.invoke("boot:getSong"),
  getDailySummary: (model) => ipcRenderer.invoke("boot:getDailySummary", model),
  pickProjectsRoot: () => ipcRenderer.invoke("config:pickProjectsRoot"),
  pickVault: () => ipcRenderer.invoke("config:pickVault"),
  initializeVault: () => ipcRenderer.invoke("config:initializeVault"),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("bit:overlay-set-expanded", expanded === true),
  openMain: () => ipcRenderer.invoke("bit:open-main"),
  openScreenQuery: () => ipcRenderer.invoke("bit:open-screen-query"),
  screenQueryClosed: () => ipcRenderer.invoke("bit:screen-query-closed"),
  screenQueryPrepared: () => ipcRenderer.invoke("bit:screen-query-prepared"),
  onScreenQueryOpen: (listener) => {
    const handler = (_event, action) => listener(action);
    ipcRenderer.on("bit:screen-query-open", handler);
    return () => ipcRenderer.removeListener("bit:screen-query-open", handler);
  },
  toggleMain: () => ipcRenderer.invoke("bit:toggle-main"),
  quitApp: () => ipcRenderer.invoke("bit:quit-app"),
  isMainVisible: () => ipcRenderer.invoke("bit:is-main-visible"),
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
  captureScreen: () => ipcRenderer.invoke("bit:screen-capture"),
  speak: (text) => ipcRenderer.invoke("bit:speak", text),
  speakAndWait: (text) => ipcRenderer.invoke("bit:speak-and-wait", text),
  stopSpeaking: () => ipcRenderer.invoke("bit:stop-speaking"),
  startVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-start"),
  stopVoiceCapture: () => ipcRenderer.invoke("bit:voice-capture-stop"),
  startWorkshopSession: (request) => ipcRenderer.invoke("bit:workshop-start", request),
  stopWorkshopSession: (request) => ipcRenderer.invoke("bit:workshop-stop", request),
  markWorkshopEvent: (request) => ipcRenderer.invoke("bit:workshop-mark", request),
  recordWorkshopReading: (request) => ipcRenderer.invoke("bit:workshop-reading", request),
  getWorkshopSnapshot: (request) => ipcRenderer.invoke("bit:workshop-snapshot", request),
  updateDiagnosticComponent: (request) => ipcRenderer.invoke("bit:diagnostic-update", request),
  getDiagnosticSnapshot: (request) => ipcRenderer.invoke("bit:diagnostic-snapshot", request),
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
  openFile: (filePath) => ipcRenderer.invoke("bit:system-open-file", { filePath }),
  onFileCreated: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("bit:file-created", handler);
    return () => ipcRenderer.removeListener("bit:file-created", handler);
  },
  auditObsidianVault: (vaultPath) => ipcRenderer.invoke("bit:obsidian-audit", { vaultPath }),
  saveToObsidian: (vaultPath, title, content) => ipcRenderer.invoke("bit:obsidian-save", { vaultPath, title, content }),
  downloadAsset: (url, destPath, expectedHash, assetName) => ipcRenderer.invoke("bit:download-asset", { url, destPath, expectedHash, assetName }),
  ensurePiperModel: (modelName, voicesDir) => ipcRenderer.invoke("bit:ensure-piper-model", { modelName, voicesDir }),
  captureAndAnalyzeScreen: (prompt, visionModel, maxSide) => ipcRenderer.invoke("bit:system-capture-screen", { prompt, visionModel, maxSide }),
  openApp: (target, args) => ipcRenderer.invoke("bit:system-open-app", { target, args }),
  hudClicked: () => ipcRenderer.send("hud-clicked"),
  getConnectedDisplays: () => ipcRenderer.invoke("bit:get-connected-displays"),
  setDisplayRole: (displayId, role) => ipcRenderer.invoke("bit:set-display-role", displayId, role),
  openWorkspace: () => ipcRenderer.invoke("bit:open-workspace"),
  closeWorkspace: () => ipcRenderer.invoke("bit:close-workspace"),
  showHome: () => ipcRenderer.invoke("bit:show-home"),
  backContext: () => ipcRenderer.invoke("bit:context-back"),
  closeActiveProject: () => ipcRenderer.invoke("bit:close-active-project"),
  projectSnapshot: (request = {}) => ipcRenderer.invoke("bit:project-panel", request),
  setActiveProject: (project) => ipcRenderer.invoke("bit:project-panel-select-project", project),
  readProjectFile: (request) => ipcRenderer.invoke("bit:project-panel-read-file", request),
  loadProjectModel: (request) => ipcRenderer.invoke("bit:project-panel-load-model", request),
  loadDroppedModel: (request) => ipcRenderer.invoke("bit:load-dropped-model", request),
  openDroppedModel: (filePath) => ipcRenderer.invoke("bit:open-dropped-model", filePath),
  onProjectActivity: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("bit:project-activity", handler);
    return () => ipcRenderer.removeListener("bit:project-activity", handler);
  },
  onProjectSelection: (listener) => {
    const handler = (_event, project) => listener(project);
    ipcRenderer.on("bit:project-selection", handler);
    return () => ipcRenderer.removeListener("bit:project-selection", handler);
  },
  onProjectFileOpen: (listener) => {
    const handler = (_event, request) => listener(request);
    ipcRenderer.on("bit:project-file-open", handler);
    return () => ipcRenderer.removeListener("bit:project-file-open", handler);
  },
  onViewerCommand: (listener) => {
    const handler = (_event, request) => listener(request);
    ipcRenderer.on("bit:workspace-viewer-command", handler);
    return () => ipcRenderer.removeListener("bit:workspace-viewer-command", handler);
  },
  sendViewerCommandResult: (result) => ipcRenderer.send("bit:workspace-viewer-result", result),
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
  onWorkspaceTransition: (listener) => {
    const handler = (_event, transition) => listener(transition);
    ipcRenderer.on("bit:workspace-transition", handler);
    return () => ipcRenderer.removeListener("bit:workspace-transition", handler);
  },
  onWorkspaceLayout: (listener) => {
    const handler = (_event, layout) => listener(layout);
    ipcRenderer.on("bit:workspace-layout", handler);
    return () => ipcRenderer.removeListener("bit:workspace-layout", handler);
  },
  getUiState: () => ipcRenderer.invoke("bit:get-ui-state"),
  dispatchUiAction: (action) => ipcRenderer.invoke("bit:ui-action", action),
  onUiState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("bit:ui-state", handler);
    return () => ipcRenderer.removeListener("bit:ui-state", handler);
  },
  onWebcamCaptureRequest: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("webcam:capture-request", handler);
    return () => ipcRenderer.removeListener("webcam:capture-request", handler);
  },
  sendWebcamCaptureResult: (id, dataUrl) => ipcRenderer.send(`webcam:capture-result:${id}`, { id, dataUrl }),
}));

