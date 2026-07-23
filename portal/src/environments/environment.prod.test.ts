import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment as prod } from './environment.prod';

/**
 * Fija los DEFAULTS DE PRODUCCIÓN que son decisiones de seguridad de Fase 1, no config editable.
 *
 * El falso verde que encontró la 10ª review (#4): el test de `mostrarLanzarResearch` prueba la
 * función pura, pero nada probaba que el environment de PRODUCCIÓN tenga el flag apagado. Mutar
 * `lanzarResearch` a `true` dejaba todo verde. Esto lo cierra: si alguien enciende un flag de Fase 1
 * en `environment.prod.ts`, este test cae.
 *
 * (El cableado del `@if` en las plantillas lo cubre el spec de componente de karma; esto cubre el
 * VALOR que ese `@if` consume.)
 */

test('producción es production:true', () => {
  assert.equal(prod.production, true);
});

test('Fase 1: lanzarResearch está APAGADO en producción', () => {
  assert.equal(prod.features.lanzarResearch, false);
});

test('Fase 1: aprobarRun está APAGADO en producción', () => {
  assert.equal(prod.features.aprobarRun, false);
});
