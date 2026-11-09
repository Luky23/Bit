const isWeatherSearchRequest = (message) => /\b(?:clima|pron[oó]stico|temperatura actual)\b|\b(?:qu[eé]|c[oó]mo)\b.{0,20}\btiempo\b|\btiempo\b.{0,20}\b(?:hace|hoy|actual|ahora)\b/iu.test(String(message ?? ""));

const cases = [
  "¿Cómo está el clima en Buenos Aires?",
  "¿Cómo está el clima?",
  "¿Qué tiempo hace en Buenos Aires?",
  "¿Cómo está el tiempo en Buenos Aires?",
  "¿Qué tiempo hace hoy en Buenos Aires?",
  "¿Cuál es la temperatura en Buenos Aires?",
  "clima en Buenos Aires",
  "el pronóstico de hoy",
];
for (const c of cases) console.log(JSON.stringify(c), "=> weather?", isWeatherSearchRequest(c));

console.log("--- regex internals ---");
console.log("qu[eé] con \\b:", /\b(?:qu[eé]|c[oó]mo)\b.{0,20}\btiempo\b/iu.test("¿Qué tiempo hace en Buenos Aires?"));
console.log("c[oó]mo con \\b:", /\b(?:qu[eé]|c[oó]mo)\b/iu.test("¿Cómo está el clima?"));
console.log("pron[oó]stico con \\b:", /\b(?:pron[oó]stico|temperatura actual)\b/iu.test("¿Cuál es el pronóstico?"));
console.log("clima con \\b:", /\b(?:clima|pron[oó]stico|temperatura actual)\b/iu.test("clima en Buenos Aires"));

const isWebSearchRequest = (input) => {
  const explicitSearch = /(?:\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]).{0,60}\b(?:internet|web|google|online|red)\b|\b(?:internet|web)\b.{0,60}\b(?:b[uú]sc(?:a|ar|ame|á)|investiga(?:r)?|consulta(?:r)?|averigua(?:r)?|search)(?=$|[^\p{L}\p{N}_]))/iu;
  const currentTopic = /\b(?:noticias|actualidad|cotizaci[oó]n|precio actual)\b/iu.test(input);
  const currentQualifier = /\b(?:hoy|actual|ahora|[uú]ltim[oa]s?|reciente)\b.{0,50}\b(?:noticias|precio|cotizaci[oó]n|temperatura|resultado|informaci[oó]n)\b/iu.test(input);
  const asksCurrentTopic = /\b(?:qu[eé]|c[oó]mo|cu[aá]l|cu[aá]nto|qui[eé]n|d[oó]|d[oó]nde)\b/iu.test(input);
  return explicitSearch || isWeatherSearchRequest(input) || currentQualifier || (currentTopic && asksCurrentTopic);
};
for (const c of cases) console.log(JSON.stringify(c), "=> webSearch?", isWebSearchRequest(c));
