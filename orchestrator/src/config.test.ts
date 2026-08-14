import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DbPool } from "db";
import { opcionesDeServe } from "./app.js";
import { esModoProduccion, leerConfig } from "./config.js";
import { CLAVE_TENANT, CONCURRENCIA, inngest } from "./functions.js";

/**
 * Tests de CONFIGURACIÓN — las piezas que un typo silencioso puede romper sin que ningún test de
 * flujo lo note. La 6ª review marcó las dos como "el código está bien, pero eliminar el guard deja
 * la suite verde": esto las fija.
 */

/**
 * Las variables que deciden el modo del SDK de Inngest, más las del orquestador. Se borran todas
 * antes de cada caso para que el veredicto dependa **solo** de lo que el caso pone.
 */
const VARS = [
  // las que el SDK mira para inferir "cloud" (ver `prodChecks` en inngest/helpers/env.js)
  "NODE_ENV",
  "ENVIRONMENT",
  "CONTEXT",
  "VERCEL_ENV",
  "DENO_DEPLOYMENT_ID",
  "NETLIFY",
  "RENDER",
  "RAILWAY_GIT_BRANCH",
  "CF_PAGES",
  // la que lo fija explícitamente
  "INNGEST_DEV",
  // las del orquestador
  "INNGEST_SIGNING_KEY",
  "DATABASE_URL_ORQUESTADOR",
  "DATABASE_URL_CACHE",
  "DATABASE_URL",
  "PORT",
  "PIPELINE_MODO",
  "DATAFORSEO_MODE",
  "GOOGLE_REVIEWS_MODO",
];

const GUARDADO = { ...process.env };
afterEach(() => {
  process.env = { ...GUARDADO };
});

/** Deja el entorno con EXACTAMENTE las vars dadas (de entre las que el orquestador y el SDK miran). */
function conEntorno(vars: Record<string, string>): void {
  process.env = { ...GUARDADO };
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, vars);
}

/** Lo mínimo para que `leerConfig()` pase en modo producción. */
const PROD_COMPLETO = {
  NODE_ENV: "production",
  DATABASE_URL_ORQUESTADOR: "postgres://amg_orquestador:x@host/db",
  DATABASE_URL_CACHE: "postgres://amg_cache:x@host/db",
  INNGEST_SIGNING_KEY: "signkey-prod-abc123",
  // `mock` es un despliegue de producción legítimo y explícito: es el paso 5 del runbook
  // (verificar el circuito entero gratis antes de conectar la cuenta real).
  PIPELINE_MODO: "mock",
};

// ------------------------------------------------------- el modo lo decide el SDK, no nosotros

/**
 * 🔴 `esModoProduccion()` tiene que devolver **el veredicto del SDK**, no una heurística propia.
 *
 * Medido en inngest 3.54.2: el SDK infiere "cloud" desde una LISTA de señales (`prodChecks` en
 * `helpers/env.js`), no solo desde `NODE_ENV`. La que importa acá es `RAILWAY_GIT_BRANCH`, que
 * **Railway inyecta solo** — o sea el caso real de este despliegue.
 *
 * Si alguien reemplaza el cuerpo por `NODE_ENV.startsWith("prod")`, en Railway sin `NODE_ENV` el SDK
 * habla con Inngest **Cloud** mientras nuestra config se cree en desarrollo y cae a PGlite en
 * memoria: el proceso se declara sano y procesa el research contra una base efímera, sin un solo
 * error. Este test es lo único que ata las dos mitades.
 */
test("🔴 el modo de producción sale del SDK: NODE_ENV=production", () => {
  conEntorno({ NODE_ENV: "production" });
  assert.equal(esModoProduccion(), true);
});

test("🔴 el modo de producción sale del SDK: RAILWAY_GIT_BRANCH (lo inyecta Railway solo)", () => {
  // Sin NODE_ENV a propósito: una heurística casera basada en NODE_ENV diría "dev" acá.
  conEntorno({ RAILWAY_GIT_BRANCH: "main" });
  assert.equal(
    esModoProduccion(),
    true,
    "Railway no define NODE_ENV; si esto da false, el despliegue cae a PGlite en silencio",
  );
});

test("sin ninguna señal, no es producción (el loop de desarrollo sin credenciales se conserva)", () => {
  conEntorno({});
  assert.equal(esModoProduccion(), false);
});

test("INNGEST_DEV=1 gana sobre NODE_ENV=production, igual que en el SDK", () => {
  // El SDK trata `INNGEST_DEV` como modo EXPLÍCITO, por encima de las señales inferidas. Duplicar la
  // heurística a mano sin esta precedencia daría el veredicto contrario.
  conEntorno({ NODE_ENV: "production", INNGEST_DEV: "1" });
  assert.equal(esModoProduccion(), false);
});

/**
 * 🔴 El cliente que REALMENTE sirve no puede fijar su modo a mano.
 *
 * `esModoProduccion()` usa un cliente **sonda**, porque el SDK congela el modo al construir y un test
 * necesita poder mover el entorno. Eso es válido solo mientras el cliente real infiera su modo del
 * entorno igual que la sonda.
 *
 * Antes acá se comparaban los dos veredictos, y **era un test que no podía fallar**: el del cliente
 * real quedó congelado con el entorno del import, así que en la suite los dos lados dan `false` y la
 * aserción que corría era `false === false`. El caso realista —alguien pone `isDev: true` en el
 * cliente real para que le ande el dev server— pasaba limpio.
 *
 * Se comprueba entonces lo que de verdad los separaría. Medido en `inngest@3.54.2`
 * (`components/Inngest.js:150`): la ÚNICA opción del constructor que mueve el modo es `isDev`
 *
 *     this._mode = getMode({ explicitMode: typeof isDev === "boolean" ? (isDev ? "dev" : "cloud") : void 0 })
 *
 * `baseUrl` **no** lo mueve (lo verifiqué construyendo los tres clientes), así que ya no se nombra:
 * el docblock anterior lo listaba por analogía, no por medición.
 */
test("🔴 el cliente de Inngest que sirve las funciones NO fija su modo a mano", () => {
  const opciones = (inngest as unknown as { options: Record<string, unknown> }).options;
  assert.equal(
    opciones["isDev"],
    undefined,
    "si el cliente real fija `isDev`, su modo deja de coincidir con el de la sonda de `esModoProduccion()` " +
      "y las validaciones de producción protegerían a un proceso distinto del que corre",
  );
});

// ------------------------------------------------------- leerConfig: falla cerrado en producción

test("🔴 en producción, sin DATABASE_URL_ORQUESTADOR no arranca (y NO cae a PGlite)", () => {
  conEntorno({
    NODE_ENV: "production",
    DATABASE_URL_CACHE: PROD_COMPLETO.DATABASE_URL_CACHE,
    INNGEST_SIGNING_KEY: PROD_COMPLETO.INNGEST_SIGNING_KEY,
  });
  assert.throws(() => leerConfig(), /DATABASE_URL_ORQUESTADOR/);
});

/**
 * 🔴 En producción, el fallback `DATABASE_URL` **no vale**.
 *
 * En dev es una comodidad. En Railway, `DATABASE_URL` es el nombre que el plugin de Postgres inyecta
 * solo, y apunta al DUEÑO de la base — no a `amg_orquestador`. Aceptarlo en producción convertiría
 * "un proceso, un login, un rol" (ADR-17) en una coincidencia de nombres: el orquestador correría con
 * un login capaz de asumir cualquier rol, y `set local role app_service` funcionaría igual, así que
 * nada fallaría y nadie se enteraría.
 */
test("🔴 en producción, DATABASE_URL (el fallback de dev) no alcanza", () => {
  conEntorno({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://postgres:x@host/db",
    DATABASE_URL_CACHE: PROD_COMPLETO.DATABASE_URL_CACHE,
    INNGEST_SIGNING_KEY: PROD_COMPLETO.INNGEST_SIGNING_KEY,
  });
  assert.throws(() => leerConfig(), /DATABASE_URL_ORQUESTADOR/);
});

/**
 * 🔴 Sin `INNGEST_SIGNING_KEY` el proceso no puede verificar que quien invoca sus funciones es
 * Inngest Cloud: un typo en el nombre de la variable en Railway no produce ningún error nuestro,
 * produce un servicio que rechaza todo. Mejor no arrancar.
 *
 * (Acá decía que el SDK la lee **solo de `process.env`**. Era falso y estaba escrito sin medir —el
 * mismo error que este proyecto ya había corregido para `INNGEST_EVENT_KEY`—: `signingKey` es opción
 * pública de `serve()` y **gana** sobre el entorno. Por eso ahora se pasa; ver `opcionesDeServe`.)
 */
test("🔴 en producción, sin INNGEST_SIGNING_KEY no arranca", () => {
  conEntorno({
    NODE_ENV: "production",
    DATABASE_URL_ORQUESTADOR: PROD_COMPLETO.DATABASE_URL_ORQUESTADOR,
    DATABASE_URL_CACHE: PROD_COMPLETO.DATABASE_URL_CACHE,
  });
  assert.throws(() => leerConfig(), /INNGEST_SIGNING_KEY/);
});

test("🔴 en producción, sin DATABASE_URL_CACHE no arranca", () => {
  conEntorno({
    NODE_ENV: "production",
    DATABASE_URL_ORQUESTADOR: PROD_COMPLETO.DATABASE_URL_ORQUESTADOR,
    INNGEST_SIGNING_KEY: PROD_COMPLETO.INNGEST_SIGNING_KEY,
  });
  assert.throws(() => leerConfig(), /DATABASE_URL_CACHE/);
});

/**
 * 🔴 EL test de esta pieza: en producción, `leerConfig` **nunca** puede devolver PGlite.
 *
 * Es la afirmación que hoy no tenía dueño. Se comprueba barriendo TODOS los subconjuntos de las
 * variables obligatorias: o la config sale con Postgres, o no sale. Ninguna combinación puede
 * producir una base efímera.
 */
test("🔴 en producción, NINGUNA combinación de variables produce PGlite en memoria", () => {
  const claves = [
    "DATABASE_URL_ORQUESTADOR",
    "DATABASE_URL_CACHE",
    "INNGEST_SIGNING_KEY",
    // Va en el barrido a propósito. Al volverse obligatoria, si NO estuviera acá el barrido
    // abortaría en las 8 combinaciones y el test pasaría **vacío**: verde sin comprobar nada.
    "PIPELINE_MODO",
  ] as const;

  let arrancaron = 0;
  for (let mascara = 0; mascara < 1 << claves.length; mascara++) {
    const vars: Record<string, string> = { NODE_ENV: "production" };
    claves.forEach((k, i) => {
      if (mascara & (1 << i)) vars[k] = PROD_COMPLETO[k];
    });
    conEntorno(vars);

    let config: ReturnType<typeof leerConfig> | null = null;
    try {
      config = leerConfig();
    } catch {
      continue; // abortar está bien: es gratis y es ruidoso
    }
    arrancaron += 1;
    assert.notEqual(
      config.persistencia.tipo,
      "pglite-en-memoria",
      `con ${JSON.stringify(vars)} la config salió con una base EFÍMERA en producción`,
    );
  }

  // Si una variable obligatoria nueva no se agrega a `claves`, TODAS las combinaciones abortan y el
  // bucle de arriba no comprueba nada: verde vacío. Esto lo convierte en rojo.
  assert.equal(arrancaron, 1, "solo la combinación completa debe arrancar — y tiene que arrancar");
});

test("en producción y con todo puesto, la config sale con Postgres", () => {
  conEntorno(PROD_COMPLETO);
  const config = leerConfig();
  assert.equal(config.esProduccion, true);
  assert.equal(config.persistencia.tipo, "postgres");
  assert.equal(
    config.persistencia.tipo === "postgres" ? config.persistencia.urlOrquestador : null,
    PROD_COMPLETO.DATABASE_URL_ORQUESTADOR,
  );
});

// ---------------------------------- la clave validada tiene que ser la clave USADA

/**
 * 🔴 La clave validada viaja en la config, **trimeada**.
 *
 * El `.trim()` de la validación era el problema, no la solución: aceptaba
 * `"  signkey-…  "` (pegado del dashboard con espacios) y el SDK después releía el entorno **crudo**.
 * Lo comprobado y lo usado eran dos lecturas distintas del mismo nombre.
 */
test("🔴 leerConfig deja la INNGEST_SIGNING_KEY validada y trimeada en la config", () => {
  conEntorno({ ...PROD_COMPLETO, INNGEST_SIGNING_KEY: "  signkey-prod-abc123  " });
  assert.equal(leerConfig().inngestSigningKey, "signkey-prod-abc123");
});

/**
 * 🔴 …y esa clave llega a `serve()`. Es el test que cae si alguien deshace el arreglo.
 *
 * Medido en `inngest@3.54.2`: `signingKey` es opción pública de `serve()`
 * (`ServeHandlerOptions extends RegisterOptions`, `types.d.ts:849`) y **gana** sobre el entorno —
 * `InngestCommHandler.js:214` asigna la opción y `:1454` solo cae al entorno con
 * `if (!this.signingKey && …)`.
 */
test("🔴 opcionesDeServe pasa la signingKey validada, no la deja al entorno", () => {
  conEntorno({ ...PROD_COMPLETO, INNGEST_SIGNING_KEY: "  signkey-prod-abc123  " });
  const opciones = opcionesDeServe(leerConfig(), inngest, []);
  assert.equal(
    opciones.signingKey,
    "signkey-prod-abc123",
    "sin esto el SDK relee INNGEST_SIGNING_KEY crudo y una clave con espacios rechaza TODA " +
      "invocación de Inngest Cloud, con el proceso declarándose sano",
  );
});

/** Fuera de producción no hay clave que pasar, y `serve()` no debe recibir una vacía. */
test("sin INNGEST_SIGNING_KEY, opcionesDeServe no inventa el campo", () => {
  conEntorno({});
  assert.equal(opcionesDeServe(leerConfig(), inngest, []).signingKey, undefined);
});

// ------------------------------------------------------- PIPELINE_MODO: declarar qué se está corriendo

test("🔴 en producción, sin PIPELINE_MODO no arranca (no hay default)", () => {
  const { PIPELINE_MODO: _, ...sinModo } = PROD_COMPLETO;
  conEntorno(sinModo);
  assert.throws(() => leerConfig(), /PIPELINE_MODO/);
});

test("🔴 un PIPELINE_MODO que no es `mock` ni `live` no arranca, y el error los nombra", () => {
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "produccion" });
  assert.throws(() => leerConfig(), /PIPELINE_MODO inválido.*mock.*live/s);
});

/**
 * 🔴 El motivo entero de la variable: declarar `live` con DataForSEO en mock generaría keywords y
 * volúmenes **inventados** en la base REAL del cliente, indistinguibles de un research legítimo.
 */
test("🔴 PIPELINE_MODO=live con DATAFORSEO_MODE en mock aborta", () => {
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "live" });
  assert.throws(() => leerConfig(), /PIPELINE_MODO=live contradice DATAFORSEO_MODE/);
});

test("🔴 …y `production` no cuenta como live: el código exige exactamente `live`", () => {
  // El runbook decía `DATAFORSEO_MODE=production`, que `kr-service` trata como mock
  // (`dataforseo/index.ts:26`: `if (mode !== "live") return new MockProvider()`).
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "live", DATAFORSEO_MODE: "production" });
  assert.throws(() => leerConfig(), /contradice DATAFORSEO_MODE="production"/);
});

/**
 * 🔴 La otra dirección, que es la cara: declarar un despliegue gratuito y gastar igual (~$0.31 por
 * research). Es el error irreversible de `pipeline-gasto`.
 */
test("🔴 PIPELINE_MODO=mock con DATAFORSEO_MODE=live aborta (declarado gratis, gasta)", () => {
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "mock", DATAFORSEO_MODE: "live" });
  assert.throws(() => leerConfig(), /PIPELINE_MODO=mock contradice DATAFORSEO_MODE/);
});

/** `mock` en producción es un despliegue LEGÍTIMO: es el paso 5 del runbook, y no puede romperse. */
test("🔴 PIPELINE_MODO=mock en producción arranca: verificar el circuito gratis sigue siendo válido", () => {
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "mock" });
  const config = leerConfig();
  assert.equal(config.pipeline, "mock");
  assert.equal(config.persistencia.tipo, "postgres");
});

test("PIPELINE_MODO=live con DATAFORSEO_MODE=live arranca y queda declarado", () => {
  conEntorno({ ...PROD_COMPLETO, PIPELINE_MODO: "live", DATAFORSEO_MODE: "live" });
  assert.equal(leerConfig().pipeline, "live");
});

/**
 * Fuera de producción no se exige nada, pero el valor **no se inventa**: se deriva de lo que de
 * verdad va a pasar. Un `"mock"` fijo mentiría cuando un dev corre en vivo, y `/_health` es
 * justamente donde alguien iría a mirar.
 */
test("fuera de producción, PIPELINE_MODO no se exige y se deriva de DATAFORSEO_MODE", () => {
  conEntorno({});
  assert.equal(leerConfig().pipeline, "mock");
  conEntorno({ DATAFORSEO_MODE: "live" });
  assert.equal(leerConfig().pipeline, "live", "un dev corriendo en vivo GASTA: el health lo tiene que decir");
});

/**
 * 🔴 …y por eso la coherencia se comprueba **también fuera de producción**.
 *
 * El docblock de esa rama decía que un dev corriendo en vivo está gastando y que `/_health` lo tiene
 * que decir — pero `verificarCoherencia` solo corría en la rama de producción. Medido: en local,
 * `PIPELINE_MODO=mock` + `DATAFORSEO_MODE=live` arrancaba sin chistar, `/_health` reportaba
 * `pipeline:"mock"` y **el log de arranque se comía su propio `⚠️ GASTA DINERO`** — la declaración
 * falsa no solo no avisaba: silenciaba el aviso que sí existía. Con ~$0.31 por research.
 *
 * Es la dirección cara de `pipeline-gasto`, y una declaración que solo se contrasta en producción no
 * es una declaración: es un comentario.
 */
test("🔴 fuera de producción, declarar `mock` con DataForSEO en live también aborta", () => {
  conEntorno({ PIPELINE_MODO: "mock", DATAFORSEO_MODE: "live" });
  assert.throws(() => leerConfig(), /PIPELINE_MODO=mock contradice DATAFORSEO_MODE/);
});

test("🔴 fuera de producción, la otra dirección también aborta", () => {
  conEntorno({ PIPELINE_MODO: "live" });
  assert.throws(() => leerConfig(), /PIPELINE_MODO=live contradice DATAFORSEO_MODE/);
});

/**
 * 🔴 La contracara, y es la que protege el loop gratis: **el camino DERIVADO no puede contradecirse
 * nunca**, porque el valor sale de la misma función con la que después se contrasta.
 *
 * Sin esto, agregar la comprobación a la rama de dev sería un riesgo a ciegas: bastaría que alguien
 * cambie `modoDataForSeo()` de un lado y no del otro para que `npm run dev` deje de arrancar sin
 * credenciales. Se barre con valores reales y con basura.
 */
test("🔴 sin PIPELINE_MODO, leerConfig NUNCA aborta por coherencia (el loop sin credenciales)", () => {
  for (const dfs of [undefined, "", "mock", "live", "production", "LIVE", " live "]) {
    conEntorno(dfs === undefined ? {} : { DATAFORSEO_MODE: dfs });
    assert.doesNotThrow(
      () => leerConfig(),
      `con DATAFORSEO_MODE=${JSON.stringify(dfs)} el modo derivado tiene que ser coherente consigo mismo`,
    );
  }
});

// --------------------------------------- GOOGLE_REVIEWS_MODO: mock-first, sin exigir la variable

/**
 * A diferencia de `PIPELINE_MODO`, esta variable NO gasta nada mientras sea `mock`, y `live` ni
 * siquiera está implementado en esta fase (Bloque F fase 1). Por eso el default sin la variable es
 * `mock`, y no se exige en producción — exigirla sería pedirle al desplegador un valor que `live`
 * todavía no puede usar.
 */
test("GOOGLE_REVIEWS_MODO por defecto es 'mock' si no está la variable", () => {
  conEntorno({});
  const c = leerConfig();
  assert.equal(c.resenasGoogle, "mock");
});

test("🔴 GOOGLE_REVIEWS_MODO con un valor que no es mock/live lanza", () => {
  conEntorno({ GOOGLE_REVIEWS_MODO: "produccion" });
  assert.throws(() => leerConfig(), /GOOGLE_REVIEWS_MODO inválido/);
});

/**
 * 🔴 La diferencia deliberada con `PIPELINE_MODO`: en producción, sin la variable, el arranque tiene
 * que seguir adelante (con `mock`), no abortar. Si esto lanzara, `GOOGLE_REVIEWS_MODO` habría quedado
 * tan obligatoria como `PIPELINE_MODO` sin que ese fuera el pedido — acá no hay nada real que exigir.
 */
test("en producción, sin GOOGLE_REVIEWS_MODO arranca igual (default mock, no se exige)", () => {
  conEntorno(PROD_COMPLETO); // PROD_COMPLETO no incluye GOOGLE_REVIEWS_MODO
  const c = leerConfig();
  assert.equal(c.resenasGoogle, "mock");
});

test("GOOGLE_REVIEWS_MODO=live en producción queda declarado (el provider lo rechaza después, no la config)", () => {
  conEntorno({ ...PROD_COMPLETO, GOOGLE_REVIEWS_MODO: "live" });
  const c = leerConfig();
  assert.equal(c.resenasGoogle, "live");
});

// ------------------------------------------------------- fuera de producción, nada cambia

/**
 * 🔴 La contracara, y es una virtud del proyecto que no se toca: **sin una sola credencial, arranca**.
 * Si esto se rompe, el loop de desarrollo gratis se rompe con él.
 */
test("🔴 fuera de producción y sin credenciales, sigue levantando PGlite en memoria", () => {
  conEntorno({});
  const config = leerConfig();
  assert.equal(config.esProduccion, false);
  assert.equal(config.persistencia.tipo, "pglite-en-memoria");
});

test("fuera de producción, DATABASE_URL sigue sirviendo de fallback", () => {
  conEntorno({
    DATABASE_URL: "postgres://dev@localhost/db",
    DATABASE_URL_CACHE: "postgres://dev@localhost/db",
  });
  const config = leerConfig();
  assert.equal(config.persistencia.tipo, "postgres");
});

test("fuera de producción NO se exige INNGEST_SIGNING_KEY (el dev server no la usa)", () => {
  conEntorno({});
  assert.doesNotThrow(() => leerConfig());
});

/**
 * `PORT` mal escrito daba `NaN`, y `listen(NaN)` **no falla**: Node elige un puerto al azar. El
 * servicio queda arriba, en un puerto que nadie sondea, y el health check nunca responde. Es el mismo
 * modo de fallo silencioso, en chico.
 */
test("🔴 un PORT inválido no arranca en vez de escuchar en un puerto al azar", () => {
  conEntorno({ PORT: "ochomil" });
  assert.throws(() => leerConfig(), /PORT/);
});

test("PORT válido se respeta; sin PORT, el default es 3100", () => {
  conEntorno({ PORT: "8080" });
  assert.equal(leerConfig().puerto, 8080);
  conEntorno({});
  assert.equal(leerConfig().puerto, 3100);
});

// ------------------------------------------------------- el composition root revalida

/**
 * 🔴 Defensa en profundidad: aunque alguien arme la config a mano (un dev-server, un test, un
 * refactor que se saltee `leerConfig`), `crearConexiones` **se niega** a abrir PGlite en producción.
 * Es el mismo criterio que `getProvider()` con el registro durable: el que gasta es el que revalida.
 */
test("🔴 crearConexiones rechaza PGlite en memoria si la config dice producción", async () => {
  const { crearConexiones } = await import("./deps.js");
  await assert.rejects(
    () =>
      crearConexiones({
        puerto: 3100,
        esProduccion: true,
        pipeline: "mock",
        resenasGoogle: "mock",
        persistencia: { tipo: "pglite-en-memoria" },
      }),
    /PGlite/,
    "una base efímera en producción tiene que abortar, no arrancar",
  );
});

/** Fuera de producción sí, obviamente: es el loop de desarrollo. */
test("crearConexiones abre PGlite en memoria fuera de producción", async () => {
  const { crearConexiones } = await import("./deps.js");
  const cx = await crearConexiones({
    puerto: 3100,
    esProduccion: false,
    pipeline: "mock",
    resenasGoogle: "mock",
    persistencia: { tipo: "pglite-en-memoria" },
  });
  assert.ok(cx.orquestador);
  await cx.cerrar();
});

/**
 * 🔴 La clave de concurrencia por tenant tiene que apuntar a un campo que el evento REALMENTE lleva.
 *
 * El bug (5ª review, #11) fue `event.data.ctx.tenantId`: `ctx` no existe en el evento, así que la
 * clave resolvía a `undefined` y la equidad entre tenants no se aplicaba. El evento
 * `research/solicitado` lleva `{ runId, tenantId }` (ver `events.ts`), así que la clave válida es
 * `event.data.tenantId` — y **no** un subcampo anidado que no existe.
 */
test("🔴 la clave de concurrencia por tenant apunta a un campo real del evento", () => {
  assert.equal(CLAVE_TENANT, "event.data.tenantId");
  // Nada de `.ctx.` ni otro nivel anidado: el evento no tiene esa forma.
  assert.ok(!CLAVE_TENANT.includes(".ctx."), "no debe apuntar a event.data.ctx.* (no existe)");
  const porTenant = CONCURRENCIA.find((c) => "key" in c);
  assert.equal(porTenant?.key, "event.data.tenantId", "la regla por tenant usa la clave correcta");
  assert.equal(porTenant && "limit" in porTenant ? porTenant.limit : 0, 1, "1 research por tenant a la vez");
});

/**
 * 🔴 El composition root ata el store al rol `app_service`, y ESO es lo que ningún test fijaba.
 *
 * La 13ª review externa lo midió con una mutación de un carácter: cambiar `"app_service"` por
 * `"app_user"` en `deps.ts` dejaba **199 tests y el typecheck en verde**, y el fallo aparecía recién en
 * producción, donde `amg_orquestador` **no tiene concedido** `app_user` y Postgres rechaza el
 * `set role` (ADR-17). Los tests de `db` prueban que `PgStore` funciona con `app_service` **cuando el
 * test lo elige**; ninguno probaba que producción lo elija. Es la regla del proyecto incumplida: *un
 * default de producción sin test es una decisión sin dueño*.
 *
 * Se comprueba por el EFECTO y no leyendo el campo privado: un pool espía registra el SQL, y lo que se
 * afirma es el `set local role` que la conexión acaba ejecutando — que es lo que Postgres ve.
 */
test("🔴 crearDeps ata el store a app_service, el único rol que su login puede asumir", async () => {
  const ejecutado: string[] = [];
  const espia: DbPool = {
    transaction: (fn) =>
      fn({
        query: async (sql: string) => {
          ejecutado.push(sql);
          return { rows: [] };
        },
        exec: async (sql: string) => {
          ejecutado.push(sql);
          return undefined;
        },
      }),
  };

  const { crearDeps } = await import("./deps.js");
  const deps = crearDeps({ orquestador: espia, cache: espia, cerrar: async () => {} });

  // Cualquier operación sirve: `withTenant` aplica el rol antes de tocar los datos.
  await deps.store.getRun({ tenantId: "11111111-1111-4111-8111-111111111111" }, "22222222-2222-4222-8222-222222222222");

  assert.ok(
    ejecutado.some((s) => s.includes("set local role app_service")),
    `el store del orquestador tiene que asumir app_service. SQL ejecutado: ${JSON.stringify(ejecutado)}`,
  );
  assert.ok(
    !ejecutado.some((s) => s.includes("set local role app_user")),
    "y NUNCA app_user: su login no lo tiene concedido, así que en producción esto reventaría",
  );
});

/**
 * 🔴 Con Postgres real, `DATABASE_URL_CACHE` es obligatoria: NO puede heredar la del orquestador,
 * porque ese login no puede tocar las caches (5ª review, #9). Sin ella, hay que abortar al arrancar.
 */
test("🔴 crearConexiones aborta si hay Postgres real sin DATABASE_URL_CACHE", async () => {
  const orig = { ...process.env };
  try {
    process.env["DATABASE_URL_ORQUESTADOR"] = "postgres://amg_orquestador:x@localhost/db";
    delete process.env["DATABASE_URL_CACHE"];
    delete process.env["DATABASE_URL"];

    const { crearConexiones } = await import("./deps.js");
    await assert.rejects(
      () => crearConexiones(),
      /DATABASE_URL_CACHE/,
      "sin la credencial de cache, el sistema no debe arrancar (fallaría en el primer research)",
    );
  } finally {
    process.env = orig;
  }
});

/*
 * ---------------------------------------------------------------------------------------------
 * 🔴 El barrido de runs colgados (bloque A2). La lógica está fuera de `createFunction` justo para
 * que estos tests puedan correrla — igual que `CONCURRENCIA`.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * 🔴 El plazo se IMPORTA de `db`, no se escribe a mano en el orquestador.
 *
 * Es la regla del proyecto —*un default de producción sin test es una decisión sin dueño*— aplicada a
 * un caso donde el dueño es otro paquete. Si alguien escribiera `"3 hours"` acá, el test del default
 * de `db` seguiría verde mientras producción usa otro número, y las dos mitades divergirían sin que
 * nada avise. Este test cae si el literal se duplica.
 */
test("🔴 barrido: el plazo que usa el orquestador es EXACTAMENTE el de `db`", async () => {
  const { barrerRunsColgados } = await import("./functions.js");
  const { PLAZO_RUN_COLGADO } = await import("db");

  const pedidos: string[] = [];
  const store = {
    expirarRunsColgados: async (plazo: string) => {
      pedidos.push(plazo);
      return [];
    },
  } as unknown as Parameters<typeof barrerRunsColgados>[0]["store"];

  await barrerRunsColgados({ store });

  assert.deepEqual(pedidos, [PLAZO_RUN_COLGADO]);
  assert.equal(PLAZO_RUN_COLGADO, "3 hours", "si esto cambia, cambialo también en `db` y decí por qué");
});

/**
 * 🔴 El barrido loguea TAMBIÉN cuando no encuentra nada.
 *
 * Es la mitad que se olvida. Un barrido que solo habla cuando encuentra algo es indistinguible de un
 * cron que dejó de dispararse — y el fallo mudo es exactamente lo que este barrido existe para no
 * repetir. La línea horaria de "ningún run colgado" es la prueba de vida.
 */
test("🔴 barrido: dice algo aunque no haya nada colgado (si no, no se distingue de un cron muerto)", async () => {
  const { barrerRunsColgados } = await import("./functions.js");

  const dicho: string[] = [];
  const store = {
    expirarRunsColgados: async () => [],
  } as unknown as Parameters<typeof barrerRunsColgados>[0]["store"];

  const r = await barrerRunsColgados({ store }, (m) => dicho.push(m));

  assert.equal(r.expirados, 0);
  assert.equal(dicho.length, 1, "una línea, siempre");
  assert.match(dicho[0]!, /ningún run colgado/);
});

test("🔴 barrido: nombra cada run expirado con su tenant (sin el tenant no se puede rastrear)", async () => {
  const { barrerRunsColgados } = await import("./functions.js");

  const dicho: string[] = [];
  const store = {
    expirarRunsColgados: async () => [
      { id: "run-a", tenantId: "tenant-1" },
      { id: "run-b", tenantId: "tenant-2" },
    ],
  } as unknown as Parameters<typeof barrerRunsColgados>[0]["store"];

  const r = await barrerRunsColgados({ store }, (m) => dicho.push(m));

  assert.equal(r.expirados, 2);
  assert.equal(dicho.length, 2);
  // El tenant importa: el barrido es lo único cross-tenant del sistema, así que un id suelto no dice
  // de quién es el run que se acaba de matar.
  assert.match(dicho[0]!, /run-a.*tenant-1/);
  assert.match(dicho[1]!, /run-b.*tenant-2/);
});

/**
 * 🔴 El cron es un default de producción como cualquier otro, y encima de los que no fallan ruidoso:
 * una expresión mal escrita no revienta, simplemente **no se dispara nunca**.
 */
test("🔴 barrido: el cron es horario y no una expresión que no dispara nunca", async () => {
  const { CRON_BARRIDO } = await import("./functions.js");

  assert.equal(CRON_BARRIDO, "0 * * * *");
  assert.equal(CRON_BARRIDO.split(/\s+/).length, 5, "cinco campos, el formato que Inngest espera");
  // El plazo (3 h) tiene que ser MAYOR que el intervalo del barrido: si barriera cada tres horas o
  // más, un run podría quedarse colgado hasta el doble del plazo antes de que alguien lo mire.
  assert.equal(CRON_BARRIDO.startsWith("0 *"), true, "cada hora en punto");
});

/**
 * 🔴 Las dos funciones quedan registradas, y `/_health` tiene que poder decirlo.
 *
 * `server.ts` no se puede importar en un test (arranca el proceso y lee el entorno), así que lo que
 * se fija acá es que las dos fábricas existan y produzcan funciones con ids distintos. El número que
 * reporta `/_health` sale de `funciones.length` en `server.ts`; tras desplegar esto tiene que decir 2.
 */
test("🔴 barrido: la fábrica produce una función con id propio, distinta de la del research", async () => {
  const { crearFuncionBarrido, crearFuncionResearch } = await import("./functions.js");
  const deps = {} as Parameters<typeof crearFuncionBarrido>[0];

  const barrido = crearFuncionBarrido(deps);
  const research = crearFuncionResearch(deps);

  assert.notEqual(barrido.id(), research.id(), "dos funciones distintas, dos ids distintos");
  assert.match(barrido.id(), /barrido/);
});
