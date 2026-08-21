import OpenAI from "openai";
import type { ReseñaCruda } from "../google/provider.js";
import type { BorradorProvider } from "./provider.js";

/**
 * USD por 1M tokens. Mismo criterio de "costo conocido, no medido" que
 * `kr-service/src/lib/cost.ts` — acá sin tabla configurable por entorno porque el volumen esperado
 * es bajo (solo se loguea, no se factura una propuesta comercial con esto). Si el modelo configurado
 * no tiene tarifa acá, `costoEstimadoUsd` devuelve `null` en vez de inventar un número.
 *
 * ✅ Verificado contra developers.openai.com/api/docs/pricing el 2026-08-18. Los precios cambian:
 * re-verificar si esto empieza a importar para una propuesta comercial.
 */
const PRECIOS_USD_POR_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

/**
 * `?.trim() || ...`, no `??`: env:sync escribe `""` (no `undefined`) cuando la clave falta en
 * credenciales.env (scripts/env-sync.mts, repartir()) — mismo patrón que leerModoBorrador() en
 * config.ts, por la misma razón. `??` dejaría pasar `""` como modelo real y OpenAI la rechazaría.
 */
export function leerModeloBorrador(): string {
  return process.env["OPENAI_MODEL"]?.trim() || "gpt-4o-mini";
}

/** Costo estimado en USD a partir del `usage` que devuelve la respuesta de OpenAI. */
export function costoEstimadoUsd(
  usage: { prompt_tokens: number; completion_tokens: number },
  modelo: string,
): number | null {
  const precio = PRECIOS_USD_POR_1M[modelo];
  if (!precio) return null;
  return (usage.prompt_tokens * precio.input + usage.completion_tokens * precio.output) / 1_000_000;
}

const PROMPT_SISTEMA =
  "Sos el community manager de un negocio gastronómico, respondiendo reseñas de clientes en Google. " +
  "Escribís en español, tono cercano y profesional, agradeciendo la reseña. Si el cliente mencionó " +
  "algo concreto (un plato, el servicio), lo nombrás. NUNCA prometas resultados garantizados ni hagas " +
  "afirmaciones que el negocio no pueda sostener. 2-3 frases, nada más. Devolvé SOLO el texto de la " +
  "respuesta, sin comillas ni preámbulo.";

/**
 * Genera el borrador llamando a OpenAI de verdad. La instrucción de "nunca prometas de más" es una
 * instrucción al modelo, **no una garantía dura** (mismo límite que ya tiene la prosa de
 * `web-builder/src/llm/content.ts:64-72`): la garantía real es que ningún borrador sale de esta pieza
 * sin pasar antes por revisión humana — esta pieza no publica nada.
 */
export class OpenAIBorradorProvider implements BorradorProvider {
  private readonly client: OpenAI;
  private readonly modelo: string;

  constructor() {
    // OPENAI_MODEL es compartida con kr-service/web-builder — ver .env.example
    this.client = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      timeout: 30_000,
      maxRetries: 1,
    });
    this.modelo = leerModeloBorrador();
  }

  async generar(reseña: ReseñaCruda): Promise<string> {
    // `autor`/`texto` son texto de un tercero no confiable (cualquiera deja una reseña en Google),
    // interpolados sin escapar. Decisión consciente (ver la spec de esta pieza): la garantía real es que
    // NINGÚN borrador sale de acá sin pasar por revisión humana en el portal -- esta pieza no publica
    // nada. Si la próxima pieza (publicar la respuesta de vuelta a Google) toca este código, tiene que
    // decidir esto de nuevo con la publicación en la cabeza, no heredar el supuesto en silencio.
    const contexto = reseña.texto
      ? `Reseña de ${reseña.puntuacion}★ de ${reseña.autor}: "${reseña.texto}"`
      : `Reseña de ${reseña.puntuacion}★ de ${reseña.autor}, sin comentario escrito.`;

    const res = await this.client.chat.completions.create({
      model: this.modelo,
      max_tokens: 300,
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: contexto },
      ],
    });

    const texto = res.choices[0]?.message.content?.trim();
    if (!texto) throw new Error("OpenAI no devolvió texto para el borrador");

    if (res.usage) {
      const costo = costoEstimadoUsd(res.usage, this.modelo);
      console.log(
        `[borrador-ia] costo estimado: ${costo != null ? `$${costo.toFixed(6)}` : "modelo sin tarifa conocida"} ` +
          `(${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out, modelo ${this.modelo})`,
      );
    }

    return texto;
  }
}
