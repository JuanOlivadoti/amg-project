import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCsvPortal } from './csv';

/**
 * Batería local del parser del portal. La garantía FUERTE (que este parser se comporta IGUAL que
 * `parsearCsv` de la API) no vive acá — vive en el test cruzado de
 * `api/src/comparativas/filas.test.ts`, que importa `parsearCsvPortal` por ruta y la compara contra
 * `CASOS_CSV`/`CASOS_CSV_INVALIDOS`. Esta batería es más chica y solo cubre que el módulo, aislado,
 * hace lo que promete su propio comentario.
 */

test('fila simple sin comillas', () => {
  assert.deepEqual(parsearCsvPortal('a,b,c'), [['a', 'b', 'c']]);
});

test('campo entrecomillado con coma adentro no parte la fila', () => {
  assert.deepEqual(parsearCsvPortal('a,"b,c",d'), [['a', 'b,c', 'd']]);
});

test('comillas escapadas dobles', () => {
  assert.deepEqual(parsearCsvPortal('"dice ""hola"""'), [['dice "hola"']]);
});

test('salto de línea DENTRO de un campo entrecomillado no abre fila nueva', () => {
  assert.deepEqual(parsearCsvPortal('a,"linea1\nlinea2",c'), [['a', 'linea1\nlinea2', 'c']]);
});

test('CRLF y LF mezclados, última línea sin salto también vale', () => {
  assert.deepEqual(parsearCsvPortal('a,b\r\nc,d\ne,f'), [
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ]);
});

test('texto vacío no produce filas', () => {
  assert.deepEqual(parsearCsvPortal(''), []);
});

test('🔴 una comilla sin cerrar lanza en vez de corromper filas en silencio', () => {
  assert.throws(() => parsearCsvPortal('a,"b,c\nd,e'), /línea 1/);
});
