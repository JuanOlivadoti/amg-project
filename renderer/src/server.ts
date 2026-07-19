import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { crearDeps, leerConfig } from "./deps.js";

/** Punto de entrada del renderizador público (ADR-19). Un proceso, N dominios de cliente. */
const config = leerConfig();
const { deps, cerrar } = await crearDeps(config);
const app = createApp(deps);

const port = Number(process.env["PORT"] ?? 8080);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`▶ Renderizador AMG escuchando en http://localhost:${info.port}`);
  console.log(`  preview: ${deps.previewSecret ? "activo" : "DESACTIVADO (sin PREVIEW_SECRET)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void cerrar().then(() => process.exit(0));
  });
}
