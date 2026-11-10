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
