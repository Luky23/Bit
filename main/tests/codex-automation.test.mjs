import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOOLS } from "../src/core/agent.mjs";
import { validateToolInput } from "../src/core/validation.mjs";
import { CodexImprovementManager, buildCodexPrompt, buildImplementationRequest, calculateSnapshotDiff, createProjectSnapshot, resolveTargetFiles, restoreProjectSnapshot, triggerCodexPrompt } from "../src/core/codex-automation.mjs";

test("codex automation: registra una herramienta validada que modifica estado", () => {
  assert.equal(AGENT_TOOLS.find((entry) => entry.name === "system.requestCodeImprovement")?.modifiesState, true);
  assert.equal(validateToolInput("bit:system-request-code-improvement", { userRequest: "Cambiar el HUD" }).ok, false);
  assert.equal(validateToolInput("bit:system-request-code-improvement", { userRequest: "Cambiar el HUD", targetArea: "ui" }).ok, true);
  assert.equal(validateToolInput("bit:system-request-code-improvement", { userRequest: "Cambiar el HUD", targetArea: "otra" }).ok, false);
  assert.equal(validateToolInput("bit:system-request-code-improvement", { userRequest: "Cambiar el HUD", targetFiles: [] }).ok, false);
  assert.equal(validateToolInput("bit:system-request-code-improvement", { userRequest: "" }).ok, false);
});

test("codex automation: construye la solicitud de borrador sin autorizar cambios", () => {
  const prompt = buildCodexPrompt({ userRequest: "Agregar un botón", targetFiles: ["main/electron/index.html"] });
  assert.match(prompt, /Pedido del usuario: Agregar un botón/u);
  assert.match(prompt, /NO modifiques/u);
  assert.match(prompt, /.bit\/pending-prompt\.md/u);
});

test("codex automation: limita el contexto a los archivos objetivo o al área mínima", () => {
  assert.deepEqual(resolveTargetFiles({ targetArea: "ui" }), ["main/electron/index.html"]);
  assert.deepEqual(resolveTargetFiles({ targetFiles: ["main/src/core/agent.mjs"] }), ["main/src/core/agent.mjs"]);
  assert.throws(() => resolveTargetFiles({ targetArea: "desconocida" }), /targetFiles o un targetArea válido/u);

  const prompt = buildCodexPrompt({ userRequest: "Cambiar el HUD", targetArea: "ui" });
  assert.match(prompt, /Archivos objetivo exclusivos/u);
  assert.match(prompt, /Nunca leas el directorio completo/u);
  assert.match(prompt, /UNIFIED DIFF/u);
});

test("codex automation: el pedido aprobado exige señal pero calcula el diff aparte", () => {
  const request = buildImplementationRequest("Cambiar el HUD", { targetArea: "ui" });
  assert.match(request, /Cambiar el HUD/u);
  assert.match(request, /.bit\/codex-change\.json/u);
  assert.match(request, /diff real/u);
});

test("codex automation: instantánea, diff y restauración", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-codex-project-"));
  const snapshot = await mkdtemp(join(tmpdir(), "bit-codex-snapshot-"));
  try {
    await mkdir(join(root, "main"));
    await writeFile(join(root, "package.json"), "{}\n");
    await writeFile(join(root, "main", "app.mjs"), "export const value = 1;\n");
    await createProjectSnapshot({ projectRoot: root, snapshotRoot: snapshot });
    await writeFile(join(root, "main", "app.mjs"), "export const value = 2;\n");
    await writeFile(join(root, "main", "new.mjs"), "export {};\n");
    const diff = await calculateSnapshotDiff({ projectRoot: root, snapshotRoot: snapshot });
    assert.deepEqual(diff.changes.map((item) => item.type).sort(), ["created", "modified"]);
    assert.match(diff.diff, /value = 2/u);
    await restoreProjectSnapshot({ projectRoot: root, snapshotRoot: snapshot });
    assert.equal(await readFile(join(root, "main", "app.mjs"), "utf8"), "export const value = 1;\n");
    await assert.rejects(() => readFile(join(root, "main", "new.mjs")));
  } finally { await rm(root, { recursive: true, force: true }); await rm(snapshot, { recursive: true, force: true }); }
});

test("codex automation: requiere prompt, diff y verificación antes de reiniciar", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-codex-manager-"));
  const data = await mkdtemp(join(tmpdir(), "bit-codex-data-"));
  let restarted = 0;
  try {
    await mkdir(join(root, "main"));
    await writeFile(join(root, "package.json"), "{}\n");
    await writeFile(join(root, "main", "app.mjs"), "export const n = 1;\n");
    const manager = new CodexImprovementManager({ projectRoot: root, dataRoot: data, openProject: async () => {}, sendPrompt: async () => {}, verify: async () => ({ ok: true }), restart: async () => { restarted += 1; }, pollMs: 100000 });
    await manager.start({ userRequest: "Cambiar n", targetFiles: ["main/app.mjs"] });
    await writeFile(join(root, ".bit", "pending-prompt.md"), "Cambiar n a 2");
    await manager.poll(); assert.equal(manager.state.status, "awaitingPromptApproval");
    await manager.approvePrompt(); assert.equal(manager.state.status, "implementing");
    await writeFile(join(root, "main", "app.mjs"), "export const n = 2;\n");
    await writeFile(join(root, ".bit", "codex-change.json"), "{\"status\":\"completed\"}");
    await manager.poll(); assert.equal(manager.state.status, "awaitingDiffApproval");
    await manager.approveDiff(); assert.equal(restarted, 1);
  } finally { await rm(root, { recursive: true, force: true }); await rm(data, { recursive: true, force: true }); }
});

test("codex automation: compatibilidad del disparador cancela antes de abrir VS Code", async () => {
  let opened = false;
  const result = await triggerCodexPrompt({ userRequest: "Cambiar color", targetArea: "ui", projectRoot: "C:\\repo\\Bit", deps: { confirmPrompt: async () => false, openProject: async () => { opened = true; }, sendPrompt: async () => {} } });
  assert.deepEqual(result, { ok: false, cancelled: true }); assert.equal(opened, false);
});
