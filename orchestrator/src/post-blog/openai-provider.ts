import OpenAI from "openai";
import type { PostBlogGenerado, PostProvider } from "./provider.js";
// Reuso deliberado: OPENAI_MODEL es compartida por todo el pipeline (kr-service, web-builder,
// borrador de reseñas) — leerModeloBorrador/costoEstimadoUsd no son específicas de reseñas pese al
// nombre del archivo, ver su propio docblock.
import { costoEstimadoUsd, leerModeloBorrador } from "../borrador/openai-provider.js";

// Base genérica — sin mención de rubro. Corregido en la revisión conjunta de los tres sub-proyectos
// (2026-08-26): la versión anterior decía "negocio gastronómico" a secas, lenguaje incorrecto para
// un cliente de correduría de seguros (sub-proyecto 1). Ninguno de los tres sub-proyectos se
// implementó todavía, así que se corrige acá en vez de arrastrar la deuda.
const PROMPT_SISTEMA_BASE =
  "Sos un redactor SEO para un negocio local. Te doy una keyword principal, un brief de contenido " +
  "(JSON) y el perfil del negocio. Escribís un post de blog en español, HTML simple (<p>, <h2>, " +
  "<h3>, <ul>, <li>, <strong>, <em>, <a href>), 400-600 palabras, que desarrolle el brief para esa " +
  "keyword. Devolvé SOLO un objeto JSON con dos claves: \"titulo\" (string, sin HTML) y \"cuerpo\" " +
  "(string, HTML). Nada de texto fuera del JSON.";

// Una línea de más contexto por vertical, agregada solo cuando `vertical` viaja en `args` (sub-proyecto
// 1 implementado). Sin `vertical`, el prompt queda en la base genérica de arriba — no asume rubro.
const CONTEXTO_POR_VERTICAL: Record<"restauracion" | "correduria_seguros", string> = {
  restauracion:
    " El negocio es gastronómico (restaurante, bar, cafetería): mencioná platos, " +
    "ingredientes o la experiencia gastronómica cuando el brief lo permita.",
  correduria_seguros:
    " El negocio es una correduría de seguros: mencioná coberturas, pólizas o " +
    "asesoramiento cuando el brief lo permita — nunca prometas cobertura o condiciones específicas " +
    "que el negocio no haya confirmado.",
};

// Exportada (no interna) para poder testearla sin pegarle a OpenAI — es una función pura.
export function armarPromptSistema(
  vertical: "restauracion" | "correduria_seguros" | null | undefined,
): string {
  return vertical ? PROMPT_SISTEMA_BASE + CONTEXTO_POR_VERTICAL[vertical] : PROMPT_SISTEMA_BASE;
}

/**
 * Genera el post llamando a OpenAI de verdad. El cuerpo sale de acá SIN sanitizar — la garantía real
 * es que ningún HTML se persiste sin pasar por `sanitizarHtml` (db/src/store.ts, `guardarPost`),
 * mismo límite que ya documenta `OpenAIBorradorProvider` sobre el texto sin escapar.
 */
export class OpenAIPostProvider implements PostProvider {
  private readonly client: OpenAI;
  private readonly modelo: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      timeout: 45_000,
      maxRetries: 1,
    });
    this.modelo = leerModeloBorrador();
  }

  async generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
    vertical?: "restauracion" | "correduria_seguros" | null;
  }): Promise<PostBlogGenerado> {
    const contexto = JSON.stringify({
      keyword_principal: args.keywordPrincipal,
      content_brief: args.contentBrief,
      perfil_negocio: args.perfilCliente,
    });

    const res = await this.client.chat.completions.create({
      model: this.modelo,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: armarPromptSistema(args.vertical) },
        { role: "user", content: contexto },
      ],
    });

    const texto = res.choices[0]?.message.content?.trim();
    if (!texto) throw new Error("OpenAI no devolvió texto para el post");

    let parsed: unknown;
    try {
      parsed = JSON.parse(texto);
    } catch {
      throw new Error("OpenAI devolvió un JSON inválido para el post");
    }
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof obj["titulo"] !== "string" ||
      typeof obj["cuerpo"] !== "string"
    ) {
      throw new Error("OpenAI devolvió un JSON sin las claves titulo/cuerpo");
    }

    if (res.usage) {
      const costo = costoEstimadoUsd(res.usage, this.modelo);
      console.log(
        `[post-blog] costo estimado: ${costo != null ? `$${costo.toFixed(6)}` : "modelo sin tarifa conocida"} ` +
          `(${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out, modelo ${this.modelo})`,
      );
    }

    return { titulo: obj["titulo"] as string, cuerpo: obj["cuerpo"] as string };
  }
}
