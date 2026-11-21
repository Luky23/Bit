const READING_ORIGINS = new Set(["sensor", "user-input"]);
const SESSION_STATUSES = new Set(["idle", "active", "finished"]);

function clone(value) {
  const { now, ...serializable } = value;
  return { ...structuredClone(serializable), now };
}

function assertTimestamp(value, label) {
  if (!(typeof value === "number" || typeof value === "string") || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${label} no es válido`);
  }
  return value;
}

function assertSession(state) {
  if (!state || typeof state !== "object" || !state.session || !SESSION_STATUSES.has(state.session.status)) {
    throw new Error("Estado de ensayo no válido");
  }
}

/** Estado en memoria para ensayos locales; no deriva magnitudes físicas de imágenes. */
export function createWorkshopState({ project = "", now = () => Date.now() } = {}) {
  if (typeof project !== "string" || project.length > 80) throw new Error("Proyecto de ensayo no válido");
  return {
    project,
    session: { id: null, status: "idle", source: "local", startedAt: null, endedAt: null },
    events: [],
    readings: {},
    now,
  };
}

export function startWorkshopSession(input, { id, at = input?.now?.(), source = "local" } = {}) {
  assertSession(input);
  if (input.session.status === "active") throw new Error("Ya hay una sesión de ensayo activa");
  if (typeof id !== "string" || !id.trim()) throw new Error("La sesión necesita un identificador");
  assertTimestamp(at, "El inicio");
  const state = clone(input);
  state.session = { id: id.trim().slice(0, 120), status: "active", source: source === "local" ? "local" : "authorized-source", startedAt: at, endedAt: null };
  state.events = [];
  return state;
}

export function stopWorkshopSession(input, { at = input?.now?.() } = {}) {
  assertSession(input);
  if (input.session.status !== "active") throw new Error("No hay una sesión de ensayo activa");
  assertTimestamp(at, "El final");
  const state = clone(input);
  state.session.status = "finished";
  state.session.endedAt = at;
  return state;
}

export function addWorkshopEvent(input, event = {}) {
  assertSession(input);
  if (input.session.status !== "active") throw new Error("Inicie un ensayo antes de registrar eventos");
  if (typeof event.type !== "string" || !event.type.trim() || typeof event.label !== "string" || !event.label.trim()) {
    throw new Error("El evento necesita tipo y etiqueta");
  }
  const state = clone(input);
  state.events.push({
    type: event.type.trim().slice(0, 80),
    label: event.label.trim().slice(0, 240),
    at: assertTimestamp(event.at ?? input.now(), "El instante del evento"),
    source: event.source === "user-input" ? "user-input" : "local",
  });
  return state;
}

export function recordWorkshopReading(input, reading = {}) {
  assertSession(input);
  if (typeof reading.key !== "string" || !reading.key.trim()) throw new Error("La lectura necesita una variable");
  if (!READING_ORIGINS.has(reading.origin)) throw new Error("El origen debe ser sensor o user-input");
  if (typeof reading.value !== "number" || !Number.isFinite(reading.value)) throw new Error("La lectura necesita un valor numérico");
  if (typeof reading.unit !== "string" || !reading.unit.trim()) throw new Error("La lectura necesita una unidad");
  const observedAt = assertTimestamp(reading.observedAt ?? input.now(), "El instante de la lectura");
  const staleAfterMs = Number.isFinite(reading.staleAfterMs) ? Math.max(0, reading.staleAfterMs) : 5_000;
  const state = clone(input);
  state.readings[reading.key.trim().slice(0, 120)] = {
    value: reading.value,
    unit: reading.unit.trim().slice(0, 40),
    origin: reading.origin,
    observedAt,
    receivedAt: reading.receivedAt ?? input.now(),
    staleAfterMs,
  };
  return state;
}

export function getWorkshopSnapshot(input, at = input?.now?.()) {
  assertSession(input);
  const now = new Date(assertTimestamp(at, "El instante de consulta")).getTime();
  const readings = Object.fromEntries(Object.entries(input.readings).map(([key, reading]) => {
    const observed = new Date(reading.observedAt).getTime();
    const ageMs = Math.max(0, now - observed);
    return [key, { ...reading, ageMs, status: ageMs > reading.staleAfterMs ? "stale" : "current" }];
  }));
  return { project: input.project, session: { ...input.session }, events: input.events.map(clone), readings };
}

/** Traduce solo gestos de navegación del visor; nunca devuelve una operación de escritura o borrado. */
export function mapSupportedGesture(gesture = {}) {
  if (gesture.type === "pinch" && Number.isFinite(gesture.scale) && gesture.scale > 0) {
    return { action: "zoom", amount: Math.max(0.5, Math.min(2, gesture.scale)) };
  }
  if (gesture.type === "swipe" && gesture.direction === "left") return { action: "rotate", degrees: -15 };
  if (gesture.type === "swipe" && gesture.direction === "right") return { action: "rotate", degrees: 15 };
  if (gesture.type === "open-hand") return { action: "assemble" };
  if (gesture.type === "fist") return { action: "explode" };
  return null;
}

