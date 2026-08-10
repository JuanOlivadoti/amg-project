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
  // ⚠️ Del CSS de esta pieza no queda casi nada, y es la señal de que el reparto salió bien: el
  // `border-bottom` que heredaba del `section{…}` global lo sustituye el ritmo de `.seccion`, y el
  // titular lo pinta `.encabezado h2` del base. Lo compartido de verdad —`.cards`, `.card`,
  // `.pending`— ya vivía ahí (§3.6).
  // El aviso de "sin páginas" se centra: sin esto queda pegado al borde izquierdo de una banda de
  // 1320 px, debajo de un encabezado centrado. `.cards` y `.card` los declara el base (§3.6).
  css: `.p-indice .pending{text-align:center;max-width:var(--ancho-lectura);margin:0 auto}
`,

  render(ctx: CtxPieza): string {
    const tarjetas = ctx.paginas.length
      ? `<div class="cards">
${ctx.paginas.map(tarjetaIndice).join("\n")}
  </div>`
      : `<p class="pending">Aún no hay páginas publicadas. Aparecerán aquí en cuanto se publiquen.</p>`;

    // El antetítulo es una ETIQUETA DE PLANTILLA. "Páginas" se mantiene como `h2` —es el texto que
    // congela el gate de paridad— y "Lo que hay en el sitio" lo rotula sin decir nada del negocio.
    return envolver(
      "p-indice",
      `<section class="indice seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Lo que hay en el sitio</p><h2>Páginas</h2></div>
  ${tarjetas}
</div></section>`,
    );
  },
};
