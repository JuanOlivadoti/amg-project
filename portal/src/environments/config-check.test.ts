import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemasDeConfigProd } from './config-check';
import { environment as prod } from './environment.prod';

const OK = {
  apiBaseUrl: 'https://api.bellanapoli-demo.com',
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiExampleAnonKey',
};

test('una config real y HTTPS no tiene problemas', () => {
  assert.deepEqual(problemasDeConfigProd(OK), []);
});

test('detecta el placeholder de la api', () => {
  const p = problemasDeConfigProd({ ...OK, apiBaseUrl: 'https://api.tudominio.com' });
  assert.equal(p.length, 1);
  assert.match(p[0]!, /apiBaseUrl/);
});

test('detecta los placeholders de Supabase', () => {
  const p = problemasDeConfigProd({
    ...OK,
    supabaseUrl: 'https://TU-PROYECTO.supabase.co',
    supabaseAnonKey: 'TU-ANON-KEY-PUBLICA',
  });
  assert.equal(p.length, 2);
});

test('rechaza api/supabase que no sean HTTPS', () => {
  const p = problemasDeConfigProd({ ...OK, apiBaseUrl: 'http://api.x.com' });
  assert.ok(p.some((x) => /HTTPS/.test(x)));
});

test('rechaza valores vacíos', () => {
  const p = problemasDeConfigProd({ ...OK, supabaseAnonKey: '' });
  assert.ok(p.some((x) => /vac/.test(x)));
});

/**
 * El estado ACTUAL del repo: `environment.prod.ts` tiene placeholders a propósito (Juan los completa
 * antes de desplegar). Este test fija esa expectativa —el guard DEBE marcarlo como no-listo— para que
 * el propio guard no se rompa en silencio. Cuando Juan complete los valores reales, este test se
 * actualiza a `deepEqual([])`.
 */
test('el environment.prod del repo AÚN tiene placeholders (Juan los completa al desplegar)', () => {
  assert.ok(problemasDeConfigProd(prod).length > 0, 'con placeholders, el guard frena el build');
});
