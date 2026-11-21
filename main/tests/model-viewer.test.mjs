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
  const animationFrames = [];
  const context = Object.fromEntries([
    "setTransform", "clearRect", "save", "restore", "beginPath", "ellipse",
    "moveTo", "lineTo", "stroke", "closePath", "fill", "setLineDash",
  ].map((name) => [name, (...args) => operations.push([name, ...args])]));
  for (const property of ["fillStyle", "strokeStyle", "shadowColor", "shadowBlur", "lineWidth", "globalCompositeOperation"]) {
    Object.defineProperty(context, property, {
      set(value) {
        operations.push([property, value]);
      },
    });
  }
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
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame() {},
  };
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
  return { root, canvas, elements, operations, animationFrames };
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

test("3D renderer holográfico usa cuerpo petróleo sombreado y translúcido", (t) => {
  const { root, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  viewer.setQuality("high");
  operations.length = 0;
  viewer.load({
    name: "pieza-color.stl",
    format: "stl",
    bounds: { center: [0, 0, 0], radius: 1 },
    components: [{
      id: "mesh-a",
      name: "Malla cian",
      color: [0.2, 0.7, 0.9],
      positions: new Float32Array([
        -0.8, -0.6, 0, 0.8, -0.6, 0, 0, 0.8, 0,
      ]),
    }, {
      id: "mesh-b",
      name: "Malla ámbar",
      color: [0.35, 0.72, 0.82],
      positions: new Float32Array([
        -0.6, -0.4, -0.4, 0, 0.7, 0.4, 0.7, -0.4, -0.4,
      ]),
    }],
  });

  const fills = operations.filter(([name]) => name === "fillStyle").map(([, value]) => value);
  assert.ok(new Set(fills).size >= 2, `se esperaban caras con color variable; se obtuvo ${fills.join(", ")}`);
  assert.ok(fills.every((value) => /, \.82\)$/u.test(value)), "el cuerpo holográfico debe conservar opacidad 0.82");
  assert.ok(fills.every((value) => /^rgba\(\d+, \d+, \d+, \.82\)$/u.test(value)), "el cuerpo debe usar sombreado calculado");
  viewer.close();
});

test("3D renderer holográfico mantiene la superficie sólida al seleccionar", (t) => {
  const { root, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  viewer.setQuality("low");
  viewer.load({
    name: "cubo.stl",
    format: "stl",
    bounds: { center: [0, 0, 0], radius: 1 },
    components: [{
      id: "mesh",
      name: "Cubo",
      color: [0.2, 0.7, 0.9],
      positions: new Float32Array([
        -0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0,
        -0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0,
      ]),
    }],
  });
  const restingFills = operations.filter(([name]) => name === "fillStyle").map(([, value]) => value);
  operations.length = 0;

  viewer.selectComponentByName("Cubo");

  assert.equal(operations.filter(([name]) => name === "fill").length, 2, "la selección debe conservar todas las caras sólidas");
  assert.deepEqual(operations.filter(([name]) => name === "fillStyle").map(([, value]) => value), restingFills, "la selección no debe cambiar el material");
  assert.ok(operations.filter(([name]) => name === "stroke").length > 0, "debe conservar las aristas técnicas");
  viewer.close();
});

test("3D renderer holográfico no omite caras al superar el presupuesto interactivo", (t) => {
  const { root, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  const triangleCount = 15_000;
  const positions = new Float32Array(triangleCount * 9);
  for (let index = 0; index < positions.length; index += 9) {
    const offset = index / 90_000;
    positions[index] = offset;
    positions[index + 3] = offset + 0.01;
    positions[index + 7] = 0.01;
  }
  viewer.setQuality("high");
  operations.length = 0;

  viewer.load({
    name: "superficie-completa.3mf",
    format: "3mf",
    bounds: { center: [0.75, 0.005, 0], radius: 1 },
    components: [{ id: "mesh", name: "Superficie", color: [0.2, 0.7, 0.9], positions }],
  });

  assert.equal(operations.filter(([name]) => name === "fill").length, triangleCount, "el render estático debe dibujar todas las caras");
  viewer.close();
});

test("3D renderer agrupa movimientos del puntero en un solo cuadro", (t) => {
  const { root, canvas, operations, animationFrames } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  viewer.load({
    name: "ensamble.obj",
    format: "obj",
    bounds: { center: [0.5, 0.2, 0], radius: 1 },
    components: [component("base", "Base", 0), component("tapa", "Tapa", 0.6)],
  });
  canvas.click("pointerdown", { clientX: 10, clientY: 10, button: 0, shiftKey: false, pointerId: 1 });
  const rendersBeforeMove = operations.filter(([name]) => name === "clearRect").length;

  canvas.click("pointermove", { clientX: 20, clientY: 12 });
  canvas.click("pointermove", { clientX: 28, clientY: 16 });
  canvas.click("pointermove", { clientX: 35, clientY: 20 });

  assert.equal(operations.filter(([name]) => name === "clearRect").length, rendersBeforeMove);
  assert.equal(animationFrames.length, 1);
  animationFrames.shift()(16);
  assert.equal(operations.filter(([name]) => name === "clearRect").length, rendersBeforeMove + 1);
  viewer.close();
});

test("3D renderer conserva completa una malla grande en reposo", (t) => {
  const { root, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  const triangleCount = 100_000;
  const positions = new Float32Array(triangleCount * 9);
  for (let index = 0; index < positions.length; index += 9) {
    const offset = index / 9_000;
    positions[index] = offset;
    positions[index + 3] = offset + 0.4;
    positions[index + 7] = 0.4;
  }
  viewer.setQuality("low");
  operations.length = 0;
  viewer.load({
    name: "ensamble-grande.stl",
    format: "stl",
    bounds: { center: [50, 0.2, 0], radius: 50 },
    components: [{ id: "mesh", name: "Malla", color: [0.2, 0.7, 0.9], positions }],
  });

  const filledTriangles = operations.filter(([name]) => name === "fill").length;
  assert.equal(filledTriangles, triangleCount, `se dibujaron ${filledTriangles} de ${triangleCount} caras`);
  viewer.close();
});

test("3D renderer conserva material y detalle mientras se gira", (t) => {
  const { root, canvas, operations, animationFrames } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  const triangleCount = 100_000;
  const positions = new Float32Array(triangleCount * 9);
  for (let index = 0; index < positions.length; index += 9) {
    const offset = index / 9_000;
    positions[index] = offset;
    positions[index + 3] = offset + 0.4;
    positions[index + 7] = 0.4;
  }
  viewer.setQuality("high");
  viewer.load({
    name: "ensamble-interactivo.stl",
    format: "stl",
    bounds: { center: [50, 0.2, 0], radius: 50 },
    components: [{ id: "mesh", name: "Malla", color: [0.2, 0.7, 0.9], positions }],
  });
  operations.length = 0;

  canvas.click("pointerdown", { clientX: 10, clientY: 10, button: 0, shiftKey: false, pointerId: 1 });
  canvas.click("pointermove", { clientX: 40, clientY: 16 });
  animationFrames.shift()(16);

  const interactiveEdges = operations.filter(([name]) => name === "lineTo").length;
  const interactiveFills = operations.filter(([name]) => name === "fillStyle").map(([, value]) => value);
  operations.length = 0;
  canvas.click("pointerup", { clientX: 40, clientY: 16, button: 0 });
  assert.equal(operations.filter(([name]) => name === "lineTo").length, interactiveEdges, "el detalle cambió al soltar el puntero");
  assert.deepEqual(operations.filter(([name]) => name === "fillStyle").map(([, value]) => value), interactiveFills, "el material cambió al soltar el puntero");
  viewer.close();
});

test("3D renderer evita desenfoque costoso en mallas de miles de caras", (t) => {
  const { root, operations } = makeViewerHarness(t);
  const viewer = createModelViewer(root);
  const triangleCount = 5_000;
  const positions = new Float32Array(triangleCount * 9);
  for (let index = 0; index < positions.length; index += 9) {
    positions[index] = index / 9_000;
    positions[index + 3] = positions[index] + 0.4;
    positions[index + 7] = 0.4;
  }
  viewer.setQuality("high");
  operations.length = 0;
  viewer.load({
    name: "malla-detallada.stl",
    format: "stl",
    bounds: { center: [2.5, 0.2, 0], radius: 3 },
    components: [{ id: "mesh", name: "Malla", color: [0.2, 0.7, 0.9], positions }],
  });

  const blurValues = operations.filter(([name]) => name === "shadowBlur").map(([, value]) => value);
  assert.equal(Math.max(...blurValues), 0, `se aplic\u00f3 un desenfoque de ${Math.max(...blurValues)} px`);
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
