/**
 * Automatización de Windows para Bit (computer use).
 *
 * Ejecuta un helper PowerShell FIJO (win-input.ps1) con verbos cerrados.
 * No hay shell libre: el modelo nunca pasa comandos, solo parámetros
 * validados que viajan como argv literal (spawn sin shell).
 * El texto a escribir en otras apps no pasa por acá: se coloca en el
 * clipboard de Electron y se envía con el combo ctrl+v.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WIN_HELPER_PATH = fileURLToPath(new URL("../win32/win-input.ps1", import.meta.url));

export const WIN_VERBS = Object.freeze(["list", "focus", "key", "click"]);

const MAX_TITLE_PATTERN = 200;
const MAX_CLICK_COORD = 32767;
const MAX_WINDOW_TITLE = 300;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Modificadores permitidos y su representación en SendKeys. */
const MODIFIER_TOKENS = Object.freeze({ ctrl: "^", alt: "%", shift: "+" });

/** Teclas simples permitidas y su representación en SendKeys. */
const SIMPLE_KEY_TOKENS = Object.freeze({
  enter: "{ENTER}",
  esc: "{ESC}",
  tab: "{TAB}",
  backspace: "{BS}",
  delete: "{DEL}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  space: " ",
});

/** Caracteres que romperían el parseo de argumentos de powershell -File. */
const FORBIDDEN_PATTERN_CHARS = /["`\u0000-\u001f\u007f]/;

/**
 * Valida el patrón de título de ventana que viajará al helper.
 * Devuelve el patrón recortado o lanza Error.
 */
export function sanitizeTitlePattern(pattern) {
  if (typeof pattern !== "string") {
    throw new Error("title debe ser una cadena de texto");
  }
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error("title no puede estar vacío");
  }
  if (trimmed.length > MAX_TITLE_PATTERN) {
    throw new Error(`title supera ${MAX_TITLE_PATTERN} caracteres`);
  }
  if (FORBIDDEN_PATTERN_CHARS.test(trimmed)) {
    throw new Error('title contiene caracteres no permitidos (comillas, backticks o control)');
  }
  if (trimmed.startsWith("-")) {
    throw new Error("title no puede empezar con guion (lo interpretaría PowerShell como parámetro)");
  }
  return trimmed;
}

/**
 * Convierte un combo tipo "ctrl+shift+p" a la notación de SendKeys ("^+p").
 * Solo acepta la whitelist: modificadores ctrl/alt/shift y una tecla final
 * de una letra, un dígito o una tecla simple conocida.
 */
export function parseKeyCombo(combo) {
  if (typeof combo !== "string" || !combo.trim()) {
    throw new Error("combo vacío");
  }
  const tokens = combo
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());
  if (tokens.length < 1 || tokens.length > 4) {
    throw new Error(`combo inválido: ${combo}`);
  }
  const finalToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, -1);

  const seen = new Set();
  let prefix = "";
  for (const modifier of modifierTokens) {
    if (!(modifier in MODIFIER_TOKENS)) {
      throw new Error(`modificador no permitido: ${modifier}`);
    }
    if (seen.has(modifier)) {
      throw new Error(`modificador repetido: ${modifier}`);
    }
    seen.add(modifier);
    prefix += MODIFIER_TOKENS[modifier];
  }

  if (/^[a-z0-9]$/.test(finalToken)) {
    return prefix + finalToken;
  }
  if (finalToken in SIMPLE_KEY_TOKENS) {
    return prefix + SIMPLE_KEY_TOKENS[finalToken];
  }
  throw new Error(`tecla final no permitida: ${finalToken}`);
}

function assertNoExtraParams(verb, params, allowed) {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) {
      throw new Error(`parámetro desconocido para ${verb}: ${key}`);
    }
  }
}

function parseCoordinate(value, name) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} debe ser un entero`);
  }
  if (value < 0 || value > MAX_CLICK_COORD) {
    throw new Error(`${name} fuera de rango (0..${MAX_CLICK_COORD})`);
  }
  return String(value);
}

/**
 * Construye el argv literal para powershell -File (sin shell, sin -Command).
 * Lanza Error si el verbo o los parámetros no pasan la validación.
 */
export function buildHelperArgs(verb, params = {}) {
  if (!WIN_VERBS.includes(verb)) {
    throw new Error(`verbo no permitido: ${verb}`);
  }
  switch (verb) {
    case "list": {
      assertNoExtraParams(verb, params, []);
      return [];
    }
    case "focus": {
      assertNoExtraParams(verb, params, ["title"]);
      if (!("title" in params)) {
        throw new Error("falta el parámetro title para focus");
      }
      return [sanitizeTitlePattern(params.title)];
    }
    case "key": {
      assertNoExtraParams(verb, params, ["combo"]);
      if (!("combo" in params)) {
        throw new Error("falta el parámetro combo para key");
      }
      return [parseKeyCombo(params.combo)];
    }
    case "click": {
      assertNoExtraParams(verb, params, ["x", "y"]);
      if (!("x" in params) || !("y" in params)) {
        throw new Error("faltan los parámetros x e y para click");
      }
      return [parseCoordinate(params.x, "x"), parseCoordinate(params.y, "y")];
    }
    default:
      throw new Error(`verbo no permitido: ${verb}`);
  }
}

/**
 * Parsea la salida JSON del helper. Tolera ruido de una línea antes del JSON.
 * ok:false se convierte en Error con el mensaje del helper.
 */
export function parseHelperOutput(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    throw new Error("salida vacía del helper de Windows");
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const lastLine = lines[lines.length - 1] ?? "";
    try {
      data = JSON.parse(lastLine);
    } catch {
      throw new Error("la salida del helper de Windows no es JSON válido");
    }
  }
  if (data && data.ok === false) {
    throw new Error(typeof data.error === "string" && data.error ? data.error : "el helper de Windows falló");
  }
  return data;
}

function defaultSpawnImpl(file, args) {
  return spawn(file, args, { windowsHide: true, shell: false });
}

/**
 * Ejecuta el helper con un verbo ya validado.
 * @param {{verb: string, params?: object, timeoutMs?: number, spawnImpl?: Function}} options
 */
export function runWinCommand({ verb, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = defaultSpawnImpl }) {
  const args = buildHelperArgs(verb, params);
  const argv = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    WIN_HELPER_PATH,
    verb,
    ...args,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl("powershell.exe", argv);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // el proceso ya terminó
      }
      reject(new Error(`timeout de ${timeoutMs} ms ejecutando el helper de Windows (${verb})`));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code === 0) {
        try {
          finish(resolve, parseHelperOutput(stdout));
        } catch (error) {
          finish(reject, error);
        }
        return;
      }
      const detail = (stderr || stdout).trim().slice(0, 400);
      finish(reject, new Error(`el helper de Windows salió con código ${code}${detail ? `: ${detail}` : ""}`));
    });
  });
}

/** Lista las ventanas visibles: [{hwnd, pid, process, title}]. */
export async function listWindows(options = {}) {
  const data = await runWinCommand({ verb: "list", params: {}, ...options });
  if (!Array.isArray(data.windows)) {
    return [];
  }
  return data.windows
    .filter((entry) => entry && typeof entry === "object" && typeof entry.title === "string")
    .map((entry) => ({
      hwnd: Number(entry.hwnd),
      pid: Number(entry.pid),
      process: typeof entry.process === "string" ? entry.process : "",
      title: entry.title.slice(0, MAX_WINDOW_TITLE),
    }))
    .filter((entry) => Number.isFinite(entry.hwnd));
}

/** Enfoca la primera ventana visible cuyo título contiene el patrón. */
export async function focusWindow(title, options = {}) {
  const data = await runWinCommand({ verb: "focus", params: { title }, ...options });
  return data.focused === true;
}

/** Envía un combo de teclas a la ventana en primer plano. */
export async function sendKeyCombo(combo, options = {}) {
  await runWinCommand({ verb: "key", params: { combo }, ...options });
}

/** Mueve el cursor y hace clic izquierdo en coordenadas físicas. */
export async function clickAt(x, y, options = {}) {
  await runWinCommand({ verb: "click", params: { x, y }, ...options });
}
