import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainUiUrl = new URL("../electron/index.html", import.meta.url);
const overlayUrl = new URL("../electron/overlay.html", import.meta.url);

test("el chat principal amplía el área visible y desplaza la respuesta larga al final", async () => {
  const source = await readFile(mainUiUrl, "utf8");

  assert.match(source, /max-height:min\(48vh,480px\)/);
  assert.match(source, /function scrollChatToLatest\(\)\{requestAnimationFrame/);
  assert.match(source, /const answer=result\.text\|\|'No recibí una respuesta\.';/);
  assert.match(source, /pending\.textContent=answer\+/);
  assert.match(source, /pending\.className='message assistant';scrollChatToLatest\(\)/);
});

test("el overlay deja crecer el chat y desplaza al final después de completar la respuesta", async () => {
  const source = await readFile(overlayUrl, "utf8");

  assert.match(source, /flex:\s*1 1 0;\s*min-height:\s*0;\s*overflow-y:\s*auto/);
  assert.match(source, /function scrollMessagesToLatest\(\)\s*\{\s*requestAnimationFrame/);
  assert.match(source, /const answer = result\.text \|\| 'El modelo no devolvió texto\.';/);
  assert.match(source, /pending\.textContent = answer \+ \(result\.sources\?\.length/);
  assert.match(source, /scrollMessagesToLatest\(\)/);
});

test("el panel de ajustes permite desplazarse hasta la configuración de Obsidian", async () => {
  const source = await readFile(mainUiUrl, "utf8");

  assert.match(source, /\.drawer\{[^}]*overflow-y:auto;overscroll-behavior-y:contain/);
});

test("el núcleo queda estático y sin animación de fotogramas mientras Bit piensa", async () => {
  const mainUi = await readFile(mainUiUrl, "utf8");
  const overlay = await readFile(overlayUrl, "utf8");

  assert.match(mainUi, /\.orb\.processing,[^{}]*\{animation:none\}/);
  assert.match(mainUi, /\.orb\.processing\{filter:drop-shadow\(0 0 16px #00d9ff33\)\}/);
  assert.match(mainUi, /if\(!thinking\)frameId=requestAnimationFrame\(draw\);else frameId=0/);
  assert.match(mainUi, /const pulse=thinking\?1:/);
  assert.match(mainUi, /if\(!thinking\)particle\.angle\+=particle\.speed/);
  assert.match(overlay, /\.hud-core\.processing \.core-ring \{ animation: none;/);
  assert.match(overlay, /\.hud-core\.processing \.core-center \{[^}]*animation: none;/);
  assert.match(overlay, /if \(newState === State\.LISTENING \|\| newState === State\.SPEAKING\) animateCoreBars\(\)/);
});
