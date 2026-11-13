import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn } from '../src/core/agent.mjs';
import { findDatedPassage } from '../src/core/dated-answer.mjs';

test('una pregunta de fecha responde con la fecha respaldada sin esperar al modelo', async () => {
  let generated = false;
  const result = await runAgentTurn({
    message: 'cuando viene el papa a argentina',
    config: { fastModel: 'local' },
    deps: {
      chatClient: { generate: async () => { generated = true; return { message: { content: 'Resumen sin fecha' } }; } },
      executeTool: async () => [{ title: 'Programa del viaje', url: 'https://www.vaticannews.va/es/prueba.html', snippet: 'El pontífice visitará Argentina del 8 al 11 de noviembre de 2031.' }],
    },
  });
  assert.match(result.text, /8 al 11 de noviembre de 2031/u);
  assert.equal(generated, false);
  assert.equal(result.sources.length, 1);
});

test('la fecha de publicación y un evento sin el destino no responden la pregunta', () => {
  assert.equal(findDatedPassage('Publicado el 5 de noviembre de 2031. El Papa visita Argentina.', 'papa argentina visita fecha'), '');
  assert.equal(findDatedPassage('El Papa visitará Uruguay el 5 de noviembre de 2031.', 'papa argentina visita fecha'), '');
});
