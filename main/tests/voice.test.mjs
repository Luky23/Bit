import test from "node:test";
import assert from "node:assert/strict";
import { JsonlFramer, encodeVoiceMessage, parseVoiceLine } from "../src/voice/protocol.mjs";
import { SpeechQueue, splitSentences } from "../src/voice/speech.mjs";
import { isAllowedAudioFile, validateVoiceSettings } from "../src/voice/settings.mjs";

test("protocolo de voz valida y enmarca JSONL", () => {
  const framer = new JsonlFramer();
  const line = encodeVoiceMessage({ type: "speak", text: "Hola." });
  assert.deepEqual(framer.push(line.slice(0, 4)), []);
  assert.deepEqual(framer.push(line.slice(4)), [{ type: "speak", text: "Hola." }]);
  assert.throws(() => parseVoiceLine(JSON.stringify({ type: "speak" })), /sin texto/);
});

test("la respuesta se segmenta por oración y puede interrumpirse", async () => {
  assert.deepEqual(splitSentences("Uno. Dos! Tres?"), ["Uno.", "Dos!", "Tres?"]);
  const spoken = [];
  const queue = new SpeechQueue(async (text) => { spoken.push(text); });
  queue.enqueue("Primera. Segunda.");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(spoken, ["Primera.", "Segunda."]);
  queue.enqueue("No debe salir.");
  queue.cancel();
  assert.equal(queue.items.length, 0);
});

test("voz ajusta endpointing y limita extensiones de audio", () => {
  assert.equal(validateVoiceSettings({ vadEndpointMs: 100 }).vadEndpointMs, 500);
  assert.equal(validateVoiceSettings({ vadEndpointMs: 999 }).vadEndpointMs, 700);
  assert.equal(isAllowedAudioFile("saludo.wav"), true);
  assert.equal(isAllowedAudioFile("programa.exe"), false);
});
