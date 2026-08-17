import type { Alergeno, EtiquetaDietetica } from './models';

/**
 * Vocabulario del menú enriquecido: los 14 alérgenos y las 7 etiquetas dietéticas, con su etiqueta
 * legible en español — mismas listas y mismos textos que `ETIQUETA_ALERGENO`/`ETIQUETA_DIETETICA` de
 * `web-builder/src/render/piezas/carta-categorias.ts` (que el portal no importa, ADR-21, así que se
 * copian a mano). Si el sitio público cambia una etiqueta, este archivo se desincroniza en silencio
 * — mismo riesgo que ya acepta `ideas-estado.ts` para el vocabulario de Ideas.
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
