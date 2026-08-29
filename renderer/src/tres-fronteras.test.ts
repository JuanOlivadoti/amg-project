import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones } from "db";
import { parseProfile } from "web-builder";
// Las fixtures viven en un subpath propio (`web-builder/fixtures`) y no en el índice: son material
// de test y no tienen por qué formar parte de la API del paquete. Pero se IMPORTAN, no se copian —
// una fixture duplicada deja de representar el perfil real en cuanto una de las dos copias cambia.
import { perfilConManual, perfilLegacy } from "web-builder/fixtures";
import { perfilValido } from "./perfil.js";

/**
 * Las tres fronteras **encadenadas**, que es la única forma de comprobar lo que de verdad importa.
 *
 * Cada frontera tiene sus tests: el Zod en `web-builder`, la allowlist en `db/src/fotos-publicas`,
 * `perfilValido` acá al lado. Los tres pueden estar en verde y el campo no llegar igual, porque lo
 * que rompe el recorrido no es que una capa falle: es que **las tres listas no digan lo mismo**. Un
 * campo enumerado en dos de tres desaparece **sin error y sin log** — es el modo de fallo que la spec
 * pone primero (§Las cuatro fronteras) y el que causó la migración `0010`.
 *
 * Este test recorre el camino real de producción —JSON → Zod → `business_profile` → la columna
 * generada → `perfilValido`— y exige que **el perfil salga entero**. Si alguien agrega un campo al
 * tipo y se olvida de una capa, cae acá nombrando la clave, en vez de aparecer como una foto que no
 * se ve tres semanas después.
 *
 * La cuarta frontera (el render) no está: es la entrega 2 y la 3 de la spec.
 */
describe("las tres fronteras encadenadas: Zod → allowlist de Postgres → perfilValido", () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    await aplicarMigraciones(db);
    await db.exec(
      `insert into tenants (id, nombre, slug)
       values ('11111111-1111-1111-1111-111111111111', 'Agencia', 'agencia')`,
    );
  });

  after(async () => {
    await db.close();
  });

  /** El camino real: valida en la puerta, guarda, y lee lo ÚNICO que el renderizador puede leer. */
  async function recorrer(perfilCrudo: unknown, dominio: string): Promise<unknown> {
    const validado = parseProfile(perfilCrudo);
    await db.query(
      `insert into clients (tenant_id, nombre, domain, business_profile, vertical)
       values ('11111111-1111-1111-1111-111111111111', $1, $1, $2::jsonb, 'restauracion')`,
      [dominio, JSON.stringify(validado)],
    );
    const { rows } = await db.query<{ publico: unknown }>(
      "select business_profile_publico as publico from clients where domain = $1",
      [dominio],
    );
    return perfilValido(rows[0]?.publico);
  }

  it("🔴 el perfil con manual de marca completo llega ENTERO al otro lado", async () => {
    const entrada = perfilConManual();
    const salida = await recorrer(entrada, "completo.es");

    // La aserción que importa: lo que entró es lo que sale. Comparar campo por campo dejaría fuera
    // justo el campo que alguien olvide agregar a la lista de comprobaciones.
    assert.deepEqual(salida, parseProfile(entrada));
  });

  it("🔴 el perfil LEGACY {color, font} llega entero: ninguna web sembrada se rompe", async () => {
    const entrada = perfilLegacy();
    const salida = await recorrer(entrada, "legacy.es");

    assert.deepEqual(salida, parseProfile(entrada));
  });

  it("una clave que ninguna de las tres capas enumera no llega (y no da error)", async () => {
    // Se inserta SALTEANDO el Zod: en producción `business_profile` es una columna `jsonb` que nadie
    // valida al escribir, así que este es el caso real, no uno inventado.
    await db.query(
      `insert into clients (tenant_id, nombre, domain, business_profile, vertical)
       values ('11111111-1111-1111-1111-111111111111', 'x', 'colada.es', $1::jsonb, 'restauracion')`,
      [JSON.stringify({ name: "X", notas_internas: "no publicar", portada_grande: { src: "https://a.storyblok.com/f/1/x.jpg" } })],
    );
    const { rows } = await db.query<{ publico: unknown }>(
      "select business_profile_publico as publico from clients where domain = 'colada.es'",
    );
    const salida = perfilValido(rows[0]?.publico) as Record<string, unknown> | null;

    assert.equal(salida?.["name"], "X");
    assert.equal(salida?.["notas_internas"], undefined);
    assert.equal(salida?.["portada_grande"], undefined);
  });

  it("los topes coinciden en las tres capas: 30 fotos entran, la 31 hace fallar la puerta", async () => {
    const foto = { src: "https://a.storyblok.com/f/1/x.jpg" };
    const salida = (await recorrer(
      perfilConManual({ fotos: Array.from({ length: 30 }, () => foto) }),
      "topes.es",
    )) as { fotos?: unknown[] } | null;

    // 30 sobreviven el recorrido entero — si Postgres cortara en 29 o `perfilValido` en 25, acá se ve.
    assert.equal(salida?.fotos?.length, 30);
    // Y la 31 no llega a guardarse: la puerta rechaza el archivo antes (ver el comentario de los topes
    // en `web-builder/src/contract.ts` sobre por qué esta capa rechaza y las otras dos cortan).
    assert.throws(() => parseProfile(perfilConManual({ fotos: Array.from({ length: 31 }, () => foto) })));
  });
});
