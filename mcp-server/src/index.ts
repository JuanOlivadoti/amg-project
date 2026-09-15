import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpcionesApi } from "./api-client.js";
import { crearServidor } from "./server.js";

/**
 * El punto de entrada que Claude Desktop arranca como subproceso (transporte `stdio`). Lee toda su
 * configuración de variables de entorno (spec §4) — nada hardcodeado, nada de argv.
 *
 * `AMG_API_URL` apunta al `dev-server` local (`http://localhost:3000`) hasta que el circuito completo
 * esté probado contra Claude Desktop real; apuntar a producción es después, cambiando una variable.
 */
function leerOpciones(): OpcionesApi {
  const apiUrl = process.env["AMG_API_URL"];
  const supabaseUrl = process.env["AMG_SUPABASE_URL"];
  const anonKey = process.env["AMG_SUPABASE_ANON_KEY"];
  const faltan = [
    !apiUrl && "AMG_API_URL",
    !supabaseUrl && "AMG_SUPABASE_URL",
    !anonKey && "AMG_SUPABASE_ANON_KEY",
  ].filter((x): x is string => Boolean(x));
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(", ")}. Ver mcp-server/README.md.`);
  }
  return { apiUrl: apiUrl as string, supabaseUrl: supabaseUrl as string, anonKey: anonKey as string };
}

async function main(): Promise<void> {
  const server = crearServidor(leerOpciones());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e: unknown) => {
  // stdout está tomado por el protocolo JSON-RPC (spec §3.2) — cualquier log de arranque va a
  // stderr, nunca a console.log.
  console.error(`[mcp-server] ${(e as Error).message}`);
  process.exit(1);
});
