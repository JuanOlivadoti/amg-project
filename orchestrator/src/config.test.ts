import { test } from "node:test";
import assert from "node:assert/strict";
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
