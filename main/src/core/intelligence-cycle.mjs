/**
 * Núcleo agnóstico del ciclo general de Bit.
 *
 * No ejecuta comandos ni concede permisos: recibe herramientas declaradas y
 * funciones inyectadas. Esto permite reutilizar el mismo ciclo para texto,
 * voz, archivos, pantalla y proyectos sin crear agentes por dominio.
 */

export const CYCLE_STAGES = Object.freeze([
  "understand",
  "reason",
  "plan",
  "execute",
  "verify",
  "learn",
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createToolRegistry(tools = []) {
  const registry = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== "string" || !tool.name.trim()) throw new TypeError("Toda herramienta necesita un nombre");
    if (registry.has(tool.name)) throw new Error(`Herramienta duplicada: ${tool.name}`);
    registry.set(tool.name, Object.freeze({ ...tool, name: tool.name.trim() }));
  }
  return Object.freeze({
    list: () => [...registry.values()],
    get: (name) => registry.get(name),
    select: (capabilities = []) => {
      const wanted = new Set(capabilities);
      return [...registry.values()].filter((tool) => !wanted.size || (tool.capabilities || []).some((capability) => wanted.has(capability)));
    },
  });
}

export function createPlan({ objective, steps = [] } = {}) {
  if (typeof objective !== "string" || !objective.trim()) throw new TypeError("El objetivo del plan es obligatorio");
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    objective: objective.trim(),
    status: "planned",
    steps: steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, ...step, status: step.status || "pending" })),
  };
}

export async function runIntelligenceCycle({ input, context = {}, registry, understand, reason, plan, execute, verify, learn } = {}) {
  if (!registry || typeof registry.list !== "function") throw new TypeError("registry es obligatorio");
  if (typeof understand !== "function" || typeof reason !== "function" || typeof plan !== "function" || typeof execute !== "function" || typeof verify !== "function") {
    throw new TypeError("Faltan etapas del ciclo inteligente");
  }
  const trace = [];
  const stage = async (name, fn, value) => {
    const result = await fn(value, { input, context, registry, trace });
    trace.push({ stage: name, ok: true });
    return result;
  };
  const understanding = await stage("understand", understand, input);
  const reasoning = await stage("reason", reason, understanding);
  const executionPlan = await stage("plan", plan, reasoning);
  const execution = await stage("execute", execute, executionPlan);
  const verification = await stage("verify", verify, execution);
  const learning = typeof learn === "function" ? await stage("learn", learn, { input, understanding, reasoning, executionPlan, execution, verification }) : null;
  return { input, understanding, reasoning, plan: executionPlan, execution, verification, learning, trace };
}

export function createExperienceRecord({ objective, context = {}, plan = null, actions = [], result = null, errors = [], corrections = [], evaluation = null } = {}) {
  return Object.freeze({
    version: 1,
    objective: String(objective || "").slice(0, 2000),
    context: clone(context),
    plan: clone(plan),
    actions: clone(actions),
    result: clone(result),
    errors: clone(errors),
    corrections: clone(corrections),
    evaluation: clone(evaluation),
    createdAt: new Date().toISOString(),
  });
}
