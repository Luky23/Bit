import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const url=new URL('../electron/screen-query.html',import.meta.url);
async function setup(){
  const html=await readFile(url,'utf8');
  const frames=[];
  const element=()=>({children:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},classList:{remove(){}},appendChild(node){this.children.push(node)},focus(options){this.focusOptions=options;},value:'Explique la pantalla',disabled:false});
  const nodes=Object.fromEntries(['prompt','form','submit','status','thread'].map(id=>[id,element()]));
  Object.assign(nodes.thread,{scrollHeight:1000,clientHeight:300,scrollTop:700});
  let resolveChat,streamChunk;
  let now=0,tick;const timers=new Set();
  const env={performance:{now:()=>now},setInterval:fn=>{tick=fn;timers.add(1);return 1},clearInterval:id=>timers.delete(id),document:{getElementById:id=>nodes[id],createElement:element},window:{BitResponseTiming:{start:()=>({finish(){}})},BitMessageEditor:{create:()=>({attach(){},commit(){}})},bitRuntime:{onChatChunk:callback=>{streamChunk=callback},chat:()=>new Promise(resolve=>{resolveChat=resolve;})}},requestAnimationFrame:fn=>frames.push(fn)};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],env);
  return {html,nodes,frames,timers,stream:text=>streamChunk({text}),advance(ms){now+=ms;tick?.()},resolve:result=>resolveChat(result),flush(){while(frames.length)frames.shift()();}};
}

test('la respuesta de pantalla aparece por fragmentos antes de finalizar',async()=>{
  const app=await setup();const pending=app.nodes.form.listeners.submit({preventDefault(){}});
  app.stream('Veo un cuaderno');app.stream(' de matemática.');
  assert.equal(app.nodes.thread.children.at(-1).textContent,'Veo un cuaderno de matemática.');
  app.resolve({text:'Veo un cuaderno de matemática.'});await pending;
  app.stream('Fragmento tardío');assert.equal(app.nodes.thread.children.at(-1).textContent,'Veo un cuaderno de matemática.');
});

test('enviar limpia el cuadro, permite preparar otra pregunta y conserva ese borrador al recibir la respuesta',async()=>{
 const app=await setup();const pending=app.nodes.form.listeners.submit({preventDefault(){}});
 assert.equal(app.nodes.prompt.value,'');assert.equal(app.nodes.prompt.disabled,false);
 assert.equal(app.nodes.thread.children[0].textContent,'Explique la pantalla');
 app.nodes.prompt.value='Mi siguiente pregunta';
 await app.nodes.form.listeners.submit({preventDefault(){}});
 assert.equal(app.nodes.thread.children.length,2,'no inicia otra consulta mientras responde');
 app.resolve({text:'Respuesta'});await pending;
 assert.equal(app.nodes.prompt.value,'Mi siguiente pregunta');assert.equal(app.nodes.submit.disabled,false);
});

test('la consulta muestra segundos mientras espera y conserva la duración final',async()=>{
  const app=await setup();const pending=app.nodes.form.listeners.submit({preventDefault(){}});
  app.advance(2500);assert.match(app.nodes.status.textContent,/2,5 s/u);
  app.resolve({text:'Respuesta'});await pending;
  assert.match(app.nodes.status.textContent,/completada en 2,5 s/u);
  assert.equal(app.timers.size,0);
});
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
