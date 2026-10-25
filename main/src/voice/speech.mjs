import { encodeVoiceMessage } from "./protocol.mjs";

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
 */
export class SpeechQueue {
  /**
   * @param {Function} sendToSidecar - Función que envía mensaje al sidecar (recibe string JSONL)
   */
  constructor(sendToSidecar) {
    this.sendToSidecar = sendToSidecar;
    this.items = [];
    this.running = false;
    this.cancelled = false;
    this.currentPromise = null;
  }

  /**
   * Encola texto para ser hablado. Segmenta en oraciones.
   * @param {string} text
   */
  enqueue(text) {
    this.cancelled = false;
    const sentences = splitSentences(text);
    if (sentences.length === 0) return;
    this.items.push(...sentences);
    void this.#drain();
  }

  /**
   * Cancela la cola actual y detiene la síntesis en el sidecar.
   */
  cancel() {
    this.cancelled = true;
    this.items.length = 0;
    // Enviar comando stop al sidecar
    try {
      this.sendToSidecar(encodeVoiceMessage({ type: "stop" }));
    } catch {
      // Ignorar errores de envío durante cancelación
    }
  }

  /**
   * Verifica si hay items pendientes o en proceso.
   */
  get isActive() {
    return this.running || this.items.length > 0;
  }

  async #drain() {
    if (this.running) return;
    this.running = true;

    try {
      while (!this.cancelled && this.items.length > 0) {
        const sentence = this.items.shift();
        if (!sentence) continue;

        // Esperar a que el sidecar esté listo (ready) antes de enviar la siguiente oración
        // Nota: el sidecar responde "ready" después de cada síntesis completa
        await this.#speakSentence(sentence);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Envía una oración al sidecar y espera confirmación "ready".
   * @returns {Promise<void>}
   */
  #speakSentence(sentence) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        resolve();
        return;
      }

      // Timeout de seguridad (30s por oración)
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout esperando ready del sidecar"));
      }, 30000);

      const cleanup = () => {
        clearTimeout(timeout);
        // Remover listener temporal
      };

      // Listener temporal para "ready"
      const onReady = () => {
        cleanup();
        resolve();
      };

      // Registrar listener temporal en el sidecar manager (se configura externamente)
      if (typeof this.onSidecarReady === "function") {
        this.onSidecarReady(onReady);
      } else {
        // Fallback: resolver inmediatamente (el sidecar maneja su propia cola)
        cleanup();
        resolve();
      }

      // Enviar oración
      try {
        this.sendToSidecar(encodeVoiceMessage({ type: "speak", text: sentence }));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  /**
   * Callback que se invoca cuando el sidecar envía "ready".
   * Se registra desde main.mjs para coordinar la cola.
   * @param {Function} callback
   */
  setReadyHandler(callback) {
    this.onSidecarReady = callback;
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
    this.vadThreshold = 0.5;
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