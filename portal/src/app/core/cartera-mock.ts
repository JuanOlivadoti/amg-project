import type { PaginaPropuesta, RunSummary } from './models';
import { EVIDENCIA_RESPALDADA } from './evidence';

export interface ClienteCartera {
  readonly client_id: string;
  /**
   * La API no expone nombre de cliente hoy (solo `client_id`), así que el nombre lo pone esta pantalla.
   * Para el cliente REAL es el nombre sembrado en la base; para los demás, muestra.
   */
  readonly nombre: string;
  readonly runs: readonly RunSummary[];
}

export interface CarteraDashboard {
  readonly clientes: readonly ClienteCartera[];
  /** Todas las páginas de la cartera: alimentan los KPIs y el gráfico de oportunidades. */
  readonly pages: readonly PaginaPropuesta[];
  /**
   * Solo las del cliente real. La tabla de la pantalla lista ESTAS: con `pages` entero se veían 14
   * filas reales seguidas de 30 de relleno — algo que solo se nota abriendo la página.
   */
  readonly paginasDelClientePrincipal: readonly PaginaPropuesta[];
}

/**
 * ## Por qué el primer cliente NO es de muestra
 *
 * El recorrido de la demo es dashboard → cliente → página, y hasta ahora cada pantalla hablaba de un
 * negocio distinto: acá salían seis restaurantes inventados, el brief mostraba el italiano de ejemplo
 * y la web servía La Birra Bar. Tres historias sin relación en tres clics.
 *
 * Ahora la cartera **abre con el cliente real**: los mismos IDs, el mismo coste y las mismas keywords
 * que están sembrados en la base (`db/src/seed-demo.ts`) y publicados en Storyblok. La fila que Frank
 * abre es la que después ve por dentro. Los otros cinco siguen siendo muestra: hacen falta para que
 * un *panorama de cartera* se lea como un panorama y no como una sola fila.
 *
 * **Límite conocido:** los UUID y los números están copiados del seed, no importados — `portal/` vive
 * fuera del monorepo a propósito (ADR-16/21), así que no hay forma de que un test ate las dos copias.
 * Si cambian los IDs fijos del seed, hay que tocar los dos lados. Lo que sí está atado por test es el
 * perfil del negocio, entre el seed y `web-builder/business-profile.json`.
 */
const CLIENTE_REAL = {
  clientId: 'd3305eba-11a5-4e0e-9c1f-000000000001',
  runId: 'd3305eba-11a5-4e0e-9c1f-000000000002',
  nombre: 'La Birra Bar',
  /** $0.3097: lo que costó de verdad la corrida de la acción 06 (2026-07-30). */
  costeMicros: 309_700,
  prompt:
    'Hamburguesería gourmet argentina en Madrid, con dos locales (Puerta del Sol y barrio de Salamanca).',
} as const;

/**
 * Las 14 páginas del brief real, en el orden del seed: 8 respaldadas por datos de mercado y 6 sin
 * validar. Son las que el dashboard grafica en "Top oportunidades", así que tienen que ser las
 * keywords que Frank va a reconocer, no relleno.
 *
 * `[keyword, slug, score, volumen, dificultad]` — volumen `null` = sin validar (≠ 0, ver `kr.v0.4`).
 */
const PAGINAS_REALES: readonly [string, string, number, number | null, number | null][] = [
  ['mejor hamburguesa madrid', '/mejor-hamburguesa-madrid', 94.5, 2400, 34],
  ['la birra bar madrid', '/la-birra-bar-madrid', 92.0, 1900, 8],
  ['hamburgueseria madrid centro', '/hamburgueseria-madrid-centro', 86.4, 1300, 28],
  ['cerveza artesanal madrid', '/cerveza-artesanal-madrid', 79.8, 880, 31],
  ['hamburguesa gourmet madrid', '/hamburguesa-gourmet-madrid', 77.2, 720, 22],
  ['hamburgueseria barrio salamanca', '/hamburgueseria-barrio-salamanca', 74.0, 390, 18],
  ['hamburguesa argentina madrid', '/hamburguesa-argentina-madrid', 71.5, 260, 15],
  ['hamburgueseria puerta del sol', '/hamburgueseria-puerta-del-sol', 68.3, 210, 20],
  ['patatas fritas especiales madrid', '/patatas-fritas-especiales-madrid', 57.0, null, null],
  ['hamburguesas para llevar madrid', '/hamburguesas-para-llevar-madrid', 53.5, null, null],
  ['cenas de grupo hamburgueseria madrid', '/cenas-de-grupo-hamburgueseria-madrid', 49.0, null, null],
  ['como se hace la golden burger', '/como-se-hace-la-golden-burger', 46.5, null, null],
  ['maridaje cerveza artesanal hamburguesa', '/maridaje-cerveza-artesanal-hamburguesa', 43.0, null, null],
  ['historia la birra bar', '/historia-la-birra-bar-buenos-aires-madrid', 40.0, null, null],
];

/** Los otros cinco: cartera de muestra, para que el panorama se lea como un panorama. */
const NOMBRES_MUESTRA: readonly string[] = [
  'Trattoria Novecento',
  'Sushi Kamon',
  'Parrilla del Puerto',
  'La Tapería',
  'Verde Bowl',
];

function runReal(): RunSummary {
  return {
    id: CLIENTE_REAL.runId,
    client_id: CLIENTE_REAL.clientId,
    // Espera en la compuerta, igual que en la base: es lo que Frank va a cruzar en la demo.
    status: 'pending_approval',
    prompt: CLIENTE_REAL.prompt,
    schema_version: 'kr.v0.5',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: CLIENTE_REAL.costeMicros,
    calidad_datos: { cobertura_volumen: 0.571, keywords_con_volumen: 8, keywords_totales: 14 },
    config: { max_cost_usd: 1.0, max_pages: 14 },
    created_at: new Date(Date.UTC(2026, 6, 30)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 6, 30, 0, 16, 15)).toISOString(),
  };
}

function paginasReales(): PaginaPropuesta[] {
  return PAGINAS_REALES.map(([keyword, slug, score, volumen, dificultad], i) => ({
    id: `${CLIENTE_REAL.runId}-pagina-${i}`,
    // Ninguna nace aprobada: la compuerta certifica que un humano miró (ADR-06).
    approved: false,
    cluster_id: `cluster-real-${i % 4}`,
    tipo: volumen === null && i >= 11 ? 'blog' : 'landing_local',
    page_strategy: i === 0 ? 'hub' : 'spoke',
    url_slug: slug,
    keyword_principal: keyword,
    keywords_secundarias: [],
    intencion: i % 2 === 0 ? 'transaccional' : 'comercial',
    local: i < 11,
    volumen,
    dificultad,
    evidencia: volumen === null ? 'sin_datos' : EVIDENCIA_RESPALDADA,
    opportunity_score: score,
    // Las respaldadas tienen confianza alta; las que no tienen volumen, baja — es el dato que
    // `score_confidence` existe para decir.
    score_confidence: volumen === null ? 0.25 : 0.8,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
  }));
}

function runMuestra(clientIdx: number, runIdx: number, clientId: string, nombre: string): RunSummary {
  const dia = 1 + clientIdx * 5 + runIdx * 2;
  return {
    id: `run-${clientIdx}-${runIdx}`,
    client_id: clientId,
    status: 'approved',
    prompt: `Research ${nombre}`,
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

/**
 * El score de las páginas de muestra se topa a 60, POR DEBAJO del más bajo de las respaldadas reales
 * (68.3). Sin ese techo, el relleno llegaba a 98 y se quedaba con el gráfico de "Top oportunidades"
 * —6 de las 8 barras eran `keyword run-N-M`—, que es lo primero que se ve de la demo. Solo se nota
 * abriendo la pantalla: los tests de KPIs pasaban igual.
 */
const TECHO_SCORE_MUESTRA = 60;

function paginaMuestra(runId: string, pageIdx: number, semillaBase: number): PaginaPropuesta {
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
    opportunity_score: Math.round(((semilla * 13) % TECHO_SCORE_MUESTRA) * 10) / 10,
    score_confidence: Math.round((semilla * 17) % 100) / 100,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
  };
}

export function generarCarteraMock(): CarteraDashboard {
  const clientes: ClienteCartera[] = [
    { client_id: CLIENTE_REAL.clientId, nombre: CLIENTE_REAL.nombre, runs: [runReal()] },
  ];
  const delClientePrincipal = paginasReales();
  const pages: PaginaPropuesta[] = [...delClientePrincipal];

  NOMBRES_MUESTRA.forEach((nombre, i) => {
    // El índice arranca en 1: el 0 es del cliente real, y los ids de run de muestra (`run-N-M`) no
    // deben chocar con nada.
    const clientIdx = i + 1;
    const clientId = `cliente-${clientIdx}`;
    const runs = [0, 1].map((runIdx) => runMuestra(clientIdx, runIdx, clientId, nombre));
    runs.forEach((run, runIdx) => {
      for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
        pages.push(paginaMuestra(run.id, pageIdx, clientIdx * 7 + runIdx * 11));
      }
    });
    clientes.push({ client_id: clientId, nombre, runs });
  });

  return { clientes, pages, paginasDelClientePrincipal: delClientePrincipal };
}
