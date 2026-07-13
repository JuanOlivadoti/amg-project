import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { costMeter } from "../lib/cost.js";
import type { Market, Seed } from "../types.js";
import type { TextGen } from "./types.js";

/** Generación con Claude (tool use para JSON estructurado). ADR-09. */
export class AnthropicTextGen implements TextGen {
  async generateSeeds(prompt: string, market: Market): Promise<Seed[]> {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const msg = await client.messages.create({
      model: config.anthropic.generationModel,
      max_tokens: 1500,
      tool_choice: { type: "tool", name: "emit_seeds" },
      tools: [
        {
          name: "emit_seeds",
          description: "Devuelve keywords semilla en el idioma del mercado.",
          input_schema: {
            type: "object",
            properties: {
              seeds: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    keyword: { type: "string" },
                    service: { type: "string" },
                    intent_hint: {
                      type: "string",
                      enum: ["transactional", "commercial", "local", "informational", "navigational"],
                    },
                  },
                  required: ["keyword"],
                },
              },
            },
            required: ["seeds"],
          },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            `Negocio: ${prompt}\nMercado: ${market.country} (idioma ${market.language_code}).\n` +
            `Generá 15-30 keywords semilla en ese idioma. No inventes servicios no mencionados.`,
        },
      ],
    });
    // Sin tarifa configurada para el modelo, el costo NO se inventa: queda en unpricedModels.
    costMeter.addTokens(
      "llm_generation",
      config.anthropic.generationModel,
      msg.usage?.input_tokens ?? 0,
      msg.usage?.output_tokens ?? 0,
    );

    const toolUse = msg.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return (toolUse.input as { seeds: Seed[] }).seeds;
    }
    return [];
  }
}
