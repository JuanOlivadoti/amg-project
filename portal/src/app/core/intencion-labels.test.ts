import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENCIONES, ETIQUETA_INTENCION, etiquetaIntencion } from './intencion-labels';

test('INTENCIONES tiene exactamente los 5 valores de SearchIntent del contrato', () => {
  assert.deepEqual(
    [...INTENCIONES].sort(),
    ['commercial', 'informational', 'local', 'navigational', 'transactional'],
  );
});

// Valor por valor, no un smoke test: un default sin test que lo fije no tiene dueño
// (mismo criterio que `contraste.test.ts` fija `AA_TEXTO_NORMAL`).
test('ETIQUETA_INTENCION traduce cada valor del contrato a su etiqueta exacta en español', () => {
  assert.equal(ETIQUETA_INTENCION.transactional, 'Transaccional');
  assert.equal(ETIQUETA_INTENCION.commercial, 'Comercial');
  assert.equal(ETIQUETA_INTENCION.local, 'Local');
  assert.equal(ETIQUETA_INTENCION.informational, 'Informacional');
  assert.equal(ETIQUETA_INTENCION.navigational, 'Navegacional');
});

test('INTENCIONES tiene exactamente una entrada en ETIQUETA_INTENCION, sin huérfanas', () => {
  for (const i of INTENCIONES) {
    assert.ok(ETIQUETA_INTENCION[i], `${i} no tiene etiqueta`);
  }
  assert.equal(Object.keys(ETIQUETA_INTENCION).length, INTENCIONES.length);
});

test('etiquetaIntencion traduce cada valor conocido', () => {
  assert.equal(etiquetaIntencion('commercial'), 'Comercial');
  assert.equal(etiquetaIntencion('local'), 'Local');
});

// 🔴 nació de un bug real: el mock del portal escribía `intencion: 'comercial'` (español, vocabulario
// viejo del seed) y la tabla lo pintaba crudo — ver `cartera-mock.ts` antes de este cambio. Mutación
// verificada: sin el `?? valor` de `etiquetaIntencion`, un valor fuera del vocabulario da `undefined`
// en vez del texto crudo, y este test cae.
test('🔴 etiquetaIntencion no esconde un valor fuera del vocabulario: muestra el crudo', () => {
  assert.equal(etiquetaIntencion('comercial'), 'comercial');
  assert.equal(etiquetaIntencion(''), '');
});
