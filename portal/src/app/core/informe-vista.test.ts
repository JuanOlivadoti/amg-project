import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisoCongelado, fechaLegible } from './informe-vista';

test('fechaLegible: el ISO de la API se lee como fecha y hora, con la zona escrita', () => {
  // El instante real del informe de la demo (`db/src/seed-demo.ts`).
  assert.equal(fechaLegible('2026-07-30T00:16:15.597Z'), '30/07/2026, 00:16 UTC');
  // Sin milisegundos y sin la Z también: es la misma forma ISO.
  assert.equal(fechaLegible('2026-08-05T21:04:41Z'), '05/08/2026, 21:04 UTC');
});

test('🔴 fechaLegible NO inventa una fecha con una entrada que no es ISO: la muestra tal cual', () => {
  // `PgStore.getInforme` garantiza el ISO, pero esta función no puede comprobarlo. Falla cerrado, igual
  // que el parser de Markdown con una marca desconocida: lo raro se VE, no se esconde ni se sustituye por
  // un `Invalid Date` ni por la fecha de hoy.
  assert.equal(fechaLegible('mañana'), 'mañana');
  assert.equal(fechaLegible(''), '');
});

test('🔴 el aviso dice que el informe está congelado, con la fecha, y la frase completa', () => {
  /*
   * Esto es el contrato con el revisor, no un texto de relleno: el informe refleja el brief del momento
   * en que se generó, así que si alguien editó una keyword después, la pantalla y el informe NO coinciden.
   * La frase es lo único que evita que quien encuentre la discrepancia crea que el sistema se equivocó.
   * Se fija acá —y no en un test de Karma— porque es una cadena, no un render.
   */
  assert.equal(
    avisoCongelado('2026-07-30T00:16:15.597Z'),
    'Informe generado el 30/07/2026, 00:16 UTC. Refleja el brief original; ' +
      'las ediciones posteriores del revisor no están incluidas.',
  );
});

test('🔴 sin fecha, el aviso sigue avisando y no imprime "null"', () => {
  // `kr_informes.generado_at` es `not null` (0016), así que en el contrato esto solo puede pasar si no hay
  // informe. Pero el tipo lo admite, y un `Informe generado el null.` en la cara del revisor sería el
  // resultado. Lo importante —que el texto está congelado— se dice igual.
  const aviso = avisoCongelado(null);
  assert.ok(!aviso.includes('null'), aviso);
  assert.equal(
    aviso,
    'Informe congelado en el momento en que se generó. Refleja el brief original; ' +
      'las ediciones posteriores del revisor no están incluidas.',
  );
});
