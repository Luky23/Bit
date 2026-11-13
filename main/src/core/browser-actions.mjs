export const BROWSER_APPS = Object.freeze({ "chrome.exe": "chrome", "msedge.exe": "microsoft edge", "firefox.exe": "firefox", "brave.exe": "brave" });
export const isBrowserTarget = (target) => target === "default-browser" || Object.hasOwn(BROWSER_APPS, target);

/** Solo destinos de lectura construidos para búsqueda o páginas de inicio conocidas. */
export function validateBrowserPage(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Dirección de navegador no permitida");
  const hosts = { "https://www.google.com": ["/", "/search", "q"], "https://www.bing.com": ["/", "/search", "q"], "https://www.youtube.com": ["/", "/results", "search_query"] };
  const rule = hosts[url.origin];
  if (!rule || !rule.slice(0, 2).includes(url.pathname) || [...url.searchParams.keys()].some((key) => key !== rule[2]) || url.searchParams.getAll(rule[2]).length > 1) throw new Error("Dirección de navegador no permitida");
  const query = url.searchParams.get(rule[2]) || "";
  if (query.length > 300 || /[\u0000-\u001f\u007f]/u.test(query)) throw new Error("Consulta de navegador no válida");
  return url.href;
}

export function resolveBrowserSearchRequest(message) {
  const input = String(message ?? "").trim().replace(/^[¿¡\s]+|[?!.]+$/gu, "").trim();
  const prefix = "(?:(?:por favor,?|pod[eé]s|puedes|podr[ií]as|podr[ií]a|me pod[eé]s|me puedes)\\s+)*";
  const browser = "(google chrome|microsoft edge|chrome|edge|firefox|brave|(?:el )?navegador|google)";
  const search = "(?:busca|buscá|buscar|busque|buscame|búscame)";
  let match = input.match(new RegExp(`^${prefix}(?:abr[ií]|abre|abrir|abrime|inicia|iniciar)\\s+${browser}\\s+y\\s+${search}\\s+(.+)$`, "iu"));
  let name, query;
  if (match) [, name, query] = match;
  else {
    match = input.match(new RegExp(`^${prefix}${search}\\s+en\\s+${browser}\\s+(.+)$`, "iu"));
    if (match) [, name, query] = match;
    else {
      match = input.match(new RegExp(`^${prefix}${search}\\s+(.+?)\\s+en\\s+${browser}$`, "iu"));
      if (!match) return null;
      [, query, name] = match;
    }
  }
  query = query.trim();
  if (!query || query.length > 300 || /[\u0000-\u001f\u007f]/u.test(query)) return null;
  const names = { chrome: "chrome.exe", "google chrome": "chrome.exe", edge: "msedge.exe", "microsoft edge": "msedge.exe", firefox: "firefox.exe", brave: "brave.exe" };
  const target = names[name.toLowerCase()] || "default-browser";
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return { target, args: url.href, label: `la búsqueda de ${query} en ${name.toLowerCase()}` };
}

/** El proceso main calcula explicitRequest; nunca se acepta como argumento de una herramienta. */
export async function executeBrowserAction({ target, args = "", explicitRequest, externalContent = false, signal }, { confirm, openPage, openApplication, audit }) {
  try {
    signal?.throwIfAborted();
    if (externalContent) throw new Error("El contenido externo no autoriza aperturas del navegador");
    const browser = isBrowserTarget(target) ? target : "default-browser";
    const page = isBrowserTarget(target) ? args : target;
    if (!isBrowserTarget(target) && !target.startsWith("https://")) throw new Error("Navegador no permitido");
    if (!isBrowserTarget(target) && args) throw new Error("Una página no admite argumentos adicionales");
    if (page) validateBrowserPage(page);
    else if (browser === "default-browser") throw new Error("Falta la dirección de la página");
    const explicit = explicitRequest?.target === target && (explicitRequest.args || "") === args;
    if (!explicit) {
      await audit({ action: "browser.open", target, status: "awaiting-authorization" });
      if (!await confirm({ target, args })) {
        await audit({ action: "browser.open", target, status: "cancelled" });
        return { ok: false, cancelled: true };
      }
    }
    signal?.throwIfAborted();
    await audit({ action: "browser.open", target, explicit, status: "started" });
    const result = page ? await openPage(page, { browser, signal }) : await openApplication(browser, { signal });
    await audit({ action: "browser.open", target, status: result?.ok ? "completed" : "failed" });
    return result;
  } catch (error) {
    await audit({ action: "browser.open", target, status: "failed" });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
