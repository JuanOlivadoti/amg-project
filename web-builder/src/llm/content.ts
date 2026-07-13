import OpenAI from "openai";
import { config } from "../config.js";
import type { BusinessProfile } from "../types.js";

export interface ProseInput {
  businessContext: string;
  languageCode: string;
  pageTitle: string;
  intent: string;
  pageType: string;
  isLocal: boolean;
  sections: string[];
  faqs: string[];
  tono?: string;
  claimsPermitidos?: string[];
  claimsProhibidos?: string[];
  profile?: BusinessProfile;
}

export interface ProseResult {
  sections: Array<{ heading: string; body: string }>;
  faqs: Array<{ question: string; answer: string }>;
}

/** Genera la prose final de la página (secciones + respuestas FAQ). openai | mock. */
export interface ProseGen {
  fillPage(input: ProseInput): Promise<ProseResult>;
}

export function getProseGen(): ProseGen {
  return config.prose.mode === "openai" && config.openai.hasKey
    ? new OpenAIProseGen()
    : new MockProseGen();
}

// ---------------------------------------------------------------- OpenAI
class OpenAIProseGen implements ProseGen {
  private client = new OpenAI({ apiKey: config.openai.apiKey });

  async fillPage(input: ProseInput): Promise<ProseResult> {
    const res = await this.client.chat.completions.create({
      model: config.openai.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Sos redactor SEO experto en sectores regulados (gastronomía, salud). Redactás en el " +
            "idioma indicado, con tono natural y orientado a conversión, optimizado para SEO y para " +
            "buscadores IA (respuestas claras y autocontenidas). NUNCA prometas resultados garantizados " +
            "ni hagas claims prohibidos. Respetá los claims permitidos. Devolvé SOLO JSON con la forma: " +
            '{"sections":[{"heading":string,"body":string}],"faqs":[{"question":string,"answer":string}]}. ' +
            "Cada 'body' es 2-4 frases (60-110 palabras). Cada 'answer' es 1-3 frases concretas. " +
            "Devolvé EXACTAMENTE los mismos headings y questions que recibís, sin agregar ni quitar.",
        },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as Partial<ProseResult>;
    return reconcile(parsed, input);
  }
}

// ---------------------------------------------------------------- Mock
class MockProseGen implements ProseGen {
  async fillPage(input: ProseInput): Promise<ProseResult> {
    return reconcile({}, input);
  }
}

// ---------------------------------------------------------------- helpers
function buildUserPrompt(input: ProseInput): string {
  const p = input.profile;
  const lines = [
    `Negocio: ${input.businessContext}`,
    p ? `Nombre comercial: ${p.name}` : "",
    p?.address
      ? `Ubicación: ${p.address.streetAddress}, ${p.address.addressLocality} (${p.address.postalCode})`
      : "",
    p?.telephone ? `Teléfono: ${p.telephone}` : "",
    p?.opening_hours ? `Horario: ${p.opening_hours}` : "",
    `Idioma: ${input.languageCode}`,
    `Página: "${input.pageTitle}" · tipo ${input.pageType} · intención ${input.intent}${input.isLocal ? " (local)" : ""}`,
    input.tono ? `Tono: ${input.tono}` : "",
    input.claimsPermitidos?.length ? `Claims permitidos: ${input.claimsPermitidos.join("; ")}` : "",
    input.claimsProhibidos?.length ? `Claims prohibidos (NO usar): ${input.claimsProhibidos.join("; ")}` : "",
    "",
    `Secciones a redactar (headings):\n${input.sections.map((s) => `- ${s}`).join("\n")}`,
    "",
    input.faqs.length ? `Preguntas a responder:\n${input.faqs.map((q) => `- ${q}`).join("\n")}` : "Sin FAQs.",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Garantiza que cada heading/question de entrada tenga texto (usa el del LLM o un fallback).
 * Defensivo (#8 review Codex): el LLM puede devolver JSON válido pero estructuralmente parcial
 * (p.ej. `sections` como string, o items sin `heading`). Se ignoran los elementos inválidos.
 * Exportada para test.
 */
export function reconcile(parsed: Partial<ProseResult>, input: ProseInput): ProseResult {
  const secMap = new Map<string, unknown>();
  for (const s of asArray<{ heading?: unknown; body?: unknown }>(parsed.sections)) {
    if (isStr(s?.heading)) secMap.set(norm(s.heading), s.body);
  }
  const faqMap = new Map<string, unknown>();
  for (const f of asArray<{ question?: unknown; answer?: unknown }>(parsed.faqs)) {
    if (isStr(f?.question)) faqMap.set(norm(f.question), f.answer);
  }
  const name = input.profile?.name ?? input.businessContext;

  return {
    sections: input.sections.map((heading) => ({
      heading,
      body: clean(secMap.get(norm(heading))) ?? `Información sobre ${heading.toLowerCase()} en ${name}.`,
    })),
    faqs: input.faqs.map((question) => ({
      question,
      answer: clean(faqMap.get(norm(question))) ?? `Contáctanos y te informamos sobre "${question}".`,
    })),
  };
}

function clean(s: unknown): string | undefined {
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : undefined;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Devuelve `v` si es un array; si no, `[]`. Neutraliza respuestas LLM no-array. */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
