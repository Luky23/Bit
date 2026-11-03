/**
 * Configuración persistente de Bit (userData/Bit Preview/config.json)
 * Mismo mecanismo y esquema del panel de ajustes.
 * Soporta config:get, config:set, config:pickSong, boot:getSong
 */

import { mkdir, readFile, writeFile, readdir, stat, copyFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import pkg from "electron";
const { app } = pkg;
import { isAllowedAudioFile } from "../voice/settings.mjs";
import { validateProjectsRoot } from "../projects/workspace.mjs";

const MUSIC_DIR_NAME = "music";
const MAX_SONG_MB = 30;
const MAX_SONG_BYTES = MAX_SONG_MB * 1024 * 1024;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export function isSafeSongName(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(value) ||
    /[ .]$/u.test(value) ||
    WINDOWS_RESERVED_NAME_RE.test(value.split(".", 1)[0].replace(/[ .]+$/u, "")) ||
    !isAllowedAudioFile(value)
  ) {
    return false;
  }
  return true;
}

export function normalizeUserName(value) {
  if (typeof value !== "string") {
    return { ok: false, error: "El nombre debe tener hasta 40 letras y solo puede incluir espacios, puntos, guiones o apóstrofos" };
  }
  const normalized = value.normalize("NFC");
  if (normalized.length > 40 || /[^\p{L}\p{M} .'-]/u.test(normalized)) {
    return { ok: false, error: "El nombre debe tener hasta 40 letras y solo puede incluir espacios, puntos, guiones o apóstrofos" };
  }
  return { ok: true, value: normalized.trim().replace(/\s+/gu, " ") };
}

// Esquema de configuración de inicio
const STARTUP_DEFAULTS = {
  startupEnabled: false,
  startupSong: "",
  startupVolume: 70,
  startupStartSec: 0,
  startupMaxSec: 25,
  duckLevel: 0.25,
  webcamEnabled: false,
  visionModel: "",
  screenAnalysisEnabled: false,
  speechEnabled: true,
  userName: "",
  whisperModelPath: "",
  projectsRoot: "",
};

/**
 * Directorio de configuración: userData/Bit Preview/
 */
function configDir() {
  return resolve(app.getPath("userData"));
}

function configPath() {
  return join(configDir(), "config.json");
}

function musicDir() {
  return join(configDir(), MUSIC_DIR_NAME);
}

function songPath(songName) {
  if (!isSafeSongName(songName)) throw new Error("Nombre de canción no válido");
  return join(musicDir(), songName);
}

/**
 * Lee la configuración completa desde disco.
 * @returns {Promise<Object>}
 */
async function readConfig() {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    const config = { ...STARTUP_DEFAULTS, ...parsed };
    if (parsed && Object.hasOwn(parsed, "userName")) {
      const userName = normalizeUserName(parsed.userName);
      config.userName = userName.ok ? userName.value : STARTUP_DEFAULTS.userName;
    }
    return config;
  } catch {
    return { ...STARTUP_DEFAULTS };
  }
}

/**
 * Escribe la configuración completa a disco.
 * @param {Object} config
 */
async function writeConfig(config) {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2), "utf8");
}

/**
 * Obtiene un valor de configuración por clave.
 * @param {string} key
 * @returns {Promise<{ok: boolean, value?: any, error?: string}>}
 */
export async function configGet(key) {
  const config = await readConfig();
  if (!(key in config)) {
    return { ok: false, error: `Clave de configuración no encontrada: ${key}` };
  }
  return { ok: true, value: config[key] };
}

/**
 * Establece un valor de configuración por clave.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function configSet(key, value) {
  const config = await readConfig();

  // Validaciones específicas
  if (key === "startupVolume") {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: "startupVolume debe ser 0-100" };
    }
    config[key] = v;
  } else if (key === "startupStartSec") {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: "startupStartSec debe ser >= 0" };
    }
    config[key] = v;
  } else if (key === "startupMaxSec") {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 1) {
      return { ok: false, error: "startupMaxSec debe ser >= 1" };
    }
    config[key] = v;
  } else if (key === "duckLevel") {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: "duckLevel debe ser 0-1" };
    }
    config[key] = v;
  } else if (key === "webcamEnabled" || key === "startupEnabled" || key === "screenAnalysisEnabled") {
    config[key] = value === true;
  } else if (key === "speechEnabled") {
    if (typeof value !== "boolean") {
      return { ok: false, error: "speechEnabled debe ser boolean" };
    }
    config[key] = value;
  } else if (key === "userName") {
    const userName = normalizeUserName(value);
    if (!userName.ok) return userName;
    config[key] = userName.value;
  } else if (key === "startupSong") {
    if (typeof value !== "string" || (value !== "" && !isSafeSongName(value))) {
      return { ok: false, error: "startupSong debe ser un nombre local de archivo de audio válido" };
    }
    config[key] = value.normalize("NFC");
  } else if (key === "visionModel") {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { ok: false, error: `${key} debe ser string` };
    }
    config[key] = value;
  } else if (key === "whisperModelPath") {
    if (typeof value !== "string" || value.length > 1024 || (value !== "" && !isAbsolute(value))) {
      return { ok: false, error: "whisperModelPath debe ser una ruta local válida" };
    }
    config[key] = value;
  } else if (key === "projectsRoot") {
    if (
      typeof value !== "string" ||
      value.length > 1024 ||
      (value !== "" && (!isAbsolute(value) || value.startsWith("\\\\") || value.startsWith("//")))
    ) {
      return { ok: false, error: "projectsRoot debe ser una carpeta local absoluta, no una ruta de red" };
    }
    config[key] = value ? resolve(value) : "";
  } else {
    config[key] = value;
  }

  await writeConfig(config);
  return { ok: true };
}

/**
 * Elige una canción: abre dialog, copia el archivo a music/, guarda solo el nombre.
 * @param {Function} showOpenDialog - Función de Electron dialog.showOpenDialog
 * @returns {Promise<{ok: boolean, songName?: string, error?: string}>}
 */
export async function configPickSong(showOpenDialog) {
  const result = await showOpenDialog({
    title: "Elegir canción de inicio",
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "flac"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }

  const filePath = result.filePaths[0];
  const selectedName = filePath.split(/[\\/]/).pop();

  if (!isAllowedAudioFile(selectedName)) {
    return { ok: false, error: "Formato de audio no permitido (mp3, wav, ogg, m4a, flac)" };
  }
  const fileName = selectedName.normalize("NFC");

  // Verificar tamaño
  try {
    const stats = await stat(filePath);
    if (stats.size > MAX_SONG_BYTES) {
      return { ok: false, error: `El archivo excede los ${MAX_SONG_MB} MB` };
    }
  } catch {
    return { ok: false, error: "No se pudo leer el archivo seleccionado" };
  }

  // Sanitizar nombre
  if (!isSafeSongName(fileName)) {
    return { ok: false, error: "Nombre de archivo no válido" };
  }

  // Copiar a music/
  await mkdir(musicDir(), { recursive: true });
  const destPath = songPath(fileName);
  try {
    await copyFile(filePath, destPath);
  } catch (error) {
    return { ok: false, error: `No se pudo copiar la canción: ${error.message}` };
  }

  const savedSong = await configSet("startupSong", fileName);
  if (!savedSong.ok) return savedSong;
  const enabled = await configSet("startupEnabled", true);
  if (!enabled.ok) return enabled;

  return { ok: true, songName: fileName };
}

/**
 * Quita la canción y desactiva el sonido de inicio.
 * @returns {Promise<{ok: boolean}>}
 */
export async function configRemoveSong() {
  const removed = await configSet("startupSong", "");
  if (!removed.ok) return removed;
  const disabled = await configSet("startupEnabled", false);
  if (!disabled.ok) return disabled;
  return { ok: true };
}

export async function configPickWhisperModel(showOpenDialog) {
  const result = await showOpenDialog({
    title: "Elegir modelo local de transcripción",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }

  const modelPath = resolve(result.filePaths[0]);
  let modelStats;
  let configStats;
  try {
    [modelStats, configStats] = await Promise.all([
      stat(join(modelPath, "model.bin")),
      stat(join(modelPath, "config.json")),
    ]);
  } catch {
    return { ok: false, error: "La carpeta debe contener un modelo local CTranslate2 con model.bin y config.json" };
  }
  if (!modelStats.isFile() || !configStats.isFile()) {
    return { ok: false, error: "La carpeta debe contener un modelo local CTranslate2 con model.bin y config.json" };
  }

  const saved = await configSet("whisperModelPath", modelPath);
  if (!saved.ok) return saved;
  return { ok: true, modelPath };
}

export async function configPickProjectsRoot(showOpenDialog) {
  const result = await showOpenDialog({
    title: "Elegir carpeta local para proyectos de Bit",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }

  const projectsRoot = resolve(result.filePaths[0]);
  await validateProjectsRoot(projectsRoot);
  const saved = await configSet("projectsRoot", projectsRoot);
  if (!saved.ok) return saved;
  return { ok: true, projectsRoot };
}

/**
 * Devuelve los bytes de la canción actual para boot.
 * @returns {Promise<{ok: boolean, bytes?: Uint8Array, songName?: string, error?: string}>}
 */
export async function bootGetSong() {
  const config = await readConfig();
  const songName = config.startupSong;
  if (!songName) {
    return { ok: true, bytes: null, songName: null };
  }

  if (!isSafeSongName(songName)) {
    return { ok: false, error: "Nombre de canción no válido en configuración" };
  }

  const path = songPath(songName);
  try {
    const stats = await stat(path);
    if (stats.size > MAX_SONG_BYTES) {
      return { ok: false, error: "La canción excede el tamaño máximo" };
    }
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(path);
    return { ok: true, bytes: new Uint8Array(buffer), songName };
  } catch (error) {
    return { ok: false, error: `No se pudo leer la canción de inicio: ${error.message}` };
  }
}

/**
 * Obtiene la configuración de inicio completa.
 * @returns {Promise<Object>}
 */
export async function getStartupConfig() {
  return readConfig();
}