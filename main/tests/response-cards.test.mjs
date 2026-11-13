import test from "node:test";
import assert from "node:assert/strict";
import { createAnswerCard } from "../src/core/response-cards.mjs";

test("tarjetas de respuesta: resume cualquier respuesta de Bit sin usar HTML", () => {
  const card = createAnswerCard({
    message: "¿Qué ve en la pantalla?",
    text: "Veo una ventana del Bloc de notas con una lista de tareas.",
  });

  assert.deepEqual(card, {
    kind: "answer",
    label: "PANTALLA",
    badge: "LECTURA LOCAL",
    icon: "◉",
    value: "Veo una ventana del Bloc de notas con una lista de tareas.",
    detail: "",
  });
});

test("tarjetas de respuesta: conserva el resultado web como texto no ejecutable", () => {
  const card = createAnswerCard({
    message: "Buscá novedades de seguridad",
    text: "La actualización está disponible. <script>alert(1)</script>",
    sources: [{ title: "Boletín oficial" }],
  });

  assert.equal(card.label, "RESULTADO WEB");
  assert.equal(card.badge, "INTERNET");
  assert.equal(card.value, "La actualización está disponible.");
  assert.equal(card.detail, "<script>alert(1)</script>");
});
