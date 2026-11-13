import { readdir, access } from "node:fs/promises";
import { join, resolve, relative, basename, extname, sep } from "node:path";

const EXCLUDE_DIRS = new Set([".obsidian", ".trash", "node_modules", ".git"]);
const EXCLUDE_HIDDEN = /^\./;
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);
const LEGACY_TYPES = new Set(["bit-conversation"]);

async function walkDir(dir, root) {
  const results = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name) || EXCLUDE_HIDDEN.test(entry.name)) continue;
      results.push(...await walkDir(fullPath, root));
    } else if (entry.isFile()) {
      if (MARKDOWN_EXTS.has(extname(entry.name).toLowerCase())) {
        results.push({ fullPath, relPath, name: basename(entry.name, extname(entry.name)) });
      }
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const data = {};
  for (const line of yaml.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      data[key] = value;
    }
  }
  return data;
}

function isLegacyNote(frontmatter) {
  if (!frontmatter) return false;
  if (frontmatter.type && LEGACY_TYPES.has(frontmatter.type)) return true;
  if (frontmatter.bit_version) return true;
  return false;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function auditVaultCompatibility(vaultPath) {
  const root = resolve(vaultPath);
  const bitFolder = join(root, "Bit");
  const hasBitFolder = await pathExists(bitFolder);

  let totalFiles = 0;
  let indexedNotes = 0;
  let legacyOutsideBit = 0;
  const warnings = [];

  try {
    const files = await walkDir(root, root);
    totalFiles = files.length;

    for (const file of files) {
      const content = await (await import("node:fs/promises")).readFile(file.fullPath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      if (frontmatter) {
        indexedNotes++;
        if (isLegacyNote(frontmatter) && !file.relPath.startsWith("Bit" + sep)) {
          legacyOutsideBit++;
        }
      }
    }

    if (legacyOutsideBit > 0) {
      warnings.push(`${legacyOutsideBit} nota(s) legacy fuera de /Bit/ detectadas. Se migrarán en futuras versiones.`);
    }
    if (totalFiles > 10000) {
      warnings.push("Bóveda grande (>10k notas): la indexación inicial puede tardar.");
    }
  } catch (error) {
    warnings.push(`Error al escanear: ${error.message}`);
  }

  return {
    ok: true,
    vaultPath: root,
    totalFiles,
    indexedNotes,
    legacyOutsideBit,
    warnings,
    hasBitFolder
  };
}