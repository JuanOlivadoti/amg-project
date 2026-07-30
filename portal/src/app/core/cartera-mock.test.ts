import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock } from './cartera-mock';
import { EVIDENCIA_RESPALDADA } from './evidence';

test('genera entre 4 y 6 clientes, según el roadmap (seed de 4-6 restaurantes)', () => {
  const d = generarCarteraMock();
  assert.ok(d.clientes.length >= 4 && d.clientes.length <= 6, `esperaba 4-6 clientes, obtuve ${d.clientes.length}`);
});

test('cada cliente tiene al menos 2 runs, para poder armar una serie temporal', () => {
  const d = generarCarteraMock();
  for (const c of d.clientes) assert.ok(c.runs.length >= 2, `${c.nombre} tiene menos de 2 runs`);
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
