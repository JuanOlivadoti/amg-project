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
  // Sin regla para `h2`: este índice no lleva encabezado (el `<h1>` de arriba ya dice "Blog · …").
  css: `.p-blogIndice .indice{padding:8px 0 32px;border-bottom:1px solid #f0f0f0}
@media(prefers-color-scheme:dark){.p-blogIndice .indice{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const tarjetas = ctx.paginas.length
      ? `<div class="cards">\n${ctx.paginas.map(tarjetaIndice).join("\n")}\n</div>`
      : `<p class="pending">Todavía no hay artículos publicados.</p>`;

    return envolver(
      "p-blogIndice",
      `<section class="indice">
  ${tarjetas}
</section>`,
    );
  },
};
