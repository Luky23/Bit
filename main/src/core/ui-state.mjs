import { cloneLayout, resolveWorkspaceLayout, validateWorkspaceLayout } from "../projects/layout.mjs";

export const UI_ACTION_NAMES = Object.freeze([
  "ui.openPanel",
  "ui.closePanel",
  "ui.focusPanel",
  "ui.resizePanel",
  "ui.createWorkspace",
  "ui.setLayout",
  "ui.previewFile",
  "ui.open3DViewer",
  "ui.movePanelToDisplay",
  "ui.goBack",
  "ui.restoreWorkspace",
  "ui.returnHome",
]);

export const UI_PANELS = Object.freeze([
  "project", "files", "context", "core", "conversation", "summary", "tasks", "activity",
  "viewer3d", "model", "properties", "document", "command",
]);

const UI_PANEL_SET = new Set(UI_PANELS);
const IMMUTABLE_PANELS = new Set(["core", "command"]);
const UI_REGIONS = Object.freeze(["left", "center", "right", "bottom"]);
const UI_REGION_SET = new Set(UI_REGIONS);
const MAX_HISTORY = 40;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function boundedNumber(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function defaultPanels(layout) {
  const regions = new Map();
  for (const region of UI_REGIONS) {
    for (const panel of layout[region]) regions.set(panel, region);
  }
  return Object.fromEntries(UI_PANELS.map(panel => [panel, {
    open: regions.has(panel),
    region: regions.get(panel) || "right",
    width: null,
    height: null,
  }]));
}

function viewOf(state) {
  return clone({
    version: state.version,
    visualState: state.visualState,
    layout: state.layout,
    panels: state.panels,
    focusedPanel: state.focusedPanel,
    core: state.core,
    workspace: state.workspace,
    file: state.file,
    displayAssignments: state.displayAssignments,
  });
}

function normalizeLayout(layout, fallback = resolveWorkspaceLayout("home")) {
  const checked = validateWorkspaceLayout(layout);
  return checked.ok ? checked.value : cloneLayout(fallback);
}

function normalizePanels(panels, layout) {
  const defaults = defaultPanels(layout);
  if (!panels || typeof panels !== "object" || Array.isArray(panels)) return defaults;
  return Object.fromEntries(UI_PANELS.map(panel => {
    const candidate = panels[panel];
    const source = candidate && typeof candidate === "object" ? candidate : {};
    return [panel, {
      open: source.open === undefined ? defaults[panel].open : source.open === true,
      region: UI_REGION_SET.has(source.region) ? source.region : defaults[panel].region,
      width: Number.isFinite(source.width) ? boundedNumber(source.width, null, 180, 1600) : null,
      height: Number.isFinite(source.height) ? boundedNumber(source.height, null, 120, 1200) : null,
    }];
  }));
}

function normalizeState(input = {}) {
  const layout = normalizeLayout(input.layout);
  const panels = normalizePanels(input.panels, layout);
  panels.core.open = true;
  panels.command.open = true;
  const focusedPanel = UI_PANEL_SET.has(input.focusedPanel) && panels[input.focusedPanel].open
    ? input.focusedPanel
    : "core";
  return {
    version: 1,
    visualState: typeof input.visualState === "string" ? input.visualState : "idle",
    layout,
    panels,
    focusedPanel,
    core: {
      position: input.core?.position === "lateral" ? "lateral" : "center",
      scale: boundedNumber(input.core?.scale, 1, 0.7, 1.35),
    },
    workspace: input.workspace && typeof input.workspace === "object" ? clone(input.workspace) : null,
    file: input.file && typeof input.file === "object" ? clone(input.file) : null,
    displayAssignments: input.displayAssignments && typeof input.displayAssignments === "object"
      ? clone(input.displayAssignments)
      : {},
    history: [],
  };
}

function setLayoutState(state, layout, preset = "custom") {
  state.layout = normalizeLayout(layout);
  state.panels = normalizePanels(state.panels, state.layout);
  const included = new Set();
  for (const region of UI_REGIONS) {
    for (const panel of state.layout[region]) {
      state.panels[panel].region = region;
      state.panels[panel].open = true;
      included.add(panel);
    }
  }
  for (const panel of UI_PANELS) {
    if (!IMMUTABLE_PANELS.has(panel) && !included.has(panel)) state.panels[panel].open = false;
  }
  state.workspace = state.workspace ? { ...state.workspace, layout: preset } : state.workspace;
}

function restoreView(state, view) {
  const next = normalizeState(view);
  Object.assign(state, next);
}

export function createUiStateManager(initial = {}, { onChange } = {}) {
  const state = normalizeState(initial);

  const commit = (mutator, { remember = true } = {}) => {
    if (remember) state.history = [...state.history, viewOf(state)].slice(-MAX_HISTORY);
    mutator(state);
    const snapshot = snapshotState();
    onChange?.(snapshot);
    return snapshot;
  };

  const snapshotState = () => ({ ...viewOf(state), history: clone(state.history) });

  const dispatch = (action = {}) => {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      throw new Error("La acción de interfaz debe tener un tipo");
    }
    const args = action.args && typeof action.args === "object" ? action.args : action;
    switch (action.type) {
      case "ui.openPanel":
        if (!UI_PANEL_SET.has(args.panel)) throw new Error(`Panel inválido: ${args.panel}`);
        return commit(current => { current.panels[args.panel].open = true; });
      case "ui.closePanel":
        if (!UI_PANEL_SET.has(args.panel)) throw new Error(`Panel inválido: ${args.panel}`);
        if (IMMUTABLE_PANELS.has(args.panel)) throw new Error(`El panel ${args.panel} siempre debe permanecer disponible`);
        return commit(current => {
          current.panels[args.panel].open = false;
          if (current.focusedPanel === args.panel) current.focusedPanel = "core";
        });
      case "ui.focusPanel":
        if (!UI_PANEL_SET.has(args.panel)) throw new Error(`Panel inválido: ${args.panel}`);
        if (!state.panels[args.panel].open) throw new Error(`El panel ${args.panel} está cerrado`);
        return commit(current => { current.focusedPanel = args.panel; });
      case "ui.resizePanel":
        if (!UI_PANEL_SET.has(args.panel)) throw new Error(`Panel inválido: ${args.panel}`);
        if (args.width !== undefined && (!Number.isFinite(args.width) || args.width < 180 || args.width > 1600)) throw new Error("El ancho debe estar entre 180 y 1600 píxeles");
        if (args.height !== undefined && (!Number.isFinite(args.height) || args.height < 120 || args.height > 1200)) throw new Error("La altura debe estar entre 120 y 1200 píxeles");
        return commit(current => {
          if (args.width !== undefined) current.panels[args.panel].width = args.width;
          if (args.height !== undefined) current.panels[args.panel].height = args.height;
        });
      case "ui.createWorkspace":
        if (typeof args.name !== "string" || !args.name.trim()) throw new Error("El Workspace necesita un nombre");
        return commit(current => {
          current.workspace = { id: args.id || `workspace-${Date.now()}`, name: args.name.trim().slice(0, 120), layout: "project" };
          setLayoutState(current, resolveWorkspaceLayout("project"), "project");
          current.visualState = "project";
          current.core.position = "lateral";
          current.focusedPanel = "project";
        });
      case "ui.setLayout": {
        if (args.preset === "custom" && !args.layout) throw new Error("Un layout personalizado requiere sus regiones");
        const layout = args.layout || resolveWorkspaceLayout(args.preset || "home");
        const checked = validateWorkspaceLayout(layout);
        if (!checked.ok) throw new Error(checked.error);
        return commit(current => setLayoutState(current, checked.value, args.preset || "custom"));
      }
      case "ui.previewFile":
        if (typeof args.path !== "string" || !args.path.trim()) throw new Error("Falta la ruta local del archivo");
        return commit(current => {
          current.file = { path: args.path, name: args.name || args.path.split(/[\\/]/u).pop(), kind: args.kind || "unknown" };
          current.visualState = "file-intake";
          current.core.position = "lateral";
          current.panels.context.open = true;
          current.focusedPanel = "context";
        });
      case "ui.open3DViewer":
        if (typeof args.path !== "string" || !args.path.trim()) throw new Error("Falta la ruta local del modelo 3D");
        return commit(current => {
          setLayoutState(current, resolveWorkspaceLayout("project_3d"), "project_3d");
          current.file = { path: args.path, name: args.name || args.path.split(/[\\/]/u).pop(), kind: "3d" };
          current.visualState = "project-3d";
          current.core.position = "lateral";
          current.panels.viewer3d.open = true;
          current.panels.viewer3d.region = "center";
          current.focusedPanel = "viewer3d";
        });
      case "ui.movePanelToDisplay":
        if (!UI_PANEL_SET.has(args.panel)) throw new Error(`Panel inválido: ${args.panel}`);
        if (!Number.isInteger(args.displayId)) throw new Error("La pantalla debe identificarse con un número entero");
        return commit(current => { current.displayAssignments[args.panel] = args.displayId; });
      case "ui.goBack":
        if (!state.history.length) return snapshotState();
        return commit(current => {
          const previous = current.history[current.history.length - 1];
          const remaining = current.history.slice(0, -1);
          restoreView(current, previous);
          current.history = remaining;
        }, { remember: false });
      case "ui.restoreWorkspace":
        if (!args.snapshot || typeof args.snapshot !== "object") throw new Error("Falta la instantánea del Workspace");
        return commit(current => restoreView(current, args.snapshot));
      case "ui.returnHome":
        return commit(current => {
          const home = resolveWorkspaceLayout("home");
          setLayoutState(current, home, "home");
          current.visualState = "idle";
          current.workspace = null;
          current.file = null;
          current.core.position = "center";
          current.focusedPanel = "core";
          for (const panel of UI_PANELS) current.panels[panel].open = home.left.includes(panel) || home.center.includes(panel) || home.right.includes(panel) || home.bottom.includes(panel);
        });
      default:
        throw new Error(`Acción de interfaz desconocida: ${action.type}`);
    }
  };

  return Object.freeze({ dispatch, snapshot: snapshotState });
}

