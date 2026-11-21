function clone(value) {
  return structuredClone(value);
}

function timestamp(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} no es válido`);
  return value;
}

function componentOrThrow(state, id) {
  if (!state.components[id]) throw new Error(`Componente de diagnóstico desconocido: ${id}`);
  return state.components[id];
}

export function createDiagnosticState({ project = "", components = [] } = {}) {
  if (typeof project !== "string" || project.length > 80) throw new Error("Proyecto de diagnóstico no válido");
  return {
    project,
    components: Object.fromEntries([...new Set(components)].map(id => [id, {
      id,
      connection: "disconnected",
      readings: {},
      thresholds: {},
      alerts: [],
      hypothesis: null,
      updatedAt: null,
    }])),
  };
}

export function updateDiagnosticComponent(input, { id, connection = "connected", readings = {}, thresholds = {}, hypothesis = null, at = Date.now() } = {}) {
  const current = componentOrThrow(input, id);
  if (!["connected", "disconnected"].includes(connection)) throw new Error("Estado de conexión no válido");
  const instant = timestamp(at, "El instante del diagnóstico");
  const next = clone(input);
  const alerts = [];
  const normalizedReadings = {};
  for (const [key, reading] of Object.entries(readings || {})) {
    if (!reading || typeof reading.value !== "number" || !Number.isFinite(reading.value) || typeof reading.unit !== "string") continue;
    const observedAt = timestamp(reading.observedAt ?? instant, `La lectura ${key}`);
    const threshold = thresholds?.[key];
    const above = Number.isFinite(threshold?.max) && reading.value > threshold.max;
    const below = Number.isFinite(threshold?.min) && reading.value < threshold.min;
    if (above || below) alerts.push({ kind: "threshold", key, value: reading.value, threshold });
    normalizedReadings[key] = { value: reading.value, unit: reading.unit, origin: reading.origin || "sensor", observedAt, staleAfterMs: reading.staleAfterMs ?? 5_000 };
  }
  next.components[id] = { ...current, connection, readings: normalizedReadings, thresholds: clone(thresholds || {}), alerts, hypothesis: typeof hypothesis === "string" && hypothesis.trim() ? hypothesis.trim().slice(0, 300) : null, updatedAt: instant };
  return next;
}

export function getDiagnosticSnapshot(input, at = Date.now()) {
  const now = timestamp(at, "El instante de consulta");
  const state = clone(input);
  for (const component of Object.values(state.components)) {
    let hasStale = false;
    for (const reading of Object.values(component.readings)) {
      reading.ageMs = Math.max(0, now - reading.observedAt);
      reading.status = reading.ageMs > reading.staleAfterMs ? "stale" : component.alerts.some(alert => alert.key && alert.key === Object.keys(component.readings).find(key => component.readings[key] === reading)) ? "alert" : "current";
      hasStale ||= reading.status === "stale";
    }
    if (component.connection === "connected" && hasStale) component.connection = "stale";
  }
  return state;
}
