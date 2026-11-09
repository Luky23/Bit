import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, relative, basename, extname, dirname, posix } from "node:path";

const EXCLUDE_DIRS = new Set([".obsidian", ".trash", "node_modules", ".git"]);
const EXCLUDE_HIDDEN = /^\./;
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

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

function extractTags(content) {
  const tags = new Set();
  const tagRegex = /#([^\s#]+)/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    tags.add(match[1]);
  }
  return Array.from(tags);
}

function normalizeLinkTarget(value) {
  return String(value)
    .split("|", 1)[0]
    .trim()
    .replace(/^!/, "")
    .replace(/#[^#]*$/, "")
    .replace(/\^[^\s/]+$/, "")
    .trim();
}

function normalizePathKey(value) {
  return posix.normalize(String(value).replace(/\\/g, "/"))
    .replace(/^\.\/+/, "")
    .replace(/\.(?:md|markdown)$/i, "")
    .toLowerCase();
}

function extractWikiLinks(content) {
  const withoutCode = content
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  const targets = new Set();
  const linkRegex = /!?\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = linkRegex.exec(withoutCode)) !== null) {
    const target = normalizeLinkTarget(match[1]);
    if (target) targets.add(target);
  }
  return Array.from(targets);
}

function extractAliases(frontmatter) {
  if (!frontmatter) return [];
  const aliases = frontmatter.aliases ?? frontmatter.alias;
  if (!aliases) return [];
  if (Array.isArray(aliases)) return aliases.map(a => String(a).trim()).filter(Boolean);
  // Handle YAML inline array format: [alias1, alias2] or "alias1, alias2"
  const str = String(aliases).trim();
  const withoutBrackets = str.replace(/^\[|\]$/g, "");
  return withoutBrackets.split(",").map(a => a.trim()).filter(Boolean);
}

export class ObsidianIndexer {
  constructor(vaultPath) {
    this.vaultPath = resolve(vaultPath);
    this.index = new Map();
    this.titleIndex = new Map();
    this.aliasIndex = new Map();
    this.tagIndex = new Map();
    this.pathIndex = new Map();
    this.fileMetadata = new Map();
  }

  async #readEntry(file, metadata) {
    const content = await readFile(file.fullPath, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const tags = extractTags(content);
    const aliases = extractAliases(frontmatter);
    const title = frontmatter?.title ?? file.name;
    const entry = {
      path: file.relPath,
      title,
      aliases,
      tags,
      frontmatter,
      links: [],
      linkTargets: extractWikiLinks(content),
    };
    this.index.set(file.relPath, entry);
    this.fileMetadata.set(file.relPath, metadata);
  }

  #rebuildDerivedIndexes() {
    this.titleIndex.clear();
    this.aliasIndex.clear();
    this.tagIndex.clear();
    this.pathIndex.clear();
    for (const entry of this.index.values()) {
      this.pathIndex.set(normalizePathKey(entry.path), entry.path);
      this.titleIndex.set(entry.title.toLowerCase(), entry.path);
      for (const alias of entry.aliases) this.aliasIndex.set(alias.toLowerCase(), entry.path);
      for (const tag of entry.tags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
        this.tagIndex.get(tag).push(entry.path);
      }
    }
    for (const entry of this.index.values()) {
      entry.links = Array.from(new Set(
        entry.linkTargets.map((target) => this.resolveBacklink(target, entry.path)).filter(Boolean)
      ));
    }
  }

  async buildIndex() {
    this.index.clear();
    this.fileMetadata.clear();

    const files = await walkDir(this.vaultPath, this.vaultPath);
    for (const file of files) {
      const info = await stat(file.fullPath);
      await this.#readEntry(file, { size: info.size, mtimeMs: info.mtimeMs });
    }
    this.#rebuildDerivedIndexes();
    return this;
  }

  async refresh() {
    const files = await walkDir(this.vaultPath, this.vaultPath);
    const seen = new Set();
    let changed = false;
    for (const file of files) {
      seen.add(file.relPath);
      const info = await stat(file.fullPath);
      const nextMetadata = { size: info.size, mtimeMs: info.mtimeMs };
      const previousMetadata = this.fileMetadata.get(file.relPath);
      if (!previousMetadata || previousMetadata.size !== nextMetadata.size || previousMetadata.mtimeMs !== nextMetadata.mtimeMs) {
        await this.#readEntry(file, nextMetadata);
        changed = true;
      }
    }
    for (const path of this.index.keys()) {
      if (!seen.has(path)) {
        this.index.delete(path);
        this.fileMetadata.delete(path);
        changed = true;
      }
    }
    if (changed) this.#rebuildDerivedIndexes();
    return this;
  }

  resolveBacklink(linkName, fromPath = "") {
    const target = normalizeLinkTarget(linkName);
    if (!target) return null;

    const pathTarget = normalizePathKey(target);
    const pathCandidates = [pathTarget];
    if (fromPath && target.includes("/")) {
      pathCandidates.unshift(normalizePathKey(join(dirname(fromPath), target)));
    }
    for (const candidate of pathCandidates) {
      if (this.pathIndex.has(candidate)) return this.pathIndex.get(candidate);
    }

    const lower = target.toLowerCase();
    if (this.titleIndex.has(lower)) return this.titleIndex.get(lower);
    if (this.aliasIndex.has(lower)) return this.aliasIndex.get(lower);
    const basenameTarget = target.replace(/\\/g, "/").split("/").pop().toLowerCase();
    if (this.titleIndex.has(basenameTarget)) return this.titleIndex.get(basenameTarget);
    if (this.aliasIndex.has(basenameTarget)) return this.aliasIndex.get(basenameTarget);
    return null;
  }

  getByTitle(title) {
    return this.titleIndex.get(title.toLowerCase());
  }

  getByTag(tag) {
    return this.tagIndex.get(tag) ?? [];
  }

  getAllTags() {
    return Array.from(this.tagIndex.keys());
  }

  getAll() {
    return Array.from(this.index.values());
  }

  getBacklinks(notePath) {
    const resolvedPath = this.resolveBacklink(notePath);
    if (!resolvedPath) return [];
    return this.getAll()
      .filter((entry) => entry.links.includes(resolvedPath))
      .map((entry) => entry.path);
  }

  getGraph(notePath = "", limit = 200) {
    const allEntries = this.getAll();
    let entries = allEntries;

    if (notePath) {
      const resolvedPath = this.resolveBacklink(notePath);
      if (!resolvedPath) {
        return { nodes: [], edges: [], totalNodes: allEntries.length, truncated: false };
      }
      const center = this.index.get(resolvedPath);
      const connectedPaths = new Set([
        resolvedPath,
        ...center.links,
        ...this.getBacklinks(resolvedPath)
      ]);
      entries = [
        center,
        ...allEntries.filter((entry) => entry.path !== resolvedPath && connectedPaths.has(entry.path))
      ];
    }

    const nodeLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
    const nodes = entries.slice(0, nodeLimit).map(({ path, title, tags }) => ({ path, title, tags }));
    const includedPaths = new Set(nodes.map((node) => node.path));
    const graphPaths = new Set(entries.map((entry) => entry.path));
    const edges = entries
      .filter((entry) => includedPaths.has(entry.path))
      .flatMap((entry) => entry.links
        .filter((target) => includedPaths.has(target))
        .map((target) => ({ from: entry.path, to: target })));
    const totalEdges = entries.reduce(
      (count, entry) => count + entry.links.filter((target) => graphPaths.has(target)).length,
      0
    );

    return {
      nodes,
      edges,
      totalNodes: entries.length,
      totalEdges,
      truncated: nodes.length < entries.length
    };
  }
}
