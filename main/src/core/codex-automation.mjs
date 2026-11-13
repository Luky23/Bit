import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { focusWindow, listWindows, sendKeyCombo } from "./win-automation.mjs";

export const CODEX_STATES = Object.freeze(["idle", "drafting", "awaitingPromptApproval", "implementing", "verifying", "awaitingDiffApproval", "restarting", "rolledBack", "failed"]);
export const DRAFT_FILE = ".bit/pending-prompt.md";
export const COMPLETION_FILE = ".bit/codex-change.json";
const CODEX_OPEN_COMMAND = "Codex: Open Codex Sidebar";
const ROOT_FILES = new Set([".gitignore", "AGENTS.md", "package.json", "package-lock.json", "electron-builder.yml", "opencode.json", "README.md"]);
const ROOT_DIRS = new Set(["main", "scripts", "docs", ".github", ".vscode"]);
const EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".ts", ".tsx", ".html", ".css", ".json", ".yml", ".yaml", ".md", ".py"]);
const EXCLUDED = new Set([".git", ".bit", "node_modules", "dist", "models", "userData", "userData-preview", "data", "vault", "boveda", "notas", "audio-user", "logs", "coverage", ".venv", "_referencia"]);
export const TARGET_FILES_BY_AREA = Object.freeze({
  ui: "main/electron/index.html",
  tools: "main/src/core/file-tools.mjs",
  voice: "main/src/voice/speech.mjs",
  backend: "main/electron/main.mjs",
});

const delay = (ms, signal) => new Promise((ok, fail) => {
  if (signal?.aborted) return fail(new Error("La automatización fue cancelada"));
  const timer = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); fail(new Error("La automatización fue cancelada")); }, { once: true });
});
const normalize = (path) => String(path).split(sep).join("/");
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const inside = (root, path) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith(sep)); };

async function allowedFiles(root) {
  const output = [];
  const visit = async (dir, rel = "") => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const childRel = normalize(join(rel, entry.name));
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name) || (!rel && !ROOT_DIRS.has(entry.name))) continue;
        await visit(child, childRel);
      } else if (entry.isFile() && (ROOT_FILES.has(entry.name) || EXTENSIONS.has(extname(entry.name).toLowerCase())) && (await stat(child)).size <= 2_000_000) {
        output.push({ path: childRel, absolute: child });
      }
    }
  };
  await visit(root);
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

export function resolveTargetFiles({ targetArea, targetFiles } = {}) {
  if (targetArea !== undefined && !Object.hasOwn(TARGET_FILES_BY_AREA, targetArea)) throw new Error("Indique targetFiles o un targetArea válido");
  if (targetFiles !== undefined) {
    if (!Array.isArray(targetFiles) || targetFiles.length < 1 || targetFiles.length > 2) throw new Error("targetFiles debe incluir uno o dos archivos");
    const files = [...new Set(targetFiles.map((item) => String(item).trim().replaceAll("\\", "/")))];
    if (files.length !== targetFiles.length || files.some((file) => !file || file.startsWith("/") || file.includes("..") || file.includes("//"))) throw new Error("targetFiles contiene una ruta inválida");
    return files;
  }
  if (targetArea) return [TARGET_FILES_BY_AREA[targetArea]];
  throw new Error("Indique targetFiles o un targetArea válido");
}

export function buildDraftRequest({ userRequest, targetArea, targetFiles } = {}) {
  if (typeof userRequest !== "string" || !userRequest.trim()) throw new Error("El requerimiento no puede estar vacío");
  const files = resolveTargetFiles({ targetArea, targetFiles });
  const targets = files.map((file) => `- ${file}`).join("\n");
  return `Analizá este pedido para Bit y redactá un prompt de implementación preciso. Todavía NO modifiques ningún archivo del proyecto.\n\nPedido del usuario: ${userRequest.trim().slice(0, 8000)}\n\nArchivos objetivo exclusivos:\n${targets}\n\nLeé únicamente AGENTS.md y los archivos objetivo. Nunca leas el directorio completo ni envíes contextos globales si la modificación afecta solo a un módulo específico. El prompt debe exigir un parche corto UNIFIED DIFF (líneas + y -), no archivos completos. Guardá únicamente el prompt final en ${DRAFT_FILE}. No escribas ningún otro archivo ni ejecutes comandos.`;
}
export const buildCodexPrompt = buildDraftRequest;
export function buildImplementationRequest(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("El prompt aprobado está vacío");
  const files = resolveTargetFiles(options);
  return `Implementá exactamente este prompt aprobado por el usuario:\n\n---\n${prompt.trim()}\n---\n\nArchivos objetivo exclusivos:\n${files.map((file) => `- ${file}`).join("\n")}\n\nRespetá AGENTS.md y no instales dependencias. Leé y modificá exclusivamente los archivos objetivo; nunca leas el directorio completo ni envíes contextos globales. Aplicá parches cortos UNIFIED DIFF (líneas + y -), sin reescribir archivos completos. Al terminar de editar, creá ${COMPLETION_FILE} con JSON válido {"status":"completed"}. Bit calculará el diff real de forma independiente.`;
}

export function resolveVsCodeExecutable({ localAppData = process.env.LOCALAPPDATA, programFiles = process.env.ProgramFiles, programFilesX86 = process.env["ProgramFiles(x86)"], exists = existsSync } = {}) {
  return [localAppData && join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), programFiles && join(programFiles, "Microsoft VS Code", "Code.exe"), programFilesX86 && join(programFilesX86, "Microsoft VS Code", "Code.exe")].filter(Boolean).find((path) => exists(path)) || null;
}
export async function openVsCodeProject(projectRoot, { spawnImpl = spawn, resolveExecutable = resolveVsCodeExecutable, signal } = {}) {
  if (signal?.aborted) throw new Error("La automatización fue cancelada");
  const executable = resolveExecutable();
  if (!executable) throw new Error("No se encontró Visual Studio Code");
  spawnImpl(executable, [projectRoot, "--reuse-window"], { shell: false, windowsHide: false, detached: false }).unref?.();
}
export async function sendPromptToCodex(prompt, { clipboard, wait = delay, windows = listWindows, focus = focusWindow, key = sendKeyCombo, projectRoot = "", signal } = {}) {
  if (!clipboard?.writeText) throw new Error("Portapapeles de Electron no disponible");
  await wait(1500, signal);
  const project = basename(projectRoot).toLowerCase();
  const candidates = (await windows()).filter((item) => item.process.toLowerCase() === "code");
  const target = candidates.find((item) => item.title.toLowerCase().includes(project)) || candidates[0];
  if (!target || !(await focus(target.title))) throw new Error("No se pudo enfocar VS Code");
  await key("ctrl+shift+p"); clipboard.writeText(CODEX_OPEN_COMMAND); await key("ctrl+v"); await key("enter");
  await wait(1000, signal); clipboard.writeText(prompt); await key("ctrl+v"); await key("enter");
}

export async function createProjectSnapshot({ projectRoot, snapshotRoot }) {
  const files = await allowedFiles(resolve(projectRoot));
  await mkdir(snapshotRoot, { recursive: true });
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: {} };
  for (const file of files) {
    const content = await readFile(file.absolute);
    manifest.files[file.path] = { hash: hash(content), bytes: content.length };
    const backup = join(snapshotRoot, "files", ...file.path.split("/"));
    await mkdir(dirname(backup), { recursive: true }); await copyFile(file.absolute, backup);
  }
  await writeFile(join(snapshotRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
const loadManifest = async (root) => JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
function fileDiff(path, before, after) {
  const a = before.split(/\r?\n/u), b = after.split(/\r?\n/u), lines = [`--- a/${path}`, `+++ b/${path}`];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) { if (i < a.length) lines.push(`-${a[i]}`); if (i < b.length) lines.push(`+${b[i]}`); }
  return lines.join("\n");
}
export async function calculateSnapshotDiff({ projectRoot, snapshotRoot }) {
  const manifest = await loadManifest(snapshotRoot), current = new Map((await allowedFiles(resolve(projectRoot))).map((file) => [file.path, file]));
  const paths = [...new Set([...Object.keys(manifest.files), ...current.keys()])].sort(), changes = []; let diff = "";
  for (const path of paths) {
    const before = manifest.files[path] ? await readFile(join(snapshotRoot, "files", ...path.split("/"))) : null;
    const after = current.has(path) ? await readFile(current.get(path).absolute) : null;
    if ((before && hash(before)) === (after && hash(after))) continue;
    changes.push({ path, type: !before ? "created" : !after ? "deleted" : "modified" });
    diff += `${diff ? "\n\n" : ""}${fileDiff(path, before?.toString("utf8") || "", after?.toString("utf8") || "")}`;
  }
  return { changes, diff };
}
export async function restoreProjectSnapshot({ projectRoot, snapshotRoot }) {
  const root = resolve(projectRoot), comparison = await calculateSnapshotDiff({ projectRoot: root, snapshotRoot });
  for (const change of comparison.changes) {
    const target = resolve(root, ...change.path.split("/"));
    if (!inside(root, target)) throw new Error(`Ruta fuera del proyecto: ${change.path}`);
    if (change.type === "created") await rm(target, { force: true });
    else { await mkdir(dirname(target), { recursive: true }); await copyFile(join(snapshotRoot, "files", ...change.path.split("/")), target); }
  }
  return { restored: comparison.changes.map((item) => item.path) };
}
export function runFixedVerification({ projectRoot, spawnImpl = spawn }) {
  const run = (script) => new Promise((done) => {
    const child = spawnImpl("npm.cmd", ["run", script], { cwd: projectRoot, shell: false, windowsHide: true }); let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); }); child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => done({ ok: false, script, output: error.message })); child.on("close", (code) => done({ ok: code === 0, script, code, output: output.slice(-20000) }));
  });
  return (async () => { const typecheck = await run("typecheck"); if (!typecheck.ok) return { ok: false, typecheck, verify: null }; const verify = await run("verify"); return { ok: verify.ok, typecheck, verify }; })();
}

export class CodexImprovementManager {
  constructor({ projectRoot, dataRoot, openProject, sendPrompt, verify = runFixedVerification, restart = async () => {}, onState = () => {}, audit = async () => {}, pollMs = 750 }) {
    Object.assign(this, { projectRoot: resolve(projectRoot), dataRoot: resolve(dataRoot), openProject, sendPrompt, verify, restart, onState, audit, pollMs }); this.state = { status: "idle" }; this.timer = null;
  }
  async transition(status, extra = {}) {
    if (!CODEX_STATES.includes(status)) throw new Error(`Estado inválido: ${status}`);
    this.state = { ...this.state, ...extra, status, updatedAt: new Date().toISOString() };
    if (this.state.sessionDir) await writeFile(join(this.state.sessionDir, "state.json"), JSON.stringify(this.state, null, 2));
    await this.audit({ action: "codex.improvement", status, sessionId: this.state.sessionId || null }); this.onState({ ...this.state });
  }
  async recover() {
    const sessionsRoot = join(this.dataRoot, "codex-improvements");
    let sessions;
    try { sessions = await readdir(sessionsRoot, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return { ok: true, status: "idle" }; throw error; }
    const candidates = [];
    for (const entry of sessions) {
      if (!entry.isDirectory()) continue;
      const statePath = join(sessionsRoot, entry.name, "state.json");
      try { const info = await stat(statePath); candidates.push({ statePath, mtime: info.mtimeMs }); } catch { /* sesión incompleta */ }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (!candidates.length) return { ok: true, status: "idle" };
    const recovered = JSON.parse(await readFile(candidates[0].statePath, "utf8"));
    if (!["drafting", "awaitingPromptApproval", "implementing", "verifying", "awaitingDiffApproval"].includes(recovered.status)) return { ok: true, status: "idle" };
    this.state = recovered;
    this.onState({ ...this.state, recovered: true });
    if (["drafting", "implementing"].includes(this.state.status)) this.schedule();
    else if (this.state.status === "verifying") {
      const diff = await calculateSnapshotDiff({ projectRoot: this.projectRoot, snapshotRoot: this.state.sessionDir });
      const verification = await this.verify({ projectRoot: this.projectRoot });
      await this.transition("awaitingDiffApproval", { diff, verification });
    }
    return { ok: true, status: this.state.status };
  }
  async start({ userRequest, targetArea, targetFiles } = {}) {
    if (!["idle", "failed", "rolledBack"].includes(this.state.status)) throw new Error("Ya hay una mejora de código en curso");
    const files = resolveTargetFiles({ targetArea, targetFiles });
    const sessionId = randomUUID(), sessionDir = join(this.dataRoot, "codex-improvements", sessionId);
    await mkdir(join(this.projectRoot, ".bit"), { recursive: true }); await rm(join(this.projectRoot, DRAFT_FILE), { force: true }); await rm(join(this.projectRoot, COMPLETION_FILE), { force: true });
    await createProjectSnapshot({ projectRoot: this.projectRoot, snapshotRoot: sessionDir });
    await this.transition("drafting", { sessionId, sessionDir, userRequest: userRequest.trim(), targetArea, targetFiles: files, prompt: null, diff: null, verification: null });
    await this.openProject(this.projectRoot); await this.sendPrompt(buildDraftRequest({ userRequest, targetFiles: files })); this.schedule();
    return { ok: true, sessionId, status: "drafting" };
  }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.poll().catch((error) => this.fail(error)), this.pollMs); }
  async poll() {
    clearTimeout(this.timer);
    if (this.state.status === "drafting") {
      let prompt; try { prompt = (await readFile(join(this.projectRoot, DRAFT_FILE), "utf8")).trim(); } catch (error) { if (error?.code === "ENOENT") return this.schedule(); throw error; }
      if (!prompt) return this.schedule();
      const diff = await calculateSnapshotDiff({ projectRoot: this.projectRoot, snapshotRoot: this.state.sessionDir }); if (diff.changes.length) throw new Error("Codex modificó archivos durante el borrador");
      await this.transition("awaitingPromptApproval", { prompt }); return;
    }
    if (this.state.status === "implementing") {
      try { JSON.parse(await readFile(join(this.projectRoot, COMPLETION_FILE), "utf8")); } catch (error) { if (error?.code === "ENOENT" || error instanceof SyntaxError) return this.schedule(); throw error; }
      await this.transition("verifying"); const diff = await calculateSnapshotDiff({ projectRoot: this.projectRoot, snapshotRoot: this.state.sessionDir }); if (!diff.changes.length) throw new Error("Codex no produjo cambios");
      const verification = await this.verify({ projectRoot: this.projectRoot }); await this.transition("awaitingDiffApproval", { diff, verification });
    }
  }
  async approvePrompt() { if (this.state.status !== "awaitingPromptApproval") throw new Error("No hay prompt pendiente"); await rm(join(this.projectRoot, COMPLETION_FILE), { force: true }); await this.transition("implementing"); await this.sendPrompt(buildImplementationRequest(this.state.prompt, { targetFiles: this.state.targetFiles })); this.schedule(); return { ok: true, status: "implementing" }; }
  async rejectPrompt() { if (this.state.status !== "awaitingPromptApproval") throw new Error("No hay prompt pendiente"); return this.rollback(); }
  async approveDiff() { if (this.state.status !== "awaitingDiffApproval") throw new Error("No hay diff pendiente"); if (!this.state.verification?.ok) throw new Error("La verificación falló"); clearTimeout(this.timer); await this.transition("restarting"); await this.restart(); return { ok: true, status: "restarting" }; }
  async rejectDiff() { if (this.state.status !== "awaitingDiffApproval") throw new Error("No hay diff pendiente"); return this.rollback(); }
  async rollback() { clearTimeout(this.timer); const result = await restoreProjectSnapshot({ projectRoot: this.projectRoot, snapshotRoot: this.state.sessionDir }); await rm(join(this.projectRoot, DRAFT_FILE), { force: true }); await rm(join(this.projectRoot, COMPLETION_FILE), { force: true }); await this.transition("rolledBack", result); return { ok: true, status: "rolledBack", ...result }; }
  async cancel() { return ["idle", "rolledBack", "failed", "restarting"].includes(this.state.status) ? { ok: true, status: this.state.status } : this.rollback(); }
  async fail(error) {
    clearTimeout(this.timer);
    let restored = [];
    if (this.state.status === "drafting" && this.state.sessionDir) {
      try {
        restored = (await restoreProjectSnapshot({ projectRoot: this.projectRoot, snapshotRoot: this.state.sessionDir })).restored;
        await rm(join(this.projectRoot, DRAFT_FILE), { force: true });
      } catch (restoreError) {
        console.error("[codex] No se pudo restaurar el borrador inválido:", restoreError);
      }
    }
    await this.transition("failed", { error: error instanceof Error ? error.message : String(error), restored });
  }
}

export async function triggerCodexPrompt({ userRequest, targetArea, targetFiles, projectRoot, deps }) {
  const prompt = buildDraftRequest({ userRequest, targetArea, targetFiles }); if (!(await deps.confirmPrompt(prompt))) return { ok: false, cancelled: true };
  const context = await deps.onAutomationStart?.(); try { await deps.openProject(projectRoot, context); await deps.sendPrompt(prompt, context); } finally { await deps.onAutomationEnd?.(context); }
  return { ok: true, sent: true, prompt };
}
