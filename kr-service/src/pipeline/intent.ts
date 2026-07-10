import type { Market, SearchIntent } from "../types.js";

/**
 * Clasificación de intención — HEURÍSTICA v0 para el spike.
 * TODO (F2): reemplazar por Haiku 4.5 + señales de SERP (ver plan §Paso 7).
 * Devuelve la intención y si es local (intención compuesta).
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
  // v0: marca local si menciona país o términos geográficos comunes.
  // TODO (F2): usar features del SERP (map pack) en vez de heurística.
  const geoHints = ["madrid", "barcelona", "valencia", "sevilla", "centro", "cerca"];
  return geoHints.some((h) => keyword.includes(h)) || keyword.includes(market.country.toLowerCase());
}
