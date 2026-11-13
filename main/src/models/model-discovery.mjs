import { readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isWithin } from "../core/sandbox.mjs";

const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".venv", "temp", "tmp", "logs"]);
const MAX_DIRECTORIES = 4_000;
const MAX_MODELS = 256;
const MAX_DEPTH = 10;

export function automaticModelDirectories({ home, appData, localAppData, userData, appPath, resourcesPath } = {}) {
  const roots = [
    userData && join(userData, "models"),
    appPath && join(appPath, "models"),
    resourcesPath && join(resourcesPath, "models"),
    home && join(home, "models"),
    home && join(home, ".lmstudio", "models"),
    home && join(home, ".cache", "huggingface", "hub"),
    localAppData && join(localAppData, "nomic.ai", "GPT4All"),
    localAppData && join(localAppData, "Jan", "models"),
    appData && join(appData, "Jan", "models"),
  ].filter(Boolean).map((path) => resolve(path));
  return [...new Set(roots)];
}

/** Busca solamente GGUF bajo raíces conocidas, con límites de profundidad y cantidad. */
export async function discoverGgufFiles(roots) {
  const found = [];
  const seenFiles = new Set();
  let inspectedDirectories = 0;
  for (const configuredRoot of roots) {
    let root;
    try { root = await realpath(configuredRoot); } catch { continue; }
    const pending = [{ directory: root, depth: 0 }];
    while (pending.length && found.length < MAX_MODELS && inspectedDirectories < MAX_DIRECTORIES) {
      const { directory, depth } = pending.shift();
      inspectedDirectories += 1;
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const candidate = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH && !SKIP_DIRECTORIES.has(entry.name.toLocaleLowerCase("es"))) pending.push({ directory: candidate, depth: depth + 1 });
          continue;
        }
        if (!entry.name.toLocaleLowerCase("es").endsWith(".gguf")) continue;
        let canonical = candidate;
        try {
          if (entry.isSymbolicLink()) canonical = await realpath(candidate);
          if (!isWithin(root, canonical) || !(await stat(canonical)).isFile()) continue;
        } catch { continue; }
        const key = canonical.toLocaleLowerCase("en-US");
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
        found.push({ name: entry.name, path: candidate, canonicalPath: canonical, root });
        if (found.length >= MAX_MODELS) break;
      }
    }
  }
  return { files: found, truncated: found.length >= MAX_MODELS || inspectedDirectories >= MAX_DIRECTORIES };
}
