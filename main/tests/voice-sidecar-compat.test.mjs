import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidecarPath = new URL("../voice-sidecar/sidecar.py", import.meta.url);

test("el STT evita la incompatibilidad de PyAV metadata_errors", async () => {
  const source = await readFile(sidecarPath, "utf8");

  assert.match(source, /wave\.open\(str\(audio_path\),\s*["']rb["']\)/u);
  assert.match(source, /np\.frombuffer\(pcm,\s*dtype=np\.int16\)/u);
  assert.match(source, /self\.model\.transcribe\(audio,/u);
  assert.doesNotMatch(source, /self\.model\.transcribe\(str\(audio_path\)/u);
});
