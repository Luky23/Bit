import test from "node:test";
import assert from "node:assert/strict";
import { createUiStateManager } from "../src/core/ui-state.mjs";

test("mantiene el núcleo, permite paneles dinámicos y vuelve atrás", () => {
  const manager = createUiStateManager();
  manager.dispatch({ type: "ui.openPanel", args: { panel: "project" } });
  manager.dispatch({ type: "ui.focusPanel", args: { panel: "project" } });
  assert.equal(manager.snapshot().focusedPanel, "project");

  manager.dispatch({ type: "ui.closePanel", args: { panel: "project" } });
  assert.equal(manager.snapshot().panels.project.open, false);
  manager.dispatch({ type: "ui.goBack" });
  assert.equal(manager.snapshot().panels.project.open, true);
  assert.throws(() => manager.dispatch({ type: "ui.closePanel", args: { panel: "core" } }), /siempre debe permanecer/iu);
});

test("crea un Workspace visual y adapta el visor 3D", () => {
  const manager = createUiStateManager();
  manager.dispatch({ type: "ui.createWorkspace", args: { name: "FlipDock" } });
  let state = manager.snapshot();
  assert.equal(state.visualState, "project");
  assert.equal(state.workspace.name, "FlipDock");
  assert.equal(state.core.position, "lateral");

  manager.dispatch({ type: "ui.open3DViewer", args: { path: "models/flipdock.stl" } });
  state = manager.snapshot();
  assert.equal(state.visualState, "project-3d");
  assert.equal(state.layout.center[0], "viewer3d");
  assert.equal(state.panels.viewer3d.open, true);
});

test("valida layouts personalizados, tamaños y pantallas", () => {
  const manager = createUiStateManager();
  const layout = { left: ["project"], center: ["core", "conversation"], right: ["context"], bottom: ["command"] };
  manager.dispatch({ type: "ui.setLayout", args: { preset: "custom", layout } });
  manager.dispatch({ type: "ui.resizePanel", args: { panel: "context", width: 420, height: 600 } });
  manager.dispatch({ type: "ui.movePanelToDisplay", args: { panel: "context", displayId: 123456789 } });
  const state = manager.snapshot();
  assert.equal(state.panels.context.width, 420);
  assert.equal(state.displayAssignments.context, 123456789);
  assert.throws(() => manager.dispatch({ type: "ui.setLayout", args: { preset: "custom" } }), /layout personalizado/iu);
});

