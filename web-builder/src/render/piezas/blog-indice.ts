import { envolver, tarjetaIndice } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El índice de `/blog`: las páginas de research que son artículos (`schema_type: Article`).
 *
 * Existe para que los posts no queden como enlaces sueltos en el pie ni compitiendo con las landings
 * comerciales en el índice de la home.
 *
 * Igual que `indice`, su estado "sin datos" es un **aviso**, no el vacío: la página `/blog` existe y
 * dice que todavía no hay artículos.
 */
export const blogIndice: Pieza = {
  id: "blogIndice",
  raiz: "p-blogIndice",
  // **Sin encabezado, y por eso su CSS es solo el del aviso**: el cabezal de `/blog` ya dice "Blog ·
  // …", y repetirlo en un `h2` sería el mismo título dos veces en dos pantallas de distancia. Es la
  // única diferencia real con `indice`, y es la razón por la que siguen siendo dos piezas.
  css: `.p-blogIndice .pending{text-align:center;max-width:var(--ancho-lectura);margin:0 auto}
`,

  render(ctx: CtxPieza): string {
    const tarjetas = ctx.paginas.length
      ? `<div class="cards">\n${ctx.paginas.map(tarjetaIndice).join("\n")}\n  </div>`
      : `<p class="pending">Todavía no hay artículos publicados.</p>`;

    return envolver(
      "p-blogIndice",
      `<section class="indice seccion"><div class="banda">
  ${tarjetas}
</div></section>`,
    );
  },
};
