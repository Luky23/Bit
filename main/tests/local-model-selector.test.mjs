import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("el selector carga modelos locales y no ofrece tags ficticios de Ollama", async () => {
  const html = await readFile(new URL("../electron/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<option value="qwen2\.5(?::3b|-coder:7b)"/u);
  assert.match(html, /getConfig\('availableModels'\)/u);
  assert.match(html, /entry\.kind==='model'/u);
  assert.match(html, /Sin modelo local disponible/u);
});
