import type { PaginaPropuesta } from './models';

/**
 * La separación por evidencia. **Es el argumento de venta del sistema: dice lo que NO sabe.**
 *
 * En la corrida real, 5 de 8 páginas no tenían datos de mercado que las respaldaran. Presentarlas
 * mezcladas con las respaldadas —como si todas valieran lo mismo— sería exactamente la clase de
 * afirmación que un cliente detecta. El portal las muestra separadas: ✅ respaldadas por datos vs
 * ⚠️ sin validar.
 *
 * El criterio es `evidencia === 'datos_mercado'`. Es una decisión de contrato con el M2, no una
 * heurística de UI: si el pipeline cambia la etiqueta, esto se actualiza acá, en un solo lugar, con
 * su test al lado.
 */
export const EVIDENCIA_RESPALDADA = 'datos_mercado';

export function esRespaldada(p: PaginaPropuesta): boolean {
  return p.evidencia === EVIDENCIA_RESPALDADA;
}

export interface PorEvidencia {
  /** Respaldadas por datos de mercado reales. */
  respaldadas: PaginaPropuesta[];
  /** Sin datos que las validen: se muestran, pero marcadas. No se ocultan — ocultarlas sería mentir. */
  sinValidar: PaginaPropuesta[];
}

/**
 * Parte las páginas en respaldadas / sin validar, **conservando el orden** de entrada. No descarta
 * ninguna: mostrar lo que no se sabe es el punto.
 *
 * **Conservar el orden no es un detalle de implementación: es el contrato.** La API manda las páginas
 * en el orden del brief que produjo el M2 —evidencia primero, después `score_confidence`— persistido en
 * `kr_pages.orden_brief` (KR-3, migración 0015). Ese criterio **no se puede reconstruir desde
 * `opportunity_score`**: una página sin validar puede tener más score que una respaldada, y aun así no
 * puede presentarse por encima de ella.
 *
 * Así que **no re-ordenes acá, ni "restaures" un `sort` por score**: era lo que la base hacía antes de
 * la 0015, y es la razón por la que la columna "Confianza" del portal no ordenaba nada. Lo fija el test
 * 🔴 de `evidence.test.ts`, cuyo fixture entra con el orden contradiciendo al score a propósito.
 */
export function separarPorEvidencia(pages: PaginaPropuesta[]): PorEvidencia {
  const respaldadas: PaginaPropuesta[] = [];
  const sinValidar: PaginaPropuesta[] = [];
  for (const p of pages) (esRespaldada(p) ? respaldadas : sinValidar).push(p);
  return { respaldadas, sinValidar };
}

/**
 * ¿Se puede aprobar el run? La compuerta es doble (ADR-06): hace falta AL MENOS una página aprobada.
 * El portal usa esto para habilitar/deshabilitar el botón — pero la verdad la impone la API, que
 * rechaza aprobar un run sin páginas aprobadas. Acá es solo para no ofrecer un click que fallará.
 */
export function puedeAprobarseRun(pages: PaginaPropuesta[]): boolean {
  return pages.some((p) => p.approved);
}
