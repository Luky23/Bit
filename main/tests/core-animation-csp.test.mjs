import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el nucleo principal permanece visible e inicia su animacion', async () => {
  const html = await readFile(new URL('../electron/index.html', import.meta.url), 'utf8');
  assert.match(html, /body\.file-model-active \.orb-area\{display:none!important\}/u);
  assert.match(html, /startMainCore=\(\)=>\{if\(stopMainCore\)return;stopMainCore=window\.startBitCore\(\$\('orb-canvas'/u);
  assert.match(html, /coreHandoffComplete=false[\s\S]*if\(coreHandoffComplete\)return;coreHandoffComplete=true/u);
  assert.match(html, /window\.addEventListener\('bit:startup-ready',handoffToMainCore,\{once:true\}\)/u);
  assert.doesNotMatch(html, /bit:startup-phase[\s\S]*handoffToMainCore/u);
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
  assert.match(animation, /canvas\.id === 'orb-mini-canvas' \? 44/u);
  assert.match(animation, /canvas\.id === 'startup-core-canvas' \|\| canvas\.id === 'orb-canvas'/u);
  assert.match(animation, /__bitPrimaryCoreState/u);
  assert.match(animation, /extent=Math\.min\(width,height\)\*\.40/u);
  assert.match(animation, /new ResizeObserver\(resize\)/u);
});
