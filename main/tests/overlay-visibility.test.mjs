import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('el núcleo sigue visible cuando el Workspace alterna en una sola pantalla y Bit queda oculto', () => {
  const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const match = source.match(/function syncOverlayVisibility\(\) \{[\s\S]*?\n\}/u);
  assert.ok(match, 'Falta una política común de visibilidad para el núcleo');
  let visible = true, minimized = false, shown = false;
  const context = vm.createContext({
    mainWindow: { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized, isFocused: () => false },
    overlayWindow: { isDestroyed: () => false, hide: () => { shown = false; }, showInactive: () => { shown = true; } },
    screenCaptureInProgress: false, openingMainFromOverlay: false,
    singleDisplayWorkspaceActive: true,
    getConnectedDisplays: () => [{ id: 1 }],
    setSecondaryWindowsVisible: () => {},
    hasHologramDisplay: () => false,
  });
  vm.runInContext(match[0], context);
  context.syncOverlayVisibility(); assert.equal(shown, false, 'Con Bit visible, el núcleo debe ocultarse');
  visible = false; context.syncOverlayVisibility(); assert.equal(shown, true, 'El núcleo debe seguir visible cuando Bit queda oculto y el Workspace alterna en una sola pantalla');
  visible = true; minimized = true; context.syncOverlayVisibility(); assert.equal(shown, true);
  minimized = false; context.syncOverlayVisibility(); assert.equal(shown, false);
  context.mainWindow = undefined; context.syncOverlayVisibility(); assert.equal(shown, true);
  context.screenCaptureInProgress = true; context.syncOverlayVisibility(); assert.equal(shown, false);
  context.screenCaptureInProgress = false; context.openingMainFromOverlay = true;
  context.syncOverlayVisibility(); assert.equal(shown, false);
});
