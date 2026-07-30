import type { CarteraDashboard } from './cartera-mock';

export interface KpisCartera {
  readonly sitiosActivos: number;
  readonly opportunityScorePromedio: number;
  readonly costeDelMesUsd: number;
}

export function kpisDeCartera(dashboard: CarteraDashboard, mesReferencia: Date = new Date()): KpisCartera {
  const scores = dashboard.pages.map((p) => p.opportunity_score);
  const promedio = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const runsDelMes = dashboard.clientes.flatMap((c) => c.runs).filter((r) => {
    const fecha = new Date(r.created_at);
    return (
      fecha.getUTCFullYear() === mesReferencia.getUTCFullYear() &&
      fecha.getUTCMonth() === mesReferencia.getUTCMonth()
    );
  });
  const costeMicros = runsDelMes.reduce((acc, r) => acc + r.coste_micros_usd, 0);

  return {
    sitiosActivos: dashboard.clientes.length,
    opportunityScorePromedio: Math.round(promedio * 10) / 10,
    costeDelMesUsd: Math.round((costeMicros / 1_000_000) * 100) / 100,
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
