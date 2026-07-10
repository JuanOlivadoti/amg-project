import { config } from "../config.js";
import type { Market, Seed } from "../types.js";
import { getTextGen } from "./index.js";

/** Paso A del pipeline: seeds a partir del prompt. Delega al proveedor configurado. */
export async function generateSeeds(prompt: string, market: Market): Promise<Seed[]> {
  if (config.llm.provider === "mock") {
    console.warn("⚠️  LLM en modo mock → seeds heurísticos (configurá OPENAI_API_KEY o ANTHROPIC_API_KEY).");
  }
  return getTextGen().generateSeeds(prompt, market);
}
