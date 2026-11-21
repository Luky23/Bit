import test from "node:test";
import assert from "node:assert/strict";
import { createExperienceRecord, createPlan, createToolRegistry, runIntelligenceCycle } from "../src/core/intelligence-cycle.mjs";

test("registro selecciona herramientas por capacidades y rechaza duplicados", () => {
  const registry = createToolRegistry([{ name: "read", capabilities: ["read", "verify"] }, { name: "write", capabilities: ["write"] }]);
  assert.equal(registry.select(["verify"])[0].name, "read");
  assert.throws(() => createToolRegistry([{ name: "read" }, { name: "read" }]));
});

test("ciclo general ejecuta las seis etapas en orden", async () => {
  const order = [];
  const result = await runIntelligenceCycle({
    input: "revisar proyecto",
    registry: createToolRegistry([{ name: "read", capabilities: ["read"] }]),
    understand: async (input) => { order.push("understand"); return { intent: input }; },
    reason: async (value) => { order.push("reason"); return value; },
    plan: async (value) => { order.push("plan"); return createPlan({ objective: value.intent, steps: [{ tool: "read" }] }); },
    execute: async (value) => { order.push("execute"); return { plan: value, output: "ok" }; },
    verify: async (value) => { order.push("verify"); return { ok: Boolean(value.output) }; },
    learn: async (value) => { order.push("learn"); return createExperienceRecord({ objective: value.input, result: value.verification }); },
  });
  assert.deepEqual(order, ["understand", "reason", "plan", "execute", "verify", "learn"]);
  assert.equal(result.verification.ok, true);
  assert.equal(result.trace.length, 6);
});

test("la experiencia conserva resultado y correcciones sin convertirse en permiso", () => {
  const experience = createExperienceRecord({ objective: "ordenar archivos", corrections: [{ expected: "solo lectura" }] });
  assert.equal(experience.corrections[0].expected, "solo lectura");
  assert.equal(experience.version, 1);
});
