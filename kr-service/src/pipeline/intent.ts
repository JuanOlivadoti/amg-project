import type { Market, SearchIntent } from "../types.js";

/**
 * Clasificación de intención — HEURÍSTICA (fallback).
 * La vía principal es el LLM (ver ContentGen.classifyIntents / applyIntents); esta
 * función cubre las keywords que el LLM no resuelve o si la llamada falla.
 *
 * El `is_local` que sale de acá (y el del LLM) es una CONJETURA sobre el texto de la keyword.
 * `pipeline/local-signal.ts` lo corrige después con la presencia de map pack en el SERP, que es
 * evidencia de mercado — pero solo para las ~15 cabezas de cluster cuyo SERP se consulta. Para todo
 * lo demás, lo que decida esta función es lo que queda.
 */
export function classifyIntent(
  keyword: string,
  market: Market,
): { intent: SearchIntent; is_local: boolean } {
  const k = keyword.toLowerCase();

  const isLocal = detectLocal(k, market);

  if (/(precio|barato|reservar|reserva|comprar|cerca|abierto|a domicilio|delivery)/.test(k)) {
    return { intent: "transactional", is_local: isLocal };
  }
  if (/(mejor|mejores|top|comparativa|opiniones|rese[ñn]as|vs)/.test(k)) {
    return { intent: "commercial", is_local: isLocal };
  }
  if (/(qu[eé]|c[oó]mo|cu[aá]nto|por qu[eé]|gu[ií]a|recetas?|significa)/.test(k)) {
    return { intent: "informational", is_local: isLocal };
  }
  // Sin señales claras: si es local, tratamos como local; si no, comercial.
  return { intent: isLocal ? "local" : "commercial", is_local: isLocal };
}

function detectLocal(keyword: string, market: Market): boolean {
  // v0: marca local si menciona país o términos geográficos comunes. SOBRE-DETECTA a propósito
  // conocido: en la corrida real dio 53 de 60 keywords locales, porque en un negocio de Madrid casi
  // toda keyword dice "madrid". Quien lo corrige con evidencia real es `local-signal.ts`.
  const geoHints = ["madrid", "barcelona", "valencia", "sevilla", "centro", "cerca"];
  return geoHints.some((h) => keyword.includes(h)) || keyword.includes(market.country.toLowerCase());
}
