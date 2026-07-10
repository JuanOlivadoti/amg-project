import OpenAI from "openai";
import { config } from "../config.js";
import { tokenize } from "./mock.js";
import type { Market, PageType, SearchIntent } from "../types.js";

export interface PageContentInput {
  keyword_principal: string;
  keywords_secundarias: string[];
  intent: SearchIntent;
  is_local: boolean;
  page_type: PageType;
  businessPrompt: string;
  market: Market;
}

export interface PageContentResult {
  meta_title: string;
  meta_description: string;
  h1: string;
  secciones_sugeridas: string[];
  word_count_objetivo: number;
  faqs: string[];
  cta: string;
  tono: string;
  claims_permitidos: string[];
  claims_prohibidos: string[];
}

export interface ContentGen {
  /** Relevancia de cada keyword respecto al negocio (0..1). Alimenta el gate del scoring. */
  businessRelevance(businessPrompt: string, keywords: string[]): Promise<Map<string, number>>;
  /** Contenido SEO on-page de una página propuesta. */
  pageContent(input: PageContentInput): Promise<PageContentResult>;
}

/** Elige el generador de contenido: OpenAI si es el proveedor activo; si no, mock. */
export function getContentGen(): ContentGen {
  return config.llm.provider === "openai" && config.openai.hasKey
    ? new OpenAIContentGen()
    : new MockContentGen();
}

// ---------------------------------------------------------------- OpenAI
class OpenAIContentGen implements ContentGen {
  private client = new OpenAI({ apiKey: config.openai.apiKey });

  async businessRelevance(businessPrompt: string, keywords: string[]): Promise<Map<string, number>> {
    const res = await this.client.chat.completions.create({
      model: config.openai.generationModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Sos experto SEO. Para cada keyword, evaluá su relevancia (0..1) para el negocio " +
            "descrito (1 = muy relevante para captar clientes de ese negocio; 0 = irrelevante). " +
            'Devolvé SOLO JSON: {"scores":[{"keyword":string,"relevance":number}]}',
        },
        { role: "user", content: `Negocio: ${businessPrompt}\nKeywords:\n${keywords.join("\n")}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
      scores?: Array<{ keyword: string; relevance: number }>;
    };
    const map = new Map<string, number>();
    for (const s of parsed.scores ?? []) map.set(s.keyword, clamp01(s.relevance));
    return map;
  }

  async pageContent(input: PageContentInput): Promise<PageContentResult> {
    const res = await this.client.chat.completions.create({
      model: config.openai.generationModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Sos redactor SEO experto y cuidadoso con lo legal (sectores regulados: salud, " +
            "gastronomía). Generás contenido on-page en el idioma del mercado. NO prometas " +
            "resultados garantizados ni hagas claims médicos/legales indebidos. Devolvé SOLO JSON " +
            "con las claves: meta_title, meta_description, h1, secciones_sugeridas (array), " +
            "word_count_objetivo (número), faqs (array de preguntas), cta, tono, " +
            "claims_permitidos (array), claims_prohibidos (array).",
        },
        {
          role: "user",
          content:
            `Negocio: ${input.businessPrompt}\nIdioma: ${input.market.language_code}\n` +
            `Tipo de página: ${input.page_type}\nIntención: ${input.intent}${input.is_local ? " (local)" : ""}\n` +
            `Keyword principal: ${input.keyword_principal}\n` +
            `Keywords secundarias: ${input.keywords_secundarias.join(", ")}`,
        },
      ],
    });
    const p = JSON.parse(res.choices[0]?.message.content ?? "{}") as Partial<PageContentResult>;
    return normalizeContent(p, input);
  }
}

// ---------------------------------------------------------------- Mock
class MockContentGen implements ContentGen {
  async businessRelevance(businessPrompt: string, keywords: string[]): Promise<Map<string, number>> {
    const bag = new Set(tokenize(businessPrompt));
    const map = new Map<string, number>();
    for (const kw of keywords) {
      const toks = tokenize(kw);
      const hits = toks.filter((t) => bag.has(t)).length;
      map.set(kw, clamp01(0.45 + 0.18 * hits)); // más solape con el negocio → más relevante
    }
    return map;
  }

  async pageContent(input: PageContentInput): Promise<PageContentResult> {
    return normalizeContent({}, input);
  }
}

// ---------------------------------------------------------------- helpers
function normalizeContent(p: Partial<PageContentResult>, input: PageContentInput): PageContentResult {
  const kw = input.keyword_principal;
  const cap = kw.charAt(0).toUpperCase() + kw.slice(1);
  return {
    meta_title: p.meta_title ?? cap,
    meta_description: p.meta_description ?? `Información y servicios sobre ${kw}.`,
    h1: p.h1 ?? cap,
    secciones_sugeridas:
      p.secciones_sugeridas ?? (input.page_type === "blog"
        ? ["Introducción", "Desarrollo", "Preguntas frecuentes"]
        : ["Servicio", "Beneficios", "Precios", "Contacto"]),
    word_count_objetivo: p.word_count_objetivo ?? (input.page_type === "blog" ? 900 : 1100),
    faqs: p.faqs ?? [],
    cta: p.cta ?? "Contáctanos",
    tono: p.tono ?? "Profesional y cercano",
    claims_permitidos: p.claims_permitidos ?? [],
    claims_prohibidos: p.claims_prohibidos ?? [],
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
