import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('el botón único detiene al pensar y hablar, y recupera enviar al terminar', async () => {
  const html = await readFile(new URL('../electron/index.html', import.meta.url), 'utf8');
  const button = { dataset: {}, setAttribute(name, value) { this[name] = value; } };
  const prompt = { value: 'Hola', focus() {} };
  const form = {};
  let finishChat, chats = 0, stops = 0;
  const context = vm.createContext({
    $: id => ({ send: button, prompt, 'chat-form': form, model: { value: 'local' } })[id],
    window: { BitResponseTiming:{start:()=>({durationMs:()=>2500,finish(){}})}, bitRuntime: {
      chat: () => { chats++; return new Promise(resolve => { finishChat = resolve; }); },
      stopChat: async () => { stops++; },
    } },
    messageEditor: {commit(){}}, addMessage: () => ({}), scrollChatToLatest() {}, speakResponse() {}, showResponseCard() {},
  });
  vm.runInContext(`const State={IDLE:'idle',PROCESSING:'processing',SPEAKING:'speaking',ERROR:'error'};let currentState=State.IDLE,history=[],historyIndex=0,conversationHistory=[];`, context);
  vm.runInContext(html.slice(html.indexOf('    let chatPending='), html.indexOf('    function setState(')), context);
  vm.runInContext('function setState(state){currentState=state;updateSendButton()} updateSendButton();', context);
  const submit = html.split('\n').find(line => line.includes("$('chat-form').onsubmit="));
  vm.runInContext(submit, context);
  assert.equal(button.dataset.action, 'send');
  const first = form.onsubmit({ preventDefault() {} });
  assert.equal(button.dataset.action, 'stop');
  assert.equal(button.disabled, false);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(stops, 1);
  assert.equal(chats, 1);
  vm.runInContext('setState(State.SPEAKING)', context);
  finishChat({ text: 'Respuesta' });
  await first;
  assert.equal(button.dataset.action, 'stop', 'conserva detener si el audio continúa después del chat');
  await form.onsubmit({ preventDefault() {} });
  assert.equal(stops, 2);
  assert.equal(chats, 1);
  vm.runInContext('setState(State.IDLE)', context);
  assert.equal(button.dataset.action, 'send');
  assert.equal(button['aria-label'], 'Enviar mensaje');
  assert.doesNotMatch(html, /<button id="stop-chat"/u);
});
