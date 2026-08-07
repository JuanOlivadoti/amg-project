import type { CarteraDashboard } from './cartera-mock';

export interface KpisCartera {
  readonly sitiosActivos: number;
  readonly opportunityScorePromedio: number;
  /**
   * `null` = **no disponible**, no «cero».
   *
   * Pasa cuando ningún run de la cartera trae coste, que es lo que ve un rol no-staff: `app.es_staff()`
   * lo decide dentro de Postgres (`db/src/store.ts`) y el número no viaja. Un `0` acá afirmaría que la
   * cartera entera de research no costó nada.
   */
  readonly costeTotalUsd: number | null;
}

// Suma TODO el coste de la cartera, sin filtrar por mes: el mock es un dataset estático (siempre
// julio 2026, ver cartera-mock.ts), no una serie que rueda con el calendario real. Filtrar por
// "mes actual" contra datos que nunca cambian de mes daba un KPI que dependía de `new Date()` en
// producción y que ningún test ejercitaba (los tests siempre pasaban una fecha de referencia
// explícita) — a partir de agosto de 2026 el tile leía 0 en silencio. Con datos reales del backend
// (series que sí avanzan) este KPI se puede volver a acotar a un período, con su propio test.
export function kpisDeCartera(dashboard: CarteraDashboard): KpisCartera {
  const scores = dashboard.pages.map((p) => p.opportunity_score);
  const promedio = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // Solo los runs que TRAEN coste. El filtro se hace antes de sumar y no con un `?? 0` dentro del
  // reduce, porque hace falta saber si quedó alguno: sin ninguno, el total no es 0 — no existe.
  // (Y ojo: `acc + null` no da NaN, da `acc`. Este `| null` no rompe ruidosamente, se suma como cero,
  // que es justo lo que lo vuelve peligroso.)
  const conCoste = dashboard.clientes
    .flatMap((c) => c.runs)
    .map((r) => r.coste_micros_usd)
    .filter((c): c is number => c !== null);

  return {
    sitiosActivos: dashboard.clientes.length,
    opportunityScorePromedio: Math.round(promedio * 10) / 10,
    costeTotalUsd: conCoste.length
      ? Math.round((conCoste.reduce((a, b) => a + b, 0) / 1_000_000) * 100) / 100
      : null,
  };
}

export interface OportunidadTop {
  readonly keyword: string;
  readonly score: number;
}

export function topOportunidades(pages: CarteraDashboard['pages'], n: number): OportunidadTop[] {
  return [...pages]
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, n)
    .map((p) => ({ keyword: p.keyword_principal, score: p.opportunity_score }));
}

export interface PuntoCosteRun {
  readonly fecha: string;
  readonly costeUsd: number;
}

/**
 * Un punto por run **con coste conocido**. Los runs sin coste no aparecen en la serie.
 *
 * Omitir y no poner en 0: `Math.round((null / 1e6) * 100) / 100` devuelve **0**, no `NaN` —`null` se
 * coacciona a cero en aritmética—, así que el fallo no se vería como un error sino como una corrida
 * gratis en el gráfico. Un punto que no se conoce no se dibuja; si el rol no ve ningún coste, el
 * gráfico queda vacío, que es la verdad.
 */
export function serieTemporalCoste(dashboard: CarteraDashboard): PuntoCosteRun[] {
  return dashboard.clientes
    .flatMap((c) => c.runs)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((r) =>
      r.coste_micros_usd === null
        ? []
        : [
            {
              fecha: r.created_at.slice(0, 10),
              costeUsd: Math.round((r.coste_micros_usd / 1_000_000) * 100) / 100,
            },
          ],
    );
}
