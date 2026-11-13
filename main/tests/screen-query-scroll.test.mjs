import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const url=new URL('../electron/screen-query.html',import.meta.url);
async function setup(){
  const html=await readFile(url,'utf8');
  const frames=[];
  const element=()=>({listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},classList:{remove(){}},appendChild(){},focus(options){this.focusOptions=options;},value:'Explique la pantalla',disabled:false});
  const nodes=Object.fromEntries(['prompt','form','submit','status','thread'].map(id=>[id,element()]));
  Object.assign(nodes.thread,{scrollHeight:1000,clientHeight:300,scrollTop:700});
  let resolveChat;
  const env={document:{getElementById:id=>nodes[id],createElement:element},window:{bitRuntime:{chat:()=>new Promise(resolve=>{resolveChat=resolve;})}},requestAnimationFrame:fn=>frames.push(fn)};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],env);
  return {html,nodes,frames,resolve:result=>resolveChat(result),flush(){while(frames.length)frames.shift()();}};
}
test('la respuesta tardia conserva la posicion al leer mensajes anteriores',async()=>{
  const app=await setup();
  const pending=app.nodes.form.listeners.submit({preventDefault(){}});app.flush();
  app.nodes.thread.scrollTop=120;app.nodes.thread.listeners.scroll();
  app.nodes.thread.scrollHeight=1800;app.resolve({text:'Respuesta extensa'});await pending;app.flush();
  assert.equal(app.nodes.thread.scrollTop,120);
  assert.deepEqual(app.nodes.prompt.focusOptions.preventScroll,true);
});
test('la respuesta nueva se sigue cuando el usuario permanece al final',async()=>{
  const app=await setup();const pending=app.nodes.form.listeners.submit({preventDefault(){}});app.flush();
  app.nodes.thread.scrollHeight=1800;app.resolve({text:'Respuesta extensa'});await pending;app.flush();
  assert.equal(app.nodes.thread.scrollTop,1800);
});
test('el historial tiene altura acotada y los mensajes no se comprimen',async()=>{
  const {html}=await setup();
  assert.match(html,/\.window \{[^}]*height: 100%; min-height: 0;/);
  assert.match(html,/#thread \{[^}]*flex: 1 1 0; min-height: 0;[^}]*overflow-y: auto/);
  assert.match(html,/\.bubble \{ flex-shrink: 0; overflow-wrap: anywhere/);
  assert.match(html,/id="thread"[^>]*tabindex="0"/);
});
