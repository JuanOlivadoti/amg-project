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
 * ahí, pero `renderHome`/`renderCatalogo`/`renderBlogIndex` emiten su propio `<header class="hero">`:
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
 * ## El rediseño: un CABEZAL de página, no una portada
 *
 * Las dos páginas que la usan son interiores (`/menu`, `/blog`), y en la referencia una página
 * interior no abre con el hero de la home sino con una **banda corta con fondo** que dice dónde
 * estás. Eso es lo que dibuja ahora: `.seccion.alt` con el titular centrado y su bajada, con el
 * padding recortado a propósito —los 120 px de `--pad-seccion` empujarían la primera categoría de la
 * carta fuera de la pantalla, y `/menu` existe para leer la carta—.
 *
 * No tiene `cssOscuro`, y es una respuesta y no un olvido: el `border-bottom:#eee` que lo necesitaba
 * ya no existe, y ningún valor de la pieza es hoy un color literal.
 *
 * ⚠️ **La deuda creció con el rediseño y sigue sin pagarse**: `home` pasó de `hero` a `heroSlider`, así
 * que la rama muerta viaja ahora en el `<style>` de dos páginas en vez de tres, pero la pieza entera
 * quedó a un paso de la situación que retiró a `carta` y a `heroPortada` —quedarse sin ninguna receta
 * que la nombre—. Si `/menu` y `/blog` estrenaran su propia pieza de titular, `hero` se jubila.
 */
export const hero: Pieza = {
  id: "hero",
  raiz: "p-hero",
  // El cabezal es una franja con fondo (`.seccion.alt`) y NO la portada del sitio: en la referencia,
  // las páginas interiores abren con una banda corta que dice dónde estás, no con el hero de la home.
  // Por eso el `padding` propio pisa al de `.seccion`: 120 px de aire arriba de la carta empujan la
  // primera categoría fuera de la pantalla, y `/menu` existe para leer la carta.
  css: `.p-hero .hero{padding:clamp(40px,5vw,72px) 0}
.p-hero .cabeza{text-align:center;max-width:var(--ancho-lectura);margin:0 auto}
/* Mismo escalado que el titular de la portada, un punto más bajo: es la misma familia de titular y
   tiene que leerse como parte del mismo sitio. SIN 'font-weight' — se precarga un solo archivo (700),
   que es el que un h1 hereda; declarar otro peso convierte el preload en una descarga tirada. */
.p-hero .cabeza h1{font-family:var(--fuente-titulo);font-size:clamp(2.1rem,1.2rem + 3.2vw,3.75rem);line-height:1.15;text-transform:uppercase;margin:0;color:var(--titulo);letter-spacing:-.01em}
.p-hero .lede{font-size:1.15rem;line-height:1.7;color:var(--muted);margin:16px auto 0;max-width:60ch}
/* La foto y el CTA son de la rama del blok \`hero\`, que hoy ninguna receta alcanza (ver la DEUDA
   CONOCIDA de arriba): se conservan porque la rama se conserva, no porque se dibujen en producción. */
.p-hero .hero-img{width:100%;max-width:var(--ancho-pagina);border-radius:14px;margin:0 auto 28px;object-fit:cover;aspect-ratio:16/9;display:block}
.p-hero .cta-lede{font-size:1.02rem;color:var(--muted);margin:16px auto 0;max-width:60ch}
.p-hero .cta{display:inline-block;margin:24px 0 0;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:15px 40px;border-radius:5px;font-family:var(--fuente-titulo);font-size:1rem;font-weight:500;text-transform:uppercase;letter-spacing:.02em}
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
        `<header class="hero seccion alt${foto ? " has-img" : ""}"><div class="banda">
  ${foto}
  <div class="cabeza">
    <h1>${esc(h.headline)}</h1>
    ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
    ${cta.bajada ? `<p class="cta-lede">${esc(cta.bajada)}</p>` : ""}
    ${cta.etiqueta && cta.href ? `<a class="cta" href="${cta.href}">${esc(cta.etiqueta)}</a>` : ""}
  </div>
</div></header>`,
      );
    }

    if (ctx.titulo) {
      return envolver(
        "p-hero",
        `<header class="hero seccion alt"><div class="banda">
  <div class="cabeza">
    <h1>${esc(ctx.titulo)}</h1>
    ${ctx.bajada ? `<p class="lede">${esc(ctx.bajada)}</p>` : ""}
  </div>
</div></header>`,
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
