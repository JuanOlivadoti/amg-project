/**
 * Punto de entrada del paquete `web-builder` (Módulo 1 — Creador de Webs).
 *
 * **No importa NADA de `kr-service`** (ADR-06/07). La frontera entre el M2 y el M1 es el brief JSON
 * validado con Zod (`parseBrief`), no un `import`. Quien los une es el orquestador.
 */
export { parseBrief, parseProfile, SUPPORTED_SCHEMA_VERSIONS } from "./contract.js";
export { briefToStories, pageToStory } from "./handoff/adapter.js";
export { renderStory } from "./render/html.js";
export { fromStoryblokContent } from "./storyblok/content.js";
export { getPublisher } from "./publish/publisher.js";
export type { Publisher, PublishResult } from "./publish/publisher.js";
export { applyProse, loadProfile } from "./enrich.js";
export { config } from "./config.js";
export type { KrBrief, KrProposedPage, BusinessProfile, Story, Blok } from "./types.js";
