# Desacoplar keyword research de creación de webs — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partir `workflowResearch` en dos funciones Inngest independientes (research y decisión),
introducir la tabla `kr_run_decisiones` con destino elegido al aprobar (`crear_web` / `solo_informe`
/ `crear_posts` rechazado), habilitar retomar un run cerrado en `solo_informe` hacia `crear_web`, y
retirar el mecanismo `RUN_SIN_WORKFLOW` que ya no describe la arquitectura nueva.

**Architecture:** `crearFuncionResearch` queda recortada (research → persistencia → `pending_approval`,
sin esperar nada). `crearFuncionDecision`, nueva, se dispara por `research/aprobado` (que ya no lleva
el destino — solo `tenantId`+`decisionId`) y relee la autoridad real de `kr_run_decisiones` bajo RLS
antes de bifurcar. La carrera de doble aprobación se cierra con un índice único parcial en Postgres,
no con lógica de aplicación. No hay timeout automático nuevo: la razón operativa del viejo (liberar
una ejecución dormida) desaparece con el desacople.

**Tech Stack:** TypeScript ESM strict, `node:test`/`node:assert`, PGlite (Postgres real en WASM) para
los tests de seguridad, Inngest para orquestación durable, Angular/Karma para el portal.

**Documento de referencia:** [`docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`](../specs/2026-08-26-desacoplar-kr-web-design.md)
— spec revisado por Codex (12 hallazgos, todos aplicados).

## Global Constraints

- **Un evento no porta autoridad — ni el destino.** `research/aprobado` lleva `{ tenantId,
  decisionId, aprobadoPor? }`, nunca `destino`. Todo lo que decide `workflowDecision` se relee de
  `kr_run_decisiones` bajo RLS. Violar esto fue el hallazgo Critical #2 de la ronda de Codex sobre
  el spec.
- **La carrera de doble decisión se cierra en Postgres**, con el índice único parcial
  `kr_run_decisiones_una_pendiente` — nunca con un `insert...select...where` sin más, que no
  serializa nada bajo `READ COMMITTED` (Critical #3).
- **`kr_runs.status` no gana valores nuevos.** `'approved'` pasa a significar "se tomó al menos una
  decisión", no "se publicó". El destino real y su resultado viven en `kr_run_decisiones`.
- **No hay timeout automático nuevo, y no se toca el barrido de runs colgados** (`app_barrido`,
  `0018_barrido_runs_colgados.sql`) — sigue protegiendo solo la fase `running`, ajena a este cambio.
- **`RunSinWorkflowError`/`RUN_SIN_WORKFLOW` se retiran** (decisión #6 del spec, confirmada por el
  usuario) — coordinado entre `db/`, `api/` y `portal/` en la misma tanda de tasks; no puede quedar
  un lado actualizado y el otro no.
- **`solicitud_emitida_at` no se borra** — la API la sigue escribiendo (sin cambios en
  `api/src/solicitar.ts`), queda como dato histórico, deja de condicionar la aprobación.
- **`crear_posts` existe en el enum de datos (`destino_run`) pero la API lo rechaza con 501** antes
  de tocar la base — nunca un `CHECK` que lo excluya del tipo (eso violaría la decisión #2 del spec:
  es un destino reconocido para el sub-proyecto 3 futuro).
- **"Al menos una página aprobada" (ADR-06, compuerta doble) se exige SOLO para `crear_web`**, dentro
  del `WHERE` de `registrarDecision` — `solo_informe` no lo necesita (el informe ya existe desde el
  research, sin depender de páginas aprobadas). Confirmado con el usuario durante la ronda de Codex
  sobre el plan; no estaba en el spec original.
- **La carrera de doble decisión se cierra con `ON CONFLICT ... DO NOTHING`**, no dejando que el
  índice único parcial lance una excepción `23505` sin manejar — eso terminaría en 500, no en el 409
  prometido (Major #2 de la ronda de Codex sobre el plan).
- **Todas las tablas de este proyecto van sin prefijo de schema** (`kr_runs`, `tenants`, la nueva
  `kr_run_decisiones`) — solo las funciones helper (`app.current_tenant_id()`, `app.ve_cliente()`)
  viven en el schema `app`.
- **Nombres de dominio en español**, TDD (rojo → verde → mutación donde aplique), sin builds
  (`tsx`), tests con `node:test`/`node:assert` en el monorepo y Karma/Jasmine en `portal/`.

> **Nota AMG OS — a quién delegar:** las tasks 1-4 y 12 (parcial) son de `datos` (db/api RLS); 5-8
> son de `pipeline` (orchestrator); 9-10 son compartidas `datos`/`pipeline` (codigos.ts, app.ts); 11
> es de `front` (portal). Después de cada task, pasa el `revisor`.

---

### Task 1: Migración `0027_kr_run_decisiones.sql`

> **Confirmado en la revisión conjunta de los tres sub-proyectos (2026-08-26): este sub-proyecto se
> implementa PRIMERO** — tanto el sub-proyecto 1 (multi-vertical) como el 3 (posts en blog externo)
> dependen de código que este plan introduce (`workflowDecision`). `0027` es el número real siempre que
> se respete ese orden — igual, correr `ls db/migrations | tail -3` antes de crear el archivo, por las
> dudas.

**Files:**
- Create: `db/migrations/0027_kr_run_decisiones.sql`
- Create: `db/src/kr-decisiones.test.ts`

**Interfaces:**
- Produce: la tabla `kr_run_decisiones` (columnas `id, run_id, tenant_id, client_id, destino,
  decidido_por, decidido_en, resultado, detalle_error, completado_en`), el enum `destino_run`
  (`'crear_web' | 'solo_informe' | 'crear_posts'`), el índice único parcial
  `kr_run_decisiones_una_pendiente`, las políticas `decision_select`/`decision_write`, y los grants
  a `app_user`/`app_service`. Las Tasks 2-3 escriben SQL contra esta tabla.

- [ ] **Step 1: Escribir el test que falla (la tabla no existe todavía)**

```ts
// db/src/kr-decisiones.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./testdb.js"; // mismo helper que usa store.test.ts para levantar PGlite migrada
import { ctxA, tenantA, clientA1 } from "./fixtures.js"; // ajustar al nombre real de los fixtures de store.test.ts

test("kr_run_decisiones: existe con las columnas del spec", async () => {
  const { sql, close } = await newDb();
  try {
    const rows = await sql<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'kr_run_decisiones' order by column_name",
    );
    const columnas = rows.map((r) => r.column_name).sort();
    assert.deepEqual(columnas, [
      "client_id", "completado_en", "decidido_en", "decidido_por", "destino",
      "detalle_error", "id", "resultado", "run_id", "tenant_id",
    ]);
  } finally {
    await close();
  }
});

test("🔴 el check de coherencia rechaza 'completado' sin completado_en", async () => {
  const { sql, close } = await newDb();
  try {
    const [run] = await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt, market_country,
        market_language, market_location_code)
       values ($1, $2, 'kr.v0.5', 'pending_approval', 'x', 'ES', 'es', 1) returning id`,
      [tenantA, clientA1],
    );
    await assert.rejects(
      () => sql(
        `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado)
         values ($1, $2, $3, 'solo_informe', 'completado')`,
        [run!.id, tenantA, clientA1],
      ),
      /check/i,
    );
  } finally {
    await close();
  }
});

test("🔴 el índice único parcial rechaza una segunda decisión 'pendiente' para el mismo run", async () => {
  const { sql, close } = await newDb();
  try {
    const [run] = await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt, market_country,
        market_language, market_location_code)
       values ($1, $2, 'kr.v0.5', 'pending_approval', 'x', 'ES', 'es', 1) returning id`,
      [tenantA, clientA1],
    );
    await sql(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino) values ($1, $2, $3, 'solo_informe')`,
      [run!.id, tenantA, clientA1],
    );
    await assert.rejects(
      () => sql(
        `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino) values ($1, $2, $3, 'crear_web')`,
        [run!.id, tenantA, clientA1],
      ),
      /duplicate key|unique/i,
    );
  } finally {
    await close();
  }
});
```

> Nota: los nombres exactos de los helpers de fixtures (`newDb`, `ctxA`, `tenantA`, `clientA1`) hay
> que confirmarlos contra `db/src/store.test.ts` (líneas 1-140 aprox., donde se definen) antes de
> escribir este archivo — este plan asume la convención que usa el resto de la suite de `db/`, pero
> el implementador tiene que leer `store.test.ts` primero y ajustar los imports si difieren.

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm test -w db -- --test-name-pattern="kr_run_decisiones"`
Expected: FAIL — `relation "kr_run_decisiones" does not exist`.

- [ ] **Step 3: Escribir la migración**

```sql
-- db/migrations/0027_kr_run_decisiones.sql
-- =============================================================================
-- AMG OS — 0027: kr_run_decisiones — el historial de decisiones de un run de KR
--
-- Desacopla "terminar el research" de "publicar la web"
-- (docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md). Antes, aprobar un run SIEMPRE
-- terminaba en publicar. Ahora la aprobación elige un DESTINO (crear_web / solo_informe /
-- crear_posts), y esa elección queda en esta tabla en vez de sobrescribir una columna de kr_runs
-- — así un run puede recibir una SEGUNDA decisión más adelante (retomable: solo_informe →
-- crear_web) sin perder el rastro de la primera.
-- =============================================================================

create type destino_run as enum ('crear_web', 'solo_informe', 'crear_posts');

create table kr_run_decisiones (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  -- Denormalizado desde el run, mismo motivo que kr_keywords.client_id (0001_init.sql:182-185): la
  -- política RLS no se hereda del padre, y sin esto un rol 'cliente' vería decisiones de otros
  -- negocios del mismo tenant.
  client_id      uuid not null,
  destino        destino_run not null,
  decidido_por   uuid,
  decidido_en    timestamptz not null default now(),
  resultado      text not null default 'pendiente'
    check (resultado in ('pendiente', 'completado', 'error')),
  detalle_error  text,
  completado_en  timestamptz,

  check (
    (resultado = 'pendiente'     and completado_en is null     and detalle_error is null)
    or (resultado = 'completado' and completado_en is not null and detalle_error is null)
    or (resultado = 'error'      and completado_en is not null and detalle_error is not null)
  ),

  -- FK compuesta con el mismo motivo que kr_runs (0001_init.sql:147-161): sin el tenant Y el
  -- client en la referencia, una fila podría declararse del tenant propio pero apuntar al run de
  -- otro.
  foreign key (run_id, tenant_id, client_id)
    references kr_runs (id, tenant_id, client_id) on delete cascade
);

create index on kr_run_decisiones (run_id, decidido_en desc);

-- La defensa real contra la carrera de doble aprobación (Critical #3 de la ronda de Codex): un
-- `insert...select...where` sin esto no serializa nada bajo READ COMMITTED — dos transacciones
-- concurrentes ven la misma foto y ninguna ve el insert sin commit de la otra. Un índice único
-- parcial SÍ lo cierra: Postgres serializa las inserciones que compiten por la misma entrada del
-- índice, gane quien gane la carrera la otra espera y después falla por violación de unicidad. Es
-- una garantía del motor, no de la aplicación.
create unique index kr_run_decisiones_una_pendiente
  on kr_run_decisiones (run_id)
  where resultado = 'pendiente';

alter table kr_run_decisiones enable row level security;
alter table kr_run_decisiones force row level security;

-- Mismo patrón que run_select/run_write (0001_init.sql:441-447), client_id incluido.
create policy decision_select on kr_run_decisiones
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy decision_write on kr_run_decisiones
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (
    tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id)
  );

-- Tabla nueva: los grants de tabla de app_user/app_service sobre kr_runs (0001:413, 0002:93) NO
-- cubren esta tabla automáticamente.
grant select, insert, update on kr_run_decisiones to app_user;
grant select, insert, update on kr_run_decisiones to app_service;
-- app_render: sin grant, igual que sobre kr_runs (0007_render_publico.sql:35-36).
-- app_barrido: sin grant — no hay barrido de expiración que la necesite (ver el spec, sección
-- "No hay timeout automático nuevo").
```

- [ ] **Step 4: Correr y confirmar que los tres tests pasan**

Run: `npm test -w db -- --test-name-pattern="kr_run_decisiones"`
Expected: PASS, los tres.

- [ ] **Step 5: Agregar `kr_run_decisiones` al test de RLS FORCE**

En `db/src/rls.test.ts`, el test `"RLS: FORCE está activo — ni el dueño de la tabla salta las
políticas"` (líneas 279-294 aprox.) hace `select ... from pg_class where relname in
('tenants','memberships','clients','kr_runs','kr_keywords','kr_pages','kr_metrics_cache',
'kr_serp_cache','kr_provider_tasks')` con `assert.equal(rows.length, 9)`. Agregar
`'kr_run_decisiones'` a la lista del `in (...)` y subir el `9` a `10`.

- [ ] **Step 6: RLS y grants bajo roles reales — no solo la forma de la tabla**

Hallazgo Major de la ronda de Codex sobre el plan: los tests de los Steps 1-4 verifican columnas,
`CHECK`, unicidad y `FORCE RLS`, pero ninguno prueba aislamiento entre tenants/clientes ni los
grants bajo un rol real — quitar un `grant` o debilitar una policy dejaría esta suite en verde
igual, exactamente la clase de agujero que ya costó un hallazgo Critical en el sub-proyecto 1.
Mismo patrón que `db/src/rls.test.ts` (`TestDb.create()`, `seed(db)`, `db.asUser({tenantId,userId},
sql, params?)` — confirmado leyendo ese archivo, líneas 1-47).

```ts
// db/src/kr-decisiones.test.ts — agregar
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

test("RLS: un tenant NO ve las decisiones de otro tenant", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
       values ($1, $2, $3, 'solo_informe')`,
      [s.runA1, s.tenantA, s.clientA1],
    );
    const rows = await db.asUser(
      { tenantId: s.tenantB, userId: s.equipoB },
      "select id from kr_run_decisiones",
    );
    assert.equal(rows.length, 0, "el tenant B no ve la decisión del tenant A");
  } finally {
    await db.close();
  }
});

test("RLS: dentro del mismo tenant, un rol 'cliente' no ve las decisiones de OTRO negocio", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
       values ($1, $2, $3, 'solo_informe')`,
      [s.runA1, s.tenantA, s.clientA1],
    );
    // s.duenoA1 (rol 'cliente') está atado a s.clientA1 — confirmar contra testdb.ts qué cliente le
    // corresponde y usar uno DISTINTO al dueño de la fila para este assert.
    const rows = await db.asUser(
      { tenantId: s.tenantA, userId: s.duenoA2 ?? s.duenoA1 }, // ajustar al fixture real de un segundo cliente del mismo tenant
      "select id from kr_run_decisiones where client_id = $1",
      [s.clientA1],
    );
    assert.equal(rows.length, 0, "un 'cliente' de OTRO negocio del mismo tenant no ve la fila");
  } finally {
    await db.close();
  }
});

test("grants: app_user y app_service pueden select/insert/update sobre kr_run_decisiones", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    for (const rol of ["app_user", "app_service"] as const) {
      const puede = await db.exec(
        `select has_table_privilege('${rol}', 'kr_run_decisiones', 'select') as sel,
                has_table_privilege('${rol}', 'kr_run_decisiones', 'insert') as ins,
                has_table_privilege('${rol}', 'kr_run_decisiones', 'update') as upd`,
      );
      // has_table_privilege confirma el GRANT; no reemplaza el test de RLS de arriba (evalúa
      // privilegio, no la política) — los dos hacen falta, uno no cubre al otro.
      assert.deepEqual(puede, [{ sel: true, ins: true, upd: true }]);
    }
    const app_render = await db.exec(
      `select has_table_privilege('app_render', 'kr_run_decisiones', 'select') as sel`,
    );
    assert.deepEqual(app_render, [{ sel: false }], "app_render sin grant, igual que sobre kr_runs");
  } finally {
    await db.close();
  }
});
```

> Nota: los nombres exactos de los fixtures de `Seed` (`tenantA`, `equipoA`, `clientA1`, `runA1`, un
> segundo dueño/cliente del mismo tenant para el segundo test) hay que confirmarlos contra
> `db/src/testdb.ts` antes de escribir — este plan no tiene el `interface Seed` completo a mano.
> Ajustar los nombres, no la forma de los tres tests.

- [ ] **Step 7: Correr toda la suite de `db/` y confirmar verde**

Run: `npm test -w db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/0027_kr_run_decisiones.sql db/src/kr-decisiones.test.ts db/src/rls.test.ts
git commit -m "db: tabla kr_run_decisiones — historial de destino por run, retomable"
```

---

### Task 2: `ClientRow` gana `archived_at`

**Files:**
- Modify: `db/src/store.ts:191-198` (interfaz `ClientRow`)
- Modify: `db/src/store.ts:1426-1434` (método `getClient`)
- Test: `db/src/store.test.ts` (nuevo test junto a los existentes de `getClient`, si los hay, o en
  la sección de lectura)

**Interfaces:**
- Consume: nada nuevo.
- Produce: `ClientRow.archived_at: string | null`, que la Task 6 usa en `workflowDecision` para
  abortar la publicación si el cliente fue archivado.

- [ ] **Step 1: Escribir el test que falla**

```ts
test("getClient incluye archived_at", async () => {
  await sql("update clients set archived_at = now() where id = $1", [clientA1]);
  const cliente = await store.getClient(ctxA(), clientA1);
  assert.ok(cliente);
  assert.ok(cliente!.archived_at !== undefined, "archived_at tiene que venir en la fila, aunque sea null");
  assert.notEqual(cliente!.archived_at, null);
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm test -w db -- --test-name-pattern="archived_at"`
Expected: FAIL — `cliente!.archived_at` es `undefined` (TS lo permitiría en runtime porque el
`select` no lo trae; el test falla en el `assert.notEqual`).

- [ ] **Step 3: Ampliar `ClientRow` y la query**

```ts
// db/src/store.ts:191-198
export interface ClientRow {
  id: string;
  nombre: string;
  /** Space de Storyblok de ESTE cliente. **Sin él no se publica** (ADR-04: uno por cliente). */
  storyblok_space_id: string | null;
  /** Perfil NAP del negocio → JSON-LD. Antes era un archivo global: el mismo para todos. */
  business_profile: Record<string, unknown> | null;
  /** NULL = activo. No null = archivado — workflowDecision no publica sobre un cliente archivado. */
  archived_at: string | null;
}
```

```ts
// db/src/store.ts:1426-1434
async getClient(ctx: TenantContext, clientId: string): Promise<ClientRow | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<ClientRow>(
      "select id, nombre, storyblok_space_id, business_profile, archived_at from clients where id = $1",
      [clientId],
    );
    return rows[0] ?? null;
  });
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm test -w db -- --test-name-pattern="archived_at"`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite de `db/` (nada más debería depender del shape viejo de `ClientRow`)**

Run: `npm test -w db && npm run typecheck -w db`
Expected: PASS. Si algo en `db/` construye un `ClientRow` a mano (no vía `getClient`), `tsc` lo va a
marcar por el campo faltante — agregar `archived_at: null` donde haga falta.

- [ ] **Step 6: Commit**

```bash
git add db/src/store.ts db/src/store.test.ts
git commit -m "db: ClientRow y getClient exponen archived_at"
```

---

### Task 3: `PgStore.registrarDecision` / `cerrarDecision` / `getDecision` / `getUltimaDecision`

**Files:**
- Modify: `db/src/store.ts` — insertar después de `rejectRun` (línea ~1407, dentro de la sección
  `// -------------------------------------------------------------- compuerta (ADR-06)`) los
  métodos de escritura; después de `getClient` (línea ~1434, dentro de
  `// -------------------------------------------------------------- lectura`) los de lectura.
- Modify: `db/src/index.ts` — exportar los tipos nuevos.
- Test: `db/src/store.test.ts`

**Interfaces:**
- Consume: la tabla `kr_run_decisiones` de la Task 1.
- Produce:
  - `registrarDecision(ctx: TenantContext, runId: string, destino: "crear_web" | "solo_informe" | "crear_posts", decididoPor?: string): Promise<string | null>` — exige al menos una página aprobada si `destino` es `"crear_web"` o `"crear_posts"` (no para `"solo_informe"`).
  - `type CierreDecision = { resultado: "completado" } | { resultado: "error"; detalleError: string }`
  - `cerrarDecision(ctx: TenantContext, decisionId: string, cierre: CierreDecision): Promise<boolean>`
  - `getDecision(ctx: TenantContext, decisionId: string): Promise<DecisionRow | null>`
  - `getUltimaDecision(ctx: TenantContext, runId: string): Promise<UltimaDecision | null>`
  - `interface DecisionRow { id: string; run_id: string; client_id: string; destino: "crear_web" | "solo_informe" | "crear_posts"; resultado: "pendiente" | "completado" | "error"; }`
  - `interface UltimaDecision { destino: "crear_web" | "solo_informe" | "crear_posts"; resultado: "pendiente" | "completado" | "error"; decididoEn: string; }`
  Las Tasks 6 y 10 consumen estos cuatro métodos — **con la firma nueva de `cerrarDecision`
  (objeto, no dos parámetros sueltos)**.

- [ ] **Step 1: Escribir los tests que fallan (transición, retomable, combinaciones inválidas, página aprobada)**

```ts
test("registrarDecision: primera decisión sobre un run pending_approval califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1); // helper: crea run + 1 página aprobada, deja status='pending_approval'
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(decisionId);
  const [run] = await sql<{ status: string }>("select status from kr_runs where id = $1", [runId]);
  assert.equal(run!.status, "approved", "la primera decisión promueve el run");
});

test("registrarDecision: repetir el mismo destino no califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const primera = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(primera);
  await store.cerrarDecision(ctxA(), primera!, { resultado: "completado" });
  const segunda = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.equal(segunda, null);
});

test("registrarDecision: retomable — solo_informe completado → crear_web califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const d1 = await store.registrarDecision(ctxA(), runId, "solo_informe");
  await store.cerrarDecision(ctxA(), d1!, { resultado: "completado" });
  const d2 = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(d2);
  assert.notEqual(d2, d1);
});

test("🔴 registrarDecision: retomar DESPUÉS de crear_web no califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const d1 = await store.registrarDecision(ctxA(), runId, "crear_web");
  await store.cerrarDecision(ctxA(), d1!, { resultado: "completado" });
  const d2 = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.equal(d2, null, "crear_web ya publicado no es retomable hacia solo_informe");
});

// Hallazgo de la ronda de Codex sobre el plan (Major #6, ver "Historial de revisión"): el viejo
// approveRun exigía "al menos una página aprobada" (ADR-06, compuerta doble) y registrarDecision no
// había heredado ese chequeo. Confirmado con el usuario: se aplica SOLO a crear_web — solo_informe
// no lo necesita, porque el informe ya existe desde el research sin depender de páginas aprobadas.
test("🔴 registrarDecision: crear_web SIN ninguna página aprobada no califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1); // helper: run en pending_approval, cero páginas approved
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.equal(decisionId, null);
});

test("registrarDecision: solo_informe SIN ninguna página aprobada SÍ califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(decisionId, "el informe no depende de páginas aprobadas");
});

// Agregado al escribir el plan del sub-proyecto 3 (publicar posts en blog externo): mismo criterio
// que crear_web — no tiene sentido generar posts de un run sin ninguna página aprobada.
test("🔴 registrarDecision: crear_posts SIN ninguna página aprobada no califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_posts");
  assert.equal(decisionId, null);
});

test("registrarDecision: crear_posts CON al menos una página aprobada califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_posts");
  assert.ok(decisionId);
});

test("cerrarDecision: guard de reproceso — cerrar dos veces no pisa el resultado", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  const primera = await store.cerrarDecision(ctxA(), decisionId!, { resultado: "completado" });
  const segunda = await store.cerrarDecision(ctxA(), decisionId!, {
    resultado: "error",
    detalleError: "no debería aplicar",
  });
  assert.equal(primera, true);
  assert.equal(segunda, false, "ya no está 'pendiente': el segundo cierre es un no-op");
  const decision = await store.getDecision(ctxA(), decisionId!);
  assert.equal(decision!.resultado, "completado", "el resultado de la primera NO se pisó");
});

/*
 * Hallazgo Major de la ronda de Codex: PGlite serializa TODAS sus transacciones sobre una única
 * conexión (`db/src/pool.ts:69-71`, `PglitePool.transaction()` es exclusiva) — dos llamadas por
 * `Promise.all` NUNCA se solapan de verdad ahí adentro, así que un test así puede quedar verde sin
 * haber ejercitado la colisión del índice. Este test es DETERMINISTA en su lugar: fuerza la
 * colisión insertando directo (sin pasar por `registrarDecision`) una segunda fila 'pendiente' para
 * el mismo run, y confirma que el índice la rechaza con `ON CONFLICT ... DO NOTHING` (0 filas) en
 * vez de una excepción 23505 sin manejar.
 *
 * La concurrencia REAL (dos conexiones Postgres solapadas de verdad) queda fuera de lo que este
 * arnés puede probar — no se afirma que este test la cubra.
 */
test("🔴 dos decisiones 'pendiente' para el mismo run: el índice único parcial bloquea la segunda", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const primera = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(primera);
  // Segunda decisión "pendiente" simulando la carrera SIN pasar por registrarDecision (que ya
  // bloquearía por status='approved' tras la primera) — ejercita directamente el índice, no el
  // WHERE de más arriba.
  const { rows } = await sql<{ id: string }>(
    `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
     values ($1, $2, $3, 'crear_web')
     on conflict (run_id) where resultado = 'pendiente' do nothing
     returning id`,
    [runId, tenantA, clientA1],
  );
  assert.equal(rows.length, 0, "la segunda 'pendiente' no se insertó — el índice la bloqueó en silencio, no con una excepción");
});
```

> Nota sobre `runPendienteDeAprobacion` y `runSinPaginasAprobadas`: son helpers nuevos que este step
> tiene que escribir — el primero crea un run con una página aprobada y lo deja en
> `pending_approval` (más simple que el actual `runConWorkflow`, que además marca
> `solicitud_emitida_at`; una vez retirado `RunSinWorkflowError` en la Task 4 esa marca deja de ser
> necesaria). El segundo es igual pero SIN aprobar ninguna página.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npm test -w db -- --test-name-pattern="registrarDecision|cerrarDecision"`
Expected: FAIL — `store.registrarDecision is not a function`.

- [ ] **Step 3: Implementar los cuatro métodos**

```ts
// db/src/store.ts — después de rejectRun (línea ~1407)

/**
 * Registra una decisión sobre un run (destino elegido al aprobar) y, si corresponde, promueve
 * `kr_runs.status` a 'approved' — las dos cosas en la MISMA sentencia (CTE encadenado), para que
 * ninguna carrera deje una sin la otra.
 *
 * La regla de qué transición califica vive en el WHERE del insert, no en TypeScript: así el índice
 * único parcial (`kr_run_decisiones_una_pendiente`) puede cerrar la carrera sin que la aplicación
 * tenga que coordinarse. Devuelve `null` si no calificaba — mismo estilo defensivo que `approveRun`
 * (ahora retirado, ver Task 4).
 *
 * Tres correcciones respecto de la primera versión — las dos primeras de la ronda de Codex sobre
 * este plan, la tercera agregada al diseñar el sub-proyecto 3 (publicar posts en blog externo):
 *  1. `on conflict (run_id) where resultado = 'pendiente' do nothing`: sin esto, dos inserts que
 *     pasan el `where` en una carrera GENUINA (ninguno vio el commit del otro) generan una
 *     excepción `23505` sin manejar — la API terminaría en 500, no en el 409 prometido. Con
 *     `do nothing`, el perdedor de la carrera simplemente no inserta nada y el método devuelve
 *     `null`, como cualquier otra transición que no calificó.
 *  2. La condición final exige al menos una página aprobada, pero SOLO para `crear_web` y
 *     `crear_posts` — el viejo `approveRun` lo exigía siempre; el usuario confirmó que
 *     `solo_informe` no lo necesita (el informe ya existe desde el research).
 *  3. `crear_posts` se agregó a la firma y a la condición de página aprobada (spec del sub-proyecto
 *     3, `docs/superpowers/specs/2026-08-26-publicar-posts-blog-externo-design.md`, "Riesgos": no
 *     tiene sentido generar posts de un run sin ninguna página aprobada, mismo criterio que
 *     `crear_web`). El sub-proyecto 2 solo tipaba `crear_web | solo_informe` porque `crear_posts`
 *     todavía no tenía un consumidor real — ahora lo tiene.
 */
async registrarDecision(
  ctx: TenantContext,
  runId: string,
  destino: "crear_web" | "solo_informe" | "crear_posts",
  decididoPor?: string,
): Promise<string | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ decision_id: string }>(
      `with decision as (
         insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, decidido_por)
         select r.id, r.tenant_id, r.client_id, $2::destino_run, $3
         from kr_runs r
         where r.id = $1
           and (
             r.status = 'pending_approval'
             or (
               r.status = 'approved'
               and $2::destino_run <> 'solo_informe'
               and (
                 select d.destino from kr_run_decisiones d
                 where d.run_id = r.id and d.resultado = 'completado'
                 order by d.decidido_en desc limit 1
               ) = 'solo_informe'
             )
           )
           and (
             $2::destino_run not in ('crear_web', 'crear_posts')
             or exists (
               select 1 from kr_pages p where p.run_id = r.id and p.approved and not p.retirada
             )
           )
         on conflict (run_id) where resultado = 'pendiente' do nothing
         returning id, run_id
       ),
       promocion as (
         update kr_runs
         set status = 'approved'
         from decision
         where kr_runs.id = decision.run_id and kr_runs.status = 'pending_approval'
         returning kr_runs.id
       )
       select id as decision_id from decision`,
      [runId, destino, decididoPor ?? null],
    );
    return rows[0]?.decision_id ?? null;
  });
}

/**
 * Lo que se le puede pasar a `cerrarDecision` — unión discriminada, no dos parámetros sueltos.
 *
 * Hallazgo Minor de la ronda de Codex: `resultado: "error" | "completado"` + `detalleError?:
 * string` independientes permitían `{ resultado: "completado", detalleError: "..." }` o `{
 * resultado: "error" }` sin detalle — las dos violan el `CHECK` de la tabla (0027), pero recién en
 * tiempo de ejecución. La unión lo hace un error de tipos, no un 500 sorpresa.
 */
export type CierreDecision =
  | { resultado: "completado" }
  | { resultado: "error"; detalleError: string };

/**
 * Cierra una decisión `pendiente`. El guard `where resultado = 'pendiente'` es lo que hace el
 * cierre idempotente ante un replay de Inngest después de la ventana de idempotencia de 24h
 * (Major #7 de la ronda de Codex): una segunda ejecución no encuentra fila `pendiente` y no pisa
 * el resultado de la primera. Devuelve `false` si ya estaba cerrada — no lanza.
 */
async cerrarDecision(ctx: TenantContext, decisionId: string, cierre: CierreDecision): Promise<boolean> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `update kr_run_decisiones
       set resultado = $2, detalle_error = $3, completado_en = now()
       where id = $1 and resultado = 'pendiente'
       returning id`,
      [decisionId, cierre.resultado, cierre.resultado === "error" ? cierre.detalleError : null],
    );
    return rows.length > 0;
  });
}
```

```ts
// db/src/store.ts — después de getClient (línea ~1434)

/** La decisión que `workflowDecision` tiene que cerrar — la autoridad real, releída bajo RLS. */
async getDecision(ctx: TenantContext, decisionId: string): Promise<DecisionRow | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<DecisionRow>(
      "select id, run_id, client_id, destino, resultado from kr_run_decisiones where id = $1",
      [decisionId],
    );
    return rows[0] ?? null;
  });
}

/** La última decisión de un run — lo que el portal necesita para ofrecer "construir la web ahora". */
async getUltimaDecision(ctx: TenantContext, runId: string): Promise<UltimaDecision | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ destino: string; resultado: string; decidido_en: string }>(
      `select destino, resultado, decidido_en from kr_run_decisiones
       where run_id = $1 order by decidido_en desc limit 1`,
      [runId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      destino: r.destino as UltimaDecision["destino"],
      resultado: r.resultado as UltimaDecision["resultado"],
      decididoEn: r.decidido_en,
    };
  });
}
```

```ts
// db/src/store.ts — junto a las demás interfaces de fila (cerca de ClientRow, línea ~198)
export interface DecisionRow {
  id: string;
  run_id: string;
  client_id: string;
  destino: "crear_web" | "solo_informe" | "crear_posts";
  resultado: "pendiente" | "completado" | "error";
}

export interface UltimaDecision {
  destino: "crear_web" | "solo_informe" | "crear_posts";
  resultado: "pendiente" | "completado" | "error";
  decididoEn: string;
}
```

- [ ] **Step 4: Exportar los tipos nuevos desde `db/src/index.ts`**

Agregar `CierreDecision`, `DecisionRow`, `UltimaDecision` al bloque
`export type { TenantContext, NewRun, ... }`.

- [ ] **Step 5: Correr y confirmar que todos los tests pasan**

Run: `npm test -w db -- --test-name-pattern="registrarDecision|cerrarDecision"`
Expected: PASS, los diez (los seis originales, los dos de "página aprobada" para `crear_web`, y los
dos de "página aprobada" para `crear_posts` agregados al escribir el plan del sub-proyecto 3).

- [ ] **Step 6: Verificación por mutación del índice único**

Comentar temporalmente la línea `create unique index kr_run_decisiones_una_pendiente ...` de la
migración 0027 y correr el test **"🔴 dos decisiones 'pendiente' para el mismo run..."** del
Step 1 — tiene que FALLAR (el segundo `insert` deja de colisionar y se cuela una segunda fila
`pendiente`). Restaurar la línea, confirmar que vuelve a pasar. Esto prueba que el test realmente
ejercita el índice y no una casualidad — no confundir con una prueba de concurrencia real (ver la
nota dentro del propio test, Step 1: PGlite serializa sus transacciones y no puede producirla).

- [ ] **Step 7: Correr toda la suite de `db/`**

Run: `npm test -w db && npm run typecheck -w db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add db/src/store.ts db/src/index.ts db/src/store.test.ts
git commit -m "db: registrarDecision/cerrarDecision — la autoridad de destino, serializada en Postgres"
```

---

### Task 4: Retirar `RunSinWorkflowError`/`approveRun` de `db/`

**Files:**
- Modify: `db/src/store.ts` — borrar `RunSinWorkflowError` (líneas ~380-402, docblock incluido) y
  `approveRun` (líneas ~1377-1401).
- Modify: `db/src/index.ts:5` — quitar `RunSinWorkflowError` del export.
- Modify: `db/src/store.test.ts` — borrar la sección `// ------------------------------------------- la marca de solicitud emitida (0019, bloque C0)` (líneas ~313-388: los tests de `RunSinWorkflowError` en sí) y reescribir cada llamada a `approveRun(` (líneas 284, 293, 334, 351, 386, 832, 849, 889, 972) para usar `registrarDecision` en su lugar.
- Modify (solo comentarios, sin cambio de código): `api/src/solicitar.ts:108`,
  `api/src/dev-server.ts:102,191`, `db/migrations/0019_marca_solicitud_emitida.sql:47-51` (el
  `comment on column` describe la garantía vieja — actualizarlo desde la migración 0027, no
  editando 0019 ya desplegada), `.claude/skills/datos-api/SKILL.md:94`,
  `docs/proyecto/15-plan-plataforma.md:331-332`. Todos mencionan `approveRun`/`RunSinWorkflowError`
  como si siguieran existiendo (hallazgo Minor de la ronda de Codex — inventario que faltaba en la
  primera versión de este plan).
- Verificar también `db/README.md` y `db/src/seed-demo.test.ts` — Codex los citó como referencias
  adicionales; confirmar con `rg "RunSinWorkflowError|RUN_SIN_WORKFLOW|approveRun"` sobre esos dos
  archivos puntuales antes de cerrar esta task, y actualizar lo que corresponda.

**Interfaces:**
- Consume: `registrarDecision`/`cerrarDecision` de la Task 3.
- Produce: nada nuevo — es un retiro. Las Tasks 6/8/10/11 dependen de que este retiro ya haya
  pasado (no pueden dejar un lado del stack todavía escribiendo `RunSinWorkflowError`).

- [ ] **Step 1: Borrar `RunSinWorkflowError` y `approveRun` de `store.ts`**

Borrar el docblock + `export class RunSinWorkflowError extends Error { ... }` completo, y el método
`approveRun` completo. Confirmar con `rg "RunSinWorkflowError|approveRun" db/src/store.ts` que no
queda ninguna referencia.

- [ ] **Step 2: Quitar el export de `db/src/index.ts:5`**

```ts
// antes
export { PgStore, PLAZO_RUN_COLGADO, RunSinWorkflowError } from "./store.js";
// después
export { PgStore, PLAZO_RUN_COLGADO } from "./store.js";
```

- [ ] **Step 3: Correr `npm run typecheck -w db` para encontrar cada roto**

Run: `npm run typecheck -w db`
Expected: FAIL en `db/src/store.test.ts` en cada línea que usa `RunSinWorkflowError` o `approveRun`
— esa lista de errores ES el inventario exacto de qué reescribir en el Step 4 (más preciso que
confiar en los números de línea de este plan, que pueden haber corrido un poco tras la Task 3).

- [ ] **Step 4: Borrar la sección obsoleta y reescribir los call-sites de `approveRun`**

Borrar entera la sección `// ------------------------------------------- la marca de solicitud
emitida (0019, bloque C0)` — los tests que verificaban que `RunSinWorkflowError` se lanzara ya no
tienen sujeto.

Para cada llamada restante a `approveRun(ctx, runId)` que sea SETUP de otro test (no el sujeto), el
reemplazo mecánico es:

```ts
// antes
await store.approveRun(ctx, runId);
// después
const decisionId = await store.registrarDecision(ctx, runId, "crear_web");
assert.ok(decisionId, "setup: la decisión tiene que calificar");
```

Aplicar en las líneas listadas por el `typecheck` del Step 3 (el grounding de este plan encontró 9:
284, 293, 334, 351, 386, 832, 849, 889, 972 — usar esa lista como punto de partida, no como
definitiva).

El test `"🔴 tiene_workflow viaja por los TRES lectores de runs..."` (líneas ~390-406) **se
mantiene**: `tiene_workflow`/`solicitud_emitida_at` siguen existiendo como dato histórico (Global
Constraints), solo dejaron de condicionar la aprobación — este test verifica que el dato viaja
correctamente, que sigue siendo cierto.

- [ ] **Step 5: Actualizar los comentarios obsoletos (sin código que cambie)**

En cada uno de los seis archivos listados arriba ("Files"), reemplazar la mención a
`approveRun`/`RunSinWorkflowError` como mecanismo VIGENTE por una nota de que se retiró en este
sub-proyecto — una frase alcanza en cada caso, no hace falta reescribir el comentario entero. Para
`solicitud_emitida_at` en particular (la columna de la migración 0019, ya desplegada — **no se
edita esa migración**): agregar un comentario SQL nuevo en la migración 0027 de la Task 1,
`comment on column kr_runs.solicitud_emitida_at is '...'`, documentando que desde este sub-proyecto
la columna es histórica y ya no condiciona la aprobación.

- [ ] **Step 6: Correr y confirmar verde**

Run: `npm test -w db && npm run typecheck -w db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/src/store.ts db/src/index.ts db/src/store.test.ts api/src/solicitar.ts \
  api/src/dev-server.ts db/migrations/0027_kr_run_decisiones.sql \
  .claude/skills/datos-api/SKILL.md docs/proyecto/15-plan-plataforma.md
git commit -m "db: retira RunSinWorkflowError/approveRun — reemplazados por registrarDecision"
```

---

### Task 5: `orchestrator/src/events.ts` — `ResearchAprobado` sin autoridad

**Files:**
- Modify: `orchestrator/src/events.ts:45-51`

**Interfaces:**
- Produce: `ResearchAprobado.data: { tenantId: string; decisionId: string; aprobadoPor?: string }`.
  Consumido por la Task 7 (`crearFuncionDecision`) y por la Task 10 (`api/src/app.ts`, quien emite
  el evento).

- [ ] **Step 1: Editar la interfaz**

```ts
// orchestrator/src/events.ts:45-51 — antes
export interface ResearchAprobado {
  data: {
    runId: string;
    /** Solo trazabilidad. La aprobación REAL está en la base (`kr_runs` + `kr_pages`). */
    aprobadoPor?: string;
  };
}

// después
export interface ResearchAprobado {
  data: {
    /** Coordenada para localizar la decisión bajo RLS. NO es autoridad — igual que tenantId en
     *  ResearchSolicitado (líneas 19-21 de este archivo). */
    tenantId: string;
    /** El evento solo señala QUÉ decisión revisar. El destino real se lee de la fila
     *  (`kr_run_decisiones`, bajo RLS) — nunca del evento. Ver el comentario de cabecera de este
     *  archivo: "UN EVENTO NO PORTA AUTORIDAD. NUNCA." */
    decisionId: string;
    /** Solo trazabilidad, igual que antes. */
    aprobadoPor?: string;
  };
}
```

- [ ] **Step 2: Ampliar el comentario de cabecera del archivo (líneas 24-26)**

El párrafo que dice *"Lo mismo vale para `research/aprobado`: solo DESPIERTA al workflow..."* sigue
siendo cierto sin cambios de fondo — agregar una frase explícita: *"Desde el desacople (2026-08-26),
tampoco lleva el destino: `workflowDecision` lo relee de `kr_run_decisiones` por `decisionId`."*

- [ ] **Step 3: `npm run typecheck -w orchestrator`**

Run: `npm run typecheck -w orchestrator`
Expected: **PASS.** (Corrección de la ronda de Codex sobre este plan, Minor: la primera versión de
este plan afirmaba que este typecheck fallaba en cascada — es falso. `functions.ts` no consume
`ResearchAprobado["data"]` todavía en ningún lado hoy; ese uso lo agrega recién la Task 7. Cambiar
solo la forma del tipo, sin ningún consumidor todavía, no rompe nada. Y `npm run typecheck
-w orchestrator` no puede reportar errores de `api/`, que es otro workspace — la Task 10, donde
`api/src/app.ts` sí empieza a construir el payload nuevo, es la que hay que correr con `npm run
typecheck -w api`.) Si por algún motivo SÍ falla acá, es una señal de que algo en `orchestrator/`
ya dependía de la forma vieja del tipo de un modo que este plan no anticipó — pararse a investigar
antes de seguir, no asumir que es "el rojo esperado".

- [ ] **Step 4: Commit**

```bash
git add orchestrator/src/events.ts
git commit -m "orchestrator: ResearchAprobado lleva tenantId+decisionId, nunca el destino"
```

---

### Task 6: `orchestrator/src/workflow.ts` — recortar `workflowResearch`, agregar `workflowDecision`

**Files:**
- Modify: `orchestrator/src/workflow.ts`

**Interfaces:**
- Consume: `deps.store.getDecision`, `.getClient`, `.getPublishablePages`, `.getRun`,
  `.cerrarDecision`, `.marcarPublicadas` (todas ya existen o las agregó la Task 3); `deps.publicar`,
  `deps.validarContrato` (ya existen en `Deps`); `briefDesdeLaBase` (privada, ya existe en este
  archivo, se reusa sin exportar).
- Produce:
  - `EntradaDecision { tenantId: string; decisionId: string }`
  - `ResultadoDecision { decisionId: string; runId: string; destino: "crear_web" | "solo_informe" | "crear_posts"; resultado: "completado" | "error"; paginasPublicadas?: number }`
  - `workflowDecision(paso: Pasos, entrada: EntradaDecision, deps: Deps): Promise<ResultadoDecision>`
  La Task 7 (`crearFuncionDecision`) llama a esta función.

- [ ] **Step 1: Recortar `workflowResearch` — quitar la compuerta y la publicación**

Borrar desde la línea 284 (`log(\`[run ${runId}] esperando aprobación humana...\`)`) hasta el cierre
de la función en la línea 381 (todo el bloque 4-5: la espera y el `paso.run("publicar", ...)`).
Reemplazar por un cierre simple:

```ts
// orchestrator/src/workflow.ts — reemplaza las líneas 284-381
  return { runId, estado: run.status === "running" ? "pending_approval" : "sin_cambio" };
}
```

Y actualizar `ResultadoWorkflow` (líneas 134-138):

```ts
export interface ResultadoWorkflow {
  runId: string;
  /** 'pending_approval': el research (si hacía falta) terminó y el run quedó esperando decisión.
   *  'sin_cambio': el run ya estaba más allá de 'running' — un replay que no vuelve a pagar nada. */
  estado: "pending_approval" | "sin_cambio";
}
```

Nota: la rama `if (!movio) { ...; return "sin_cambio"; }` interna al step `"cerrar-run"` (línea
~276) sigue devolviendo la cadena `"sin_cambio"` como resultado DEL STEP (para el log persistido de
Inngest) — eso no cambia. Lo que cambia es el `return` FINAL de la función completa, que ahora es el
que se acaba de escribir arriba.

- [ ] **Step 2: Retirar `PLAZO_APROBACION` y actualizar sus referencias**

La constante (línea 141) queda sin ningún uso dentro de `workflow.ts` tras el Step 1. Borrarla.

`PLAZO_APROBACION` se menciona, como CONTRASTE explicativo ("el barrido NO deriva su umbral de
PLAZO_APROBACION, que es un timer DISTINTO"), en seis lugares que van a quedar describiendo una
constante que ya no existe — actualizarlos, sin tocar el umbral real de esos barridos:

- `db/src/store.ts:76-78` (docblock de `PLAZO_RUN_COLGADO`): reemplazar *"NO se deriva de
  `PLAZO_APROBACION` (`"7d"`, en `orchestrator/src/workflow.ts`)... Éste mide la fase de research"*
  por *"Ya no existe un timer de aprobación con el que confundirse — el desacople de 2026-08-26 quitó
  la espera embebida. Éste sigue midiendo solo la fase de research, que dura minutos."*
- `db/src/store.ts:966-970`: mismo ajuste — la frase *"el único plazo del sistema
  (`PLAZO_APROBACION`) vive dentro del workflow, así que no hay reloj"* pasa a *"ya no hay ningún
  plazo de aprobación embebido — la única espera que existe hoy es la de esta fase, y por eso hace
  falta este reloj de afuera"*.
- `db/src/store.test.ts:1330-1331` (comentario) y `db/src/store.test.ts:1570-1572` (comentario):
  mismo criterio, quitar la mención a `PLAZO_APROBACION` como timer vivo.
- `db/migrations/0018_barrido_runs_colgados.sql:12-14` (comentario SQL): idem.
- `docs/proyecto/15-plan-plataforma.md:117-145`: el párrafo que dice *"El único plazo del sistema es
  `PLAZO_APROBACION`... El umbral no puede salir de `PLAZO_APROBACION`"* — actualizar a que ya no
  existe, y que el umbral del barrido de runs colgados se elige independientemente (motivo: separar
  fases de gasto, no un timer compartido).
- `.claude/skills/pipeline-orquestacion/SKILL.md:109-113`: la sección "La compuerta humana" describe
  `paso.esperarEvento(..., timeout: PLAZO_APROBACION, ...)` como el mecanismo vigente — reescribirla
  para reflejar el desacople (dos funciones, sin sleep embebido) o marcarla como histórica.
- `.claude/agents/pipeline.md:114-116`: la lista de "defaults de producción sin dueño" incluye
  `PLAZO_APROBACION` — quitarlo de la lista (ya no existe).

No tocar `PLAZO_RUN_COLGADO` en sí (el umbral del barrido de runs colgados) — solo las explicaciones
que lo contrastaban contra una constante que se retira.

- [ ] **Step 3: Escribir `workflowDecision`**

```ts
// orchestrator/src/workflow.ts — agregar después de workflowResearch, antes de aFilaDePagina

/** Lo que el evento trae. Solo coordenadas: la decisión YA EXISTE, la creó la API bajo RLS. */
export interface EntradaDecision {
  tenantId: string;
  decisionId: string;
}

export interface ResultadoDecision {
  decisionId: string;
  runId: string;
  destino: "crear_web" | "solo_informe" | "crear_posts";
  resultado: "completado" | "error";
  paginasPublicadas?: number;
}

/**
 * El workflow de la DECISIÓN, disparado por `research/aprobado`.
 *
 * La autoridad se relee siempre de la base, nunca del evento (ver el comentario de cabecera de
 * `events.ts`). El evento solo señala qué decisión revisar.
 */
export async function workflowDecision(
  paso: Pasos,
  entrada: EntradaDecision,
  deps: Deps,
): Promise<ResultadoDecision> {
  const log = deps.log ?? (() => {});
  const { decisionId } = entrada;
  const ctx: TenantContext = { tenantId: entrada.tenantId };

  const decision = await paso.run("cargar-decision", async () => {
    const d = await deps.store.getDecision(ctx, decisionId);
    if (!d) {
      throw new Error(
        `La decisión ${decisionId} no existe para el tenant ${entrada.tenantId}. El evento no crea ` +
          `decisiones: las crea la API bajo RLS. No se gasta nada ni se publica nada.`,
      );
    }
    return d;
  });

  // Guard de reproceso (Major #7 de la ronda de Codex): la idempotencia de Inngest es de 24h, no
  // una garantía. Un replay después de esa ventana encuentra la fila ya cerrada.
  if (decision.resultado !== "pendiente") {
    log(`[decision ${decisionId}] ya está '${decision.resultado}' — no se reprocesa`);
    return {
      decisionId,
      runId: decision.run_id,
      destino: decision.destino,
      resultado: decision.resultado as "completado" | "error",
    };
  }

  if (decision.destino === "crear_posts") {
    // Nunca debería llegar acá — la API lo rechaza con 501 antes de emitir el evento (Task 10). Si
    // llega igual (evento emitido a mano, bug), falla cerrado y explícito.
    await paso.run("cerrar-no-implementado", () =>
      deps.store.cerrarDecision(ctx, decisionId, {
        resultado: "error",
        detalleError: "Destino 'crear_posts' todavía no está implementado (sub-proyecto 3).",
      }),
    );
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" };
  }

  if (decision.destino === "solo_informe") {
    // No hace nada más — el informe ya existe desde el paso 1 de workflowResearch.
    await paso.run("cerrar-solo-informe", () =>
      deps.store.cerrarDecision(ctx, decisionId, { resultado: "completado" }),
    );
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "completado" };
  }

  // decision.destino === "crear_web"
  return paso.run("publicar", async () => {
    const cliente = await deps.store.getClient(ctx, decision.client_id);
    if (!cliente || cliente.archived_at !== null) {
      // Major #10 de la ronda de Codex: un cliente archivado entre la aprobación y la ejecución no
      // se publica.
      await deps.store.cerrarDecision(ctx, decisionId, {
        resultado: "error",
        detalleError: "El cliente fue archivado o ya no es visible: no se publica.",
      });
      return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
    }

    // Nota: registrarDecision (Task 3) ya exige al menos una página aprobada para calificar
    // crear_web, así que este caso no debería darse en el camino normal — se mantiene como defensa
    // en profundidad (una página puede desaprobarse editándola DESPUÉS de que la decisión ya
    // calificó, ver workflow.test.ts "editar revoca la aprobación").
    const paginas = await deps.store.getPublishablePages(ctx, decision.run_id);
    if (paginas.length === 0) {
      await deps.store.cerrarDecision(ctx, decisionId, {
        resultado: "error",
        detalleError: "El run no tiene páginas publicables.",
      });
      return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
    }

    const actual = await deps.store.getRun(ctx, decision.run_id);
    if (!actual) throw new Error(`El run ${decision.run_id} no es visible para este tenant.`);

    const briefValidado = deps.validarContrato(briefDesdeLaBase(actual, paginas));
    const resultados = await deps.publicar(briefValidado, {
      clientId: cliente.id,
      storyblokSpaceId: cliente.storyblok_space_id,
      perfil: cliente.business_profile,
    });

    const publicadas = resultados.filter((p) => p.published);
    const enDraft = resultados.length - publicadas.length;

    if (publicadas.length > 0) {
      await deps.store.marcarPublicadas(
        ctx,
        decision.run_id,
        publicadas.map((p) => ({ slug: p.slug, storyId: p.location })),
      );
    }
    if (enDraft > 0) {
      log(
        `[decision ${decisionId}] ⚠️ ${enDraft} página(s) NO quedaron publicadas (draft o dry-run).`,
      );
    }

    await deps.store.cerrarDecision(ctx, decisionId, { resultado: "completado" });
    log(`[decision ${decisionId}] publicadas ${publicadas.length} de ${resultados.length} página(s)`);
    return {
      decisionId,
      runId: decision.run_id,
      destino: decision.destino,
      resultado: "completado" as const,
      paginasPublicadas: publicadas.length,
    };
  });
}
```

- [ ] **Step 4: `npm run typecheck -w orchestrator`**

Run: `npm run typecheck -w orchestrator`
Expected: **FAIL — pero en `workflow.test.ts`, no en `functions.ts`/`server.ts`.** (Corrección de la
ronda de Codex: la primera versión de este plan apuntaba a los archivos equivocados.
`orchestrator/src/workflow.test.ts` todavía referencia `PLAZO_APROBACION`, el `estado:
"publicado"|"sin_respuesta"|"nada_que_publicar"` viejo de `ResultadoWorkflow`, y los helpers
`correrHastaLaCompuerta`/`despertar`/`Suspendido` contra la forma vieja de `workflowResearch` — eso
es lo que rompe acá, y lo arregla la Task 8, no ésta. `functions.ts`/`server.ts` en cambio siguen
compilando sin cambios hasta que la Task 7 los toque.) Confirmar que el listado de errores está
efectivamente en `workflow.test.ts` antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/workflow.ts db/src/store.ts db/src/store.test.ts \
  db/migrations/0018_barrido_runs_colgados.sql docs/proyecto/15-plan-plataforma.md \
  .claude/skills/pipeline-orquestacion/SKILL.md .claude/agents/pipeline.md
git commit -m "orchestrator: workflowResearch recortado, workflowDecision nuevo, retira PLAZO_APROBACION"
```

---

### Task 7: `orchestrator/src/functions.ts` + `server.ts` — `crearFuncionDecision`

**Files:**
- Modify: `orchestrator/src/functions.ts` — agregar `crearFuncionDecision` inmediatamente después de
  `crearFuncionResearch` (después de la línea 96).
- Modify: `orchestrator/src/server.ts:20-27,51-62,77-78` — registrar la función nueva, actualizar el
  comentario "cinco funciones" y el conteo de `/_health`.
- Modify: `orchestrator/src/config.test.ts:851-867` — el test que arma el array de funciones a mano.
- Test: `orchestrator/src/app.test.ts:91` (opcional — solo si se quiere cubrir la nueva función en
  el `/_health` de `app.ts` también; no es obligatorio para esta task).

**Interfaces:**
- Consume: `workflowDecision` de la Task 6.
- Produce: `crearFuncionDecision(deps: Deps)`, registrada en el array `funciones` de `server.ts`.

- [ ] **Step 1: Agregar el import de `TenantContext` y de `workflowDecision`**

```ts
// orchestrator/src/functions.ts — cerca de los imports existentes
import type { TenantContext } from "db";
```

Y ampliar el import existente de `workflow.js` para incluir `workflowDecision` (junto a
`workflowResearch`, que ya se importa ahí).

- [ ] **Step 2: Escribir `crearFuncionDecision`**

```ts
// orchestrator/src/functions.ts — inmediatamente después de crearFuncionResearch (línea 96)

export function crearFuncionDecision(deps: Deps) {
  return inngest.createFunction(
    {
      id: "research-decision-workflow",
      concurrency: [...CONCURRENCIA], // sigue siendo por tenantId — el evento lo sigue trayendo
      retries: 1,
      // Comodidad, NO la garantía (mismo principio que crearFuncionResearch, líneas 65-70 de este
      // archivo): un replay después de 24h todavía tiene que encontrar la decisión ya cerrada y no
      // repetirla. Eso lo impone el guard de kr_run_decisiones.resultado en workflowDecision, no
      // esta key.
      idempotency: "event.data.decisionId",
      onFailure: async ({ event, error }) => {
        const d = event.data.event.data as Eventos["research/aprobado"]["data"];
        const ctx: TenantContext = { tenantId: d.tenantId };
        await deps.store.cerrarDecision(ctx, d.decisionId, { resultado: "error", detalleError: error.message });
      },
    },
    { event: "research/aprobado" },
    async ({ event, step }) => {
      const d = event.data as Eventos["research/aprobado"]["data"];
      const ctx: TenantContext = { tenantId: d.tenantId };
      return workflowDecision(adaptarPasos(step as StepTools), { tenantId: ctx.tenantId, decisionId: d.decisionId }, deps);
    },
  );
}
```

- [ ] **Step 3: Registrar en `server.ts`**

```ts
// orchestrator/src/server.ts:20-27 — antes
import {
  crearFuncionBarrido,
  crearFuncionPollingResenas,
  crearFuncionPublicarResena,
  crearFuncionResearch,
  crearFuncionVincularTelegram,
  inngest,
} from "./functions.js";

// después
import {
  crearFuncionBarrido,
  crearFuncionDecision,
  crearFuncionPollingResenas,
  crearFuncionPublicarResena,
  crearFuncionResearch,
  crearFuncionVincularTelegram,
  inngest,
} from "./functions.js";
```

```ts
// orchestrator/src/server.ts:56-62 — antes
const funciones = [
  crearFuncionResearch(deps),
  crearFuncionBarrido(deps),
  crearFuncionPollingResenas(deps),
  crearFuncionPublicarResena(deps),
  crearFuncionVincularTelegram(deps),
];

// después
const funciones = [
  crearFuncionResearch(deps),
  crearFuncionDecision(deps),
  crearFuncionBarrido(deps),
  crearFuncionPollingResenas(deps),
  crearFuncionPublicarResena(deps),
  crearFuncionVincularTelegram(deps),
];
```

Actualizar el comentario de las líneas 51-55 (el que cuenta "Cinco: el workflow del research, el
barrido programado...") a **seis**, agregando "...el workflow de la decisión (aprobar y bifurcar por
destino)..." a la enumeración. El objeto que arma `crearServidor` sigue leyendo
`funciones: funciones.length` (línea 78) — no hace falta tocar ese número a mano, se deriva solo.

- [ ] **Step 4: Actualizar `config.test.ts`**

```ts
// orchestrator/src/config.test.ts:851-867 — agregar crearFuncionDecision al array armado a mano y
// al comentario "decir 5" → "decir 6". Mirror exacto de cómo ya están las otras cinco.
```

- [ ] **Step 5: `npm run typecheck -w orchestrator`**

Run: `npm run typecheck -w orchestrator`
Expected: PASS — con esto se cierran los errores en cascada que dejaron abiertos las Tasks 5-6.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/functions.ts orchestrator/src/server.ts orchestrator/src/config.test.ts
git commit -m "orchestrator: registra crearFuncionDecision — seis funciones"
```

---

### Task 8: `orchestrator/src/workflow.test.ts` — migrar los tests de la compuerta/publicación

**Files:**
- Modify: `orchestrator/src/workflow.test.ts`

**Interfaces:**
- Consume: `workflowResearch` recortado y `workflowDecision` de la Task 6.
- Produce: nada nuevo — reescribe la cobertura existente contra la forma nueva.

- [ ] **Step 1: Retirar lo que ya no aplica**

El `MotorPasos` doble (líneas 59-90) implementa `esperarEvento` con memoización + la clase
`Suspendido` (líneas 43-47) que señalaba que el workflow se durmió. Como `workflowResearch` recortado
**nunca llama a `esperarEvento`**, estos ya no tienen sujeto en los tests de `workflowResearch` — se
mantienen en el archivo SOLO si `workflowDecision` los necesitara (no los necesita: no espera nada).
Borrar `Suspendido` y simplificar `MotorPasos` para que solo implemente `run` (o dejar
`esperarEvento` sin usar si simplifica el diff — decisión del implementador, sin impacto funcional).

Borrar los helpers `correrHastaLaCompuerta` (376-389) y `despertar` (392-395) — dependían de la
compuerta embebida que ya no existe.

Borrar el test `"🔴 si nadie responde en el plazo, NO se publica"` (702-714, usa `aprobacion =
"timeout"`) — no hay timeout que probar.

- [ ] **Step 2: Migrar los tests de `workflowResearch` que seguían vigentes**

Estos NO dependían de la compuerta/publicación y se mantienen contra la forma recortada (ajustar
solo si usaban `Suspendido`/`correrHastaLaCompuerta`):

- `"🔴 un evento con un runId INVENTADO no gasta un centavo"` (729-738)
- `"🔴 un evento con el runId de OTRO tenant no gasta un centavo"` (741-752)
- `"🔴 un evento duplicado (motor NUEVO) no vuelve a hacer el research"` (761-776) — el
  `assert.rejects(..., Suspendido)` de la línea 771 se reemplaza: el workflow recortado ya no lanza
  `Suspendido`, simplemente retorna `{ runId, estado: "sin_cambio" }` o `"pending_approval"` según
  corresponda. Cambiar el `assert.rejects` por un `assert.equal` sobre el `estado` devuelto.
- `"las keywords pagas se persisten aunque el research reviente DESPUÉS"` (784-816)

**La primera mitad de `"el run queda en pending_approval y NO se publica nada hasta que un humano
apruebe"` (401-410) migra acá**, recortada — hallazgo Major de la ronda de Codex: esta task no la
tenía inventariada. La mitad "NO se publica nada" se retira sin reemplazo: es trivialmente cierta
una vez que `workflowResearch` recortado no tiene ningún camino que publique, no hace falta un test
para afirmarlo.

```ts
test("el run queda en pending_approval tras el research, sin publicar nada (workflowResearch ya no publica)", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const resultado = await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);

  assert.equal(resultado.estado, "pending_approval");
  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval");
});
```

- [ ] **Step 3: Escribir los tests de `workflowDecision`, migrando el contenido de los que se retiran**

Los siguientes tests probaban publicación/compuerta dentro de `workflowResearch` — su contenido migra
a tests NUEVOS de `workflowDecision`, con `registrarDecision` como setup (no `approveRun`, retirado
en la Task 4) y sin pasar por `paso.esperarEvento`:

- `"aprobado en la base + evento → se publica"` (412-428)
- `"solo se publican las páginas que el humano aprobó..."` (430-449)
- `"🔴 cada cliente publica en SU space..."` (831-860)
- `"🔴 si la story queda en DRAFT..."` (869-886)
- `"editar y volver a aprobar sí publica..."` (931-949)

Patrón de setup para cada uno (reemplaza lo que antes hacía `runConWorkflow` + `approveRun` +
`despertar`):

```ts
test("workflowDecision: aprobado con destino crear_web → se publica", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1); // helper existente o nuevo, mismo shape que antes usaba runConWorkflow pero SIN marcarSolicitudEmitida (ya no hace falta)
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId);

  const motor = new MotorPasos();
  const resultado = await workflowDecision(motor, { tenantId: tenantA, decisionId: decisionId! }, deps);

  assert.equal(resultado.resultado, "completado");
  assert.equal(resultado.destino, "crear_web");
  assert.equal(resultado.paginasPublicadas, 1);
});
```

Cada test de esta lista migrado reemplaza su verificación original (contenido publicado, space del
cliente, estado de la story) tal cual estaba, solo cambiando el setup y la función bajo prueba.

**Los tres casos siguientes NO siguen el patrón genérico de arriba** — hallazgo Major de la ronda de
Codex: la primera versión de esta task los omitió, o les asignó una migración incorrecta. Cada uno
necesita su propio tratamiento:

- **`"🔴 un evento de aprobación NO publica nada si en la base nadie aprobó"` (643-653)**: en la
  arquitectura nueva no existe un camino donde `research/aprobado` se emita sin que
  `registrarDecision` ya haya calificado — la API los ata (Task 10). El equivalente real es un
  `decisionId` FALSO/inventado en el evento (el mismo espíritu: "el evento no es autoridad, si no
  hay fila detrás no pasa nada"):

  ```ts
  test("🔴 workflowDecision con un decisionId INVENTADO no publica nada", async () => {
    const espia = depsFalsas([]);
    await assert.rejects(
      () => workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: crypto.randomUUID() }, espia.deps),
      /no existe/i,
    );
    assert.equal(espia.publicadas.length, 0);
  });
  ```

- **`"🔴 con las páginas aprobadas pero el run sin aprobar, no se publica nada"` (659-672)**: **se
  retira sin reemplazo directo.** Ya no es un escenario alcanzable: una decisión `kr_run_decisiones`
  solo existe si `registrarDecision` la creó, y `registrarDecision` ya exige que el run esté en
  `pending_approval` o sea la ruta retomable — no hay forma de que `workflowDecision` reciba un
  `decisionId` válido para un run "sin aprobar". El test de arriba (decisionId inventado) cubre el
  caso de autoridad forjada que este test protegía en espíritu.

- **`"🔴 el tenant B no puede hacer que se publique el research del tenant A"` (679-695)**: el
  patrón cambia — ya no es "B aprueba con su propio contexto y falla en `approvePage`/`approveRun`",
  sino "la decisión la crea A, pero el `workflowDecision` corre con el `tenantId` de B (evento
  forjado) y RLS le niega la lectura de la fila":

  ```ts
  test("🔴 el tenant B no puede leer ni publicar una decisión creada por el tenant A", async () => {
    const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1);
    const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
    assert.ok(decisionId);

    const espia = depsFalsas([]);
    await assert.rejects(
      () => workflowDecision(new MotorPasos(), { tenantId: tenantB, decisionId: decisionId! }, espia.deps),
      /no existe/i,
      "RLS: la fila de A es invisible bajo el contexto de B",
    );
    assert.equal(espia.publicadas.length, 0);
  });
  ```

**`"🔴 editar una página aprobada REVOCA su aprobación..."` (899-929) cambia de resultado, no solo de
setup** — otro hallazgo Major de la ronda de Codex: la verificación original esperaba `estado:
"nada_que_publicar"`, un valor que `ResultadoDecision` ya no tiene (`workflowDecision` colapsa ese
caso en `resultado: "error"`, ver Task 6). Migrar así, no con el patrón genérico:

```ts
test("🔴 editar una página aprobada REVOCA su aprobación — workflowDecision cierra en error, no publica", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1, { urlSlug: "/pizza" });
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.editPage(humano(tenantA), rows[0]!.id, { url_slug: "/pizza-napolitana" });

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.resultado, "error", "editar revocó la aprobación: no queda nada publicable");
  assert.equal(espia.publicadas.length, 0);
});
```

- [ ] **Step 4: Tests nuevos que el spec pedía explícitamente y no existían**

```ts
test("workflowDecision: retomable — solo_informe completado, después crear_web publica", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1);
  const d1 = await store.registrarDecision(ctxA(), runId, "solo_informe");
  await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: d1! }, deps);

  const d2 = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(d2);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: d2! }, deps);
  assert.equal(resultado.resultado, "completado");
  assert.equal(resultado.paginasPublicadas, 1);
});

test("workflowDecision: guard de reproceso — llamar dos veces sobre la misma decisión completada no publica dos veces", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, deps);

  let publicarLlamadas = 0;
  const depsContando = { ...deps, publicar: async (...args: Parameters<typeof deps.publicar>) => {
    publicarLlamadas++;
    return deps.publicar(...args);
  }};
  const segunda = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, depsContando);

  assert.equal(segunda.resultado, "completado", "informa el resultado ya cerrado, no lo repite");
  assert.equal(publicarLlamadas, 0, "no se llamó a publicar() la segunda vez");
});

test("🔴 workflowDecision: crear_posts persistido a mano cierra en error, nunca en completado", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1);
  // Simula un evento emitido a mano / bug: insertar la decisión directo, sin pasar por la API que
  // la rechazaría con 501 (Task 10).
  const [d] = await sql<{ id: string }>(
    `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
     values ($1, $2, $3, 'crear_posts') returning id`,
    [runId, tenantA, clientA1],
  );
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: d!.id }, deps);
  assert.equal(resultado.resultado, "error");
});

test("🔴 workflowDecision: cliente archivado a mitad de camino no publica", async () => {
  const runId = await crearRunConPaginaAprobada(store, ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  await sql("update clients set archived_at = now() where id = $1", [clientA1]);

  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, deps);
  assert.equal(resultado.resultado, "error");
});
```

- [ ] **Step 5: Correr toda la suite**

Run: `npm test -w orchestrator`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/workflow.test.ts
git commit -m "orchestrator: migra los tests de compuerta/publicación a workflowDecision, cubre retomable y guard de reproceso"
```

---

### Task 9: `api/src/codigos.ts` + `portal/src/app/core/codigos.ts` — `TRANSICION_INVALIDA`

**Files:**
- Modify: `api/src/codigos.ts`
- Modify: `portal/src/app/core/codigos.ts`

**Interfaces:**
- Produce: `TRANSICION_INVALIDA = "TRANSICION_INVALIDA"`, agregado a `CODIGOS` en ambos archivos
  (atados por `portal/src/app/core/codigos.test.ts`, que exige que las dos copias coincidan
  exactamente).

- [ ] **Step 1: Escribir el test que falla**

El test existente `portal/src/app/core/codigos.test.ts` ya compara `portal.CODIGOS` contra
`api.CODIGOS` con `deepEqual` — alcanza con agregar el código a UN lado primero para verlo fallar.

- [ ] **Step 2: `api/src/codigos.ts` — retirar `RUN_SIN_WORKFLOW`, agregar `TRANSICION_INVALIDA`**

```ts
// antes (líneas 26-39)
/**
 * `POST /runs/:id/approve` — el run existe y se puede ver, pero **nadie está esperando la
 * aprobación**: ...
 */
export const RUN_SIN_WORKFLOW = "RUN_SIN_WORKFLOW";

/** Todos los códigos, para el test que los ata a la copia del portal. */
export const CODIGOS = { SIN_PAGINAS_APROBADAS, RUN_SIN_WORKFLOW } as const;

// después
/**
 * `POST /runs/:id/approve` — la transición pedida no califica: ni es la primera decisión de un run
 * en `pending_approval`, ni es el único camino retomable (última decisión completada
 * 'solo_informe' → un destino distinto). Ver `docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`,
 * sección "Modelo de datos".
 */
export const TRANSICION_INVALIDA = "TRANSICION_INVALIDA";

/** Todos los códigos, para el test que los ata a la copia del portal. */
export const CODIGOS = { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } as const;
```

- [ ] **Step 3: Mismo cambio en `portal/src/app/core/codigos.ts`** (copia literal, mismo diff)

- [ ] **Step 4: Correr y confirmar verde**

Run: `npm test -w api -- --test-name-pattern="codigos"` y
`npm --prefix portal run test:components -- --include='**/codigos.test.ts'` (o el comando
equivalente que use este repo para tests `node:test` dentro de `portal/` — confirmar contra
`package.json` de `portal/`, ya que `codigos.test.ts` usa `node:test`, no Karma).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/codigos.ts portal/src/app/core/codigos.ts
git commit -m "api+portal: retira RUN_SIN_WORKFLOW, agrega TRANSICION_INVALIDA"
```

---

### Task 10: `api/src/app.ts` — `POST /runs/:id/approve` y `GET /runs/:id`

**Files:**
- Modify: `api/src/app.ts:4,24,211-219,358-378,840-854`
- Modify: `db/src/store.ts` — nuevo método `getRunConUltimaDecision` (no se toca `RunSummary` en sí
  ni `RUN_SUMMARY_COLS` compartida por `listRuns`/`listAllRuns` — ver Step 3, corregido tras la
  ronda de Codex).
- Test: `api/src/app.test.ts:9,452-460,474-478,486-497,520-536,550-564,566-577`

**Interfaces:**
- Consume: `registrarDecision` (Task 3), `TRANSICION_INVALIDA` (Task 9), `ResearchAprobado`
  extendido (Task 5).
- Produce: `POST /runs/:id/approve` con body `{ destino }`; `GET /runs/:id` con
  `run.ultimaDecision`; `PgStore.getRunConUltimaDecision`.

- [ ] **Step 1: Escribir los tests que fallan**

Tres correcciones de la ronda de Codex respecto de la primera versión de esta task, todas en este
Step: (Critical) el `send()` sin compensación necesita su propio test; (Major) los tres tests
existentes que llaman `POST /runs/:id/approve` **sin body** se rompen con `await c.req.json()` si no
se migran; (Major) "crear_web sin páginas aprobadas" ahora se resuelve DENTRO de `registrarDecision`
(Task 3), así que es un `409 TRANSICION_INVALIDA` genérico, no un código distinto como antes.

```ts
// api/src/app.test.ts:474-478 — MIGRAR (antes llamaba sin body)
test("POST /runs/:id/approve sin ninguna página aprobada → 409 y NO despierta al workflow", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(res.status, 409);
  const cuerpo = (await res.json()) as { codigo: string };
  assert.equal(cuerpo.codigo, TRANSICION_INVALIDA, "sin página aprobada, crear_web no calificó en registrarDecision (Task 3)");
  assert.equal(eventos.length, 0, "no se emite research/aprobado si la compuerta no se cumplió");
});

// api/src/app.test.ts:486-497 — MIGRAR (antes llamaba sin body)
test("aprobar página y run: recién ahí se emite research/aprobado", async () => {
  const { runId, pageId } = await runNacidoDelPipeline();

  const a = await req("POST", `/pages/${pageId}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(a.status, 200);

  const b = await req("POST", `/runs/${runId}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(b.status, 200);
  const cuerpo = (await b.json()) as { decisionId: string };
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.name, "research/aprobado");
  assert.deepEqual(eventos[0]!.data, { tenantId: tenantA, decisionId: cuerpo.decisionId, aprobadoPor: equipoA });
});

// api/src/app.test.ts:520-536 — MIGRAR (antes llamaba sin body)
test("🔴 un CLIENTE no puede aprobar el RUN aunque vea una página aprobada → 403, sin evento", async () => {
  const { runId, pageId } = await runNacidoDelPipeline();
  await req("POST", `/pages/${pageId}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0;

  const res = await req("POST", `/runs/${runId}/approve`, {
    user: duenoA1, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(res.status, 403);
  assert.equal(eventos.length, 0, "el cliente no puede despertar el workflow");

  const [r] = await sql<{ status: string }>("select status from kr_runs where id = $1", [runId]);
  assert.equal(r!.status, "running", "el run NO quedó aprobado");
});

// api/src/app.test.ts — reemplaza el test de la línea 550-564 (RUN_SIN_WORKFLOW)
test("aprobar un run insertado DIRECTO en la base (sin solicitud_emitida_at) SÍ califica ahora", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0;
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "solo_informe" },
  });
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { ok: boolean; decisionId: string };
  assert.ok(cuerpo.decisionId);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0]!.data, { tenantId: tenantA, decisionId: cuerpo.decisionId, aprobadoPor: equipoA });
});

test("🔴 aprobar con un destino que no califica → 409 TRANSICION_INVALIDA", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "crear_web" } });
  eventos.length = 0;
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "solo_informe" } });
  assert.equal(res.status, 409);
  const cuerpo = (await res.json()) as { codigo: string };
  assert.equal(cuerpo.codigo, TRANSICION_INVALIDA);
  assert.equal(eventos.length, 0);
});

test("🔴 aprobar con destino crear_posts → 501, sin tocar la base ni emitir evento", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0;
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "crear_posts" } });
  assert.equal(res.status, 501);
  assert.equal(eventos.length, 0);
  const [row] = await sql<{ n: string }>("select count(*)::text as n from kr_run_decisiones where run_id = $1", [runA1]);
  assert.equal(row!.n, "0");
});

// Hallazgo Minor de la ronda de Codex: agregar cobertura de body ausente/malformado.
test("🔴 aprobar sin body → 400, sin tocar la base", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 400);
  const [row] = await sql<{ n: string }>("select count(*)::text as n from kr_run_decisiones where run_id = $1", [runA1]);
  assert.equal(row!.n, "0");
});

test("🔴 aprobar con destino inválido → 400", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "publicar_ya" },
  });
  assert.equal(res.status, 400);
});

// Hallazgo Critical de la ronda de Codex: si emisor.send() falla DESPUÉS de que registrarDecision
// ya insertó la fila, sin compensación esa decisión queda 'pendiente' PARA SIEMPRE — el índice
// único parcial (Task 1) impide registrar cualquier otra sobre el mismo run.
test("🔴 si emisor.send() falla, la decisión se cierra en 'error' — no queda bloqueada", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  emisorFalla = true; // flag del emisor de prueba — confirmar el mecanismo real contra el harness de app.test.ts
  try {
    const res = await req("POST", `/runs/${runA1}/approve`, {
      user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
    });
    assert.equal(res.status, 500);
  } finally {
    emisorFalla = false;
  }
  const [row] = await sql<{ resultado: string }>(
    "select resultado from kr_run_decisiones where run_id = $1", [runA1],
  );
  assert.equal(row!.resultado, "error", "la fila NO queda 'pendiente' — el índice único la liberó");

  // Y una segunda aprobación normal, después del fallo, SÍ puede calificar:
  const segundo = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(segundo.status, 200, "el índice único ya no bloquea: la primera decisión quedó 'error', no 'pendiente'");
});

test("GET /runs/:id devuelve ultimaDecision null cuando todavía no se aprobó", async () => {
  const res = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  const cuerpo = (await res.json()) as { run: { ultimaDecision: unknown } };
  assert.equal(cuerpo.run.ultimaDecision, null);
});

test("GET /runs/:id devuelve ultimaDecision con destino y resultado tras aprobar", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "solo_informe" } });
  const res = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  const cuerpo = (await res.json()) as { run: { ultimaDecision: { destino: string } | null } };
  assert.equal(cuerpo.run.ultimaDecision?.destino, "solo_informe");
});
```

El test de `tiene_workflow` (566-577) se mantiene sin cambios: sigue viajando en `RunSummary` como
dato histórico.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npm test -w api -- --test-name-pattern="approve|ultimaDecision"`
Expected: FAIL — el handler todavía no lee `destino` del body.

- [ ] **Step 3: `getRunConUltimaDecision` — una sola consulta, no dos lecturas separadas**

Hallazgo Major de la ronda de Codex: la primera versión de esta task proponía dos lecturas
independientes (`getRun` + `getUltimaDecision`, cada una su propia transacción) y descartaba
ampliar la query por "no vale la pena tocar algo compartido por tres métodos". El problema real no
es de rendimiento (no hay N+1: es un endpoint de detalle) — es que entre las dos lecturas alguien
puede aprobar el run, y la respuesta mostraría `status: 'pending_approval'` junto a una
`ultimaDecision` que ya existe. Un solo snapshot lo cierra, sin tocar `RUN_SUMMARY_COLS` (que
`listRuns`/`listAllRuns` también usan): un método NUEVO, dedicado, con un `left join lateral`.

```ts
// db/src/store.ts — después de getRun (línea ~1567)
/**
 * `getRun` + su última decisión, en una sola sentencia — Major #9 de la ronda de Codex: dos
 * lecturas separadas podían mostrar un `status` y una `ultimaDecision` de momentos distintos si una
 * aprobación ocurría justo entre las dos. No toca `RUN_SUMMARY_COLS` (la usan `listRuns`/
 * `listAllRuns`, que no necesitan este dato) — es un método aparte, solo para `GET /runs/:id`.
 */
async getRunConUltimaDecision(
  ctx: TenantContext,
  runId: string,
): Promise<(RunSummary & { ultimaDecision: UltimaDecision | null }) | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<
      RunSummary & {
        decision_destino: string | null;
        decision_resultado: string | null;
        decision_decidido_en: string | null;
      }
    >(
      `select ${RUN_SUMMARY_COLS},
              d.destino as decision_destino,
              d.resultado as decision_resultado,
              d.decidido_en as decision_decidido_en
       from kr_runs
       left join lateral (
         select destino, resultado, decidido_en from kr_run_decisiones
         where run_id = kr_runs.id order by decidido_en desc limit 1
       ) d on true
       where kr_runs.id = $1`,
      [runId],
    );
    const r = rows[0];
    if (!r) return null;
    const { decision_destino, decision_resultado, decision_decidido_en, ...run } = r;
    return {
      ...run,
      ultimaDecision: decision_destino
        ? {
            destino: decision_destino as UltimaDecision["destino"],
            resultado: decision_resultado as UltimaDecision["resultado"],
            decididoEn: decision_decidido_en!,
          }
        : null,
    };
  });
}
```

`getUltimaDecision` (Task 3) NO se retira — sigue haciendo falta suelto en cualquier lugar que solo
necesite la decisión sin el run completo (por ejemplo, dentro de `workflowDecision` no aplica, pero
otro caller futuro sí podría). Esta task solo agrega el método combinado para `GET /runs/:id`.

- [ ] **Step 4: Reescribir el handler `POST /runs/:id/approve`**

```ts
// api/src/app.ts:358-378 — antes
/*
 * POST /runs/:id/approve — la otra mitad, y también COMANDO COMPUESTO.
 * ...
 */
app.post("/runs/:id/approve", async (c) => {
  const ctx = c.get("ctx");
  const runId = c.req.param("id");
  const ok = await deps.store.approveRun(ctx, runId);
  if (!ok) return c.json({ error: "No autorizado para aprobar este run." }, 403);
  await deps.emisor.send({
    name: "research/aprobado",
    data: ctx.userId ? { runId, aprobadoPor: ctx.userId } : { runId },
  });
  return c.json({ ok: true });
});

// después
/*
 * POST /runs/:id/approve — la otra mitad, y también COMANDO COMPUESTO.
 *
 * `registrarDecision` inserta la decisión Y promueve el run a 'approved' en la misma sentencia,
 * bajo RLS (Tx). Solo si calificó y devolvió un id, se emite el evento — que no lleva el destino:
 * `workflowDecision` lo relee de la fila (ADR-12/18, y el comentario de cabecera de `events.ts`).
 *
 * Corrección Critical de la ronda de Codex: si `send()` falla DESPUÉS de que `registrarDecision` ya
 * insertó la fila, sin compensación esa decisión queda 'pendiente' PARA SIEMPRE — el índice único
 * parcial (Task 1) bloquearía cualquier otra decisión sobre el mismo run. Mismo patrón que
 * `solicitar.ts:83-95` (fila → evento → si el evento falla, marcar y relanzar).
 */
app.post("/runs/:id/approve", async (c) => {
  const ctx = c.get("ctx");
  const runId = c.req.param("id");
  const { destino } = await c.req.json<{ destino?: string }>();

  // TEMPORAL — retirado por el sub-proyecto 3 (docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md,
  // Task 10 Step 0.1), agregado durante la revisión conjunta de los tres sub-proyectos (2026-08-26):
  // sin ese Step, crear_posts queda inalcanzable para siempre pese a que el sub-proyecto 3 implementa
  // el resto del mecanismo (hallazgo Critical de Codex sobre esa revisión). Si estás implementando
  // ESTE sub-proyecto (el 2) en aislamiento, dejalo así — el bloque se retira cuando le toque el
  // turno al sub-proyecto 3, no antes.
  if (destino === "crear_posts") {
    return c.json(
      { error: "Destino 'crear_posts' todavía no está implementado.", codigo: "NO_IMPLEMENTADO" },
      501,
    );
  }
  if (destino !== "crear_web" && destino !== "solo_informe") {
    return c.json({ error: "destino tiene que ser 'crear_web' o 'solo_informe'." }, 400);
  }

  const decisionId = await deps.store.registrarDecision(ctx, runId, destino, ctx.userId ?? undefined);
  if (!decisionId) {
    return c.json(
      { error: "Esta transición no está permitida para el estado actual del run.", codigo: TRANSICION_INVALIDA },
      409,
    );
  }

  try {
    await deps.emisor.send({
      name: "research/aprobado",
      data: { tenantId: ctx.tenantId, decisionId, ...(ctx.userId ? { aprobadoPor: ctx.userId } : {}) },
    });
  } catch (fallo) {
    try {
      await deps.store.cerrarDecision(ctx, decisionId, {
        resultado: "error",
        detalleError: `No se pudo emitir research/aprobado: ${(fallo as Error).message}`,
      });
    } catch (fallaElCierre) {
      console.error("[api] no se pudo cerrar la decisión tras el fallo de send():", fallaElCierre);
    }
    throw fallo;
  }
  return c.json({ ok: true, decisionId });
});
```

Nota: `registrarDecision` puede lanzar por RLS (rol `cliente` sin `puede_escribir()`, etc.) — ese
caso ya lo cubre el `onError` existente (403 por `42501`), sin cambios. Si `send()` falla y el
`throw fallo` de arriba no cae en ningún `if` de `onError`, cae en el `500` genérico del final — es
el comportamiento correcto: un fallo de infraestructura al emitir el evento es un 500, no un 4xx.

- [ ] **Step 5: Quitar el bloque `RunSinWorkflowError` de `onError` y sus imports**

```ts
// api/src/app.ts:4 — antes
import { RunSinWorkflowError, esEstadoIdea, ESTADOS_IDEA } from "db";
// después
import { esEstadoIdea, ESTADOS_IDEA } from "db";
```

```ts
// api/src/app.ts:24 — antes
import { SIN_PAGINAS_APROBADAS, RUN_SIN_WORKFLOW } from "./codigos.js";
// después
import { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } from "./codigos.js";
```

Borrar el bloque completo de `onError` (líneas 840-854, comentario incluido):

```ts
if (err instanceof RunSinWorkflowError) {
  return c.json({ error: err.message, codigo: RUN_SIN_WORKFLOW }, 409);
}
```

(El `TRANSICION_INVALIDA` no pasa por `onError` — se devuelve directo en el handler del Step 4, no
es una excepción.)

- [ ] **Step 6: `GET /runs/:id` gana `ultimaDecision`**

```ts
// api/src/app.ts:211-219 — antes
/** GET /runs/:id — el brief: el run + sus páginas propuestas (con evidencia y estado de aprobación). */
app.get("/runs/:id", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const run = await deps.store.getRun(ctx, id);
  if (!run) return c.json({ error: "Run no encontrado." }, 404);
  const pages = await deps.store.getRunPages(ctx, id);
  return c.json({ run, pages });
});

// después — usa getRunConUltimaDecision (Step 3), UN snapshot, no dos lecturas separadas
/** GET /runs/:id — el brief: el run + sus páginas propuestas, y la última decisión (si hay). */
app.get("/runs/:id", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const run = await deps.store.getRunConUltimaDecision(ctx, id);
  if (!run) return c.json({ error: "Run no encontrado." }, 404);
  const pages = await deps.store.getRunPages(ctx, id);
  return c.json({ run, pages });
});
```

- [ ] **Step 7: Correr y confirmar verde**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api/src/app.ts api/src/app.test.ts
git commit -m "api: POST /runs/:id/approve exige destino, GET /runs/:id expone ultimaDecision"
```

---

### Task 11: Portal — selector de destino, retiro del gate `tiene_workflow`

**Files:**
- Modify: `portal/src/app/core/models.ts` (`Brief` — NO `RunSummary`, ver Step 1)
- Modify: `portal/src/app/core/api-core.ts` (`aprobarRun`, `verBrief`, retirar `esRunSinWorkflow`)
- Modify: `portal/src/app/core/api-core.test.ts` (retirar los tests de `esRunSinWorkflow`)
- Modify: `portal/src/app/core/features.ts` (`mostrarDestinoPosts`)
- Modify: `portal/src/environments/environment.ts` y `environment.prod.ts` (flag
  `features.destinoPosts`)
- Modify: `portal/src/environments/environment.prod.test.ts` (fija el flag nuevo, retira el test de
  coherencia obsoleto)
- Modify: `portal/src/app/pages/brief/brief.ts` (selector de destino, retiro del gate)
- Modify: `portal/src/app/pages/brief/brief.spec.ts`

**Interfaces:**
- Consume: `POST /runs/:id/approve` con body y `GET /runs/:id` con `ultimaDecision` (Task 10);
  `TRANSICION_INVALIDA` (Task 9).
- Produce: nada que otra task consuma — es la punta visible.

- [ ] **Step 1: `models.ts` — `ultimaDecision` va en `Brief`, NO en `RunSummary`**

Corrección Major de la ronda de Codex: `RunSummary` no es exclusivo del brief — lo consumen 12
archivos del portal (`cartera-mock.ts`, `metricas.ts`/`.test.ts`, `inicio.ts`/`.spec.ts`,
`cliente-research.ts`/`.spec.ts`, `cartera.test.ts`, `dinero.ts`, `codigos.ts`, `api-core.ts`,
confirmado con `rg -n "RunSummary" portal/src/app -g '*.ts'`). Agregar un campo OBLIGATORIO nuevo a
esa interfaz rompe el typecheck de cada mock/constructor de esos 12 archivos que este plan no
tocó. `ultimaDecision` va en el tipo que envuelve el detalle del run, `Brief` — el único lugar que
lo necesita.

```ts
// portal/src/app/core/models.ts — junto a la definición existente de RunSummary (líneas 9-53)
export interface UltimaDecision {
  destino: 'crear_web' | 'solo_informe' | 'crear_posts';
  resultado: 'pendiente' | 'completado' | 'error';
  decididoEn: string;
}

// RunSummary NO CAMBIA — se mantiene exactamente como está.

// Brief (líneas ~117-120): el único consumidor que necesita ultimaDecision.
export interface Brief {
  run: RunSummary & { ultimaDecision: UltimaDecision | null };
  pages: PaginaPropuesta[];
}
```

- [ ] **Step 2: `api-core.ts` — `aprobarRun` recibe destino, se retira `esRunSinWorkflow`**

> TEMPORAL — el sub-proyecto 3 amplía este tipo a `'crear_web' | 'solo_informe' | 'crear_posts'`
> (`docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md`, Task 11 Step 0), agregado
> durante la revisión conjunta de los tres sub-proyectos (2026-08-26). Si estás implementando ESTE
> sub-proyecto en aislamiento, los dos valores de acá son correctos — se amplía cuando le toque el
> turno al sub-proyecto 3.

```ts
// api-core.ts:237 (interfaz ClienteApi) — antes
aprobarRun(runId: string): Promise<void>;
// después
aprobarRun(runId: string, destino: 'crear_web' | 'solo_informe'): Promise<void>;
```

```ts
// api-core.ts:472-474 — antes
async aprobarRun(runId) {
  await pedir('POST', `/runs/${encodeURIComponent(runId)}/approve`);
},
// después
async aprobarRun(runId, destino) {
  await pedir('POST', `/runs/${encodeURIComponent(runId)}/approve`, { destino });
},
```

Borrar `esRunSinWorkflow` (líneas 62-64) y su import de `RUN_SIN_WORKFLOW`. Agregar, si hace falta
para el manejo del 409 en `brief.ts` (Step 6), un helper equivalente para el código nuevo:

```ts
export function esTransicionInvalida(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as ApiError).codigo === TRANSICION_INVALIDA;
}
```

- [ ] **Step 3: `api-core.test.ts` — retirar los tests de `esRunSinWorkflow`, agregar los de
  `esTransicionInvalida`** (mismo patrón, mirror del test que se borra)

- [ ] **Step 4: `features.ts` — `mostrarDestinoPosts`**

> TEMPORAL — el sub-proyecto 3 quita el `disabled` de la opción y prende `destinoPosts: true` en
> `environment.ts` de DEV (`environment.prod.ts` queda en `false` a propósito — decisión de
> lanzamiento separada, ver `docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md`, Task
> 11 Step 0). Agregado durante la revisión conjunta de los tres sub-proyectos (2026-08-26).

```ts
/**
 * ¿Se muestra la opción "crear_posts" del selector de destino, aunque deshabilitada?
 * Sub-proyecto 3 (publicar en un blog externo) todavía no existe — este flag queda en `false`
 * hasta que lo haya. Mismo patrón que `mostrarAprobarRun`/`mostrarLanzarResearch`.
 */
export function mostrarDestinoPosts(esEquipo: boolean, destinoPostsHabilitado: boolean): boolean {
  return esEquipo && destinoPostsHabilitado;
}
```

- [ ] **Step 5: `environment.ts` / `environment.prod.ts` — flag `destinoPosts: false`**

```ts
// portal/src/environments/environment.ts — dentro de features:
features: {
  lanzarResearch: true,
  aprobarRun: true,
  /** La opción "crear_posts" del selector de destino. false hasta que exista el sub-proyecto 3. */
  destinoPosts: false,
},
```

Mismo cambio en `environment.prod.ts`. En `environment.prod.test.ts`:
- Agregar `test('destinoPosts está APAGADO en producción (sub-proyecto 3 no existe todavía)', () => { assert.equal(prod.features.destinoPosts, false); })`.
- **Retirar** el test `"no se puede aprobar-y-publicar sin poder lanzar..."` (líneas 47-57) — su
  razón de ser era que aprobar un run sembrado (sin `solicitud_emitida_at`) emitía un evento que
  nadie escuchaba; con el desacople y el retiro de `RunSinWorkflowError` (Task 4), CUALQUIER run en
  `pending_approval` puede recibir una decisión, nacido del pipeline o sembrado. La combinación que
  el test prohibía ya no es un problema. Actualizar el comentario de cabecera del archivo
  (líneas 40-46) para que no siga describiendo un peligro que ya no existe.

- [ ] **Step 6: `brief.ts` — selector de destino, retiro del gate**

Borrar el bloque `tiene_workflow`/`rechazadoSinWorkflow`/`motivoNoAprobar` tal como estaba atado a
esa marca (líneas 304-334) — el motivo de "no aprobable" que queda es únicamente
`hayPaginaAprobada` (la otra mitad de `motivoNoAprobable`, que se mantiene). Reemplazar el botón
único (líneas 147-160) por un selector:

```html
@if (puedeAprobarRunUI()) {
  <div class="mt-4 space-y-2">
    <label class="block text-sm font-medium">¿Qué hacemos con este research?</label>
    <select [(ngModel)]="destinoElegido" class="rounded-md border-borde text-sm px-2 py-1">
      <option value="crear_web">Crear la web</option>
      <option value="solo_informe">Solo quedarme con el informe</option>
      @if (mostrarDestinoPostsUI()) {
        <option value="crear_posts" disabled>Crear posts (próximamente)</option>
      }
    </select>
    <button
      (click)="aprobarRun()"
      [disabled]="motivoNoAprobar() !== null || trabajando()"
      [attr.title]="motivoNoAprobar()"
      class="rounded-md bg-respaldo text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
    >
      Confirmar
    </button>
    @if (motivoNoAprobar(); as motivo) {
      <p class="text-xs text-texto-tenue">{{ motivo }}</p>
    }
  </div>
}
@if (puedeRetomarUI()) {
  <button data-test="retomar-web" (click)="retomarConWeb()" class="mt-4 rounded-md border border-borde px-4 py-2 text-sm">
    Construir la web ahora
  </button>
}
```

```ts
// brief.ts — junto a las demás señales del componente
readonly destinoElegido = signal<'crear_web' | 'solo_informe'>('crear_web');
readonly mostrarDestinoPostsUI = computed(() =>
  mostrarDestinoPosts(this.membresia.esEquipo(), environment.features.destinoPosts),
);
// Corrección Major de la ronda de Codex: la primera versión de este computed solo miraba la
// decisión, sin combinar el gate de rol/flag — un usuario 'cliente', o un despliegue con
// aprobarRun apagado, veía el botón igual y el backend lo rechazaba recién al hacer clic.
readonly puedeRetomarUI = computed(() => {
  if (!this.puedeAprobarRunUI()) return false; // mismo gate de equipo+flag que el selector de arriba
  const u = this.brief()?.run.ultimaDecision;
  return u?.destino === 'solo_informe' && u.resultado === 'completado';
});

async aprobarRun(): Promise<void> {
  const pedido = this.runId;
  this.trabajando.set(true);
  this.error.set('');
  try {
    await this.api.aprobarRun(pedido, this.destinoElegido());
    await this.refetch();
  } catch (e) {
    if (this.vigencia.obsoleta(pedido)) return;
    if (esTransicionInvalida(e)) this.error.set('Este run ya no admite esa transición.');
    else this.error.set((e as Error).message);
  } finally {
    if (!this.vigencia.obsoleta(pedido)) this.trabajando.set(false);
  }
}

async retomarConWeb(): Promise<void> {
  this.destinoElegido.set('crear_web');
  await this.aprobarRun();
}
```

`motivoNoAprobar` se simplifica a solo depender de `hayPaginaAprobada` — actualizar
`core/aprobar-run.ts` y su test si `motivoNoAprobable` tenía el parámetro `tieneWorkflow` como
obligatorio (quitarlo de la firma, no solo de la llamada).

- [ ] **Step 7: `brief.spec.ts` — reescribir los tests del gate viejo, agregar los del selector**

Retirar los tests atados a `tiene_workflow`/`sinWorkflow()` (líneas 171-179, 295-371, 373+ listadas
en el grounding de este plan). Agregar equivalentes contra el selector: el selector se muestra
cuando el flag está encendido, la opción `crear_posts` aparece deshabilitada, el botón
"Construir la web ahora" aparece solo cuando `ultimaDecision.destino === 'solo_informe' &&
resultado === 'completado'`, y el 409 `TRANSICION_INVALIDA` muestra el mensaje sin borrar la
pantalla (mismo patrón que el test viejo de la línea 344-371, adaptado al código nuevo).

Agregar los dos negativos de `puedeRetomarUI` que pide la ronda de Codex — el botón "Construir la
web ahora" NO debería aparecer aunque `ultimaDecision` califique, si:

```ts
it('🔴 no muestra "Construir la web ahora" para un rol cliente, aunque la decisión califique', () => {
  configurar({ brief: conUltimaDecision('solo_informe', 'completado'), esEquipo: false });
  renderFixture();
  expect(fixture.debugElement.query(By.css('[data-test="retomar-web"]'))).toBeNull();
});

it('🔴 no muestra "Construir la web ahora" con el flag aprobarRun apagado, aunque la decisión califique', () => {
  configurar({ brief: conUltimaDecision('solo_informe', 'completado'), aprobarRunHabilitado: false });
  renderFixture();
  expect(fixture.debugElement.query(By.css('[data-test="retomar-web"]'))).toBeNull();
});
```

(Nombres de helpers — `conUltimaDecision`, el flag de `configurar` — ilustrativos: ajustar al estilo
real de `brief.spec.ts` una vez reescrito el Step 6; agregar `data-test="retomar-web"` al botón del
Step 6 si el spec lo necesita para seleccionarlo.)

- [ ] **Step 8: Correr toda la suite del portal**

Run: `npm --prefix portal run test:components` (Karma) y los `*.test.ts` de `node:test` dentro de
`portal/core` (`npm --prefix portal test` o el script equivalente — confirmar en
`portal/package.json`).
Expected: PASS.

- [ ] **Step 9: Manejar la app en el navegador (MCP chrome-devtools)**

Con la API y el orchestrator corriendo en modo dev (`npm run dev:server -w api`,
`npm run dev -w orchestrator` o el equivalente), abrir el portal y recorrer el flujo completo:
lanzar research → ver el informe sin aprobar → aprobar con `solo_informe` → confirmar que aparece
"Construir la web ahora" → retomar con `crear_web` → confirmar que el sitio se publica. Los tests
automatizados no ven layout roto ni un `@if` mal cableado — esto sí.

- [ ] **Step 10: Commit**

```bash
git add portal/src/app/core/models.ts portal/src/app/core/api-core.ts \
  portal/src/app/core/api-core.test.ts portal/src/app/core/features.ts \
  portal/src/app/core/aprobar-run.ts portal/src/environments/environment.ts \
  portal/src/environments/environment.prod.ts portal/src/environments/environment.prod.test.ts \
  portal/src/app/pages/brief/brief.ts portal/src/app/pages/brief/brief.spec.ts
git commit -m "portal: selector de destino, retira el gate tiene_workflow, agrega retomar hacia crear_web"
```

---

### Task 12: Verificación end-to-end y documentación

**Files:**
- Modify: `docs/proyecto/09-estado-y-roadmap.md`
- Modify: `progress/current.md`
- Modify: `docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md` (marcar implementado, si
  este plan se ejecuta antes de la revisión conjunta de los 3 sub-proyectos — ver nota en el header
  del spec sobre la secuencia)

- [ ] **Step 1: `npm run verificar` desde la raíz**

Run: `npm run verificar`
Expected: entorno, arnés, higiene de secretos, typecheck y tests — todo verde, con el output a la
vista.

- [ ] **Step 2: Grep final de que no queda ningún rastro de lo retirado**

```bash
rg "RunSinWorkflowError|RUN_SIN_WORKFLOW" --type ts
rg "PLAZO_APROBACION" --type ts --type sql -g '!*.test.ts'
```

Expected: cero resultados en código de producción (los `.test.ts` que quedaron con el nombre viejo
en un comentario histórico, si los hay, son aceptables — el símbolo en sí no debe existir).

- [ ] **Step 2b: Cerrar el riesgo "quién asume que `status === 'approved'` implica publicado"**

Ya inventariado durante la escritura de este plan (`rg "status === .approved.|status = 'approved'"`
sobre `api/`, `portal/`, `orchestrator/`): la etiqueta del portal (`cliente-research.ts:14-19`) dice
genéricamente "Aprobado", no "Publicado" — no hay ninguna suposición que corregir ahí. El único cabo
suelto real es `api/src/dev-server.ts:96`, que siembra un run demo con `status: 'approved'` sin una
fila `kr_run_decisiones` correspondiente — es un script de desarrollo local, no producción, pero
deja el demo con `ultimaDecision: null` sobre un run "aprobado" (cosmético: el botón "Construir la
web ahora" de la Task 11 no aparece para ese run demo). Si se quiere que el demo se vea coherente,
agregar un `insert into kr_run_decisiones (...) values (..., 'crear_web', 'completado', ...)`
después de la línea 96 de `dev-server.ts`. No bloquea el cierre de esta task si se decide dejarlo
para después — es cosmético, documentarlo alcanza.

- [ ] **Step 3: Actualizar `docs/proyecto/09-estado-y-roadmap.md` y `progress/current.md`**

Agregar entrada de "sub-proyecto 2: diseño y plan completos" al lado de la del sub-proyecto 1
(spec+plan sin implementar, o "implementado" si este plan se ejecutó — depende de si el usuario
decidió adelantar la implementación respecto de la secuencia original de "diseñar los 3 antes de
implementar cualquiera").

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "Doc: cierra el sub-proyecto 2 (desacoplar keyword research de creación de webs)"
git push
```

(Push solo si el usuario lo confirma explícitamente en el momento — ver AGENTS.md, acciones que
afectan el repo remoto requieren confirmación.)

---

## Historial de revisión

**Ronda 1 (Codex, sobre este plan), 2026-08-26** — veredicto NECESITA REDISEÑO, 12 hallazgos
(1 Critical, 8 Major, 3 Minor). Reporte completo en
[`progress/informes/codex-desacoplar-kr-plan.md`](../../../progress/informes/codex-desacoplar-kr-plan.md).
Los 12 fueron verificados empíricamente contra el código real (no aceptados por juicio, ninguno
refutado) y aplicados. Ninguno contradijo las 6 decisiones fijas del spec; uno (el hallazgo 6, más
abajo) requirió una decisión de producto chica que no estaba en el spec original, confirmada
explícitamente con el usuario.

1. [Critical] Un fallo al emitir `research/aprobado` dejaba la decisión `pendiente` para siempre
   (el índice único parcial bloqueaba cualquier otra) → `try/catch` alrededor del `send` en
   `POST /runs/:id/approve`, cierra la decisión en `error` y relanza (Task 10).
2. [Major] La carrera protegida por el índice único devolvía una excepción `23505` sin manejar, no
   `null`/409 → `on conflict (run_id) where resultado = 'pendiente' do nothing` en el `INSERT` de
   `registrarDecision` (Task 3).
3. [Major] El test de concurrencia con `Promise.all` no podía producir una carrera real: PGlite
   serializa todas sus transacciones sobre una única conexión
   (`db/src/pool.ts:69-71`, confirmado leyendo el archivo) → reemplazado por un test determinista
   del conflicto (inserción directa + `ON CONFLICT`), con una nota explícita de que la concurrencia
   real con dos conexiones queda fuera de lo que este arnés puede probar (Task 3).
4. [Major] La tabla nueva no tenía tests de RLS ni de grants bajo roles reales → agregados a la
   Task 1, mismo patrón que `db/src/rls.test.ts` (`TestDb`/`asUser`).
5. [Major] El inventario de migración de `workflow.test.ts` estaba incompleto (tres tests sin
   inventariar: 401-410, 643-653, 659-672) y uno migrado con el resultado esperado equivocado
   (899-929, esperaba `estado: "nada_que_publicar"`, un valor que `ResultadoDecision` ya no tiene) →
   los tres tratados individualmente, uno retirado sin reemplazo directo (ya no es un escenario
   alcanzable bajo la arquitectura nueva) (Task 8).
6. [Major] Los tests HTTP existentes de `POST /runs/:id/approve` llamaban sin body y se habrían
   roto con `await c.req.json()`; y de paso se encontró que `registrarDecision` no heredaba el
   chequeo "al menos una página aprobada" del viejo `approveRun` (ADR-06) → los tres tests migrados
   con `{destino}`, y el chequeo agregado al `WHERE` de `registrarDecision` **solo para `crear_web`**
   (confirmado con el usuario: `solo_informe` no lo necesita) (Tasks 3 y 10).
7. [Major] Agregar `ultimaDecision` como campo obligatorio de `RunSummary` rompía 12 consumidores
   ajenos al brief (`cartera-mock.ts`, `metricas.test.ts`, `inicio.spec.ts`, etc.) → `RunSummary` no
   se toca; `ultimaDecision` vive en `Brief.run: RunSummary & {...}` (Task 11).
8. [Major] `puedeRetomarUI` no combinaba con el gate de rol/flag — un rol `cliente` o un despliegue
   con `aprobarRun` apagado veía igual el botón "Construir la web ahora" → combinado con
   `puedeAprobarRunUI`, con los dos negativos cubiertos por test (Task 11).
9. [Major] `GET /runs/:id` podía devolver `run.status` y `ultimaDecision` de un momento distinto (dos
   lecturas separadas, sin transacción compartida) → un método nuevo,
   `getRunConUltimaDecision` (`left join lateral`), un solo snapshot (Task 10).
10. [Minor] El retiro de `RunSinWorkflowError`/`RUN_SIN_WORKFLOW`/`approveRun` dejaba comentarios
    obsoletos fuera del inventario en `api/src/solicitar.ts`, `api/src/dev-server.ts`,
    `.claude/skills/datos-api/SKILL.md`, `docs/proyecto/15-plan-plataforma.md` y la migración 0019
    (ya desplegada, no se edita — el comentario nuevo va en la 0027) → agregados al inventario de la
    Task 4.
11. [Minor] La Task 5 anunciaba un `npm run typecheck -w orchestrator` en rojo que en realidad pasa
    en verde (nada en `orchestrator/` consume `ResearchAprobado["data"]` todavía en ese punto) → la
    Task 6 SÍ queda en rojo, pero por `workflow.test.ts`, no por `functions.ts`/`server.ts` como
    decía la primera versión → corregidas las expectativas de ambas tasks.
12. [Minor] `cerrarDecision(id, resultado, detalleError?)` permitía combinaciones que el `CHECK` de
    la tabla rechazaba en runtime (`"completado"` con detalle, `"error"` sin detalle) → unión
    discriminada `CierreDecision` (Task 3), propagada a todos los call-sites (Tasks 6, 7).

**Enmienda, 2026-08-26 — no es una ronda de Codex, es una dependencia del sub-proyecto 3.** Al
escribir el spec de "publicar posts en un blog externo"
([`docs/superpowers/specs/2026-08-26-publicar-posts-blog-externo-design.md`](../specs/2026-08-26-publicar-posts-blog-externo-design.md),
"Riesgos"), Codex (ronda 1 sobre ese spec, hallazgo Major #7) señaló que dejar esta dependencia solo
como flag para la revisión conjunta no era una precondición ejecutable — el plan del sub-proyecto 3
no puede depender de un cambio acá sin que ese cambio exista. Se resolvió extendiendo el hallazgo 6
de esta misma ronda (arriba): `registrarDecision` ahora exige "al menos una página aprobada" también
para `destino: "crear_posts"`, no solo `crear_web` — mismo razonamiento (ADR-06, no tiene sentido
generar contenido de un run sin ninguna página aprobada). Cambiado: la firma de `registrarDecision`
(Task 3, agrega `"crear_posts"` a la unión), la condición SQL (`not in ('crear_web', 'crear_posts')`
en vez de `<> 'crear_web'`), y dos tests nuevos (Task 3, Step 1). Sigue siendo edición de documento
de diseño, no código — no adelanta la secuencia de implementación acordada para los tres
sub-proyectos.

**Segunda enmienda, 2026-08-26 — revisión exhaustiva conjunta de los tres sub-proyectos, ronda 2
(Codex, 1 Critical + 3 Major).** Reporte completo:
[`progress/informes/codex-revision-conjunta.md`](../../../progress/informes/codex-revision-conjunta.md).
El hallazgo Critical de esa ronda es sobre ESTE plan y el del sub-proyecto 3 juntos: el `501` de
`POST /runs/:id/approve` (Task de la API), el tipo angosto de `aprobarRun` y el `disabled`/flag
`destinoPosts` del selector (Task del portal) quedaban PERMANENTES — el sub-proyecto 3 nunca los
retiraba en su propio plan, pese a que su spec prometía hacerlo. No se tocó ningún comportamiento de
ESTE plan: se agregaron tres comentarios `TEMPORAL` marcando exactamente dónde y por qué el
sub-proyecto 3 va a completar cada uno cuando le toque su turno (ver Task del `POST /runs/:id/approve`,
Step 2 de `api-core.ts`, y Step 4 de `features.ts`). El arreglo real —retirar el `501`, ampliar el
tipo, sacar el `disabled`— vive en
[`docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md`](../plans/2026-08-26-publicar-posts-blog-externo.md),
Task 10 Step 0.1 y Task 11 Step 0.
