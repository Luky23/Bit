import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('editar conserva la conversación hasta reenviar; cancelar restaura el borrador y reenviar reemplaza desde ese punto', () => {
  const source=readFileSync(new URL('../electron/message-editor.js',import.meta.url),'utf8');
  class Node {
    constructor(){this.children=[];this.value='Borrador';this.listeners={};}
    appendChild(node){this.children.push(node);node.parentNode=this;}
    addEventListener(name,fn){this.listeners[name]=fn;}
    focus(){}
    remove(){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}
    get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1];}
  }
  const context={window:{},document:{createElement:()=>new Node()}};
  vm.runInNewContext(source,context);
  const input=new Node(),composer=new Node(),thread=new Node();composer.appendChild(input);
  const first=new Node(),answer=new Node(),later=new Node();for(const node of [first,answer,later])thread.appendChild(node);
  let busy=false,history;
  const editor=context.window.BitMessageEditor.create({input,isBusy:()=>busy,onCommit:snapshot=>{history=snapshot;}});
  editor.attach(first,'Pregunta original',['anterior']);
  first.children[0].onclick();assert.equal(input.value,'Pregunta original');assert.equal(thread.children.length,3);
  editor.cancel();assert.equal(input.value,'Borrador');assert.equal(thread.children.length,3);
  busy=true;first.children[0].onclick();assert.equal(input.value,'Borrador');busy=false;
  first.children[0].onclick();input.value='Pregunta corregida';editor.commit();
  assert.equal(thread.children.length,0);assert.equal(history[0],'anterior');assert.equal(input.value,'Pregunta corregida');
});

test('editar mientras responde cancela primero y habilita la edición al terminar la cancelación',async()=>{
 const source=readFileSync(new URL('../electron/message-editor.js',import.meta.url),'utf8');
 const element=()=>({children:[],value:'Borrador',addEventListener(){},focus(){},appendChild(node){this.children.push(node);node.parentNode=this}});
 const input=element();element().appendChild(input);const node=element();
 let busy=true,stops=0,finishStop;
 const context={window:{},document:{createElement:element}};vm.runInNewContext(source,context);
 const editor=context.window.BitMessageEditor.create({input,isBusy:()=>busy,stop:async()=>{stops++;await new Promise(resolve=>{finishStop=resolve});busy=false;}});
 editor.attach(node,'Pregunta para corregir');const editing=node.children[0].onclick();
 assert.equal(stops,1);assert.equal(input.value,'Borrador');
 finishStop();await editing;
 assert.equal(input.value,'Pregunta para corregir');assert.equal(node.children[0].disabled,false);
});
