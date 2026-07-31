import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock } from './cartera-mock';
import { kpisDeCartera, topOportunidades, serieTemporalCoste } from './cartera';

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
  const esperadoMicros = d.clientes.flatMap((c) => c.runs).reduce((acc, r) => acc + r.coste_micros_usd, 0);
  assert.equal(kpis.costeTotalUsd, Math.round((esperadoMicros / 1_000_000) * 100) / 100);
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
