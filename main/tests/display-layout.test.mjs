import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDisplayRoles } from '../src/core/display-layout.mjs';

const display=(id,x)=>({id,bounds:{x,y:0,width:1920,height:1080},workArea:{x,y:0,width:1920,height:1040},size:{width:1920,height:1080}});

test('distribuye uno, dos y tres monitores por posición física',()=>{
  assert.deepEqual([...resolveDisplayRoles([display(1,0)]).values()],['main']);
  assert.deepEqual([...resolveDisplayRoles([display(1,0),display(2,1920)]).values()],['main','project']);
  assert.deepEqual([...resolveDisplayRoles([display(3,1920),display(1,-1920),display(2,0)]).values()],['project','main','info']);
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
    isDestroyed(){return this.destroyed;}
    isVisible(){return true;}
    show(){} hide(){} once(){} on(){} close(){this.destroyed=true;}
    loadFile(path,options){this.path=path;this.query=options?.query;}
  }
  let stored={'1':'project','2':'main','3':'info'};
  const source=await readFile(new URL('../electron/display-manager.mjs',import.meta.url),'utf8');
  const body=source.replace(/^import .*;\r?\n/gm,'').replace(/const here = .*;/,'const here = "C:/Bit/main/electron";').replace(/^export \{.*\};/gm,'').replace(/export /g,'');
  const manager=new Function('pkg','resolveDisplayRoles','join','configGet','configSet',body+';return {initDisplayManager,setDisplayRole,getConnectedDisplays,updateDisplayLayout};')(
    {BrowserWindow:Window,screen:{getAllDisplays:()=>[...displays],getPrimaryDisplay:()=>displays[0],on:(name,fn)=>{events[name]=fn;}}},
    resolveDisplayRoles,join,async()=>({ok:true,value:stored}),async(_key,value)=>{stored=value;return {ok:true};}
  );
  const main=new Window({});
  manager.initDisplayManager({mainWindow:main});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(main.bounds.x,0);
  assert.equal(main.bounds.height,1040);
  assert.ok(windows.some(win=>win.query?.role==='project'&&win.path.endsWith('display-panel.html')));
  await manager.setDisplayRole(1,'main');
  assert.equal(stored['2'],'project');
  assert.equal(main.bounds.x,-1920);
  displays=[display(2,0)];
  await manager.updateDisplayLayout();
  assert.equal(main.bounds.x,0);
  assert.equal(manager.getConnectedDisplays()[0].role,'main');
  await assert.rejects(manager.setDisplayRole(999,'info'),/conectada/);
});
