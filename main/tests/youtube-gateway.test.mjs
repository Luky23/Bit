import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNetGateway } from "../src/net-gateway.mjs";

test("YouTube: apertura auditada, indicador y rechazo de destinos arbitrarios", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bit-youtube-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const auditPath = join(root, "audit.log");
  const opened = [], activity = [];
  const gateway = createNetGateway({ auditPath, openExternal: async (url) => { opened.push(url); }, onActivity: (event) => activity.push(event.active) });
  assert.equal((await gateway.openYouTube("https://www.youtube.com/")).ok, true);
  assert.equal((await gateway.openYouTube("https://www.youtube.com/results?search_query=daddy+yankee")).ok, true);
  for (const url of ["http://www.youtube.com/", "https://www.youtube.com.evil.example/", "https://user@www.youtube.com/", "https://www.youtube.com/watch?v=123", "https://www.youtube.com/?next=https://evil.example", "file:///C:/programa.exe"]) {
    await assert.rejects(gateway.openYouTube(url));
  }
  assert.equal(opened.length, 2);
  assert.deepEqual(activity, [true, false, true, false]);
  const logs = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(logs.map((line) => line.status), ["started", "completed", "started", "completed"]);
  const failed = createNetGateway({ auditPath, openExternal: async () => { throw new Error("fallo navegador"); }, onActivity: (event) => activity.push(event.active) });
  await assert.rejects(failed.openYouTube("https://www.youtube.com/"), /fallo navegador/);
  assert.equal(activity.at(-1), false);
  assert.match(await readFile(auditPath, "utf8"), /"status":"failed"/);
});

test("búsqueda en navegador: conserva la elección y audita sin efectuar fetch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bit-browser-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const opened = [], activity = [];
  const auditPath = join(root, "audit.log");
  const gateway = createNetGateway({ auditPath, fetchImpl: () => assert.fail("La búsqueda se entrega al navegador"),
    openExternal: async (url, options) => { opened.push({ url, browser: options.browser }); },
    onActivity: (event) => activity.push(event.active),
  });
  const url = "https://www.google.com/search?q=recetas";
  assert.equal((await gateway.openBrowserPage(url, { browser: "chrome.exe" })).ok, true);
  assert.deepEqual(opened, [{ url, browser: "chrome.exe" }]);
  assert.deepEqual(activity, [true, false]);
  await assert.rejects(gateway.openBrowserPage(url, { browser: "cmd.exe" }));
  await assert.rejects(gateway.openBrowserPage("https://www.google.com.evil.example/search?q=test"));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(gateway.openBrowserPage(url, { signal: abort.signal }));
  assert.equal(opened.length, 1);
  const failing = createNetGateway({ auditPath, openExternal: async () => { throw new Error("navegador ausente"); }, onActivity: (event) => activity.push(event.active) });
  await assert.rejects(failing.openBrowserPage(url), /ausente/);
  assert.equal(activity.at(-1), false);
  assert.match(await readFile(auditPath, "utf8"), /"status":"failed"/);
});
