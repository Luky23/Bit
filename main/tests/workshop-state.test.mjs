import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkshopState,
  startWorkshopSession,
  stopWorkshopSession,
  addWorkshopEvent,
  recordWorkshopReading,
  getWorkshopSnapshot,
  mapSupportedGesture,
} from "../src/workshop/state.mjs";

test("una sesión de ensayo conserva inicio, marcas y finalización explícitos", () => {
  let state = createWorkshopState({ project: "FlipDock" });
  state = startWorkshopSession(state, { id: "ensayo-1", at: "2026-11-15T12:00:00.000Z", source: "local" });
  state = addWorkshopEvent(state, { type: "mark", label: "carga inicial", at: "2026-11-15T12:00:03.000Z" });
  state = stopWorkshopSession(state, { at: "2026-11-15T12:01:00.000Z" });

  assert.equal(state.session.status, "finished");
  assert.equal(state.session.startedAt, "2026-11-15T12:00:00.000Z");
  assert.equal(state.session.endedAt, "2026-11-15T12:01:00.000Z");
  assert.equal(state.events[0].label, "carga inicial");
});

test("las lecturas distinguen sensor, valor ingresado y dato vencido", () => {
  let state = createWorkshopState({ project: "FlipDock", now: () => 1_000 });
  state = recordWorkshopReading(state, { key: "temperature", value: 24.5, unit: "°C", origin: "sensor", observedAt: 900, staleAfterMs: 50 });
  state = recordWorkshopReading(state, { key: "speed", value: 120, unit: "rpm", origin: "user-input", observedAt: 1_000 });
  const snapshot = getWorkshopSnapshot(state, 1_000);

  assert.equal(snapshot.readings.temperature.status, "stale");
  assert.equal(snapshot.readings.temperature.origin, "sensor");
  assert.equal(snapshot.readings.speed.origin, "user-input");
  assert.equal(snapshot.readings.speed.status, "current");
  assert.equal(snapshot.readings.speed.unit, "rpm");
});

test("los gestos solo traducen controles de visor y no acciones persistentes", () => {
  assert.deepEqual(mapSupportedGesture({ type: "pinch", scale: 1.2 }), { action: "zoom", amount: 1.2 });
  assert.deepEqual(mapSupportedGesture({ type: "swipe", direction: "left" }), { action: "rotate", degrees: -15 });
  assert.equal(mapSupportedGesture({ type: "delete" }), null);
});
