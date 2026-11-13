import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la consola principal conserva el contexto reciente; el overlay solo la abre", async () => {
  const mainUi = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.match(mainUi, /conversationHistory\.slice\(-8\)/);
  assert.match(mainUi, /role:'user',content:prompt/);
  assert.match(mainUi, /role:'assistant',content:answer/);
});
