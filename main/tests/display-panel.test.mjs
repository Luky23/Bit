import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const panelScript = new URL('../electron/display-panel.js', import.meta.url);

function makeElement() {
  const listeners = new Map();
  return {
    children: [],
    classList: { toggle() {} },
    style: {},
    value: '',
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener() {},
    focus() {},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    get listenerCount() { return listeners.size; },
    dispatch(name, event) { return listeners.get(name)?.(event); },
  };
}

test('el rol info presenta Project Intelligence con resumen y actividad del proyecto', async () => {
  const source = await readFile(panelScript, 'utf8');
  const values = new Map();
  const classes = new Map();
  const document = {
    body: { classList: { toggle: (name, enabled) => classes.set(name, enabled) } },
    getElementById: (id) => {
      if (!values.has(id)) values.set(id, { textContent: '' });
      return values.get(id);
    },
    querySelector: (selector) => {
      if (!values.has(selector)) values.set(selector, { textContent: '' });
      return values.get(selector);
    },
  };

  vm.runInNewContext(source, {
    document,
    window: {},
    location: { search: '?role=info' },
    URLSearchParams,
  });

  assert.equal(classes.get('info-mode'), true);
  assert.equal(values.get('title').textContent, 'Inteligencia del proyecto');
  assert.equal(values.get('.status-panel .panel-head span').textContent, 'RESUMEN DEL PROYECTO');
  assert.equal(values.get('.activity-panel .panel-head span').textContent, 'ACTIVIDAD Y CAMBIOS');
});

test('el markup del Workspace ofrece controles únicos y separa el panel de componentes del canvas', async () => {
  const html = await readFile(new URL('../electron/display-panel.html', import.meta.url), 'utf8');
  const script = await readFile(panelScript, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['model-canvas', 'model-components', 'model-rotation', 'model-viewer', 'workspace-command-form', 'command-feedback']) {
    assert.ok(ids.includes(id), `falta el control #${id}`);
  }
  assert.ok(html.indexOf('id="model-components"') < html.indexOf('id="model-viewer"'));
  assert.match(html, /@keyframes workspace-surface-in/u);
  assert.match(html, /workspace-entering \.file-panel/u);
  assert.match(html, /workspace-entering \.preview-panel/u);
  assert.match(html, /workspace-entering \.status-panel/u);
  assert.match(html, /prefers-reduced-motion/u);
  assert.match(script, /onWorkspaceTransition/u);
  assert.match(script, /POSTERIOR/u);
  assert.match(script, /LATERAL IZQUIERDA/u);
  assert.match(script, /SECCIÓN · NO DISPONIBLE/u);
});

test('el dock del Workspace envía el comando al chat de Bit y muestra la respuesta', async () => {
  const source = await readFile(panelScript, 'utf8');
  const elements = new Map();
  const document = {
    body: { classList: { toggle() {} } },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelector() { return makeElement(); },
    createElement() { return makeElement(); },
  };
  document.getElementById('workspace-command');
  document.getElementById('workspace-command-form');
  let submittedMessage = '';
  let chatChunkListener;
  const window = {
    projectPanel: {
      async snapshot() { return { projects: [], files: [], activity: [], file: null }; },
      onActivity() { return () => {}; },
      onViewerCommand() { return () => {}; },
      onChatChunk(listener) { chatChunkListener = listener; return () => {}; },
      async chat(message) {
        submittedMessage = message;
        chatChunkListener?.('respuesta parcial');
        return { text: 'Vista superior aplicada.' };
      },
      openMain() {},
      sendViewerCommandResult() {},
    },
    addEventListener() {},
  };

  vm.runInNewContext(source, {
    document,
    window,
    location: { search: '' },
    URLSearchParams,
    Option: function Option(label, value) { this.textContent = label; this.value = value; },
  });
  await new Promise(resolve => setImmediate(resolve));
  elements.get('workspace-command').value = 'BIT, mostrame la vista superior';
  await elements.get('workspace-command-form').dispatch('submit', { preventDefault() {} });

  assert.equal(submittedMessage, 'BIT, mostrame la vista superior');
  assert.equal(elements.get('command-feedback').textContent, 'Vista superior aplicada.');
  assert.equal(elements.get('workspace-state').textContent, 'OPERATIVO');
  assert.equal(elements.get('workspace-command-submit').disabled, false);
});
