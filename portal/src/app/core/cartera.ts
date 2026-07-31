import type { CarteraDashboard } from './cartera-mock';

export interface KpisCartera {
  readonly sitiosActivos: number;
  readonly opportunityScorePromedio: number;
  readonly costeTotalUsd: number;
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

  const costeMicros = dashboard.clientes
    .flatMap((c) => c.runs)
    .reduce((acc, r) => acc + r.coste_micros_usd, 0);

  return {
    sitiosActivos: dashboard.clientes.length,
    opportunityScorePromedio: Math.round(promedio * 10) / 10,
    costeTotalUsd: Math.round((costeMicros / 1_000_000) * 100) / 100,
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

export function serieTemporalCoste(dashboard: CarteraDashboard): PuntoCosteRun[] {
  return dashboard.clientes
    .flatMap((c) => c.runs)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      fecha: r.created_at.slice(0, 10),
      costeUsd: Math.round((r.coste_micros_usd / 1_000_000) * 100) / 100,
    }));
}
