import type { ClienteAgencia, EstadoContrato, TipoCliente } from './models';

/**
 * Los criterios de filtrado de la lista de clientes. Todos opcionales/vacíos = "sin filtrar" (se
 * ve todo lo activo). Vive separado del servicio Angular por la misma razón que `features.ts`:
 * lógica pura, sin `@angular/core`, testeable con `node:test` sin instanciar nada.
 */
export interface FiltroClientes {
  /** Substring sobre `nombre`, case-insensitive. Vacío = no filtra por texto. */
  texto: string;
  /** `null` = cualquier tipo. */
  tipo: TipoCliente | null;
  /** `null` = cualquier estado de contrato. */
  estadoContrato: EstadoContrato | null;
  /** `null` = cualquiera (incluye sin asignar). El uuid de `memberships.user_id`, o `''` para "sin asignar". */
  asignadoA: string | null;
  /**
   * ¿Se muestran los archivados? `false` por default: coherente con que `archived_at is null` es
   * "activo" en la base (0011_clientes_crm.sql) — el default sensato es no mostrar lo archivado.
   */
  archivados: boolean;
}

/** El filtro que corresponde a "recién abrí la pantalla, sin nada tocado". */
export function filtroVacio(): FiltroClientes {
  return { texto: '', tipo: null, estadoContrato: null, asignadoA: null, archivados: false };
}

/**
 * Aplica `filtro` sobre `clientes` y devuelve el resultado ordenado por `created_at` descendente
 * (mismo orden que ya devuelve `GET /clients` — este ordenamiento es defensivo, no corrige nada que
 * la API haga mal, solo blinda el contrato si algún día cambia el orden del backend).
 *
 * Función pura: mismo input → mismo output, sin leer nada externo. Por eso es un `computed` en el
 * servicio y no un `effect` — no hay efecto secundario que ejecutar, solo un valor derivado.
 */
export function filtrarClientes(clientes: ClienteAgencia[], filtro: FiltroClientes): ClienteAgencia[] {
  const texto = filtro.texto.trim().toLowerCase();

  return clientes
    .filter((c) => (filtro.archivados ? true : c.archived_at === null))
    .filter((c) => (texto === '' ? true : c.nombre.toLowerCase().includes(texto)))
    .filter((c) => (filtro.tipo === null ? true : c.tipo === filtro.tipo))
    .filter((c) => (filtro.estadoContrato === null ? true : c.estado_contrato === filtro.estadoContrato))
    .filter((c) => (filtro.asignadoA === null ? true : (c.asignado_a ?? '') === filtro.asignadoA))
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
