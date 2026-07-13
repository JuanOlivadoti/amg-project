import OpenAI from "openai";
import { config } from "../config.js";
import { currentMeter } from "../lib/cost.js";
import type { Market, Seed } from "../types.js";
import type { Embedder, TextGen } from "./types.js";

const client = () => new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Semilla de muestreo para las llamadas de CLASIFICACIÓN (seeds, intención, relevancia).
 *
 * `temperature: 0` reduce la varianza pero OpenAI no garantiza determinismo con eso solo; el
 * parámetro `seed` es el que pide un muestreo reproducible. Juntos hacen que el mismo prompt dé
 * (casi siempre) el mismo research.
 *
 * Importa por dos motivos, y el primero pesa más:
 *  1. **Reproducibilidad.** Un cliente que paga dos veces por el mismo research no puede recibir
 *     dos planes de sitio distintos.
 *  2. **Costo.** Si el universo de keywords cambia en cada corrida, la cache casi nunca acierta:
 *     nunca se pide dos veces lo mismo.
 *
 * NO se usa en `pageContent`: eso es redacción, y ahí la variedad es deseable.
 */
export const DETERMINISTIC_SEED = 20260713;

/** Registra el costo de una respuesta de chat a partir de los tokens reportados por OpenAI. */
export function trackChatUsage(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): void {
  if (!usage) return;
  currentMeter().addTokens("llm_generation", model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
}

/** Generación con OpenAI (JSON estructurado). */
export class OpenAITextGen implements TextGen {
  async generateSeeds(prompt: string, market: Market): Promise<Seed[]> {
    const res = await client().chat.completions.create({
      model: config.openai.generationModel,
      response_format: { type: "json_object" },
      // Determinista A PROPÓSITO. Generar seeds no es una tarea creativa: es extraer los términos
      // que describen al negocio. Con la temperatura por defecto (1.0), el mismo prompt daba un
      // conjunto de keywords DISTINTO en cada corrida → el research no era reproducible (el cliente
      // paga dos veces y recibe dos planes de sitio distintos) y la cache casi nunca acertaba,
      // porque nunca se pedían las mismas keywords dos veces.
      temperature: 0,
      seed: DETERMINISTIC_SEED,
      messages: [
        {
          role: "system",
          content:
            "Sos un experto SEO. Devolvés SOLO JSON: " +
            '{"seeds":[{"keyword":string,"service"?:string,"intent_hint"?:' +
            '"transactional"|"commercial"|"local"|"informational"|"navigational"}]}',
        },
        {
          role: "user",
          content:
            `Negocio: ${prompt}\nMercado: ${market.country} (idioma ${market.language_code}).\n` +
            `Generá 15-30 keywords semilla en ese idioma. No inventes servicios no mencionados.`,
        },
      ],
    });
    trackChatUsage(config.openai.generationModel, res.usage);
    const raw = res.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(raw) as { seeds?: Seed[] };
    return parsed.seeds ?? [];
  }
}

/** Embeddings con OpenAI (text-embedding-3-small, multilingüe). */
export class OpenAIEmbedder implements Embedder {
  readonly dim = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await client().embeddings.create({
      model: config.openai.embeddingModel,
      input: texts,
    });
    // Los embeddings no tienen tokens de salida: solo se paga la entrada.
    currentMeter().addTokens("llm_embeddings", config.openai.embeddingModel, res.usage?.prompt_tokens ?? 0, 0);
    return res.data.map((d) => d.embedding);
  }
}
