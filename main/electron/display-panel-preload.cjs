const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('projectPanel',Object.freeze({
  snapshot: (request={})=>ipcRenderer.invoke('bit:project-panel',request),
  onActivity: listener=>{
    const handler=()=>listener();
    ipcRenderer.on('bit:project-activity',handler);
    return ()=>ipcRenderer.removeListener('bit:project-activity',handler);
  },
  openMain: ()=>ipcRenderer.invoke('bit:open-main'),
}));
