# Verificación de JWT con ES256 (JWKS) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el login del portal funcione en producción, verificando los tokens ES256 de Supabase contra su JWKS público en vez de un secreto compartido — y que cerrar sesión revoque de verdad.

**Architecture:** `verificadorSupabase` deja de recibir un secreto y pasa a recibir un resolvedor de claves (`JWTVerifyGetKey` de `jose`). Producción lo arma con `createRemoteJWKSet` derivado del `iss`; los tests inyectan un JWKS local con una clave generada en el propio test, así la suite sigue sin red. `SUPABASE_JWT_SECRET` desaparece del sistema y `SUPABASE_JWT_ISS` pasa a obligatoria.

**Tech Stack:** TypeScript ESM strict · `jose` 5.10.0 (ya es dependencia de `api`) · `node:test` + `node:assert` · Angular 20 (portal) · `tsx`, sin paso de build.

## Global Constraints

- **Diseño validado contra el proyecto real** (2026-07-26): `alg=ES256`, `aud=authenticated`, `iss=https://<ref>.supabase.co/auth/v1`, y el `app_metadata` trae `tenant_id` y `rol`. **`AUD_SUPABASE` no cambia.**
- **`algorithms` es siempre una lista cerrada de un solo algoritmo.** Pasa de `["HS256"]` a `["ES256"]`. Nunca ambos: con verificación asimétrica la clave pública es conocida, así que aceptar `HS256` o `none` es explotable **sin conocer ningún secreto**.
- **Fallar cerrado**: si el JWKS no se puede obtener, la verificación falla y la API responde 401. Nunca dejar pasar por no poder comprobar.
- **Rojo primero, después el arreglo, después mutación**: reintroducir el bug y confirmar que cae *exactamente* su test.
- Tests con `node:test` + `node:assert`, sin dependencias nuevas y **sin red**.
- Comentarios en español que expliquen **por qué**, no qué.
- Mensajes de commit en español, terminados en `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No tocar `docs/private/` ni ningún `.env` en un commit.

---

## File Structure

| Archivo | Responsabilidad | Acción |
| --- | --- | --- |
| `api/src/auth.ts` | El verificador y el helper que deriva el JWKS del `iss` | Modificar |
| `api/src/auth.test.ts` | El contrato del verificador: qué entra y qué no | Reescribir andamiaje |
| `api/src/deps.ts` | Composition root: lee entorno, arma el verificador | Modificar |
| `api/src/deps.test.ts` | Que la config falle cerrado | Modificar |
| `api/.env.example` | Contrato público de variables de la API | Modificar |
| `scripts/env-sync.mts` | `MAPA`: qué claves recibe cada paquete | Modificar |
| `portal/src/app/core/auth-core.ts` | Lógica pura de auth contra GoTrue | Agregar `cerrarSesion` |
| `portal/src/app/core/auth-core.test.ts` | Su contrato | Agregar casos |
| `portal/src/app/services/auth.ts` | Estado de sesión del portal | Modificar `logout` |
| `portal/src/app/app.ts:25` | Llama a `logout()` | Ajustar a async |

---

## Task 1: El verificador exige ES256 y recibe un resolvedor de claves

**Files:**

- Modify: `api/src/auth.ts:1` (import), `api/src/auth.ts:25-62` (`verificadorSupabase`)
- Test: `api/src/auth.test.ts` (reescritura del andamiaje, se conservan los 10 casos)

**Interfaces:**

- Consumes: nada de tareas anteriores.
- Produces: `verificadorSupabase(claves: JWTVerifyGetKey, opts?: OpcionesJwt): VerificadorToken`. `OpcionesJwt` y `AUD_SUPABASE` no cambian. La Tarea 2 depende de esta firma.

- [ ] **Step 1: Reescribir el andamiaje del test a ES256**

Reemplazá las líneas 1-37 de `api/src/auth.test.ts` (imports, `SECRETO`, `clave`, `firmar`, `verificar`) por esto. **El resto del archivo —los 10 `test(...)`— no se toca todavía**, salvo el que menciona el secreto (Step 3):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { verificadorSupabase, AUD_SUPABASE } from "./auth.js";

/**
 * EL TEST QUE NO EXISTÍA — y su ausencia dejaba abierta la frontera de autenticación.
 *
 * Los tests de `app.test.ts` inyectan un verificador FALSO (`valid:<uuid>`), que es lo correcto para
 * probar rutas y RLS sin criptografía… pero significaba que **`verificadorSupabase` no lo ejercitaba
 * nadie**. Medido por la 8ª review: mutarlo para aceptar CUALQUIER token dejaba los 21 tests en
 * verde.
 *
 * Acá se firman JWT de verdad (ES256, como firma Supabase desde su migración a claves asimétricas) y
 * se prueba el CONTRATO: qué entra y qué no. El JWKS es LOCAL: la suite no toca la red.
 */

const KID = "clave-de-prueba";

// `extractable: true` hace falta para poder exportar la pública a JWK.
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
// Un segundo par: "otro emisor". Sustituye al viejo caso de "otro secreto".
const otro = await generateKeyPair("ES256", { extractable: true });

const JWKS: JWTVerifyGetKey = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", kid: KID }],
});

/** Firma un token. Cada parámetro se puede romper a propósito para probar el rechazo. */
async function firmar(
  opts: {
    sub?: string | undefined;
    exp?: string | number | undefined;
    aud?: string | undefined;
    iss?: string | undefined;
    clave?: KeyLike;
  } = {},
): Promise<string> {
  let jwt = new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: KID }).setIssuedAt();
  if (opts.sub !== undefined) jwt = jwt.setSubject(opts.sub);
  if (opts.exp !== undefined) jwt = jwt.setExpirationTime(opts.exp);
  if (opts.aud !== undefined) jwt = jwt.setAudience(opts.aud);
  if (opts.iss !== undefined) jwt = jwt.setIssuer(opts.iss);
  return jwt.sign(opts.clave ?? privateKey);
}

const verificar = verificadorSupabase(JWKS);
```

- [ ] **Step 2: Ajustar el caso de "otro secreto" a "otro emisor"**

En `api/src/auth.test.ts`, buscá el test `un token firmado con OTRO secreto se rechaza` y reemplazalo entero por:

```typescript
test("un token firmado por OTRO emisor se rechaza", async () => {
  // Antes era "otro secreto". Con firma asimétrica el equivalente es otra clave privada: el `kid`
  // dice que es la nuestra, pero la firma no cierra contra la pública del JWKS.
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE, clave: otro.privateKey });
  assert.equal(await verificar(token), null);
});
```

- [ ] **Step 3: Correr los tests y verificar que FALLAN**

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL. `verificadorSupabase` todavía espera un `string` y usa `algorithms: ["HS256"]`, así que ningún token ES256 verifica. Los errores serán de tipo y de aserción (`expected null to equal { userId: 'user-1' }` invertido).

- [ ] **Step 4: Cambiar el verificador a ES256 con resolvedor de claves**

En `api/src/auth.ts`, reemplazá la línea 1:

```typescript
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
```

Y reemplazá el bloque de las líneas 25-62 (el comentario de `verificadorSupabase` y la función) por:

```typescript
/**
 * Verificador de JWT de Supabase (**ES256 contra el JWKS del proyecto**).
 *
 * No recibe un secreto: recibe un RESOLVEDOR de claves. Producción le pasa `jwksDeSupabase(iss)`
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
 * `aud` se verifica por defecto (`authenticated`) y `iss` si se configura: un token válido emitido
 * por otro proyecto, o para otra audiencia, no debería abrir esta puerta.
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
        // clave pública es conocida, así que aceptar `HS256` (usándola como secreto) o `none` sería
        // explotable SIN conocer ningún secreto. Con HS256 compartido ese ataque no existía.
        algorithms: ["ES256"],
        // Sin esto, un token sin `exp` es eterno. Y sin `sub` no hay a quién identificar.
        requiredClaims: ["exp", "sub"],
        ...(audience ? { audience } : {}),
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
      });
      const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
      // `sub` en blanco (o solo espacios) no identifica a nadie: `app.user_id` quedaría vacío.
      return sub.length > 0 ? { userId: sub } : null;
    } catch {
      // Incluye el caso "no se pudo bajar el JWKS": si no se puede comprobar, NO se deja pasar.
      return null;
    }
  };
}

/**
 * Arma el resolvedor de claves de un proyecto Supabase a partir de su `iss`.
 *
 * El JWKS se DERIVA del issuer (`<iss>/.well-known/jwks.json`) en vez de ser otra variable: dos
 * valores que tienen que apuntar al mismo proyecto son dos oportunidades de que no coincidan.
 *
 * `createRemoteJWKSet` cachea la clave y refresca con cooldown, así que soporta rotación sin
 * redeploy y no pega en cada request.
 */
export function jwksDeSupabase(issuer: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`));
}
```

- [ ] **Step 5: Correr los tests y verificar que PASAN**

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: PASS, 10 tests.

- [ ] **Step 6: Agregar los dos casos nuevos**

Al final de `api/src/auth.test.ts`:

```typescript
test("🔴 un token HS256 se rechaza, aunque venga bien formado", async () => {
  // El caso que motivó todo esto al revés: la API aceptaba SOLO HS256 y Supabase pasó a ES256.
  // Ahora hay que garantizar lo contrario, y es una garantía de seguridad, no de compatibilidad:
  // con firma asimétrica la clave pública es conocida. Si el verificador aceptara HS256, un atacante
  // podría firmar un token usando esa clave pública COMO secreto y entrar sin saber nada privado.
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

test("🔴 si el JWKS no se puede obtener, NO se deja pasar", async () => {
  // Fallar cerrado. Un verificador que ante un error de red devolviera el token como válido
  // convertiría una caída de Supabase en un bypass de autenticación.
  const inalcanzable = createRemoteJWKSet(new URL("http://127.0.0.1:1/.well-known/jwks.json"));
  const verificarSinJwks = verificadorSupabase(inalcanzable);
  const token = await firmar({ sub: "user-1", exp: "2h", aud: AUD_SUPABASE });
  assert.equal(await verificarSinJwks(token), null);
});
```

- [ ] **Step 7: Correr y verificar que pasan los 12**

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 8: Verificación por mutación (NO saltear)**

Agregá `"HS256"` a la lista de algoritmos en `api/src/auth.ts` — que quede `algorithms: ["ES256", "HS256"]` — y corré:

Run: `cd api && npx tsx --test src/auth.test.ts`

Expected: FAIL, y **exactamente 1 test**: `🔴 un token HS256 se rechaza, aunque venga bien formado`.

Si falla otro número de tests, o falla otro test, el andamiaje está mal y hay que revisarlo antes de seguir. **Revertí la mutación** y volvé a correr: 12 en verde.

- [ ] **Step 9: Correr toda la suite de la API**

Run: `cd api && npm test`

Expected: PASS. `app.test.ts` usa un verificador falso inyectado, así que no debería verse afectado.

- [ ] **Step 10: Commit**

```bash
git add api/src/auth.ts api/src/auth.test.ts
git commit -m "$(cat <<'EOF'
El verificador de JWT exige ES256 contra el JWKS, no un secreto compartido

Supabase migró a claves asimétricas y el proyecto, creado el 2026-07-25, nació
con el esquema nuevo: firma ES256. La API solo aceptaba HS256, así que TODO
login terminaba en 401.

`verificadorSupabase` deja de recibir un secreto y recibe un resolvedor de
claves. Producción usa `jwksDeSupabase(iss)`; los tests inyectan un JWKS local,
así la suite sigue sin red.

La lista cerrada de algoritmos importa más que antes: con firma asimétrica la
clave pública es conocida, así que aceptar HS256 (usándola como secreto) o
`none` sería explotable sin conocer nada privado. Con HS256 compartido ese
ataque no existía. Hay un test para cada uno, y el de HS256 está verificado por
mutación: al agregar "HS256" a la lista cae exactamente ese test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: La config deriva el JWKS del issuer y elimina el secreto

**Files:**

- Modify: `api/src/deps.ts:3` (import), `api/src/deps.ts:11-25` (`ConfigApi`), `api/src/deps.ts:28-31` y `39-44` (`leerConfig`), `api/src/deps.ts:108-111` (armado del verificador)
- Modify: `api/.env.example`
- Modify: `scripts/env-sync.mts` (el `MAPA`)
- Test: `api/src/deps.test.ts:27-30` y casos nuevos

**Interfaces:**

- Consumes: `verificadorSupabase(claves, opts)` y `jwksDeSupabase(issuer)` de la Tarea 1.
- Produces: `ConfigApi` sin `jwtSecret` y con `jwtIssuer: string` (obligatorio, ya no opcional).

- [ ] **Step 1: Escribir los tests que fallan**

En `api/src/deps.test.ts`, reemplazá el `BASE` de las líneas 27-30 por:

```typescript
const BASE = {
  DATABASE_URL_API: "postgres://amg_api@host/db",
  SUPABASE_JWT_ISS: "https://proyecto.supabase.co/auth/v1",
};
```

Y reemplazá el test `sigue fallando si falta la conexión o el secreto del JWT` por estos tres:

```typescript
test("sigue fallando si falta la conexión a la base", () => {
  conEntorno({ CORS_ORIGINS: "https://app.tudominio.com", SUPABASE_JWT_ISS: "https://p.supabase.co/auth/v1" });
  assert.throws(() => leerConfig(), /DATABASE_URL_API/);
});

test("🔴 falla cerrado si falta SUPABASE_JWT_ISS: sin issuer no hay de dónde sacar el JWKS", () => {
  // Antes era opcional y la API arrancaba igual, verificando sin exigir emisor. Ahora es la fuente
  // de la clave pública: sin esto no hay con qué comprobar ninguna firma.
  conEntorno({ DATABASE_URL_API: "postgres://amg_api@host/db", CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /SUPABASE_JWT_ISS/);
});

test("🔴 rechaza un issuer que no sea https: el JWKS derivado viajaría en claro", () => {
  conEntorno({ ...BASE, SUPABASE_JWT_ISS: "http://proyecto.supabase.co/auth/v1", CORS_ORIGINS: "https://app.tudominio.com" });
  assert.throws(() => leerConfig(), /SUPABASE_JWT_ISS|https/i);
});

test("el issuer válido queda en la config", () => {
  conEntorno({ ...BASE, CORS_ORIGINS: "https://app.tudominio.com" });
  assert.equal(leerConfig().jwtIssuer, "https://proyecto.supabase.co/auth/v1");
});
```

En la misma línea 21 del archivo, el array de claves que `conEntorno` borra: cambiá `"SUPABASE_JWT_SECRET"` por nada (quitalo) — la lista queda `["DATABASE_URL_API", "CORS_ORIGINS", "SUPABASE_JWT_AUD", "SUPABASE_JWT_ISS"]`.

- [ ] **Step 2: Correr y verificar que FALLAN**

Run: `cd api && npx tsx --test src/deps.test.ts`

Expected: FAIL. Los tres tests nuevos fallan porque `leerConfig` todavía exige `SUPABASE_JWT_SECRET` y no valida el issuer.

- [ ] **Step 3: Cambiar `ConfigApi`**

En `api/src/deps.ts`, reemplazá las líneas 11-25 por:

```typescript
export interface ConfigApi {
  /** Cadena de conexión del login `amg_api`. Ese login SOLO puede asumir `app_user` (ADR-17). */
  databaseUrl: string;
  /**
   * `iss` del proyecto Supabase (`https://<proy>.supabase.co/auth/v1`). **Obligatorio**: de acá se
   * deriva el JWKS con el que se verifica la firma, y además amarra el emisor — un token válido de
   * OTRO proyecto Supabase no entra. Antes era opcional; que lo fuera era el agujero.
   */
  jwtIssuer: string;
  /** Id de la app Inngest emisora. La API es una app distinta del orquestador: solo envía eventos. */
  inngestId?: string;
  /** Orígenes CORS permitidos (coma-separados en `CORS_ORIGINS`). Sin esto: `*` (ver `app.ts`). */
  corsOrigins?: string[];
  /** `aud` esperado del JWT. Default `authenticated` (lo que emite Supabase). */
  jwtAudience?: string;
}
```

- [ ] **Step 4: Cambiar `leerConfig`**

En `api/src/deps.ts`, reemplazá la línea 30 (`const jwtSecret = ...`) por:

```typescript
  const jwtIssuer = process.env["SUPABASE_JWT_ISS"]?.trim();
```

Reemplazá el array `faltan` (líneas 38-44 aprox.) por:

```typescript
  const faltan = [
    !databaseUrl && "DATABASE_URL_API (login amg_api → rol app_user)",
    !jwtIssuer && "SUPABASE_JWT_ISS (https://<proy>.supabase.co/auth/v1; de acá sale el JWKS)",
    !corsRaw && "CORS_ORIGINS (origen del portal; en producción no se sirve con `*`)",
  ].filter((x): x is string => Boolean(x));
```

Justo después del `if (faltan.length > 0) { throw ... }`, agregá:

```typescript
  // El issuer se convierte en una URL para derivar el JWKS. Si no es https, la clave pública viajaría
  // por un canal que se puede manipular — y ahí la firma deja de probar nada.
  let issUrl: URL;
  try {
    issUrl = new URL(jwtIssuer as string);
  } catch {
    throw new Error(`SUPABASE_JWT_ISS no es una URL válida: "${jwtIssuer}".`);
  }
  if (issUrl.protocol !== "https:") {
    throw new Error(`SUPABASE_JWT_ISS debe ser https (es "${issUrl.protocol}").`);
  }
```

Y en el `return` de `leerConfig`, reemplazá la línea `jwtSecret: jwtSecret as string,` por:

```typescript
    jwtIssuer: jwtIssuer as string,
```

Y borrá del mismo `return` la línea `...(iss ? { jwtIssuer: iss } : {}),` y la declaración `const iss = process.env["SUPABASE_JWT_ISS"]?.trim();` que quedó duplicada.

- [ ] **Step 5: Cambiar el armado del verificador**

En `api/src/deps.ts`, reemplazá la línea 3 por:

```typescript
import { verificadorSupabase, jwksDeSupabase, type VerificadorToken } from "./auth.js";
```

Y las líneas 108-111 por:

```typescript
  // El JWKS se deriva del issuer y se comparte para toda la vida del proceso: `createRemoteJWKSet`
  // cachea la clave y refresca sola, así que no pega en cada request ni hace falta redeploy si
  // Supabase rota la clave.
  const verificar: VerificadorToken = verificadorSupabase(jwksDeSupabase(config.jwtIssuer), {
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {}),
    issuer: config.jwtIssuer,
  });
```

- [ ] **Step 6: Correr y verificar que PASAN**

Run: `cd api && npm test && npx tsc --noEmit`

Expected: PASS y typecheck limpio.

- [ ] **Step 7: Actualizar el contrato de variables**

En `api/.env.example`, borrá el bloque de `SUPABASE_JWT_SECRET` (el comentario y la línea) y reemplazá el bloque de `SUPABASE_JWT_ISS` por:

```bash
# ── Obligatoria: de acá sale la clave pública con la que se verifica el token ─────
# `iss` del proyecto Supabase. La API deriva el JWKS de acá
# (`<iss>/.well-known/jwks.json`) y verifica la firma ES256 con la clave pública.
# NO hay secreto compartido: la clave privada nunca sale de Supabase.
# Además amarra el emisor: un token válido de OTRO proyecto no entra.
SUPABASE_JWT_ISS=https://<project-ref>.supabase.co/auth/v1
```

Movelo a la sección de obligatorias (junto a `DATABASE_URL_API` y `CORS_ORIGINS`) y sacá `SUPABASE_JWT_ISS` de la sección "Recomendadas".

En `scripts/env-sync.mts`, en el `MAPA`, reemplazá la línea de `api` por:

```typescript
  api: ["DATABASE_URL_API", "CORS_ORIGINS", "SUPABASE_JWT_ISS", "SUPABASE_JWT_AUD"],
```

- [ ] **Step 8: Correr los tests de scripts (el contrato se verifica solo)**

Run: `npm test`

Expected: PASS. El test `api: MAPA coincide EXACTAMENTE con su .env.example` es el que confirma que las dos listas quedaron alineadas. Si falla, una de las dos quedó con `SUPABASE_JWT_SECRET`.

- [ ] **Step 9: Commit**

```bash
git add api/src/deps.ts api/src/deps.test.ts api/.env.example scripts/env-sync.mts
git commit -m "$(cat <<'EOF'
SUPABASE_JWT_SECRET se elimina; SUPABASE_JWT_ISS pasa a obligatoria

La API ya no necesita un secreto compartido: verifica contra el JWKS del
proyecto. El JWKS se DERIVA del issuer en vez de ser otra variable — dos
valores que deben apuntar al mismo proyecto son dos oportunidades de que no
coincidan.

Que el issuer pase de opcional a obligatorio cierra un agujero que estaba
abierto: siendo opcional, un token válido emitido por OTRO proyecto Supabase
entraba. Ahora el emisor queda amarrado por construcción.

Se valida que sea https: si el JWKS viajara por un canal manipulable, la firma
dejaría de probar nada.

Un secreto menos que rotar, que custodiar y que filtrar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: El logout revoca la sesión en Supabase

**Files:**

- Modify: `portal/src/app/core/auth-core.ts` (agregar `cerrarSesion` al final)
- Modify: `portal/src/app/services/auth.ts:43-50` (`logout`) y `:88`
- Modify: `portal/src/app/app.ts:25`
- Test: `portal/src/app/core/auth-core.test.ts` (casos nuevos al final)

**Interfaces:**

- Consumes: `AuthOpts` de `auth-core.ts` (ya existe: `{ supabaseUrl, anonKey, fetchFn? }`).
- Produces: `cerrarSesion(opts: AuthOpts, accessToken: string): Promise<void>`.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `portal/src/app/core/auth-core.test.ts`:

```typescript
test('cerrarSesion llama al logout de Supabase con el token del usuario', async () => {
  let capturado: { url: string; init: RequestInit } | null = null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    capturado = { url, init };
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  await cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'anon-123', fetchFn }, 'tok-abc');

  assert.equal(capturado!.url, 'https://p.supabase.co/auth/v1/logout');
  assert.equal(capturado!.init.method, 'POST');
  const h = capturado!.init.headers as Record<string, string>;
  assert.equal(h['apikey'], 'anon-123');
  // Sin el Bearer, Supabase no sabe QUÉ sesión revocar: revocaría nada.
  assert.equal(h['authorization'], 'Bearer tok-abc');
});

test('🔴 cerrarSesion NO lanza si Supabase responde error: revocar es best-effort', async () => {
  // El estado local se limpia igual (lo prueba el test de AuthService). Si esta función lanzara,
  // un logout con la red caída dejaría al usuario con la sesión abierta en pantalla — peor que no
  // revocar.
  const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  await assert.doesNotReject(
    cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'a', fetchFn }, 'tok'),
  );
});

test('🔴 cerrarSesion NO lanza si la red falla', async () => {
  const fetchFn = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  await assert.doesNotReject(
    cerrarSesion({ supabaseUrl: 'https://p.supabase.co', anonKey: 'a', fetchFn }, 'tok'),
  );
});
```

Y agregá `cerrarSesion` al import de la línea 3, que queda:

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
 * **Nunca lanza.** Revocar es best-effort: si la red está caída, el usuario tiene que quedar
 * deslogueado en su navegador igual. Un logout que aborta y deja la sesión en pantalla es peor que
 * uno que no revoca. Quien llama se encarga de limpiar el estado local SIEMPRE.
 */
export async function cerrarSesion(opts: AuthOpts, accessToken: string): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    await fetchFn(`${opts.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: opts.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch {
    /* best-effort: ver el comentario de arriba */
  }
}
```

- [ ] **Step 4: Correr y verificar que PASAN**

Run: `cd portal && npx tsx --test src/app/core/auth-core.test.ts`

Expected: PASS.

- [ ] **Step 5: Conectar el logout del servicio**

En `portal/src/app/services/auth.ts`, agregá `cerrarSesion` al import de la línea 2:

```typescript
import { loginConPassword, refrescarSesion, parseSesion, cerrarSesion } from '../core/auth-core';
```

Reemplazá `logout()` (líneas 43-50) por:

```typescript
  /**
   * Cierra sesión de verdad: revoca en Supabase **y** limpia el estado local.
   *
   * El orden importa: se revoca con el token todavía en mano, y se limpia en el `finally` para que
   * el usuario quede deslogueado aunque la revocación falle.
   */
  async logout(): Promise<void> {
    const s = this._sesion();
    try {
      if (s) await cerrarSesion(this.authOpts, s.accessToken);
    } finally {
      this.limpiarLocal();
    }
  }

  /** Solo el estado del navegador. Se usa cuando la sesión YA está muerta (ver `refrescar`). */
  private limpiarLocal(): void {
    this._sesion.set(null);
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* sin localStorage (modo privado) */
    }
  }
```

Y en la línea 88 (dentro del `catch` de `refrescar`), reemplazá `this.logout();` por:

```typescript
      // El refresh token ya no sirve —por eso estamos acá—, así que pedirle a Supabase que lo
      // revoque es una llamada que va a fallar. Solo se limpia lo local.
      this.limpiarLocal();
```

- [ ] **Step 6: Ajustar al llamador**

En `portal/src/app/app.ts:25`, reemplazá `this.auth.logout();` por:

```typescript
    void this.auth.logout();
```

`void` porque el handler del botón no espera: el estado local se limpia en el `finally`, así que la UI reacciona de inmediato y la revocación viaja en segundo plano.

- [ ] **Step 7: Correr toda la suite del portal y el typecheck**

Run: `cd portal && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Verificación por mutación**

En `portal/src/app/core/auth-core.ts`, quitá el `try`/`catch` de `cerrarSesion` (que el `await fetchFn(...)` quede pelado) y corré:

Run: `cd portal && npx tsx --test src/app/core/auth-core.test.ts`

Expected: FAIL, y **exactamente 1 test**: `🔴 cerrarSesion NO lanza si la red falla`.

**Revertí la mutación** y volvé a correr: verde.

- [ ] **Step 9: Commit**

```bash
git add portal/src/app/core/auth-core.ts portal/src/app/core/auth-core.test.ts portal/src/app/services/auth.ts portal/src/app/app.ts
git commit -m "$(cat <<'EOF'
El logout revoca en Supabase, no solo borra el localStorage

`AuthService.logout()` solo hacía `localStorage.removeItem`. El refresh token
seguía válido del lado del servidor después de "cerrar sesión" — y un refresh
token no caduca solo, así que quedaba viva una credencial capaz de acuñar
access tokens indefinidamente. Si a alguien le roban el equipo y cierra sesión
desde otro lado, sin esto no pasaba nada.

Ahora se llama a `POST /auth/v1/logout` con el access token, y el estado local
se limpia en un `finally`: si la red está caída el usuario queda deslogueado
igual. Un logout que aborta y deja la sesión en pantalla es peor que uno que no
revoca. Hay un test para eso, verificado por mutación.

En el fallo de refresh se limpia solo lo local: el refresh token ya está muerto,
pedir que lo revoquen es una llamada que va a fallar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Documentación, credenciales y despliegue

**Files:**

- Modify: `docs/proyecto/12-credenciales.md`
- Modify: `docs/proyecto/13-runbook-despliegue.md` (B.1 y C.5)
- Modify: `docs/decisiones-arquitectura.md`
- Manual: `docs/private/credenciales.env` y las Variables de Railway

**Interfaces:**

- Consumes: el contrato final de variables de la Tarea 2.
- Produces: nada de código.

- [ ] **Step 1: Actualizar `12-credenciales.md`**

En la sección de variables de entorno, quitá `SUPABASE_JWT_SECRET` de donde aparezca y agregá, al final de la sección "Dónde viven: una fuente, reparto por paquete":

```markdown
> **La API no tiene ningún secreto de Supabase.** Verifica los tokens contra el **JWKS público** del
> proyecto (`<iss>/.well-known/jwks.json`), derivado de `SUPABASE_JWT_ISS`. La clave privada nunca
> sale de Supabase y la pública es pública por definición: no hay nada que rotar ni que filtrar.
> Antes había un `SUPABASE_JWT_SECRET` compartido — se eliminó el 2026-07-26.
```

- [ ] **Step 2: Actualizar el runbook**

En `docs/proyecto/13-runbook-despliegue.md`:

En **B.1**, reemplazá el punto 4 (el del JWT Secret) por:

```markdown
4. **No hace falta ningún JWT Secret.** La API verifica los tokens contra el JWKS público del
   proyecto, que deriva del `iss`. El único valor que necesita es
   `https://<project-ref>.supabase.co/auth/v1`, que ya conocés del paso 3.
```

En **C.5 paso 3**, reemplazá la tabla de variables por:

```markdown
   | Variable | De dónde sale | Obligatoria |
   | --- | --- | --- |
   | `DATABASE_URL_API` | C.2 — login `amg_api`, **no** el de admin | sí |
   | `SUPABASE_JWT_ISS` | `https://<project-ref>.supabase.co/auth/v1` | **sí** |
   | `CORS_ORIGINS` | `https://bigballs.es,https://www.bigballs.es` | sí |
   | `SUPABASE_JWT_AUD` | vacía salvo que hayas cambiado el default | no |
   | `NPM_CONFIG_PRODUCTION` | `false` — a mano | sí |
```

Y cambiá el texto que dice "las 5 líneas" por "las 4 líneas", y "6 variables" por "5 variables".

En la tabla de **Troubleshooting**, agregá esta fila (respetando el ancho de columnas del resto: la tabla está alineada, así que después de editar hay que igualar el padding):

```markdown
| El login falla con `Token inválido o expirado` y las credenciales son correctas | El proyecto firma con ES256 y la API espera otro algoritmo | Comprobá `curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`: el `alg` que declare es el que la API tiene que exigir en `api/src/auth.ts`. |
```

- [ ] **Step 3: Agregar el ADR**

En `docs/decisiones-arquitectura.md`, al final de la lista de ADR:

```markdown
### ADR-23 — La API verifica identidad contra el JWKS del emisor, no contra un secreto compartido

**Contexto.** El verificador se escribió cuando Supabase firmaba en HS256 con un secreto de proyecto.
Supabase migró a claves asimétricas; el proyecto de producción firma **ES256**. Todo login terminaba
en 401.

**Decisión.** La API verifica la firma contra el **JWKS público** del emisor
(`<iss>/.well-known/jwks.json`), derivado de `SUPABASE_JWT_ISS`, que pasa a ser **obligatoria**.
`SUPABASE_JWT_SECRET` se elimina del sistema.

**Por qué, más allá de que sea lo que Supabase emite hoy.** Desaparece un secreto compartido: estaba
en las variables de Railway, en las notas privadas de despliegue y en cualquier lugar donde se
hubiera pegado. La clave privada nunca sale de Supabase; la pública es pública por definición. Es
menos superficie, no solo código más nuevo.

**Consecuencia que hay que sostener.** `algorithms` debe seguir siendo una **lista cerrada de un solo
algoritmo**, y ahora importa más: con firma asimétrica la clave pública es conocida, así que aceptar
`HS256` —usándola como secreto— o `none` sería explotable **sin conocer nada privado**. Con HS256
compartido ese ataque no existía. Lo fijan dos tests, uno de ellos verificado por mutación.

**Descartado.** Volver el proyecto a HS256 (deuda a seis meses, y conserva el secreto) y aceptar
ambos algoritmos (dos caminos en el borde de seguridad más crítico, justo donde diez reviews vinieron
eliminando opcionalidad).
```

- [ ] **Step 4: Sincronizar las cifras de tests**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` y sumá los totales del monorepo; después `cd portal && npm test` para el del portal.

Actualizá los números donde aparezcan. Buscalos con:

Run: `grep -rnE "\b445 tests|\b45 (en el portal|tests)" --include=*.md docs/ CLAUDE.md`

Expected: los documentos con cifras viejas quedan sincronizados con la salida real.

- [ ] **Step 5: Commit de la documentación**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
Documentar ADR-23: verificación contra el JWKS del emisor

La API deja de tener un secreto de Supabase. 12-credenciales, el runbook (B.1 y
C.5, que baja de 6 a 5 variables en Railway) y un ADR nuevo con la consecuencia
que hay que sostener: la lista de algoritmos sigue siendo cerrada, y con firma
asimétrica eso pasó de higiene a defensa — la clave pública es conocida.

Agregada al troubleshooting la fila del síntoma real: login que falla con
credenciales correctas porque el proyecto firma con otro algoritmo.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Aplicar los cambios de credenciales (manual, NO se commitea)**

1. En `docs/private/credenciales.env`, borrá la línea `SUPABASE_JWT_SECRET=...` y confirmá que `SUPABASE_JWT_ISS` tenga el valor correcto.
2. Repartí a los paquetes: `npm run env:sync`
3. Confirmá que el secreto desapareció de `api/.env`: `grep -c SUPABASE_JWT_SECRET api/.env` debe imprimir `0`.
4. En **Railway → Variables**, **borrá `SUPABASE_JWT_SECRET`** y confirmá que `SUPABASE_JWT_ISS` esté puesta. Redeploy.

- [ ] **Step 7: Verificación en producción (el paso que cierra la pieza)**

1. Entrá a `https://bigballs.es`, logueate con Frank y confirmá que **ya no aparece "Token inválido o expirado"** y que se ve el research de Bella Napoli.
2. Confirmá que el logout revoca: cerrá sesión, y en Supabase → Authentication → Users → Frank → Sessions, la sesión ya no debe estar.
3. Comprobá que la API sigue cerrada a los no autenticados:

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://api.bigballs.es/runs`
Expected: `401`

Run: `curl -s https://api.bigballs.es/health`
Expected: `{"status":"ok"}`

---

## Notas para quien ejecute

- **`npm run build -w portal` no funciona**: el portal está fuera del monorepo a propósito. Desde la raíz es `npm run build:portal`; desde `portal/`, `npm run build`.
- El portal se despliega **solo** en cada push a `main` (Hostinger buildea en el servidor), así que un commit que rompa `environment.prod.ts` publica. El `prebuild` lo frena, pero no confíes en eso: corré `npm test` en `portal/` antes de pushear.
- Los `.env` de los paquetes son **generados**: se editan en `docs/private/credenciales.env` y se reparten con `npm run env:sync`.
