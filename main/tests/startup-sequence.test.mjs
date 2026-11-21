import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("el arranque muestra una secuencia progresiva antes de revelar Bit", async () => {
  const [html, css, sequence, boot] = await Promise.all([
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8"),
    readFile(new URL("../electron/startup-sequence.js", import.meta.url), "utf8"),
    readFile(new URL("../electron/boot.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<body class="booting">/u);
  assert.match(html, /id="startup-sequence"/u);
  assert.match(html, /id="startup-core-canvas"/u);
  assert.match(html, /window\.startBitCore\(\$\('startup-core-canvas'\)/u);
  assert.match(html, /id="system-status-panel"/u);
  assert.match(html, /id="settings"[^>]*aria-label="Abrir configuración"/u);
  assert.match(html, /class="file-context-pdf-frame"/u);
  assert.match(html, /id="startup-status"/u);
  assert.match(sequence, /DESPERTANDO NÚCLEO/u);
  assert.match(html, /src="startup-sequence\.js"/u);
  assert.match(css, /body\.booting > \.topbar/u);
  assert.match(css, /body\.startup-reveal > \.workspace #chat-form/u);
  assert.match(css, /startup-progress span[\s\S]*transition: width \.34s/u);
  assert.match(css, /\.startup-core-canvas/u);
  assert.match(css, /startup-status-reveal/u);
  assert.match(css, /startup-chat-reveal/u);
  assert.match(css, /startup-topbar-stage/u);
  assert.match(css, /startup-orb-stage/u);
  assert.doesNotMatch(css, /data-startup-phase="systems"/u);
  assert.match(css, /startup-side-stage/u);
  assert.match(css, /startup-reveal:not\(\.file-model-active\)[\s\S]*#orb-canvas/u);
  assert.match(css, /startup-reveal > \.workspace > \.spatial-hud-side[\s\S]*filter: none !important/u);
  assert.match(css, /BIT  \/\/  CONVERSACIÓN LOCAL/u);
  assert.match(css, /#chat[\s\S]*background: transparent !important/u);
  assert.match(css, /startup-sequence\s*\{[\s\S]*transition:\s*opacity 1\.1s/u);
  assert.doesNotMatch(css, /body\.startup-reveal \.startup-sequence\s*\{[^}]*opacity:\s*1/u);
  assert.match(sequence, /const STARTUP_STEPS = Object\.freeze\(\[/u);
  assert.match(sequence, /progress: 100/u);
  assert.match(sequence, /const MIN_SEQUENCE_MS = 4200/u);
  assert.match(css, /bit-startup-core-arrive-shared/u);
  assert.match(css, /bit-startup-composer-reveal/u);
  assert.match(css, /startup-core[\s\S]*top: 33%/u);
  assert.match(sequence, /event\.key === "Escape"/u);
  assert.match(sequence, /body\.classList\.remove\("startup-active"\)/u);
  assert.match(css, /visual-transitioning\.file-context-active \.file-context[\s\S]*animation: none !important/u);
  assert.match(css, /file-context-pdf-reveal/u);
  assert.match(boot, /await waitForVisualStartup\(\)/u);
  assert.ok(boot.indexOf("await waitForVisualStartup()") < boot.indexOf("const config = await window.bitRuntime.getConfig"));
  assert.match(html, /boot\(\)\.then\(\(\)=>import\('\.\/boot\.js'\)\)\.then\(\(\{runBootSequence\}\)=>\{window\.bitStartupSequence\?\.complete\(\)/u);
  assert.doesNotMatch(html, /bit:startup-phase[\s\S]*handoffToMainCore/u);
});
