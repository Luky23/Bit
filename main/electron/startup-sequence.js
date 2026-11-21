/**
 * Secuencia visual de arranque de Bit.
 * No carga modelos ni bloquea el proceso principal: solo coordina la
 * presentación progresiva del renderer antes del saludo.
 */

const STARTUP_STEPS = Object.freeze([
  { at: 0, key: "power", status: "INICIANDO SISTEMA", log: "Encendiendo la interfaz local…", progress: 12 },
  { at: 720, key: "core", status: "DESPERTANDO NÚCLEO", log: "Despertando el núcleo visual…", progress: 34 },
  { at: 1500, key: "memory", status: "CARGANDO CONTEXTO", log: "Preparando conversación y memoria local…", progress: 58 },
  { at: 2500, key: "systems", status: "VERIFICANDO SISTEMAS", log: "Comprobando voz, modelos y conexiones seguras…", progress: 79 },
  { at: 0, key: "ready", status: "BIT EN LÍNEA", log: "Todos los sistemas locales están disponibles.", progress: 100 },
]);
const MIN_SEQUENCE_MS = 4200;
const TIMED_STEPS = STARTUP_STEPS.slice(0, -1);

function createStartupSequence({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const body = documentRef?.body;
  const sequence = documentRef?.getElementById?.("startup-sequence");
  if (!body || !sequence) {
    return {
      start() {},
      complete() {},
      ready: () => Promise.resolve({ skipped: false, unavailable: true }),
      isComplete: () => true,
    };
  }

  const status = documentRef.getElementById("startup-status");
  const log = documentRef.getElementById("startup-log");
  const progressBar = documentRef.getElementById("startup-progress-bar");
  const percent = documentRef.getElementById("startup-percent");
  const reducedMotion = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  let started = false;
  let completed = false;
  let startedAt = 0;
  let timer = 0;
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });

  function renderStep(step) {
    body.dataset.startupPhase = step.key;
    status && (status.textContent = step.status);
    log && (log.textContent = step.log);
    if (progressBar) progressBar.style.width = `${step.progress}%`;
    if (percent) percent.textContent = `${String(step.progress).padStart(2, "0")}%`;
    windowRef?.dispatchEvent?.(new CustomEvent("bit:startup-phase", { detail: { ...step } }));
  }

  function complete({ skipped = false } = {}) {
    if (completed) return readyPromise;
    if (!skipped && !reducedMotion && startedAt) {
      const remaining = MIN_SEQUENCE_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        clearTimeout(timer);
        timer = windowRef.setTimeout(() => complete(), remaining);
        return readyPromise;
      }
    }
    completed = true;
    clearTimeout(timer);
    documentRef.removeEventListener?.("keydown", onKeyDown);
    if (!skipped) renderStep(STARTUP_STEPS.at(-1));
    body.dataset.startupPhase = skipped ? "skipped" : "ready";
    body.classList.add("startup-complete", "startup-reveal");
    // La secuencia visual ya terminó. Quitar startup-active evita que las
    // animaciones preparatorias del fondo vuelvan a competir con la
    // transición única que revela la interfaz principal.
    body.classList.remove("startup-active");
    if (skipped) body.classList.add("startup-skipped");
    windowRef?.dispatchEvent?.(new CustomEvent("bit:startup-ready", { detail: { skipped } }));
    body.classList.remove("booting");
    resolveReady({ skipped });
    return readyPromise;
  }

  function onKeyDown(event) {
    if (event.key === "Escape") complete({ skipped: true });
  }

  function start() {
    if (started) return readyPromise;
    started = true;
    startedAt = Date.now();
    body.classList.add("booting", "startup-active");
    documentRef.addEventListener?.("keydown", onKeyDown);
    if (reducedMotion) {
      renderStep(STARTUP_STEPS[STARTUP_STEPS.length - 1]);
      return complete();
    }
    TIMED_STEPS.forEach(step => {
      windowRef.setTimeout(() => {
        if (!completed) renderStep(step);
      }, step.at);
    });
    return readyPromise;
  }

  return {
    start,
    complete,
    skip: () => complete({ skipped: true }),
    ready: () => readyPromise,
    isComplete: () => completed,
    steps: STARTUP_STEPS,
  };
}

globalThis.createStartupSequence = createStartupSequence;
globalThis.startupSequenceSteps = STARTUP_STEPS;
globalThis.bitStartupSequence = createStartupSequence();
globalThis.bitStartupSequence.start();
