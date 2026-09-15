import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpcionesApi } from "./api-client.js";
import { crearServidor } from "./server.js";

const OPTS_DE_PRUEBA: OpcionesApi = {
  apiUrl: "http://localhost:3000",
  supabaseUrl: "https://x.supabase.co",
  anonKey: "k",
};

test("crearServidor registra las seis tools del spec §5, ni una más ni una menos", async () => {
  const server = crearServidor(OPTS_DE_PRUEBA);
  // `_registeredTools` es un detalle de implementación del SDK, pero es el único gancho síncrono
  // para verificar el registro sin levantar un transporte real. Si el SDK cambia esta forma interna,
  // este test es el primero en avisarlo — que es justo lo que tiene que pasar.
  const nombres = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
  assert.deepEqual(
    nombres.sort(),
    [
      "amg_aprobar_run",
      "amg_listar_clientes",
      "amg_listar_runs",
      "amg_ver_cliente",
      "amg_ver_informe",
      "amg_ver_run",
    ],
  );
});
