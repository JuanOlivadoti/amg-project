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
 * Percentil de la escala del volumen: por encima de él, todo satura en el mismo aporte.
 *
 * Default de PRODUCCIÓN (no lo elige ningún test, y hay uno que fija este valor). 0.9 deja fuera de
 * la escala al ~10% superior, que es donde vive el outlier que motivó el cambio, sin recortar a la
 * cabeza legítima de un dataset sano.
 */
export const VOLUMEN_PERCENTIL_TOPE = 0.9;

/**
 * Percentil por **nearest-rank**: devuelve un valor que EXISTE en la población, sin interpolar.
 *
 * La interpolación (R-7 y compañía) inventa un número intermedio; acá se prefiere el resultado
 * determinista y trivial de razonar en un test: `rank = ceil(p × N)`, acotado a `[1, N]`, y se
 * devuelve el elemento en esa posición del orden ascendente.
 *
 * Ordena una copia por su cuenta a propósito. Podría pedir la población ya ordenada y documentarlo,
 * pero un llamador que pase la lista sin ordenar obtendría un resultado silenciosamente equivocado
 * —y este repo ya aprendió que una garantía escrita en un comentario es una intención, no una
 * garantía—. Con N ~ 60 keywords el orden no se nota.
 *
 * @returns `null` si la población está vacía. No hay percentil de la nada, y devolver 0 afirmaría
 *   "el percentil 90 es cero", que es justo la confusión `null`/`0` que el resto del pipeline evita.
 * @throws `RangeError` si `p` no es finito. Sin esta guarda, `ceil(NaN × N)` atraviesa los dos
 *   `Math.min/max` (que propagan NaN) y el acceso indexado devuelve `undefined` tipado como
 *   `number`: exactamente la mentira que `noUncheckedIndexedAccess` existe para evitar, tapada por
 *   el `!` de abajo. Un percentil fuera de `[0, 1]` sí se acota en silencio: el clamp del rank le da
 *   el sentido obvio (el mínimo o el máximo).
 */
export function percentilNearestRank(poblacion: readonly number[], p: number): number | null {
  if (!Number.isFinite(p)) throw new RangeError(`percentil no finito: ${p}`);
  if (poblacion.length === 0) return null;
  const ordenada = [...poblacion].sort((a, b) => a - b);
  const rank = Math.min(ordenada.length, Math.max(1, Math.ceil(p * ordenada.length)));
  return ordenada[rank - 1]!;
}

/**
 * opportunity_score (0..100) + score_confidence (0..1).
 *
 * ## El volumen se normaliza contra el percentil 90 del run, winsorizado
 *
 * Antes se normalizaba contra el `volume_max` del run: UN pico (1300 búsquedas en la corrida real)
 * reescalaba a todas las demás hacia abajo, y eso cambia qué páginas *parecen* valiosas en el brief
 * que se le enseña al cliente. Ahora el tope es el percentil 90 y todo lo que lo supera satura en
 * 1.0 — eso es la winsorización, y es lo que impide que un outlier aplaste al resto.
 *
 * La población son los volúmenes CONOCIDOS. Un `0` entra (es una observación real: nadie busca eso);
 * un `null` no (no sabemos). Es la misma distinción que rige `evidenceOf` y el `n/d` del informe.
 *
 * TODO (KR-1, cuesta dinero): esto es el percentil **del run**, no el del mercado. Arregla el
 * aplastamiento por outlier, pero la escala sigue siendo relativa a las keywords de esa corrida: el
 * mismo volumen puntúa distinto en dos runs con datasets distintos, así que los scores no son
 * comparables entre corridas. Una distribución de mercado de verdad —percentiles cruzados entre
 * runs, por rubro y mercado— necesita el dataset persistido y calibrado con datos reales, que hoy
 * no existe y no se puede construir gratis.
 */
export function scoreKeywords(kws: EnrichedKeyword[], weights: ScoringWeights): void {
  const poblacion: number[] = [];
  for (const k of kws) if (k.volume != null) poblacion.push(k.volume);

  // `max(1, …)` cubre los dos casos degenerados de una sola vez: población vacía (percentil `null`)
  // y población entera en cero. En ambos `logCap = log10(2) > 0`, así que la división es segura y
  // todos los volúmenes conocidos dan `volumeNorm = 0`: sin distribución, el volumen no informa nada.
  const cap = Math.max(1, percentilNearestRank(poblacion, VOLUMEN_PERCENTIL_TOPE) ?? 0);
  const logCap = Math.log10(1 + cap);

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

    // `min(1, …)`: por encima del percentil 90 se satura. Sin el tope, el pico se llevaba la escala.
    const volumeNorm = Math.min(1, Math.log10(1 + (k.volume ?? 0)) / logCap);
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
