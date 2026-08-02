import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CAPACIDADES, ROLES_HUMANOS, capacidadesDe, esStaff, rolEfectivo } from './capacidades';
import type { Miembro } from './models';

/**
 * La tabla de capacidades no puede prometer más de lo que RLS cumple. Estos tests son lo que le da
 * valor: sin ellos es una lista de frases bonitas que envejece sola.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
/** `portal/` vive FUERA del monorepo a propósito; la raíz queda cuatro niveles arriba de `core/`. */
const RAIZ = resolve(AQUI, '../../../..');

const ids = (rol: string): string[] => capacidadesDe(rol).map((c) => c.id);

const miembro = (userId: string, rol: string): Miembro => ({
  id: 'm-' + userId,
  tenant_id: 't1',
  user_id: userId,
  rol,
  client_id: null,
  created_at: '2026-08-02T00:00:00Z',
  email: userId + '@agencia.test',
  raw_app_meta_data: null,
});

// ------------------------------------------------------------------ la jerarquía

test('las capacidades de cliente son un subconjunto de las de equipo, y las de equipo de las de maestro', () => {
  const cliente = ids('cliente');
  const equipo = ids('equipo');
  const maestro = ids('maestro');

  for (const c of cliente) assert.ok(equipo.includes(c), `equipo tendría que incluir "${c}"`);
  for (const c of equipo) assert.ok(maestro.includes(c), `maestro tendría que incluir "${c}"`);

  // Y que no sean iguales: si los tres tuvieran lo mismo, el test de arriba pasaría sin decir nada.
  assert.ok(cliente.length < equipo.length, 'un cliente NO puede poder lo mismo que el equipo');
  assert.ok(equipo.length < maestro.length, 'un equipo NO puede poder lo mismo que un maestro');
});

test('cambiar el rol de otro es exclusivo de maestro', () => {
  // Es LA capacidad de esta pieza, y la que un `equipo` no tiene: membership_update.with check.
  assert.ok(ids('maestro').includes('cambiar_rol'));
  assert.ok(!ids('equipo').includes('cambiar_rol'));
  assert.ok(!ids('cliente').includes('cambiar_rol'));
});

test('🔴 un rol desconocido no puede NADA: no hay default permisivo', () => {
  // `Sesion.rol` nacía con un default "vacío = asumo equipo" para no romper el flujo del equipo. Esa
  // concesión no se hereda acá: una tabla de permisos que ante la duda promete cosas es exactamente
  // lo que esta pantalla vino a reemplazar.
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('servicio'), []);
  assert.deepEqual(ids('super_admin'), []); // un rol del origen, que en AMG no existe
  assert.equal(esStaff(''), false);
  assert.equal(esStaff('servicio'), false);
});

// ------------------------------------------------------------------ el respaldo existe de verdad

test('🔴 cada capacidad cita una política/función que EXISTE en el código de la base', () => {
  // Esto es lo que impide que la tabla envejezca en silencio: si alguien renombra `membership_update`
  // o borra `app.puede_escribir()`, la fila que la citaba cae acá, no en producción.
  for (const c of CAPACIDADES) {
    const ruta = resolve(RAIZ, c.respaldo.archivo);
    let contenido: string;
    try {
      contenido = readFileSync(ruta, 'utf8');
    } catch {
      assert.fail(`"${c.id}" cita ${c.respaldo.archivo}, que no existe (¿se movió?)`);
    }
    assert.ok(
      contenido.includes(c.respaldo.simbolo),
      `"${c.id}" cita «${c.respaldo.simbolo}» en ${c.respaldo.archivo}, y ahí no está`,
    );
  }
});

test('cada capacidad tiene id único, etiqueta, al menos un rol, y ningún rol inventado', () => {
  const vistos = new Set<string>();
  for (const c of CAPACIDADES) {
    assert.ok(!vistos.has(c.id), `id duplicado: ${c.id}`);
    vistos.add(c.id);
    assert.ok(c.etiqueta.length > 0, `${c.id} sin etiqueta`);
    assert.ok(c.respaldo.nota.length > 0, `${c.id} sin nota de respaldo`);
    assert.ok(c.roles.length > 0, `${c.id} no la tiene nadie: sobra`);
    for (const r of c.roles) {
      assert.ok((ROLES_HUMANOS as readonly string[]).includes(r), `${c.id} cita un rol inexistente: ${r}`);
    }
  }
});

// ------------------------------------------------------------------ el rol efectivo

test('🔴 el rol sale de la membresía, no del token: token dice equipo, membresía dice maestro → maestro', () => {
  // El caso exacto que hace falta arreglar: la API no tiene credenciales de Supabase, así que
  // cambiar una membresía NO actualiza `app_metadata.rol`. Si la UI siguiera leyendo el token, un
  // maestro recién nombrado no vería nunca la pantalla que le corresponde.
  const yo = 'u-1';
  const rol = rolEfectivo([miembro(yo, 'maestro'), miembro('u-2', 'equipo')], yo);

  assert.equal(rol, 'maestro');
  assert.ok(capacidadesDe(rol).some((c) => c.id === 'cambiar_rol'), 'tiene que ofrecer lo de maestro');
});

test('🔴 y también a la inversa: token que dice maestro, membresía que dice equipo → equipo', () => {
  // La dirección que importa para la seguridad de la pantalla: una membresía degradada manda sobre
  // un token que todavía no lo sabe. Sin este caso, el test de arriba se satisfaría con "quedarse
  // siempre con el rol más alto que se haya visto".
  const yo = 'u-1';
  const rol = rolEfectivo([miembro(yo, 'equipo')], yo);

  assert.equal(rol, 'equipo');
  assert.ok(!capacidadesDe(rol).some((c) => c.id === 'cambiar_rol'));
});

test('sin fila propia el rol es vacío: existe en Auth pero no tiene acceso a este tenant', () => {
  // Es el rol `new` del origen, que acá no se persiste: no tener membresía YA lo dice.
  assert.equal(rolEfectivo([miembro('otro', 'maestro')], 'u-1'), '');
  assert.equal(rolEfectivo([], 'u-1'), '');
  assert.equal(rolEfectivo([miembro('u-1', 'maestro')], ''), '', 'sin userId no se adivina nada');
});

test('🔴 una fila propia con rol servicio NO da un rol de UI', () => {
  // `servicio` es la identidad de los jobs del orquestador, atada a una credencial de Postgres. Que
  // aparezca en una fila de `memberships` ya sería anómalo (`membresia_no_es_servicio` lo impide),
  // pero si pasara, tratarlo como rol de UI le pondría a una persona la cara de un proceso.
  assert.equal(rolEfectivo([miembro('u-1', 'servicio')], 'u-1'), '');
});
