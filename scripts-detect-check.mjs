function normalizeWeatherInput(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
const WEATHER_TOPIC_PATTERN = /\b(?:clima|pronostico|pronostica|temperatura|temperaturas|meteorologia|meteorologico|meteorologica|weather)\b/i;
const WEATHER_TIME_PATTERN = /\btiempo\b/i;
const WEATHER_CONTEXT_PATTERN = /\b(?:hace|hoy|ahora|actual|actualmente|estan|sera|haya|hara|habra|va|van|saldra|saldran|prevision|pronostico|forecast|llovia|lluvi|neblina|nublado|nublada|soleado|despejado|despejada|parcial|helada|tormenta|chubasco|helado|niebla|inundacion|lluvia|lluviosa|meteorologico|meteorologica|lluvioso|lluviosa)\b/i;
const WEATHER_QUESTION_PATTERN = /\b(?:que|quien|como|cual|donde|what|which|who|how|where|what|which|who|how|which|where|what|which|who|how)\b/i;
function isWeatherSearchRequestImpl(message) {
  const normalized = normalizeWeatherInput(message);
  const topic = WEATHER_TOPIC_PATTERN.test(normalized) || (WEATHER_TIME_PATTERN.test(normalized) && (WEATHER_CONTEXT_PATTERN.test(normalized) || WEATHER_QUESTION_PATTERN.test(normalized)));
  return topic;
}
const cases = [
  ["¿Cómo está el clima?", true],
  ["¿Cómo está el clima en Madrid?", true],
  ["y en brazil", false],
  ["¿Qué idiomas hablan en Brasil?", false],
  ["¿Cuánto tiempo falta?", false],
  ["No me gustan las noticias", false],
  ["Hola, ¿cómo estás?", false],
  ["¿Cuál es la temperatura en Buenos Aires?", true],
  ["¿Qué temperatura hace en Buenos Aires?", true],
  ["el clima hoy en Buenos Aires", true],
  ["qué tiempo hace", true],
  ["¿Qué hay del tiempo en Córdoba?", true],
  ["¿Qué tiempo hace hoy en Buenos Aires?", true],
  ["¿Cómo está el tiempo en Buenos Aires?", true],
  ["¿Qué clima hace en Buenos Aires?", true],
  ["¿Hace cuánto tiempo que llovia?", true],
  ["pronostico de buenos aires", true],
  ["temperatura en buenos aires", true],
  ["tiempo en buenos aires", false],
];
let failures = 0;
for (const [c, expected] of cases) {
  const actual = isWeatherSearchRequestImpl(c);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(ok ? "OK  " : "FAIL", JSON.stringify(c), "=>", actual, "(esperado", expected + ")");
}
console.log(failures === 0 ? "TODOS OK" : `${failures} FALLOS`);
