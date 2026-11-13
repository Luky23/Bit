import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el overlay completo deja libres los controles superiores de las ventanas', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const body = source.match(/function overlayBounds\(expanded = false\) \{([\s\S]*?)\n\}/)[1];
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1536, y: 40, width: 1536, height: 824 },
  ]) {
    const bounds = new Function('screen', 'expanded', body);
    const screen = { getPrimaryDisplay: () => ({ workArea: area }) };
    for (const expanded of [false, true]) {
      const result = bounds(screen, expanded);
      assert.equal(result.y, area.y + 40, 'el margen superior deja libres los controles sin alejar el núcleo');
      assert.ok(result.y + result.height <= area.y + area.height);
      assert.ok(result.x >= area.x);
      assert.ok(result.x + result.width <= area.x + area.width);
    }
  }
});
