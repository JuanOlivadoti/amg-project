import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRON_BARRIDO,
  CRON_POLLING_RESENAS,
  crearFuncionPollingResenas,
  crearFuncionPublicarResena,
  crearFuncionVincularTelegram,
  pollearResenas,
  publicarRespuestaResena,
  vincularTelegramPendientes,
} from "./functions.js";
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
  nombre: string;
}

interface ResenaCrudaFalsa {
  googleReviewId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
}

/** Un cliente conectado, con los cinco campos que espera `store.clientesConectadosGoogle()`. */
function cliente(
  clientId: string,
  tenantId: string,
  locationId: string,
  refreshToken: string,
  nombre = "Negocio de Prueba",
): ClienteConectadoFalso {
  return { clientId, tenantId, locationId, refreshToken, nombre };
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
 * Arma las `Deps` mínimas que necesita `pollearResenas` (`store` + `resenasProvider` +
 * `telegramProvider`) a partir de dobles estructurales. El `PgStore` real es una clase con decenas de
 * métodos ajenos al polling; el `as unknown as` es el mismo patrón que usa `config.test.ts` para
 * `barrerRunsColgados` -- se declara el tipo mínimo acá y se cruza con lo que la función realmente
 * consume.
 *
 * Los tres métodos de Telegram del `store` tienen default (sin pendientes, sin CM vinculado, marca
 * ok) para que los tests que NO ejercitan el bloque de alerta no tengan que declararlos.
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
    resenasPendientesAlertaTelegram?: (clientId: string) => Promise<
      Array<{ googleReviewId: string; tenantId: string; puntuacion: number; autor: string; texto: string | null }>
    >;
    telegramDelAsignado?: (clientId: string) => Promise<string | null>;
    marcarAlertaTelegramEnviada?: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
    }) => Promise<boolean>;
  },
  resenasProvider: {
    refrescarToken: (refreshToken: string) => Promise<string>;
    listarResenas: (accessToken: string, locationId: string) => Promise<ResenaCrudaFalsa[]>;
  },
  borradorProvider?: { generar: (r: ResenaCrudaFalsa) => Promise<string> },
  telegramProvider?: { enviarMensaje: (chatId: string, texto: string) => Promise<void> },
): DepsDePolling {
  return {
    store: {
      guardarBorradorResena: async () => true,
      resenasPendientesAlertaTelegram: async () => [],
      telegramDelAsignado: async () => null,
      marcarAlertaTelegramEnviada: async () => true,
      ...store,
    },
    resenasProvider,
    borradorProvider: borradorProvider ?? { generar: async () => "borrador de prueba" },
    telegramProvider: telegramProvider ?? { enviarMensaje: async () => {} },
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

// ---------------------------------------------------------------- alerta de Telegram (Bloque F, fase 2)

/**
 * El bloque de alerta -- rediseñado (Step 8, decisión de Juan tras el hallazgo 4 de Codex: retry
 * automático, no best-effort perdido). Es un paso INDEPENDIENTE por cliente, así que estos tests no
 * necesitan que `listarResenas` devuelva nada: alcanza con lo que `resenasPendientesAlertaTelegram`
 * reporte.
 */

test("🔴 pendiente + CM con Telegram vinculado: manda el mensaje y marca la alerta enviada", async () => {
  const enviados: Array<{ chatId: string; texto: string }> = [];
  const marcados: Array<{ clientId: string; tenantId: string; googleReviewId: string }> = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok", "La Trattoria")],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async () => [
        { googleReviewId: "gr-1", tenantId: "t1", puntuacion: 2, autor: "Cliente Molesto", texto: "Tardó mucho" },
      ],
      telegramDelAsignado: async () => "chat-555",
      marcarAlertaTelegramEnviada: async (r) => {
        marcados.push(r);
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
    undefined,
    { enviarMensaje: async (chatId, texto) => void enviados.push({ chatId, texto }) },
  );

  await pollearResenas(deps);

  assert.equal(enviados.length, 1);
  assert.equal(enviados[0]!.chatId, "chat-555");
  assert.match(enviados[0]!.texto, /2/, "el texto incluye la puntuación");
  assert.match(enviados[0]!.texto, /Cliente Molesto/, "el texto incluye el autor");
  assert.match(enviados[0]!.texto, /La Trattoria/, "el texto incluye el nombre del CLIENTE (negocio)");
  assert.deepEqual(marcados, [{ clientId: "c1", tenantId: "t1", googleReviewId: "gr-1" }]);
});

test("🔴 sin pendientes, NO se consulta telegramDelAsignado (evita un lookup de más)", async () => {
  let consultado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async () => [],
      telegramDelAsignado: async () => {
        consultado = true;
        return "chat-1";
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
  );

  await pollearResenas(deps);

  assert.equal(consultado, false);
});

test("🔴 hay pendientes pero telegramDelAsignado da null: NO manda ni marca", async () => {
  let enviado = false;
  let marcado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async () => [
        { googleReviewId: "gr-1", tenantId: "t1", puntuacion: 1, autor: "A", texto: null },
      ],
      telegramDelAsignado: async () => null,
      marcarAlertaTelegramEnviada: async () => {
        marcado = true;
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
    undefined,
    { enviarMensaje: async () => void (enviado = true) },
  );

  await pollearResenas(deps);

  assert.equal(enviado, false);
  assert.equal(marcado, false);
});

/**
 * 🔴 EL CASO CENTRAL del hallazgo 4 de Codex: si `enviarMensaje` lanza, `marcarAlertaTelegramEnviada`
 * NUNCA se llama para esa reseña -- si se llamara, la próxima corrida ya no la reintentaría, que es
 * exactamente el bug que motivó el rediseño (Step 8). El polling NO aborta: una segunda pendiente del
 * mismo lote también se intenta.
 *
 * Verificación por mutación: comentar el `try/catch` interno del `for` de pendientes (dejar que
 * `enviarMensaje` propague) hace que este test caiga con la excepción sin atrapar.
 */
test("🔴 enviarMensaje lanza: NUNCA marca la alerta enviada, y sigue con la próxima pendiente", async () => {
  const marcados: string[] = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async () => [
        { googleReviewId: "gr-falla", tenantId: "t1", puntuacion: 1, autor: "A", texto: null },
        { googleReviewId: "gr-ok", tenantId: "t1", puntuacion: 2, autor: "B", texto: null },
      ],
      telegramDelAsignado: async () => "chat-1",
      marcarAlertaTelegramEnviada: async (r) => {
        marcados.push(r.googleReviewId);
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
    undefined,
    {
      enviarMensaje: async (_chatId, texto) => {
        if (texto.includes("A")) throw new Error("Telegram caído");
      },
    },
  );

  await assert.doesNotReject(() => pollearResenas(deps));

  assert.deepEqual(marcados, ["gr-ok"], "gr-falla NO se marca; gr-ok, la segunda del lote, sí se intenta y marca");
});

test("🔴 dos clientes, uno con resenasPendientesAlertaTelegram que lanza: el otro se sigue procesando", async () => {
  const marcados: string[] = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [
        cliente("c-roto", "t1", "l1", "tok"),
        cliente("c-ok", "t1", "l2", "tok"),
      ],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async (clientId) => {
        if (clientId === "c-roto") throw new Error("store caído");
        return [{ googleReviewId: "gr-1", tenantId: "t1", puntuacion: 1, autor: "A", texto: null }];
      },
      telegramDelAsignado: async () => "chat-1",
      marcarAlertaTelegramEnviada: async (r) => {
        marcados.push(r.clientId);
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
  );

  await pollearResenas(deps);

  assert.deepEqual(marcados, ["c-ok"], "el cliente roto no frena la alerta del otro");
});

test("🔴 una reseña de más de 3500 caracteres llega truncada, con '…' final", async () => {
  const largo = "x".repeat(4000);
  const enviados: string[] = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      resenasPendientesAlertaTelegram: async () => [
        { googleReviewId: "gr-1", tenantId: "t1", puntuacion: 1, autor: "A", texto: largo },
      ],
      telegramDelAsignado: async () => "chat-1",
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [] },
    undefined,
    { enviarMensaje: async (_chatId, texto) => void enviados.push(texto) },
  );

  await pollearResenas(deps);

  assert.equal(enviados.length, 1);
  const textoEnviado = enviados[0]!;
  // El texto de la reseña dentro del mensaje: el bloque entre comillas.
  const match = /"([^"]*)"/.exec(textoEnviado);
  assert.ok(match, "el mensaje tiene que llevar el texto de la reseña entre comillas");
  const textoResena = match![1]!;
  assert.equal(textoResena.length, 3501, "3500 caracteres + el '…' final");
  assert.ok(textoResena.endsWith("…"));
});

// ---------------------------------------------------------------- vincular Telegram (Bloque F, fase 2)

type DepsDeVincular = Parameters<typeof vincularTelegramPendientes>[0];

function depsDeVincular(
  store: {
    offsetTelegramActual: () => Promise<number>;
    vincularTelegramPorCodigo: (codigo: string, chatId: string) => Promise<boolean>;
    avanzarOffsetTelegram: (nuevoOffset: number) => Promise<number | void>;
  },
  telegramProvider: {
    obtenerActualizaciones: (offset: number) => Promise<{
      maxUpdateId: number | null;
      mensajes: Array<{ updateId: number; texto: string; chatId: string }>;
    }>;
  },
): DepsDeVincular {
  return { store, telegramProvider } as unknown as DepsDeVincular;
}

test("🔴 un /start <código> válido vincula y avanza el offset a update_id + 1", async () => {
  const vinculados: Array<{ codigo: string; chatId: string }> = [];
  let offsetNuevo: number | null = null;
  const deps = depsDeVincular(
    {
      offsetTelegramActual: async () => 5,
      vincularTelegramPorCodigo: async (codigo, chatId) => {
        vinculados.push({ codigo, chatId });
        return true;
      },
      avanzarOffsetTelegram: async (n) => {
        offsetNuevo = n;
      },
    },
    {
      obtenerActualizaciones: async () => ({
        maxUpdateId: 10,
        mensajes: [{ updateId: 10, texto: "/start abc123", chatId: "chat-1" }],
      }),
    },
  );

  const r = await vincularTelegramPendientes(deps);

  assert.equal(r.vinculados, 1);
  assert.deepEqual(vinculados, [{ codigo: "abc123", chatId: "chat-1" }]);
  assert.equal(offsetNuevo, 11);
});

test("🔴 un texto que no matchea el patrón NO vincula, pero SÍ avanza el offset (no se reprocesa para siempre)", async () => {
  let vinculadoLlamado = false;
  let offsetNuevo: number | null = null;
  const deps = depsDeVincular(
    {
      offsetTelegramActual: async () => 0,
      vincularTelegramPorCodigo: async () => {
        vinculadoLlamado = true;
        return true;
      },
      avanzarOffsetTelegram: async (n) => {
        offsetNuevo = n;
      },
    },
    {
      obtenerActualizaciones: async () => ({
        maxUpdateId: 3,
        mensajes: [
          { updateId: 2, texto: "hola", chatId: "chat-1" },
          { updateId: 3, texto: "/start", chatId: "chat-2" }, // sin código
        ],
      }),
    },
  );

  const r = await vincularTelegramPendientes(deps);

  assert.equal(r.vinculados, 0);
  assert.equal(vinculadoLlamado, false);
  assert.equal(offsetNuevo, 4, "el offset avanza igual: el mensaje descartado no se reprocesa para siempre");
});

test("🔴 sin actualizaciones nuevas, NO llama a avanzarOffsetTelegram (evita una escritura de más)", async () => {
  let avanzarLlamado = false;
  const deps = depsDeVincular(
    {
      offsetTelegramActual: async () => 7,
      vincularTelegramPorCodigo: async () => true,
      avanzarOffsetTelegram: async () => {
        avanzarLlamado = true;
      },
    },
    { obtenerActualizaciones: async () => ({ maxUpdateId: null, mensajes: [] }) },
  );

  await vincularTelegramPendientes(deps);

  assert.equal(avanzarLlamado, false);
});

/**
 * 🔴 El offset avanza al MAYOR `update_id` del lote, no al del último mensaje ÚTIL del array (si
 * llegaran desordenados) -- y `maxUpdateId` ya lo calcula el provider, así que acá alcanza con
 * comprobar que `vincularTelegramPendientes` USA ese valor y no el `updateId` de un mensaje puntual.
 */
test("🔴 el offset avanza según maxUpdateId, no según el último mensaje del array", async () => {
  let offsetNuevo: number | null = null;
  const deps = depsDeVincular(
    {
      offsetTelegramActual: async () => 0,
      vincularTelegramPorCodigo: async () => true,
      avanzarOffsetTelegram: async (n) => {
        offsetNuevo = n;
      },
    },
    {
      obtenerActualizaciones: async () => ({
        maxUpdateId: 9, // el mayor real del lote (por ejemplo, un update sin texto no listado en mensajes)
        mensajes: [{ updateId: 4, texto: "/start x", chatId: "c1" }], // el ÚLTIMO/ÚNICO mensaje útil trae un id MENOR
      }),
    },
  );

  await vincularTelegramPendientes(deps);

  assert.equal(offsetNuevo, 10, "10 = maxUpdateId(9) + 1, NO updateId(4) + 1 del mensaje útil");
});

test("🔴 la fábrica produce una función con id propio, con 'telegram' en el nombre", () => {
  const deps = {} as Deps;
  const fn = crearFuncionVincularTelegram(deps);
  assert.match(fn.id(), /telegram/);
});

// ---------------------------------------------------------------- publicar la respuesta (Bloque F, fase 2, segunda pieza)

/**
 * `publicarRespuestaResena` — mismo criterio de test que `pollearResenas`: la lógica se prueba con un
 * `store`/`resenasProvider` falsos, sin levantar Inngest ni PGlite. La comprobación de RLS y el WHERE
 * que decide si la solicitud sigue vigente ya los cubrió la Task 1 (`db`); acá lo único que importa
 * es que la función pura llame a las piezas correctas, en el orden correcto, y no se trague errores.
 */

type DepsDePublicar = Parameters<typeof publicarRespuestaResena>[0];

interface ResenaParaPublicarFalsa {
  clientId: string;
  tenantId: string;
  googleReviewId: string;
  borrador: string;
  locationId: string;
  refreshToken: string;
}

function resenaParaPublicarFalsa(overrides: Partial<ResenaParaPublicarFalsa> = {}): ResenaParaPublicarFalsa {
  return {
    clientId: "c1",
    tenantId: "t1",
    googleReviewId: "review-1",
    borrador: "Gracias por tu reseña",
    locationId: "loc-1",
    refreshToken: "refresh-tok",
    ...overrides,
  };
}

function depsDePublicar(
  store: {
    resenaParaPublicar: (resenaId: string) => Promise<ResenaParaPublicarFalsa | null>;
    marcarRespuestaPublicada: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
    }) => Promise<boolean>;
  },
  resenasProvider: {
    refrescarToken: (refreshToken: string) => Promise<string>;
    publicarRespuesta: (
      accessToken: string,
      locationId: string,
      googleReviewId: string,
      texto: string,
    ) => Promise<void>;
  },
): DepsDePublicar {
  return { store, resenasProvider } as unknown as DepsDePublicar;
}

test("publicarRespuestaResena: con info válida, refresca el token, publica con los 4 argumentos correctos y confirma", async () => {
  const llamadas: string[] = [];
  let publicarArgs: [string, string, string, string] | null = null;
  let marcarArgs: { clientId: string; tenantId: string; googleReviewId: string } | null = null;

  const deps = depsDePublicar(
    {
      resenaParaPublicar: async (resenaId) => {
        llamadas.push(`resenaParaPublicar(${resenaId})`);
        return resenaParaPublicarFalsa();
      },
      marcarRespuestaPublicada: async (r) => {
        llamadas.push("marcarRespuestaPublicada");
        marcarArgs = r;
        return true;
      },
    },
    {
      refrescarToken: async (refreshToken) => {
        llamadas.push(`refrescarToken(${refreshToken})`);
        return "access-desde-refresh-tok";
      },
      publicarRespuesta: async (accessToken, locationId, googleReviewId, texto) => {
        llamadas.push("publicarRespuesta");
        publicarArgs = [accessToken, locationId, googleReviewId, texto];
      },
    },
  );

  const resultado = await publicarRespuestaResena(deps, "resena-1");

  assert.deepEqual(resultado, { publicada: true });
  assert.deepEqual(
    llamadas,
    ["resenaParaPublicar(resena-1)", "refrescarToken(refresh-tok)", "publicarRespuesta", "marcarRespuestaPublicada"],
    "el orden importa: primero se relocaliza, después se refresca, después se publica, después se confirma",
  );
  assert.deepEqual(publicarArgs, ["access-desde-refresh-tok", "loc-1", "review-1", "Gracias por tu reseña"]);
  assert.deepEqual(marcarArgs, { clientId: "c1", tenantId: "t1", googleReviewId: "review-1" });
});

/**
 * 🔴 Cero filas = la solicitud ya no aplica (ADR-18: el evento no porta autoridad, la base decide).
 * No es un error: no debe intentar refrescar token, ni publicar, ni confirmar nada.
 */
test("🔴 resenaParaPublicar devuelve null: no llama a NINGÚN otro método, y devuelve {publicada: false}", async () => {
  let otroMetodoLlamado = false;
  const deps = depsDePublicar(
    { resenaParaPublicar: async () => null, marcarRespuestaPublicada: async () => { otroMetodoLlamado = true; return true; } },
    {
      refrescarToken: async () => { otroMetodoLlamado = true; return "no-deberia-pasar"; },
      publicarRespuesta: async () => { otroMetodoLlamado = true; },
    },
  );

  const resultado = await publicarRespuestaResena(deps, "resena-inexistente");

  assert.deepEqual(resultado, { publicada: false });
  assert.equal(otroMetodoLlamado, false, "la solicitud ya no aplica: no se toca ni el provider ni el store de nuevo");
});

test("🔴 marcarRespuestaPublicada devuelve false (carrera): no lanza, devuelve {publicada: false} y loguea", async () => {
  const deps = depsDePublicar(
    { resenaParaPublicar: async () => resenaParaPublicarFalsa(), marcarRespuestaPublicada: async () => false },
    { refrescarToken: async () => "access-ok", publicarRespuesta: async () => {} },
  );

  const dicho: string[] = [];
  const resultado = await publicarRespuestaResena(deps, "resena-1", (m) => dicho.push(m));

  assert.deepEqual(resultado, { publicada: false });
  assert.ok(
    dicho.some((m) => m.includes("resena-1")),
    `tiene que loguear que la confirmación no pisó nada. Logueado: ${JSON.stringify(dicho)}`,
  );
});

test("🔴 un error de refrescarToken SE PROPAGA (no se traga, a diferencia de pollearResenas)", async () => {
  const deps = depsDePublicar(
    { resenaParaPublicar: async () => resenaParaPublicarFalsa(), marcarRespuestaPublicada: async () => true },
    {
      refrescarToken: async () => { throw new Error("refresh token revocado"); },
      publicarRespuesta: async () => {},
    },
  );

  await assert.rejects(() => publicarRespuestaResena(deps, "resena-1"), /refresh token revocado/);
});

test("🔴 un error de publicarRespuesta SE PROPAGA (no se traga)", async () => {
  const deps = depsDePublicar(
    { resenaParaPublicar: async () => resenaParaPublicarFalsa(), marcarRespuestaPublicada: async () => true },
    {
      refrescarToken: async () => "access-ok",
      publicarRespuesta: async () => { throw new Error("Google devolvió 500"); },
    },
  );

  await assert.rejects(() => publicarRespuestaResena(deps, "resena-1"), /Google devolvió 500/);
});

test("🔴 la fábrica produce una función con id propio, distinta de las demás", () => {
  const deps = {} as Deps;
  const fn = crearFuncionPublicarResena(deps);

  assert.match(fn.id(), /publicar/);
  assert.match(fn.id(), /resena/i);
});
