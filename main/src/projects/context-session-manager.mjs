const VERSION = 1;
const HOME = Object.freeze({ kind: "home" });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validName(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 80) throw new Error("Nombre de proyecto no válido");
  return value.normalize("NFC").trim();
}

function sameContext(a, b) {
  return a?.kind === b?.kind && a?.project === b?.project && a?.path === b?.path;
}

function defaultProject(name) {
  return {
    name,
    lifecycle: "open",
    visibility: "background",
    dirty: false,
    selectedFiles: [],
    conversation: [],
    tasks: [],
    progress: null,
    model: "",
    operation: null,
    viewer: { path: "", camera: null, state: null },
  };
}

function normalizeStored(stored) {
  if (!stored || stored.version !== VERSION || !stored.projects || typeof stored.projects !== "object") {
    return { version: VERSION, visible: clone(HOME), history: [], projects: {}, openProjects: [] };
  }
  const projects = {};
  const openProjects = [];
  for (const rawName of Array.isArray(stored.openProjects) ? stored.openProjects : []) {
    const name = validName(rawName);
    const source = stored.projects[name];
    if (!source || typeof source !== "object" || projects[name]) continue;
    projects[name] = { ...defaultProject(name), ...clone(source), name, lifecycle: "open", visibility: "background" };
    projects[name].viewer = { ...defaultProject(name).viewer, ...(source.viewer || {}) };
    openProjects.push(name);
  }
  return {
    version: VERSION,
    visible: clone(HOME),
    history: Array.isArray(stored.history) ? clone(stored.history).slice(-50) : [],
    projects,
    openProjects,
  };
}

export function createContextSessionManager(stored = null, { startAtHome = false, onChange = null } = {}) {
  const state = normalizeStored(stored);
  if (!startAtHome && stored?.visible?.kind && stored.visible.kind !== "home") state.visible = clone(stored.visible);

  function emit() {
    for (const project of Object.values(state.projects)) project.visibility = "background";
    if (state.visible.project && state.projects[state.visible.project]) state.projects[state.visible.project].visibility = "visible";
    onChange?.(api.snapshot());
  }

  function transition(next, { record = true } = {}) {
    if (sameContext(state.visible, next)) return;
    if (record) {
      state.history = state.history.filter(context => !sameContext(context, next));
      state.history.push(clone(state.visible));
      state.history = state.history.slice(-50);
    }
    state.visible = clone(next);
    emit();
  }

  function ensureOpen(name) {
    name = validName(name);
    if (!state.projects[name]) {
      state.projects[name] = defaultProject(name);
      state.openProjects.push(name);
    }
    return state.projects[name];
  }

  const api = {
    openProject(name) {
      const project = ensureOpen(name);
      transition({ kind: "project", project: project.name });
      return api.snapshot();
    },
    showHome() {
      transition(HOME);
      return api.snapshot();
    },
    openViewer(path, viewerState = {}) {
      const name = state.visible.project;
      if (!name || !state.projects[name]) throw new Error("Abra un proyecto antes de mostrar el visor 3D");
      if (typeof path !== "string" || !path.trim()) throw new Error("Ruta de modelo no válida");
      state.projects[name].viewer = { ...state.projects[name].viewer, ...clone(viewerState), path };
      transition({ kind: "viewer", project: name, path });
      return api.snapshot();
    },
    closeViewer() {
      if (state.visible.kind !== "viewer") return api.snapshot();
      transition({ kind: "project", project: state.visible.project }, { record: false });
      return api.snapshot();
    },
    back() {
      while (state.history.length) {
        const previous = state.history.pop();
        if (previous.kind === "home" || (previous.project && state.projects[previous.project])) {
          transition(previous, { record: false });
          return api.snapshot();
        }
      }
      transition(HOME, { record: false });
      return api.snapshot();
    },
    closeProject(name = state.visible.project, { discard = false } = {}) {
      name = validName(name);
      const project = state.projects[name];
      if (!project) return api.snapshot();
      if (project.dirty && !discard) throw new Error(`El proyecto ${name} tiene cambios sin guardar`);
      if (project.tasks.some(task => task?.status === "running")) throw new Error(`El proyecto ${name} tiene tareas en ejecución`);
      delete state.projects[name];
      state.openProjects = state.openProjects.filter(projectName => projectName !== name);
      state.history = state.history.filter(context => context.project !== name);
      if (state.visible.project === name) {
        const fallback = state.openProjects.at(-1);
        state.visible = fallback ? { kind: "project", project: fallback } : clone(HOME);
      }
      emit();
      return api.snapshot();
    },
    setProjectState(name, updates) {
      const project = ensureOpen(name);
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new Error("Estado de proyecto no válido");
      Object.assign(project, clone(updates), { name: project.name, lifecycle: "open" });
      if (updates.viewer) project.viewer = { ...project.viewer, ...clone(updates.viewer) };
      emit();
      return api.snapshot();
    },
    snapshot() { return clone(state); },
    serialize() { return clone(state); },
  };

  emit();
  return api;
}
