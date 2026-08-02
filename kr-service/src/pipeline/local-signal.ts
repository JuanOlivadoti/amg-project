import { canonicalKey } from "../lib/text.js";
import type { SerpResultado } from "../dataforseo/provider.js";
import type { EnrichedKeyword } from "../types.js";

export interface RefinamientoLocal {
  /** Keywords del dataset con una observación REAL del SERP (`mapPack` booleano). */
  observadas: number;
  /** De esas, cuántas tenían mal el `is_local` y se corrigieron. */
  cambiadas: number;
  /** Se consultó el SERP pero no se pudo observar (`mapPack: null`): no se tocó nada. */
  sinSenal: number;
}

/**
 * Refina `is_local` con la presencia de **map pack** en el SERP (KR-3).
 *
 * ## Por qué existe
 *
 * `is_local` lo decidía el LLM, o —cuando el LLM no la resolvía— la heurística de
 * `intent.ts:detectLocal`, que marca local con que la keyword mencione "madrid" o "centro". En la
 * corrida real eso dio **53 de 60** keywords locales y **7 de 8** páginas declaradas
 * `LocalBusiness`. Y `schema_type` es una afirmación dirigida a Google ("esta página ES la ficha de
 * un negocio físico"), así que la sobre-detección se publicaba como una afirmación falsa.
 *
 * El map pack es otra cosa: es **Google diciendo** que considera local esa búsqueda. Es evidencia
 * de mercado, no una conjetura sobre el texto de la keyword.
 *
 * ## Las tres reglas
 *
 * 1. **Solo se pisa `is_local` cuando `mapPack !== null`.** Sin observación se respeta lo que dijo
 *    el LLM. Tratar "no observado" como "no es local" es el mismo error que `volumen ?? 0`: afirma
 *    un hecho negativo a partir de una ausencia de dato. Acá además sería caro en la dirección
 *    equivocada — un timeout de red desmarcaría una landing local legítima.
 * 2. **Con observación, el SERP manda.** Evidencia de mercado contra conjetura del LLM: gana la
 *    evidencia. Sin esto la pieza no sirve para nada.
 * 3. **Solo se observan las ~15 cabezas de cluster** (`serpValidateTop`, control de costo del
 *    endpoint más caro). Es lo esperado y es lo que importa: la cabeza es la que decide el tipo de
 *    la página, y de ahí el `schema_type`. El resto del dataset queda INTACTO, no "no local".
 *
 * Es una función pura respecto del mundo (no pide nada, no cobra nada) y **muta las keywords en
 * el lugar**, igual que `applyIntents` y `scoreKeywords`.
 *
 * @param senales Las señales observadas, indexadas por la keyword tal como se consultó. El cruce
 *   con el dataset va por `canonicalKey`, como TODOS los cruces del pipeline: el proveedor puede
 *   devolver otro casing o espaciado, y sin normalizar el lookup falla en silencio.
 */
export function refineIsLocal(
  keywords: EnrichedKeyword[],
  senales: ReadonlyMap<string, SerpResultado>,
): RefinamientoLocal {
  const porClave = new Map([...senales].map(([kw, r]) => [canonicalKey(kw), r]));
  let observadas = 0;
  let cambiadas = 0;
  let sinSenal = 0;

  for (const k of keywords) {
    const s = porClave.get(canonicalKey(k.keyword));
    if (!s) continue; // nadie miró su SERP (no es cabeza de cluster): no se toca
    if (s.mapPack === null) {
      // Se pidió el SERP y no se pudo observar. NO es evidencia de nada.
      sinSenal++;
      continue;
    }
    observadas++;
    if (k.is_local !== s.mapPack) {
      k.is_local = s.mapPack;
      cambiadas++;
    }
  }

  return { observadas, cambiadas, sinSenal };
}
