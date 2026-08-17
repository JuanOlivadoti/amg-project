import type { Alergeno, EtiquetaDietetica } from './models';

/**
 * Vocabulario del menú enriquecido: los 14 alérgenos y las 7 etiquetas dietéticas, con su etiqueta
 * legible en español — mismas listas y mismos textos que `ETIQUETA_ALERGENO`/`ETIQUETA_DIETETICA` de
 * `web-builder/src/render/piezas/carta-categorias.ts` (que el portal no importa, ADR-21, así que se
 * copian a mano).
 *
 * **Las ETIQUETAS en español (los textos que ve el usuario) no tienen mecanismo de runtime-import
 * que las ate al sitio público** — ahí sí corre el mismo riesgo que ya acepta `ideas-estado.ts` para
 * el vocabulario de Ideas: si el render cambia un texto, este archivo se desincroniza en silencio.
 *
 * **Los VALORES del enum (`ALERGENOS`/`ETIQUETAS_DIETETICAS` en sí) son otra historia**, y no es el
 * mismo caso que Ideas: los identificadores de Ideas SÍ están atados a `db/src/ideas.ts` con un
 * `import()` en runtime del archivo real (mismo mecanismo que `codigos.test.ts`), porque `db/`
 * puede importarse desde un test del portal. `web-builder/` no — ADR-21 es unidireccional, así que
 * esta copia no puede hacer lo mismo. La atadura real de los VALORES vive del otro lado: un test en
 * `web-builder/src/contract.test.ts` prueba, con estos mismos arrays pegados como literales (porque
 * ESE test tampoco puede importar del portal), que `menuItemSchema` acepta cada uno — si alguien
 * renombra un valor en `web-builder`, ese test cae ahí, no acá.
 */
export const ALERGENOS: readonly Alergeno[] = [
  'gluten',
  'crustaceos',
  'huevos',
  'pescado',
  'cacahuetes',
  'soja',
  'lacteos',
  'frutos_cascara',
  'apio',
  'mostaza',
  'sesamo',
  'sulfitos',
  'altramuces',
  'moluscos',
];

export const ETIQUETA_ALERGENO: Record<Alergeno, string> = {
  gluten: 'Gluten',
  crustaceos: 'Crustáceos',
  huevos: 'Huevos',
  pescado: 'Pescado',
  cacahuetes: 'Cacahuetes',
  soja: 'Soja',
  lacteos: 'Lácteos',
  frutos_cascara: 'Frutos de cáscara',
  apio: 'Apio',
  mostaza: 'Mostaza',
  sesamo: 'Sésamo',
  sulfitos: 'Sulfitos',
  altramuces: 'Altramuces',
  moluscos: 'Moluscos',
};

export const ETIQUETAS_DIETETICAS: readonly EtiquetaDietetica[] = [
  'vegano',
  'vegetariano',
  'sin_gluten',
  'sin_lactosa',
  'picante',
  'halal',
  'kosher',
];

export const ETIQUETA_DIETETICA_LABEL: Record<EtiquetaDietetica, string> = {
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sin_gluten: 'Sin gluten',
  sin_lactosa: 'Sin lactosa',
  picante: 'Picante',
  halal: 'Halal',
  kosher: 'Kosher',
};
