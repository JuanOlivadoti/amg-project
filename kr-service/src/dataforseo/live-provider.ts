import type { Market } from "../types.js";
import { DataForSeoClient } from "./client.js";
import {
  bulkKeywordDifficulty,
  keywordSuggestions,
  searchVolume,
  serpOrganic,
  type SearchVolumeRow,
} from "./endpoints.js";
import type { KeywordDataProvider } from "./provider.js";
import type { ProviderTaskLog } from "./task-log.js";

/** Provider real: pega contra la API de DataForSEO (sandbox o producción). */
export class LiveProvider implements KeywordDataProvider {
  private client: DataForSeoClient;

  /**
   * El registro de tareas se INYECTA. `kr-service` sigue sin saber que existe una base de datos:
   * conoce la interfaz, no la implementación (igual que con `KeywordCache`). El orquestador y el CLI
   * le pasan la que persiste en Postgres (`PgTaskLog`).
   *
   * En **producción** ese registro durable es OBLIGATORIO: `getProvider` rechaza `Noop`/`Mem`/nada
   * antes de tocar la red (ADR-14), porque sin persistencia un crash + re-run vuelve a pagar. En
   * sandbox (gratis) o mock, no hace falta y `taskLog` puede venir vacío.
   */
  constructor(taskLog?: ProviderTaskLog) {
    this.client = new DataForSeoClient(taskLog);
  }

  get costMicros(): number {
    return this.client.costMicros;
  }

  /** Peticiones reenviadas sin saber si la anterior ya se cobró. Cero es lo esperable. */
  get repagos(): number {
    return this.client.repagos;
  }

  keywordSuggestions(keyword: string, market: Market, limit = 30): Promise<string[]> {
    return keywordSuggestions(this.client, keyword, market, limit);
  }

  searchVolume(keywords: string[], market: Market): Promise<SearchVolumeRow[]> {
    return searchVolume(this.client, keywords, market);
  }

  bulkKeywordDifficulty(
    keywords: string[],
    market: Market,
  ): Promise<Map<string, number | null>> {
    return bulkKeywordDifficulty(this.client, keywords, market);
  }

  serp(keyword: string, market: Market, depth = 10): Promise<string[]> {
    return serpOrganic(this.client, keyword, market, depth);
  }
}
