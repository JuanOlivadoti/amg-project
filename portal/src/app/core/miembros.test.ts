import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ROLES_ASIGNABLES, motivoParaNoGuardar, nombreDe } from './miembros';
import type { Miembro } from './models';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../../..');

function miembro(parcial: Partial<Miembro>): Miembro {
  return {
    id: 'm1',
    tenant_id: 't1',
    user_id: 'u-1',
    rol: 'equipo',
    client_id: null,
    created_at: '2026-08-02T00:00:00Z',
    email: null,
    raw_app_meta_data: null,
    ...parcial,
  };
}

// ---------------------------------------------------------------- el nombre visible

test('el nombre sale de app_metadata si está, si no del email, si no del uuid', () => {
  assert.equal(nombreDe(miembro({ raw_app_meta_data: { name: 'Ana' }, email: 'a@x.test' })), 'Ana');
  assert.equal(nombreDe(miembro({ raw_app_meta_data: { full_name: 'Ana Ruiz' } })), 'Ana Ruiz');
  assert.equal(nombreDe(miembro({ email: 'a@x.test' })), 'a@x.test');
});

test('🔴 sin nombre ni email se muestra el uuid: NUNCA un texto inventado', () => {
  // Una invitación pendiente o un login por teléfono no traen email. Un "Usuario sin nombre" haría
  // indistinguibles a dos personas distintas en la misma tabla — el uuid es feo, pero es cierto.
  assert.equal(nombreDe(miembro({ user_id: 'u-abc' })), 'u-abc');
  assert.equal(nombreDe(miembro({ user_id: 'u-abc', email: '   ' })), 'u-abc');
  assert.equal(nombreDe(miembro({ user_id: 'u-abc', raw_app_meta_data: { name: '  ' } })), 'u-abc');
});

test('raw_app_meta_data es JSON libre: un `name` que no sea texto no se muestra como nombre', () => {
  // Viene de Supabase, no de nuestro esquema: nada garantiza el tipo.
  assert.equal(nombreDe(miembro({ user_id: 'u-abc', raw_app_meta_data: { name: 42 } })), 'u-abc');
  assert.equal(nombreDe(miembro({ user_id: 'u-abc', raw_app_meta_data: { name: null } })), 'u-abc');
});

// ---------------------------------------------------------------- el `<select>` de roles

test('🔴 el selector NO ofrece `servicio`, y coincide con la allowlist del endpoint', () => {
  const valores = ROLES_ASIGNABLES.map((r) => r.valor);
  assert.deepEqual([...valores], ['maestro', 'equipo', 'cliente']);
  assert.ok(!valores.includes('servicio' as never), 'servicio es un proceso, no una persona');

  // Y que sea LA MISMA lista que el servidor acepta: si alguien agrega un rol acá y no allá, la
  // pantalla ofrecería algo que la API rechaza; al revés, quedaría una capacidad inalcanzable.
  const api = readFileSync(resolve(RAIZ, 'api/src/app.ts'), 'utf8');
  const linea = /const ROLES_ASIGNABLES = new Set\(\[([^\]]*)\]\)/.exec(api);
  assert.ok(linea, 'no encontré ROLES_ASIGNABLES en api/src/app.ts (¿se renombró?)');
  const enLaApi = [...linea![1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(enLaApi, [...valores], 'la lista del portal y la de la API se separaron');
});

// ---------------------------------------------------------------- lo que no se manda

test('🔴 nadie puede cambiar su propio rol, y la pantalla lo dice antes de mandar nada', () => {
  const motivo = motivoParaNoGuardar({
    userIdObjetivo: 'u-1',
    userIdPropio: 'u-1',
    rol: 'equipo',
    clientId: null,
  });
  assert.match(motivo, /tu propio rol/i);
});

test('🔴 un rol cliente sin negocio no se manda: la base lo rechazaría (cliente_exige_client_id)', () => {
  const motivo = motivoParaNoGuardar({
    userIdObjetivo: 'u-2',
    userIdPropio: 'u-1',
    rol: 'cliente',
    clientId: null,
  });
  assert.match(motivo, /atado a un negocio/i);
});

test('🔴 `servicio` no se puede mandar desde la pantalla ni forzando el valor', () => {
  const motivo = motivoParaNoGuardar({
    userIdObjetivo: 'u-2',
    userIdPropio: 'u-1',
    rol: 'servicio',
    clientId: null,
  });
  assert.match(motivo, /no se puede asignar/i);
});

test('un cambio legítimo no tiene motivo para frenarse', () => {
  // Sin este caso, `motivoParaNoGuardar` podría devolver siempre algo y los tests de arriba pasarían.
  assert.equal(
    motivoParaNoGuardar({ userIdObjetivo: 'u-2', userIdPropio: 'u-1', rol: 'equipo', clientId: null }),
    '',
  );
  assert.equal(
    motivoParaNoGuardar({ userIdObjetivo: 'u-2', userIdPropio: 'u-1', rol: 'cliente', clientId: 'c-1' }),
    '',
  );
});
