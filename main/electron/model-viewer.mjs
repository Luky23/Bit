const TAU = Math.PI * 2;

function quaternionNormalize([x, y, z, w]) {
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

function quaternionMultiply(a, b) {
  return quaternionNormalize([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

function quaternionFromEuler({ x, y, z }) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return quaternionNormalize([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
}

function eulerFromQuaternion([x, y, z, w]) {
  return {
    x: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    y: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))),
    z: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  };
}

function trackballPoint(event, rect) {
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  const x = (event.clientX - (rect.left + rect.width / 2)) / radius;
  const y = ((rect.top + rect.height / 2) - event.clientY) / radius;
  const distance = Math.hypot(x, y);
  if (distance > 1) return [x / distance, y / distance, 0];
  return [x, y, Math.sqrt(1 - distance * distance)];
}

function quaternionFromTrackball(start, end) {
  const axis = [
    start[1] * end[2] - start[2] * end[1],
    start[2] * end[0] - start[0] * end[2],
    start[0] * end[1] - start[1] * end[0],
  ];
  const dot = Math.max(-1, Math.min(1, start[0] * end[0] + start[1] * end[1] + start[2] * end[2]));
  const axisLength = Math.hypot(...axis);
  if (axisLength < 0.000001) return [0, 0, 0, 1];
  const halfAngle = Math.atan2(axisLength, dot) / 2;
  const scale = Math.sin(halfAngle) / axisLength;
  return quaternionNormalize([axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(halfAngle)]);
}

function quaternionToCssMatrix([x, y, z, w]) {
  // CSS matrix3d usa la misma base de orientación que el cuaternión del
  // visor. Esto evita que el cubo se desincronice al cruzar ±180° en X/Z.
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ].join(",");
}

function rotateVectorByQuaternion([x, y, z], [qx, qy, qz, qw]) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}

const HOLOGRAM_PALETTE = Object.freeze([
  "rgba(12, 72, 104, .28)",
  "rgba(12, 166, 190, .36)",
  "rgba(83, 231, 231, .44)",
  "rgba(245, 184, 64, .54)",
  "rgba(255, 94, 36, .62)",
]);

const HOLOGRAM_COMPONENT_COLORS = Object.freeze([
  "rgba(39, 211, 231, .38)",
  "rgba(247, 181, 61, .46)",
  "rgba(255, 103, 50, .48)",
  "rgba(126, 151, 255, .4)",
  "rgba(74, 224, 174, .42)",
]);

function hologramBand(normalX, normalY, normalZ, triangleIndex) {
  const length = Math.hypot(normalX, normalY, normalZ) || 1;
  const x = normalX / length;
  const y = normalY / length;
  const z = normalZ / length;
  const light = Math.max(0, x * -0.32 + y * 0.24 + z * 0.92);
  const rim = 1 - Math.min(1, Math.abs(z));
  const warm = Math.max(0, x * 0.72 - y * 0.2 + z * 0.28);
  if (warm > 0.58 || (triangleIndex % 17 === 11 && light > 0.2)) return warm > 0.78 ? 4 : 3;
  if (light + rim * 0.4 > 0.78) return 2;
  return light + rim * 0.25 > 0.38 ? 1 : 0;
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

function hologramComponentColor(component, componentIndex) {
  const values = Array.isArray(component.color) ? component.color.map(Number) : [];
  const hasMaterialColor = values.length >= 3 && values.every((value) => Number.isFinite(value))
    && values.some((value, index) => Math.abs(value - [0.35, 0.72, 0.82][index]) > 0.04);
  if (!hasMaterialColor) {
    const [red, green, blue] = HOLOGRAM_COMPONENT_COLORS[componentIndex % HOLOGRAM_COMPONENT_COLORS.length]
      .match(/\d+/gu).slice(0, 3);
    return `rgba(${red}, ${green}, ${blue}, 1)`;
  }
  const [red, green, blue] = values.slice(0, 3).map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
  return `rgba(${red}, ${green}, ${blue}, 1)`;
}

function pointInTriangle(x, y, triangle) {
  const [x1, y1, x2, y2, x3, y3] = triangle;
  const a = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const b = (x3 - x2) * (y - y2) - (y3 - y2) * (x - x2);
  const c = (x1 - x3) * (y - y3) - (y1 - y3) * (x - x3);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}

const HOLOGRAM_EDGE_ANGLE = 22 * Math.PI / 180;
const HOLOGRAM_LIGHTS = Object.freeze([
  { direction: [-0.35, 0.72, 0.6], color: [56, 189, 248], strength: 0.72 },
  { direction: [0.62, -0.28, -0.74], color: [2, 132, 199], strength: 0.48 },
]);

function normalizedFaceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const length = Math.hypot(...normal) || 1;
  return normal.map(value => value / length);
}

function vertexKey(point) {
  return point.map(value => Math.round(value * 100_000)).join(":");
}

/** Equivalente CPU de THREE.EdgesGeometry(geometry, 22). */
function buildTechnicalEdges(positions) {
  const candidates = new Map();
  for (let index = 0; index < positions.length; index += 9) {
    const points = [
      [positions[index], positions[index + 1], positions[index + 2]],
      [positions[index + 3], positions[index + 4], positions[index + 5]],
      [positions[index + 6], positions[index + 7], positions[index + 8]],
    ];
    const normal = normalizedFaceNormal(...points);
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
      const firstKey = vertexKey(points[from]), secondKey = vertexKey(points[to]);
      const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
      const edge = candidates.get(key);
      if (edge) edge.normals.push(normal);
      else candidates.set(key, { a: points[from], b: points[to], normals: [normal] });
    }
  }
  const edges = [...candidates.values()].filter(edge => {
    if (edge.normals.length === 1) return true;
    const [first, second] = edge.normals;
    const dot = Math.max(-1, Math.min(1, first[0] * second[0] + first[1] * second[1] + first[2] * second[2]));
    return Math.acos(dot) >= HOLOGRAM_EDGE_ANGLE;
  }).map(edge => ({ ...edge, boundary: edge.normals.length === 1 }));
  const stride = Math.max(1, Math.ceil(edges.length / 12_000));
  return stride === 1 ? edges : edges.filter((_edge, index) => index % stride === 0);
}

export function createModelViewer(root, componentRoot = root) {
  const canvas = root.querySelector("#model-canvas");
  const navigationCube = root.querySelector(".model-view-cube");
  const navigationCubeBody = navigationCube?.querySelector?.(".cube-3d");
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
  let triangleCount = 0;
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
  let cubeDrag = null;
  let suppressCubeClick = false;
  let revealTimer = null;
  let lowResolutionPending = false;
  let interactionCooldownUntil = 0;
  let qualityRestoreTimer = null;
  let width = 0;
  let height = 0;
  let disposed = false;
  let resizeObserver = null;
  let renderFrame = 0;
  const controlCleanups = [];
  const componentCleanups = [];

  function effectiveQuality() {
    if (qualityPreference !== "automatic") return qualityPreference;
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
    // Isométrica inicial: superior + frontal + lateral derecho, sin roll.
    // Vista de carga equivalente a la referencia: superior + frontal +
    // derecha. Solo cambia la cámara; la geometría del archivo no se rota.
    "iso-nw": { x: -0.55, y: -0.68, z: 0 },
    "iso-ne": { x: -0.55, y: 0.68, z: -0.12 },
    "iso-sw": { x: 0.55, y: -0.68, z: -0.12 },
    "iso-se": { x: 0.55, y: 0.68, z: 0.12 },
  };
  const rotation = { ...views[view] };
  let orbitQuaternion = quaternionFromEuler(rotation);

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
    if (navigationCubeBody) {
      navigationCubeBody.style.transform = `matrix3d(${quaternionToCssMatrix(orbitQuaternion)})`;
    }
  }

  function fitCanvas(renderNow = true) {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(bounds.width));
    const nextHeight = Math.max(1, Math.floor(bounds.height));
    if (!nextWidth || !nextHeight) return;
    // Canvas 2D se rasteriza en CPU; un DPR alto multiplica el coste de cada
    // fotograma sin mejorar proporcionalmente la lectura del modelo.
    const ratioLimit = { low: 0.65, medium: 0.75, high: 1 }[effectiveQuality()];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, ratioLimit);
    if (canvas.width !== Math.round(nextWidth * pixelRatio) || canvas.height !== Math.round(nextHeight * pixelRatio)) {
      canvas.width = Math.round(nextWidth * pixelRatio);
      canvas.height = Math.round(nextHeight * pixelRatio);
    }
    width = nextWidth;
    height = nextHeight;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (renderNow) render();
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
    ctx.strokeStyle = "rgba(54, 199, 224, .16)";
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
    ctx.setLineDash([1, 7]);
    for (const factor of [0.38, 1.12]) {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * factor, radius * factor, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let index = 0; index < 24; index += 1) {
      const angle = index * TAU / 24;
      const inner = radius * (index % 3 === 0 ? 1.04 : 1.08);
      const outer = radius * 1.14;
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  function scheduleRender() {
    if (disposed || renderFrame) return;
    const requestFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
    renderFrame = requestFrame(() => {
      renderFrame = 0;
      if (lowResolutionPending) {
        lowResolutionPending = false;
        fitCanvas(false);
      }
      render();
    });
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
    // El visor corre en CPU. Durante la interacción y en modo de alambre se
    // limita el detalle, pero una superficie estática debe dibujar todas sus
    // caras: saltar triángulos deja agujeros reales en la geometría visible.
    const triangleBudget = { low: 2_500, medium: 7_000, high: 14_000 }[quality];
    const triangleStride = mode === "wireframe" ? Math.max(1, Math.ceil(triangleCount / triangleBudget)) : 1;
    projected = [];
    const drawList = [];

    for (const [componentIndex, component] of components.entries()) {
      const sampledLength = Math.ceil((component.positions.length / 9) / triangleStride) * 9;
      if (!component.projected || component.projected.length !== sampledLength) component.projected = new Float32Array(sampledLength);
      const screen = component.projected;
      const centerOffset = component.offset;
      let screenIndex = 0;
      const [qx, qy, qz, qw] = orbitQuaternion;
      for (let triangleIndex = 0; triangleIndex < component.positions.length; triangleIndex += 9 * triangleStride) {
        for (let vertexOffset = 0; vertexOffset < 9; vertexOffset += 3) {
          const index = triangleIndex + vertexOffset;
          const x = component.positions[index] - center[0] + centerOffset[0];
          const y = component.positions[index + 1] - center[1] + centerOffset[1];
          const z = component.positions[index + 2] - center[2] + centerOffset[2];
          // Rotación inline: evita crear arrays por vértice durante la órbita.
          const tx = 2 * (qy * z - qz * y);
          const ty = 2 * (qz * x - qx * z);
          const tz = 2 * (qx * y - qy * x);
          const rx = x + qw * tx + qy * tz - qz * ty;
          const ry = y + qw * ty + qz * tx - qx * tz;
          const rz = z + qw * tz + qx * ty - qy * tx;
          const perspective = cameraDistance / Math.max(cameraDistance * 0.25, cameraDistance - rz);
          screen[screenIndex] = cameraX + rx * scale * perspective;
          screen[screenIndex + 1] = cameraY - ry * scale * perspective;
          screen[screenIndex + 2] = rz;
          screenIndex += 3;
        }
      }
      projected.push(screen);
      if (!component.visible) continue;

      const selected = componentIndex === selectedIndex;
      const color = component.color.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(", ");
      for (let index = 0; index < screen.length; index += 9) {
        const normal = normalizedFaceNormal(
          [screen[index], screen[index + 1], screen[index + 2]],
          [screen[index + 3], screen[index + 4], screen[index + 5]],
          [screen[index + 6], screen[index + 7], screen[index + 8]],
        );
        let red = 6, green = 40, blue = 56;
        for (const light of HOLOGRAM_LIGHTS) {
          const diffuse = Math.max(0, normal[0] * light.direction[0] + normal[1] * light.direction[1] + normal[2] * light.direction[2]) * light.strength;
          red += light.color[0] * diffuse * 0.32;
          green += light.color[1] * diffuse * 0.32;
          blue += light.color[2] * diffuse * 0.32;
        }
        const fillStyle = mode === "holo"
          ? `rgba(${Math.min(255, Math.round(red))}, ${Math.min(255, Math.round(green))}, ${Math.min(255, Math.round(blue))}, .82)`
          : `rgba(${color}, .96)`;
        drawList.push({
          componentIndex,
          fillStyle,
          index,
          screen,
          selected,
          depth: (screen[index + 2] + screen[index + 5] + screen[index + 8]) / 3,
        });
      }
    }

    // Las caras lejanas se pintan primero. Sin esta pasada, una malla opaca
    // deja ver triángulos internos y parece un conjunto de líneas rotas.
    drawList.sort((first, second) => first.depth - second.depth);
    for (const triangle of drawList) {
      const { index, screen, selected, fillStyle } = triangle;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(screen[index], screen[index + 1]);
      ctx.lineTo(screen[index + 3], screen[index + 4]);
      ctx.lineTo(screen[index + 6], screen[index + 7]);
      ctx.closePath();
      if (mode !== "wireframe") {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }

      // La selección se comunica con color y estado en el panel. Trazar cada
      // triángulo seleccionado revela aristas internas y fragmenta la pieza.
      if (mode === "wireframe") {
        ctx.strokeStyle = selected ? "rgba(210, 255, 255, .98)" : "rgba(119, 238, 247, .86)";
        ctx.lineWidth = selected ? 1.35 : 0.8;
        ctx.shadowColor = selected ? "#9afaff" : "#31dfff";
        ctx.shadowBlur = selected || triangleCount < 4_000 ? 5 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    if (mode === "holo") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const component of components) {
        if (!component.visible) continue;
        for (const edge of component.technicalEdges) {
          const endpoints = [edge.a, edge.b].map(point => {
            const local = [
              point[0] - center[0] + component.offset[0],
              point[1] - center[1] + component.offset[1],
              point[2] - center[2] + component.offset[2],
            ];
            const rotated = rotateVectorByQuaternion(local, orbitQuaternion);
            const perspective = cameraDistance / Math.max(cameraDistance * 0.25, cameraDistance - rotated[2]);
            return [cameraX + rotated[0] * scale * perspective, cameraY - rotated[1] * scale * perspective];
          });
          ctx.beginPath();
          ctx.moveTo(...endpoints[0]);
          ctx.lineTo(...endpoints[1]);
          ctx.strokeStyle = edge.boundary ? "rgba(34, 211, 238, .68)" : "rgba(103, 232, 249, .45)";
          ctx.lineWidth = edge.boundary ? 1.35 : 0.8;
          ctx.shadowColor = edge.boundary ? "#22d3ee" : "transparent";
          ctx.shadowBlur = edge.boundary && component.technicalEdges.length < 4_000 ? 7 : 0;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function setView(nextView) {
    if (!views[nextView]) throw new Error(`Vista 3D desconocida: ${nextView}`);
    view = nextView;
    Object.assign(rotation, views[view]);
    orbitQuaternion = quaternionFromEuler(rotation);
    syncRotationControl();
    setStatus(`Vista ${nextView} aplicada`);
    render();
  }

  function setRotation(degrees) {
    if (!Number.isFinite(degrees)) throw new Error("La rotación solicitada no es válida");
    rotation.y = degrees * Math.PI / 180;
    view = "custom";
    orbitQuaternion = quaternionFromEuler(rotation);
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
    setView(model?.preferredView && views[model.preferredView] ? model.preferredView : "iso-nw");
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
    clearTimeout(revealTimer);
    canvas.classList?.remove("model-reveal", "model-reveal-pending");
    // El primer cuadro queda preparado antes de iniciar la animación. Así el
    // navegador no pinta la pieza terminada de golpe al cambiar de archivo.
    void canvas.offsetWidth;
    canvas.classList?.add("model-reveal-pending");
    // El parser ya calculó los límites reales. Recorriendo de nuevo todos los
    // vértices acá se congelaba la interfaz durante la carga de STL grandes.
    modelRadius = Number.isFinite(nextModel.bounds?.radius) && nextModel.bounds.radius > 0
      ? nextModel.bounds.radius
      : 1;
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
        technicalEdges: buildTechnicalEdges(component.positions),
        visible: true,
        offset: [0, 0, 0],
        explosionDirection: direction.map((value) => value / length),
      };
    });
    triangleCount = components.reduce((total, component) => total + component.positions.length / 9, 0);
    selectedIndex = -1;
    zoom = 1;
    panX = 0;
    panY = 0;
    exploded = 0;
    view = nextModel.preferredView && views[nextModel.preferredView] ? nextModel.preferredView : "iso-nw";
    Object.assign(rotation, views[view]);
    orbitQuaternion = quaternionFromEuler(rotation);
    syncRotationControl();
    explodeSlider.disabled = components.length < 2;
    explodeSlider.value = "0";
    buildComponentList();
    setStatus(`${nextModel.name} · ${components.length} componente(s) · ${nextModel.format.toUpperCase()}`);
    fitCanvas();
    setTimeout(() => {
      canvas.classList?.remove("model-reveal-pending");
      canvas.classList?.add("model-reveal");
      revealTimer = setTimeout(() => canvas.classList?.remove("model-reveal"), 980);
    }, 16);
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
    clearTimeout(qualityRestoreTimer);
    interactionCooldownUntil = 0;
    event.preventDefault?.();
    const rect = canvas.getBoundingClientRect();
    drag = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      // Navegación CAD: botón central orbita, Shift + central desplaza y el
      // botón derecho también desplaza. El clic izquierdo queda para elegir.
      pan: event.button === 2 || (event.button === 1 && event.shiftKey) || (event.button === 0 && event.shiftKey),
      orbit: event.button === 0 || (event.button === 1 && !event.shiftKey),
      roll: event.ctrlKey || event.altKey,
      trackballStart: trackballPoint(event, rect),
      orbitStart: [...orbitQuaternion],
    };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2 && !drag.moved) {
      drag.moved = true;
      lowResolutionPending = true;
    }
    if (drag.pan) {
      panX += dx;
      panY += dy;
    } else if (drag.roll) {
      rotation.z += dx * 0.008;
      rotation.z += dy * 0.002;
      orbitQuaternion = quaternionFromEuler(rotation);
      syncRotationControl();
    } else if (drag.orbit) {
      const nextPoint = trackballPoint(event, canvas.getBoundingClientRect());
      const delta = quaternionFromTrackball(drag.trackballStart, nextPoint);
      // La órbita se aplica en el sistema de la cámara, como en un visor CAD:
      // el eje de giro sigue la pantalla y no queda atado al eje local de la
      // pieza después de varios giros.
      orbitQuaternion = quaternionMultiply(delta, drag.orbitStart);
      Object.assign(rotation, eulerFromQuaternion(orbitQuaternion));
      view = "custom";
      syncRotationControl();
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    scheduleRender();
  }

  function onPointerUp(event) {
    const completedDrag = drag;
    drag = null;
    if (completedDrag?.moved) {
      if (renderFrame) {
        (window.cancelAnimationFrame || clearTimeout)(renderFrame);
        renderFrame = 0;
      }
      fitCanvas();
    }
  }

  function onWheel(event) {
    event.preventDefault();
    zoom = Math.max(0.15, Math.min(12, zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    scheduleRender();
  }

  function onPointerCancel() {
    drag = null;
  }

  function onCubePointerDown(event) {
    if (!model || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cubeDrag = { x: event.clientX, y: event.clientY, moved: false, start: [...orbitQuaternion] };
    navigationCube?.setPointerCapture?.(event.pointerId);
  }

  function onCubePointerMove(event) {
    if (!cubeDrag) return;
    const dx = event.clientX - cubeDrag.x;
    const dy = event.clientY - cubeDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) cubeDrag.moved = true;
    if (!cubeDrag.moved) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = quaternionFromEuler({ x: dy * 0.012, y: dx * 0.012, z: 0 });
    orbitQuaternion = quaternionMultiply(delta, cubeDrag.start);
    Object.assign(rotation, eulerFromQuaternion(orbitQuaternion));
    view = "custom";
    syncRotationControl();
    scheduleRender();
  }

  function onCubePointerUp(event) {
    if (!cubeDrag) return;
    if (cubeDrag.moved) {
      suppressCubeClick = true;
      event.preventDefault();
      event.stopPropagation();
      render();
    }
    cubeDrag = null;
  }

  function onCubeClick(event) {
    if (!suppressCubeClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressCubeClick = false;
  }

  function onContextMenu(event) {
    event.preventDefault();
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
  listen(canvas, "contextmenu", onContextMenu);
  listen(canvas, "wheel", onWheel, { passive: false });
  listen(navigationCube, "pointerdown", onCubePointerDown);
  listen(navigationCube, "pointermove", onCubePointerMove);
  listen(navigationCube, "pointerup", onCubePointerUp);
  listen(navigationCube, "pointercancel", onCubePointerUp);
  listen(navigationCube, "click", onCubeClick, true);
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
      view = "custom";
      // Mantener el cuaternión y los ángulos sincronizados. Antes el comando
      // actualizaba solo el control numérico y el render seguía usando la
      // orientación anterior.
      orbitQuaternion = quaternionFromEuler(rotation);
      syncRotationControl();
      setStatus(`Rotación aplicada: ${degrees}° en eje ${axis.toUpperCase()}`);
      render();
    },
    getSummary,
    reset,
    close() {
      if (disposed) return;
      disposed = true;
      if (renderFrame) {
        (window.cancelAnimationFrame || clearTimeout)(renderFrame);
        renderFrame = 0;
      }
      resizeObserver?.disconnect();
      clearTimeout(revealTimer);
      clearTimeout(qualityRestoreTimer);
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
