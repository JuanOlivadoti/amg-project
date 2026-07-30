import type { PaginaPropuesta, RunSummary } from './models';
import { EVIDENCIA_RESPALDADA } from './evidence';

export interface ClienteCartera {
  readonly client_id: string;
  /** La API no expone nombre de cliente hoy (solo `client_id`) — 100% mock, documentado acá. */
  readonly nombre: string;
  readonly runs: readonly RunSummary[];
}

export interface CarteraDashboard {
  readonly clientes: readonly ClienteCartera[];
  readonly pages: readonly PaginaPropuesta[];
}

const NOMBRES: readonly string[] = [
  'Trattoria Novecento',
  'Sushi Kamon',
  'Parrilla del Puerto',
  'La Tapería',
  'Verde Bowl',
  'Café Andén',
];

function runMock(clientIdx: number, runIdx: number, clientId: string): RunSummary {
  const dia = 1 + clientIdx * 5 + runIdx * 2;
  return {
    id: `run-${clientIdx}-${runIdx}`,
    client_id: clientId,
    status: 'approved',
    prompt: `Research ${NOMBRES[clientIdx]}`,
    schema_version: 'kr.v0.5',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: 250_000 + clientIdx * 40_000 + runIdx * 15_000,
    calidad_datos: {},
    config: {},
    created_at: new Date(Date.UTC(2026, 6, dia)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 6, dia, 0, 20)).toISOString(),
  };
}

function paginaMock(runId: string, pageIdx: number, semillaBase: number): PaginaPropuesta {
  const semilla = semillaBase + pageIdx * 3;
  return {
    id: `${runId}-pagina-${pageIdx}`,
    approved: pageIdx % 3 !== 0,
    cluster_id: `cluster-${runId}-${pageIdx % 3}`,
    tipo: 'comercial',
    page_strategy: null,
    url_slug: `/pagina-${runId}-${pageIdx}`,
    keyword_principal: `keyword ${runId} ${pageIdx}`,
    keywords_secundarias: [],
    intencion: pageIdx % 2 === 0 ? 'comercial' : 'informacional',
    local: true,
    volumen: 100 + semilla * 37,
    dificultad: 10 + (semilla % 60),
    evidencia: pageIdx % 3 === 0 ? 'sin_datos' : EVIDENCIA_RESPALDADA,
    opportunity_score: Math.round(((semilla * 13) % 100) * 10) / 10,
    score_confidence: Math.round((semilla * 17) % 100) / 100,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
  };
}

export function generarCarteraMock(): CarteraDashboard {
  const clientes: ClienteCartera[] = [];
  const pages: PaginaPropuesta[] = [];

  NOMBRES.forEach((nombre, clientIdx) => {
    const clientId = `cliente-${clientIdx}`;
    const runs = [0, 1].map((runIdx) => runMock(clientIdx, runIdx, clientId));
    runs.forEach((run, runIdx) => {
      for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
        pages.push(paginaMock(run.id, pageIdx, clientIdx * 7 + runIdx * 11));
      }
    });
    clientes.push({ client_id: clientId, nombre, runs });
  });

  return { clientes, pages };
}
