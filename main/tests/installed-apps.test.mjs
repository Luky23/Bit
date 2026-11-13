import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstalledApps } from "../src/core/installed-apps.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bit-app-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const menu = join(root, "menu");
  const programs = join(root, "programs");
  await mkdir(menu); await mkdir(programs);
  const target = join(programs, "word.exe");
  const shortcut = join(menu, "Microsoft Word.lnk");
  await writeFile(target, "fixture"); await writeFile(shortcut, "fixture");
  const calls = [], logs = [];
  const details = { target, args: "", cwd: "" };
  let approval = true;
  const options = {
    roots: [menu], targetRoots: [programs], readShortcut: () => ({ ...details }),
    openPath: async (path) => { calls.push(path); return ""; },
    confirm: async () => approval,
    audit: async (event) => { logs.push(event); },
  };
  return { menu, programs, target, shortcut, calls, logs, details, options, reject: () => { approval = false; } };
}

test("apps instaladas: encuentra por palabras y abre solo el destino validado", async (t) => {
  const f = await fixture(t);
  const apps = createInstalledApps(f.options);
  assert.deepEqual(await apps.search("word"), { results: [{ name: "Microsoft Word" }] });
  assert.equal((await apps.open("word")).ok, true);
  assert.deepEqual(f.calls, [f.target]);
  assert.equal(f.logs.at(-1).status, "completed");
  assert.equal((await apps.open("ord")).ok, false);
});

test("navegadores: solo resuelve el ejecutable fijo solicitado, no argumentos del acceso", async (t) => {
  const f = await fixture(t);
  assert.equal(await createInstalledApps(f.options).browserTarget("firefox.exe"), "firefox.exe");
  await assert.rejects(createInstalledApps(f.options).browserTarget("cmd.exe"), /no permitido/);
  await writeFile(join(f.menu, "Google Chrome.lnk"), "fixture");
  await assert.rejects(createInstalledApps(f.options).browserTarget("chrome.exe"), /no apunta/);
  const chrome = join(f.programs, "chrome.exe");
  await writeFile(chrome, "fixture");
  f.details.target = chrome;
  f.details.args = "--load-extension=malicioso";
  assert.equal(await createInstalledApps(f.options).browserTarget("chrome.exe"), chrome);
  assert.deepEqual(f.calls, []);
});

test("apps instaladas: cancelación, ambigüedad y nombres de ruta no ejecutan", async (t) => {
  const f = await fixture(t);
  f.reject();
  assert.equal((await createInstalledApps(f.options).open("word")).cancelled, true);
  await writeFile(join(f.menu, "Word Viewer.lnk"), "fixture");
  assert.match((await createInstalledApps(f.options).open("word")).error, /varias coincidencias/);
  assert.equal((await createInstalledApps(f.options).open("../../word.exe")).ok, false);
  assert.deepEqual(f.calls, []);
});

test("apps instaladas: bloquea shells, scripts, destinos fuera de instalación y repositorio", async (t) => {
  const f = await fixture(t);
  for (const name of ["cmd.exe", "powershell.exe", "node.exe", "programa.py"]) {
    const path = join(f.programs, name);
    await writeFile(path, "fixture"); f.details.target = path;
    assert.equal((await createInstalledApps(f.options).open("word")).ok, false);
  }
  f.details.target = f.target;
  assert.equal((await createInstalledApps({ ...f.options, targetRoots: [f.menu] }).open("word")).ok, false);
  assert.equal((await createInstalledApps({ ...f.options, blockedRoots: [f.programs] }).open("word")).ok, false);
  assert.deepEqual(f.calls, []);
});

test("apps instaladas: revalida tras aprobar y comunica errores de Windows", async (t) => {
  const f = await fixture(t);
  const apps = createInstalledApps({ ...f.options, confirm: async () => { f.details.args = "--cambio"; return true; } });
  assert.match((await apps.open("word")).error, /cambió/);
  assert.deepEqual(f.calls, []);
  f.details.args = "";
  const error = await createInstalledApps({ ...f.options, openPath: async () => "Windows rechazó la apertura" }).open("word");
  assert.equal(error.ok, false);
  assert.match(error.error, /Windows rechazó/);
  assert.equal(f.logs.at(-1).status, "failed");
});
