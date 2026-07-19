import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vigencia } from './vigencia';

test('una respuesta del run actual sigue vigente', () => {
  const v = new Vigencia();
  v.cambiarA('run-A');
  assert.equal(v.obsoleta('run-A'), false);
});

test('🔴 la respuesta de un run anterior queda obsoleta: no puede pisar la pantalla', () => {
  // El bug: cargar(A) → navegar a B → B pinta → llega A y sobrescribía con A, con la URL en B.
  const v = new Vigencia();
  v.cambiarA('run-A');
  const enVuelo = v.actual; // se captura ANTES del await
  v.cambiarA('run-B');
  assert.equal(v.obsoleta(enVuelo), true, 'la de A llegó tarde');
  assert.equal(v.obsoleta('run-B'), false, 'la de B sí manda');
});

test('🔴 tras destruir, NADA sigue vigente: ni la respuesta del run actual', () => {
  // El bug: la promesa resolvía después de ngOnDestroy y creaba un setInterval sin dueño.
  const v = new Vigencia();
  v.cambiarA('run-A');
  v.destruir();
  assert.equal(v.obsoleta('run-A'), true);
  assert.equal(v.viva, false, 'nadie debe crear un timer nuevo');
});

test('destruir es definitivo: cambiar de run después no la revive', () => {
  const v = new Vigencia();
  v.cambiarA('run-A');
  v.destruir();
  v.cambiarA('run-B');
  assert.equal(v.viva, false);
  assert.equal(v.obsoleta('run-B'), true);
});

test('arranca sin clave: cualquier respuesta con clave es obsoleta', () => {
  const v = new Vigencia();
  assert.equal(v.obsoleta('run-A'), true);
  assert.equal(v.actual, '');
});
