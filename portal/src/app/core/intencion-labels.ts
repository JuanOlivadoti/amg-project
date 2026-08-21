import type { Intencion } from './models';

/**
 * Vocabulario de intención de búsqueda, con su etiqueta legible en español — mismo patrón que
 * `menu-taxonomia.ts` para alérgenos y etiquetas dietéticas.
 *
 * Los cinco valores son los de `SearchIntent` (`contrato/src/tipos.ts`), en inglés porque así los
 * clasifica el M2 (`kr-service/src/pipeline/intent.ts`) y así los impone la base desde la migración
 * 0017 (`intencion_del_contrato`, check de `kr_pages`). El portal no importa `contrato` ni `kr-service`
 * (ADR-21, fuera del monorepo a propósito), así que la lista está copiada a mano — mismo criterio que
 * `ALERGENOS`/`ETIQUETAS_DIETETICAS`.
 *
 * `local` NO es "comercial pero con geo": el clasificador la usa como categoría propia cuando la
 * keyword tiene señal geográfica y ninguna señal léxica de compra, comparación o duda
 * (`kr-service/src/pipeline/intent.ts`, `classifyIntent`) — no es una variante de `commercial`, y su
 * etiqueta en español no debe sugerirlo.
 */
export const INTENCIONES: readonly Intencion[] = [
  'transactional',
  'commercial',
  'local',
  'informational',
  'navigational',
];

export const ETIQUETA_INTENCION: Record<Intencion, string> = {
  transactional: 'Transaccional',
  commercial: 'Comercial',
  local: 'Local',
  informational: 'Informacional',
  navigational: 'Navegacional',
};

/**
 * Traduce un valor de `intencion` a su etiqueta en español, con el crudo como fallback.
 *
 * `PaginaPropuesta.intencion` (`models.ts`) es `string` a secas —un DTO que espeja el JSON de la API
 * tal cual llega, sin garantía de enum en el tipo—, así que este accesor no puede asumir que el valor
 * está en `ETIQUETA_INTENCION`. Mostrar el valor crudo en vez de esconderlo o lanzar es el mismo
 * criterio que un uuid "sin asignar" (`portal-angular`): no inventar una traducción que no se puede
 * respaldar.
 */
export function etiquetaIntencion(valor: string): string {
  return (ETIQUETA_INTENCION as Record<string, string>)[valor] ?? valor;
}
