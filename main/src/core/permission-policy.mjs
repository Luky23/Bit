export const AUTONOMY_LEVELS = Object.freeze(["conservative", "balanced", "autonomous"]);

export const PERMISSION_CATEGORIES = Object.freeze({
  "app.open": { risk: "low", label: "Abrir aplicaciones instaladas" },
  "browser.open": { risk: "low", label: "Abrir páginas y búsquedas" },
  "music.play": { risk: "low", label: "Reproducir y controlar música" },
  "web.search": { risk: "low", label: "Buscar información en Internet" },
  "file.read": { risk: "low", label: "Abrir documentos autorizados" },
  "workspace.read": { risk: "low", label: "Leer archivos de proyectos" },
  "workspace.view": { risk: "low", label: "Mostrar proyectos y vistas 3D" },
  "system.read": { risk: "low", label: "Consultar información del sistema" },
  "workspace.write": { risk: "medium", label: "Crear o modificar archivos de proyectos" },
  "memory.write": { risk: "medium", label: "Guardar información en la memoria local" },
  "config.change": { risk: "medium", label: "Cambiar preferencias de Bit" },
  "file.move": { risk: "medium", label: "Mover archivos autorizados" },
  "file.delete": { risk: "high", label: "Eliminar archivos" },
  "system.settings": { risk: "high", label: "Cambiar configuración de Windows" },
  "system.execute": { risk: "high", label: "Ejecutar comandos o software" },
  "data.send": { risk: "high", label: "Enviar información a terceros" },
  "financial.purchase": { risk: "high", label: "Realizar compras o pagos" },
  "code.change": { risk: "high", label: "Modificar el código de Bit" },
});

export const DEFAULT_AUTONOMOUS_CATEGORIES = Object.freeze(
  Object.entries(PERMISSION_CATEGORIES)
    .filter(([, definition]) => definition.risk !== "high")
    .map(([category]) => category),
);

const REMEMBERABLE_CATEGORIES = new Set(["workspace.write", "memory.write", "config.change", "file.move"]);
const VALID_GRANT_SCOPE = /^[^\u0000-\u001f\u007f*?]{1,512}$/u;

export function normalizePermissionGrants(value) {
  if (!Array.isArray(value) || value.length > 200) {
    return { ok: false, error: "permissionGrants debe contener hasta 200 permisos específicos" };
  }
  const result = [];
  const seen = new Set();
  for (const grant of value) {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)
      || Object.keys(grant).some((key) => key !== "category" && key !== "scope")
      || !REMEMBERABLE_CATEGORIES.has(grant.category)
      || typeof grant.scope !== "string" || !VALID_GRANT_SCOPE.test(grant.scope.trim())) {
      return { ok: false, error: "Cada permiso recordado debe limitarse a una categoría reversible y un recurso exacto" };
    }
    const normalized = { category: grant.category, scope: grant.scope.trim() };
    const key = `${normalized.category}\0${normalized.scope}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return { ok: true, value: result };
}

export function permissionGrantMatches(grants, category, scope) {
  return Array.isArray(grants)
    && typeof scope === "string"
    && grants.some((grant) => grant?.category === category && grant.scope === scope);
}

export function evaluatePermission(request, preferences = {}) {
  const category = request?.category;
  const definition = PERMISSION_CATEGORIES[category];
  if (!definition) {
    return { decision: "prompt", risk: "high", reason: "La categoría no está clasificada", rememberable: false };
  }

  const risk = definition.risk;
  const autonomyLevel = AUTONOMY_LEVELS.includes(preferences.autonomyLevel)
    ? preferences.autonomyLevel
    : "conservative";
  const directUser = request.directUser === true;
  if (request.externalContent === true && request.modifiesState === true) {
    return { decision: "deny", category, risk, reason: "El contenido externo no puede autorizar cambios", rememberable: false };
  }
  if (risk === "high") {
    return { decision: "prompt", category, risk, reason: "Las acciones de alto riesgo siempre requieren confirmación", rememberable: false };
  }
  const scopeAuthorized = request.scopeAuthorized === true;
  const scope = typeof request.scope === "string" ? request.scope : "";
  if (risk === "medium") {
    const reversible = request.reversible === true;
    if (!scopeAuthorized || !reversible || !scope) {
      return { decision: "prompt", category, risk, reason: "Falta un alcance autorizado y reversible", rememberable: false };
    }
    if (permissionGrantMatches(preferences.permissionGrants, category, scope)
      && (directUser || autonomyLevel === "autonomous")) {
      return { decision: "allow", category, risk, reason: "Permiso recordado para este recurso", rememberable: false };
    }
    if (!directUser) {
      return { decision: "prompt", category, risk, reason: "La sugerencia del modelo no sustituye una instrucción directa ni un permiso específico", rememberable: false };
    }
    const enabled = Array.isArray(preferences.permissionAutoCategories)
      ? preferences.permissionAutoCategories
      : DEFAULT_AUTONOMOUS_CATEGORIES;
    if (autonomyLevel !== "conservative" && enabled.includes(category)) {
      return { decision: "allow", category, risk, reason: "Instrucción directa, alcance local y reversibilidad verificados", rememberable: true };
    }
    return {
      decision: "prompt",
      category,
      risk,
      reason: autonomyLevel === "conservative"
        ? "El nivel conservador confirma las acciones de riesgo medio"
        : "La autorización automática está desactivada para esta categoría",
      rememberable: true,
    };
  }

  if (!directUser) {
    return { decision: "prompt", category, risk, reason: "La sugerencia del modelo no sustituye una instrucción directa", rememberable: false };
  }
  const enabled = Array.isArray(preferences.permissionAutoCategories)
    ? preferences.permissionAutoCategories
    : DEFAULT_AUTONOMOUS_CATEGORIES;
  if (!scopeAuthorized) {
    return { decision: "prompt", category, risk, reason: "El recurso no está dentro del alcance autorizado", rememberable: false };
  }
  if (enabled.includes(category)) {
    return { decision: "allow", category, risk, reason: "Categoría segura solicitada directamente por el usuario", rememberable: false };
  }
  return { decision: "prompt", category, risk, reason: "La autorización automática está desactivada para esta categoría", rememberable: false };
}

export function requiresExecutionAuthorization(targetInfo, {
  directUser = true,
  preferences = {},
} = {}) {
  if (!targetInfo || typeof targetInfo !== "object") return true;
  const categoryByType = {
    executable: targetInfo.args ? "system.execute" : "app.open",
    url: "browser.open",
    file: "file.read",
    protocol: "system.settings",
  };
  const category = categoryByType[targetInfo.type];
  if (!category) return true;
  const decision = evaluatePermission({
    category,
    directUser,
    scopeAuthorized: true,
    reversible: targetInfo.type === "file" || targetInfo.type === "executable",
    modifiesState: targetInfo.type === "executable" || targetInfo.type === "protocol",
  }, preferences);
  return decision.decision !== "allow";
}
