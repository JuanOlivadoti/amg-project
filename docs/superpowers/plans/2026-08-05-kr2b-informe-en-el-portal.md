# KR-2b — El informe del research, en el portal · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** que la agencia pueda **leer en el portal** el informe de keyword research de un run y
**descargarlo en `.md`**, con el informe guardado tal como se generó y visible solo para staff.

**Architecture:** el Markdown lo produce `renderReport()` (ya existe en `contrato/`, KR-2a) y se guarda
**una vez** en una tabla propia `kr_informes` cuya política RLS exige `app.es_staff()` — porque el informe
lleva el coste que la agencia paga a DataForSEO, o sea su margen, y **RLS es por fila, no por columna**.
Dos productores lo escriben (el orquestador vía `PgStore.guardarInforme`, el seed con su propio `insert`),
un consumidor lo lee (dos endpoints), y el portal lo pinta **parseando el Markdown a una estructura de
datos** que se dibuja con `@if`/`@for` — sin `innerHTML`, así que la inyección de HTML es imposible por
construcción y no por configuración.

**Tech Stack:** PostgreSQL (PGlite en tests) · TypeScript ESM strict + `tsx` · `node:test` + `node:assert`
· Hono (API) · Angular 20 standalone + signals (portal) · el paquete `contrato/` para render y tipos.

## Global Constraints

Copiadas de la spec y de `AGENTS.md`. **Valen para todas las tareas**, no se repiten en cada una.

- **La migración es la `0016`.** `0013` y `0014` están **reservadas** para ramas que corren en otra
  máquina: un número libre en el disco no es un número libre.
- **`db/` corre PostgreSQL 16.4 y `api/` 18.3** (medido el 2026-08-05: `select version()` en `db/` →
  `PostgreSQL 16.4`). Cualquier comportamiento del motor se mide **en el paquete donde corre**, nunca se
  extrapola del otro.
- **Nada de credenciales, nada de gasto.** Todo corre con PGlite en memoria y providers mock. **No** correr
  `env:sync`, `reseed:demo` sin `--dry-run`, `demo -w renderer`, `migrate:deploy`, ni DataForSEO en
  producción. **La `0016` NO se despliega en esta pieza** — se suma a `0011`, `0012` y `0015`, que tampoco
  están desplegadas.
- **Rojo primero**, después el arreglo, después **verificación por mutación**: reintroducir el bug y
  confirmar que cae *exactamente* su test. **Una mutación que no tumba nada es un resultado, no un fallo del
  método**: o falta el test, o la línea no hace lo que su comentario dice — hay que averiguar cuál de las dos
  **antes** de tocar el test, y dejarlo escrito.
- **El rol no se declara: se DERIVA de `memberships` dentro de Postgres** (ADR-15). Ningún endpoint acepta
  `role` del body, y **ninguno de estos endpoints lleva un `if` de rol**: autoriza Postgres.
- **El acceso a la base es solo por transacción con conexión reservada** (`Tx` vía `withTenant`), nunca un
  `query()` suelto (ADR-13).
- **Todo valor que termine en el HTML es superficie de inyección.** Acá aplica dos veces: el `filename` del
  header de descarga (allowlist) y el Markdown que pinta el portal (estructura de datos, no `innerHTML`).
- Nombres de dominio **en español** (`guardarInforme`, `parsearMarkdown`, `nombreArchivo`). Los comentarios
  explican **por qué**, no qué — sobre todo la decisión de seguridad o la trampa que se evita.
- **Un comentario que afirma algo medible tiene que estar medido.** Si no se midió, no se escribe.
- Se importa **por nombre de paquete** (`import { renderReport } from "contrato"`), nunca por ruta relativa
  entre paquetes.
- Verificación de cierre de cada tarea: `npm run verificar` (o el test del paquete mientras se itera). El
  portal **no** entra en `npm test` de la raíz: sus tests van con `npm --prefix portal test` y los de
  componente con `npm --prefix portal run test:components`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `db/migrations/0016_informe_kr.sql` | **crear** — la tabla, RLS + force, los dos `grant`, la política `app.es_staff()` | T1 |
| `db/src/testdb.ts` | **modificar** — helper `asOrquestador` (rol `app_service` real, sujeto a RLS) | T1 |
| `db/src/informes.test.ts` | **crear** — la seguridad de la tabla: grants, aislamiento, `cliente`, rol ausente, `app_render`, FK compuesta, tope de tamaño | T1 |
| `db/src/store.ts` | **modificar** — `InformeRow`, `guardarInforme`, `getInforme` | T2 |
| `db/src/informe-store.test.ts` | **crear** — idempotencia, `generado_at`, que no revoca aprobaciones, run ajeno | T2 |
| `db/src/index.ts` | **modificar** — exportar `InformeRow` | T2 |
| `orchestrator/src/workflow.ts` | **modificar** — step `guardar-informe` entre `guardar-paginas` y `cerrar-run` | T3 |
| `orchestrator/src/workflow.test.ts` | **modificar** — el invariante: un run `pending_approval` siempre tiene informe | T3 |
| `api/src/informe-nombre.ts` | **crear** — `nombreArchivo()`: allowlist del `filename` | T4 |
| `api/src/app.ts` | **modificar** — los dos endpoints | T4 |
| `api/src/informe.test.ts` | **crear** — `200`+`null` vs `404`, el `filename`, el fallback | T4 |
| `db/package.json` | **modificar** — `contrato` como dependencia (el seed renderiza) | T5 |
| `db/src/seed-demo.ts` | **modificar** — `calidad_datos` honesto, `backlog`, `keywords_analizadas`, render + insert del informe | T5 |
| `db/src/seed-demo.test.ts` | **modificar** — el informe sembrado y sus tres huecos | T5 |
| `portal/src/app/core/cartera-mock.ts` | **modificar** — el mismo `calidad_datos` que el seed | T5 |
| `db/src/cartera-portal.test.ts` | **modificar** — atar `calidad_datos` de los dos lados (hoy **no** lo mira) | T5 |
| `portal/src/app/core/markdown.ts` | **crear** — `parsearMarkdown()`: Markdown → estructura de datos | T6 |
| `portal/src/app/core/markdown.test.ts` | **crear** — el subconjunto cerrado y que lo desconocido es texto literal | T6 |
| `portal/src/app/core/api-core.ts` | **modificar** — `verInforme()` y `urlInformeMd()` | T7 |
| `portal/src/app/core/models.ts` | **modificar** — el tipo `Informe` | T7 |
| `portal/src/app/services/api.ts` | **modificar** — exponer los dos métodos | T7 |
| `portal/src/app/pages/informe/informe.ts` | **crear** — la pantalla | T7 |
| `portal/src/app/pages/informe/informe.spec.ts` | **crear** — test de componente (Karma) | T7 |
| `portal/src/app/pages/brief/brief.ts` | **modificar** — el link al informe | T7 |
| `portal/src/app/app.routes.ts` | **modificar** — la ruta `runs/:id/informe` | T7 |
| `portal/src/app/core/sin-html-crudo.test.ts` | **crear** — barrido del árbol: ninguna plantilla usa `innerHTML` | T7 |

**Orden y paralelismo.** `T1 → T2 → {T3, T4, T5}`; **T6 es independiente de todo** (recibe un string) y puede
ir en cualquier momento; **T7 va última** porque consume el contrato de T4 y el parser de T6. La spec fija
que `datos` define la forma del endpoint **antes** de que `front` la consuma.

---

### Task 1: La migración `0016` y la seguridad de la tabla

**Files:**
- Create: `db/migrations/0016_informe_kr.sql`
- Modify: `db/src/testdb.ts` (agregar `asOrquestador`)
- Test: `db/src/informes.test.ts`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: la tabla `kr_informes (run_id, tenant_id, client_id, informe_md, generado_at)` con política
  `informe_staff`; y `TestDb.asOrquestador<T>(ctx: {tenantId: string; userId?: string}, sql: string,
  params?: unknown[]): Promise<T[]>` — rol `app_service` **real** (sujeto a RLS), que T2 usa en sus tests.

> **Por qué hace falta `asOrquestador`.** `TestDb.asService` es el **superusuario** de infraestructura: salta
> RLS. Su propio comentario avisa de no confundirlo con `app_service`. Ningún test de política puede usarlo,
> y **tampoco** el test de los grants: medido el 2026-08-05 en PGlite, un `insert` sobre una tabla sin un
> solo `grant` **pasa** como superuser y da **42501** tras `set local role app_service`. O sea: el helper que
> hay hoy haría pasar el test siempre. Ese es el helper que falta.

- [ ] **Step 1: Escribir el test que falla — los dos logins pueden usar la tabla**

Crear `db/src/informes.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * La seguridad de `kr_informes` (migración 0016), contra Postgres real (PGlite en WASM).
 *
 * El informe lleva el coste que la agencia le paga a DataForSEO — o sea su margen — así que vive en su
 * propia tabla y NO en una columna de `kr_runs`: RLS es por FILA, no por columna, y cualquiera que pueda
 * ver el run vería la columna. El rol `cliente` existe, es el dueño del negocio, y ve los runs de su
 * cliente. Con la fila propia, la política puede exigir staff.
 *
 * ⚠️ Ninguno de estos tests puede usar `db.asService`: es el SUPERUSUARIO de infraestructura y salta RLS
 * (y los grants). Medido: un `insert` sin un solo `grant` pasa como superuser y da 42501 con
 * `set local role app_service`. Los tests van con `asUser` (app_user) y `asOrquestador` (app_service).
 */
let db: TestDb;
let s: Seed;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
});
after(async () => {
  await db.close();
});

const MD = "# Informe\n\nUn informe cualquiera.";

test("los DOS logins pueden usar la tabla: el orquestador escribe y la API lee", async () => {
  // El grant es lo que se prueba acá: sin él, Postgres corta con 42501 ANTES de evaluar RLS.
  await db.asOrquestador(
    { tenantId: s.tenantA },
    `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
     select $1, $2, r.client_id, $3 from kr_runs r where r.id = $1`,
    [s.runA1, s.tenantA, MD],
  );

  const filas = await db.asUser<{ informe_md: string }>(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 1, "el equipo del tenant A lee el informe de su run");
  assert.equal(filas[0]?.informe_md, MD);
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm test -w db 2>&1 | tail -20
```

Esperado: **FALLA**. Sin la migración, `relation "kr_informes" does not exist` (42P01). Y sin
`asOrquestador`, además `db.asOrquestador is not a function` — las dos cosas se resuelven en los pasos 3 y 4.

- [ ] **Step 3: El helper `asOrquestador` en `testdb.ts`**

Agregar junto a `asRender` (mismo patrón: transacción, `set local role`, rollback), en
`db/src/testdb.ts`:

```ts
  /**
   * Query como el ORQUESTADOR: rol `app_service` de verdad, **sujeto a RLS y a los grants**.
   *
   * No confundir con `asService`, que es el superusuario de infraestructura (migraciones y seed) y
   * **salta** las dos cosas. La diferencia no es cosmética: medido en PGlite, un `insert` sobre una tabla
   * sin un solo `grant` PASA con `asService` y da 42501 con este helper. Un test de política o de grants
   * escrito con `asService` pasa siempre y no prueba nada.
   *
   * Pone el contexto de tenant porque las políticas lo exigen (`app.current_tenant_id()`); el `userId` es
   * opcional porque el orquestador **no es una persona** y su autoridad no viene de una membresía.
   */
  async asOrquestador<T = Record<string, unknown>>(
    ctx: { tenantId: string; userId?: string },
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await this.pg.exec("begin");
    try {
      await this.pg.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await this.pg.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await this.pg.exec("set local role app_service");
      const res = await this.pg.query<T>(sql, params);
      await this.pg.exec("commit");
      return res.rows;
    } catch (e) {
      await this.pg.exec("rollback");
      throw e;
    }
  }
```

> **Ojo con el `commit`:** `asRender` hace `rollback` porque solo lee. Este **escribe**, y los tests de T2
> necesitan que lo escrito sobreviva a la transacción. Si hiciera `rollback`, los tests de idempotencia
> pasarían por la razón equivocada (no habría fila previa nunca).

- [ ] **Step 4: Escribir la migración**

Crear `db/migrations/0016_informe_kr.sql`:

```sql
-- =============================================================================
-- AMG OS — 0016: el informe del keyword research, en su propia tabla (KR-2b)
--
-- ## Por qué una tabla y no una columna de `kr_runs`
--
-- Porque **RLS es por fila, no por columna**. El informe lleva el desglose del coste que la agencia le
-- paga a DataForSEO — su margen — y el rol `cliente` (el dueño del negocio) VE los runs de su cliente:
-- `run_select` usa `app.ve_cliente(client_id)`. Una columna en `kr_runs` sería visible para él, y un grant
-- por columna no lo distingue de `equipo`: los dos conectan con el MISMO rol de Postgres (`app_user`), y
-- lo que los separa es la política, que opera sobre filas.
--
-- Ya hubo una fuga de exactamente esta clase con `kr_keywords` (0001_init.sql § kr_keywords) y otra con
-- las notas internas del CRM. Con la fila propia, la fila ES el informe, así que la política puede exigir
-- staff y el `cliente` no recibe la fila — no recibe un 403.
--
-- ## Un informe por run, y lo que eso NO deja preparado
--
-- `run_id` es la PK, así que hay UN informe por run. El día que haga falta una variante para el cliente
-- (el mismo informe sin el bloque de coste) va a necesitar migración igual: la PK pasaría a
-- `(run_id, variante)`. Se dice acá para no dejar escrita la promesa cómoda de que "ya está preparado":
-- no lo está, y creerlo es peor que saberlo.
-- =============================================================================

create table if not exists kr_informes (
  run_id       uuid primary key references kr_runs(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  client_id    uuid not null,
  informe_md   text not null,
  generado_at  timestamptz not null default now(),

  -- Misma FK compuesta que `kr_pages`: la fila no puede MENTIR sobre a qué run/tenant/cliente pertenece.
  -- Sin esto, un `client_id` cualquiera entraría mientras el `run_id` fuera válido, y el informe del
  -- restaurante A quedaría contabilizado contra el cliente B.
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade,

  /*
   * TOPE DE TAMAÑO, en la base y no en un comentario. El informe de 14 páginas mide decenas de KB; el
   * tope está una orden de magnitud arriba, así que solo lo toca un dato patológico (un LLM que devuelve
   * una FAQ de 2 MB). Va acá porque es el ÚNICO punto de escritura: con la constraint puesta, ni el
   * endpoint ni la pantalla necesitan lógica de tamaño — no pueden recibir algo que no entró.
   */
  constraint informe_tamano_razonable check (octet_length(informe_md) <= 262144)  -- 256 KiB
);

alter table kr_informes enable row level security;
alter table kr_informes force  row level security;

-- -----------------------------------------------------------------------------
-- LOS GRANTS. Una política SIN grant no da acceso: Postgres rechaza con 42501 ANTES de evaluar RLS.
--
-- Los grants de este proyecto son listas EXPLÍCITAS por tabla (0001_init.sql para `app_user`, 0002_auth
-- para `app_service`) y no hay `on all tables` ni `alter default privileges` en ninguna migración: **una
-- tabla nueva nace SIN un solo privilegio para nadie**. `kr_informes` es la primera tabla que el proyecto
-- agrega desde que existen los cuatro logins (ADR-17), así que este paso no estaba en ninguna rutina — y
-- la primera versión de la spec se olvidó de él. Lo cazó una review midiéndolo en PGlite: `app_service`
-- recibía 42501 al insertar contra una política que autorizaba filas de una tabla inalcanzable.
--
-- `app_render` NO recibe nada, y eso es la mitad de la decisión de ADR-19: el proceso anónimo es el rol
-- más pobre del sistema y el informe es lo más interno que hay.
-- -----------------------------------------------------------------------------
grant select                         on kr_informes to app_user;     -- la API lee (staff, vía RLS)
grant select, insert, update, delete on kr_informes to app_service;  -- el orquestador escribe

-- -----------------------------------------------------------------------------
-- `app.es_staff()` es una ALLOWLIST POSITIVA que FALLA CERRADO: un rol NULL o desconocido no ve nada.
--
-- NO se usa `app.current_role() is distinct from 'cliente'`, que falla ABIERTO: con un rol ausente,
-- `NULL is distinct from 'cliente'` da TRUE y concedería visibilidad de maestro. Es el bug que
-- 0001_init.sql § FALLAR CERRADO documenta como YA OCURRIDO en este esquema.
-- -----------------------------------------------------------------------------
create policy informe_staff on kr_informes
  for all to app_user, app_service
  using      (tenant_id = app.current_tenant_id() and app.es_staff())
  with check (tenant_id = app.current_tenant_id() and app.es_staff());

comment on table kr_informes is
  'El informe de keyword research ya renderizado en Markdown, tal como se genero. Tabla propia y no una '
  'columna de kr_runs porque RLS es por fila: el informe lleva el coste que la agencia paga a DataForSEO '
  'y el rol cliente ve los runs de su cliente. Solo staff (app.es_staff()). Un informe por run.';
```

- [ ] **Step 5: Correr y ver el verde del primer test**

```bash
npm test -w db 2>&1 | tail -15
```

Esperado: PASA el test del step 1.

- [ ] **Step 6: Los tests de quién NO puede leerlo**

Agregar a `db/src/informes.test.ts`:

```ts
test("🔴 un tenant NO lee el informe de otro", async () => {
  const filas = await db.asUser(
    { tenantId: s.tenantB, userId: s.equipoB },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "el tenant B no ve el informe del run del tenant A");
});

test("🔴 el rol `cliente` NO recibe el informe de SU PROPIO run", async () => {
  // `duenoA1` es el dueño del negocio A1: ve su run, y NO debe ver el informe — lleva el margen.
  const run = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "select id from kr_runs where id = $1",
    [s.runA1],
  );
  assert.equal(run.length, 1, "precondición: el cliente SÍ ve su run (si no, este test no prueba nada)");

  const filas = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "ve el run pero NO el informe");
});

test("🔴 un usuario SIN membresía tampoco: la allowlist falla cerrado", async () => {
  /*
   * Éste es un test DISTINTO del anterior y por eso son dos. Un `cliente` correctamente puesto NO caza
   * la forma que falla abierto: `'cliente' is distinct from 'cliente'` es FALSE, así que seguiría
   * negando. La forma rota solo se destapa con el rol AUSENTE, donde `NULL is distinct from 'cliente'`
   * da TRUE y concede visibilidad de maestro.
   */
  const filas = await db.asUser(
    { tenantId: s.tenantA, userId: s.intruso },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "sin membresía no hay rol, y sin rol no hay informe");
});

test("🔴 `app_render` no puede leer `kr_informes`: no tiene grant ni política", async () => {
  await assert.rejects(
    () => db.asRender("select informe_md from kr_informes"),
    (e: { code?: string }) => e.code === "42501",
    "el rol del renderizador anónimo no llega a la tabla: 42501 antes de evaluar RLS",
  );
});
```

- [ ] **Step 7: Los tests de las constraints (la fila no puede mentir, y el tope)**

```ts
test("🔴 la fila NO puede apuntar a un run de otro cliente: FK compuesta", async () => {
  await assert.rejects(
    () =>
      db.asOrquestador(
        { tenantId: s.tenantA },
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md) values ($1, $2, $3, $4)`,
        // El run existe y es del tenant A, pero el client_id es de OTRO cliente del mismo tenant.
        [s.runA1, s.tenantA, s.clientA2, MD],
      ),
    (e: { code?: string }) => e.code === "23503",
    "la FK compuesta (run_id, tenant_id, client_id) lo rechaza",
  );
});

test("🔴 un informe de más de 256 KiB se rechaza en la BASE", async () => {
  await assert.rejects(
    () =>
      db.asOrquestador(
        { tenantId: s.tenantA },
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
         select $1, $2, r.client_id, $3 from kr_runs r where r.id = $1
         on conflict (run_id) do update set informe_md = excluded.informe_md`,
        [s.runA1, s.tenantA, "x".repeat(262145)],
      ),
    (e: { code?: string; constraint?: string }) =>
      e.code === "23514" && e.constraint === "informe_tamano_razonable",
    "el check corta el dato patológico donde se escribe, no en el endpoint",
  );
});
```

- [ ] **Step 8: Verde completo del paquete**

```bash
npm test -w db 2>&1 | tail -15
```

Esperado: PASA todo (los 7 tests nuevos + los que ya había).

- [ ] **Step 9: Verificación por mutación — seis, una por garantía**

Correr **una por una**, confirmar que cae *exactamente* su test, y **restaurar** antes de la siguiente.
Trabajar sobre una copia de respaldo (`cp`), no con `git checkout`, para no arriesgar lo no commiteado.

| # | Mutación en `0016_informe_kr.sql` | Test que debe caer |
|---|---|---|
| 1 | borrar las dos líneas `grant` | "los DOS logins pueden usar la tabla" (42501) |
| 2 | quitar `tenant_id = app.current_tenant_id()` de la política | "un tenant NO lee el informe de otro" |
| 3 | quitar `and app.es_staff()` de la política | "el rol `cliente` NO recibe el informe" |
| 4 | cambiar `app.es_staff()` por `app.current_role() is distinct from 'cliente'` | "un usuario SIN membresía tampoco" — **y NO el del `cliente`** |
| 5 | bajar la FK compuesta a `references kr_runs(id)` | "la fila NO puede apuntar a un run de otro cliente" |
| 6 | quitar el `check informe_tamano_razonable` | "un informe de más de 256 KiB se rechaza" |

> **La mutación de `app_render` es distinta y va con las DOS mitades juntas:** `grant select on kr_informes
> to app_render` **y** agregar `app_render` al `to` de la política. Con solo el grant, para `app_render` no
> hay política aplicable y RLS devuelve cero filas de todas formas — el test seguiría en verde por la razón
> equivocada, y eso ya se midió una vez (`render_after_grant_rows=0`). Correrla así, con las dos, y
> confirmar que cae el test de `app_render`.

**Si alguna mutación no tumba nada, es un resultado:** averiguar si falta el test o si la línea no hace lo
que su comentario dice, y dejarlo escrito en el informe de la tarea.

- [ ] **Step 10: Commit**

```bash
git add db/migrations/0016_informe_kr.sql db/src/informes.test.ts db/src/testdb.ts
git commit -m "KR-2b: la tabla kr_informes, con sus grants y la política de staff"
```

---

### Task 2: `guardarInforme` y `getInforme` en el store

**Files:**
- Modify: `db/src/store.ts`, `db/src/index.ts`
- Test: `db/src/informe-store.test.ts`

**Interfaces:**
- Consumes: la tabla `kr_informes` (T1) y `TestDb.asOrquestador` (T1).
- Produces:
  - `export interface InformeRow { informe_md: string; generado_at: string }`
  - `PgStore.guardarInforme(ctx: TenantContext, runId: string, informeMd: string): Promise<void>` — lanza si
    el run no existe o no es visible.
  - `PgStore.getInforme(ctx: TenantContext, runId: string): Promise<InformeRow | null>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `db/src/informe-store.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PgStore } from "./store.js";
import { PglitePool } from "./pool.js";

/**
 * `guardarInforme` / `getInforme`: la escritura del orquestador y la lectura de la API.
 *
 * El store del orquestador se construye con rol `app_service` — el que su login tiene concedido — y el de
 * la API con `app_user`. No es un parámetro cosmético: es la credencial (ADR-17).
 */
let db: TestDb;
let s: Seed;
let servicio: PgStore;
let api: PgStore;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  const pool = new PglitePool(db.raw());
  servicio = new PgStore(pool, "app_service");
  api = new PgStore(pool, "app_user");
});
after(async () => {
  await db.close();
});

const ctxA = { tenantId: () => s.tenantA, userId: () => s.equipoA };

test("guarda el informe y lo lee de vuelta", async () => {
  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, "# Informe\n\nprimera versión");
  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  assert.equal(informe?.informe_md, "# Informe\n\nprimera versión");
  assert.ok(informe?.generado_at, "trae la fecha de generación");
});

test("🔴 un reintento REESCRIBE el informe en vez de fallar por PK duplicada", async () => {
  // El step del orquestador es durable y se reintenta. Sin `on conflict`, el segundo intento revienta con
  // 23505 y el run queda sin cerrar.
  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, "# Informe\n\nsegunda versión");
  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  assert.equal(informe?.informe_md, "# Informe\n\nsegunda versión", "gana el último render");
});

test("🔴 un reintento actualiza `generado_at`: es la fecha del ÚLTIMO render", async () => {
  /*
   * La pantalla muestra esta fecha y dice "refleja el brief original", así que tiene que significar UNA
   * sola cosa. Si el `do update` no la toca, queda la del primer render y la pantalla afirma una fecha
   * que no corresponde al texto que está mostrando.
   */
  const antes = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  await new Promise((r) => setTimeout(r, 5)); // `now()` tiene resolución de microsegundos; 5ms sobran.
  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, "# Informe\n\ntercera versión");
  const despues = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);

  assert.ok(
    new Date(despues!.generado_at).getTime() > new Date(antes!.generado_at).getTime(),
    `generado_at tiene que avanzar con el reintento: antes=${antes?.generado_at} despues=${despues?.generado_at}`,
  );
});

test("🔴 guardar el informe NO revoca las aprobaciones de las páginas", async () => {
  /*
   * La tabla propia hace que este bug ya no se herede de un `where` compartido con el upsert de páginas
   * (que es lo que pasaba cuando el informe era una columna de `kr_runs`). Pero NO es una garantía
   * estructural: `app_service` tiene `update` sobre `kr_pages`, así que nada en el esquema impide que
   * alguien agregue ese `update` acá. Lo que la tabla propia compra es que ahora hay que escribirlo a
   * propósito. El test existe para que escribirlo cueste un rojo.
   */
  await db.asOrquestador(
    { tenantId: s.tenantA },
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                           keyword_principal, intencion, local, evidencia, approved, retirada)
     values ($1, $2, $3, gen_random_uuid(), 'servicio', 'nueva', '/aprobada', 'kw', 'transaccional',
             false, 'respaldada', true, false)`,
    [s.tenantA, s.runA1, s.clientA1],
  );

  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, "# Informe\n\notra versión");

  const filas = await db.asUser<{ approved: boolean }>(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select approved from kr_pages where run_id = $1 and url_slug = '/aprobada'",
    [s.runA1],
  );
  assert.equal(filas[0]?.approved, true, "la aprobación de la compuerta sigue en pie");
});

test("🔴 un run que no existe o no es visible LANZA, no guarda en silencio", async () => {
  /*
   * Si el insert no encuentra el run, `select … where r.id = $1` no devuelve filas y el insert no escribe
   * NADA — sin error. El step del orquestador daría por hecho que guardó, el run se cerraría en
   * `pending_approval` y el invariante "un run en pending_approval siempre tiene informe" quedaría roto en
   * silencio. Por eso el método comprueba el `returning` y lanza.
   */
  await assert.rejects(
    () => servicio.guardarInforme({ tenantId: s.tenantA }, s.runB1, "# de otro tenant"),
    /no existe o no es visible/,
    "un run de otro tenant no se guarda ni se calla",
  );
});

test("un run sin informe devuelve null, no lanza", async () => {
  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runB1);
  assert.equal(informe, null, "no hay fila: null (el endpoint lo traduce a 200 con null)");
});
```

> **Antes de escribir el test, comprobar cómo los tests de `store.ts` construyen el `PgStore` sobre PGlite**
> (`db/src/store.test.ts`, alrededor de la línea 300) y usar **ese** patrón: `PglitePool`, `db.raw()` o el
> helper que exista. Si el nombre difiere, ajustar los imports de arriba — lo que no cambia es que hacen
> falta **dos** stores, uno por rol.

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm test -w db 2>&1 | tail -20
```

Esperado: FALLA con `servicio.guardarInforme is not a function`.

- [ ] **Step 3: Implementar los dos métodos**

En `db/src/store.ts`, junto a los demás métodos de la clase:

```ts
/** Lo que la API devuelve del informe. `generado_at` es la fecha del ÚLTIMO render, no del primero. */
export interface InformeRow {
  informe_md: string;
  generado_at: string;
}
```

```ts
  /**
   * Guarda el informe ya renderizado del run. Lo llama el ORQUESTADOR (rol `app_service`).
   *
   * El `client_id` NO lo aporta el llamador: se lee del propio run. Un parámetro sería una forma de que
   * la fila mintiera, y aunque la FK compuesta lo cazaría, es mejor que no haya nada que cazar.
   *
   * Idempotente: el step del orquestador es durable y se reintenta, así que un segundo intento tiene que
   * reescribir en vez de reventar con 23505. `generado_at` se actualiza a propósito — es la fecha del
   * render que se está guardando, y la pantalla la muestra junto al texto.
   */
  async guardarInforme(ctx: TenantContext, runId: string, informeMd: string): Promise<void> {
    await this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ run_id: string }>(
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
         select $1, $2, r.client_id, $3
           from kr_runs r
          where r.id = $1
         on conflict (run_id) do update
            set informe_md  = excluded.informe_md,
                generado_at = now()
         returning run_id`,
        [runId, ctx.tenantId, informeMd],
      );

      /*
       * Sin este guard, un run inexistente o de otro tenant NO da error: el `select` no devuelve filas,
       * el insert escribe cero y todo parece haber funcionado. El orquestador cerraría el run en
       * `pending_approval` sin informe y el invariante de §5.3 quedaría roto sin que nada avisara.
       */
      if (!rows[0]) {
        throw new Error(
          `El run ${runId} no existe o no es visible para este tenant: no se guarda informe.`,
        );
      }
    });
  }

  /** El informe del run, o `null` si no hay. Lo llama la API (rol `app_user`, staff vía RLS). */
  async getInforme(ctx: TenantContext, runId: string): Promise<InformeRow | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<InformeRow>(
        "select informe_md, generado_at from kr_informes where run_id = $1",
        [runId],
      );
      return rows[0] ?? null;
    });
  }
```

En `db/src/index.ts`, agregar `InformeRow` a los tipos exportados (mismo bloque que `RunSummary`).

- [ ] **Step 4: Correr y ver el verde**

```bash
npm test -w db 2>&1 | tail -15
```

- [ ] **Step 5: Verificación por mutación — cuatro**

| # | Mutación en `guardarInforme` | Test que debe caer |
|---|---|---|
| 1 | quitar `on conflict (run_id) do update …` (dejar el insert pelado) | "un reintento REESCRIBE el informe" (23505) |
| 2 | quitar `generado_at = now()` del `do update set` | "un reintento actualiza `generado_at`" |
| 3 | agregar `await tx.query("update kr_pages set approved = false where run_id = $1", [runId])` | "guardar el informe NO revoca las aprobaciones" |
| 4 | borrar el `if (!rows[0]) throw` | "un run que no existe o no es visible LANZA" |

- [ ] **Step 6: Commit**

```bash
git add db/src/store.ts db/src/index.ts db/src/informe-store.test.ts
git commit -m "KR-2b: guardarInforme y getInforme, con el client_id leído del run"
```

---

### Task 3: El step `guardar-informe` en el orquestador

**Files:**
- Modify: `orchestrator/src/workflow.ts` (entre `guardar-paginas` y `cerrar-run`)
- Test: `orchestrator/src/workflow.test.ts`

**Interfaces:**
- Consumes: `PgStore.guardarInforme(ctx, runId, informeMd)` (T2) y `renderReport(brief)` de `contrato`.
- Produces: el invariante **un run en `pending_approval` (o posterior) siempre tiene informe**.

> **Antes de escribir:** `orchestrator` ya depende de `db`, `kr-service` y `web-builder`, pero **no** de
> `contrato`. Hay que agregarlo a `orchestrator/package.json` (`"contrato": "*"`) y correr `npm install`
> desde la raíz. Comprobar también cómo el test existente construye el `store` mock — el step nuevo agrega
> un método al doble de prueba, y si el mock es un objeto literal hay que sumarle `guardarInforme`.

- [ ] **Step 1: El test que falla — el invariante**

Agregar a `orchestrator/src/workflow.test.ts`, siguiendo el patrón de los tests que ya hay:

```ts
test("🔴 un run que llega a `pending_approval` SIEMPRE tiene informe", async () => {
  /*
   * El invariante de la spec §5.3, y es el que hace que el mensaje de la pantalla no sea ambiguo: un run
   * sin informe es uno anterior a la 0016 o uno que nunca llegó a la compuerta, NO un fallo silencioso de
   * persistencia.
   *
   * El orden importa y es lo que este test fija: si `guardar-informe` fuera DESPUÉS de `cerrar-run`,
   * existiría una ventana en la que el run está en `pending_approval` sin informe — y como los tres steps
   * tienen transacciones separadas, no es una ventana teórica.
   */
  const guardados: Array<{ runId: string; md: string }> = [];
  const orden: string[] = [];
  // … montar el workflow con el store doble, registrando en `orden` cada llamada:
  //   savePages → orden.push("guardar-paginas")
  //   guardarInforme → orden.push("guardar-informe"); guardados.push({runId, md})
  //   finishRun → orden.push("cerrar-run")

  await correrWorkflow(); // el helper que ya usan los otros tests de este archivo

  assert.deepEqual(
    orden,
    ["guardar-paginas", "guardar-informe", "cerrar-run"],
    "el informe se guarda ANTES de cerrar el run, o el invariante tiene una ventana",
  );
  assert.equal(guardados.length, 1, "se guardó exactamente un informe");
  assert.match(guardados[0]!.md, /^# Keyword Research/, "es el Markdown de renderReport, no otra cosa");
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm test -w orchestrator 2>&1 | tail -20
```

Esperado: FALLA — `orden` no contiene `guardar-informe`.

- [ ] **Step 3: Agregar el step**

En `orchestrator/src/workflow.ts`, **entre** `guardar-paginas` y `cerrar-run`:

```ts
    /*
     * El informe, guardado ANTES de cerrar el run. Ese orden es el invariante: un run en
     * `pending_approval` siempre tiene informe (spec §5.3). Al revés existiría una ventana con el run ya
     * en la compuerta y sin informe, y como los tres steps tienen transacciones separadas no sería una
     * ventana teórica.
     *
     * El brief entero vive en la memoización de Inngest (`paso.run("research")`), así que un reintento de
     * este step lo tiene completo SIN volver a pagarle a DataForSEO. Y `guardarInforme` es idempotente,
     * así que el reintento reescribe en vez de reventar.
     */
    await paso.run("guardar-informe", async () => {
      const md = renderReport(brief);
      await deps.store.guardarInforme(ctx, runId, md);
      return md.length;
    });
```

Con el import arriba: `import { renderReport } from "contrato";`

- [ ] **Step 4: Correr y ver el verde**

```bash
npm test -w orchestrator 2>&1 | tail -15
```

- [ ] **Step 5: Verificación por mutación**

Mover el bloque `paso.run("guardar-informe", …)` **después** de `paso.run("cerrar-run", …)`. Debe caer el
test del invariante por el `deepEqual` del orden. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/workflow.ts orchestrator/src/workflow.test.ts orchestrator/package.json package-lock.json
git commit -m "KR-2b: el step guardar-informe, antes de cerrar el run"
```

---

### Task 4: Los dos endpoints

**Files:**
- Create: `api/src/informe-nombre.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/informe.test.ts`

**Interfaces:**
- Consumes: `PgStore.getInforme` y `getRun` / `getClient`.
- Produces:
  - `GET /runs/:id/informe` → `{ informe_md: string | null, generado_at: string | null }`; **404** solo si el
    run no existe o no es visible.
  - `GET /runs/:id/informe.md` → `text/markdown` + `Content-Disposition: attachment`; **404** si no hay
    informe.
  - `export function nombreArchivo(nombreCliente: string | null | undefined): string`

- [ ] **Step 1: El test que falla — `nombreArchivo`**

Crear `api/src/informe.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreArchivo } from "./informe-nombre.js";

/**
 * El `filename` del header de descarga es SUPERFICIE DE INYECCIÓN DE HEADER: sale del nombre del cliente,
 * que es texto que un humano escribe en el CRM. Un `\r\n` ahí parte la respuesta HTTP y un `"` rompe el
 * header. Se sanea con ALLOWLIST, no con lista de prohibidos: una denylist protege de lo que se le ocurrió
 * a quien la escribió.
 */
test("🔴 un nombre con CRLF no puede partir la respuesta HTTP", () => {
  const n = nombreArchivo('Bar\r\nX-Inyectado: si');
  assert.doesNotMatch(n, /[\r\n]/, "ni un solo carácter de control sobrevive");
  assert.equal(n, "informe-Bar-X-Inyectado-si.md");
});

test("🔴 una comilla doble no puede cerrar el header", () => {
  assert.doesNotMatch(nombreArchivo('Bar "El Bueno"'), /"/);
});

test("los acentos, la Ñ y los emoji se reemplazan, no se cuelan", () => {
  const n = nombreArchivo("Señor Ñandú 🍕");
  assert.match(n, /^informe-[A-Za-z0-9._-]+\.md$/, "solo caracteres de la allowlist");
  assert.doesNotMatch(n, /[ÑñúÚ🍕]/);
});

test("🔴 si tras sanear no queda nada, cae al fallback `informe.md`", () => {
  // El caso que se olvida. Un nombre entero fuera de la allowlist dejaría `informe-.md`, o peor, `informe-`.
  assert.equal(nombreArchivo("🍕🍕🍕"), "informe.md");
  assert.equal(nombreArchivo("---"), "informe.md");
  assert.equal(nombreArchivo(""), "informe.md");
  assert.equal(nombreArchivo(null), "informe.md");
  assert.equal(nombreArchivo(undefined), "informe.md");
});

test("los guiones consecutivos se colapsan y el largo se acota a 60", () => {
  assert.equal(nombreArchivo("A   B"), "informe-A-B.md");
  const largo = nombreArchivo("a".repeat(200));
  assert.equal(largo.length, "informe-".length + 60 + ".md".length);
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm test -w api 2>&1 | tail -15
```

- [ ] **Step 3: Implementar `nombreArchivo`**

Crear `api/src/informe-nombre.ts`:

```ts
/**
 * El `filename` del `Content-Disposition` de la descarga del informe.
 *
 * ALLOWLIST, no denylist: el valor sale del nombre del cliente, que lo escribe un humano en el CRM, y
 * termina dentro de un header HTTP. Un `\r\n` ahí parte la respuesta; un `"` cierra el header antes de
 * tiempo. Una denylist protege de lo que se le ocurrió a quien la escribió; una allowlist deja pasar
 * exactamente lo que se decidió.
 *
 * Los números son explícitos a propósito: un default sin número no es un default.
 */
const PERMITIDOS = /[^A-Za-z0-9._-]/g;
const LARGO_MAXIMO = 60;

export function nombreArchivo(nombreCliente: string | null | undefined): string {
  const base = (nombreCliente ?? "")
    .replace(PERMITIDOS, "-") // todo lo que no está en la allowlist, incluidos control y multibyte
    .replace(/-{2,}/g, "-") // "Bar   El Bueno" no se convierte en un tren de guiones
    .replace(/^[-.]+|[-.]+$/g, "") // ni empieza ni termina en separador; `..` queda vacío y cae al fallback
    .slice(0, LARGO_MAXIMO)
    .replace(/[-.]+$/g, ""); // el corte de arriba pudo dejar un separador colgando

  // Si tras sanear no queda ningún carácter de la allowlist, NO se devuelve "informe-.md": el nombre del
  // cliente puede ser entero no-ASCII, y ese es el caso que se olvida.
  return base ? `informe-${base}.md` : "informe.md";
}
```

- [ ] **Step 4: Verde de `nombreArchivo`**

```bash
npm test -w api 2>&1 | tail -15
```

- [ ] **Step 5: Los tests de los endpoints**

Agregar a `api/src/informe.test.ts`, con el patrón de los tests de API que ya existen (app sobre PGlite,
JWT firmados de verdad — **copiar el arranque de `api/src/app.test.ts`**, no inventarlo):

```ts
test("GET /runs/:id/informe — devuelve el informe al staff", async () => {
  const res = await pedir(`/runs/${runId}/informe`, tokenEquipo);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.informe_md, /^# Keyword Research/);
  assert.ok(body.generado_at);
});

test("🔴 un run que existe SIN informe → 200 con null, NO 404", async () => {
  /*
   * Un 404 mentiría: el run existe. El portal necesita distinguir "no hay run" de "hay run sin informe"
   * para decir cuál de las dos cosas pasa, en vez de mostrar un error genérico.
   */
  const res = await pedir(`/runs/${runSinInforme}/informe`, tokenEquipo);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { informe_md: null, generado_at: null });
});

test("un run inexistente o de otro tenant → 404", async () => {
  const res = await pedir(`/runs/${UUID_INEXISTENTE}/informe`, tokenEquipo);
  assert.equal(res.status, 404);
});

test("🔴 un run visible para el `cliente` pero cuyo informe no lo es se ve IGUAL que uno sin informe", async () => {
  /*
   * 200 con null, no 403. La API no debe revelar que existe algo que no puede mostrar — y no lo decide
   * con un `if` de rol: la política simplemente no le devuelve la fila (ADR-15).
   */
  const res = await pedir(`/runs/${runId}/informe`, tokenCliente);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { informe_md: null, generado_at: null });
});

test("GET /runs/:id/informe.md — baja como archivo, con el nombre saneado", async () => {
  const res = await pedir(`/runs/${runId}/informe.md`, tokenEquipo);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  const disp = res.headers.get("content-disposition") ?? "";
  assert.match(disp, /^attachment; filename="informe-[A-Za-z0-9._-]*\.md"$/);
  assert.match(await res.text(), /^# Keyword Research/);
});

test("🔴 sin informe, el .md es 404: no hay archivo que bajar", async () => {
  const res = await pedir(`/runs/${runSinInforme}/informe.md`, tokenEquipo);
  assert.equal(res.status, 404);
});
```

- [ ] **Step 6: Implementar los endpoints**

En `api/src/app.ts`, después de `GET /runs/:id`:

```ts
  /*
   * GET /runs/:id/informe — el informe para la pantalla.
   *
   * Tres resultados y son tres a propósito: 404 si el run no existe o no es visible; 200 con `null` si el
   * run existe y no hay informe; 200 con el informe si hay y quien pregunta puede verlo. Un `cliente` cae
   * en el segundo caso, porque la política no le devuelve la fila — y esto NO se decide acá con un `if`
   * de rol: lo decide Postgres (ADR-15). La API no debe revelar que existe algo que no puede mostrar.
   */
  app.get("/runs/:id/informe", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const run = await deps.store.getRun(ctx, id);
    if (!run) return c.json({ error: "Run no encontrado." }, 404);
    const informe = await deps.store.getInforme(ctx, id);
    return c.json({
      informe_md: informe?.informe_md ?? null,
      generado_at: informe?.generado_at ?? null,
    });
  });

  /*
   * GET /runs/:id/informe.md — la descarga. Acá la ausencia de informe SÍ es 404: no hay archivo.
   *
   * El `filename` sale del nombre del cliente y se sanea con allowlist (`nombreArchivo`), porque es texto
   * humano que termina dentro de un header HTTP.
   */
  app.get("/runs/:id/informe.md", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const informe = await deps.store.getInforme(ctx, id);
    if (!informe) return c.json({ error: "Informe no encontrado." }, 404);

    const run = await deps.store.getRun(ctx, id);
    const cliente = run ? await deps.store.getClient(ctx, run.client_id) : null;

    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${nombreArchivo(cliente?.nombre)}"`);
    return c.body(informe.informe_md);
  });
```

Con `import { nombreArchivo } from "./informe-nombre.js";` arriba.

- [ ] **Step 7: Verde del paquete**

```bash
npm test -w api 2>&1 | tail -15
```

- [ ] **Step 8: Verificación por mutación — cuatro**

| # | Mutación | Test que debe caer |
|---|---|---|
| 1 | en `/informe`, devolver `404` cuando `informe` es null | "un run que existe SIN informe → 200 con null" |
| 2 | en `/informe`, devolver `403` si `getInforme` da null y el rol no es staff | "se ve IGUAL que uno sin informe" |
| 3 | quitar el `nombreArchivo(...)` y poner `cliente?.nombre` crudo | el test del CRLF |
| 4 | en `nombreArchivo`, devolver `` `informe-${base}.md` `` sin el ternario del fallback | "cae al fallback `informe.md`" |

- [ ] **Step 9: Commit**

```bash
git add api/src/informe-nombre.ts api/src/app.ts api/src/informe.test.ts
git commit -m "KR-2b: los dos endpoints del informe, con el filename por allowlist"
```

---

### Task 5: El seed de la demo, y los tres huecos que se declaran

**Files:**
- Modify: `db/package.json` (dependencia `contrato`), `db/src/seed-demo.ts`,
  `portal/src/app/core/cartera-mock.ts`
- Test: `db/src/seed-demo.test.ts`, `db/src/cartera-portal.test.ts`

**Interfaces:**
- Consumes: la tabla (T1) y `renderReport` de `contrato`.
- Produces: el run de la demo con informe, **sin gastar $0.31**.

> **Por qué el seed NO usa `guardarInforme`.** `sembrarDemo(con: ConexionReservada)` abre su propio `begin`,
> escribe todo con `con.query(…)` y cierra con `commit`, mientras `PgStore.withTenant` **siempre** abre
> `pool.transaction` — otra conexión, que no vería el run sin confirmar. Llamarlo desde el seed fallaría por
> FK; llamarlo después del commit rompería la atomicidad. **No es una excepción nueva: es el precedente que
> ya existe** para las otras nueve tablas. Lo que sí tiene que ser único es el **render**, no el `INSERT`.

- [ ] **Step 1: Los tests que fallan**

Agregar a `db/src/seed-demo.test.ts`:

```ts
test("🔴 el run de la demo tiene informe, y no costó $0.31", async () => {
  const filas = await db.asService<{ informe_md: string }>(
    "select informe_md from kr_informes where run_id = $1",
    [DEMO_RUN_ID],
  );
  assert.equal(filas.length, 1, "sembrar la demo deja el informe listo para la pantalla");
  assert.match(filas[0]!.informe_md, /^# Keyword Research/);
});

test("🔴 el informe de la demo declara sus TRES huecos en vez de inventarlos", async () => {
  /*
   * El desglose de coste por proveedor y las dos coberturas se perdieron con `out/` (KR-1). El informe
   * tiene que decir `n/d`, no un `0` ni un número plausible: el sistema dice lo que sabe y lo que no. Y de
   * paso esto pone el camino de datos incompletos EN LA PANTALLA DE LA DEMO, así que si el endurecimiento
   * de KR-2a estuviera mal, se ve enseguida.
   */
  const [fila] = await db.asService<{ informe_md: string }>(
    "select informe_md from kr_informes where run_id = $1",
    [DEMO_RUN_ID],
  );
  const md = fila!.informe_md;

  assert.doesNotMatch(md, /NaN/, "nunca NaN");
  assert.match(md, /n\/d/, "los huecos se declaran");
  assert.match(md, /0\.3097/, "el total SÍ está medido y se muestra");
});

test("🔴 `calidad_datos` de la demo no afirma lo que no se midió", async () => {
  const [run] = await db.asService<{ calidad_datos: Record<string, unknown> }>(
    "select calidad_datos from kr_runs where id = $1",
    [DEMO_RUN_ID],
  );
  const cd = run!.calidad_datos;

  assert.equal(cd["cobertura_volumen"], null, "era 0.571 por PÁGINA, no por keyword: no se sabe");
  assert.equal(cd["cobertura_kd"], null, "no quedó registrado");
  assert.equal(
    cd["endpoints_degradados"],
    null,
    "`[]` diría «ninguno falló», y la corrida no registró NADA sobre endpoints: es una certeza inventada",
  );
  assert.equal(cd["keywords_analizadas"], 55, "esto sí está medido");
  // Los dos campos cuyo NOMBRE mentía (son páginas, no keywords) y que `DataQuality` no define.
  assert.ok(!("keywords_con_volumen" in cd), "se fue");
  assert.ok(!("keywords_totales" in cd), "se fue");
});
```

Y agregar a `db/src/cartera-portal.test.ts` el test que **hoy no existe** — el archivo compara nueve campos
de página y **no mira `calidad_datos`**:

```ts
test("🔴 el seed y el mock del portal dicen lo MISMO en `calidad_datos`", async () => {
  /*
   * Este test no existía, y la spec afirmaba que `cartera-portal.test.ts` ya ataba esto: compara nueve
   * campos de PÁGINA y de `calidad_datos` no dice nada. Sin él, cambiar la calidad en un lado deja al
   * dashboard del portal mostrando una cobertura que la base ya no tiene, y nada avisa.
   */
  const { RUN_REAL } = await cargarMock();
  const delSeed = CALIDAD_DATOS_DEMO; // exportado por seed-demo.ts (ver step 3)

  assert.deepEqual(
    RUN_REAL.calidad_datos,
    delSeed,
    "la calidad de datos que muestra el portal es la que siembra el seed",
  );
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm test -w db 2>&1 | tail -20
```

- [ ] **Step 3: `contrato` como dependencia de `db`, y el seed**

En `db/package.json`, agregar a `dependencies`: `"contrato": "*"`. Después, desde la raíz:

```bash
npm install
```

En `db/src/seed-demo.ts`:

```ts
import { renderReport, SCHEMA_VERSION } from "contrato";
import type { KeywordResearchBrief } from "contrato";
```

```ts
/**
 * La calidad de datos de la corrida real, con sus huecos DECLARADOS.
 *
 * Se exporta porque el mock del portal tiene que decir lo mismo, y hay un test que los ata
 * (`cartera-portal.test.ts`). Tres de los cuatro campos son `null` a propósito: el dato se perdió con
 * `out/` en KR-1, y sembrar un número plausible sería inventarlo. `endpoints_degradados` también va
 * `null` y NO `[]`: `[]` significa "ninguno falló", que es una afirmación, y esta corrida no registró
 * nada sobre endpoints.
 */
export const CALIDAD_DATOS_DEMO = {
  cobertura_volumen: null,
  cobertura_kd: null,
  endpoints_degradados: null,
  keywords_analizadas: 55,
} as const;
```

Reemplazar el `JSON.stringify({ cobertura_volumen: 0.571, keywords_con_volumen: 8, keywords_totales: 14 })`
del insert de `kr_runs` por `JSON.stringify(CALIDAD_DATOS_DEMO)`.

Y **después** del loop que inserta las 14 páginas, dentro de la misma transacción:

```ts
    /*
     * --- El informe de la demo ---
     *
     * Se renderiza con `renderReport` (el MISMO render que usa el orquestador: la lógica del informe tiene
     * un solo dueño) y se inserta con `con.query`, dentro de esta transacción. No usa
     * `PgStore.guardarInforme` porque ese abre su propia transacción en otra conexión y no vería el run
     * todavía sin confirmar — es el mismo motivo por el que el seed inserta a mano las otras nueve tablas.
     *
     * Que la demo tenga informe sin correr DataForSEO es la mitad del valor; la otra es que el informe
     * sale con TRES HUECOS (`n/d`), así que la pantalla de la demo ejercita el camino de datos
     * incompletos. Si el endurecimiento de KR-2a estuviera mal, se ve en la demo y no en producción.
     */
    const briefDemo: KeywordResearchBrief = {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      cliente: NOMBRE_CLIENTE_DEMO,
      generated_at: new Date(Date.UTC(2026, 6, 30, 0, 16, 15)).toISOString(),
      market: { country: "ES", language_code: "es", location_code: 2724 },
      paginas_propuestas: /* mapear PAGINAS_DEMO a la forma de ProposedPage */,
      backlog: [], // qué clusters quedaron fuera no se registró; con [] la sección no se pinta
      meta_run: {
        keywords_analizadas: CALIDAD_DATOS_DEMO.keywords_analizadas,
        paginas_propuestas: PAGINAS_DEMO.length,
        coste_micros_usd: COSTE_MICROS_DEMO,
        coste_breakdown: {}, // el desglose no quedó registrado: el informe muestra el total y lo dice
        calidad_datos: CALIDAD_DATOS_DEMO,
        modelos_sin_precio: [],
      },
    };

    await con.query(
      `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
       values ($1, $2, $3, $4)`,
      [runId, tenantId, clientId, renderReport(briefDemo)],
    );
```

> **El mapeo de `PAGINAS_DEMO` a `ProposedPage` es trabajo real, no un `as`.** Comprobar campo por campo
> contra `contrato/src/tipos.ts` y **no** silenciar diferencias con `as unknown as`: si un campo del seed no
> encaja, la pregunta es cuál de los dos está mal. `tsc` es la red acá.

En `portal/src/app/core/cartera-mock.ts`, reemplazar
`calidad_datos: { cobertura_volumen: 0.571, keywords_con_volumen: 8, keywords_totales: 14 }` por la misma
forma que exporta el seed (los cuatro campos, tres en `null`).

- [ ] **Step 4: Verde de los dos paquetes**

```bash
npm test -w db 2>&1 | tail -15
npm --prefix portal test 2>&1 | tail -15
```

- [ ] **Step 5: Verificación por mutación — dos**

| # | Mutación | Test que debe caer |
|---|---|---|
| 1 | sembrar `endpoints_degradados: []` en vez de `null` | "no afirma lo que no se midió" |
| 2 | cambiar `cobertura_volumen` a `0.571` **solo en el mock del portal** | "el seed y el mock dicen lo MISMO" |

- [ ] **Step 6: Commit**

```bash
git add db/package.json db/src/seed-demo.ts db/src/seed-demo.test.ts db/src/cartera-portal.test.ts \
        portal/src/app/core/cartera-mock.ts package-lock.json
git commit -m "KR-2b: el informe de la demo, con sus tres huecos declarados"
```

---

### Task 6: El parser de Markdown del portal

**Files:**
- Create: `portal/src/app/core/markdown.ts`
- Test: `portal/src/app/core/markdown.test.ts`

**Interfaces:**
- Consumes: nada — recibe un `string`. **Independiente de las tareas 1-5**, se puede hacer en cualquier
  momento.
- Produces:

```ts
export type Inline =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'negrita'; valor: string }
  | { tipo: 'cursiva'; valor: string }
  | { tipo: 'codigo'; valor: string };

export type Bloque =
  | { tipo: 'encabezado'; nivel: 1 | 2 | 3; texto: Inline[] }
  | { tipo: 'parrafo'; texto: Inline[] }
  | { tipo: 'lista'; items: Inline[][] }
  | { tipo: 'cita'; texto: Inline[] }
  | { tipo: 'tabla'; cabecera: Inline[][]; filas: Inline[][][] };

export function parsearMarkdown(md: string): Bloque[];
```

> **Por qué un parser propio y no `marked` + `DOMPurify`.** Esa pareja falla **abierto**: si el sanitizador
> se configura mal, pasa todo. Y `bypassSecurityTrustHtml` es exactamente lo que Angular tiene para no usar.
> Acá el Markdown se convierte en **datos** y se pinta con `@if`/`@for`, así que Angular escapa el texto por
> defecto: **la inyección de HTML/JS es imposible por construcción, no evitada por configuración.** Fijate
> en el tipo: `Inline` solo contiene `string`s, así que no hay forma de que el parser produzca HTML.
>
> Y el subconjunto es cerrado porque **escribimos el generador**: lo que `renderReport` emite y nada más.
> Cualquier cosa fuera del conjunto se pinta como **texto literal** — falla cerrado.

- [ ] **Step 1: Los tests que fallan**

Crear `portal/src/app/core/markdown.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearMarkdown } from './markdown.js';

test('encabezados de los tres niveles', () => {
  const bs = parsearMarkdown('# Uno\n\n## Dos\n\n### Tres');
  assert.deepEqual(
    bs.map((b) => [b.tipo, b.tipo === 'encabezado' ? b.nivel : null]),
    [['encabezado', 1], ['encabezado', 2], ['encabezado', 3]],
  );
});

test('una tabla con cabecera y filas', () => {
  const bs = parsearMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.equal(bs.length, 1);
  const t = bs[0]!;
  assert.equal(t.tipo, 'tabla');
  if (t.tipo !== 'tabla') return;
  assert.equal(t.cabecera.length, 2);
  assert.equal(t.filas.length, 2);
});

test('listas, citas y énfasis', () => {
  const bs = parsearMarkdown('- uno\n- dos\n\n> una cita\n\nun **fuerte** y un _suave_ y un `codigo`');
  assert.equal(bs[0]?.tipo, 'lista');
  assert.equal(bs[1]?.tipo, 'cita');
  const p = bs[2]!;
  assert.equal(p.tipo, 'parrafo');
  if (p.tipo !== 'parrafo') return;
  assert.deepEqual(
    p.texto.filter((i) => i.tipo !== 'texto').map((i) => [i.tipo, i.valor]),
    [['negrita', 'fuerte'], ['cursiva', 'suave'], ['codigo', 'codigo']],
  );
});

test('🔴 el HTML crudo NO es una marca: sale como TEXTO', () => {
  /*
   * La garantía central. El informe lleva texto de LLM (h1, meta_description, FAQs), así que el paso
   * Markdown → pantalla es por definición superficie de inyección. Acá se comprueba que el parser no
   * produce ninguna estructura "html": lo único que puede salir son strings, que Angular escapa.
   */
  for (const hostil of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '<div onclick="alert(1)">hola</div>',
  ]) {
    const bs = parsearMarkdown(hostil);
    const plano = JSON.stringify(bs);
    assert.equal(bs.length, 1);
    assert.equal(bs[0]?.tipo, 'parrafo', `${hostil} tiene que ser un párrafo de texto`);
    assert.match(plano, /"tipo":"texto"/, 'el contenido va como texto');
    assert.doesNotMatch(plano, /"tipo":"html"/, 'no existe un bloque html, y no debe existir nunca');
  }
});

test('🔴 una marca DESCONOCIDA se pinta literal, no se interpreta a medias', () => {
  // Falla cerrado: lo que el generador no emite, el parser no inventa.
  const bs = parsearMarkdown('![una imagen](http://ejemplo.com/x.png)');
  assert.equal(bs[0]?.tipo, 'parrafo');
  assert.match(JSON.stringify(bs), /!\[una imagen\]/, 'se ve tal cual, como texto');
});

test('un informe con datos ausentes se parsea sin perder los `n/d`', () => {
  const bs = parsearMarkdown('| Proveedor | Coste |\n|---|---|\n| DataForSEO | n/d |');
  assert.match(JSON.stringify(bs), /n\/d/);
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
npm --prefix portal test 2>&1 | tail -20
```

- [ ] **Step 3: Implementar el parser**

Crear `portal/src/app/core/markdown.ts` con los tipos de arriba y la implementación: recorrer las líneas,
detectar `#{1,3} `, `| … |` (con la fila de guiones como separador de cabecera), `- `, `> `, y agrupar el
resto en párrafos; el inline con una única pasada que reconoce `` `código` ``, `**negrita**` y `_cursiva_`,
y **todo lo demás** como `{ tipo: 'texto' }`.

Reglas que el código tiene que cumplir, y que los tests de arriba fijan:

- **No existe** ninguna variante `html` en `Bloque` ni en `Inline`. Si alguien la agrega, el test la caza.
- Una línea que no encaja en ninguna forma conocida es **texto de párrafo**, nunca se descarta ni se
  interpreta a medias.
- Una tabla sin fila de guiones no es tabla: es un párrafo (el generador siempre la emite, así que su
  ausencia significa que eso no era una tabla).

- [ ] **Step 4: Verde**

```bash
npm --prefix portal test 2>&1 | tail -15
```

- [ ] **Step 5: Verificación por mutación — dos**

| # | Mutación | Test que debe caer |
|---|---|---|
| 1 | agregar un caso que devuelva `{ tipo: 'html', valor: linea }` cuando la línea empieza con `<` | "el HTML crudo NO es una marca" |
| 2 | descartar en silencio las líneas que no encajan (en vez de hacerlas párrafo) | "una marca DESCONOCIDA se pinta literal" |

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/core/markdown.ts portal/src/app/core/markdown.test.ts
git commit -m "KR-2b: el parser de Markdown del portal, sin innerHTML por construcción"
```

---

### Task 7: La pantalla, el link y el barrido de `innerHTML`

**Files:**
- Create: `portal/src/app/pages/informe/informe.ts`, `portal/src/app/pages/informe/informe.spec.ts`,
  `portal/src/app/core/sin-html-crudo.test.ts`
- Modify: `portal/src/app/core/api-core.ts`, `portal/src/app/core/models.ts`,
  `portal/src/app/services/api.ts`, `portal/src/app/pages/brief/brief.ts`,
  `portal/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `GET /runs/:id/informe` y `/informe.md` (T4), `parsearMarkdown` (T6).
- Produces: la ruta `runs/:id/informe`; `ClienteApi.verInforme(runId): Promise<Informe>` y
  `urlInformeMd(runId): string`; `interface Informe { informe_md: string | null; generado_at: string | null }`.

- [ ] **Step 1: El test que falla — el barrido del árbol**

Crear `portal/src/app/core/sin-html-crudo.test.ts`, con el patrón que el portal **ya usa** para los colores
incrustados (`contraste.test.ts`: recorre `src/app` con `readdirSync` en vez de listar archivos, así que
cubre también las pantallas que todavía no existen):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ninguna plantilla del portal pinta HTML crudo.
 *
 * El informe lleva texto generado por LLM, así que el paso Markdown → pantalla es superficie de inyección.
 * La defensa es estructural —el Markdown se parsea a datos y se pinta con `@if`/`@for`, y Angular escapa
 * el texto por defecto—, y este test es lo que impide que alguien la desarme con un atajo.
 *
 * Recorre el árbol en vez de listar archivos: un test que enumera se queda viejo con la próxima pantalla,
 * y ésta es exactamente la clase de garantía que no puede depender de que alguien se acuerde.
 */
const PROHIBIDO = /\[innerHTML\]|\.innerHTML|bypassSecurityTrustHtml/;

test('🔴 ninguna plantilla usa innerHTML ni bypassSecurityTrustHtml', () => {
  const raiz = new URL('..', import.meta.url).pathname;
  const hallazgos: string[] = [];

  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|html)$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        const texto = readFileSync(ruta, 'utf8');
        for (const [i, linea] of texto.split('\n').entries()) {
          if (PROHIBIDO.test(linea)) hallazgos.push(`${ruta}:${i + 1}: ${linea.trim()}`);
        }
      }
    }
  };
  recorrer(raiz);

  assert.deepEqual(
    hallazgos,
    [],
    `HTML crudo en el portal:\n${hallazgos.join('\n')}\n` +
      `Si hace falta pintar Markdown, se parsea a datos (core/markdown.ts) y se dibuja con @if/@for.`,
  );
});
```

- [ ] **Step 2: Correr — debe pasar en verde ya (todavía no hay `innerHTML`)**

```bash
npm --prefix portal test 2>&1 | tail -10
```

> Este test nace **en verde**, y eso está bien: es una red, no la prueba de un arreglo. Su valor se
> comprueba en el paso 8 con la mutación — que es la única forma de saber que muerde.

- [ ] **Step 3: El contrato del cliente HTTP**

En `portal/src/app/core/models.ts`:

```ts
/** El informe del research, tal como lo devuelve la API. `null` = no hay, o no es visible para este rol. */
export interface Informe {
  informe_md: string | null;
  generado_at: string | null;
}
```

En `portal/src/app/core/api-core.ts`, en `ClienteApi` y en `crearApi` (mismo patrón que `verBrief`):

```ts
  verInforme(runId: string): Promise<Informe>;
  /** La URL de descarga. Es un `<a href>` normal: el navegador la baja, no pasa por `pedir`. */
  urlInformeMd(runId: string): string;
```

```ts
    verInforme(runId) {
      return pedir<Informe>('GET', `/runs/${encodeURIComponent(runId)}/informe`);
    },
    urlInformeMd(runId) {
      return `${opts.base}/runs/${encodeURIComponent(runId)}/informe.md`;
    },
```

> **Comprobar cómo `crearApi` recibe la base de la URL** (el nombre real de la opción) y usarlo. Y si la
> descarga necesita el token —lo necesita, la API pide `Authorization`— resolverlo **sin** poner el token en
> la URL: lo correcto es pedir el `.md` con `fetch` autenticado y disparar la descarga con un `Blob` +
> `URL.createObjectURL`. Un token en la query string queda en logs e historial.

En `portal/src/app/services/api.ts`, exponer los dos: `readonly verInforme = this.cliente.verInforme;` y
`readonly urlInformeMd = this.cliente.urlInformeMd;`

- [ ] **Step 4: La pantalla**

Crear `portal/src/app/pages/informe/informe.ts`: componente standalone con signals, que
1. carga `verInforme(runId)`,
2. si `informe_md` es `null`, muestra el mensaje de que no hay informe (**no** un spinner infinito ni un
   error),
3. si hay, lo pasa por `parsearMarkdown` y lo pinta con `@if`/`@for` sobre los tipos de `Bloque`,
4. muestra el aviso de que el informe está congelado:

```
Informe generado el <fecha>. Refleja el brief original; las ediciones posteriores del revisor no están incluidas.
```

5. y ofrece el botón de descarga.

**La tabla tiene que poder scrollear sola** (`overflow-x: auto` en su contenedor): en 390 px el informe
tiene tablas de 6 columnas, y lo que no puede pasar es que la **página** scrollee en horizontal.

- [ ] **Step 5: La ruta y el link**

En `portal/src/app/app.routes.ts`, como hija del shell, junto a `runs/:id`:

```ts
      {
        path: 'runs/:id/informe',
        loadComponent: () => import('./pages/informe/informe').then((m) => m.InformePage),
      },
```

En `portal/src/app/pages/brief/brief.ts`, agregar el link — **aparece siempre**, incluso si el run no tiene
informe: esconderlo haría que nadie sepa que la función existe, y es la pantalla la que explica qué pasa.

- [ ] **Step 6: El test de componente**

Crear `portal/src/app/pages/informe/informe.spec.ts` (Karma), con el patrón de los `.spec.ts` que ya hay:
que con un `informe_md` que contiene `<script>` **no** aparece un `<script>` en el DOM y sí el texto; y que
con `informe_md: null` se ve el mensaje.

- [ ] **Step 7: Verde de las dos suites del portal**

```bash
npm --prefix portal test 2>&1 | tail -15
npm --prefix portal run test:components 2>&1 | tail -15
```

- [ ] **Step 8: Verificación por mutación — dos**

| # | Mutación | Test que debe caer |
|---|---|---|
| 1 | poner `<div [innerHTML]="md()"></div>` en la plantilla del informe | "ninguna plantilla usa innerHTML" |
| 2 | borrar el `routerLink` al informe de `brief.ts` | el test del link (agregarlo si no existe) |

- [ ] **Step 9: Commit**

```bash
git add portal/src/app/pages/informe portal/src/app/core/sin-html-crudo.test.ts \
        portal/src/app/core/api-core.ts portal/src/app/core/models.ts portal/src/app/services/api.ts \
        portal/src/app/pages/brief/brief.ts portal/src/app/app.routes.ts
git commit -m "KR-2b: la pantalla del informe, el link y la red contra el HTML crudo"
```

---

## Cierre de la etapa (sesión principal, no un subagente)

- [ ] **`npm run verificar -- --con-portal`** en verde, con el output a la vista. La cifra de tests que
      imprime es **la** cifra: sincronizarla donde aparezca (`09`, `08`, `11`, los dos README).
- [ ] **Manejar la app en el navegador** (MCP chrome-devtools) — es la mitad del ritual que ningún script
      cubre, y en este proyecto ya encontró cosas varias veces. Concretamente: el informe **en claro y en
      oscuro**, la tabla **sin scroll horizontal de página en 390 px**, la descarga bajando un archivo con
      el nombre correcto, un run **sin** informe mostrando su mensaje, y la **consola limpia**.
      Levantar con `npm run dev:server -w api` (PGlite, sin credenciales).
- [ ] **Documentación** (paso 3 del ritual): `docs/proyecto/09-estado-y-roadmap.md` (KR-2 pasa a hecho),
      `docs/proyecto/11-plan-fase-2.md`, `progress/history.md` (una entrada) y `progress/current.md`.
      Actualizar **ADR-07** si el informe cierra alguna promesa vieja, y `docs/proyecto/06-contrato-handoff.md`
      si el contrato cambió de forma.
- [ ] **`CHECKPOINTS.md`:** agregar la línea que la spec pide y que esta etapa estrena — *toda tabla nueva
      necesita su `grant`, y el test que lo prueba es un `insert`/`select` con el login real, no con el
      superuser*. `kr_informes` es la primera tabla del proyecto desde que existen los cuatro logins, así
      que el paso no estaba en ninguna rutina.
- [ ] **Migraciones:** anotar que la `0016` queda **escrita y sin desplegar**, junto a `0011`, `0012` y
      `0015`. La próxima libre pasa a ser la `0017`.
- [ ] Commit + push a `main`.

---

## Lo que este plan NO hace, a propósito

PDF · envío por email · una variante del informe **para el cliente** (sin coste) · versionado de informes ·
regenerar por lote los informes de runs viejos · gráficos.

Y dos cosas que quedan **abiertas con nombre**, porque no son de esta pieza:

- **El margen sigue siendo legible por el rol `cliente`** en `kr_runs` (`coste_micros_usd`,
  `coste_breakdown`), vía `app.ve_cliente(client_id)`. **KR-2b no lo causa ni lo empeora** —el informe queda
  fuera de su alcance— pero tampoco lo cierra: eso toca `RunSummary` y la pantalla del brief, y es una pieza
  propia.
- **El informe de la demo sale con tres huecos** hasta que exista el dataset crudo (~$0.31, ~16 min contra
  DataForSEO en producción, **decide Juan**). Es la consecuencia declarada en §8.1, no una deuda de este
  plan. Y si se corre: **volver a sandbox** en `kr-service/.env`.

---

## Auto-revisión de este plan

**Cobertura de la spec**, sección por sección: §4.3 dos productores → T3 y T5. §5.1 tabla, grants, política →
T1. §5.2 idempotencia y que no revoca aprobaciones → T2. §5.3 el step y el invariante → T3. §6 endpoints y
el `filename` → T4. §7.1 el parser sin `innerHTML` → T6 y T7. §7.2 lo que la pantalla dice de sí misma →
T7 step 4. §8 el seed → T5. §9 la matriz de mutaciones → repartida en los steps de mutación de cada tarea,
**las 28 filas**. §11 el riesgo del 7º workspace → ya cerrado en KR-2a.

**Tres huecos que esta auto-revisión encontró y que quedan resueltos arriba, no pendientes:**

1. **`TestDb.asService` es superuser y no puede probar la política ni los grants** — la spec lo advertía en
   una nota, pero no existía el helper que sí puede. T1 lo agrega (`asOrquestador`), y se midió que la
   diferencia es real: 42501 con el rol asumido, `ok` como superuser.
2. **`guardarInforme` podía no guardar nada y no avisar** — el `insert … select … where r.id = $1` escribe
   cero filas si el run no es visible, sin error. Sin el guard del `returning`, el invariante de §5.3 se
   rompía en silencio. Tiene test y mutación propios (T2).
3. **`orchestrator` no dependía de `contrato`** y **`db` tampoco** — los dos hacen falta (uno para
   `renderReport` en el step, el otro para el seed). Está explícito en T3 y T5, con el `npm install`.

**Tipos y nombres, cruzados entre tareas:** `InformeRow` (T2) → lo consume T4. `Informe` (T7, portal) es
**otro** tipo a propósito: es la forma del JSON del endpoint, con los dos campos nullable. `guardarInforme`
/ `getInforme` / `nombreArchivo` / `parsearMarkdown` / `verInforme` / `urlInformeMd` se escriben igual en
todas las tareas donde aparecen. `CALIDAD_DATOS_DEMO` lo exporta T5 y lo consume el test de T5.

**Lo que este plan deja como trabajo real y no como copia:** el mapeo de `PAGINAS_DEMO` a `ProposedPage`
(T5 step 3), la implementación del parser (T6 step 3) y la plantilla de la pantalla (T7 step 4). En los tres
casos el plan fija el **contrato y los tests**, y deja la escritura al implementador — con la advertencia
explícita de no silenciar a `tsc` con un `as` en el primero.
