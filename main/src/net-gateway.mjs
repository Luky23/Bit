import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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
const OFFICIAL_ORGANIZATION_HOSTS = new Set(["un.org", "open-meteo.com"]);
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
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => named[entity.toLowerCase()] ?? match);
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
    if (!title || !isOfficialSourceUrl(url)) continue;
    const canonicalUrl = new URL(url).href;
    if (seenUrls.has(canonicalUrl)) continue;
    seenUrls.add(canonicalUrl);
    results.push({ title: title.slice(0, 300), url: canonicalUrl, snippet: snippet.slice(0, 600) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

export function isWebSearchRequest(message) {
  const input = String(message ?? "");
  const explicitSearch = /(?:\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]).{0,60}\b(?:internet|web|google|online|red)\b|\b(?:internet|web)\b.{0,60}\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]))/iu.test(input);
  const currentTopic = /\b(?:noticias|actualidad|cotizaci[oó]n|precio actual)\b/iu.test(input);
  const currentQualifier = /\b(?:hoy|actual|ahora|[uú]ltim[oa]s?|reciente)\b.{0,50}\b(?:noticias|precio|cotizaci[oó]n|temperatura|resultado|informaci[oó]n)\b/iu.test(input);
  const asksCurrentTopic = /\b(?:qu[eé]|c[oó]mo|cu[aá]l|cu[aá]nto|qui[eé]n|d[oó]nde)\b/iu.test(input);
  return explicitSearch || isWeatherSearchRequest(input) || currentQualifier || (currentTopic && asksCurrentTopic);
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
  if (isWeatherSearchRequest(input)) {
    const locationMatch = input.match(/\b(?:en|de|para|cerca de)\s+(.+?)(?=\s+\b(?:hoy|ahora|actual|actualmente|mañana)\b|[?.!]|$)/i);
    const location = locationMatch?.[1]?.trim().replace(/,+$/u, "");
    return `clima actual en ${location || "Buenos Aires, Argentina"}`;
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

export function createNetGateway({ auditPath, fetchImpl = globalThis.fetch, onActivity = () => {}, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("El gateway necesita fetch");
  if (typeof auditPath !== "string" || !auditPath) throw new Error("El gateway necesita una ruta local para audit.log");

  return Object.freeze({
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
          const response = await fetchImpl(url, {
            method: "GET",
            headers: { accept: "application/rss+xml, application/xml;q=0.9", "accept-language": "es-AR,es;q=0.9" },
            redirect: "error",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`El buscador respondió HTTP ${response.status}`);
          results = parseSearchResults(await readBoundedBody(response));
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
