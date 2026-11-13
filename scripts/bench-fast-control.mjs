import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { createInstalledApps } from "../main/src/core/installed-apps.mjs";
import { resolveDirectOpenRequest, resolveDirectFileSearch, runAgentTurn } from "../main/src/core/agent.mjs";

// Mide únicamente el despacho local; no simula latencia de modelos ni de Windows.
const messages = ["¿Podría abrir la calculadora?", "Quiero que abras Chrome", 'Buscá el archivo "Informe Final.pdf" en descargas', "Abrí YouTube", "Poné Daddy Yankee en YouTube", "Abrí Word", "Abrí Chrome y buscá recetas", "Buscá noticias en Firefox", "Buscá en Google horarios del tren"];
for (let i = 0; i < 1000; i++) {
  for (const message of messages) { resolveDirectOpenRequest(message); resolveDirectFileSearch(message); }
}
const beforeCpu = process.cpuUsage();
const beforeRam = process.memoryUsage().rss;
const started = performance.now();
const iterations = 10000;
for (let i = 0; i < iterations; i++) {
  for (const message of messages) { resolveDirectOpenRequest(message); resolveDirectFileSearch(message); }
}
const elapsedMs = performance.now() - started;
const cpu = process.cpuUsage(beforeCpu);
let modelCalls = 0;
const deps = {
  chatClient: { generate() { modelCalls++; throw new Error("Inferencia inesperada"); } },
  modelClient: { show() { throw new Error("Consulta de capacidades inesperada"); } },
  executeTool: async (name) => name === "system.searchFiles" ? { results: [] } : { ok: true },
};
const turnStarted = performance.now();
for (const message of messages) {
  const result = await runAgentTurn({ message, deps });
  if (result.rounds !== 0) throw new Error("El pedido no usó el camino directo");
}
const mockedToolTurnsMs = performance.now() - turnStarted;
const catalog = createInstalledApps({
  roots: [process.env.APPDATA, process.env.ProgramData].filter(Boolean).map((root) => join(root, "Microsoft", "Windows", "Start Menu", "Programs")),
  targetRoots: [],
  readShortcut() { throw new Error("La medición no abre accesos directos"); },
  openPath() { throw new Error("La medición no abre aplicaciones"); },
  confirm: async () => false, audit: async () => {},
});
const catalogCpu = process.cpuUsage();
const catalogRam = process.memoryUsage().rss;
const catalogStarted = performance.now();
await catalog.search("__bit_performance_probe_no_match__");
const catalogColdMs = performance.now() - catalogStarted;
const warmStarted = performance.now();
await catalog.search("__bit_performance_probe_no_match__");
const catalogWarmMs = performance.now() - warmStarted;
const catalogCpuUsed = process.cpuUsage(catalogCpu);
console.log(JSON.stringify({
  requests: iterations * messages.length,
  dispatchMsPerRequest: elapsedMs / (iterations * messages.length),
  cpuMs: (cpu.user + cpu.system) / 1000,
  cpuPercentOfOneCore: ((cpu.user + cpu.system) / 1000) / elapsedMs * 100,
  rssBeforeMiB: beforeRam / 1024 ** 2,
  rssAfterMiB: process.memoryUsage().rss / 1024 ** 2,
  mockedToolTurnsMs,
  modelCalls,
  catalogColdMs, catalogWarmMs,
  catalogCpuMs: (catalogCpuUsed.user + catalogCpuUsed.system) / 1000,
  catalogRssDeltaMiB: (process.memoryUsage().rss - catalogRam) / 1024 ** 2,
}, null, 2));
