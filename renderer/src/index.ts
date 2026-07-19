/**
 * Punto de entrada del paquete `renderer` (ADR-19): el servicio que sirve las webs de cliente.
 *
 * **No importa nada de `kr-service` ni de `api`.** Lo único que comparte con el resto del sistema
 * es `renderStory()` de `web-builder` (el render, que ya existía y está probado) y `PgSitios` de
 * `db` (el mapa dominio → space). La frontera es estrecha a propósito: este es el proceso más
 * expuesto del sistema, y todo lo que pueda importar es todo lo que puede filtrar.
 */
export { createApp } from "./app.js";
export type { RendererDeps } from "./app.js";

export { CacheRender } from "./cache.js";
export { StoryblokCda, MockCda, ErrorCda, CDA_BASE } from "./cda.js";
export type { Cda, Version, PeticionStory, FetchLike } from "./cda.js";

export { normalizarHost, hostDeLaPeticion } from "./dominio.js";
export { firmarPreview, previewAutorizado, PARAM_FIRMA, PARAM_VENCE } from "./preview.js";
export { firmaValida, parsearEvento, HEADER_FIRMA } from "./webhook.js";

export { crearDeps, leerConfig } from "./deps.js";
export type { ConfigRenderer } from "./deps.js";
