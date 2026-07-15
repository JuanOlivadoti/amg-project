import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separarPorEvidencia, esRespaldada, puedeAprobarseRun } from './evidence';
import type { PaginaPropuesta } from './models';

function pagina(over: Partial<PaginaPropuesta>): PaginaPropuesta {
  return {
    id: 'p',
    approved: false,
    cluster_id: 'c',
    tipo: 'landing_local',
    page_strategy: null,
    url_slug: '/x',
    keyword_principal: 'kw',
    keywords_secundarias: [],
    intencion: 'local',
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: 'sin_validar',
    opportunity_score: 50,
    score_confidence: 0.3,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
    ...over,
  };
}

test('separa respaldadas (datos_mercado) de sin validar', () => {
  const pages = [
    pagina({ id: 'a', evidencia: 'datos_mercado' }),
    pagina({ id: 'b', evidencia: 'sin_validar' }),
    pagina({ id: 'c', evidencia: 'datos_mercado' }),
  ];
  const { respaldadas, sinValidar } = separarPorEvidencia(pages);
  assert.deepEqual(respaldadas.map((p) => p.id), ['a', 'c']);
  assert.deepEqual(sinValidar.map((p) => p.id), ['b']);
});

test('conserva el orden de entrada (la API ya ordenó por score)', () => {
  const pages = [
    pagina({ id: '1', evidencia: 'datos_mercado' }),
    pagina({ id: '2', evidencia: 'datos_mercado' }),
  ];
  assert.deepEqual(separarPorEvidencia(pages).respaldadas.map((p) => p.id), ['1', '2']);
});

test('no descarta ninguna: mostrar lo que no se sabe es el punto', () => {
  const pages = [pagina({ evidencia: 'sin_validar' }), pagina({ evidencia: 'otra_cosa' })];
  const { respaldadas, sinValidar } = separarPorEvidencia(pages);
  assert.equal(respaldadas.length, 0);
  assert.equal(sinValidar.length, 2);
});

test('esRespaldada solo es true para datos_mercado', () => {
  assert.equal(esRespaldada(pagina({ evidencia: 'datos_mercado' })), true);
  assert.equal(esRespaldada(pagina({ evidencia: 'sin_validar' })), false);
});

test('puedeAprobarseRun exige al menos una página aprobada (ADR-06)', () => {
  assert.equal(puedeAprobarseRun([pagina({ approved: false })]), false);
  assert.equal(puedeAprobarseRun([pagina({ approved: false }), pagina({ approved: true })]), true);
  assert.equal(puedeAprobarseRun([]), false);
});
