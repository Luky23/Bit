export function shouldAnalyzeScreenVisually(prompt, hasOcrText) {
  if (!hasOcrText) return true;
  const normalized = String(prompt ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(?:que ves|que hay|imagen|foto|objeto|persona|video|escena|colores?|aparece|muestra|describe|descripcion|icono|grafico|dibujo)\b/u.test(normalized)) return true;
  return !/\b(?:lee|leer|texto|documento|parrafo|palabras|que dice|escrito)\b/u.test(normalized);
}

export function chooseVisionModel(names) {
  return [
    names.find((name) => /qwen2\.5vl(?::3b)?/iu.test(name)),
    names.find((name) => /^(?:llava|gemma3)(?::|$)/iu.test(name)),
    names.find((name) => /^moondream(?::|$)/iu.test(name)),
    names.find((name) => /(?:vision|vl)/iu.test(name)),
  ].find(Boolean) || "";
}

/** Selecciona únicamente modelos locales cuya capacidad visual confirma Ollama. */
export async function resolveInstalledVisionModel(requested, client) {
  const installed = await client.list();
  const names = installed.map((entry) => entry.name || entry.model).filter(Boolean);
  const configured = names.find((name) => name === requested)
    || names.find((name) => name === `${requested}:latest`);
  const candidates = [...new Set([configured, chooseVisionModel(names), ...names].filter(Boolean))];
  for (const name of candidates) {
    if ((await client.show(name)).vision === true) return name;
  }
  throw new Error("No hay un modelo visual instalado en Ollama. Configure uno local que admita imágenes; Bit no descarga modelos automáticamente.");
}
