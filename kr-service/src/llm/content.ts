import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { currentMeter } from "../lib/cost.js";
import { trackChatUsage } from "./openai.js";
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

let warnedNoKey = false;

/**
 * Elige el generador de contenido según el proveedor activo (ADR-09).
 * Los tres (OpenAI, Anthropic, mock) implementan la MISMA interfaz: cambiar de proveedor no
 * degrada capacidades. Si el proveedor está configurado pero falta la key, se avisa fuerte
 * antes de caer a mock — nunca una degradación silenciosa (#6 review Codex).
 */
export function getContentGen(): ContentGen {
  if (config.llm.provider === "openai" && config.openai.hasKey) return new OpenAIContentGen();
  if (config.llm.provider === "anthropic" && config.anthropic.hasKey) return new AnthropicContentGen();

  if (config.llm.provider !== "mock" && !warnedNoKey) {
    warnedNoKey = true;
    console.warn(
      `  [llm] AVISO: LLM_PROVIDER=${config.llm.provider} pero falta la API key → ` +
        `intención, business_relevance y contenido on-page usan MOCK.`,
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
    trackChatUsage(config.openai.generationModel, res.usage);
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
            "en el contexto del negocio. " +
            INTENT_RULE +
            IS_LOCAL_RULE +
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
    trackChatUsage(config.openai.generationModel, res.usage);
    const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
      items?: Array<{ keyword?: string; intent?: string; is_local?: boolean }>;
    };
    const map = new Map<string, IntentResult>();
    for (const it of asArray<{ keyword?: unknown; intent?: unknown; is_local?: unknown }>(parsed.items)) {
      const intent = normalizeIntent(typeof it?.intent === "string" ? it.intent : undefined);
      if (typeof it?.keyword === "string" && intent) {
        map.set(it.keyword, { intent, is_local: strictBool(it.is_local) });
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
    trackChatUsage(config.openai.generationModel, res.usage);
    const p = JSON.parse(res.choices[0]?.message.content ?? "{}") as Partial<PageContentResult>;
    return normalizeContent(p, input);
  }
}

// ---------------------------------------------------------------- Anthropic
/**
 * ContentGen con Claude (tool use para JSON estructurado, igual que AnthropicTextGen).
 * ADR-09: modelo económico (Haiku) para clasificar, modelo de gama alta para redactar.
 *
 * ⚠️ Costo: no hay tarifas de Claude en `lib/cost.ts` por defecto. Si usás Anthropic, cargá
 * `LLM_PRICES` o el total del run quedará marcado como INCOMPLETO (no se inventa el costo).
 */
class AnthropicContentGen implements ContentGen {
  private client = new Anthropic({ apiKey: config.anthropic.apiKey });

  /** Llama a Claude forzando una tool y devuelve su input (el JSON estructurado). */
  private async callTool<T>(
    model: string,
    toolName: string,
    description: string,
    inputSchema: Record<string, unknown>,
    userContent: string,
    maxTokens = 2000,
  ): Promise<Partial<T>> {
    const msg = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      tool_choice: { type: "tool", name: toolName },
      tools: [{ name: toolName, description, input_schema: inputSchema as never }],
      messages: [{ role: "user", content: userContent }],
    });
    currentMeter().addTokens("llm_generation", model, msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0);

    const toolUse = msg.content.find((b) => b.type === "tool_use");
    return toolUse && toolUse.type === "tool_use" ? (toolUse.input as Partial<T>) : {};
  }

  async businessRelevance(businessPrompt: string, keywords: string[]): Promise<Map<string, number>> {
    if (keywords.length === 0) return new Map();
    const out = await this.callTool<{ scores: Array<{ keyword: string; relevance: number }> }>(
      config.anthropic.classificationModel,
      "emit_scores",
      "Relevancia (0..1) de cada keyword para captar clientes del negocio descrito.",
      {
        type: "object",
        properties: {
          scores: {
            type: "array",
            items: {
              type: "object",
              properties: { keyword: { type: "string" }, relevance: { type: "number" } },
              required: ["keyword", "relevance"],
            },
          },
        },
        required: ["scores"],
      },
      `Negocio: ${businessPrompt}\nKeywords:\n${keywords.join("\n")}`,
    );

    const map = new Map<string, number>();
    for (const s of asArray<{ keyword?: unknown; relevance?: unknown }>(out.scores)) {
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
    const out = await this.callTool<{
      items: Array<{ keyword: string; intent: string; is_local: boolean }>;
    }>(
      config.anthropic.classificationModel,
      "emit_intents",
      "Intención de búsqueda dominante y señal local de cada keyword, en el contexto del negocio.",
      {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                keyword: { type: "string" },
                intent: { type: "string", enum: VALID_INTENTS as unknown as string[] },
                is_local: { type: "boolean" },
              },
              required: ["keyword", "intent", "is_local"],
            },
          },
        },
        required: ["items"],
      },
      // Las MISMAS reglas que OpenAI. Antes acá había una versión abreviada y distinta
      // ("is_local = true si la búsqueda tiene intención geográfica real"), así que cambiar de
      // proveedor cambiaba silenciosamente la clasificación: el mismo research daba otro resultado.
      `Negocio: ${businessPrompt}\nMercado: ${market.country} (idioma ${market.language_code})\n` +
        INTENT_RULE +
        IS_LOCAL_RULE +
        `\nKeywords:\n${keywords.join("\n")}`,
    );

    const map = new Map<string, IntentResult>();
    for (const it of asArray<{ keyword?: unknown; intent?: unknown; is_local?: unknown }>(out.items)) {
      const intent = normalizeIntent(typeof it?.intent === "string" ? it.intent : undefined);
      if (typeof it?.keyword === "string" && intent) {
        map.set(it.keyword, { intent, is_local: strictBool(it.is_local) });
      }
    }
    return map;
  }

  async pageContent(input: PageContentInput): Promise<PageContentResult> {
    const strList = { type: "array", items: { type: "string" } };
    const out = await this.callTool<PageContentResult>(
      config.anthropic.generationModel,
      "emit_content",
      "Contenido SEO on-page. NO prometas resultados garantizados ni hagas claims indebidos " +
        "(sectores regulados: salud, gastronomía).",
      {
        type: "object",
        properties: {
          meta_title: { type: "string" },
          meta_description: { type: "string" },
          h1: { type: "string" },
          secciones_sugeridas: strList,
          word_count_objetivo: { type: "number" },
          faqs: strList,
          cta: { type: "string" },
          tono: { type: "string" },
          claims_permitidos: strList,
          claims_prohibidos: strList,
        },
        required: ["meta_title", "meta_description", "h1", "secciones_sugeridas"],
      },
      `Negocio: ${input.businessPrompt}\nIdioma: ${input.market.language_code}\n` +
        `Tipo de página: ${input.page_type}\nIntención: ${input.intent}${input.is_local ? " (local)" : ""}\n` +
        `Keyword principal: ${input.keyword_principal}\n` +
        `Keywords secundarias: ${input.keywords_secundarias.join(", ")}`,
    );
    return normalizeContent(out, input);
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

/**
 * Regla de `is_local`, compartida por todos los proveedores para que no diverjan.
 *
 * La versión anterior decía "...o un servicio que se consume presencialmente en una zona", lo que
 * hacía local a CUALQUIER búsqueda gastronómica: en la corrida real dio `is_local` en 53 de 60
 * keywords, y casi todas las páginas salieron `landing_local` con JSON-LD `LocalBusiness`. Eso no
 * es una clasificación interna imperfecta: es una afirmación estructurada FALSA hacia Google.
 *
 * El error de fondo era confundir "el NEGOCIO es local" (siempre cierto para un restaurante) con
 * "esta BÚSQUEDA apunta a un lugar" (que es lo que hay que decidir).
 *
 * La señal correcta es el SERP (presencia de map/local pack). Hasta tenerla, el LLM es un proxy y
 * el prompt tiene que ser explícito sobre la distinción.
 */
/**
 * Regla de intención, compartida por todos los proveedores.
 *
 * El problema que corrige: el LLM mandaba a `informational` cualquier keyword sin modificador
 * geográfico, incluidas las que nombran un SERVICIO QUE EL NEGOCIO VENDE ("cenas para grupos",
 * "brunch fin de semana"). Quedaba oculto porque `is_local` cortocircuitaba el tipo de página; al
 * arreglar `is_local`, esas páginas se iban a `blog`/`Article` en vez de a una landing de servicio.
 *
 * Quien busca "cenas para grupos en restaurante italiano" NO quiere aprender sobre cenas de grupo:
 * quiere una. Es demanda comercial, no informativa.
 */
const INTENT_RULE =
  "Valores de intent: " +
  "transactional (listo para contratar/comprar/reservar: 'reservar', 'pedir', 'a domicilio'), " +
  "commercial (evalúa un servicio o compara opciones antes de decidir: 'mejor', 'opiniones', " +
  "'precios', 'barato' — y TAMBIÉN cualquier keyword que nombre un servicio/producto que el " +
  "negocio ofrece, aunque no lleve esas palabras), " +
  "local (busca un negocio en una zona geográfica concreta), " +
  "informational (quiere APRENDER, no contratar: 'qué es', 'cómo se hace', 'guía', 'receta', " +
  "'diferencia entre', 'historia de'), " +
  "navigational (busca una marca o sitio concreto). " +
  "REGLA CLAVE: si la keyword nombra algo que el negocio VENDE, es commercial o transactional, " +
  "NO informational. 'cenas para grupos' o 'menú del día' son demanda de un servicio (commercial); " +
  "'cómo hacer pasta fresca' o 'qué es la pizza napolitana' sí son informational. La ausencia de " +
  "ciudad NO convierte una búsqueda en informativa. ";

const IS_LOCAL_RULE =
  "is_local = true SOLO si la BÚSQUEDA en sí apunta a un lugar: lleva un modificador geográfico " +
  "(ciudad, barrio, zona, código postal) o de proximidad ('cerca de mí', 'a domicilio en X'). " +
  "IMPORTANTE: is_local NO es 'el negocio es local'. Que el negocio se visite físicamente NO " +
  "hace local a la búsqueda. Ejemplos: 'pizzeria napolitana Madrid' → true (lleva ciudad); " +
  "'restaurantes cerca de mí' → true (proximidad); 'qué es la pizza napolitana' → false " +
  "(informativa, sin lugar); 'cómo se hace la pasta fresca' → false; 'menú del día' → false " +
  "(no menciona ningún lugar). Ante la duda, false. ";

/**
 * `is_local` debe ser un booleano REAL. Antes se hacía `Boolean(it.is_local)`, que convierte el
 * string "false" (y cualquier otro valor inesperado) en `true` — la misma clase de coerción
 * silenciosa que el viejo `volumen ?? 0`. Si el LLM devuelve basura, se trata como dato ausente
 * (false) en vez de fabricar un `true`.
 */
function strictBool(v: unknown): boolean {
  return v === true;
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
