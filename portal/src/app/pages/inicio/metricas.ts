import type { ClienteAgencia, EstadoIdea, IdeaResumen, RunSummary } from '../../core/models';

export interface ConteoPorEstado {
  nueva: number;
  en_revision: number;
  aprobada: number;
  rechazada: number;
}

export interface UltimaIdea {
  id: string;
  titulo: string;
  estado: EstadoIdea;
  creadaEn: string;
  clienteId: string;
  clienteNombre: string;
}

/** El nombre que se muestra cuando un `client_id` no aparece en la lista de clientes cargada. */
const CLIENTE_DESCONOCIDO = 'Cliente desconocido';

/**
 * Cuenta las ideas por estado. Arranca los cuatro contadores en 0 para que un estado sin ninguna
 * idea dé `0` y no `undefined` — el dashboard pinta los cuatro números siempre, no solo los que
 * tienen datos.
 *
 * Un estado que NO es ninguno de los cuatro válidos **lanza**, en vez de contarse en silencio en
 * otro grupo o descartarse mudo: la regla del plan es que un dato corrupto (una migración mal
 * hecha, un typo del lado de la API) no puede inflar un contador sin que nadie se entere.
 *
 * Aceptado, no arreglado: en `inicio.ts` esta función se llama dentro de un `computed` (fuera de
 * cualquier `try/catch`), así que hoy un estado desconocido tumbaría toda la pantalla de inicio en
 * vez de degradar solo el bloque de ideas — la composición de "gritar ante un dato corrupto" (acá)
 * con "que una fuente no tumbe a las otras" (el diseño de `inicio.ts`) no se decidió. Se deja así
 * a propósito porque `idea_estado` (`db/migrations/0013_ideas.sql`) es un enum de Postgres de 4
 * valores: hoy es inalcanzable. Si se agrega un quinto valor al enum, hay que revisar esto.
 */
export function contarIdeasPorEstado(ideas: readonly IdeaResumen[]): ConteoPorEstado {
  const conteo: ConteoPorEstado = { nueva: 0, en_revision: 0, aprobada: 0, rechazada: 0 };
  for (const idea of ideas) {
    // `Object.hasOwn` y NO `in`: `in` recorre la cadena de prototipos, así que un estado como
    // 'toString' o 'constructor' da `in` === true (heredado de Object.prototype) sin ser una clave
    // propia de `conteo`, y la guarda de abajo se saltearía en silencio — justo lo que el brief pide
    // impedir (ver el 🔴 de más abajo, que reproduce exactamente este caso).
    if (!Object.hasOwn(conteo, idea.estado)) {
      throw new Error(`contarIdeasPorEstado: estado desconocido "${idea.estado}" (idea ${idea.id}).`);
    }
    conteo[idea.estado]++;
  }
  return conteo;
}

/** Cuenta los clientes activos: los que NO tienen `archived_at` (es decir, `archived_at === null`). */
export function contarClientesActivos(clientes: readonly ClienteAgencia[]): number {
  return clientes.filter((c) => c.archived_at === null).length;
}

/** Cuenta los runs cuyo research espera aprobación (`status === 'pending_approval'`). */
export function contarBriefsPendientes(runs: readonly RunSummary[]): number {
  return runs.filter((r) => r.status === 'pending_approval').length;
}

/**
 * Las últimas `limite` ideas, TAL COMO VIENEN en `ideas` — la API ya las entrega
 * `order by creada_en desc`, así que esta función no reordena, solo recorta con `.slice`.
 *
 * A cada una le agrega `clienteNombre` buscando en `clientes` por `client_id === clienteId`. Si el
 * cliente no aparece (borrado, o de otro tenant por algún desalineo), cae a `'Cliente
 * desconocido'` — no lanza, no rompe la fila: es un dato secundario de presentación, no la
 * garantía de RLS, que la impone Postgres y no esta función.
 */
export function ultimasIdeasCon(
  ideas: readonly IdeaResumen[],
  clientes: readonly ClienteAgencia[],
  limite: number,
): UltimaIdea[] {
  return ideas.slice(0, limite).map((idea) => {
    const cliente = clientes.find((c) => c.id === idea.client_id);
    return {
      id: idea.id,
      titulo: idea.titulo,
      estado: idea.estado,
      creadaEn: idea.creada_en,
      clienteId: idea.client_id,
      clienteNombre: cliente?.nombre ?? CLIENTE_DESCONOCIDO,
    };
  });
}
