import { config } from "../config.js";
import { AnthropicTextGen } from "./anthropic.js";
import { MockEmbedder, MockTextGen } from "./mock.js";
import { OpenAIEmbedder, OpenAITextGen } from "./openai.js";
import type { Embedder, TextGen } from "./types.js";

/** Generador de texto según config.llm.provider. */
export function getTextGen(): TextGen {
  switch (config.llm.provider) {
    case "openai":
      return new OpenAITextGen();
    case "anthropic":
      return new AnthropicTextGen();
    default:
      return new MockTextGen();
  }
}

/** Embedder según config.llm.embeddingProvider (openai si hay key; si no, mock). */
export function getEmbedder(): Embedder {
  return config.llm.embeddingProvider === "openai" ? new OpenAIEmbedder() : new MockEmbedder();
}

export type { Embedder, TextGen };
