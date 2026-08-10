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
 */
export const galeria: Pieza = {
  id: "galeria",
  raiz: "p-galeria",
  // `auto-fill` + `minmax(150px,1fr)`: tantas columnas como quepan, sin media queries. Las fotos van
  // en cuadrado (`aspect-ratio:1`) con `object-fit:cover` porque las de la ficha vienen con
  // proporciones distintas y una rejilla de alturas desiguales se lee como un error, no como diseño.
  css: `/* Andamio del rediseno: esta pieza todavia no usa la banda ancha, asi que se queda en el
   ancho de lectura. Se quita cuando la seccion se rediseñe. */
.p-galeria{max-width:var(--ancho-lectura);margin:0 auto}
.p-galeria .galeria{padding:32px 0;border-bottom:1px solid #f0f0f0}
.p-galeria .galeria h2{font-size:1.45rem;margin:0 0 16px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-galeria .rejilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.p-galeria .foto{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-galeria .galeria{border-color:#1e1e1e}}
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

    return envolver(
      "p-galeria",
      `<section class="galeria">
  <h2>Galería</h2>
  <div class="rejilla">
${imgs.map((img) => `    ${img}`).join("\n")}
  </div>
</section>`,
    );
  },
};
