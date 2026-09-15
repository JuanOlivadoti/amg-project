import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpcionesApi } from "./api-client.js";
import { respuestaTexto } from "./formato.js";
import { listarClientes, verCliente } from "./tools/clientes.js";
import { aprobarRun, listarRuns, verInforme, verRun } from "./tools/runs.js";

/**
 * Arma el servidor MCP con las seis tools de la v1 (spec §5). Función pura respecto del transporte:
 * `index.ts` es lo único que lo conecta a `stdio` — separarlos es lo que permite testear el registro
 * sin abrir un subproceso real.
 */
export function crearServidor(opts: OpcionesApi): McpServer {
  const server = new McpServer({ name: "amg-mcp", version: "0.0.1" });

  server.registerTool(
    "amg_listar_clientes",
    {
      title: "Listar clientes",
      description:
        "Clientes visibles del tenant, con id y nombre. Paso previo OBLIGATORIO antes de usar " +
        "cualquier otra tool que pida un clienteId o runId: nunca adivines un id, siempre resolvelo " +
        "acá primero.",
      inputSchema: {},
    },
    async () => respuestaTexto(await listarClientes(opts)),
  );

  server.registerTool(
    "amg_ver_cliente",
    {
      title: "Ver un cliente",
      description: "Ficha completa de un cliente. clienteId tiene que ser el UUID de amg_listar_clientes.",
      inputSchema: { clienteId: z.string().describe("UUID del cliente, tal como lo devolvió amg_listar_clientes") },
    },
    async ({ clienteId }) => respuestaTexto(await verCliente(opts, clienteId)),
  );

  server.registerTool(
    "amg_listar_runs",
    {
      title: "Listar runs de keyword research",
      description:
        "Runs de un cliente (si se pasa clientId) o de todo el tenant. clientId, si se pasa, tiene " +
        "que ser un UUID de amg_listar_clientes.",
      inputSchema: {
        clientId: z.string().optional().describe("UUID del cliente para filtrar; si se omite, trae los de todo el tenant"),
      },
    },
    async ({ clientId }) => respuestaTexto(await listarRuns(opts, clientId)),
  );

  server.registerTool(
    "amg_ver_run",
    {
      title: "Ver un run",
      description: "El brief, las páginas propuestas y la última decisión de un run. runId de amg_listar_runs.",
      inputSchema: { runId: z.string().describe("UUID del run, de amg_listar_runs") },
    },
    async ({ runId }) => respuestaTexto(await verRun(opts, runId)),
  );

  server.registerTool(
    "amg_ver_informe",
    {
      title: "Ver el informe de un run",
      description: "El informe de keyword research en Markdown, para resumir o cruzar con otros runs.",
      inputSchema: { runId: z.string().describe("UUID del run, de amg_listar_runs") },
    },
    async ({ runId }) => respuestaTexto(await verInforme(opts, runId)),
  );

  server.registerTool(
    "amg_aprobar_run",
    {
      title: "Aprobar un run (ESCRIBE, dispara trabajo real)",
      description:
        "Aprueba un run con un destino. ⚠️ Dispara trabajo real del pipeline, y con destino " +
        "'crear_web' implica GASTO real (DataForSEO, el proveedor de research). No es reversible " +
        "desde acá. destino tiene que ser exactamente 'crear_web', 'solo_informe' o 'crear_posts'.",
      inputSchema: {
        runId: z.string().describe("UUID del run, de amg_listar_runs"),
        destino: z.enum(["crear_web", "solo_informe", "crear_posts"]),
      },
    },
    async ({ runId, destino }) => respuestaTexto(await aprobarRun(opts, runId, destino)),
  );

  return server;
}
