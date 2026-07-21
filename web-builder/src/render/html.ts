import type {
  BrandTheme,
  BusinessProfile,
  FaqBlok,
  HeroBlok,
  Imagen,
  PageContent,
  SchemaType,
  SectionBlok,
  Story,
} from "../types.js";

/**
 * Render AI-search-first (ADR-04): HTML semántico + JSON-LD por tipo de página.
 * Página autocontenida (CSS inline, sin dependencias externas).
 *
 * OJO — quién sirve esto en producción está SIN DECIDIR (OBS-03). ADR-16 quitó Next del
 * stack, así que este render dejó de ser "un preview de lo que hará Next" y es, de hecho,
 * el único renderizador que existe. Falta el paso que lo publique en un dominio y lo
 * regenere cuando alguien edite en Storyblok.
 *
 * `profile` (opcional): datos NAP del negocio → enriquecen JSON-LD y agregan contacto.
 */
export function renderStory(
  story: Story,
  profile?: BusinessProfile | null,
  languageCode = "es",
): string {
  const c = story.content;
  const lang = esc(languageCode);
  const url = resolveCanonical(c.seo.canonical, profile);
  const hero = c.body.find((b): b is HeroBlok => b.component === "hero");
  const sections = c.body.filter((b): b is SectionBlok => b.component === "section");
  const faq = c.body.find((b): b is FaqBlok => b.component === "faq");
  // Destino del CTA: contacto si hay perfil, si no las FAQs; si no hay ninguno, sin ancla.
  const ctaHref = profile ? "#contacto" : faq ? "#faq" : null;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.seo.title)}</title>
<meta name="description" content="${esc(c.seo.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(c.seo.og_title)}">
<meta property="og:description" content="${esc(c.seo.og_description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
${profile?.image ? `<meta property="og:image" content="${esc(profile.image)}">` : ""}
<script type="application/ld+json">
${safeJson(jsonLd(c, url, profile))}
</script>
${researchTrace(c)}
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile)}
<main>
${hero ? renderHero(hero, ctaHref) : ""}
${sections.map(renderSection).join("\n")}
${faq ? renderFaq(faq) : ""}
${profile ? renderContact(profile) : ""}
</main>
<footer><p>Página generada por AMG OS · contrato ${esc(c.meta.contract_version)} · schema ${esc(c.schema_type)}</p></footer>
</body>
</html>`;
}

/** Familias tipográficas seguras, por nombre. La marca elige un nombre, NUNCA escribe el stack. */
const FONT_STACKS: Record<NonNullable<BrandTheme["font"]>, string> = {
  sistema: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  moderna: "'Helvetica Neue',Arial,sans-serif",
};

/**
 * Traduce el tema de marca a CSS, **revalidando cada valor** aunque ya lo haya validado Zod: en PROD
 * el perfil puede venir de Storyblok sin pasar por `parseProfile`, así que el renderizador no confía.
 * Lo que no valida, lo descarta → cae al default. Un color inválido no rompe la página, la deja sobria.
 */
function themeCss(brand?: BrandTheme | null): string {
  if (!brand) return "";
  const reglas: string[] = [];

  if (typeof brand.color === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brand.color)) {
    reglas.push(`--accent:${brand.color}`);
  }
  if (brand.font && brand.font in FONT_STACKS) {
    reglas.push(`--font:${FONT_STACKS[brand.font]}`);
  }
  return reglas.length ? `\n:root{${reglas.join(";")}}` : "";
}

/** Cabecera del sitio: logo + nombre. Es lo que hace que la página se sienta DE alguien. */
function renderSiteHeader(profile?: BusinessProfile | null): string {
  if (!profile) return "";
  // El logo va a un `<img src>`: se exige http(s) acá también, no solo en Zod (en PROD el perfil
  // puede venir de Storyblok sin validar). Un logo dudoso cae al nombre, no rompe la cabecera.
  const logo = profile.brand?.logo;
  const logoOk = typeof logo === "string" && /^https?:\/\//i.test(logo);
  const marca = logoOk
    ? `<img class="logo" src="${esc(logo)}" alt="${esc(profile.name)}" height="40">`
    : `<span class="marca">${esc(profile.name)}</span>`;
  return `<header class="sitebar"><a href="/" class="brand">${marca}</a></header>`;
}

/**
 * Una `<img>` de contenido, lista para Core Web Vitals: `loading="lazy"`, `decoding="async"`, y
 * `width`/`height` cuando se pueden inferir del asset de Storyblok (evita el salto de layout, CLS).
 * Sin src válido no se renderiza nada — una imagen rota es peor que ninguna.
 */
function renderImagen(img: Imagen | undefined, clase: string): string {
  if (!img || typeof img.src !== "string" || !/^https?:\/\//i.test(img.src)) return "";
  const dim = dimsDeStoryblok(img.src);
  const wh = dim ? ` width="${dim.w}" height="${dim.h}"` : "";
  return `<img class="${clase}" src="${esc(img.src)}" alt="${esc(img.alt ?? "")}" loading="lazy" decoding="async"${wh}>`;
}

/**
 * Las URLs de assets de Storyblok llevan las dimensiones en la ruta: `.../f/<space>/1200x800/<hash>/…`.
 * Extraerlas deja fijar `width`/`height` sin descargar la imagen. Si no matchea, se omite (mejor sin
 * dimensiones que con dimensiones inventadas).
 */
function dimsDeStoryblok(src: string): { w: number; h: number } | null {
  const m = src.match(/\/(\d{1,5})x(\d{1,5})\//);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Resuelve el canonical: una sola fuente de verdad = el `canonical` del brief (#16 review Codex).
 * Antes se re-derivaba de `story.slug` ignorando el canonical aprobado. Reglas:
 *  - si el canonical ya es absoluto (http/https), se respeta tal cual;
 *  - si es una ruta, se resuelve contra el dominio del perfil (validado por Zod);
 *  - sin dominio, queda relativo (el frontend Next.js le antepondrá su base en PROD).
 */
function resolveCanonical(canonical: string, profile?: BusinessProfile | null): string {
  if (/^https?:\/\//i.test(canonical)) return canonical;
  const path = canonical.startsWith("/") ? canonical : `/${canonical}`;
  if (profile?.url) return `${profile.url.replace(/\/+$/, "")}${path}`;
  return path;
}

function renderContact(p: BusinessProfile): string {
  const addr = p.address
    ? `${esc(p.address.streetAddress)}, ${esc(p.address.postalCode)} ${esc(p.address.addressLocality)}`
    : "";
  return `<section class="contacto" id="contacto">
  <h2>Contacto</h2>
  <p><strong>${esc(p.name)}</strong></p>
  ${addr ? `<p>${addr}</p>` : ""}
  ${p.telephone ? `<p>Tel: <a href="tel:${esc(p.telephone.replace(/\s/g, ""))}">${esc(p.telephone)}</a></p>` : ""}
  ${p.opening_hours ? `<p>Horario: ${esc(p.opening_hours)}</p>` : ""}
</section>`;
}

function renderHero(h: HeroBlok, ctaHref: string | null): string {
  // La foto de portada va como banner arriba del título: es lo primero que ve un humano.
  const foto = renderImagen(h.image, "hero-img");
  return `<header class="hero${foto ? " has-img" : ""}">
  ${foto}
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${h.cta_label && ctaHref ? `<a class="cta" href="${ctaHref}">${esc(h.cta_label)}</a>` : ""}
</header>`;
}

function renderSection(s: SectionBlok): string {
  const body = s.body
    ? `<p>${esc(s.body)}</p>`
    : `<p class="pending">Contenido pendiente de redacción (generación por LLM — siguiente paso del pipeline).</p>`;
  const foto = renderImagen(s.image, "section-img");
  return `<section${foto ? " class=\"has-img\"" : ""}>
  <h2>${esc(s.heading)}</h2>
  ${foto}
  ${body}
</section>`;
}

function renderFaq(f: FaqBlok): string {
  const items = f.items
    .map(
      (it) => `  <details>
    <summary>${esc(it.question)}</summary>
    <p>${it.answer ? esc(it.answer) : `<span class="pending">Respuesta pendiente de redacción.</span>`}</p>
  </details>`,
    )
    .join("\n");
  return `<section class="faq" id="faq">
  <h2>Preguntas frecuentes</h2>
${items}
</section>`;
}

/** JSON-LD: tipo primario + FAQPage cuando hay FAQs, unidos en un @graph. */
function jsonLd(c: PageContent, url: string, profile?: BusinessProfile | null): unknown {
  const graph: unknown[] = [primaryEntity(c, url, profile)];
  const faq = c.body.find((b): b is FaqBlok => b.component === "faq");
  if (faq && faq.items.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.items.map((it) => ({
        "@type": "Question",
        name: it.question,
        acceptedAnswer: { "@type": "Answer", text: it.answer || it.question },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function primaryEntity(c: PageContent, url: string, profile?: BusinessProfile | null): unknown {
  if (c.schema_type === "Article") {
    return { "@type": "Article", headline: c.seo.title, description: c.seo.description, url };
  }
  const type: Record<SchemaType, string> = {
    LocalBusiness: "LocalBusiness",
    Article: "Article",
    FAQPage: "WebPage", // el FAQPage va en el graph aparte; el primario cae a WebPage
    WebPage: "WebPage",
  };
  const entity: Record<string, unknown> = {
    "@type": type[c.schema_type],
    url,
    name: profile?.name ?? c.seo.title,
    description: c.seo.description,
  };

  // Enriquecimiento con datos NAP del negocio (cierra los warnings de LocalBusiness).
  if (c.schema_type === "LocalBusiness" && profile) {
    if (profile.telephone) entity.telephone = profile.telephone;
    if (profile.priceRange) entity.priceRange = profile.priceRange;
    if (profile.image) entity.image = profile.image;
    if (profile.address) {
      entity.address = {
        "@type": "PostalAddress",
        streetAddress: profile.address.streetAddress,
        addressLocality: profile.address.addressLocality,
        postalCode: profile.address.postalCode,
        ...(profile.address.addressRegion ? { addressRegion: profile.address.addressRegion } : {}),
        ...(profile.address.addressCountry ? { addressCountry: profile.address.addressCountry } : {}),
      };
    }
  }
  return entity;
}

/**
 * Trazabilidad hacia el research como <script type="application/json"> (machine-readable).
 * Antes iba en un comentario HTML, donde datos no confiables (keyword) podían inyectar `-->`.
 * Un bloque script con serialización segura evita ese vector.
 */
function researchTrace(c: PageContent): string {
  const t = {
    source_keyword: c.meta.source_keyword,
    intent: c.intent,
    is_local: c.is_local,
    page_type: c.page_type,
    opportunity_score: c.meta.opportunity_score,
    volumen: c.meta.volumen,
    dificultad: c.meta.dificultad,
    evidencia: c.meta.evidencia,
    score_confidence: c.meta.score_confidence,
    word_count_objetivo: c.meta.word_count_objetivo,
  };
  return `<script type="application/json" id="research-trace">\n${safeJson(t)}\n</script>`;
}

/**
 * Serializa a JSON seguro para incrustar en <script>: neutraliza `<`, `>`, `&`, que
 * `JSON.stringify` NO escapa y que permitirían cerrar el <script> (`</script>`) e
 * inyectar markup. El JSON resultante sigue siendo válido (usa escapes \\uXXXX).
 */
function safeJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
:root{--fg:#1a1a1a;--muted:#6b7280;--accent:#b91c1c;--bg:#fff;--soft:#f8f7f5;--font:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 var(--font);color:var(--fg);background:var(--bg)}
img{max-width:100%;height:auto}
.sitebar{border-bottom:1px solid #eee;padding:14px 20px}
.sitebar .brand{display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)}
.sitebar .marca{font-weight:700;font-size:1.15rem;letter-spacing:-.01em}
.sitebar .logo{display:block}
main{max-width:760px;margin:0 auto;padding:0 20px}
.hero{padding:48px 0 40px;border-bottom:1px solid #eee}
.hero.has-img{padding-top:24px}
.hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.hero h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em}
.lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
section{padding:32px 0;border-bottom:1px solid #f0f0f0}
section h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em}
.section-img{width:100%;border-radius:12px;margin:0 0 18px;object-fit:cover;aspect-ratio:3/2}
.pending{color:var(--muted);font-style:italic}
.faq{background:var(--soft);border-radius:12px;padding:24px;margin:32px 0}
details{padding:12px 0;border-bottom:1px solid #e7e5e0}
summary{font-weight:600;cursor:pointer}
footer{max-width:760px;margin:24px auto 48px;padding:0 20px;color:var(--muted);font-size:.85rem}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--muted:#9aa0aa;--bg:#111;--soft:#1b1b1b}body{background:var(--bg)}.sitebar,.hero{border-color:#222}section{border-color:#1e1e1e}}
`;
