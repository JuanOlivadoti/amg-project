import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mostrarLanzarResearch, mostrarAprobarRun, mostrarDestinoPosts } from './features';

/**
 * El botón "lanzar research" (§A.5). La regla de Fase 1: aunque seas equipo, si el flag está
 * apagado NO se muestra —no hay orquestador detrás y un botón que no hace nada es peor que no
 * tenerlo—. Un cliente (solo lectura) no lo ve nunca. Es una decisión de despliegue, así que se
 * fija con un test en vez de confiar en que nadie borre el `&&` del template.
 */

test('equipo + flag encendido (dev/Fase 2): se muestra', () => {
  assert.equal(mostrarLanzarResearch(true, true), true);
});

test('equipo + flag apagado (Fase 1): NO se muestra, aunque sea equipo', () => {
  assert.equal(mostrarLanzarResearch(true, false), false);
});

test('no-equipo (cliente): no se muestra ni con el flag encendido', () => {
  assert.equal(mostrarLanzarResearch(false, true), false);
});

test('no-equipo + flag apagado: no se muestra', () => {
  assert.equal(mostrarLanzarResearch(false, false), false);
});

test('aprobar run: equipo + flag encendido → se muestra', () => {
  assert.equal(mostrarAprobarRun(true, true), true);
});

test('aprobar run: equipo + flag apagado (Fase 1) → NO se muestra', () => {
  assert.equal(mostrarAprobarRun(true, false), false);
});

test('aprobar run: no-equipo → no se muestra ni con el flag encendido', () => {
  assert.equal(mostrarAprobarRun(false, true), false);
});

/**
 * La opción "crear_posts" del selector de destino (sub-proyecto 3, todavía no existe). Mismo patrón
 * equipo + flag que las dos de arriba — el flag queda en `false` en los dos environments de este
 * sub-proyecto (`environment.prod.test.ts` lo fija para producción).
 */

test('destino posts: equipo + flag encendido → se muestra', () => {
  assert.equal(mostrarDestinoPosts(true, true), true);
});

test('destino posts: equipo + flag apagado (sub-proyecto 3 no existe) → NO se muestra', () => {
  assert.equal(mostrarDestinoPosts(true, false), false);
});

test('destino posts: no-equipo → no se muestra ni con el flag encendido', () => {
  assert.equal(mostrarDestinoPosts(false, true), false);
});
