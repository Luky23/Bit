const PDFJS_URL = new URL("../../node_modules/pdfjs-dist/build/pdf.mjs", import.meta.url).href;
const PDFJS_WORKER_URL = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;

export function createPdfViewer({ stage, pages, frame, status, documentRef = document } = {}) {
  let task = null;
  let pdf = null;
  let token = 0;
  let pageNumber = 1;
  let zoom = 1;
  let fit = true;

  const yieldToUi = () => new Promise(resolve => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(resolve, { timeout: 80 });
    else globalThis.setTimeout(resolve, 0);
  });

  function updateStatus() {
    if (status && pdf) status.textContent = `${pageNumber} / ${pdf.numPages}`;
    for (const item of pages?.querySelectorAll?.("[data-pdf-page]") || []) item.classList.toggle("is-active", Number(item.dataset.pdfPage) === pageNumber);
  }

  async function canvasFor(page, scale, generation) {
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const canvas = documentRef.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
    return generation === token ? canvas : null;
  }

  async function renderPage(generation = token) {
    if (!pdf || generation !== token) return;
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, (frame?.clientWidth || 800) - 36);
    const height = Math.max(240, (frame?.clientHeight || 700) - 36);
    const scale = fit ? Math.min(width / base.width, height / base.height) : zoom;
    const canvas = await canvasFor(page, Math.max(.2, scale), generation);
    if (!canvas || generation !== token) return;
    stage.replaceChildren(canvas);
    updateStatus();
  }

  async function renderThumbnails(generation) {
    pages.replaceChildren();
    for (let number = 1; number <= pdf.numPages; number += 1) {
      await yieldToUi();
      if (generation !== token) return;
      const page = await pdf.getPage(number);
      const button = documentRef.createElement("button");
      button.type = "button";
      button.dataset.pdfPage = String(number);
      button.className = "file-context-page-item";
      const thumb = documentRef.createElement("span");
      thumb.className = "file-context-page-thumb";
      const label = documentRef.createElement("span");
      label.textContent = `Página ${number}`;
      button.append(thumb, label);
      button.addEventListener("click", () => { pageNumber = number; void renderPage(); });
      pages.append(button);
      const canvas = await canvasFor(page, .22, generation);
      if (canvas) thumb.append(canvas);
    }
    updateStatus();
  }

  function normalizeSource(source) {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (typeof source === "string" && source.startsWith("data:application/pdf;base64,")) {
      const binary = globalThis.atob(source.slice(source.indexOf(",") + 1));
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
    throw new TypeError("El PDF local no contiene bytes válidos");
  }

  async function load(source) {
    clear();
    const generation = token;
    const pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    task = pdfjs.getDocument({ data: normalizeSource(source) });
    pdf = await task.promise;
    if (generation !== token) return;
    pageNumber = 1;
    fit = true;
    await renderPage(generation);
    void renderThumbnails(generation);
  }

  function clear() {
    token += 1;
    task?.destroy?.();
    pdf?.destroy?.();
    task = null;
    pdf = null;
    stage?.replaceChildren();
    pages?.replaceChildren();
  }

  const changePage = delta => { if (pdf) { pageNumber = Math.min(pdf.numPages, Math.max(1, pageNumber + delta)); void renderPage(); } };
  const changeZoom = delta => { fit = false; zoom = Math.min(2.5, Math.max(.35, zoom + delta)); void renderPage(); };
  return { load, clear, previous: () => changePage(-1), next: () => changePage(1), zoomIn: () => changeZoom(.15), zoomOut: () => changeZoom(-.15), fitPage: () => { fit = true; void renderPage(); } };
}
