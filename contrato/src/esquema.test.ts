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

// --- `calidad_datos` — la distinción entre "cero" y "no sé". Los dos tests van juntos porque la
// --- laxitud del primero solo es segura si el segundo sigue en pie: un `.nullable()` que se escriba
// --- como `.optional()` deja de pedir el dato en vez de admitir que no se conoce, y ahí un brief que
// --- OMITE la cobertura pasa como si la hubiera declarado desconocida.

test("emisionM2 acepta coberturas null (no se sabe) y sigue exigiendo el campo", () => {
  const b = briefM2();
  b.meta_run.calidad_datos = {
    cobertura_volumen: null,
    cobertura_kd: null,
    endpoints_degradados: null,
  };
  assert.equal(emisionM2.safeParse(b).success, true);

  // Pero la CLAVE sigue siendo obligatoria: "no sé" es un valor, no una ausencia.
  // @ts-expect-error: se borra a propósito.
  delete b.meta_run.calidad_datos.cobertura_kd;
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 sigue rechazando una cobertura fuera de 0..1", () => {
  const b = briefM2();
  b.meta_run.calidad_datos.cobertura_volumen = 1.5;
  assert.equal(emisionM2.safeParse(b).success, false);
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

// --- La INCLUSIÓN. Es lo ÚNICO que ata los dos derivados entre sí: los tests de arriba prueban cada
// --- validador por separado, y los dos siguen verdes mientras se separan. Endurecer `consumoM1` o
// --- agregar un valor a un enum de `emisionM2` rompe el handoff M2→M1 en producción sin que nada avise.
// ---
// --- PASA EN VERDE DESDE QUE SE ESCRIBIÓ, y eso NO lo vuelve inútil: no documenta un bug arreglado,
// --- fija una relación que hoy se cumple y que nada impedía romper. Su valor se comprobó por MUTACIÓN,
// --- no por un rojo previo. Si algún día parece que "no aporta", la comprobación es de tres líneas:
// --- agregale un campo requerido a `consumoM1` que el M2 no emita y mirá que caiga exactamente acá.
// ---
// --- Qué NO cubre, para no prometer de más:
// ---  1. Un campo que `consumoM1` OLVIDE. Zod descarta lo que no está en el esquema, así que el brief
// ---     del M2 sigue validando, solo más pobre: la inclusión pasa igual. Eso lo cubre el diferencial
// ---     de la SALIDA contra el esquema viejo, no este test.
// ---  2. Un valor de enum nuevo en `emisionM2` que ningún caso de acá ejercite. Se midió: la mutación
// ---     que agrega "institucional_v2" al `tipo` del M2 pasaba en verde con los tres casos originales,
// ---     y solo cayó cuando un fixture lo usó. Este test cubre lo que sus fixtures ejercitan.
test("todo brief que valide emisionM2 valida consumoM1 (emisionM2 ⊆ consumoM1)", () => {
  // La relación NO es simétrica, y eso es correcto: hay briefs kr.v0.2 que el M1 acepta y el M2 ya no
  // emite. Lo que no puede pasar es lo contrario — que el M2 emita algo que el M1 rechaza, porque ahí
  // el handoff se rompe en producción con toda la suite en verde.
  const pagina = briefM2().paginas_propuestas[0]!;
  const casos = [
    briefM2(),
    briefM2({ paginas_propuestas: [] }),
    briefM2({ status: "approved" }),
    // El cuarto caso NO es decorativo: existe por lo que midió la mutación del punto 2 de arriba. Los
    // tres de arriba usan la MISMA página del fixture, así que ejercitan un solo valor de cada enum
    // compartido (`landing_local`, `local`, `LocalBusiness`, `single`, `datos_mercado`) y
    // `volumen`/`dificultad` solo con número. Este recorre el otro extremo, incluido el `null` de v0.4.
    // `local: false` no es casual: una página `blog` no puede declararse `LocalBusiness`.
    briefM2({
      paginas_propuestas: [
        {
          ...pagina,
          tipo: "blog",
          page_strategy: "hub_spoke",
          intencion: "informational",
          local: false,
          volumen: null,
          dificultad: null,
          evidencia: "sin_validar",
          score_confidence: 0.2,
          seo: { ...pagina.seo, schema_type: "Article" },
        },
      ],
    }),
  ];
  for (const brief of casos) {
    assert.equal(emisionM2.safeParse(brief).success, true, "el fixture ya no es válido para el M2");
    const r = consumoM1.safeParse(brief);
    assert.equal(
      r.success,
      true,
      `el M2 emite algo que el M1 rechaza: ${r.success ? "" : JSON.stringify(r.error.issues)}`,
    );
  }
});

// --- El tipo de retorno de `parseBrief` NO puede prometer más que el validador. Fue un hallazgo
// --- bloqueante de la revisión de la tarea 9: el retorno se casteaba con `as KeywordResearchBrief`, o
// --- sea al tipo de EMISIÓN, que exige cinco campos que `consumoM1` no valida. Nadie los leía, así que
// --- ningún test caía — la garantía vivía en un comentario del propio docstring que admitía la mentira.
// ---
// --- Este test la fija por los DOS lados, y cada mitad caza una cosa distinta:
// ---  · en runtime, que Zod efectivamente los DESCARTA (o sea que el dato no los tiene);
// ---  · en tipos, que el retorno no los promete. Esa mitad la hace cumplir `npm run typecheck`, no el
// ---    runner: si alguien vuelve a castear a `KeywordResearchBrief`, al literal de abajo le faltan
// ---    cuatro campos obligatorios y `tsc` cae. Verificado por mutación, en esa dirección.
test("parseBrief devuelve el tipo de CONSUMO, no el de emisión (ni en el dato ni en el tipo)", () => {
  const b = parseBrief(briefM1());

  // El dato: los cuatro campos raíz de emisión no sobreviven al parseo, aunque el brief los traiga.
  const conExtras = { ...briefM1(), run_id: "r1", generated_at: "2026-01-01T00:00:00.000Z", backlog: [] };
  const parseado = parseBrief(conExtras);
  for (const k of ["run_id", "generated_at", "backlog", "meta_run"]) {
    assert.ok(!(k in parseado), `${k} no debería sobrevivir a consumoM1, y sobrevivió`);
  }
  assert.ok(
    !("page_strategy" in (parseado.paginas_propuestas[0] ?? {})),
    "page_strategy tampoco: el M1 no la valida",
  );

  // El tipo: un brief de consumo completo, con una página SIN `page_strategy`, SIN `evidencia` y SIN
  // `score_confidence`. Si `parseBrief` volviera a devolver el tipo de emisión no compilaría: le
  // faltarían `run_id`/`generated_at`/`backlog`/`meta_run` a la raíz y esos tres a la página. Sin
  // ningún `as`, que es el punto — un cast acá anularía la comprobación entera.
  const soloConsumo: typeof b = {
    schema_version: "kr.v0.2",
    cliente: "x",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    status: "approved",
    paginas_propuestas: [
      {
        cluster_id: "c1",
        tipo: "landing_local",
        url_slug: "/x",
        keyword_principal: "x",
        keywords_secundarias: [],
        intencion: "local",
        local: true,
        volumen: null,
        dificultad: null,
        opportunity_score: 0,
        seo: { meta_title: "t", meta_description: "d", schema_type: "WebPage", canonical: "/x" },
        content_brief: {
          h1: "h",
          secciones_sugeridas: [],
          word_count_objetivo: 0,
          enlazado_interno: [],
        },
        preguntas_frecuentes: [],
        approved: false,
      },
    ],
  };

  // Y que además VALIDE, no solo que tipe: un tipo que acepta lo que el validador rechaza es la misma
  // mentira al revés. Las dos mitades tienen que coincidir, y esto lo ata.
  assert.equal(consumoM1.safeParse(soloConsumo).success, true, "el tipo acepta lo que Zod rechaza");
  assert.equal(soloConsumo.paginas_propuestas[0]?.evidencia, undefined);
  assert.equal(soloConsumo.paginas_propuestas[0]?.score_confidence, undefined);
});
