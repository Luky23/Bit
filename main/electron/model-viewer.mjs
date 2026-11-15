const TAU = Math.PI * 2;

function rotatePoint(x, y, z, rotation) {
  const cosX = Math.cos(rotation.x), sinX = Math.sin(rotation.x);
  const cosY = Math.cos(rotation.y), sinY = Math.sin(rotation.y);
  const cosZ = Math.cos(rotation.z), sinZ = Math.sin(rotation.z);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  const x2 = x * cosY + z1 * sinY;
  const z2 = -x * sinY + z1 * cosY;
  return [x2 * cosZ - y1 * sinZ, x2 * sinZ + y1 * cosZ, z2];
}

function componentCenter(positions) {
  const center = [0, 0, 0];
  const count = positions.length / 3;
  for (let index = 0; index < positions.length; index += 3) {
    center[0] += positions[index];
    center[1] += positions[index + 1];
    center[2] += positions[index + 2];
  }
  return center.map((value) => value / count);
}

function pointInTriangle(x, y, triangle) {
  const [x1, y1, x2, y2, x3, y3] = triangle;
  const a = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const b = (x3 - x2) * (y - y2) - (y3 - y2) * (x - x2);
  const c = (x1 - x3) * (y - y3) - (y1 - y3) * (x - x3);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}

export function createModelViewer(root, componentRoot = root) {
  const canvas = root.querySelector("#model-canvas");
  const ctx = canvas?.getContext("2d", { alpha: true });
  const status = root.querySelector("#model-status");
  const componentList = componentRoot.querySelector("#model-components");
  const explodeSlider = root.querySelector("#explode-slider");
  const rotationSlider = root.querySelector("#model-rotation");
  const rotationValue = root.querySelector("#rotation-value");
  if (!canvas || !ctx || !status || !componentList || !explodeSlider || !rotationSlider || !rotationValue) {
    throw new Error("No se pudo iniciar el renderizador 3D del Workspace");
  }

  let model = null;
  let modelRadius = 1;
  let projected = [];
  let components = [];
  let selectedIndex = -1;
  let view = "iso";
  let mode = "holo";
  let qualityPreference = "automatic";
  let performanceProfile = {};
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let exploded = 0;
  let drag = null;
  let width = 0;
  let height = 0;
  let disposed = false;
  let resizeObserver = null;
  const controlCleanups = [];
  const componentCleanups = [];

  function effectiveQuality() {
    if (qualityPreference !== "automatic") return qualityPreference;
    const triangleCount = components.reduce((total, component) => total + component.positions.length / 9, 0);
    if ((performanceProfile.cpuUtilizationPercent ?? 0) >= 85
      || (performanceProfile.availableMemoryBytes ?? Infinity) < 1.5 * 1024 ** 3
      || triangleCount > 100_000) return "low";
    if ((performanceProfile.cpuUtilizationPercent ?? 0) >= 65 || triangleCount > 35_000) return "medium";
    return "high";
  }

  const views = {
    front: { x: 0, y: 0, z: 0 },
    rear: { x: 0, y: Math.PI, z: 0 },
    top: { x: -Math.PI / 2, y: 0, z: 0 },
    bottom: { x: Math.PI / 2, y: 0, z: 0 },
    left: { x: 0, y: -Math.PI / 2, z: 0 },
    right: { x: 0, y: Math.PI / 2, z: 0 },
    side: { x: 0, y: Math.PI / 2, z: 0 },
    iso: { x: -0.55, y: 0.68, z: 0 },
  };
  const rotation = { ...views[view] };

  function setStatus(message) {
    status.textContent = message;
  }

  function getSummary() {
    if (!model) return null;
    return {
      name: model.name,
      format: model.format,
      bounds: model.bounds,
      triangleCount: components.reduce((total, component) => total + component.positions.length / 9, 0),
      componentCount: components.length,
      visibleCount: components.filter((component) => component.visible).length,
      selectedComponent: selectedIndex >= 0 ? components[selectedIndex].name : "",
      units: model.units || "model units",
      componentStrategy: model.componentStrategy || (components.length > 1 ? "components" : "single-mesh"),
    };
  }

  function emitSummary() {
    if (typeof root.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
    const summary = getSummary();
    if (summary) root.dispatchEvent(new CustomEvent("bit-model-summary", { detail: summary }));
  }

  function syncRotationControl() {
    const degrees = ((rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    rotationSlider.value = String(Math.round(degrees));
    rotationValue.textContent = `${Math.round(degrees)}°`;
  }

  function fitCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(bounds.width));
    const nextHeight = Math.max(1, Math.floor(bounds.height));
    if (!nextWidth || !nextHeight) return;
    const ratioLimit = { low: 0.65, medium: 1, high: 1.5 }[effectiveQuality()];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, ratioLimit);
    if (canvas.width !== Math.round(nextWidth * pixelRatio) || canvas.height !== Math.round(nextHeight * pixelRatio)) {
      canvas.width = Math.round(nextWidth * pixelRatio);
      canvas.height = Math.round(nextHeight * pixelRatio);
    }
    width = nextWidth;
    height = nextHeight;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    render();
  }

  function buildComponentList() {
    for (const cleanup of componentCleanups.splice(0)) cleanup();
    componentList.replaceChildren();
    for (const [index, component] of components.entries()) {
      const row = document.createElement("div");
      row.className = "component-row";
      const select = document.createElement("button");
      select.type = "button";
      select.className = "component-select";
      select.textContent = component.name;
      select.setAttribute("aria-pressed", String(selectedIndex === index));
      select.title = `Seleccionar ${component.name}`;
      listenComponent(select, "click", () => selectComponent(index));
      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "component-visibility";
      visibility.textContent = component.visible ? "VISIBLE" : "OCULTO";
      visibility.setAttribute("aria-pressed", String(component.visible));
      visibility.title = `${component.visible ? "Ocultar" : "Mostrar"} ${component.name}`;
      listenComponent(visibility, "click", () => setComponentVisible(index, !component.visible));
      row.append(select, visibility);
      componentList.append(row);
    }
  }

  function drawGuides() {
    const centerX = width / 2 + panX;
    const centerY = height / 2 + panY;
    const radius = Math.max(34, Math.min(width, height) * 0.38);
    ctx.save();
    ctx.strokeStyle = "rgba(54, 199, 224, .13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 8]);
    for (const factor of [0.58, 0.8, 1]) {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * factor, radius * factor * 0.29, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(centerX - radius * 1.2, centerY);
    ctx.lineTo(centerX + radius * 1.2, centerY);
    ctx.moveTo(centerX, centerY - radius * 0.7);
    ctx.lineTo(centerX, centerY + radius * 0.7);
    ctx.strokeStyle = "rgba(52, 190, 218, .12)";
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (disposed || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const quality = effectiveQuality();
    if (quality !== "low") drawGuides();
    if (!model) {
      projected = [];
      return;
    }
    const { center } = model.bounds;
    const displayedRadius = modelRadius * (1 + exploded * 1.15);
    const scale = Math.min(width, height) * 0.39 * zoom / displayedRadius;
    const cameraDistance = displayedRadius * 4.5;
    const cameraX = width / 2 + panX;
    const cameraY = height / 2 + panY;
    projected = [];

    for (const [componentIndex, component] of components.entries()) {
      const screen = new Float32Array(component.positions.length);
      const centerOffset = component.offset;
      for (let index = 0; index < component.positions.length; index += 3) {
        const x = component.positions[index] - center[0] + centerOffset[0];
        const y = component.positions[index + 1] - center[1] + centerOffset[1];
        const z = component.positions[index + 2] - center[2] + centerOffset[2];
        const [rx, ry, rz] = rotatePoint(x, y, z, rotation);
        const perspective = cameraDistance / Math.max(cameraDistance * 0.25, cameraDistance - rz);
        screen[index] = cameraX + rx * scale * perspective;
        screen[index + 1] = cameraY - ry * scale * perspective;
        screen[index + 2] = rz;
      }
      projected.push(screen);
      if (!component.visible) continue;

      const selected = componentIndex === selectedIndex;
      const color = selected ? "255, 143, 71" : component.color.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(", ");
      ctx.beginPath();
      for (let index = 0; index < screen.length; index += 9) {
        ctx.moveTo(screen[index], screen[index + 1]);
        ctx.lineTo(screen[index + 3], screen[index + 4]);
        ctx.lineTo(screen[index + 6], screen[index + 7]);
        ctx.closePath();
      }
      if (mode !== "wireframe") {
        ctx.fillStyle = `rgba(${color}, ${selected ? 0.42 : mode === "solid" ? 0.88 : 0.2})`;
        ctx.fill();
      }
      ctx.strokeStyle = selected ? "rgba(255, 155, 80, .96)" : mode === "wireframe" ? "rgba(94, 225, 247, .82)" : "rgba(83, 226, 249, .43)";
      ctx.lineWidth = selected ? 1.35 : mode === "wireframe" ? 0.8 : 0.55;
      ctx.shadowColor = selected ? "#ff8c47" : "#31dfff";
      ctx.shadowBlur = quality === "high" ? selected ? 12 : mode === "holo" ? 8 : 0 : quality === "medium" && selected ? 5 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function setView(nextView) {
    if (!views[nextView]) throw new Error(`Vista 3D desconocida: ${nextView}`);
    view = nextView;
    Object.assign(rotation, views[view]);
    syncRotationControl();
    setStatus(`Vista ${nextView} aplicada`);
    render();
  }

  function setRotation(degrees) {
    if (!Number.isFinite(degrees)) throw new Error("La rotación solicitada no es válida");
    rotation.y = degrees * Math.PI / 180;
    syncRotationControl();
    setStatus(`Rotación horizontal: ${Math.round(degrees)}°`);
    render();
  }

  function setMode(nextMode) {
    if (!["solid", "wireframe", "holo"].includes(nextMode)) throw new Error(`Modo 3D desconocido: ${nextMode}`);
    mode = nextMode;
    const selector = root.querySelector("#model-mode");
    if (selector) selector.value = mode;
    setStatus(`Modo de renderizado: ${mode === "holo" ? "holograma" : mode}`);
    render();
  }

  function setQuality(value, profile = {}) {
    if (!["automatic", "low", "medium", "high"].includes(value)) {
      throw new Error("La calidad holográfica solicitada no es válida");
    }
    qualityPreference = value;
    performanceProfile = {
      cpuUtilizationPercent: Number.isFinite(profile.cpuUtilizationPercent) ? profile.cpuUtilizationPercent : null,
      availableMemoryBytes: Number.isFinite(profile.availableMemoryBytes) ? profile.availableMemoryBytes : null,
    };
    fitCanvas();
  }

  function updateOffsets() {
    if (!model) return;
    for (const component of components) {
      component.offset = component.explosionDirection.map((value) => value * modelRadius * 1.15 * exploded);
    }
    render();
  }

  function setExploded(value) {
    if (!model) throw new Error("Primero cargue un modelo 3D");
    if (components.length < 2) {
      exploded = 0;
      explodeSlider.value = "0";
      setStatus("Este archivo tiene una sola malla: no es posible generar una explosión fiable.");
      render();
      return;
    }
    exploded = Math.max(0, Math.min(1, Number(value) / 100));
    explodeSlider.value = String(Math.round(exploded * 100));
    updateOffsets();
    setStatus(exploded ? `Vista explosionada · separación ${Math.round(exploded * 100)}%` : "Ensamblaje original restaurado.");
  }

  function selectComponent(index) {
    if (!Number.isInteger(index) || index < 0 || index >= components.length) return;
    selectedIndex = index;
    buildComponentList();
    setStatus(`Componente seleccionado: ${components[index].name}`);
    render();
    emitSummary();
  }

  function resolveComponent(name) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Indique el nombre del componente o selecciónelo en el panel");
    const matches = components
      .map((component, index) => ({ component, index }))
      .filter(({ component }) => component.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    if (matches.length === 0) throw new Error(`No se encontró el componente "${name}"`);
    if (matches.length > 1) throw new Error(`El nombre "${name}" es ambiguo; indique el nombre completo del componente`);
    return matches[0].index;
  }

  function setComponentVisible(index, visible) {
    if (!components[index]) throw new Error("El componente seleccionado no existe");
    components[index].visible = Boolean(visible);
    buildComponentList();
    setStatus(`${components[index].visible ? "Visible" : "Oculto"}: ${components[index].name}`);
    render();
    emitSummary();
  }

  function reset() {
    if (!model) return;
    setView("iso");
    zoom = 1;
    panX = 0;
    panY = 0;
    setExploded(0);
    selectedIndex = -1;
    for (const component of components) component.visible = true;
    buildComponentList();
    setStatus(`Ensamblaje restablecido · ${components.length} componentes`);
    render();
    emitSummary();
  }

  function load(nextModel) {
    if (disposed) throw new Error("El visor 3D ya está cerrado");
    if (!nextModel?.components?.length) throw new Error("El archivo no contiene componentes 3D");
    model = nextModel;
    modelRadius = 0;
    for (const component of nextModel.components) {
      for (let index = 0; index < component.positions.length; index += 3) {
        modelRadius = Math.max(modelRadius, Math.hypot(
          component.positions[index] - nextModel.bounds.center[0],
          component.positions[index + 1] - nextModel.bounds.center[1],
          component.positions[index + 2] - nextModel.bounds.center[2],
        ));
      }
    }
    modelRadius = modelRadius || 1;
    components = nextModel.components.map((component, index) => {
      const centerPoint = componentCenter(component.positions);
      let direction = centerPoint.map((value, axis) => value - nextModel.bounds.center[axis]);
      let length = Math.hypot(...direction);
      if (length < nextModel.bounds.radius * 0.015) {
        const angle = (index + 1) * 2.399963229728653;
        direction = [Math.cos(angle), Math.sin(angle), Math.cos(angle * 0.63)];
        length = Math.hypot(...direction);
      }
      return {
        ...component,
        visible: true,
        offset: [0, 0, 0],
        explosionDirection: direction.map((value) => value / length),
      };
    });
    selectedIndex = -1;
    zoom = 1;
    panX = 0;
    panY = 0;
    exploded = 0;
    view = "iso";
    Object.assign(rotation, views[view]);
    syncRotationControl();
    explodeSlider.disabled = components.length < 2;
    explodeSlider.value = "0";
    buildComponentList();
    setStatus(`${nextModel.name} · ${components.length} componente(s) · ${nextModel.format.toUpperCase()}`);
    fitCanvas();
    emitSummary();
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let winner = -1;
    let nearestDepth = -Infinity;
    for (const [componentIndex, screen] of projected.entries()) {
      if (!components[componentIndex].visible) continue;
      for (let index = 0; index < screen.length; index += 9) {
        const triangle = [
          screen[index], screen[index + 1],
          screen[index + 3], screen[index + 4],
          screen[index + 6], screen[index + 7],
        ];
        if (pointInTriangle(x, y, triangle)) {
          const depth = (screen[index + 2] + screen[index + 5] + screen[index + 8]) / 3;
          if (depth > nearestDepth) {
            nearestDepth = depth;
            winner = componentIndex;
          }
        }
      }
    }
    if (winner >= 0) selectComponent(winner);
  }

  function onPointerDown(event) {
    if (!model) return;
    drag = { x: event.clientX, y: event.clientY, moved: false, pan: event.button !== 0 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.pan) {
      panX += dx;
      panY += dy;
    } else {
      rotation.y += dx * 0.008;
      rotation.x = Math.max(-Math.PI, Math.min(Math.PI, rotation.x + dy * 0.008));
      syncRotationControl();
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    render();
  }

  function onPointerUp(event) {
    if (drag && !drag.moved && event.button === 0) pick(event);
    drag = null;
  }

  function onWheel(event) {
    event.preventDefault();
    zoom = Math.max(0.15, Math.min(12, zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    render();
  }

  function onPointerCancel() {
    drag = null;
  }

  function listen(target, eventName, handler, options) {
    if (!target) return;
    target.addEventListener(eventName, handler, options);
    controlCleanups.push(() => target.removeEventListener(eventName, handler, options));
  }

  function listenComponent(target, eventName, handler) {
    target.addEventListener(eventName, handler);
    componentCleanups.push(() => target.removeEventListener(eventName, handler));
  }

  const onResize = () => fitCanvas();
  listen(canvas, "pointerdown", onPointerDown);
  listen(canvas, "pointermove", onPointerMove);
  listen(canvas, "pointerup", onPointerUp);
  listen(canvas, "pointercancel", onPointerCancel);
  listen(canvas, "wheel", onWheel, { passive: false });
  root.querySelectorAll("[data-view]").forEach((button) => listen(button, "click", () => setView(button.dataset.view)));
  listen(root.querySelector("#model-mode"), "change", (event) => setMode(event.target.value));
  listen(root.querySelector("#explode-assembled"), "click", () => setExploded(0));
  listen(root.querySelector("#explode-separated"), "click", () => setExploded(100));
  listen(root.querySelector("#model-reset"), "click", reset);
  listen(explodeSlider, "input", () => setExploded(explodeSlider.value));
  listen(rotationSlider, "input", () => setRotation(Number(rotationSlider.value)));
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
  } else {
    listen(window, "resize", onResize);
  }
  fitCanvas();

  return Object.freeze({
    load,
    setView,
    setRotation,
    setMode,
    setQuality,
    setExploded,
    selectComponent,
    setComponentVisible,
    selectComponentByName(name) {
      selectComponent(resolveComponent(name));
    },
    setComponentVisibleByName(name, visible) {
      setComponentVisible(resolveComponent(name), visible);
    },
    setSelectedComponentVisible(visible) {
      if (selectedIndex < 0) throw new Error("Seleccione primero un componente en el panel 3D");
      setComponentVisible(selectedIndex, visible);
    },
    rotateBy(degrees, axis = "y") {
      if (!model) throw new Error("Primero cargue un modelo 3D");
      if (!["x", "y", "z"].includes(axis) || !Number.isFinite(degrees)) throw new Error("La rotación solicitada no es válida");
      rotation[axis] += degrees * Math.PI / 180;
      syncRotationControl();
      setStatus(`Rotación aplicada: ${degrees}° en eje ${axis.toUpperCase()}`);
      render();
    },
    getSummary,
    reset,
    close() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      for (const cleanup of controlCleanups.splice(0)) cleanup();
      for (const cleanup of componentCleanups.splice(0)) cleanup();
      model = null;
      modelRadius = 1;
      projected = [];
      components = [];
      componentList.replaceChildren();
      ctx.clearRect(0, 0, width, height);
    },
  });
}
