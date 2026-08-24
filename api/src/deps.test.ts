import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { leerConfig } from "./deps.js";

/**
 * `leerConfig` es el borde donde la API decide su postura de seguridad de despliegue. Estaba SIN
 * test (el "default de producción sin dueño" que AGENTS.md marca): en particular, si faltaba
 * `CORS_ORIGINS`, la API arrancaba con `origin: *` sin que nadie lo decidiera. La API está expuesta a
 * internet, así que en producción **no queremos `*`**: mejor no arrancar que arrancar abierto.
 *
 * Nota: `leerConfig` lee `process.env`, así que estos tests lo manipulan y lo restauran.
 */
const GUARDADO = { ...process.env };
afterEach(() => {
  process.env = { ...GUARDADO };
});

/** Deja el entorno con EXACTA­MENTE las vars dadas (borra las que la API mira). */
function conEntorno(vars: Record<string, string>): void {
  process.env = { ...GUARDADO };
  for (const k of [
    "DATABASE_URL_API",
    "CORS_ORIGINS",
    "SUPABASE_JWT_AUD",
    "SUPABASE_JWT_ISS",
    "OAUTH_STATE_SECRET",
    "GOOGLE_REVIEWS_MODO",
    "TELEGRAM_BOT_USERNAME",
    // El SDK de Inngest infiere su modo del entorno: si la máquina que corre los tests tuviera
    // `NODE_ENV=production` o `RAILWAY_GIT_BRANCH`, la mitad de estos tests cambiaría de resultado
    // sin que nadie tocara el código. Se limpian, y cada test declara el entorno que quiere probar.
    "INNGEST_DEV",
    "INNGEST_EVENT_KEY",
    "NODE_ENV",
    "RAILWAY_GIT_BRANCH",
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, vars);
}

const BASE = {
  DATABASE_URL_API: "postgres://amg_api@host/db",
  SUPABASE_JWT_ISS: "https://proyecto.supabase.co/auth/v1",
  OAUTH_STATE_SECRET: "secreto-de-test-no-para-produccion",
  TELEGRAM_BOT_USERNAME: "AMGReviewsBotTest",
  // Modo dev EXPLÍCITO. `INNGEST_DEV` gana sobre toda la inferencia del SDK (medido), así que estos
  // tests —que no van sobre Inngest— dan igual en un portátil que en un CI que se crea producción.
  // Los que SÍ van sobre el modo lo borran y ponen las variables del PaaS de verdad.
  INNGEST_DEV: "1",
};

test("falla cerrado si falta CORS_ORIGINS (no arranca con `*` en algo expuesto)", () => {
  conEntorno(BASE);
  assert.throws(() => leerConfig(), /CORS_ORIGINS/);
});

test("🔴 falla cerrado si falta TELEGRAM_BOT_USERNAME: sin ella, /me/telegram/vincular armaría una URL rota", () => {
  // Mismo criterio que OAUTH_STATE_SECRET/SUPABASE_JWT_ISS: mejor no arrancar que servir en
  // silencio `t.me/undefined?start=...` a cada CM que pida vincular su Telegram.
  const { TELEGRAM_BOT_USERNAME: _sinBot, ...sinEstaVar } = BASE;
  conEntorno({ ...sinEstaVar, CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /TELEGRAM_BOT_USERNAME/);
});

test("acepta CORS_ORIGINS y lo parsea coma-separado, con trim", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: " https://app.tudominio.com , https://admin.tudominio.com " });
  const config = leerConfig();
  assert.deepEqual(config.corsOrigins, [
    "https://app.tudominio.com",
    "https://admin.tudominio.com",
  ]);
});

test("sigue fallando si falta la conexión a la base", () => {
  conEntorno({ CORS_ORIGINS: "https://app.tudominio.com", SUPABASE_JWT_ISS: BASE.SUPABASE_JWT_ISS });
  assert.throws(() => leerConfig(), /DATABASE_URL_API/);
});

test("🔴 falla cerrado si falta SUPABASE_JWT_ISS: sin issuer no hay de dónde sacar el JWKS", () => {
  // Antes era opcional y la API arrancaba igual, sin exigir emisor: un token válido de OTRO
  // proyecto Supabase entraba. Ahora además es la fuente de la clave pública.
  conEntorno({ DATABASE_URL_API: BASE.DATABASE_URL_API, CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /SUPABASE_JWT_ISS/);
});

test("🔴 un issuer de un host ajeno no arranca la API", () => {
  conEntorno({ ...BASE, SUPABASE_JWT_ISS: "https://atacante.example/auth/v1", CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /Supabase/);
});

test("🔴 falla cerrado si falta OAUTH_STATE_SECRET: sin él, el callback OAuth no puede confiar en el state", () => {
  // Mismo criterio que SUPABASE_JWT_ISS arriba: sin este secreto, `GET /clients/:id/google/callback`
  // (anónimo, fuera de `autenticar()`) no tendría con qué verificar el `tenantId`/`userId` que trae
  // el `state` -- un valor fijo acá sería una credencial compartida entre despliegues.
  const { OAUTH_STATE_SECRET: _sinSecreto, ...sinEsteVar } = BASE;
  conEntorno({ ...sinEsteVar, CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /OAUTH_STATE_SECRET/);
});

test("el emisor válido queda canonizado en la config, con su URL de JWKS", () => {
  conEntorno({ ...BASE, SUPABASE_JWT_ISS: "https://proyecto.supabase.co/auth/v1/", CORS_ORIGINS: "https://app.tudominio.com" });
  const c = leerConfig();
  assert.equal(c.emisor.issuer, "https://proyecto.supabase.co/auth/v1");
  assert.equal(c.emisor.jwksUrl.href, "https://proyecto.supabase.co/auth/v1/.well-known/jwks.json");
});

test("RECHAZA `*`: 'CORS_ORIGINS obligatorio' no sirve si se acepta el comodín", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: "*" });
  assert.throws(() => leerConfig(), /\*|comod/i);
});

test("rechaza un origen que no es una URL http(s) completa", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: "app.tudominio.com" }); // sin esquema
  assert.throws(() => leerConfig(), /origen|http/i);
});

test("rechaza una lista con un elemento vacío (coma colgando)", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: "https://app.tudominio.com," });
  assert.throws(() => leerConfig(), /vac|origen/i);
});

test("acepta varios orígenes https válidos", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: "https://app.tudominio.com,http://localhost:4200" });
  const config = leerConfig();
  assert.deepEqual(config.corsOrigins, ["https://app.tudominio.com", "http://localhost:4200"]);
});

// ------------------------------------------------------------------ INNGEST_EVENT_KEY (modo cloud)
//
// `Inngest.send()` LANZA si el SDK está en modo cloud y no hay event key. La API la usa en `POST
// /runs` DESPUÉS de crear la fila (ADR-18), así que un despliegue sin esa variable levanta sano,
// pasa el health-check, y recién falla cuando alguien pide un research. Estos tests fijan que no
// levante.
//
// Ninguno simula el modo: ponen las variables del PaaS de verdad y dejan que el SDK infiera. Es lo
// que ata que no estemos reimplementando su heurística en un `if` propio (ver `deps.ts`).

const CORS = "https://app.tudominio.com";
/** Lo mismo que `BASE` pero SIN el `INNGEST_DEV=1`: acá se deja que el SDK infiera el modo. */
const { INNGEST_DEV: _sinModoExplicito, ...BASE_INFERIDO } = BASE;

test("🔴 modo cloud (Railway) sin INNGEST_EVENT_KEY: la API NO levanta", () => {
  // `RAILWAY_GIT_BRANCH` es lo que hay en el servicio real, y el SDK lo cuenta como cloud.
  conEntorno({ ...BASE_INFERIDO, CORS_ORIGINS: CORS, RAILWAY_GIT_BRANCH: "main" });
  assert.throws(() => leerConfig(), /INNGEST_EVENT_KEY/);
});

test("🔴 el mensaje dice qué variable falta y DÓNDE ponerla", () => {
  // Un "faltan variables" a secas manda a alguien a leer el código a las 3 de la mañana.
  conEntorno({ ...BASE_INFERIDO, CORS_ORIGINS: CORS, RAILWAY_GIT_BRANCH: "main" });
  assert.throws(() => leerConfig(), /Railway/);
});

test("🔴 NODE_ENV=production también cuenta como cloud (no solo Railway)", () => {
  // Si acá hubiera un `if (RAILWAY_GIT_BRANCH)` escrito a mano, este test seguiría rojo hasta que
  // alguien agregara el segundo `if`. Al preguntarle al SDK, sale gratis.
  conEntorno({ ...BASE_INFERIDO, CORS_ORIGINS: CORS, NODE_ENV: "production" });
  assert.throws(() => leerConfig(), /INNGEST_EVENT_KEY/);
});

test("modo cloud CON la event key: levanta, y la clave viaja en la config", () => {
  // Viaja en la config a propósito: `crearDeps` se la pasa al cliente en vez de dejar que el SDK
  // relea el entorno, para que lo validado y lo usado sean el mismo valor.
  conEntorno({
    ...BASE_INFERIDO,
    CORS_ORIGINS: CORS,
    RAILWAY_GIT_BRANCH: "main",
    INNGEST_EVENT_KEY: "  clave-real  ",
  });
  const config = leerConfig();
  assert.equal(config.inngestEventKey, "clave-real");
});

test("modo dev (un portátil, sin variables de PaaS) NO exige la event key", () => {
  // El otro lado del default: si esto fallara, `npm run serve` en local dejaría de arrancar.
  conEntorno({ ...BASE_INFERIDO, CORS_ORIGINS: CORS });
  const config = leerConfig();
  assert.equal(config.inngestEventKey, undefined);
});

test("INNGEST_DEV=1 desactiva la exigencia aunque el PaaS diga producción", () => {
  // La salida documentada en el propio mensaje de error, para un arranque local contra el dev server.
  conEntorno({ ...BASE, CORS_ORIGINS: CORS, RAILWAY_GIT_BRANCH: "main" });
  assert.doesNotThrow(() => leerConfig());
});

test("🔴 una event key en blanco no cuenta como puesta", () => {
  // `INNGEST_EVENT_KEY=` en el panel del PaaS es un error de tipeo, no una decisión: el SDK la
  // trataría como ausente (`options.eventKey || …`) y `send()` lanzaría igual.
  conEntorno({
    ...BASE_INFERIDO,
    CORS_ORIGINS: CORS,
    RAILWAY_GIT_BRANCH: "main",
    INNGEST_EVENT_KEY: "   ",
  });
  assert.throws(() => leerConfig(), /INNGEST_EVENT_KEY/);
});

// --------------------------------------------------------------------- GOOGLE_REVIEWS_MODO
//
// Hallazgo 3 de la revisión final de `feature/resenas-google`: la API leía esta variable suelta en
// `crearDeps` con `=== "live" ? "live" : "mock"`, así que un typo (`"liv"`) caía a `mock` EN
// SILENCIO, mientras `orchestrator/src/config.ts` (`validarModoResenasGoogle`) lanza ante el mismo
// valor. Mismo botón de operación, dos procesos, dos comportamientos — estos tests fijan que la API
// ahora falle tan cerrado como el orquestador.

test("GOOGLE_REVIEWS_MODO por defecto es 'mock' si no está la variable", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: CORS });
  const config = leerConfig();
  assert.equal(config.modoResenasGoogle, "mock");
});

test("acepta GOOGLE_REVIEWS_MODO=live explícito", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: CORS, GOOGLE_REVIEWS_MODO: "live" });
  const config = leerConfig();
  assert.equal(config.modoResenasGoogle, "live");
});

test("🔴 GOOGLE_REVIEWS_MODO con un valor que no es mock/live NO cae a 'mock' en silencio: lanza", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: CORS, GOOGLE_REVIEWS_MODO: "liv" });
  assert.throws(() => leerConfig(), /GOOGLE_REVIEWS_MODO inválido/);
});
