import { test } from "node:test";
import assert from "node:assert/strict";
import { emisionM2 } from "./index.js";
import { briefM2 } from "./fixtures.js";

test("emisionM2 acepta el brief que el M2 produce hoy", () => {
  const r = emisionM2.safeParse(briefM2());
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
});

// --- Fixtures NEGATIVOS. Un validador se prueba con lo que tiene que RECHAZAR: un fixture positivo
// --- sigue pasando aunque el esquema se relaje, así que no prueba que la exigencia siga en pie.
// --- Lo señaló la 14ª review sobre la matriz de mutaciones de la spec.

test("emisionM2 RECHAZA un brief sin meta_run", () => {
  const { meta_run, ...sinMeta } = briefM2();
  assert.equal(emisionM2.safeParse(sinMeta).success, false);
});

test("emisionM2 RECHAZA un brief sin run_id ni generated_at", () => {
  const { run_id, generated_at, ...sinIds } = briefM2();
  assert.equal(emisionM2.safeParse(sinIds).success, false);
});

test("emisionM2 RECHAZA un url_slug que no empieza con /", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.url_slug = "hamburgueseria-madrid-centro";
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA una página sin evidencia", () => {
  const b = briefM2();
  // @ts-expect-error: se borra a propósito para probar que el esquema lo exige.
  delete b.paginas_propuestas[0]!.evidencia;
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA una dificultad fuera de 0..100", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.dificultad = 101;
  assert.equal(emisionM2.safeParse(b).success, false);
});

// --- Los tres de abajo cubren las exigencias que `emisionM2` añade con `.extend()` sobre el piso de
// --- `esquemaBase`. Sin ellos, borrar un `.extend()` no tumbaría ningún test y la exigencia del M2 se
// --- perdería en silencio al aflojarse a la forma laxa del consumo.

test("emisionM2 RECHAZA un meta_title vacío (exigencia del M2, no del piso)", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.seo.meta_title = "";
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA un word_count_objetivo que no es entero positivo", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.content_brief.word_count_objetivo = 0;
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA un location_code fraccionario", () => {
  assert.equal(
    emisionM2.safeParse(briefM2({ market: { country: "ES", language_code: "es", location_code: 1.5 } }))
      .success,
    false,
  );
});
