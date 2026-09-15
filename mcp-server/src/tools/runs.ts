import { llamarApi, type OpcionesApi, type ResultadoLlamada } from "../api-client.js";
import { esUuid } from "../validacion.js";

/** `amg_listar_runs` — GET /runs, opcionalmente filtrado por cliente. */
export async function listarRuns(opts: OpcionesApi, clientId?: string): Promise<ResultadoLlamada<unknown>> {
  if (clientId !== undefined && !esUuid(clientId)) {
    return { ok: false, mensaje: "clientId tiene que ser un UUID (usá amg_listar_clientes primero)." };
  }
  return llamarApi(opts, clientId ? `/runs?clientId=${clientId}` : "/runs");
}

/** `amg_ver_run` — GET /runs/:id. Trae el brief, las páginas propuestas y la última decisión. */
export async function verRun(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  return llamarApi(opts, `/runs/${runId}`);
}

/** `amg_ver_informe` — GET /runs/:id/informe. El informe legible de keyword research. */
export async function verInforme(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  return llamarApi(opts, `/runs/${runId}/informe`);
}

/** El enum cerrado que acepta `POST /runs/:id/approve` (`api/src/app.ts:526`). */
export type Destino = "crear_web" | "solo_informe" | "crear_posts";

const DESTINOS: readonly Destino[] = ["crear_web", "solo_informe", "crear_posts"];

export function esDestinoValido(v: string): v is Destino {
  return (DESTINOS as readonly string[]).includes(v);
}

/**
 * `amg_aprobar_run` — POST /runs/:id/approve. La ÚNICA tool de escritura de la v1 (spec §5): dispara
 * trabajo real del pipeline y, con `destino: "crear_web"`, gasto real. Valida `runId` (UUID) y
 * `destino` (el enum cerrado) ANTES de llamar — la API los vuelve a validar igual (defensa en
 * profundidad, no un reemplazo).
 */
export async function aprobarRun(opts: OpcionesApi, runId: string, destino: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  if (!esDestinoValido(destino)) {
    return { ok: false, mensaje: "destino tiene que ser 'crear_web', 'solo_informe' o 'crear_posts'." };
  }
  return llamarApi(opts, `/runs/${runId}/approve`, { method: "POST", body: { destino } });
}
