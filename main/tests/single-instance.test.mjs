import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('otra apertura termina la segunda instancia y muestra la ventana de la primera', async () => {
  const source = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const match = source.match(/function initializeSingleInstance\(\) \{[\s\S]*?\n\}/u);
  assert.ok(match, 'Falta el bloqueo de instancia única');
  for (const ownsLock of [true, false]) {
    let exitCode, shown = 0;
    const listeners = new Map();
    const context = vm.createContext({
      app: { requestSingleInstanceLock: () => ownsLock, exit: code => { exitCode = code; },
        on: (name, callback) => listeners.set(name, callback), whenReady: () => Promise.resolve() },
      showMainWindow: () => { shown++; },
    });
    vm.runInContext(match[0], context);
    assert.equal(context.initializeSingleInstance(), ownsLock);
    if (ownsLock) {
      await listeners.get('second-instance')(); assert.equal(shown, 1); assert.equal(exitCode, undefined);
    } else { assert.equal(exitCode, 0); assert.equal(listeners.size, 0); }
  }
});
