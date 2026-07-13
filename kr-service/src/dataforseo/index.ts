import { config } from "../config.js";
import { LiveProvider } from "./live-provider.js";
import { MockProvider } from "./mock-provider.js";
import { CachedProvider } from "./cached-provider.js";
import { FileCache } from "./cache.js";
import type { KeywordDataProvider } from "./provider.js";

/**
 * Provider según config (mock por default, live si DATAFORSEO_MODE=live), envuelto en la cache.
 *
 * La cache SOLO envuelve al provider live: cachear el mock no ahorra nada (es determinista y
 * gratis) y ensuciaría el loop de desarrollo sirviendo datos viejos cuando se toca el propio mock.
 */
export function getProvider(): KeywordDataProvider {
  if (config.dataforseo.mode !== "live") return new MockProvider();

  const live = new LiveProvider();
  if (!config.cache.enabled) return live;

  return new CachedProvider(live, new FileCache(config.cache.path));
}

export type { KeywordDataProvider };
export { CachedProvider } from "./cached-provider.js";
