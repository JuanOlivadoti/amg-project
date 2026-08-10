import type { FaqBlok, HeroBlok } from "../../types.js";
import { envolver, esc, renderImagen, resolverCta } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El titular de la página.
 *
 * Cubre **dos** casos porque el HTML de origen los pintaba con el mismo `.hero`:
 *
 *  - una **story**: el blok `hero` del brief aprobado (titular, bajada, CTA y foto del blok);
 *  - una página **sintetizada** (`/`, `/menu`, `/blog`): el `titulo`/`bajada` del contexto.
 *
 * Por eso esta pieza no está solo en la receta de story. La tabla del encargo la listaba únicamente
 * ahí, pero `renderHome`/`renderMenu`/`renderBlogIndex` emiten su propio `<header class="hero">`:
 * dejarla fuera borraba el `<h1>` de tres páginas, o bien obligaba a triplicar el CSS de `.hero`
 * dentro de `indice`, `cartaCategorias` y `blogIndice`.
 *
 * ⚠️ **Hoy la nombran DOS recetas, `/menu` y `/blog`.** En `story` la sustituyó `heroPortada` en la
 * entrega 3 (mitad B) y en `story` y `home` la sustituye `heroSlider` desde el rediseño de la
 * plantilla base: ahí el titular viene con las fotos del perfil. Las dos piezas comparten
 * `resolverCta` y el markup del titular, pero no el CSS — cada una es dueña del suyo (§3.5).
 *
 * ## DEUDA CONOCIDA, dicha acá para que no haya que redescubrirla
 *
 * Con ese cambio, **la rama del blok `hero` de esta pieza dejó de ser alcanzable desde los cuatro
 * puntos de entrada**: las dos recetas que la nombran (`menu`, `blog`) pasan `story: null`, así que
 * siempre cae al titular sintetizado. Lo que queda muerto en PROD es la foto del blok, el CTA y su
 * CSS (`.hero-img`, `.cta`, `.cta-lede`), que hoy viajan en el `<style>` de esas dos páginas sin que
 * nada los dibuje.
 *
 * **No se podó en esta entrega a propósito**, y el motivo es el mismo por el que la spec parte el
 * trabajo en tres: podarla obliga a mudar los tests del CTA —incluido el del borde de `LIMITE_CTA`,
 * que nació de una revisión— y eso mezcla dos decisiones en un diff cuyo objetivo es otro. Queda como
 * el trabajo siguiente, con dos salidas posibles: podar la rama y su CSS, o darle un consumidor real
 * (un juego de plantillas cuyo `story` use `hero`). Lo que no puede quedarse es como está.
 *
 * ⚠️ **La deuda creció con el rediseño y sigue sin pagarse**: `home` pasó de `hero` a `heroSlider`, así
 * que la rama muerta viaja ahora en el `<style>` de dos páginas en vez de tres, pero la pieza entera
 * quedó a un paso de la situación que retiró a `carta` y a `heroPortada` —quedarse sin ninguna receta
 * que la nombre—. Si `/menu` y `/blog` estrenaran su propia pieza de titular, `hero` se jubila.
 */
export const hero: Pieza = {
  id: "hero",
  raiz: "p-hero",
  css: `/* Andamio del rediseno: esta pieza todavia no usa la banda ancha, asi que se queda en el
   ancho de lectura. Se quita cuando la seccion se rediseñe. */
.p-hero{max-width:var(--ancho-lectura);margin:0 auto}
.p-hero .hero{padding:48px 0 40px;border-bottom:1px solid #eee}
.p-hero .hero.has-img{padding-top:24px}
.p-hero .hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.p-hero .hero h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-hero .lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
/* La frase del CTA cuando no cabe en un botón. Menos peso que la bajada: es una invitación, no el
   resumen de la página. */
.p-hero .cta-lede{font-size:1.02rem;color:var(--muted);margin:0 0 20px}
.p-hero .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-hero .hero{border-color:#222}}
`,

  render(ctx: CtxPieza): string {
    const body = ctx.story?.content.body;
    const h = body?.find((b): b is HeroBlok => b.component === "hero");
    if (h) {
      const faq = body?.find((b): b is FaqBlok => b.component === "faq");
      // La foto de portada va como banner arriba del título: es lo primero que ve un humano.
      const foto = renderImagen(h.image, "hero-img", ctx.presupuestoImagenes);
      const cta = resolverCta(h.cta_label, ctx, Boolean(faq));
      return envolver(
        "p-hero",
        `<header class="hero${foto ? " has-img" : ""}">
  ${foto}
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${cta.bajada ? `<p class="cta-lede">${esc(cta.bajada)}</p>` : ""}
  ${cta.etiqueta && cta.href ? `<a class="cta" href="${cta.href}">${esc(cta.etiqueta)}</a>` : ""}
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

// ⚠️ `LIMITE_CTA` y `resolverCta` se mudaron a `lib.ts` en la entrega 3: los usan **dos** piezas
// (ésta y la pieza de portada, hoy `heroSlider`), y dos copias del umbral son dos umbrales que se
// separan el día que alguien ajusta uno. La conducta no cambió — el código se movió tal cual y sus
// tests siguen entrando por `hero.render`.
