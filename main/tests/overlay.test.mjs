import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overlay: dibuja el mismo núcleo luminoso con partículas animadas", async () => {
  const overlayUrl = new URL("../electron/overlay.html", import.meta.url);
  const overlay = await readFile(overlayUrl, "utf8");
  const script = overlay.match(/<script>([\s\S]*?)<\/script>/u)?.[1];

  assert.ok(script, "el overlay debe conservar su script local");
  assert.match(overlay, /<canvas class="core-particles" id="coreParticles"/u);
  assert.match(overlay, /radial-gradient\(circle at 35% 30%, #f2ffff 0, #77e3f2 13%, #17789a 48%, #061b2b 76%\)/u);
  assert.match(script, /function drawCoreParticles/u);
  assert.match(script, /createRadialGradient\(centerX - 5, centerY - 7, 1, centerX, centerY, 28\)/u);
  assert.doesNotThrow(() => new Function(script));
});
