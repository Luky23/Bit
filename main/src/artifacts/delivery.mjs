import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";

const ACTIVE_TEXT = /\bon\w+\s*=|\b(?:fetch|xmlhttprequest|websocket|navigator\.sendbeacon)\s*\(|\b(?:https?:)?\/\//iu;
const ACTIVE_HTML = /<\s*\/?(?:script|iframe|object|embed|form)\b|\bon\w+\s*=|\b(?:fetch|xmlhttprequest|websocket|navigator\.sendbeacon)\s*\(|\b(?:https?:)?\/\//iu;
const SAFE_COLOR = /^#[0-9a-f]{6}$/iu;
const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,120}$/u;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertPassiveText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} debe ser texto no vacío`);
  if (ACTIVE_TEXT.test(value)) throw new Error(`${label} contiene contenido activo o una referencia de red`);
}

function validateSpec(spec) {
  assertPlainObject(spec, "La especificación");
  const allowed = new Set(["title", "subtitle", "sections", "accent"]);
  for (const key of Object.keys(spec)) {
    if (!allowed.has(key)) throw new Error(`campo no permitido: ${key}`);
  }
  assertPassiveText(spec.title, "El título");
  if (spec.subtitle !== undefined) assertPassiveText(spec.subtitle, "El subtítulo");
  if (!Array.isArray(spec.sections) || spec.sections.length === 0 || spec.sections.length > 50) {
    throw new Error("Las secciones deben contener entre 1 y 50 elementos");
  }
  if (!SAFE_COLOR.test(spec.accent ?? "")) throw new Error("El color de acento no es válido");
  for (const section of spec.sections) {
    assertPlainObject(section, "Cada sección");
    if (Object.keys(section).some((key) => key !== "heading" && key !== "paragraphs")) throw new Error("campo no permitido en sección");
    assertPassiveText(section.heading, "El encabezado");
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length === 0 || section.paragraphs.length > 100) {
      throw new Error("Los párrafos de una sección no son válidos");
    }
    for (const paragraph of section.paragraphs) assertPassiveText(paragraph, "El párrafo");
  }
}

export function validateRenderedHtml(html) {
  if (typeof html !== "string" || !html.trim()) return { ok: false, error: "HTML vacío" };
  if (!/Content-Security-Policy/i.test(html) || !/default-src 'none'/iu.test(html) || !/connect-src 'none'/iu.test(html) || !/form-action 'none'/iu.test(html)) {
    return { ok: false, error: "Falta una CSP restrictiva" };
  }
  if (ACTIVE_HTML.test(html)) return { ok: false, error: "El HTML contiene contenido activo o acceso de red" };
  return { ok: true };
}

export function renderHtmlArtifact(spec) {
  validateSpec(spec);
  const sections = spec.sections.map((section) => [
    "<section>",
    `<h2>${escapeHtml(section.heading)}</h2>`,
    ...section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    "</section>",
  ].join("\n")).join("\n");
  const subtitle = spec.subtitle ? `<p class="subtitle">${escapeHtml(spec.subtitle)}</p>` : "";
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>${escapeHtml(spec.title)}</title><style>:root{--accent:${spec.accent}}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#08121d;color:#e7f4ff}main{max-width:760px;margin:48px auto;padding:0 24px}h1,h2{color:var(--accent)}h1{margin-bottom:0}.subtitle{color:#b9c8d7}section{margin:32px 0;padding:20px;border-left:3px solid var(--accent);background:#0d1c2a}p{white-space:pre-wrap}</style></head>
<body><main><header><h1>${escapeHtml(spec.title)}</h1>${subtitle}</header>${sections}</main></body></html>`;
  const validation = validateRenderedHtml(html);
  if (!validation.ok) throw new Error(validation.error);
  return html;
}

function slugify(name) {
  const slug = String(name).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80);
  if (!slug) throw new Error("El nombre de la entrega no es válido");
  return slug;
}

function assertFileName(name) {
  if (typeof name !== "string" || !SAFE_FILE_NAME.test(name) || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("Nombre de archivo no permitido");
  }
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function createArtifactDelivery({ root, name, kind, files, spec, now = () => new Date() }) {
  if (typeof root !== "string" || !root) throw new Error("Se requiere una carpeta de entregas");
  if (kind !== "html" && kind !== "pdf") throw new Error("Tipo de entrega no permitido");
  validateSpec(spec);
  assertPlainObject(files, "Los archivos");
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.length > 20) throw new Error("Cantidad de archivos no válida");
  for (const [fileName, content] of entries) {
    assertFileName(fileName);
    if (!(typeof content === "string" || content instanceof Uint8Array)) throw new Error("El contenido del archivo no es válido");
    if (typeof content === "string" && Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) throw new Error("El archivo supera el límite de tamaño");
    if (content instanceof Uint8Array && content.byteLength > 20 * 1024 * 1024) throw new Error("El archivo supera el límite de tamaño");
  }
  if (kind === "html") {
    for (const [fileName, content] of entries) {
      if (fileName.endsWith(".html") && !validateRenderedHtml(content).ok) throw new Error("El HTML no supera la validación de seguridad");
    }
  }

  const destinationRoot = resolve(root);
  await mkdir(destinationRoot, { recursive: true });
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new Error("Fecha de entrega inválida");
  const prefix = `${date.toISOString().slice(0, 10)}_${slugify(name)}`;
  let folderName = prefix;
  let ordinal = 2;
  while (await exists(join(destinationRoot, folderName))) folderName = `${prefix} (${ordinal++})`;
  const deliveryPath = join(destinationRoot, folderName);
  if (relative(destinationRoot, deliveryPath).startsWith("..") || !deliveryPath.startsWith(destinationRoot + sep)) throw new Error("Ruta de entrega no permitida");
  await mkdir(deliveryPath);
  for (const [fileName, content] of entries) await writeFile(join(deliveryPath, fileName), content);
  const manifest = { version: 1, kind, name: String(name), createdAt: date.toISOString(), files: entries.map(([fileName]) => fileName), spec };
  await writeFile(join(deliveryPath, ".bit.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ok: true, path: deliveryPath, folderName, manifest };
}
