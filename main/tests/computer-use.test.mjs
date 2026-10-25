import test from "node:test";
import assert from "node:assert/strict";
import { validateToolInput, listSchemas } from "../src/core/validation.mjs";
import { validateExecutionTarget } from "../src/screen/exec-tools.mjs";

test("validation: esquemas de computer use registrados", () => {
  const schemas = listSchemas();
  assert.ok(schemas.includes("bit:system-capture-screen"));
  assert.ok(schemas.includes("bit:system-open-app"));
});

test("system-capture-screen: valida prompt requerido", () => {
  const result = validateToolInput("bit:system-capture-screen", {});
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("prompt"));
});

test("system-capture-screen: acepta prompt y opcionales", () => {
  const result = validateToolInput("bit:system-capture-screen", {
    prompt: "¿Qué hay en pantalla?",
    visionModel: "llava",
    maxSide: 1280,
  });
  assert.equal(result.ok, true);
});

test("system-capture-screen: rechaza maxSide fuera de rango", () => {
  const result = validateToolInput("bit:system-capture-screen", {
    prompt: "test",
    maxSide: 500, // mínimo 640
  });
  assert.equal(result.ok, false);
});

test("system-open-app: valida target requerido", () => {
  const result = validateToolInput("bit:system-open-app", {});
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("target"));
});

test("system-open-app: acepta target válido", () => {
  const result = validateToolInput("bit:system-open-app", {
    target: "notepad.exe",
    args: "",
  });
  assert.equal(result.ok, true);
});

test("exec-tools: validateExecutionTarget permite ejecutables en whitelist", () => {
  assert.deepEqual(validateExecutionTarget("notepad.exe"), { ok: true, type: "executable" });
  assert.deepEqual(validateExecutionTarget("calc.exe"), { ok: true, type: "executable" });
  assert.deepEqual(validateExecutionTarget("code.exe"), { ok: true, type: "executable" });
});

test("exec-tools: validateExecutionTarget permite URLs https/http", () => {
  assert.deepEqual(validateExecutionTarget("https://github.com"), { ok: true, type: "url" });
  assert.deepEqual(validateExecutionTarget("http://localhost:3000"), { ok: true, type: "url" });
});

test("exec-tools: validateExecutionTarget permite protocolos Windows", () => {
  assert.deepEqual(validateExecutionTarget("ms-settings:"), { ok: true, type: "protocol" });
  assert.deepEqual(validateExecutionTarget("ms-photos:"), { ok: true, type: "protocol" });
});

test("exec-tools: validateExecutionTarget permite archivos con extensiones permitidas", () => {
  assert.deepEqual(validateExecutionTarget("documento.pdf"), { ok: true, type: "file" });
  assert.deepEqual(validateExecutionTarget("script.js"), { ok: true, type: "file" });
  assert.deepEqual(validateExecutionTarget("nota.md"), { ok: true, type: "file" });
});

test("exec-tools: validateExecutionTarget permite .exe en directorios seguros", () => {
  assert.deepEqual(validateExecutionTarget("C:\\Program Files\\App\\app.exe"), { ok: true, type: "executable" });
  assert.deepEqual(validateExecutionTarget("C:\\Windows\\System32\\cmd.exe"), { ok: true, type: "executable" });
});

test("exec-tools: validateExecutionTarget BLOQUEA comandos peligrosos", () => {
  // PowerShell con comandos complejos
  assert.equal(validateExecutionTarget("powershell -c rm -rf /").ok, false);
  assert.equal(validateExecutionTarget("cmd /c del /f *").ok, false);
  // Rutas arbitrarias
  assert.equal(validateExecutionTarget("C:\\Temp\\malware.exe").ok, false);
  // Inyección de comandos
  assert.equal(validateExecutionTarget("notepad.exe && rm -rf /").ok, false);
  assert.equal(validateExecutionTarget("calc.exe; shutdown /s").ok, false);
});

test("exec-tools: validateExecutionTarget BLOQUEA extensiones no permitidas", () => {
  assert.equal(validateExecutionTarget("script.bat").ok, false);
  assert.equal(validateExecutionTarget("malware.scr").ok, false);
  assert.equal(validateExecutionTarget("evil.vbs").ok, false);
});

test("exec-tools: validateExecutionTarget BLOQUEA rutas arbitrarias", () => {
  assert.equal(validateExecutionTarget("C:\\Users\\user\\AppData\\Local\\Temp\\x.exe").ok, false);
  assert.equal(validateExecutionTarget("C:\\Windows\\Temp\\x.exe").ok, false);
});