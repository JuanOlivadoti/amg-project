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

export interface MetricasInicio {
  ideasPorEstado: ConteoPorEstado;
  clientesActivos: number;
  briefsPendientes: number;
  ultimasIdeas: readonly UltimaIdea[];
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
 */
export function contarIdeasPorEstado(ideas: readonly IdeaResumen[]): ConteoPorEstado {
  const conteo: ConteoPorEstado = { nueva: 0, en_revision: 0, aprobada: 0, rechazada: 0 };
  for (const idea of ideas) {
    if (!(idea.estado in conteo)) {
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

/** Junta las cuatro funciones de arriba. Es lo único que la pantalla de inicio necesita llamar. */
export function calcularMetricas(
  ideas: readonly IdeaResumen[],
  clientes: readonly ClienteAgencia[],
  runs: readonly RunSummary[],
  limiteUltimasIdeas = 5,
): MetricasInicio {
  return {
    ideasPorEstado: contarIdeasPorEstado(ideas),
    clientesActivos: contarClientesActivos(clientes),
    briefsPendientes: contarBriefsPendientes(runs),
    ultimasIdeas: ultimasIdeasCon(ideas, clientes, limiteUltimasIdeas),
  };
}
