import { test } from "node:test";
import assert from "node:assert/strict";
import { juegoDe } from "./plantilla.js";

test("juegoDe('correduria_seguros') devuelve el juego SEGUROS, sin platosDestacados/cartaCategorias-only", () => {
  const juego = juegoDe("correduria_seguros");
  assert.equal(juego.id, "seguros");
  assert.ok(!juego.story.contenido.includes("platosDestacados"));
});

test("juegoDe('restauracion') sigue devolviendo BASE, sin regresión", () => {
  const juego = juegoDe("restauracion");
  assert.equal(juego.id, "base");
});
