import { test } from "node:test";
import assert from "node:assert/strict";
import { mapClustersToPages } from "./cluster-map.js";
import { renderReport } from "./brief.js";
import { briefSchema } from "../validation/brief.schema.js";
import type { Cluster } from "./cluster.js";
import type { EnrichedKeyword, KeywordResearchBrief } from "../types.js";

function kw(over: Partial<EnrichedKeyword> = {}): EnrichedKeyword {
  return {
    keyword: "pasta fresca madrid",
    source: "seed",
    volume: 1300,
    difficulty: 40,
    cpc: null,
    competition: null,
    trend: null,
    intent: "local",
    is_local: true,
    business_relevance: 0.9,
    opportunity_score: 80,
    score_confidence: 1,
    cluster_id: null,
    discarded: false,
    ...over,
  };
}

const cluster = (head: EnrichedKeyword): Cluster => ({ members: [head] });

/**
 * Regresión: el proveedor devuelve `null` cuando no tiene la métrica. Coaccionarlo a 0 le dice al
 * cliente "esta keyword tiene 0 búsquedas/mes", que es una afirmación falsa y distinta de
 * "no tenemos el dato". Se detectó con la primera corrida real contra DataForSEO.
 */
test("volumen/KD ausentes se propagan como null, NO como 0", () => {
  const { pages } = mapClustersToPages([cluster(kw({ volume: null, difficulty: null }))], 25);

  assert.equal(pages[0]!.volumen, null);
  assert.equal(pages[0]!.dificultad, null);
});

test("un 0 REAL del proveedor se preserva como 0 (no se confunde con ausente)", () => {
  const { pages } = mapClustersToPages([cluster(kw({ volume: 0, difficulty: 0 }))], 25);

  assert.equal(pages[0]!.volumen, 0);
  assert.equal(pages[0]!.dificultad, 0);
});

function briefWith(pages: ReturnType<typeof mapClustersToPages>["pages"], coberturaVolumen = 0.5) {
  return {
    schema_version: "kr.v0.5",
    run_id: "00000000-0000-4000-8000-000000000000",
    cliente: "Test",
    market: { country: "ES", language: "es", language_code: "es", location_code: 2724 },
    generated_at: "2026-01-01T00:00:00.000Z",
    status: "pending_approval",
    paginas_propuestas: pages,
    backlog: [],
    meta_run: {
      keywords_analizadas: pages.length,
      paginas_propuestas: pages.length,
      calidad_datos: {
        cobertura_volumen: coberturaVolumen,
        cobertura_kd: coberturaVolumen,
        endpoints_degradados: [],
      },
      coste_micros_usd: 0,
      coste_breakdown: { dataforseo_micros: 0, llm_generation_micros: 0, llm_embeddings_micros: 0 },
    },
  } as unknown as KeywordResearchBrief;
}

test("el brief con métricas null valida contra el esquema", () => {
  const { pages } = mapClustersToPages([cluster(kw({ volume: null, difficulty: null }))], 25);

  assert.equal(briefSchema.safeParse(briefWith(pages)).success, true);
});

test("el informe muestra 'n/d' para la métrica ausente, nunca '0'", () => {
  const { pages } = mapClustersToPages(
    [cluster(kw({ volume: null, difficulty: null, keyword: "menú del día" }))],
    25,
  );

  const report = renderReport(briefWith(pages));

  assert.match(report, /n\/d/);
  assert.match(report, /No es un 0/);
  // La fila de la página no debe contener un "| 0 |" fabricado.
  const row = report.split("\n").find((l) => l.includes("menú del día") && l.startsWith("| 1 |"));
  assert.ok(row, "debería haber una fila para la página");
  assert.doesNotMatch(row, /\|\s0\s\|/);
});

/**
 * Regresión (#4 review Codex): el 40% del score (intención + relevancia) no depende de datos de
 * mercado, así que una keyword de la que no sabemos NADA arranca en ~50 puntos y puede superar a
 * una con volumen real pero alta dificultad. `score_confidence` lo detectaba y NO se usaba.
 */
test("evidencia: un cluster con volumen en CUALQUIER miembro cuenta como respaldado", () => {
  const { pages } = mapClustersToPages(
    [
      {
        members: [
          kw({ keyword: "cabeza sin datos", volume: null, difficulty: null, opportunity_score: 50 }),
          kw({ keyword: "miembro con volumen", volume: 900, opportunity_score: 40 }),
        ],
      },
    ],
    25,
  );

  assert.equal(pages[0]!.evidencia, "datos_mercado");
});

test("evidencia: sin volumen en NINGÚN miembro → sin_validar (pero NO se descarta)", () => {
  const { pages, backlog } = mapClustersToPages(
    [{ members: [kw({ volume: null, difficulty: null }), kw({ keyword: "otra", volume: null })] }],
    25,
  );

  assert.equal(pages.length, 1, "la página se conserva: puede ser un servicio real del negocio");
  assert.equal(backlog.length, 0);
  assert.equal(pages[0]!.evidencia, "sin_validar");
});

test("una página sin_validar NUNCA se ordena por encima de una con datos, aunque su score sea mayor", () => {
  const sinDatos = kw({ keyword: "apuesta sin datos", volume: null, difficulty: null, opportunity_score: 95 });
  const conDatos = kw({ keyword: "keyword real", volume: 1200, difficulty: 60, opportunity_score: 55 });

  const { pages } = mapClustersToPages([cluster(sinDatos), cluster(conDatos)], 25);

  assert.equal(pages[0]!.keyword_principal, "keyword real");
  assert.equal(pages[0]!.evidencia, "datos_mercado");
  assert.equal(pages[1]!.evidencia, "sin_validar");
});

test("el informe SEPARA las páginas respaldadas de las que son una apuesta", () => {
  const sinDatos = kw({ keyword: "brunch fin de semana", volume: null, difficulty: null, opportunity_score: 50 });
  const conDatos = kw({ keyword: "pizza napolitana madrid", volume: 390, difficulty: 15, opportunity_score: 84 });

  const report = renderReport(briefWith(mapClustersToPages([cluster(sinDatos), cluster(conDatos)], 25).pages));

  assert.match(report, /Respaldadas por datos de mercado \(1\)/);
  assert.match(report, /Sin validar \(1\)/);
  assert.match(report, /no hay evidencia de que alguien los busque/);
  // La cobertura del run se declara arriba de todo.
  assert.match(report, /Calidad de los datos/);
});
