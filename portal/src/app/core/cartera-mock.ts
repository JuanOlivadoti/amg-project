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
 * **Copiado del seed, pero ATADO por test.** Los UUID y los números siguen escritos acá porque
 * `portal/` vive fuera del monorepo a propósito (ADR-16/21) y no puede importar `db`. Lo que antes
 * decía este comentario —que por eso *ningún test podía atar las dos copias*— resultó falso, y caro:
 * el 2026-08-01 el seed trajo sus keywords de Storyblok, esta copia se quedó con las viejas, y
 * producción mostró las mismas métricas con nombres distintos en dos pantallas a dos clics.
 * Estar fuera del monorepo impide importar el paquete, no leer el archivo:
 * `db/src/cartera-portal.test.ts` carga este módulo y compara las 14 páginas campo por campo.
 * Si cambia el brief sembrado, ese test falla y dice exactamente qué fila difiere.
 */
export const CLIENTE_REAL = {
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
 * **Copiadas de `db/src/seed-demo.ts`**, que a su vez las leyó de Storyblok: son los slugs, keywords
 * y tipos que están publicados de verdad. `volumen: null` = sin validar (≠ 0, ver `kr.v0.4`).
 * `db/src/cartera-portal.test.ts` compara esta lista contra `PAGINAS_DEMO` campo por campo y en
 * orden — si cambia el brief sembrado y esta copia no, la suite lo dice antes que un cliente.
 */
interface PaginaReal {
  readonly keyword: string;
  readonly slug: string;
  readonly tipo: string;
  readonly intencion: string;
  readonly local: boolean;
  readonly volumen: number | null;
  readonly dificultad: number | null;
  readonly score: number;
  readonly confianza: number;
}

export const PAGINAS_REALES: readonly PaginaReal[] = [
  { keyword: 'mejor hamburguesa del mundo Madrid', slug: '/mejor-hamburguesa-del-mundo-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 2400, dificultad: 34, score: 94.5, confianza: 0.9 },
  { keyword: 'La Birra Bar Madrid', slug: '/la-birra-bar-madrid', tipo: 'landing_local', intencion: 'navegacional', local: true, volumen: 1900, dificultad: 8, score: 92, confianza: 0.88 },
  { keyword: 'hamburguesería gourmet Madrid', slug: '/hamburgueseria-gourmet-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 1300, dificultad: 28, score: 86.4, confianza: 0.85 },
  { keyword: 'restaurante argentino en Madrid', slug: '/restaurante-argentino-en-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 880, dificultad: 31, score: 79.8, confianza: 0.81 },
  { keyword: 'cervezas artesanales Madrid', slug: '/cervezas-artesanales-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 720, dificultad: 22, score: 77.2, confianza: 0.8 },
  { keyword: 'cerveza Ale Ogham Madrid', slug: '/cerveza-ale-ogham-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 390, dificultad: 18, score: 74, confianza: 0.78 },
  { keyword: 'tienda de cervezas artesanales madrid', slug: '/tienda-de-cervezas-artesanales-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 260, dificultad: 15, score: 71.5, confianza: 0.76 },
  { keyword: 'patatas fritas especiales Madrid', slug: '/patatas-fritas-especiales-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: 210, dificultad: 20, score: 68.3, confianza: 0.74 },
  { keyword: 'opiniones de la birra bar hamburguesas artesanales madrid', slug: '/opiniones-de-la-birra-bar-hamburguesas-artesanales-madrid', tipo: 'landing_local', intencion: 'comercial', local: true, volumen: null, dificultad: null, score: 57, confianza: 0.25 },
  { keyword: 'hamburguesas con salsas de la casa', slug: '/hamburguesas-con-salsas-de-la-casa', tipo: 'servicio', intencion: 'comercial', local: false, volumen: null, dificultad: null, score: 53.5, confianza: 0.25 },
  { keyword: 'hamburguesas de carne vacuna española', slug: '/hamburguesas-de-carne-vacuna-espanola', tipo: 'servicio', intencion: 'comercial', local: false, volumen: null, dificultad: null, score: 49, confianza: 0.25 },
  { keyword: 'hamburguesas con pan artesanal', slug: '/hamburguesas-con-pan-artesanal', tipo: 'servicio', intencion: 'comercial', local: false, volumen: null, dificultad: null, score: 46.5, confianza: 0.25 },
  { keyword: 'mejor hamburguesa Dubai Burger Championship', slug: '/mejor-hamburguesa-dubai-burger-championship', tipo: 'blog', intencion: 'informacional', local: false, volumen: null, dificultad: null, score: 43, confianza: 0.25 },
  { keyword: 'People\'s Choice Award Burger Bash Miami', slug: '/people-s-choice-award-burger-bash-miami', tipo: 'blog', intencion: 'informacional', local: false, volumen: null, dificultad: null, score: 40, confianza: 0.25 },
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
    /*
     * Los huecos de la corrida real, DECLARADOS. Copiado de `CALIDAD_DATOS_DEMO`
     * (`db/src/seed-demo.ts`) y atado por `db/src/cartera-portal.test.ts`, que compara este objeto
     * contra el del seed.
     *
     * Los tres `null` no son "sin datos todavía": el `0.571` que había acá era cobertura por PÁGINA (8
     * de 14) y `DataQuality` define cobertura por KEYWORD, así que como dato de calidad mentía; la de KD
     * no quedó registrada; y `endpoints_degradados` va `null` y no `[]` porque `[]` afirmaría "ninguno
     * falló" y la corrida no registró nada sobre endpoints. `keywords_analizadas: 55` sí está medido.
     */
    calidad_datos: {
      cobertura_volumen: null,
      cobertura_kd: null,
      endpoints_degradados: null,
      keywords_analizadas: 55,
    },
    config: { max_cost_usd: 1.0, max_pages: 14 },
    created_at: new Date(Date.UTC(2026, 6, 30)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 6, 30, 0, 16, 15)).toISOString(),
  };
}

function paginasReales(): PaginaPropuesta[] {
  return PAGINAS_REALES.map((p, i) => ({
    id: `${CLIENTE_REAL.runId}-pagina-${i}`,
    // Ninguna nace aprobada: la compuerta certifica que un humano miró (ADR-06).
    approved: false,
    cluster_id: `cluster-real-${i % 4}`,
    // `tipo`, `intencion` y `local` salen del dato, no del índice: derivarlos de la posición hacía
    // que el dashboard contradijera al brief que muestra la pantalla de al lado.
    tipo: p.tipo,
    page_strategy: i === 0 ? 'hub' : p.tipo === 'blog' ? 'single' : 'spoke',
    url_slug: p.slug,
    keyword_principal: p.keyword,
    keywords_secundarias: [],
    intencion: p.intencion,
    local: p.local,
    volumen: p.volumen,
    dificultad: p.dificultad,
    evidencia: p.volumen === null ? 'sin_datos' : EVIDENCIA_RESPALDADA,
    opportunity_score: p.score,
    score_confidence: p.confianza,
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
