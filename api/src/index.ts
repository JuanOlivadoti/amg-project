/**
 * Punto de entrada del paquete `api`. Lo público: crear la app (para tests y para `server.ts`), y
 * las piezas que se inyectan.
 */
export { createApp } from "./app.js";
export type { ApiDeps } from "./app.js";
export { autenticar, verificadorSupabase, TENANT_HEADER } from "./auth.js";
export type { VerificadorToken, Variables } from "./auth.js";
export { solicitarResearch } from "./solicitar.js";
export type { EmisorEventos, PeticionResearch } from "./solicitar.js";
export { crearDeps, leerConfig } from "./deps.js";
export type { ConfigApi } from "./deps.js";
