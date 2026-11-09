import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectRecentVaultNotes } from "../src/obsidian/daily-summary.mjs";

test("daily summary: devuelve hasta 10 notas recientes en orden y respeta exclusiones", async () => {
  const vault = await mkdtemp(join(tmpdir(), "bit-daily-summary-"));
  const now = Date.now();
  try {
    const notesDir = join(vault, "Notas");
    await mkdir(notesDir);
    await mkdir(join(vault, ".obsidian"));
    await mkdir(join(vault, ".privado"));
    const recentFiles = [];
    for (let index = 0; index < 12; index += 1) {
      const path = join(notesDir, `nota-${index}.md`);
      await writeFile(path, `---\ntitle: Título ${index}\n---\n${"x".repeat(2200)}`);
      const modified = (now - (12 - index) * 1000) / 1000;
      await utimes(path, modified, modified);
      recentFiles.push(path);
    }

    const oldPath = join(notesDir, "antigua.md");
    await writeFile(oldPath, "Nota antigua");
    await utimes(oldPath, (now - 8 * 24 * 60 * 60 * 1000) / 1000, (now - 8 * 24 * 60 * 60 * 1000) / 1000);
    await writeFile(join(vault, ".obsidian", "settings.md"), "No incluir");
    await writeFile(join(vault, ".privado", "nota.md"), "No incluir");

    const notes = await collectRecentVaultNotes(vault, now);
    assert.equal(notes.length, 10);
    assert.equal(notes[0].title, "Título 11");
    assert.equal(notes.at(-1).title, "Título 2");
    assert.equal(notes[0].content.length, 2000);
    assert.ok(notes.every((note) => !note.content.includes("Nota antigua")));
    assert.equal(recentFiles.length, 12);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("daily summary: informa errores de bóveda en vez de devolver un resumen vacío", async () => {
  await assert.rejects(() => collectRecentVaultNotes(join(tmpdir(), "bit-vault-inexistente")));
});
