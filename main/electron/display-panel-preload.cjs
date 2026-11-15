const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('projectPanel',Object.freeze({
  snapshot: (request={})=>ipcRenderer.invoke('bit:project-panel',request),
  setActiveProject: project=>ipcRenderer.invoke('bit:project-panel-select-project',project),
  loadModel: (request)=>ipcRenderer.invoke('bit:project-panel-load-model',request),
  chat: message=>ipcRenderer.invoke('bit:chat',{message}),
  onChatChunk: listener=>{
    const handler=(_event,chunk)=>listener(chunk.text);
    ipcRenderer.on('bit:chat-chunk',handler);
    return ()=>ipcRenderer.removeListener('bit:chat-chunk',handler);
  },
  onActivity: listener=>{
    const handler=()=>listener();
    ipcRenderer.on('bit:project-activity',handler);
    return ()=>ipcRenderer.removeListener('bit:project-activity',handler);
  },
  onProjectSelection: listener=>{
    const handler=(_event,project)=>listener(project);
    ipcRenderer.on('bit:project-selection',handler);
    return ()=>ipcRenderer.removeListener('bit:project-selection',handler);
  },
  onProjectFileOpen: listener=>{
    const handler=(_event,request)=>listener(request);
    ipcRenderer.on('bit:project-file-open',handler);
    return ()=>ipcRenderer.removeListener('bit:project-file-open',handler);
  },
  onViewerCommand: listener=>{
    const handler=(_event,request)=>listener(request);
    ipcRenderer.on('bit:workspace-viewer-command',handler);
    return ()=>ipcRenderer.removeListener('bit:workspace-viewer-command',handler);
  },
  onWorkspaceTransition: listener=>{
    const handler=(_event,transition)=>listener(transition);
    ipcRenderer.on('bit:workspace-transition',handler);
    return ()=>ipcRenderer.removeListener('bit:workspace-transition',handler);
  },
  sendViewerCommandResult: result=>ipcRenderer.send('bit:workspace-viewer-result',result),
  openMain: ()=>ipcRenderer.invoke('bit:open-main'),
  showHome: ()=>ipcRenderer.invoke('bit:show-home'),
}));
