import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarClientes, filtroVacio } from './clientes-filtro';
import type { ClienteAgencia } from './models';

/** Cliente de prueba con defaults razonables; cada test pisa solo lo que le importa. */
function cliente(overrides: Partial<ClienteAgencia>): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizzería Roma',
    tipo: null,
    industria: null,
    etiquetas: [],
    nivel_actividad: null,
    estado_contrato: 'vigente',
    contrato_vence_en: null,
    score: null,
    asignado_a: null,
    contacto: {},
    origen: null,
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('filtroVacio: no filtra por nada y NO muestra archivados', () => {
  const f = filtroVacio();
  assert.equal(f.texto, '');
  assert.equal(f.tipo, null);
  assert.equal(f.estadoContrato, null);
  assert.equal(f.asignadoA, null);
  assert.equal(f.archivados, false);
});

test('sin filtro, oculta los archivados (default sensato: archived_at is null = activo)', () => {
  const activos = [cliente({ id: 'a', archived_at: null }), cliente({ id: 'b', archived_at: '2026-01-01' })];
  const res = filtrarClientes(activos, filtroVacio());
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('archivados: true muestra también los archivados', () => {
  const clientes = [cliente({ id: 'a', archived_at: null }), cliente({ id: 'b', archived_at: '2026-01-01' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), archivados: true });
  assert.deepEqual(
    res.map((c) => c.id).sort(),
    ['a', 'b'],
  );
});

test('texto filtra por substring de nombre, case-insensitive', () => {
  const clientes = [cliente({ id: 'a', nombre: 'Pizzería Roma' }), cliente({ id: 'b', nombre: 'Sushi Ken' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), texto: 'PIZZ' });
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('texto vacío (o solo espacios) no filtra nada', () => {
  const clientes = [cliente({ id: 'a' }), cliente({ id: 'b', nombre: 'Otro' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), texto: '   ' });
  assert.equal(res.length, 2);
});

test('tipo filtra por coincidencia exacta', () => {
  const clientes = [cliente({ id: 'a', tipo: 'empresa' }), cliente({ id: 'b', tipo: 'autonomo' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), tipo: 'empresa' });
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('estadoContrato filtra por coincidencia exacta', () => {
  const clientes = [
    cliente({ id: 'a', estado_contrato: 'vigente' }),
    cliente({ id: 'b', estado_contrato: 'vencido' }),
  ];
  const res = filtrarClientes(clientes, { ...filtroVacio(), estadoContrato: 'vencido' });
  assert.deepEqual(res.map((c) => c.id), ['b']);
});

test('asignadoA con uuid filtra por ese asignado', () => {
  const clientes = [cliente({ id: 'a', asignado_a: 'u1' }), cliente({ id: 'b', asignado_a: 'u2' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), asignadoA: 'u1' });
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('asignadoA con \'\' filtra los sin asignar (asignado_a null)', () => {
  const clientes = [cliente({ id: 'a', asignado_a: null }), cliente({ id: 'b', asignado_a: 'u2' })];
  const res = filtrarClientes(clientes, { ...filtroVacio(), asignadoA: '' });
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('el resultado queda ordenado por created_at descendente', () => {
  const clientes = [
    cliente({ id: 'viejo', created_at: '2026-01-01T00:00:00.000Z' }),
    cliente({ id: 'nuevo', created_at: '2026-03-01T00:00:00.000Z' }),
    cliente({ id: 'medio', created_at: '2026-02-01T00:00:00.000Z' }),
  ];
  const res = filtrarClientes(clientes, filtroVacio());
  assert.deepEqual(
    res.map((c) => c.id),
    ['nuevo', 'medio', 'viejo'],
  );
});

test('los filtros se combinan con AND, no OR', () => {
  const clientes = [
    cliente({ id: 'a', nombre: 'Pizzería Roma', tipo: 'empresa' }),
    cliente({ id: 'b', nombre: 'Pizzería Sur', tipo: 'autonomo' }),
  ];
  const res = filtrarClientes(clientes, { ...filtroVacio(), texto: 'pizzería', tipo: 'empresa' });
  assert.deepEqual(res.map((c) => c.id), ['a']);
});

test('filtrarClientes no muta el array original', () => {
  const clientes = [
    cliente({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
    cliente({ id: 'b', created_at: '2026-02-01T00:00:00.000Z' }),
  ];
  const copia = [...clientes];
  filtrarClientes(clientes, filtroVacio());
  assert.deepEqual(clientes, copia);
});
