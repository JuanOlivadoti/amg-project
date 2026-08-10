import { barraDatos } from "./barra-datos.js";
import { blogIndice } from "./blog-indice.js";
import { cabecera } from "./cabecera.js";
import { cartaCategorias } from "./carta-categorias.js";
import { contacto } from "./contacto.js";
import { ctaFinal } from "./cta-final.js";
import { faq } from "./faq.js";
import { galeria } from "./galeria.js";
import { hero } from "./hero.js";
import { heroSlider } from "./hero-slider.js";
import { indice } from "./indice.js";
import { locales } from "./locales.js";
import { platosDestacados } from "./platos-destacados.js";
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
 *
 * ⚠️ **`carta` ya no está**, y su retiro es una decisión de esta entrega, no una omisión.
 * `cartaCategorias` cubre también el caso sin `menu_categorias` —la spec lo pide como test—, así que
 * `carta` se quedaba sin ninguna receta que la nombrara. Una pieza que no nombra ninguna receta es
 * código que nunca llega a un navegador con tests que pasan para siempre: exactamente la clase de
 * verde que este proyecto persigue. Sus dos garantías vivas (el arreglo del doble borde al final de
 * cada categoría y el escapado de nombre/precio/descripción) se mudaron con sus tests a
 * `cartaCategorias`, que es donde hoy importan.
 *
 * ⚠️ **`heroPortada` tampoco está**, y se retira por el MISMO criterio, no por uno nuevo. El rediseño
 * de la plantilla base le dio a `heroSlider` los dos casos que quedaban —la portada de `story` y la de
 * `home`—, así que `heroPortada` se quedó sin ninguna receta que la nombrara: código que nunca llega a
 * un navegador con tests que pasan para siempre. Sus garantías vivas se mudaron con sus tests a
 * `heroSlider` (`piezas-foto.test.ts`), y son las mismas de siempre: sin foto válida la portada cae al
 * hero **tipográfico** y no a un hueco (`class="portada sin-img"`), una foto de host no permitido no se
 * dibuja y la portada sale igual, y la foto de arriba es la **única** `fetchpriority="high"` del
 * documento —con la diferencia de que ahora hay hasta cinco diapositivas y la prioritaria es solo la
 * primera—.
 */
export const CATALOGO: readonly Pieza[] = [
  cabecera,
  heroSlider,
  hero,
  barraDatos,
  seccionProsa,
  platosDestacados,
  cartaCategorias,
  galeria,
  faq,
  indice,
  blogIndice,
  ctaFinal,
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
