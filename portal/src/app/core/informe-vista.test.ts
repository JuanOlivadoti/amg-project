import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisoCongelado, fechaDelResearch, fechaLegible } from './informe-vista';

/**
 * La cabecera REAL que emite `renderReport`, copiada del informe de la demo bajado del `dev-server` el
 * 2026-08-06 (`GET /runs/:id/informe.md`, 13.718 bytes). Es una copia y no un import: el portal no depende
 * de `contrato` a propósito (ADR-21), así que lo que se fija acá es «la forma que el generador emite hoy»,
 * y si el generador cambia, lo que pasa está medido abajo: `fechaDelResearch` devuelve `null` y el aviso
 * cambia de redacción, nunca de fecha.
 */
const CABECERA_REAL = [
  '# Keyword Research — Borcelle Burger',
  '',
  '_ES · es · 2026-07-30T00:16:15.000Z_',
  '',
  '- Keywords analizadas: **55**',
  '- Páginas propuestas: **14**',
].join('\n');

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

// ------------------------------------------------------------------ la fecha del research

test('fechaDelResearch la encuentra en la cabecera REAL que emite el generador', () => {
  assert.equal(fechaDelResearch(CABECERA_REAL), '2026-07-30T00:16:15.000Z');
});

test('🔴 con DOS candidatas en la cabecera devuelve null: no elige, y no adivina', () => {
  /*
   * El caso que decide si esta función es honesta. Si el generador algún día imprime otra fecha en la
   * cabecera —o el nombre de un cliente trae una—, hay dos candidatas y ninguna razón para preferir una.
   * Devolver la primera sería inventar precisión, y una fecha equivocada DENTRO del aviso que explica cuál
   * fecha es cuál es peor que no mostrarla: el aviso pasa a su otra redacción y no pierde ninguna verdad.
   */
  const ambigua = CABECERA_REAL.replace(
    '- Keywords analizadas: **55**',
    '- Actualizado: 2026-08-01T10:00:00Z',
  );
  assert.equal(fechaDelResearch(ambigua), null);
});

test('🔴 no la busca fuera de la cabecera: una fecha en el cuerpo no es la del research', () => {
  // Sin el tope de líneas, cualquier ISO que apareciera en una meta description o en una FAQ pasaría por
  // ser la fecha del research. Medido sobre el informe real (2026-08-06): hoy hay UN solo token ISO en los
  // 13.718 bytes, así que este límite no descarta nada real — descarta lo que podría aparecer mañana.
  const conFechaAbajo = [
    '# Keyword Research — Bar X',
    '',
    '_ES · es_',
    '',
    '- Keywords analizadas: **10**',
    '',
    '## Detalle',
    '',
    'Meta description: promo válida hasta 2026-09-01T00:00:00Z.',
  ].join('\n');
  assert.equal(fechaDelResearch(conFechaAbajo), null);
});

test('sin ninguna fecha en la cabecera devuelve null', () => {
  assert.equal(fechaDelResearch('# Keyword Research — Bar X\n\n_ES · es_\n'), null);
  assert.equal(fechaDelResearch(''), null);
});

test('🔴 un ISO que NO es UTC devuelve null: no se etiqueta como UTC algo que no lo es', () => {
  /*
   * `contrato/src/esquema.ts:137` tipa `generated_at` como `z.string()` PELADO: no exige ISO, no exige UTC.
   * Que hoy llegue un instante UTC es propiedad de los productores (`toISOString()`), no del contrato.
   *
   * Medido con la versión anterior de esta función, que hacía la `Z` opcional: `2026-07-30T02:16:15+02:00`
   * devolvía `2026-07-30T02:16:15` (el offset se quedaba afuera del match) y la pantalla imprimía
   * «30/07/2026, 02:16 UTC» — dos horas de error, con la etiqueta UTC puesta encima. El instante real es
   * `2026-07-30T00:16:15.000Z`. Por eso la `Z` es obligatoria: sin zona explícita, esta función no sabe qué
   * instante es, y el aviso pasa a su redacción sin fecha.
   */
  const conOffset = '# KR — Bar\n\n_ES · es · 2026-07-30T02:16:15+02:00_\n';
  const sinZona = '# KR — Bar\n\n_ES · es · 2026-07-30T02:16:15_\n';
  assert.equal(fechaDelResearch(conOffset), null);
  assert.equal(fechaDelResearch(sinZona), null);
  // Y el instante real de ese offset, para que quede escrito que los 02:16 NO eran las 02:16 UTC.
  assert.equal(new Date('2026-07-30T02:16:15+02:00').toISOString(), '2026-07-30T00:16:15.000Z');
});

test('🔴 una fecha en el NOMBRE del cliente (línea 1) no se confunde con la del research', () => {
  // El h1 es `# Keyword Research — ${cliente}`, y `cliente` es texto que un humano escribió en el CRM: el
  // único texto libre de la cabecera. Medido con la versión anterior, que miraba desde la línea 1: con
  // `generated_at` no-ISO y este nombre, devolvía la fecha DEL NOMBRE y la pantalla la presentaba como la
  // del research. Ahora la línea 1 no se mira.
  const md = '# Keyword Research — Bar 2026-07-30T00:00:00Z\n\n_ES · es · hace un rato_\n';
  assert.equal(fechaDelResearch(md), null);
  // Y con el nombre hostil PERO una fecha válida en su sitio, sigue encontrando la correcta y no la del nombre.
  const conAmbas = '# Keyword Research — Bar 2026-01-01T00:00:00Z\n\n_ES · es · 2026-07-30T00:16:15.000Z_\n';
  assert.equal(fechaDelResearch(conAmbas), '2026-07-30T00:16:15.000Z');
});

// ------------------------------------------------------------------ el aviso

test('🔴 el aviso nombra las DOS fechas y dice que son dos hechos distintos', () => {
  /*
   * Esto es el contrato con el revisor, no un texto de relleno, y tiene dos mitades.
   *
   * La primera: el informe refleja el brief del momento en que se generó, así que si alguien editó una
   * keyword después, la pantalla y el informe NO coinciden. Esa frase es lo único que evita que quien
   * encuentre la discrepancia crea que el sistema se equivocó.
   *
   * La segunda, decidida el 2026-08-06: las DOS fechas se muestran y el aviso explica cuál es cuál. Entre
   * ellas hay la duración del research (16 min 15 s en la corrida real; días en el dataset sembrado, donde
   * `generado_at` es cuándo corrió el seed). Un revisor que las ve juntas sin explicación concluye que el
   * sistema se contradice, y ahí pierde la confianza en el informe entero.
   */
  const aviso = avisoCongelado('2026-08-06T17:42:00.000Z', '2026-07-30T00:16:15.000Z');
  assert.equal(
    aviso,
    'Research hecho el 30/07/2026, 00:16 UTC. Este render del informe se guardó el ' +
      '06/08/2026, 17:42 UTC: son dos fechas distintas, no una que cambió. ' +
      'Refleja el brief original; las ediciones posteriores del revisor no están incluidas.',
  );
});

test('🔴 el orden de los argumentos no es simétrico: intercambiarlos cambia lo que el aviso afirma', () => {
  // El fallo más peligroso de esta función es el que NO parece un fallo: las dos fechas correctas, cada una
  // pegada a la etiqueta de la otra. `assert.notEqual` es lo que convierte «primero guardado, después
  // research» en una propiedad y no en una convención que alguien recuerde.
  const bien = avisoCongelado('2026-08-06T17:42:00.000Z', '2026-07-30T00:16:15.000Z');
  const alReves = avisoCongelado('2026-07-30T00:16:15.000Z', '2026-08-06T17:42:00.000Z');
  assert.notEqual(bien, alReves);
  assert.match(bien, /Research hecho el 30\/07\/2026/);
  assert.match(bien, /se guardó el 06\/08\/2026/);
});

test('🔴 sin la fecha del research, el aviso dice de qué ES la que muestra y no remite a ninguna parte', () => {
  /*
   * `fechaDelResearch` devuelve null por DOS causas —cero candidatas (o ninguna en UTC) y ≥2—, y la
   * redacción tiene que servir para las dos. La versión anterior decía «es la que el informe muestra en su
   * encabezado»: verdad con ≥2 candidatas, falsa con cero, porque ahí el encabezado NO la tiene y el
   * revisor iba a buscar algo que no está. Ahora no remite a ningún sitio: dice de qué es la fecha que
   * muestra, que la del research es otra, y que no se pudo leer.
   */
  const aviso = avisoCongelado('2026-08-06T17:42:00.000Z', null);
  assert.equal(
    aviso,
    'Este render del informe se guardó el 06/08/2026, 17:42 UTC: es cuándo se guardó, no cuándo se ' +
      'hizo el research, que es otra fecha y no se pudo leer de este informe. ' +
      'Refleja el brief original; las ediciones posteriores del revisor no están incluidas.',
  );
  assert.ok(!aviso.includes('encabezado'), 'no puede remitir a un encabezado que puede no tener la fecha');
});

test('🔴 sin ninguna fecha, el aviso sigue avisando y no imprime "null"', () => {
  // `kr_informes.generado_at` es `not null` (0016), así que en el contrato esto solo puede pasar si no hay
  // informe. Pero el tipo lo admite, y un `se guardó el null` en la cara del revisor sería el resultado.
  const aviso = avisoCongelado(null, null);
  assert.ok(!aviso.includes('null'), aviso);
  assert.equal(
    aviso,
    'Informe congelado: es un render guardado, no una vista en vivo. ' +
      'Refleja el brief original; las ediciones posteriores del revisor no están incluidas.',
  );
});

test('🔴 las tres formas del aviso llevan SIEMPRE la frase que la spec pide', () => {
  // La frase es el motivo por el que el aviso existe. Se afirma sobre las tres ramas juntas para que
  // agregar una cuarta sin ella no pase desapercibida.
  const avisos = [
    avisoCongelado('2026-08-06T17:42:00.000Z', '2026-07-30T00:16:15.000Z'),
    avisoCongelado('2026-08-06T17:42:00.000Z', null),
    avisoCongelado(null, null),
    avisoCongelado(null, '2026-07-30T00:16:15.000Z'), // sin guardado pero con research: cae en la 3ª
  ];
  for (const a of avisos) {
    assert.match(a, /Refleja el brief original; las ediciones posteriores del revisor no están incluidas\.$/);
  }
});
