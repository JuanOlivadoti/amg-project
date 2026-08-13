# Módulo de reseñas de Google (Bloque F, fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la fase 1 (solo monitoreo + alerta, sin borrador de IA ni publicación) del módulo
de reseñas de Google: conexión OAuth por cliente, polling periódico contra la Business Profile API
(mock-first), y el tab `/clientes/:id/resenas` del portal mostrando reseñas reales con las 1-3★
destacadas.

**Architecture:** Sin paquete nuevo. `db/` gana una tabla (`resenas_google`), tres columnas en
`clients` y un rol sin login (`app_resenas`) con dos funciones `security definer` que el orquestador
usa para cruzar tenants — mismo molde que el barrido de runs colgados. `orchestrator/` gana una función
Inngest de polling y un `GoogleReviewsProvider` mock/live. `api/` gana los endpoints de conexión OAuth
(con su propio `GoogleOAuthProvider` mock/live) y de lectura de reseñas. `portal/` reemplaza el
placeholder de `cliente-resenas.ts`, que gana el botón "Conectar Google" (visible solo para
`maestro`/`equipo`) y los cuatro estados de la pantalla.

**Tech Stack:** PostgreSQL (PGlite en tests), Hono (`api/`), Inngest (`orchestrator/`), Angular 20
standalone + signals (`portal/`), `node:test` + `node:assert` en todo el backend, Karma en el portal.

## Global Constraints

- **Spec de referencia**, todo lo de abajo lo desarrolla:
  [`docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md`](../specs/2026-08-13-modulo-resenas-google-design.md).
- **Fase 1 únicamente**: sin borrador de IA, sin publicar respuestas, sin WhatsApp/email, sin Pub/Sub.
  Ningún task de este plan agrega ninguna de esas cosas.
- **Mock-first de punta a punta**: ni el polling de reseñas ni el intercambio OAuth llaman a Google de
  verdad en este plan. Las dos superficies (`GoogleReviewsProvider`, `GoogleOAuthProvider`) tienen
  únicamente implementación `mock`; el modo `live` existe como rama que lanza un error explícito
  ("Fase 2 de Bloque F, sin implementar todavía"), no como código a medio escribir.
- **`app_user` nunca puede leer `clients.google_refresh_token`.** Grant por columna: `update` sí,
  `select` no. Solo `app_resenas` (dueño de las funciones `security definer`, ejecutable solo por
  `app_service`) lo lee.
- **ADR-19 intacto**: ni `resenas_google` ni las columnas nuevas de `clients` ganan un solo grant para
  `app_render`.
- **ADR-20** (verbo, no visibilidad): el rol `cliente` puede VER sus reseñas (misma política
  `app.ve_cliente` que ya usan `ideas`/`clients`), pero no puede conectar/desconectar Google ni marcar
  una reseña como vista — eso exige `app.puede_escribir()`, que es `false` para `cliente`.
- **Nombres de dominio en español** (`resenas_google`, `puntuacion`, `autor`, `texto`, `publicada_en`,
  `vista_en`), como el resto del esquema.
- **`Tx`/transacción con conexión reservada** para todo acceso a la base (ADR-13) — ningún `query()`
  suelto.
- Migraciones siguientes libres: **`0021`** y **`0022`** (confirmado: la última es `0020`).

---

### Task 1: Migración `0021` — tabla `resenas_google` + columnas de conexión en `clients`

**Files:**
- Create: `db/migrations/0021_resenas_google.sql`
- Create: `db/src/resenas.ts`
- Create: `db/src/resenas.test.ts`
- Modify: `db/src/index.ts` (exportar `PgResenas` y sus tipos)

**Interfaces:**
- Consumes: `app.ve_cliente(cid uuid)`, `app.puede_escribir()`, `app.current_tenant_id()` (definidas
  en `db/migrations/0001_init.sql`), la tabla `clients (id, tenant_id)`, la clase base `Tx`/`DbPool` de
  `db/src/store.ts` (mismo `withTenant` que usa `PgIdeas`).
- Produces: tabla `resenas_google`; columnas `clients.google_location_id`,
  `clients.google_refresh_token`, `clients.google_conectado_en`; clase
  `PgResenas` con `listarResenas(ctx: TenantContext, clientId: string): Promise<ResenaGoogle[]>` y
  `marcarVista(ctx: TenantContext, clientId: string, resenaId: string): Promise<boolean>`; tipo
  `ResenaGoogle`. Los Tasks 5-7 consumen esta interfaz.

- [ ] **Step 1: Escribir la migración**

```sql
-- =============================================================================
-- AMG OS — 0021: el módulo de reseñas de Google (Bloque F, fase 1) — SOLO lectura de agencia
--
-- Esta migración cubre la mitad "normal" del módulo: la tabla de reseñas bajo RLS igual que
-- `ideas` (0013), y las tres columnas de conexión en `clients`. La mitad cross-tenant (el rol
-- `app_resenas` y sus dos funciones `security definer` que el polling necesita para leer el
-- refresh token de TODOS los clientes conectados) va en la `0022`, separada a propósito: son dos
-- unidades revisables por separado, mismo motivo que `0018` mantiene el barrido en un solo bloque
-- pero ese bloque es autocontenido — acá el equivalente autocontenido es "la tabla + RLS normal"
-- por un lado y "el cruce de tenants" por otro.
--
-- Spec: docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- La conexión: tres columnas en `clients`, mismo patrón que los tokens de Storyblok (0007).
--
-- `google_refresh_token` es lo único de las tres que es una CREDENCIAL (acceso continuo a la
-- cuenta de Google del cliente) y no un dato de negocio. Por eso el grant de más abajo es
-- asimétrico: app_user puede ESCRIBIRLA (el callback de OAuth corre con su identidad) pero no
-- LEERLA de vuelta. Ver el detalle completo del razonamiento en la 0022, que es donde se concede
-- el único SELECT que existe sobre esa columna.
-- -----------------------------------------------------------------------------
alter table clients
  add column if not exists google_location_id   text,
  add column if not exists google_refresh_token  text,
  add column if not exists google_conectado_en   timestamptz;

comment on column clients.google_location_id is
  'El id de la ficha de Google Business Profile del cliente. NULL = no conectado.';
comment on column clients.google_refresh_token is
  'Credencial OAuth de acceso continuo a la cuenta de Google del cliente. app_user puede escribirla '
  '(el callback de OAuth) pero NUNCA leerla de vuelta -- ver los grants por columna de la 0022. Solo '
  'la lee app_resenas, vía una funcion security definer.';
comment on column clients.google_conectado_en is
  'Cuando se completo el flujo de OAuth. NULL = no conectado. Se limpia (junto a las otras dos) si '
  'el polling detecta que el refresh token fue revocado del lado de Google.';

-- -----------------------------------------------------------------------------
-- La tabla. Mismo esqueleto que `ideas` (0013): tenant_id + client_id con FK compuesta, para que
-- un cliente no pueda apuntar a un tenant ajeno.
-- -----------------------------------------------------------------------------
create table resenas_google (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  client_id         uuid not null,

  -- El id de Google, no el nuestro. Es la clave de idempotencia del polling: sin el unique de más
  -- abajo, correr el polling dos veces con la misma reseña la insertaria dos veces.
  google_review_id  text not null,
  puntuacion        smallint not null check (puntuacion between 1 and 5),
  autor             text not null,
  -- Una reseña de solo estrellas, sin comentario, es real en Google Maps -- por eso nullable.
  texto             text,
  -- La fecha que dice GOOGLE, no la del polling: es la que decide el orden real de aparicion.
  publicada_en      timestamptz not null,
  -- NULL = todavia nadie la vio en el portal. Es lo que separa "alerta pendiente" de "ya la vio
  -- alguien", y es lo unico que este modulo permite escribir fuera de la conexion misma.
  vista_en          timestamptz,

  creada_en         timestamptz not null default now(),

  foreign key (tenant_id, client_id) references clients (tenant_id, id) on delete cascade,
  unique (client_id, google_review_id)
);

comment on table resenas_google is
  'Reseñas de Google Business Profile, una fila por reseña real. Material interno de la agencia -- '
  'ADR-19: cero grants para app_render. El rol cliente puede VERLAS (ADR-20) pero no marcarlas '
  'como vistas ni gestionar la conexion.';

create index resenas_google_client_puntuacion
  on resenas_google (client_id, puntuacion, vista_en);

alter table resenas_google enable row level security;
alter table resenas_google force row level security;

-- -----------------------------------------------------------------------------
-- Grants. `app_user` es el único rol con login que toca esta tabla en esta migración
-- (`app_resenas`, cross-tenant, llega en la 0022).
-- -----------------------------------------------------------------------------
grant select                 on resenas_google to app_user;
grant update (vista_en)      on resenas_google to app_user;

-- El refresh token: escribible por app_user (el callback de OAuth), pero SIN select. Location_id y
-- conectado_en sí son legibles -- son lo que el portal necesita para pintar "conectado desde...".
grant select (id, tenant_id, google_location_id, google_conectado_en) on clients to app_user;
grant update (google_location_id, google_refresh_token, google_conectado_en) on clients to app_user;

-- -----------------------------------------------------------------------------
-- Políticas. `to app_user` explícito -- mismo motivo que `idea_select` en la 0013: sin la
-- cláusula `to`, la política aplicaría a PUBLIC y también correría (inútilmente, porque no hay
-- grant de tabla) para `app_resenas`.
-- -----------------------------------------------------------------------------
create policy resena_select on resenas_google
  for select to app_user
  using (app.ve_cliente(client_id));

-- Solo marcar como vista, y solo agencia (ADR-20: el rol cliente no escribe). `using` decide qué
-- filas puede tocar (las suyas, agencia), `with check` que la fila resultante siga siendo del
-- mismo tenant/cliente -- no se puede reasignar una reseña a otro cliente por esta vía.
create policy resena_marcar_vista on resenas_google
  for update to app_user
  using      (app.ve_cliente(client_id) and app.puede_escribir())
  with check (app.ve_cliente(client_id) and app.puede_escribir());
```

- [ ] **Step 2: Correr la migración contra PGlite y confirmar que aplica limpia**

Run: `npm test -w db -- --test-name-pattern="migra"`
Expected: los tests existentes de aplicación de migraciones (que recorren TODO `db/migrations/` en
orden) siguen en verde, incluida la `0021` nueva.

- [ ] **Step 3: Escribir el store `PgResenas` (`db/src/resenas.ts`)**

```ts
import type { DbPool, Tx } from "./store.js";
import { withTenant } from "./store.js";

/** Una fila de `resenas_google`, tal como la ve el portal. */
export interface ResenaGoogle {
  id: string;
  clientId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
  vistaEn: string | null;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
}

const COLS = "id, client_id, puntuacion, autor, texto, publicada_en, vista_en";

function aResena(r: {
  id: string;
  client_id: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicada_en: string;
  vista_en: string | null;
}): ResenaGoogle {
  return {
    id: r.id,
    clientId: r.client_id,
    puntuacion: r.puntuacion,
    autor: r.autor,
    texto: r.texto,
    publicadaEn: r.publicada_en,
    vistaEn: r.vista_en,
  };
}

/**
 * Acceso a `resenas_google` bajo RLS (rol `app_user`). Mismo molde que `PgIdeas`: sin `role` en el
 * constructor porque `app_service` (el orquestador) no tiene ningún grant sobre esta tabla -- lo
 * cross-tenant vive en `PgStore.clientesConectadosGoogle`/`registrarResenaGoogle` (Task 2), no acá.
 *
 * Orden explícito: `puntuacion asc` (1-3★ primero) y dentro de cada bucket, sin ver antes que
 * vistas, y más nueva primero. Es el orden que la spec pide para la pantalla ("1-3★ sin ver
 * primero"), impuesto en SQL y no en el portal -- así ningún consumidor nuevo lo puede pintar en
 * otro orden por accidente.
 */
export class PgResenas {
  constructor(private readonly pool: DbPool) {}

  async listarResenas(ctx: TenantContext, clientId: string): Promise<ResenaGoogle[]> {
    return withTenant(this.pool, ctx, async (tx: Tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(
        `select ${COLS} from resenas_google
         where client_id = $1
         order by (vista_en is not null) asc, puntuacion asc, publicada_en desc`,
        [clientId],
      );
      return rows.map((r) => aResena(r as Parameters<typeof aResena>[0]));
    });
  }

  /** `false` si la reseña no existe o no es de este cliente/tenant -- nunca lanza por eso. */
  async marcarVista(ctx: TenantContext, clientId: string, resenaId: string): Promise<boolean> {
    return withTenant(this.pool, ctx, async (tx: Tx) => {
      const { rowCount } = await tx.query(
        `update resenas_google set vista_en = now()
         where id = $1 and client_id = $2 and vista_en is null`,
        [resenaId, clientId],
      );
      return (rowCount ?? 0) > 0;
    });
  }
}
```

- [ ] **Step 4: Escribir los tests, en rojo primero**

```ts
// db/src/resenas.test.ts
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TestDb } from "./test-helpers.js"; // mismo helper que usa ideas.test.ts
import { PglitePool } from "./pool.js";
import { PgResenas } from "./resenas.js";

let db: TestDb;
let resenas: PgResenas;
let s: { tenantA: string; clientA1: string; clientA2: string; tenantB: string; clientB1: string };

before(async () => {
  db = await TestDb.create();
  s = await seedDosClientesEnDosTenants(db); // helper local, ver ideas.test.ts para el patrón
  resenas = new PgResenas(new PglitePool(db.pglite));
});

async function crearResena(clientId: string, tenantId: string, over: Partial<{
  googleReviewId: string; puntuacion: number; autor: string; texto: string | null;
}> = {}) {
  await db.asService(
    `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, texto, publicada_en)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [tenantId, clientId, over.googleReviewId ?? crypto.randomUUID(), over.puntuacion ?? 5,
     over.autor ?? "Ana", over.texto ?? null],
  );
}

test("🔴 listarResenas devuelve SOLO las del cliente pedido, no las de otro cliente del mismo tenant", async () => {
  await crearResena(s.clientA1, s.tenantA, { autor: "De A1" });
  await crearResena(s.clientA2, s.tenantA, { autor: "De A2" });

  const vistas = await resenas.listarResenas({ tenantId: s.tenantA, userId: "u" }, s.clientA1);

  assert.equal(vistas.length, 1);
  assert.equal(vistas[0]?.autor, "De A1");
});

test("🔴 listarResenas pone las 1-3★ SIN VER antes que el resto, y dentro de eso más nueva primero", async () => {
  await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, autor: "Positiva vieja" });
  await crearResena(s.clientA1, s.tenantA, { puntuacion: 2, autor: "Negativa" });

  const vistas = await resenas.listarResenas({ tenantId: s.tenantA, userId: "u" }, s.clientA1);

  assert.equal(vistas[0]?.autor, "Negativa", "la de 2★ sin ver va primero aunque sea más nueva la otra");
});

test("marcarVista pone vista_en y no se puede repetir sobre una ya vista", async () => {
  await crearResena(s.clientA1, s.tenantA, { googleReviewId: "r1" });
  const [r] = await resenas.listarResenas({ tenantId: s.tenantA, userId: "u" }, s.clientA1);

  const primera = await resenas.marcarVista({ tenantId: s.tenantA, userId: "u" }, s.clientA1, r!.id);
  assert.equal(primera, true);

  const segunda = await resenas.marcarVista({ tenantId: s.tenantA, userId: "u" }, s.clientA1, r!.id);
  assert.equal(segunda, false, "ya estaba vista: el update no afecta filas");
});

test("🔴 marcarVista sobre una reseña de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  await crearResena(s.clientB1, s.tenantB, { googleReviewId: "ajena" });
  const [ajena] = await resenas.listarResenas({ tenantId: s.tenantB, userId: "u" }, s.clientB1);

  const resultado = await resenas.marcarVista({ tenantId: s.tenantA, userId: "u" }, s.clientA1, ajena!.id);
  assert.equal(resultado, false);
});

test("🔴 los grants sobre clients.google_refresh_token son ESCRITURA sin lectura para app_user", async () => {
  const [t] = await db.asService<Record<string, boolean>>(`
    select
      has_column_privilege('app_user', 'clients', 'google_refresh_token', 'select') as puede_leer,
      has_column_privilege('app_user', 'clients', 'google_refresh_token', 'update') as puede_escribir
  `);
  assert.equal(t?.puede_leer, false, "app_user NUNCA puede leer el refresh token de vuelta");
  assert.equal(t?.puede_escribir, true, "pero sí puede escribirlo -- lo hace el callback de OAuth");
});
```

- [ ] **Step 5: Correr los tests y confirmar que fallan por lo esperado (módulo inexistente)**

Run: `npm test -w db -- --test-name-pattern="resenas"`
Expected: FAIL — `Cannot find module './resenas.js'` (todavía no existe `db/src/resenas.ts` en el
build, o falla porque el `seedDosClientesEnDosTenants` local no existe todavía: escribilo calcando
`seed()` de `ideas.test.ts`, con dos tenants en vez de uno).

- [ ] **Step 6: Confirmar que pasan con la migración + el store ya escritos**

Run: `npm test -w db -- --test-name-pattern="resenas"`
Expected: PASS, los 5 tests.

- [ ] **Step 7: Exportar `PgResenas` desde el paquete**

Modify `db/src/index.ts`: agregar `export { PgResenas } from "./resenas.js";` y
`export type { ResenaGoogle } from "./resenas.js";` junto a las exportaciones de `PgIdeas`.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/0021_resenas_google.sql db/src/resenas.ts db/src/resenas.test.ts db/src/index.ts
git commit -m "Feat: tabla resenas_google + conexión de cliente a Google (migración 0021)"
```

---

### Task 2: Migración `0022` — rol `app_resenas` cross-tenant para el polling

**Files:**
- Create: `db/migrations/0022_resenas_google_polling.sql`
- Modify: `db/src/store.ts` (dos métodos nuevos en `PgStore`)
- Modify: `db/src/store.test.ts` (tests de credenciales, mismo archivo que ya testea `app_barrido`)

**Interfaces:**
- Consumes: `PgStore.sinTenant` (privado, ya existe), la tabla `resenas_google` y las columnas de
  `clients` de la Task 1.
- Produces: `PgStore.clientesConectadosGoogle(): Promise<ClienteConectado[]>` y
  `PgStore.registrarResenaGoogle(r: ResenaParaGuardar): Promise<void>`. El Task 4 (polling) consume
  esta interfaz exacta.

- [ ] **Step 1: Escribir la migración, calcando `0018` punto por punto**

```sql
-- =============================================================================
-- AMG OS — 0022: `app_resenas`, el rol cross-tenant del polling de reseñas
--
-- Segunda `security definer` del proyecto (la primera fue `app_barrido`, 0018). Mismo motivo
-- exacto: el polling tiene que leer el refresh token y el location_id de TODOS los clientes
-- conectados de TODOS los tenants, y ninguna sesión con identidad puede hacer eso bajo RLS. Y
-- tiene que insertar reseñas bajo el tenant_id de cada cliente, uno por uno, en la misma corrida.
--
-- Confinar el privilegio a DOS funciones cuyo cuerpo entero es "listar conectados" y "insertar una
-- reseña bajo el tenant que se le pasa" concede algo que no puede filtrar nada más (ninguna de las
-- dos toca `kr_runs`, `ideas`, ni ninguna otra tabla) y no puede hacer otra cosa (los cuerpos son
-- fijos).
--
-- `set search_path = pg_catalog, public` en las dos, por el mismo motivo que 0018: sin eso, una
-- `security definer` es una escalada clásica si alguien puede anteponer un schema propio.
--
-- El dueño de las funciones NO puede ser quien corre la migración -- ver el comentario largo de
-- 0018 para el porqué completo (RLS forzada + `postgres` no-superusuario en Supabase alojado).
-- Esta migración repite la misma secuencia de grants temporales, en el mismo orden.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_resenas') then
    create role app_resenas nologin;
  end if;
end $$;

grant usage on schema public, app to app_resenas;

-- Lectura cross-tenant: SOLO lo que el polling necesita para pedirle reseñas a Google. Ni
-- business_profile, ni storyblok_*, ni ninguna otra columna de `clients`.
grant select (id, tenant_id, google_location_id, google_refresh_token) on clients to app_resenas;

-- Escritura cross-tenant: solo insertar reseñas. Nada de update/delete -- el polling nunca
-- modifica una reseña existente, solo agrega las que todavía no vio.
grant insert on resenas_google to app_resenas;

-- Mismo motivo que la política `run_barrido_ve` de 0018: las políticas de `clients` (0001) no
-- llevan `to`, así que aplican a PUBLIC también para `app_resenas` -- y evaluarlas exige poder
-- leer `memberships`, o la sentencia entera aborta con "permission denied for table memberships".
grant select on memberships to app_resenas;

-- -----------------------------------------------------------------------------
-- Función 1: listar los clientes conectados, de TODOS los tenants.
-- -----------------------------------------------------------------------------
create or replace function app.clientes_conectados_google()
returns table (client_id uuid, tenant_id uuid, location_id text, refresh_token text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select id, tenant_id, google_location_id, google_refresh_token
  from clients
  where google_refresh_token is not null
    and archived_at is null;
$$;

comment on function app.clientes_conectados_google() is
  'Lista, cruzando TODOS los tenants, los clientes con Google conectado. Solo devuelve lo que el '
  'polling necesita para pedir reseñas -- ni business_profile ni ningún otro dato. security '
  'definer y propiedad de app_resenas (no del dueño de la tabla, sujeto a FORCE RLS en producción).';

-- -----------------------------------------------------------------------------
-- Función 2: registrar una reseña, bajo el tenant_id que el LLAMADOR ya conoce (no el que decida
-- el motor). `on conflict do nothing` es la idempotencia: el unique (client_id, google_review_id)
-- de la 0021 es lo que hace que un segundo polling con la misma reseña no falle ni duplique.
-- -----------------------------------------------------------------------------
create or replace function app.registrar_resena_google(
  p_client_id uuid, p_tenant_id uuid, p_google_review_id text,
  p_puntuacion smallint, p_autor text, p_texto text, p_publicada_en timestamptz
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  insertadas int;
begin
  insert into resenas_google
    (tenant_id, client_id, google_review_id, puntuacion, autor, texto, publicada_en)
  values
    (p_tenant_id, p_client_id, p_google_review_id, p_puntuacion, p_autor, p_texto, p_publicada_en)
  on conflict (client_id, google_review_id) do nothing;

  get diagnostics insertadas = row_count;
  return insertadas > 0;
end;
$$;

comment on function app.registrar_resena_google is
  'Inserta una reseña bajo el tenant/cliente que el llamador ya trae (del propio '
  'clientes_conectados_google). Idempotente vía el unique (client_id, google_review_id) de la 0021: '
  'devuelve false si ya existía, sin error. security definer, propiedad de app_resenas.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, idéntico a 0018: dos permisos temporales, revocados al final, en ese orden.
-- -----------------------------------------------------------------------------
grant app_resenas to current_user;
grant create on schema app to app_resenas;

alter function app.clientes_conectados_google() owner to app_resenas;
alter function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  owner to app_resenas;

revoke execute on function app.clientes_conectados_google() from public;
revoke execute on function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  from public;
grant execute on function app.clientes_conectados_google() to app_service;
grant execute on function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  to app_service;

revoke create on schema app from app_resenas;
revoke app_resenas from current_user;
```

- [ ] **Step 2: Correr las migraciones y confirmar que la `0022` aplica limpia sobre la `0021`**

Run: `npm test -w db -- --test-name-pattern="migra"`
Expected: PASS.

- [ ] **Step 3: Agregar los dos métodos a `PgStore` (`db/src/store.ts`)**, justo debajo de
  `expirarRunsColgados`:

```ts
export interface ClienteConectadoGoogle {
  clientId: string;
  tenantId: string;
  locationId: string;
  refreshToken: string;
}

export interface ResenaParaGuardar {
  clientId: string;
  tenantId: string;
  googleReviewId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
}

// ... dentro de la clase PgStore, junto a expirarRunsColgados:

/**
 * Cross-tenant, solo para el polling de reseñas. Ver `app.clientes_conectados_google` en la 0022
 * para por qué esto no se puede hacer con un `select` normal bajo RLS.
 */
async clientesConectadosGoogle(): Promise<ClienteConectadoGoogle[]> {
  return this.sinTenant(async (tx) => {
    const { rows } = await tx.query<{
      client_id: string; tenant_id: string; location_id: string; refresh_token: string;
    }>("select * from app.clientes_conectados_google()");
    return rows.map((r) => ({
      clientId: r.client_id, tenantId: r.tenant_id,
      locationId: r.location_id, refreshToken: r.refresh_token,
    }));
  });
}

/** @returns true si insertó una fila nueva; false si ya existía (idempotencia). */
async registrarResenaGoogle(r: ResenaParaGuardar): Promise<boolean> {
  return this.sinTenant(async (tx) => {
    const { rows } = await tx.query<{ registrar_resena_google: boolean }>(
      "select app.registrar_resena_google($1, $2, $3, $4, $5, $6, $7) as registrar_resena_google",
      [r.clientId, r.tenantId, r.googleReviewId, r.puntuacion, r.autor, r.texto, r.publicadaEn],
    );
    return rows[0]?.registrar_resena_google ?? false;
  });
}
```

- [ ] **Step 4: Tests, en `db/src/store.test.ts`, junto a los que ya testean `app_barrido`**

```ts
test("🔴 credenciales: app_resenas no tiene login concedible (SET) a ningún rol con login", async () => {
  const [row] = await db.asService<{ tiene_set: boolean }>(
    "select pg_has_role('amg_api', 'app_resenas', 'SET') as tiene_set",
  );
  assert.equal(row?.tiene_set, false);
});

test("🔴 credenciales: app_user NO puede ejecutar clientes_conectados_google (42501)", async () => {
  await assert.rejects(
    () => db.asUser("select * from app.clientes_conectados_google()"),
    /permission denied|42501/,
  );
});

test("clientesConectadosGoogle solo devuelve clientes con refresh_token no nulo, de todos los tenants", async () => {
  const s = await seedDosClientesEnDosTenants(db);
  await db.asService("update clients set google_refresh_token = 'tok-a1', google_location_id = 'loc-a1' where id = $1", [s.clientA1]);
  await db.asService("update clients set google_refresh_token = 'tok-b1', google_location_id = 'loc-b1' where id = $1", [s.clientB1]);
  // clientA2 se queda sin conectar.

  const store = new PgStore(new PglitePool(db.pglite), "app_service");
  const conectados = await store.clientesConectadosGoogle();
  const ids = conectados.map((c) => c.clientId);

  assert.ok(ids.includes(s.clientA1) && ids.includes(s.clientB1), "cruza los dos tenants");
  assert.ok(!ids.includes(s.clientA2), "el que no conectó no aparece");
});

test("🔴 registrarResenaGoogle es idempotente: la segunda llamada con el mismo google_review_id no duplica", async () => {
  const s = await seedDosClientesEnDosTenants(db);
  const store = new PgStore(new PglitePool(db.pglite), "app_service");
  const reseña = {
    clientId: s.clientA1, tenantId: s.tenantA, googleReviewId: "gr-1",
    puntuacion: 4, autor: "Ana", texto: "Bien", publicadaEn: new Date().toISOString(),
  };

  const primera = await store.registrarResenaGoogle(reseña);
  const segunda = await store.registrarResenaGoogle(reseña);

  assert.equal(primera, true);
  assert.equal(segunda, false, "ya existía: no se duplica");
  const [{ n }] = await db.asService<{ n: string }>(
    "select count(*)::text as n from resenas_google where google_review_id = 'gr-1'",
  );
  assert.equal(n, "1");
});
```

- [ ] **Step 5: Correr, confirmar rojo → verde**

Run: `npm test -w db -- --test-name-pattern="resenas|barrido"`
Expected: PASS, incluidos los tests preexistentes de `app_barrido` (no deben romperse).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0022_resenas_google_polling.sql db/src/store.ts db/src/store.test.ts
git commit -m "Feat: rol app_resenas cross-tenant para el polling de reseñas (migración 0022)"
```

---

### Task 3: `GoogleReviewsProvider` — interfaz mock/live en `orchestrator/`

**Files:**
- Create: `orchestrator/src/google/provider.ts`
- Create: `orchestrator/src/google/mock-provider.ts`
- Create: `orchestrator/src/google/provider.test.ts`
- Modify: `orchestrator/src/config.ts` (agregar `GOOGLE_REVIEWS_MODO`)
- Modify: `orchestrator/src/config.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: interfaz `GoogleReviewsProvider` con `refrescarToken(refreshToken: string): Promise<string>`
  y `listarResenas(accessToken: string, locationId: string): Promise<ReseñaCruda[]>`; función
  `getGoogleReviewsProvider(): GoogleReviewsProvider`; tipo `ReseñaCruda`. El Task 4 (polling) los
  consume exactamente así.

- [ ] **Step 1: Agregar el modo a la config**, siguiendo el molde de `PIPELINE_MODO`
  (`orchestrator/src/config.ts`):

```ts
export type ModoResenasGoogle = "mock" | "live";
const MODOS_RESENAS_GOOGLE: readonly string[] = ["mock", "live"];

function validarModoResenasGoogle(crudo: string): ModoResenasGoogle {
  if (!MODOS_RESENAS_GOOGLE.includes(crudo)) {
    throw new Error(
      `GOOGLE_REVIEWS_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`live\`.`,
    );
  }
  return crudo as ModoResenasGoogle;
}

// En la función que arma la config final (junto a donde hoy se resuelve `pipeline`):
// Sin acceso real a la Business Profile API todavía (Bloque F, fase 1): sin la variable, el
// default es `mock` -- a diferencia de PIPELINE_MODO, que exige la variable en producción porque
// gasta dinero real. Este módulo no gasta nada mientras sea mock, y `live` ni siquiera está
// implementado (Task 4 lo hace lanzar un error claro) -- exigir la variable sin tener un `live`
// real que ofrecer sería pedirle al desplegador un valor que no puede usar.
const resenasGoogle = process.env["GOOGLE_REVIEWS_MODO"]?.trim()
  ? validarModoResenasGoogle(process.env["GOOGLE_REVIEWS_MODO"].trim())
  : "mock";
```

Exportar `resenasGoogle` como campo `resenasGoogle: ModoResenasGoogle` de `ConfigOrquestador`.

- [ ] **Step 2: Test de la config, en rojo**

```ts
// orchestrator/src/config.test.ts, agregado junto a los tests de PIPELINE_MODO
test("GOOGLE_REVIEWS_MODO por defecto es 'mock' si no está la variable", () => {
  delete process.env["GOOGLE_REVIEWS_MODO"];
  const c = leerConfig({ /* ...lo mínimo que ya arman los otros tests de este archivo */ });
  assert.equal(c.resenasGoogle, "mock");
});

test("🔴 GOOGLE_REVIEWS_MODO con un valor que no es mock/live lanza", () => {
  process.env["GOOGLE_REVIEWS_MODO"] = "produccion";
  assert.throws(() => leerConfig({ /* ... */ }), /GOOGLE_REVIEWS_MODO inválido/);
  delete process.env["GOOGLE_REVIEWS_MODO"];
});
```

- [ ] **Step 3: Correr, confirmar rojo → verde tras el Step 1**

Run: `npm test -w orchestrator -- --test-name-pattern="config"`

- [ ] **Step 4: Escribir la interfaz y el selector (`orchestrator/src/google/provider.ts`)**

```ts
export interface ReseñaCruda {
  googleReviewId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
}

/**
 * Separa el polling de si hay o no credenciales reales de Google -- mismo criterio que
 * `Publisher` en web-builder/src/publish/publisher.ts (mock/dry-run/live).
 */
export interface GoogleReviewsProvider {
  /** Cambia un refresh token por un access token de corta duración. */
  refrescarToken(refreshToken: string): Promise<string>;
  /** Las reseñas de una ubicación, tal como las devuelve la Business Profile API. */
  listarResenas(accessToken: string, locationId: string): Promise<ReseñaCruda[]>;
}

import { config } from "../config.js";
import { MockGoogleReviewsProvider } from "./mock-provider.js";

export function getGoogleReviewsProvider(): GoogleReviewsProvider {
  if (config.resenasGoogle === "mock") return new MockGoogleReviewsProvider();
  // Fase 2 de Bloque F: sin acceso real a la Business Profile API todavía (spec, sección "Mock-first").
  throw new Error(
    "GOOGLE_REVIEWS_MODO=live sin implementación todavía. Bloque F fase 1 es mock-first a propósito " +
      "-- ver docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md.",
  );
}
```

- [ ] **Step 5: Escribir el mock (`orchestrator/src/google/mock-provider.ts`)**

```ts
import type { GoogleReviewsProvider, ReseñaCruda } from "./provider.js";

/**
 * Fixtures fijas y deterministas -- mismo criterio que `MockPublisher`
 * (web-builder/src/publish/mock-publisher.ts): nunca sale a internet, y el `googleReviewId` es
 * estable entre corridas para que el test de idempotencia del polling (Task 4) tenga sentido.
 */
export class MockGoogleReviewsProvider implements GoogleReviewsProvider {
  async refrescarToken(refreshToken: string): Promise<string> {
    if (!refreshToken) throw new Error("refrescarToken: refresh token vacío");
    return `mock-access-token-para-${refreshToken}`;
  }

  async listarResenas(_accessToken: string, locationId: string): Promise<ReseñaCruda[]> {
    return [
      {
        googleReviewId: `mock-${locationId}-1`,
        puntuacion: 2,
        autor: "Cliente Mock Insatisfecho",
        texto: "El servicio tardó mucho.",
        publicadaEn: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        googleReviewId: `mock-${locationId}-2`,
        puntuacion: 5,
        autor: "Cliente Mock Contento",
        texto: "Excelente comida.",
        publicadaEn: new Date().toISOString(),
      },
    ];
  }
}
```

- [ ] **Step 6: Test del provider**

```ts
// orchestrator/src/google/provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockGoogleReviewsProvider } from "./mock-provider.js";

test("MockGoogleReviewsProvider.listarResenas devuelve siempre los mismos googleReviewId para la misma location", async () => {
  const p = new MockGoogleReviewsProvider();
  const primera = await p.listarResenas("tok", "loc-1");
  const segunda = await p.listarResenas("tok", "loc-1");
  assert.deepEqual(primera.map((r) => r.googleReviewId), segunda.map((r) => r.googleReviewId));
});

test("🔴 refrescarToken rechaza un refresh token vacío", async () => {
  const p = new MockGoogleReviewsProvider();
  await assert.rejects(() => p.refrescarToken(""));
});
```

- [ ] **Step 7: Correr todo, confirmar verde**

Run: `npm test -w orchestrator -- --test-name-pattern="google|config"`

- [ ] **Step 8: Commit**

```bash
git add orchestrator/src/google/ orchestrator/src/config.ts orchestrator/src/config.test.ts
git commit -m "Feat: GoogleReviewsProvider mock-first (GOOGLE_REVIEWS_MODO)"
```

---

### Task 4: El polling — función Inngest + wiring en `deps.ts`/`server.ts`

**Files:**
- Modify: `orchestrator/src/functions.ts`
- Modify: `orchestrator/src/workflow.ts` (agregar los dos campos a `Deps`)
- Modify: `orchestrator/src/deps.ts` (cablear `clientesConectadosGoogle`/`registrarResenaGoogle` +
  `getGoogleReviewsProvider`)
- Modify: `orchestrator/src/server.ts` (sumar la función al array)
- Create: `orchestrator/src/functions.test.ts` si no existe ya un archivo de test para
  `barrerRunsColgados`; si existe, agregar ahí.

**Interfaces:**
- Consumes: `PgStore.clientesConectadosGoogle`/`registrarResenaGoogle` (Task 2),
  `getGoogleReviewsProvider` (Task 3).
- Produces: `pollearResenas(deps, log)`, `crearFuncionPollingResenas(deps)`, `CRON_POLLING_RESENAS`.
  Nada de tareas posteriores depende de esto directamente (es el final del camino de datos), pero el
  Task 6 lee lo que esta función escribe.

- [ ] **Step 1: Sumar los dos campos a `Deps` en `orchestrator/src/workflow.ts`**, junto a `store`:

```ts
export interface Deps {
  store: PgStore;
  // ... los campos existentes (research, validarContrato, publicar, log) ...
  resenasProvider: GoogleReviewsProvider;
}
```

- [ ] **Step 2: Escribir `pollearResenas`, calcando `barrerRunsColgados`**

```ts
// orchestrator/src/functions.ts, junto a barrerRunsColgados

export const CRON_POLLING_RESENAS = "*/30 * * * *"; // cada 30 min, a calibrar como CRON_BARRIDO

export async function pollearResenas(
  deps: Pick<Deps, "store" | "resenasProvider">,
  log: (msg: string) => void = () => {},
): Promise<{ clientesRecorridos: number; resenasNuevas: number; fallidos: number }> {
  const clientes = await deps.store.clientesConectadosGoogle();

  let resenasNuevas = 0;
  let fallidos = 0;

  for (const cliente of clientes) {
    try {
      const accessToken = await deps.resenasProvider.refrescarToken(cliente.refreshToken);
      const crudas = await deps.resenasProvider.listarResenas(accessToken, cliente.locationId);

      for (const r of crudas) {
        const insertada = await deps.store.registrarResenaGoogle({
          clientId: cliente.clientId,
          tenantId: cliente.tenantId,
          googleReviewId: r.googleReviewId,
          puntuacion: r.puntuacion,
          autor: r.autor,
          texto: r.texto,
          publicadaEn: r.publicadaEn,
        });
        if (insertada) resenasNuevas++;
      }
    } catch (e) {
      // Un cliente con el token revocado no frena a los demás -- mismo criterio que las tres
      // fuentes independientes del dashboard. Se loguea con el tenant para poder rastrearlo.
      fallidos++;
      log(`[polling-resenas] cliente ${cliente.clientId} (tenant ${cliente.tenantId}) falló: ${(e as Error).message}`);
    }
  }

  log(`[polling-resenas] ${clientes.length} clientes conectados, ${resenasNuevas} reseñas nuevas, ${fallidos} fallidos`);
  return { clientesRecorridos: clientes.length, resenasNuevas, fallidos };
}

export function crearFuncionPollingResenas(deps: Deps) {
  return inngest.createFunction(
    {
      id: "polling-resenas-google",
      concurrency: [{ limit: 1 }],
      retries: 0,
    },
    { cron: CRON_POLLING_RESENAS },
    async ({ step }) => step.run("pollear", () => pollearResenas(deps, console.log)),
  );
}
```

- [ ] **Step 3: Test, calcando el estilo de `barrerRunsColgados` — un cliente falla, los otros no**

```ts
test("🔴 un cliente con refrescarToken que lanza no frena el polling de los demás", async () => {
  const store = {
    clientesConectadosGoogle: async () => [
      { clientId: "c1", tenantId: "t1", locationId: "l1", refreshToken: "malo" },
      { clientId: "c2", tenantId: "t1", locationId: "l2", refreshToken: "bueno" },
    ],
    registrarResenaGoogle: async () => true,
  };
  const provider = {
    refrescarToken: async (tok: string) => {
      if (tok === "malo") throw new Error("revocado");
      return "access-ok";
    },
    listarResenas: async () => [{
      googleReviewId: "r1", puntuacion: 5, autor: "A", texto: null,
      publicadaEn: new Date().toISOString(),
    }],
  };

  const r = await pollearResenas({ store: store as any, resenasProvider: provider as any });

  assert.equal(r.clientesRecorridos, 2);
  assert.equal(r.fallidos, 1);
  assert.equal(r.resenasNuevas, 1, "el cliente bueno igual escribió su reseña");
});
```

- [ ] **Step 4: Correr, confirmar verde**

Run: `npm test -w orchestrator -- --test-name-pattern="polling"`

- [ ] **Step 5: Cablear en `deps.ts`**

```ts
// orchestrator/src/deps.ts, dentro de crearDeps, en el objeto que retorna:
import { getGoogleReviewsProvider } from "./google/provider.js";
// ...
return {
  store,
  research: /* ... existente ... */,
  validarContrato: /* ... existente ... */,
  publicar: /* ... existente ... */,
  resenasProvider: getGoogleReviewsProvider(),
  log: (msg) => console.log(msg),
};
```

- [ ] **Step 6: Registrar la función en `server.ts`**

```ts
// orchestrator/src/server.ts
import { crearFuncionBarrido, crearFuncionPollingResenas, crearFuncionResearch, inngest } from "./functions.js";
// ...
const funciones = [crearFuncionResearch(deps), crearFuncionBarrido(deps), crearFuncionPollingResenas(deps)];
```

Actualizar el comentario que dice "Dos: el workflow del research y el barrido" a "Tres:" y ajustar
cualquier test que afirme `funciones: 2` en `/_health` a `funciones: 3`.

- [ ] **Step 7: Correr la suite completa de `orchestrator/` y confirmar verde**

Run: `npm test -w orchestrator`

- [ ] **Step 8: Commit**

```bash
git add orchestrator/src/functions.ts orchestrator/src/workflow.ts orchestrator/src/deps.ts orchestrator/src/server.ts orchestrator/src/functions.test.ts
git commit -m "Feat: polling de reseñas de Google, función Inngest programada"
```

---

### Task 5: API — conexión OAuth (`conectar` / `callback` / `desconectar`)

**Files:**
- Create: `api/src/google-oauth.ts`
- Create: `api/src/google-oauth.test.ts`
- Modify: `api/src/app.ts` (tres endpoints nuevos + `resenas: PgResenas` en `ApiDeps` para el Task 6)
- Modify: `api/src/app.test.ts`

**Interfaces:**
- Consumes: `ApiDeps` existente (`api/src/app.ts:27-49`), `autenticar`/`c.get("ctx")`
  (`api/src/auth.ts`), `app.puede_escribir` reflejado en el store (vía RLS: si el rol es `cliente`,
  el `update` de las columnas de conexión simplemente no afecta filas — mismo criterio que
  `marcarVista`).
- Produces: `POST /clients/:id/google/conectar`, `GET /clients/:id/google/callback`,
  `POST /clients/:id/google/desconectar`.

- [ ] **Step 1: `GoogleOAuthProvider` mock/live, mismo molde que `GoogleReviewsProvider`**

```ts
// api/src/google-oauth.ts
export interface GoogleOAuthProvider {
  /**
   * La URL a la que el portal redirige para que Google pida consentimiento.
   * `callbackBaseUrl` es el origen de ESTA API (`new URL(c.req.url).origin`, se lo pasa el
   * endpoint) -- en `live` se ignora, porque el `redirect_uri` real está fijado en la config de
   * Google Cloud, no en cada request; en `mock` es lo que permite simular el redirect SIN un sitio
   * externo real, apuntando al propio callback.
   */
  urlDeConsentimiento(clientId: string, state: string, callbackBaseUrl: string): string;
  /** Intercambia el `code` del callback por un refresh token. */
  intercambiarCode(code: string): Promise<{ refreshToken: string; locationId: string }>;
}

export class MockGoogleOAuthProvider implements GoogleOAuthProvider {
  urlDeConsentimiento(clientId: string, state: string, callbackBaseUrl: string): string {
    // No hay pantalla real de Google en mock: en vez de inventar una pantalla de consentimiento
    // falsa, la "url de consentimiento" apunta DIRECTO al propio callback de esta API, con un code
    // fijo -- mismo espíritu que MockPublisher (nunca sale del proceso), y ejercita el mismo tramo
    // de código que el modo live (navegación del navegador -> callback -> redirect al portal).
    const params = new URLSearchParams({ code: "mock-code", state });
    return `${callbackBaseUrl}/clients/${encodeURIComponent(clientId)}/google/callback?${params.toString()}`;
  }

  async intercambiarCode(code: string): Promise<{ refreshToken: string; locationId: string }> {
    if (!code) throw new Error("intercambiarCode: code vacío");
    return { refreshToken: `mock-refresh-${code}`, locationId: `mock-location-${code}` };
  }
}

export function getGoogleOAuthProvider(modo: "mock" | "live"): GoogleOAuthProvider {
  if (modo === "mock") return new MockGoogleOAuthProvider();
  throw new Error(
    "GOOGLE_REVIEWS_MODO=live sin implementación todavía (Bloque F fase 1 es mock-first).",
  );
}
```

- [ ] **Step 2: Test del provider mock**

```ts
// api/src/google-oauth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockGoogleOAuthProvider } from "./google-oauth.js";

test("intercambiarCode devuelve un refreshToken y locationId derivados del code", async () => {
  const p = new MockGoogleOAuthProvider();
  const r = await p.intercambiarCode("abc123");
  assert.equal(r.refreshToken, "mock-refresh-abc123");
});

test("🔴 intercambiarCode rechaza un code vacío", async () => {
  const p = new MockGoogleOAuthProvider();
  await assert.rejects(() => p.intercambiarCode(""));
});
```

Run: `npm test -w api -- --test-name-pattern="google-oauth"` → verde.

- [ ] **Step 3: Sumar `resenas: PgResenas` y `googleOAuth: GoogleOAuthProvider` a `ApiDeps`**

```ts
// api/src/app.ts, en la interfaz ApiDeps (junto a ideas: PgIdeas)
resenas: PgResenas;
googleOAuth: GoogleOAuthProvider;
```

- [ ] **Step 4: Los tres endpoints**, siguiendo el molde exacto de los endpoints de `ideas`
  (validación en el borde, `ctx` desde `c.get("ctx")`, códigos HTTP explícitos):

```ts
// api/src/app.ts

app.post("/clients/:id/google/conectar", async (c) => {
  const clientId = c.req.param("id");
  // El `state` ata el callback al cliente correcto -- sin esto, dos conexiones en simultáneo
  // (dos pestañas, dos clientes) podrían escribir el token del uno en la fila del otro.
  const state = Buffer.from(JSON.stringify({ clientId, nonce: crypto.randomUUID() })).toString("base64url");
  // El origen de ESTA request, no un valor fijo: en dev la API vive en :3000, en producción en su
  // propio dominio -- `urlDeConsentimiento` (mock) lo necesita para armar un callback absoluto.
  const origen = new URL(c.req.url).origin;
  return c.json({ url: deps.googleOAuth.urlDeConsentimiento(clientId, state, origen) });
});

app.get("/clients/:id/google/callback", async (c) => {
  const ctx = c.get("ctx");
  const clientId = c.req.param("id");
  const code = c.req.query("code");
  const stateCrudo = c.req.query("state");

  if (!code || !stateCrudo) {
    return c.json({ error: "Falta code o state en el callback de Google." }, 400);
  }

  let state: { clientId: string };
  try {
    state = JSON.parse(Buffer.from(stateCrudo, "base64url").toString("utf8"));
  } catch {
    return c.json({ error: "state inválido." }, 400);
  }
  if (state.clientId !== clientId) {
    return c.json({ error: "El state no corresponde a este cliente." }, 400);
  }

  const { refreshToken, locationId } = await deps.googleOAuth.intercambiarCode(code);

  const ok = await deps.resenas.conectarGoogle(ctx, clientId, { refreshToken, locationId });
  if (!ok) return c.json({ error: "Cliente no encontrado o sin permiso para conectar." }, 404);

  // Este endpoint lo pega el NAVEGADOR (window.location.href de cliente-resenas.ts), no un
  // fetch del portal -- así que la respuesta tiene que ser un redirect real de vuelta al tab, no
  // JSON. `deps.portalUrl` es el único dato nuevo de config que este task agrega a `ApiDeps`
  // (junto a `corsOrigins`, que ya existe): el origen del portal, para saber a dónde volver.
  return c.redirect(`${deps.portalUrl}/clientes/${clientId}/resenas`);
});

app.post("/clients/:id/google/desconectar", async (c) => {
  const ctx = c.get("ctx");
  const clientId = c.req.param("id");
  const ok = await deps.resenas.desconectarGoogle(ctx, clientId);
  if (!ok) return c.json({ error: "Cliente no encontrado o sin permiso para desconectar." }, 404);
  return c.json({ ok: true });
});
```

**`ApiDeps` gana `portalUrl: string`** (junto a `resenas`/`googleOAuth` del Step 3 de arriba), leído
del mismo lugar que hoy arma `corsOrigins` al construir `createApp()` — el origen del portal ya es un
dato que el proceso de la API conoce (es contra quien abre CORS), así que no es una variable de
entorno nueva conceptualmente distinta, es la misma que hoy se usa para `corsOrigins` pasada también
como `portalUrl` (si `corsOrigins` es un array, tomar el primer elemento; documentar esa elección con
un comentario en el sitio donde se arma `ApiDeps`, sea `api/src/server.ts` o el `dev-server.ts`).

**Nota de implementación**: esto exige agregar `conectarGoogle`/`desconectarGoogle` a `PgResenas`
(Task 1), con la misma forma que `marcarVista` (`update ... where id = $1 returning`, bajo RLS,
`false` si no afecta filas — el `update` de `google_refresh_token`/`google_location_id`/
`google_conectado_en` ya tiene grant para `app_user` desde el Task 1, y la política implícita de
`clients` ya exige `app.puede_escribir()` para escribir, así que el rol `cliente` no puede conectar
ni desconectar sin que haga falta código nuevo de autorización). Agregalo como parte de este step:

```ts
// db/src/resenas.ts — agregar a PgResenas
async conectarGoogle(
  ctx: TenantContext, clientId: string,
  datos: { refreshToken: string; locationId: string },
): Promise<boolean> {
  return withTenant(this.pool, ctx, async (tx: Tx) => {
    const { rowCount } = await tx.query(
      `update clients set google_refresh_token = $1, google_location_id = $2, google_conectado_en = now()
       where id = $3`,
      [datos.refreshToken, datos.locationId, clientId],
    );
    return (rowCount ?? 0) > 0;
  });
}

async desconectarGoogle(ctx: TenantContext, clientId: string): Promise<boolean> {
  return withTenant(this.pool, ctx, async (tx: Tx) => {
    const { rowCount } = await tx.query(
      `update clients set google_refresh_token = null, google_location_id = null, google_conectado_en = null
       where id = $1`,
      [clientId],
    );
    return (rowCount ?? 0) > 0;
  });
}
```

- [ ] **Step 5: Tests de los tres endpoints, mismo estilo que `api/src/ideas.test.ts`**

```ts
test("POST /clients/:id/google/conectar devuelve una URL absoluta que apunta al propio callback (mock)", async () => {
  const res = await req("POST", `/clients/${clienteA}/google/conectar`, { user: equipoA, tenant: tenantA });
  const body = (await res.json()) as { url: string };
  assert.ok(body.url.includes(`/clients/${clienteA}/google/callback`));
  assert.ok(body.url.includes("code=mock-code"));
});

test("GET /clients/:id/google/callback con state de OTRO cliente → 400, no escribe nada", async () => {
  const stateAjeno = Buffer.from(JSON.stringify({ clientId: "otro-cliente" })).toString("base64url");
  const res = await req("GET", `/clients/${clienteA}/google/callback?code=abc&state=${stateAjeno}`, {
    user: equipoA, tenant: tenantA,
  });
  assert.equal(res.status, 400);
});

test("🔴 el flujo completo conecta (redirect 302 de vuelta al tab) y desconectar limpia las tres columnas", async () => {
  const state = Buffer.from(JSON.stringify({ clientId: clienteA })).toString("base64url");
  const conectar = await req("GET", `/clients/${clienteA}/google/callback?code=xyz&state=${state}`, {
    user: equipoA, tenant: tenantA, redirect: "manual",
  });
  assert.equal(conectar.status, 302);
  assert.ok(conectar.headers.get("location")?.includes(`/clientes/${clienteA}/resenas`));

  const desconectar = await req("POST", `/clients/${clienteA}/google/desconectar`, {
    user: equipoA, tenant: tenantA,
  });
  assert.equal(desconectar.status, 200);
});

test("🔴 con rol 'cliente', desconectar no afecta ninguna fila (ADR-20: solo lee)", async () => {
  const res = await req("POST", `/clients/${clienteA}/google/desconectar`, {
    user: duenoDeA, tenant: tenantA, rol: "cliente",
  });
  assert.equal(res.status, 404, "el update de RLS no afectó filas: el endpoint lo reporta como no encontrado");
});
```

- [ ] **Step 6: Correr, confirmar verde**

Run: `npm test -w api -- --test-name-pattern="google"`

- [ ] **Step 7: Commit**

```bash
git add api/src/google-oauth.ts api/src/google-oauth.test.ts api/src/app.ts api/src/app.test.ts db/src/resenas.ts db/src/resenas.test.ts
git commit -m "Feat: endpoints de conexión OAuth con Google (conectar/callback/desconectar)"
```

---

### Task 6: API — listar reseñas y marcar como vista

**Files:**
- Modify: `api/src/app.ts`
- Modify: `api/src/app.test.ts`

**Interfaces:**
- Consumes: `PgResenas.listarResenas`/`marcarVista` (Task 1), `ApiDeps.resenas` (Task 5).
- Produces: `GET /clients/:id/resenas`, `PATCH /clients/:id/resenas/:resenaId`. El Task 7 (portal)
  consume esta forma exacta.

- [ ] **Step 1: Los dos endpoints**

```ts
// api/src/app.ts

app.get("/clients/:id/resenas", async (c) => {
  const ctx = c.get("ctx");
  const clientId = c.req.param("id");
  const resenas = await deps.resenas.listarResenas(ctx, clientId);
  return c.json({ resenas });
});

app.patch("/clients/:id/resenas/:resenaId", async (c) => {
  const ctx = c.get("ctx");
  const clientId = c.req.param("id");
  const resenaId = c.req.param("resenaId");
  const body = await c.req.json().catch(() => null);

  if (!body || body["vista"] !== true) {
    return c.json({ error: 'El único cambio soportado es {"vista": true}.' }, 400);
  }

  const ok = await deps.resenas.marcarVista(ctx, clientId, resenaId);
  if (!ok) return c.json({ error: "Reseña no encontrada, ya vista, o sin permiso." }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Tests**

```ts
test("GET /clients/:id/resenas devuelve solo las del cliente, ordenadas 1-3★ sin ver primero", async () => {
  await sembrarResena(clienteA, { puntuacion: 5, googleReviewId: "buena" });
  await sembrarResena(clienteA, { puntuacion: 2, googleReviewId: "mala" });

  const res = await req("GET", `/clients/${clienteA}/resenas`, { user: equipoA, tenant: tenantA });
  const body = (await res.json()) as { resenas: Array<{ id: string; puntuacion: number }> };

  assert.equal(body.resenas[0]?.puntuacion, 2, "la de 2★ sin ver va primero");
});

test("🔴 GET /clients/:id/resenas de OTRO tenant devuelve lista vacía, no un error (RLS)", async () => {
  const res = await req("GET", `/clients/${clienteDeOtroTenant}/resenas`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { resenas: unknown[] };
  assert.deepEqual(body.resenas, []);
});

test("PATCH .../resenas/:id marca vista=true y una segunda vez da 404", async () => {
  const [r] = await sembrarResena(clienteA, { googleReviewId: "r-marcar" });
  const primera = await req("PATCH", `/clients/${clienteA}/resenas/${r.id}`, {
    user: equipoA, tenant: tenantA, body: { vista: true },
  });
  assert.equal(primera.status, 200);

  const segunda = await req("PATCH", `/clients/${clienteA}/resenas/${r.id}`, {
    user: equipoA, tenant: tenantA, body: { vista: true },
  });
  assert.equal(segunda.status, 404);
});

test("🔴 con rol 'cliente', PATCH .../resenas/:id da 404 (ADR-20: solo lee)", async () => {
  const [r] = await sembrarResena(clienteA, { googleReviewId: "r-solo-lectura" });
  const res = await req("PATCH", `/clients/${clienteA}/resenas/${r.id}`, {
    user: duenoDeA, tenant: tenantA, rol: "cliente", body: { vista: true },
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 3: Correr toda la suite de `api/`**

Run: `npm test -w api`
Expected: PASS entero, sin regresiones en los tests de `ideas`/`clients` existentes.

- [ ] **Step 4: Commit**

```bash
git add api/src/app.ts api/src/app.test.ts
git commit -m "Feat: GET/PATCH de reseñas por cliente"
```

---

### Task 7: Portal — `cliente-resenas.ts` real (los cuatro estados)

**Files:**
- Modify: `portal/src/app/core/api-core.ts`
- Modify: `portal/src/app/core/models.ts` (tipo `ResenaGoogle`, si `models.ts` es donde viven los
  demás tipos de dominio del portal — confirmar con `IdeaResumen` como referencia)
- Modify: `portal/src/app/pages/clientes/cliente-resenas.ts` (deja de ser placeholder)
- Create: `portal/src/app/pages/clientes/cliente-resenas.spec.ts`
- Modify: `portal/src/app/services/api.ts` (exponer los métodos nuevos, mismo patrón que
  `listarTodasLasIdeas`)

**Interfaces:**
- Consumes: `GET /clients/:id/resenas`, `PATCH /clients/:id/resenas/:resenaId` (Task 6),
  `MembresiaService.esEquipo` (`portal/src/app/services/membresia.ts:64`).
- Produces: `ClienteApi.listarResenas(clientId): Promise<ResenaGoogle[]>`,
  `ClienteApi.marcarResenaVista(clientId, resenaId): Promise<void>`. El Task 8 (botón "Conectar
  Google") comparte este mismo `api-core.ts`.

- [ ] **Step 1: Tipo `ResenaGoogle` en `portal/src/app/core/models.ts`**

```ts
export interface ResenaGoogle {
  id: string;
  clientId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
  vistaEn: string | null;
}
```

- [ ] **Step 2: Métodos en `api-core.ts`**, mismo molde que `listarIdeas`/`cambiarEstadoIdea`

```ts
// interfaz ClienteApi
listarResenas(clientId: string): Promise<ResenaGoogle[]>;
marcarResenaVista(clientId: string, resenaId: string): Promise<void>;
conectarGoogle(clientId: string): Promise<{ url: string }>;
desconectarGoogle(clientId: string): Promise<void>;
googleConectado(clientId: string): Promise<boolean>;

// implementación
async listarResenas(clientId) {
  const { resenas } = await pedir<{ resenas: ResenaGoogle[] }>(
    'GET', `/clients/${encodeURIComponent(clientId)}/resenas`,
  );
  return resenas;
},
async marcarResenaVista(clientId, resenaId) {
  await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`, { vista: true });
},
async conectarGoogle(clientId) {
  return pedir<{ url: string }>('POST', `/clients/${encodeURIComponent(clientId)}/google/conectar`);
},
async desconectarGoogle(clientId) {
  await pedir('POST', `/clients/${encodeURIComponent(clientId)}/google/desconectar`);
},
async googleConectado(clientId) {
  // Reutiliza GET /clients/:id (ya existente) leyendo la columna que sí es legible para app_user.
  const { client } = await pedir<{ client: { googleConectadoEn: string | null } }>(
    'GET', `/clients/${encodeURIComponent(clientId)}`,
  );
  return client.googleConectadoEn !== null;
},
```

**Nota**: `googleConectado` asume que `GET /clients/:id` ya devuelve `googleConectadoEn` en su
serialización — si el endpoint existente en `api/src/app.ts` serializa el cliente con una lista fija
de campos, sumar `google_conectado_en` (como `googleConectadoEn`) a esa lista es parte de este step
(ubicar la función `serializarCliente` o equivalente y agregar el campo, con su test correspondiente
de que el campo viaja).

- [ ] **Step 3: Exponer en `portal/src/app/services/api.ts`**, mismo patrón que
  `listarTodasLasIdeas`:

```ts
readonly listarResenas = this.cliente.listarResenas;
readonly marcarResenaVista = this.cliente.marcarResenaVista;
readonly conectarGoogle = this.cliente.conectarGoogle;
readonly desconectarGoogle = this.cliente.desconectarGoogle;
readonly googleConectado = this.cliente.googleConectado;
```

- [ ] **Step 4: `cliente-resenas.ts` real**, calcando la estructura de `cliente-ideas.ts` (signals
  `cargando`/`error`/lista, `Vigencia` para la carrera de `:id`, filtro de query param NO aplica
  acá):

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { ResenaGoogle } from '../../core/models';

@Component({
  selector: 'app-cliente-resenas',
  template: `
    <div class="space-y-4">
      <h1 class="text-sm font-semibold text-texto">Reseñas de Google</h1>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando reseñas…</p>
      } @else if (error()) {
        <div class="bg-error-suave rounded-xl border border-borde p-6">
          <p class="text-sm text-error">{{ error() }}</p>
        </div>
      } @else if (!conectado()) {
        <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
          <p class="text-sm text-texto-tenue">Este cliente todavía no conectó su Google Business Profile.</p>
          @if (membresia.esEquipo()) {
            <button
              (click)="conectar()"
              class="mt-4 rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Conectar Google
            </button>
          }
        </div>
      } @else if (resenas().length === 0) {
        <p class="text-sm text-texto-tenue">Todavía no hay reseñas.</p>
      } @else {
        <ul class="space-y-3">
          @for (r of resenas(); track r.id) {
            <li
              class="bg-superficie rounded-xl border border-borde p-4"
              [class.border-error]="r.puntuacion <= 3 && !r.vistaEn"
              (click)="verla(r)"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-texto">{{ r.autor }} — {{ r.puntuacion }}★</span>
                @if (!r.vistaEn) {
                  <span class="text-xs text-error">sin ver</span>
                }
              </div>
              @if (r.texto) {
                <p class="mt-1 text-sm text-texto-medio">{{ r.texto }}</p>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ClienteResenasPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  readonly membresia = inject(MembresiaService);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly conectado = signal(false);
  readonly resenas = signal<ResenaGoogle[]>([]);

  private clientId = '';

  constructor() {
    this.ruta.parent!.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) return;
      this.clientId = id;
      await this.cargar();
    });
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const conectado = await this.api.googleConectado(this.clientId);
      this.conectado.set(conectado);
      if (conectado) {
        this.resenas.set(await this.api.listarResenas(this.clientId));
      }
    } catch {
      this.error.set('No se pudieron cargar las reseñas.');
    } finally {
      this.cargando.set(false);
    }
  }

  async conectar(): Promise<void> {
    const { url } = await this.api.conectarGoogle(this.clientId);
    window.location.href = url;
  }

  async verla(r: ResenaGoogle): Promise<void> {
    if (r.vistaEn) return;
    await this.api.marcarResenaVista(this.clientId, r.id);
    this.resenas.update((rs) => rs.map((x) => (x.id === r.id ? { ...x, vistaEn: new Date().toISOString() } : x)));
  }
}
```

- [ ] **Step 5: Spec, calcando `cliente-ideas.spec.ts`** (TestBed sin host, `paramMap` como
  `BehaviorSubject`, mocks de `ApiService`):

```ts
// portal/src/app/pages/clientes/cliente-resenas.spec.ts
describe('ClienteResenasPage', () => {
  it('sin conectar: muestra el CTA de conectar solo si esEquipo', async () => { /* ... */ });
  it('conectado sin reseñas: mensaje vacío, no error', async () => { /* ... */ });
  it('con reseñas: la 1-3★ sin ver aparece primero y marcada', async () => { /* ... */ });
  it('al hacer click en una sin ver, llama marcarResenaVista y la actualiza local', async () => { /* ... */ });
  it('si googleConectado rechaza, muestra el estado de error', async () => { /* ... */ });
});
```

(Completar cada `it` con el mismo patrón de montaje que `cliente-ideas.spec.ts` — `TestBed`, spies
de `ApiService`, `fixture.whenStable()`.)

- [ ] **Step 6: Correr**

Run: `npm --prefix portal run test:components -- --single-run`
Expected: verde, sin romper los specs existentes de `cliente-ideas`.

- [ ] **Step 7: Commit**

```bash
git add portal/src/app/core/api-core.ts portal/src/app/core/models.ts portal/src/app/services/api.ts portal/src/app/pages/clientes/cliente-resenas.ts portal/src/app/pages/clientes/cliente-resenas.spec.ts
git commit -m "Feat: el tab de reseñas deja de ser placeholder, lista reseñas reales"
```

---

### Task 8: Cierre — verificación de punta a punta y documentación

**El botón "Conectar Google" ya quedó resuelto en el Task 7**: vive DENTRO de `cliente-resenas.ts`
(no en el header de `cliente-ficha.ts`) porque es una acción específica de ESE tab, no un estado
global del cliente que otros tabs necesiten — mismo criterio que el resto de los botones
condicionados por rol del portal (ej. "Lanzar research" vive en `cliente-research.ts`, no en el
shell). Este task es puramente el cierre: nada de código nuevo, solo verificación y documentación.

**Files:**
- Modify: `docs/proyecto/09-estado-y-roadmap.md`
- Modify: `docs/proyecto/15-plan-plataforma.md` (Bloque F)
- Modify: `progress/history.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada — es el cierre.

- [ ] **Step 1: Confirmar en el navegador el recorrido completo** (mock-first, sin credenciales):

```bash
npm run dev:server -w api
npm --prefix portal start
```

Recorrido: abrir un cliente sin conectar → ver el CTA (con rol `equipo`) → click "Conectar Google" →
el mock redirige y vuelve → el tab pasa a mostrar reseñas del mock → la de 2★ aparece arriba y sin
ver → click → pasa a "vista" → refrescar la página → sigue vista. Repetir con rol `cliente`: ve las
reseñas, no ve el botón de conectar, y un intento directo de `PATCH` (si se prueba a mano) da 404.

- [ ] **Step 2: Correr la verificación completa del monorepo**

Run: `npm run verificar -- --con-portal`
Expected: exit 0, entorno/arnés/secretos/typecheck/tests verdes, incluidos los nuevos.

- [ ] **Step 3: Actualizar la documentación** (ritual de `AGENTS.md`, paso 3): el Bloque F en
  `15-plan-plataforma.md` deja de decir "sin ni una línea de código ni spec" y pasa a describir la
  fase 1 cerrada, con la fase 2 (borrador IA + publicar) anotada como lo que sigue. `09` suma el
  bloque de cifras de tests nuevas. `progress/history.md` suma la entrada del día.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "Feat: cierre del Bloque F fase 1 — módulo de reseñas de Google completo, mock-first"
```

---

## Verificación de punta a punta (para el `revisor` / la revisión final de rama)

- RLS: cliente A nunca ve reseñas ni columnas de conexión de cliente B (Task 1, 6).
- Credenciales: `app_resenas` sin login concedible; `app_user` no puede ejecutar las dos funciones
  cross-tenant ni leer `google_refresh_token` (Task 1, 2).
- Idempotencia del polling, con mutación (Task 2, 4).
- Un cliente con token inválido no frena a los demás, con mutación (Task 4).
- ADR-20: el rol `cliente` ve pero no conecta/desconecta/marca-vista, en los tres endpoints (Task
  5, 6).
- ADR-19: `resenas_google` y las columnas de `clients` no ganan ningún grant para `app_render`
  (confirmable con el mismo estilo de test que ya usa `ideas` para probar la ausencia).
- Los cuatro estados del tab, verificados en navegador (Task 8).
