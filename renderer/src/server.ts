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
  // Se imprime SIEMPRE, también cuando no hay dominio de demo. Un `DOMINIO_PREVIEW` mal escrito no da
  // error en ninguna parte: simplemente no casa con ningún host y la demo se indexa igual. Esta línea
  // es lo único que convierte ese fallo silencioso en algo que se ve al arrancar.
  console.log(`  noindex de demo: ${deps.dominioPreview ? `*.${deps.dominioPreview}` : "ninguno (sin DOMINIO_PREVIEW)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void cerrar().then(() => process.exit(0));
  });
}
