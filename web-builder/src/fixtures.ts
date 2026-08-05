import type { BusinessProfile, KrBrief, KrProposedPage } from "./types.js";

/**
 * Página propuesta válida (kr.v0.2) para tests; overridable por campo.
 *
 * Desde KR-2a el tipo es el del contrato, que exige tres campos que el esquema de consumo del M1 NO
 * exige (`page_strategy`, `evidencia`, `score_confidence`). Están acá para satisfacer el tipo, con
 * valores COHERENTES con el resto de la fixture —tiene volumen y KD, así que su evidencia es
 * `datos_mercado`—, no para que ningún test dependa de ellos.
 */
export function validPage(over: Partial<KrProposedPage> = {}): KrProposedPage {
  return {
    cluster_id: "c1",
    tipo: "landing_local",
    page_strategy: "single",
    url_slug: "/restaurante-italiano-madrid-centro",
    keyword_principal: "restaurante italiano madrid centro",
    keywords_secundarias: ["pizza napolitana madrid", "pasta fresca madrid"],
    intencion: "local",
    local: true,
    volumen: 1200,
    dificultad: 25,
    evidencia: "datos_mercado",
    opportunity_score: 78,
    score_confidence: 0.9,
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

/**
 * Brief válido con una página; overridable.
 *
 * Los cuatro campos que el M1 **no consume** (`run_id`, `generated_at`, `backlog`, `meta_run`) están
 * acá porque el tipo es ahora el del contrato completo, no porque el M1 los reciba: `consumoM1` los
 * DESCARTA al parsear, así que `parseBrief(validBrief())` sigue devolviendo el mismo subconjunto de
 * siempre. No son datos de una corrida real y ningún test debería leerlos como tales.
 */
export function validBrief(over: Partial<KrBrief> = {}): KrBrief {
  return {
    schema_version: "kr.v0.2",
    run_id: "00000000-0000-0000-0000-000000000001",
    cliente: "restaurante italiano madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    generated_at: "2026-01-01T00:00:00.000Z",
    status: "pending_approval",
    paginas_propuestas: [validPage()],
    backlog: [],
    meta_run: {
      // La principal + las dos secundarias de `validPage()`: el número sale de la fixture, no de una
      // corrida.
      keywords_analizadas: 3,
      paginas_propuestas: 1,
      // `null` y NO `0`: esta fixture nunca corrió un research, así que no conoce su cobertura. Un `0`
      // afirmaría "ninguna keyword tenía volumen", que es un dato distinto de "no se sabe". Ídem
      // `endpoints_degradados`: `[]` afirmaría que ninguno falló. Ver `DataQuality` en el contrato.
      calidad_datos: { cobertura_volumen: null, cobertura_kd: null, endpoints_degradados: null },
      coste_micros_usd: 0,
      coste_breakdown: { dataforseo_micros: 0, llm_generation_micros: 0, llm_embeddings_micros: 0 },
    },
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
