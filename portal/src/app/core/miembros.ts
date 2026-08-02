import type { Miembro } from './models';

/**
 * Lo que se muestra de un miembro, en funciones puras y testeadas.
 *
 * Vive en `core/` y no dentro de un componente por la misma razón que `evidence.ts` o `vigencia.ts`:
 * un `@if` o una interpolación en un template se rompe sin que nada avise, y acá hay dos decisiones
 * que no son cosméticas — de dónde sale el nombre cuando Supabase no lo trae, y qué se ofrece en un
 * `<select>` de roles.
 */

/**
 * El nombre visible. `raw_app_meta_data` es JSON libre de Supabase: no hay garantía de que traiga
 * `name`, ni de que sea un string.
 *
 * El orden de preferencia es nombre → email → uuid, y el último escalón importa: **nunca se inventa
 * un texto**. Si no hay nombre ni email (una invitación pendiente, un login por teléfono), se
 * muestra el uuid, que es feo pero cierto. Un "Usuario sin nombre" haría indistinguibles a dos
 * personas distintas en la misma tabla.
 */
export function nombreDe(m: Miembro): string {
  const meta = m.raw_app_meta_data;
  const n = meta?.['name'] ?? meta?.['full_name'];
  if (typeof n === 'string' && n.trim().length > 0) return n.trim();
  if (m.email && m.email.trim().length > 0) return m.email.trim();
  return m.user_id;
}

/**
 * Los roles que un `maestro` puede asignar desde la pantalla.
 *
 * Es la MISMA lista que la allowlist del endpoint (`ROLES_ASIGNABLES` en `api/src/app.ts`) y por la
 * misma razón: `servicio` es un `user_role` válido (0001) pero no es un rol que una persona pueda
 * recibir — es la identidad de los jobs del orquestador, atada a una credencial de Postgres. Un
 * `<select>` que listara el enum completo dejaría a un maestro convertir a alguien en un proceso
 * automático.
 *
 * Que esté acá NO es la garantía: la garantía es la allowlist del servidor y la constraint
 * `membresia_no_es_servicio` (0003). Esto solo evita ofrecer en pantalla algo que la base va a
 * rechazar.
 */
export const ROLES_ASIGNABLES = [
  { valor: 'maestro', etiqueta: 'Maestro — administra el tenant y reparte roles' },
  { valor: 'equipo', etiqueta: 'Equipo — trabaja con toda la cartera' },
  { valor: 'cliente', etiqueta: 'Cliente — solo su propio negocio, y solo lectura' },
] as const;

/**
 * ¿Se puede guardar este cambio de rol? Devuelve el motivo por el que NO, o `''` si se puede.
 *
 * Las tres razones que devuelve están las tres impuestas también en la base — esto no autoriza
 * nada, solo evita mandar un PATCH cuya respuesta ya se conoce y explicar por qué en el idioma de
 * la pantalla en vez de con un 403 pelado:
 *
 *  - el propio rol: `membership_update.with check` exige `user_id <> current_user_id()` (0012), y
 *    el endpoint lo comprueba antes de viajar a la base;
 *  - `servicio`: `membresia_no_es_servicio` (0003) y la allowlist del endpoint;
 *  - `cliente` sin negocio: `cliente_exige_client_id` (0001).
 */
export function motivoParaNoGuardar(opts: {
  userIdObjetivo: string;
  userIdPropio: string;
  rol: string;
  clientId: string | null;
}): string {
  if (opts.userIdObjetivo === opts.userIdPropio) {
    return 'No podés cambiar tu propio rol. Pedíselo a otro maestro del tenant.';
  }
  if (!ROLES_ASIGNABLES.some((r) => r.valor === opts.rol)) {
    return 'Ese rol no se puede asignar desde el portal.';
  }
  if (opts.rol === 'cliente' && !opts.clientId) {
    return 'Un rol cliente tiene que quedar atado a un negocio.';
  }
  return '';
}
