import type { FaqBlok } from "../../types.js";
import { envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Las preguntas frecuentes: el `renderFaq` actual, trasladado. Dueña de `id="faq"`.
 *
 * ⚠️ `details` y `summary` eran **selectores de elemento globales** en el CSS de origen, y son de los
 * cuatro que la spec señala como "sin dueño claro". Ahora son suyos — y con ellos, su modo oscuro:
 * el `border-bottom:#e7e5e0` de `details` salía casi blanco sobre negro porque el `@media` central
 * nunca lo nombró. Completarlo fue el arreglo 1 de la entrega 3.
 *
 * ## El rediseño: un acordeón de tarjetas, y el marcador propio
 *
 * Cada pregunta pasa a ser una tarjeta con fondo en vez de una fila separada por una línea, y la
 * sección **no lleva `.alt`**: en la receta de la landing va justo antes de `ctaFinal`, que sí lo
 * lleva, y dos franjas `--soft` seguidas se leen como una sola de 400 px de alto.
 *
 * El `+`/`−` de la derecha sustituye al triángulo nativo, que es el único elemento de la página que
 * no sigue la tipografía de nadie. **Quitarlo necesita las dos reglas** —`list-style:none` para
 * Firefox y `::-webkit-details-marker` para Safari—: con una sola, el otro navegador dibuja los dos
 * marcadores a la vez.
 *
 * Y sigue **sin una línea de JavaScript**: `details`/`summary` abren y cierran solos.
 */
export const faq: Pieza = {
  id: "faq",
  raiz: "p-faq",
  css: `.p-faq .lista{max-width:var(--ancho-lectura);margin:0 auto;display:grid;gap:12px}
/* Cada pregunta es una tarjeta con fondo, no una fila separada por una línea: el acordeón de la
   referencia se lee como una lista de piezas pulsables, y con el fondo se ve dónde termina la
   respuesta abierta sin necesidad de más separadores. */
.p-faq details{background:var(--soft);border:1px solid #e7e5e0;border-radius:10px;padding:0}
.p-faq summary{font-family:var(--fuente-titulo);font-size:1.1rem;font-weight:500;color:var(--titulo);cursor:pointer;padding:18px 52px 18px 22px;position:relative;list-style:none}
/* Sin el marcador nativo: el triángulo por defecto es el único elemento de la página que no sigue la
   tipografía de nadie, y con el signo propio el estado abierto/cerrado se lee igual. Las dos reglas
   hacen falta —'list-style' cubre Firefox, el pseudo de WebKit cubre Safari— y ninguna de las dos
   sirve sola. */
.p-faq summary::-webkit-details-marker{display:none}
.p-faq summary::after{content:"+";position:absolute;right:22px;top:50%;transform:translateY(-50%);font-size:1.5rem;line-height:1;color:var(--acento-legible)}
.p-faq details[open] summary::after{content:"\\2212"}
.p-faq summary:focus-visible{outline:2px solid var(--acento-legible);outline-offset:-2px;border-radius:10px}
.p-faq details p{margin:0;padding:0 22px 20px;color:var(--muted);line-height:1.8}
`,

  // El borde de la tarjeta es el único color literal que le queda a la pieza, y por eso sigue
  // teniendo modo oscuro: `#e7e5e0` sobre `#111` es casi blanco.
  cssOscuro: `@media(prefers-color-scheme:dark){.p-faq details{border-color:#2a2a2a}}
`,

  render(ctx: CtxPieza): string {
    const f = ctx.story?.content.body.find((b): b is FaqBlok => b.component === "faq");
    if (!f) return "";
    const items = f.items
      .map(
        (it) => `    <details>
      <summary>${esc(it.question)}</summary>
      <p>${it.answer ? esc(it.answer) : `<span class="pending">Respuesta pendiente de redacción.</span>`}</p>
    </details>`,
      )
      .join("\n");
    // El antetítulo es una ETIQUETA DE PLANTILLA, igual que en las demás secciones rediseñadas: "FAQ"
    // rotula la sección y no afirma nada del negocio. El `id="faq"` sigue en el `<section>`, que es
    // adonde apunta el CTA del hero cuando no hay perfil — moverlo rompería ese ancla en silencio.
    return envolver(
      "p-faq",
      `<section class="faq seccion" id="faq"><div class="banda">
  <div class="encabezado"><p class="antetitulo">FAQ</p><h2>Preguntas frecuentes</h2></div>
  <div class="lista">
${items}
  </div>
</div></section>`,
    );
  },
};
