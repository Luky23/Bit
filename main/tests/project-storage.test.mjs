import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectWorkspace } from "../src/projects/workspace.mjs";

test("el modo de respaldo central conserva metadatos y separa las copias", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bit-storage-root-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "bit-storage-backups-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(backupRoot, { recursive: true, force: true })]));
  const workspace = createProjectWorkspace({ root, backupRoot, auditPath: join(root, "audit.log") });

  await workspace.createProject({ project: "FlipDock", storageMode: "central-local-backup" });
  await workspace.createFile({ project: "FlipDock", path: "notes.txt", content: "uno" });
  await workspace.updateFile({ project: "FlipDock", path: "notes.txt", content: "dos" });

  assert.deepEqual(await workspace.listFiles({ project: "FlipDock" }), ["notes.txt"]);
  assert.equal(JSON.parse(await readFile(join(root, "FlipDock", ".bit-storage.json"), "utf8")).storageMode, "central-local-backup");
  assert.equal((await workspace.listBackups({ project: "FlipDock", path: "notes.txt" })).length, 1);
  assert.equal((await readdir(join(backupRoot, ".bit-backups", "FlipDock", "notes.txt.versions"))).length, 1);
});
