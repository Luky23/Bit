import test from "node:test";
import assert from "node:assert/strict";
import { createModelViewer } from "../electron/model-viewer.mjs";

function makeElement() {
  const listeners = new Map();
  return {
    children: [],
    dataset: {},
    value: "holo",
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    setAttribute() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    click(name = "click", event = {}) {
      for (const listener of listeners.get(name) || []) listener(event);
    },
    get listenerCount() {
      return [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0);
    },
  };
}

function makeViewerHarness(t) {
  const operations = [];
  const context = Object.fromEntries([
    "setTransform", "clearRect", "save", "restore", "beginPath", "ellipse",
    "moveTo", "lineTo", "stroke", "closePath", "fill", "setLineDash",
  ].map((name) => [name, (...args) => operations.push([name, ...args])]));
  const canvas = makeElement();
  Object.assign(canvas, {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 420 }),
    setPointerCapture() {},
  });
  const elements = new Map([
    ["#model-canvas", canvas],
    ["#model-status", makeElement()],
    ["#model-components", makeElement()],
    ["#explode-slider", makeElement()],
    ["#model-rotation", makeElement()],
    ["#rotation-value", makeElement()],
    ["#model-mode", makeElement()],
    ["#explode-assembled", makeElement()],
    ["#explode-separated", makeElement()],
    ["#model-reset", makeElement()],
  ]);
  const views = ["front", "rear", "top", "bottom", "left", "right", "side", "iso"].map((view) => {
    const button = makeElement();
    button.dataset.view = view;
    return button;
  });
  const root = {
    querySelector: (selector) => elements.get(selector) || null,
    querySelectorAll: () => views,
  };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { createElement: () => makeElement() };
  globalThis.ResizeObserver = undefined;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalResizeObserver;
  });
  return { root, canvas, elements, operations };
}

function component(id, name, xOffset) {
  return {
    id,
    name,
    color: [0.2, 0.7, 0.9],
    positions: new Float32Array([
      xOffset, 0, 0,
      xOffset + 0.4, 0, 0,
      xOffset, 0.4, 0,
    ]),
  };
}

test("3D renderer supports views, rotation, selection, visibility, explosion and disposal", (t) => {
  const { root, canvas, elements, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  viewer.load({
    name: "ensamble.obj",
    format: "obj",
    bounds: { center: [0.5, 0.2, 0], radius: 1 },
    components: [component("base", "Base", 0), component("tapa", "Tapa", 0.6)],
  });

  assert.equal(elements.get("#model-components").children.length, 2);
  assert.equal(viewer.getSummary().triangleCount, 2);
  assert.equal(viewer.getSummary().componentCount, 2);
  viewer.setQuality("low");
  assert.equal(canvas.width, 416);
  viewer.setQuality("automatic", { cpuUtilizationPercent: 90 });
  assert.equal(canvas.width, 416);
  viewer.setQuality("high");
  assert.equal(canvas.width, 640);
  viewer.setRotation(90);
  assert.equal(elements.get("#model-rotation").value, "90");
  assert.equal(elements.get("#rotation-value").textContent, "90°");
  assert.equal(operations.some(([name]) => name === "fill"), true);
  viewer.setView("top");
  for (const view of ["front", "rear", "top", "bottom", "left", "right", "iso"]) {
    assert.doesNotThrow(() => viewer.setView(view));
  }
  viewer.rotateBy(90, "z");
  viewer.setMode("wireframe");
  viewer.selectComponentByName("Base");
  viewer.setComponentVisibleByName("Tapa", false);
  viewer.setExploded(75);
  viewer.setExploded(0);
  viewer.reset();
  assert.match(elements.get("#model-status").textContent, /restablecido/u);

  viewer.close();
  assert.equal(canvas.listenerCount, 0);
  assert.equal(elements.get("#model-components").children.length, 0);
});

test("3D renderer rechaza una calidad no configurada", (t) => {
  const { root } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  assert.throws(() => viewer.setQuality("ultra"), /calidad holográfica/u);
  viewer.close();
});

test("3D renderer informa que no puede explosionar una malla única", (t) => {
  const { root, elements } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  viewer.load({
    name: "pieza.stl",
    format: "stl",
    bounds: { center: [0, 0, 0], radius: 1 },
    components: [component("single", "Malla STL", 0)],
  });

  viewer.setExploded(80);
  assert.match(elements.get("#model-status").textContent, /una sola malla/u);
  assert.equal(elements.get("#explode-slider").disabled, true);
  viewer.close();
});
