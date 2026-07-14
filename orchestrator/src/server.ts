import { createServer } from "node:http";
import { serve } from "inngest/node";
import { crearDeps, crearConexiones } from "./deps.js";
import { crearFuncionResearch, inngest } from "./functions.js";

/**
 * Expone las funciones del orquestador para que Inngest las invoque.
 *
 * En desarrollo: `npx inngest-cli dev -u http://localhost:3100/api/inngest` levanta el runtime
 * local (con su panel para ver los runs, los steps y reintentarlos a mano). Sin `DATABASE_URL` y
 * sin credenciales de proveedor, el sistema entero corre igual: PGlite en memoria y los providers
 * mock. Es el mismo principio que ya rige en `kr-service` y `web-builder`.
 */
const PUERTO = Number(process.env["PORT"] ?? 3100);

const cx = await crearConexiones();
const deps = crearDeps(cx);
const funciones = [crearFuncionResearch(deps)];

const handler = serve({ client: inngest, functions: funciones });

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/inngest")) {
    void handler(req, res);
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PUERTO, () => {
  console.log(`▶ Orquestador escuchando en http://localhost:${PUERTO}/api/inngest`);
  console.log(`  Funciones: ${funciones.length}`);
});

const apagar = async () => {
  server.close();
  await cx.cerrar();
  process.exit(0);
};
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);
