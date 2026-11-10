const HEAVY = /\b(c[oó]digo|programa|programar|funci[oó]n|caracter[ií]stica|agregar|agrega|a[nñ]adir|a[nñ]ade|mejorar|mejora|p[aá]gina|web|documento|planilla|presentaci[oó]n|proyecto|proyectos|archivo|archivos|respaldo|respaldos|restaurar|crear|escribir|modificar|editar|actualizar|plan de varios|pensalo mejor|razon[aá])\b/i;
const VISION = /\b(pantalla|screen|se[ñn]ala|señalar|ves|ver esto|captura)\b/i;
const LIGHT = /\b(hola|buenos d[ií]as|buenas tardes|buenas noches|charla|voz|resumen|recordatorio|record[aá]me)\b/i;

export function routeRequest(text, options = {}) {
  const input = typeof text === "string" ? text.trim() : "";
  if (VISION.test(input) && options.visionModel) return { role: "vision", model: options.visionModel, reason: "pantalla" };
  if (HEAVY.test(input)) return { role: "heavy", model: options.model, reason: "tarea pesada" };
  if (LIGHT.test(input) || input.length < 80) return { role: "fast", model: options.fastModel, reason: "interacción liviana" };
  return { role: "fast", model: options.fastModel, reason: "predeterminado seguro" };
}

export function fallbackRoute(route, options) {
  if (route.role === "fast") return route;
  return { role: "fast", model: options.fastModel, reason: `${route.reason}; respaldo por falla del modelo` };
}
