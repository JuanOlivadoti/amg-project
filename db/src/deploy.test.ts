import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrarConRegistro, ConexionReservada } from "./deploy.js";

/** PGlite es una sola conexión → una `ConexionReservada` válida para los tests. */
const con = (pg: PGlite) => ConexionReservada.desdePglite(pg);

/**
 * Tests del runner de migraciones para una base REMOTA que persiste (Fase 1: Supabase).
 *
 * La diferencia con `aplicarMigraciones` (que corre en cada test sobre una base nueva) es que acá la
 * base NO se descarta: correr las migraciones dos veces tiene que ser seguro. Muchas sentencias de
 * las migraciones NO son idempotentes (`create table`, `create type`, `create policy`, `add
 * constraint`), así que sin un registro de lo ya aplicado la segunda corrida revienta. Ese registro
 * es exactamente lo que este runner agrega y lo que estos tests fijan.
 *
 * PGlite es Postgres real (WASM): prueba la semántica de verdad —transacciones, roles, RLS— sin
 * credenciales ni red, igual que el resto del proyecto.
 */

test("migrarConRegistro: aplica todas las migraciones en orden en una base nueva y registra cada una", async () => {
  const pg = new PGlite();
  try {
    const aplicadas = await migrarConRegistro(con(pg));

    assert.ok(aplicadas.length >= 9, `esperaba >=9 migraciones, aplicó ${aplicadas.length}`);
    assert.deepEqual(aplicadas, [...aplicadas].sort(), "se aplican en orden alfabético (0001, 0002, …)");

    const { rows } = await pg.query<{ nombre: string }>(
      "select nombre from app.migraciones_aplicadas order by nombre",
    );
    assert.deepEqual(
      rows.map((r) => r.nombre),
      aplicadas,
      "el registro tiene exactamente las migraciones que dijo haber aplicado",
    );
  } finally {
    await pg.close();
  }
});

test("migrarConRegistro: re-ejecutar NO re-aplica y no lanza (idempotente)", async () => {
  const pg = new PGlite();
  try {
    const primera = await migrarConRegistro(con(pg));
    // Sin el registro, esto lanzaría: `create table tenants` / `create type user_role` ya existen.
    const segunda = await migrarConRegistro(con(pg));

    assert.ok(primera.length > 0, "la primera corrida aplica migraciones");
    assert.equal(segunda.length, 0, "la segunda corrida no aplica ninguna");
  } finally {
    await pg.close();
  }
});

test("migrarConRegistro: crea los roles y deja RLS forzada (cierra el requisito del §A.1)", async () => {
  const pg = new PGlite();
  try {
    await migrarConRegistro(con(pg));

    const { rows: roles } = await pg.query<{ rolname: string }>(
      `select rolname from pg_roles
       where rolname in ('amg_api','amg_render','amg_cache','app_render','app_user','app_service')
       order by rolname`,
    );
    assert.deepEqual(
      roles.map((r) => r.rolname),
      ["amg_api", "amg_cache", "amg_render", "app_render", "app_service", "app_user"],
      "los logins y roles de aplicación existen tras migrar",
    );

    const { rows: rls } = await pg.query<{ relforcerowsecurity: boolean }>(
      "select relforcerowsecurity from pg_class where relname = 'kr_pages'",
    );
    assert.equal(rls[0]?.relforcerowsecurity, true, "kr_pages tiene RLS FORZADA (no solo enable)");
  } finally {
    await pg.close();
  }
});

test("migrarConRegistro: aborta si una migración YA aplicada cambió (deriva de checksum)", async () => {
  const pg = new PGlite();
  try {
    await migrarConRegistro(con(pg));

    // Simulamos que alguien editó una migración aplicada: su checksum registrado deja de coincidir.
    await pg.query("update app.migraciones_aplicadas set checksum = 'checksum-viejo' where nombre = '0001_init.sql'");

    await assert.rejects(
      () => migrarConRegistro(con(pg)),
      /0001_init\.sql.*CAMBIÓ|CAMBIÓ.*0001_init\.sql/s,
      "re-aplicar con contenido cambiado debe abortar, no correr en silencio",
    );
  } finally {
    await pg.close();
  }
});

test("migrarConRegistro: el registro NO tiene RLS (no se auto-bloquea si el rol no es superuser)", async () => {
  const pg = new PGlite();
  try {
    await migrarConRegistro(con(pg));
    const { rows } = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'migraciones_aplicadas'",
    );
    assert.equal(rows[0]?.relrowsecurity, false, "sin enable RLS");
    assert.equal(rows[0]?.relforcerowsecurity, false, "sin force RLS: la protección es la falta de grants, no una RLS que se auto-bloquea");
  } finally {
    await pg.close();
  }
});
