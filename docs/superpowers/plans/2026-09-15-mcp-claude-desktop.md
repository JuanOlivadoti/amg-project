# MCP para Claude Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `mcp-server/`, un paquete nuevo del monorepo que expone AMG OS a Claude Desktop
como seis herramientas MCP (cinco lecturas, una escritura), actuando con el usuario y el rol reales de
quien lo corre.

**Architecture:** Servidor MCP `stdio` que Claude Desktop arranca como subproceso. Habla HTTP con
`api/` (nunca con Postgres directo) usando el JWT de una sesión guardada en disco
(`~/.amg-mcp/session.json`), obtenida con un comando de login aparte (`npm run mcp:login -w
mcp-server`) porque el transporte `stdio` no tiene TTY para pedir contraseña. El tenant sale de
`app_metadata.tenant_id` del propio JWT, nunca se elige. Las tools de escritura piden UUID, nunca un
nombre.

**Tech Stack:** TypeScript ESM strict + `tsx` (sin paso de build, igual que el resto del monorepo),
`node:test`, `@modelcontextprotocol/sdk`, `zod` (validación del input de cada tool).

**Fuente:** [`docs/superpowers/specs/2026-09-05-mcp-claude-desktop-design.md`](../specs/2026-09-05-mcp-claude-desktop-design.md)
— diseño aprobado. Este plan no reabre ninguna decisión del spec; donde el spec ya decidió algo, este
plan solo lo ejecuta.

## Global Constraints

- **TypeScript ESM strict**, `noUncheckedIndexedAccess: true` — mismo `tsconfig.json` que `contrato/`
  (ver Task 1).
- **`tsx`, sin paso de build.** Tests con `node:test` nativo (`node --import tsx --test`).
- **No importa `db/` ni `api/` como paquetes.** Todo pasa por HTTP contra endpoints que ya existen y
  ya están probados (spec §1).
- **No abre conexión a Postgres.** No hay SQL en este paquete, en ningún archivo.
- **El tenant nunca se elige**: sale de `app_metadata.tenant_id` del JWT (spec §3.3). Si falta, el
  login falla ruidosamente y no escribe sesión.
- **Las tools de escritura reciben UUID, jamás un nombre** (spec §3.4). Validar el formato ANTES de
  llamar a la API.
- **Ningún error se traga.** Cada camino de fallo se traduce al mensaje exacto de la tabla del spec §7
  (reproducida en la Task 4).
- **Nada de `localStorage`, nada de `rol`** en la sesión de este paquete — es un subconjunto más chico
  que el del portal (spec §3.6).
- **La sesión vive en `~/(homedir)/.amg-mcp/session.json`, fuera del repo.**
- **Comentarios en español, explican el PORQUÉ** — mismo criterio que el resto del monorepo
  (`AGENTS.md`).

---

### Task 1: Scaffolding del paquete `mcp-server/`

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/src/index.test.ts` (test trivial, solo para probar que el arnés levanta el
  paquete)
- Modify: `package.json:7-15` (raíz) — agregar `"mcp-server"` al array `workspaces`

**Interfaces:**
- Consumes: nada (primer task).
- Produces: el workspace `mcp-server` existe, `npm install` desde la raíz lo resuelve, `npm test` y
  `npm run typecheck` desde la raíz lo incluyen automáticamente (los scripts raíz usan
  `--workspaces --if-present`, y `scripts/verificar.sh:123` cuenta los paquetes leyendo
  `package.json` — no hace falta tocar ningún número a mano).

- [ ] **Step 1: Crear `mcp-server/package.json`**

```json
{
  "name": "mcp-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Servidor MCP local: opera AMG OS desde Claude Desktop, hablando HTTP con api/ con la sesión y el rol reales de quien lo corre.",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "mcp:login": "tsx src/cli/login.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Crear `mcp-server/tsconfig.json`** (idéntico al de `contrato/`, mismo criterio de
  strictness que todo el monorepo)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Agregar el workspace a la raíz**

En `package.json` de la raíz, el array `workspaces` pasa de:

```json
  "workspaces": [
    "contrato",
    "db",
    "kr-service",
    "web-builder",
    "orchestrator",
    "api",
    "renderer"
  ],
```

a:

```json
  "workspaces": [
    "contrato",
    "db",
    "kr-service",
    "web-builder",
    "orchestrator",
    "api",
    "renderer",
    "mcp-server"
  ],
```

- [ ] **Step 4: Crear un test trivial que pruebe que el arnés levanta el paquete**

`mcp-server/src/index.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

test("el paquete mcp-server existe y node:test lo puede correr", () => {
  assert.equal(1 + 1, 2);
});
```

(Este test se borra en la Task 8, cuando `index.ts` exista de verdad y tenga sus propios tests. Es
solo el canario de que el scaffolding quedó bien armado.)

- [ ] **Step 5: Instalar y verificar**

```bash
npm install
npm run typecheck -w mcp-server
npm test -w mcp-server
```

Esperado: instala sin error, typecheck limpio, 1 test en verde.

- [ ] **Step 6: Commit**

```bash
git add package.json mcp-server/package.json mcp-server/tsconfig.json mcp-server/src/index.test.ts
git commit -m "mcp-server: scaffolding del paquete (workspace #8)"
```

---

### Task 2: `session.ts` — leer, escribir y evaluar vencimiento de la sesión en disco

**Files:**
- Create: `mcp-server/src/session.ts`
- Test: `mcp-server/src/session.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usado por Task 4, `api-client.ts`, y Task 9, `cli/login.ts`):
  - `export interface Sesion { accessToken: string; refreshToken: string; expiraEn: number; userId: string; tenantId: string }`
  - `export function rutaSesion(): string`
  - `export async function leerSesion(ruta?: string): Promise<Sesion | null>`
  - `export async function escribirSesion(sesion: Sesion, ruta?: string): Promise<void>`
  - `export function estaPorVencer(sesion: Sesion, margenMs: number, ahora?: () => number): boolean`

- [ ] **Step 1: Escribir los tests, en rojo**

`mcp-server/src/session.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { escribirSesion, estaPorVencer, leerSesion, type Sesion } from "./session.ts";

const SESION_DE_PRUEBA: Sesion = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiraEn: Date.UTC(2026, 0, 1),
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};

async function rutaTemporal(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-test-"));
  return join(dir, "session.json");
}

test("escribirSesion + leerSesion: round-trip exacto", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const leida = await leerSesion(ruta);
  assert.deepEqual(leida, SESION_DE_PRUEBA);
});

test("escribirSesion crea el directorio si no existe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-test-"));
  const ruta = join(dir, "no-existe-todavia", "session.json");
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const leida = await leerSesion(ruta);
  assert.deepEqual(leida, SESION_DE_PRUEBA);
});

test("escribirSesion es atómica: no deja un archivo .tmp colgado", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const archivos = await readdir(join(ruta, ".."));
  assert.deepEqual(
    archivos.filter((f) => f.endsWith(".tmp")),
    [],
    "no debe quedar ningún .tmp después de escribir",
  );
});

test("escribirSesion escribe JSON legible (no un blob de una sola línea imposible de auditar)", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const crudo = await readFile(ruta, "utf8");
  assert.ok(crudo.includes("\n"), "se espera JSON con indentación, no minificado");
});

test("leerSesion: null si el archivo no existe", async () => {
  const ruta = await rutaTemporal(); // el directorio existe, el archivo no
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null ante JSON inválido", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(ruta, "esto no es json{", "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null si falta un campo requerido", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  const incompleta = { ...SESION_DE_PRUEBA, accessToken: undefined };
  await writeFile(ruta, JSON.stringify(incompleta), "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null si tenantId no es un string", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(ruta, JSON.stringify({ ...SESION_DE_PRUEBA, tenantId: 123 }), "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("estaPorVencer: true dentro del margen", () => {
  const ahora = () => 1000;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 1500 };
  assert.equal(estaPorVencer(sesion, 600, ahora), true); // vence en 500ms, margen 600ms
});

test("estaPorVencer: false fuera del margen", () => {
  const ahora = () => 1000;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 5000 };
  assert.equal(estaPorVencer(sesion, 600, ahora), false);
});

test("estaPorVencer: true si ya venció", () => {
  const ahora = () => 9999;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 1000 };
  assert.equal(estaPorVencer(sesion, 600, ahora), true);
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
npx tsx --test mcp-server/src/session.test.ts
```

Esperado: FAIL — `session.ts` no existe todavía.

- [ ] **Step 3: Implementar `mcp-server/src/session.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * La sesión guardada en disco, fuera del repo. Subconjunto más chico que la del portal (sin `rol`,
 * sin nada de UI) — spec §3.6.
 */
export interface Sesion {
  accessToken: string;
  refreshToken: string;
  /** Instante (epoch ms) en que vence el `accessToken`. */
  expiraEn: number;
  userId: string;
  tenantId: string;
}

/**
 * `~/.amg-mcp/session.json`. Fuera del repo a propósito: nada de `git add` distraído la agarra —
 * spec §6, la misma clase de accidente que ya sufrió este proyecto con `docs/private.zip`.
 */
export function rutaSesion(): string {
  return join(homedir(), ".amg-mcp", "session.json");
}

/**
 * Lee una sesión guardada, **validando la forma** — no solo que el JSON parsee. Mismo criterio que
 * `portal/src/app/core/auth-core.ts:parseSesion`: un archivo manipulado o de una versión vieja no
 * debe producir una sesión fantasma que después falle en cada llamada con un error confuso. Si algo
 * no cierra, no hay sesión — el llamador ve `null` y sabe pedir `npm run mcp:login`.
 */
export async function leerSesion(ruta: string = rutaSesion()): Promise<Sesion | null> {
  let crudo: string;
  try {
    crudo = await readFile(ruta, "utf8");
  } catch {
    return null;
  }

  let v: unknown;
  try {
    v = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;

  const texto = (k: string): boolean => typeof s[k] === "string" && (s[k] as string).length > 0;
  if (!texto("accessToken") || !texto("refreshToken") || !texto("userId") || !texto("tenantId")) {
    return null;
  }
  const expiraEn = s["expiraEn"];
  if (typeof expiraEn !== "number" || !Number.isFinite(expiraEn) || expiraEn <= 0) return null;

  return {
    accessToken: s["accessToken"] as string,
    refreshToken: s["refreshToken"] as string,
    expiraEn,
    userId: s["userId"] as string,
    tenantId: s["tenantId"] as string,
  };
}

/**
 * Escribe la sesión de forma ATÓMICA: archivo temporal + `rename`, nunca una escritura parcial sobre
 * el archivo bueno (spec §6, mitigación 1). Es la protección real contra el escenario que el spec
 * nombra: Claude Desktop mata el subproceso MCP libremente, y un `writeFile` directo interrumpido a
 * mitad de escritura dejaría un `session.json` corrupto — sin sesión recuperable, ni siquiera con un
 * login nuevo hasta borrar el archivo a mano.
 *
 * Se intenta `chmod 600` mejor-esfuerzo: en Windows es casi un no-op y NO se documenta como
 * protección real (spec §6) — la protección de verdad es que el archivo vive en el perfil del
 * usuario.
 */
export async function escribirSesion(sesion: Sesion, ruta: string = rutaSesion()): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, JSON.stringify(sesion, null, 2), { mode: 0o600 });
  await rename(temporal, ruta);
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(ruta, 0o600);
  } catch {
    // Mejor esfuerzo — ver el comentario de arriba. Nunca debe tumbar el login por esto.
  }
}

/** ¿Falta menos de `margenMs` para que venza `accessToken`? Vencido cuenta como "por vencer". */
export function estaPorVencer(sesion: Sesion, margenMs: number, ahora: () => number = Date.now): boolean {
  return sesion.expiraEn - ahora() <= margenMs;
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
npx tsx --test mcp-server/src/session.test.ts
```

Esperado: PASS, 11/11.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w mcp-server
```

Esperado: limpio.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/session.ts mcp-server/src/session.test.ts
git commit -m "mcp-server: session.ts — leer/escribir la sesión en disco, atómico"
```

---

### Task 3: `gotrue.ts` — login y refresh contra Supabase Auth

**Files:**
- Create: `mcp-server/src/gotrue.ts`
- Test: `mcp-server/src/gotrue.test.ts`

**Interfaces:**
- Consumes: `Sesion` de `./session.ts` (Task 2).
- Produces (usado por Task 4 y Task 9):
  - `export interface OpcionesGoTrue { supabaseUrl: string; anonKey: string; fetchFn?: typeof fetch }`
  - `export const TIMEOUT_TOKEN_MS = 8_000`
  - `export async function iniciarSesion(opts: OpcionesGoTrue, email: string, password: string): Promise<Sesion>`
  - `export async function refrescarSesion(opts: OpcionesGoTrue, refreshToken: string): Promise<Sesion>`
  - Las dos **lanzan** (no devuelven `null`) si Supabase rechaza la credencial o si falta
    `app_metadata.tenant_id` — spec §3.3: *"si el usuario no tiene `app_metadata.tenant_id`, el login
    falla ruidosamente y no escribe sesión"*.

**Nota de diseño, para quien lea el código de `portal/src/app/core/auth-core.ts` en busca del molde:**
esta versión es más chica a propósito (spec §3.6) — sin `rol`, sin `email` en la `Sesion` — y
**difiere en un punto real**: el portal defatea `tenantId` a `''` cuando falta; acá se **lanza**,
porque no hay pantalla que le muestre al usuario "no tenés tenant" — la única superficie es el mensaje
de error de la tool, y una sesión con `tenantId: ''` escrita en disco produciría un 400 confuso en
cada llamada futura en vez de un error claro una sola vez, en el login.

- [ ] **Step 1: Escribir los tests, en rojo**

`mcp-server/src/gotrue.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { iniciarSesion, refrescarSesion, TIMEOUT_TOKEN_MS, type OpcionesGoTrue } from "./gotrue.ts";

const OPTS: OpcionesGoTrue = { supabaseUrl: "https://proyecto.supabase.co", anonKey: "anon-key-123" };

function respuestaGoTrue(over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-abc",
      refresh_token: "refresh-def",
      expires_in: 3600,
      user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: { tenant_id: "tenant-xyz" } },
      ...over,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("iniciarSesion: arma el request de login con la forma exacta de GoTrue", async () => {
  let capturado: { url: string; init: RequestInit } | null = null;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    capturado = { url: String(url), init: init ?? {} };
    return respuestaGoTrue();
  }) as typeof fetch;

  await iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2");

  assert.ok(capturado);
  assert.equal(capturado!.url, "https://proyecto.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(capturado!.init.method, "POST");
  const headers = capturado!.init.headers as Record<string, string>;
  assert.equal(headers["apikey"], "anon-key-123");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(capturado!.init.body as string), { email: "juan@amg.es", password: "hunter2" });
});

test("iniciarSesion: mapea la respuesta a Sesion", async () => {
  const fetchFn = (async () => respuestaGoTrue()) as typeof fetch;
  const sesion = await iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2");
  assert.equal(sesion.accessToken, "access-abc");
  assert.equal(sesion.refreshToken, "refresh-def");
  assert.equal(sesion.userId, "11111111-1111-1111-1111-111111111111");
  assert.equal(sesion.tenantId, "tenant-xyz");
  assert.ok(sesion.expiraEn > Date.now(), "expiraEn tiene que ser un instante futuro");
});

test("iniciarSesion: LANZA si falta app_metadata.tenant_id (spec §3.3)", async () => {
  const fetchFn = (async () =>
    respuestaGoTrue({ user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: {} } })) as typeof fetch;
  await assert.rejects(
    () => iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2"),
    /tenant/i,
  );
});

test("iniciarSesion: LANZA con el mensaje de Supabase si el login falla", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ error_description: "Invalid login credentials" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  await assert.rejects(
    () => iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "mal"),
    /Invalid login credentials/,
  );
});

test("refrescarSesion: arma el request con grant_type=refresh_token", async () => {
  let capturado: { url: string; body: string } | null = null;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    capturado = { url: String(url), body: init?.body as string };
    return respuestaGoTrue();
  }) as typeof fetch;

  await refrescarSesion({ ...OPTS, fetchFn }, "refresh-viejo");

  assert.equal(capturado!.url, "https://proyecto.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.deepEqual(JSON.parse(capturado!.body), { refresh_token: "refresh-viejo" });
});

test("refrescarSesion: también lanza si falta el tenant", async () => {
  const fetchFn = (async () =>
    respuestaGoTrue({ user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: {} } })) as typeof fetch;
  await assert.rejects(() => refrescarSesion({ ...OPTS, fetchFn }, "refresh-viejo"), /tenant/i);
});

test("TIMEOUT_TOKEN_MS es razonable y se usa en el request", async () => {
  assert.equal(TIMEOUT_TOKEN_MS, 8_000);
  let vioSignal = false;
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    vioSignal = init?.signal instanceof AbortSignal;
    return respuestaGoTrue();
  }) as typeof fetch;
  await iniciarSesion({ ...OPTS, fetchFn }, "a@b.es", "x");
  assert.ok(vioSignal, "el request tiene que llevar un AbortSignal (timeout)");
});
```

- [ ] **Step 2: Correr, confirmar rojo**

```bash
npx tsx --test mcp-server/src/gotrue.test.ts
```

Esperado: FAIL — `gotrue.ts` no existe.

- [ ] **Step 3: Implementar `mcp-server/src/gotrue.ts`**

```ts
import type { Sesion } from "./session.ts";

/**
 * Login/refresh contra Supabase Auth (GoTrue) por su endpoint REST, sin el SDK — mismo criterio que
 * `portal/src/app/core/auth-core.ts` y la misma razón: el token es lo único que hace falta, y
 * `fetch` directo mantiene esto testeable sin red.
 */
export interface OpcionesGoTrue {
  supabaseUrl: string;
  anonKey: string;
  fetchFn?: typeof fetch;
}

interface RespuestaGoTrue {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; app_metadata?: { tenant_id?: string } };
}

/** Mismo valor que el portal (`TIMEOUT_TOKEN_MS`): mismo endpoint, mismo modo de fallo (red muda). */
export const TIMEOUT_TOKEN_MS = 8_000;

async function postToken(opts: OpcionesGoTrue, params: string, body: unknown): Promise<RespuestaGoTrue> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(`${opts.supabaseUrl}/auth/v1/token?${params}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: opts.anonKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_TOKEN_MS),
  });
  if (!res.ok) {
    let mensaje = "No se pudo iniciar sesión.";
    try {
      const j = (await res.json()) as { error_description?: string; msg?: string; error?: string };
      mensaje = j.error_description ?? j.msg ?? j.error ?? mensaje;
    } catch {
      /* cuerpo no-JSON */
    }
    throw new Error(mensaje);
  }
  return (await res.json()) as RespuestaGoTrue;
}

/**
 * `tenantId` sale de `app_metadata.tenant_id`, nunca se elige (spec §3.3). Si falta, se LANZA: no
 * hay pantalla acá que le muestre al usuario el caso "sin tenant" como hace el portal, así que una
 * sesión sin tenant escrita en disco solo produciría un 400 confuso en cada tool futura. Mejor
 * fallar una vez, fuerte, en el login.
 */
function aSesion(j: RespuestaGoTrue): Sesion {
  const tenantId = j.user.app_metadata?.tenant_id;
  if (!tenantId) {
    throw new Error(
      "Tu usuario no tiene un tenant asignado (app_metadata.tenant_id). Pedile a un administrador " +
        "que te lo asigne antes de usar el MCP de AMG OS.",
    );
  }
  const expiraEn = j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiraEn, userId: j.user.id, tenantId };
}

/** Login con email + password. Lanza si Supabase rechaza la credencial o si falta el tenant. */
export async function iniciarSesion(opts: OpcionesGoTrue, email: string, password: string): Promise<Sesion> {
  const j = await postToken(opts, "grant_type=password", { email, password });
  return aSesion(j);
}

/** Renueva con el refresh token. Mismas reglas de fallo que `iniciarSesion`. */
export async function refrescarSesion(opts: OpcionesGoTrue, refreshToken: string): Promise<Sesion> {
  const j = await postToken(opts, "grant_type=refresh_token", { refresh_token: refreshToken });
  return aSesion(j);
}
```

- [ ] **Step 4: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/gotrue.test.ts
```

Esperado: PASS, 7/7.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/gotrue.ts mcp-server/src/gotrue.test.ts
git commit -m "mcp-server: gotrue.ts — login y refresh contra Supabase Auth"
```

---

### Task 4: `api-client.ts` — el cliente HTTP de `api/`, con refresh automático y traducción de errores

**Files:**
- Create: `mcp-server/src/api-client.ts`
- Test: `mcp-server/src/api-client.test.ts`

**Interfaces:**
- Consumes: `Sesion`, `leerSesion`, `escribirSesion`, `estaPorVencer` de `./session.ts` (Task 2);
  `refrescarSesion`, `OpcionesGoTrue` de `./gotrue.ts` (Task 3).
- Produces (usado por Task 5, Task 6, y transitivamente por Task 8):
  - `export interface OpcionesApi { apiUrl: string; supabaseUrl: string; anonKey: string; fetchFn?: typeof fetch; ahora?: () => number; rutaSesion?: string }`
  - `export type ResultadoLlamada<T> = { ok: true; datos: T } | { ok: false; mensaje: string }`
  - `export async function llamarApi<T>(opts: OpcionesApi, path: string, init?: { method?: string; body?: unknown }): Promise<ResultadoLlamada<T>>`

**La tabla de errores que este archivo implementa, verbatim del spec §7:**

| Situación | Mensaje |
| --- | --- |
| No hay sesión / refresh falló | `Sesión no disponible. Corré \`npm run mcp:login -w mcp-server\`.` |
| `401` de la API | Se intenta un refresh; si vuelve a fallar, el mensaje de arriba |
| `503` de la API | `No se puede verificar el token ahora (Supabase). Reintentá en un momento.` |
| `403` / `404` | `No existe o no tenés acceso.` |
| `409` | El mensaje real que manda la API (p. ej. `TRANSICION_INVALIDA`), tal cual |
| La API no responde | `No hay API en <AMG_API_URL>. ¿Está corriendo \`npm run dev:server -w api\`?` |

- [ ] **Step 1: Escribir los tests, en rojo**

`mcp-server/src/api-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { llamarApi, type OpcionesApi } from "./api-client.ts";
import { escribirSesion, type Sesion } from "./session.ts";

const SESION_VIVA: Sesion = {
  accessToken: "access-vivo",
  refreshToken: "refresh-vivo",
  expiraEn: Date.now() + 3_600_000, // vence en 1h — no está por vencer
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};

async function conSesion(sesion: Sesion | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-api-test-"));
  const ruta = join(dir, "session.json");
  if (sesion) await escribirSesion(sesion, ruta);
  return ruta;
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

const BASE: Omit<OpcionesApi, "rutaSesion" | "fetchFn"> = {
  apiUrl: "http://localhost:3000",
  supabaseUrl: "https://proyecto.supabase.co",
  anonKey: "anon-key",
};

test("sin sesión: no llama a fetch, devuelve el mensaje de 'sin sesión'", async () => {
  const rutaSesion = await conSesion(null);
  let llamoFetch = false;
  const fetchFn = (async () => {
    llamoFetch = true;
    return json({});
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /mcp:login -w mcp-server/);
  assert.equal(llamoFetch, false);
});

test("sesión viva: manda authorization y x-amg-tenant correctos", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let headers: Record<string, string> = {};
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    headers = init?.headers as Record<string, string>;
    return json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi<{ clientes: unknown[] }>({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(headers["authorization"], "Bearer access-vivo");
  assert.equal(headers["x-amg-tenant"], "22222222-2222-2222-2222-222222222222");
});

test("con body: manda content-type y el JSON del body", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let headers: Record<string, string> = {};
  let cuerpo = "";
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    headers = init?.headers as Record<string, string>;
    cuerpo = init?.body as string;
    return json({ ok: true, decisionId: "d1" });
  }) as typeof fetch;

  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs/r1/approve", {
    method: "POST",
    body: { destino: "solo_informe" },
  });

  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(cuerpo), { destino: "solo_informe" });
});

test("sesión por vencer: refresca ANTES de llamar, y usa el token nuevo", async () => {
  const rutaSesion = await conSesion({ ...SESION_VIVA, expiraEn: Date.now() + 1_000 }); // por vencer
  let tokenUsado = "";
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    tokenUsado = ((init?.headers as Record<string, string>)["authorization"] ?? "").replace("Bearer ", "");
    return json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(tokenUsado, "access-refrescado");
});

test("401 en el primer intento: refresca UNA vez y reintenta con éxito", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let llamadasApi = 0;
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    llamadasApi += 1;
    return llamadasApi === 1 ? json({ error: "Token inválido o expirado." }, 401) : json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(llamadasApi, 2, "primer intento (401) + reintento tras refrescar");
});

test("401 persiste tras refrescar: mensaje de 'sin sesión', no un loop", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    return json({ error: "Token inválido o expirado." }, 401);
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /mcp:login -w mcp-server/);
});

test("503: mensaje específico de Supabase caído, no el de sesión muerta", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async () => json({ error: "No se puede verificar el token en este momento." }, 503)) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /Supabase/);
});

test("403 y 404: mismo mensaje genérico, sin distinguir (igual que la API)", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  for (const status of [403, 404]) {
    const fetchFn = (async () => json({ error: "no importa" }, status)) as typeof fetch;
    const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients/x");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.mensaje, /No existe o no tenés acceso/);
  }
});

test("409: reenvía el mensaje real de la API, tal cual", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async () =>
    json({ error: "Esta transición no está permitida para el estado actual del run.", codigo: "TRANSICION_INVALIDA" }, 409)) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs/r1/approve", { method: "POST", body: { destino: "solo_informe" } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.mensaje, "Esta transición no está permitida para el estado actual del run.");
});

test("la API no responde (fetch lanza): mensaje con la URL configurada", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) return json({});
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.mensaje, /No hay API en/);
    assert.match(r.mensaje, /http:\/\/localhost:3000/);
    assert.match(r.mensaje, /dev:server -w api/);
  }
});

test("refresh persiste en disco: la próxima llamada ya usa el token nuevo sin refrescar de nuevo", async () => {
  const rutaSesion = await conSesion({ ...SESION_VIVA, expiraEn: Date.now() + 1_000 });
  let refrescos = 0;
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      refrescos += 1;
      return json({
        access_token: `access-${refrescos}`,
        refresh_token: `refresh-${refrescos}`,
        expires_in: 3600, // la sesión nueva NO está por vencer
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    return json({ clientes: [] });
  }) as typeof fetch;

  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");
  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(refrescos, 1, "la segunda llamada tiene que leer la sesión YA refrescada del disco");
});
```

- [ ] **Step 2: Correr, confirmar rojo**

```bash
npx tsx --test mcp-server/src/api-client.test.ts
```

Esperado: FAIL — `api-client.ts` no existe.

- [ ] **Step 3: Implementar `mcp-server/src/api-client.ts`**

```ts
import { refrescarSesion } from "./gotrue.ts";
import { escribirSesion, estaPorVencer, leerSesion, type Sesion } from "./session.ts";

export interface OpcionesApi {
  apiUrl: string;
  supabaseUrl: string;
  anonKey: string;
  fetchFn?: typeof fetch;
  ahora?: () => number;
  /** Override de la ruta de sesión, solo para tests. */
  rutaSesion?: string;
}

export type ResultadoLlamada<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

/** Si falta esto de margen o menos para que venza el access token, se refresca antes de llamar. */
const MARGEN_REFRESH_MS = 60_000;

const MSG_SIN_SESION = "Sesión no disponible. Corré `npm run mcp:login -w mcp-server`.";

/** Sesión válida y no por vencer, refrescando y persistiendo si hace falta. `null` si no se puede. */
async function sesionUtilizable(opts: OpcionesApi): Promise<Sesion | null> {
  const sesion = await leerSesion(opts.rutaSesion);
  if (!sesion) return null;

  const ahora = opts.ahora ?? Date.now;
  if (!estaPorVencer(sesion, MARGEN_REFRESH_MS, ahora)) return sesion;

  try {
    const nueva = await refrescarSesion({ supabaseUrl: opts.supabaseUrl, anonKey: opts.anonKey, fetchFn: opts.fetchFn }, sesion.refreshToken);
    await escribirSesion(nueva, opts.rutaSesion);
    return nueva;
  } catch {
    return null;
  }
}

/**
 * Llama a `api/` con la sesión guardada, refrescando el token cuando hace falta (por vencer, o ante
 * un 401) y traduciendo cada fallo al mensaje de la tabla del spec §7 — ver el comentario de cabecera
 * del archivo de test. Nunca lanza: siempre devuelve `ResultadoLlamada`, que es lo único que una tool
 * MCP le puede mostrar al usuario.
 */
export async function llamarApi<T>(
  opts: OpcionesApi,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ResultadoLlamada<T>> {
  let sesion = await sesionUtilizable(opts);
  if (!sesion) return { ok: false, mensaje: MSG_SIN_SESION };

  const fetchFn = opts.fetchFn ?? fetch;
  const pedir = (accessToken: string): Promise<Response> =>
    fetchFn(`${opts.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-amg-tenant": (sesion as Sesion).tenantId,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  let res: Response;
  try {
    res = await pedir(sesion.accessToken);
  } catch {
    return { ok: false, mensaje: `No hay API en ${opts.apiUrl}. ¿Está corriendo \`npm run dev:server -w api\`?` };
  }

  if (res.status === 401) {
    try {
      const nueva = await refrescarSesion({ supabaseUrl: opts.supabaseUrl, anonKey: opts.anonKey, fetchFn: opts.fetchFn }, sesion.refreshToken);
      await escribirSesion(nueva, opts.rutaSesion);
      sesion = nueva;
      res = await pedir(sesion.accessToken);
    } catch {
      return { ok: false, mensaje: MSG_SIN_SESION };
    }
    if (res.status === 401) return { ok: false, mensaje: MSG_SIN_SESION };
  }

  if (res.status === 503) {
    return { ok: false, mensaje: "No se puede verificar el token ahora (Supabase). Reintentá en un momento." };
  }
  if (res.status === 403 || res.status === 404) {
    return { ok: false, mensaje: "No existe o no tenés acceso." };
  }
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, mensaje: cuerpo?.error ?? `La API respondió ${res.status}.` };
  }

  return { ok: true, datos: (await res.json()) as T };
}
```

- [ ] **Step 4: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/api-client.test.ts
```

Esperado: PASS, 11/11.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/api-client.ts mcp-server/src/api-client.test.ts
git commit -m "mcp-server: api-client.ts — llamar a api/ con refresh automático y errores traducidos"
```

---

### Task 5: `tools/clientes.ts` — `amg_listar_clientes` y `amg_ver_cliente`, y `validacion.ts`

**Files:**
- Create: `mcp-server/src/validacion.ts`
- Create: `mcp-server/src/tools/clientes.ts`
- Test: `mcp-server/src/validacion.test.ts`
- Test: `mcp-server/src/tools/clientes.test.ts`

**Interfaces:**
- Consumes: `llamarApi`, `OpcionesApi`, `ResultadoLlamada` de `../api-client.ts` (Task 4).
- Produces (usado por Task 6 y Task 8):
  - `export const UUID_RE: RegExp` (`validacion.ts`)
  - `export function esUuid(v: string): boolean` (`validacion.ts`)
  - `export async function listarClientes(opts: OpcionesApi): Promise<ResultadoLlamada<unknown>>`
  - `export async function verCliente(opts: OpcionesApi, clienteId: string): Promise<ResultadoLlamada<unknown>>`

**Por qué `ResultadoLlamada<unknown>` y no un tipo `Cliente`:** el spec (§1) es explícito — este
paquete no conoce el dominio, solo reenvía lo que la API ya devuelve para que Claude lo lea. Tipar la
forma exacta del cliente obligaría a mantener un tercer lugar sincronizado con `db/`/`api/`, que es
justo la clase de duplicación que el spec descarta.

- [ ] **Step 1: Escribir los tests de `validacion.ts`, en rojo**

`mcp-server/src/validacion.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { esUuid } from "./validacion.ts";

test("esUuid: acepta un UUID v4 válido", () => {
  assert.equal(esUuid("11111111-1111-1111-1111-111111111111"), true);
});

test("esUuid: acepta mayúsculas", () => {
  assert.equal(esUuid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"), true);
});

test("esUuid: rechaza un nombre de cliente", () => {
  assert.equal(esUuid("Bella Napoli"), false);
});

test("esUuid: rechaza un UUID con un carácter de más", () => {
  assert.equal(esUuid("11111111-1111-1111-1111-1111111111111"), false);
});

test("esUuid: rechaza vacío", () => {
  assert.equal(esUuid(""), false);
});
```

- [ ] **Step 2: Implementar `mcp-server/src/validacion.ts`**

```ts
/**
 * Mismo patrón que `api/src/auth.ts:UUID` — no se importa desde ahí porque `mcp-server` no depende
 * de `api/` como paquete (spec §1). Es una constante de 5 líneas; duplicarla es más barato y más
 * seguro que abrir un import cruzado entre dos paquetes que el diseño mantiene separados a propósito.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La barrera contra la clase de error que el spec nombra explícitamente (§3.4): elegir un cliente o
 * un run por nombre desde un chat. Toda tool de escritura, y toda tool que recibe un id como
 * argumento, valida con esto ANTES de llamar a la API.
 */
export function esUuid(v: string): boolean {
  return UUID_RE.test(v);
}
```

- [ ] **Step 3: Correr `validacion.test.ts`, confirmar verde**

```bash
npx tsx --test mcp-server/src/validacion.test.ts
```

Esperado: PASS, 5/5.

- [ ] **Step 4: Escribir los tests de `tools/clientes.ts`, en rojo**

`mcp-server/src/tools/clientes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpcionesApi } from "../api-client.ts";
import { listarClientes, verCliente } from "./clientes.ts";

function opts(fetchFn: typeof fetch): OpcionesApi {
  return { apiUrl: "http://localhost:3000", supabaseUrl: "https://x.supabase.co", anonKey: "k", fetchFn };
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

test("listarClientes: pega a GET /clients", async () => {
  let pedido: string | null = null;
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ clientes: [{ id: "c1", nombre: "Bella Napoli" }] });
  }) as typeof fetch;

  const r = await listarClientes(opts(fetchFn));

  assert.match(pedido!, /\/clients$/);
  assert.equal(r.ok, true);
});

test("verCliente: pega a GET /clients/:id con un UUID válido", async () => {
  const id = "11111111-1111-1111-1111-111111111111";
  let pedido: string | null = null;
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ cliente: { id, nombre: "Bella Napoli" } });
  }) as typeof fetch;

  const r = await verCliente(opts(fetchFn), id);

  assert.equal(pedido, `http://localhost:3000/clients/${id}`);
  assert.equal(r.ok, true);
});

test("🔴 verCliente: rechaza un nombre en vez de un UUID, SIN llamar a la API", async () => {
  let llamoFetch = false;
  const fetchFn = (async () => {
    llamoFetch = true;
    return json({});
  }) as typeof fetch;

  const r = await verCliente(opts(fetchFn), "Bella Napoli");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /UUID/);
  assert.equal(llamoFetch, false, "un id inválido no debe llegar a la red");
});
```

- [ ] **Step 5: Implementar `mcp-server/src/tools/clientes.ts`**

```ts
import { llamarApi, type OpcionesApi, type ResultadoLlamada } from "../api-client.ts";
import { esUuid } from "../validacion.ts";

/** `amg_listar_clientes` — GET /clients. Es el paso previo obligatorio de cualquier escritura (spec §3.4/§5). */
export async function listarClientes(opts: OpcionesApi): Promise<ResultadoLlamada<unknown>> {
  return llamarApi(opts, "/clients");
}

/** `amg_ver_cliente` — GET /clients/:id. `clienteId` tiene que ser el UUID que devolvió `listarClientes`. */
export async function verCliente(opts: OpcionesApi, clienteId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(clienteId)) return { ok: false, mensaje: "clienteId tiene que ser un UUID (usá amg_listar_clientes primero)." };
  return llamarApi(opts, `/clients/${clienteId}`);
}
```

- [ ] **Step 6: Correr todo, confirmar verde**

```bash
npx tsx --test mcp-server/src/validacion.test.ts mcp-server/src/tools/clientes.test.ts
```

Esperado: PASS, 8/8.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/validacion.ts mcp-server/src/validacion.test.ts mcp-server/src/tools/clientes.ts mcp-server/src/tools/clientes.test.ts
git commit -m "mcp-server: tools de clientes (amg_listar_clientes, amg_ver_cliente) + validación de UUID"
```

---

### Task 6: `tools/runs.ts` — las cuatro tools de runs, incluida la única escritura

**Files:**
- Create: `mcp-server/src/tools/runs.ts`
- Test: `mcp-server/src/tools/runs.test.ts`

**Interfaces:**
- Consumes: `llamarApi`, `OpcionesApi`, `ResultadoLlamada` de `../api-client.ts` (Task 4); `esUuid` de
  `../validacion.ts` (Task 5).
- Produces (usado por Task 8):
  - `export async function listarRuns(opts: OpcionesApi, clientId?: string): Promise<ResultadoLlamada<unknown>>`
  - `export async function verRun(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>>`
  - `export async function verInforme(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>>`
  - `export type Destino = "crear_web" | "solo_informe" | "crear_posts"`
  - `export function esDestinoValido(v: string): v is Destino`
  - `export async function aprobarRun(opts: OpcionesApi, runId: string, destino: string): Promise<ResultadoLlamada<unknown>>`

- [ ] **Step 1: Escribir los tests, en rojo**

`mcp-server/src/tools/runs.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpcionesApi } from "../api-client.ts";
import { aprobarRun, esDestinoValido, listarRuns, verInforme, verRun } from "./runs.ts";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function opts(fetchFn: typeof fetch): OpcionesApi {
  return { apiUrl: "http://localhost:3000", supabaseUrl: "https://x.supabase.co", anonKey: "k", fetchFn };
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

test("listarRuns sin clientId: GET /runs", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ runs: [] });
  }) as typeof fetch;
  await listarRuns(opts(fetchFn));
  assert.equal(pedido, "http://localhost:3000/runs");
});

test("listarRuns con clientId: GET /runs?clientId=<uuid>", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ runs: [] });
  }) as typeof fetch;
  await listarRuns(opts(fetchFn), CLIENT_ID);
  assert.equal(pedido, `http://localhost:3000/runs?clientId=${CLIENT_ID}`);
});

test("🔴 listarRuns: clientId inválido no llega a la red", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;
  const r = await listarRuns(opts(fetchFn), "no-es-un-uuid");
  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});

test("verRun: GET /runs/:id", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ run: {}, pages: [] });
  }) as typeof fetch;
  await verRun(opts(fetchFn), RUN_ID);
  assert.equal(pedido, `http://localhost:3000/runs/${RUN_ID}`);
});

test("🔴 verRun: rechaza un id no-UUID sin llamar a la red", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;
  const r = await verRun(opts(fetchFn), "el run de bella napoli");
  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});

test("verInforme: GET /runs/:id/informe", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ informe_md: null, generado_at: null });
  }) as typeof fetch;
  await verInforme(opts(fetchFn), RUN_ID);
  assert.equal(pedido, `http://localhost:3000/runs/${RUN_ID}/informe`);
});

test("esDestinoValido: los tres valores del enum, y nada más", () => {
  assert.equal(esDestinoValido("crear_web"), true);
  assert.equal(esDestinoValido("solo_informe"), true);
  assert.equal(esDestinoValido("crear_posts"), true);
  assert.equal(esDestinoValido("publicar_ya"), false);
  assert.equal(esDestinoValido(""), false);
});

test("aprobarRun: POST /runs/:id/approve con {destino} en el body", async () => {
  let pedido: { url: string; method: string; body: string } | null = null;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    pedido = { url: String(url), method: init?.method ?? "", body: init?.body as string };
    return json({ ok: true, decisionId: "d1" });
  }) as typeof fetch;

  const r = await aprobarRun(opts(fetchFn), RUN_ID, "solo_informe");

  assert.equal(pedido!.url, `http://localhost:3000/runs/${RUN_ID}/approve`);
  assert.equal(pedido!.method, "POST");
  assert.deepEqual(JSON.parse(pedido!.body), { destino: "solo_informe" });
  assert.equal(r.ok, true);
});

test("🔴 aprobarRun: destino fuera del enum se rechaza ANTES de llamar a la API", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;

  const r = await aprobarRun(opts(fetchFn), RUN_ID, "publicar_ya");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /crear_web.*solo_informe.*crear_posts|destino/i);
  assert.equal(llamo, false, "un destino inválido no debe llegar a la red — la API igual lo validaría, pero esto es defensa en profundidad (spec §5)");
});

test("🔴 aprobarRun: runId no-UUID se rechaza ANTES de llamar a la API", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;

  const r = await aprobarRun(opts(fetchFn), "el run de ayer", "solo_informe");

  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});
```

- [ ] **Step 2: Correr, confirmar rojo**

```bash
npx tsx --test mcp-server/src/tools/runs.test.ts
```

Esperado: FAIL — `runs.ts` no existe.

- [ ] **Step 3: Implementar `mcp-server/src/tools/runs.ts`**

```ts
import { llamarApi, type OpcionesApi, type ResultadoLlamada } from "../api-client.ts";
import { esUuid } from "../validacion.ts";

/** `amg_listar_runs` — GET /runs, opcionalmente filtrado por cliente. */
export async function listarRuns(opts: OpcionesApi, clientId?: string): Promise<ResultadoLlamada<unknown>> {
  if (clientId !== undefined && !esUuid(clientId)) {
    return { ok: false, mensaje: "clientId tiene que ser un UUID (usá amg_listar_clientes primero)." };
  }
  return llamarApi(opts, clientId ? `/runs?clientId=${clientId}` : "/runs");
}

/** `amg_ver_run` — GET /runs/:id. Trae el brief, las páginas propuestas y la última decisión. */
export async function verRun(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  return llamarApi(opts, `/runs/${runId}`);
}

/** `amg_ver_informe` — GET /runs/:id/informe. El informe legible de keyword research. */
export async function verInforme(opts: OpcionesApi, runId: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  return llamarApi(opts, `/runs/${runId}/informe`);
}

/** El enum cerrado que acepta `POST /runs/:id/approve` (`api/src/app.ts:526`). */
export type Destino = "crear_web" | "solo_informe" | "crear_posts";

const DESTINOS: readonly Destino[] = ["crear_web", "solo_informe", "crear_posts"];

export function esDestinoValido(v: string): v is Destino {
  return (DESTINOS as readonly string[]).includes(v);
}

/**
 * `amg_aprobar_run` — POST /runs/:id/approve. La ÚNICA tool de escritura de la v1 (spec §5): dispara
 * trabajo real del pipeline y, con `destino: "crear_web"`, gasto real. Valida `runId` (UUID) y
 * `destino` (el enum cerrado) ANTES de llamar — la API los vuelve a validar igual (defensa en
 * profundidad, no un reemplazo).
 */
export async function aprobarRun(opts: OpcionesApi, runId: string, destino: string): Promise<ResultadoLlamada<unknown>> {
  if (!esUuid(runId)) return { ok: false, mensaje: "runId tiene que ser un UUID (usá amg_listar_runs primero)." };
  if (!esDestinoValido(destino)) {
    return { ok: false, mensaje: "destino tiene que ser 'crear_web', 'solo_informe' o 'crear_posts'." };
  }
  return llamarApi(opts, `/runs/${runId}/approve`, { method: "POST", body: { destino } });
}
```

- [ ] **Step 4: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/tools/runs.test.ts
```

Esperado: PASS, 10/10.

- [ ] **Step 5: Verificación por mutación de las dos barreras de seguridad (spec §8)**

Mutá a mano `esDestinoValido` para que devuelva siempre `true`, corré
`npx tsx --test mcp-server/src/tools/runs.test.ts` y confirmá que **cae exactamente**
`"🔴 aprobarRun: destino fuera del enum se rechaza ANTES de llamar a la API"`. Repetí con `esUuid`
(hacé que siempre devuelva `true`) y confirmá que caen los tres tests marcados `🔴`. Revertí las dos
mutaciones.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/tools/runs.ts mcp-server/src/tools/runs.test.ts
git commit -m "mcp-server: tools de runs (listar/ver/informe/aprobar) — mutación confirmada en las dos barreras de UUID/enum"
```

---

### Task 7: `formato.ts` — traducir `ResultadoLlamada` a la respuesta que espera el SDK de MCP

**Files:**
- Create: `mcp-server/src/formato.ts`
- Test: `mcp-server/src/formato.test.ts`

**Interfaces:**
- Consumes: `ResultadoLlamada` de `./api-client.ts` (Task 4).
- Produces (usado por Task 8):
  - `export interface RespuestaMcp { content: Array<{ type: "text"; text: string }>; isError?: boolean }`
  - `export function respuestaTexto(resultado: ResultadoLlamada<unknown>): RespuestaMcp`

- [ ] **Step 1: Escribir los tests, en rojo**

`mcp-server/src/formato.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { respuestaTexto } from "./formato.ts";

test("resultado ok: el texto es el JSON legible de los datos, sin isError", () => {
  const r = respuestaTexto({ ok: true, datos: { clientes: [{ id: "c1" }] } });
  assert.equal(r.isError, undefined);
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0]!.type, "text");
  assert.deepEqual(JSON.parse(r.content[0]!.text), { clientes: [{ id: "c1" }] });
});

test("resultado NO ok: el texto es el mensaje, con isError true", () => {
  const r = respuestaTexto({ ok: false, mensaje: "No existe o no tenés acceso." });
  assert.equal(r.isError, true);
  assert.equal(r.content[0]!.text, "No existe o no tenés acceso.");
});
```

- [ ] **Step 2: Implementar `mcp-server/src/formato.ts`**

```ts
import type { ResultadoLlamada } from "./api-client.ts";

/** La forma que el SDK de MCP espera como respuesta de una tool. */
export interface RespuestaMcp {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Traduce lo que devuelven las tools (`ResultadoLlamada`) a lo único que Claude Desktop puede
 * mostrar: texto. `isError` marca el camino de fallo para que Claude Desktop lo distinga en la UI,
 * pero el mensaje siempre es el mismo texto legible que ya armó `llamarApi` (spec §7) — ningún error
 * se traga ni se re-envuelve.
 */
export function respuestaTexto(resultado: ResultadoLlamada<unknown>): RespuestaMcp {
  if (!resultado.ok) return { content: [{ type: "text", text: resultado.mensaje }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(resultado.datos, null, 2) }] };
}
```

- [ ] **Step 3: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/formato.test.ts
```

Esperado: PASS, 2/2.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/formato.ts mcp-server/src/formato.test.ts
git commit -m "mcp-server: formato.ts — ResultadoLlamada a respuesta MCP"
```

---

### Task 8: `server.ts` + `index.ts` — registrar las seis tools y arrancar el transporte `stdio`

**Files:**
- Create: `mcp-server/src/server.ts`
- Create: `mcp-server/src/index.ts`
- Test: `mcp-server/src/server.test.ts`
- Modify: `mcp-server/src/index.test.ts` — se borra (lo reemplaza `server.test.ts`, que prueba el
  wiring de verdad)

**Interfaces:**
- Consumes: todo lo de las Tasks 2-7 (`OpcionesApi`, las seis funciones de tools, `respuestaTexto`).
- Produces: el binario que Claude Desktop arranca (`npm start -w mcp-server`, o `tsx
  mcp-server/src/index.ts` desde `claude_desktop_config.json`).

**⚠️ Antes de escribir este Task, verificar la API instalada.** Este plan asume la API de alto nivel
del SDK (`McpServer` + `server.registerTool(nombre, config, handler)`), que es la estable en la serie
1.x al momento de escribir el spec. Antes de tocar código:

```bash
cat mcp-server/node_modules/@modelcontextprotocol/sdk/package.json | grep '"version"'
node -e 'console.log(Object.keys(require("@modelcontextprotocol/sdk/server/mcp.js")))' 2>&1 || true
```

Si la versión instalada expone una API distinta (por ejemplo, el `server.tool(nombre, descripcion,
zodShape, handler)` de versiones más viejas), adaptar la forma exacta de `server.ts` de abajo a lo que
los tipos instalados digan — el resto del archivo (las seis tools, sus `inputSchema` en zod, el
`respuestaTexto`) no cambia.

- [ ] **Step 1: Escribir el test de wiring, en rojo**

`mcp-server/src/server.test.ts` — no levanta el transporte `stdio` real (no tiene sentido en un test);
prueba que el server se construye y que las seis tools quedan registradas con los nombres del spec §5.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { crearServidor } from "./server.ts";
import type { OpcionesApi } from "./api-client.ts";

const OPTS_DE_PRUEBA: OpcionesApi = {
  apiUrl: "http://localhost:3000",
  supabaseUrl: "https://x.supabase.co",
  anonKey: "k",
};

test("crearServidor registra las seis tools del spec §5, ni una más ni una menos", async () => {
  const server = crearServidor(OPTS_DE_PRUEBA);
  // `_registeredTools` es un detalle de implementación del SDK, pero es el único gancho síncrono
  // para verificar el registro sin levantar un transporte real. Si el SDK cambia esta forma interna,
  // este test es el primero en avisarlo — que es justo lo que tiene que pasar.
  const nombres = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
  assert.deepEqual(
    nombres.sort(),
    [
      "amg_aprobar_run",
      "amg_listar_clientes",
      "amg_listar_runs",
      "amg_ver_cliente",
      "amg_ver_informe",
      "amg_ver_run",
    ],
  );
});
```

- [ ] **Step 2: Correr, confirmar rojo**

```bash
npx tsx --test mcp-server/src/server.test.ts
```

Esperado: FAIL — `server.ts` no existe.

- [ ] **Step 3: Implementar `mcp-server/src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpcionesApi } from "./api-client.ts";
import { respuestaTexto } from "./formato.ts";
import { listarClientes, verCliente } from "./tools/clientes.ts";
import { aprobarRun, listarRuns, verInforme, verRun } from "./tools/runs.ts";

/**
 * Arma el servidor MCP con las seis tools de la v1 (spec §5). Función pura respecto del transporte:
 * `index.ts` es lo único que lo conecta a `stdio` — separarlos es lo que permite testear el registro
 * sin abrir un subproceso real.
 */
export function crearServidor(opts: OpcionesApi): McpServer {
  const server = new McpServer({ name: "amg-mcp", version: "0.0.1" });

  server.registerTool(
    "amg_listar_clientes",
    {
      title: "Listar clientes",
      description:
        "Clientes visibles del tenant, con id y nombre. Paso previo OBLIGATORIO antes de usar " +
        "cualquier otra tool que pida un clienteId o runId: nunca adivines un id, siempre resolvelo " +
        "acá primero.",
      inputSchema: {},
    },
    async () => respuestaTexto(await listarClientes(opts)),
  );

  server.registerTool(
    "amg_ver_cliente",
    {
      title: "Ver un cliente",
      description: "Ficha completa de un cliente. clienteId tiene que ser el UUID de amg_listar_clientes.",
      inputSchema: { clienteId: z.string().describe("UUID del cliente, tal como lo devolvió amg_listar_clientes") },
    },
    async ({ clienteId }) => respuestaTexto(await verCliente(opts, clienteId)),
  );

  server.registerTool(
    "amg_listar_runs",
    {
      title: "Listar runs de keyword research",
      description:
        "Runs de un cliente (si se pasa clientId) o de todo el tenant. clientId, si se pasa, tiene " +
        "que ser un UUID de amg_listar_clientes.",
      inputSchema: {
        clientId: z.string().optional().describe("UUID del cliente para filtrar; si se omite, trae los de todo el tenant"),
      },
    },
    async ({ clientId }) => respuestaTexto(await listarRuns(opts, clientId)),
  );

  server.registerTool(
    "amg_ver_run",
    {
      title: "Ver un run",
      description: "El brief, las páginas propuestas y la última decisión de un run. runId de amg_listar_runs.",
      inputSchema: { runId: z.string().describe("UUID del run, de amg_listar_runs") },
    },
    async ({ runId }) => respuestaTexto(await verRun(opts, runId)),
  );

  server.registerTool(
    "amg_ver_informe",
    {
      title: "Ver el informe de un run",
      description: "El informe de keyword research en Markdown, para resumir o cruzar con otros runs.",
      inputSchema: { runId: z.string().describe("UUID del run, de amg_listar_runs") },
    },
    async ({ runId }) => respuestaTexto(await verInforme(opts, runId)),
  );

  server.registerTool(
    "amg_aprobar_run",
    {
      title: "Aprobar un run (ESCRIBE, dispara trabajo real)",
      description:
        "Aprueba un run con un destino. ⚠️ Dispara trabajo real del pipeline, y con destino " +
        "'crear_web' implica GASTO real (DataForSEO, el proveedor de research). No es reversible " +
        "desde acá. destino tiene que ser exactamente 'crear_web', 'solo_informe' o 'crear_posts'.",
      inputSchema: {
        runId: z.string().describe("UUID del run, de amg_listar_runs"),
        destino: z.enum(["crear_web", "solo_informe", "crear_posts"]),
      },
    },
    async ({ runId, destino }) => respuestaTexto(await aprobarRun(opts, runId, destino)),
  );

  return server;
}
```

- [ ] **Step 4: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/server.test.ts
```

Esperado: PASS, 1/1. Si `_registeredTools` no es el nombre real del campo interno en la versión
instalada del SDK, el test falla con un `undefined` claro — inspeccionar el objeto `server` con
`console.log(Object.keys(server))` una vez, a mano, y corregir el nombre del campo en el test.

- [ ] **Step 5: Borrar el test canario y crear `index.ts`**

```bash
rm mcp-server/src/index.test.ts
```

`mcp-server/src/index.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpcionesApi } from "./api-client.ts";
import { crearServidor } from "./server.ts";

/**
 * El punto de entrada que Claude Desktop arranca como subproceso (transporte `stdio`). Lee toda su
 * configuración de variables de entorno (spec §4) — nada hardcodeado, nada de argv.
 *
 * `AMG_API_URL` apunta al `dev-server` local (`http://localhost:3000`) hasta que el circuito completo
 * esté probado contra Claude Desktop real; apuntar a producción es después, cambiando una variable.
 */
function leerOpciones(): OpcionesApi {
  const apiUrl = process.env["AMG_API_URL"];
  const supabaseUrl = process.env["AMG_SUPABASE_URL"];
  const anonKey = process.env["AMG_SUPABASE_ANON_KEY"];
  const faltan = [
    !apiUrl && "AMG_API_URL",
    !supabaseUrl && "AMG_SUPABASE_URL",
    !anonKey && "AMG_SUPABASE_ANON_KEY",
  ].filter((x): x is string => Boolean(x));
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(", ")}. Ver mcp-server/README.md.`);
  }
  return { apiUrl: apiUrl as string, supabaseUrl: supabaseUrl as string, anonKey: anonKey as string };
}

async function main(): Promise<void> {
  const server = crearServidor(leerOpciones());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e: unknown) => {
  // stdout está tomado por el protocolo JSON-RPC (spec §3.2) — cualquier log de arranque va a
  // stderr, nunca a console.log.
  console.error(`[mcp-server] ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
npm test -w mcp-server
git add mcp-server/src/server.ts mcp-server/src/server.test.ts mcp-server/src/index.ts
git rm mcp-server/src/index.test.ts
git commit -m "mcp-server: server.ts + index.ts — arma y arranca el servidor MCP con las seis tools"
```

---

### Task 9: `cli/login.ts` — el comando `npm run mcp:login`

**Files:**
- Create: `mcp-server/src/cli/login.ts`
- Test: `mcp-server/src/cli/login.test.ts`

**Interfaces:**
- Consumes: `iniciarSesion`, `OpcionesGoTrue` de `../gotrue.ts` (Task 3); `escribirSesion` de
  `../session.ts` (Task 2).
- Produces: el script que `package.json` ya declara como `"mcp:login": "tsx src/cli/login.ts"`
  (Task 1) — nada más lo consume, es una hoja del árbol.

**Por qué existe aparte del servidor (spec §3.2):** un servidor `stdio` tiene stdin/stdout tomados
por el protocolo JSON-RPC y no tiene TTY — pedir una contraseña ahí corrompe el transporte. Este CLI
se corre a mano, en una terminal normal, antes de que Claude Desktop arranque el servidor.

**Nota sobre el password en pantalla:** Node no tiene un modo de entrada enmascarada nativo en
`node:readline`. Este CLI **no la enmascara** — se documenta así, no se finge una protección que no
existe (mismo criterio que el spec aplica a `chmod 600` en Windows, §6). Es un trade-off aceptado por
el spec para v1 (no agrega una dependencia nueva solo por esto); si en el uso real molesta, es un
paquete chico (`prompts`, `enquirer`) para una sesión futura.

- [ ] **Step 1: Escribir el test de la parte pura (la interactiva no se testea con `node:test`)**

La función que arma la sesión a partir de email/password YA está probada (es `iniciarSesion`, Task
3). Lo único propio de este archivo que vale la pena testear sin abrir un proceso interactivo real es
el mensaje de éxito/error que arma para la terminal — se extrae a una función pura.

`mcp-server/src/cli/login.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mensajeExito } from "./login.ts";

test("mensajeExito: incluye la ruta de la sesión y el tenant, no el token", () => {
  const msg = mensajeExito("/home/juan/.amg-mcp/session.json", "22222222-2222-2222-2222-222222222222");
  assert.match(msg, /session\.json/);
  assert.match(msg, /22222222-2222-2222-2222-222222222222/);
  assert.doesNotMatch(msg, /access|token/i);
});
```

- [ ] **Step 2: Correr, confirmar rojo**

```bash
npx tsx --test mcp-server/src/cli/login.test.ts
```

Esperado: FAIL — `login.ts` no existe.

- [ ] **Step 3: Implementar `mcp-server/src/cli/login.ts`**

```ts
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { iniciarSesion, type OpcionesGoTrue } from "../gotrue.ts";
import { escribirSesion, rutaSesion } from "../session.ts";

/** Mensaje final, deliberadamente SIN el token — esto es lo único que se imprime tras loguear. */
export function mensajeExito(ruta: string, tenantId: string): string {
  return `✔ Sesión guardada en ${ruta} (tenant ${tenantId}). Ya podés arrancar Claude Desktop.`;
}

function leerOpcionesGoTrue(): OpcionesGoTrue {
  const supabaseUrl = process.env["AMG_SUPABASE_URL"];
  const anonKey = process.env["AMG_SUPABASE_ANON_KEY"];
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Faltan AMG_SUPABASE_URL y/o AMG_SUPABASE_ANON_KEY en el entorno. Ver mcp-server/README.md.",
    );
  }
  return { supabaseUrl, anonKey };
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = await rl.question("Email de AMG OS: ");
    // Sin enmascarar — node:readline no lo soporta nativo. Ver el comentario del plan de esta tarea.
    const password = await rl.question("Contraseña: ");
    const sesion = await iniciarSesion(leerOpcionesGoTrue(), email.trim(), password);
    await escribirSesion(sesion);
    console.log(mensajeExito(rutaSesion(), sesion.tenantId));
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Correr, confirmar verde**

```bash
npx tsx --test mcp-server/src/cli/login.test.ts
```

Esperado: PASS, 1/1.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w mcp-server
git add mcp-server/src/cli/login.ts mcp-server/src/cli/login.test.ts
git commit -m "mcp-server: npm run mcp:login — el CLI interactivo de login"
```

---

### Task 10: README del paquete, nota de dueño en `AGENTS.md`, y verificación final

**Files:**
- Create: `mcp-server/README.md`
- Modify: `AGENTS.md` — agregar `mcp-server` a la tabla "Quién hace qué"

**Interfaces:**
- Consumes: nada nuevo — documenta lo construido en las Tasks 1-9.
- Produces: nada que otro task consuma — es la última.

- [ ] **Step 1: Escribir `mcp-server/README.md`**

```md
# mcp-server — AMG OS desde Claude Desktop

Servidor MCP local. Le da a Claude Desktop seis herramientas para operar AMG OS en lenguaje natural,
actuando **con el usuario y el rol reales de quien lo corre** — nunca con una credencial más poderosa
que la suya. Diseño completo: [`docs/superpowers/specs/2026-09-05-mcp-claude-desktop-design.md`](../docs/superpowers/specs/2026-09-05-mcp-claude-desktop-design.md).

## 1. Iniciar sesión (una vez, o cuando el refresh token muera)

En una terminal normal — **no** dentro de Claude Desktop:

```bash
AMG_SUPABASE_URL=https://<tu-proyecto>.supabase.co \
AMG_SUPABASE_ANON_KEY=<la anon key> \
npm run mcp:login -w mcp-server
```

Pide email y contraseña (la contraseña **no** se enmascara en pantalla — ver el comentario en
`src/cli/login.ts`) y escribe la sesión en `~/.amg-mcp/session.json`.

## 2. Registrar el servidor en Claude Desktop

Editá `claude_desktop_config.json` (la ubicación depende del sistema operativo; buscarla en la
documentación de Claude Desktop) y agregá:

```json
{
  "mcpServers": {
    "amg-os": {
      "command": "npx",
      "args": ["tsx", "/ruta/absoluta/al/repo/mcp-server/src/index.ts"],
      "env": {
        "AMG_API_URL": "http://localhost:3000",
        "AMG_SUPABASE_URL": "https://<tu-proyecto>.supabase.co",
        "AMG_SUPABASE_ANON_KEY": "<la anon key>"
      }
    }
  }
}
```

`AMG_API_URL` apunta al `dev-server` local (`npm run dev:server -w api`, puerto `3000`) hasta que el
circuito esté probado de punta a punta. Apuntar a producción es cambiar esa única variable, un paso
aparte y consciente.

Reiniciá Claude Desktop después de editar el archivo.

## 3. Las seis tools

| Tool | Qué hace | Escribe |
| --- | --- | --- |
| `amg_listar_clientes` | Clientes del tenant, con id y nombre — paso previo obligatorio | no |
| `amg_ver_cliente` | Ficha de un cliente | no |
| `amg_listar_runs` | Runs de un cliente o de todo el tenant | no |
| `amg_ver_run` | Brief, páginas propuestas y última decisión de un run | no |
| `amg_ver_informe` | El informe de keyword research | no |
| `amg_aprobar_run` | Aprueba un run — dispara trabajo real, y gasto si el destino es `crear_web` | **sí** |

## 4. Si algo no anda

Ver la tabla de errores en el spec §7 — cada mensaje que devuelve una tool ya dice qué hacer
(`npm run mcp:login`, revisar que el `dev-server` esté corriendo, etc.).

## 5. Desarrollo

```bash
npm test -w mcp-server
npm run typecheck -w mcp-server
```

No importa `db/` ni `api/` como paquetes — solo habla HTTP y GoTrue directo. Ver §1 y §3.1 del spec
para por qué.
```

- [ ] **Step 2: Agregar `mcp-server` a la tabla de `AGENTS.md`**

En `AGENTS.md`, la sección "Quién hace qué" (la tabla con `front`/`revisor`/`pipeline`/`datos`/
`render`), agregar una línea después de la tabla, antes del párrafo "**Cuándo delegar**":

```md
`mcp-server/` no tiene agente de área propio — no encaja en `front`, `datos`, `pipeline` ni `render`
(spec del paquete, §9.2). Hasta que haga falta uno, lo lleva la sesión principal.
```

- [ ] **Step 3: Verificación completa del monorepo**

```bash
npm run verificar
```

Esperado: verde entero, con `mcp-server` contado entre los paquetes (8 ahora, no 7 — el conteo sale
solo de `package.json`, no hay ningún número que actualizar a mano).

- [ ] **Step 4: Commit**

```bash
git add mcp-server/README.md AGENTS.md
git commit -m "mcp-server: README del paquete + nota de dueño en AGENTS.md — v1 completa"
```

- [ ] **Step 5: Lo que queda, y que NINGÚN agente puede hacer solo (anotarlo, no ejecutarlo)**

Esto es manual, fuera del alcance de cualquier sesión de Claude Code, y es el criterio de "terminada"
del spec (§10):

1. Un humano con Claude Desktop instalado registra el servidor (paso 2 del README) contra el
   `dev-server` local.
2. Corre `npm run mcp:login -w mcp-server` de verdad, contra un proyecto real de Supabase.
3. Ejercita las seis tools desde Claude Desktop, **incluida una aprobación real que llegue a la
   base** (`amg_aprobar_run` con `destino: "solo_informe"` para no gastar).
4. Recién entonces, cambiar `AMG_API_URL` a producción es una decisión aparte — no de esta sesión.

Si quien retoma este plan no tiene Claude Desktop a mano, el paquete queda completo e íntegramente
probado por `node:test` igual — lo único que falta es la prueba manual, no código.
