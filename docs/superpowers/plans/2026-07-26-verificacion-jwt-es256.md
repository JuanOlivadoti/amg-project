# Verificación de JWT con ES256 (JWKS) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el login del portal funcione en producción, verificando los tokens ES256 de Supabase contra su JWKS público en vez de un secreto compartido — y que cerrar sesión revoque de verdad.

**Architecture:** `verificadorSupabase` deja de recibir un secreto y pasa a recibir un resolvedor de claves (`JWTVerifyGetKey` de `jose`). El emisor se **canoniza y valida una sola vez** (`emisorSupabase`), y de ese único valor salen tanto el `iss` que se exige como la URL del JWKS. El verificador distingue *"el token es inválido"* (401) de *"no pude comprobarlo"* (503). `SUPABASE_JWT_SECRET` desaparece del sistema y `SUPABASE_JWT_ISS` pasa a obligatoria.

**Tech Stack:** TypeScript ESM strict · `jose` 5.10.0 (ya es dependencia de `api`) · `node:test` + `node:assert` · Angular 20 (portal) · `tsx`, sin paso de build.

## Global Constraints

- **Diseño validado contra el proyecto real** (2026-07-26): `alg=ES256`, `aud=authenticated`, `iss=https://<ref>.supabase.co/auth/v1`, y el `app_metadata` trae `tenant_id` y `rol`. **`AUD_SUPABASE` no cambia.**
- **`algorithms` es siempre una lista cerrada de un solo algoritmo** (`["ES256"]`). Nunca más de uno: con firma asimétrica la clave pública es conocida.
- **La lista de algoritmos se fija con un test de ES384, no con uno de HS256.** Está *medido*: con un resolvedor JWKS, `jose` rechaza `HS256` aunque esté en la lista (`ERR_JOSE_NOT_SUPPORTED`: no resuelve claves HMAC desde un JWKS), así que un test de HS256 **no cae bajo mutación** y no fija nada. El de ES384 sí, porque su clave pública está en el JWKS de prueba y es realmente resoluble.
- **Fallar cerrado siempre.** Ni el 401 ni el 503 dejan pasar a nadie: la diferencia es solo qué se le informa al portal.
- **Un único valor canónico de emisor.** El `iss` que se exige y el host del JWKS salen de la misma `EmisorSupabase`. Dos valores que deben apuntar al mismo proyecto son dos oportunidades de que no coincidan.
- **Rojo primero, después el arreglo, después mutación**: reintroducir el bug y confirmar que cae *exactamente* su test.
- Tests con `node:test` + `node:assert`, sin dependencias nuevas y **sin red — ni siquiera a `localhost`**. Un resolvedor que falla se **inyecta**, no se simula abriendo un socket.
- **El repositorio queda en verde en cada commit**: `npm test` y `npm run typecheck` desde la raíz, después de cada tarea.
- Comentarios en español que expliquen **por qué**, no qué.
- Mensajes de commit en español, terminados en `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No tocar `docs/private/` ni ningún `.env` en un commit.

---

## Contexto de la revisión (leer antes de empezar)

Este plan es la **tercera versión**: dos rondas de revisión externa (Codex), con cada hallazgo
verificado contra el código real o ejecutándolo. Si al ejecutar te dan ganas de "simplificar" alguno
de estos puntos, son justamente los que costaron una revisión:

| Lo que parecía razonable | Por qué no lo es |
| --- | --- |
| Probar la lista de algoritmos con un token HS256 | Medido: no cae bajo mutación. `jose` lo rechaza por otra razón |
| Quitarle la barra final al issuer solo para el JWKS | El `iss` que se exige quedaría con la barra y **ningún token verificaría** |
| Validar que el issuer sea `https` y nada más | Deja pasar `https://atacante.example/auth/v1`: cambia el emisor de confianza entero |
| Anclar el host con `endsWith(".supabase.co")` | Deja pasar `supabase.co` pelado y `a.b.supabase.co`, que no son endpoints de proyecto |
| Un test que apunte a `127.0.0.1:1` | Abre un socket: rompe el invariante de suite sin red |
| Limpiar el estado local en un `finally` después del `await` | La UI queda autenticada mientras el `fetch` cuelga, y puede pisar una sesión nueva |
| Cubrir las carreras del portal **solo** con una época | La época cambia al *iniciar*: un refresh disparado después de un login comparte la suya y pisa la sesión nueva |
| Compartir `refrescoEnVuelo` sin mirar de qué sesión es | Tras logout + login, el refresh nuevo devuelve el `false` del viejo |
| Probar el logout mirando solo la signal | Quitar el `removeItem` queda en verde, y la sesión vuelve al recargar |
| Un `fetch` falso único para logout y refresh | El test se **cuelga** en vez de fallar: ambos esperan la misma promesa |
| Mutar el `catch` entero para probar la clasificación 401/503 | Tumba media suite. Hay que mutar **un** código de la allowlist |
| Dar por hecho que cada mutación tumba 1 test | Varias tumban 2. Lo que importa es predecir **cuáles**, no que sea una |
| Confiar en que "los 10 tests actuales" se conservan | Son **12**, y dos usan símbolos que el andamiaje viejo definía |

**Verificado ejecutándolo** antes de escribir esta versión: la mutación de algoritmo, los códigos de
error de `jose` por caso, que `AuthService` es instanciable bajo `node --test`, que `localStorage` es
asignable en Node 24, y los 23 casos de aceptación/rechazo de `emisorSupabase`.

---

## File Structure

| Archivo | Responsabilidad | Acción |
| --- | --- | --- |
| `api/src/auth.ts` | Verificador, clasificación de fallos, emisor canónico y JWKS | Modificar |
| `api/src/auth.test.ts` | El contrato del verificador y del emisor | Reescribir andamiaje + casos |
| `api/src/app.test.ts` | Que un fallo de verificación dé 503 y no 401 | Agregar 1 caso |
| `api/src/index.ts` | Superficie pública del paquete | Modificar exports |
| `api/src/deps.ts` | Composition root: lee entorno, arma el verificador | Modificar |
| `api/src/deps.test.ts` | Que la config falle cerrado | Modificar |
| `api/.env.example` | Contrato público de variables de la API | Modificar |
| `scripts/env-sync.mts` | `MAPA`: qué claves recibe cada paquete | Modificar |
| `portal/src/app/core/auth-core.ts` | Lógica pura de auth contra GoTrue | Agregar `cerrarSesion` |
| `portal/src/app/core/auth-core.test.ts` | Su contrato | Agregar casos |
| `portal/src/app/services/auth.ts` | Estado de sesión del portal | Modificar `logout`, `login`, `hacerRefresh` |
| `portal/src/app/services/auth.test.ts` | **Nuevo.** Que el estado local se limpie siempre y sin carreras | Crear |
| `portal/src/app/app.ts:25` | Llama a `logout()` | Ajustar a async |

---

## Task 1: El verificador exige ES256 contra el JWKS y distingue "no pude comprobar" ✅ HECHA

> **Estado: completa** — implementación `9706bec`, correcciones de review `5f6bc23`. 464 tests en el
> monorepo (64 en `api`, 27 en `auth.test.ts`), typecheck limpio.
>
> **Tres cosas quedaron distintas de lo escrito abajo**, por hallazgos de la review. Si leés estos
> pasos para entender el código, leé también esto:
>
> 1. **Existe `verificadorDeEmisor(emisor, claves?, opts?)`**, y es lo que usa `crearDeps`. Los pasos
>    de abajo hacían que `deps.ts` pasara el resolvedor y el `issuer` por separado, y la garantía de
>    que salieran del mismo emisor vivía **solo en un comentario**: `crearDeps` no lo prueba nadie, así
>    que borrar la línea del issuer dejaba la suite entera en verde y la API dejaba de comprobar el
>    emisor. Ahora un token de otro proyecto Supabase tumba un test.
> 2. **`ERR_JWKS_MULTIPLE_MATCHING_KEYS` NO está en `CODIGOS_DE_TOKEN`.** El bloque de abajo lo
>    incluye; fue un error. Ese código describe **nuestro** conjunto de claves, no la credencial:
>    salta durante una rotación que publica dos claves ES256 a la vez, que es exactamente la ventana
>    para la que existe el 503.
> 3. **La audiencia usa `||` con `trim()`, no `??`.** Con `??`, un `audience: ""` apagaba la
>    comprobación de audiencia en silencio.

**Files:**

- Modify: `api/src/auth.ts` (imports, `VerificadorToken`, `verificadorSupabase`, `autenticar`; agregar `emisorSupabase` y `jwksDeSupabase`)
- Modify: `api/src/deps.ts` (`ConfigApi`, `leerConfig`, armado del verificador)
- Modify: `api/src/index.ts` (exports)
- Test: `api/src/auth.test.ts` (reescritura del andamiaje + casos), `api/src/deps.test.ts`, `api/src/app.test.ts`

**Interfaces:**

- Consumes: nada de tareas anteriores.
- Produces:
  - `NO_DISPONIBLE = "no-disponible"` y `VerificadorToken = (token: string) => Promise<{ userId: string } | null | typeof NO_DISPONIBLE>`
  - `interface EmisorSupabase { issuer: string; jwksUrl: URL }`
  - `emisorSupabase(valor: string): EmisorSupabase` (lanza si no valida)
  - `jwksDeSupabase(emisor: EmisorSupabase): JWTVerifyGetKey`
  - `verificadorSupabase(claves: JWTVerifyGetKey, opts?: OpcionesJwt): VerificadorToken`
  - `ConfigApi` sin `jwtSecret`, con `emisor: EmisorSupabase`

> **Por qué esta tarea toca `auth.ts` y `deps.ts` juntos.** Cambiar la firma de `verificadorSupabase`
> sin cambiar su único llamador dejaría el typecheck en rojo entre commits. Van en el mismo commit.

- [ ] **Step 1: Reescribir el andamiaje del test a ES256**

Reemplazá las **líneas 1-37** de `api/src/auth.test.ts` por esto. El resto del archivo (los `test(...)`) se ajusta en los steps siguientes:

```typescript
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
```

- [ ] **Step 2: Ajustar los dos tests que usaban el andamiaje viejo**

Los símbolos `SECRETO` y `clave` ya no existen. Dos tests los usan y **el archivo no compila hasta arreglarlos**.

Reemplazá el test `un token firmado con OTRO secreto se rechaza` por:

```typescript
test("un token firmado por OTRO emisor se rechaza", async () => {
  // Antes era "otro secreto". Con firma asimétrica el equivalente es otra clave privada: el `kid`
  // dice que es la nuestra, pero la firma no cierra contra la pública del JWKS.
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, clave: otro.privateKey });
  assert.equal(await verificar(token), null);
});
```

Reemplazá el test `si se configura issuer, un token de OTRO proyecto se rechaza` por:

```typescript
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
```

Reemplazá el test `🔴 un HS512 firmado con el MISMO secreto se rechaza: el contrato es HS256` por su equivalente asimétrico, **que es el que fija la lista de algoritmos**:

```typescript
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
```

- [ ] **Step 3: Correr los tests y verificar que FALLAN**

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL. `verificadorSupabase` todavía espera un `string` y usa `algorithms: ["HS256"]`, y `emisorSupabase`/`NO_DISPONIBLE` no existen: fallan el import y las aserciones.

- [ ] **Step 4: Reescribir `api/src/auth.ts`**

Reemplazá la línea 1 por:

```typescript
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
```

Reemplazá el bloque de las líneas 5-12 (el comentario de `VerificadorToken` y el tipo) por:

```typescript
/**
 * El verificador no pudo COMPROBAR la firma: JWKS inalcanzable, DNS caído, timeout.
 *
 * No es lo mismo que un token inválido, y confundirlos tiene una consecuencia concreta: el portal
 * trata cualquier 401 como "token vencido", así que quema el refresh token y reintenta. Con esto,
 * una caída del JWKS devuelve 503 y el portal no destruye la sesión de nadie.
 *
 * **Sigue fallando cerrado**: 401 y 503 deniegan igual. Lo único que cambia es qué se informa.
 */
export const NO_DISPONIBLE = "no-disponible";

/**
 * Verifica el token y devuelve QUIÉN es. Nada más.
 *
 * Se INYECTA a propósito: los tests pasan un verificador de mentira y ejercitan toda la API sin
 * Supabase ni criptografía; producción pasa el de abajo. Es la misma disciplina que ya separa el
 * emisor de eventos de Inngest.
 */
export type VerificadorToken = (
  token: string,
) => Promise<{ userId: string } | null | typeof NO_DISPONIBLE>;
```

Reemplazá el bloque de las líneas 25-62 (el comentario de `verificadorSupabase` y la función) por:

```typescript
/**
 * Códigos de `jose` que hablan del TOKEN: la credencial que trajo el usuario está mal.
 *
 * Todo lo que NO esté acá se trata como "no pude comprobar". Es a propósito que la lista sea de
 * códigos de token y no de códigos de red: un fallo de red no siempre trae un código de `jose` —
 * está medido que un resolvedor que rechaza llega **sin `code`**, y `createRemoteJWKSet` contra un
 * host muerto llega con `ECONNREFUSED`, que es de Node. Enumerar lo enumerable y tratar el resto
 * como infraestructura es lo único que no deja un caso sin clasificar.
 *
 * `ERR_JWKS_NO_MATCHING_KEY` cuenta como token: el `kid` no está en el conjunto de confianza. La
 * rotación no lo dispara en la práctica — Supabase publica la clave nueva antes de firmar con ella,
 * y la vieja sigue en el JWKS.
 */
const CODIGOS_DE_TOKEN = new Set([
  "ERR_JWS_INVALID",
  "ERR_JWT_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JOSE_NOT_SUPPORTED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

/**
 * Verificador de JWT de Supabase (**ES256 contra el JWKS del proyecto**).
 *
 * No recibe un secreto: recibe un RESOLVEDOR de claves. Producción le pasa `jwksDeSupabase(...)`
 * —que baja la clave pública y la cachea— y los tests le pasan un JWKS local. Esa inversión es lo
 * que mantiene la suite sin red.
 *
 * Por qué no hay secreto compartido: Supabase firma con una clave asimétrica y **la privada nunca
 * sale de Supabase**. Antes había un `SUPABASE_JWT_SECRET` en las variables de Railway, en las notas
 * de despliegue y en cualquier transcript donde se hubiera pegado. Ahora no hay nada que filtrar.
 *
 * Comprueba la firma **y exige `exp` y `sub`**. Lo de `exp` no es un detalle: `jwtVerify` valida la
 * expiración *si el claim está*, pero **no lo exige** — así que un token bien firmado y **sin `exp`
 * no caducaba nunca**. Con `requiredClaims` deja de pasar. (Lo encontró la 8ª review: yo escribí
 * este verificador y **ningún test lo tocaba**.)
 *
 * Un token **sin `kid`** se acepta si el JWKS tiene una sola clave compatible. Está medido y es una
 * decisión, no un descuido: la clave sale igual del conjunto de confianza, y exigir `kid` nos ata a
 * un detalle del header que Supabase puede cambiar. Hay un test que lo fija.
 *
 * Acá termina lo que la API afirma: **quién es**. **Qué puede hacer** no se decide en TypeScript —
 * lo deriva Postgres de `memberships` (ADR-15).
 */
export function verificadorSupabase(
  claves: JWTVerifyGetKey,
  opts: OpcionesJwt = {},
): VerificadorToken {
  const audience = opts.audience ?? AUD_SUPABASE;
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, claves, {
        // Lista CERRADA de un solo algoritmo, y ahora importa más que antes: con firma asimétrica la
        // clave pública es conocida, así que aceptar un segundo algoritmo abre la puerta a que el
        // token se valide contra una clave que no es la que debería firmarlo. La fija el test de
        // ES384 (el de HS256 NO sirve para esto: ver su comentario).
        algorithms: ["ES256"],
        // Sin esto, un token sin `exp` es eterno. Y sin `sub` no hay a quién identificar.
        requiredClaims: ["exp", "sub"],
        ...(audience ? { audience } : {}),
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
      });
      const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
      // `sub` en blanco (o solo espacios) no identifica a nadie: `app.user_id` quedaría vacío.
      return sub.length > 0 ? { userId: sub } : null;
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      // Los dos caminos deniegan. La diferencia es si el problema es del token o nuestro.
      return typeof code === "string" && CODIGOS_DE_TOKEN.has(code) ? null : NO_DISPONIBLE;
    }
  };
}

/** Emisor Supabase ya validado y canonizado: el `iss` que se exige y de dónde sale su clave. */
export interface EmisorSupabase {
  /** `iss` exacto que tiene que traer el token. Sin barra final. */
  issuer: string;
  /** `<issuer>/.well-known/jwks.json`. */
  jwksUrl: URL;
}

/**
 * Valida y canoniza el emisor. **Lanza** si no cierra: una API a medio configurar no arranca.
 *
 * Por qué canoniza en UN solo lugar: si se le quitara la barra final solo para armar la URL del
 * JWKS, el `iss` que se exige quedaría con la barra, no coincidiría con el que emite Supabase y
 * **ningún token verificaría** — el mismo 401 total que este cambio viene a arreglar.
 *
 * Por qué no alcanza con exigir `https`: `https://atacante.example/auth/v1` es https y válido, y
 * bajaría el JWKS de un host ajeno. Eso no es solo una petición saliente indeseada: sustituye el
 * emisor de confianza entero, y a partir de ahí cualquier token que ese host firme entra. Por eso se
 * ancla al dominio de Supabase.
 *
 * Limitación conocida y aceptada: un dominio de auth propio (Supabase lo permite) no pasaría esta
 * validación. Si algún día se usa, hay que ampliar esto a propósito — que falle ruidosamente al
 * arrancar es exactamente lo que se busca.
 */
export function emisorSupabase(valor: string): EmisorSupabase {
  const crudo = valor.trim();
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    throw new Error(`SUPABASE_JWT_ISS no es una URL válida: "${crudo}".`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`SUPABASE_JWT_ISS debe ser https (es "${url.protocol}").`);
  }
  if (url.username || url.password) {
    throw new Error("SUPABASE_JWT_ISS no puede llevar credenciales embebidas.");
  }
  if (url.port) {
    throw new Error(`SUPABASE_JWT_ISS no lleva puerto (tiene ":${url.port}").`);
  }
  if (url.search || url.hash) {
    throw new Error("SUPABASE_JWT_ISS no puede llevar query ni fragment.");
  }
  // Exactamente `<project-ref>.supabase.co`: UNA etiqueta no vacía y nada más. Un `endsWith`
  // dejaba pasar `supabase.co` pelado, `.supabase.co` y `a.b.supabase.co`, que no son endpoints de
  // proyecto: la API arrancaría para después fallar en cada login con un 503 inexplicable.
  if (!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
    throw new Error(
      `SUPABASE_JWT_ISS debe ser un host de proyecto Supabase (es "${url.hostname}"). ` +
        "Formato esperado: https://<project-ref>.supabase.co/auth/v1",
    );
  }
  const ruta = url.pathname.replace(/\/+$/, "");
  if (ruta !== "/auth/v1") {
    throw new Error(
      `SUPABASE_JWT_ISS debe terminar en /auth/v1 (su ruta es "${url.pathname}").`,
    );
  }
  const issuer = `${url.origin}${ruta}`;
  return { issuer, jwksUrl: new URL(`${issuer}/.well-known/jwks.json`) };
}

/**
 * El resolvedor de claves del proyecto.
 *
 * `createRemoteJWKSet` cachea la clave y refresca con cooldown (medido en jose 5.10.0: timeout 5 s,
 * cooldown 30 s, cache 10 min), así que soporta rotación sin redeploy y no pega en cada request.
 * Durante una rotación puede haber hasta ~30 s en que un `kid` recién publicado no se resuelve; es
 * aceptable porque Supabase publica la clave nueva antes de firmar con ella.
 */
export function jwksDeSupabase(emisor: EmisorSupabase): JWTVerifyGetKey {
  return createRemoteJWKSet(emisor.jwksUrl);
}
```

- [ ] **Step 5: Que `autenticar` traduzca "no disponible" a 503**

En `api/src/auth.ts`, dentro de `autenticar`, reemplazá las dos líneas:

```typescript
    const claims = await verificar(token);
    if (!claims) return c.json({ error: "Token inválido o expirado." }, 401);
```

por:

```typescript
    const claims = await verificar(token);
    if (claims === NO_DISPONIBLE) {
      // No es culpa de la credencial: no pudimos comprobarla. Con 401 el portal daría por muerta la
      // sesión y quemaría el refresh token por una caída de Supabase.
      return c.json({ error: "No se puede verificar el token en este momento." }, 503);
    }
    if (!claims) return c.json({ error: "Token inválido o expirado." }, 401);
```

- [ ] **Step 6: Agregar los casos nuevos del verificador**

Al final de `api/src/auth.test.ts`:

```typescript
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
```

- [ ] **Step 7: Agregar los casos del emisor canónico**

Al final de `api/src/auth.test.ts`:

```typescript
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
```

- [ ] **Step 8: Correr los tests del verificador**

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: PASS, **24 tests**.

Si el número no coincide, contá los `test(` del archivo y reconciliá antes de seguir — **no ajustes el número a ojo**: el conteo es la señal de que no se perdió ningún caso de los 12 originales.

- [ ] **Step 9: Verificación por mutación del algoritmo (NO saltear)**

Agregá `"ES384"` a la lista en `api/src/auth.ts` — que quede `algorithms: ["ES256", "ES384"]` — y corré:

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL, y **exactamente 1 test**: `🔴 un ES384 se rechaza aunque su clave ESTÉ en el JWKS`.

Si cae otro número de tests, el andamiaje está mal. **Revertí la mutación** y volvé a correr: 24 en verde.

- [ ] **Step 10: Verificación por mutación de la clasificación de fallos (NO saltear)**

En `api/src/auth.ts`, hacé que el `catch` devuelva siempre `null` (borrá la comprobación de `CODIGOS_DE_TOKEN`) y corré:

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL, y **exactamente 1 test**: `🔴 si el JWKS no se puede obtener, devuelve NO_DISPONIBLE (no null)`.

Después, para la dirección contraria, **no** mutes el `catch` entero: hacer que devuelva siempre
`NO_DISPONIBLE` tumbaría una decena de tests (todos los que rechazan por excepción), y una mutación
que tumba media suite no señala nada. Mutá **un solo código de la allowlist**: quitá
`"ERR_JWKS_NO_MATCHING_KEY"` de `CODIGOS_DE_TOKEN` y corré:

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL, y **exactamente 1 test**: `un kid que no está en el JWKS se rechaza` — que pasa a
devolver `NO_DISPONIBLE` en vez de `null`. Eso prueba que la allowlist **se consulta de verdad**.

Ojo con lo que *no* prueba: quitar una entrada demuestra que **esa** entrada se consulta, no que todas
las demás tengan un caso que las cubra. Si querés esa garantía, hay que ir código por código.

**Revertí las dos mutaciones** y volvé a verde.

- [ ] **Step 11: El 503 en la API**

En `api/src/app.test.ts`, al final:

```typescript
test("🔴 si el verificador no puede comprobar, la API responde 503 y no 401", async () => {
  // Un 401 acá haría que el portal dé la sesión por muerta y queme el refresh token por una caída
  // de Supabase. Sigue sin dejar pasar a nadie.
  const { NO_DISPONIBLE } = await import("./auth.js");
  const caido: VerificadorToken = async () => NO_DISPONIBLE;
  const appCaida = createApp({ store, emisor, verificar: caido });
  const res = await appCaida.request("/runs", {
    headers: { authorization: "Bearer lo-que-sea", "x-amg-tenant": TENANT },
  });
  assert.equal(res.status, 503);
});
```

> **Nota para quien implemente:** `store`, `emisor`, `TENANT` y `createApp` ya existen en ese archivo.
> Usá los nombres reales que encuentres ahí — si el identificador del tenant se llama distinto,
> adaptá **el test**, no el archivo.

- [ ] **Step 12: Actualizar `deps.ts`**

En `api/src/deps.ts`, reemplazá la línea 3 por:

```typescript
import {
  verificadorSupabase,
  emisorSupabase,
  jwksDeSupabase,
  type EmisorSupabase,
  type VerificadorToken,
} from "./auth.js";
```

Reemplazá las líneas 11-25 (`ConfigApi`) por:

```typescript
export interface ConfigApi {
  /** Cadena de conexión del login `amg_api`. Ese login SOLO puede asumir `app_user` (ADR-17). */
  databaseUrl: string;
  /**
   * Emisor Supabase **ya validado y canonizado** (de `SUPABASE_JWT_ISS`). **Obligatorio**: de acá
   * salen las dos cosas que antes podían no coincidir — el `iss` que se le exige al token y la URL
   * del JWKS con el que se comprueba la firma. Antes el issuer era opcional; que lo fuera era el
   * agujero: un token válido de OTRO proyecto Supabase entraba.
   */
  emisor: EmisorSupabase;
  /** Id de la app Inngest emisora. La API es una app distinta del orquestador: solo envía eventos. */
  inngestId?: string;
  /** Orígenes CORS permitidos (coma-separados en `CORS_ORIGINS`). Sin esto: `*` (ver `app.ts`). */
  corsOrigins?: string[];
  /** `aud` esperado del JWT. Default `authenticated` (lo que emite Supabase). */
  jwtAudience?: string;
}
```

Reemplazá la línea 30 (`const jwtSecret = ...`) por:

```typescript
  const issCrudo = process.env["SUPABASE_JWT_ISS"]?.trim();
```

En el array `faltan`, reemplazá la línea de `jwtSecret` por:

```typescript
    !issCrudo && "SUPABASE_JWT_ISS (https://<proy>.supabase.co/auth/v1; de acá sale el JWKS)",
```

Reemplazá las líneas 63-71 (desde `const aud = ...` hasta el cierre del `return`) por:

```typescript
  const aud = process.env["SUPABASE_JWT_AUD"]?.trim();
  // Valida y canoniza acá, al arrancar: si el issuer está mal, la API no levanta. Es preferible a
  // levantar y rechazar todos los logins, que es como se ve el mismo error desde afuera.
  const emisor = emisorSupabase(issCrudo as string);
  return {
    databaseUrl: databaseUrl as string,
    emisor,
    corsOrigins,
    ...(aud ? { jwtAudience: aud } : {}),
  };
```

Reemplazá las líneas 108-111 (armado del verificador) por:

```typescript
  // El JWKS se deriva del MISMO emisor canónico que se exige como `iss`, y se comparte para toda la
  // vida del proceso: `createRemoteJWKSet` cachea la clave y refresca sola.
  const verificar: VerificadorToken = verificadorSupabase(jwksDeSupabase(config.emisor), {
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {}),
    issuer: config.emisor.issuer,
  });
```

- [ ] **Step 13: Actualizar `deps.test.ts`**

En `api/src/deps.test.ts`, en el array de claves que `conEntorno` borra (línea 21), quitá `"SUPABASE_JWT_SECRET"`.

Reemplazá el `BASE` (líneas 27-30) por:

```typescript
const BASE = {
  DATABASE_URL_API: "postgres://amg_api@host/db",
  SUPABASE_JWT_ISS: "https://proyecto.supabase.co/auth/v1",
};
```

Reemplazá el test `sigue fallando si falta la conexión o el secreto del JWT` por:

```typescript
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
```

- [ ] **Step 14: Actualizar los exports del paquete**

En `api/src/index.ts`, reemplazá las líneas 7-8 por:

```typescript
export { autenticar, verificadorSupabase, emisorSupabase, jwksDeSupabase, TENANT_HEADER, NO_DISPONIBLE } from "./auth.js";
export type { VerificadorToken, Variables, EmisorSupabase } from "./auth.js";
```

- [ ] **Step 15: Verde completo**

Run: `cd api && npm test`

Expected: PASS.

Run (desde la raíz): `npm run typecheck`

Expected: PASS. Si algo sigue en rojo acá, es que quedó un consumidor de `jwtSecret` sin migrar — arreglalo antes de commitear: **el repo tiene que quedar verde en cada commit**.

- [ ] **Step 16: Commit**

```bash
git add api/src/auth.ts api/src/auth.test.ts api/src/app.test.ts api/src/deps.ts api/src/deps.test.ts api/src/index.ts
git commit -m "$(cat <<'EOF'
El verificador de JWT exige ES256 contra el JWKS, no un secreto compartido

Supabase migró a claves asimétricas y el proyecto, creado el 2026-07-25, nació
con el esquema nuevo: firma ES256. La API solo aceptaba HS256, así que TODO
login terminaba en 401.

`verificadorSupabase` deja de recibir un secreto y recibe un resolvedor de
claves. Producción usa el JWKS remoto; los tests inyectan uno local, así la
suite sigue sin red — ni siquiera a localhost.

El emisor se canoniza y valida UNA vez (`emisorSupabase`): de ese único valor
salen el `iss` que se exige y la URL del JWKS. Canonizar solo uno de los dos
dejaría el otro sin coincidir y ningún token verificaría. Se ancla al dominio
de Supabase: exigir solo https dejaba pasar un issuer ajeno, que no es una
petición saliente de más sino la sustitución del emisor de confianza entero.

El verificador ahora distingue "el token es inválido" (401) de "no pude
comprobarlo" (503). Los dos deniegan; la diferencia es que con 401 el portal
daba la sesión por muerta y quemaba el refresh token ante una caída del JWKS.

La lista de algoritmos la fija un test de ES384, no uno de HS256: está medido
que `jose` rechaza HS256 con un resolvedor JWKS aunque esté permitido, así que
ese test no cae bajo mutación y no probaría nada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: El contrato de variables pierde el secreto

**Files:**

- Modify: `api/.env.example`
- Modify: `scripts/env-sync.mts` (el `MAPA`)

**Interfaces:**

- Consumes: el contrato de config de la Tarea 1 (`SUPABASE_JWT_ISS` obligatoria, sin `SUPABASE_JWT_SECRET`).
- Produces: nada de código.

- [ ] **Step 1: Actualizar `api/.env.example`**

Borrá el bloque de las líneas 21-23 (comentario + `SUPABASE_JWT_SECRET=`).

Borrá el bloque de las líneas 30-33 (el encabezado `── Recomendadas ──` y `SUPABASE_JWT_ISS=`), y en su lugar dejá el `SUPABASE_JWT_AUD` bajo un encabezado nuevo:

```bash
# ── Opcionales ───────────────────────────────────────────────────────────────────

# `aud` esperado. Por defecto `authenticated` (lo que emite Supabase). Dejalo vacío si no cambiaste el default.
SUPABASE_JWT_AUD=
```

Y dentro de la sección de **Obligatorias**, justo después del bloque de `DATABASE_URL_API`, agregá:

```bash
# `iss` del proyecto Supabase. La API deriva de acá el JWKS
# (`<iss>/.well-known/jwks.json`) y verifica con él la firma ES256 del token.
# NO hay secreto compartido: la clave privada nunca sale de Supabase.
# Además amarra el emisor: un token válido de OTRO proyecto no entra.
# Tiene que ser exactamente https://<project-ref>.supabase.co/auth/v1
SUPABASE_JWT_ISS=https://<project-ref>.supabase.co/auth/v1
```

- [ ] **Step 2: Actualizar el `MAPA`**

En `scripts/env-sync.mts`, reemplazá la línea de `api` por:

```typescript
  api: ["DATABASE_URL_API", "CORS_ORIGINS", "SUPABASE_JWT_ISS", "SUPABASE_JWT_AUD"],
```

- [ ] **Step 3: El contrato se verifica solo**

Run (desde la raíz): `npm test`

Expected: PASS. El test `api: MAPA coincide EXACTAMENTE con su .env.example` es el que confirma que las dos listas quedaron alineadas **en las dos direcciones**. Si falla, una de las dos todavía tiene `SUPABASE_JWT_SECRET`.

- [ ] **Step 4: Commit**

```bash
git add api/.env.example scripts/env-sync.mts
git commit -m "$(cat <<'EOF'
SUPABASE_JWT_SECRET se elimina del contrato; SUPABASE_JWT_ISS pasa a obligatoria

La API ya no necesita un secreto compartido: verifica contra el JWKS público
del proyecto. El JWKS se DERIVA del issuer en vez de ser otra variable — dos
valores que deben apuntar al mismo proyecto son dos oportunidades de que no
coincidan.

Un secreto menos que rotar, que custodiar y que filtrar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: El logout revoca en Supabase, sin bloquear la UI ni pisar sesiones nuevas

> ### ⚠️ Actualización (2026-07-27) — el alcance pasó a `local`, y `revocacionEnVuelo` se borró
>
> Lo que sigue describe el plan tal como se ejecutó, con alcance **global** (`POST /auth/v1/logout`
> sin `scope`) y una guarda `revocacionEnVuelo` que `login()` esperaba antes de pedir un token nuevo.
> Una revisión posterior (Codex) sobre `fix/jwt-es256` cambió el alcance a **local** por decisión del
> dueño del producto: el botón dice "Salir", no "Salir de todos los dispositivos". Eso le quitó la
> razón de existir a `revocacionEnVuelo` — con alcance local, una revocación tardía solo puede tocar
> el refresh token de la sesión que la originó, que ya está muerta localmente, así que la carrera que
> esa guarda cerraba desaparece por construcción. Se borró el campo, su bookkeeping en `logout` y el
> `await` al inicio de `login`. Las guardas de identidad (`hacerRefresh`) y de época (`login`) no
> cambiaron.
>
> También cambió `cerrarSesion`: en vez de `Promise<boolean>` devuelve `ResultadoRevocacion`
> (`'revocada' | 'credencial-rechazada' | 'indeterminada'`), y el reintento de `revocar` (Step 4, más
> abajo) pasó a dispararse SOLO con `'credencial-rechazada'` (401/403) — no con cualquier fallo. Antes,
> un 500 o un timeout también reintentaban, lo que rotaba un refresh token que podía estar
> perfectamente bien.
>
> El resto de este Task —el orden limpiar-antes-de-revocar, las cuatro carreras y sus dos guardas
> (identidad + época), y el reintento en sí— sigue describiendo el diseño real.

**Files:**

- Modify: `portal/src/app/core/auth-core.ts` (agregar `cerrarSesion` al final)
- Modify: `portal/src/app/services/auth.ts` (`login`, `logout`, `hacerRefresh`, `limpiarLocal`, `epoca`)
- Modify: `portal/src/app/app.ts:25`
- Test: `portal/src/app/core/auth-core.test.ts` (casos nuevos) y `portal/src/app/services/auth.test.ts` (**nuevo**)

**Interfaces:**

- Consumes: `AuthOpts` de `auth-core.ts` (ya existe: `{ supabaseUrl, anonKey, fetchFn? }`).
- Produces: `cerrarSesion(opts: AuthOpts, accessToken: string): Promise<boolean>` — `true` si Supabase confirmó la revocación. **Nunca lanza.**

> **Verificado antes de escribir este plan:** `AuthService` se puede instanciar bajo
> `node --import tsx --test` sin Angular TestBed (`new AuthService()` funciona; `localStorage` no
> existe y los `try/catch` que ya tiene lo absorben). Por eso el test del servicio es viable.

- [ ] **Step 1: Los tests de `cerrarSesion` que fallan**

Al final de `portal/src/app/core/auth-core.test.ts`:

```typescript
test('cerrarSesion llama al logout de Supabase con el token del usuario', async () => {
  let capturado: { url: string; init: RequestInit } | null = null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    capturado = { url, init };
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  const ok = await cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'anon-123', fetchFn }, 'tok-abc');

  assert.equal(ok, true);
  assert.equal(capturado!.url, 'https://p.supabase.co/auth/v1/logout');
  assert.equal(capturado!.init.method, 'POST');
  const h = capturado!.init.headers as Record<string, string>;
  assert.equal(h['apikey'], 'anon-123');
  // Sin el Bearer, Supabase no sabe QUÉ sesión revocar: revocaría nada.
  assert.equal(h['authorization'], 'Bearer tok-abc');
});

test('🔴 cerrarSesion devuelve false si Supabase responde error, y NO lanza', async () => {
  // Que no lance es lo que garantiza que el usuario quede deslogueado igual. Que devuelva false es
  // lo que permite distinguir "revocado" de "solo limpiado acá" sin obligar a nadie a mirarlo.
  const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  assert.equal(
    await cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'a', fetchFn }, 'tok'),
    false,
  );
});

test('🔴 cerrarSesion devuelve false si la red falla, y NO lanza', async () => {
  const fetchFn = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  assert.equal(
    await cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'a', fetchFn }, 'tok'),
    false,
  );
});
```

Y agregá `cerrarSesion` al import de la línea 3:

```typescript
import { loginConPassword, refrescarSesion, parseSesion, cerrarSesion } from './auth-core';
```

- [ ] **Step 2: Correr y verificar que FALLAN**

Run: `cd portal && npx tsx --test src/app/core/auth-core.test.ts`

Expected: FAIL con `cerrarSesion is not a function` (o error de import).

- [ ] **Step 3: Implementar `cerrarSesion`**

Al final de `portal/src/app/core/auth-core.ts`:

```typescript
/**
 * Revoca la sesión **en Supabase**, no solo en el navegador.
 *
 * Por qué existe: borrar el `localStorage` no invalida nada. El refresh token sigue siendo válido
 * del lado del servidor y **no caduca solo**, así que un "cerrar sesión" que solo limpia local deja
 * viva una credencial que puede acuñar access tokens indefinidamente. Si a alguien le roban el
 * equipo y cierra sesión desde otro lado, sin esto no pasa absolutamente nada.
 *
 * **Alcance: global.** Es el default de `POST /auth/v1/logout` sin `scope`, y es el que corresponde
 * al caso que motiva la función — el equipo robado —: revoca los refresh tokens de TODAS las
 * sesiones del usuario, no solo la de este navegador.
 *
 * **Lo que NO hace:** los access tokens ya emitidos siguen siendo válidos hasta su `exp` (una hora).
 * La API los verifica localmente contra el JWKS y no consulta a Supabase en cada request, así que la
 * revocación corta la renovación, no el acceso en curso. Cortarlo de inmediato exigiría comprobar la
 * sesión contra el servidor en cada llamada, y ese costo no se justifica acá.
 *
 * **Nunca lanza.** Revocar es best-effort: si la red está caída, el usuario tiene que quedar
 * deslogueado en su navegador igual. Devuelve si Supabase confirmó, para que quien llame pueda
 * registrarlo en vez de descubrirlo por casualidad.
 */
export async function cerrarSesion(opts: AuthOpts, accessToken: string): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(`${opts.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: opts.anonKey, authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr y verificar que PASAN**

Run: `cd portal && npx tsx --test src/app/core/auth-core.test.ts`

Expected: PASS.

- [ ] **Step 5: Los tests del servicio que fallan**

Creá `portal/src/app/services/auth.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './auth';
import type { Sesion } from '../core/models';

/**
 * Lo que se prueba acá NO lo prueban los tests de `auth-core`: que el estado local del portal se
 * limpie SIEMPRE, de inmediato y **también en `localStorage`**, y que ninguna llamada en vuelo pueda
 * resucitar una sesión cerrada ni pisar una nueva.
 *
 * Sin estos tests, mover la limpieza detrás del `await`, borrar la guarda de identidad o quitar el
 * `removeItem` deja todo en verde. Son los primeros tests que tiene el servicio.
 *
 * Las cuatro carreras que se cubren, todas reales:
 *  · login en vuelo → logout → el login resuelve  (no debe autenticar)
 *  · refresh en vuelo → logout → el refresh resuelve  (no debe resucitar)
 *  · sesión A → login B → el refresh de A resuelve  (no debe pisar a B)
 *  · logout lento → login nuevo → la revocación termina  (no debe borrar al nuevo)
 */

const CLAVE = 'amg.sesion';
const TENANT = '11111111-1111-1111-1111-111111111111';

function sesion(id: string, email: string, token: string): Sesion {
  return {
    accessToken: token,
    refreshToken: `${token}-r`,
    expiraEn: Date.now() + 3_600_000,
    userId: id,
    email,
    tenantId: TENANT,
    rol: 'equipo',
  };
}

const SESION_A = sesion('user-a', 'a@ejemplo.com', 'tok-a');
const SESION_B = sesion('user-b', 'b@ejemplo.com', 'tok-b');

/** Cuerpo de respuesta de GoTrue, como lo parsea `aSesion` en `auth-core.ts`. */
function respuestaGoTrue(id: string, email: string, token: string) {
  return {
    access_token: token,
    refresh_token: `${token}-r`,
    expires_in: 3600,
    user: { id, email, app_metadata: { tenant_id: TENANT, rol: 'equipo' } },
  };
}

/**
 * `fetch` falso que **enruta por URL** y deja cada respuesta pendiente hasta que se la suelta.
 *
 * Que las colas estén separadas no es un detalle: con una sola promesa compartida, un test que
 * espera el logout antes de soltar el token se cuelga para siempre en vez de fallar.
 */
function fetchControlado() {
  const colas = { token: [] as ((r: Response) => void)[], logout: [] as ((r: Response) => void)[] };
  const fetchFn = ((url: string) =>
    new Promise<Response>((resolver) => {
      colas[url.includes('/logout') ? 'logout' : 'token'].push(resolver);
    })) as unknown as typeof fetch;
  return {
    fetchFn,
    soltarToken(cuerpo: unknown): void {
      colas.token.shift()!(
        new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    soltarLogout(): void {
      colas.logout.shift()!(new Response(null, { status: 204 }));
    },
  };
}

/** Un servicio nuevo con `localStorage` y red falsos. El almacén se devuelve para poder afirmarlo. */
function crear() {
  const almacen = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => {
      almacen.set(k, v);
    },
    removeItem: (k: string) => {
      almacen.delete(k);
    },
  };
  const red = fetchControlado();
  const a = new AuthService();
  (a as unknown as { authOpts: { fetchFn: unknown } }).authOpts.fetchFn = red.fetchFn;
  return { a, red, almacen };
}

/** Instala una sesión viva, en la signal y en el almacén, sin pasar por la red. */
function instalar(a: AuthService, almacen: Map<string, string>, s: Sesion): void {
  (a as unknown as { _sesion: { set(v: Sesion | null): void } })._sesion.set(s);
  almacen.set(CLAVE, JSON.stringify(s));
}

test('🔴 logout limpia signal y localStorage ANTES de esperar a la red', async () => {
  // Si la limpieza estuviera después del `await`, la UI seguiría autenticada mientras el fetch
  // cuelga — y `fetch` no tiene timeout propio, así que puede colgar indefinidamente.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  assert.equal(a.autenticado(), false, 'la sesión tiene que estar cerrada YA, sin esperar la red');
  assert.equal(almacen.has(CLAVE), false, 'y el localStorage también, o vuelve al recargar');

  red.soltarLogout();
  await cierre;
  assert.equal(a.autenticado(), false);
});

test('🔴 logout deja al usuario deslogueado aunque la revocación falle', async () => {
  const { a, almacen } = crear();
  (a as unknown as { authOpts: { fetchFn: unknown } }).authOpts.fetchFn = () => {
    throw new Error('ECONNREFUSED');
  };
  instalar(a, almacen, SESION_A);

  await a.logout();
  assert.equal(a.autenticado(), false);
  assert.equal(almacen.has(CLAVE), false);
});

test('🔴 un login en vuelo no autentica si mientras tanto hubo logout', async () => {
  const { a, red } = crear();
  const entrada = a.login('b@ejemplo.com', 'pw');
  // Sin sesión viva, `logout` no llama a la red: resuelve solo.
  await a.logout();

  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b'));
  await entrada;

  assert.equal(a.autenticado(), false, 'un login que llega tarde no puede reabrir la sesión');
});

test('🔴 un logout lento no pisa un login posterior', async () => {
  // logout → el usuario vuelve a entrar → la revocación vieja termina. No debe borrar lo nuevo.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  const entrada = a.login('b@ejemplo.com', 'pw');
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b'));
  await entrada;
  red.soltarLogout();
  await cierre;

  assert.equal(a.autenticado(), true, 'el logout viejo no debe borrar la sesión nueva');
  assert.equal(a.email(), 'b@ejemplo.com');
});

test('🔴 un refresh en vuelo no resucita la sesión después de un logout', async () => {
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const refresco = a.refrescar();
  const cierre = a.logout();
  red.soltarLogout();
  await cierre;

  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2'));
  assert.equal(await refresco, false);
  assert.equal(a.autenticado(), false, 'el refresh no puede resucitar una sesión cerrada');
  assert.equal(almacen.has(CLAVE), false);
});

test('🔴 el refresh de la sesión vieja no pisa un login nuevo', async () => {
  // La carrera que la ÉPOCA sola no cubre: el refresh arranca después del login, así que comparte
  // su época y la guarda por época lo dejaría escribir. Solo la identidad de la sesión lo frena.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const entrada = a.login('b@ejemplo.com', 'pw'); // encola primero
  const refresco = a.refrescar(); // captura A, encola segundo
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b')); // resuelve el LOGIN
  await entrada;
  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2')); // resuelve el REFRESH

  assert.equal(await refresco, false);
  assert.equal(a.email(), 'b@ejemplo.com', 'la sesión nueva tiene que sobrevivir');
});

test('🔴 un refresco en vuelo no se comparte con una sesión distinta', async () => {
  // `refrescoEnVuelo` se comparte para no disparar N refrescos. Compartirlo entre SESIONES haría
  // que el refresh de la sesión nueva devolviera el resultado (false) del de la vieja.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const viejo = a.refrescar();
  const cierre = a.logout();
  red.soltarLogout();
  await cierre;
  instalar(a, almacen, SESION_B);

  const nuevo = a.refrescar();
  assert.notEqual(nuevo, viejo, 'no debe reusar el refresco de otra sesión');

  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2'));
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b2'));
  await Promise.allSettled([viejo, nuevo]);
});
```

- [ ] **Step 6: Correr y verificar que FALLAN**

Run: `cd portal && npx tsx --test src/app/services/auth.test.ts`

Expected: FAIL. `logout()` todavía es síncrono y no revoca, y no existen ni la guarda de época ni la
de identidad de sesión.

- [ ] **Step 7: Reescribir el servicio**

En `portal/src/app/services/auth.ts`, agregá `cerrarSesion` al import de la línea 2:

```typescript
import { loginConPassword, refrescarSesion, parseSesion, cerrarSesion } from '../core/auth-core';
```

Justo después de `private readonly authOpts = {...}` (línea 31), agregá:

```typescript
  /**
   * Generación de la sesión: cambia en cada login y en cada logout.
   *
   * Sirve **solo para el login**, que es la única operación que no tiene una sesión previa contra la
   * cual compararse — crea una nueva. Todo lo demás usa la identidad de la sesión capturada, que es
   * una guarda más fuerte (ver `hacerRefresh`).
   */
  private epoca = 0;
```

Reemplazá `login` (líneas 33-41) por:

```typescript
  async login(email: string, password: string): Promise<void> {
    const epoca = ++this.epoca;
    const sesion = await loginConPassword(this.authOpts, email, password);
    // Si mientras viajaba el login hubo un logout (u otro login), este resultado ya no es el que
    // manda: escribirlo dejaría al portal autenticado después de que el usuario cerró sesión.
    if (epoca !== this.epoca) return;
    this._sesion.set(sesion);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(sesion));
    } catch {
      /* sin localStorage (modo privado): la sesión vive en memoria y ya */
    }
  }
```

Reemplazá `logout` (líneas 43-50) por:

```typescript
  /**
   * Cierra sesión de verdad: limpia el estado local **y** revoca en Supabase.
   *
   * El orden importa y es al revés de lo que parece natural: se limpia PRIMERO, de forma síncrona.
   * Si la limpieza esperara a la red, la UI quedaría autenticada mientras el `fetch` cuelga — y
   * `fetch` no tiene timeout propio, así que puede colgar indefinidamente. La revocación viaja
   * después con el token que ya se capturó; que falle no cambia nada de lo que ve el usuario.
   */
  async logout(): Promise<void> {
    const s = this._sesion();
    this.epoca++;
    this.limpiarLocal();
    if (s) await cerrarSesion(this.authOpts, s.accessToken);
  }

  /** Solo el estado del navegador. Se usa cuando la sesión YA está muerta (ver `hacerRefresh`). */
  private limpiarLocal(): void {
    this._sesion.set(null);
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* sin localStorage (modo privado) */
    }
  }
```

Reemplazá el bloque completo de `refrescoEnVuelo` + `refrescar` + `hacerRefresh` (líneas 52-91, incluido el comentario de cabecera) por:

```typescript
  /**
   * Renueva el access token con el refresh token. La llama el cliente HTTP cuando la API responde
   * 401. Si el refresh falla (token revocado o vencido del todo), **cierra la sesión** y devuelve
   * `false`: el guard mandará al login en la próxima navegación.
   *
   * En vuelo puede haber varias llamadas a la vez; se comparte una sola promesa para no disparar N
   * refrescos. Pero se comparte **solo entre llamadas de la MISMA sesión**: tras un logout y un login
   * nuevo, engancharse al refresco viejo devolvería su resultado —normalmente `false`— para una
   * sesión que sí se podía refrescar, y el cliente propagaría un 401 que no correspondía.
   */
  private refrescoEnVuelo: { sesion: Sesion; promesa: Promise<boolean> } | null = null;

  refrescar(): Promise<boolean> {
    const actual = this._sesion();
    if (!actual) return Promise.resolve(false);
    const enVuelo = this.refrescoEnVuelo;
    if (enVuelo && enVuelo.sesion === actual) return enVuelo.promesa;

    const promesa = this.hacerRefresh(actual);
    const entrada = { sesion: actual, promesa };
    this.refrescoEnVuelo = entrada;
    void promesa.finally(() => {
      // Solo limpia si sigue siendo el suyo: una promesa vieja no puede borrar una más nueva.
      if (this.refrescoEnVuelo === entrada) this.refrescoEnVuelo = null;
    });
    return promesa;
  }

  /**
   * La sesión a refrescar se recibe por parámetro y se usa como **identidad**: antes de escribir se
   * comprueba que siga siendo la sesión viva.
   *
   * Por qué identidad y no la época: la época solo cambia al *iniciar* un login o un logout, así que
   * un refresh disparado DESPUÉS de arrancar un login comparte su época y pasaría la guarda —
   * escribiendo la sesión vieja encima de la nueva. Comparar contra `actual` cubre los tres casos de
   * una vez: tras un logout `_sesion()` es `null`, tras otro login es otro objeto, y en el caso
   * normal es el mismo.
   */
  private async hacerRefresh(actual: Sesion): Promise<boolean> {
    try {
      const sesion = await refrescarSesion(this.authOpts, actual.refreshToken);
      // Si mientras refrescábamos hubo un logout o un login, este resultado está viejo: escribirlo
      // resucitaría una sesión cerrada o pisaría una nueva.
      if (this._sesion() !== actual) return false;
      // El refresh de Supabase no repite app_metadata: conservamos tenant/rol/email de la sesión viva.
      const fusion: Sesion = {
        ...sesion,
        tenantId: sesion.tenantId || actual.tenantId,
        rol: sesion.rol || actual.rol,
        email: sesion.email || actual.email,
      };
      this._sesion.set(fusion);
      try {
        localStorage.setItem(CLAVE, JSON.stringify(fusion));
      } catch {
        /* modo privado */
      }
      return true;
    } catch {
      if (this._sesion() !== actual) return false;
      // El refresh token ya no sirve —por eso estamos acá—, así que pedirle a Supabase que lo
      // revoque es una llamada que va a fallar. Solo se limpia lo local.
      this.limpiarLocal();
      return false;
    }
  }
```

- [ ] **Step 8: Ajustar al llamador**

En `portal/src/app/app.ts:25`, reemplazá `this.auth.logout();` por:

```typescript
    void this.auth.logout();
```

`void` porque el handler del botón no espera: el estado local ya se limpió de forma síncrona, así que la UI reacciona de inmediato y la revocación viaja en segundo plano.

- [ ] **Step 9: Verde y typecheck del portal**

Run: `cd portal && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 10: Verificación por mutación (NO saltear)**

Seis mutaciones, **una por vez**, revirtiendo cada una antes de la siguiente. Corré la suite entera
del portal (`cd portal && npm test`) porque algunas cruzan de archivo.

Lo importante no es que caiga *un* test: es que caigan **exactamente los que se predicen acá**. Si
cae otro, o cae otro número, la garantía no está donde creés y hay que entender por qué antes de
seguir.

| # | Mutación | Tienen que caer |
| --- | --- | --- |
| 1 | En `services/auth.ts`, mové `this.limpiarLocal()` de antes del `await` a después | **2**: `logout limpia signal y localStorage ANTES…` y `un logout lento no pisa un login posterior` |
| 2 | En `services/auth.ts`, quitá `localStorage.removeItem(CLAVE)` de `limpiarLocal` | **3**: `logout limpia signal y localStorage ANTES…`, `logout deja al usuario deslogueado aunque la revocación falle` y `un refresh en vuelo no resucita…` (este último también afirma que el almacén quedó limpio) |
| 3 | En `services/auth.ts`, borrá la guarda `if (this._sesion() !== actual) return false;` del `try` de `hacerRefresh` | **2**: `un refresh en vuelo no resucita…` y `el refresh de la sesión vieja no pisa un login nuevo` |
| 4 | En `services/auth.ts`, borrá la guarda `if (epoca !== this.epoca) return;` de `login` | **1**: `un login en vuelo no autentica si mientras tanto hubo logout` |
| 5 | En `services/auth.ts`, en `refrescar`, compartí siempre el refresco en vuelo (quitá `&& enVuelo.sesion === actual`) | **1**: `un refresco en vuelo no se comparte con una sesión distinta` |
| 6 | En `core/auth-core.ts`, quitá el `try`/`catch` de `cerrarSesion` | **2**: `cerrarSesion devuelve false si la red falla…` (auth-core) y `logout deja al usuario deslogueado aunque la revocación falle` (services) |

La 3 y la 4 juntas son la prueba de que **hacen falta las dos guardas**: la de época no cubre el caso
de la 3 (el refresh arranca *después* del login, así que comparte su época) y la de identidad no
cubre el de la 4 (el login no tiene sesión previa contra la cual compararse).

**Revertí las seis** y volvé a verde.

- [ ] **Step 11: Commit**

```bash
git add portal/src/app/core/auth-core.ts portal/src/app/core/auth-core.test.ts portal/src/app/services/auth.ts portal/src/app/services/auth.test.ts portal/src/app/app.ts
git commit -m "$(cat <<'EOF'
El logout revoca en Supabase, no solo borra el localStorage

`AuthService.logout()` solo hacía `localStorage.removeItem`. El refresh token
seguía válido del lado del servidor después de "cerrar sesión" — y no caduca
solo, así que quedaba viva una credencial capaz de acuñar access tokens
indefinidamente. Si a alguien le roban el equipo y cierra sesión desde otro
lado, sin esto no pasaba nada.

Ahora se llama a POST /auth/v1/logout con el access token. El estado local se
limpia PRIMERO y de forma síncrona: si esperara a la red, la UI quedaría
autenticada mientras el fetch cuelga, y `fetch` no tiene timeout propio.

Se agregan dos guardas para cuatro carreras reales que antes no cubría nada: la
identidad de la sesión capturada, que impide que un refresh escriba encima de
una sesión que ya no es la suya, y una época, que invalida un login que llega
tarde. Hacen falta las dos: un refresh disparado DESPUÉS de arrancar un login
comparte su época y la pasaría, y un login no tiene sesión previa contra la
cual compararse. `refrescoEnVuelo` se comparte ahora solo dentro de la misma
sesión, o el refresh de la sesión nueva devolvería el resultado de la vieja.

Con tests de servicio —los primeros que tiene— y seis mutaciones que los fijan.

Alcance global (el default de Supabase): revoca todas las sesiones del usuario.
Los access tokens ya emitidos siguen valiendo hasta su exp; la API verifica
contra el JWKS sin consultar a Supabase en cada request.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Documentación, credenciales y despliegue

**Files:**

- Modify: `api/README.md`, `docs/proyecto/03-stack.md`, `docs/proyecto/09-estado-y-roadmap.md`, `docs/proyecto/11-plan-fase-2.md` (si menciona la pieza), `docs/proyecto/12-credenciales.md`, `docs/proyecto/12-despliegue-fase-1.md`, `docs/proyecto/13-runbook-despliegue.md`, `docs/decisiones-arquitectura.md`
- Modify: `portal/src/app/core/auth-core.ts` (comentario de cabecera desactualizado)
- Manual: `docs/private/credenciales.env` y las Variables de Railway

**Interfaces:**

- Consumes: el contrato final de variables de las Tareas 1 y 2.
- Produces: nada de código.

- [ ] **Step 1: Encontrar TODO lo que quedó mintiendo**

No confíes en la lista de archivos de arriba: buscala.

Run: `cd "$(git rev-parse --show-toplevel)" && grep -rn --include=*.md --include=*.ts "SUPABASE_JWT_SECRET\|JWT Secret\|HS256" . --exclude-dir=node_modules --exclude-dir=.git`

Expected: una lista de apariciones. Cada una es o bien una referencia histórica legítima (el registro de una review vieja en `08-testing-calidad.md`, el ADR anterior) o bien una instrucción que ahora es falsa. **Las históricas se dejan; las instrucciones se corrigen.**

Confirmado al escribir este plan, hay al menos: `api/README.md:36,57,73`, `docs/proyecto/03-stack.md:176`, `docs/proyecto/09-estado-y-roadmap.md:135`, `docs/proyecto/12-credenciales.md:105`, `docs/proyecto/12-despliegue-fase-1.md:169`, `docs/proyecto/13-runbook-despliegue.md:63,245,406`, `docs/decisiones-arquitectura.md:1013` y el comentario de cabecera de `portal/src/app/core/auth-core.ts:6`.

- [ ] **Step 2: Actualizar `12-credenciales.md`**

Quitá `SUPABASE_JWT_SECRET` de donde aparezca y agregá, al final de la sección "Dónde viven: una fuente, reparto por paquete":

```markdown
> **La API no tiene ningún secreto de Supabase.** Verifica los tokens contra el **JWKS público** del
> proyecto (`<iss>/.well-known/jwks.json`), derivado de `SUPABASE_JWT_ISS`. La clave privada nunca
> sale de Supabase y la pública es pública por definición: no hay nada que rotar ni que filtrar.
> Antes había un `SUPABASE_JWT_SECRET` compartido — se eliminó el 2026-07-26.
```

- [ ] **Step 3: Actualizar el runbook**

En `docs/proyecto/13-runbook-despliegue.md`:

En **B.1**, reemplazá el punto 4 (el del JWT Secret, línea 63) por:

```markdown
4. **No hace falta ningún JWT Secret.** La API verifica los tokens contra el JWKS público del
   proyecto, que deriva del `iss`. El único valor que necesita es
   `https://<project-ref>.supabase.co/auth/v1`, que ya conocés del paso 3.
```

En **C.5 paso 3**, reemplazá la fila de `SUPABASE_JWT_SECRET` (línea 245) para que la tabla quede:

```markdown
   | Variable | De dónde sale | Obligatoria |
   | --- | --- | --- |
   | `DATABASE_URL_API` | C.2 — login `amg_api`, **no** el de admin | sí |
   | `SUPABASE_JWT_ISS` | `https://<project-ref>.supabase.co/auth/v1` | **sí** |
   | `CORS_ORIGINS` | `https://bigballs.es,https://www.bigballs.es` | sí |
   | `SUPABASE_JWT_AUD` | vacía salvo que hayas cambiado el default | no |
   | `NPM_CONFIG_PRODUCTION` | `false` — a mano | sí |
```

Y cambiá el texto que diga "las 5 líneas" por "las 4 líneas", y "6 variables" por "5 variables".

En la fila de troubleshooting de la línea 406, reemplazá `SUPABASE_JWT_SECRET` por `SUPABASE_JWT_ISS`. Y agregá dos filas nuevas (la tabla está **alineada**: después de editar hay que igualar el padding de las columnas):

```markdown
| El login falla con `Token inválido o expirado` y las credenciales son correctas | El proyecto firma con un algoritmo que la API no acepta | Mirá `curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`: el `alg` que declare es el que `api/src/auth.ts` tiene que exigir. |
| La API responde `503` con `No se puede verificar el token` | No puede bajar el JWKS de Supabase | No es un problema de credenciales. Comprobá que `SUPABASE_JWT_ISS` sea exactamente `https://<ref>.supabase.co/auth/v1` y que Supabase esté arriba. |
| Rotaste la clave de firma **por sospecha de compromiso** y la vieja sigue funcionando | La API cachea el JWKS 10 minutos | Rotar en Supabase no alcanza: **reiniciá el servicio de la API en Railway** para vaciar el caché. En una rotación planificada no hace falta. |
```

- [ ] **Step 4: Corregir el resto de las referencias**

- `api/README.md`: línea 36 (el `alg` que verifica), línea 57 (el ejemplo de arranque) y la fila 73 de la tabla de variables — cambiá `SUPABASE_JWT_SECRET` por `SUPABASE_JWT_ISS` **obligatoria**, y HS256 por ES256 contra el JWKS.
- `docs/proyecto/03-stack.md:176`: el comentario del árbol dice `alg fijado a HS256` → `alg fijado a ES256, verificado contra el JWKS del emisor`.
- `docs/proyecto/09-estado-y-roadmap.md:135`: la tabla de variables por paquete → `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS`.
- `docs/proyecto/12-despliegue-fase-1.md:169`: la fila de `SUPABASE_JWT_SECRET` → `SUPABASE_JWT_ISS`.
- `portal/src/app/core/auth-core.ts:6`: el comentario de cabecera, si describe la verificación del lado de la API.
- `docs/proyecto/08-testing-calidad.md:275`: **NO lo toques.** Es el registro histórico de la 3ª review.

- [ ] **Step 5: Agregar el ADR**

En `docs/decisiones-arquitectura.md`, al final de la lista de ADR:

```markdown
### ADR-23 — La API verifica identidad contra el JWKS del emisor, no contra un secreto compartido

**Contexto.** El verificador se escribió cuando Supabase firmaba en HS256 con un secreto de proyecto.
Supabase migró a claves asimétricas; el proyecto de producción, creado el 2026-07-25, firma **ES256**.
Todo login terminaba en 401.

**Decisión.** La API verifica la firma contra el **JWKS público** del emisor
(`<iss>/.well-known/jwks.json`), derivado de `SUPABASE_JWT_ISS`, que pasa a ser **obligatoria**.
`SUPABASE_JWT_SECRET` se elimina del sistema.

**Por qué, más allá de que sea lo que Supabase emite hoy.** Desaparece un secreto compartido: estaba
en las variables de Railway, en las notas privadas de despliegue y en cualquier lugar donde se
hubiera pegado. La clave privada nunca sale de Supabase; la pública es pública por definición. Es
menos superficie, no solo código más nuevo.

**El emisor es el ancla de confianza, y se valida como tal.** `SUPABASE_JWT_ISS` se canoniza y se
comprueba una sola vez (`emisorSupabase`): https, host de `supabase.co`, ruta `/auth/v1`, sin puerto,
credenciales, query ni fragment. Exigir solo `https` no alcanzaba: un issuer como
`https://atacante.example/auth/v1` habría sustituido el emisor de confianza entero, y a partir de ahí
cualquier token que ese host firmara entraba. Que la canonización sea única tampoco es cosmético: si
se le quitara la barra final solo para armar la URL del JWKS, el `iss` exigido quedaría con la barra
y **ningún token verificaría**. *Limitación aceptada:* un dominio de auth propio no pasa esta
validación y habría que ampliarla a propósito — falla ruidosamente al arrancar, que es lo buscado.

**Consecuencia que hay que sostener.** `algorithms` debe seguir siendo una **lista cerrada de un solo
algoritmo**. La fija un test de **ES384**, no uno de HS256: está medido que `jose` rechaza HS256 con
un resolvedor JWKS aunque el algoritmo esté permitido —no resuelve claves HMAC desde un JWKS—, así
que un test de HS256 no cae bajo mutación y daría una garantía falsa. El de ES384 sí cae, porque su
clave pública está en el JWKS de prueba.

**No poder comprobar no es lo mismo que ser inválido.** El verificador devuelve `NO_DISPONIBLE` para
los fallos que no hablan del token (JWKS inalcanzable, timeout, DNS) y la API responde **503**; el
token realmente inválido sigue dando 401. Los dos deniegan — la diferencia es que con 401 el portal
daba la sesión por muerta y quemaba el refresh token ante una caída de Supabase. La clasificación es
una **allowlist de códigos de token**: un fallo de red no siempre trae un código de `jose` (un
resolvedor que rechaza llega sin `code`; `createRemoteJWKSet` contra un host muerto llega con
`ECONNREFUSED`, que es de Node), así que todo lo no enumerado se trata como infraestructura.

El criterio para decidir de qué lado va cada código es **de quién habla el error**.
`ERR_JWKS_NO_MATCHING_KEY` habla del token: trae un `kid` que no está en el conjunto de confianza.
`ERR_JWKS_MULTIPLE_MATCHING_KEYS` habla de **nosotros**: salta cuando el token no trae `kid` y dos de
*nuestras* claves matchean el algoritmo, que es lo que pasa durante una rotación —justo la ventana
para la que existe el 503—, así que va del lado de infraestructura.

**El emisor se amarra por construcción, no por convención.** `verificadorDeEmisor(emisor, …)` deriva
el `iss` exigido y la URL del JWKS del mismo `EmisorSupabase`. La primera versión los pasaba por
separado y confiaba en un comentario; como `crearDeps` no tiene tests, borrar el `issuer` dejaba la
suite entera en verde y la API aceptaba tokens de cualquier otro proyecto Supabase. Lo encontró la
review de la tarea 1. `verificadorSupabase` conserva los dos parámetros sueltos porque es lo que
permite inyectar un JWKS local y probar la criptografía sin red — pero producción no pasa por ahí.

**Consecuencia operativa: la rotación de emergencia necesita un reinicio.** `createRemoteJWKSet`
cachea el JWKS 10 minutos y tiene 30 s de cooldown. En una rotación *planificada* eso es invisible,
porque Supabase publica la clave nueva antes de firmar con ella. En una rotación **reactiva** —por
sospecha de compromiso— no: el caché puede seguir aceptando firmas de la clave retirada hasta 10
minutos. El procedimiento de emergencia no es solo rotar en Supabase; hay que **reiniciar el servicio
de la API en Railway** para vaciar el caché.

**Descartado.** Volver el proyecto a HS256 (deuda a seis meses, y conserva el secreto) y aceptar
ambos algoritmos (dos caminos en el borde de seguridad más crítico, justo donde diez reviews vinieron
eliminando opcionalidad).
```

- [ ] **Step 6: Sincronizar las cifras de tests**

Run: `cd "$(git rev-parse --show-toplevel)" && npm test 2>&1 | grep -E "^. (tests|pass|fail) " | tail -20`

Y para el portal:

Run: `cd portal && npm test 2>&1 | grep -E "^. (tests|pass|fail) " | tail -20`

Buscá las cifras viejas y actualizalas:

Run: `cd "$(git rev-parse --show-toplevel)" && grep -rnE "[0-9]+ tests?\b" --include=*.md docs/ AGENTS.md README.md`

Expected: los documentos con cifras viejas quedan sincronizados con la salida real.

- [ ] **Step 7: Actualizar el estado del proyecto**

En `docs/proyecto/09-estado-y-roadmap.md` y `docs/proyecto/11-plan-fase-2.md`, dejá registrado qué se hizo, **dónde estamos** y **qué falta**. Esta pieza (A) queda cerrada; las piezas B (modo oscuro), C (dashboard) y D (research en vivo) siguen pendientes.

- [ ] **Step 8: Commit de la documentación**

```bash
git add docs/ api/README.md portal/src/app/core/auth-core.ts
git commit -m "$(cat <<'EOF'
Documentar ADR-23: verificación contra el JWKS del emisor

La API deja de tener un secreto de Supabase. El ADR registra las tres
decisiones que hay que sostener: la lista de algoritmos sigue cerrada y la fija
un test de ES384 (el de HS256 no cae bajo mutación), el emisor es el ancla de
confianza y se valida como tal, y "no pude comprobar" responde 503 en vez de
confundirse con un token inválido.

Corregidas todas las referencias operativas que seguían mandando copiar el JWT
Secret del panel: README de la API, 03-stack, 09-estado, 12-credenciales,
12-despliegue y el runbook (B.1 y C.5, que baja de 6 a 5 variables en Railway).
El registro histórico de las reviews viejas se deja como está.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Aplicar los cambios de credenciales (manual, NO se commitea)**

1. En `docs/private/credenciales.env`, borrá la línea `SUPABASE_JWT_SECRET=...` y confirmá que `API__SUPABASE_JWT_ISS` (o `SUPABASE_JWT_ISS`) tenga exactamente `https://<ref>.supabase.co/auth/v1`.
2. Repartí a los paquetes: `npm run env:sync`
3. Confirmá que el secreto desapareció: `grep -c SUPABASE_JWT_SECRET api/.env` debe imprimir `0`.
4. En **Railway → Variables**, **borrá `SUPABASE_JWT_SECRET`** y confirmá que `SUPABASE_JWT_ISS` esté puesta con ese valor exacto. Redeploy.

- [ ] **Step 9b: Dos puntos de vigilancia operativa (anotar, no "arreglar")**

Salieron de la review de la tarea 1. Ninguno es un defecto; los dos importan al desplegar:

1. **Una rotación de Supabase a otro algoritmo daría 401, no 503.** `ERR_JOSE_ALG_NOT_ALLOWED` es un
   código de token, así que si el proyecto pasara a RS256 todos los logins fallarían **y quemarían
   refresh tokens**. Hoy el JWKS sirve una sola clave ES256 (verificado). Si Supabase anuncia un
   cambio de algoritmo, hay que tocar `algorithms` antes, no después.
2. **Durante una caída del JWKS, cada request paga el timeout de 5 s antes de su 503.** El caché vence
   a los 10 minutos y `_local` solo se reemplaza cuando el fetch tiene éxito, así que cada petición
   secuencial reintenta. Falla cerrado y es correcto, pero se lee como un cuelgue. Si molesta, el
   lugar para afinar `timeoutDuration`/`cacheMaxAge` es `crearDeps` — **con una medición, no a ojo**.

Agregá los dos a `docs/proyecto/09-estado-y-roadmap.md`, en deudas conocidas.

- [ ] **Step 10: Verificación en producción (el paso que cierra la pieza)**

1. Entrá a `https://bigballs.es`, logueate con Frank y confirmá que **ya no aparece "Token inválido o expirado"** y que se ve el research de Bella Napoli.
2. Confirmá que el logout revoca: cerrá sesión, y en Supabase → Authentication → Users → Frank → Sessions, la sesión ya no debe estar.
3. Comprobá que la API sigue cerrada a los no autenticados:

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://api.bigballs.es/runs`
Expected: `401`

Run: `curl -s https://api.bigballs.es/health`
Expected: `{"status":"ok"}`

Y por último, confirmá que un token basura da **401** y no 503 — si diera 503, la clasificación de
errores quedó al revés y una credencial mala se estaría reportando como una caída nuestra:

Run: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer basura" -H "x-amg-tenant: 11111111-1111-1111-1111-111111111111" https://api.bigballs.es/runs`
Expected: `401`

---

## Notas para quien ejecute

- **`npm run build -w portal` no funciona**: el portal está fuera del monorepo a propósito. Desde la raíz es `npm run build:portal`; desde `portal/`, `npm run build`.
- El portal se despliega **solo** en cada push a `main` (Hostinger buildea en el servidor) y Railway hace lo mismo con la API, así que **este trabajo va en una rama** y se mergea al final, ya verificado.
- Los bloques `bash` de este plan (heredocs, `grep`, `$(...)`) son de **shell POSIX**. En Windows corrélos desde Git Bash, no desde PowerShell.
- Los `.env` de los paquetes son **generados**: se editan en `docs/private/credenciales.env` y se reparten con `npm run env:sync`.
- Si algún número de tests de este plan no coincide con la realidad, **contá y reconciliá** — no ajustes el número para que cierre.
