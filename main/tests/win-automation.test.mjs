import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  WIN_VERBS,
  WIN_HELPER_PATH,
  parseKeyCombo,
  sanitizeTitlePattern,
  buildHelperArgs,
  parseHelperOutput,
  runWinCommand,
  listWindows,
  focusWindow,
} from "../src/core/win-automation.mjs";

/** Cuerpo falso de proceso: mismos eventos que un child_process real. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

test("win-automation: verbos cerrados (sin verbos libres)", () => {
  assert.deepEqual([...WIN_VERBS], ["list", "focus", "key", "click"]);
  assert.throws(() => buildHelperArgs("eval", {}), /no permitido/);
  assert.throws(() => buildHelperArgs("exec", {}), /no permitido/);
  assert.throws(() => buildHelperArgs("", {}), /no permitido/);
});

test("parseKeyCombo: convierte combos válidos a notación SendKeys", () => {
  assert.equal(parseKeyCombo("ctrl+v"), "^v");
  assert.equal(parseKeyCombo("ctrl+a"), "^a");
  assert.equal(parseKeyCombo("Ctrl+Shift+p"), "^+p");
  assert.equal(parseKeyCombo("shift+enter"), "+{ENTER}");
  assert.equal(parseKeyCombo("ctrl+enter"), "^{ENTER}");
  assert.equal(parseKeyCombo("enter"), "{ENTER}");
  assert.equal(parseKeyCombo("esc"), "{ESC}");
  assert.equal(parseKeyCombo("tab"), "{TAB}");
  assert.equal(parseKeyCombo("up"), "{UP}");
  assert.equal(parseKeyCombo("g"), "g");
  assert.equal(parseKeyCombo("5"), "5");
});

test("parseKeyCombo: rechaza entradas que no son combos de la whitelist", () => {
  const invalidos = [
    "",
    "   ",
    "ctrl",
    "ctrl+",
    "+v",
    "super+v",
    "meta+v",
    "ctrl+ctrl+v",
    "ctrl+alt+shift+ctrl+a",
    "ctrl+v extra",
    "^v", // notación SendKeys cruda no se acepta como entrada
    "ctrl+%v",
    "ctrl+{ENTER}",
    "ctrl+;+v",
    "tab+enter", // modifiers solo de la whitelist: tab no es modifier
  ];
  for (const combo of invalidos) {
    assert.throws(() => parseKeyCombo(combo), undefined, `debería rechazar: ${JSON.stringify(combo)}`);
  }
});

test("sanitizeTitlePattern: acepta títulos de ventana razonables", () => {
  assert.equal(sanitizeTitlePattern("Visual Studio Code"), "Visual Studio Code");
  assert.equal(sanitizeTitlePattern("  main.mjs - Bit - Visual Studio Code  "), "main.mjs - Bit - Visual Studio Code");
  assert.equal(sanitizeTitlePattern("Bit (admin) [1]"), "Bit (admin) [1]");
});

test("sanitizeTitlePattern: rechaza patrones peligrosos o vacíos", () => {
  const invalidos = [
    "",
    "     ",
    "a".repeat(201),
    'notepad" ',
    "back`tick",
    "con\nnewline",
    "con\ttab",
    "-Empieza con guion", // PowerShell lo interpretaría como nombre de parámetro
    42,
    null,
    undefined,
    ["Visual Studio Code"],
  ];
  for (const pattern of invalidos) {
    assert.throws(() => sanitizeTitlePattern(pattern), undefined, `debería rechazar: ${JSON.stringify(pattern)}`);
  }
});

test("buildHelperArgs: construye argv sin shell para cada verbo", () => {
  assert.deepEqual(buildHelperArgs("list", {}), []);
  assert.deepEqual(buildHelperArgs("focus", { title: "Visual Studio Code" }), ["Visual Studio Code"]);
  assert.deepEqual(buildHelperArgs("key", { combo: "ctrl+v" }), ["^v"]);
  assert.deepEqual(buildHelperArgs("click", { x: 100, y: 200 }), ["100", "200"]);
});

test("buildHelperArgs: valida parámetros y rechaza extras", () => {
  assert.throws(() => buildHelperArgs("focus", {}), /title/);
  assert.throws(() => buildHelperArgs("focus", { title: 'malo"' }), /title|inválido|caracteres/i);
  assert.throws(() => buildHelperArgs("focus", { title: "vs", extra: 1 }), /desconocido/);
  assert.throws(() => buildHelperArgs("key", {}), /combo/);
  assert.throws(() => buildHelperArgs("key", { combo: "super+q" }), /no permitido/i);
  assert.throws(() => buildHelperArgs("click", { x: -1, y: 10 }), /x/);
  assert.throws(() => buildHelperArgs("click", { x: 40000, y: 10 }), /x/);
  assert.throws(() => buildHelperArgs("click", { x: 10.5, y: 10 }), /x/);
  assert.throws(() => buildHelperArgs("click", { x: 10 }), /y/);
  assert.throws(() => buildHelperArgs("list", { title: "x" }), /desconocido/);
});

test("parseHelperOutput: JSON válido con ok:true", () => {
  const data = parseHelperOutput('{"ok":true,"windows":[{"hwnd":1,"title":"VS"}]}');
  assert.equal(data.ok, true);
  assert.equal(data.windows[0].title, "VS");
});

test("parseHelperOutput: extrae la última línea si hay ruido antes", () => {
  const data = parseHelperOutput('Aviso del sistema\n{"ok":true,"focused":true}\n');
  assert.equal(data.ok, true);
  assert.equal(data.focused, true);
});

test("parseHelperOutput: rechaza ok:false, vacío o basura", () => {
  assert.throws(() => parseHelperOutput('{"ok":false,"error":"sin ventana"}'), /sin ventana/);
  assert.throws(() => parseHelperOutput(""), /vacía/i);
  assert.throws(() => parseHelperOutput("   \n "), /vacía/i);
  assert.throws(() => parseHelperOutput("esto no es json"), /JSON/);
});

test("runWinCommand: ejecuta powershell con -File y argv literal (sin shell)", async () => {
  const calls = [];
  const spawnImpl = (file, args) => {
    calls.push({ file, args });
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.write('{"ok":true,"focused":true}\n');
      child.emit("close", 0);
    });
    return child;
  };
  const data = await runWinCommand({ verb: "focus", params: { title: "Visual Studio Code" }, spawnImpl });
  assert.equal(data.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "powershell.exe");
  const { file, args } = calls[0];
  assert.ok(args.includes("-NoProfile"));
  assert.ok(args.includes("-NonInteractive"));
  assert.ok(args.includes("-File"));
  assert.ok(args.includes(WIN_HELPER_PATH));
  assert.equal(args[args.length - 2], "focus");
  assert.equal(args[args.length - 1], "Visual Studio Code");
  assert.ok(!args.some((a) => a === "-Command" || a === "-EncodedCommand"), "no debe usar -Command");
  assert.ok(file === "powershell.exe");
});

test("runWinCommand: exit code distinto de cero rechaza con el stderr", async () => {
  const spawnImpl = () => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stderr.write("Add-Type falló");
      child.emit("close", 1);
    });
    return child;
  };
  await assert.rejects(
    () => runWinCommand({ verb: "list", params: {}, spawnImpl }),
    /Add-Type falló/,
  );
});

test("runWinCommand: mata el proceso si excede el timeout", async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  await assert.rejects(
    () => runWinCommand({ verb: "list", params: {}, spawnImpl, timeoutMs: 30 }),
    /timeout/i,
  );
  assert.equal(child.killed, true);
});

test("runWinCommand: error de spawn (powershell ausente) se propaga", async () => {
  const spawnImpl = () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
    return child;
  };
  await assert.rejects(() => runWinCommand({ verb: "list", params: {}, spawnImpl }), /ENOENT/);
});

test("listWindows: valida y filtra la salida del helper", async () => {
  const spawnImpl = () => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.write(
        JSON.stringify({
          ok: true,
          windows: [
            { hwnd: "42", pid: 1, process: "Code", title: "main.mjs - Bit - Visual Studio Code" },
            { hwnd: "43", pid: 2, process: "explorer", title: 123 }, // basura: título no string
            " basura ",
          ],
        }),
      );
      child.emit("close", 0);
    });
    return child;
  };
  const windows = await listWindows({ spawnImpl });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].title, "main.mjs - Bit - Visual Studio Code");
  assert.equal(windows[0].process, "Code");
});

test("focusWindow: devuelve false cuando ninguna ventana coincide", async () => {
  const spawnImpl = () => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.write('{"ok":true,"focused":false,"needle":"NoExiste"}');
      child.emit("close", 0);
    });
    return child;
  };
  assert.equal(await focusWindow("NoExiste", { spawnImpl }), false);
});
