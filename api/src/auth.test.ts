import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { verificadorSupabase, emisorSupabase, AUD_SUPABASE, NO_DISPONIBLE } from "./auth.js";

/**
 * EL TEST QUE NO EXISTÍA — y su ausencia dejaba abierta la frontera de autenticación.
 *
 * Los tests de `app.test.ts` inyectan un verificador FALSO (`valid:<uuid>`), que es lo correcto para
 * probar rutas y RLS sin criptografía… pero significaba que **`verificadorSupabase` no lo ejercitaba
 * nadie**. Medido por la 8ª review: mutarlo para aceptar CUALQUIER token dejaba los 21 tests en
 * verde.
 *
 * Acá se firman JWT de verdad (ES256, como firma Supabase desde su migración a claves asimétricas) y
 * se prueba el CONTRATO: qué entra, qué no, y qué devuelve cuando NO SE PUEDE saber. El JWKS es
 * LOCAL: la suite no toca la red, ni siquiera a localhost.
 */

const KID = "clave-de-prueba";
const KID_384 = "clave-de-prueba-384";

// `extractable: true` hace falta para poder exportar la pública a JWK.
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
// Un segundo par ES256: "otro emisor". Sustituye al viejo caso de "otro secreto".
const otro = await generateKeyPair("ES256", { extractable: true });
// Un par ES384 CUYA PÚBLICA SÍ ESTÁ EN EL JWKS. Es lo que hace que el test de algoritmo sirva: si la
// clave no fuera resoluble, abrir la lista no cambiaría el resultado y la mutación no probaría nada.
const p384 = await generateKeyPair("ES384", { extractable: true });

const JWKS: JWTVerifyGetKey = createLocalJWKSet({
  keys: [
    { ...(await exportJWK(publicKey)), alg: "ES256", kid: KID },
    { ...(await exportJWK(p384.publicKey)), alg: "ES384", kid: KID_384 },
  ],
});

/** Firma un token. Cada parámetro se puede romper a propósito para probar el rechazo. */
async function firmar(
  opts: {
    sub?: string | undefined;
    exp?: string | number | undefined;
    aud?: string | undefined;
    iss?: string | undefined;
    clave?: KeyLike;
    kid?: string | undefined;
    alg?: string;
  } = {},
): Promise<string> {
  const kid = opts.kid === undefined ? KID : opts.kid;
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: opts.alg ?? "ES256", ...(kid === "" ? {} : { kid }) })
    .setIssuedAt();
  if (opts.sub !== undefined) jwt = jwt.setSubject(opts.sub);
  if (opts.exp !== undefined) jwt = jwt.setExpirationTime(opts.exp);
  if (opts.aud !== undefined) jwt = jwt.setAudience(opts.aud);
  if (opts.iss !== undefined) jwt = jwt.setIssuer(opts.iss);
  return jwt.sign(opts.clave ?? privateKey);
}

const verificar = verificadorSupabase(JWKS);

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

test("un token firmado por OTRO emisor se rechaza", async () => {
  // Antes era "otro secreto". Con firma asimétrica el equivalente es otra clave privada: el `kid`
  // dice que es la nuestra, pero la firma no cierra contra la pública del JWKS.
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, clave: otro.privateKey });
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
  const conIssuer = verificadorSupabase(JWKS, {
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

test("🔴 un ES384 se rechaza aunque su clave ESTÉ en el JWKS: el contrato es ES256", async () => {
  // ESTE es el test que fija `algorithms: ["ES256"]`, y está construido para que la mutación lo
  // tumbe: la pública ES384 está en el JWKS, así que si se abriera la lista el token verificaría.
  //
  // No se usa HS256 para esto: está MEDIDO que `jose` rechaza HS256 con un resolvedor JWKS aunque
  // el algoritmo esté permitido (no resuelve claves HMAC desde un JWKS), así que un test de HS256
  // pasa igual con la lista abierta y no probaría nada.
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, alg: "ES384", clave: p384.privateKey, kid: KID_384 });
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

test("un token HS256 se rechaza", async () => {
  // Contrato, NO prueba de la lista de algoritmos: con un resolvedor JWKS `jose` lo rechaza igual
  // aunque HS256 esté permitido, porque no resuelve claves HMAC desde un JWKS. Está medido. Quien
  // quiera fijar la lista, mire el test de ES384.
  const secreto = new TextEncoder().encode("cualquier-secreto-simetrico-de-atacante");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject("user-1")
    .setExpirationTime("2h")
    .setAudience(AUD_SUPABASE)
    .sign(secreto);
  assert.equal(await verificar(token), null);
});

test("un kid que no está en el JWKS se rechaza", async () => {
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, kid: "no-existe" });
  assert.equal(await verificar(token), null);
});

test("un token SIN kid entra si el JWKS tiene una sola clave compatible", async () => {
  // Decisión fijada, no accidente: la clave sale igual del conjunto de confianza. Si algún día se
  // decide exigir `kid`, este test es el que tiene que cambiar — y el cambio será deliberado.
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, kid: "" });
  assert.deepEqual(await verificar(token), { userId: "user-1" });
});

test("🔴 si el JWKS no se puede obtener, devuelve NO_DISPONIBLE (no null)", async () => {
  // Fallar cerrado, pero SIN mentir: un error de red no dice nada del token. El resolvedor se
  // INYECTA rechazando — nada de apuntar a un puerto muerto, que abriría un socket de verdad.
  const resolvedorCaido: JWTVerifyGetKey = async () => {
    throw new Error("getaddrinfo ENOTFOUND proyecto.supabase.co");
  };
  const verificarSinJwks = verificadorSupabase(resolvedorCaido);
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE });
  assert.equal(await verificarSinJwks(token), NO_DISPONIBLE);
});

test("🔴 un token inválido devuelve null, no NO_DISPONIBLE", async () => {
  // El complemento del anterior: si todo cayera en NO_DISPONIBLE, la API respondería 503 a las
  // credenciales malas y el 401 dejaría de existir.
  const token = await firmar({ sub: "user-1", exp: "-1h", aud: AUD_SUPABASE });
  assert.equal(await verificar(token), null);
});

test("emisorSupabase canoniza la barra final y deriva el JWKS del MISMO valor", async () => {
  // El bug que esto previene: quitarle la barra solo para el JWKS y exigir el `iss` con barra. El
  // JWKS bajaría bien y NINGÚN token verificaría.
  const e = emisorSupabase("https://abc.supabase.co/auth/v1/");
  assert.equal(e.issuer, "https://abc.supabase.co/auth/v1");
  assert.equal(e.jwksUrl.href, "https://abc.supabase.co/auth/v1/.well-known/jwks.json");
});

test("emisorSupabase acepta el formato normal y recorta espacios", async () => {
  const e = emisorSupabase("  https://abc.supabase.co/auth/v1  ");
  assert.equal(e.issuer, "https://abc.supabase.co/auth/v1");
});

test("🔴 emisorSupabase exige exactamente <project-ref>.supabase.co", async () => {
  // No alcanza con exigir https: un issuer ajeno sustituye el emisor de confianza entero.
  assert.throws(() => emisorSupabase("https://atacante.example/auth/v1"), /Supabase/);
  // Y no alcanza con un `endsWith`: ninguno de estos es un endpoint de proyecto.
  assert.throws(() => emisorSupabase("https://supabase.co/auth/v1"), /Supabase/);
  assert.throws(() => emisorSupabase("https://a.b.supabase.co/auth/v1"), /Supabase/);
  assert.throws(() => emisorSupabase("https://malo.supabase.co.atacante.example/auth/v1"), /Supabase/);
});

test("🔴 emisorSupabase rechaza http", async () => {
  assert.throws(() => emisorSupabase("http://abc.supabase.co/auth/v1"), /https/);
});

test("🔴 emisorSupabase rechaza una ruta que no sea /auth/v1", async () => {
  assert.throws(() => emisorSupabase("https://abc.supabase.co/otra/cosa"), /auth\/v1/);
});

test("🔴 emisorSupabase rechaza query, fragment, puerto y credenciales", async () => {
  assert.throws(() => emisorSupabase("https://abc.supabase.co/auth/v1?x=1"), /query/);
  assert.throws(() => emisorSupabase("https://abc.supabase.co/auth/v1#x"), /query|fragment/);
  assert.throws(() => emisorSupabase("https://abc.supabase.co:8443/auth/v1"), /puerto/);
  assert.throws(() => emisorSupabase("https://u:p@abc.supabase.co/auth/v1"), /credenciales/);
});

test("emisorSupabase rechaza una URL que no es URL", async () => {
  assert.throws(() => emisorSupabase("no-es-una-url"), /URL válida/);
});
