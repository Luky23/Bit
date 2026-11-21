import test from "node:test";
import assert from "node:assert/strict";
import { initWorkspaceContext } from "../electron/workspace-context.mjs";

function createElement() {
  const classes = new Set();
  const listeners = new Map();
  const attributes = new Map();
  return {
    children: [],
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
      contains(name) { return classes.has(name); },
    },
    style: {},
    hidden: true,
    textContent: "",
    value: "",
    addEventListener(name, listener) { listeners.set(name, listener); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) || null; },
    removeAttribute(name) { attributes.delete(name); },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    dispatch(name, event = {}) { return listeners.get(name)?.(event); },
  };
}

function createHarness({ workspaceView = "none" } = {}) {
  const ids = [
    "file-context", "file-context-name", "file-context-meta", "file-context-response", "file-context-actions", "file-context-close",
    "file-context-icon", "file-context-kind-label", "file-context-viewer-title", "file-context-page-status", "file-context-question",
    "file-context-prompt", "file-context-send", "file-context-preview", "file-context-pdf", "file-context-audio", "file-context-video", "file-context-text", "file-context-grid", "file-context-pages",
    "project-context", "project-document", "project-model", "project-state-label",
    "model-summary", "model-title", "model-status", "project-model-facts", "project-model-facts-content", "project-file-name",
    "project-file-type", "project-file-size", "project-file-modified",
    "project-versions", "project-activity", "project-progress", "project-files",
    "project-file-count", "project-select", "project-name", "project-summary",
    "project-info-summary", "project-goals", "project-summary-banner",
    "document-title", "document-content", "project-model-viewer", "workspace-toggle",
    "project-close", "document-close", "model-close",
  ];
  const elements = new Map(ids.map(id => [id, createElement()]));
  const fileActions = new Map(["summarize", "analyze", "open", "project", "model3d"].map(action => [action, { dataset: { fileAction: action }, hidden: false, disabled: false }]));
  elements.get("file-context-actions").querySelectorAll = () => [...fileActions.values()];
  const orbArea = createElement();
  const body = createElement();
  const listeners = new Map();
  const requests = [];
  const fileRequests = [];
  const modelCalls = [];
  const runtime = {
    async projectSnapshot(request) {
      requests.push(request);
      const project = request.project || "Mark II";
      return {
        activeProject: "Mark II",
        workspaceView,
        lastSession: { project: "Mark II", goal: "Mantener el centro", lastTask: "Actualizar el visor" },
        projects: ["Mark II", "Other"],
        files: project === "Mark II" ? ["docs/readme.md", "models/sample.stl"] : ["notes.txt"],
        activity: [],
        file: request.path ? {
          project,
          path: request.path,
          size: 12,
          modifiedAt: "2026-01-01T00:00:00.000Z",
        } : null,
        versions: [],
      };
    },
    async readProjectFile() { return { content: "# Project document" }; },
    async openFile() { return { ok: true }; },
    async previewDroppedFile(filePath) {
      return filePath.endsWith(".stl")
        ? { kind: "model3d", notice: "Modelo 3D detectado; se abrirá en el visor 3D." }
        : { kind: "pdf", content: "Contenido de la página 1.", pageCount: 9, dataUrl: "data:application/pdf;base64,VA==", notice: "Vista previa y texto extraídos localmente." };
    },
    async processDroppedFile(request) { fileRequests.push(request); return { ok: true, text: "Respuesta local sobre el archivo." }; },
    async loadProjectModel(request) {
      modelCalls.push(request);
      return { data: new Uint8Array([1, 2, 3]) };
    },
    async setActiveProject(project) { return { ok: true, project }; },
    async closeWorkspace() { return { ok: true }; },
    async showHome() { requests.push({ home: true }); return { ok: true }; },
    onWorkspaceTransition(listener) { listeners.set("transition", listener); return () => {}; },
    onFileDropRequested(listener) { listeners.set("file-drop-requested", listener); return () => {}; },
    onProjectActivity(listener) { listeners.set("activity", listener); return () => {}; },
    onProjectSelection(listener) { listeners.set("selection", listener); return () => {}; },
    onProjectFileOpen(listener) { listeners.set("file-open", listener); return () => {}; },
    onDisplayChange(listener) { listeners.set("display", listener); return () => {}; },
    onViewerCommand(listener) { listeners.set("viewer", listener); return () => {}; },
    sendViewerCommandResult() {},
  };
  const documentRef = {
    body,
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return createElement(); },
    createTextNode(text) { return { textContent: String(text) }; },
    querySelector(selector) { return selector === ".orb-area" ? orbArea : null; },
  };
  const windowRef = {
    Option: function Option(text, value) { this.textContent = text; this.value = value; },
    addEventListener() {},
    matchMedia() { return { matches: true }; },
  };
  const modelRuntime = {
    parse3DModel({ name }) {
      return { name, format: "stl", bounds: { size: [1, 2, 3] } };
    },
    createModelViewer() {
      return {
        load() {},
        getSummary() {
          return {
            name: "models/sample.stl",
            format: "stl",
            bounds: { size: [1, 2, 3] },
            triangleCount: 2,
            componentCount: 1,
          };
        },
        close() { modelCalls.push("closed"); },
      };
    },
  };
  return { runtime, documentRef, windowRef, modelRuntime, elements, fileActions, body, orbArea, listeners, requests, fileRequests, modelCalls };
}

test("al recargar el renderer se restaura la composición del proyecto activo", async () => {
  const harness = createHarness({ workspaceView: "embedded" });
  initWorkspaceContext(harness);
  await settle();
  assert.equal(harness.body.classList.contains("project-active"), true);
  assert.equal(harness.elements.get("project-context").hidden, false);
  assert.equal(harness.elements.get("project-name").textContent, "Mark II");
});

test("un proyecto sin archivos muestra un estado vacío explícito en el explorador", async () => {
  const harness = createHarness();
  const snapshot = harness.runtime.projectSnapshot;
  harness.runtime.projectSnapshot = async request => ({ ...await snapshot(request), files: [] });
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "embedded" });
  await settle();
  const files = harness.elements.get("project-files");
  assert.equal(files.classList.contains("is-empty"), true);
  assert.match(files.children[0].textContent, /Arrastre archivos a Bit/u);
});

test("el visor lleva dimensiones y formato reales al panel derecho y los limpia al cerrar", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "embedded" });
  await settle();
  await harness.elements.get("project-files").children[1].dispatch("click");
  await settle();
  const facts = harness.elements.get("project-model-facts");
  const content = harness.elements.get("project-model-facts-content");
  const rendered = content.children.map(row => row.children.map(cell => cell.textContent).join(": ")).join(" · ");
  assert.equal(facts.hidden, false);
  assert.match(rendered, /STL/u);
  assert.match(rendered, /1 × 2 × 3/u);
  assert.match(rendered, /unidad no declarada/u);
  harness.elements.get("project-model-viewer").dispatch("bit-model-summary", {
    detail: { name: "models/sample.stl", format: "stl", bounds: { size: [1, 2, 3] }, triangleCount: 2, componentCount: 1, componentStrategy: "single-mesh", selectedComponent: "Base" },
  });
  const updated = content.children.map(row => row.children.map(cell => cell.textContent).join(": ")).join(" · ");
  assert.match(updated, /Selección: Base/u);
  harness.elements.get("model-close").dispatch("click");
  assert.equal(facts.hidden, true);
});

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

test("una pantalla transiciona entre reposo, proyecto, documento, modelo y regreso sin perder contexto", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "embedded" });
  await settle();

  assert.equal(harness.body.classList.contains("project-active"), true);
  assert.equal(harness.elements.get("project-context").hidden, false);
  assert.equal(harness.elements.get("project-name").textContent, "Mark II");

  const documentButton = harness.elements.get("project-files").children[0];
  await documentButton.dispatch("click");
  await settle();
  assert.equal(harness.elements.get("project-document").hidden, false);
  assert.equal(harness.elements.get("document-content").textContent, "# Project document");
  harness.elements.get("document-close").dispatch("click");
  assert.equal(harness.elements.get("project-document").hidden, true);
  assert.equal(harness.body.classList.contains("project-active"), true);

  const modelButton = harness.elements.get("project-files").children[1];
  await modelButton.dispatch("click");
  await settle();
  assert.equal(harness.elements.get("project-model").hidden, false);
  assert.equal(harness.body.classList.contains("model-active"), true);
  assert.deepEqual(harness.modelCalls[0], { project: "Mark II", path: "models/sample.stl" });
  harness.elements.get("model-close").dispatch("click");
  assert.equal(harness.elements.get("project-model").hidden, true);
  assert.equal(harness.body.classList.contains("model-active"), false);
  assert.equal(harness.body.classList.contains("project-active"), true);
  assert.ok(harness.requests.some(request => request.metadataOnly === true));

  harness.listeners.get("transition")({ phase: "return" });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(harness.elements.get("project-context").hidden, true);
  assert.equal(harness.body.classList.contains("project-active"), false);
});

test("un archivo soltado abre contexto intermedio sin activar el proyecto", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.windowRef.BitUI.setFileContext({ name: "informe.pdf", filePath: "C:/tmp/informe.pdf", size: 2048 });
  assert.equal(harness.elements.get("file-context").hidden, false);
  assert.equal(harness.body.classList.contains("file-active"), true);
  assert.equal(harness.body.classList.contains("project-active"), false);
  assert.equal(harness.elements.get("file-context-name").children[0].textContent, "informe.pdf");
  assert.equal(harness.fileActions.get("summarize").hidden, false);
  assert.equal(harness.fileActions.get("analyze").hidden, true);
  assert.equal(harness.fileActions.get("open").hidden, false);
});

test("cerrar un archivo incorporado durante un proyecto conserva el Workspace", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "embedded" });
  await settle();
  harness.windowRef.BitUI.setFileContext({ name: "plano.png", filePath: "C:/tmp/plano.png", size: 2048 });
  assert.equal(harness.body.classList.contains("file-context-active"), true);
  assert.equal(harness.body.classList.contains("project-active"), true);
  harness.windowRef.BitUI.closeFileContext();
  assert.equal(harness.body.classList.contains("project-active"), true);
  assert.equal(harness.elements.get("project-context").hidden, false);
});

test("Abrir un PDF usa el visor seguro y conserva una sola tarjeta", async () => {
  const harness = createHarness();
  let openedPath = "";
  harness.runtime.openFile = async path => { openedPath = path; return { ok: true }; };
  initWorkspaceContext(harness);
  harness.windowRef.BitUI.setFileContext({ name: "informe.pdf", filePath: "C:/tmp/informe.pdf", size: 2048 });
  await settle();
  assert.equal(harness.elements.get("file-context-page-status").children[0].textContent, "1 / 9");
  assert.equal(harness.elements.get("file-context-pages").children.length, 8);
  const button = harness.fileActions.get("open");
  await harness.elements.get("file-context-actions").dispatch("click", { target: { closest: () => button } });
  assert.equal(openedPath, "C:/tmp/informe.pdf");
  assert.equal(harness.elements.get("file-context").hidden, false);
  assert.match(harness.elements.get("file-context-response").textContent, /Archivo abierto/u);
});

test("la vista contextual permite preguntar sobre el archivo sin crear un proyecto", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.windowRef.BitUI.setFileContext({ name: "informe.pdf", filePath: "C:/tmp/informe.pdf", size: 2048 });
  harness.elements.get("file-context-prompt").value = "¿Cuál es la idea principal?";
  harness.elements.get("file-context-send").dispatch("click");
  await settle();
  assert.deepEqual(harness.fileRequests[0], {
    filePath: "C:/tmp/informe.pdf",
    action: "ask",
    question: "¿Cuál es la idea principal?",
  });
  assert.match(harness.elements.get("file-context-response").textContent, /Respuesta local/u);
});

test("si falla un modelo soltado, el error queda visible en el contexto del archivo", async () => {
  const harness = createHarness();
  harness.runtime.loadDroppedModel = async () => ({ data: new Uint8Array([1, 2, 3]), assets: {} });
  harness.modelRuntime.parse3DModel = () => { throw new Error("geometría inválida"); };
  initWorkspaceContext(harness);
  harness.windowRef.BitUI.setFileContext({ name: "pieza.stl", filePath: "C:/tmp/pieza.stl", size: 123 });
  await settle();
  assert.equal(harness.elements.get("file-context").hidden, false);
  assert.match(harness.elements.get("file-context-response").textContent, /geometría inválida/u);
});

test("la orden de arrastre abre un modelo local en el Workspace integrado", async () => {
  const harness = createHarness();
  let requestedPath = '';
  let response;
  harness.runtime.loadDroppedModel = async ({ filePath }) => {
    requestedPath = filePath;
    return { data: new Uint8Array([1, 2, 3]), assets: {} };
  };
  harness.runtime.sendViewerCommandResult = value => { response = value; };
  initWorkspaceContext(harness);
  await harness.listeners.get('viewer')({ id: 'drop-1', command: { action: 'load-dropped', filePath: 'C:/tmp/pieza.stl' } });
  assert.equal(requestedPath, 'C:/tmp/pieza.stl');
  assert.equal(response.result.ok, true);
  assert.equal(harness.elements.get('project-model').hidden, false);
  assert.equal(harness.body.classList.contains('project-active'), true);
  assert.equal(harness.body.dataset.visualState, 'project-3d');
});

test("la presentación multimonitor muestra un resumen principal y sincroniza la selección", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "parallel" });
  await settle();
  assert.equal(harness.elements.get("project-context").hidden, true);
  assert.equal(harness.elements.get("project-summary-banner").hidden, false);
  assert.match(harness.elements.get("project-summary-banner").textContent, /Mark II/u);

  harness.listeners.get("selection")("Other");
  await settle();
  assert.ok(harness.requests.some(request => request.project === "Other"));
  assert.match(harness.elements.get("project-summary-banner").textContent, /Other/u);

  harness.listeners.get("display")([{ role: "main" }]);
  await settle();
  assert.equal(harness.elements.get("project-context").hidden, false);
  assert.equal(harness.elements.get("project-summary-banner").hidden, true);
});

test("abrir un archivo sincronizado lo muestra y el núcleo conserva el acceso al inicio", async () => {
  const harness = createHarness();
  initWorkspaceContext(harness);
  harness.listeners.get("transition")({ phase: "enter", displayMode: "embedded" });
  await settle();
  harness.listeners.get("file-open")({ project: "Mark II", path: "docs/readme.md" });
  await settle();

  assert.equal(harness.elements.get("document-content").textContent, "# Project document");
  assert.match(harness.elements.get("project-goals").textContent, /Actualizar el visor/u);
  assert.equal(harness.orbArea.getAttribute("role"), "button");
  await harness.orbArea.dispatch("click");
  assert.ok(harness.requests.some(request => request.home === true));
});
