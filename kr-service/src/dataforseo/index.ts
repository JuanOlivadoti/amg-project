import { config } from "../config.js";
import { LiveProvider } from "./live-provider.js";
import { MockProvider } from "./mock-provider.js";
import type { KeywordDataProvider } from "./provider.js";

/** Elige el provider según config (mock por default, live si DATAFORSEO_MODE=live). */
export function getProvider(): KeywordDataProvider {
  return config.dataforseo.mode === "live" ? new LiveProvider() : new MockProvider();
}

export type { KeywordDataProvider };
