import type { FaqBlok, HeroBlok } from "../../types.js";
import { envolver, esc, renderImagen } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El titular de la página.
 *
 * Cubre **dos** casos porque el HTML de origen los pintaba con el mismo `.hero`:
 *
 *  - una **story**: el blok `hero` del brief aprobado (titular, bajada, CTA y foto del blok);
 *  - una página **sintetizada** (`/`, `/menu`, `/blog`): el `titulo`/`bajada` del contexto.
 *
 * Por eso esta pieza está en las CUATRO recetas y no solo en la de story. La tabla del encargo la
 * listaba únicamente en `story`, pero `renderHome`/`renderMenu`/`renderBlogIndex` emiten hoy su
 * propio `<header class="hero">`: dejarla fuera borraba el `<h1>` de tres páginas (y con él el gate
 * de paridad), o bien obligaba a triplicar el CSS de `.hero` dentro de `indice`, `carta` y
 * `blogIndice` — tres copias que se desincronizan en cuanto la entrega 3 rediseñe el hero.
 *
 * ⚠️ Esto es el **traslado** de `renderHero`, sin foto de portada del perfil. `heroPortada`
 * (`profile.portada`), `barraDatos` y el CTA derivado son la entrega 3.
 */
export const hero: Pieza = {
  id: "hero",
  raiz: "p-hero",
  css: `.p-hero .hero{padding:48px 0 40px;border-bottom:1px solid #eee}
.p-hero .hero.has-img{padding-top:24px}
.p-hero .hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.p-hero .hero h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em}
.p-hero .lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
.p-hero .cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
@media(prefers-color-scheme:dark){.p-hero .hero{border-color:#222}}
`,

  render(ctx: CtxPieza): string {
    const body = ctx.story?.content.body;
    const h = body?.find((b): b is HeroBlok => b.component === "hero");
    if (h) {
      const faq = body?.find((b): b is FaqBlok => b.component === "faq");
      // Destino del CTA: contacto si hay perfil, si no las FAQs; si no hay ninguno, sin ancla.
      const ctaHref = ctx.profile ? "#contacto" : faq ? "#faq" : null;
      // La foto de portada va como banner arriba del título: es lo primero que ve un humano.
      const foto = renderImagen(h.image, "hero-img");
      return envolver(
        "p-hero",
        `<header class="hero${foto ? " has-img" : ""}">
  ${foto}
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${h.cta_label && ctaHref ? `<a class="cta" href="${ctaHref}">${esc(h.cta_label)}</a>` : ""}
</header>`,
      );
    }

    if (ctx.titulo) {
      return envolver(
        "p-hero",
        `<header class="hero">
  <h1>${esc(ctx.titulo)}</h1>
  ${ctx.bajada ? `<p class="lede">${esc(ctx.bajada)}</p>` : ""}
</header>`,
      );
    }

    // Ni blok `hero` ni titular sintetizado: no hay nada que anunciar. Sin datos → "".
    return "";
  },
};
