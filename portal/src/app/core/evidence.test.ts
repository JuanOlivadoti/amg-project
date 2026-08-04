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

/**
 * 🔴 El orden que llega de la API es EL orden, y el portal no lo puede rehacer.
 *
 * La API devuelve las páginas en el orden del brief que produjo el M2 —evidencia primero, después
 * `score_confidence`— persistido en `kr_pages.orden_brief` (KR-3, migración 0015). Ese criterio **no se
 * puede reconstruir desde `opportunity_score`**: es justo lo que el `order by opportunity_score` de la
 * base deshacía antes de la 0015, y por eso la columna "Confianza" no ordenaba nada.
 *
 * El test entra con el orden CONTRADICIENDO el score (90 después de 40) a propósito. La versión
 * anterior de este test usaba dos páginas con el mismo score, así que pasaba igual con un
 * `.sort((a, b) => b.opportunity_score - a.opportunity_score)` metido en medio: no mordía. Y su nombre
 * decía "la API ya ordenó por score", que hoy es exactamente lo que la API NO hace.
 */
test('🔴 conserva el orden de entrada: es el del brief, y contradice al score a propósito', () => {
  const pages = [
    pagina({ id: 'primera-aunque-score-bajo', evidencia: 'datos_mercado', opportunity_score: 40 }),
    pagina({ id: 'segunda-aunque-score-alto', evidencia: 'datos_mercado', opportunity_score: 90 }),
  ];
  assert.deepEqual(
    separarPorEvidencia(pages).respaldadas.map((p) => p.id),
    ['primera-aunque-score-bajo', 'segunda-aunque-score-alto'],
    'si esto sale al revés, alguien está re-ordenando por score y el orden del M2 se perdió',
  );
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
