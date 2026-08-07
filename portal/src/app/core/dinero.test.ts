import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdDeMicros } from './dinero';

test('convierte micros a dólares con dos decimales', () => {
  assert.equal(usdDeMicros(309_700), '0.31');
  assert.equal(usdDeMicros(1_500_000), '1.50');
});

/**
 * Los dos casos que NO se pueden confundir, y que son el motivo entero de que esta función devuelva
 * `string | null` en vez de `string`.
 */
test('🔴 un coste de CERO es un dato: se pinta $0.00', () => {
  // Si esto devolviera `null`, un run que de verdad no costó nada dejaría de mostrar su coste y se
  // leería como «no sabemos» — la mentira simétrica de la de abajo.
  assert.equal(usdDeMicros(0), '0.00');
});

test('🔴 sin dato devuelve null, no "0.00": no se afirma que el research fue gratis', () => {
  // `coste_micros_usd` llega en `null` cuando quien pregunta no es staff (`app.es_staff()` lo decide
  // dentro de Postgres, `db/src/store.ts`). Pintar $0.00 ahí le afirmaría al lector que la agencia no
  // pagó nada por los datos. Quien recibe el `null` no pinta la línea.
  assert.equal(usdDeMicros(null), null);
});
