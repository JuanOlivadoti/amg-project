import { test } from "node:test";
import assert from "node:assert/strict";
import { percentilNearestRank, scoreKeywords, VOLUMEN_PERCENTIL_TOPE } from "./scoring.js";
import { WEIGHTS_DEFAULT } from "../types.js";
import type { EnrichedKeyword } from "../types.js";

const kw = (over: Partial<EnrichedKeyword>): EnrichedKeyword => ({
  keyword: "k",
  source: "seed",
  volume: 1000,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: "transactional",
  is_local: false,
  business_relevance: null,
  opportunity_score: null,
  score_confidence: null,
  cluster_id: null,
  discarded: false,
  ...over,
});

test("#4 relevancia evaluada y alta: score alto, confianza plena, no descartada", () => {
  const k = kw({ business_relevance: 0.9 });
  scoreKeywords([k], WEIGHTS_DEFAULT);
  assert.equal(k.discarded, false);
  assert.equal(k.score_confidence, 1);
  assert.ok((k.opportunity_score ?? 0) > 50);
});

test("#4 relevancia evaluada por debajo del gate: descartada con score 0", () => {
  const k = kw({ business_relevance: 0.2 });
  scoreKeywords([k], WEIGHTS_DEFAULT);
  assert.equal(k.discarded, true);
  assert.equal(k.opportunity_score, 0);
  assert.match(k.discard_reason ?? "", /business_relevance/);
});

test("#4 relevancia NO evaluada (null): no se promueve → cap 35 y confianza baja", () => {
  const k = kw({ business_relevance: null });
  scoreKeywords([k], WEIGHTS_DEFAULT);
  assert.equal(k.discarded, false, "no se descarta: queda para revisión");
  assert.ok((k.opportunity_score ?? 999) <= 35, "score capeado");
  assert.ok((k.score_confidence ?? 1) < 1, "confianza materialmente menor");
  assert.match(k.discard_reason ?? "", /no evaluada/);
});

test("#4 no evaluada nunca supera a evaluada equivalente", () => {
  const evaluated = kw({ business_relevance: 0.9 });
  const unknown = kw({ business_relevance: null });
  scoreKeywords([evaluated, unknown], WEIGHTS_DEFAULT);
  assert.ok((unknown.opportunity_score ?? 0) < (evaluated.opportunity_score ?? 0));
});

// ───────────────────────── KR-3: normalización del volumen por percentil ─────────────────────────

/**
 * Todas las keywords de estos tests llevan `business_relevance` alta a propósito: con la relevancia
 * sin evaluar el score se capea en 35 (`RELEVANCE_UNKNOWN_CAP`) y el aporte del volumen —que es lo
 * único que se está midiendo acá— quedaría escondido detrás del tope.
 */
const conVolumen = (keyword: string, volume: number | null): EnrichedKeyword =>
  kw({ keyword, volume, business_relevance: 0.9 });

const scoreDe = (k: EnrichedKeyword) => k.opportunity_score ?? 0;

test("percentil nearest-rank: devuelve un valor DE la población, sin interpolar", () => {
  const p = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  // rank = ceil(0.9 × 10) = 9 → el noveno. Un percentil interpolado daría 91, que no existe
  // en la población: queremos un resultado determinista y fácil de razonar en un test.
  assert.equal(percentilNearestRank(p, 0.9), 90);
  // rank = ceil(0.5 × 4) = 2. Promediar los dos centrales daría 25, que tampoco existe.
  assert.equal(percentilNearestRank([10, 20, 30, 40], 0.5), 20);
});

test("percentil nearest-rank: no depende del orden en que llega la población", () => {
  const desordenada = [100, 10, 90, 20, 80, 30, 70, 40, 60, 50];

  assert.equal(percentilNearestRank(desordenada, 0.9), 90);
  assert.equal(percentilNearestRank([...desordenada].sort((a, b) => a - b), 0.9), 90);
});

test("percentil nearest-rank: extremos y casos borde", () => {
  const p = [10, 20, 30];

  assert.equal(percentilNearestRank(p, 0), 10, "p=0 → el mínimo");
  assert.equal(percentilNearestRank(p, 1), 30, "p=1 → el máximo");
  assert.equal(percentilNearestRank([7], 0.9), 7, "un solo elemento: es el percentil de todo");
  assert.equal(percentilNearestRank([7], 0), 7);
  assert.equal(
    percentilNearestRank([], 0.9),
    null,
    "población vacía: NO hay percentil. `null` = no sabemos, igual que en el resto del pipeline",
  );
  assert.equal(percentilNearestRank(p, 1.5), 30, "fuera de rango se acota al máximo");
});

test("percentil nearest-rank: un percentil no finito lanza, no devuelve `undefined` disfrazado", () => {
  // Sin la guarda, NaN atraviesa los Math.min/max y el acceso indexado devuelve `undefined`
  // tipado como `number`. Un `null` legítimo (población vacía) y una basura silenciosa se
  // confundirían, y el `cap` terminaría en 1 sin que nada avise.
  assert.throws(() => percentilNearestRank([10, 20, 30], Number.NaN), RangeError);
  assert.throws(() => percentilNearestRank([10, 20, 30], Number.POSITIVE_INFINITY), RangeError);
});

test("VOLUMEN_PERCENTIL_TOPE es 0.9 (default de producción, no lo elige el test)", () => {
  assert.equal(VOLUMEN_PERCENTIL_TOPE, 0.9);
});

/**
 * La propiedad que justifica el cambio: con `volume_max`, UN pico reescalaba a todas las demás
 * (1300 en la corrida real aplastaba al resto) y eso cambiaba qué páginas *parecen* valiosas en el
 * brief. Con el tope winsorizado en el p90, sacar el outlier de la corrida no mueve a nadie.
 */
test("un outlier NO cambia el score de las demás keywords", () => {
  const sinOutlier = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((v) => conVolumen(`k${v}`, v));
  scoreKeywords(sinOutlier, WEIGHTS_DEFAULT);
  const antes = sinOutlier.map(scoreDe);

  const conOutlier = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((v) => conVolumen(`k${v}`, v));
  scoreKeywords([...conOutlier, conVolumen("pico", 1300)], WEIGHTS_DEFAULT);

  assert.deepEqual(conOutlier.map(scoreDe), antes);
});

test("winsorización: todo lo que pasa el percentil 90 satura en el mismo aporte de volumen", () => {
  const poblacion = [10, 20, 30, 40, 50, 60, 70, 80].map((v) => conVolumen(`k${v}`, v));
  const enElTope = conVolumen("en el tope", 90); // p90 de los 10: rank = ceil(0.9 × 10) = 9
  const pico = conVolumen("pico", 1300);
  scoreKeywords([...poblacion, enElTope, pico], WEIGHTS_DEFAULT);

  assert.equal(scoreDe(pico), scoreDe(enElTope), "14× más volumen no compra ni un punto más");
  assert.ok(scoreDe(enElTope) > scoreDe(poblacion[0]!), "pero el tope sí supera a la cola");
});

/**
 * `null` = el proveedor no devolvió el dato; `0` = nadie busca eso. Es la misma distinción que rige
 * el resto del pipeline (`evidenceOf`, el `n/d` del informe) y no puede romperse acá: si los `null`
 * entraran a la población como ceros, correrían el percentil hacia abajo y saturarían de más.
 */
test("la población son los volúmenes CONOCIDOS: los desconocidos no la mueven", () => {
  const conocidas = [10, 20, 30, 40, 1000].map((v) => conVolumen(`k${v}`, v));
  scoreKeywords(conocidas, WEIGHTS_DEFAULT);
  const solas = conocidas.map(scoreDe);

  const conocidasOtraVez = [10, 20, 30, 40, 1000].map((v) => conVolumen(`k${v}`, v));
  const desconocidas = [1, 2, 3, 4, 5].map((i) => conVolumen(`sin dato ${i}`, null));
  scoreKeywords([...conocidasOtraVez, ...desconocidas], WEIGHTS_DEFAULT);

  assert.deepEqual(conocidasOtraVez.map(scoreDe), solas);
});

test("un volumen CERO sí entra en la población: es una observación real", () => {
  const ceros = [1, 2, 3, 4, 5].map((i) => conVolumen(`nadie busca ${i}`, 0));
  const cola = [10, 20, 30].map((v) => conVolumen(`k${v}`, v));
  const enElTope = conVolumen("en el tope", 40); // p90 de los 10 con los ceros dentro
  const pico = conVolumen("pico", 1000);
  scoreKeywords([...ceros, ...cola, enElTope, pico], WEIGHTS_DEFAULT);

  // Con los ceros dentro el percentil 90 baja hasta 40, así que la de 40 ya satura. Si los ceros
  // se excluyeran (o si fueran `null`), el p90 sería 1000 y la de 40 quedaría muy por debajo.
  assert.equal(scoreDe(enElTope), scoreDe(pico));
});

test("población vacía (ningún volumen conocido): el volumen no aporta nada", () => {
  const sinDatos = conVolumen("sin dato", null);
  scoreKeywords([sinDatos], WEIGHTS_DEFAULT);

  // Referencia: la misma keyword con el peso del volumen anulado. Si `volumeNorm` no fuese 0,
  // los dos scores no coincidirían.
  const referencia = conVolumen("con dato", 1000);
  scoreKeywords([referencia], { ...WEIGHTS_DEFAULT, volume: 0 });

  assert.equal(scoreDe(sinDatos), scoreDe(referencia));
});

test("todos los volúmenes en cero: aporte de volumen 0, pero la confianza NO es la de un null", () => {
  const cero = conVolumen("nadie busca esto", 0);
  scoreKeywords([cero], WEIGHTS_DEFAULT);

  const nulo = conVolumen("no sabemos", null);
  scoreKeywords([nulo], WEIGHTS_DEFAULT);

  assert.equal(scoreDe(cero), scoreDe(nulo), "cero demanda y demanda desconocida valen lo mismo");
  assert.equal(cero.score_confidence, 1, "pero del cero SÍ tenemos el dato");
  assert.ok((nulo.score_confidence ?? 1) < 1, "y del null no");
});

test("un solo volumen conocido: satura, sea cual sea su magnitud", () => {
  const chico = conVolumen("chico", 5);
  scoreKeywords([chico], WEIGHTS_DEFAULT);

  const grande = conVolumen("grande", 5000);
  scoreKeywords([grande], WEIGHTS_DEFAULT);

  assert.equal(scoreDe(chico), scoreDe(grande), "una población de uno no tiene distribución");
});
