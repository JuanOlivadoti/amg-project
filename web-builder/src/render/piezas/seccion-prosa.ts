import type { SectionBlok } from "../../types.js";
import { envolver, esc, renderImagen } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Las secciones de prosa de una story: el `renderSection` actual, trasladado.
 *
 * ⚠️ Su CSS **es el que más se toca al repartir**, porque en el origen era `section{…}` y
 * `section h2{…}` a secas: dos selectores de elemento que estilaban *todas* las secciones del
 * documento —el índice de la home, la carta, la FAQ y hasta las del pie—. Al pasar a
 * `.p-seccionProsa section`, cada una de esas piezas se lleva su propia copia de lo que antes
 * heredaba, en vez de depender de un selector global sin dueño.
 */
export const seccionProsa: Pieza = {
  id: "seccionProsa",
  raiz: "p-seccionProsa",
  css: `.p-seccionProsa section{padding:32px 0;border-bottom:1px solid #f0f0f0}
.p-seccionProsa section h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em}
.p-seccionProsa .section-img{width:100%;border-radius:12px;margin:0 0 18px;object-fit:cover;aspect-ratio:3/2}
@media(prefers-color-scheme:dark){.p-seccionProsa section{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const sections = ctx.story?.content.body.filter((b): b is SectionBlok => b.component === "section") ?? [];
    if (sections.length === 0) return "";
    return envolver("p-seccionProsa", sections.map(unaSeccion).join("\n"));
  },
};

function unaSeccion(s: SectionBlok): string {
  const body = s.body
    ? `<p>${esc(s.body)}</p>`
    : `<p class="pending">Contenido pendiente de redacción (generación por LLM — siguiente paso del pipeline).</p>`;
  const foto = renderImagen(s.image, "section-img");
  return `<section${foto ? ' class="has-img"' : ""}>
  <h2>${esc(s.heading)}</h2>
  ${foto}
  ${body}
</section>`;
}
