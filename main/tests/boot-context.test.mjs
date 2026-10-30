import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Simula la lógica de armado del contexto de bóveda para el resumen del día:
 * archivos .md modificados en los últimos 7 días, hasta 10, título y primeros 200 caracteres.
 */
async function assembleVaultContext(vaultPath) {
  const { ObsidianIndexer } = await import("../src/obsidian/indexer.mjs");
  const indexer = new ObsidianIndexer(vaultPath);
  await indexer.buildIndex();

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recent = [];

  for (const [relPath, entry] of indexer.index) {
    const fullPath = join(vaultPath, relPath);
    try {
      const { stat } = await import("node:fs/promises");
      const st = await stat(fullPath);
      if (st.mtimeMs >= sevenDaysAgo) {
        let content = "";
        try {
          const { readFile } = await import("node:fs/promises");
          content = await readFile(fullPath, "utf-8");
        } catch { content = ""; }
        recent.push({
          title: entry.title || relPath,
          content: content.slice(0, 200),
          mtimeMs: st.mtimeMs,
        });
      }
    } catch { /* skip */ }
  }

  recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return recent.slice(0, 10);
}

test("boot-context: notas de los últimos 7 días se incluyen", async () => {
  const vault = await mkdtemp(join(tmpdir(), "bit-boot-context-"));
  try {
    const bitDir = join(vault, "Bit");
    const convDir = join(bitDir, "Conversaciones");
    await mkdir(convDir, { recursive: true });

    const nowSec = Date.now() / 1000;
    const oneDayAgoSec = nowSec - 24 * 60 * 60;
    const thirtyDaysAgoSec = nowSec - 30 * 24 * 60 * 60;

    // Nota reciente (ayer) - mtime ayer
    await writeFile(join(convDir, "2026-10-29_nota-reciente.md"), "---\ntitle: Nota Reciente\ndate: 2026-10-29\n---\n# Contenido reciente de prueba");
    await utimes(join(convDir, "2026-10-29_nota-reciente.md"), oneDayAgoSec, oneDayAgoSec);

    // Nota antigua (hace 30 días) - mtime hace 30 días
    await writeFile(join(convDir, "2026-09-30_nota-antigua.md"), "---\ntitle: Nota Antigua\ndate: 2026-09-30\n---\n# Contenido antiguo");
    await utimes(join(convDir, "2026-09-30_nota-antigua.md"), thirtyDaysAgoSec, thirtyDaysAgoSec);

    const context = await assembleVaultContext(vault);
    assert.equal(context.length, 1);
    assert.equal(context[0].title, "Nota Reciente");
    assert.ok(context[0].content.includes("Contenido reciente"));
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("boot-context: sin bóveda devuelve vacío", async () => {
  const vault = await mkdtemp(join(tmpdir(), "bit-boot-empty-"));
  try {
    const context = await assembleVaultContext(vault);
    assert.equal(context.length, 0);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("boot-context: máximo 10 notas", async () => {
  const vault = await mkdtemp(join(tmpdir(), "bit-boot-many-"));
  try {
    const bitDir = join(vault, "Bit");
    const convDir = join(bitDir, "Conversaciones");
    await mkdir(convDir, { recursive: true });

    const nowSec = Date.now() / 1000;
    const oneHourAgoSec = nowSec - 60 * 60;

    // Crear 15 notas recientes
    for (let i = 0; i < 15; i++) {
      await writeFile(join(convDir, `2026-10-30_nota-${i}.md`), `---\ntitle: Nota ${i}\ndate: 2026-10-30\n---\n# Contenido ${i}`);
      await utimes(join(convDir, `2026-10-30_nota-${i}.md`), oneHourAgoSec, oneHourAgoSec);
    }

    const context = await assembleVaultContext(vault);
    assert.equal(context.length, 10);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});
