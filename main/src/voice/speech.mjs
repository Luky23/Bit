import { encodeVoiceMessage } from "./protocol.mjs";

const CODE_LINE = /^(?:(?:const|let|var|function|return|import|export|class|def|async|await|print|console|if|else|for|while|switch|case|try|catch|finally|throw|new|using|namespace|package)\b|\/\/|[{}[\]();]|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:=>|=)\s*.+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^)]*\)\s*[;{]?$)/iu;

function isCodeLine(line) {
  const candidate = line.trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/^>\s?/u, "");
  if (!candidate) return false;
  if (CODE_LINE.test(candidate)) return true;
  if (/^\s{4,}\S/u.test(line)) return true;
  return /(?:=>|===?|!==?|&&|\|\||\+\+|--|->|::|[{};])/.test(candidate)
    && !/[.!?]\s/u.test(candidate);
}

function spokenNumber(value) {
  return value.replace(/^[-−]/u, 'menos ').replace(/^\+/u, 'más ').replace(/[.,]/u, ' coma ');
}

function expandSpokenUnits(text) {
  return text
    .replace(/([+−-]?\d+(?:[.,]\d+)?)\s*(?:[°º]\s*([CF])|([℃℉]))(?!\p{L})/giu, (_match, value, scale, symbol) => {
      const singular = Math.abs(Number(value.replace('−', '-').replace(',', '.'))) === 1;
      const unit = (scale?.toUpperCase() === 'F' || symbol === '℉') ? 'Fahrenheit' : 'Celsius';
      return `${spokenNumber(value)} ${singular ? 'grado' : 'grados'} ${unit}`;
    })
    .replace(/([+−-]?\d+(?:[.,]\d+)?)\s*°/gu, (_match, value) => `${spokenNumber(value)} ${Math.abs(Number(value.replace('−', '-').replace(',', '.'))) === 1 ? 'grado' : 'grados'}`)
    .replace(/([+−-]?\d+(?:[.,]\d+)?)\s*km\s*\/\s*h\b/giu, (_match, value) => `${spokenNumber(value)} ${Number(value.replace(',', '.')) === 1 ? 'kilómetro' : 'kilómetros'} por hora`)
    .replace(/\bkm\s*\/\s*h\b/giu, 'kilómetros por hora')
    .replace(/([+−-]?\d+(?:[.,]\d+)?)\s*%/gu, (_match, value) => `${spokenNumber(value)} por ciento`);
}

/**
 * Prepara una versión hablable sin cambiar el texto que se muestra en el chat.
 */
export function prepareSpeechText(text, preferredName = "") {
  if (typeof text !== "string" || !text.trim()) return "";
  text = text.normalize("NFC");

  let removedCode = false;
  const withoutCodeBlocks = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, () => {
    removedCode = true;
    return " ";
  });
  const withoutCodeLines = withoutCodeBlocks.split(/\r?\n/u).filter((line) => {
    if (!isCodeLine(line)) return true;
    removedCode = true;
    return false;
  }).join("\n");
  const readable = expandSpokenUnits(withoutCodeLines
    .replace(/`[^`\n]+`/gu, () => {
      removedCode = true;
      return " ";
    })
    .replace(/!?\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, ""))
    .replace(/[^\p{L}\p{M}\p{N}\s,.;:!?'-]/gu, " ")
    .replace(/\p{Lm}/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([,;:])(?=\S)/gu, "$1 ")
    .replace(/(?:,\s*){2,}/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();

  const speechText = readable || (removedCode ? "La respuesta incluye código que puede consultar en el chat." : "");
  const name = typeof preferredName === "string"
    ? preferredName.normalize("NFC")
      .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
      .replace(/\p{Lm}/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
    : "";
  if (!speechText || !name) return speechText;

  const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const normalizedSpeech = normalize(speechText);
  const normalizedName = normalize(name);
  const greetings = ["hola", "buenos dias", "buenas tardes", "buenas noches"];
  const alreadyAddressed = normalizedSpeech.startsWith(`${normalizedName},`)
    || normalizedSpeech.startsWith(`${normalizedName}.`)
    || normalizedSpeech.startsWith(`${normalizedName} `)
    || greetings.some((greeting) =>
      [", ", " "].some((separator) => normalizedSpeech.startsWith(`${greeting}${separator}${normalizedName}`))
    );

  if (alreadyAddressed) return speechText;
  const continuation = speechText.replace(/^\p{Lu}/u, (letter) => letter.toLocaleLowerCase("es"));
  return `${name}, ${continuation}`;
}

/**
 * Divide un texto en oraciones completas.
 * Respeta puntos, interrogaciones, exclamaciones y elipsis.
 * Mantiene los signos de puntuación al final de cada oración.
 */
export function splitSentences(text) {
  if (!text || typeof text !== "string") return [];
  // Normalizar espacios
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Regex para oraciones: captura hasta punto, ?, !, ... o fin de string
  // Incluye el signo de puntuación en la oración
  const sentenceRegex = /[^.!?…]+(?:[.!?…]+|$)/g;
  const matches = normalized.match(sentenceRegex);
  if (!matches) return [normalized];

  return matches
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Cola de voz que segmenta texto en oraciones y las envía al sidecar.
 * Maneja interrupción (cancel) y backpressure.
 *
 * Opciones:
 * - waitForReady (boolean, default false): si true, cada oración espera a
 *   notifyReady() antes de enviarse. Si false, se resuelve inmediatamente
 *   después de enviar (comportamiento anterior, no rompe tests existentes).
 */
export class SpeechQueue {
  /**
   * @param {Function} sendToSidecar - Función que envía mensaje al sidecar (recibe string JSONL)
   * @param {Object} options
   * @param {boolean} options.waitForReady - Esperar ready del sidecar entre oraciones
   */
  constructor(sendToSidecar, { waitForReady = false } = {}) {
    this.sendToSidecar = sendToSidecar;
    this.waitForReady = waitForReady;
    this.items = [];
    this.running = false;
    this.cancelled = false;
    this.generation = 0;
    this.currentPromise = null;
    this._readyResolve = null; // Resolver pendiente de notifyReady()
    this._readyReject = null;
    this.idleWaiters = [];
  }

  /**
   * Encola texto para ser hablado. Segmenta en oraciones.
   * @param {string} text
   */
  enqueue(text, preferredName = "") {
    this.cancelled = false;
    this.generation++;
    const sentences = splitSentences(prepareSpeechText(text, preferredName));
    this.items = sentences;
    if (sentences.length === 0) return;
    void this.#drain();
  }

  /**
   * Cancela la cola actual y detiene la síntesis en el sidecar.
   */
  cancel() {
    this.cancelled = true;
    this.items.length = 0;
    // Resolver cualquier promise pendiente de ready para no dejar rejected promises
    if (this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
      this._readyReject = null;
    }
    if (!this.running) this.#settleIdle();
    // Enviar comando stop al sidecar
    try {
      this.sendToSidecar(encodeVoiceMessage({ type: "stop" }));
    } catch {
      // Ignorar errores de envío durante cancelación
    }
  }

  /**
   * Notifica que el sidecar está listo para la siguiente oración.
   * Se llama desde main.mjs cuando llega el mensaje "ready" del sidecar.
   */
  notifyReady() {
    if (this._readyResolve) {
      const resolve = this._readyResolve;
      this._readyResolve = null;
      this._readyReject = null;
      resolve();
    }
  }

  notifyError(error) {
    if (!this._readyReject) return;
    const reject = this._readyReject;
    this._readyResolve = null;
    this._readyReject = null;
    reject(error);
  }

  waitForIdle() {
    if (!this.isActive) return Promise.resolve();
    return new Promise((resolve, reject) => this.idleWaiters.push({ resolve, reject }));
  }

  #settleIdle(error) {
    for (const waiter of this.idleWaiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  /**
   * Verifica si hay items pendientes o en proceso.
   */
  get isActive() {
    return this.running || this.items.length > 0;
  }

  get isWaitingForReady() {
    return this._readyResolve !== null;
  }

  async #drain() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;

    try {
      while (!this.cancelled && generation === this.generation && this.items.length > 0) {
        const sentence = this.items.shift();
        if (!sentence) continue;

        await this.#speakSentence(sentence);
      }
    } catch (error) {
      this.#settleIdle(error);
    } finally {
      this.running = false;
      if (!this.cancelled && this.items.length > 0) void this.#drain();
      else this.#settleIdle();
    }
  }

  /**
   * Envía una oración al sidecar.
   * Si waitForReady es true, espera notifyReady() antes de resolver.
   * @returns {Promise<void>}
   */
  #speakSentence(sentence) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        resolve();
        return;
      }

      // Timeout de seguridad (30s por oración) solo cuando waitForReady está activo
      let timeout = null;
      if (this.waitForReady) {
        timeout = setTimeout(() => {
          this._readyResolve = null;
          this._readyReject = null;
          reject(new Error("Timeout esperando ready del sidecar"));
        }, 30000);
      }

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
      };

      // Enviar oración
      try {
        this.sendToSidecar(encodeVoiceMessage({ type: "speak", text: sentence }));
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (this.waitForReady) {
        // Esperar a notifyReady() antes de continuar con la siguiente oración
        this._readyResolve = () => {
          cleanup();
          resolve();
        };
        this._readyReject = (error) => {
          cleanup();
          reject(error);
        };
      } else {
        // Comportamiento anterior: resolver inmediatamente después de enviar
        cleanup();
        resolve();
      }
    });
  }
}

/**
 * Gestor de interrupciones de voz (VAD + STT).
 * Coordina la detección de voz del usuario para cortar la síntesis actual.
 */
export class InterruptionManager {
  constructor(speechQueue, sidecarSender) {
    this.speechQueue = speechQueue;
    this.sidecarSender = sidecarSender;
    this.vadEnabled = false;
    this.listening = false;
    // RMS normalizado de PCM16; 0.5 solo detectaría voces saturadas.
    this.vadThreshold = 0.015;
    this.silenceFrames = 0;
    this.speechFrames = 0;
    this.requiredSpeechFrames = 3; // ~100ms a 32ms/frame
    this.requiredSilenceFrames = 15; // ~500ms de silencio
  }

  /**
   * Activa/desactiva la detección de interrupción.
   */
  setEnabled(enabled) {
    this.vadEnabled = enabled;
    if (!enabled) {
      this.listening = false;
    }
  }

  /**
   * Procesa un chunk de audio PCM (int16) para detectar voz.
   * @param {Buffer} pcmInt16
   * @returns {boolean} true si se detectó interrupción
   */
  processAudio(pcmInt16) {
    if (!this.vadEnabled || !this.sidecarSender) return false;

    // Enviar al sidecar para análisis VAD
    const pcmBase64 = pcmInt16.toString("base64");
    this.sidecarSender(encodeVoiceMessage({
      type: "vad-process",
      pcmBase64,
      sampleRate: 16000,
      sampleWidth: 2,
      channels: 1
    }));

    return false; // El sidecar responderá con "level" o "vad-trigger"
  }

  /**
   * Maneja respuesta de VAD del sidecar.
   * @param {Object} message - {type: "level", rms: number} o {type: "vad-trigger", speech: boolean}
   */
  handleVadResponse(message) {
    if (message.type === "level") {
      const rms = message.rms ?? 0;
      const isSpeech = rms > this.vadThreshold;

      if (isSpeech) {
        this.speechFrames++;
        this.silenceFrames = 0;
        if (this.speechFrames >= this.requiredSpeechFrames && !this.listening) {
          this.listening = true;
          // Iniciar grabación para STT
          this.sidecarSender(encodeVoiceMessage({ type: "stt-start" }));
        }
      } else {
        this.silenceFrames++;
        this.speechFrames = 0;
        if (this.listening && this.silenceFrames >= this.requiredSilenceFrames) {
          this.listening = false;
          // Detener grabación y obtener transcripción
          this.sidecarSender(encodeVoiceMessage({ type: "stt-stop" }));
        }
      }
    } else if (message.type === "vad-trigger") {
      if (message.speech && !this.listening) {
        this.listening = true;
        this.sidecarSender(encodeVoiceMessage({ type: "stt-start" }));
      } else if (!message.speech && this.listening) {
        this.listening = false;
        this.sidecarSender(encodeVoiceMessage({ type: "stt-stop" }));
      }
    } else if (message.type === "transcript") {
      // Transcripción recibida - aquí se podría disparar un evento
      this.onTranscript?.(message.text);
    }
  }

  /**
   * Callback opcional cuando se recibe una transcripción.
   * @param {Function} callback
   */
  onTranscript(callback) {
    this.onTranscript = callback;
  }
}
