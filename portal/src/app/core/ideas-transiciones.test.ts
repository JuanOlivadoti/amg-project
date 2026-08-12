import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSICIONES_IDEA, transicionesDesde } from './ideas-transiciones';
import type { EstadoIdea } from './models';

const ESTADOS: readonly EstadoIdea[] = ['nueva', 'en_revision', 'aprobada', 'rechazada'];

test('la tabla tiene los cuatro estados como claves, ni uno más ni uno menos', () => {
  assert.deepEqual(Object.keys(TRANSICIONES_IDEA).sort(), [...ESTADOS].sort());
});

test('nueva → en_revision es la única transición desde nueva', () => {
  assert.deepEqual(transicionesDesde('nueva'), ['en_revision']);
});

test('en_revision → aprobada | rechazada, en ese orden', () => {
  assert.deepEqual(transicionesDesde('en_revision'), ['aprobada', 'rechazada']);
});

test('aprobada y rechazada son terminales: sin transiciones salientes', () => {
  assert.deepEqual(transicionesDesde('aprobada'), []);
  assert.deepEqual(transicionesDesde('rechazada'), []);
});

test('🔴 espeja EXACTAMENTE TRANSICIONES_IDEA de db/src/ideas.ts: mismos pares, mismo orden', () => {
  /*
   * Esta es la SEGUNDA copia de la máquina de estados dentro del portal (la primera ya es una
   * segunda copia de la de Postgres — ver el comentario de `db/src/ideas.ts`). Un desalineo acá no
   * lo detecta ningún test que corra en `db` ni en `api`: el portal no importa de ahí (ADR-21). Si
   * alguien cambia una transición en la base y se olvida de esta tabla, la UI seguiría ofreciendo (o
   * negando) un botón que ya no corresponde — la API lo rechazaría igual, pero el mensaje sería "no
   * se pudo" en vez de que el botón ni apareciera.
   */
  const esperado: Record<EstadoIdea, readonly EstadoIdea[]> = {
    nueva: ['en_revision'],
    en_revision: ['aprobada', 'rechazada'],
    aprobada: [],
    rechazada: [],
  };
  for (const estado of ESTADOS) {
    assert.deepEqual(TRANSICIONES_IDEA[estado], esperado[estado], `transiciones desde ${estado}`);
  }
});
