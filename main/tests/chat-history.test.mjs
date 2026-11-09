import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("las interfaces principal y HUD conservan el contexto reciente en memoria", async () => {
  const [mainUi, overlayUi] = await Promise.all([
    readFile(new URL("../electron/index.html", import.meta.url), "utf8"),
    readFile(new URL("../electron/overlay.html", import.meta.url), "utf8"),
  ]);

  for (const source of [mainUi, overlayUi]) {
    assert.match(source, /conversationHistory\.slice\(-8\)/);
    assert.match(source, /role:\s*'user',\s*content:\s*prompt/);
    assert.match(source, /role:\s*'assistant',\s*content:\s*answer/);
  }
});
