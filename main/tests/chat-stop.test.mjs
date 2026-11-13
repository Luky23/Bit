import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('detener cancela solo el turno del emisor, limpia voz y audita', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const activeChatTurns = new Map();');
  const end = source.indexOf('ipcMain.handle("bit:chat",', start);
  let stop;
  const sent = [], audit = [];
  let voiceCancelled = false;
  const context = vm.createContext({
    ipcMain: { handle: (_channel, handler) => { stop = handler; } },
    speechQueue: { cancel: () => { voiceCancelled = true; } },
    voiceProcess: null,
    previewData: 'local', join: (...parts) => parts.join('/'),
    writeWorkspaceAudit: async (...args) => audit.push(args),
  });
  vm.runInContext(source.slice(start, end), context);
  const own = new AbortController(), other = new AbortController();
  context.own = own; context.other = other;
  vm.runInContext('activeChatTurns.set(1, own); activeChatTurns.set(2, other);', context);
  await stop({ sender: { id: 1, send: channel => sent.push(channel) } });
  assert.equal(own.signal.aborted, true);
  assert.equal(other.signal.aborted, false);
  assert.equal(voiceCancelled, true);
  assert.deepEqual(sent, ['bit:voice-clear']);
  assert.equal(audit[0][1].action, 'chat.stop');
});
