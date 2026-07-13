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

test("el brief con métricas null valida contra el esquema", () => {
  const { pages } = mapClustersToPages([cluster(kw({ volume: null, difficulty: null }))], 25);
  const brief = {
    schema_version: "kr.v0.4",
    run_id: "00000000-0000-4000-8000-000000000000",
    cliente: "Test",
    market: { country: "ES", language: "es", language_code: "es", location_code: 2724 },
    generated_at: new Date().toISOString(),
    status: "pending_approval",
    paginas_propuestas: pages,
    backlog: [],
    meta_run: {
      keywords_analizadas: 1,
      paginas_propuestas: 1,
      coste_micros_usd: 0,
      coste_breakdown: { dataforseo_micros: 0, llm_generation_micros: 0, llm_embeddings_micros: 0 },
    },
  };

  assert.equal(briefSchema.safeParse(brief).success, true);
});

test("el informe muestra 'n/d' para la métrica ausente, nunca '0'", () => {
  const { pages } = mapClustersToPages(
    [cluster(kw({ volume: null, difficulty: null, keyword: "menú del día" }))],
    25,
  );
  const brief = {
    schema_version: "kr.v0.4",
    run_id: "r",
    cliente: "Test",
    market: { country: "ES", language: "es", language_code: "es", location_code: 2724 },
    generated_at: "2026-01-01T00:00:00.000Z",
    status: "pending_approval",
    paginas_propuestas: pages,
    backlog: [],
    meta_run: {
      keywords_analizadas: 1,
      paginas_propuestas: 1,
      coste_micros_usd: 0,
      coste_breakdown: { dataforseo_micros: 0, llm_generation_micros: 0, llm_embeddings_micros: 0 },
    },
  } as unknown as KeywordResearchBrief;

  const report = renderReport(brief);

  assert.match(report, /n\/d/);
  assert.match(report, /No es un 0/);
  // La fila de la página no debe contener un "| 0 |" fabricado.
  const row = report.split("\n").find((l) => l.includes("menú del día") && l.startsWith("| 1 |"));
  assert.ok(row, "debería haber una fila para la página");
  assert.doesNotMatch(row, /\|\s0\s\|/);
});
