import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDisplayRoles } from '../src/core/display-layout.mjs';

const display=(id,x)=>({id,bounds:{x,y:0,width:1920,height:1080},workArea:{x,y:0,width:1920,height:1040},size:{width:1920,height:1080}});

test('distribuye uno, dos y tres monitores por posición física',()=>{
  assert.deepEqual([...resolveDisplayRoles([display(1,0)]).values()],['main']);
  assert.deepEqual([...resolveDisplayRoles([display(1,0),display(2,1920)],new Map(),2).values()],['project','main']);
  assert.deepEqual([...resolveDisplayRoles([display(3,1920),display(1,-1920),display(2,0)],new Map(),2).values()],['project','main','info']);
  assert.deepEqual([...resolveDisplayRoles([display(1,0),display(2,1920),display(3,3840)],new Map(),1).values()],['main','project','info']);
});

test('el modo de una pantalla alterna entre Bit y Workspace sin recrear su ventana',async()=>{
  let displays=[display(1,0)];
  const windows=[];
  class Window {
    constructor(options){this.options=options;this.visible=options.show===true;this.messages=[];this.webContents={send:(...args)=>this.messages.push(args)};this.destroyed=false;this.listeners={};windows.push(this);}
    setBounds(bounds){this.bounds=bounds;}
    focus(){}
    setAlwaysOnTop(){}
    setVisibleOnAllWorkspaces(){}
    setIgnoreMouseEvents(){}
    isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;}
    show(){this.visible=true;}
    hide(){this.visible=false;}
    focus(){this.focused=true;}
    once(name,fn){(this.listeners[name]??=[]).push(fn);}
    on(name,fn){(this.listeners[name]??=[]).push(fn);}
    close(){this.destroyed=true;}
    loadFile(path,options){this.path=path;this.query=options?.query;}
  }
  const source=await readFile(new URL('../electron/display-manager.mjs',import.meta.url),'utf8');
  const body=source.replace(/^import .*;\r?\n/gm,'').replace(/const here = .*;/,'const here = "C:/Bit/main/electron";').replace(/^export \{.*\};/gm,'').replace(/export /g,'');
  const manager=new Function('pkg','resolveDisplayRoles','join','configGet','configSet',body+';return {initDisplayManager,showProjectWorkspace,setSecondaryWindowsVisible,setSingleDisplayWorkspaceTransition};')(
    {BrowserWindow:Window,screen:{getAllDisplays:()=>[...displays],getPrimaryDisplay:()=>displays[0],on(){}}},
    resolveDisplayRoles,join,async()=>({ok:true,value:{}}),async()=>({ok:true})
  );
  const main=new Window({show:true});
  manager.initDisplayManager({mainWindow:main});
  await new Promise(resolve=>setImmediate(resolve));
  main.hide();
  manager.setSecondaryWindowsVisible(false);
  manager.showProjectWorkspace(displays[0].workArea);
  const workspace=windows.find(win=>win.query?.role==='project');
  assert.ok(workspace);
  for(const listener of workspace.listeners['ready-to-show']??[]) listener();
  assert.equal(workspace.visible,true);
  assert.equal(workspace.focused,true);
  workspace.messages.length=0;
  manager.showProjectWorkspace(displays[0].workArea,{transition:true});
  assert.equal(workspace.messages.some(([channel,payload])=>channel==='bit:workspace-transition'&&payload?.phase==='enter'),false);
  manager.setSingleDisplayWorkspaceTransition(true);
  manager.setSecondaryWindowsVisible(true);
  assert.equal(workspace.visible,true, 'La vista del proyecto permanece visible mientras Bit anima el regreso');
  manager.setSingleDisplayWorkspaceTransition(false);
  manager.setSecondaryWindowsVisible(true);
  assert.equal(workspace.visible,false);
  assert.equal(windows.includes(workspace),true);
});

test('recupera la principal al desconectar su monitor y elimina roles duplicados',()=>{
  const preferences=new Map([[1,'project'],[2,'main'],[3,'info']]);
  const roles=resolveDisplayRoles([display(1,0),display(3,1920)],preferences);
  assert.equal([...roles.values()].filter(r=>r==='main').length,1);
  assert.deepEqual([...resolveDisplayRoles([display(1,0),display(2,1920)],new Map([[2,'main']])).values()],['none','main']);
});

test('guarda intercambios, restaura preferencias y usa el área útil',async()=>{
  let displays=[display(1,-1920),display(2,0),display(3,1920)];
  const events={};
  const windows=[];
  class Window {
    constructor(options){this.options=options;this.webContents={send(){}};this.destroyed=false;windows.push(this);}
    setBounds(bounds){this.bounds=bounds;}
    focus(){}
    setAlwaysOnTop(value,level){this.alwaysOnTop={value,level};}
    setVisibleOnAllWorkspaces(value,options){this.visibleOnAllWorkspaces={value,options};}
    setIgnoreMouseEvents(ignore,options){this.ignoreMouseEvents={ignore,options};}
    isDestroyed(){return this.destroyed;}
    isVisible(){return true;}
    show(){} hide(){} once(){} on(){} close(){this.destroyed=true;}
    loadFile(path,options){this.path=path;this.query=options?.query;}
  }
  let stored={'1':'project','2':'main','3':'hologram'};
  const source=await readFile(new URL('../electron/display-manager.mjs',import.meta.url),'utf8');
  const body=source.replace(/^import .*;\r?\n/gm,'').replace(/const here = .*;/,'const here = "C:/Bit/main/electron";').replace(/^export \{.*\};/gm,'').replace(/export /g,'');
  const manager=new Function('pkg','resolveDisplayRoles','join','configGet','configSet',body+';return {initDisplayManager,setDisplayRole,getConnectedDisplays,updateDisplayLayout,showProjectWorkspace};')(
    {BrowserWindow:Window,screen:{getAllDisplays:()=>[...displays],getPrimaryDisplay:()=>displays[0],on:(name,fn)=>{events[name]=fn;}}},
    resolveDisplayRoles,join,async()=>({ok:true,value:stored}),async(_key,value)=>{stored=value;return {ok:true};}
  );
  const main=new Window({});
  const overlay=new Window({});
  manager.initDisplayManager({mainWindow:main,overlayWindow:overlay,getOverlayDefaultBounds:()=>({x:10,y:20,width:160,height:160})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(main.bounds.x,0);
  assert.equal(main.bounds.height,1040);
  assert.equal(overlay.bounds.x,1920);
  assert.deepEqual(overlay.ignoreMouseEvents,{ignore:true,options:{forward:true}});
  assert.deepEqual(overlay.alwaysOnTop,{value:true,level:'floating'});
  assert.equal(windows.some(win=>win.query?.role==='project'),false);
  manager.showProjectWorkspace(displays.find(display => display.id === 1).workArea);
  assert.ok(windows.some(win=>win.query?.role==='project'&&win.path.endsWith('display-panel.html')));
  await manager.setDisplayRole(1,'main');
  assert.equal(stored['2'],'project');
  assert.equal(main.bounds.x,-1920);
  displays=[display(2,0)];
  events['display-removed'](null,display(1,-1920));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(main.bounds.x,0);
  assert.equal(overlay.bounds.x,10);
  assert.deepEqual(overlay.ignoreMouseEvents,{ignore:false,options:undefined});
  assert.equal(manager.getConnectedDisplays()[0].role,'main');
  assert.ok(windows.some(win=>win.query?.role==='project'&&win.destroyed));
  await assert.rejects(manager.setDisplayRole(999,'info'),/conectada/);
});
