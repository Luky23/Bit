/**
 * Configuración persistente de Bit (userData/Bit Preview/config.json)
 * Mismo mecanismo y esquema del panel de ajustes.
 * Soporta config:get, config:set, config:pickSong, boot:getSong
 */

import { mkdir, readFile, writeFile, readdir, stat, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pkg from "electron";
const { app } = pkg;
import { isAllowedAudioFile } from "../voice/settings.mjs";

const MUSIC_DIR_NAME = "music";
const MAX_SONG_MB = 30;
const MAX_SONG_BYTES = MAX_SONG_MB * 1024 * 1024;
const SONG_NAME_RE = /^[A-Za-z0-9._ -]+$/;

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
  if (!SONG_NAME_RE.test(songName)) throw new Error("Nombre de canción no válido");
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
    return { ...STARTUP_DEFAULTS, ...parsed };
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
  } else if (key === "webcamEnabled" || key === "startupEnabled") {
    config[key] = value === true;
  } else if (key === "startupSong" || key === "visionModel") {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { ok: false, error: `${key} debe ser string` };
    }
    config[key] = value;
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
    return { ok: false, error: "No se seleccionó ningún archivo" };
  }

  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop();

  if (!isAllowedAudioFile(fileName)) {
    return { ok: false, error: "Formato de audio no permitido (mp3, wav, ogg, m4a, flac)" };
  }

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
  if (!SONG_NAME_RE.test(fileName)) {
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

  // Guardar solo el nombre en config
  await configSet("startupSong", fileName);

  return { ok: true, songName: fileName };
}

/**
 * Quita la canción (vuelve al sonido sintético).
 * @returns {Promise<{ok: boolean}>}
 */
export async function configRemoveSong() {
  await configSet("startupSong", "");
  return { ok: true };
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

  if (!SONG_NAME_RE.test(songName)) {
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
  } catch {
    return { ok: true, bytes: null, songName: null };
  }
}

/**
 * Obtiene la configuración de inicio completa.
 * @returns {Promise<Object>}
 */
export async function getStartupConfig() {
  return readConfig();
}