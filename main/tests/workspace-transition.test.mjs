import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el Workspace de una pantalla se integra alrededor del núcleo sin ocultar conversación ni voz', async () => {
  const html = await readFile(new URL('../electron/index.html', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../electron/workspace-context.mjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('./../electron/main.mjs', import.meta.url), 'utf8');
  assert.match(html, /id="project-context"/u);
  assert.match(html, /id="project-document"/u);
  assert.match(html, /id="project-model"/u);
  assert.match(html, /id="project-response-section"/u);
  assert.match(html, /isEmbeddedProjectResponse\(\)/u);
  assert.match(html, /clearProjectResponse/u);
  assert.match(html, /appearance-mode/u);
  assert.match(html, /body\[data-appearance="holographic"\]/u);
  assert.match(html, /setConfig\('appearanceMode'/u);
  assert.match(html, /prefers-reduced-motion/u);
  assert.match(renderer, /displayMode === "parallel"/u);
  assert.match(renderer, /runtime\.projectSnapshot/u);
  assert.match(renderer, /runtime\.loadProjectModel/u);
  assert.match(renderer, /runtime\.readProjectFile/u);
  assert.match(renderer, /runtime\.onProjectSelection/u);
  assert.match(renderer, /runtime\.onDisplayChange/u);
  assert.match(renderer, /BitUI\?\.clearProjectResponse/u);
  assert.match(renderer, /BitUI\?\.clearCards/u);
  assert.match(main, /displayMode: "embedded"/u);
  assert.doesNotMatch(main, /mainWindow\.hide\(\);\s*setSingleDisplayWorkspaceTransition\(false\)/u);
  for (const id of ['chat', 'chat-form', 'voice', 'voice-capture']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
});
