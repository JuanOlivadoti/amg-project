import type { FaqBlok, HeroBlok } from "../../types.js";
import { comoImagen, envolver, esc, renderImagen, resolverCta } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La portada de una landing**: el titular del brief aprobado más la foto del negocio.
 *
 * Sustituye a `hero` en la receta de `story` (y solo ahí: las tres páginas sintetizadas siguen usando
 * `hero`, que no tiene de dónde sacar una portada específica de la página).
 *
 * ## Las dos fuentes de la foto, y por qué el blok manda
 *
 *  - `story.body[hero].image` — la foto **de esta página**, que un humano sube en el Visual Editor;
 *  - `profile.portada` — la foto **del sitio**, que la agencia carga una vez en la ficha.
 *
 * Gana la del blok porque es la específica: quien la subió estaba mirando esta página. La de la ficha
 * es el respaldo, y es lo que hace que una web recién publicada tenga foto sin que nadie entre al
 * editor — que es el caso real, porque `handoff/adapter.ts` nunca rellena `image`.
 *
 * Si la del blok no pasa la §Política de imágenes, **se prueba la de la ficha**: `renderImagen`
 * devuelve `""` sin gastar cupo cuando descarta una URL, así que el respaldo no cuesta nada.
 *
 * ## Sin foto: hero TIPOGRÁFICO, no un hueco
 *
 * La spec lo pide con esas palabras. Un hueco sería emitir el envoltorio de la imagen vacío o dejar
 * el titular con el tamaño que solo tiene sentido cuando compite con una foto. La clase `sin-img` es
 * lo que el CSS usa para que el titular **crezca** y ocupe él la portada, con una regla decorativa
 * debajo. No es un fallback triste: es la otra mitad del diseño, y es la que ven todos los clientes
 * hasta que suben su primera foto.
 */
export const heroPortada: Pieza = {
  id: "heroPortada",
  raiz: "p-heroPortada",
  css: `.p-heroPortada .portada{padding:32px 0 40px;border-bottom:1px solid #f0f0f0}
/* Sin foto el bloque respira más y el titular crece: es lo único que hay en la portada, así que es lo
   que tiene que llevar el peso. Con foto se queda en 2.3rem para no competir con ella. */
.p-heroPortada .portada.sin-img{padding:56px 0 44px}
.p-heroPortada .portada h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-heroPortada .portada.sin-img h1{font-size:2.9rem}
/* La regla decorativa bajo el titular tipográfico. Es el ÚNICO consumidor del segundo color de marca
   en esta pieza y va en una superficie decorativa a propósito: \`--marca-secundario\` no puede pintar
   texto largo (ver \`css.ts\`, donde se explica el 2.62:1 que lo sacó de \`--muted\`). */
.p-heroPortada .portada.sin-img h1::after{content:"";display:block;width:72px;height:3px;margin:18px 0 0;background:var(--decorativo)}
/* ⚠️ Con la foto DECLARADA pero rota (el asset se borró del space), esta regla no salva el layout:
   el navegador trata una imagen sin píxeles como texto alternativo en línea e ignora width:100% y
   aspect-ratio, así que la portada colapsa a la altura del alt — medido en el navegador: 26 px donde
   iba el LCP, y el titular NO crece porque sin-img mira si hay src, no si carga.
   Detectarlo requeriría JS (onerror), y meter JS en el proceso anónimo por una ficha mal cargada es
   peor que el síntoma. Lo que sí lo mitiga es que renderImagen emite width/height cuando la URL de
   Storyblok los lleva (/2560x1440/): con ellos el navegador reserva el hueco y el resto de la página
   no se descoloca. Las URLs reales los llevan; las inventadas del dev-server, no. */
.p-heroPortada .hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.p-heroPortada .lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
/* La frase del CTA cuando no cabe en un botón. Menos peso que la bajada: es una invitación, no el
   resumen de la página. */
.p-heroPortada .cta-lede{font-size:1.02rem;color:var(--muted);margin:0 0 20px}
.p-heroPortada .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
@media(prefers-color-scheme:dark){.p-heroPortada .portada{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const body = ctx.story?.content.body;
    const h = body?.find((b): b is HeroBlok => b.component === "hero");
    // Sin blok `hero` no hay titular que anunciar. `heroPortada` NO cubre el caso sintetizado: para
    // eso está `hero`, que es la pieza de las otras tres recetas.
    if (!h) return "";

    // El `||` es la precedencia y el respaldo a la vez: una URL descartada devuelve `""` **sin gastar
    // cupo** (ver `renderImagen`), así que probar la segunda no cuesta un hueco del presupuesto.
    const foto =
      // `prioridad: "alta"` — esta foto es el **LCP** de la landing: va arriba del todo y es el
      // elemento más grande de la portada. Con `loading="lazy"` el navegador tendría que terminar el
      // layout para descubrir que está en el viewport y solo entonces pedirla, retrasando justo lo que
      // la métrica mide. Es la ÚNICA imagen del sitio marcada como prioritaria: marcar dos es no
      // marcar ninguna, porque compiten por el mismo ancho de banda.
      renderImagen(h.image, "hero-img", ctx.presupuestoImagenes, "alta") ||
      renderImagen(comoImagen(ctx.profile?.portada), "hero-img", ctx.presupuestoImagenes, "alta");

    const hayFaq = Boolean(body?.find((b): b is FaqBlok => b.component === "faq"));
    const cta = resolverCta(h.cta_label, ctx, hayFaq);

    return envolver(
      "p-heroPortada",
      `<header class="portada ${foto ? "con-img" : "sin-img"}">
  ${foto}
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${cta.bajada ? `<p class="cta-lede">${esc(cta.bajada)}</p>` : ""}
  ${cta.etiqueta && cta.href ? `<a class="cta" href="${cta.href}">${esc(cta.etiqueta)}</a>` : ""}
</header>`,
    );
  },
};
