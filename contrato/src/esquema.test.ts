import { test } from "node:test";
import assert from "node:assert/strict";
import { consumoM1, emisionM2, parseBrief, SUPPORTED_SCHEMA_VERSIONS } from "./index.js";
import { briefM1, briefM2 } from "./fixtures.js";

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

// --- `consumoM1` — el derivado LAXO. Lo que se prueba acá es lo que ACEPTA: cada laxitud es
// --- deliberada (briefs viejos que siguen siendo publicables), así que un endurecimiento accidental
// --- es el fallo a evitar, no el rechazo.

test("consumoM1 acepta un brief kr.v0.2 sin meta_run ni evidencia", () => {
  const r = consumoM1.safeParse(briefM1());
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
});

test("consumoM1 acepta las cuatro versiones soportadas", () => {
  assert.deepEqual([...SUPPORTED_SCHEMA_VERSIONS], ["kr.v0.2", "kr.v0.3", "kr.v0.4", "kr.v0.5"]);
  for (const v of SUPPORTED_SCHEMA_VERSIONS) {
    assert.doesNotThrow(() => parseBrief(briefM1({ schema_version: v })), `falló con ${v}`);
  }
});

test("parseBrief RECHAZA una schema_version fuera de las cuatro", () => {
  assert.throws(() => parseBrief(briefM1({ schema_version: "kr.v0.9" })), /no soportada/);
});

test("parseBrief RECHAZA un brief con la forma mal", () => {
  assert.throws(() => parseBrief({ schema_version: "kr.v0.5" }), /Brief inválido/);
});

test("consumoM1 CONSERVA evidencia y score_confidence cuando vienen", () => {
  // El bug histórico: no estaban en el esquema, así que Zod los DESCARTABA al parsear — el M2 los
  // calculaba y el M1 los tiraba. Son la señal de honestidad del research.
  const b = briefM1();
  (b.paginas_propuestas[0] as Record<string, unknown>).evidencia = "sin_validar";
  (b.paginas_propuestas[0] as Record<string, unknown>).score_confidence = 0.2;
  const r = consumoM1.safeParse(b);
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.paginas_propuestas[0]?.evidencia, "sin_validar");
  assert.equal(r.success && r.data.paginas_propuestas[0]?.score_confidence, 0.2);
});
