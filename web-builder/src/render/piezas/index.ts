import { blogIndice } from "./blog-indice.js";
import { cabecera } from "./cabecera.js";
import { carta } from "./carta.js";
import { contacto } from "./contacto.js";
import { faq } from "./faq.js";
import { hero } from "./hero.js";
import { indice } from "./indice.js";
import { locales } from "./locales.js";
import { seccionProsa } from "./seccion-prosa.js";
import type { Pieza } from "./tipos.js";

export type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **El catálogo, y su orden es un contrato.**
 *
 * El `<style>` emite el CSS de las piezas usadas en ESTE orden, no en el de la receta, para que dos
 * páginas con las mismas piezas produzcan un `<style>` idéntico byte a byte. Reordenar este array
 * cambia los bytes de todas las páginas publicadas; con las reglas de aislamiento (§3) no cambia
 * cómo se ven, pero sigue siendo un cambio deliberado y no un detalle de import.
 *
 * El orden elegido es el del documento: cabecera → contenido (en el orden en que suele aparecer) →
 * pie. Es el que hace legible el `<style>` de una página cualquiera.
 */
export const CATALOGO: readonly Pieza[] = [
  cabecera,
  hero,
  seccionProsa,
  faq,
  indice,
  carta,
  blogIndice,
  contacto,
  locales,
];

/**
 * La pieza con ese id, o `undefined`.
 *
 * **No lanza**, y es una decisión de seguridad, no de estilo: este código corre en el único proceso
 * expuesto a internet anónimo, y una receta que nombrara una pieza inexistente serviría un 503 en vez
 * de una página a la que le falta un bloque. Que las recetas solo nombren piezas del catálogo lo fija
 * un test (`ensamblado.test.ts`), que es donde un error de programación tiene que doler.
 */
export function piezaPorId(id: string): Pieza | undefined {
  return CATALOGO.find((p) => p.id === id);
}
