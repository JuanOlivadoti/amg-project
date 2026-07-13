import type {
  BusinessProfile,
  FaqBlok,
  HeroBlok,
  PageContent,
  SchemaType,
  SectionBlok,
  Story,
} from "../types.js";

/**
 * Render AI-search-first (ADR-04): HTML semántico + JSON-LD por tipo de página.
 * Página autocontenida (CSS inline) para previsualizar sin frontend Next.js.
 * En PROD, el render real lo hace Next.js leyendo la story de Storyblok; este preview
 * refleja el MISMO contrato de bloks, así lo que ve el cliente coincide.
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
<style>${CSS}</style>
</head>
<body>
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
  return `<header class="hero">
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${h.cta_label && ctaHref ? `<a class="cta" href="${ctaHref}">${esc(h.cta_label)}</a>` : ""}
</header>`;
}

function renderSection(s: SectionBlok): string {
  const body = s.body
    ? `<p>${esc(s.body)}</p>`
    : `<p class="pending">Contenido pendiente de redacción (generación por LLM — siguiente paso del pipeline).</p>`;
  return `<section>
  <h2>${esc(s.heading)}</h2>
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
:root{--fg:#1a1a1a;--muted:#6b7280;--accent:#b91c1c;--bg:#fff;--soft:#f8f7f5}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:760px;margin:0 auto;padding:0 20px}
.hero{padding:64px 0 40px;border-bottom:1px solid #eee}
.hero h1{font-size:2.2rem;line-height:1.15;margin:0 0 12px}
.lede{font-size:1.15rem;color:var(--muted);margin:0 0 24px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
section{padding:32px 0;border-bottom:1px solid #f0f0f0}
section h2{font-size:1.4rem;margin:0 0 12px}
.pending{color:var(--muted);font-style:italic}
.faq{background:var(--soft);border-radius:12px;padding:24px;margin:32px 0}
details{padding:12px 0;border-bottom:1px solid #e7e5e0}
summary{font-weight:600;cursor:pointer}
footer{max-width:760px;margin:24px auto 48px;padding:0 20px;color:var(--muted);font-size:.85rem}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--muted:#9aa0aa;--bg:#111;--soft:#1b1b1b}body{background:var(--bg)}.hero{border-color:#222}section{border-color:#1e1e1e}}
`;
