import { test } from "node:test";
import assert from "node:assert/strict";
import { refineIsLocal } from "./local-signal.js";
import type { SerpResultado } from "../dataforseo/provider.js";
import type { EnrichedKeyword } from "../types.js";

/** Keyword mínima: solo importan `keyword` e `is_local`. */
function kw(keyword: string, is_local: boolean): EnrichedKeyword {
  return {
    keyword,
    source: "seed",
    volume: null,
    difficulty: null,
    cpc: null,
    competition: null,
    trend: null,
    intent: null,
    is_local,
    business_relevance: null,
    opportunity_score: null,
    score_confidence: null,
    cluster_id: null,
    discarded: false,
  };
}

const serp = (mapPack: boolean | null): SerpResultado => ({ urls: [], mapPack });

// ================================================================
// La regla que da sentido a todo lo demás
// ================================================================

/**
 * 🔴 EL TEST QUE IMPORTA.
 *
 * `mapPack: null` significa "NO SE PUDO OBSERVAR" (el SERP falló). Tomarlo por `false` afirmaría
 * "Google no considera local esta búsqueda" sin haberla mirado — es exactamente el mismo error que
 * `volumen ?? 0`, y en la dirección más cara: desmarcaría `is_local` en una landing legítima por un
 * timeout de red.
 */
test("🔴 mapPack null NO pisa nada: sin observación manda lo que dijo el LLM", () => {
  const kws = [kw("restaurante italiano madrid", true), kw("pasta fresca", false)];

  const r = refineIsLocal(
    kws,
    new Map([
      ["restaurante italiano madrid", serp(null)],
      ["pasta fresca", serp(null)],
    ]),
  );

  assert.equal(kws[0]!.is_local, true, "una local sin observación sigue siendo local");
  assert.equal(kws[1]!.is_local, false, "y una no-local sigue sin serlo");
  assert.equal(r.observadas, 0, "no hubo observación");
  assert.equal(r.cambiadas, 0);
  assert.equal(r.sinSenal, 2, "y las dos se cuentan como no observadas");
});

/**
 * La razón de ser de la pieza: el map pack es evidencia de que Google considera local la búsqueda.
 * La heurística (`intent.ts:detectLocal`) marcaba local con que la keyword dijera "madrid" —
 * 53 de 60 keywords en la corrida real. La evidencia de mercado gana sobre la conjetura.
 */
test("con observación, la señal del SERP MANDA sobre la del LLM (en los dos sentidos)", () => {
  // El LLM dijo local (menciona "madrid") pero el SERP no trae map pack → NO es local.
  const falsoPositivo = kw("como se hace la pasta fresca en madrid", true);
  // El LLM no la marcó local, pero Google sí muestra el bloque local → SÍ es local.
  const falsoNegativo = kw("trattoria abierta ahora", false);

  const r = refineIsLocal(
    [falsoPositivo, falsoNegativo],
    new Map([
      ["como se hace la pasta fresca en madrid", serp(false)],
      ["trattoria abierta ahora", serp(true)],
    ]),
  );

  assert.equal(falsoPositivo.is_local, false, "el SERP desmiente al LLM");
  assert.equal(falsoNegativo.is_local, true, "y también lo corrige al revés");
  assert.equal(r.observadas, 2);
  assert.equal(r.cambiadas, 2);
});

test("una observación que COINCIDE con el LLM se cuenta como observada pero no como cambiada", () => {
  const k = kw("pizzeria napolitana madrid", true);
  const r = refineIsLocal([k], new Map([["pizzeria napolitana madrid", serp(true)]]));

  assert.equal(k.is_local, true);
  assert.equal(r.observadas, 1);
  assert.equal(r.cambiadas, 0, "no cambió nada: ya estaba bien");
});

// ================================================================
// El cruce entre las dos listas
// ================================================================

/**
 * Solo se observan las ~15 cabezas de cluster (control de costo del SERP). El resto del dataset
 * queda intacto — no "no local", INTACTO.
 */
test("las keywords NO observadas quedan exactamente como estaban", () => {
  const observada = kw("pizza napolitana madrid", true);
  const intacta = kw("brunch fin de semana madrid", true);

  const r = refineIsLocal(
    [observada, intacta],
    new Map([["pizza napolitana madrid", serp(false)]]),
  );

  assert.equal(observada.is_local, false);
  assert.equal(intacta.is_local, true, "nadie miró su SERP: no se toca");
  assert.equal(r.observadas, 1);
});

/**
 * El cruce va por `canonicalKey`, como TODOS los cruces del pipeline. El proveedor puede devolver
 * la keyword con otro casing, espaciado o forma Unicode; sin normalizar, el lookup falla en
 * silencio y la señal —ya pagada— se pierde.
 */
test("el cruce va por clave canónica: casing y espaciado no rompen el match", () => {
  const k = kw("Pizza  Napolitana Madrid", true);
  const r = refineIsLocal([k], new Map([["pizza napolitana madrid", serp(false)]]));

  assert.equal(k.is_local, false, "es la misma keyword para el proveedor y para nosotros");
  assert.equal(r.observadas, 1);
});

/**
 * Y también al revés: la clave de la SEÑAL se canoniza igual.
 *
 * Hoy las señales las produce `clusterKeywords` con nuestra propia grafía, así que en el pipeline
 * las dos puntas coinciden — pero esta función es pública y recibe un mapa cualquiera. Canonizar
 * un solo lado del cruce es la mitad de la defensa, y en este repo un lookup que falla en silencio
 * ya costó métricas pagadas.
 */
test("el cruce canoniza LAS DOS puntas, no solo la del dataset", () => {
  const k = kw("pizza napolitana madrid", true);
  const r = refineIsLocal([k], new Map([["Pizza  Napolitana MADRID", serp(false)]]));

  assert.equal(k.is_local, false);
  assert.equal(r.observadas, 1);
});

test("una señal que no corresponde a ninguna keyword del dataset no rompe ni cuenta", () => {
  const k = kw("pizza napolitana madrid", true);
  const r = refineIsLocal([k], new Map([["keyword de otro run", serp(false)]]));

  assert.equal(k.is_local, true);
  assert.equal(r.observadas, 0);
});

test("sin señales, el refinamiento es un no-op", () => {
  const kws = [kw("a", true), kw("b", false)];
  const r = refineIsLocal(kws, new Map());

  assert.deepEqual(kws.map((k) => k.is_local), [true, false]);
  assert.deepEqual(r, { observadas: 0, cambiadas: 0, sinSenal: 0 });
});
