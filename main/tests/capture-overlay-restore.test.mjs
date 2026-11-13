import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

for (const captureFails of [false, true]) {
  test(`restaura el núcleo antes del análisis aunque ya estuviera oculto; fallo=${captureFails}`, async () => {
    const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('async function captureScreenForUserQuestion(');
    const end = source.indexOf('\n}', start) + 2;
    let restored = false;
    const context = vm.createContext({
      performance, join: () => '', previewData: '', writeWorkspaceAudit: async () => {},
      mainWindow: undefined, screenCaptureInProgress: false,
      overlayWindow: { isDestroyed: () => false, isVisible: () => false },
      screenQueryWindow: { isDestroyed: () => false, isVisible: () => true, hide() {}, show() {}, focus() {} },
      syncOverlayVisibility: () => { restored = true; },
      setTimeout: fn => fn(),
      captureScreenBase64: async () => { if (captureFails) throw Error('captura fallida'); return { imageBase64: 'aGVsbG8=' }; },
      analyzeImageWithTesseract: async () => { assert.equal(restored, true); return ''; },
      analyzeImageWithVision: async () => 'Veo una imagen.', isGroundingRequest: () => false,
    });
    vm.runInContext(source.slice(start, end), context);
    if (captureFails) await assert.rejects(context.captureScreenForUserQuestion({ prompt: 'mire la pantalla' }));
    else await context.captureScreenForUserQuestion({ prompt: 'mire la pantalla' });
    assert.equal(restored, true);
    assert.equal(context.screenCaptureInProgress, false);
  });
}
