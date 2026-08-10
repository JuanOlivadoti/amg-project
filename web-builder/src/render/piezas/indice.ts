import { envolver, tarjetaIndice } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El índice de páginas publicadas de la home sintetizada.
 *
 * **No devuelve `""` cuando no hay páginas**, y es deliberado: hoy emite un aviso ("Aún no hay
 * páginas publicadas…") que es texto visible y por tanto parte del gate de paridad. Un cliente recién
 * dado de alta tiene que ver que su portada existe y que las páginas van a aparecer, no una home
 * hueca. Su estado "sin datos" es el aviso, no el vacío.
 */
export const indice: Pieza = {
  id: "indice",
  raiz: "p-indice",
  // `.indice` y su `border-bottom` (que heredaba del `section{…}` global) los declara cada índice por
  // separado: `blogIndice` tiene los suyos. Lo compartido de verdad —`.cards`, `.card`, `.pending`—
  // vive en el CSS base (§3.6).
  css: `/* Andamio del rediseno: esta pieza todavia no usa la banda ancha, asi que se queda en el
   ancho de lectura. Se quita cuando la seccion se rediseñe. */
.p-indice{max-width:var(--ancho-lectura);margin:0 auto}
.p-indice .indice{padding:8px 0 32px;border-bottom:1px solid #f0f0f0}
.p-indice .indice h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-indice .indice{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const tarjetas = ctx.paginas.length
      ? `<div class="cards">
${ctx.paginas.map(tarjetaIndice).join("\n")}
</div>`
      : `<p class="pending">Aún no hay páginas publicadas. Aparecerán aquí en cuanto se publiquen.</p>`;

    return envolver(
      "p-indice",
      `<section class="indice">
  <h2>Páginas</h2>
  ${tarjetas}
</section>`,
    );
  },
};
