import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceLayout, validateWorkspaceLayout } from "../src/projects/layout.mjs";

test("layout: presets ubican el visor 3D al centro y conservan comandos", () => {
  const layout = resolveWorkspaceLayout("project_3d");
  assert.deepEqual(layout.center, ["viewer3d"]);
  assert.ok(layout.left.includes("files"));
  assert.ok(layout.right.includes("properties"));
  assert.deepEqual(layout.bottom, ["command"]);
});

test("layout: rechaza paneles repetidos y layouts sin barra de comandos", () => {
  assert.equal(validateWorkspaceLayout({ left: ["files"], center: [], right: ["files"], bottom: ["command"] }).ok, false);
  assert.equal(validateWorkspaceLayout({ left: [], center: [], right: [], bottom: [] }).ok, false);
});
