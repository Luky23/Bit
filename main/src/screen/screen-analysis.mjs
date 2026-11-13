export function isVideoTopicQuestion(prompt) {
  const text = String(prompt ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\bvideo\b/u.test(text) && /\b(?:de que (?:es|trata|va|habla)|tema|resum(?:e|en|i)|explica(?:me)?)\b/u.test(text);
}

export function videoTopicLimitation(prompt, ocrText) {
  if (!isVideoTopicQuestion(prompt)) return '';
  const text = String(ocrText ?? '').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, '').replace(/\s+/gu, ' ').trim();
  if (text.length >= 120) return '';
  return 'Con un solo fotograma y ese fragmento de texto no puedo confirmar de qué trata el video completo. No escuché su audio; muestre el título o subtítulos con más contexto para que pueda explicarlo.';
}

export function isPhoneIdentityQuestion(prompt) {
  const text = String(prompt ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\b(?:celular(?:es)?|telefonos?|movil(?:es)?)\b/u.test(text)
    && /\b(?:(?:que|cuales)\s+(?:celular(?:es)?|telefonos?|movil(?:es)?)|modelos?|marcas?|identifica(?:r)?|reconoce(?:r)?)\b/u.test(text);
}

export function shouldAnalyzeScreenVisually(prompt, hasOcrText) {
  if (!hasOcrText) return true;
  if (isPhoneIdentityQuestion(prompt)) return true;
  if (isVideoTopicQuestion(prompt)) return false;
  const normalized = String(prompt ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(?:imagen|foto|objeto|persona|video|escena|colores?|icono|grafico|dibujo|diagrama|figura|aspecto|diseno)\b/u.test(normalized)) return true;
  return !/\b(?:que ves|que vez|que hay|pantalla|abierto|pagina|lee|leer|texto|documento|parrafo|palabras|que dice|escrito)\b/u.test(normalized);
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
