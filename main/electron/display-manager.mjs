/**
 * display-manager.mjs — Gestión Dinámica Multimonitor para Bit
 *
 * Detecta cambios de pantalla, asigna roles a cada monitor (Principal /
 * Proyecto / Telemetría / Ninguna) y gestiona las ventanas secundarias
 * (proyecto e información) con estética HUD frameless/transparente.
 *
 * Roles válidos:
 *   - "main"   : Ventana Principal (Núcleo 3D + Chat + Tarjetas)
 *   - "project": Workspace del Proyecto (Archivos + Diffs + estado tiempo real)
 *   - "info"   : Telemetría & Grafo de Obsidian (CPU/RAM/VRAM/Logs)
 *   - "none"   : Desactivar pantalla / Ocultar
 *
 * Las preferencias de rol se persisten en config.json bajo la clave
 * "displayLayout" (mapa de displayId -> rol).
 */

import { app, BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { configGet, configSet } from "../src/core/config.mjs";

const here = new URL(".", import.meta.url);
const APP_ICON = join(here, "assets", "bit-orb.png");

const DISPLAY_LAYOUT_KEY = "displayLayout";
const VALID_ROLES = new Set(["main", "project", "info", "none"]);

/* ── Estado interno ─────────────────────────────────────────────── */

let mainWindowRef = null;
let projectWindow = null;
let infoWindow = null;
let roleChangeListeners = [];
let userRoles = new Map(); // displayId (number) -> role (string)
let initialized = false;

/* ── Utilidades de pantalla ─────────────────────────────────────── */

/**
 * Devuelve todas las pantallas conectadas ordenadas por posición X
 * (izquierda a derecha).
 */
function getDisplays() {
  return screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);
}

/**
 * Calcula roles por defecto según la cantidad de monitores y su
 * posición física horizontal.
 */
function computeDefaultRoles(displays) {
  const roles = new Map();
  const count = displays.length;
  if (count === 0) return roles;

  if (count === 1) {
    // 1 monitor: Modo Compacto → todo en la única pantalla
    roles.set(displays[0].id, "main");
  } else if (count === 2) {
    // 2 monitores: Principal + Proyecto
    roles.set(displays[0].id, "main");
    roles.set(displays[1].id, "project");
  } else {
    // 3+ monitores: Proyecto (izq) + Principal (centro) + Info (der)
    roles.set(displays[0].id, "project"); // Monitor izquierdo
    roles.set(displays[1].id, "main");    // Monitor central
    roles.set(displays[2].id, "info");    // Monitor derecho
    for (let i = 3; i < count; i++) {
      roles.set(displays[i].id, "none");  // Monitores extra: desactivados
    }
  }
  return roles;
}

/**
 * Resuelve el rol efectivo para un display: preferencia del usuario si
 * existe, si no el rol por defecto según la disposición actual.
 */
function resolveRole(displayId, displays) {
  if (userRoles.has(displayId)) return userRoles.get(displayId);
  const defaults = computeDefaultRoles(displays);
  return defaults.get(displayId) ?? "none";
}

/* ── Persistencia ───────────────────────────────────────────────── */

async function loadUserRoles() {
  const result = await configGet(DISPLAY_LAYOUT_KEY);
  userRoles = new Map();
  if (result.ok && result.value && typeof result.value === "object") {
    for (const [key, value] of Object.entries(result.value)) {
      if (VALID_ROLES.has(value)) {
        userRoles.set(Number(key), value);
      }
    }
  }
}

async function saveUserRoles() {
  const obj = {};
  for (const [displayId, role] of userRoles) {
    obj[String(displayId)] = role;
  }
  await configSet(DISPLAY_LAYOUT_KEY, obj);
}

/* ── Ventanas secundarias ───────────────────────────────────────── */

/**
 * Crea una ventana secundaria frameless y transparente centrada en los
 * bounds del display indicado. Estética de cristal esmerilado / HUD.
 */
function createSecondaryWindowOnDisplay(displayBounds, role) {
  const { x, y, width, height } = displayBounds;
  const winWidth = Math.min(960, width);
  const winHeight = Math.min(760, height);

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: x + Math.max(0, Math.floor((width - winWidth) / 2)),
    y: y + Math.max(0, Math.floor((height - winHeight) / 2)),
    minWidth: 480,
    minHeight: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    icon: APP_ICON,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(join(here, "index.html"));

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    // Notificar al renderer qué rol representa esta ventana
    win.webContents.send("bit:display-role-assigned", role);
  });

  win.on("closed", () => {
    if (win === projectWindow) projectWindow = null;
    if (win === infoWindow) infoWindow = null;
  });

  return win;
}

/**
 * Crea (o reutiliza) la ventana del Panel de Proyecto en el display dado.
 */
export function createProjectWindow(displayBounds) {
  if (projectWindow && !projectWindow.isDestroyed()) {
    projectWindow.setBounds(displayBounds, true);
    projectWindow.show();
    projectWindow.webContents.send("bit:display-role-assigned", "project");
    return projectWindow;
  }
  projectWindow = createSecondaryWindowOnDisplay(displayBounds, "project");
  return projectWindow;
}

/**
 * Crea (o reutiliza) la ventana del Panel de Información en el display dado.
 */
export function createInfoWindow(displayBounds) {
  if (infoWindow && !infoWindow.isDestroyed()) {
    infoWindow.setBounds(displayBounds, true);
    infoWindow.show();
    infoWindow.webContents.send("bit:display-role-assigned", "info");
    return infoWindow;
  }
  infoWindow = createSecondaryWindowOnDisplay(displayBounds, "info");
  return infoWindow;
}

/**
 * Cierra una ventana secundaria específica si existe.
 */
function closeWindow(ref) {
  if (ref && !ref.isDestroyed()) {
    ref.close();
  }
  return null;
}

/* ── Layout dinámico ────────────────────────────────────────────── */

/**
 * Reposiciona todas las ventanas según los roles actuales. Se invoca
 * al arranque, al cambiar la configuración y al conectar/desconectar
 * monitores.
 */
export async function updateDisplayLayout() {
  const displays = getDisplays();

  // Resolver rol para cada pantalla
  const assignments = new Map(); // displayId -> role
  for (const display of displays) {
    assignments.set(display.id, resolveRole(display.id, displays));
  }

  // Localizar el display asignado a cada rol (primera coincidencia)
  const displayByRole = new Map();
  for (const [displayId, role] of assignments) {
    if (!displayByRole.has(role)) {
      const d = displays.find((x) => x.id === displayId);
      if (d) displayByRole.set(role, d);
    }
  }

  // ── Ventana Principal ──
  const mainDisplay = displayByRole.get("main");
  if (mainDisplay && mainWindowRef && !mainWindowRef.isDestroyed()) {
    const { x, y, width, height } = mainDisplay.bounds;
    const mwWidth = Math.min(980, width);
    const mwHeight = Math.min(720, height);
    mainWindowRef.setBounds({
      x: x + Math.max(0, Math.floor((width - mwWidth) / 2)),
      y: y + Math.max(0, Math.floor((height - mwHeight) / 2)),
      width: mwWidth,
      height: mwHeight,
    }, true);
    if (!mainWindowRef.isVisible()) mainWindowRef.show();
    mainWindowRef.webContents.send("bit:display-role-assigned", "main");
  } else if (!mainDisplay && mainWindowRef && !mainWindowRef.isDestroyed()) {
    // No hay pantalla asignada a "main": ocultar la principal
    mainWindowRef.hide();
  }

  // ── Ventana del Proyecto ──
  const projectDisplay = displayByRole.get("project");
  if (projectDisplay) {
    createProjectWindow(projectDisplay.bounds);
  } else {
    projectWindow = closeWindow(projectWindow);
  }

  // ── Ventana de Información ──
  const infoDisplay = displayByRole.get("info");
  if (infoDisplay) {
    createInfoWindow(infoDisplay.bounds);
  } else {
    infoWindow = closeWindow(infoWindow);
  }

  notifyRoleChange(displays);

  // Notificar a la interfaz sobre el cambio de disposición
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.webContents.send("bit:display-change", getConnectedDisplays());
    } catch { /* no-op */ }
  }

  return { ok: true, displays: getConnectedDisplays() };
}

/**
 * Forzar reposición de paneles abiertos a la pantalla principal activa
 * cuando un monitor se desconecta (sin cerrar la aplicación).
 */
function regroupToPrimary() {
  const primary = screen.getPrimaryDisplay();
  const displays = getDisplays();

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    const { x, y, width, height } = primary.bounds;
    const mwWidth = Math.min(980, width);
    const mwHeight = Math.min(720, height);
    mainWindowRef.setBounds({
      x: x + Math.max(0, Math.floor((width - mwWidth) / 2)),
      y: y + Math.max(0, Math.floor((height - mwHeight) / 2)),
      width: mwWidth,
      height: mwHeight,
    }, true);
    if (!mainWindowRef.isVisible()) mainWindowRef.show();
    mainWindowRef.webContents.send("bit:display-role-assigned", "main");
  }

  if (projectWindow && !projectWindow.isDestroyed()) {
    projectWindow.setBounds(primary.bounds, true);
    projectWindow.show();
    projectWindow.webContents.send("bit:display-role-assigned", "project");
  }
  if (infoWindow && !infoWindow.isDestroyed()) {
    infoWindow.setBounds(primary.bounds, true);
    infoWindow.show();
    infoWindow.webContents.send("bit:display-role-assigned", "info");
  }

  notifyRoleChange(displays);

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.webContents.send("bit:display-change", getConnectedDisplays());
    } catch { /* no-op */ }
  }
}

/* ── API pública ────────────────────────────────────────────────── */

/**
 * Devuelve la lista de monitores conectados con resoluciones,
 * posiciones y rol asignado.
 */
export function getConnectedDisplays() {
  return getDisplays().map((d) => ({
    id: d.id,
    role: userRoles.has(d.id) ? userRoles.get(d.id) : resolveRole(d.id, getDisplays()),
    bounds: {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
    },
    size: { width: d.size.width, height: d.size.height },
    workArea: {
      x: d.workArea.x,
      y: d.workArea.y,
      width: d.workArea.width,
      height: d.workArea.height,
    },
    isPrimary: d.isPrimary,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
  }));
}

/**
 * Asigna un rol a un monitor, lo persiste en config.json y notifica.
 */
export function setDisplayRole(displayId, role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Rol de pantalla no válido: ${role}`);
  }
  userRoles.set(Number(displayId), role);
  void saveUserRoles();
  void updateDisplayLayout();
}

/**
 * Suscribe un listener a cambios de rol de pantallas.
 * Devuelve una función para cancelar la suscripción.
 */
export function onDisplayRoleChange(listener) {
  roleChangeListeners.push(listener);
  return () => {
    roleChangeListeners = roleChangeListeners.filter((l) => l !== listener);
  };
}

function notifyRoleChange(displays) {
  const current = getConnectedDisplays();
  for (const listener of roleChangeListeners) {
    try { listener(current); } catch { /* no-op */ }
  }
}

/**
 * Inicializa el gestor de pantallas. Debe llamarse una vez desde
 * main.mjs tras `app.whenReady()`.
 *
 * @param {Object} options
 * @param {BrowserWindow} options.mainWindow - Referencia a la ventana principal
 */
export function initDisplayManager({ mainWindow } = {}) {
  if (initialized) return;
  initialized = true;
  mainWindowRef = mainWindow;

  void loadUserRoles();

  // ── Eventos de pantalla de Electron ────────────────────────────

  screen.on("display-added", (event, newDisplay) => {
    console.log(`[display-manager] Pantalla añadida: id=${newDisplay.id} x=${newDisplay.bounds.x}`);
    void updateDisplayLayout();
  });

  screen.on("display-removed", (event, oldDisplay) => {
    console.log(`[display-manager] Pantalla removida: id=${oldDisplay.id}`);
    // Agrupar paneles abiertos en la pantalla principal activa
    regroupToPrimary();
    void updateDisplayLayout();
  });

  screen.on("display-metrics-changed", (event, display, changedMetrics) => {
    console.log(`[display-manager] Métricas cambiadas: id=${display.id}`, changedMetrics);
    void updateDisplayLayout();
  });

  // Notificar a la UI principal sobre la disposición inicial
  void updateDisplayLayout();
}

export { getDisplays, computeDefaultRoles };
