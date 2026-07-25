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
 * Desplegado (2026-07-25): `environment.prod.ts` ya tiene los valores reales, así que este test pasó
 * de "aún tiene placeholders" a su forma definitiva —la que anticipaba su propio comentario—.
 *
 * Ahora vale más que antes: el portal se despliega SOLO en cada push a `main` (Hostinger buildea en
 * el servidor). Si alguien revierte un valor a placeholder o lo pasa a `http://`, esto cae acá, en
 * el test, y no en un deploy que publica un portal que no puede hablar con su API.
 */
test('el environment.prod del repo está LISTO para desplegar: sin placeholders y todo HTTPS', () => {
  assert.deepEqual(problemasDeConfigProd(prod), []);
});
