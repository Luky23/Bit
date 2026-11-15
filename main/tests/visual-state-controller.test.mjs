import test from "node:test";
import assert from "node:assert/strict";
import { createVisualStateController } from "../electron/visual-state-controller.mjs";

function harness() {
  const classes = new Set();
  const body = { dataset: {}, classList: {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
  } };
  return { documentRef: { body }, windowRef: { matchMedia: () => ({ matches: true }) }, classes };
}

test("el controlador mantiene estados internos sin desmontar la interfaz", () => {
  const fixture = harness();
  const controller = createVisualStateController({ ...fixture });
  assert.equal(controller.get(), "idle");
  controller.set("project", { project: true });
  assert.equal(fixture.documentRef.body.dataset.visualState, "project");
  assert.equal(fixture.classes.has("project-active"), true);
  controller.set("project_3d", { project: true, model: true });
  assert.equal(controller.get(), "project_3d");
  assert.equal(fixture.classes.has("model-active"), true);
  controller.set("idle");
  assert.equal(fixture.classes.has("project-active"), false);
  assert.equal(fixture.classes.has("model-active"), false);
});

test("el orquestador expone estados adaptativos y valida sus transiciones", () => {
  const fixture = harness();
  const controller = createVisualStateController({ ...fixture });
  const context = {
    project: "FlipDock v3",
    files: ["models/base.stl"],
    selectedPath: "models/base.stl",
    results: { source: "local" },
  };

  assert.equal(controller.canTransition("file-intake"), true);
  assert.equal(controller.set("file-intake", { context }).accepted, true);
  assert.equal(controller.set("file-analysis").accepted, true);
  assert.equal(controller.set("file-results", { context: { results: { source: "local", count: 1 } } }).accepted, true);
  assert.deepEqual(controller.getSnapshot().context, {
    ...context,
    results: { source: "local", count: 1 },
  });
  assert.equal(controller.set("project").accepted, true);
  assert.equal(controller.set("file-analysis").accepted, false);
  assert.equal(controller.get(), "project");
  assert.equal(controller.canTransition("project-3d"), true);
});
