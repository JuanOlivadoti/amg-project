import { test } from "node:test";
import assert from "node:assert/strict";
import { CRON_BARRIDO, CRON_POLLING_RESENAS, crearFuncionPollingResenas, pollearResenas } from "./functions.js";
import type { Deps } from "./workflow.js";

/**
 * `pollearResenas` — mismo criterio de test que `barrerRunsColgados` en `config.test.ts`: la lógica
 * se prueba con un `store`/`resenasProvider` falsos, sin levantar Inngest. La función de Inngest
 * (`crearFuncionPollingResenas`) es un adaptador fino; lo que hay que cubrir de verdad vive acá.
 */

type DepsDePolling = Parameters<typeof pollearResenas>[0];

interface ClienteConectadoFalso {
  clientId: string;
  tenantId: string;
  locationId: string;
  refreshToken: string;
}

interface ResenaCrudaFalsa {
  googleReviewId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
}

/** Un cliente conectado, con los cuatro campos que espera `store.clientesConectadosGoogle()`. */
function cliente(clientId: string, tenantId: string, locationId: string, refreshToken: string): ClienteConectadoFalso {
  return { clientId, tenantId, locationId, refreshToken };
}

/** Una reseña cruda mínima, tal como la devolvería el proveedor. */
function resenaCruda(googleReviewId: string): ResenaCrudaFalsa {
  return {
    googleReviewId,
    puntuacion: 5,
    autor: "A",
    texto: null,
    publicadaEn: new Date().toISOString(),
  };
}

/**
 * Arma las `Deps` mínimas que necesita `pollearResenas` (`store` + `resenasProvider`) a partir de
 * dobles estructurales. El `PgStore` real es una clase con decenas de métodos ajenos al polling; el
 * `as unknown as` es el mismo patrón que usa `config.test.ts` para `barrerRunsColgados` -- se
 * declara el tipo mínimo acá y se cruza con lo que la función realmente consume.
 */
function depsDePolling(
  store: {
    clientesConectadosGoogle: () => Promise<ClienteConectadoFalso[]>;
    registrarResenaGoogle: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
      puntuacion: number;
      autor: string;
      texto: string | null;
      publicadaEn: string;
    }) => Promise<boolean>;
    guardarBorradorResena?: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
      borrador: string;
    }) => Promise<boolean>;
  },
  resenasProvider: {
    refrescarToken: (refreshToken: string) => Promise<string>;
    listarResenas: (accessToken: string, locationId: string) => Promise<ResenaCrudaFalsa[]>;
  },
  borradorProvider?: { generar: (r: ResenaCrudaFalsa) => Promise<string> },
): DepsDePolling {
  return {
    store: { guardarBorradorResena: async () => true, ...store },
    resenasProvider,
    borradorProvider: borradorProvider ?? { generar: async () => "borrador de prueba" },
  } as unknown as DepsDePolling;
}

test("🔴 un cliente con refrescarToken que lanza no frena el polling de los demás", async () => {
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [
        cliente("c1", "t1", "l1", "malo"),
        cliente("c2", "t1", "l2", "bueno"),
      ],
      registrarResenaGoogle: async () => true,
    },
    {
      refrescarToken: async (tok) => {
        if (tok === "malo") throw new Error("revocado");
        return "access-ok";
      },
      listarResenas: async () => [resenaCruda("r1")],
    },
  );

  const r = await pollearResenas(deps);

  assert.equal(r.clientesRecorridos, 2);
  assert.equal(r.fallidos, 1, "el cliente con el token malo cuenta como fallido");
  assert.equal(r.resenasNuevas, 1, "el cliente bueno igual escribió su reseña");
});

/**
 * 🔴 `resenasNuevas` cuenta lo que `registrarResenaGoogle` de verdad INSERTÓ, no lo que el proveedor
 * devolvió.
 *
 * `registrarResenaGoogle` hace `on conflict do nothing` y devuelve `false` cuando la reseña ya
 * existía (Task 2). Si `pollearResenas` contara `crudas.length` en vez de sumar el booleano de cada
 * inserción, correr el polling dos veces sobre las mismas reseñas reportaría "2 reseñas nuevas" la
 * segunda vez también -- exactamente la mentira que la idempotencia existe para evitar. Acá se
 * fuerza el caso: el proveedor devuelve DOS reseñas, pero el store dice que UNA ya existía.
 */
test("🔴 resenasNuevas refleja el retorno real de registrarResenaGoogle, no el total de reseñas listadas", async () => {
  const yaExistian = new Set(["ya-estaba"]);
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "bueno")],
      registrarResenaGoogle: async (r) => !yaExistian.has(r.googleReviewId),
    },
    {
      refrescarToken: async () => "access-ok",
      listarResenas: async () => [resenaCruda("ya-estaba"), resenaCruda("nueva")],
    },
  );

  const r = await pollearResenas(deps);

  assert.equal(r.clientesRecorridos, 1);
  assert.equal(r.fallidos, 0);
  assert.equal(
    r.resenasNuevas,
    1,
    "el proveedor listó 2, pero solo 1 se insertó de verdad -- el conteo tiene que ser 1, no 2",
  );
});

test("🔴 sin clientes conectados, igual dice algo (si no, no se distingue de un cron muerto)", async () => {
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [],
      registrarResenaGoogle: async () => true,
    },
    {
      refrescarToken: async () => "access-ok",
      listarResenas: async () => [],
    },
  );

  const dicho: string[] = [];
  const r = await pollearResenas(deps, (m) => dicho.push(m));

  assert.equal(r.clientesRecorridos, 0);
  assert.equal(r.resenasNuevas, 0);
  assert.equal(r.fallidos, 0);
  assert.equal(dicho.length, 1, "una línea, siempre -- misma disciplina que el barrido");
  assert.match(dicho[0]!, /0 clientes conectados/);
});

test("🔴 un cliente fallido se loguea con su tenantId (sin él no se puede rastrear)", async () => {
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c-roto", "tenant-9", "l1", "malo")],
      registrarResenaGoogle: async () => true,
    },
    {
      refrescarToken: async () => {
        throw new Error("revocado por el usuario");
      },
      listarResenas: async () => [],
    },
  );

  const dicho: string[] = [];
  await pollearResenas(deps, (m) => dicho.push(m));

  assert.ok(
    dicho.some((m) => m.includes("c-roto") && m.includes("tenant-9")),
    `el log tiene que nombrar cliente y tenant. Logueado: ${JSON.stringify(dicho)}`,
  );
});

test("🔴 CRON_POLLING_RESENAS es una constante propia, distinta de CRON_BARRIDO", () => {
  assert.notEqual(CRON_POLLING_RESENAS, CRON_BARRIDO);
  assert.equal(CRON_POLLING_RESENAS.split(/\s+/).length, 5, "cinco campos, el formato que Inngest espera");
});

test("🔴 la fábrica produce una función con id propio, distinta de las demás", () => {
  const deps = {} as Deps;
  const fn = crearFuncionPollingResenas(deps);

  assert.match(fn.id(), /polling/);
  assert.match(fn.id(), /resenas/i);
});

// ---------------------------------------------------------------- borrador de IA (Bloque F, fase 2)

test("🔴 genera y guarda el borrador para una reseña 5★ nueva", async () => {
  const guardados: Array<{ googleReviewId: string; borrador: string }> = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      guardarBorradorResena: async (r) => {
        guardados.push({ googleReviewId: r.googleReviewId, borrador: r.borrador });
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r5"), puntuacion: 5 }] },
    { generar: async () => "Gracias por tu reseña" },
  );

  await pollearResenas(deps);

  assert.deepEqual(guardados, [{ googleReviewId: "r5", borrador: "Gracias por tu reseña" }]);
});

test("🔴 NO genera borrador para una reseña de 1-3★", async () => {
  let generarLlamado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r2"), puntuacion: 2 }] },
    { generar: async () => { generarLlamado = true; return "no debería pasar"; } },
  );

  await pollearResenas(deps);

  assert.equal(generarLlamado, false, "🔴 el PRD prohíbe IA para 1-3★, ni siquiera se intenta");
});

test("🔴 NO genera borrador para una reseña que el polling ya había visto (insertada = false)", async () => {
  let generarLlamado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => false, // ya existía
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r5-vieja"), puntuacion: 5 }] },
    { generar: async () => { generarLlamado = true; return "no debería pasar"; } },
  );

  await pollearResenas(deps);

  assert.equal(generarLlamado, false, "reseña ya vista: no se re-genera un borrador");
});

test("🔴 un fallo del BorradorProvider en una reseña no frena el resto del mismo cliente", async () => {
  const guardados: string[] = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      guardarBorradorResena: async (r) => {
        guardados.push(r.googleReviewId);
        return true;
      },
    },
    {
      refrescarToken: async () => "access-ok",
      listarResenas: async () => [
        { ...resenaCruda("r-1"), puntuacion: 5 },
        { ...resenaCruda("r-2"), puntuacion: 5 },
        { ...resenaCruda("r-3"), puntuacion: 5 },
      ],
    },
    {
      generar: async (r) => {
        if (r.googleReviewId === "r-2") throw new Error("OpenAI caído");
        return "ok";
      },
    },
  );

  const resultado = await pollearResenas(deps);

  assert.deepEqual(guardados, ["r-1", "r-3"], "r-2 falló, pero r-1 y r-3 igual guardaron su borrador");
  assert.equal(resultado.fallidos, 0, "un fallo de borrador NO cuenta como cliente fallido");
});

test("🔴 un fallo del BorradorProvider se loguea con el id de la reseña y del cliente", async () => {
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c-x", "t-y", "l1", "tok")],
      registrarResenaGoogle: async () => true,
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r-falla"), puntuacion: 5 }] },
    { generar: async () => { throw new Error("timeout"); } },
  );

  const dicho: string[] = [];
  await pollearResenas(deps, (m) => dicho.push(m));

  assert.ok(
    dicho.some((m) => m.includes("r-falla") && m.includes("c-x")),
    `el log tiene que nombrar la reseña y el cliente. Logueado: ${JSON.stringify(dicho)}`,
  );
});
