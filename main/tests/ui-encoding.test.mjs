import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la interfaz no contiene texto recodificado varias veces', async () => {
  for(const name of ['index.html','overlay.html','screen-query.html','display-panel.html']) {
    const html = await readFile(new URL(`../electron/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /Ã|Â|â€|�/u);
  }
});
