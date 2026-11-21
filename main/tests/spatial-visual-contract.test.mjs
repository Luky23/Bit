import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Spatial Intelligence conserva el núcleo y prioriza la conversación sin saludo ni accesos rápidos", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8");
  assert.match(html, /id="spatial-hud-frame"/u);
  assert.doesNotMatch(html, /id="spatial-hero" class="spatial-hero"/u);
  assert.doesNotMatch(html, /aria-label="Acciones principales de Bit"/u);
  assert.match(html, /id="orb-mini-canvas"/u);
  assert.match(css, /\.orb-area\s*\{[^}]*top:\s*33%/u);
  assert.match(css, /#chat\s*\{[^}]*top:\s*calc\(33% \+ clamp\(160px,\s*16vw,\s*230px\) \+ 10px\)/u);
  assert.match(css, /#chat #welcome\s*\{[^}]*display:\s*block\s*!important/u);
  assert.match(css, /#chat \.message:not\(#welcome\)\s*\{[^}]*text-align:\s*center/u);
  assert.match(css, /#chat-form\.composer\s*\{[^}]*align-items:\s*center/u);
  assert.doesNotMatch(html, /\.orb-core\{display:block!important[^}]*background:radial-gradient/u);
  assert.doesNotMatch(html, /\.orb:before\{content:""!important;display:block!important/u);
});

test("la composición 3D conserva el núcleo en la columna izquierda", async () => {
  const css = await readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8");
  assert.match(css, /\.model-active \.orb-area\s*\{[^}]*left:\s*80px/u);
  assert.match(css, /\.model-active #chat\s*\{[^}]*left:\s*138px/u);
  assert.match(css, /\.model-active #chat\s*\{[^}]*transform:\s*none/u);
  assert.match(css, /\.model-active \.conversation\s*\{[^}]*z-index:\s*9/u);
});

test("el panel del proyecto muestra su nombre real y no una línea que atraviesa el centro", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../electron/workspace-context.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8");
  assert.match(html, /id="project-name"/u);
  assert.match(js, /\$\("project-name"\)\.textContent = selectedProject/u);
  assert.match(css, /\.project-active \.project-context::before\s*\{\s*display:\s*none/u);
});

test("el proyecto reserva columnas laterales proporcionadas y no superpone rótulos", async () => {
  const css = await readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:\s*clamp\(285px,\s*23\.5vw/u);
  assert.match(css, /\.project-active \.spatial-hud-side-left\s*\{[^}]*left:\s*26%/u);
  assert.match(css, /\.project-active \.project-context::after\s*\{\s*display:\s*none/u);
});

test("el ingreso de archivos reemplaza el saludo y no cubre el compositor", async () => {
  const css = await readFile(new URL("../electron/spatial-reference-final.css", import.meta.url), "utf8");
  assert.match(css, /\.file-context-active \.spatial-hero\s*\{\s*display:\s*none/u);
  assert.match(css, /\.file-context-active \.workspace > \.spatial-actions\s*\{\s*display:\s*none/u);
  assert.match(css, /\.file-context-active #file-context:not\(\[hidden\]\)\s*\{[^}]*bottom:\s*calc\(7% \+ 80px\)/u);
  assert.match(css, /\.file-context-active:not\(\.file-model-active\) #file-context:not\(\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*minmax\(210px,\s*250px\)/u);
  assert.match(css, /\.file-context-active:not\(\.file-model-active\) \.file-context-main\s*\{[^}]*grid-column:\s*1/u);
  assert.match(css, /\.file-context-active:not\(\.file-model-active\) \.file-context-preview:not\(\[hidden\]\)[\s\S]*?grid-column:\s*2\s*!important;[\s\S]*?grid-row:\s*2 \/ 5/u);
});

test("la recarga de desarrollo incluye el JavaScript del renderer espacial", async () => {
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /ext !== "\.js"/u);
  assert.match(main, /ext === "\.html" \|\| ext === "\.css" \|\| ext === "\.js"/u);
});

test("la vista compartida sin preload no interrumpe el núcleo al leer configuración", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.match(html, /if\(!window\.bitRuntime\)return;const mode=/u);
});

test("el perfil clásico existente no se reemplaza sin elección explícita", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.match(html, /applyAppearance\(result\?\.ok \? result\.value : 'holographic'\)/u);
  assert.doesNotMatch(html, /setConfig\('appearanceMode', 'holographic'\); await/u);
});
