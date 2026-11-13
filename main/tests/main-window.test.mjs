import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ventana principal: integra nÃºcleo, chat, telemetrÃ­a y entrada", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.match(html, /id="orb-canvas"/u);
  assert.equal((html.match(/class="orbital-ring/g) || []).length, 3);
  assert.match(html, /id="chat"/u);
  assert.match(html, /id="chatForm"/u);
  assert.match(html, /id="chatInput"/u);
  assert.match(html, /id="telemetryLog"/u);
  assert.match(html, /id="settings"/u);
});

test("el panel de ajustes estÃ¡ agrupado y persiste sin botÃ³n de guardado", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  for (const category of ["Identidad", "Modelos", "Sensores", "Audio"]) assert.match(html, new RegExp(`<h3>${category}</h3>`, "u"));
  assert.match(html, /window\.bitRuntime\.setConfig\(input\.id,value\)/u);
});

test("Windows: Bit conserva su identidad visual en bandeja, ventana e iniciador", async () => {
  const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const builder = await readFile(new URL("../../electron-builder.yml", import.meta.url), "utf8");
  assert.match(main, /const APP_ICON = join\(here, "assets", "bit-orb\.png"\);/u);
  assert.match(main, /tray = new Tray\(icon\);/u);
  assert.match(main, /tray\.setToolTip\("Bit"\);/u);
  assert.match(main, /app\.setName\("Bit"\);/u);
  assert.equal(packageJson.productName, "Bit");
  assert.equal(packageJson.build.productName, "Bit");
  assert.equal(packageJson.build.nsis.shortcutName, "Bit");
  assert.match(builder, /productName: Bit/u);
});

test("el inicio ejecuta una sola secuencia", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/runBootSequence\(\{model:/gu) || []).length, 1);
});

test("los errores del modelo muestran detalle en telemetrÃ­a", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.match(html, /result\.diagnostic/u);
  assert.match(html, /telemetry\('TRACE'/u);
  assert.match(html, /No pude iniciar el modelo local/u);
});
