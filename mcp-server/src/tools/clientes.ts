import { llamarApi, type OpcionesApi, type ResultadoLlamada } from "../api-client.js";
import { esUuid } from "../validacion.js";

/** `amg_listar_clientes` — GET /clients. Es el paso previo obligatorio de cualquier escritura (spec §3.4/§5). */
export async function listarClientes(opts: OpcionesApi): Promise<ResultadoLlamada<unknown>> {
  return llamarApi(opts, "/clients");
}

/** `amg_ver_cliente` — GET /clients/:id. `clienteId` tiene que ser el UUID que devolvió `listarClientes`. */
export async function verCliente(opts: OpcionesApi, clienteId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(clienteId)) return { ok: false, mensaje: "clienteId tiene que ser un UUID (usá amg_listar_clientes primero)." };
  return llamarApi(opts, `/clients/${clienteId}`);
}
