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
import { quantizationFromName, readGgufMetadata } from "../models/gguf-metadata.mjs";
import { automaticModelDirectories, discoverGgufFiles } from "../models/model-discovery.mjs";
import { isWithin } from "./sandbox.mjs";
import { OllamaClient } from "../models/ollama-client.mjs";
import { ModelService } from "../models/model-service.mjs";

const MUSIC_DIR_NAME = "music";
const MAX_SONG_MB = 30;
const MAX_SONG_BYTES = MAX_SONG_MB * 1024 * 1024;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const DEFAULT_TEXT_MODEL = "qwen2.5-3b-q4_k_m.gguf";
const MAX_PERSONALITY_PROMPT_LENGTH = 4000;
const MAX_LAST_SESSION_TEXT = 4000;
const LOCAL_MODEL_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;

export function isSafeLocalModelId(value) {
  return typeof value === "string" && LOCAL_MODEL_ID.test(value);
}

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
  model: "",
  fastModel: "qwen2.5:3b",
  heavyModel: "qwen2.5-coder:7b",
  visionModel: "qwen2.5vl:3b",
  visionProjection: "",
  voiceModel: "",
  voiceSpeed: 1,
  voicePitch: 0,
  voiceProfile: "neutral",
  overlayPosition: "top-right",
  screenAnalysisEnabled: false,
  speechEnabled: true,
  userName: "Usuario",
  personalityPrompt: "Eres Bit, un asistente personal local inteligente, eficiente, conciso y técnico. Responde de forma directa sin divagar.",
  whisperModelPath: "",
  projectsRoot: "",
  vaultPath: "",
  continuityEnabled: true,
  lastSession: null,
  googleCalendarConnection: { status: "not-configured", readOnly: true },
  notionConnection: { status: "not-configured", readOnly: true },
};
const CONFIG_KEYS = new Set(Object.keys(STARTUP_DEFAULTS));
CONFIG_KEYS.add('displayLayout');

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

async function modelDirectories() {
  const directories = [
    ...automaticModelDirectories({
      home: app.getPath("home"),
      appData: app.getPath("appData"),
      localAppData: process.env.LOCALAPPDATA,
      userData: app.getPath("userData"),
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
  ];
  return [...new Set(directories.map((directory) => resolve(directory)))];
}

export function localVoiceDirectories({ userData, appPath, resourcesPath, localAppData } = {}) {
  const directories = [
    userData && join(userData, "voices"),
    appPath && join(appPath, "voices"),
    resourcesPath && join(resourcesPath, "voices"),
    localAppData && join(localAppData, "Bit", "voices"),
    localAppData && join(localAppData, "Bit", "Piper", "voices"),
  ];
  return [...new Set(directories.map((directory) => resolve(directory)))];
}

function voiceDirectories() {
  return localVoiceDirectories({
    userData: app.getPath("userData"),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    localAppData: process.env.LOCALAPPDATA,
  });
}

function isProjectionModel(name) {
  return /(?:^|[-_.])(?:mmproj|projector)(?:[-_.]|$)/iu.test(name);
}

/** Devuelve solo archivos GGUF locales permitidos, sin consultar servicios. */
export async function listLocalModels() {
  const userModels = resolve(app.getPath("userData"), "models");
  const discovery = await discoverGgufFiles(await modelDirectories());
  const entries = await Promise.all(discovery.files.map(async (file) => {
    const details = await stat(file.canonicalPath);
    let metadata = {};
    try { metadata = await readGgufMetadata(file.canonicalPath); } catch { /* El motor hará la validación definitiva al cargar. */ }
    return {
      name: file.name,
      path: file.path,
      size: details.size,
      modifiedAt: details.mtime.toISOString(),
      quantization: quantizationFromName(file.name),
      contextLength: metadata.contextLength ?? null,
      architecture: metadata.architecture ?? null,
      kind: isProjectionModel(file.name) ? "projection" : "model",
      source: isWithin(userModels, file.path) ? "userData" : "detected",
    };
  }));
  return entries.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Devuelve voces Piper .onnx locales, sin inspeccionar red ni servicios. */
export async function listLocalVoices() {
  const entries = await Promise.all(voiceDirectories().map(async (directory) => {
    try {
      const names = await readdir(directory);
      const files = await Promise.all(names
        .filter((name) => name.toLowerCase().endsWith(".onnx"))
        .map(async (name) => {
          const path = join(directory, name);
          const details = await stat(path);
          if (!details.isFile()) return null;
          return { name, path, source: directory === resolve(app.getPath("userData"), "voices") ? "userData" : "app" };
        }));
      return files.filter(Boolean);
    } catch {
      return [];
    }
  }));
  return entries.flat().sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function resolveLocalVoice(requested = "") {
  const voices = await listLocalVoices();
  const wanted = typeof requested === "string" ? requested.trim() : "";
  const match = wanted && voices.find((voice) => voice.name === wanted || voice.path === wanted);
  if (match) return match;
  if (wanted) throw new Error(`La voz local seleccionada no está disponible: ${wanted}`);
  const defaultVoice = voices.find((voice) => voice.name.toLowerCase() === "es_es-davefx-medium.onnx");
  if (defaultVoice) return defaultVoice;
  if (voices[0]) return voices[0];
  throw new Error("No hay voces Piper .onnx locales en voices/ o userData/voices.");
}

function normalizePersonalityPrompt(value) {
  if (typeof value !== "string") return { ok: false, error: "personalityPrompt debe ser texto" };
  const normalized = value.normalize("NFC").trim();
  if (normalized.length > MAX_PERSONALITY_PROMPT_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)) {
    return { ok: false, error: `personalityPrompt debe tener hasta ${MAX_PERSONALITY_PROMPT_LENGTH} caracteres y no incluir controles` };
  }
  return { ok: true, value: normalized };
}

function normalizeLastSession(value) {
  if (value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "lastSession debe ser un objeto o null" };
  }
  const fields = ["project", "goal", "nextStep", "lastUserMessage", "lastAssistantMessage"];
  const normalized = { savedAt: new Date().toISOString() };
  for (const field of fields) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].length > MAX_LAST_SESSION_TEXT) {
      return { ok: false, error: `${field} debe ser texto de hasta ${MAX_LAST_SESSION_TEXT} caracteres` };
    }
    normalized[field] = value[field].normalize("NFC").trim();
  }
  return { ok: true, value: normalized };
}

function normalizeReadOnlyConnection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "La conexión debe ser un objeto" };
  }
  const status = value.status === "connected" ? "connected" : "not-configured";
  return { ok: true, value: { status, readOnly: true } };
}

/**
 * Resuelve un modelo exclusivamente dentro de las carpetas locales de Bit.
 * Nunca acepta una ruta arbitraria enviada por el renderer o por el modelo.
 */
export async function resolveLocalModel(requested = "", { projection = false } = {}) {
  const models = await listLocalModels();
  const candidates = models.filter((model) => projection ? model.kind === "projection" : model.kind === "model");
  if (!candidates.length) {
    throw new Error(projection
      ? "No hay una proyección visual .gguf local (mmproj) disponible"
      : "No hay un modelo GGUF local disponible. Configure un modelo local en Ajustes para conversar.");
  }
  const wanted = typeof requested === "string" ? requested.trim() : "";
  const match = wanted && candidates.find((model) => model.name === wanted || model.path === wanted);
  if (match) return match;
  // Las configuraciones antiguas guardaban tags de Ollama (por ejemplo,
  // qwen2.5:3b). Si existe un GGUF local, ese tag no debe bloquear la migraciÃ³n.
  if (wanted && !/\.gguf$/iu.test(wanted)) {
    const defaultModel = candidates.find((model) => model.name.toLowerCase() === DEFAULT_TEXT_MODEL);
    if (defaultModel) return defaultModel;
    if (candidates[0]) return candidates[0];
  }
  if (wanted) throw new Error(`El modelo local seleccionado no está disponible: ${wanted}`);
  if (!projection) {
    const defaultModel = candidates.find((model) => model.name.toLowerCase() === DEFAULT_TEXT_MODEL);
    if (defaultModel) return defaultModel;
  }
  if (candidates[0]) return candidates[0];
  throw new Error(projection
    ? "No hay una proyección visual .gguf local (mmproj) disponible"
    : `No hay modelos GGUF en las ubicaciones locales conocidas. Puede descargar ${DEFAULT_TEXT_MODEL} desde Configuración.`);
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
  if (key === "availableModels") return { ok: true, value: await new ModelService({ ollama: new OllamaClient(), listGguf: listLocalModels }).list() };
  if (key === "availableVoices") return { ok: true, value: await listLocalVoices() };
  if (key === "modelPath") {
    const config = await readConfig();
    try {
      return { ok: true, value: (await resolveLocalModel(config.model || config.fastModel || "")).path };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  if (typeof key !== "string" || !CONFIG_KEYS.has(key)) return { ok: false, error: "Clave de configuración no permitida" };
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
  if (typeof key !== "string" || !CONFIG_KEYS.has(key)) return { ok: false, error: "Clave de configuración no permitida" };
  if (key === 'displayLayout' && (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries(value).some(([id,role]) => !/^-?\d+$/.test(id) || !['main','project','info','none'].includes(role)))) return { ok: false, error: 'Distribución de pantallas no válida' };
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
    if (!isSafeLocalModelId(value)) return { ok: false, error: `${key} debe ser un tag local de Ollama válido` };
    config[key] = value;
  } else if (key === "visionProjection") {
    if (typeof value !== "string") return { ok: false, error: `${key} debe ser el nombre de una proyección GGUF local` };
    if (value) {
      try { await resolveLocalModel(value, { projection: true }); }
      catch (error) { return { ok: false, error: error.message }; }
    }
    config[key] = value;
  } else if (key === "model" || key === "fastModel" || key === "heavyModel") {
    if (!isSafeLocalModelId(value)) return { ok: false, error: `${key} debe ser un tag local de Ollama válido` };
    config[key] = value;
  } else if (key === "voiceModel") {
    if (typeof value !== "string") return { ok: false, error: "voiceModel debe ser el nombre de una voz Piper local" };
    try {
      const voice = await resolveLocalVoice(value);
      config[key] = voice.name;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  } else if (key === "voiceSpeed") {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      return { ok: false, error: "voiceSpeed debe estar entre 0.5 y 2.0" };
    }
    config[key] = speed;
  } else if (key === "voicePitch") {
    const pitch = Number(value);
    if (!Number.isFinite(pitch) || pitch < -12 || pitch > 12) {
      return { ok: false, error: "voicePitch debe estar entre -12 y 12 semitonos" };
    }
    config[key] = pitch;
  } else if (key === "voiceProfile") {
    const profiles = new Set(["masculine", "neutral", "feminine"]);
    if (typeof value !== "string" || !profiles.has(value)) {
      return { ok: false, error: "voiceProfile debe ser masculino, neutro o femenino" };
    }
    config[key] = value;
  } else if (key === "overlayPosition") {
    const positions = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
    if (typeof value !== "string" || !positions.has(value)) {
      return { ok: false, error: "overlayPosition debe ser una esquina válida" };
    }
    config[key] = value;
  } else if (key === "personalityPrompt") {
    const personality = normalizePersonalityPrompt(value);
    if (!personality.ok) return personality;
    config[key] = personality.value;
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
  } else if (key === "continuityEnabled") {
    if (typeof value !== "boolean") return { ok: false, error: "continuityEnabled debe ser boolean" };
    config[key] = value;
  } else if (key === "lastSession") {
    const session = normalizeLastSession(value);
    if (!session.ok) return session;
    config[key] = session.value;
  } else if (key === "googleCalendarConnection" || key === "notionConnection") {
    const connection = normalizeReadOnlyConnection(value);
    if (!connection.ok) return connection;
    config[key] = connection.value;
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
