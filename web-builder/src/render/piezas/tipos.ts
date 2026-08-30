import type { BusinessProfile, NavItem, Story, Vertical } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import type { PresupuestoVideos } from "../videos.js";

/**
 * El contrato de una **pieza** del catálogo de render (spec de plantillas de landing, §2).
 *
 * Una pieza es un fragmento de HTML **con su CSS**, y esas dos cosas viajan juntas o no viajan: si
 * `render` devuelve `""` porque no hay datos que mostrar, su `css` tampoco entra en el `<style>`. Es
 * lo que permite recetas optimistas sin huecos y sin pagar bytes por lo que no se dibuja.
 */
export interface Pieza {
  /** Identidad estable. La receta nombra piezas por este id. */
  id: string;
  /**
   * La clase raíz única que envuelve TODO su HTML, siempre `p-<id>`.
   *
   * No es cosmética: es lo que hace componible al catálogo. **Todo selector de `css` empieza por
   * ella** y `aislamiento.ts` lo comprueba mecánicamente, porque el CSS de origen estaba lleno de
   * selectores globales (`section`, `details`, `summary`) y repartirlos sin esa regla convierte cada
   * pieza en una amenaza para las demás — es exactamente el bug de modo oscuro que la spec viene a
   * cerrar: una sola regla nombraba cinco clases de cinco dueños distintos y dos se quedaron fuera.
   */
  raiz: string;
  /** Su CSS, y SOLO el suyo. Ver `raiz`. */
  css: string;
  /**
   * Su CSS **para el modo oscuro**, y solo el suyo. Va en un campo aparte —y no dentro de `css`—
   * porque el tema dejó de ser una decisión del visitante: el sitio de un cliente se sirve **claro**
   * salvo que su ficha pida `tema: "auto"` (ver `ensamblarCss`).
   *
   * Mientras el `@media(prefers-color-scheme:dark)` vivía incrustado en el string de `css`, "no
   * emitir el oscuro" solo se podía hacer recortando CSS con una expresión regular: frágil, y
   * silencioso cuando fallara. Separarlo lo convierte en no concatenar una cadena.
   *
   * Va **envuelto en su propio `@media`** por la pieza, igual que antes, para que siga siendo legible
   * de un vistazo qué regla pertenece a qué tema. `aislamiento.ts` lo audita con las mismas reglas que
   * `css`: la raíz de la pieza manda también acá.
   */
  cssOscuro?: string;
  /** El HTML de la pieza, o `""` si no tiene datos que mostrar. */
  render(ctx: CtxPieza): string;
}

/**
 * Lo que una pieza puede leer. **Es todo lo que puede leer**: una pieza no recibe la story de otra
 * página, ni el destino de publicación, ni nada que la deje decidir por el documento.
 *
 * `titulo`/`bajada`/`paginas` no estaban en el boceto de la spec y hacen falta porque tres de los
 * cuatro puntos de entrada (`/`, `/menu`, `/blog`) son páginas **sintetizadas**: no tienen `story`,
 * y su titular y su índice salen del perfil y de la lista de páginas publicadas.
 */
export interface CtxPieza {
  /** `null` en las páginas sintetizadas (home, `/menu`, `/blog`). */
  story: Story | null;
  profile: BusinessProfile | null;
  /** El slug de ESTA página, para marcar `aria-current` en el nav. */
  activeSlug: string;
  /**
   * El titular de una página **sintetizada**. Vacío en una story: ahí el titular sale del blok `hero`
   * y el que manda es el brief aprobado, no el perfil.
   */
  titulo: string;
  /** La bajada del titular sintetizado. Hoy solo la usa la home. */
  bajada: string;
  /** Páginas publicadas (home) o artículos (`/blog`). Vacío en el resto. */
  paginas: NavItem[];
  /** El rubro del cliente dueño del documento. Cualquier pieza puede leerlo para variar su copy
   *  (título de sección, unidad de conteo) sin necesitar una pieza nueva por vertical. */
  vertical: Vertical;
  /**
   * El presupuesto de imágenes **de este documento** (§Política de imágenes, punto 5).
   *
   * Es un objeto **mutable y compartido por todas las piezas del mismo documento**: cada `<img>` que
   * se emite le resta un hueco, de modo que el tope de 60 cuenta la página entera y no cada campo por
   * separado. Lo crea `renderDocumento`, uno por documento — nunca un contador de módulo.
   */
  presupuestoImagenes: PresupuestoImagenes;
  /** El presupuesto de videos de ESTE documento — mismo criterio que `presupuestoImagenes`, ver ahí. */
  presupuestoVideos: PresupuestoVideos;
}
