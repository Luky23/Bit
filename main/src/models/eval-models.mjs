const prompts = [
  "Saludame de forma breve.",
  "Recordame que mañana revise el calendario.",
  "Escribí en palabras el número 42 para leerlo en voz alta.",
  "Pensalo mejor: diseñá un plan de varios pasos para una página web.",
  "Programá una función que valide una ruta segura."
];

console.log("Evaluación local preparada (sin red ni modelos):");
console.table(prompts.map((prompt) => ({ prompt, fast: "pendiente", heavy: "pendiente", latencyMs: "manual con Ollama local" })));
