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
  for (const k of ["DATABASE_URL_API", "CORS_ORIGINS", "SUPABASE_JWT_AUD", "SUPABASE_JWT_ISS"]) {
    delete process.env[k];
  }
  Object.assign(process.env, vars);
}

const BASE = {
  DATABASE_URL_API: "postgres://amg_api@host/db",
  SUPABASE_JWT_ISS: "https://proyecto.supabase.co/auth/v1",
};

test("falla cerrado si falta CORS_ORIGINS (no arranca con `*` en algo expuesto)", () => {
  conEntorno(BASE);
  assert.throws(() => leerConfig(), /CORS_ORIGINS/);
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
