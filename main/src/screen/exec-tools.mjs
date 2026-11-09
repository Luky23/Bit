/**
 * App Execution Module - Abre aplicaciones nativas con consentimiento explícito
 * Zero-Trust: validación estricta, whitelist y confirmación para toda apertura o ejecución
 */

import pkg from "electron";
const { shell, dialog } = pkg;
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

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
const URL_PROTOCOLS = new Set(["file:", "http:", "https:", "mailto:", "tel:"]);
const WINDOWS_PROTOCOLS = new Set(["ms-settings:", "ms-photos:"]);
const FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".css",
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".mp3", ".wav", ".mp4", ".mkv", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
]);

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
      if (url.hostname && url.hostname !== "localhost") {
        return { ok: false, reason: "No se permiten rutas file: hacia ubicaciones de red", type: "blocked" };
      }
      const extension = extname(decodeURIComponent(url.pathname)).toLowerCase();
      if ([".js", ".ts", ".py", ".html", ".svg"].includes(extension)) {
        return { ok: false, reason: "Bit no puede abrir ni ejecutar scripts o documentos activos", type: "blocked" };
      }
      if (FILE_EXTENSIONS.has(extension)) return { ok: true, type: "url" };
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

  // 3. Ruta a archivo con extensión permitida (solo nombre de archivo, sin ruta)
  const ext = trimmed.toLowerCase().substring(trimmed.toLowerCase().lastIndexOf("."));
  if (FILE_EXTENSIONS.has(ext) && !trimmed.includes("\\") && !trimmed.includes("/")) {
    return { ok: true, type: "file" };
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

export function requiresExecutionAuthorization() {
  // Abrir una aplicación, un archivo, una pestaña o una superficie del sistema
  // modifica el estado visible del equipo. La lista blanca limita qué se puede
  // abrir, pero no sustituye el consentimiento del usuario.
  return true;
}

/**
 * Ejecuta un objetivo local validado y solicita confirmación para acciones sensibles
 * Para ejecutables usa spawn (desacoplado) en lugar de execFile para no matar la app al pasar el timeout.
 * @param {Object} options
 * @param {string} options.target - Comando, app, URL o ruta
 * @param {string} options.args - Argumentos adicionales (solo para ejecutables)
 * @param {BrowserWindow} mainWindow - Ventana principal para el dialog
 * @returns {Promise<{ok: boolean, result?: string, error?: string, cancelled?: boolean}>}
 */
export async function executeWithConfirmation({ target, args = "", mainWindow }) {
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

  if (requiresExecutionAuthorization()) {
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
        const child = spawn(target, cmdArgs, {
          detached: true,
          stdio: "ignore",
          shell: false,
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
