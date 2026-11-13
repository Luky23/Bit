import test from 'node:test';
import assert from 'node:assert/strict';
import {isWebSearchRequest,buildWebSearchQuery} from '../src/net-gateway.mjs';
import {runAgentTurn} from '../src/core/agent.mjs';

test('cotizaciones se consultan aunque falten tildes o haya errores de escritura',()=>{
 for(const text of ['cuanto eta dolar en pesos argentino','¿A cuánto está el dólar?','cuanto esta el euro en pesos','valor del bitcoin','dolar blue hoy','USD a ARS','Buscá información sobre los eclipses','Averiguá quién inventó el telescopio'])assert.equal(isWebSearchRequest(text),true,text);
 for(const text of ['¿Qué es el dólar?','Buscá mi archivo del dólar','Lee mis notas sobre bitcoin','Explica la historia del peso argentino'])assert.equal(isWebSearchRequest(text),false,text);
 assert.match(buildWebSearchQuery('cuanto eta dolar en pesos argentino'),/d[oó]lar.*peso argentino.*cotizaci[oó]n.*hoy/iu);
});

test('si hubo búsqueda no devuelve la excusa genérica de no tener acceso a internet',async()=>{
 const result=await runAgentTurn({message:'cuanto eta dolar en pesos argentino',config:{fastModel:'local'},deps:{
  executeTool:async()=>[{title:'Cotizaciones',url:'https://www.bna.com.ar/',snippet:'Consulte las cotizaciones de compra y venta publicadas con su fecha de actualización.'}],
  chatClient:{generate:async()=>({message:{content:'Lo siento, no tengo acceso a datos en tiempo real.'}})},
 }});
 assert.doesNotMatch(result.text,/no tengo acceso/u);assert.match(result.text,/compra y venta/u);assert.equal(result.sources.length,1);
});

test('la pregunta de la captura busca antes de generar y conserva sus fuentes sin ofrecer herramientas',async()=>{
 let searches=0;
 const result=await runAgentTurn({message:'cuanto eta dolar en pesos argentino',config:{fastModel:'local'},deps:{
  executeTool:async(name,args)=>{assert.equal(name,'web.search');assert.match(args.query,/compra.*venta/iu);searches++;return[{title:'Cotización de prueba',url:'https://www.bna.com.ar/',snippet:'Cotización de prueba fechada: compra 1000, venta 1010 pesos por dólar. No son valores actuales.'}]},
  chatClient:{generate:async(_model,req)=>{assert.equal(searches,1);assert.equal(req.tools,undefined);assert.ok(req.messages.some(item=>item.content.includes('No son valores actuales')));return{message:{content:'Los resultados de prueba no permiten confirmar la cotización actual.'}}}},
 }});
 assert.equal(result.sources.length,1);assert.equal(searches,1);
});
