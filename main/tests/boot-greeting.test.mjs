import test from "node:test";
import assert from "node:assert/strict";
import { createStartupGreeting } from "../electron/boot.js";

function franjaDe(date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "numeric",
    hourCycle: "h23",
  }).format(date));
  return hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
}

test("el saludo no se repite entre arranques consecutivos (historial reciente)", () => {
  const now = new Date("2026-11-03T10:00:00-03:00");
  const usados = [];
  for (let i = 0; i < 8; i++) {
    const saludo = createStartupGreeting("Luca", now, () => 0, usados);
    assert.ok(!usados.includes(saludo), `se repitió un saludo previo: ${saludo}`);
    usados.push(saludo);
  }
  assert.equal(usados.length, new Set(usados).size, "los 8 saludos generados deberían ser distintos");
});

test("mantiene compatibilidad con un solo saludo previo (string)", () => {
  const now = new Date("2026-11-03T10:00:00-03:00");
  const previo = createStartupGreeting("Luca", now, () => 0);
  const siguiente = createStartupGreeting("Luca", now, () => 0, previo);
  assert.notEqual(siguiente, previo);
});

test("cuando todos los variantes están recientes, devuelve uno de la lista completa", () => {
  const now = new Date("2026-11-03T10:00:00-03:00");
  const todos = [];
  for (let i = 0; i < 8; i++) {
    todos.push(createStartupGreeting("Luca", now, () => i / 8, todos));
  }
  assert.equal(todos.length, new Set(todos).size, "debería agotar las 8 variantes antes del fallback");
  const siguiente = createStartupGreeting("Luca", now, () => 0, todos);
  assert.ok(todos.includes(siguiente), `fuera del conjunto de variantes: ${siguiente}`);
});

test("respeta la franja horaria de Buenos Aires según la fecha pasada", () => {
  const casos = [
    ["2026-11-03T09:00:00-03:00", "Buenos días"],
    ["2026-11-03T15:00:00-03:00", "Buenas tardes"],
    ["2026-11-03T22:00:00-03:00", "Buenas noches"],
  ];
  for (const [iso, esperado] of casos) {
    const ahora = new Date(iso);
    const horaBA = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "numeric",
      hourCycle: "h23",
    }).format(ahora));
    assert.equal(
      horaBA < 12 ? "Buenos días" : horaBA < 20 ? "Buenas tardes" : "Buenas noches",
      esperado,
      `franja esperada para ${iso}`,
    );
    const saludo = createStartupGreeting("Luca", ahora, () => 0);
    assert.ok(saludo.startsWith(`${esperado}, Luca`), `saludo inesperado para ${iso}: ${saludo}`);
  }
});

test("usa 'amigo' cuando no hay nombre de usuario", () => {
  const ahora = new Date("2026-11-03T10:00:00-03:00");
  assert.ok(createStartupGreeting(null, ahora, () => 0).startsWith("Buenos días, amigo"));
});
