export const WORKSPACE_LAYOUTS = Object.freeze({
  home: Object.freeze({ left: [], center: ["core", "conversation"], right: ["context"], bottom: ["command"] }),
  project: Object.freeze({ left: ["project", "files", "context"], center: ["core", "conversation"], right: ["summary", "tasks", "activity"], bottom: ["command"] }),
  project_3d: Object.freeze({ left: ["project", "files", "conversation"], center: ["viewer3d"], right: ["model", "properties", "tasks", "activity"], bottom: ["command"] }),
  document: Object.freeze({ left: ["project", "files"], center: ["document", "conversation"], right: ["summary", "properties", "activity"], bottom: ["command"] }),
});

const REGIONS = ["left", "center", "right", "bottom"];
const PANELS = new Set(["project", "files", "context", "core", "conversation", "summary", "tasks", "activity", "viewer3d", "model", "properties", "document", "command"]);

export function resolveWorkspaceLayout(name = "project") {
  return cloneLayout(WORKSPACE_LAYOUTS[name] || WORKSPACE_LAYOUTS.project);
}

export function validateWorkspaceLayout(layout) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return { ok: false, error: "El layout debe ser un objeto" };
  const seen = new Set();
  for (const region of REGIONS) {
    if (!Array.isArray(layout[region])) return { ok: false, error: `La región ${region} debe ser una lista` };
    for (const panel of layout[region]) {
      if (!PANELS.has(panel) || seen.has(panel)) return { ok: false, error: `Panel inválido o repetido: ${panel}` };
      seen.add(panel);
    }
  }
  if (!seen.has("command")) return { ok: false, error: "El layout debe conservar la barra de comandos" };
  return { ok: true, value: cloneLayout(layout) };
}

export function cloneLayout(layout) {
  return Object.fromEntries(REGIONS.map(region => [region, [...(layout?.[region] || [])]]));
}
