/**
 * Convierte una respuesta ya producida en una tarjeta visual segura. La tarjeta
 * no interpreta HTML: el renderer la inserta exclusivamente con textContent.
 */
function normalizedText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitCardText(text) {
  const sentence = text.match(/^(.{1,120}?[.!?])(?:\s|$)/u);
  if (sentence) {
    const detail = text.slice(sentence[1].length).trim();
    if (detail) return { value: sentence[1], detail: detail.slice(0, 600) };
  }
  if (text.length <= 120) return { value: text, detail: "" };
  const cut = text.lastIndexOf(" ", 120);
  const end = cut >= 48 ? cut : 120;
  return { value: text.slice(0, end).trim(), detail: text.slice(end).trim().slice(0, 600) };
}

function cardContext(message, hasSources) {
  const prompt = normalizedText(message).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (hasSources) return { label: "RESULTADO WEB", badge: "INTERNET", icon: "⌁" };
  if (/\b(?:pantalla|screen|que ves|que hay abierto|que dice)\b/u.test(prompt)) {
    return { label: "PANTALLA", badge: "LECTURA LOCAL", icon: "◉" };
  }
  if (/\b(?:abri|abrir|abre|ejecuta|inicia|busca archivo|encuentra archivo)\b/u.test(prompt)) {
    return { label: "ACCIÓN LOCAL", badge: "EQUIPO", icon: "✓" };
  }
  return { label: "RESPUESTA", badge: "BIT LOCAL", icon: "◌" };
}

/**
 * Crea una tarjeta reutilizable para cualquier respuesta textual de Bit.
 * Una tarjeta especializada (por ejemplo, clima) puede reemplazarla.
 */
export function createAnswerCard({ message = "", text = "", sources = [] } = {}) {
  const answer = normalizedText(text);
  if (!answer) return null;
  const context = cardContext(message, Array.isArray(sources) && sources.length > 0);
  return { kind: "answer", ...context, ...splitCardText(answer) };
}
