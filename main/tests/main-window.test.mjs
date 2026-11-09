import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ventana principal: conserva núcleo, chat y entrada sin paneles redundantes", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)].map((match) => match[1]);
  const finalStyles = styleBlocks.at(-2);

  assert.match(html, /id="orb-canvas"/u);
  assert.match(html, /id="chat"/u);
  assert.match(html, /id="prompt"/u);
  assert.match(html, /id="settings"/u);
  assert.match(finalStyles, /#context-panel,\s*\.conversation-head\{display:none!important\}/u);
  assert.match(finalStyles, /\.composer #history-up,\.composer #history-down,\.composer select\{display:none\}/u);
  assert.match(finalStyles, /\.status>span:not\(#connection\)\{display:none\}/u);
  assert.doesNotMatch(finalStyles, /\.status\{display:none/u);
});
