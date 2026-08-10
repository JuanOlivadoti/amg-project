import type { SectionBlok } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import { envolver, esc, renderImagen } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Las secciones de prosa de una story: el `renderSection` actual, trasladado.
 *
 * ⚠️ Su CSS **fue el que más se tocó al repartir**, porque en el origen era `section{…}` y
 * `section h2{…}` a secas: dos selectores de elemento que estilaban *todas* las secciones del
 * documento —el índice de la home, la carta, la FAQ y hasta las del pie—. Cada una de esas piezas se
 * llevó su propia copia de lo que antes heredaba, en vez de depender de un selector global sin dueño.
 *
 * ## El rediseño: una sección con varios apartados, no varias secciones
 *
 * Los apartados de una story son partes de un mismo texto, así que van dentro de **una** `.seccion`
 * con la mitad de aire entre ellos. Con `--pad-seccion` cada uno, una landing de cuatro apartados
 * serían cuatro pantallas de scroll con tres párrafos dentro.
 *
 * Y la prosa se queda en `--ancho-lectura` aunque la banda mida 1320: es el caso exacto para el que
 * existen los dos anchos. Lo único que usa la banda entera es el apartado **con foto**, que pasa a
 * dos columnas —el bloque "sobre nosotros" de la referencia—; hoy no lo alcanza ninguna página de
 * producción, porque `handoff/adapter.ts` nunca rellena `image`.
 *
 * Sin `cssOscuro`: el `border-bottom:#f0f0f0` que lo necesitaba era el separador entre apartados, que
 * ya no hay. Ningún valor de la pieza es un color literal.
 */
export const seccionProsa: Pieza = {
  id: "seccionProsa",
  raiz: "p-seccionProsa",
  // ⚠️ **Las secciones de una story comparten UNA `.seccion`, no una cada una.** Son los apartados de
  // un mismo texto —"Sobre nosotros", "Especialidades"—, y darle a cada uno el aire de una sección
  // completa (120 px arriba y abajo) convertiría una landing de cuatro apartados en una página de
  // cuatro pantallas de scroll con tres párrafos dentro. El aire entre apartados es la mitad.
  css: `.p-seccionProsa .bloques{display:grid;gap:clamp(40px,5vw,72px)}
/* La prosa se queda en el ancho de LECTURA aunque la banda mida 1320: un renglón de 1280 px es
   ilegible. Es exactamente el caso para el que existen los dos anchos. */
.p-seccionProsa .texto{max-width:var(--ancho-lectura);margin:0 auto}
.p-seccionProsa h2{font-family:var(--fuente-titulo);font-size:clamp(1.6rem,1.1rem + 1.6vw,2.5rem);line-height:1.2;margin:0 0 16px;color:var(--titulo);letter-spacing:-.01em}
.p-seccionProsa p{margin:0;font-size:1.08rem;line-height:1.85}
.p-seccionProsa .section-img{width:100%;border-radius:14px;object-fit:cover;aspect-ratio:3/2;display:block}
/* Con foto, dos columnas: es el bloque "sobre nosotros" de la referencia. Sin foto, el apartado se
   queda centrado en el ancho de lectura — que es el estado de TODAS las secciones de producción,
   porque \`handoff/adapter.ts\` no rellena \`image\`. */
@media(min-width:992px){.p-seccionProsa .con-img{display:grid;grid-template-columns:1fr 1fr;gap:clamp(32px,4vw,64px);align-items:center}
.p-seccionProsa .con-img .texto{margin:0}}
`,

  render(ctx: CtxPieza): string {
    const sections = ctx.story?.content.body.filter((b): b is SectionBlok => b.component === "section") ?? [];
    if (sections.length === 0) return "";
    // El presupuesto de imágenes se pasa a cada sección: es del DOCUMENTO, así que las secciones lo
    // comparten entre sí y con el resto de las piezas. Ver `imagenes.ts`.
    return envolver(
      "p-seccionProsa",
      `<section class="seccion"><div class="banda">
  <div class="bloques">
${sections.map((s) => unaSeccion(s, ctx.presupuestoImagenes)).join("\n")}
  </div>
</div></section>`,
    );
  },
};

function unaSeccion(s: SectionBlok, presupuesto: PresupuestoImagenes): string {
  const body = s.body
    ? `<p>${esc(s.body)}</p>`
    : `<p class="pending">Contenido pendiente de redacción (generación por LLM — siguiente paso del pipeline).</p>`;
  const foto = renderImagen(s.image, "section-img", presupuesto);
  // `<article>` y no `<section>`: al dejar de ser cada apartado una sección del documento —ahora son
  // los bloques de UNA— el elemento que los describe es el genérico de contenido, no otro `<section>`
  // anidado dentro del primero.
  return `    <article${foto ? ' class="con-img"' : ""}>
      ${foto}
      <div class="texto">
        <h2>${esc(s.heading)}</h2>
        ${body}
      </div>
    </article>`;
}
