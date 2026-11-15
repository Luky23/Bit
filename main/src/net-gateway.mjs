import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isBrowserTarget, validateBrowserPage } from "./core/browser-actions.mjs";
import { datedAnswer, findDatedPassage } from "./core/dated-answer.mjs";

const SEARCH_ENDPOINT = "https://www.bing.com/search";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESULTS = 5;
const WEATHER_HOSTS = new Set(["geocoding-api.open-meteo.com", "api.open-meteo.com"]);
const OFFICIAL_DOMAIN_SUFFIXES = [
  ".gov", ".gob", ".gouv", ".govt", ".gc.ca", ".go.jp", ".go.kr", ".go.id",
  ".go.th", ".go.ug", ".go.ke", ".go.tz", ".go.gh", ".go.zw", ".go.za",
  ".go.in", ".gov.in", ".nic.in", ".gov.cn", ".gov.br", ".gov.ar", ".gob.ar",
  ".gov.cl", ".gob.cl", ".gov.co", ".gov.pe", ".gob.pe", ".gov.py", ".gov.uy",
  ".gub.uy", ".gov.ec", ".gob.ec", ".gov.uk", ".gov.fr", ".gov.it", ".gov.pt",
  ".gov.au", ".govt.nz", ".gov.sg", ".gov.my", ".gov.ph", ".gov.mx", ".gob.mx",
  ".gob.es", ".edu", ".ac.uk", ".edu.au", ".edu.ar", ".edu.br", ".int",
  ".europa.eu",
];
const OFFICIAL_ORGANIZATION_HOSTS = new Set([
  "un.org", "open-meteo.com", "vatican.va", "vaticannews.va", "fifa.com",
  "rockstargames.com", "take2games.com", "playstation.com", "xbox.com",
  "nintendo.com", "mozilla.org", "apple.com", "samsung.com", "microsoft.com",
]);
const DOWNLOAD_HOSTS = new Set([
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "cas-bridge.xethub.hf.co",
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
]);

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü" };
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => named[entity] ?? match);
}

function xmlField(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!match) return "";
  const value = match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function isOfficialSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    return OFFICIAL_ORGANIZATION_HOSTS.has(hostname)
      || [...OFFICIAL_ORGANIZATION_HOSTS].some((domain) => hostname.endsWith(`.${domain}`))
      || /\.(?:gov|gob)\.[a-z]{2}$/u.test(hostname)
      || OFFICIAL_DOMAIN_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/** Un enlace de búsqueda no certifica autoridad ni autoriza leer su destino. */
export function isPublicSearchSourceUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    // Solo nombres DNS públicos; ninguna IP, dominio de red local o de pruebas.
    if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(host)) return false;
    return !/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/u.test(host)
      && !/(?:^|\.)example\.(?:com|net|org)$/u.test(host);
  } catch {
    return false;
  }
}

function weatherDescription(code) {
  const descriptions = new Map([
    [0, "despejado"], [1, "mayormente despejado"], [2, "parcialmente nublado"], [3, "nublado"],
    [45, "niebla"], [48, "niebla con escarcha"],
    [51, "llovizna ligera"], [53, "llovizna moderada"], [55, "llovizna intensa"],
    [56, "llovizna helada ligera"], [57, "llovizna helada intensa"],
    [61, "lluvia ligera"], [63, "lluvia moderada"], [65, "lluvia intensa"],
    [66, "lluvia helada ligera"], [67, "lluvia helada intensa"],
    [71, "nieve ligera"], [73, "nieve moderada"], [75, "nieve intensa"], [77, "granizo menudo"],
    [80, "chubascos ligeros"], [81, "chubascos moderados"], [82, "chubascos intensos"],
    [85, "chubascos de nieve ligeros"], [86, "chubascos de nieve intensos"],
    [95, "tormenta"], [96, "tormenta con granizo leve"], [99, "tormenta con granizo intenso"],
  ]);
  return descriptions.get(code) ?? "condición no disponible";
}

function formatWeatherValue(value, unit) {
  return Number.isFinite(value)
    ? `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)} ${unit}`
    : null;
}

async function fetchWeatherJson(fetchImpl, url, signal) {
  if (url.protocol !== "https:" || !WEATHER_HOSTS.has(url.hostname)) {
    throw new Error("Host meteorológico no permitido por net-gateway");
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`El servicio meteorológico respondió HTTP ${response.status}`);
  return JSON.parse(await readBoundedBody(response));
}

async function searchCurrentWeather(fetchImpl, location, signal) {
  const geocodingUrl = new URL(GEOCODING_ENDPOINT);
  geocodingUrl.searchParams.set("name", location);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "es");
  geocodingUrl.searchParams.set("format", "json");
  const geocoding = await fetchWeatherJson(fetchImpl, geocodingUrl, signal);
  const place = geocoding?.results?.[0];
  if (!place || typeof place.name !== "string"
    || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
    || place.latitude < -90 || place.latitude > 90
    || place.longitude < -180 || place.longitude > 180) {
    return [];
  }

  const forecastUrl = new URL(FORECAST_ENDPOINT);
  forecastUrl.searchParams.set("latitude", String(place.latitude));
  forecastUrl.searchParams.set("longitude", String(place.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "1");
  const forecast = await fetchWeatherJson(fetchImpl, forecastUrl, signal);
  const current = forecast?.current;
  const daily = forecast?.daily;
  if (!current || !daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    throw new Error("El servicio meteorológico devolvió datos incompletos");
  }

  const placeName = [place.name, place.admin1, place.country].filter((part, index, parts) => (
    typeof part === "string" && part && parts.indexOf(part) === index
  )).join(", ");
  const currentTemperature = formatWeatherValue(current.temperature_2m, "°C");
  const feelsLike = formatWeatherValue(current.apparent_temperature, "°C");
  const wind = formatWeatherValue(current.wind_speed_10m, "km/h");
  const precipitation = formatWeatherValue(current.precipitation, "mm");
  const minimum = formatWeatherValue(daily.temperature_2m_min?.[0], "°C");
  const maximum = formatWeatherValue(daily.temperature_2m_max?.[0], "°C");
  const probability = formatWeatherValue(daily.precipitation_probability_max?.[0], "%");
  if (!currentTemperature) throw new Error("El servicio meteorológico no informó la temperatura actual");

  const details = [
    `Ahora: ${weatherDescription(current.weather_code)}, ${currentTemperature}`,
    feelsLike ? `sensación ${feelsLike}` : null,
    Number.isFinite(current.relative_humidity_2m) ? `humedad ${current.relative_humidity_2m}%` : null,
    wind ? `viento ${wind}` : null,
    precipitation ? `precipitación ${precipitation}` : null,
    `Hoy: ${weatherDescription(daily.weather_code?.[0])}`,
    minimum && maximum ? `mínima ${minimum}, máxima ${maximum}` : null,
    probability ? `probabilidad de precipitación ${probability}` : null,
    typeof current.time === "string" ? `actualizado ${current.time}${forecast.timezone ? ` (${forecast.timezone})` : ""}` : null,
  ].filter(Boolean).join("; ");

  return [{
    title: `Clima actual en ${placeName}`,
    url: forecastUrl.href,
    snippet: details,
  }];
}

export function parseSearchResults(xml) {
  const results = [];
  const seenUrls = new Set();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = xmlField(item, "title");
    const url = xmlField(item, "link");
    const snippet = xmlField(item, "description");
    const publishedAtValue = xmlField(item, "pubDate");
    if (!title || !isPublicSearchSourceUrl(url)) continue;
    const canonicalUrl = new URL(url).href;
    if (seenUrls.has(canonicalUrl)) continue;
    seenUrls.add(canonicalUrl);
    const result = { title: title.slice(0, 300), url: canonicalUrl, snippet: snippet.slice(0, 600) };
    const publishedAt = Date.parse(publishedAtValue);
    if (publishedAtValue && Number.isFinite(publishedAt)) result.publishedAt = new Date(publishedAt).toISOString();
    results.push(result);
    if (results.length >= MAX_RESULTS) break;
  }
  return results.sort((a, b) => Number(isOfficialSourceUrl(b.url)) - Number(isOfficialSourceUrl(a.url)));
}

export function isCurrencySearchRequest(message) {
  const text = normalizeWeatherInput(message);
  const currency = /\b(?:dolares?|dolar|usd|euros?|eur|bitcoin|btc|peso(?:s)? argentino(?:s)?|ars|real(?:es)? brasileno(?:s)?|libra(?:s)? esterlina(?:s)?)\b/u.test(text);
  return currency && (/\b(?:cuanto|cotiza|cotizacion|cambio|precio|valor|hoy|ahora)\b/u.test(text)
    || /\b(?:usd|eur|btc)\s+(?:a|en)\s+(?:ars|usd|eur)\b/u.test(text));
}

export function isWebSearchRequest(message) {
  const input = String(message ?? "");
  const explicitSearch = /(?:\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]).{0,60}\b(?:internet|web|google|online|red)\b|\b(?:internet|web)\b.{0,60}\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]))/iu.test(input);
  const currentTopic = /\b(?:noticias|actualidad|cotizaci[oó]n|precio actual)\b/iu.test(input);
  const currentQualifier = /\b(?:hoy|actual|ahora|[uú]ltim[oa]s?|reciente)\b.{0,50}\b(?:noticias|precio|cotizaci[oó]n|temperatura|resultado|informaci[oó]n)\b/iu.test(input);
  const asksCurrentTopic = /\b(?:qu[eé]|c[oó]mo|cu[aá]l|cu[aá]nto|qui[eé]n|d[oó]nde)\b/iu.test(input);
  const upcomingEvent = /\bcuando\b.{0,70}\b(?:viene|vendra|llega|llegara|visitara|se\s+(?:celebra|juega|realiza))\b/u.test(normalizeWeatherInput(input));
  const normalized = normalizeWeatherInput(input);
  // Los pedidos privados no se convierten en consultas públicas por mencionar
  // precios o versiones. Una búsqueda web explícita conserva su propia ruta.
  const privateContext = /\b(?:mis? (?:notas?|archivos?|documentos?|proyectos?|calendarios?|carpetas?|correos?|(?:nuev[oa]s? )?(?:computadoras?|equipos?|telefonos?))|boveda|obsidian|archivo local|pantalla)\b/u.test(normalized);
  if (privateContext && !explicitSearch) return false;
  const publicSearch = /\b(?:busca(?:me|r)?|investiga(?:r)?|averigua(?:r)?)\s+(?:informacion|datos|noticias|sobre|quien|que|cuando|cuanto|como)\b/u.test(normalized);
  const novelty = /\b(?:nuev[oa]s?|ultim[oa]s?|recientes?|recientemente|actual(?:es|mente)?|novedades|mas reciente)\b/u.test(normalized);
  const informational = /\b(?:que|cual(?:es)?|quien|cuando|donde|cuanto|contame|cuentame|hablame|informacion|novedades)\b/u.test(normalized);
  const creativeOrConceptual = /\b(?:crea|crear|escrib[aei]|escribir|redacta|inventa|imagina|aprend(?:o|er)|idioma|nueva espana|nuevo testamento|nuevo mundo)\b/u.test(normalized);
  const asksNovelty = novelty && informational && !creativeOrConceptual;
  const releaseQuestion = /\b(?:cuando (?:sale|saldra|se estrena|se lanza|estara disponible)|fecha de (?:lanzamiento|estreno)|ya (?:salio|se estreno|esta disponible))\b/u.test(normalized);
  const changingQuestion = /\b(?:cuanto (?:cuesta|vale|sale)|cual es (?:la|el) (?:ultima|ultimo|nueva|nuevo) (?:version|modelo)|quien gano .{0,60}(?:ayer|hoy|anoche)|sigue disponible|que se sabe (?:actualmente|hoy|ahora))\b/u.test(normalized)
    && !/\b(?:calcular|algoritmo|complejidad)\b/u.test(normalized);
  const eventTopic = /\b(?:mundial|copa|olimpiadas|juegos olimpicos|elecciones|torneo|concierto|partido|festival)\b/u.test(normalized);
  const eventQuestion = eventTopic && /\b(?:proxim[oa]s?|siguiente|cuando es|cuando sera|donde sera)\b/u.test(normalized);
  const currentOffice = /\bquien\s+es\b/u.test(normalized) && /\b(?:presidente|papa|primer ministro|gobernador|alcalde|rey|reina)\b/u.test(normalized);
  return explicitSearch || publicSearch || isCurrencySearchRequest(input) || asksNovelty || releaseQuestion || changingQuestion || isWeatherSearchRequest(input) || currentQualifier || upcomingEvent || eventQuestion || currentOffice || (currentTopic && asksCurrentTopic);
}

/**
 * Normaliza el texto para detectar intención meteorológica sin depender de acentos
 * (NFD + quitar diacríticos + lowercase), porque las fronteras de palabra y las clases
 * de caracteres de los regex son ASCII y fallan con letras tildadas.
 */
function normalizeWeatherInput(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const WEATHER_TOPIC_PATTERN = /\b(?:clima|pronostico|pronostica|temperatura|temperaturas|meteorologia|meteorologico|meteorologica|weather)\b/i;
const WEATHER_TIME_PATTERN = /\btiempo\b/i;
const WEATHER_CONTEXT_PATTERN = /\b(?:hace|hoy|ahora|actual|actualmente|estan|sera|haya|hara|habra|va|van|saldra|saldran|prevision|pronostico|forecast|llovia|lluvi|neblina|nublado|nublada|soleado|despejado|despejada|parcial|helada|tormenta|chubasco|helado|niebla|inundacion|lluvia|lluviosa|meteorologico|meteorologica|lluvioso)\b/i;
const WEATHER_QUESTION_PATTERN = /\b(?:que|quien|como|cual|donde|what|which|who|how|where|what|which|who|how)\b/i;

export function isWeatherSearchRequest(message) {
  const normalized = normalizeWeatherInput(message);
  const isWeatherTopic = WEATHER_TOPIC_PATTERN.test(normalized) || (WEATHER_TIME_PATTERN.test(normalized) && (WEATHER_CONTEXT_PATTERN.test(normalized) || WEATHER_QUESTION_PATTERN.test(normalized)));
  return isWeatherTopic;
}

export function isWeatherLocationFollowUp(message) {
  return /^(?:¿?\s*)?(?:(?:y|también)\s+)?(?:en|para)\s+[\p{L}\p{M}][\p{L}\p{M}\s,.'-]{1,100}[?.!]*$/iu.test(String(message ?? "").trim());
}

export function resolveWeatherSearchQuery(message, history = []) {
  if (isWeatherSearchRequest(message)) return buildWebSearchQuery(message);
  if (!isWeatherLocationFollowUp(message)) return null;

  const previousUserMessage = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((entry) => entry?.role === "user" && typeof entry.content === "string");
  if (!previousUserMessage || !isWeatherSearchRequest(previousUserMessage.content)) return null;

  const match = String(message).trim().match(/^(?:¿?\s*)?(?:(?:y|también)\s+)?(?:en|para)\s+(.+?)[?.!]*$/iu);
  const location = match?.[1]?.trim();
  if (!location) return null;
  const normalizedLocation = /^brazil$/iu.test(location) ? "Brasília, Brasil" : location;
  return buildWebSearchQuery(`clima actual en ${normalizedLocation}`);
}

export function isDownloadUrlAllowed(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DOWNLOAD_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function buildWebSearchQuery(message) {
  const input = String(message ?? "").trim().replace(/\s+/g, " ");
  const normalized = normalizeWeatherInput(input);
  if (isCurrencySearchRequest(input) && /\b(?:dolar|dolares|usd)\b/u.test(normalized)
    && /\b(?:pesos? argentinos?|argentina|ars)\b/u.test(normalized)) {
    const market = normalized.match(/\b(?:blue|oficial|mep|tarjeta|ccl)\b/u)?.[0];
    return `dólar ${market ? market + ' ' : ''}peso argentino cotización hoy compra venta${market ? '' : ' oficial blue MEP'}`;
  }
  if (isWeatherSearchRequest(input)) {
    const locationMatch = input.match(/\b(?:en|de|para|cerca de)\s+(.+?)(?=\s+\b(?:hoy|ahora|actual|actualmente|mañana)\b|[?.!]|$)/i);
    const location = locationMatch?.[1]?.trim().replace(/,+$/u, "");
    return `clima actual en ${location || "Buenos Aires, Argentina"}`;
  }
  const visitQuestion = input.match(/^¿?\s*cu[aá]ndo\s+(?:viene|vendr[aá]|llega|llegar[aá]|visitar[aá])\s+(.+?)[?!.]*$/iu);
  if (visitQuestion) {
    const terms = visitQuestion[1]
      .replace(/^(?:el|la|los|las)\s+/iu, "")
      .replace(/\s+(?:a|en)\s+/iu, " ")
      .trim();
    if (terms) return `${terms} visita fecha`.slice(0, 300);
  }
  if (/\bmundial\b/u.test(normalizeWeatherInput(input)) && /\b(?:proxim[oa]|siguiente|cuando es|cuando sera|donde sera)\b/u.test(normalizeWeatherInput(input))) {
    const topic = input.replace(/^¿?\s*(?:(?:cu[aá]ndo|d[oó]nde|cu[aá]l)\s+(?:es|ser[aá])\s+)?(?:el|la)?\s*(?:pr[oó]xim[oa]|siguiente)?\s*/iu, '').replace(/[?!.]+$/u, '').trim();
    return `${topic} próxima edición calendario oficial site:fifa.com`.slice(0, 300);
  }
  const query = input
    .replace(/^(?:por favor[,]?\s*)?(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)\s+(?:en\s+)?(?:internet|la\s+web|web|google)\s*(?:sobre|acerca de|por)?\s*/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  return (query || input).slice(0, 300);
}

function extractWeatherLocation(query) {
  const match = query.match(/^(?:clima|pron[oó]stico|temperatura actual)(?: actual)? en (.{2,120})$/iu);
  return match?.[1]?.trim() || null;
}

async function readBoundedBody(response) {
  if (!response.body?.getReader) throw new Error("La búsqueda devolvió una respuesta sin contenido");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("La respuesta de búsqueda supera el límite de tamaño");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function createNetGateway({ auditPath, fetchImpl = globalThis.fetch, openExternal, onActivity = () => {}, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("El gateway necesita fetch");
  if (typeof auditPath !== "string" || !auditPath) throw new Error("El gateway necesita una ruta local para audit.log");

  return Object.freeze({
    async openBrowserPage(value, { browser = "default-browser", signal } = {}) {
      const url = validateBrowserPage(value);
      if (!isBrowserTarget(browser)) throw new Error("Navegador no permitido");
      if (typeof openExternal !== "function") throw new Error("Apertura del navegador no disponible");
      signal?.throwIfAborted();
      await mkdir(dirname(auditPath), { recursive: true });
      const record = async (status) => appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.openBrowserPage", host: new URL(url).hostname, browser, status })}\n`, "utf8");
      await record("started");
      onActivity({ active: true, service: "web.openBrowserPage" });
      try {
        signal?.throwIfAborted();
        await openExternal(url, { browser, signal });
        await record("completed");
        return { ok: true };
      } catch (error) {
        await record("failed");
        throw error;
      } finally {
        onActivity({ active: false, service: "web.openBrowserPage" });
      }
    },
    async openYouTube(value) {
      const url = new URL(value);
      if (url.origin !== "https://www.youtube.com" || url.username || url.password || url.hash ||
          !["/", "/results"].includes(url.pathname) ||
          [...url.searchParams.keys()].some((key) => key !== "search_query") ||
          url.searchParams.getAll("search_query").length > 1 ||
          (url.searchParams.get("search_query") || "").length > 160) throw new Error("Apertura de YouTube no válida");
      if (typeof openExternal !== "function") throw new Error("Apertura del navegador no disponible");
      await mkdir(dirname(auditPath), { recursive: true });
      const record = async (status) => appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.openYouTube", host: url.hostname, status })}\n`, "utf8");
      await record("started");
      onActivity({ active: true, service: "web.openYouTube" });
      try {
        await openExternal(url.href);
        await record("completed");
        return { ok: true };
      } catch (error) {
        await record("failed");
        throw error;
      } finally {
        onActivity({ active: false, service: "web.openYouTube" });
      }
    },
    async searchWeb(query) {
      const cleanQuery = typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";
      if (!cleanQuery || cleanQuery.length > 300 || /[\u0000-\u001f\u007f]/.test(cleanQuery)) {
        throw new Error("La consulta web debe tener entre 1 y 300 caracteres válidos");
      }

      const weatherLocation = extractWeatherLocation(cleanQuery);
      const url = weatherLocation ? null : new URL(SEARCH_ENDPOINT);
      if (url) {
        url.searchParams.set("format", "rss");
        url.searchParams.set("setlang", "es-AR");
        url.searchParams.set("q", cleanQuery);
      }
      const hosts = weatherLocation
        ? [...WEATHER_HOSTS].join(",")
        : url.hostname;

      await mkdir(dirname(auditPath), { recursive: true });
      await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.search", host: hosts, query: cleanQuery, status: "started" })}\n`, "utf8");
      onActivity({ active: true, service: "web.search" });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        let results;
        if (weatherLocation) {
          results = await searchCurrentWeather(fetchImpl, weatherLocation, controller.signal);
        } else {
          const search = async (searchUrl) => {
            const response = await fetchImpl(searchUrl, {
              method: "GET",
              headers: { accept: "application/rss+xml, application/xml;q=0.9", "accept-language": "es-AR,es;q=0.9" },
              redirect: "error",
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`El buscador respondió HTTP ${response.status}`);
            return parseSearchResults(await readBoundedBody(response));
          };
          results = await search(url);
          const dateQuery = / visita fecha$/u.test(cleanQuery);
          if ((results.length === 0 || (dateQuery && !datedAnswer(results, cleanQuery))) && /\b(?:papa|pontifice|vaticano|santa sede)\b/u.test(normalizeWeatherInput(cleanQuery))) {
            const retryUrl = new URL(url);
            const retryQuery = `${cleanQuery.replace(/ visita fecha$/u, "")} site:vaticannews.va`;
            retryUrl.searchParams.set("q", retryQuery);
            await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.search", host: url.hostname, query: retryQuery, status: "retry" })}\n`, "utf8");
            const retryResults = await search(retryUrl);
            results = [...retryResults, ...results].filter((item, index, all) => all.findIndex(other => other.url === item.url) === index).slice(0, MAX_RESULTS);
          }
          if (dateQuery && !datedAnswer(results, cleanQuery)) {
            // Dos lecturas en paralelo, dentro del mismo límite de tiempo y tamaño.
            const candidates = results.filter(item => isOfficialSourceUrl(item.url) && /\/news\/|\/bollettino\//u.test(new URL(item.url).pathname)).slice(0, 2);
            await Promise.all(candidates.map(async item => {
              try {
                await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.read", url: item.url, status: "started" })}\n`, "utf8");
                const page = await fetchImpl(new URL(item.url), { redirect: "error", signal: controller.signal, cache: "no-store", headers: { accept: "text/html" } });
                if (!page.ok) throw new Error(`HTTP ${page.status}`);
                const html = await readBoundedBody(page);
                const text = decodeEntities(html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/giu, " ").replace(/<\/(?:p|div|h[1-6]|li)>/giu, "\n").replace(/<[^>]*>/gu, " "));
                const passage = findDatedPassage(text, cleanQuery);
                if (passage) item.snippet = passage;
                await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.read", url: item.url, status: "completed", dateFound: Boolean(passage) })}\n`, "utf8");
              } catch (error) {
                await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.read", url: item.url, status: "failed", error: error.message })}\n`, "utf8");
              }
            }));
          }
        }
        await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.search", host: hosts, status: "completed", resultCount: results.length })}\n`, "utf8");
        return results;
      } catch (error) {
        const message = controller.signal.aborted
          ? "La búsqueda web superó el límite de 12 segundos"
          : error instanceof Error ? error.message : String(error);
        await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "web.search", host: hosts, status: "failed", error: message })}\n`, "utf8");
        throw new Error(message, { cause: error });
      } finally {
        clearTimeout(timeout);
        onActivity({ active: false, service: "web.search" });
      }
    },
    async fetchDownload(value, options = {}) {
      let url = new URL(value);
      if (!isDownloadUrlAllowed(url.href)) throw new Error("Dominio de descarga no permitido por el gateway");

      await mkdir(dirname(auditPath), { recursive: true });
      await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "asset.download", host: url.hostname, status: "started" })}\n`, "utf8");
      onActivity({ active: true, service: "asset.download" });
      try {
        let response;
        for (let redirects = 0; redirects <= 5; redirects++) {
          response = await fetchImpl(url, {
            method: "GET",
            headers: options.headers,
            redirect: "manual",
            cache: "no-store",
            signal: options.signal,
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers?.get?.("location");
          if (!location || redirects === 5) throw new Error("Redirección de descarga inválida o demasiado larga");
          url = new URL(location, url);
          if (!isDownloadUrlAllowed(url.href)) throw new Error("La redirección apunta a un dominio no permitido");
        }
        await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "asset.download", host: url.hostname, status: "response" })}\n`, "utf8");
        return response;
      } catch (error) {
        await appendFile(auditPath, `${JSON.stringify({ at: now().toISOString(), action: "asset.download", host: url.hostname, status: "failed", error: error instanceof Error ? error.message : String(error) })}\n`, "utf8");
        throw error;
      } finally {
        onActivity({ active: false, service: "asset.download" });
      }
    },
  });
}
