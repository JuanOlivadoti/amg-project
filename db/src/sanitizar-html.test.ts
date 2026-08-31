import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizarHtml } from "./sanitizar-html.js";

test("permite las tags de la allowlist", () => {
  const entrada = "<p>Hola <strong>mundo</strong>, mirá <a href=\"https://x.com\">esto</a>.</p>";
  assert.equal(sanitizarHtml(entrada), entrada);
});

test("🔴 descarta <script> por completo", () => {
  const salida = sanitizarHtml('<p>Hola</p><script>alert(1)</script>');
  assert.ok(!salida.includes("<script"), "el tag script no debe sobrevivir");
  assert.ok(!salida.includes("alert(1)"), "el contenido del script tampoco");
});

test("🔴 descarta un atributo onerror/onclick", () => {
  const salida = sanitizarHtml('<p onclick="alert(1)">Hola</p>');
  assert.ok(!salida.includes("onclick"));
});

test("🔴 descarta un href javascript:", () => {
  const salida = sanitizarHtml('<a href="javascript:alert(1)">click</a>');
  assert.ok(!salida.includes("javascript:"));
});

test("🔴 descarta un tag fuera de la allowlist (ej. <img>) pero conserva el texto de alrededor", () => {
  const salida = sanitizarHtml('<p>antes<img src="x">después</p>');
  assert.ok(!salida.includes("<img"));
  assert.ok(salida.includes("antes"));
  assert.ok(salida.includes("después"));
});

// Codex, ronda 1 sobre el plan, hallazgo Minor: `allowedSchemes` solo filtra esquemas EXPLÍCITOS
// (http:, https:, javascript:) — por defecto, `sanitize-html` conserva enlaces relativos
// (`href="/ruta"`) porque no tienen esquema que filtrar. Un link relativo dentro del post ("leé
// también /otro-post-del-mismo-blog") es contenido legítimo, así que se decide permitirlo
// explícitamente. Lo que SÍ hay que cerrar aparte son los protocol-relative (`href="//evil.com"`,
// que el navegador resuelve con el protocolo de la página actual): `allowProtocolRelative: false`.
test("permite un href relativo (sin esquema)", () => {
  const entrada = '<p>Mirá <a href="/otro-post">este</a>.</p>';
  assert.equal(sanitizarHtml(entrada), entrada);
});

test("🔴 descarta un href protocol-relative (//host)", () => {
  const salida = sanitizarHtml('<a href="//evil.com/x">click</a>');
  assert.ok(!salida.includes("//evil.com"), "protocol-relative no es lo mismo que 'enlaces http(s)'");
});
