import { parse3DModel } from "./model-formats.mjs";
import { createModelViewer } from "./model-viewer.mjs";
import { createVisualStateController } from "./visual-state-controller.mjs";

const MODEL_EXTENSIONS = new Set(["stl", "3mf", "obj", "glb", "gltf"]);
const DOCUMENT_EXTENSIONS = new Set([
  "txt", "md", "json", "csv", "log", "xml", "yaml", "yml", "js", "ts", "tsx",
  "jsx", "css", "html", "py", "mjs", "cjs", "java", "c", "cpp", "h", "cs",
  "go", "rs", "sql", "toml", "ini", "sh", "bat", "ps1",
]);
function extension(path) {
  const name = path?.split(/[\\/]/u).pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MiB`;
}

function setHidden(element, hidden) {
  element.hidden = hidden;
}

export function initWorkspaceContext({
  runtime = typeof window !== "undefined" ? window.bitRuntime : null,
  modelRuntime = { parse3DModel, createModelViewer },
  documentRef = typeof document !== "undefined" ? document : null,
  windowRef = typeof window !== "undefined" ? window : null,
} = {}) {
  if (!runtime || !documentRef || !windowRef) return () => {};
  const $ = id => documentRef.getElementById(id);
  const createElement = name => documentRef.createElement(name);
  const OptionConstructor = windowRef.Option || globalThis.Option;
  const projectContext = $("project-context");
  const documentView = $("project-document");
  const modelView = $("project-model");
  if (!projectContext || !documentView || !modelView) return () => {};
  const visualState = createVisualStateController({ documentRef, windowRef });
  const fileContext = $("file-context");
  let contextualFile = null;

  function showFileContext(file, detailed = false, autoOpenModel = true) {
    if (!fileContext || !file) return;
    contextualFile = file;
    const name = file.name || file.path?.split(/[\\/]/u).pop() || "Archivo local";
    const extensionName = extension(name).toUpperCase() || "ARCHIVO";
    const size = formatSize(file.size);
    $("file-context-name")?.replaceChildren(documentRef.createTextNode(name));
    $("file-context-meta").textContent = `${extensionName} · ${size} · ${detailed ? "contexto de trabajo activo" : "archivo cargado, sin proyecto"}`;
    $("file-context-response").textContent = detailed ? "BIT está integrando la respuesta y el historial de este archivo." : "BIT está listo para resumirlo, analizarlo o convertirlo en contexto de trabajo.";
    const modelButton = $("file-context-actions")?.querySelector?.('[data-file-action="model3d"]');
    if (modelButton) modelButton.hidden = !MODEL_EXTENSIONS.has(extension(name));
    setHidden(fileContext, false);
    visualState.set("file-intake", {
      context: { file: { name, extension: extensionName.toLowerCase(), size: file.size ?? null } },
    });
    if (autoOpenModel && !detailed && MODEL_EXTENSIONS.has(extension(name))) void openDroppedModel(file);
  }

  function closeFileContext() {
    contextualFile = null;
    setHidden(fileContext, true);
    if (!documentRef.body.classList.contains("project-active")) visualState.set("idle");
  }

  let selectedProject = "";
  let selectedPath = "";
  let displayMode = "embedded";
  let snapshotGeneration = 0;
  let modelGeneration = 0;
  let modelViewer = null;
  let performanceProfile = { quality: "automatic", cpuUtilizationPercent: null, availableMemoryBytes: null };
  let performanceRefreshTimer = null;
  let performanceRefreshInProgress = false;
  let loadedModel = false;
  let standaloneModelActive = false;
  let closeTimer = 0;

  function setProjectStatus(message) {
    $("project-state-label").textContent = message;
  }

  function showModelProperties(summary) {
    if (!summary) {
      $("model-summary").textContent = "";
      return;
    }
    const dimensions = summary.bounds.size.map(value => Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 })).join(" × ");
    $("model-title").textContent = `HOLOGRAMA · ${summary.name.split(/[\\/]/u).pop()}`;
    const unit = summary.units === "millimeter" ? "mm" : summary.units || "unidades del modelo";
    const assembly = summary.componentStrategy === "single-mesh" ? "malla única · explosionado no disponible" : `${summary.componentCount} componentes separables`;
    $("model-summary").textContent = `${summary.format.toUpperCase()} · ${dimensions} ${unit} · ${summary.triangleCount.toLocaleString("es-AR")} triángulos · ${assembly}`;
  }

  function closeModel() {
    modelGeneration += 1;
    clearInterval(performanceRefreshTimer);
    performanceRefreshTimer = null;
    modelViewer?.close();
    modelViewer = null;
    loadedModel = false;
    setHidden(modelView, true);
    documentRef.body.classList.remove("model-active", "file-model-active");
    standaloneModelActive = false;
    if (documentRef.body.classList.contains("project-active")) visualState.set("project", { project: true, displayMode });
    else if (visualState.get() === "standalone-3d") visualState.set("idle");
    $("model-status").textContent = "Seleccione un modelo 3D compatible.";
    showModelProperties(null);
  }

  async function refreshViewerPerformance() {
    if (!modelViewer || typeof runtime.getPerformanceStatus !== "function" || performanceRefreshInProgress) return;
    performanceRefreshInProgress = true;
    try {
      const snapshot = await runtime.getPerformanceStatus();
      performanceProfile.cpuUtilizationPercent = snapshot.hardware?.cpu?.utilizationPercent ?? null;
      performanceProfile.availableMemoryBytes = snapshot.hardware?.memory?.availableBytes ?? null;
      modelViewer?.setQuality?.(performanceProfile.quality, performanceProfile);
    } catch (error) {
      console.warn("[rendimiento] No se pudo actualizar el perfil holográfico:", error.message);
    } finally {
      performanceRefreshInProgress = false;
    }
  }

  function closeDocument() {
    setHidden(documentView, true);
    documentRef.body.classList.remove("document-active");
    if (documentRef.body.classList.contains("project-active")) visualState.set("project", { project: true, displayMode });
  }

  function renderFileDetails(file, versions = []) {
    if (!file) {
      $("project-file-name").textContent = "Ninguno";
      $("project-file-type").textContent = "Tipo: —";
      $("project-file-size").textContent = "Tamaño: —";
      $("project-file-modified").textContent = "Modificado: —";
      $("project-versions").replaceChildren();
      return;
    }
    $("project-file-name").textContent = file.path;
    $("project-file-type").textContent = `Tipo: ${extension(file.path).toUpperCase() || "archivo"}`;
    $("project-file-size").textContent = `Tamaño: ${formatSize(file.size)}`;
    $("project-file-modified").textContent = file.modifiedAt
      ? `Modificado: ${new Date(file.modifiedAt).toLocaleString("es-AR")}`
      : "Modificado: —";
    const target = $("project-versions");
    target.replaceChildren();
    if (!versions.length) {
      const empty = createElement("p");
      empty.textContent = "Sin versiones guardadas.";
      target.append(empty);
      return;
    }
    for (const version of versions) {
      const item = createElement("p");
      item.textContent = `Versión ${version.backupId} · ${formatSize(version.size)}`;
      target.append(item);
    }
  }

  function renderActivity(data) {
    const activity = $("project-activity");
    activity.replaceChildren();
    const items = (data.activity || []).filter(item => !selectedProject || item.project === selectedProject);
    const completed = items.filter(item => item.status === "completed").length;
    const working = items.filter(item => item.status === "working").length;
    const failed = items.filter(item => item.status === "failed").length;
    $("project-progress").textContent = items.length
      ? `${items.length} operaciones registradas · ${completed} completadas · ${working} en curso · ${failed} fallidas.`
      : "No hay tareas ni operaciones registradas para este proyecto.";
    for (const item of items.slice(0, 12)) {
      const row = createElement("p");
      row.textContent = `${new Date(item.time).toLocaleString("es-AR")} · ${item.tool} · ${item.path || item.project} · ${item.status}`;
      activity.append(row);
    }
    if (!items.length) {
      const empty = createElement("p");
      empty.textContent = "No hay actividad registrada.";
      activity.append(empty);
    }
  }

  function renderFileList(data) {
    const target = $("project-files");
    target.replaceChildren();
    for (const path of data.files || []) {
      const button = createElement("button");
      button.type = "button";
      button.textContent = path;
      button.title = path;
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-current", String(path === selectedPath));
      button.style.paddingInlineStart = `${8 + Math.max(0, path.split("/").length - 1) * 10}px`;
      button.addEventListener("click", () => { void selectFile(path); });
      target.append(button);
    }
    if (!target.children.length) {
      const empty = createElement("p");
      empty.textContent = "El proyecto no contiene archivos disponibles.";
      target.append(empty);
    }
    $("project-file-count").textContent = String((data.files || []).length);
  }

  function renderProjects(data) {
    const select = $("project-select");
    const previous = selectedProject;
    select.replaceChildren(new OptionConstructor("Seguir proyecto activo", ""));
    for (const name of data.projects || []) select.append(new OptionConstructor(name, name));
    selectedProject = previous || data.activeProject || "";
    select.value = selectedProject;
    if (selectedProject && !select.value) selectedProject = "";
    $("project-name").textContent = selectedProject || "Sin proyecto";
  }

  async function refresh(path = "") {
    const requestId = ++snapshotGeneration;
    const request = {};
    if (selectedProject) request.project = selectedProject;
    if (path) {
      request.path = path;
      request.metadataOnly = true;
    }
    try {
      const data = await runtime.projectSnapshot(request);
      if (requestId !== snapshotGeneration) return null;
      renderProjects(data);
      renderFileList(data);
      renderFileDetails(data.file, data.versions || []);
      const files = data.files || [];
      const activity = (data.activity || []).filter(item => !selectedProject || item.project === selectedProject);
      const summary = selectedProject
        ? `${files.length} archivos locales · ${activity.length} operaciones de esta sesión.`
        : data.notice || "Seleccione un proyecto local para consultar sus archivos.";
      $("project-summary").textContent = summary;
      $("project-info-summary").textContent = summary;
      if (displayMode === "parallel") $("project-summary-banner").textContent = `Proyecto · ${selectedProject || "sin proyecto seleccionado"} · ${files.length} archivos`;
      const session = data.lastSession?.project === selectedProject ? data.lastSession : null;
      const sessionDetails = [
        session?.goal ? `Objetivo registrado: ${session.goal}` : "",
        session?.nextStep ? `Siguiente paso registrado: ${session.nextStep}` : "",
        session?.lastTask ? `Última tarea registrada: ${session.lastTask}` : "",
      ].filter(Boolean);
      $("project-goals").textContent = sessionDetails.length
        ? sessionDetails.join(" · ")
        : "No hay objetivos ni notas registrados en los datos locales disponibles.";
      renderActivity(data);
      if (data.notice) setProjectStatus(data.notice);
      else setProjectStatus(selectedProject ? "PROYECTO ACTIVO" : "SIN PROYECTO");
      return data;
    } catch (error) {
      if (requestId === snapshotGeneration) {
        setProjectStatus("ERROR DE LECTURA");
        $("project-info-summary").textContent = `No se pudo leer el proyecto: ${error.message}`;
      }
      return null;
    }
  }

  async function loadModel(path, generation, sourceOverride = null, standalone = false) {
    try {
      $("model-status").textContent = `Cargando y validando ${path}…`;
      setHidden(modelView, false);
      documentRef.body.classList.add("model-active");
      documentRef.body.classList.toggle("file-model-active", standalone);
      visualState.set(standalone ? "standalone-3d" : "project-3d", {
        project: !standalone,
        model: true,
        displayMode,
        context: { selectedPath: path, viewer: { active: true } },
      });
      const source = sourceOverride || await runtime.loadProjectModel({ project: selectedProject, path });
      if (generation !== modelGeneration) return false;
      if (!modelViewer) {
        modelViewer = modelRuntime.createModelViewer($("project-model-viewer"), $("project-model-viewer"));
        modelViewer.setQuality?.(performanceProfile.quality, performanceProfile);
        if (typeof runtime.getConfig === "function") {
          void runtime.getConfig("hologramQuality").then(result => {
            if (!result?.ok) throw new Error(result?.error || "No se pudo leer la calidad holográfica");
            performanceProfile.quality = result.value;
            modelViewer?.setQuality?.(performanceProfile.quality, performanceProfile);
          }).catch(error => console.warn("[rendimiento] No se pudo aplicar la calidad holográfica guardada:", error.message));
        }
      }
      if (typeof runtime.getPerformanceStatus === "function" && !performanceRefreshTimer) {
        void refreshViewerPerformance();
        performanceRefreshTimer = setInterval(() => void refreshViewerPerformance(), 5000);
      }
      const model = await modelRuntime.parse3DModel({ name: path, data: source.data, assets: source.assets });
      if (generation !== modelGeneration) return false;
      modelViewer.load(model);
      loadedModel = true;
      showModelProperties(modelViewer.getSummary());
      setProjectStatus(standalone ? "MODELO 3D EN CONTEXTO" : "MODELO 3D ACTIVO");
      return true;
    } catch (error) {
      if (generation !== modelGeneration) return false;
      modelViewer?.close();
      modelViewer = null;
      loadedModel = false;
      setHidden(modelView, true);
      documentRef.body.classList.remove("model-active", "file-model-active");
      $("model-status").textContent = `No se pudo cargar el modelo: ${error.message}`;
      setProjectStatus("ERROR DE MODELO");
      return false;
    }
  }

  async function selectFile(path) {
    selectedPath = path;
    closeModel();
    closeDocument();
    const data = await refresh(path);
    if (!data || !selectedProject) return;
    const file = data.file;
    if (MODEL_EXTENSIONS.has(extension(path))) {
      const modelRequest = ++modelGeneration;
      await loadModel(path, modelRequest);
    } else if (DOCUMENT_EXTENSIONS.has(extension(path))) {
      try {
        const textFile = await runtime.readProjectFile({ project: selectedProject, path });
        $("document-title").textContent = `DOCUMENTO · ${path}`;
        $("document-content").textContent = textFile.content;
        setHidden(documentView, false);
        documentRef.body.classList.add("document-active");
        visualState.set(["js", "ts", "tsx", "jsx", "css", "html", "py", "mjs", "cjs", "java", "c", "cpp", "h", "cs", "go", "rs", "sql", "toml", "ini", "sh", "bat", "ps1"].includes(extension(path)) ? "code" : "document", { project: true, document: true, displayMode, context: { selectedPath: path } });
        setProjectStatus("DOCUMENTO ABIERTO");
      } catch (error) {
        setProjectStatus("ERROR DE LECTURA");
        $("project-info-summary").textContent = `No se pudo abrir ${path}: ${error.message}`;
      }
    } else if (file) {
      setProjectStatus(`ARCHIVO ${extension(path).toUpperCase() || "LOCAL"} SELECCIONADO`);
    }
  }

  async function openDroppedModel(file) {
    if (!file?.filePath || !MODEL_EXTENSIONS.has(extension(file.name || file.filePath))) return false;
    closeModel();
    closeDocument();
    contextualFile = file;
    standaloneModelActive = true;
    setHidden(fileContext, true);
    const generation = ++modelGeneration;
    try {
      const source = await runtime.loadDroppedModel({ filePath: file.filePath });
      return await loadModel(file.name || file.filePath, generation, source, true);
    } catch (error) {
      standaloneModelActive = false;
      showFileContext(file, true, false);
      $("file-context-response").textContent = `No se pudo abrir el modelo: ${error.message}`;
      return false;
    }
  }

  async function executeViewerCommand(request) {
    const { action } = request;
    if (action === "load") {
      const project = request.project || selectedProject;
      const path = request.path || selectedPath;
      if (!project || !path || !MODEL_EXTENSIONS.has(extension(path))) {
        throw new Error("Seleccione un proyecto y un archivo STL, 3MF, OBJ, GLB o glTF.");
      }
      selectedProject = project;
      await refresh();
      await selectFile(path);
      if (!loadedModel) throw new Error($("model-status").textContent);
      return { ok: true, action, project, path };
    }
    if (!modelViewer || !loadedModel) throw new Error("Primero cargue un modelo 3D desde el explorador del proyecto.");
    switch (action) {
      case "view": modelViewer.setView(request.view); break;
      case "rotate": modelViewer.rotateBy(request.degrees, request.axis || "y"); break;
      case "select": modelViewer.selectComponentByName(request.component); break;
      case "hide":
        if (request.component) modelViewer.setComponentVisibleByName(request.component, false);
        else modelViewer.setSelectedComponentVisible(false);
        break;
      case "show":
        if (request.component) modelViewer.setComponentVisibleByName(request.component, true);
        else modelViewer.setSelectedComponentVisible(true);
        break;
      case "explode": modelViewer.setExploded(request.amount ?? 100); break;
      case "assemble": modelViewer.setExploded(0); break;
      case "reset": modelViewer.reset(); break;
      case "mode": modelViewer.setMode(request.mode); break;
      default: throw new Error(`Acción de visor 3D no compatible: ${action}`);
    }
    return { ok: true, action };
  }

  function enterWorkspace(transition = {}) {
    clearTimeout(closeTimer);
    windowRef.BitUI?.clearCards?.();
    windowRef.BitUI?.clearProjectResponse?.();
    documentRef.body.classList.remove("project-leaving");
    displayMode = transition.displayMode || "embedded";
    documentRef.body.classList.add("project-active");
    visualState.set("project", { project: true, displayMode });
    documentRef.body.classList.toggle("parallel-project", displayMode === "parallel");
    setHidden(projectContext, displayMode === "parallel");
    setHidden($("project-summary-banner"), displayMode !== "parallel");
    $("workspace-toggle")?.setAttribute("aria-label", "Volver al inicio");
    const orbArea = documentRef.querySelector?.(".orb-area");
    orbArea?.setAttribute("role", "button");
    orbArea?.setAttribute("tabindex", "0");
    orbArea?.setAttribute("aria-label", "Volver al inicio de Bit");
    if (displayMode === "parallel") {
      $("project-summary-banner").textContent = `Proyecto · ${selectedProject || "sin proyecto seleccionado"}`;
    }
    void refresh(selectedPath);
    documentRef.body.classList.add("project-entering");
    closeTimer = setTimeout(() => documentRef.body.classList.remove("project-entering"), 700);
  }

  function leaveWorkspace() {
    clearTimeout(closeTimer);
    windowRef.BitUI?.clearCards?.();
    windowRef.BitUI?.clearProjectResponse?.();
    documentRef.body.classList.remove("project-entering");
    documentRef.body.classList.add("project-leaving");
    closeModel();
    closeDocument();
    closeTimer = setTimeout(() => {
      documentRef.body.classList.remove("project-active", "parallel-project", "project-leaving");
      visualState.set("idle");
      setHidden(projectContext, true);
      setHidden($("project-summary-banner"), true);
      const orbArea = documentRef.querySelector?.(".orb-area");
      orbArea?.removeAttribute("role");
      orbArea?.removeAttribute("tabindex");
      orbArea?.setAttribute("aria-label", "Núcleo visual de Bit");
      selectedPath = "";
      selectedProject = "";
      renderFileDetails(null);
    }, windowRef.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : 640);
  }

  const cleanups = [
    runtime.onFileDropRequested?.(file => { showFileContext(file); }),
    runtime.onWorkspaceTransition(({ phase, ...transition }) => {
      if (phase === "enter") enterWorkspace(transition);
      else if (phase === "exit" || phase === "return") leaveWorkspace();
      else if (phase === "refresh") void refresh(selectedPath);
    }),
    runtime.onProjectActivity(() => { if (documentRef.body.classList.contains("project-active")) void refresh(selectedPath); }),
    runtime.onProjectSelection(project => {
      if (project === selectedProject) return;
      selectedProject = project;
      selectedPath = "";
      closeModel();
      closeDocument();
      if (documentRef.body.classList.contains("project-active")) void refresh();
    }),
    runtime.onProjectFileOpen(request => {
      if (displayMode === "parallel" || !request?.project || !request?.path) return;
      selectedProject = request.project;
      selectedPath = request.path;
      closeModel();
      closeDocument();
      void selectFile(request.path);
    }),
    runtime.onDisplayChange(displays => {
      if (!documentRef.body.classList.contains("project-active")) return;
      const nextMode = displays.some(display => display.role === "project") ? "parallel" : "embedded";
      if (nextMode !== displayMode) enterWorkspace({ displayMode: nextMode });
    }),
    runtime.onViewerCommand(async ({ id, command }) => {
      try {
        const result = await executeViewerCommand(command);
        runtime.sendViewerCommandResult({ id, result });
      } catch (error) {
        runtime.sendViewerCommandResult({ id, error: error.message });
      }
    }),
  ];

  windowRef.BitUI ||= {};
  windowRef.BitUI.setFileContext = showFileContext;
  windowRef.BitUI.closeFileContext = closeFileContext;
  windowRef.BitUI.openDroppedModel = openDroppedModel;
  $("file-context-close")?.addEventListener("click", closeFileContext);
  $("file-context-actions")?.addEventListener("click", async event => {
    const button = event.target.closest?.("button[data-file-action]");
    if (!button || !contextualFile) return;
    const action = button.dataset.fileAction;
    if (action === "model3d") {
      button.disabled = true;
      try { await openDroppedModel(contextualFile); } finally { button.disabled = false; }
      return;
    }
    const actionMap = { summarize: "summarize", analyze: "vision", classify: "summarize", open: "attach", project: "attach" };
    const runtimeAction = actionMap[action];
    if (!runtimeAction || typeof runtime.processDroppedFile !== "function") return;
    button.disabled = true;
    try {
      const result = await runtime.processDroppedFile({ filePath: contextualFile.filePath, action: runtimeAction });
      showFileContext(contextualFile, true);
      $("file-context-response").textContent = result?.text || "Archivo procesado.";
    } catch (error) {
      $("file-context-response").textContent = `No se pudo procesar el archivo: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  const onPerformanceProfile = event => {
    const detail = event.detail;
    if (!detail || !["automatic", "low", "medium", "high"].includes(detail.quality)) return;
    performanceProfile = {
      quality: detail.quality,
      cpuUtilizationPercent: Number.isFinite(detail.cpuUtilizationPercent) ? detail.cpuUtilizationPercent : null,
      availableMemoryBytes: Number.isFinite(detail.availableMemoryBytes) ? detail.availableMemoryBytes : null,
    };
    modelViewer?.setQuality?.(performanceProfile.quality, performanceProfile);
  };
  windowRef.addEventListener("bit:performance-profile", onPerformanceProfile);
  if (typeof windowRef.removeEventListener === "function") {
    cleanups.push(() => windowRef.removeEventListener("bit:performance-profile", onPerformanceProfile));
  }

  $("project-select").addEventListener("change", () => {
    const previousProject = selectedProject;
    selectedProject = $("project-select").value;
    selectedPath = "";
    closeModel();
    closeDocument();
    void runtime.setActiveProject(selectedProject).then(() => refresh()).catch(error => {
      selectedProject = previousProject;
      $("project-select").value = previousProject;
      setProjectStatus(`ERROR: ${error.message}`);
      void refresh();
    });
  });
  $("project-close").addEventListener("click", async () => {
    try {
      const result = await runtime.showHome();
      if (!result?.ok) throw new Error(result?.error || "No se pudo cerrar el proyecto");
    } catch (error) {
      setProjectStatus(`ERROR: ${error.message}`);
    }
  });
  $("document-close").addEventListener("click", closeDocument);
  $("model-close").addEventListener("click", closeModel);
  $("project-model-viewer").addEventListener("bit-model-summary", event => showModelProperties(event.detail));
  const returnHome = () => {
    if (!documentRef.body.classList.contains("project-active")) return;
    void runtime.showHome().catch(error => setProjectStatus(`ERROR: ${error.message}`));
  };
  $("workspace-toggle")?.addEventListener("click", returnHome);
  const orbArea = documentRef.querySelector?.(".orb-area");
  orbArea?.addEventListener("click", returnHome);
  orbArea?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      returnHome();
    }
  });
  windowRef.addEventListener("beforeunload", () => {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
    closeModel();
    visualState.dispose();
  }, { once: true });

  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
    closeModel();
  };
}

if (typeof window !== "undefined" && window.bitRuntime) initWorkspaceContext();
