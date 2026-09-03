import type { PostDePagina } from './models';

/**
 * La máquina de 4 estados de `PostDePagina` (Task 11, sub-proyecto de publicación en blog externo).
 *
 * Corregido tras la ronda de Codex sobre el plan (hallazgo Major "publicación fallida bloquea el
 * post para siempre"): la primera versión no distinguía "publicando ahora mismo" de "el último
 * intento falló" — las dos se veían igual (`solicitadoEn` seteado) y el botón quedaba deshabilitado
 * para siempre en el segundo caso. `errorEn` (`marcarPostFallido`, `db/`) es la señal explícita: al
 * fallar, el servidor limpia `solicitadoEn` Y marca `errorEn`, así que las dos condiciones son
 * mutuamente excluyentes en la práctica — el orden de abajo es defensivo, no adivinado.
 */
export type EstadoPost = 'generando' | 'publicada' | 'publicando' | 'fallo' | 'editable';

/**
 * `post === null` es el 404 de `GET /pages/:id/post` ya traducido por `ClienteApi.verPost` — la
 * página está aprobada pero `workflowDecision` todavía no le escribió un post (o el run no era
 * `crear_posts`, o la página no estaba entre las aprobadas al generar).
 */
export function estadoDePost(post: PostDePagina | null): EstadoPost {
  if (post === null) return 'generando';
  // `publicadoEn` manda primero: una vez publicado, no hay vuelta atrás desde esta pantalla
  // (republicar tras editar es fuera de alcance, spec "Fuera de alcance").
  if (post.publicadoEn !== null) return 'publicada';
  // Intento EN CURSO. Manda sobre `errorEn`: un reintento que está viajando no puede leerse como
  // "el intento anterior falló" solo porque el anterior sí lo hizo.
  if (post.solicitadoEn !== null) return 'publicando';
  if (post.errorEn !== null) return 'fallo';
  return 'editable';
}
