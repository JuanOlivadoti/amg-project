import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb } from "./testdb.js";

/**
 * `force row level security`, barrida sobre TODO el esquema `public` — no una tabla puntual.
 *
 * Por qué un barrido y no un test por tabla: `db/src/informes.test.ts` (y `resenas.test.ts`, y
 * varios más) ya prueban RLS de ACCESO para su tabla — que un rol no ve lo que no debería. Eso no
 * cubre el flag `force`: sin él, el DUEÑO de la tabla (quien corre las migraciones) salta las
 * políticas enteras, y ese agujero no se nota en un test de aislamiento porque los tests de
 * aislamiento nunca corren como dueño. Un test por tabla, además, es una lista que hay que acordarse
 * de extender cada vez que se agrega una tabla nueva — y "acordarse" es exactamente lo que falló acá
 * (fue la fila de deuda que motivó este archivo: `kr_informes` tenía `force`, pero nada lo probaba).
 *
 * Investigado ANTES de escribir el barrido (no asumido): en las 21 migraciones actuales, TODA tabla
 * de `public` que lleva `enable row level security` lleva también `force row level security`, en la
 * línea siguiente — 12 de 12 (`tenants`, `memberships`, `clients`, `kr_runs`, `kr_keywords`,
 * `kr_pages`, `kr_metrics_cache`, `kr_serp_cache`, `kr_provider_tasks`, `ideas`, `kr_informes`,
 * `resenas_google`). No hay ninguna tabla con RLS habilitada y `force` deliberadamente ausente.
 *
 * La única tabla del proyecto que corre SIN `force` es `app.migraciones_aplicadas`
 * (`db/src/deploy.ts`), y no es la excepción a esta regla: no tiene RLS habilitada EN ABSOLUTO — la
 * protege la ausencia de grants, no una política. Vive en el schema `app`, así que este barrido
 * (filtrado a `public`) ni siquiera la ve; y no la crea `aplicarMigraciones` (la que usa `TestDb`,
 * abajo) sino solo `migrarConRegistro`, el runner de despliegue — por eso su propio test vive en
 * `db/src/deploy.test.ts` ("el registro NO tiene RLS"), no acá: repetirlo acá con `TestDb` sería un
 * test que pasa por el motivo equivocado, porque la tabla ni siquiera existiría en ese escenario.
 *
 * Si el día de mañana alguien necesita una tabla de `public` con RLS habilitada pero SIN force por
 * diseño (un caso "el dueño necesita bypassear la política"), este test tiene que aprender a
 * distinguirla — hoy no hace falta, porque no existe.
 */

let db: TestDb;

before(async () => {
  db = await TestDb.create();
});

after(async () => {
  await db.close();
});

test("RLS: toda tabla de `public` con RLS habilitada también la tiene FORZADA", async () => {
  const rows = await db.asService<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  `);

  // Guarda contra la trampa de un barrido que recorre cero filas y pasa en verde sin haber
  // comprobado nada: si el glob de tablas viniera vacío (esquema mal migrado, filtro mal escrito),
  // esto lo dice antes de que la aserción de abajo pase "por descarte".
  assert.ok(rows.length > 0, "el esquema public debería tener tablas — si esto falla, el barrido no está viendo nada");

  const conRls = rows.filter((r) => r.relrowsecurity);
  assert.ok(
    conRls.length > 0,
    "debería haber al menos una tabla con RLS habilitada — si esto falla, el filtro está mal, no el esquema",
  );

  const sinForzar = conRls.filter((r) => !r.relforcerowsecurity);
  assert.deepEqual(
    sinForzar.map((r) => r.relname),
    [],
    "toda tabla con `enable row level security` necesita también `force`: sin FORCE, el dueño de la " +
      "tabla (quien corre las migraciones) salta las políticas enteras — ver AGENTS.md / ADR sobre RLS",
  );
});

test("RLS: `app.migraciones_aplicadas` no entra en el barrido — vive en `app`, no en `public`", async () => {
  // `TestDb.create()` corre `aplicarMigraciones` (db/src/migrate.ts), que NO crea el registro de
  // despliegue: eso lo hace solo `migrarConRegistro` (db/src/deploy.ts), probado aparte en
  // `db/src/deploy.test.ts`. Acá solo confirmamos que la tabla, sencillamente, no existe en este
  // escenario — así el barrido de arriba no la está "aprobando" por accidente.
  const rows = await db.asService(`
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'migraciones_aplicadas'
  `);

  assert.equal(rows.length, 0, "aplicarMigraciones no crea el registro de despliegue");
});
