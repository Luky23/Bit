import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImageWithVision, buildVisionPrompt } from '../src/screen/vision-tools.mjs';

for (const ocrText of ['', 'SAMSUNG AM WIEN Gece', 'Galaxy S24 FE']) {
  test(`identificar teléfonos consulta la imagen aunque OCR sea ${JSON.stringify(ocrText)}`, async () => {
    let calls = 0;
    const answer = 'Por las cámaras, parecen Galaxy S; el de la derecha podría ser Ultra. No confirmo la generación.';
    const result = await analyzeImageWithVision({
      prompt: 'qué celulares son los de la foto', imageBase64: 'aGVsbG8=', ocrText,
      visualAnalyzer: async ({ prompt }) => {
        calls++;
        assert.match(prompt, /hipótesis/iu);
        assert.match(prompt, /cámaras/iu);
        return answer;
      },
    });
    assert.equal(calls, 1);
    assert.equal(result, answer);
  });
}

test('la identificación orienta a familias probables sin imponer marca ni generación', () => {
  const prompt = buildVisionPrompt('qué modelo de celular es', 'ruido OCR');
  assert.match(prompt, /no impongas una marca/iu);
  assert.match(prompt, /perspectiva/iu);
});
