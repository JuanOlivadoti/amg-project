import { MAX_FOTOS_GALERIA, comoImagen, envolver, renderImagen } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La rejilla de fotos del negocio** (`profile.fotos`).
 *
 * ## El `""` de esta pieza tiene DOS causas, no una
 *
 * La obvia: un perfil sin `fotos`. La que un `if (!fotos.length) return ""` no cubre: **una ficha con
 * fotos de las que ninguna se puede servir** —hosts fuera de la allowlist, `http:`, o el presupuesto
 * de 60 imágenes del documento ya agotado—. Ahí hay datos y no hay nada que dibujar, y emitir el
 * `<h2>` sobre una rejilla vacía sería exactamente el hueco que la spec prohíbe, con el agravante de
 * que este sí llega a servirse.
 *
 * Por eso se renderizan primero las `<img>` y se decide después: la pieza existe si al menos una foto
 * sobrevivió a la §Política de imágenes.
 *
 * ## El tope
 *
 * 30, aplicado también acá (frontera 4). Las otras tres fronteras ya cortan, pero en PROD el perfil
 * llega de `clients.business_profile_publico` sin pasar por el Zod de este paquete. El presupuesto de
 * 60 del documento no sustituye a este tope: protege al documento entero, no a esta sección, y una
 * galería que se comiera los 60 huecos dejaría a la carta y a la portada sin ninguno.
 *
 * ## El rediseño: la banda ancha, que es lo que una galería necesitaba
 *
 * Hasta ahora el andamio del rediseño la encerraba en `--ancho-lectura` (760 px), o sea que la rejilla
 * de fotos ocupaba el ancho pensado para PÁRRAFOS. Es la pieza a la que más le costaba ese andamio:
 * una galería es exactamente el caso que justifica que existan dos anchos. Al quitarlo pasa a la banda
 * de 1320 y las fotos se ven al tamaño que tienen.
 *
 * Con el ancho llega el **encabezado compartido** (antetítulo + `h2`), el mismo de las demás secciones
 * rediseñadas: un `h2` pequeño propio hacía que la galería se leyera como un apéndice del párrafo de
 * arriba en vez de como una sección.
 */
export const galeria: Pieza = {
  id: "galeria",
  raiz: "p-galeria",
  // Las fotos van en cuadrado (`aspect-ratio:1`) con `object-fit:cover` porque las de la ficha vienen
  // con proporciones distintas y una rejilla de alturas desiguales se lee como un error, no como
  // diseño.
  css: `/* Número de columnas FIJO por tramo, y no un \`auto-fill\` con \`minmax\`.
   Con la banda ancha, un 'auto-fill' de 150px daría ocho columnas de miniaturas en un escritorio; y
   subir el mínimo para arreglarlo deja el número de columnas a merced del ancho, con lo que una ficha
   de seis fotos —las que trae la plantilla de demo— cae en 4+2 y la última fila queda coja. Con 2 y 3
   las seis siempre completan sus filas, en móvil y en escritorio. */
.p-galeria .rejilla{display:grid;grid-template-columns:repeat(2,1fr);gap:clamp(12px,1.4vw,20px)}
@media(min-width:768px){.p-galeria .rejilla{grid-template-columns:repeat(3,1fr)}}
.p-galeria .foto{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block}
`,

  render(ctx: CtxPieza): string {
    const fotos = ctx.profile?.fotos ?? [];
    if (fotos.length === 0) return "";

    const imgs = fotos
      .slice(0, MAX_FOTOS_GALERIA)
      .map((f) => renderImagen(comoImagen(f), "foto", ctx.presupuestoImagenes))
      .filter(Boolean);
    // Ver el bloque de arriba: hay fotos en la ficha y ninguna se puede servir.
    if (imgs.length === 0) return "";

    // El antetítulo y el título son ETIQUETAS DE PLANTILLA, no contenido del negocio: rotulan la
    // sección igual que "Inicio" rotula una entrada del nav. Lo que no se inventa es el dato.
    return envolver(
      "p-galeria",
      `<section class="seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Galería</p><h2>El sitio, por dentro</h2></div>
  <div class="rejilla">
${imgs.map((img) => `    ${img}`).join("\n")}
  </div>
</div></section>`,
    );
  },
};
