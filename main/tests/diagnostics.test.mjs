import test from "node:test";
import assert from "node:assert/strict";
import { createDiagnosticState, updateDiagnosticComponent, getDiagnosticSnapshot } from "../src/workshop/diagnostics.mjs";

test("diagnóstico distingue desconexión, lectura, alerta e hipótesis", () => {
  let state = createDiagnosticState({ project: "FlipDock", components: ["motor"] });
  state = updateDiagnosticComponent(state, { id: "motor", connection: "connected", readings: { temperature: { value: 85, unit: "°C", observedAt: 900 } }, thresholds: { temperature: { max: 80 } }, hypothesis: "Revisar ventilación", at: 1000 });
  const current = getDiagnosticSnapshot(state, 1000);
  assert.equal(current.components.motor.connection, "connected");
  assert.equal(current.components.motor.readings.temperature.status, "alert");
  assert.equal(current.components.motor.alerts[0].kind, "threshold");
  assert.equal(current.components.motor.hypothesis, "Revisar ventilación");

  const stale = getDiagnosticSnapshot(state, 7000);
  assert.equal(stale.components.motor.readings.temperature.status, "stale");
  assert.equal(stale.components.motor.connection, "stale");
});

