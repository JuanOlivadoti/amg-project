import type { BusinessProfile, KrBrief, KrProposedPage } from "./types.js";

/** Página propuesta válida (kr.v0.2) para tests; overridable por campo. */
export function validPage(over: Partial<KrProposedPage> = {}): KrProposedPage {
  return {
    cluster_id: "c1",
    tipo: "landing_local",
    url_slug: "/restaurante-italiano-madrid-centro",
    keyword_principal: "restaurante italiano madrid centro",
    keywords_secundarias: ["pizza napolitana madrid", "pasta fresca madrid"],
    intencion: "local",
    local: true,
    volumen: 1200,
    dificultad: 25,
    opportunity_score: 78,
    seo: {
      meta_title: "Restaurante Italiano en Madrid Centro",
      meta_description: "Auténtica cocina italiana en el corazón de Madrid.",
      schema_type: "LocalBusiness",
      canonical: "/restaurante-italiano-madrid-centro",
    },
    content_brief: {
      h1: "Restaurante Italiano en Madrid Centro",
      secciones_sugeridas: ["Sobre Nosotros", "Especialidades"],
      word_count_objetivo: 1100,
      enlazado_interno: ["/menu", "/reservas"],
      cta: "Reserva tu mesa",
      tono: "Cercano y profesional",
      claims_permitidos: ["ingredientes frescos"],
      claims_prohibidos: ["el mejor de Madrid"],
    },
    preguntas_frecuentes: ["¿Tienen opciones sin gluten?", "¿Cómo reservo?"],
    approved: false,
    ...over,
  };
}

/** Brief válido con una página; overridable. */
export function validBrief(over: Partial<KrBrief> = {}): KrBrief {
  return {
    schema_version: "kr.v0.2",
    cliente: "restaurante italiano madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    status: "pending_approval",
    paginas_propuestas: [validPage()],
    ...over,
  };
}

export function validProfile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    name: "Trattoria Bella Napoli",
    telephone: "+34 911 23 45 67",
    priceRange: "€€",
    url: "https://trattoriabellanapoli.es",
    image: "https://trattoriabellanapoli.es/img/fachada.jpg",
    address: {
      streetAddress: "Calle Mayor 12",
      addressLocality: "Madrid",
      postalCode: "28013",
      addressRegion: "Madrid",
      addressCountry: "ES",
    },
    opening_hours: "Lun-Dom 13:00-16:00 y 20:00-23:30",
    ...over,
  };
}
