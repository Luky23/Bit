import { AdaptivePerformanceManager } from "./adaptive-performance.mjs";

export const MAX_TASK_ATTEMPTS = 3;
export const MUSIC_SELECTION_MODES = Object.freeze(["popular", "recent", "random"]);

const fallbackPerformanceManager = new AdaptivePerformanceManager();
const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("es-AR")
  .replace(/\s+/gu, " ")
  .trim();

function boundedText(value, maxLength = 160) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return text.length > 0 && text.length <= maxLength ? text : "";
}

function musicPreferences(config) {
  const artists = boundedText(config.frequentArtists, 300).split(/[,;]+/u).map(value => value.trim()).filter(Boolean);
  const genres = boundedText(config.preferredGenres, 300).split(/[,;]+/u).map(value => value.trim()).filter(Boolean);
  return {
    platform: ["spotify", "youtube"].includes(config.musicPlatform) ? config.musicPlatform : "youtube",
    browser: ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "default-browser"].includes(config.browserPreference)
      ? config.browserPreference
      : "default-browser",
    artist: artists[0] || "",
    genre: genres[0] || "",
    selectionMode: MUSIC_SELECTION_MODES.includes(config.musicSelectionMode) ? config.musicSelectionMode : "popular",
  };
}

export function resolveMusicIntent(message, config = {}) {
  const raw = String(message ?? "").trim().replace(/^[¿¡\s]+|[?!.]+\s*$/gu, "").trim();
  const text = normalize(raw);
  if (!text || text.length > 8000) return null;

  const platformMatch = text.match(/\b(?:en|por)\s+(spotify|youtube|youtube music)\s*$/u);
  const platformExplicit = Boolean(platformMatch);
  const requestedPlatform = platformMatch?.[1].startsWith("spotify") ? "spotify" : platformMatch ? "youtube" : "";
  const preferences = musicPreferences(config);
  const activeMusic = config.activeMusic && typeof config.activeMusic === "object"
    ? {
      artist: boundedText(config.activeMusic.artist),
      track: boundedText(config.activeMusic.track),
    }
    : { artist: "", track: "" };
  const selectionMode = /\b(?:lo ultimo|algo mas nuevo|mas nuevo|lo mas reciente|lo reciente)\b/u.test(text)
    ? "recent"
    : /\b(?:cualquiera|al azar|aleatorio|aleatoria)\b/u.test(text)
      ? "random"
      : preferences.selectionMode;

  if (/\b(?:pausa|pausa la musica|pausa musica|pausar|pausame|detene la musica|detener la musica|para la musica|stop music)\b/u.test(text)) {
    return { type: "control", action: "pause", platform: requestedPlatform || preferences.platform, platformExplicit };
  }
  if (/\b(?:reanuda|reanudar|segui con la musica|segui reproduciendo|continua la musica|continuar|reproduce|play music)\b/u.test(text)) {
    return { type: "control", action: "play", platform: requestedPlatform || preferences.platform, platformExplicit };
  }
  const asksForNext = /^(?:(?:bit)[,:\s]+)?(?:(?:por favor)\s+)?(?:pon(?:e|eme)?\s+)?(?:otra cancion|siguiente|pasa la siguiente|siguiente cancion|siguiente tema|next song)$/u.test(text);
  if (asksForNext) {
    if (!activeMusic.artist) return { type: "control", action: "next", platform: requestedPlatform || preferences.platform, platformExplicit };
    return {
      type: "play",
      platform: requestedPlatform || preferences.platform,
      platformExplicit,
      artist: activeMusic.artist,
      track: "",
      album: "",
      genre: "",
      playlist: "",
      excludeTrack: activeMusic.track,
      selectionMode,
      query: activeMusic.artist,
    };
  }
  if (/\b(?:cancion anterior|tema anterior|previous song)\b/u.test(text)) {
    return { type: "control", action: "previous", platform: requestedPlatform || preferences.platform, platformExplicit };
  }
  if (/\b(?:subi|subir|aumenta|aumentar) (?:el )?volumen\b/u.test(text)) {
    return { type: "control", action: "volume-up", platform: requestedPlatform || preferences.platform, platformExplicit };
  }
  if (/\b(?:baja|bajar|reduce|reducir) (?:el )?volumen\b/u.test(text)) {
    return { type: "control", action: "volume-down", platform: requestedPlatform || preferences.platform, platformExplicit };
  }
  if (/\b(?:silencia|silenciar|mute)\b/u.test(text)) {
    return { type: "control", action: "mute", platform: requestedPlatform || preferences.platform, platformExplicit };
  }

  const start = raw.replace(/^(?:(?:bit)[,:\s]+)?(?:(?:por favor)[,\s]+)?(?:quiero escuchar|quiero oir|pon(?:e|é|eme|er)?|reproduc(?:e|í|ir|ime)?|escuch(?:a|á|ar)|play)\s+/iu, "").trim();
  if (!start || start === raw) return null;
  const withoutPlatform = platformExplicit
    ? start.replace(/\s+(?:en|por)\s+(?:spotify|youtube(?:\s+music)?)\s*$/iu, "").trim()
    : start;
  const normalizedRequest = normalize(withoutPlatform);
  if (!normalizedRequest || /\.(?:pdf|mp3|wav|mp4|mkv|docx?|xlsx?)$/iu.test(withoutPlatform)) return null;

  const asksForAnother = /^(?:otra|otro|otra cancion|otro tema|otra del mismo artista|otra cancion del mismo artista|siguiente)$/u.test(normalizedRequest);
  const asksForRecent = /^(?:lo ultimo|algo mas nuevo|mas nuevo|lo mas reciente|lo reciente)$/u.test(normalizedRequest);
  const asksForRandom = /^(?:cualquiera|algo cualquiera|al azar|aleatorio|aleatoria)$/u.test(normalizedRequest);
  if (asksForAnother && !activeMusic.artist) return null;
  if ((asksForAnother || asksForRecent) && activeMusic.artist) {
    return {
      type: "play",
      platform: requestedPlatform || preferences.platform,
      platformExplicit,
      artist: activeMusic.artist,
      track: "",
      album: "",
      genre: "",
      playlist: "",
      excludeTrack: asksForAnother ? activeMusic.track : "",
      selectionMode: asksForRecent ? "recent" : selectionMode,
      query: activeMusic.artist,
    };
  }

  const kindMatch = withoutPlatform.match(/^(?:un[oa]?\s+)?(album|álbum|playlist|genero|género)\s+(?:de\s+)?(.+)$/iu);
  const specificTrack = withoutPlatform.match(/^(.+?)\s+(?:de|por)\s+(.+)$/iu);
  const request = {
    type: "play",
    platform: requestedPlatform || preferences.platform,
    platformExplicit,
    artist: "",
    track: "",
    album: "",
    genre: "",
    playlist: "",
    excludeTrack: "",
    selectionMode,
  };

  if (asksForRandom || asksForRecent
    || /^(?:musica|music|algo de musica|canciones|algo para escuchar|un video(?: de youtube)?|video)$/iu.test(normalizedRequest)) {
    request.artist = preferences.artist;
    request.genre = preferences.genre;
  } else if (kindMatch) {
    const [, kind, value] = kindMatch;
    if (/^play/u.test(normalize(kind))) request.playlist = boundedText(value);
    else if (/^album$/u.test(normalize(kind))) request.album = boundedText(value);
    else request.genre = boundedText(value);
  } else if (specificTrack) {
    request.track = boundedText(specificTrack[1]);
    request.artist = boundedText(specificTrack[2]);
  } else {
    request.artist = boundedText(withoutPlatform.replace(/^(?:la|el|un|una)\s+/iu, ""));
  }

  if (![request.artist, request.track, request.album, request.genre, request.playlist].some(Boolean)) {
    request.genre = preferences.genre;
  }
  request.query = [request.track, request.artist, request.album, request.playlist, request.genre]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300) || (asksForRandom ? "música" : "música popular");
  return request;
}

function officialMusicResult(text) {
  return /\b(?:official|oficial|vevo|topic|provided to youtube by)\b/u.test(text);
}

function viewCount(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(mil millones|billones|millones|miles de millones|[kmb])?\s*(?:views?|vistas?|visualizaciones|reproducciones)\b/u);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const suffix = normalize(match[2] || "");
  const factor = ["b", "billones", "mil millones", "miles de millones"].includes(suffix)
    ? 1_000_000_000
    : ["m", "millones"].includes(suffix)
      ? 1_000_000
      : ["k", "miles"].includes(suffix)
        ? 1_000
        : 1;
  return amount * factor;
}

function validVideoUrl(value) {
  try {
    // Algunos buscadores entregan el enlace dentro de un campo URL ya
    // percent-encoded (por ejemplo, /watch%3Fv%3D...). Se puede normalizar
    // una sola vez sin ampliar los hosts ni los parámetros admitidos.
    let candidate = String(value ?? "");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let decoded;
      try {
        decoded = decodeURIComponent(candidate);
      } catch {
        break;
      }
      if (decoded === candidate) break;
      candidate = decoded;
    }
    const url = new URL(candidate);
    const safeWatchParams = new Set([
      "v",
      "app",
      "autoplay",
      "disable_polymer",
      "enablejsapi",
      "feature",
      "index",
      "lc",
      "list",
      "origin",
      "playnext",
      "pp",
      "rel",
      "si",
      "start_radio",
      "t",
      "widget_referrer",
    ]);
    if (!["youtube.com", "www.youtube.com"].includes(url.hostname)
      || url.protocol !== "https:" || url.pathname !== "/watch" || url.username || url.password
      || [...url.searchParams.keys()].some(key => key !== "v" && !safeWatchParams.has(key))) return null;
    const videoId = url.searchParams.get("v");
    return /^[A-Za-z0-9_-]{11}$/u.test(videoId || "")
      ? `https://www.youtube.com/watch?v=${videoId}&autoplay=1`
      : null;
  } catch {
    return null;
  }
}

function validSpotifyTrackUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://open.spotify.com"
      && /^\/track\/[A-Za-z0-9]{22}$/u.test(url.pathname)
      && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].every(key => key === "si")
      && url.searchParams.getAll("si").length <= 1
      ? `${url.origin}${url.pathname}`
      : null;
  } catch {
    return null;
  }
}

function publishedTime(result) {
  const value = typeof result?.publishedAt === "string" ? Date.parse(result.publishedAt) : NaN;
  return Number.isFinite(value) ? value : null;
}

function selectedTrackTitle(title, artist) {
  let track = title;
  const cleanArtist = boundedText(artist, 160);
  if (cleanArtist) {
    const escapedArtist = cleanArtist.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    track = track
      .replace(new RegExp(`^${escapedArtist}\\s*[-–—:|]\\s*`, "iu"), "")
      .replace(new RegExp(`\\s*[-–—:|]\\s*${escapedArtist}$`, "iu"), "");
  }
  return boundedText(track
    .replace(/\s*[\[(](?:official|oficial|video|audio|vevo|lyrics|hd|4k)[^\])]*[\])]\s*/giu, " ")
    .replace(/\b(?:official video|video oficial|official audio|audio oficial|vevo|hd|4k)\b/giu, "")
    .trim(), 160);
}

export function chooseMusicResult(results, intent, { random = Math.random } = {}) {
  if (!Array.isArray(results)) return null;
  const wantedTrack = normalize(intent.track);
  const wantedArtist = normalize(intent.artist);
  const excludedTrack = normalize(intent.excludeTrack);
  const artistMatches = (text) => {
    if (!wantedArtist) return true;
    const aliases = new Set([wantedArtist]);
    const words = wantedArtist.split(/\s+/u).filter(Boolean);
    if (words.length > 1) {
      aliases.add(words.join(""));
      aliases.add(words.map(word => word[0]).join(""));
      aliases.add(words[0]);
      aliases.add(words.at(-1));
    }
    return [...aliases].some(alias => alias && text.includes(alias));
  };
  const candidates = [];
  for (const result of results) {
    if (typeof result?.url !== "string" || typeof result.title !== "string" || typeof result.snippet !== "string") continue;
    const title = normalize(result.title);
    const text = `${title} ${normalize(result.snippet)}`;
    if (/\b(?:interview|entrevista|reaction|reaccion|reaccionando|review|critica|biografia|biography|noticias|news|cover|karaoke|tutorial|sponsored|advertisement|publicidad|anuncio)\b/u.test(text)) continue;
    if (wantedTrack && !title.includes(wantedTrack)) continue;
    if (wantedArtist && !artistMatches(text)) continue;
    if (excludedTrack && title.includes(excludedTrack)) continue;
    const url = intent.platform === "spotify" ? validSpotifyTrackUrl(result.url) : validVideoUrl(result.url);
    if (!url) continue;
    const official = officialMusicResult(text);
    candidates.push({
      title: boundedText(result.title, 240),
      track: selectedTrackTitle(result.title, intent.artist),
      url,
      official,
      popularity: viewCount(text),
      publishedAt: publishedTime(result),
      order: candidates.length,
    });
  }
  if (!candidates.length) return null;

  const officialCandidates = candidates.filter(candidate => candidate.official);
  const preferred = officialCandidates.length ? officialCandidates : candidates;
  if (intent.selectionMode === "random") {
    const index = Math.max(0, Math.min(preferred.length - 1, Math.floor(random() * preferred.length)));
    return preferred[index];
  }
  if (intent.selectionMode === "recent") {
    const dated = preferred.filter(candidate => candidate.publishedAt !== null);
    if (dated.length) return dated.sort((a, b) => b.publishedAt - a.publishedAt)[0];
    return preferred[0];
  }
  const withPopularity = preferred.filter(candidate => candidate.popularity !== null);
  if (withPopularity.length) return withPopularity.sort((a, b) => b.popularity - a.popularity)[0];
  return preferred[0];
}

export async function executeTaskWithFallback(strategies, {
  maxAttempts = MAX_TASK_ATTEMPTS,
  performanceManager = fallbackPerformanceManager,
  audit = async () => {},
} = {}) {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    return { ok: false, attempts: 0, error: "No hay estrategias de ejecución disponibles." };
  }
  const limit = Math.max(1, Math.min(MAX_TASK_ATTEMPTS, Math.trunc(maxAttempts)));
  const attempts = [];

  for (const strategy of strategies.slice(0, limit)) {
    if (!strategy || typeof strategy.name !== "string" || typeof strategy.run !== "function") continue;
    try {
      const result = await performanceManager.run(
        "browser.navigation",
        ({ signal }) => strategy.run({ signal }),
        { priority: "interactive" },
      );
      attempts.push({ strategy: strategy.name, status: result?.ok === true ? "completed" : result?.cancelled ? "cancelled" : "failed" });
      await audit({ strategy: strategy.name, status: attempts.at(-1).status });
      if (result?.ok === true || result?.cancelled === true) {
        return { ...result, strategy: strategy.name, attempts: attempts.length, history: attempts };
      }
      if (typeof result?.error === "string" && result.error) {
        attempts.at(-1).error = result.error.slice(0, 240);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ strategy: strategy.name, status: "failed", error: message.slice(0, 240) });
      await audit({ strategy: strategy.name, status: "failed", error: message.slice(0, 240) });
      if (error?.code === "ADAPTIVE_TIMEOUT" || error?.code === "ADAPTIVE_RESOURCE_WAIT_TIMEOUT") {
        return {
          ok: false,
          attempts: attempts.length,
          history: attempts,
          error: message.slice(0, 240),
        };
      }
    }
  }

  return {
    ok: false,
    attempts: attempts.length,
    history: attempts,
    error: attempts.at(-1)?.error || "No fue posible completar la tarea con las alternativas disponibles.",
  };
}

export function createMusicExecutor({
  searchWeb,
  openPage,
  confirm,
  availableBrowsers,
  performanceManager = fallbackPerformanceManager,
  audit = async () => {},
  random = Math.random,
} = {}) {
  if (typeof openPage !== "function" || typeof confirm !== "function") {
    throw new Error("El ejecutor musical requiere apertura de página y autorización.");
  }

  return async function executeMusicIntent(intent) {
    if (!intent || !["spotify", "youtube"].includes(intent.platform)) {
      return { ok: false, error: "La plataforma musical no es válida." };
    }
    if (intent.type === "control") {
      return {
        ok: false,
        error: "No hay una integración verificada con Windows Media Session o con el reproductor activo. No envié controles simulados.",
      };
    }
    if (intent.type !== "play") return { ok: false, error: "La acción musical no es válida." };

    if (typeof searchWeb !== "function") return { ok: false, error: "La búsqueda musical no está disponible en este momento." };
    const preferredMode = MUSIC_SELECTION_MODES.includes(intent.selectionMode) ? intent.selectionMode : "popular";
    const baseQuery = intent.platform === "spotify"
      ? `site:open.spotify.com/track ${intent.track ? `"${intent.track}" ` : ""}${intent.artist || intent.album || intent.playlist || intent.genre || intent.query}`
      : `site:youtube.com/watch ${intent.track ? `"${intent.track}" ` : ""}${intent.artist || intent.album || intent.playlist || intent.genre || intent.query} official music`;
    const searchQueries = [
      baseQuery.trim(),
      `${intent.track ? `"${intent.track}" ` : ""}${intent.artist || intent.album || intent.playlist || intent.genre || intent.query} ${preferredMode === "recent" ? "latest new release" : "official song"}`.trim(),
    ];
    let selected = null;
    let searchError = "";
    let searchSucceeded = false;
    for (const searchQuery of [...new Set(searchQueries)]) {
      try {
        const results = await searchWeb(searchQuery);
        searchSucceeded = true;
        selected = chooseMusicResult(results, { ...intent, selectionMode: preferredMode }, { random });
        if (selected) break;
      } catch (error) {
        searchError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!selected) {
      return {
        ok: false,
        error: !searchSucceeded && searchError
          ? `No pude consultar resultados musicales: ${searchError}`
          : `No encontré una canción confiable que coincida con ${intent.artist || intent.track || intent.query}. No abrí una lista de resultados para que tenga que elegir.`,
      };
    }

    let browsers = [];
    try {
      if (typeof availableBrowsers === "function") browsers = await availableBrowsers();
    } catch {
      browsers = [];
    }
    const supported = new Set(["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "default-browser"]);
    const uniqueBrowsers = [...new Set((Array.isArray(browsers) ? browsers : []).filter(browser => supported.has(browser)))].slice(0, 3);
    if (!uniqueBrowsers.length) uniqueBrowsers.push("default-browser");

    const execution = await executeTaskWithFallback(
      uniqueBrowsers.map(browser => ({
        name: browser,
        run: async ({ signal }) => {
          const approval = await confirm({
            platform: intent.platform,
            browser,
            url: selected.url,
            title: selected.title,
          });
          if (approval !== true) return { ok: false, cancelled: true, error: "La apertura no fue autorizada." };
          return openPage(selected.url, { browser, platform: intent.platform, signal });
        },
      })),
      { maxAttempts: 3, performanceManager, audit },
    );

    if (execution.cancelled) return execution;
    if (execution.ok !== true) return execution;
    const artist = boundedText(intent.artist || selected.title.match(/^(.+?)\s+[-–—]\s+/u)?.[1], 160);
    return {
      ...execution,
      platform: intent.platform === "youtube" ? "YouTube" : "Spotify Web",
      opened: true,
      playbackAttempted: intent.platform === "youtube" || execution.playbackAttempted === true,
      playbackVerified: execution.playbackVerified === true,
      playbackBlocked: execution.playbackBlocked === true,
      selectionRequired: false,
      authenticationMayBeRequired: intent.platform === "spotify",
      title: selected.title,
      artist,
      track: selectedTrackTitle(selected.title, artist) || boundedText(intent.track, 160) || selected.title,
      url: selected.url,
      selectionMode: preferredMode,
      popularityVerified: selected.popularity !== null,
      publishedAt: selected.publishedAt ? new Date(selected.publishedAt).toISOString() : "",
    };
  };
}
