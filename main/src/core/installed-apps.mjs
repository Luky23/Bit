import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { BROWSER_APPS } from "./browser-actions.mjs";

const normalize = (value) => String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const inside = (root, path) => { const part = relative(root, path); return part !== "" && !part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part); };
const BLOCKED = /^(?:cmd|powershell|pwsh|bash|sh|wscript|cscript|mshta|rundll32|regsvr32|regedit|msiexec|python(?:w|\d*)?|node|npm|npx|winget|choco|pip|shutdown|taskkill|conhost|wt)\.exe$/iu;

/** Catálogo local acotado. Nunca ejecuta texto del modelo ni busca en todo el disco. */
export function createInstalledApps({ roots, targetRoots, blockedRoots = [], readShortcut, openPath, confirm, audit, now = Date.now }) {
  let cached;
  let refreshedAt = 0;
  async function catalog() {
    if (cached && now() - refreshedAt < 30000) return cached;
    const entries = [];
    let visited = 0;
    async function walk(dir, root, depth = 0) {
      if (depth > 8 || visited >= 2000) return;
      for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (++visited > 2000) break;
        const path = join(dir, item.name);
        if (item.isDirectory()) await walk(path, root, depth + 1);
        else if (item.isFile() && extname(item.name).toLowerCase() === ".lnk") entries.push({ name: basename(item.name, extname(item.name)), path, root });
      }
    }
    for (const root of roots.filter(Boolean)) await walk(root, root);
    cached = entries;
    refreshedAt = now();
    return entries;
  }
  async function find(query) {
    const key = normalize(query);
    if (!key || key.length > 160) return [];
    const entries = await catalog();
    const exact = entries.filter((entry) => normalize(entry.name) === key);
    return exact.length ? exact : entries.filter((entry) => (` ${normalize(entry.name)} `).includes(` ${key} `));
  }
  async function inspect(entry) {
    const root = await realpath(entry.root);
    const shortcut = await realpath(entry.path);
    if (!inside(root, shortcut)) throw new Error("Acceso directo fuera del menú Inicio");
    const details = readShortcut(shortcut);
    if (typeof details.target !== "string" || !isAbsolute(details.target) || extname(details.target).toLowerCase() !== ".exe") throw new Error("El acceso directo no apunta a una aplicación ejecutable local");
    const target = await realpath(details.target);
    const resolvedRoots = await Promise.all(targetRoots.filter(Boolean).map((path) => realpath(path).catch(() => null)));
    const forbidden = await Promise.all(blockedRoots.filter(Boolean).map((path) => realpath(path).catch(() => null)));
    if (!resolvedRoots.some((path) => path && inside(path, target)) || forbidden.some((path) => path && (path === target || inside(path, target))) || BLOCKED.test(basename(target))) throw new Error("Destino de aplicación no permitido");
    if (!(await stat(target)).isFile()) throw new Error("La aplicación ya no existe");
    return { shortcut, target, args: details.args || "", cwd: details.cwd || "" };
  }
  return Object.freeze({
    async browserTarget(browser) {
      if (!Object.hasOwn(BROWSER_APPS, browser)) throw new Error("Navegador no permitido");
      const matches = await find(BROWSER_APPS[browser]);
      if (!matches.length) return browser; // Fallback al nombre fijo en PATH; nunca a texto del modelo.
      const destinations = new Set();
      for (const entry of matches) {
        const details = await inspect(entry);
        if (basename(details.target).toLowerCase() !== browser) throw new Error("El acceso directo no apunta al navegador solicitado");
        destinations.add(details.target);
      }
      if (destinations.size !== 1) throw new Error("Hay varias instalaciones del navegador. Indique cuál desea usar.");
      return [...destinations][0];
    },
    async search(query) {
      const results = (await find(query)).slice(0, 20).map(({ name }) => ({ name }));
      await audit({ action: "system.searchApps", query, count: results.length, status: "completed" });
      return { results };
    },
    async open(name, { signal } = {}) {
      try {
        signal?.throwIfAborted();
        const matches = await find(name);
        if (matches.length !== 1) {
          const error = matches.length ? `Hay varias coincidencias: ${matches.slice(0, 5).map((entry) => entry.name).join(", ")}. Indique el nombre completo.` : "No encontré esa aplicación en el menú Inicio. Compruebe que esté instalada.";
          await audit({ action: "system.openInstalledApp", name, status: "rejected" });
          return { ok: false, error };
        }
        const entry = matches[0];
        const details = await inspect(entry);
        // Aplicaciones fuera de la lista conocida: aprobación nativa por esta apertura.
        if (!await confirm({ name: entry.name, ...details })) {
          await audit({ action: "system.openInstalledApp", name, status: "cancelled" });
          return { ok: false, cancelled: true };
        }
        const current = await inspect(entry);
        if (JSON.stringify(current) !== JSON.stringify(details)) throw new Error("El acceso directo cambió durante la confirmación");
        await audit({ action: "system.openInstalledApp", name, target: details.target, status: "started" });
        signal?.throwIfAborted();
        const error = await openPath(details.args ? details.shortcut : details.target);
        if (error) throw new Error(error);
        await audit({ action: "system.openInstalledApp", name, target: details.target, status: "completed" });
        return { ok: true, name: entry.name };
      } catch (error) {
        await audit({ action: "system.openInstalledApp", name, status: "failed" });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
