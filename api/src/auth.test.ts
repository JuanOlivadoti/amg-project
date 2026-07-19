import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { verificadorSupabase, AUD_SUPABASE } from "./auth.js";

/**
 * EL TEST QUE NO EXISTÍA — y su ausencia dejaba abierta la frontera de autenticación.
 *
 * Los tests de `app.test.ts` inyectan un verificador FALSO (`valid:<uuid>`), que es lo correcto para
 * probar rutas y RLS sin criptografía… pero significaba que **`verificadorSupabase` no lo ejercitaba
 * nadie**. Medido por la 8ª review: mutarlo para aceptar CUALQUIER token dejaba los 21 tests en
 * verde. Es exactamente el error que vengo criticando —probar lo fácil en vez de lo que se rompe—,
 * cometido en la puerta de entrada.
 *
 * Acá se firman JWT de verdad (HS256) y se prueba el CONTRATO: qué entra y qué no.
 */

const SECRETO = "secreto-de-prueba-muy-largo-para-hs256";
const clave = new TextEncoder().encode(SECRETO);

/** Firma un token. Cada parámetro se puede romper a propósito para probar el rechazo. */
async function firmar(opts: {
  sub?: string | undefined;
  exp?: string | number | undefined;
  aud?: string | undefined;
  iss?: string | undefined;
  secreto?: Uint8Array;
} = {}): Promise<string> {
  let jwt = new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuedAt();
  if (opts.sub !== undefined) jwt = jwt.setSubject(opts.sub);
  if (opts.exp !== undefined) jwt = jwt.setExpirationTime(opts.exp);
  if (opts.aud !== undefined) jwt = jwt.setAudience(opts.aud);
  if (opts.iss !== undefined) jwt = jwt.setIssuer(opts.iss);
  return jwt.sign(opts.secreto ?? clave);
}

const verificar = verificadorSupabase(SECRETO);

test("un token válido de Supabase entra, y devuelve el sub como userId", async () => {
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE });
  assert.deepEqual(await verificar(token), { userId: "user-1" });
});

test("🔴 un token SIN exp se rechaza: sin caducidad sería eterno", async () => {
  // El bug real: `jwtVerify` valida `exp` si está, pero no lo exige. Un token firmado con el secreto
  // correcto y sin `exp` no vencía NUNCA.
  const token = await firmar({ sub: "user-1", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("un token expirado se rechaza", async () => {
  const token = await firmar({ sub: "user-1", exp: "-1h", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("un token firmado con OTRO secreto se rechaza", async () => {
  const otro = new TextEncoder().encode("otro-secreto-completamente-distinto");
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, secreto: otro });
  assert.equal(await verificar(token), null);
});

test("un token sin sub se rechaza: no hay a quién identificar", async () => {
  const token = await firmar({ exp: "2h", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("un sub vacío se rechaza (no se pone app.user_id = '')", async () => {
  const token = await firmar({ sub: "", exp: "2h", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("🔴 un token con OTRA audiencia se rechaza (no es para esta API)", async () => {
  const token = await firmar({ sub: "user-1", exp: "2h", aud: "otra-app" });
  assert.equal(await verificar(token), null);
});

test("si se configura issuer, un token de OTRO proyecto se rechaza", async () => {
  const conIssuer = verificadorSupabase(SECRETO, {
    issuer: "https://proyecto-real.supabase.co/auth/v1",
  });
  const propio = await firmar({
    sub: "user-1",
    exp: "2h",
    aud: AUD_SUPABASE,
    iss: "https://proyecto-real.supabase.co/auth/v1",
  });
  const ajeno = await firmar({
    sub: "user-1",
    exp: "2h",
    aud: AUD_SUPABASE,
    iss: "https://proyecto-de-otro.supabase.co/auth/v1",
  });
  assert.deepEqual(await conIssuer(propio), { userId: "user-1" });
  assert.equal(await conIssuer(ajeno), null);
});

test("🔴 un HS512 firmado con el MISMO secreto se rechaza: el contrato es HS256", async () => {
  // No es un bypass (hace falta el secreto), pero una política declarada y no impuesta no es una
  // política. Sin `algorithms: ["HS256"]` esto entraba.
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS512" })
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("2h")
    .setAudience(AUD_SUPABASE)
    .sign(clave);
  assert.equal(await verificar(token), null);
});

test("alg:none se rechaza", async () => {
  // Header y payload sin firma: el ataque clásico.
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "user-1", exp, aud: AUD_SUPABASE })}.`;
  assert.equal(await verificar(token), null);
});

test("un sub de solo espacios se rechaza: no identifica a nadie", async () => {
  const token = await firmar({ sub: "   ", exp: "2h", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("basura no rompe: devuelve null, no lanza", async () => {
  assert.equal(await verificar("no-es-un-jwt"), null);
  assert.equal(await verificar(""), null);
});
