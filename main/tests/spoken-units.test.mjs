import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSpeechText,SpeechQueue} from '../src/voice/speech.mjs';

test('la voz expande temperaturas, signos y decimales antes de quitar símbolos',()=>{
 assert.equal(prepareSpeechText('Ahora: 22 °C. Mínima: -3,5°C.'),'Ahora: 22 grados Celsius. Mínima: menos 3 coma 5 grados Celsius.');
 assert.equal(prepareSpeechText('1°C, 32°F y 18℃.'),'1 grado Celsius, 32 grados Fahrenheit y 18 grados Celsius.');
 assert.equal(prepareSpeechText('El ángulo mide 90°.'),'El ángulo mide 90 grados.');
});

test('la voz dice kilómetros por hora y no separa decimales en oraciones distintas',async()=>{
 assert.equal(prepareSpeechText('Viento: 15 km/h. Ráfagas: 21.5 km / h.'),'Viento: 15 kilómetros por hora. Ráfagas: 21 coma 5 kilómetros por hora.');
 const sent=[];const queue=new SpeechQueue(message=>sent.push(JSON.parse(message)));
 queue.enqueue('Viento: 21.5 km/h. Temperatura: -2.5 °C.');
 await queue.waitForIdle();
 assert.deepEqual(sent.filter(item=>item.text).map(item=>item.text),['Viento: 21 coma 5 kilómetros por hora.','Temperatura: menos 2 coma 5 grados Celsius.']);
});
