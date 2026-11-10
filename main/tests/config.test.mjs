import test from "node:test";
import assert from "node:assert/strict";
import { isSafeLocalModelId, isSafeSongName, normalizeUserName } from "../src/core/config.mjs";

test("config: acepta tags locales de Ollama y bloquea rutas", () => {
  assert.equal(isSafeLocalModelId("qwen2.5:3b"), true);
  assert.equal(isSafeLocalModelId("qwen2.5vl:3b"), true);
  assert.equal(isSafeLocalModelId("../modelo"), false);
  assert.equal(isSafeLocalModelId("http://servidor"), false);
});

test("config: normaliza el nombre preferido", () => {
  assert.deepEqual(normalizeUserName("  Lucía   Pérez "), { ok: true, value: "Lucía Pérez" });
  assert.deepEqual(normalizeUserName("Sen\u0303or"), { ok: true, value: "Señor" });
  assert.deepEqual(normalizeUserName(""), { ok: true, value: "" });
});

test("config: rechaza nombres inválidos", () => {
  assert.equal(normalizeUserName("Lucía\nHola").ok, false);
  assert.equal(normalizeUserName("A".repeat(41)).ok, false);
  assert.equal(normalizeUserName(42).ok, false);
});

test("config: permite nombres locales de audio con caracteres Unicode", () => {
  assert.equal(isSafeSongName("Canción de Lucía (versión 2).mp3"), true);
  assert.equal(isSafeSongName("mañana.wav"), true);
  assert.equal(isSafeSongName("Música_日本.flac"), true);
});

test("config: rechaza rutas, nombres reservados y nombres inválidos para Windows", () => {
  assert.equal(isSafeSongName("CON.mp3"), false);
  assert.equal(isSafeSongName("LPT1.wav"), false);
  assert.equal(isSafeSongName("audio?.mp3"), false);
  assert.equal(isSafeSongName("audio.mp3 "), false);
  assert.equal(isSafeSongName("C:\\música\\audio.mp3"), false);
  assert.equal(isSafeSongName("audio.txt"), false);
});
