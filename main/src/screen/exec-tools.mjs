/**
 * App Execution Module - valida y ejecuta objetivos mediante la política central
 * de permisos; los destinos no confiables o de riesgo alto nunca se autoautorizan.
 */

import pkg from "electron";
const { shell, dialog } = pkg;
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { enforceSandbox } from "../core/sandbox.mjs";
import { requiresExecutionAuthorization } from "../core/permission-policy.mjs";

/**
 * Lista blanca de ejecutables permitidos (nombres base, sin ruta)
 * Solo comandos simples, sin argumentos complejos de shell
 * NOTA: cmd.exe, powershell.exe, pwsh.exe, regedit.exe SON INTENCIONALMENTE EXCLUIDOS por riesgo de seguridad
 */
const ALLOWED_EXECUTABLES = new Set([
  // Windows built-ins (sin cmd/powershell/regedit - riesgo de seguridad)
  "calc.exe", "notepad.exe", "mspaint.exe", "write.exe", "wordpad.exe",
  "explorer.exe", "control.exe", "msconfig.exe", "taskmgr.exe",
  "snippingtool.exe", "ms-settings:", "ms-photos:",
  // Dev tools (si están en PATH)
  "code.exe", "code-insiders.exe", "vim.exe", "nvim.exe",
  // Common apps
  "chrome.exe", "firefox.exe", "msedge.exe", "brave.exe",
  "vlc.exe", "spotify.exe", "discord.exe", "teams.exe",
]);

/**
 * Patrones permitidos para URLs/rutas
 */
const URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const WINDOWS_PROTOCOLS = new Set(["ms-settings:", "ms-photos:"]);
const FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".css",
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".mp3", ".wav", ".mp4", ".mkv", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
]);

/**
 * Instaladores, gestores de paquetes, shells y comandos destructivos.
 * Se aplica a cualquier objetivo antes de cualquier validación permisiva.
 * NOTA: `spawn` corre con `shell: false`, así que el control real es el primer
 * token; esta regex es defensa en profundidad.
 */
const DANGEROUS_COMMAND_RE = /\b(npm|choco|winget|msiexec|apt|pip|powershell|pwsh|cmd|regedit|format|shutdown|reboot|rm|del|taskkill)\b/i;

function isLoopbackHost(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

/**
 * Valida si un target es seguro para ejecutar
 * @param {string} target - Comando, ruta o URL
 * @returns {{ok: boolean, reason?: string, type: "executable"|"url"|"file"|"protocol"}}
 */
export function validateExecutionTarget(target) {
  let trimmed = target.trim();

  // Remover sintaxis de enlace markdown [texto](url) si está presente
  if (trimmed.startsWith('[') && trimmed.includes('](')) {
    const openingParenIdx = trimmed.indexOf('](');
    if (openingParenIdx > 0) {
      trimmed = trimmed.substring(openingParenIdx + 2); // Quitar [texto] y dejar solo la URL
    }
  }

  // RECHAZO TEMPRANO: Detectar patrones peligrosos ANTES de cualquier validación permisiva
  if (trimmed.includes('..')) {
    return { ok: false, reason: "Patrón peligroso detectado (path traversal)", type: "blocked" };
  }
  // Instaladores, gestores de paquetes, variables de entorno y shells destructivos.
  if (DANGEROUS_COMMAND_RE.test(trimmed)) {
    return { ok: false, reason: "Patrón peligroso detectado (comando o gestor bloqueado)", type: "blocked" };
  }
  const destructivePatterns = /\b(rm|del|format|shutdown|reboot|taskkill|rd|rmdir)\b/i;
  if (destructivePatterns.test(trimmed)) {
    return { ok: false, reason: "Patrón peligroso detectado (comando destructivo)", type: "blocked" };
  }
  if (/[%{}]/.test(trimmed)) {
    return { ok: false, reason: "Patrón peligroso detectado (variables entorno)", type: "blocked" };
  }

  // 1. URLs locales. Las públicas deben pasar por net-gateway.
  try {
    const url = new URL(trimmed);
    if (url.protocol === "file:") {
      return { ok: false, reason: "Las rutas file: solo se abren mediante el sandbox local de Bit", type: "blocked" };
    }
    if (URL_PROTOCOLS.has(url.protocol) && !/^[a-z]:\\/i.test(trimmed)) {
      return { ok: true, type: "url" };
    }
  } catch { /* no es URL válida */ }

  // 2. Protocolo Windows especial - BLOQUEAR protocolos de confianza baja
  if (/^[a-z-]+:/i.test(trimmed) && !trimmed.includes("\\") && !trimmed.includes("/")) {
    const trimmedLower = trimmed.toLowerCase();
    if (WINDOWS_PROTOCOLS.has(trimmedLower)) {
      return { ok: true, type: "protocol" };
    }
    return { ok: false, reason: "Protocolo no permitido", type: "blocked" };
  }

  // 3. Los documentos se abren exclusivamente por `openSandboxedFile`, que
  // valida su pertenencia al raíz local antes de llamar a shell.openPath.
  const ext = trimmed.toLowerCase().substring(trimmed.toLowerCase().lastIndexOf("."));
  if (FILE_EXTENSIONS.has(ext) && !trimmed.includes("\\") && !trimmed.includes("/")) {
    return { ok: false, reason: "Los documentos deben abrirse desde la carpeta segura de Bit", type: "blocked" };
  }

  // 4. Ejecutable en whitelist (SOLO nombre base, SIN argumentos, SIN ruta)
  const baseName = trimmed.toLowerCase();
  if (ALLOWED_EXECUTABLES.has(baseName) && !trimmed.includes(" ") && !trimmed.includes("\\") && !trimmed.includes("/")) {
    return { ok: true, type: "executable" };
  }

  // 5. Ruta absoluta a .exe SOLO en directorios seguros
  if (trimmed.toLowerCase().endsWith(".exe")) {
    const safeDirs = [
      "C:\\Program Files\\",
      "C:\\Program Files (x86)\\",
      "C:\\Windows\\",
      "C:\\Windows\\System32\\",
    ];
    const upper = trimmed.toUpperCase();
    const inSafeDir = safeDirs.some(dir => upper.startsWith(dir.toUpperCase()));
    const noTraversal = !upper.includes("..") && !upper.includes("TEMP") && !upper.includes("APPDATA") && !upper.includes("LOCALAPPDATA");
    if (inSafeDir && noTraversal) {
      return { ok: true, type: "executable" };
    }
  }

  return {
    ok: false,
    reason: "Objetivo no permitido: solo ejecutables locales en whitelist, archivos permitidos o protocolos Windows aprobados",
    type: "blocked",
  };
}

/**
 * Resuelve y comprueba un documento dentro del sandbox antes de abrirlo. Esta
 * ruta no usa diálogos porque no ejecuta procesos ni admite destinos externos.
 *
 * @param {{root: string, target: string}} options
 * @returns {Promise<{ok: boolean, absolutePath?: string, error?: string}>}
 */
export async function resolveSandboxedFile({ root, target }) {
  let absolutePath;
  try {
    absolutePath = await enforceSandbox(root, target);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) return { ok: false, error: "El archivo no existe dentro de la carpeta segura de Bit" };
  return { ok: true, absolutePath };
}

/**
 * Consulta la política central para decidir si una operación validada requiere confirmación.
 *
 * @param {{type?: string}} [targetInfo] Resultado de `validateExecutionTarget`
 * @returns {boolean}
 */
export { requiresExecutionAuthorization };

/**
 * Ejecuta un objetivo local validado y solicita confirmación cuando la política lo exige
 * Para ejecutables usa spawn (desacoplado) en lugar de execFile para no matar la app al pasar el timeout.
 * @param {Object} options
 * @param {string} options.target - Comando, app, URL o ruta
 * @param {string} options.args - Argumentos adicionales (solo para ejecutables)
 * @param {BrowserWindow} mainWindow - Ventana principal para el dialog
 * @returns {Promise<{ok: boolean, result?: string, error?: string, cancelled?: boolean}>}
 */
export async function executeWithConfirmation({ target, args = "", mainWindow, spawnImpl = spawn, authorize, directUser = true }) {
  const validation = validateExecutionTarget(target);
  if (!validation.ok) {
    return { ok: false, error: validation.reason };
  }
  if (validation.type === "url") {
    const url = new URL(target);
    if ((url.protocol === "http:" || url.protocol === "https:") && !isLoopbackHost(url.hostname)) {
      return { ok: false, error: "Las direcciones de internet deben consultarse mediante net-gateway" };
    }
  }

  const permissionCategory = validation.type === "protocol"
    ? "system.settings"
    : validation.type === "url"
      ? "browser.open"
      : validation.type === "file"
        ? "file.read"
        : args.trim()
          ? "system.execute"
          : "app.open";
  if (authorize) {
    const allowed = await authorize({
      category: permissionCategory,
      action: "system.open",
      directUser,
      scopeAuthorized: true,
      reversible: validation.type === "file" || (validation.type === "executable" && !args.trim()),
      modifiesState: validation.type === "executable" || validation.type === "protocol",
      resource: validation.type === "executable" ? target : "",
    });
    if (allowed !== true) return { ok: false, cancelled: true };
  } else if (requiresExecutionAuthorization({ ...validation, args }, { directUser })) {
    const displayArgs = args ? ` con argumentos: ${args}` : "";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Autorizar acción sensible",
      message: "¿Desea permitir esta acción?",
      detail: `${target}${displayArgs}\n\nTipo: ${validation.type}. Si puede modificar el equipo o abrir contenido externo, cancele si no lo solicitó.`,
      buttons: ["Cancelar", "Permitir"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (result.response !== 1) {
      return { ok: false, cancelled: true };
    }
  }

  try {
    switch (validation.type) {
      case "url":
      case "protocol": {
        await shell.openExternal(target);
        return { ok: true, result: `Abierto en navegador/sistema: ${target}` };
      }

      case "file": {
        await shell.openPath(target);
        return { ok: true, result: `Archivo abierto: ${target}` };
      }

      case "executable": {
        // Usar spawn para ejecutar desacoplado (no bloquea, no mata al pasar timeout)
        const cmdArgs = (args ? args.trim().split(/\s+/) : []).filter(Boolean);
        const child = spawnImpl(target, cmdArgs, {
          detached: true,
          stdio: "ignore",
          shell: false,
        });
        await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("spawn", resolve);
        });
        child.unref();

        return {
          ok: true,
          result: `Ejecutado: ${target}${cmdArgs.length ? " " + cmdArgs.join(" ") : ""}`,
        };
      }

      default:
        return { ok: false, error: "Tipo de ejecución no manejado" };
    }
  } catch (error) {
    return {
      ok: false,
      error: `Error al ejecutar: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
