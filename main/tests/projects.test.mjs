import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectWorkspace, validateProjectsRoot } from "../src/projects/workspace.mjs";
import { toolSchemaName, validateToolInput } from "../src/core/validation.mjs";
import { routeRequest } from "../src/models/router.mjs";
import { runAgentTurn } from "../src/core/agent.mjs";

async function makeWorkspace(t) {
  const directory = await mkdtemp(join(tmpdir(), "bit-projects-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    root,
    auditPath: join(directory, "audit.log"),
    workspace: createProjectWorkspace({ root, auditPath: join(directory, "audit.log") }),
  };
}

test("workspace: crea proyectos y archivos de texto solo dentro de la carpeta elegida", async (t) => {
  const { root, workspace } = await makeWorkspace(t);
  await workspace.createProject({ project: "Mark II" });
  await workspace.createFile({ project: "Mark II", path: "src/design.md", content: "Diseño inicial" });

  assert.deepEqual(await workspace.listProjects(), ["Mark II"]);
  assert.deepEqual(await workspace.listFiles({ project: "Mark II" }), ["src/design.md"]);
  assert.deepEqual(await workspace.readFile({ project: "Mark II", path: "src/design.md" }), {
    project: "Mark II",
    path: "src/design.md",
    content: "Diseño inicial",
  });
  assert.equal(await readFile(join(root, "Mark II", "src", "design.md"), "utf8"), "Diseño inicial");
});

test("workspace: guarda una copia antes de cada modificación y respalda la versión actual al restaurar", async (t) => {
  const { workspace, auditPath } = await makeWorkspace(t);
  await workspace.createProject({ project: "Mark II" });
  await workspace.createFile({ project: "Mark II", path: "notes.txt", content: "secreto inicial" });

  const firstUpdate = await workspace.updateFile({ project: "Mark II", path: "notes.txt", content: "versión dos" });
  assert.equal(firstUpdate.backupId.endsWith(".bak"), true);
  const secondUpdate = await workspace.updateFile({ project: "Mark II", path: "notes.txt", content: "versión tres" });
  assert.notEqual(firstUpdate.backupId, secondUpdate.backupId);
  assert.deepEqual(await workspace.listBackups({ project: "Mark II", path: "notes.txt" }), [
    { path: "notes.txt", backupId: secondUpdate.backupId, size: Buffer.byteLength("versión dos") },
    { path: "notes.txt", backupId: firstUpdate.backupId, size: Buffer.byteLength("secreto inicial") },
  ]);

  const restored = await workspace.restoreBackup({
    project: "Mark II",
    path: "notes.txt",
    backupId: firstUpdate.backupId,
  });
  assert.equal(restored.currentBackupId.endsWith(".bak"), true);
  assert.equal((await workspace.readFile({ project: "Mark II", path: "notes.txt" })).content, "secreto inicial");
  const audit = await readFile(auditPath, "utf8");
  assert.match(audit, /"action":"workspace.update-file"/u);
  assert.doesNotMatch(audit, /secreto inicial/u);
});

test("workspace: bloquea traversal, sobrescritura y archivos binarios", async (t) => {
  const { workspace } = await makeWorkspace(t);
  await workspace.createProject({ project: "Mark II" });
  await assert.rejects(workspace.createFile({ project: "Mark II", path: "../outside.txt", content: "x" }), /ruta|proyecto/i);
  await assert.rejects(workspace.createProject({ project: ".." }), /nombre de proyecto/i);
  await workspace.createFile({ project: "Mark II", path: "notes.txt", content: "original" });
  await assert.rejects(workspace.createFile({ project: "Mark II", path: "notes.txt", content: "reemplazo" }), /EEXIST/u);
  await assert.rejects(workspace.updateFile({ project: "Mark II", path: "notes.txt", content: "\0binario" }), /UTF-8/u);
  assert.equal((await workspace.readFile({ project: "Mark II", path: "notes.txt" })).content, "original");
});

test("workspace: rechaza ubicaciones dentro de un repositorio Git", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bit-git-root-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectRoot = join(directory, "repo", "projects");
  await mkdir(join(directory, "repo", ".git"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await assert.rejects(validateProjectsRoot(projectRoot), /repositorio Git/u);
});

test("workspace tools: valida argumentos y solo ofrece escrituras para tareas pesadas sin imágenes", async () => {
  assert.equal(routeRequest("Crea el proyecto Mark II").role, "heavy");
  assert.equal(toolSchemaName("workspace.createFile"), "bit:workspace-create-file");
  assert.equal(validateToolInput("bit:workspace-create-file", {
    project: "Mark II",
    path: "src/main.ts",
    content: "console.log('no se ejecuta');",
    extra: true,
  }).ok, false);

  let capturedRequest;
  const deps = {
    chatClient: {
      async generate(_model, request) {
        capturedRequest = request;
        return { message: { content: "No ejecuté ninguna acción." } };
      },
    },
    ollamaClient: { async show() { return { tools: true, vision: true }; } },
    async executeTool() { throw new Error("No se esperaba ejecutar una herramienta"); },
  };
  await runAgentTurn({
    message: "Crea el proyecto Mark II",
    config: { model: "qwen2.5-coder:7b", fastModel: "qwen2.5:3b" },
    deps,
  });
  assert.ok(capturedRequest.tools.some((tool) => tool.function.name === "workspace.createProject"));

  await runAgentTurn({
    message: "Crea el proyecto Mark II usando esta captura",
    imageDataUrl: "data:image/png;base64,AA==",
    config: { model: "qwen2.5-coder:7b", fastModel: "qwen2.5:3b" },
    deps,
  });
  assert.ok(!capturedRequest.tools.some((tool) =>
    ["workspace.createProject", "workspace.createFile", "workspace.updateFile", "workspace.restoreBackup"]
      .includes(tool.function.name)
  ));
});

test("agent: no ejecuta herramientas ocultas ni permite escribir después de leer datos externos", async () => {
  let executedHiddenTool = false;
  let imageRounds = 0;
  const imageTurn = await runAgentTurn({
    message: "Crea el proyecto Mark II a partir de esta captura",
    imageDataUrl: "data:image/png;base64,AA==",
    config: { model: "qwen2.5-coder:7b", fastModel: "qwen2.5:3b" },
    deps: {
      chatClient: {
        async generate() {
          imageRounds++;
          if (imageRounds > 1) return { message: { content: "No ejecuté cambios." } };
          return {
            message: {
              tool_calls: [{
                id: "hidden-write",
                type: "function",
                function: { name: "workspace.createProject", arguments: JSON.stringify({ project: "Mark II" }) },
              }],
            },
          };
        },
      },
      ollamaClient: { async show() { return { tools: true, vision: true }; } },
      async executeTool() { executedHiddenTool = true; },
    },
  });
  assert.equal(imageTurn.toolCalls, 1);
  assert.equal(executedHiddenTool, false);

  const executedTools = [];
  let calls = 0;
  await runAgentTurn({
    message: "Lee el archivo y luego actualiza el proyecto Mark II",
    config: { model: "qwen2.5-coder:7b", fastModel: "qwen2.5:3b" },
    deps: {
      chatClient: {
        async generate() {
          calls++;
          const tool = calls === 1
            ? { name: "workspace.readFile", arguments: { project: "Mark II", path: "notes.txt" } }
            : { name: "workspace.updateFile", arguments: { project: "Mark II", path: "notes.txt", content: "nuevo" } };
          return {
            message: {
              tool_calls: [{
                id: `step-${calls}`,
                type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
              }],
            },
          };
        },
      },
      ollamaClient: { async show() { return { tools: true, vision: true }; } },
      async executeTool(name) {
        executedTools.push(name);
        return { content: "contenido leído" };
      },
    },
  });
  assert.deepEqual(executedTools, ["workspace.readFile"]);
});
