import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWebSearchQuery,
  createNetGateway,
  isDownloadUrlAllowed,
  isOfficialSourceUrl,
  isWeatherSearchRequest,
  isWeatherLocationFollowUp,
  isWebSearchRequest,
  parseSearchResults,
  resolveWeatherSearchQuery,
} from "../src/net-gateway.mjs";

const rss = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[Servicio Meteorológico Nacional]]></title><link>https://www.smn.gob.ar/</link><description><![CDATA[Pronóstico oficial para Argentina]]></description></item>
  <item><title>Servicio Meteorológico Nacional (duplicado)</title><link>https://www.smn.gob.ar/</link><description>duplicado</description></item>
  <item><title>Dominio parecido</title><link>https://smn.gob.ar.evil.example/</link><description>no es oficial</description></item>
  <item><title>Sin cifrado</title><link>http://www.smn.gob.ar/</link><description>no es seguro</description></item>
  <item><title>Unsafe</title><link>javascript:alert(1)</link><description>ignored</description></item>
</channel></rss>`;

test("reconoce solicitudes web y convierte el clima sin ubicación a Buenos Aires", () => {
  assert.equal(isWebSearchRequest("¿Cómo está el clima?"), true);
  assert.equal(isWeatherSearchRequest("¿Cómo está el clima en Madrid?"), true);
  assert.equal(isWeatherLocationFollowUp("y en brazil"), true);
  assert.equal(isWeatherSearchRequest("y en brazil"), false);
  assert.equal(resolveWeatherSearchQuery("y en brazil", [
    { role: "user", content: "¿Cómo está el clima en Buenos Aires?" },
    { role: "assistant", content: "En Buenos Aires: Ahora, 16 °C." },
  ]), "clima actual en Brasília, Brasil");
  assert.equal(resolveWeatherSearchQuery("y en brazil", [
    { role: "user", content: "¿Qué idiomas hablan en Brasil?" },
  ]), null);
  assert.equal(buildWebSearchQuery("¿Cómo está el clima?"), "clima actual en Buenos Aires, Argentina");
  assert.equal(buildWebSearchQuery("¿Cómo está el clima en Madrid, España?"), "clima actual en Madrid, España");
  assert.equal(buildWebSearchQuery("Busca en internet noticias de Córdoba"), "noticias de Córdoba");
  assert.equal(isWebSearchRequest("Buscá en internet el precio de la luz"), true);
  assert.equal(buildWebSearchQuery("Buscá en internet el precio de la luz"), "el precio de la luz");
  assert.equal(isWebSearchRequest("¿Cuánto tiempo falta?"), false);
  assert.equal(isWebSearchRequest("No me gustan las noticias"), false);
  assert.equal(isWebSearchRequest("Hola, ¿cómo estás?"), false);
});

test("el parser conserva enlaces HTTPS públicos con texto limpio y descarta destinos reservados", () => {
  assert.deepEqual(parseSearchResults(rss), [
    { title: "Servicio Meteorológico Nacional", url: "https://www.smn.gob.ar/", snippet: "Pronóstico oficial para Argentina" },
  ]);
});

test("la política de fuentes requiere HTTPS y dominios oficiales completos", () => {
  assert.equal(isOfficialSourceUrl("https://www.smn.gob.ar/pronostico"), true);
  assert.equal(isOfficialSourceUrl("https://www.nasa.gov/"), true);
  assert.equal(isOfficialSourceUrl("https://open-meteo.com/"), true);
  assert.equal(isOfficialSourceUrl("http://www.smn.gob.ar/"), false);
  assert.equal(isOfficialSourceUrl("https://smn.gob.ar.evil.example/"), false);
  assert.equal(isOfficialSourceUrl("https://smn.gob.ar@evil.example/"), false);
  assert.equal(isOfficialSourceUrl("https://smn.gob.ar:8443/"), false);
  assert.equal(isOfficialSourceUrl("https://weather.example/"), false);
});

test("gateway consulta solo Bing, registra actividad y deja una auditoría local", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-net-gateway-"));
  const auditPath = join(directory, "audit.log");
  const requests = [];
  const activity = [];
  try {
    const gateway = createNetGateway({
      auditPath,
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(rss, { status: 200 });
      },
      onActivity: (event) => activity.push(event),
      now: () => new Date("2026-11-02T00:00:00.000Z"),
    });

    const results = await gateway.searchWeb("noticias de Buenos Aires");
    const audit = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(results.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.hostname, "www.bing.com");
    assert.equal(requests[0].url.searchParams.get("q"), "noticias de Buenos Aires");
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(audit.length, 2);
    assert.deepEqual(audit.map((entry) => entry.status), ["started", "completed"]);
    assert.deepEqual(activity.map((event) => event.active), [true, false]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway responde el clima con datos actuales estructurados y solo consulta Open-Meteo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-net-gateway-weather-"));
  const auditPath = join(directory, "audit.log");
  const requests = [];
  const activity = [];
  try {
    const gateway = createNetGateway({
      auditPath,
      fetchImpl: async (url, options) => {
        const requestUrl = new URL(url);
        requests.push({ url: requestUrl, options });
        if (requestUrl.hostname === "geocoding-api.open-meteo.com") {
          return Response.json({
            results: [{
              name: "Buenos Aires",
              admin1: "Ciudad Autónoma de Buenos Aires",
              country: "Argentina",
              latitude: -34.6,
              longitude: -58.38,
            }],
          });
        }
        return Response.json({
          timezone: "America/Argentina/Buenos_Aires",
          current: {
            time: "2026-11-02T10:00",
            temperature_2m: 18.2,
            relative_humidity_2m: 72,
            apparent_temperature: 17.4,
            precipitation: 0,
            weather_code: 3,
            wind_speed_10m: 12.5,
          },
          daily: {
            time: ["2026-11-02"],
            weather_code: [2],
            temperature_2m_max: [22],
            temperature_2m_min: [14],
            precipitation_probability_max: [20],
          },
        });
      },
      onActivity: (event) => activity.push(event),
    });

    const results = await gateway.searchWeb("clima actual en Buenos Aires, Argentina");
    const audit = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({ url }) => url.hostname), [
      "geocoding-api.open-meteo.com",
      "api.open-meteo.com",
    ]);
    assert.ok(requests.every(({ options }) => options.redirect === "error"));
    assert.equal(requests[0].url.searchParams.get("name"), "Buenos Aires, Argentina");
    assert.equal(requests[1].url.searchParams.get("current"), "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
    assert.equal(results.length, 1);
    assert.match(results[0].title, /Buenos Aires.*Argentina/);
    assert.match(results[0].snippet, /nublado, 18,2 °C/);
    assert.match(results[0].snippet, /sensación 17,4 °C/);
    assert.match(results[0].snippet, /máxima 22 °C/);
    assert.match(results[0].snippet, /probabilidad de precipitación 20 %/);
    assert.equal(new URL(results[0].url).hostname, "api.open-meteo.com");
    assert.deepEqual(audit.map(({ status }) => status), ["started", "completed"]);
    assert.ok(audit.every(({ host }) => host.includes("open-meteo.com")));
    assert.deepEqual(activity.map(({ active }) => active), [true, false]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway restringe descargas HTTPS a hosts previamente permitidos", () => {
  assert.equal(isDownloadUrlAllowed("https://huggingface.co/model.onnx"), true);
  assert.equal(isDownloadUrlAllowed("http://huggingface.co/model.onnx"), false);
  assert.equal(isDownloadUrlAllowed("https://evil.example/model.onnx"), false);
  assert.equal(isDownloadUrlAllowed("https://user:pass@github.com/file"), false);
});

test("gateway permite CDN aprobado de Hugging Face y bloquea dominios parecidos", () => {
  assert.equal(isDownloadUrlAllowed("https://cdn-lfs.huggingface.co/model.onnx"), true);
  assert.equal(isDownloadUrlAllowed("https://huggingface.co.evil.example/model.onnx"), false);
  assert.equal(isDownloadUrlAllowed("https://github.com.evil.example/file"), false);
});

test("gateway bloquea redirecciones de descarga a hosts fuera de la whitelist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-net-gateway-redirect-"));
  const activity = [];
  try {
    const gateway = createNetGateway({
      auditPath: join(directory, "audit.log"),
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/asset" },
      }),
      onActivity: (event) => activity.push(event),
    });

    await assert.rejects(() => gateway.fetchDownload("https://huggingface.co/asset"), /dominio no permitido/);
    assert.deepEqual(activity.map((event) => event.active), [true, false]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway rechaza respuestas de búsqueda por encima del límite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-net-gateway-limit-"));
  try {
    const gateway = createNetGateway({
      auditPath: join(directory, "audit.log"),
      fetchImpl: async () => new Response("x".repeat(513 * 1024), { status: 200 }),
    });
    await assert.rejects(() => gateway.searchWeb("consulta"), /supera el límite de tamaño/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
