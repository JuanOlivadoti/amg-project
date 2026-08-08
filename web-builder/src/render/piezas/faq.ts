import type { FaqBlok } from "../../types.js";
import { envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Las preguntas frecuentes: el `renderFaq` actual, trasladado. Dueña de `id="faq"`.
 *
 * ⚠️ `details` y `summary` eran **selectores de elemento globales** en el CSS de origen, y son de los
 * cuatro que la spec señala como "sin dueño claro". Ahora son suyos. De paso queda a la vista el bug
 * que motiva la spec: el `details` de esta pieza sigue con `border-bottom:#e7e5e0` en modo oscuro,
 * porque el `@media` central nunca lo nombró. **Se reparte tal cual, con el hueco incluido**:
 * completarlo es un arreglo *visual* y pertenece a la entrega 3, donde el criterio ya no es paridad.
 */
export const faq: Pieza = {
  id: "faq",
  raiz: "p-faq",
  // `border-bottom` en `.faq` no es nuevo: lo heredaba del `section{…}` global, que ya no existe.
  css: `.p-faq .faq{background:var(--soft);border-radius:12px;padding:24px;margin:32px 0;border-bottom:1px solid #f0f0f0}
.p-faq .faq h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em}
.p-faq details{padding:12px 0;border-bottom:1px solid #e7e5e0}
.p-faq summary{font-weight:600;cursor:pointer}
@media(prefers-color-scheme:dark){.p-faq .faq{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const f = ctx.story?.content.body.find((b): b is FaqBlok => b.component === "faq");
    if (!f) return "";
    const items = f.items
      .map(
        (it) => `  <details>
    <summary>${esc(it.question)}</summary>
    <p>${it.answer ? esc(it.answer) : `<span class="pending">Respuesta pendiente de redacción.</span>`}</p>
  </details>`,
      )
      .join("\n");
    return envolver(
      "p-faq",
      `<section class="faq" id="faq">
  <h2>Preguntas frecuentes</h2>
${items}
</section>`,
    );
  },
};
