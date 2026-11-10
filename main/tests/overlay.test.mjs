import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overlay: comparte el nÃºcleo hologrÃ¡fico y reacciona al RMS", async () => {
  const [overlay, tokens] = await Promise.all([
    readFile(new URL("../electron/overlay.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/hud-tokens.css", import.meta.url), "utf8"),
  ]);
  const script = overlay.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  assert.match(overlay, /href="\.\/hud-tokens\.css"/u);
  assert.equal((overlay.match(/class="orbital-ring/g) || []).length, 3);
  assert.match(tokens, /--voice-level/u);
  assert.match(script, /onVoiceLevel/u);
  assert.match(script, /function drawCoreParticles/u);
  assert.doesNotThrow(() => new Function(script));
});

test("overlay: el clic abre la ventana principal transparente y enfoca el chat", async () => {
  const [main, overlay] = await Promise.all([
    readFile(new URL("../electron/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/overlay.html", import.meta.url), "utf8"),
  ]);
  assert.match(overlay, /function onHudClick\(\) \{\s+void window\.bitRuntime\.openMain\(\)/u);
  assert.match(main, /frame: false/u);
  assert.match(main, /transparent: true/u);
  assert.match(main, /backgroundColor: "#00000000"/u);
  assert.match(main, /bit:focus-chat-input/u);
});
