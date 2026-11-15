const STATES = new Set(["idle", "file_loaded", "file_context", "project", "document", "code", "project_3d", "model3d"]);

function normalizeState(state) {
  if (state === "model3d") return "project_3d";
  return STATES.has(state) ? state : "idle";
}

/** Coordina la composición visual sin desmontar los paneles de la ventana. */
export function createVisualStateController({ documentRef, windowRef, durationMs = 640 } = {}) {
  if (!documentRef?.body) throw new Error("Se necesita un documento para controlar el estado visual");
  let currentState = normalizeState(documentRef.body.dataset?.visualState || "idle");
  let transitionId = 0;
  let timer = 0;

  function apply(state, { project = false, document = false, model = false, displayMode = "embedded" } = {}) {
    const nextState = normalizeState(state);
    const body = documentRef.body;
    body.dataset ||= {};
    body.dataset.visualState = nextState;
    body.classList.toggle("project-active", project || ["project", "document", "code", "project_3d"].includes(nextState));
    body.classList.toggle("file-active", ["file_loaded", "file_context"].includes(nextState));
    body.classList.toggle("file-context-active", nextState === "file_context");
    body.classList.toggle("document-active", document || nextState === "document" || nextState === "code");
    body.classList.toggle("code-active", nextState === "code");
    body.classList.toggle("model-active", model || nextState === "project_3d");
    body.classList.toggle("parallel-project", displayMode === "parallel");
    return nextState;
  }

  function transition(state, options = {}) {
    const id = ++transitionId;
    clearTimeout(timer);
    const body = documentRef.body;
    body.classList.add("visual-transitioning");
    apply(state, options);
    const reduced = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    timer = setTimeout(() => {
      if (id === transitionId) body.classList.remove("visual-transitioning");
    }, reduced ? 1 : durationMs);
    currentState = normalizeState(state);
    return { state: currentState, transitionId: id };
  }

  function dispose() {
    clearTimeout(timer);
    transitionId += 1;
    documentRef.body.classList.remove("visual-transitioning");
  }

  apply(currentState);
  return { get: () => currentState, set: transition, transition, dispose };
}

export { STATES as VISUAL_STATES };
