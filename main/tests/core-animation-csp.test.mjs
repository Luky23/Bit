import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el nucleo principal permanece visible e inicia su animacion', async () => {
  const html = await readFile(new URL('../electron/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\.orb-area[^{}]*\{[^{}]*display\s*:\s*none\s*!important/);
  assert.match(html, /window\.startBitCore\(\$\('orb-canvas'\),\s*\(\)\s*=>\s*\(\{state:currentState\}\)\)/);
});

test('el nucleo flotante permite cargar su animacion local y bloquea la red', async () => {
  const html = await readFile(new URL('../electron/overlay.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const scripts = policy.split(';').map(value => value.trim()).find(value => value.startsWith('script-src ')).split(/\s+/).slice(1);
  assert.ok(scripts.includes("'self'"), 'la animacion local necesita script-src self');
  assert.ok(!scripts.some(value => /https?:|\*/.test(value)), 'no se permiten scripts remotos');
  assert.match(policy, /connect-src 'none'/);
  assert.match(html, /<script src="core-animation.js"><\/script>/);
  const animation = await readFile(new URL('../electron/core-animation.js', import.meta.url), 'utf8');
  assert.match(animation, /window.startBitCore/);
});
