import { readdir, readFile } from "node:fs/promises";
import { join, resolve, relative, basename, extname } from "node:path";

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
  }

  async buildIndex() {
    this.index.clear();
    this.titleIndex.clear();
    this.aliasIndex.clear();
    this.tagIndex.clear();

    const files = await walkDir(this.vaultPath, this.vaultPath);
    for (const file of files) {
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
        frontmatter
      };

      this.index.set(file.relPath, entry);
      this.titleIndex.set(title.toLowerCase(), file.relPath);
      for (const alias of aliases) {
        this.aliasIndex.set(alias.toLowerCase(), file.relPath);
      }
      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
        this.tagIndex.get(tag).push(file.relPath);
      }
    }
    return this;
  }

  resolveBacklink(linkName) {
    const lower = linkName.toLowerCase();
    if (this.titleIndex.has(lower)) return this.titleIndex.get(lower);
    if (this.aliasIndex.has(lower)) return this.aliasIndex.get(lower);
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
}