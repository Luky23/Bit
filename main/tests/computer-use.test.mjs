import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateToolInput, listSchemas } from "../src/core/validation.mjs";
import { requiresExecutionAuthorization, resolveSandboxedFile, validateExecutionTarget } from "../src/screen/exec-tools.mjs";

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

test("exec-tools: valida URLs web mientras que el ejecutor reserva internet para net-gateway", () => {
  assert.deepEqual(validateExecutionTarget("https://github.com"), { ok: true, type: "url" });
  assert.deepEqual(validateExecutionTarget("http://localhost:3000"), { ok: true, type: "url" });
});

test("exec-tools: validateExecutionTarget permite protocolos Windows", () => {
  assert.deepEqual(validateExecutionTarget("ms-settings:"), { ok: true, type: "protocol" });
  assert.deepEqual(validateExecutionTarget("ms-photos:"), { ok: true, type: "protocol" });
  assert.equal(validateExecutionTarget("javascript:alert(1)").ok, false);
  assert.equal(validateExecutionTarget("custom-protocol:run").ok, false);
});

test("exec-tools: los documentos solo se abren desde el sandbox", () => {
  assert.equal(validateExecutionTarget("documento.pdf").ok, false);
  assert.equal(validateExecutionTarget("nota.md").ok, false);
});

test("exec-tools: resolveSandboxedFile acepta documentos locales y bloquea traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-exec-sandbox-"));
  try {
    await writeFile(join(root, "nota.pdf"), "contenido", "utf8");
    const safe = await resolveSandboxedFile({ root, target: "nota.pdf" });
    assert.equal(safe.ok, true);
    assert.ok(safe.absolutePath.endsWith("nota.pdf"));
    assert.equal((await resolveSandboxedFile({ root, target: "../fuera.pdf" })).ok, false);
    assert.equal((await resolveSandboxedFile({ root, target: "C:\\Windows\\archivo.pdf" })).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exec-tools: bloquea scripts, documentos activos y rutas file: remotas", () => {
  for (const target of [
    "script.js",
    "tool.py",
    "page.html",
    "vector.svg",
    "file:///C:/Users/Luca/script.js",
    "file://servidor/compartido/nota.txt",
  ]) {
    assert.equal(validateExecutionTarget(target).ok, false, target);
  }
});

test("exec-tools: validateExecutionTarget permite .exe en directorios seguros", () => {
  assert.deepEqual(validateExecutionTarget("C:\\Program Files\\App\\app.exe"), { ok: true, type: "executable" });
  // cmd.exe queda bloqueado por la lista de shells destructivas.
  assert.equal(validateExecutionTarget("C:\\Windows\\System32\\cmd.exe").ok, false);
  assert.equal(validateExecutionTarget("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe").ok, false);
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

test("exec-tools: validateExecutionTarget BLOQUEA instaladores, gestores de paquetes y shells", () => {
  const blocked = [
    "npm install -g something",
    "choco install vlc",
    "winget install --id Valve.Steam",
    "msiexec /i paquete.msi",
    "apt install curl",
    "pip install requests",
    "pwsh -Command Remove-Item -Recurse C:\\",
    "regedit /s cambio.reg",
    "format C:",
    "reboot",
    "taskkill /IM notepad.exe",
  ];
  for (const target of blocked) {
    assert.equal(validateExecutionTarget(target).ok, false, target);
  }
  // Objetivos legítimos que no deben caer en la regex
  assert.equal(validateExecutionTarget("notepad.exe").ok, true);
  assert.equal(validateExecutionTarget("documento.md").ok, false);
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

test("exec-tools: solo lo que modifica el equipo o lanza algo pide autorización", () => {
  // Lanzar un ejecutable o abrir una superficie del sistema -> PREGUNTA
  assert.equal(requiresExecutionAuthorization({ target: "calc.exe", type: "executable" }), false);
  assert.equal(requiresExecutionAuthorization({ target: "C:\\Program Files\\App\\app.exe", type: "executable" }), false);
  assert.equal(requiresExecutionAuthorization({ target: "msconfig.exe", type: "executable" }), false);
  assert.equal(requiresExecutionAuthorization({ target: "calc.exe", args: "--unsafe", type: "executable" }), true);
  assert.equal(requiresExecutionAuthorization({ target: "ms-settings:", type: "protocol" }), true);
  // Abrir un documento local o una URL de loopback es seguro -> NO PREGUNTA
  assert.equal(requiresExecutionAuthorization({ target: "nota.pdf", type: "file" }), false);
  assert.equal(requiresExecutionAuthorization({ target: "informe.md", type: "file" }), false);
  assert.equal(requiresExecutionAuthorization({ target: "http://localhost:3000", type: "url" }), false);
  // Ante la duda se pregunta
  assert.equal(requiresExecutionAuthorization(), true);
  assert.equal(requiresExecutionAuthorization({ target: "algo", type: "desconocido" }), true);
});
