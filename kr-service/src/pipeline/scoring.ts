import type { EnrichedKeyword, ScoringWeights, SearchIntent } from "../types.js";

const INTENT_WEIGHT: Record<SearchIntent, number> = {
  transactional: 1.0,
  local: 1.0,
  commercial: 0.8,
  informational: 0.6,
  navigational: 0.4,
};

const BUSINESS_GATE = 0.4; // ADR-10: business_relevance como gate, no solo peso.
// Si la relevancia NO se pudo evaluar (LLM caído/parcial), NO se promueve automáticamente:
// se capea fuerte el score y se baja la confianza (#4 review Codex). No es lo mismo
// "irrelevante" (evaluado bajo → descartado) que "desconocido" (sin evaluar → a revisión).
const RELEVANCE_UNKNOWN_CAP = 35; // tope de opportunity_score cuando la relevancia es desconocida.

/**
 * opportunity_score (0..100) + score_confidence (0..1).
 * TODO (post-pruebas): normalizar volumen por percentiles del mercado en vez de
 * volume_max del run (ver plan §7); winsorizar outliers.
 */
export function scoreKeywords(kws: EnrichedKeyword[], weights: ScoringWeights): void {
  const volumeMax = Math.max(1, ...kws.map((k) => k.volume ?? 0));
  const logMax = Math.log10(1 + volumeMax);

  for (const k of kws) {
    const relevanceEvaluated = k.business_relevance != null;

    // Confianza: baja si faltan datos reales. La relevancia desconocida pesa fuerte:
    // es la señal de negocio decisiva del gate (ADR-10), no un dato secundario.
    let confidence = 1;
    if (k.volume == null) confidence -= 0.4;
    if (k.difficulty == null) confidence -= 0.3;
    if (!relevanceEvaluated) confidence -= 0.4;
    k.score_confidence = Math.max(0, Math.round(confidence * 100) / 100);

    // Gate de relevancia: si fue evaluada y es claramente irrelevante, se descarta.
    if (relevanceEvaluated && k.business_relevance! < BUSINESS_GATE) {
      k.discarded = true;
      k.discard_reason = `business_relevance ${k.business_relevance} < ${BUSINESS_GATE}`;
      k.opportunity_score = 0;
      continue;
    }

    const volumeNorm = logMax > 0 ? Math.log10(1 + (k.volume ?? 0)) / logMax : 0;
    const difficultyInv = k.difficulty == null ? 0.4 : 1 - k.difficulty / 100; // null penaliza
    const intentWeight = k.intent ? INTENT_WEIGHT[k.intent] : 0.5;
    // Sin evaluar: neutral-bajo (0.5), NO 0.6, y con el cap de abajo no puede subir a página top.
    const businessRel = k.business_relevance ?? 0.5;

    const raw =
      weights.volume * volumeNorm +
      weights.difficulty * difficultyInv +
      weights.intent * intentWeight +
      weights.business * businessRel;

    let score = Math.round(raw * 100 * 100) / 100;
    if (!relevanceEvaluated) {
      // Cap fuerte: queda visible (backlog/revisión) pero no se promueve a página sin evaluación.
      score = Math.min(score, RELEVANCE_UNKNOWN_CAP);
      k.discard_reason = "business_relevance no evaluada (revisar antes de publicar)";
    }
    k.opportunity_score = score;
  }
}
