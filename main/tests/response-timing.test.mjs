import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('el tiempo queda en el mensaje, resiste reemplazar su texto y detiene el reloj al terminar',()=>{
  const source=readFileSync(new URL('../electron/response-timing.js',import.meta.url),'utf8');
  let now=0,tick,cleared=false;
  const window={};
  vm.runInNewContext(source,{window,performance:{now:()=>now},setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{cleared=true}});
  const message={dataset:{},textContent:'Pensando…'};
  const timing=window.BitResponseTiming.start(message);
  now=3200;tick();assert.match(message.dataset.responseTime,/3,2 s/u);
  message.textContent='Respuesta terminada';timing.finish();
  assert.equal(message.dataset.responseTime,'Tiempo total: 3,2 s');assert.equal(cleared,true);
  now=8000;assert.equal(timing.durationMs(),3200);
});

test('ambas ventanas cargan el reloj y el estilo que lo muestra junto a la respuesta',()=>{
  for(const file of ['index.html','screen-query.html']){
    const html=readFileSync(new URL('../electron/'+file,import.meta.url),'utf8');
    assert.match(html,/src="response-timing.js"/u);assert.match(html,/href="response-timing.css"/u);
    assert.match(html,/BitResponseTiming.start\(pending\)/u);
    assert.match(html,/responseTiming.finish\(\)/u);
  }
});
