import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, parse, resolve } from "node:path";

const SKIP_APP_RE = /(?:uninstall|desinstalar|remove|repair|update|updater|setup|install)/iu;
const MAX_APPS = 500;

function startMenuRoots(env = process.env) {
  return [
    env.PROGRAMDATA && join(env.PROGRAMDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
    env.APPDATA && join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
  ].filter(Boolean).map((path) => resolve(path));
}

async function walkShortcuts(root, output) {
  const pending = [root];
  while (pending.length && output.length < MAX_APPS) {
    const directory = pending.shift();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".lnk" && !SKIP_APP_RE.test(entry.name)) {
        output.push({ name: basename(entry.name, ".lnk"), shortcutPath: path, source: "start-menu" });
      }
      if (output.length >= MAX_APPS) break;
    }
  }
}

/** Descubre aplicaciones desde los accesos administrados por Windows, sin Registro ni comandos. */
export async function listInstalledApps({ query = "", env = process.env } = {}) {
  const apps = [];
  await Promise.all(startMenuRoots(env).map((root) => walkShortcuts(root, apps)));
  const normalized = String(query).trim().toLocaleLowerCase("es");
  const unique = new Map();
  for (const app of apps) {
    const key = app.name.toLocaleLowerCase("es");
    if ((!normalized || key.includes(normalized)) && !unique.has(key)) unique.set(key, app);
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, "es")).slice(0, 50);
}

export async function resolveInstalledApp(name, options = {}) {
  if (typeof name !== "string" || !name.trim() || name.length > 160) throw new Error("Indique el nombre de la aplicación");
  const apps = await listInstalledApps({ ...options, query: name });
  const wanted = name.trim().toLocaleLowerCase("es");
  return apps.find((app) => app.name.toLocaleLowerCase("es") === wanted) ?? (apps.length === 1 ? apps[0] : null);
}

/**
 * Enumera volúmenes montados que Node puede leer. Un teléfono MTP sin letra de
 * unidad no forma parte del sistema de archivos y se reporta como limitación.
 */
export async function listMountedStorage({ platform = process.platform } = {}) {
  if (platform !== "win32") return [];
  const candidates = Array.from({ length: 23 }, (_, index) => `${String.fromCharCode(68 + index)}:\\`);
  const results = await Promise.all(candidates.map(async (root) => {
    try {
      const info = await stat(root);
      if (!info.isDirectory()) return null;
      await readdir(root);
      return { id: `drive-${parse(root).root[0].toUpperCase()}`, name: `Unidad ${parse(root).root[0].toUpperCase()}:`, root };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

export async function resolveMountedStorage(deviceId, options = {}) {
  if (!/^drive-[D-Z]$/u.test(String(deviceId))) return null;
  return (await listMountedStorage(options)).find((device) => device.id === deviceId) ?? null;
}
