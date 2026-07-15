import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * EL TEST QUE NO EXISTÍA — y su ausencia es la explicación de casi todo lo demás.
 *
 * Había 199 tests y **ninguno instanciaba `DataForSeoClient`**. Se probaban `MemTaskLog` y
 * `PgTaskLog` por separado, muy a fondo… y nadie probaba **la costura**: que el POST facturable pase
 * de verdad por el registro de idempotencia.
 *
 * La consecuencia, medida: quitar el `taskLog` del cliente (o pasar `new LiveProvider()` sin él)
 * **dejaba los 199 tests en verde** y todos los POST de producción sin idempotencia. El sistema
 * entero de ADR-14 estaba probado en las piezas y no donde importa.
 *
 * Es exactamente el error que ya había cometido —y criticado— en el test de concurrencia: **probar
 * lo que es fácil de afirmar en vez de lo que puede romperse.** Por eso acá no se asserta ningún
 * estado interno del registro: se cuenta **cuántos POST facturables salieron a la red**. Es lo único
 * que se traduce en dinero.
 *
 * `config` se congela al importarse, y su `isSandbox` decide si el registro se usa. Por eso el
 * entorno se fija ANTES del import dinámico: sin esto, el test correría como sandbox y no probaría
 * nada (el sandbox se salta el registro a propósito, porque es gratis).
 */

process.env["DATAFORSEO_BASE_URL"] = "https://api.dataforseo.com"; // producción: el registro se activa
process.env["DATAFORSEO_LOGIN"] = "test";
process.env["DATAFORSEO_PASSWORD"] = "test";
process.env["DFS_PERMITIR_REPAGO"] = ""; // el default seguro: una petición ambigua NO se reenvía

const { DataForSeoClient, PeticionAmbiguaError } = await import("./client.js");
const { MemTaskLog } = await import("./task-log.js");

const PATH = "/v3/keywords_data/google_ads/search_volume/live";

/** Cuenta los POST que llegaron a la red. Es la unidad en la que DataForSEO factura. */
let postsALaRed: Array<{ url: string; body: unknown }> = [];
let fetchOriginal: typeof globalThis.fetch;

/** Respuesta válida de DataForSEO, con su `cost`: esto es lo que significa "se cobró". */
function respuestaOk(cost = 0.0075) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [
        {
          id: "t1",
          cost,
          status_code: 20000,
          result: [{ items: [{ keyword: "pizza", search_volume: 390 }] }],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  postsALaRed = [];
  fetchOriginal = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Instala un `fetch` que registra cada POST y devuelve lo que se le diga. */
function stubFetch(responder: (n: number) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    postsALaRed.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return responder(postsALaRed.length);
  }) as typeof globalThis.fetch;
}

// ================================================================

/**
 * LA MUTACIÓN QUE ESTE TEST EXISTE PARA MATAR:
 *
 *   quitar `taskLog.reservar()` de `DataForSeoClient.post()`  →  este test tiene que caer.
 *
 * Si cae, la idempotencia del gasto está viva. Si pasa igual, no lo está.
 */
test("🔴 el POST facturable PASA por el registro: la segunda petición idéntica NO llega a la red", async () => {
  stubFetch(() => respuestaOk());
  const log = new MemTaskLog();

  const c1 = new DataForSeoClient(log);
  await c1.post(PATH, { keywords: ["pizza", "pasta"] });
  assert.equal(postsALaRed.length, 1, "la primera sí se paga");

  // Otro proceso (otro cliente, mismo registro) pide EXACTAMENTE lo mismo.
  const c2 = new DataForSeoClient(log);
  const res = await c2.post(PATH, { keywords: ["pizza", "pasta"] });

  assert.equal(postsALaRed.length, 1, "la segunda NO sale a la red: se sirve del registro");
  assert.ok(res.length > 0, "y devuelve el resultado que ya se había pagado");
  assert.equal(c2.costUsd, 0, "gasto de la segunda: CERO");
});

/**
 * El bug del hash (HIGH #4): los arrays no se ordenaban.
 *
 * Para DataForSEO, `["pizza","pasta"]` y `["pasta","pizza"]` son la MISMA consulta y el MISMO
 * cobro. Pero hasheaban distinto, así que el registro no las reconocía como la misma y **se pagaban
 * las dos**.
 */
test("🔴 el mismo lote en otro ORDEN es la misma petición: no se paga dos veces", async () => {
  stubFetch(() => respuestaOk());
  const log = new MemTaskLog();

  await new DataForSeoClient(log).post(PATH, { keywords: ["pizza", "pasta"] });
  await new DataForSeoClient(log).post(PATH, { keywords: ["pasta", "pizza"] }); // ← invertido

  assert.equal(
    postsALaRed.length,
    1,
    "['pizza','pasta'] y ['pasta','pizza'] son la MISMA consulta para DataForSEO",
  );
});

/**
 * El repago (HIGH #3). La petición se envía y **nunca vuelve respuesta**: DataForSEO pudo
 * ejecutarla y cobrarla, y en los endpoints live-only no hay forma de averiguarlo.
 *
 * Antes esto REENVIABA (hasta 3 veces), imprimiendo "REPAGO" por consola: el código sabía que podía
 * estar pagando dos veces, lo decía, y lo hacía igual. Ahora **se detiene**.
 */
test("🔴 una petición AMBIGUA no se reenvía sola: se detiene en vez de arriesgar un doble cobro", async () => {
  // Primer intento: la red se corta. La reserva queda `pending`, sin saber si se cobró.
  stubFetch(() => {
    throw new Error("ECONNRESET: la respuesta nunca llegó");
  });

  const log = new MemTaskLog();
  await assert.rejects(() => new DataForSeoClient(log).post(PATH, { keywords: ["pizza"] }));

  const enviadosAntes = postsALaRed.length;
  assert.ok(enviadosAntes >= 1, "el primer envío SÍ salió (y pudo haberse cobrado)");

  log.vencerLeases(); // el proceso murió: su lease vence

  // Segundo intento. Ahora la red va bien... pero da igual: no se debe reenviar.
  stubFetch(() => respuestaOk());

  await assert.rejects(
    () => new DataForSeoClient(log).post(PATH, { keywords: ["pizza"] }),
    PeticionAmbiguaError,
    "una petición que pudo haberse cobrado NO se reenvía sola",
  );

  assert.equal(
    postsALaRed.length,
    enviadosAntes,
    "no salió NI UN POST más: detener el run es barato, pagar dos veces no",
  );
});

/**
 * Un rate limit (40202) llega con HTTP 200 y significa que la task **no se creó ni se cobró**.
 * Es un rechazo PREVIO a ejecutar, así que reintentarlo es seguro — y es la diferencia entre
 * "seguro que no cobró" y "puede que haya cobrado".
 */
test("un rate limit (40202) SÍ se reintenta: es un rechazo previo a ejecutar, no cobró nada", async () => {
  stubFetch((n) =>
    n === 1
      ? new Response(JSON.stringify({ status_code: 40202, status_message: "rate limit", tasks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : respuestaOk(),
  );

  const res = await new DataForSeoClient(new MemTaskLog()).post(PATH, { keywords: ["pizza"] });

  assert.equal(postsALaRed.length, 2, "se reintentó");
  assert.ok(res.length > 0);
});

/** El cuerpo que se envía también tiene que ser canónico, no solo el hash. */
test("el orden de las CLAVES del cuerpo no cambia la petición", async () => {
  stubFetch(() => respuestaOk());
  const log = new MemTaskLog();
  await new DataForSeoClient(log).post(PATH, { keywords: ["pizza"], location_code: 2724 });
  await new DataForSeoClient(log).post(PATH, { location_code: 2724, keywords: ["pizza"] });
  assert.equal(postsALaRed.length, 1, "las mismas claves en otro orden = la misma petición");
});

/**
 * 🔴 `loteCanonico` INSPECCIONADO — no solo contado.
 *
 * El test viejo mandaba `["pizza"]` dos veces y solo contaba POSTs: cambiar `loteCanonico` por
 * `return keywords` lo dejaba verde. Acá se mira **qué lote recibe el provider**: tiene que llegar
 * deduplicado y ordenado, que es lo que hace que dos procesos con el mismo set compartan reserva.
 */
test("🔴 CachedProvider manda al provider el lote deduplicado y ORDENADO", async () => {
  const { CachedProvider } = await import("./cached-provider.js");

  const recibido: string[][] = [];
  const providerFalso = {
    costMicros: 0,
    async searchVolume(keywords: string[]) {
      recibido.push(keywords);
      return keywords.map((k) => ({ keyword: k, search_volume: 100, cpc: null, competition: null }));
    },
    async keywordSuggestions() { return []; },
    async bulkKeywordDifficulty() { return new Map(); },
    async serp() { return []; },
  };
  const cacheVacia = { async getMany() { return new Map(); }, async setMany() {} };

  const cp = new CachedProvider(providerFalso as any, cacheVacia as any, "dfs:test");
  await cp.searchVolume(["pizza", "pizza", "pasta"], { location_code: 2724, language_code: "es" } as any);

  assert.deepEqual(
    recibido[0],
    ["pasta", "pizza"],
    "al provider (y por ende a DataForSEO) le llega el set dedup+ordenado, no lo que vino",
  );
});

// ================================================================
// Método Standard (task_post / task_get) — SERP y Search Volume (#3b)
// ================================================================

const SV_BASE = "/v3/keywords_data/google_ads/search_volume";

/** Respuesta de task_post: cobra y devuelve el task_id (status 20100 = Task Created). */
function respTaskPost(id: string, cost = 0.0075) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{ id, status_code: 20100, status_message: "Task Created.", cost }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Respuesta de task_get: GRATIS (cost 0). `enCola` simula la tarea todavía no lista (40602). */
function respTaskGet(id: string, enCola = false) {
  const task = enCola
    ? { id, status_code: 40602, status_message: "Task In Queue." }
    : {
        id,
        status_code: 20000,
        status_message: "Ok.",
        result: [{ items: [{ keyword: "pizza", search_volume: 390 }] }],
      };
  return new Response(JSON.stringify({ status_code: 20000, status_message: "Ok.", tasks: [task] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** tasks_ready: lista lo pendiente de recoger, con su tag. */
function respTasksReady(entries: Array<{ id: string; tag: string }>) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{ status_code: 20000, result: entries }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Enruta por sufijo de path: task_post / task_get / tasks_ready. */
function responderStandard(taskId: string) {
  return (req: { url: string }) => {
    if (req.url.includes("/task_post")) return respTaskPost(taskId);
    if (req.url.includes("/task_get")) return respTaskGet(taskId);
    if (req.url.includes("/tasks_ready")) return respTasksReady([{ id: taskId, tag: "x" }]);
    throw new Error(`ruta inesperada: ${req.url}`);
  };
}

test("Standard: task_post cobra, task_get recupera gratis; el total es solo el post", async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    postsALaRed.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return responderStandard("task-1")({ url: String(url) });
  }) as typeof globalThis.fetch;

  const c = new DataForSeoClient(new MemTaskLog());
  const res = await c.postStandard(SV_BASE, [{ keywords: ["pizza"], location_code: 2724 }], { modoGet: "regular" });

  assert.ok(res.length > 0, "devuelve el resultado del task_get");
  assert.equal(c.costUsd, 0.0075, "solo el task_post cobró; el task_get fue gratis");
  const posts = postsALaRed.filter((p) => p.url.includes("/task_post"));
  assert.equal(posts.length, 1, "un solo task_post");
});

/**
 * 🔴 EL BUG QUE ROMPÍA SEARCH VOLUME EN PRODUCCIÓN.
 *
 * Search Volume usa `task_get/{id}` (REGULAR); SERP usa `task_get/advanced/{id}`. La ruta estaba
 * hardcodeada a `/advanced` para ambos → en producción, cada `task_get` de Search Volume daba 404 y
 * el research fallaba sin recuperar el dato pagado. El test viejo aceptaba cualquier `/task_get` y no
 * lo veía. Ahora se afirma la URL EXACTA por endpoint.
 */
test("🔴 la ruta de task_get es EXACTA: regular para Search Volume, advanced para SERP", async () => {
  const capturarGet = (taskId: string) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      postsALaRed.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      const u = String(url);
      if (u.includes("/task_post")) return respTaskPost(taskId);
      if (u.includes("/task_get")) return respTaskGet(taskId);
      throw new Error(`ruta inesperada: ${u}`);
    }) as typeof globalThis.fetch;

  // Search Volume → REGULAR
  globalThis.fetch = capturarGet("sv-1");
  await new DataForSeoClient(new MemTaskLog()).postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" });
  const getSV = postsALaRed.find((p) => p.url.includes("/task_get"))!;
  assert.ok(getSV.url.includes("/search_volume/task_get/sv-1"), `SV usa task_get regular, fue: ${getSV.url}`);
  assert.ok(!getSV.url.includes("/advanced"), "🔴 Search Volume NO lleva /advanced (daría 404)");

  // SERP → ADVANCED
  postsALaRed = [];
  globalThis.fetch = capturarGet("serp-1");
  await new DataForSeoClient(new MemTaskLog()).postStandard("/v3/serp/google/organic", [{ keyword: "pizza" }], { modoGet: "advanced" });
  const getSerp = postsALaRed.find((p) => p.url.includes("/task_get"))!;
  assert.ok(getSerp.url.includes("/organic/task_get/advanced/serp-1"), `SERP usa task_get advanced, fue: ${getSerp.url}`);
});

/**
 * 🔴 LA GARANTÍA QUE JUSTIFICA TODA LA TANDA.
 *
 * El proceso paga el task_post, anota el task_id, y MUERE antes de recuperar el resultado. El
 * siguiente intento NO debe repagar: hace task_get con el id anotado y recupera lo ya pagado.
 *
 * En el camino live (Labs) esto lanzaría PeticionAmbiguaError. Acá, con Standard, cuesta CERO.
 */
test("🔴 Standard: una respuesta perdida se RECUPERA gratis, no se vuelve a pagar", async () => {
  const log = new MemTaskLog();

  // Intento 1: el task_post cobra y anota el id, pero el task_get se cae (proceso muere).
  let caerEnGet = true;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    postsALaRed.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const u = String(url);
    if (u.includes("/task_post")) return respTaskPost("task-42");
    if (u.includes("/task_get")) {
      if (caerEnGet) throw new Error("ECONNRESET durante el task_get");
      return respTaskGet("task-42");
    }
    throw new Error(`ruta inesperada: ${u}`);
  }) as typeof globalThis.fetch;

  const c1 = new DataForSeoClient(log);
  await assert.rejects(() => c1.postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" }));
  const postsIntento1 = postsALaRed.filter((p) => p.url.includes("/task_post")).length;
  assert.equal(postsIntento1, 1, "el task_post se hizo (y cobró)");

  log.vencerLeases(); // el proceso murió: el lease vence
  caerEnGet = false; // ahora el task_get funciona

  const c2 = new DataForSeoClient(log);
  const res = await c2.postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" });

  assert.ok(res.length > 0, "el segundo intento RECUPERA el resultado");
  const totalPosts = postsALaRed.filter((p) => p.url.includes("/task_post")).length;
  assert.equal(totalPosts, 1, "🔴 NUNCA se hizo un segundo task_post");
  // El rescate NO paga de nuevo, pero SÍ contabiliza el coste ya pagado: si el meter lo diera por 0,
  // el presupuesto del research subestimaría el gasto real (bug #3 de la 6ª review).
  assert.equal(c2.costUsd, 0.0075, "🔴 el coste ya pagado se cuenta (el ledger no queda en cero)");
});

/**
 * La ventana residual: el proceso muere ENTRE el task_post y anotar el id. El id no está en el
 * registro, pero sí en tasks_ready (por el tag = payload_hash). Se recupera igual, sin repagar.
 */
test("🔴 Standard: si el id no se anotó, se recupera por tag en tasks_ready", async () => {
  const log = new MemTaskLog();
  const hash = (await import("./task-log.js")).payloadHash("dfs:prod", SV_BASE, [{ keywords: ["pizza"] }]);

  // Simulamos una huérfana SIN task_id anotado: reservamos y vencemos el lease sin anotar nada.
  await log.reservar(SV_BASE, hash);
  log.vencerLeases();

  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    postsALaRed.push({ url: u, body: null });
    if (u.includes("/tasks_ready")) return respTasksReady([{ id: "task-99", tag: hash }]);
    if (u.includes("/task_get")) return respTaskGet("task-99");
    if (u.includes("/task_post")) throw new Error("NO debería postear: la tarea ya está pagada");
    throw new Error(`ruta inesperada: ${u}`);
  }) as typeof globalThis.fetch;

  const c = new DataForSeoClient(log);
  const res = await c.postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" });

  assert.ok(res.length > 0, "recuperado por tasks_ready");
  assert.equal(c.costUsd, 0, "🔴 costo cero: era una tarea ya pagada");
  assert.equal(
    postsALaRed.filter((p) => p.url.includes("/task_post")).length,
    0,
    "🔴 no se posteó nada nuevo",
  );
});

/**
 * 🔴 EL BUG #4: el id hallado por tasks_ready DEBE persistirse antes del task_get.
 *
 * `tasks_ready` deja de listar una tarea una vez recogida. Si el proceso muere entre "hallar el id
 * por tasks_ready" y "completar", y el id no se persistió, el siguiente intento no lo encontraría en
 * tasks_ready (ya se recogió) ni en el registro → el pago se perdería. Persistir el id apenas se
 * halla convierte la segunda caída en una recuperación de capa 1 (huérfana CON taskId).
 */
test("🔴 Standard: el id de tasks_ready se PERSISTE; sobrevive a una segunda caída", async () => {
  const log = new MemTaskLog();
  const hash = (await import("./task-log.js")).payloadHash("dfs:prod", SV_BASE, [{ keywords: ["pizza"] }]);
  await log.reservar(SV_BASE, hash);
  log.vencerLeases();

  // 1ª recuperación: halla el id por tasks_ready, y muere en el task_get.
  let tasksReadyDisponible = true;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    postsALaRed.push({ url: u, body: null });
    if (u.includes("/tasks_ready")) {
      // Tras recogerse, tasks_ready ya NO la lista: la segunda vez, vacío.
      if (!tasksReadyDisponible) return respTasksReady([]);
      tasksReadyDisponible = false;
      return respTasksReady([{ id: "task-77", tag: hash }]);
    }
    if (u.includes("/task_get")) throw new Error("ECONNRESET en el get");
    if (u.includes("/task_post")) throw new Error("NO debe postear: ya está pagada");
    throw new Error(`ruta inesperada: ${u}`);
  }) as typeof globalThis.fetch;

  await assert.rejects(() => new DataForSeoClient(log).postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" }));

  // El id tiene que haber quedado PERSISTIDO (si no, la segunda caída lo perdería).
  log.vencerLeases();
  const reserva = await log.reservar(SV_BASE, hash);
  assert.equal(
    reserva.estado === "huerfana" ? reserva.taskId : undefined,
    "task-77",
    "🔴 el id hallado por tasks_ready se persistió: la segunda caída lo recupera de capa 1",
  );
});

test("Standard: sondea mientras la tarea está en cola (40602) y luego recupera", async () => {
  let getsPedidos = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    postsALaRed.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const u = String(url);
    if (u.includes("/task_post")) return respTaskPost("task-7");
    if (u.includes("/task_get")) {
      getsPedidos++;
      return respTaskGet("task-7", getsPedidos < 2); // en cola la 1ª vez, lista la 2ª
    }
    throw new Error(`ruta inesperada: ${u}`);
  }) as typeof globalThis.fetch;

  const c = new DataForSeoClient(new MemTaskLog());
  const res = await c.postStandard(SV_BASE, [{ keywords: ["pizza"] }], { modoGet: "regular" });
  assert.ok(res.length > 0);
  assert.ok(getsPedidos >= 2, "sondeó hasta que la tarea estuvo lista");
});
