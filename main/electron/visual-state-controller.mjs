const VISUAL_STATES = Object.freeze([
  "idle", "file-intake", "file-analysis", "file-results", "project", "project-3d", "standalone-3d", "error", "unsupported",
  "document", "code",
]);

const LEGACY_ALIASES = new Map([
  ["file_loaded", "file-intake"], ["file_context", "file-intake"], ["project_3d", "project-3d"], ["model3d", "standalone-3d"],
]);

const VALID_TRANSITIONS = new Map([
  ["idle", new Set(["idle", "file-intake", "project", "standalone-3d", "error", "unsupported"])],
  ["file-intake", new Set(["idle", "file-intake", "file-analysis", "file-results", "project", "project-3d", "standalone-3d", "error", "unsupported"])],
  ["file-analysis", new Set(["file-intake", "file-analysis", "file-results", "error", "unsupported"])],
  ["file-results", new Set(["idle", "file-intake", "file-analysis", "file-results", "project", "project-3d", "standalone-3d", "error", "unsupported"])],
  ["project", new Set(["idle", "file-intake", "file-results", "project", "project-3d", "standalone-3d", "document", "code", "error", "unsupported"])],
  ["project-3d", new Set(["idle", "file-intake", "file-results", "project", "project-3d", "standalone-3d", "error", "unsupported"])],
  ["standalone-3d", new Set(["idle", "file-intake", "file-results", "project", "project-3d", "standalone-3d", "error", "unsupported"])],
  ["document", new Set(["project", "file-results", "error", "unsupported"])],
  ["code", new Set(["project", "file-results", "error", "unsupported"])],
  ["error", new Set(["idle", "file-intake", "project", "standalone-3d", "error", "unsupported"])],
  ["unsupported", new Set(["idle", "file-intake", "project", "standalone-3d", "error", "unsupported"])],
]);

function canonicalState(state) {
  const normalized = String(state || "idle");
  return LEGACY_ALIASES.get(normalized) || (VISUAL_STATES.includes(normalized) ? normalized : "idle");
}

function applyClasses(body, state, { project = false, document = false, model = false, displayMode = "embedded" } = {}) {
  body.dataset ||= {};
  body.dataset.visualState = state;
  body.classList.toggle("project-active", project || ["project", "document", "code", "project-3d"].includes(state));
  body.classList.toggle("file-active", ["file-intake", "file-analysis", "file-results"].includes(state));
  body.classList.toggle("file-context-active", ["file-intake", "file-analysis", "file-results"].includes(state));
  body.classList.toggle("document-active", document || state === "document" || state === "code");
  body.classList.toggle("code-active", state === "code");
  body.classList.toggle("model-active", model || ["project-3d", "standalone-3d"].includes(state));
  body.classList.toggle("parallel-project", displayMode === "parallel");
}

/** Coordina la composición visual sin desmontar paneles ni borrar el contexto del flujo. */
export function createVisualStateController({ documentRef, windowRef, durationMs = 640 } = {}) {
  if (!documentRef?.body) throw new Error("Se necesita un documento para controlar el estado visual");
  let publicState = documentRef.body.dataset?.visualState || "idle";
  let currentState = canonicalState(publicState);
  let context = {};
  let transitionId = 0;
  let timer = 0;

  function canTransition(nextState) {
    return VALID_TRANSITIONS.get(currentState)?.has(canonicalState(nextState)) === true;
  }

  function transition(state, options = {}) {
    const nextState = canonicalState(state);
    if (!canTransition(nextState)) {
      return { accepted: false, state: currentState, transitionId, reason: `Transición no válida: ${currentState} → ${nextState}` };
    }
    const id = ++transitionId;
    clearTimeout(timer);
    const body = documentRef.body;
    body.classList.add("visual-transitioning");
    if (options.context && typeof options.context === "object" && !Array.isArray(options.context)) context = { ...context, ...options.context };
    applyClasses(body, nextState, options);
    const reduced = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    timer = setTimeout(() => { if (id === transitionId) body.classList.remove("visual-transitioning"); }, reduced ? 1 : durationMs);
    currentState = nextState;
    publicState = String(state || nextState);
    return { accepted: true, state: publicState, canonicalState: currentState, transitionId: id };
  }

  function getSnapshot() { return { state: publicState, canonicalState: currentState, context: { ...context } }; }
  function dispose() { clearTimeout(timer); transitionId += 1; documentRef.body.classList.remove("visual-transitioning"); }

  applyClasses(documentRef.body, currentState);
  return { get: () => publicState, getSnapshot, canTransition, set: transition, transition, dispose };
}

export { VISUAL_STATES, VALID_TRANSITIONS };
