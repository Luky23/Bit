import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupGreeting} from '../electron/boot.js';
import {resolveDirectGreeting} from '../src/core/agent.mjs';
import {buildPersonalizationPrompt} from '../src/models/prompt.mjs';
import {readFileSync} from 'node:fs';

test('los saludos de inicio hablan en primera persona y no repiten el último al agotar variantes',()=>{
 const now=new Date('2026-11-12T10:00:00-03:00');const greetings=[];
 for(let i=0;i<8;i++)greetings.push(createStartupGreeting('Luca',now,()=>0,greetings));
 for(const text of greetings)assert.doesNotMatch(text,/\bBit (?:ya|operativo|está)/iu);
 const last=greetings[0];assert.notEqual(createStartupGreeting('Luca',now,()=>0,[last,...greetings.slice(1)]),last);
});

test('los saludos de conversación varían con el historial sin llamar al modelo',()=>{
 const history=[];const seen=new Set();
 for(let i=0;i<5;i++){
  const text=resolveDirectGreeting('Hola','Luca',history);
  assert.equal(seen.has(text),false);seen.add(text);history.push({role:'assistant',content:text});
 }
 assert.match(buildPersonalizationPrompt({}),/primera persona/iu);
});

test('la ventana no sustituye el saludo variable por una bienvenida fija',()=>{
 const html=readFileSync(new URL('../electron/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Soy Bit\. Sistemas locales listos/u);
});
