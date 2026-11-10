// Prueba manual integrada: ejecutar con Electron, no con node --test.
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..', 'electron');
const reportPath = join(__dirname, '.drag-smoke-report.json');
const report = [];
let temp;
async function record(value) {
  report.push(value);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

async function inspect(window, label) {
  const state = await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
    title: document.title,
    preloadHost: Boolean(document.getElementById('bit-preload-drop-root')),
    dropState: document.getElementById('bit-preload-drop-root')?.dataset.dropState,
    dropFiles: document.getElementById('bit-preload-drop-root')?.dataset.dropFiles,
    dropError: document.getElementById('bit-preload-drop-root')?.dataset.dropError,
    bridge: Boolean(window.bitRuntime?.processDroppedFile),
    viewport: [innerWidth, innerHeight]
  }))))`);
  const image = await window.webContents.capturePage();
  const screenshot = join(temp, `${label}.png`);
  await writeFile(screenshot, image.toPNG());
  await record({ label, ...state, screenshot });
  return state;
}

async function main() {
  await record({ phase: 'starting' });
  temp = await mkdtemp(join(tmpdir(), 'bit-drag-smoke-'));
  const fixture = join(temp, 'prueba-bit.txt');
  await writeFile(fixture, 'Contenido de prueba local.\n', 'utf8');
  ipcMain.handle('config:get', () => ({ ok: true, value: '' }));
  ipcMain.handle('bit:runtime', () => ({ model: 'test' }));
  ipcMain.handle('bit:process-dropped-file', (_event, request) => {
    void record({ ipc: 'bit:process-dropped-file', request });
    return { ok: true, status: 'ARCHIVO PROCESADO', text: 'Prueba local completada.' };
  });

  const window = new BrowserWindow({
    width: 980, height: 720, show: false,
    webPreferences: {
      preload: join(root, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.on('preload-error', (_event, path, error) => { void record({ preloadError: path, error: String(error) }); });
  window.webContents.on('console-message', (_event, details) => { void record({ renderer: details.message }); });
  await window.loadFile(join(root, 'index.html'));
  const initial = await inspect(window, 'initial');
  if (!initial.preloadHost || !initial.bridge) throw new Error('El preload de Bit no cargó');

  window.webContents.debugger.attach('1.3');
  const send = (type) => window.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
    type, x: 490, y: 320,
    data: { items: [], files: [fixture], dragOperationsMask: 1 },
  });
  await send('dragEnter');
  await send('dragOver');
  await inspect(window, 'drag-over');
  await send('drop');
  await inspect(window, 'drop');
  window.webContents.debugger.detach();
  window.destroy();
  await record({ result: 'finished', temp });
}

app.whenReady().then(main).catch((error) => {
  void record({ smokeError: String(error), stack: error?.stack });
  process.exitCode = 1;
}).finally(() => {
  setTimeout(() => app.quit(), 200);
});
