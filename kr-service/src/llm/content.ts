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

/** Intención + señal local de una keyword, inferidas por LLM. */
export interface IntentResult {
  intent: SearchIntent;
  is_local: boolean;
}

export interface ContentGen {
  /** Relevancia de cada keyword respecto al negocio (0..1). Alimenta el gate del scoring. */
  businessRelevance(businessPrompt: string, keywords: string[]): Promise<Map<string, number>>;
  /**
   * Clasifica intención + señal local de cada keyword en el contexto del negocio.
   * Batch (1 sola llamada). Las keywords que no vuelvan quedan para el fallback heurístico.
   */
  classifyIntents(
    businessPrompt: string,
    keywords: string[],
    market: Market,
  ): Promise<Map<string, IntentResult>>;
  /** Contenido SEO on-page de una página propuesta. */
  pageContent(input: PageContentInput): Promise<PageContentResult>;
}

let warnedDegraded = false;

/** Elige el generador de contenido: OpenAI si es el proveedor activo; si no, mock. */
export function getContentGen(): ContentGen {
  if (config.llm.provider === "openai" && config.openai.hasKey) {
    return new OpenAIContentGen();
  }
  // Fuga de abstracción (#6 review Codex): ContentGen NO tiene implementación Anthropic todavía.
  // Con LLM_PROVIDER=anthropic, intención/relevancia/contenido caen a MOCK. Avisar fuerte para
  // que nadie crea que corre con Anthropic. TODO (Fase 2): implementar AnthropicContentGen.
  if (config.llm.provider === "anthropic" && !warnedDegraded) {
    warnedDegraded = true;
    console.warn(
      "  [llm] AVISO: LLM_PROVIDER=anthropic no tiene ContentGen propio → intención, " +
        "business_relevance y contenido on-page usan MOCK (solo los seeds usan Anthropic).",
    );
  }
  return new MockContentGen();
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
    // Defensivo (#8): ignorar respuestas no-array o elementos sin keyword/relevance válidos.
    for (const s of asArray<{ keyword?: unknown; relevance?: unknown }>(parsed.scores)) {
      if (typeof s?.keyword === "string" && typeof s?.relevance === "number") {
        map.set(s.keyword, clamp01(s.relevance));
      }
    }
    return map;
  }

  async classifyIntents(
    businessPrompt: string,
    keywords: string[],
    market: Market,
  ): Promise<Map<string, IntentResult>> {
    if (keywords.length === 0) return new Map();
    const res = await this.client.chat.completions.create({
      model: config.openai.generationModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Sos experto SEO/SEM. Para cada keyword, clasificá la intención de búsqueda dominante " +
            "en el contexto del negocio. Valores de intent: " +
            "transactional (listo para contratar/comprar/reservar), " +
            "commercial (compara opciones antes de decidir: 'mejor', 'opiniones', 'precios'), " +
            "local (busca un negocio/servicio en una zona geográfica concreta), " +
            "informational (busca aprender: 'qué', 'cómo', 'guía'), " +
            "navigational (busca una marca/sitio concreto). " +
            "is_local = true si la búsqueda tiene intención geográfica real (ciudad, barrio, " +
            "'cerca de mí', o un servicio que se consume presencialmente en una zona). " +
            'Devolvé SOLO JSON: {"items":[{"keyword":string,"intent":string,"is_local":boolean}]}',
        },
        {
          role: "user",
          content:
            `Negocio: ${businessPrompt}\nMercado: ${market.country} (idioma ${market.language_code})\n` +
            `Keywords:\n${keywords.join("\n")}`,
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
      items?: Array<{ keyword?: string; intent?: string; is_local?: boolean }>;
    };
    const map = new Map<string, IntentResult>();
    for (const it of asArray<{ keyword?: unknown; intent?: unknown; is_local?: unknown }>(parsed.items)) {
      const intent = normalizeIntent(typeof it?.intent === "string" ? it.intent : undefined);
      if (typeof it?.keyword === "string" && intent) {
        map.set(it.keyword, { intent, is_local: Boolean(it.is_local) });
      }
    }
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

  // Sin LLM: se delega al fallback heurístico del pipeline (applyIntents).
  async classifyIntents(): Promise<Map<string, IntentResult>> {
    return new Map();
  }

  async pageContent(input: PageContentInput): Promise<PageContentResult> {
    return normalizeContent({}, input);
  }
}

// ---------------------------------------------------------------- helpers
function normalizeContent(p: Partial<PageContentResult>, input: PageContentInput): PageContentResult {
  const kw = input.keyword_principal;
  const cap = kw.charAt(0).toUpperCase() + kw.slice(1);
  // Los campos array se coercen defensivamente (#8): si el LLM manda un no-array, usamos el default.
  const secciones = strArray(p.secciones_sugeridas);
  return {
    meta_title: p.meta_title ?? cap,
    meta_description: p.meta_description ?? `Información y servicios sobre ${kw}.`,
    h1: p.h1 ?? cap,
    secciones_sugeridas:
      secciones ?? (input.page_type === "blog"
        ? ["Introducción", "Desarrollo", "Preguntas frecuentes"]
        : ["Servicio", "Beneficios", "Precios", "Contacto"]),
    word_count_objetivo:
      typeof p.word_count_objetivo === "number" ? p.word_count_objetivo : input.page_type === "blog" ? 900 : 1100,
    faqs: strArray(p.faqs) ?? [],
    cta: p.cta ?? "Contáctanos",
    tono: p.tono ?? "Profesional y cercano",
    claims_permitidos: strArray(p.claims_permitidos) ?? [],
    claims_prohibidos: strArray(p.claims_prohibidos) ?? [],
  };
}

/** Array de strings validado; null si `v` no es un array (para caer al default). */
function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

/** Devuelve `v` si es array; si no, `[]`. Neutraliza respuestas LLM no-array (#8). */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

const VALID_INTENTS: readonly SearchIntent[] = [
  "transactional",
  "commercial",
  "local",
  "informational",
  "navigational",
];

/** Valida/normaliza el intent devuelto por el LLM; null si no es un valor conocido. */
function normalizeIntent(raw: string | undefined): SearchIntent | null {
  const v = raw?.trim().toLowerCase();
  return VALID_INTENTS.find((i) => i === v) ?? null;
}
