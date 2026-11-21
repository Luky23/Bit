/**
 * display-manager.mjs — Gestión Dinámica Multimonitor para Bit
 *
 * Detecta cambios de pantalla, asigna roles a cada monitor (Principal /
 * Proyecto / Telemetría / Holograma / Ninguna) y gestiona sus ventanas.
 *
 * Roles válidos:
 *   - "main"   : Ventana Principal (Núcleo 3D + Chat + Tarjetas)
 *   - "project": Workspace del Proyecto (Archivos + Diffs + estado tiempo real)
 *   - "info"   : Project Intelligence (resumen y actividad del proyecto)
 *   - "hologram": Overlay transparente a pantalla completa
 *   - "none"   : Desactivar pantalla / Ocultar
 *
 * Las preferencias de rol se persisten en config.json bajo la clave
 * "displayLayout" (mapa de displayId -> rol).
 */

import pkg from "electron";
const { BrowserWindow, ipcMain, screen } = pkg;
import { randomUUID } from "node:crypto";
import { resolveDisplayRoles } from '../src/core/display-layout.mjs';
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configGet, configSet } from "../src/core/config.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP_ICON = join(here, "assets", "bit-orb.png");

const DISPLAY_LAYOUT_KEY = "displayLayout";
const VALID_ROLES = new Set(["main", "project", "info", "hologram", "none"]);

/* ── Estado interno ─────────────────────────────────────────────── */

let mainWindowRef = null;
let overlayWindowRef = null;
let getOverlayDefaultBounds = null;
let onOverlayLayoutChange = null;
let projectWindow = null;
let infoWindow = null;
let roleChangeListeners = [];
let userRoles = new Map(); // displayId (number) -> role (string)
let initialized = false;
let singleDisplayWorkspaceMode = false;
let singleDisplayWorkspaceTransition = false;
let workspaceViewsVisible = false;

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
function computeDefaultRoles(displays, primaryDisplayId = screen.getPrimaryDisplay().id) {
  return resolveDisplayRoles(displays, new Map(), primaryDisplayId);
}

/**
 * Resuelve el rol efectivo para un display: preferencia del usuario si
 * existe, si no el rol por defecto según la disposición actual.
 */
function resolveRole(displayId, displays) {
  return resolveDisplayRoles(displays, userRoles, screen.getPrimaryDisplay().id).get(displayId) ?? 'none';
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
  const saved = await configSet(DISPLAY_LAYOUT_KEY, obj);
  if (!saved.ok) throw new Error(saved.error);
}

/* ── Ventanas secundarias ───────────────────────────────────────── */

/**
 * Crea una ventana secundaria frameless y transparente centrada en los
 * bounds del display indicado. Estética de cristal esmerilado / HUD.
 */
function createSecondaryWindowOnDisplay(displayBounds, role, query = {}) {
  const { x, y, width, height } = displayBounds;
  const winWidth = width;
  const winHeight = height;

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
      preload: join(here, "display-panel-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(join(here, 'display-panel.html'), { query: { role, ...query } });

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    // Notificar al renderer qué rol representa esta ventana
    win.webContents.send("bit:display-role-assigned", role);
  });

  win.on("closed", () => {
    if (win === projectWindow) {
      projectWindow = null;
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send("bit:workspace-transition", { phase: "return" });
      }
    }
    if (win === infoWindow) infoWindow = null;
  });

  return win;
}

/**
 * Crea (o reutiliza) la ventana del Panel de Proyecto en el display dado.
 */
export function createProjectWindow(displayBounds, { transition = false } = {}) {
  if (projectWindow && !projectWindow.isDestroyed()) {
    projectWindow.setBounds(displayBounds, true);
    if (transition) projectWindow.webContents.send("bit:workspace-transition", { phase: "enter" });
    projectWindow.show();
    projectWindow.webContents.send("bit:display-role-assigned", "project");
    return projectWindow;
  }
  projectWindow = createSecondaryWindowOnDisplay(displayBounds, "project", transition ? { transition: "enter" } : {});
  return projectWindow;
}

/** Muestra el Workspace y lo enfoca; en una sola pantalla alterna con Bit. */
export function showProjectWorkspace(displayBounds, { transition = false } = {}) {
  const entering = !workspaceViewsVisible;
  workspaceViewsVisible = true;
  singleDisplayWorkspaceMode = getDisplays().length === 1;
  const win = createProjectWindow(displayBounds, { transition: transition && entering });
  const infoDisplay = getDisplays().find(display => resolveRole(display.id, getDisplays()) === "info");
  if (infoDisplay) createInfoWindow(infoDisplay.workArea);
  if (win.isVisible()) {
    win.focus();
  } else {
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.focus();
    });
  }
  return win;
}

export function hideProjectWorkspace() {
  workspaceViewsVisible = false;
  for (const win of [projectWindow, infoWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send("bit:workspace-transition", { phase: "exit" });
    win.hide();
  }
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
  if (displays.length !== 1) {
    singleDisplayWorkspaceMode = false;
    singleDisplayWorkspaceTransition = false;
  }

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
    const { x, y, width, height } = mainDisplay.workArea;
    const mwWidth = width;
    const mwHeight = height;
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
    if (workspaceViewsVisible) createProjectWindow(projectDisplay.workArea);
    else projectWindow?.hide();
  } else {
    projectWindow = closeWindow(projectWindow);
  }

  // ── Ventana de Información ──
  const infoDisplay = displayByRole.get("info");
  if (infoDisplay) {
    if (workspaceViewsVisible) createInfoWindow(infoDisplay.workArea);
    else infoWindow?.hide();
  } else {
    infoWindow = closeWindow(infoWindow);
  }

  // El holograma usa la ventana overlay transparente y click-through existente.
  const hologramDisplay = displayByRole.get("hologram");
  if (overlayWindowRef && !overlayWindowRef.isDestroyed()) {
    if (hologramDisplay) {
      overlayWindowRef.setBounds(hologramDisplay.bounds, true);
      overlayWindowRef.setAlwaysOnTop(true, "floating");
      overlayWindowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      overlayWindowRef.setIgnoreMouseEvents(true, { forward: true });
      if (!overlayWindowRef.isVisible()) overlayWindowRef.showInactive();
    } else {
      overlayWindowRef.setIgnoreMouseEvents(false);
      if (getOverlayDefaultBounds) overlayWindowRef.setBounds(getOverlayDefaultBounds(), true);
    }
  }

  notifyRoleChange(displays);
  try { onOverlayLayoutChange?.(); } catch { /* no-op */ }

  // Notificar a la interfaz sobre el cambio de disposición
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.webContents.send("bit:display-change", getConnectedDisplays());
    } catch { /* no-op */ }
  }

  return { ok: true, displays: getConnectedDisplays() };
}

/* ── API pública ────────────────────────────────────────────────── */

/**
 * Devuelve la lista de monitores conectados con resoluciones,
 * posiciones y rol asignado.
 */
export function getConnectedDisplays() {
  return getDisplays().map((d) => ({
    id: d.id,
    role: resolveRole(d.id, getDisplays()),
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
    isPrimary: d.id === screen.getPrimaryDisplay().id,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
  }));
}

export function hasHologramDisplay() {
  const displays = getDisplays();
  return displays.some(display => resolveRole(display.id, displays) === "hologram");
}

/**
 * Asigna un rol a un monitor, lo persiste en config.json y notifica.
 */
export async function setDisplayRole(displayId, role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Rol de pantalla no válido: ${role}`);
  }
  const displays = getDisplays();
  if (!displays.some(d=>d.id===Number(displayId))) throw new Error('La pantalla ya no está conectada');
  const assignments = resolveDisplayRoles(displays, userRoles, screen.getPrimaryDisplay().id);
  const previous = assignments.get(Number(displayId));
  const occupied = displays.find(d=>d.id!==Number(displayId)&&assignments.get(d.id)===role&&role!=='none');
  if(previous==='main' && role!=='main' && !occupied) throw new Error('Asigne primero la pantalla principal a otro monitor');
  const before = new Map(userRoles);
  userRoles = new Map(assignments);
  if(occupied) userRoles.set(occupied.id,previous);
  userRoles.set(Number(displayId), role);
  try { await saveUserRoles(); } catch(error) { userRoles=before; throw error; }
  await updateDisplayLayout();
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
export function initDisplayManager({ mainWindow, overlayWindow, getOverlayDefaultBounds: getDefaultBounds, onOverlayLayoutChange: onOverlayChange } = {}) {
  if (initialized) return;
  initialized = true;
  mainWindowRef = mainWindow;
  overlayWindowRef = overlayWindow;
  getOverlayDefaultBounds = getDefaultBounds;
  onOverlayLayoutChange = onOverlayChange;

  const loaded = loadUserRoles();

  // ── Eventos de pantalla de Electron ────────────────────────────

  screen.on("display-added", (event, newDisplay) => {
    console.log(`[display-manager] Pantalla añadida: id=${newDisplay.id} x=${newDisplay.bounds.x}`);
    void updateDisplayLayout();
  });

  screen.on("display-removed", (event, oldDisplay) => {
    console.log(`[display-manager] Pantalla removida: id=${oldDisplay.id}`);
    // Recalcular los roles con la topología restante y cerrar vistas que ya
    // no tienen monitor asignado, evitando apilar paneles en una pantalla.
    void updateDisplayLayout();
  });

  screen.on("display-metrics-changed", (event, display, changedMetrics) => {
    console.log(`[display-manager] Métricas cambiadas: id=${display.id}`, changedMetrics);
    void updateDisplayLayout();
  });

  // Notificar a la UI principal sobre la disposición inicial
  void loaded.then(() => updateDisplayLayout());
}

export { getDisplays, computeDefaultRoles };

export function isDisplayPanel(sender) {
  return [projectWindow, infoWindow].some(win=>win&&!win.isDestroyed()&&win.webContents===sender);
}

export function requestWorkspaceViewerCommand(command, { preferMain = false } = {}) {
  const main = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
  const project = projectWindow && !projectWindow.isDestroyed() ? projectWindow : null;
  const win = preferMain ? main ?? project : project ?? main;
  if (!win) {
    return Promise.reject(new Error("No hay una ventana Workspace disponible para controlar el visor 3D"));
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      ipcMain.removeListener("bit:workspace-viewer-result", onResult);
      win.removeListener("closed", onClosed);
      win.webContents.removeListener("did-finish-load", send);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onResult = (event, response) => {
      if (event.sender !== win.webContents || response?.id !== id) return;
      if (typeof response.error === "string" && response.error) finish(new Error(response.error));
      else finish(null, response.result);
    };
    const onClosed = () => finish(new Error("La ventana Workspace se cerró antes de completar la acción 3D"));
    const send = () => {
      if (win.isDestroyed()) return onClosed();
      clearTimeout(timeout);
      timeout = setTimeout(() => finish(new Error("El Workspace no respondió a la acción 3D en 30 segundos")), 30_000);
      try {
        win.webContents.send("bit:workspace-viewer-command", { id, command });
      } catch (error) {
        finish(error);
      }
    };

    timeout = setTimeout(() => finish(new Error("El Workspace no terminó de iniciar para ejecutar la acción 3D")), 30_000);
    ipcMain.on("bit:workspace-viewer-result", onResult);
    win.once("closed", onClosed);
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
  });
}

export function notifyProjectPanels() {
  for(const win of [projectWindow,infoWindow,mainWindowRef]) {
    if(win&&!win.isDestroyed()) win.webContents.send('bit:project-activity');
  }
}

export function notifyProjectSelection(project) {
  for (const win of [projectWindow, infoWindow, mainWindowRef]) {
    if (win && !win.isDestroyed()) win.webContents.send("bit:project-selection", project);
  }
}

export function notifyProjectFileOpen(project, path) {
  const request = { project, path };
  for (const win of [projectWindow, mainWindowRef]) {
    if (!win || win.isDestroyed()) continue;
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send("bit:project-file-open", request);
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
  }
}

/** Mantiene las ventanas secundarias alineadas con la visibilidad de Bit. */
export function setSecondaryWindowsVisible(visible) {
  if (singleDisplayWorkspaceMode && singleDisplayWorkspaceTransition && getDisplays().length === 1) return;
  if (singleDisplayWorkspaceMode && getDisplays().length === 1) {
    for (const win of [projectWindow, infoWindow]) {
      if (!win || win.isDestroyed()) continue;
      if (visible || !workspaceViewsVisible) win.hide();
      else if (win === projectWindow) win.show();
      else win.hide();
    }
    return;
  }
  for (const win of [projectWindow, infoWindow]) {
    if (!win || win.isDestroyed()) continue;
    if (visible && workspaceViewsVisible) win.show();
    else win.hide();
  }
}

export function setSingleDisplayWorkspaceTransition(active, phase) {
  singleDisplayWorkspaceTransition = active === true;
  if (phase === "exit" && projectWindow && !projectWindow.isDestroyed()) {
    projectWindow.webContents.send("bit:workspace-transition", { phase });
  }
}
