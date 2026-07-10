import OpenAI from "openai";
import { config } from "../config.js";
import type { Market, Seed } from "../types.js";
import type { Embedder, TextGen } from "./types.js";

const client = () => new OpenAI({ apiKey: config.openai.apiKey });

/** Generación con OpenAI (JSON estructurado). */
export class OpenAITextGen implements TextGen {
  async generateSeeds(prompt: string, market: Market): Promise<Seed[]> {
    const res = await client().chat.completions.create({
      model: config.openai.generationModel,
      response_format: { type: "json_object" },
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
    return res.data.map((d) => d.embedding);
  }
}
