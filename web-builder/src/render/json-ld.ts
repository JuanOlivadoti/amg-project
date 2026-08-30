import type {
  BusinessProfile,
  FaqBlok,
  MenuItem,
  PageContent,
  PostalAddress,
  SchemaType,
} from "../types.js";
import { imagenPublicable } from "./imagenes.js";
import { localesDe, preciosDe, safeJson } from "./lib.js";

/**
 * El JSON-LD y la traza de research.
 *
 * **No se movió a las piezas y no debe moverse**: es una propiedad del *documento*, no de un
 * fragmento visual. Las piezas producen HTML y nada más — si el `LocalBusiness` viviera dentro de una
 * pieza, una receta que no la incluyera dejaría la página sin datos estructurados sin que nada
 * avisara, que es exactamente la clase de pérdida silenciosa que este proyecto persigue.
 */

/** JSON-LD: tipo primario + FAQPage cuando hay FAQs, unidos en un @graph. */
export function jsonLd(c: PageContent, url: string, profile?: BusinessProfile | null): unknown {
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
    // `locations` MANDA (spec): sin address/telephone de nivel superior (el caso real, un perfil
    // multi-local sin campos clásicos), el primer local los provee. Los locales adicionales no
    // entran al @graph primario — alcanza con que el primero no se pierda. Y si el perfil trae
    // AMBOS (un `telephone` clásico viejo Y `locations` con uno distinto), gana `locations`: por
    // eso `principal` va primero en el `??`, no `profile`.
    const principal = localesDe(profile)[0];
    const telephone = principal?.telephone ?? profile.telephone;
    const address = principal?.address ?? profile.address;
    if (telephone) entity.telephone = telephone;
    if (profile.priceRange) entity.priceRange = profile.priceRange;
    const imagen = imagenPublicable(profile.image);
    if (imagen) entity.image = imagen;
    if (address) entity.address = postalAddressLd(address);
  }
  return entity;
}

/** JSON-LD de la home: LocalBusiness con NAP si hay perfil; si no, un WebSite mínimo. */
export function homeLd(profile: BusinessProfile | null | undefined, url: string): unknown {
  if (!profile) {
    return { "@context": "https://schema.org", "@type": "WebSite", url };
  }
  const entity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: profile.name,
    url,
  };
  // Mismo fallback que `primaryEntity`: sin address/telephone de nivel superior, el primer local
  // (vía `localesDe`) los provee — `locations` MANDA para el JSON-LD (spec). Por eso el primer
  // operando es `principal`, no `profile`: si un perfil trae AMBOS, gana el local.
  const principal = localesDe(profile)[0];
  const telephone = principal?.telephone ?? profile.telephone;
  const address = principal?.address ?? profile.address;
  if (telephone) entity.telephone = telephone;
  if (profile.priceRange) entity.priceRange = profile.priceRange;
  const imagen = imagenPublicable(profile.image);
  if (imagen) entity.image = imagen;
  if (address) entity.address = postalAddressLd(address);
  return entity;
}

/** JSON-LD de la carta: `Menu` con una `MenuSection` por categoría. */
export function menuLd(
  profile: BusinessProfile,
  url: string,
  grupos: Array<{ categoria: string | null; items: MenuItem[] }>,
): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    url,
    name: `Menú · ${profile.name}`,
    hasMenuSection: grupos.map((g) => ({
      "@type": "MenuSection",
      ...(g.categoria ? { name: g.categoria } : {}),
      hasMenuItem: g.items.map((it) => {
        // ⚠️ **`offers` toma el PRIMERO de `precios`**, y está decidido acá con su test para que no lo
        // decida por accidente el orden de un `Object.keys` (enmienda 2026-08-02). `schema.org` admite
        // varias `Offer`, pero un plato con "Media" y "Ración" no son dos ofertas comerciales
        // distintas: es el mismo plato en dos tamaños, y declararlas como dos ofertas le diría a Google
        // que hay dos productos. El primero es el que el cliente puso primero.
        //
        // Antes esto leía `it.price` a secas, así que un plato **solo** con `precios` —la forma nueva—
        // salía al JSON-LD sin ningún precio: se perdía en silencio justo el dato que la enmienda
        // añadió. Es texto libre en los dos casos: va tal cual, sin inventar moneda ni parsear.
        const precio = preciosDe(it)[0]?.importe;
        return {
          "@type": "MenuItem",
          name: it.name,
          ...(it.description ? { description: it.description } : {}),
          ...(precio ? { offers: { "@type": "Offer", price: precio } } : {}),
        };
      }),
    })),
  };
}

/** JSON-LD del catálogo para verticales sin un tipo schema.org específico (seguros: no hay `Menu` ni
 *  `Product` correcto para una lista de pólizas — `Product` implicaría venta directa de un bien).
 *  `ItemList` es el genérico correcto para una lista de ofertas. */
export function catalogoLd(
  profile: BusinessProfile,
  url: string,
  grupos: Array<{ categoria: string | null; items: MenuItem[] }>,
  // Sin `vertical`: quien la llama (renderCatalogo) ya decidió por vertical si usa esta función o
  // menuLd — no hace falta que catalogoLd vuelva a mirarlo.
): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    url,
    name: `${profile.name} — catálogo`,
    itemListElement: grupos.flatMap((g) =>
      g.items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
      })),
    ),
  };
}

/** El PostalAddress de schema.org. Compartido por la página (LocalBusiness) y la home. */
export function postalAddressLd(address: PostalAddress): Record<string, unknown> {
  return {
    "@type": "PostalAddress",
    streetAddress: address.streetAddress,
    addressLocality: address.addressLocality,
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.addressRegion ? { addressRegion: address.addressRegion } : {}),
    ...(address.addressCountry ? { addressCountry: address.addressCountry } : {}),
  };
}

/**
 * Trazabilidad hacia el research como <script type="application/json"> (machine-readable).
 * Antes iba en un comentario HTML, donde datos no confiables (keyword) podían inyectar `-->`.
 * Un bloque script con serialización segura evita ese vector.
 */
export function researchTrace(c: PageContent): string {
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
