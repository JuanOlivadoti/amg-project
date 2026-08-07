import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock, type CarteraDashboard } from './cartera-mock';
import { kpisDeCartera, topOportunidades, serieTemporalCoste } from './cartera';
import type { RunSummary } from './models';

/**
 * Un run mínimo con el coste que se le pida. `null` es un valor REAL de este campo desde que
 * `RUN_SUMMARY_COLS` lo envuelve en `case when app.es_staff() then …` (`db/src/store.ts`): quien no
 * es staff recibe `null`, no un cero.
 */
function run(coste: number | null, dia: number): RunSummary {
  return {
    id: `run-${dia}`,
    client_id: 'c1',
    status: 'approved',
    prompt: 'p',
    schema_version: 'kr.v0.5',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: coste,
    calidad_datos: {},
    config: {},
    created_at: `2026-07-0${dia}T00:00:00.000Z`,
    finished_at: null,
  };
}

function dash(...runs: RunSummary[]): CarteraDashboard {
  return {
    clientes: [{ client_id: 'c1', nombre: 'X', runs }],
    pages: [],
    paginasDelClientePrincipal: [],
  };
}

test('kpisDeCartera: sitiosActivos es la cantidad de clientes', () => {
  const d = generarCarteraMock();
  assert.equal(kpisDeCartera(d).sitiosActivos, d.clientes.length);
});

test('kpisDeCartera: opportunityScorePromedio es el promedio simple de todas las páginas', () => {
  const d = generarCarteraMock();
  const esperado = d.pages.reduce((a, p) => a + p.opportunity_score, 0) / d.pages.length;
  assert.equal(kpisDeCartera(d).opportunityScorePromedio, Math.round(esperado * 10) / 10);
});

test('kpisDeCartera: costeTotalUsd suma coste_micros_usd de todos los runs de la cartera', () => {
  const d = generarCarteraMock();
  const kpis = kpisDeCartera(d);
  const esperadoMicros = d.clientes
    .flatMap((c) => c.runs)
    .reduce((acc, r) => acc + (r.coste_micros_usd ?? 0), 0);
  assert.equal(kpis.costeTotalUsd, Math.round((esperadoMicros / 1_000_000) * 100) / 100);
});

/*
 * Los cuatro tests que siguen son el contrato del coste ausente, y valen como GRUPO: cada uno solo
 * descarta una forma de equivocarse, y las cuatro son distintas.
 *
 * El criterio que los gobierna: **un dato ausente no es un cero**. Es el mismo que el informe ya
 * aplica con `n/d` en vez de `0` para el volumen de búsqueda (`contrato/src/informe.ts`, `metric()`),
 * y por el mismo motivo — pintar `$0.00` donde no hay dato AFIRMA que el research fue gratis.
 */
test('costeTotalUsd suma solo los runs con coste, y el total no se contamina', () => {
  /*
   * SIN 🔴 a propósito, y el motivo importa más que el test: medido en node v24.18.1, `300000 + null`
   * es `300000`, **no NaN** — JS coacciona `null` a 0 en aritmética. Así que quitar la guarda de la
   * suma NO tumba este test, y ponerle 🔴 sería reclamar una mutación que no existe.
   *
   * Es exactamente lo que hace peligroso a este `| null`: no rompe ruidosamente, se suma como cero.
   * Lo que sí falla ruidosamente es el caso de abajo (todos null → el total tiene que ser `null`), y
   * ése es el que defiende de verdad la distinción.
   */
  const kpis = kpisDeCartera(dash(run(300_000, 1), run(null, 2), run(200_000, 3)));
  assert.equal(kpis.costeTotalUsd, 0.5);
});

test('🔴 si NINGÚN run trae coste, el KPI es null: es «no disponible», no «$0.00»', () => {
  // El caso del rol que no es staff: la API le devuelve `null` en TODOS los runs. Un 0 acá le diría
  // que la cartera entera de research costó cero.
  assert.equal(kpisDeCartera(dash(run(null, 1), run(null, 2))).costeTotalUsd, null);
});

test('un coste de CERO sí es un dato: el KPI vale 0, no null', () => {
  // La mitad simétrica del test de arriba: si «no hay dato» se implementara como `sum === 0 ? null`,
  // una cartera que de verdad no costó nada desaparecería del tile. La distinción es «hubo algún
  // número», no «el número es distinto de cero».
  assert.equal(kpisDeCartera(dash(run(0, 1))).costeTotalUsd, 0);
});

test('🔴 serieTemporalCoste OMITE el run sin coste, en vez de graficarlo en 0', () => {
  // `Math.round((null / 1e6) * 100) / 100` da **0**, no NaN (`null` se coacciona a 0 en aritmética),
  // así que este fallo NO se ve como un error: se ve como una corrida gratis en el gráfico. Un punto
  // que no se conoce no se dibuja.
  const serie = serieTemporalCoste(dash(run(300_000, 1), run(null, 2), run(200_000, 3)));
  assert.deepEqual(serie, [
    { fecha: '2026-07-01', costeUsd: 0.3 },
    { fecha: '2026-07-03', costeUsd: 0.2 },
  ]);
});

test('topOportunidades: devuelve las N páginas de mayor opportunity_score, ordenadas desc', () => {
  const d = generarCarteraMock();
  const top3 = topOportunidades(d.pages, 3);
  assert.equal(top3.length, 3);
  const scoresOrdenados = [...d.pages].map((p) => p.opportunity_score).sort((a, b) => b - a);
  assert.deepEqual(top3.map((t) => t.score), scoresOrdenados.slice(0, 3));
});

test('serieTemporalCoste: un punto por run, ordenados por fecha ascendente', () => {
  const d = generarCarteraMock();
  const serie = serieTemporalCoste(d);
  const totalRuns = d.clientes.reduce((acc, c) => acc + c.runs.length, 0);
  assert.equal(serie.length, totalRuns);
  const fechas = serie.map((p) => p.fecha);
  assert.deepEqual(fechas, [...fechas].sort());
});
