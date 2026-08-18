import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contarBriefsPendientes,
  contarClientesActivos,
  contarIdeasPorEstado,
  ultimasIdeasCon,
} from './metricas';
import type { ClienteAgencia, EstadoIdea, IdeaResumen, RunSummary, RunStatus } from '../../core/models';

/** Idea de prueba con defaults razonables; cada test pisa solo lo que le importa. */
function idea(overrides: Partial<IdeaResumen>): IdeaResumen {
  return {
    id: 'i1',
    client_id: 'c1',
    titulo: 'Una idea',
    estado: 'nueva',
    creada_en: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Cliente de prueba con defaults razonables. */
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

/** Run de prueba con defaults razonables. */
function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: 'r1',
    client_id: 'c1',
    status: 'running',
    prompt: 'pizza',
    schema_version: '1',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: null,
    calidad_datos: {},
    config: {},
    created_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    tiene_workflow: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------- contarIdeasPorEstado

test('contarIdeasPorEstado: lista vacía da los cuatro contadores en 0', () => {
  const res = contarIdeasPorEstado([]);
  assert.deepEqual(res, { nueva: 0, en_revision: 0, aprobada: 0, rechazada: 0 });
});

test('contarIdeasPorEstado: una idea de cada estado da cada contador en 1', () => {
  const ideas = [
    idea({ id: 'a', estado: 'nueva' }),
    idea({ id: 'b', estado: 'en_revision' }),
    idea({ id: 'c', estado: 'aprobada' }),
    idea({ id: 'd', estado: 'rechazada' }),
  ];
  assert.deepEqual(contarIdeasPorEstado(ideas), { nueva: 1, en_revision: 1, aprobada: 1, rechazada: 1 });
});

test('contarIdeasPorEstado: varias ideas del mismo estado suman bien y no se pisan entre sí', () => {
  const ideas = [
    idea({ id: 'a', estado: 'nueva' }),
    idea({ id: 'b', estado: 'nueva' }),
    idea({ id: 'c', estado: 'aprobada' }),
  ];
  assert.deepEqual(contarIdeasPorEstado(ideas), { nueva: 2, en_revision: 0, aprobada: 1, rechazada: 0 });
});

test('🔴 un estado fuera del tipo LANZA, no se cuenta en silencio en otro grupo', () => {
  // Es la regla del plan: un estado desconocido no puede aterrizar mudo en otro contador. Si esto
  // devolviera un objeto en vez de lanzar, una migración de datos mal hecha (o un typo del lado de la
  // API) inflaría "nueva" o "rechazada" sin que nadie se entere.
  const ideas = [idea({ id: 'a', estado: 'aprovada' as EstadoIdea })];
  assert.throws(() => contarIdeasPorEstado(ideas), /aprovada/);
});

test('🔴 un estado heredado del prototipo (\'toString\') también LANZA, no cuenta ni corrompe el objeto', () => {
  /*
   * `'aprovada' in conteo` da `false` sin ayuda de ningún bug, así que ese test no cubre esto: `in`
   * recorre la cadena de PROTOTIPOS, y `conteo` (un objeto literal) hereda de `Object.prototype`. Con
   * un chequeo `idea.estado in conteo`, `'toString' in conteo` da `true` — y la función, en vez de
   * lanzar, ejecutaba `conteo['toString']++`, corrompiendo el resultado con una clave espuria
   * (`toString: NaN`) que ni siquiera es uno de los cuatro estados válidos. `Object.hasOwn` es lo que
   * lo evita: solo mira las claves PROPIAS de `conteo`, nunca las heredadas.
   */
  const ideas = [idea({ id: 'a', estado: 'toString' as EstadoIdea })];
  assert.throws(() => contarIdeasPorEstado(ideas), /toString/);
});

// ---------------------------------------------------------------- contarClientesActivos

test('contarClientesActivos: lista vacía da 0', () => {
  assert.equal(contarClientesActivos([]), 0);
});

test('contarClientesActivos: cuenta solo los que tienen archived_at === null', () => {
  const clientes = [
    cliente({ id: 'a', archived_at: null }),
    cliente({ id: 'b', archived_at: '2026-01-01T00:00:00.000Z' }),
    cliente({ id: 'c', archived_at: null }),
  ];
  assert.equal(contarClientesActivos(clientes), 2);
});

test('contarClientesActivos: todos archivados da 0', () => {
  const clientes = [
    cliente({ id: 'a', archived_at: '2026-01-01T00:00:00.000Z' }),
    cliente({ id: 'b', archived_at: '2026-02-01T00:00:00.000Z' }),
  ];
  assert.equal(contarClientesActivos(clientes), 0);
});

// ---------------------------------------------------------------- contarBriefsPendientes

test('contarBriefsPendientes: lista vacía da 0', () => {
  assert.equal(contarBriefsPendientes([]), 0);
});

test('contarBriefsPendientes: cuenta solo los pending_approval entre los cinco RunStatus', () => {
  const estados: RunStatus[] = ['running', 'pending_approval', 'approved', 'rejected', 'failed'];
  const runs = estados.map((status, i) => run({ id: `r${i}`, status }));
  assert.equal(contarBriefsPendientes(runs), 1);
});

// ---------------------------------------------------------------- ultimasIdeasCon

test('ultimasIdeasCon: lista vacía da []', () => {
  assert.deepEqual(ultimasIdeasCon([], [], 5), []);
});

test('ultimasIdeasCon: menos ideas que el límite devuelve todas', () => {
  const ideas = [idea({ id: 'a' }), idea({ id: 'b' })];
  const clientes = [cliente({ id: 'c1', nombre: 'Pizzería Roma' })];
  const res = ultimasIdeasCon(ideas, clientes, 5);
  assert.equal(res.length, 2);
});

test('🔴 ultimasIdeasCon: más ideas que el límite recorta SIN reordenar', () => {
  // La API ya entrega `order by creada_en desc`; esta función no debe reordenar, solo recortar. Si
  // reordenara (por ejemplo por creada_en), este test lo detectaría porque 'primera' dejaría de ser
  // la primera de la salida.
  const ideas = [
    idea({ id: 'primera', creada_en: '2026-01-01T00:00:00.000Z' }),
    idea({ id: 'segunda', creada_en: '2026-03-01T00:00:00.000Z' }),
    idea({ id: 'tercera', creada_en: '2026-02-01T00:00:00.000Z' }),
  ];
  const clientes = [cliente({ id: 'c1' })];
  const res = ultimasIdeasCon(ideas, clientes, 2);
  assert.deepEqual(res.map((i) => i.id), ['primera', 'segunda']);
});

test('🔴 ultimasIdeasCon: un client_id que no matchea ningún cliente cae a "Cliente desconocido", sin lanzar', () => {
  const ideas = [idea({ id: 'a', client_id: 'c-fantasma' })];
  const clientes = [cliente({ id: 'c1', nombre: 'Pizzería Roma' })];
  const res = ultimasIdeasCon(ideas, clientes, 5);
  assert.equal(res[0]!.clienteNombre, 'Cliente desconocido');
});

test('ultimasIdeasCon agrega clienteNombre buscando por client_id === id del cliente', () => {
  const ideas = [idea({ id: 'a', client_id: 'c1' })];
  const clientes = [cliente({ id: 'c1', nombre: 'Pizzería Roma' }), cliente({ id: 'c2', nombre: 'Sushi Ken' })];
  const res = ultimasIdeasCon(ideas, clientes, 5);
  assert.equal(res[0]!.clienteNombre, 'Pizzería Roma');
  assert.equal(res[0]!.clienteId, 'c1');
});
