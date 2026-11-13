import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('tarjetas: la respuesta parcial y final se muestran sin depender del evento IPC',()=>{
 const html=readFileSync(new URL('../electron/index.html',import.meta.url),'utf8');
 const start=html.indexOf('    function showResponseCard('),end=html.indexOf('    function updateCardCount(',start);
 assert.ok(start>=0,'Falta mostrar la tarjeta durante la respuesta');
 const cards=[];const context={showCard:data=>cards.push(data)};vm.createContext(context);
 vm.runInContext(html.slice(start,end),context);
 context.showResponseCard({text:'Respuesta parcial'});
 context.showResponseCard({text:'Respuesta completa',sources:[{title:'Fuente'}]});
 assert.equal(cards.length,2);assert.equal(cards[0].id,cards[1].id);
 assert.equal(cards[1].value,'Respuesta completa');assert.equal(cards[1].label,'RESULTADO WEB');
 context.showResponseCard({busy:true,text:'Espere'});
 assert.equal(cards.length,2);
});
test('tarjetas: actualiza por id, usa texto seguro y descarta sin duplicar',()=>{
 const html=readFileSync(new URL('../electron/index.html',import.meta.url),'utf8');
 class Node{constructor(){this.children=[];this.dataset={};this.className='';this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>{this.className+=' '+c}}}append(n){this.children.push(n);n.parent=this}prepend(n){this.children.unshift(n);n.parent=this}remove(){this.parent.children=this.parent.children.filter(n=>n!==this)}querySelector(c){return this.children.find(n=>n.className===c.slice(1))}setAttribute(){}get lastElementChild(){return this.children.at(-1)}}
 const nodes={cardsStack:new Node(),'card-count':new Node(),'context-panel':new Node()};
 const context={document:{createElement:()=>new Node()},$:id=>nodes[id],setTimeout:fn=>fn()};vm.createContext(context);
 const start=html.indexOf('    function updateCardCount('),end=html.indexOf('    window.BitUI=',start);
 vm.runInContext(html.slice(start,end),context);
 context.showCard({id:'weather:italia',value:'11.7?C',subtext:'<script>dato</script>'});
 context.showCard({id:'weather:italia',value:'12?C'});
 assert.equal(nodes.cardsStack.children.length,1);assert.equal(nodes.cardsStack.children[0].querySelector('.val').textContent,'12?C');
 context.hideCard('weather:italia');assert.equal(nodes.cardsStack.children.length,0);assert.equal(nodes['context-panel'].hidden,true);
});
for(const file of ['preload.cjs','preload.mjs'])test('tarjetas: IPC y limpieza en '+file,()=>{
 let bridge;const listeners=new Map();const electron={contextBridge:{exposeInMainWorld:(_,b)=>bridge=b},ipcRenderer:{on:(c,h)=>listeners.set(c,h),removeListener:(c,h)=>{if(listeners.get(c)===h)listeners.delete(c)}}};
 let source=readFileSync(new URL('../electron/'+file,import.meta.url),'utf8');source=source.replace('import pkg from "electron";', 'const pkg = require("electron");');
 vm.runInNewContext(source,{require:()=>electron});let received;const off=bridge.onDisplayCard(data=>received=data);const payload={value:'11.7?C'};listeners.get('bit:display-card')({},payload);assert.equal(received,payload);off();assert.equal(listeners.size,0);
});
