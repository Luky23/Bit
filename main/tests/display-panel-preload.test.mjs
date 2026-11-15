import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("el preload del Workspace restringe la lectura de modelos y confirma comandos del visor", async () => {
  const source = await readFile(new URL("../electron/display-panel-preload.cjs", import.meta.url), "utf8");
  const invocations = [];
  const sent = [];
  const listeners = new Map();
  let exposedBridge;
  const contextBridge = {
    exposeInMainWorld(name, bridge) {
      assert.equal(name, "projectPanel");
      exposedBridge = bridge;
    },
  };
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args);
      return { data: new Uint8Array([1, 2, 3]) };
    },
    on(channel, handler) { listeners.set(channel, handler); },
    removeListener(channel, handler) {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
    send(...args) { sent.push(args); },
  };
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, "electron");
      return { contextBridge, ipcRenderer };
    },
  });

  await exposedBridge.snapshot({ project: "Mark II" });
  await exposedBridge.setActiveProject("Mark II");
  const loaded = await exposedBridge.loadModel({ project: "Mark II", path: "part.glb" });
  await exposedBridge.chat("Muestra la vista superior");
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ["bit:project-panel", { project: "Mark II" }],
    ["bit:project-panel-select-project", "Mark II"],
    ["bit:project-panel-load-model", { project: "Mark II", path: "part.glb" }],
    ["bit:chat", { message: "Muestra la vista superior" }],
  ]);
  assert.deepEqual([...loaded.data], [1, 2, 3]);

  let command;
  const unsubscribe = exposedBridge.onViewerCommand((request) => { command = request; });
  listeners.get("bit:workspace-viewer-command")({}, { id: "request-1", command: { action: "view", view: "top" } });
  assert.deepEqual(command, { id: "request-1", command: { action: "view", view: "top" } });
  exposedBridge.sendViewerCommandResult({ id: "request-1", result: { ok: true } });
  assert.deepEqual(sent, [["bit:workspace-viewer-result", { id: "request-1", result: { ok: true } }]]);
  unsubscribe();
  assert.equal(listeners.has("bit:workspace-viewer-command"), false);

  let transition;
  const unsubscribeTransition = exposedBridge.onWorkspaceTransition((value) => { transition = value; });
  listeners.get("bit:workspace-transition")({}, { phase: "exit" });
  assert.deepEqual(transition, { phase: "exit" });
  unsubscribeTransition();
  assert.equal(listeners.has("bit:workspace-transition"), false);

  let projectSelection;
  const unsubscribeSelection = exposedBridge.onProjectSelection(project => { projectSelection = project; });
  listeners.get("bit:project-selection")({}, "Mark II");
  assert.equal(projectSelection, "Mark II");
  unsubscribeSelection();
  assert.equal(listeners.has("bit:project-selection"), false);

  let projectFile;
  const unsubscribeFile = exposedBridge.onProjectFileOpen(request => { projectFile = request; });
  listeners.get("bit:project-file-open")({}, { project: "Mark II", path: "part.glb" });
  assert.deepEqual(projectFile, { project: "Mark II", path: "part.glb" });
  unsubscribeFile();
  assert.equal(listeners.has("bit:project-file-open"), false);

  await exposedBridge.showHome();
  assert.deepEqual(invocations.at(-1), ["bit:show-home"]);

  let chunk;
  const unsubscribeChunks = exposedBridge.onChatChunk((text) => { chunk = text; });
  listeners.get("bit:chat-chunk")({}, { text: "Vista superior aplicada." });
  assert.equal(chunk, "Vista superior aplicada.");
  unsubscribeChunks();
  assert.equal(listeners.has("bit:chat-chunk"), false);
});
