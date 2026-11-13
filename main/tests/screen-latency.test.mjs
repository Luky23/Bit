import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analyzeImageWithVision } from '../src/screen/vision-tools.mjs';

test('leer texto reconocido no espera ni invoca al modelo visual', async () => {
  let calls = 0;
  const result = await analyzeImageWithVision({
    prompt: 'Lee el texto de la pantalla', imageBase64: 'aGVsbG8=', ocrText: 'Texto de prueba legible.',
    visualAnalyzer: async () => { calls++; return 'Análisis costoso'; },
  });
  assert.equal(calls, 0);
  assert.match(result, /Texto de prueba legible/u);
});

test('una descripción general usa texto legible y evita el modelo visual lento', async () => {
  let calls=0;
  const result=await analyzeImageWithVision({prompt:'qué ves en la pantalla',imageBase64:'aGVsbG8=',ocrText:'Cuaderno de matemática discreta. Crear un resumen en audio.',visualAnalyzer:async()=>{calls++;return 'Análisis visual';}});
  assert.equal(calls,0);assert.match(result,/Cuaderno de matemática/u);
});

test('un subtítulo aislado no se transforma en el tema del video ni espera al modelo visual',async()=>{
 let calls=0;
 const result=await analyzeImageWithVision({prompt:'de qué es el video',imageBase64:'aGVsbG8=',ocrText:'Es excelente, qué te voy a decir. 1:00 / 16:04',visualAnalyzer:async()=>{calls++;return 'Análisis costoso';}});
 assert.equal(calls,0);assert.match(result,/fotograma/iu);assert.match(result,/t[ií]tulo|subt[ií]tulos/iu);
});

test('una pregunta visual conserva el modelo aunque haya texto reconocido', async () => {
  let calls = 0;
  const result = await analyzeImageWithVision({
    prompt: 'Describe la imagen de la pantalla', imageBase64: 'aGVsbG8=', ocrText: 'Texto de prueba.',
    visualAnalyzer: async () => { calls++; return 'Una imagen de prueba.'; },
  });
  assert.equal(calls, 1); assert.equal(result, 'Una imagen de prueba.');
});

test('la consulta real reutiliza un único OCR antes del análisis y registra duraciones sin el texto', async () => {
  const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function captureScreenForUserQuestion(');
  const end = source.indexOf('\n}', start) + 2;
  let ocrCalls = 0;
  const audit = [];
  const context = vm.createContext({
    join: (...parts) => parts.join('/'), previewData: 'local',
    writeWorkspaceAudit: async (_path, entry) => audit.push(entry),
    mainWindow: undefined, overlayWindow: undefined, screenQueryWindow: undefined,
    screenCaptureInProgress: false, setTimeout: fn => fn(), performance,
    captureScreenBase64: async () => ({ imageBase64: 'aGVsbG8=', width: 640, height: 480 }),
    analyzeImageWithTesseract: async () => { ocrCalls++; return 'Texto local privado'; },
    analyzeImageWithVision: async args => { assert.equal(args.ocrText, 'Texto local privado'); return 'Lectura completada'; },
    isGroundingRequest: () => false,
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.captureScreenForUserQuestion({ prompt: 'Lee el texto' });
  assert.equal(result.ok, true); assert.equal(ocrCalls, 1);
  const completed = audit.find(entry => entry.status === 'completed');
  assert.equal(typeof completed.timings?.ocrMs, 'number');
  assert.equal(JSON.stringify(audit).includes('Texto local privado'), false);
});
