/**
 * App Execution Module - Abre aplicaciones nativas con consentimiento explícito
 * Zero-Trust: Validación estricta, whitelist, confirmación nativa obligatoria
 */

import pkg from "electron";
const { shell, dialog } = pkg;
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Lista blanca de ejecutables permitidos (nombres base, sin ruta)
 * Solo comandos simples, sin argumentos complejos de shell
 */
const ALLOWED_EXECUTABLES = new Set([
  // Windows built-ins
  "calc.exe", "notepad.exe", "mspaint.exe", "write.exe", "wordpad.exe",
  "cmd.exe", "powershell.exe", "pwsh.exe",
  "explorer.exe", "control.exe", "msconfig.exe", "regedit.exe", "taskmgr.exe",
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
const URL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
const FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".py", ".html", ".css",
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
  ".mp3", ".wav", ".mp4", ".mkv", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
]);

/**
 * Valida si un target es seguro para ejecutar
 * @param {string} target - Comando, ruta o URL
 * @returns {{ok: boolean, reason?: string, type: "executable"|"url"|"file"|"protocol"}}
 */
export function validateExecutionTarget(target) {
  const trimmed = target.trim();

  // RECHAZO TEMPRANO: Detectar patrones peligrosos ANTES de cualquier validación permisiva
  const dangerousPatterns = [
    /[;&|$`]/,                    // Inyección de shell: ; & | $ `
    /\b(rm|del|format|shutdown|reboot|taskkill|rd|rmdir)\b/i,  // Comandos destructivos
    /\.\./,                       // Path traversal
    /[%{}]/,                      // Variables de entorno expandidas
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: "Patrón peligroso detectado (inyección, comando destructivo, path traversal)", type: "blocked" };
    }
  }

  // 1. URL con protocolo conocido (solo http/https/mailto/tel, NO rutas de Windows como C:\)
  try {
    const url = new URL(trimmed);
    // Solo aceptar si el protocolo está en la whitelist Y no parece una ruta de Windows (ej: C:\)
    if (URL_PROTOCOLS.has(url.protocol) && !/^[a-z]:\\/i.test(trimmed)) {
      return { ok: true, type: "url" };
    }
  } catch { /* no es URL válida */ }

  // 2. Protocolo Windows especial (ms-settings:, ms-photos:, etc.)
  if (/^[a-z-]+:/i.test(trimmed) && !trimmed.includes("\\") && !trimmed.includes("/")) {
    return { ok: true, type: "protocol" };
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

  // 5. Ruta absoluta a .exe SOLO en directorios seguros (permitir espacios en ruta segura)
  if (trimmed.toLowerCase().endsWith(".exe")) {
    const safeDirs = [
      "C:\\Program Files\\",
      "C:\\Program Files (x86)\\",
      "C:\\Windows\\",
      "C:\\Windows\\System32\\",
    ];
    const upper = trimmed.toUpperCase();
    // Verificar que ESTÉ EXCLUSIVAMENTE en un directorio seguro
    const inSafeDir = safeDirs.some(dir => upper.startsWith(dir.toUpperCase()));
    // Y que NO contenga path traversal ni esté en subdirectorios sospechosos
    const noTraversal = !upper.includes("..") && !upper.includes("TEMP") && !upper.includes("APPDATA") && !upper.includes("LOCALAPPDATA");
    if (inSafeDir && noTraversal) {
      return { ok: true, type: "executable" };
    }
  }

  return {
    ok: false,
    reason: "Objetivo no permitido: solo ejecutables en whitelist (sin args), URLs http/https, protocolos Windows, o nombres de archivo simples con extensiones permitidas",
    type: "blocked",
  };
}

/**
 * Ejecuta un comando/aplicación con confirmación nativa
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

  // Mostrar diálogo de confirmación nativo
  const displayTarget = target.length > 80 ? target.slice(0, 77) + "..." : target;
  const displayArgs = args ? ` con args: ${args}` : "";

  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Ejecutar aplicación / abrir recurso",
    message: `¿Permitir ejecutar/abrir?`,
    detail: `${displayTarget}${displayArgs}\n\nTipo: ${validation.type}`,
    buttons: ["Cancelar", "Permitir"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    icon: undefined,
  });

  if (result.response === 0) {
    return { ok: false, cancelled: true };
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
        // Parsear comando y args de forma segura
        const parts = target.trim().split(/\s+/);
        const cmd = parts[0];
        const cmdArgs = [...parts.slice(1), ...(args ? args.trim().split(/\s+/) : [])].filter(Boolean);

        const result = await execFileAsync(cmd, cmdArgs, {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });

        return {
          ok: true,
          result: `Ejecutado: ${cmd}${cmdArgs.length ? " " + cmdArgs.join(" ") : ""}`,
          stdout: result.stdout?.slice(0, 2000),
          stderr: result.stderr?.slice(0, 2000),
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