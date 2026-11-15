import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, statfs, unlink, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem, availableParallelism } from "node:os";
import { dirname, join } from "node:path";

const HISTORY_LIMIT = 200;
const HISTORY_VERSION = 1;
const MB = 1024 * 1024;
const GB = 1024 * MB;
const TASK_LIMITS = Object.freeze({
  "connection.local": { totalMs: 45_000, maxTotalMs: 180_000, idleMs: 15_000, firstProgressMs: 30_000 },
  "file.search": { totalMs: 60_000, maxTotalMs: 300_000, idleMs: 45_000, firstProgressMs: 60_000 },
  "document.read": { totalMs: 120_000, maxTotalMs: 600_000, idleMs: 90_000, firstProgressMs: 120_000 },
  "file.write": { totalMs: 60_000, maxTotalMs: 300_000, idleMs: 60_000, firstProgressMs: 60_000 },
  "tool.execute": { totalMs: 120_000, maxTotalMs: 900_000, idleMs: 90_000, firstProgressMs: 120_000 },
  "agent.command": { totalMs: 180_000, maxTotalMs: 1_200_000, idleMs: 120_000, firstProgressMs: 180_000 },
  "model.generate": { totalMs: 300_000, maxTotalMs: 1_800_000, idleMs: 120_000, firstProgressMs: 240_000 },
  "model.load": { totalMs: 240_000, maxTotalMs: 1_200_000, idleMs: 180_000, firstProgressMs: 300_000 },
  "image.process": { totalMs: 180_000, maxTotalMs: 900_000, idleMs: 120_000, firstProgressMs: 180_000 },
  "browser.navigation": { totalMs: 90_000, maxTotalMs: 600_000, idleMs: 90_000, firstProgressMs: 120_000 },
});
const PRIORITIES = Object.freeze({ interactive: 0, conversation: 1, workspace: 2, files: 3, maintenance: 4 });

function bounded(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMode(value) {
  return ["automatic", "economy", "balanced", "performance"].includes(value) ? value : "automatic";
}

function validHistory(value) {
  if (!value || value.version !== HISTORY_VERSION || !Array.isArray(value.entries)) return [];
  return value.entries.filter((entry) => entry
    && typeof entry.taskType === "string"
    && Number.isFinite(entry.durationMs)
    && Number.isFinite(entry.complexity)
    && ["completed", "failed", "cancelled", "timeout"].includes(entry.result)
    && Number.isFinite(entry.rssDeltaBytes))
    .slice(-HISTORY_LIMIT);
}

function summarizeCpu(samples, previous) {
  if (!Array.isArray(samples) || !samples.length) {
    return { model: "No disponible", logicalCores: 0, availableCores: 1, utilizationPercent: null };
  }
  const first = samples[0];
  const ticks = samples.reduce((sum, cpu) => {
    const values = Object.values(cpu.times ?? {});
    return sum + values.reduce((total, value) => total + value, 0);
  }, 0);
  const idle = samples.reduce((sum, cpu) => sum + Number(cpu.times?.idle ?? 0), 0);
  let utilizationPercent = null;
  if (previous && previous.ticks >= 0 && ticks > previous.ticks) {
    const totalDelta = ticks - previous.ticks;
    const idleDelta = Math.max(0, idle - previous.idle);
    utilizationPercent = Math.round(bounded((1 - idleDelta / totalDelta) * 100, 0, 100));
  }
  let availableCores = 1;
  try {
    availableCores = Math.max(1, Math.min(samples.length, availableParallelism()));
  } catch (error) {
    availableCores = Math.max(1, samples.length - 1);
  }
  return {
    model: typeof first.model === "string" && first.model.trim() ? first.model.trim() : "No disponible",
    logicalCores: samples.length,
    availableCores,
    utilizationPercent,
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export class AdaptivePerformanceManager {
  constructor({
    historyPath,
    storagePath = process.cwd(),
    providers = {},
    clock = Date.now,
  } = {}) {
    this.historyPath = historyPath;
    this.storagePath = storagePath;
    this.clock = clock;
    this.providers = {
      cpu: providers.cpu ?? (() => cpus()),
      memory: providers.memory ?? (() => ({ totalBytes: totalmem(), availableBytes: freemem() })),
      disk: providers.disk ?? ((path) => statfs(path)),
      gpu: providers.gpu ?? (async () => ({ available: false, reason: "El sistema no expone información GPU verificable." })),
      displays: providers.displays ?? (async () => []),
      os: providers.os ?? (() => ({ platform: platform(), release: release() })),
      processMemory: providers.processMemory ?? (() => process.memoryUsage().rss),
      budgets: providers.budgets ?? {},
    };
    this.mode = "automatic";
    this.maxConcurrentTasks = 0;
    this.hologramQuality = "automatic";
    this.history = [];
    this.historyLoaded = false;
    this.cpuPrevious = null;
    this.hardware = null;
    this.lastRefreshAt = 0;
    this.staticHardware = null;
    this.staticRefreshAt = 0;
    this.refreshing = null;
    this.active = new Map();
    this.queue = [];
    this.reserved = 0;
    this.historyWrite = Promise.resolve();
  }

  configure({ mode, maxConcurrentTasks, hologramQuality } = {}) {
    if (mode !== undefined) this.mode = normalizeMode(mode);
    if (maxConcurrentTasks !== undefined) {
      this.maxConcurrentTasks = Number.isInteger(maxConcurrentTasks) ? bounded(maxConcurrentTasks, 0, 8) : 0;
    }
    if (hologramQuality !== undefined) {
      this.hologramQuality = ["automatic", "low", "medium", "high"].includes(hologramQuality)
        ? hologramQuality
        : "automatic";
    }
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.#refresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  async #refresh() {
    const cpuSamples = this.providers.cpu();
    const cpu = summarizeCpu(cpuSamples, this.cpuPrevious);
    this.cpuPrevious = {
      ticks: cpuSamples.reduce((sum, item) => sum + Object.values(item.times ?? {}).reduce((total, value) => total + value, 0), 0),
      idle: cpuSamples.reduce((sum, item) => sum + Number(item.times?.idle ?? 0), 0),
    };

    const memory = this.providers.memory();
    let staticHardware = this.staticHardware;
    if (!staticHardware || this.clock() - this.staticRefreshAt >= 60_000) {
      const [disk, gpu, displays] = await Promise.all([
        this.#readDisk(),
        this.#readGpu(),
        this.#readDisplays(),
      ]);
      staticHardware = { disk, gpu, displays };
      this.staticHardware = staticHardware;
      this.staticRefreshAt = this.clock();
    }
    this.hardware = {
      sampledAt: new Date(this.clock()).toISOString(),
      cpu,
      memory: {
        totalBytes: Number.isFinite(memory.totalBytes) ? memory.totalBytes : null,
        availableBytes: Number.isFinite(memory.availableBytes) ? memory.availableBytes : null,
      },
      gpu: staticHardware.gpu,
      os: this.providers.os(),
      storage: staticHardware.disk,
      displays: staticHardware.displays,
    };
    this.lastRefreshAt = this.clock();
    return this.hardware;
  }

  async getSnapshot() {
    if (!this.hardware || this.clock() - this.lastRefreshAt >= 5000) await this.refresh();
    await this.#loadHistory();
    return {
      hardware: this.hardware,
      policy: this.#policy(),
      mode: this.mode,
      hologramQuality: this.hologramQuality,
      activeTasks: [...this.active.values()].map((task) => ({
        id: task.id,
        taskType: task.taskType,
        status: task.status,
        elapsedMs: Math.max(0, this.clock() - task.startedAt),
        progress: task.progress,
        lastActivityAt: task.lastActivityAt,
      })),
      queuedTasks: this.queue.length,
    };
  }

  async getBudgets(taskType, { complexity = 1 } = {}) {
    const hardware = this.hardware && this.clock() - this.lastRefreshAt < 5000 ? this.hardware : await this.refresh();
    await this.#loadHistory();
    const limits = TASK_LIMITS[taskType] ?? TASK_LIMITS["tool.execute"];
    const complexityFactor = bounded(Math.sqrt(Number.isFinite(complexity) ? complexity : 1), 0.75, 2.5);
    let resourceFactor = hardware.cpu.availableCores <= 1 ? 1.7 : hardware.cpu.availableCores <= 2 ? 1.35 : 1;
    if (hardware.cpu.utilizationPercent !== null && hardware.cpu.utilizationPercent >= 75) resourceFactor *= 1.25;
    if (hardware.memory.availableBytes !== null && hardware.memory.availableBytes < 2 * GB) resourceFactor *= 1.35;
    const modeFactor = this.mode === "economy" ? 1.35 : this.mode === "performance" ? 1.15 : 1;
    const factor = bounded(complexityFactor * resourceFactor * modeFactor, 0.75, 4);
    let totalMs = Math.round(bounded(limits.totalMs * factor, 15_000, limits.maxTotalMs));

    const samples = this.history.filter((entry) => entry.taskType === taskType && entry.result === "completed");
    if (samples.length >= 5) {
      const similar = samples.filter((entry) => entry.complexity >= complexity / 2 && entry.complexity <= complexity * 2);
      if (similar.length >= 5) {
        const learnedP80 = percentile(similar.map((entry) => entry.durationMs), 0.8);
        totalMs = Math.round(bounded(totalMs * 0.8 + Math.max(totalMs, learnedP80 * 1.35) * 0.2, 15_000, limits.maxTotalMs));
      }
    }

    return {
      connectionMs: Math.round(bounded(10_000 * resourceFactor, 8_000, 30_000)),
      modelLoadMs: Math.round(bounded(limits.firstProgressMs * factor, 30_000, limits.maxTotalMs)),
      firstTokenMs: Math.round(bounded(limits.firstProgressMs * factor, 30_000, limits.maxTotalMs)),
      inactivityMs: Math.round(bounded(limits.idleMs * resourceFactor, 20_000, 300_000)),
      totalMs,
      individualOperationMs: totalMs,
      resourceWaitMs: Math.round(bounded(60_000 * resourceFactor, 30_000, 300_000)),
      ...(this.providers.budgets[taskType] ?? {}),
    };
  }

  async run(taskType, operation, {
    signal,
    complexity = 1,
    priority = "conversation",
    onProgress,
  } = {}) {
    if (typeof taskType !== "string" || !/^[a-z0-9._-]{1,64}$/iu.test(taskType) || typeof operation !== "function") {
      throw new TypeError("La tarea adaptativa requiere un tipo y una función válidos.");
    }
    signal?.throwIfAborted();
    const budgets = await this.getBudgets(taskType, { complexity });
    const id = randomUUID();
    const queuedAt = this.clock();
    try {
      await this.#acquire({ id, taskType, priority, signal, waitMs: budgets.resourceWaitMs });
    } catch (error) {
      await this.#record({
        taskType,
        durationMs: 0,
        queuedMs: Math.max(0, this.clock() - queuedAt),
        complexity: bounded(Number(complexity) || 1, 0.1, 100),
        result: signal?.aborted ? "cancelled" : "timeout",
        timeout: !signal?.aborted,
        rssDeltaBytes: 0,
      });
      throw error;
    }
    const controller = new AbortController();
    const startedAt = this.clock();
    this.reserved -= 1;
    const task = { id, taskType, status: "running", startedAt, progress: null, lastActivityAt: startedAt };
    this.active.set(id, task);
    const externalAbort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", externalAbort, { once: true });

    let firstProgressTimer;
    let idleTimer;
    let totalTimer;
    let timeoutError;
    const timeout = (phase) => {
      timeoutError = Object.assign(new Error(`La tarea ${taskType} superó el límite adaptativo de ${phase}.`), {
        code: "ADAPTIVE_TIMEOUT",
        phase,
      });
      controller.abort(timeoutError);
    };
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => timeout("inactividad"), budgets.inactivityMs);
    };
    const reportProgress = (progress) => {
      if (controller.signal.aborted) return;
      const normalized = typeof progress === "number" && Number.isFinite(progress)
        ? bounded(progress, 0, 1)
        : null;
      task.progress = normalized;
      task.lastActivityAt = this.clock();
      clearTimeout(firstProgressTimer);
      resetIdleTimer();
      if (typeof onProgress === "function") onProgress(normalized);
    };

    totalTimer = setTimeout(() => timeout("tiempo total"), budgets.totalMs);
    if (typeof onProgress === "function") {
      firstProgressTimer = setTimeout(() => timeout("primer token o progreso"), budgets.firstTokenMs);
    }

    const startedMemory = this.providers.processMemory();
    let resultType = "failed";
    let operationPromise;
    try {
      operationPromise = Promise.resolve().then(() => operation({
        signal: controller.signal,
        reportProgress,
        budgets,
      }));
      const abortPromise = new Promise((_, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason);
        else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
      const result = await Promise.race([operationPromise, abortPromise]);
      if (signal?.aborted) throw signal.reason;
      resultType = "completed";
      return result;
    } catch (error) {
      if (timeoutError) resultType = "timeout";
      else if (signal?.aborted) resultType = "cancelled";
      throw error;
    } finally {
      clearTimeout(firstProgressTimer);
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      signal?.removeEventListener("abort", externalAbort);
      if (!controller.signal.aborted) controller.abort();
      const operationSettled = operationPromise
        ? await Promise.race([operationPromise.then(() => true, () => true), Promise.resolve(false)])
        : true;
      if (controller.signal.aborted && !operationSettled) {
        task.status = "cancelling";
        operationPromise.then(
          () => this.#finishTask(id),
          () => this.#finishTask(id),
        );
      } else {
        task.status = resultType;
        this.#finishTask(id);
      }
      await this.#record({
        taskType,
        durationMs: Math.max(0, this.clock() - startedAt),
        queuedMs: Math.max(0, startedAt - queuedAt),
        complexity: bounded(Number(complexity) || 1, 0.1, 100),
        result: resultType,
        timeout: resultType === "timeout",
        rssDeltaBytes: this.providers.processMemory() - startedMemory,
      });
    }
  }

  #policy() {
    const hardware = this.hardware;
    const freeBytes = hardware?.memory.availableBytes;
    const cores = hardware?.cpu.availableCores ?? 1;
    const memorySlots = freeBytes === null || freeBytes === undefined
      ? 1
      : Math.max(1, Math.floor(Math.max(0, freeBytes - 2 * GB) / (2 * GB)) + 1);
    let automatic = Math.min(8, Math.max(1, cores - (cores > 2 ? 1 : 0)), memorySlots);
    if ((hardware?.cpu.utilizationPercent ?? 0) >= 85 || (freeBytes !== null && freeBytes !== undefined && freeBytes < 1 * GB)) {
      automatic = 1;
    }
    const modeLimit = this.mode === "economy" ? 1
      : this.mode === "balanced" ? Math.min(2, automatic)
        : this.mode === "performance" ? Math.min(8, Math.max(1, cores), memorySlots)
          : automatic;
    const maxConcurrentTasks = this.maxConcurrentTasks > 0 ? Math.min(this.maxConcurrentTasks, modeLimit) : modeLimit;
    return {
      maxConcurrentTasks,
      maxConcurrentLimit: this.maxConcurrentTasks,
      workerCount: Math.max(1, Math.min(maxConcurrentTasks, cores)),
      memoryReserveBytes: Math.max(1 * GB, Math.round((hardware?.memory.totalBytes ?? 4 * GB) * 0.2)),
      batchSize: freeBytes !== null && freeBytes !== undefined && freeBytes < 2 * GB ? 1 : freeBytes < 4 * GB ? 4 : 16,
      hologramQuality: this.hologramQuality,
    };
  }

  async #acquire(entry) {
    if (entry.signal?.aborted) throw entry.signal.reason;
    return new Promise((resolve, reject) => {
      const item = { ...entry, resolve, reject, enqueuedAt: this.clock() };
      item.timer = setTimeout(() => {
        this.queue = this.queue.filter((queued) => queued !== item);
        item.signal?.removeEventListener("abort", item.abort);
        reject(Object.assign(new Error(`No hubo recursos disponibles para ${item.taskType} dentro del tiempo de espera adaptativo.`), {
          code: "ADAPTIVE_RESOURCE_WAIT_TIMEOUT",
        }));
      }, item.waitMs);
      item.abort = () => {
        clearTimeout(item.timer);
        this.queue = this.queue.filter((queued) => queued !== item);
        item.signal?.removeEventListener("abort", item.abort);
        reject(item.signal.reason);
      };
      item.signal?.addEventListener("abort", item.abort, { once: true });
      const priorityValue = PRIORITIES[item.priority] ?? PRIORITIES.conversation;
      const index = this.queue.findIndex((queued) => (PRIORITIES[queued.priority] ?? PRIORITIES.conversation) > priorityValue);
      if (index < 0) this.queue.push(item);
      else this.queue.splice(index, 0, item);
      this.#pump();
    });
  }

  #pump() {
    const limit = this.#policy().maxConcurrentTasks;
    while (this.queue.length && this.active.size + this.reserved < limit) {
      const item = this.queue.shift();
      clearTimeout(item.timer);
      item.signal?.removeEventListener("abort", item.abort);
      if (item.signal?.aborted) {
        item.reject(item.signal.reason);
        continue;
      }
      this.reserved += 1;
      item.resolve();
    }
  }

  #release() {
    this.#pump();
  }

  #finishTask(id) {
    this.active.delete(id);
    this.#release();
  }

  async #loadHistory() {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    if (!this.historyPath) return;
    try {
      const parsed = JSON.parse(await readFile(this.historyPath, "utf8"));
      this.history = validHistory(parsed);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw new Error(`No se pudo leer el historial local de rendimiento: ${error.message}`, { cause: error });
    }
  }

  #record(entry) {
    const write = this.historyWrite.catch(() => {}).then(() => this.#persistRecord(entry));
    this.historyWrite = write;
    return write;
  }

  async #persistRecord(entry) {
    await this.#loadHistory();
    this.history.push({
      at: new Date(this.clock()).toISOString(),
      taskType: entry.taskType,
      durationMs: entry.durationMs,
      queuedMs: entry.queuedMs,
      complexity: entry.complexity,
      result: entry.result,
      timeout: entry.timeout,
      rssDeltaBytes: entry.rssDeltaBytes,
    });
    this.history = this.history.slice(-HISTORY_LIMIT);
    if (!this.historyPath) return;
    const temporaryPath = join(dirname(this.historyPath), `.${randomUUID()}.tmp`);
    await mkdir(dirname(this.historyPath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify({ version: HISTORY_VERSION, entries: this.history }), { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, this.historyPath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          throw new Error(`No se pudo guardar el historial de rendimiento ni limpiar el archivo temporal: ${cleanupError.message}`, {
            cause: error,
          });
        }
      }
      throw new Error(`No se pudo guardar el historial local de rendimiento: ${error.message}`, { cause: error });
    }
  }

  async #readDisk() {
    try {
      const info = await this.providers.disk(this.storagePath);
      const blockSize = Number(info.bsize ?? info.frsize ?? 0);
      return {
        available: true,
        totalBytes: Number(info.blocks) * blockSize,
        freeBytes: Number(info.bavail ?? info.bfree) * blockSize,
      };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async #readGpu() {
    let timer;
    try {
      const result = await Promise.race([
        this.providers.gpu(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("La consulta GPU superó su presupuesto de sondeo de 5 segundos.")), 5000);
        }),
      ]);
      return result && typeof result === "object"
        ? { ...result }
        : { available: false, reason: "El sistema no devolvió datos GPU válidos." };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async #readDisplays() {
    try {
      const result = await this.providers.displays();
      return Array.isArray(result)
        ? { available: true, monitors: result }
        : { available: false, monitors: [], error: "El sistema no devolvió datos de pantallas válidos." };
    } catch (error) {
      return { available: false, monitors: [], error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export { TASK_LIMITS };
