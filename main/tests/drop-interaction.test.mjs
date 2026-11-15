import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('soltar un archivo abre acciones y conserva el archivo para reintentar si falla el modelo',async()=>{
  const html=await readFile(new URL('../electron/index.html',import.meta.url),'utf8');
  const script=html.match(/\(function installDragAndDrop\(\) \{[\s\S]*?\}\)\(\);/)[0];
  const listeners=new Map(),nodes=new Map(),calls=[],timings=[];
  function node(id=''){
    return {style:{},dataset:{},children:[],listeners:new Map(),setAttribute(){},removeAttribute(){},append(child){this.children.push(child);},remove(){},querySelector(selector){return nodeFor(selector);},addEventListener(name,fn){this.listeners.set(name,fn);}};
  }
  function nodeFor(id){if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);}
  const bridge={getPathForFile:()=> 'C:/Documentos/nota.txt',processDroppedFile:async request=>{calls.push(request);throw new Error('Modelo no disponible');}};
  vm.runInNewContext(script,{
    window:{bitRuntime:bridge,BitResponseTiming:{start:pending=>{timings.push(pending);return{finish:()=>{pending.dataset.responseTime='Tiempo total: 1,2 s';}};}},addEventListener:(name,fn)=>listeners.set(name,fn)},
    document:{getElementById:nodeFor,createElement:()=>node()},
    console,
  });
  let prevented=false;
  await listeners.get('drop')({preventDefault(){prevented=true;},stopPropagation(){},dataTransfer:{files:[{name:'nota.txt',size:15}]}});
  assert.equal(prevented,true);
  assert.equal(nodeFor('drop-modal').style.display,'grid');
  assert.equal(nodeFor('drop-file-name').textContent,'nota.txt');
  const click=nodeFor('.drop-actions').listeners.get('click');
  const event={target:{closest:()=>({dataset:{action:'summarize'}})}};
  click(event);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodeFor('drop-modal').style.display,'grid');
  assert.match(timings[0].textContent,/No pude procesar el archivo: Modelo no disponible/u);
  assert.equal(timings[0].dataset.responseTime,'Tiempo total: 1,2 s');
  click(event);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);
  assert.equal(calls[1].filePath,'C:/Documentos/nota.txt');
});

test('el núcleo flotante remite el archivo local a la principal sin procesarlo',async()=>{
  const source=await readFile(new URL('../electron/overlay-drop.js',import.meta.url),'utf8');
  const listeners=new Map(),paths=[];
  vm.runInNewContext(source,{
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),bitRuntime:{getPathForFile:()=> 'C:/Documentos/nota.txt',forwardDroppedFile:async path=>paths.push(path)}},
    document:{querySelector:()=>null},
  });
  await listeners.get('drop')({preventDefault(){},dataTransfer:{files:[{name:'nota.txt'}]}});
  assert.deepEqual(paths,['C:/Documentos/nota.txt']);
});
