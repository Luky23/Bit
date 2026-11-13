import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('el puente distingue abrir y cerrar el chat y permite quitar la suscripcion',async()=>{
  const events=new Map();let runtime;
  const electron={contextBridge:{exposeInMainWorld(_name,value){runtime=value;}},webUtils:{},ipcRenderer:{on:(name,fn)=>events.set(name,fn),removeListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}}};
  vm.runInNewContext(await readFile(new URL('../electron/preload.cjs',import.meta.url),'utf8'),{require:()=>electron});
  const actions=[];const unsubscribe=runtime.onScreenQueryOpen(action=>actions.push(action));
  events.get('bit:screen-query-open')({},'close');
  events.get('bit:screen-query-open')({});
  assert.deepEqual(actions,['close',undefined]);
  unsubscribe();assert.equal(events.has('bit:screen-query-open'),false);
});

test('el proceso principal cierra aunque el renderer no confirme la animacion',async()=>{
  const source=await readFile(new URL('../electron/main.mjs',import.meta.url),'utf8');
  const start=source.indexOf('let screenQueryCloseTimer;');
  assert.ok(start>=0,'falta un cierre controlado por el proceso principal');
  const end=source.indexOf('function openScreenQueryWindow()',start);
  let timeout,hidden=0,sent=0;
  const env={screenQueryWindow:{isDestroyed:()=>false,hide:()=>hidden++,webContents:{send:()=>sent++}},setTimeout:fn=>(timeout=fn,1),clearTimeout(){}};
  vm.createContext(env);vm.runInContext(source.slice(start,end),env);
  vm.runInContext('closeScreenQueryWindow();closeScreenQueryWindow();',env);
  assert.equal(sent,1);assert.equal(hidden,0);
  timeout();assert.equal(hidden,1);
});
