/**
 * Punto de entrada del paquete `kr-service` (Módulo 2 — Keyword Research).
 *
 * Sigue siendo una **librería pura**: no sabe que existe una base de datos ni un orquestador. Lo
 * que necesita de afuera (el registro de tareas facturables) lo recibe como interfaz, no como
 * implementación. Ver ADR-12.
 */
export { runResearch } from "./pipeline/run.js";
export type { RunDeps, ResearchDataset, DatasetCheckpoint } from "./pipeline/run.js";

export { config, MARKET_ES } from "./config.js";
export { canonicalKey, dedupeByCanonical } from "./lib/text.js";

export { getProvider, CachedProvider } from "./dataforseo/index.js";
export { MemTaskLog, NoopTaskLog, payloadHash } from "./dataforseo/task-log.js";
export type { ProviderTaskLog, Reserva } from "./dataforseo/task-log.js";
export type { KeywordDataProvider } from "./dataforseo/provider.js";

export { SCHEMA_VERSION } from "./types.js";
export type {
  KeywordResearchInput,
  KeywordResearchBrief,
  EnrichedKeyword,
  ProposedPage,
  Market,
  DataQuality,
  PageEvidence,
} from "./types.js";
