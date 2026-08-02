import type { Miembro } from './models';

/**
 * Qué puede hacer cada rol, **derivado y de solo lectura**.
 *
 * El origen (`dashboard-project`) guardaba 20 flags booleanos por usuario, editables desde la UI.
 * Acá eso sería una segunda fuente de verdad que RLS ignora: la pantalla diría "no puede eliminar
 * clientes" y la base lo dejaría igual. En AMG el rol **se deriva de `memberships`** (ADR-15) y la
 * autorización la hacen las políticas — esta tabla no decide nada, solo **explica** lo que ya está
 * decidido en SQL.
 *
 * Por eso cada fila lleva su `respaldo`: la política, función o constraint concreta que la sostiene.
 * **Una capacidad que no se pueda respaldar no se declara** — una lista que promete más de lo que RLS
 * hace es peor que no tener la pantalla. `capacidades.test.ts` lo exige fila por fila.
 */

/** Los roles que una PERSONA puede tener. `servicio` no está: es una credencial, no alguien. */
export const ROLES_HUMANOS = ['maestro', 'equipo', 'cliente'] as const;
export type RolHumano = (typeof ROLES_HUMANOS)[number];

/**
 * De dónde sale la capacidad, en forma **verificable** y no en prosa.
 *
 * `simbolo` es el nombre exacto de la política, función o constante, y `archivo` dónde vive, los dos
 * relativos a la raíz del monorepo. `capacidades.test.ts` abre el archivo y busca el símbolo: si
 * alguien renombra una política, borra una función o mueve el archivo, la fila que la citaba **cae**.
 * Escrito como texto libre, ese renombre pasaría sin que nada avise y la tabla quedaría prometiendo
 * algo que ya no existe — que es justo el modo de fallo que esta pantalla vino a evitar.
 */
export interface Respaldo {
  simbolo: string;
  archivo: string;
  /** Para leer la tabla sin abrir el SQL. */
  nota: string;
}

export interface Capacidad {
  /** Estable, para tests y templates. No se muestra. */
  id: string;
  /** Lo que lee la agencia. */
  etiqueta: string;
  /** Quiénes la tienen, según lo que la base realmente permite. */
  roles: readonly RolHumano[];
  /** Lo que la sostiene. Sin esto, la fila no existe. */
  respaldo: Respaldo;
}

/**
 * La tabla. El orden es el de la pantalla: primero lo que casi todos pueden, al final lo que solo un
 * `maestro`.
 *
 * Las capacidades están redactadas para que la respuesta sea SÍ o NO, nunca "depende". Donde la base
 * dice "solo lo suyo" (un rol `cliente` sobre su propio negocio), hay dos filas distintas —"el suyo"
 * y "toda la cartera"— en vez de una fila ambigua con un asterisco. Un asterisco en una tabla de
 * permisos es una promesa que nadie verifica.
 */
export const CAPACIDADES: readonly Capacidad[] = [
  {
    id: 'ver_cliente_propio',
    etiqueta: 'Ver la ficha del negocio al que está asignado',
    roles: ['maestro', 'equipo', 'cliente'],
    respaldo: {
      simbolo: 'create policy client_select on clients',
      archivo: 'db/migrations/0001_init.sql',
      nota: 'La política deja pasar lo que app.ve_cliente(id) apruebe; para un rol cliente, su client_id',
    },
  },
  {
    id: 'ver_runs_propios',
    etiqueta: 'Ver las corridas de research y los briefs de ese negocio',
    roles: ['maestro', 'equipo', 'cliente'],
    respaldo: {
      simbolo: 'create policy run_select on kr_runs',
      archivo: 'db/migrations/0001_init.sql',
      nota: 'Mismo criterio en page_select y keyword_select: app.ve_cliente(client_id)',
    },
  },
  {
    id: 'ver_miembro_propio',
    etiqueta: 'Ver su propia membresía (con qué rol entra al tenant)',
    roles: ['maestro', 'equipo', 'cliente'],
    respaldo: {
      simbolo: 'create view membresias_perfil',
      archivo: 'db/migrations/0012_membresias_perfil.sql',
      nota: 'La rama m.user_id = app.current_user_id() del where, la que ve cualquiera sobre sí mismo',
    },
  },
  {
    id: 'ver_cartera',
    etiqueta: 'Ver TODOS los clientes del tenant, no solo el suyo',
    roles: ['maestro', 'equipo'],
    respaldo: {
      simbolo: 'create or replace function app.ve_cliente(cid uuid)',
      archivo: 'db/migrations/0001_init.sql',
      nota: 'Devuelve true para staff sobre cualquier cliente; un rol cliente solo matchea el suyo',
    },
  },
  {
    id: 'ver_crm',
    etiqueta: 'Ver los datos internos del cliente (contacto, contrato, notas)',
    roles: ['maestro', 'equipo'],
    respaldo: {
      simbolo: 'CLIENTE_CRM_MASKED_COLS',
      archivo: 'db/src/clientes.ts',
      nota: 'Columnas enmascaradas salvo app.es_staff(): la lista es POSITIVA, lo nuevo no se filtra solo',
    },
  },
  {
    id: 'escribir_clientes',
    etiqueta: 'Dar de alta, editar y archivar clientes',
    roles: ['maestro', 'equipo'],
    respaldo: {
      simbolo: 'create or replace function app.puede_escribir()',
      archivo: 'db/migrations/0001_init.sql',
      nota: 'client_write la exige; el rol cliente es SOLO LECTURA en todo el sistema',
    },
  },
  {
    id: 'escribir_paginas',
    etiqueta: 'Editar y aprobar las páginas de un brief',
    roles: ['maestro', 'equipo'],
    respaldo: {
      simbolo: 'create policy page_write on kr_pages',
      archivo: 'db/migrations/0001_init.sql',
      nota: 'Mismo app.puede_escribir() que los clientes, sobre kr_pages',
    },
  },
  {
    id: 'ver_miembros',
    etiqueta: 'Ver a todos los miembros del tenant',
    roles: ['maestro', 'equipo'],
    respaldo: {
      simbolo: 'create policy membership_select_staff on memberships',
      archivo: 'db/migrations/0012_membresias_perfil.sql',
      nota: 'La rama app.es_staff() de la vista, y la política que da la misma visibilidad en la tabla',
    },
  },
  {
    id: 'cambiar_rol',
    etiqueta: 'Cambiar el rol de otro miembro',
    roles: ['maestro'],
    respaldo: {
      simbolo: 'create policy membership_update on memberships',
      archivo: 'db/migrations/0012_membresias_perfil.sql',
      nota: "with check exige app.rol_propio_sin_recursion() = 'maestro' y que no sea la propia fila",
    },
  },
];

/** Lo que un rol puede hacer. Un rol desconocido no puede nada: no se inventa un default permisivo. */
export function capacidadesDe(rol: string): readonly Capacidad[] {
  return CAPACIDADES.filter((c) => (c.roles as readonly string[]).includes(rol));
}

/**
 * ¿Es staff? Es la pregunta que la UI hace para mostrar u ocultar los botones de escritura, y
 * coincide con `app.puede_escribir()` (0001): `maestro` y `equipo` escriben, `cliente` no.
 *
 * Sigue siendo COSMÉTICO — la autorización real la impone RLS (ADR-20) —, pero ahora se calcula
 * sobre el rol EFECTIVO (`memberships`), no sobre lo que dijera el token.
 */
export function esStaff(rol: string): boolean {
  return rol === 'maestro' || rol === 'equipo';
}

/**
 * El rol **efectivo**: el de la fila propia en `memberships`, no el que declare el token.
 *
 * `GET /members` siempre devuelve la fila de quien pregunta —la vista `membresias_perfil` (0012) la
 * deja pasar por las dos ramas, la de staff y la de `m.user_id = app.current_user_id()`—, así que no
 * hace falta un endpoint `/members/me` aparte: la lista que la pantalla de usuarios ya necesita
 * contiene la respuesta.
 *
 * Devuelve `''` cuando no hay fila propia. Eso NO es un error: es exactamente el rol `'new'` del
 * origen, un usuario que existe en Auth pero no tiene acceso a este tenant. La UI lo dice ("sin
 * acceso al tenant"); no se le regala un rol por defecto.
 *
 * `servicio` se descarta aunque llegue: es la identidad de los jobs del orquestador, no una persona,
 * y ninguna sesión del portal debería tenerlo. Si apareciera, tratarlo como rol de UI le daría a un
 * humano la cara de un proceso automático — mismo doble cierre que `app.rol_propio_sin_recursion()`
 * hace en SQL.
 */
export function rolEfectivo(miembros: readonly Miembro[], userId: string): RolHumano | '' {
  if (!userId) return '';
  const propia = miembros.find((m) => m.user_id === userId);
  const rol = propia?.rol ?? '';
  return (ROLES_HUMANOS as readonly string[]).includes(rol) ? (rol as RolHumano) : '';
}
