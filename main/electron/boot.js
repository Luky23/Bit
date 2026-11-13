/**
 * Secuencia de inicio tipo Jarvis para Bit.
 * Se ejecuta una sola vez por arranque de la app (no al reabrir ventana).
 * Nunca bloquea la UI. Se puede omitir con Escape o botón "Omitir".
 *
 * Flujo:
 * La música opcional acompaña el saludo y el resumen hablado de las notas locales.
 * El saludo comienza sin esperar a que el resumen o la música terminen de cargar.
 */

const DUCK_RAMP_MS = 1800;
const FADE_OUT_MS = 5000;
const GREETING_HISTORY_LIMIT = 8;

let bootCancelled = false;
let bootAudioContext = null;
let songGainNode = null;
let songSourceNode = null;
let voiceInProgress = false;
let voiceDuckLevel = 0.25;
let bootSequencePromise = null;

/**
 * Cancela la secuencia de inicio.
 */
export function cancelBoot() {
  bootCancelled = true;
  stopSong();
}

/**
 * Detiene la canción y limpia nodos de audio.
 */
function stopSong() {
  try {
    if (songSourceNode) {
      songSourceNode.stop();
      songSourceNode.disconnect();
      songSourceNode = null;
    }
    if (songGainNode) {
      songGainNode.disconnect();
      songGainNode = null;
    }
  } catch {
    // Ignorar errores al detener
  }
}

/**
 * Reproduce la canción de inicio desde los bytes obtenidos vía IPC.
 * @param {AudioContext} ctx
 * @param {number} startSec
 * @param {number} segmentSec
 * @param {number} volume
 * @param {() => void} onStarted
 * @returns {Promise<void>}
 */
async function playSongFromBytes(ctx, startSec, segmentSec, volume, onStarted) {
  if (bootCancelled) {
    onStarted();
    return;
  }

  const result = await window.bitRuntime.bootGetSong();
  if (!result.ok) throw new Error(result.error || "No se pudo leer la canción de inicio");
  if (!result.bytes) throw new Error("No hay una canción de inicio disponible");

  const bytes = Uint8Array.from(result.bytes);
  if (bytes.length === 0) throw new Error("El archivo de música está vacío");
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const offset = Math.max(0, startSec);
  if (offset >= audioBuffer.duration) throw new Error("El punto de inicio supera la duración de la canción");
  const duration = Math.min(segmentSec, Math.max(0, audioBuffer.duration - offset));
  if (duration <= 0) throw new Error("La duración de reproducción debe ser mayor que cero");

  songSourceNode = ctx.createBufferSource();
  songSourceNode.buffer = audioBuffer;
  songSourceNode.loop = true;
  songSourceNode.loopStart = offset;
  songSourceNode.loopEnd = offset + duration;

  songGainNode = ctx.createGain();
  songGainNode.gain.setValueAtTime(volume, ctx.currentTime);

  songSourceNode.connect(songGainNode);
  songGainNode.connect(ctx.destination);

  if (ctx.state !== "running") await ctx.resume();
  if (ctx.state !== "running") throw new Error(`El audio de inicio no está activo (estado: ${ctx.state})`);
  songSourceNode.start(ctx.currentTime, offset);
  if (voiceInProgress) duckSong(voiceDuckLevel);
  onStarted();
  const dailySummary = document.getElementById("daily-summary");
  if (dailySummary) dailySummary.textContent = "Música de inicio reproduciéndose · Preparando saludo y resumen…";

  songSourceNode.onended = () => {
    songSourceNode = null;
  };

  await new Promise((resolve) => {
    const checkEnded = () => {
      if (bootCancelled || !songSourceNode) {
        resolve();
        return;
      }
      setTimeout(checkEnded, 200);
    };
    checkEnded();
  });
}

/**
 * Hace ducking del gain de la canción: baja a duckLevel con rampa.
 * @param {number} targetGain
 */
function duckSong(targetGain, durationMs = DUCK_RAMP_MS) {
  if (!songGainNode) return;
  const now = bootAudioContext.currentTime;
  songGainNode.gain.cancelScheduledValues(now);
  songGainNode.gain.setValueAtTime(songGainNode.gain.value, now);
  songGainNode.gain.linearRampToValueAtTime(targetGain, now + durationMs / 1000);
}

async function speakBootText(text) {
  await window.bitRuntime.speakAndWait(text);
  if (typeof window.bitWaitForVoicePlayback === "function") {
    await window.bitWaitForVoicePlayback();
  }
}

/**
 * Obtiene el saludo de inicio basado en la hora local de Buenos Aires.
 * Elige una variante al azar distinta a las usadas recientemente para que el
 * saludo no sea siempre el mismo en cada arranque.
 * @param {string|null} userName
 * @param {Date} now
 * @param {Function} random función que devuelve un número en [0, 1)
 * @param {string|string[]} recentGreetings saludo (o lista de saludos) usados recientemente para no repetir
 * @returns {string}
 */
export function createStartupGreeting(userName, now = new Date(), random = Math.random, recentGreetings = []) {
  // Hora de Buenos Aires (UTC-3)
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now));

  const franja = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const name = userName || "amigo";
  const variants = [
    `${franja}, ${name}. Bit ya está en línea; ¿en qué puedo asistirle?`,
    `${franja}, ${name}. Qué gusto tenerle de vuelta. Estoy a su disposición.`,
    `${franja}, ${name}. Espero que esté teniendo un buen día. Sistemas locales listos.`,
    `${franja}, ${name}. Me alegra acompañarle. ¿Qué necesita resolver hoy?`,
    `${franja}, ${name}. Todos los sistemas locales operativos. ¿En qué le ayudo?`,
    `${franja}, ${name}. Aquí estoy, listo para ayudarle en lo que necesite.`,
    `${franja}, ${name}. Bit operativo y a su servicio. ¿Por dónde empezamos?`,
    `${franja}, ${name}. ¿Cómo le va el día? Estoy a su disposición.`,
  ];

  const recent = Array.isArray(recentGreetings) ? recentGreetings : recentGreetings ? [recentGreetings] : [];
  const available = variants.filter((variant) => !recent.includes(variant));
  const pool = available.length > 0 ? available : variants;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

export function runBootSequence(options = {}) {
  if (!bootSequencePromise) bootSequencePromise = runBootSequenceOnce(options);
  return bootSequencePromise;
}

/**
 * Ejecuta la secuencia de inicio.
 * Debe llamarse una sola vez por arranque de la app desde index.html.
 */
async function runBootSequenceOnce({ model = "qwen2.5:3b", voiceEnabled } = {}) {
  if (bootCancelled) return;

  const config = await window.bitRuntime.getConfig?.();
  const shouldSpeak = typeof voiceEnabled === "boolean" ? voiceEnabled : config?.speechEnabled !== false;
  const startupEnabled = config?.startupEnabled === true;
  const dailySummary = document.getElementById("daily-summary");
  const userName = typeof config?.userName === "string" ? config.userName : null;
  let recentGreetings = [];
  try {
    const raw = localStorage.getItem("bit.startupGreetings") || "[]";
    recentGreetings = JSON.parse(raw);
    if (!Array.isArray(recentGreetings) || !recentGreetings.every((greeting) => typeof greeting === "string")) {
      recentGreetings = [];
    }
  } catch (error) {
    console.warn("[boot] No se pudo leer el historial de saludos:", error);
  }
  const greeting = createStartupGreeting(userName, new Date(), Math.random, recentGreetings);
  try {
    const updated = [greeting, ...recentGreetings].slice(0, GREETING_HISTORY_LIMIT);
    localStorage.setItem("bit.startupGreetings", JSON.stringify(updated));
  } catch (error) {
    console.warn("[boot] No se pudo guardar el historial de saludos:", error);
  }
  const welcome = document.getElementById("welcome");
  if (welcome) welcome.textContent = greeting;
  let audioError = "";
  const audioNotice = config?.startupSong && !startupEnabled
    ? "La canción está configurada, pero la reproducción está desactivada en Ajustes."
    : "";
  let voiceError = "";
  let songPromise = Promise.resolve();
  let resolveSongStart;
  const songStarted = new Promise((resolve) => { resolveSongStart = resolve; });
  voiceDuckLevel = config?.duckLevel ?? 0.25;

  if (dailySummary) dailySummary.textContent = "Preparando el resumen del día…";

  if (startupEnabled && config.startupSong) {
    songPromise = (async () => {
      try {
        bootAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        await bootAudioContext.resume();
        const volume = (config.startupVolume ?? 70) / 100;
        await playSongFromBytes(
          bootAudioContext,
          config.startupStartSec ?? 0,
          config.startupMaxSec ?? 25,
          volume,
          resolveSongStart
        );
      } catch (error) {
        audioError = error.message;
        resolveSongStart();
        console.error("[boot] No se pudo reproducir la canción de inicio:", error);
      }
    })();
  } else {
    resolveSongStart();
  }

  const escHandler = (event) => {
    if (event.key === "Escape") cancelBoot();
  };
  document.addEventListener("keydown", escHandler);

  try {
    if (bootCancelled) return;

    const summaryPromise = window.bitRuntime.getDailySummary(model).then(
      (result) => ({ result }),
      (error) => ({ error })
    );
    let greetingPromise = Promise.resolve();
    if (shouldSpeak) {
      voiceInProgress = true;
      duckSong(voiceDuckLevel);
      greetingPromise = speakBootText(greeting).catch((error) => {
        voiceError = error.message;
        console.error("[boot] No se pudo pronunciar el saludo:", error);
      });
    }

    await greetingPromise;
    if (bootCancelled) return;

    const summaryOutcome = await summaryPromise;
    if (summaryOutcome.error) throw summaryOutcome.error;
    const result = summaryOutcome.result;
    if (!result?.ok) throw new Error(result?.error || "No se pudo preparar el resumen del día");
    if (bootCancelled) return;

    const summaryText = result.noteCount === 0 ? "" : result.summary;
    if (dailySummary) dailySummary.textContent = summaryText;
    if (shouldSpeak && summaryText) {
      try {
        await speakBootText(summaryText);
      } catch (error) {
        voiceError = voiceError ? `${voiceError}; ${error.message}` : error.message;
        console.error("[boot] No se pudo pronunciar el resumen:", error);
      }
    }
  } catch (error) {
    console.error("[boot] No se pudo preparar el resumen del día:", error);
    if (dailySummary) dailySummary.textContent = `${greeting} No se pudo preparar el resumen: ${error.message}`;
  } finally {
    voiceInProgress = false;
    document.removeEventListener("keydown", escHandler);
    if (startupEnabled && config.startupSong) await songStarted;
    if (songGainNode) {
      duckSong(0, FADE_OUT_MS);
      await new Promise((resolve) => setTimeout(resolve, FADE_OUT_MS + 100));
    }
    stopSong();
    await songPromise;
    if (bootAudioContext && bootAudioContext.state !== "closed") {
      try {
        await bootAudioContext.close();
      } catch (error) {
        console.error("[boot] No se pudo cerrar el contexto de audio:", error);
      }
    }
    bootAudioContext = null;
    if (audioError && dailySummary && !dailySummary.textContent.includes("No se pudo preparar el resumen")) {
      dailySummary.textContent += ` · Audio de inicio: ${audioError}`;
    }
    if (audioNotice && dailySummary) dailySummary.textContent += ` · ${audioNotice}`;
    if (voiceError && dailySummary) dailySummary.textContent += ` · Voz local: ${voiceError}`;
  }
}
