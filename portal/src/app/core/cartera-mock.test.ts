import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock } from './cartera-mock';
import { topOportunidades } from './cartera';
import { EVIDENCIA_RESPALDADA } from './evidence';

test('genera entre 4 y 6 clientes, según el roadmap (seed de 4-6 restaurantes)', () => {
  const d = generarCarteraMock();
  assert.ok(d.clientes.length >= 4 && d.clientes.length <= 6, `esperaba 4-6 clientes, obtuve ${d.clientes.length}`);
});

/**
 * Antes esto exigía 2 runs POR cliente. Se relajó a lo que el gráfico necesita de verdad —que la serie
 * tenga puntos— porque el cliente real (Borcelle Burger) tiene UN run: el de la acción 06. Darle un
 * segundo run de relleno sería inventar una corrida que no existió, justo en la fila que Frank va a
 * reconocer.
 */
test('la serie temporal tiene al menos 2 puntos, para que el gráfico sea una línea y no un punto', () => {
  const d = generarCarteraMock();
  const runs = d.clientes.flatMap((c) => c.runs);
  assert.ok(runs.length >= 2, `esperaba 2+ runs en total, obtuve ${runs.length}`);
});

/**
 * El hilo de la demo: el dashboard, el brief y la web tienen que hablar del MISMO negocio. El primer
 * cliente de la cartera es el real —el que está sembrado en la base (`db/src/seed-demo.ts`) y
 * publicado en Storyblok—, con sus IDs e importe reales, para que la fila que Frank abre sea la que
 * después ve por dentro.
 *
 * Límite conocido: los UUID están copiados del seed, no importados (`portal/` está fuera del monorepo
 * a propósito, ADR-16/21). Si los IDs fijos del seed cambian, hay que tocar los dos lados.
 */
test('el primer cliente es Borcelle Burger, con los IDs y el coste reales del seed', () => {
  const d = generarCarteraMock();
  const primero = d.clientes[0];

  assert.equal(primero?.nombre, 'Borcelle Burger', 'la cartera tiene que abrir con el cliente real');
  assert.equal(primero?.client_id, 'd3305eba-11a5-4e0e-9c1f-000000000001', 'el client_id del seed');
  assert.equal(primero?.runs.length, 1, 'el único run real: el de la acción 06');
  assert.equal(primero?.runs[0]?.id, 'd3305eba-11a5-4e0e-9c1f-000000000002', 'el run_id del seed');
  assert.equal(primero?.runs[0]?.coste_micros_usd, 309_700, 'los $0.3097 que costó de verdad');
  assert.equal(primero?.runs[0]?.status, 'pending_approval', 'el run real espera en la compuerta');
});

/**
 * Lo encontró el navegador, no un test: al mezclar un cliente real con cinco de muestra, el
 * generador de muestra sacaba scores de hasta 98 y **el gráfico "Top oportunidades" quedaba dominado
 * por relleno** ("keyword run-5-1 0"), con solo 2 de 8 barras reales. El primer golpe de la demo
 * mostraba basura. Los datos de muestra tienen que quedar POR DEBAJO de los reales.
 */
test('el top de oportunidades es todo del cliente real: la muestra no le compite', () => {
  const d = generarCarteraMock();
  const reales = new Set(d.paginasDelClientePrincipal.map((p) => p.keyword_principal));
  const top = topOportunidades(d.pages, 8);

  assert.equal(top.length, 8);
  for (const o of top) {
    assert.ok(reales.has(o.keyword), `"${o.keyword}" es de muestra y se metió en el top`);
  }
});

/**
 * La tabla de la pantalla lista ESTO, no `pages` entero: con las 44 páginas se veían 14 filas reales
 * seguidas de 30 de relleno, que es peor que una tabla corta.
 */
test('paginasDelClientePrincipal son las 14 del brief real, y ninguna de muestra', () => {
  const d = generarCarteraMock();
  assert.equal(d.paginasDelClientePrincipal.length, 14);
  assert.ok(
    d.paginasDelClientePrincipal.every((p) => p.id.startsWith('d3305eba-11a5-4e0e-9c1f-000000000002')),
    'todas tienen que colgar del run real',
  );
  assert.equal(
    d.paginasDelClientePrincipal.filter((p) => p.evidencia === EVIDENCIA_RESPALDADA).length,
    8,
    'el split de honestidad del brief real: 8 respaldadas',
  );
});

test('ningún cliente de la cartera arrastra el caso viejo del italiano de ejemplo', () => {
  const d = generarCarteraMock();
  assert.ok(
    !d.clientes.some((c) => /bella napoli/i.test(c.nombre)),
    'el seed dejó de ser Bella Napoli: la cartera no puede seguir nombrándolo',
  );
});

test('todas las páginas referencian un client_id de algún run existente', () => {
  const d = generarCarteraMock();
  const runIds = new Set(d.clientes.flatMap((c) => c.runs.map((r) => r.id)));
  // las páginas no llevan client_id directo (PaginaPropuesta no lo tiene) — se valida indirectamente
  // por convención de id: `${runId}-pagina-N`
  for (const p of d.pages) {
    const runId = p.id.replace(/-pagina-\d+$/, '');
    assert.ok(runIds.has(runId), `la página ${p.id} no corresponde a ningún run generado`);
  }
});

test('es determinístico: dos llamadas producen exactamente los mismos datos', () => {
  const a = generarCarteraMock();
  const b = generarCarteraMock();
  assert.deepEqual(a, b);
});

test('usa EVIDENCIA_RESPALDADA para marcar páginas respaldadas, no un string suelto', () => {
  const d = generarCarteraMock();
  assert.ok(
    d.pages.some((p) => p.evidencia === EVIDENCIA_RESPALDADA),
    'ninguna página de muestra usa el criterio real de "respaldada"',
  );
  assert.ok(
    d.pages.some((p) => p.evidencia !== EVIDENCIA_RESPALDADA),
    'el mock debería tener también páginas sin validar, para probar los dos estados de la UI',
  );
});
