import type { MenuItem } from "../../types.js";
import { agruparCarta, envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * La carta de `/menu`, agrupada por categoría: el `renderGrupoCarta` actual, trasladado.
 *
 * La página se **sintetiza del perfil**, no de una story ni del LLM: una carta es una lista de
 * producto con precio, no hay nada que "redactar", y generarla por IA metería una fuente más de
 * contenido que revisar en la compuerta humana (ADR-06).
 *
 * ✅ **El modo oscuro, completo** (entrega 3). Era el hueco que abre la spec: `.carta` declara su
 * `border-bottom` con una clase, así que el `section{border-color:#1e1e1e}` del `@media` central —un
 * selector de elemento— nunca ganaba por especificidad, y `.carta li` (`#f5f4f2`) quedó directamente
 * fuera; en oscuro esas líneas salían casi blancas sobre negro. Ahora las reglas oscuras son de la
 * pieza y `huecosDeModoOscuro` recorre el catálogo para que no vuelva a pasar en una pieza nueva.
 *
 * La carta rediseñada con categorías y fotos (`cartaCategorias`) es la mitad B de la entrega 3.
 */
export const carta: Pieza = {
  id: "carta",
  raiz: "p-carta",
  css: `.p-carta .carta{padding:24px 0;border-bottom:1px solid #f0f0f0}
.p-carta .carta h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-carta .carta .items{list-style:none;margin:0;padding:0}
.p-carta .carta li{padding:10px 0;border-bottom:1px solid #f5f4f2}
/* El DOBLE BORDE del final de cada categoría: la última fila dibujaba su separador y el
   \`<section class="carta">\` dibujaba el suyo justo debajo, dos líneas pegadas. Se ve en \`/menu\` de
   cualquier cliente con carta. Gana el del contenedor, que es el que separa una categoría de la
   siguiente; el de la fila solo separa platos ENTRE sí y después de la última no separa nada. */
.p-carta .carta li:last-child{border-bottom:0}
.p-carta .carta .fila{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.p-carta .carta .nombre{font-weight:600}
/* \`--acento-legible\` y no \`--accent\`: es texto de acento sobre el fondo de la página, y en oscuro el
   acento pleno de un cliente puede quedar ilegible. El botón del hero sí conserva \`--accent\`. */
.p-carta .carta .precio{color:var(--acento-legible);font-weight:600;white-space:nowrap}
.p-carta .carta .desc{margin:4px 0 0;color:var(--muted);font-size:.95rem}
@media(prefers-color-scheme:dark){.p-carta .carta{border-color:#1e1e1e}.p-carta .carta li{border-color:#191919}}
`,

  render(ctx: CtxPieza): string {
    const grupos = agruparCarta(ctx.profile?.menu ?? []);
    const cuerpo = grupos.length
      ? grupos.map(unGrupo).join("\n")
      : `<p class="pending">La carta todavía no está cargada.</p>`;
    return envolver("p-carta", cuerpo);
  },
};

function unGrupo(g: { categoria: string | null; items: MenuItem[] }): string {
  const filas = g.items
    .map((it) => {
      const precio = it.price ? `<span class="precio">${esc(it.price)}</span>` : "";
      const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
      return `  <li><div class="fila"><span class="nombre">${esc(it.name)}</span>${precio}</div>${desc}</li>`;
    })
    .join("\n");
  return `<section class="carta">
  ${g.categoria ? `<h2>${esc(g.categoria)}</h2>` : ""}
  <ul class="items">
${filas}
  </ul>
</section>`;
}
