import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbPool } from "db";
import { CLAVE_TENANT, CONCURRENCIA } from "./functions.js";

/**
 * Tests de CONFIGURACIÓN — las piezas que un typo silencioso puede romper sin que ningún test de
 * flujo lo note. La 6ª review marcó las dos como "el código está bien, pero eliminar el guard deja
 * la suite verde": esto las fija.
 */

/**
 * 🔴 La clave de concurrencia por tenant tiene que apuntar a un campo que el evento REALMENTE lleva.
 *
 * El bug (5ª review, #11) fue `event.data.ctx.tenantId`: `ctx` no existe en el evento, así que la
 * clave resolvía a `undefined` y la equidad entre tenants no se aplicaba. El evento
 * `research/solicitado` lleva `{ runId, tenantId }` (ver `events.ts`), así que la clave válida es
 * `event.data.tenantId` — y **no** un subcampo anidado que no existe.
 */
test("🔴 la clave de concurrencia por tenant apunta a un campo real del evento", () => {
  assert.equal(CLAVE_TENANT, "event.data.tenantId");
  // Nada de `.ctx.` ni otro nivel anidado: el evento no tiene esa forma.
  assert.ok(!CLAVE_TENANT.includes(".ctx."), "no debe apuntar a event.data.ctx.* (no existe)");
  const porTenant = CONCURRENCIA.find((c) => "key" in c);
  assert.equal(porTenant?.key, "event.data.tenantId", "la regla por tenant usa la clave correcta");
  assert.equal(porTenant && "limit" in porTenant ? porTenant.limit : 0, 1, "1 research por tenant a la vez");
});

/**
 * 🔴 El composition root ata el store al rol `app_service`, y ESO es lo que ningún test fijaba.
 *
 * La 13ª review externa lo midió con una mutación de un carácter: cambiar `"app_service"` por
 * `"app_user"` en `deps.ts` dejaba **199 tests y el typecheck en verde**, y el fallo aparecía recién en
 * producción, donde `amg_orquestador` **no tiene concedido** `app_user` y Postgres rechaza el
 * `set role` (ADR-17). Los tests de `db` prueban que `PgStore` funciona con `app_service` **cuando el
 * test lo elige**; ninguno probaba que producción lo elija. Es la regla del proyecto incumplida: *un
 * default de producción sin test es una decisión sin dueño*.
 *
 * Se comprueba por el EFECTO y no leyendo el campo privado: un pool espía registra el SQL, y lo que se
 * afirma es el `set local role` que la conexión acaba ejecutando — que es lo que Postgres ve.
 */
test("🔴 crearDeps ata el store a app_service, el único rol que su login puede asumir", async () => {
  const ejecutado: string[] = [];
  const espia: DbPool = {
    transaction: (fn) =>
      fn({
        query: async (sql: string) => {
          ejecutado.push(sql);
          return { rows: [] };
        },
        exec: async (sql: string) => {
          ejecutado.push(sql);
          return undefined;
        },
      }),
  };

  const { crearDeps } = await import("./deps.js");
  const deps = crearDeps({ orquestador: espia, cache: espia, cerrar: async () => {} });

  // Cualquier operación sirve: `withTenant` aplica el rol antes de tocar los datos.
  await deps.store.getRun({ tenantId: "11111111-1111-4111-8111-111111111111" }, "22222222-2222-4222-8222-222222222222");

  assert.ok(
    ejecutado.some((s) => s.includes("set local role app_service")),
    `el store del orquestador tiene que asumir app_service. SQL ejecutado: ${JSON.stringify(ejecutado)}`,
  );
  assert.ok(
    !ejecutado.some((s) => s.includes("set local role app_user")),
    "y NUNCA app_user: su login no lo tiene concedido, así que en producción esto reventaría",
  );
});

/**
 * 🔴 Con Postgres real, `DATABASE_URL_CACHE` es obligatoria: NO puede heredar la del orquestador,
 * porque ese login no puede tocar las caches (5ª review, #9). Sin ella, hay que abortar al arrancar.
 */
test("🔴 crearConexiones aborta si hay Postgres real sin DATABASE_URL_CACHE", async () => {
  const orig = { ...process.env };
  try {
    process.env["DATABASE_URL_ORQUESTADOR"] = "postgres://amg_orquestador:x@localhost/db";
    delete process.env["DATABASE_URL_CACHE"];
    delete process.env["DATABASE_URL"];

    const { crearConexiones } = await import("./deps.js");
    await assert.rejects(
      () => crearConexiones(),
      /DATABASE_URL_CACHE/,
      "sin la credencial de cache, el sistema no debe arrancar (fallaría en el primer research)",
    );
  } finally {
    process.env = orig;
  }
});
