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
 * ⚠️ **Sin modo oscuro, a propósito.** Hoy `.carta` declara su `border-bottom` con una clase, así que
 * el `section{border-color:#1e1e1e}` del `@media` central —un selector de elemento— nunca ganaba por
 * especificidad, y `.carta li` (`#f5f4f2`) quedó directamente fuera: en oscuro esas líneas salen casi
 * blancas sobre negro. **El hueco se traslada tal cual**; completarlo cambia cómo se ve el sitio y es
 * la entrega 3. La carta rediseñada con categorías y fotos (`cartaCategorias`) también.
 */
export const carta: Pieza = {
  id: "carta",
  raiz: "p-carta",
  css: `.p-carta .carta{padding:24px 0;border-bottom:1px solid #f0f0f0}
.p-carta .carta h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em}
.p-carta .carta .items{list-style:none;margin:0;padding:0}
.p-carta .carta li{padding:10px 0;border-bottom:1px solid #f5f4f2}
.p-carta .carta .fila{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.p-carta .carta .nombre{font-weight:600}
.p-carta .carta .precio{color:var(--accent);font-weight:600;white-space:nowrap}
.p-carta .carta .desc{margin:4px 0 0;color:var(--muted);font-size:.95rem}
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
