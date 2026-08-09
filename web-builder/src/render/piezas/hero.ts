import type { FaqBlok, HeroBlok } from "../../types.js";
import { envolver, esc, hayUbicaciones, localesDe, renderImagen } from "../lib.js";
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
 * (`profile.portada`) y `barraDatos` son la mitad B de la entrega 3.
 */
export const hero: Pieza = {
  id: "hero",
  raiz: "p-hero",
  css: `.p-hero .hero{padding:48px 0 40px;border-bottom:1px solid #eee}
.p-hero .hero.has-img{padding-top:24px}
.p-hero .hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.p-hero .hero h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-hero .lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
/* La frase del CTA cuando no cabe en un botón. Menos peso que la bajada: es una invitación, no el
   resumen de la página. */
.p-hero .cta-lede{font-size:1.02rem;color:var(--muted);margin:0 0 20px}
.p-hero .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
@media(prefers-color-scheme:dark){.p-hero .hero{border-color:#222}}
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

/**
 * **Cuántos caracteres entran en un botón.**
 *
 * Es un default de PRODUCCIÓN y por eso vive acá con su nombre y sus tests, no incrustado en un `if`:
 * a 28 caracteres el botón sigue cabiendo en una línea en un móvil de 360 px con el padding de
 * `.p-hero .cta`. Bajarlo o subirlo es una decisión de diseño que tiene que doler en un test.
 */
const LIMITE_CTA = 28;

interface CtaResuelto {
  /** La frase larga, degradada a bajada. `""` si el CTA cabía en el botón. */
  bajada: string;
  /** Lo que dice el botón. `""` si no hay CTA. */
  etiqueta: string;
  /** Adónde lleva. `null` cuando no hay ningún destino y entonces no se dibuja el botón. */
  href: string | null;
}

/**
 * El CTA del hero, resuelto **en el render y no en el contrato del brief**.
 *
 * El M2 escribe `cta_label` sin saber con qué ancho se va a dibujar, y a veces escribe una frase
 * ("Reserva tu mesa y disfruta de la auténtica cocina italiana"): dentro de un botón se desborda o se
 * parte en tres líneas. Arreglarlo en `kr-service` sería pedirle al research que decida tipografía.
 *
 * Cuando no cabe, **el texto no se pierde**: baja a bajada y el botón toma una etiqueta derivada del
 * dato que la página realmente tiene. "Llamar" en una ficha sin teléfono sería una promesa que la
 * página no puede cumplir, así que cada etiqueta va con el ancla donde ese dato vive.
 */
function resolverCta(label: string | undefined, ctx: CtxPieza, hayFaq: boolean): CtaResuelto {
  const vacio: CtaResuelto = { bajada: "", etiqueta: "", href: null };
  if (!label) return vacio;

  // Destino por defecto: contacto si hay perfil, si no las FAQs; si no hay ninguno, sin ancla.
  const hrefBase = ctx.profile ? "#contacto" : hayFaq ? "#faq" : null;
  if (label.length <= LIMITE_CTA) return { bajada: "", etiqueta: label, href: hrefBase };

  const profile = ctx.profile;
  if (profile) {
    // Mismo orden de precedencia que `contacto`/JSON-LD: manda `locations`, después el campo suelto.
    const tel = localesDe(profile)[0]?.telephone ?? profile.telephone;
    if (tel) return { bajada: label, etiqueta: "Llamar", href: "#contacto" };
    // "Cómo llegar" apunta a `#ubicaciones`, que existe exactamente cuando `hayUbicaciones` es cierto
    // — el mismo dato decide la etiqueta y que el ancla esté dibujada. Nunca un enlace a la nada.
    if (hayUbicaciones(profile)) return { bajada: label, etiqueta: "Cómo llegar", href: "#ubicaciones" };
    return { bajada: label, etiqueta: "Contactar", href: "#contacto" };
  }
  // Sin perfil no hay dato del que derivar nada; queda el ancla a las FAQ, si las hay.
  return hrefBase
    ? { bajada: label, etiqueta: "Saber más", href: hrefBase }
    : { bajada: label, etiqueta: "", href: null };
}
