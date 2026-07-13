import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreKeywords } from "./scoring.js";
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
