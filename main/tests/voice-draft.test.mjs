import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const source = readFileSync(new URL('../electron/voice-draft.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.BitVoiceDraft;
}

test('corrige una rectificación hablada y conserva el contexto anterior', () => {
  const { correctSpokenText } = load();
  assert.equal(correctSpokenText('abrí Chrome, no, quise decir Edge'), 'abrí Edge');
  assert.equal(correctSpokenText('corrijo: abrir Edge'), 'abrir Edge');
});

test('reemplaza una instrucción cuando la persona dice lo cambio por', () => {
  const { correctSpokenText } = load();
  assert.equal(correctSpokenText('buscar vuelos a Córdoba, lo cambio por Mendoza'), 'buscar vuelos a Mendoza');
});

test('no altera una frase normal ni un no que no sea una corrección', () => {
  const { correctSpokenText } = load();
  assert.equal(correctSpokenText('no abras el navegador'), 'no abras el navegador');
  assert.equal(correctSpokenText('  abrir el calendario  '), 'abrir el calendario');
});
