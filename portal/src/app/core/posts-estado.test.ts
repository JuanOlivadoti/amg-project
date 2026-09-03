import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDePost } from './posts-estado';
import type { PostDePagina } from './models';

/**
 * La máquina de 4 estados de `PostDePagina` (Task 11, sub-proyecto de publicación en blog externo).
 * El orden de prioridad importa: `publicadoEn` gana sobre `solicitadoEn`, que gana sobre `errorEn`.
 * Corregido tras la ronda de Codex sobre el plan: la primera versión no distinguía "publicando ahora
 * mismo" de "el último intento falló" — las dos se veían igual (`solicitadoEn` seteado) y el botón
 * quedaba deshabilitado para siempre en el segundo caso. `errorEn` es la señal explícita.
 */
function post(overrides: Partial<PostDePagina> = {}): PostDePagina {
  return {
    titulo: 'Un post',
    cuerpo: '<p>Cuerpo</p>',
    generadoEn: '2026-09-01T00:00:00.000Z',
    solicitadoEn: null,
    publicadoEn: null,
    urlExterna: null,
    errorEn: null,
    ...overrides,
  };
}

test('null (404 de GET /pages/:id/post): generando', () => {
  assert.equal(estadoDePost(null), 'generando');
});

test('publicadoEn puesto: publicada, sin importar el resto', () => {
  assert.equal(
    estadoDePost(post({ publicadoEn: '2026-09-02T00:00:00.000Z', urlExterna: 'https://blog.test/p' })),
    'publicada',
  );
});

test('solicitadoEn puesto y publicadoEn null: publicando', () => {
  assert.equal(estadoDePost(post({ solicitadoEn: '2026-09-02T00:00:00.000Z' })), 'publicando');
});

test('🔴 errorEn puesto, solicitadoEn y publicadoEn en null: fallo, NO "publicando" para siempre', () => {
  assert.equal(estadoDePost(post({ errorEn: '2026-09-02T00:00:00.000Z' })), 'fallo');
});

test('sin solicitar, sin error, sin publicar: editable', () => {
  assert.equal(estadoDePost(post()), 'editable');
});

test('🔴 publicadoEn manda sobre errorEn (defensa: el servidor no debería mandar los dos, pero si pasa, publicada gana)', () => {
  assert.equal(
    estadoDePost(post({ publicadoEn: '2026-09-02T00:00:00.000Z', errorEn: '2026-09-01T00:00:00.000Z' })),
    'publicada',
  );
});

test('🔴 solicitadoEn manda sobre errorEn: un reintento en curso no puede leerse como "falló"', () => {
  assert.equal(
    estadoDePost(post({ solicitadoEn: '2026-09-02T00:00:00.000Z', errorEn: '2026-09-01T00:00:00.000Z' })),
    'publicando',
  );
});
