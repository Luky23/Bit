import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function weatherCardFromSources(');
const end = source.indexOf('\nlet voiceProcess', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('clima: conserva ubicación y muestra temperaturas con espacio antes de °C', () => {
  const card = context.weatherCardFromSources([{
    title: 'Clima actual en Roma, Italia',
    snippet: 'Ahora: nublado, 14,5 °C; humedad 69%; viento 5,5 km/h; mínima 9 °C, máxima 18 °C; probabilidad de precipitación 20 %',
  }]);
  assert.equal(card.temperature, '14,5 °C');
  assert.equal(card.location, 'Roma, Italia');
  assert.equal(card.rain, '20 %');
  assert.equal(card.range, '18 °C / 9 °C');
});
