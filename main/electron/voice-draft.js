/* Correcciones explícitas del dictado local, sin enviar audio ni texto fuera del equipo. */
(function exposeVoiceDraft(global) {
  function clean(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
  }

  function replaceTail(prefix, replacement) {
    const left = clean(prefix).replace(/[,:;.!?]+$/u, '').trim();
    const right = clean(replacement).replace(/^[,:;.!?]+/u, '').trim();
    if (!left) return right;
    const comma = left.lastIndexOf(',');
    if (comma >= 0) return clean(`${left.slice(0, comma)} ${right}`);
    const words = left.split(/\s+/u);
    return clean(`${words.length > 1 ? words.slice(0, -1).join(' ') : ''} ${right}`);
  }

  function correctSpokenText(text) {
    const value = clean(text);
    if (!value) return '';

    // Ejemplos: «abrí Chrome, no, quise decir Edge» o «corrijo: abrir Edge».
    const standalone = value.match(/^(?:corrijo|corrección|mejor dicho)\s*[:,]?\s+(.+)$/iu);
    if (standalone) return clean(standalone[1]);
    const explicit = value.match(/^(.*?)(?:,?\s+(?:no,?\s+)?(?:quise decir|quería decir|perd[oó]n,?\s+quise decir)|\s+(?:corrijo|corrección|mejor dicho)\s*[:,]?)\s+(.+)$/iu);
    if (explicit) return replaceTail(explicit[1], explicit[2]);

    // Ejemplo: «abrir Chrome, lo cambio por Edge».
    const replacement = value.match(/^(.*?)\s+(?:lo\s+)?cambio\s+por\s+(.+)$/iu);
    if (replacement) return replaceTail(replacement[1], replacement[2]);

    return value;
  }

  global.BitVoiceDraft = Object.freeze({ clean, correctSpokenText });
})(typeof window === 'object' ? window : globalThis);
