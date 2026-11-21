import { parse3DModel } from "./model-formats.mjs";
import { createModelViewer } from "./model-viewer.mjs";
import { createVisualStateController } from "./visual-state-controller.mjs";
import { createPdfViewer } from "./pdf-viewer.mjs";

const MODEL_EXTENSIONS = new Set(["stl", "3mf", "obj", "glb", "gltf"]);
const OPEN_EXTENSIONS = new Set(["md", "txt", "csv", "json", "pdf", "rtf", "doc", "docx", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp3", "wav", "m4a", "ogg", "flac", "mp4", "mkv", "mov"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const WORD_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf"]);
const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "odp"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "ods", "csv"]);
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

function fileKind(fileExtension) {
  if (MODEL_EXTENSIONS.has(fileExtension)) return "model3d";
  if (IMAGE_EXTENSIONS.has(fileExtension)) return "image";
  if (fileExtension === "pdf") return "pdf";
  if (WORD_EXTENSIONS.has(fileExtension)) return "word";
  if (PRESENTATION_EXTENSIONS.has(fileExtension)) return "powerpoint";
  if (SPREADSHEET_EXTENSIONS.has(fileExtension)) return "spreadsheet";
  if (DOCUMENT_EXTENSIONS.has(fileExtension)) return "text";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(fileExtension)) return "audio";
  if (["mp4", "mkv", "mov"].includes(fileExtension)) return "video";
  return "binary";
}

function fileKindLabel(kind) {
  return {
    pdf: "DOCUMENTO PDF",
    image: "IMAGEN",
    word: "DOCUMENTO WORD",
    powerpoint: "PRESENTACIÓN",
    spreadsheet: "HOJA DE CÁLCULO",
    text: "TEXTO LOCAL",
    audio: "AUDIO",
    video: "VIDEO",
    model3d: "MODELO 3D",
    binary: "ARCHIVO LOCAL",
  }[kind] || "ARCHIVO LOCAL";
}

function fileKindIcon(kind) {
  return { pdf: "PDF", image: "IMG", word: "DOC", powerpoint: "PPT", spreadsheet: "XLS", text: "TXT", audio: "AUD", video: "VID", model3d: "3D" }[kind] || "◇";
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
  const pdfViewer = createPdfViewer({ stage: $("file-context-pdf-canvas"), pages: $("file-context-pages"), frame: $("file-context-pdf-frame"), status: $("file-context-page-status"), documentRef });
  $("file-context-prev")?.addEventListener("click", pdfViewer.previous);
  $("file-context-next")?.addEventListener("click", pdfViewer.next);
  $("file-context-zoom-in")?.addEventListener("click", pdfViewer.zoomIn);
  $("file-context-zoom-out")?.addEventListener("click", pdfViewer.zoomOut);
  $("file-context-fit")?.addEventListener("click", pdfViewer.fitPage);
  const fileCoreArea = documentRef.querySelector?.(".orb-area");
  const fileCoreSlot = $("file-context-core-slot");
  const fileCoreParent = fileCoreArea?.parentNode || null;
  const fileCoreNextSibling = fileCoreArea?.nextSibling || null;
  let contextualFile = null;

  function mountFileContextCore() {
    if (fileCoreArea && fileCoreSlot && fileCoreArea.parentNode !== fileCoreSlot) fileCoreSlot.append(fileCoreArea);
  }

  function restoreFileContextCore() {
    if (!fileCoreArea || !fileCoreParent || fileCoreArea.parentNode === fileCoreParent) return;
    if (fileCoreNextSibling?.parentNode === fileCoreParent) fileCoreParent.insertBefore(fileCoreArea, fileCoreNextSibling);
    else fileCoreParent.append(fileCoreArea);
  }

  function renderSpreadsheetPreview(content) {
    const target = $("file-context-grid");
    if (!target || typeof content !== "string" || !content.trim()) return false;
    target.replaceChildren();
    const lines = content.split(/\r?\n/u);
    let table = null;
    let body = null;
    let sheetName = "HOJA LOCAL";
    const finishTable = () => {
      if (!table || !body) return;
      const caption = createElement("caption");
      caption.textContent = sheetName;
      table.append(caption);
      target.append(table);
      table = null;
      body = null;
    };
    for (const line of lines) {
      if (line.startsWith("## ")) {
        finishTable();
        sheetName = line.slice(3).trim() || "HOJA LOCAL";
        continue;
      }
      if (!line.trim()) continue;
      if (!table) {
        table = createElement("table");
        body = createElement("tbody");
        table.append(body);
      }
      const row = createElement("tr");
      for (const value of line.split("\t")) {
        const cell = createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    finishTable();
    return target.children.length > 0;
  }

  function renderFilePages(kind, pageCount = null) {
    const pages = $("file-context-pages");
    if (!pages) return;
    pages.replaceChildren();
    if (kind !== "pdf") {
      pages.hidden = true;
      return;
    }
    pages.hidden = false;
    const heading = createElement("div");
    heading.className = "file-context-pages-heading";
    heading.textContent = "PÁGINAS";
    pages.append(heading);
    const total = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1;
    const visiblePages = Math.min(total, 6);
    for (let index = 1; index <= visiblePages; index += 1) {
      const item = createElement("div");
      item.className = `file-context-page-item${index === 1 ? " is-active" : ""}`;
      const thumb = createElement("div");
      thumb.className = "file-context-page-thumb";
      thumb.textContent = String(index).padStart(2, "0");
      const label = createElement("span");
      label.textContent = index === 1 ? `Página ${index} · Vista actual` : `Página ${index}`;
      item.append(thumb, label);
      pages.append(item);
    }
    if (total > visiblePages) {
      const more = createElement("div");
      more.className = "file-context-page-more";
      more.textContent = `+ ${total - visiblePages} páginas`;
      pages.append(more);
    }
  }

  function hasActiveWorkspace() {
    const banner = $('project-summary-banner');
    return Boolean(selectedProject && (!projectContext.hidden || (banner && !banner.hidden)));
  }

  function showFileContext(file, detailed = false, autoOpenModel = true) {
    if (!fileContext || !file) return;
    contextualFile = file;
    const name = file.name || file.path?.split(/[\\/]/u).pop() || "Archivo local";
    const extensionName = extension(name).toUpperCase() || "ARCHIVO";
    const fileExtension = extension(name);
    const kind = fileKind(fileExtension);
    const localPath = file.path || file.filePath;
    const normalizedFile = localPath && file.filePath === localPath ? file : { ...file, filePath: localPath };
    const size = formatSize(file.size);
    fileContext.setAttribute("data-file-kind", kind);
    $("file-context-icon")?.replaceChildren(documentRef.createTextNode(fileKindIcon(kind)));
    $("file-context-kind-label")?.replaceChildren(documentRef.createTextNode(fileKindLabel(kind)));
    $("file-context-viewer-title")?.replaceChildren(documentRef.createTextNode(kind === "pdf" ? "VISOR PDF" : `${fileKindLabel(kind)} · VISTA PREVIA`));
    $("file-context-page-status")?.replaceChildren(documentRef.createTextNode(kind === "pdf" ? "1 / PDF" : extensionName));
    $("file-context-question")?.replaceChildren(documentRef.createTextNode(kind === "image" ? "Imagen cargada." : kind === "spreadsheet" ? "Hoja de cálculo cargada." : kind === "powerpoint" ? "Presentación cargada." : kind === "word" ? "Documento cargado." : "Archivo cargado."));
    const prompt = $("file-context-prompt");
    if (prompt) prompt.placeholder = kind === "image" ? "Preguntame algo sobre esta imagen…" : "Preguntame algo sobre este archivo…";
    $("file-context-name")?.replaceChildren(documentRef.createTextNode(name));
    const projectActive = hasActiveWorkspace();
    visualState.set("file-intake", {
      project: projectActive,
      displayMode,
      context: { file: { name, extension: extensionName.toLowerCase(), size: file.size ?? null } },
    });
    $("file-context-meta").textContent = `${extensionName} · ${size} · ${projectActive ? "proyecto activo" : detailed ? "contexto de trabajo activo" : "archivo cargado, sin proyecto"}`;
    $("file-context-response").textContent = detailed
      ? "BIT está integrando la respuesta y el historial de este archivo."
      : kind === "pdf"
        ? "PDF disponible para lectura, navegación y resumen local."
        : kind === "spreadsheet"
          ? "Hoja disponible para consultar filas, columnas y datos."
          : kind === "powerpoint"
            ? "Presentación disponible para revisar sus diapositivas y temas."
            : kind === "word"
              ? "Documento disponible para leer y resumir."
              : kind === "image"
                ? "Imagen disponible para análisis visual local."
                : MODEL_EXTENSIONS.has(fileExtension)
                  ? "Cargando el modelo 3D local."
                  : "Seleccione una acción disponible para este archivo.";
    fileContext.classList.remove("file-context-preview-ready");
    fileContext.classList.add("file-context-preview-loading");
    renderFilePages(kind);
    pdfViewer.clear();
    const previewNodes = [$("file-context-preview"), $("file-context-pdf-frame"), $("file-context-audio"), $("file-context-video"), $("file-context-text"), $("file-context-grid")].filter(Boolean);
    for (const node of previewNodes) {
      node.hidden = true;
      node.removeAttribute?.("src");
      if (node.tagName === "PRE") node.textContent = "";
      if (node.id === "file-context-grid") node.replaceChildren();
    }
    if (typeof runtime.previewDroppedFile === "function" && localPath) {
      void runtime.previewDroppedFile(localPath).then(async result => {
        if (contextualFile !== file || !result) return;
        if (result.kind === "text" || result.kind === "document") {
          const grid = kind === "spreadsheet" ? $("file-context-grid") : null;
          const renderedGrid = grid && renderSpreadsheetPreview(result.content);
          const text = $("file-context-text");
          if (renderedGrid) grid.hidden = false;
          else if (text && result.content) { text.textContent = result.content; text.hidden = false; }
          else if (text && ["word", "powerpoint", "spreadsheet"].includes(kind)) {
            text.textContent = result.notice || `No hay texto extraído para mostrar este archivo ${fileKindLabel(kind).toLowerCase()}.`;
            text.hidden = false;
          }
        } else if (result.kind === "image") {
          const image = $("file-context-preview");
          if (image && result.dataUrl) { image.src = result.dataUrl; image.hidden = false; }
        } else if (result.kind === "pdf") {
          const pdfFrame = $("file-context-pdf-frame");
          const text = $("file-context-text");
          if (Number.isInteger(result.pageCount) && result.pageCount > 0) {
            $("file-context-page-status")?.replaceChildren(documentRef.createTextNode(`1 / ${result.pageCount}`));
            renderFilePages(kind, result.pageCount);
          }
          if (pdfFrame && (result.data || result.dataUrl)) {
            pdfFrame.hidden = false;
            if (text) text.hidden = true;
            await pdfViewer.load(result.data || result.dataUrl);
          } else if (text && typeof result.content === "string" && result.content.trim()) {
            text.textContent = result.content;
            text.hidden = false;
          }
        } else if (result.kind === "audio") {
          const audio = $("file-context-audio");
          if (audio && result.dataUrl) { audio.src = result.dataUrl; audio.hidden = false; }
        } else if (result.kind === "video") {
          const video = $("file-context-video");
          if (video && result.dataUrl) { video.src = result.dataUrl; video.hidden = false; }
        }
        if (result.kind !== "model3d") {
          fileContext.classList.remove("file-context-preview-loading", "file-context-preview-ready");
          void fileContext.offsetWidth;
          fileContext.classList.add("file-context-preview-ready");
          $("file-context-response").textContent = result.notice || "Vista previa local disponible.";
        }
      }).catch(error => {
        if (contextualFile === file) $("file-context-response").textContent = `No se pudo mostrar la vista previa: ${error.message}`;
      });
    }
    for (const button of $("file-context-actions")?.querySelectorAll?.("button[data-file-action]") || []) {
      const action = button.dataset.fileAction;
      button.hidden = action === "model3d" ? !MODEL_EXTENSIONS.has(fileExtension)
        : action === "summarize" ? !["pdf", "word", "powerpoint", "spreadsheet", "text"].includes(kind)
        : action === "analyze" ? !IMAGE_EXTENSIONS.has(fileExtension)
        : action === "open" ? !OPEN_EXTENSIONS.has(fileExtension)
        : false;
    }
    fileContext.classList.remove("file-context-opening");
    mountFileContextCore();
    setHidden(fileContext, false);
    void fileContext.offsetWidth;
    fileContext.classList.add("file-context-opening");
    if (autoOpenModel && !detailed && MODEL_EXTENSIONS.has(fileExtension)) {
      $("file-context-response").textContent = "Abriendo el modelo 3D en el visor central…";
      void openDroppedModel(normalizedFile);
    }
  }

  function closeFileContext() {
    contextualFile = null;
    pdfViewer.clear();
    fileContext.classList.remove("file-context-opening");
    fileContext.classList.remove("file-context-preview-loading", "file-context-preview-ready");
    fileContext.removeAttribute?.("data-file-kind");
    setHidden(fileContext, true);
    restoreFileContextCore();
    const projectActive = hasActiveWorkspace();
    visualState.set(projectActive ? "project" : "idle", {
      project: projectActive,
      displayMode,
    });
  }

  function setFileContextResponse(message) {
    const target = $("file-context-response");
    if (!target || contextualFile === null) return;
    target.textContent = String(message || "");
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
  let standaloneModelFiles = [];
  let closeTimer = 0;
  let transitionReceived = false;

  function setProjectStatus(message) {
    $("project-state-label").textContent = message;
  }

  function showModelProperties(summary) {
    const facts = $("project-model-facts");
    const factsContent = $("project-model-facts-content");
    const standaloneFacts = $("standalone-model-facts");
    const standaloneDescription = $("standalone-model-description");
    if (!summary) {
      $("model-summary").textContent = "";
      if (facts) facts.hidden = true;
      factsContent?.replaceChildren();
      standaloneFacts?.replaceChildren();
      if (standaloneDescription) standaloneDescription.textContent = "Cargue un modelo para consultar sus propiedades.";
      return;
    }
    const dimensions = summary.bounds.size.map(value => Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 })).join(" × ");
    const name = summary.name.split(/[\\/]/u).pop();
    $("model-title").textContent = name;
    const unit = summary.units === "millimeter" ? "mm (declarados)" : summary.units && summary.units !== "model units" ? summary.units : "unidad no declarada";
    const assembly = summary.componentStrategy === "single-mesh" ? "malla única · explosionado no disponible" : `${summary.componentCount} componentes separables`;
    const rows = [
      ["Archivo", name],
      ["Formato", summary.format.toUpperCase()],
      ["Dimensiones", dimensions],
      ["Unidades", unit],
      ["Componentes", String(summary.componentCount)],
      ["Triángulos", summary.triangleCount.toLocaleString("es-AR")],
      ["Ensamblaje", assembly],
    ];
    if (summary.selectedComponent) rows.push(["Selección", summary.selectedComponent]);
    $("model-summary").textContent = `${summary.format.toUpperCase()} · ${dimensions} ${unit} · ${summary.triangleCount.toLocaleString("es-AR")} triángulos · ${assembly}`;
    if (standaloneDescription) standaloneDescription.textContent = `${name} · ${summary.format.toUpperCase()} · ${assembly}.`;
    if (facts && factsContent) {
      factsContent.replaceChildren();
      for (const [label, value] of rows) {
        const row = createElement("div");
        row.className = "model-fact-row";
        const key = createElement("span");
        key.textContent = label;
        const data = createElement("strong");
        data.textContent = value;
        row.append(key, data);
        factsContent.append(row);
      }
      facts.hidden = false;
    }
    if (standaloneFacts) {
      standaloneFacts.replaceChildren();
      const material = summary.material || summary.materialName || "No declarado";
      for (const [label, value] of [...rows, ["Material", material]]) {
        const row = createElement("div");
        row.className = "standalone-fact";
        const key = createElement("span"); key.textContent = label;
        const data = createElement("strong"); data.textContent = value;
        row.append(key, data); standaloneFacts.append(row);
      }
    }
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
    standaloneModelFiles = [];
    const chat = $("chat");
    chat?.style.removeProperty("display");
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

  function mergeModels(models) {
    // Los exportadores suelen guardar cada STL/OBJ con un origen local
    // distinto. Para que varios archivos representen un mismo ensamblaje, el
    // primer modelo define el origen visual y los demás se superponen sobre
    // ese centro antes de aplicar la explosión del visor.
    const anchor = models[0]?.model?.bounds?.center || [0, 0, 0];
    const components = models.flatMap(({ file, model }) => {
      const sourceCenter = model.bounds?.center || [0, 0, 0];
      const offset = anchor.map((value, axis) => value - sourceCenter[axis]);
      return model.components.map((component, index) => {
        const positions = new Float32Array(component.positions.length);
        for (let position = 0; position < component.positions.length; position += 3) {
          positions[position] = component.positions[position] + offset[0];
          positions[position + 1] = component.positions[position + 1] + offset[1];
          positions[position + 2] = component.positions[position + 2] + offset[2];
        }
        return {
          ...component,
          positions,
          id: `${file.name}:${component.id || index}`,
          name: `${file.name} · ${component.name || `Pieza ${index + 1}`}`,
        };
      });
    });
    if (!components.length) throw new Error("Los archivos no contienen piezas 3D compatibles");
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const component of components) for (let index = 0; index < component.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], component.positions[index + axis]);
        max[axis] = Math.max(max[axis], component.positions[index + axis]);
      }
    }
    const center = min.map((value, axis) => (value + max[axis]) / 2);
    const size = max.map((value, axis) => value - min[axis]);
    return {
      name: `${models.length} piezas · ensamblaje local`,
      format: "assembly",
      components,
      bounds: { min, max, center, size, radius: Math.max(1, Math.hypot(...size) / 2) },
      componentStrategy: "multi-file-assembly",
    };
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
    target.classList.toggle("is-empty", !(data.files || []).length);
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
      empty.textContent = "Este proyecto aún no contiene archivos. Arrastre archivos a Bit para elegir qué hacer con ellos.";
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

  async function loadModel(path, generation, sourceOverride = null, standalone = false, parsedOverride = null) {
    try {
      const chat = $("chat");
      if (standalone) chat?.style.setProperty("display", "none", "important");
      $("model-status").textContent = `Cargando y validando ${path}…`;
      setHidden(modelView, false);
      documentRef.body.classList.add("model-active");
      documentRef.body.classList.toggle("file-model-active", standalone);
      if (!visualState.canTransition("project-3d")) {
        visualState.set("project", { project: true, displayMode, context: { selectedPath: path } });
      }
      visualState.set("project-3d", {
        project: true,
        model: true,
        displayMode,
        context: { selectedPath: path, viewer: { active: true } },
      });
      const source = parsedOverride ? null : sourceOverride || await runtime.loadProjectModel({ project: selectedProject, path });
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
      const model = parsedOverride || await modelRuntime.parse3DModel({ name: path, data: source.data, assets: source.assets });
      if (generation !== modelGeneration) return false;
      modelViewer.load(model);
      loadedModel = true;
      showModelProperties(modelViewer.getSummary());
      setProjectStatus(standalone ? "MODELO 3D LOCAL ACTIVO" : "MODELO 3D ACTIVO");
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
    const filePath = file?.filePath || file?.path;
    if (!filePath || !MODEL_EXTENSIONS.has(extension(file.name || filePath))) return false;
    const normalizedFile = file.filePath === filePath ? file : { ...file, filePath };
    if (standaloneModelActive && loadedModel && standaloneModelFiles.length) {
      const files = [...standaloneModelFiles, normalizedFile]
        .filter((candidate, index, all) => all.findIndex(item => item.filePath === candidate.filePath) === index);
      return openDroppedModels(files);
    }
    closeModel();
    closeDocument();
    contextualFile = normalizedFile;
    standaloneModelActive = true;
    setHidden(fileContext, true);
    const generation = ++modelGeneration;
    try {
      const source = await runtime.loadDroppedModel({ filePath });
      const loaded = await loadModel(normalizedFile.name || filePath, generation, source, true);
      if (loaded) standaloneModelFiles = [normalizedFile];
      if (!loaded && generation === modelGeneration) {
        const message = $("model-status").textContent;
        standaloneModelActive = false;
        showFileContext(normalizedFile, true, false);
        $("file-context-response").textContent = message;
      }
      return loaded;
    } catch (error) {
      standaloneModelActive = false;
      showFileContext(normalizedFile, true, false);
      $("file-context-response").textContent = `No se pudo abrir el modelo: ${error.message}`;
      return false;
    }
  }

  async function openDroppedModels(files) {
    const models = (files || []).map(file => {
      const filePath = file?.filePath || file?.path;
      return filePath ? (file.filePath === filePath ? file : { ...file, filePath }) : null;
    }).filter(file => file && MODEL_EXTENSIONS.has(extension(file.name || file.filePath)));
    if (!models.length) return false;
    if (models.length === 1) return openDroppedModel(models[0]);
    closeModel();
    closeDocument();
    contextualFile = models[0];
    standaloneModelActive = true;
    setHidden(fileContext, true);
    const generation = ++modelGeneration;
    try {
      const parsed = [];
      for (const file of models) {
        const source = await runtime.loadDroppedModel({ filePath: file.filePath });
        const model = await modelRuntime.parse3DModel({ name: file.name || file.filePath, data: source.data, assets: source.assets });
        parsed.push({ file, model });
      }
      const merged = mergeModels(parsed);
      const loaded = await loadModel(merged.name, generation, null, true, merged);
      if (loaded) standaloneModelFiles = models;
      return loaded;
    } catch (error) {
      standaloneModelActive = false;
      showFileContext(models[0], true, false);
      $("file-context-response").textContent = `No se pudo crear el ensamblaje: ${error.message}`;
      return false;
    }
  }

  async function executeViewerCommand(request) {
    const { action } = request;
    if (action === "load-dropped") {
      const filePath = request.filePath;
      if (typeof filePath !== "string" || !MODEL_EXTENSIONS.has(extension(filePath))) {
        throw new Error("Suelte un archivo STL, 3MF, OBJ, GLB o glTF.");
      }
      const file = { filePath, name: filePath.split(/[\\/]/u).pop() };
      if (!await openDroppedModel(file)) throw new Error($('file-context-response').textContent || 'No se pudo abrir el modelo 3D.');
      return { ok: true, action, path: filePath };
    }
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
    runtime.onWorkspaceTransition(({ phase, ...transition }) => {
      transitionReceived = true;
      if (phase === "enter") enterWorkspace(transition);
      else if (phase === "exit" || phase === "return") leaveWorkspace();
      else if (phase === "close-viewer") closeModel();
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
  windowRef.BitUI.setFileContextResponse = setFileContextResponse;
  windowRef.BitUI.openDroppedModel = openDroppedModel;
  windowRef.BitUI.openDroppedModels = openDroppedModels;
  $("file-context-close")?.addEventListener("click", closeFileContext);
  $("file-context-actions")?.addEventListener("click", async event => {
    const button = event.target.closest?.("button[data-file-action],button[data-file-prompt]");
    if (!button || !contextualFile) return;
    if (button.dataset.filePrompt) {
      if (fileContextPrompt) fileContextPrompt.value = button.dataset.filePrompt;
      void sendFileContextQuestion();
      return;
    }
    const action = button.dataset.fileAction;
    if (action === "model3d") {
      button.disabled = true;
      try { await openDroppedModel(contextualFile); } finally { button.disabled = false; }
      return;
    }
    const file = contextualFile;
    if (action === "open") {
      button.disabled = true;
      try {
        const result = await runtime.openFile(file.filePath);
        if (!result?.ok) throw new Error(result?.error || "No se pudo abrir el archivo");
        $("file-context-response").textContent = `Archivo abierto: ${file.name}`;
      } catch (error) {
        $("file-context-response").textContent = `No se pudo abrir el archivo: ${error.message}`;
      } finally { button.disabled = false; }
      return;
    }
    const actionMap = { summarize: "summarize", analyze: "vision" };
    const runtimeAction = actionMap[action];
    if (!runtimeAction || typeof runtime.processDroppedFile !== "function") return;
    button.disabled = true;
    try {
      const result = await runtime.processDroppedFile({ filePath: file.filePath, action: runtimeAction });
      $("file-context-response").textContent = result?.text || "Archivo procesado.";
    } catch (error) {
      $("file-context-response").textContent = `No se pudo procesar el archivo: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  const fileContextPrompt = $("file-context-prompt");
  const sendFileContextQuestion = async () => {
    const question = fileContextPrompt?.value.trim();
    if (!question || !contextualFile || typeof runtime.processDroppedFile !== "function") return;
    const file = contextualFile;
    const sendButton = $("file-context-send");
    if (sendButton) sendButton.disabled = true;
    if (fileContextPrompt) fileContextPrompt.value = "";
    setFileContextResponse(`Consultando a Bit sobre ${file.name}…`);
    try {
      const result = await runtime.processDroppedFile({
        filePath: file.filePath || file.path,
        action: "ask",
        question,
      });
      if (contextualFile === file) setFileContextResponse(result?.text || "Bit no devolvió una respuesta.");
    } catch (error) {
      if (contextualFile === file) setFileContextResponse(`No se pudo consultar el archivo: ${error.message}`);
    } finally {
      if (sendButton) sendButton.disabled = false;
    }
  };
  $("file-context-send")?.addEventListener("click", () => void sendFileContextQuestion());
  fileContextPrompt?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendFileContextQuestion();
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
      const result = await runtime.closeActiveProject();
      if (!result?.ok) throw new Error(result?.error || "No se pudo cerrar el proyecto");
    } catch (error) {
      setProjectStatus(`ERROR: ${error.message}`);
    }
  });
  $("project-back")?.addEventListener("click", async () => {
    try { await runtime.backContext(); }
    catch (error) { setProjectStatus(`ERROR: ${error.message}`); }
  });
  $("document-close").addEventListener("click", closeDocument);
  $("model-close").addEventListener("click", closeModel);
  $("model-home")?.addEventListener("click", () => {
    // La casa del visor restablece la cámara inicial del modelo. La navegación
    // a la pantalla principal queda reservada para "Cerrar modelo".
    modelViewer?.reset();
  });
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

  // El proceso principal conserva el Workspace al recargar el renderer en desarrollo.
  // Recuperar solo la vista que sigue abierta; un proyecto seleccionado no implica
  // que el usuario no haya vuelto voluntariamente a la pantalla de inicio.
  void runtime.projectSnapshot({}).then(snapshot => {
    if (transitionReceived || snapshot.workspaceView !== "embedded" || !snapshot.activeProject) return;
    selectedProject = snapshot.activeProject;
    enterWorkspace({ displayMode: "embedded" });
  }).catch(error => console.warn("[workspace] No se pudo restaurar la vista activa:", error.message));

  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
    closeModel();
  };
}

if (typeof window !== "undefined" && window.bitRuntime) initWorkspaceContext();
