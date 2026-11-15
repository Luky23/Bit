import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdaptivePerformanceManager } from "../src/core/adaptive-performance.mjs";

function providers({ cores = 4, freeBytes = 8 * 1024 ** 3, budgets = {} } = {}) {
  const cpu = Array.from({ length: cores }, () => ({ model: "CPU de prueba", times: { user: 100, idle: 900 } }));
  return {
    cpu: () => cpu,
    memory: () => ({ totalBytes: 16 * 1024 ** 3, availableBytes: freeBytes }),
    disk: async () => ({ blocks: 100, bfree: 50, bavail: 40, bsize: 4096 }),
    gpu: async () => ({ available: false, reason: "No consultable en esta prueba" }),
    displays: async () => [{ width: 1920, height: 1080 }],
    os: () => ({ platform: "win32", release: "test" }),
    processMemory: () => 100,
    budgets,
  };
}

test("hardware snapshot reports measured CPU, memory, storage, display and unavailable GPU", async () => {
  const manager = new AdaptivePerformanceManager({ providers: providers() });
  const snapshot = await manager.getSnapshot();
  assert.equal(snapshot.hardware.cpu.model, "CPU de prueba");
  assert.equal(snapshot.hardware.memory.availableBytes, 8 * 1024 ** 3);
  assert.equal(snapshot.hardware.storage.freeBytes, 40 * 4096);
  assert.equal(snapshot.hardware.gpu.available, false);
  assert.equal(snapshot.hardware.displays.monitors[0].width, 1920);
  assert.ok(snapshot.policy.maxConcurrentTasks > 0);
});

test("policy reduces concurrency on one-core or memory-constrained profiles", async () => {
  const slow = new AdaptivePerformanceManager({ providers: providers({ cores: 1, freeBytes: 1.5 * 1024 ** 3 }) });
  const fast = new AdaptivePerformanceManager({ providers: providers({ cores: 8, freeBytes: 12 * 1024 ** 3 }) });
  assert.equal((await slow.getSnapshot()).policy.maxConcurrentTasks, 1);
  assert.ok((await fast.getSnapshot()).policy.maxConcurrentTasks > 1);
});

test("las métricas dinámicas se refrescan y los sondeos estáticos se limitan", async () => {
  let now = 0;
  let availableBytes = 6 * 1024 ** 3;
  let gpuReads = 0;
  const source = providers();
  source.memory = () => ({ totalBytes: 16 * 1024 ** 3, availableBytes });
  source.gpu = async () => { gpuReads += 1; return { available: false }; };
  const manager = new AdaptivePerformanceManager({ providers: source, clock: () => now });
  assert.equal((await manager.getSnapshot()).hardware.memory.availableBytes, availableBytes);
  availableBytes = 3 * 1024 ** 3;
  now = 6000;
  assert.equal((await manager.getSnapshot()).hardware.memory.availableBytes, availableBytes);
  assert.equal(gpuReads, 1);
});

test("streaming progress resets inactivity while total duration remains bounded", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "model.generate": { totalMs: 5000, firstTokenMs: 2500, inactivityMs: 2200, resourceWaitMs: 100 } } }),
  });
  let chunks = 0;
  const result = await manager.run("model.generate", async ({ reportProgress }) => {
    for (let index = 0; index < 3; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      chunks += 1;
      reportProgress(index / 3);
    }
    return "completed";
  }, { onProgress() {} });
  assert.equal(result, "completed");
  assert.equal(chunks, 3);
});

test("una operación bloqueada después de empezar a progresar agota inactividad, no el límite de inicio", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "document.read": { totalMs: 300, firstTokenMs: 80, inactivityMs: 30, resourceWaitMs: 100 } } }),
  });
  await assert.rejects(manager.run("document.read", ({ signal, reportProgress }) => new Promise((_, reject) => {
    reportProgress(0.1);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), { onProgress() {} }), error => error.code === "ADAPTIVE_TIMEOUT" && error.phase === "inactividad");
});

test("una tarea que ignora la cancelación conserva su plaza hasta finalizar realmente", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "tool.execute": { totalMs: 300, firstTokenMs: 25, inactivityMs: 30, resourceWaitMs: 100 } } }),
  });
  let finishOperation;
  const pending = manager.run("tool.execute", () => new Promise(resolve => { finishOperation = resolve; }), { onProgress() {} });
  await assert.rejects(pending, error => error.code === "ADAPTIVE_TIMEOUT");
  const active = (await manager.getSnapshot()).activeTasks;
  assert.equal(active.length, 1);
  assert.equal(active[0].status, "cancelling");
  finishOperation();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await manager.getSnapshot()).activeTasks.length, 0);
});

test("una tarea que no consigue recursos informa el timeout de cola", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "tool.execute": { totalMs: 1000, resourceWaitMs: 20 } } }),
  });
  manager.configure({ maxConcurrentTasks: 1 });
  let finishOperation;
  const active = manager.run("tool.execute", () => new Promise(resolve => { finishOperation = resolve; }));
  await assert.rejects(
    manager.run("tool.execute", async () => "no debe iniciar"),
    error => error.code === "ADAPTIVE_RESOURCE_WAIT_TIMEOUT",
  );
  finishOperation("terminado");
  assert.equal(await active, "terminado");
});

test("el límite total sigue vigente aunque continúe llegando progreso", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "model.generate": { totalMs: 85, firstTokenMs: 60, inactivityMs: 35, resourceWaitMs: 100 } } }),
  });
  await assert.rejects(manager.run("model.generate", ({ signal, reportProgress }) => new Promise((_, reject) => {
    const timer = setInterval(() => reportProgress(0.5), 10);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      reject(signal.reason);
    }, { once: true });
  }), { onProgress() {} }), error => error.code === "ADAPTIVE_TIMEOUT" && error.phase === "tiempo total");
});

test("el planificador libera una plaza y despacha las tareas interactivas antes del mantenimiento", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "tool.execute": { totalMs: 500, firstTokenMs: 100, inactivityMs: 100, resourceWaitMs: 200 } } }),
  });
  manager.configure({ mode: "economy" });
  const order = [];
  let releaseFirst;
  let started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const first = manager.run("tool.execute", async () => {
    order.push("first");
    started();
    await new Promise(resolve => { releaseFirst = resolve; });
  });
  await firstStarted;
  const maintenance = manager.run("tool.execute", async () => { order.push("maintenance"); }, { priority: "maintenance" });
  const interactive = manager.run("tool.execute", async () => { order.push("interactive"); }, { priority: "interactive" });
  releaseFirst();
  await Promise.all([first, maintenance, interactive]);
  assert.deepEqual(order, ["first", "interactive", "maintenance"]);
});

test("a task without progress is stopped after its inactivity budget and releases its slot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bit-performance-"));
  const historyPath = join(directory, "history.json");
  const manager = new AdaptivePerformanceManager({
    historyPath,
    providers: providers({ budgets: { "document.read": { totalMs: 500, firstTokenMs: 100, inactivityMs: 35, resourceWaitMs: 100 } } }),
  });
  await assert.rejects(manager.run("document.read", ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), { onProgress() {} }), (error) => error.code === "ADAPTIVE_TIMEOUT" && error.phase === "primer token o progreso");
  assert.equal((await manager.getSnapshot()).activeTasks.length, 0);
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  assert.equal(history.entries.at(-1).result, "timeout");
  assert.equal(Object.hasOwn(history.entries.at(-1), "content"), false);
  await rm(directory, { recursive: true, force: true });
});

test("external cancellation releases the queue slot and records no timeout", async () => {
  const manager = new AdaptivePerformanceManager({
    providers: providers({ budgets: { "tool.execute": { totalMs: 500, firstTokenMs: 100, inactivityMs: 100, resourceWaitMs: 100 } } }),
  });
  const controller = new AbortController();
  const running = manager.run("tool.execute", ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new Error("cancelled by user"));
  await assert.rejects(running, /cancelled by user/u);
  assert.equal((await manager.getSnapshot()).activeTasks.length, 0);
});
