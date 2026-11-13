const DATE = /\b\d{1,2}(?:\s*(?:al|a|[-–])\s*\d{1,2})?\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/iu;
const normalize = text => String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Extrae texto literal de un evento fechado, nunca una fecha de publicación. */
export function findDatedPassage(text, query) {
  const terms = normalize(query).replace(/\b(?:visita|fecha|site)\b/gu, '').match(/[a-z]{3,}/gu) || [];
  const destination = terms.at(-1);
  if (!destination) return '';
  for (const sentence of String(text).match(/[^.!?\n]+[.!?]?/gu) || []) {
    const clean = sentence.replace(/\s+/gu, ' ').trim();
    if (clean.length > 580 || !DATE.test(clean)) continue;
    if (!normalize(clean).includes(destination)) continue;
    if (!/\b(?:llego|llega|llegara|visita|visitara|visito|viaja|viajo|viajara|realizara|celebrara|estara)\b/u.test(normalize(clean))) continue;
    return clean;
  }
  return '';
}

export function datedAnswer(sources, query) {
  for (const source of sources) {
    const passage = findDatedPassage(source.snippet, query);
    if (passage) return { text: `Fecha de la visita: ${passage.match(DATE)[0]}.`, source };
  }
  return null;
}
