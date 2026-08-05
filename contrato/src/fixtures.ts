// Fixtures del contrato, compartidos entre los tests del paquete.
//
// NO es un `.test.ts` a propósito: importar un módulo de test desde otro test hace que `node:test`
// descubra sus casos DOS veces (una por cada importador), y un test que corre dos veces con el mismo
// nombre confunde cualquier conteo posterior.
import type { KeywordResearchBrief } from "./index.js";

/** Brief válido de EMISIÓN (lo que el M2 produce hoy, kr.v0.5). Overridable por campo. */
export function briefM2(over: Partial<KeywordResearchBrief> = {}): KeywordResearchBrief {
  return {
    schema_version: "kr.v0.5",
    run_id: "11111111-1111-1111-1111-111111111111",
    cliente: "La Birra Bar",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    generated_at: "2026-07-30T12:00:00.000Z",
    status: "pending_approval",
    paginas_propuestas: [
      {
        cluster_id: "c1",
        tipo: "landing_local",
        page_strategy: "single",
        url_slug: "/hamburgueseria-madrid-centro",
        keyword_principal: "hamburgueseria madrid centro",
        keywords_secundarias: ["hamburguesa de autor madrid"],
        intencion: "local",
        local: true,
        volumen: 1200,
        dificultad: 25,
        evidencia: "datos_mercado",
        opportunity_score: 78,
        score_confidence: 0.9,
        seo: {
          meta_title: "Hamburguesería en Madrid Centro",
          meta_description: "Hamburguesas de autor en el centro de Madrid.",
          schema_type: "LocalBusiness",
          canonical: "/hamburgueseria-madrid-centro",
        },
        content_brief: {
          h1: "Hamburguesería en Madrid Centro",
          secciones_sugeridas: ["La carta", "Los locales"],
          word_count_objetivo: 1100,
          enlazado_interno: ["/menu"],
        },
        preguntas_frecuentes: ["¿Hacen reservas?"],
        approved: false,
      },
    ],
    backlog: [{ keyword_principal: "cerveza artesanal madrid", opportunity_score: 41 }],
    meta_run: {
      keywords_analizadas: 55,
      paginas_propuestas: 1,
      calidad_datos: { cobertura_volumen: 0.57, cobertura_kd: 0.31, endpoints_degradados: [] },
      coste_micros_usd: 309_700,
      coste_breakdown: {
        dataforseo_micros: 252_200,
        llm_generation_micros: 57_500,
        llm_embeddings_micros: 0,
      },
    },
    ...over,
  };
}

/**
 * Brief válido de CONSUMO: la forma mínima que el M1 acepta. Es el `validBrief()` que vivía en
 * `web-builder/src/fixtures.ts`, y NO trae `run_id`, `generated_at`, `backlog`, `meta_run` ni
 * `page_strategy`. Que esto valide `consumoM1` y NO valide `emisionM2` es el diseño, no un fallo.
 *
 * No está tipado como `KeywordResearchBrief` a propósito: no lo es — le faltan campos obligatorios.
 */
export function briefM1(over: Record<string, unknown> = {}) {
  return {
    schema_version: "kr.v0.2",
    cliente: "restaurante italiano madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    status: "pending_approval",
    paginas_propuestas: [
      {
        cluster_id: "c1",
        tipo: "landing_local",
        url_slug: "/restaurante-italiano-madrid-centro",
        keyword_principal: "restaurante italiano madrid centro",
        keywords_secundarias: ["pizza napolitana madrid"],
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
          secciones_sugeridas: ["Sobre Nosotros"],
          word_count_objetivo: 1100,
          enlazado_interno: ["/menu"],
        },
        preguntas_frecuentes: ["¿Tienen opciones sin gluten?"],
        approved: false,
      },
    ],
    ...over,
  };
}
