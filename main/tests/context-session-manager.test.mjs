import test from "node:test";
import assert from "node:assert/strict";
import { createContextSessionManager } from "../src/projects/context-session-manager.mjs";

test("mantiene dos proyectos abiertos y vuelve por el historial contextual", () => {
  const manager = createContextSessionManager();
  manager.openProject("FlipDock");
  manager.openViewer("models/flipdock.stl", { camera: { x: 1, y: 2, z: 3 } });
  manager.showHome();
  manager.openProject("Orbit Clean");

  assert.deepEqual(manager.snapshot().openProjects, ["FlipDock", "Orbit Clean"]);
  assert.equal(manager.snapshot().visible.kind, "project");
  assert.equal(manager.snapshot().visible.project, "Orbit Clean");

  manager.back();
  assert.equal(manager.snapshot().visible.kind, "home");
  manager.back();
  assert.deepEqual(manager.snapshot().visible, {
    kind: "viewer",
    project: "FlipDock",
    path: "models/flipdock.stl",
  });
  assert.deepEqual(manager.snapshot().projects.FlipDock.viewer.camera, { x: 1, y: 2, z: 3 });
});

test("cerrar el visor conserva el proyecto y cerrar un proyecto no afecta los demás", () => {
  const manager = createContextSessionManager();
  manager.openProject("FlipDock");
  manager.openViewer("models/flipdock.stl");
  manager.closeViewer();
  assert.deepEqual(manager.snapshot().visible, { kind: "project", project: "FlipDock" });

  manager.openProject("Orbit Clean");
  manager.setProjectState("Orbit Clean", { dirty: true });
  assert.throws(() => manager.closeProject("Orbit Clean"), /cambios sin guardar/u);
  manager.setProjectState("Orbit Clean", { dirty: false });
  manager.closeProject("Orbit Clean");
  assert.deepEqual(manager.snapshot().openProjects, ["FlipDock"]);
  assert.deepEqual(manager.snapshot().visible, { kind: "project", project: "FlipDock" });
});

test("persiste sesiones pero restaura la aplicación visualmente en Inicio", () => {
  const manager = createContextSessionManager();
  manager.openProject("FlipDock");
  manager.setProjectState("FlipDock", {
    selectedFiles: ["models/flipdock.stl"],
    conversation: [{ role: "user", text: "Ajustemos la bisagra" }],
    tasks: [{ id: "task-1", status: "running" }],
    model: "qwen-local.gguf",
  });
  const restored = createContextSessionManager(manager.serialize(), { startAtHome: true });

  assert.equal(restored.snapshot().visible.kind, "home");
  assert.deepEqual(restored.snapshot().openProjects, ["FlipDock"]);
  assert.equal(restored.snapshot().projects.FlipDock.tasks[0].status, "running");
  assert.equal(restored.snapshot().projects.FlipDock.visibility, "background");
});
