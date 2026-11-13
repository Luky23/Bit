import { open, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOTES = 10;
const MAX_NOTE_CHARS = 2000;
const MAX_READ_BYTES = 8192;
const EXCLUDED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

function titleFromContent(content, fallback) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
  const titleLine = frontmatter?.match(/^title:\s*(.*?)\s*$/mu)?.[1];
  return titleLine?.replace(/^(["'])(.*)\1$/u, "$2") || fallback;
}

async function findRecentMarkdownFiles(root, cutoff, now) {
  const pending = [root];
  const recent = [];

  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) pending.push(path);
        continue;
      }
      if (!entry.isFile() || ![".md", ".markdown"].includes(extname(entry.name).toLowerCase())) continue;

      const metadata = await stat(path);
      if (metadata.mtimeMs >= cutoff && metadata.mtimeMs <= now) {
        recent.push({ path, relativePath: relative(root, path), mtimeMs: metadata.mtimeMs });
      }
    }
  }

  return recent.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, MAX_NOTES);
}

async function readNoteExcerpt(path) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").slice(0, MAX_NOTE_CHARS);
  } finally {
    await file.close();
  }
}

export async function collectRecentVaultNotes(vaultPath, now = Date.now()) {
  if (typeof vaultPath !== "string" || !vaultPath) throw new Error("No hay una ruta de bóveda válida");
  const root = resolve(vaultPath);
  const recentFiles = await findRecentMarkdownFiles(root, now - LOOKBACK_MS, now);
  const notes = [];

  for (const file of recentFiles) {
    const content = await readNoteExcerpt(file.path);
    notes.push({
      title: titleFromContent(content, basename(file.relativePath, extname(file.relativePath))),
      content,
    });
  }

  return notes;
}
