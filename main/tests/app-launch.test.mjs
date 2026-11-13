import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { executeWithConfirmation } from "../src/screen/exec-tools.mjs";

test("aplicaciones: informa un ejecutable ausente sin afirmar que lo abrió", async () => {
  const child = new EventEmitter();
  child.unref = () => assert.fail("No debe desprender un proceso que falló");
  const promise = executeWithConfirmation({ target: "chrome.exe", spawnImpl: () => child });
  queueMicrotask(() => child.emit("error", new Error("ENOENT")));
  const result = await promise;
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("aplicaciones: espera el inicio del proceso y nunca usa un shell", async () => {
  const child = new EventEmitter();
  let unreferenced = false;
  child.unref = () => { unreferenced = true; };
  const promise = executeWithConfirmation({ target: "calc.exe", spawnImpl: (target, args, options) => {
    assert.equal(target, "calc.exe");
    assert.deepEqual(args, []);
    assert.equal(options.shell, false);
    return child;
  } });
  assert.equal(unreferenced, false);
  queueMicrotask(() => child.emit("spawn"));
  assert.equal((await promise).ok, true);
  assert.equal(unreferenced, true);
});
