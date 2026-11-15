import test from "node:test";
import assert from "node:assert/strict";
import { createMusicExecutor, executeTaskWithFallback, resolveMusicIntent, chooseMusicResult } from "../src/core/task-executor.mjs";
import { runAgentTurn } from "../src/core/agent.mjs";

test("música: resuelve solicitud general, artista, canción exacta y plataforma explícita", () => {
  assert.equal(resolveMusicIntent("Poné música").query, "música popular");
  assert.equal(resolveMusicIntent("BIT, poné Daddy Yankee").query, "Daddy Yankee");
  assert.deepEqual(
    (({ track, artist }) => ({ track, artist }))(resolveMusicIntent("Poné Gasolina de Daddy Yankee")),
    { track: "Gasolina", artist: "Daddy Yankee" },
  );
  assert.equal(resolveMusicIntent("Poné Daddy Yankee en Spotify").platform, "spotify");
  assert.equal(resolveMusicIntent("Poné Daddy Yankee en YouTube").platform, "youtube");
  assert.equal(resolveMusicIntent("Poné lo último", { activeMusic: { artist: "Daddy Yankee" } }).selectionMode, "recent");
  assert.equal(resolveMusicIntent("Poné cualquiera").selectionMode, "random");
  assert.equal(resolveMusicIntent("Siguiente", { activeMusic: { artist: "Daddy Yankee", track: "Gasolina" } }).excludeTrack, "Gasolina");
  assert.equal(resolveMusicIntent("Pausá la música").action, "pause");
  assert.equal(resolveMusicIntent("Poné otra canción").action, "next");
  assert.equal(resolveMusicIntent("Poné otra"), null);
  assert.equal(resolveMusicIntent("¿Qué hora es?"), null);
});

test("música: usa preferencias válidas solo cuando la orden no especifica plataforma", () => {
  const intent = resolveMusicIntent("Poné música", {
    musicPlatform: "spotify",
    frequentArtists: "Babasónicos, Soda Stereo",
    preferredGenres: "rock",
  });
  assert.equal(intent.platform, "spotify");
  assert.equal(intent.artist, "Babasónicos");
  assert.equal(resolveMusicIntent("Poné Daddy Yankee", { musicSelectionMode: "random" }).selectionMode, "random");
});

test("YouTube: prioriza una coincidencia oficial exacta y descarta entrevistas y resultados ajenos", () => {
  const intent = resolveMusicIntent("Poné Gasolina de Daddy Yankee");
  const video = { title: "Daddy Yankee - Gasolina (Video Oficial)", snippet: "Official video", url: "https://www.youtube.com/watch?v=AbCdEf12345" };
  const selected = chooseMusicResult([
    { title: "Entrevista a Daddy Yankee", snippet: "Official interview", url: "https://www.youtube.com/watch?v=AbCdEf12346" },
    { title: "Gasolina cover", snippet: "Daddy Yankee fan cover", url: "https://www.youtube.com/watch?v=AbCdEf12347" },
    video,
  ], intent);
  assert.equal(selected.title, video.title);
  assert.equal(selected.url, "https://www.youtube.com/watch?v=AbCdEf12345&autoplay=1");
});

test("YouTube: acepta enlaces de reproducción con parámetros de seguimiento comunes", () => {
  const intent = resolveMusicIntent("Poné Gasolina de Daddy Yankee");
  const selected = chooseMusicResult([
    { title: "Daddy Yankee - Gasolina (Video Oficial)", snippet: "Official video", url: "https://www.youtube.com/watch?v=AbCdEf12345&feature=share&list=PL1234567890" },
  ], intent);
  assert.equal(selected.title, "Daddy Yankee - Gasolina (Video Oficial)");
  assert.equal(selected.url, "https://www.youtube.com/watch?v=AbCdEf12345&autoplay=1");
});

test("YouTube: normaliza enlaces de resultados percent-encoded del buscador", () => {
  const intent = resolveMusicIntent("Poné Gasolina de Daddy Yankee");
  const selected = chooseMusicResult([
    { title: "Daddy Yankee - Gasolina (Video Oficial)", snippet: "Official video", url: "https://www.youtube.com/watch%3Fv%3DAbCdEf12345" },
  ], intent);
  assert.equal(selected?.url, "https://www.youtube.com/watch?v=AbCdEf12345&autoplay=1");
});

test("selección: usa popularidad verificable, fecha reciente o aleatoriedad entre canciones válidas", () => {
  const results = [
    { title: "Daddy Yankee - Tema A", snippet: "Official video, 2M views", publishedAt: "2025-01-01T00:00:00.000Z", url: "https://www.youtube.com/watch?v=AbCdEf12341" },
    { title: "Daddy Yankee - Tema B", snippet: "Official video, 8M views", publishedAt: "2026-01-01T00:00:00.000Z", url: "https://www.youtube.com/watch?v=AbCdEf12342" },
    { title: "Daddy Yankee - Tema C", snippet: "Official video", publishedAt: "2024-01-01T00:00:00.000Z", url: "https://www.youtube.com/watch?v=AbCdEf12343" },
  ];
  assert.match(chooseMusicResult(results, { artist: "Daddy Yankee", selectionMode: "popular" }).title, /Tema B/u);
  assert.match(chooseMusicResult(results, { artist: "Daddy Yankee", selectionMode: "recent" }).title, /Tema B/u);
  assert.match(chooseMusicResult(results, { artist: "Daddy Yankee", selectionMode: "random" }, { random: () => 0.99 }).title, /Tema C/u);
});

test("selección: sin datos de popularidad elige una coincidencia oficial sin atribuirle ranking", () => {
  const selected = chooseMusicResult([
    { title: "Daddy Yankee - canción A", snippet: "Official video", url: "https://www.youtube.com/watch?v=AbCdEf12341" },
    { title: "Daddy Yankee - canción B", snippet: "Official audio", url: "https://www.youtube.com/watch?v=AbCdEf12342" },
  ], { artist: "Daddy Yankee", selectionMode: "popular" });
  assert.match(selected.title, /canción A/u);
  assert.equal(selected.popularity, null);
});

test("música: sin coincidencias relevantes no abre una lista para selección manual", async () => {
  const opened = [];
  const execute = createMusicExecutor({
    searchWeb: async () => [{ title: "Entrevista a Daddy Yankee", snippet: "Official interview", url: "https://www.youtube.com/watch?v=AbCdEf12345" }],
    availableBrowsers: async () => ["chrome.exe"],
    confirm: async () => true,
    openPage: async (url, options) => { opened.push({ url, ...options }); return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee en YouTube"));
  assert.equal(result.ok, false);
  assert.match(result.error, /No encontré una canción confiable/u);
  assert.equal(opened.length, 0);
});

test("música: artista sin canción acepta aliases comunes como DY y abre el video con intento de reproducción", async () => {
  const opened = [];
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "DY - Sonríele (Video Oficial)",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["chrome.exe"],
    confirm: async () => true,
    openPage: async (url) => { opened.push(url); return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee"));
  assert.equal(result.ok, true);
  assert.equal(result.selectionRequired, false);
  assert.equal(result.playbackAttempted, true);
  assert.equal(result.playbackVerified, false);
  assert.equal(result.title, "DY - Sonríele (Video Oficial)");
  assert.match(opened[0], /watch\?v=AbCdEf12345&autoplay=1/u);
});

test("música: canción específica abre la coincidencia y conserva una verificación real si el navegador la da", async () => {
  const opened = [];
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee - Gasolina (Video Oficial)",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["chrome.exe"],
    confirm: async () => true,
    openPage: async (url) => { opened.push(url); return { ok: true, playbackVerified: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Gasolina de Daddy Yankee"));
  assert.equal(result.ok, true);
  assert.equal(result.playbackAttempted, true);
  assert.equal(result.playbackVerified, true);
  assert.equal(result.selectionRequired, false);
  assert.match(opened[0], /watch\?v=AbCdEf12345&autoplay=1/u);
});

test("Spotify: elige una pista directa sin cambiar de plataforma y advierte sobre autenticación", async () => {
  let url;
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee - Gasolina",
      snippet: "Spotify track",
      url: "https://open.spotify.com/track/0123456789ABCDEFGHIJKL",
    }],
    availableBrowsers: async () => ["msedge.exe"],
    confirm: async ({ platform }) => platform === "spotify",
    openPage: async (value) => { url = value; return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee en Spotify"));
  assert.equal(result.ok, true);
  assert.equal(result.platform, "Spotify Web");
  assert.equal(result.authenticationMayBeRequired, true);
  assert.equal(url, "https://open.spotify.com/track/0123456789ABCDEFGHIJKL");
  assert.equal(result.selectionRequired, false);
  assert.equal(result.playbackAttempted, false);
  assert.equal(result.playbackVerified, false);
});

test("Spotify: no cambia a YouTube ni abre resultados si no encuentra una pista directa", async () => {
  const opened = [];
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee Gasolina",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["chrome.exe"],
    confirm: async () => true,
    openPage: async (url) => { opened.push(url); return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee en Spotify"));
  assert.equal(result.ok, false);
  assert.match(result.error, /No encontré una canción confiable/u);
  assert.deepEqual(opened, []);
});

test("música: cambia a un navegador alternativo tras un fallo, sin repetir para siempre", async () => {
  const tried = [];
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee - Gasolina",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["chrome.exe", "msedge.exe"],
    confirm: async () => true,
    openPage: async (_url, { browser }) => {
      tried.push(browser);
      return browser === "chrome.exe" ? { ok: false, error: "Chrome no disponible" } : { ok: true };
    },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee"));
  assert.deepEqual(tried, ["chrome.exe", "msedge.exe"]);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("música: abrir resultado sin autorización cancela la tarea", async () => {
  let opens = 0;
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee - Gasolina",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["chrome.exe"],
    confirm: async () => false,
    openPage: async () => { opens++; return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee"));
  assert.equal(result.cancelled, true);
  assert.equal(opens, 0);
});

test("música: otra del mismo artista excluye la pista activa y usa el modo reciente al pedir novedades", () => {
  const config = { activeMusic: { artist: "Daddy Yankee", track: "Gasolina" } };
  const another = resolveMusicIntent("Poné otra del mismo artista", config);
  assert.equal(another.type, "play");
  assert.equal(another.artist, "Daddy Yankee");
  assert.equal(another.excludeTrack, "Gasolina");
  const recent = resolveMusicIntent("Poné algo más nuevo", config);
  assert.equal(recent.selectionMode, "recent");
  assert.equal(recent.artist, "Daddy Yankee");
  const selected = chooseMusicResult([
    { title: "Daddy Yankee - Gasolina (Video Oficial)", snippet: "Official video", url: "https://www.youtube.com/watch?v=AbCdEf12345" },
    { title: "Daddy Yankee - Rompe (Video Oficial)", snippet: "Official video", url: "https://www.youtube.com/watch?v=AbCdEf12346" },
  ], another);
  assert.match(selected.title, /Rompe/u);
});

test("música: usa el navegador predeterminado cuando Chrome y las alternativas no están disponibles", async () => {
  let browser;
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Artista - Canción",
      snippet: "Official video",
      url: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
    availableBrowsers: async () => ["default-browser"],
    confirm: async () => true,
    openPage: async (_url, options) => { browser = options.browser; return { ok: true }; },
  });
  assert.equal((await execute(resolveMusicIntent("Poné música"))).ok, true);
  assert.equal(browser, "default-browser");
});

test("música: una cancelación no abre páginas ni intenta otra plataforma", async () => {
  let opens = 0;
  const execute = createMusicExecutor({
    searchWeb: async () => [{
      title: "Daddy Yankee - Gasolina",
      snippet: "Spotify track",
      url: "https://open.spotify.com/track/0123456789ABCDEFGHIJKL",
    }],
    availableBrowsers: async () => ["chrome.exe", "msedge.exe"],
    confirm: async () => false,
    openPage: async () => { opens++; return { ok: true }; },
  });
  const result = await execute(resolveMusicIntent("Poné Daddy Yankee en Spotify"));
  assert.equal(result.cancelled, true);
  assert.equal(opens, 0);
  assert.equal(result.attempts, 1);
});

test("tareas: limita los intentos y sigue con alternativa después de una excepción", async () => {
  const attempted = [];
  const result = await executeTaskWithFallback([
    { name: "primaria", run: async () => { attempted.push("primaria"); throw new Error("offline"); } },
    { name: "alternativa", run: async () => { attempted.push("alternativa"); return { ok: true }; } },
    { name: "extra", run: async () => { attempted.push("extra"); return { ok: true }; } },
    { name: "fuera-del-limite", run: async () => { attempted.push("fuera"); return { ok: true }; } },
  ], { maxAttempts: 3 });
  assert.deepEqual(attempted, ["primaria", "alternativa"]);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("navegación: un timeout adaptativo no repite una acción de resultado incierto", async () => {
  const attempted = [];
  const result = await executeTaskWithFallback([
    { name: "primaria", run: async () => { attempted.push("primaria"); return { ok: true }; } },
    { name: "alternativa", run: async () => { attempted.push("alternativa"); return { ok: true }; } },
  ], {
    performanceManager: {
      async run(taskType, operation, options) {
        assert.equal(taskType, "browser.navigation");
        assert.equal(options.priority, "interactive");
        await operation({ signal: new AbortController().signal });
        throw Object.assign(new Error("sin progreso"), { code: "ADAPTIVE_TIMEOUT" });
      },
    },
  });
  assert.deepEqual(attempted, ["primaria"]);
  assert.equal(result.ok, false);
  assert.match(result.error, /sin progreso/u);
});

test("voz y texto: la orden hablada transcrita atraviesa la misma herramienta musical", async () => {
  const calls = [];
  const result = await runAgentTurn({
    message: "Poné Daddy Yankee",
    config: { musicPlatform: "youtube" },
    deps: {
      chatClient: { generate() { assert.fail("La orden no debe depender del modelo"); } },
      executeTool: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, opened: true, playbackAttempted: true, selectionRequired: false, platform: "YouTube", title: "Gasolina" };
      },
    },
  });
  assert.equal(result.toolCalls, 1);
  assert.equal(calls[0].name, "media.play_music");
  assert.equal(calls[0].args.query, "Daddy Yankee");
  assert.equal(calls[0].args.selectionMode, "popular");
  assert.doesNotMatch(result.text, /elija una opción/u);
});

test("música: solo declara reproducción cuando recibió verificación del reproductor", async () => {
  const verified = await runAgentTurn({
    message: "Poné Gasolina de Daddy Yankee",
    deps: {
      chatClient: { generate() { assert.fail("La orden no debe depender del modelo"); } },
      executeTool: async () => ({
        ok: true, playbackVerified: true, platform: "YouTube",
        title: "Gasolina", artist: "Daddy Yankee",
      }),
    },
  });
  assert.equal(verified.text, "Reproduciendo Gasolina de Daddy Yankee.");

  const blocked = await runAgentTurn({
    message: "Poné Gasolina de Daddy Yankee",
    deps: {
      chatClient: { generate() { assert.fail("La orden no debe depender del modelo"); } },
      executeTool: async () => ({
        ok: true, playbackAttempted: true, playbackBlocked: true,
        message: "YouTube bloqueó el inicio automático",
        title: "Gasolina", artist: "Daddy Yankee",
      }),
    },
  });
  assert.match(blocked.text, /YouTube bloqueó el inicio automático/u);
});

test("contenido externo: no habilita la herramienta musical de modificación", async () => {
  let offeredTools;
  const result = await runAgentTurn({
    message: "Poné Daddy Yankee",
    config: { externalContent: true },
    deps: {
      modelClient: { show: async () => ({ tools: true }) },
      chatClient: {
        generate: async (_model, request) => {
          offeredTools = request.tools;
          return { message: { content: "No abriré música desde contenido externo." } };
        },
      },
      executeTool: async () => assert.fail("El contenido externo no debe ejecutar acciones"),
    },
  });
  assert.ok(!offeredTools?.some(tool => tool.function.name === "media.play_music"));
  assert.match(result.text, /No abriré música/u);
});

test("controles: reporta falta de integración sin simular pausa, siguiente o volumen", async () => {
  for (const [message, action] of [
    ["Pausá la música", "pause"],
    ["Poné otra canción", "next"],
    ["Subí el volumen", "volume-up"],
  ]) {
    const calls = [];
    const result = await runAgentTurn({
      message,
      deps: {
        chatClient: { generate() { assert.fail("No debe inferir el control"); } },
        executeTool: async (name, args) => {
          calls.push({ name, args });
          return { ok: false, error: "sin integración" };
        },
      },
    });
    assert.equal(calls[0].name, "media.controlPlayback");
    assert.equal(calls[0].args.action, action);
    assert.match(result.text, /No pude completar/u);
  }
});
