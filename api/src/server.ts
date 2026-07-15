import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { crearDeps, leerConfig } from "./deps.js";

/** Punto de entrada del servicio. Larga duración (no serverless): ver etapa 5.3 del plan. */
const config = leerConfig();
const { deps, cerrar } = await crearDeps(config);
const app = createApp(deps);

const port = Number(process.env["PORT"] ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`▶ API AMG escuchando en http://localhost:${info.port}`);
});

// Cierre ordenado: soltar el pool de Postgres para no dejar conexiones colgadas.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void cerrar().then(() => process.exit(0));
  });
}
