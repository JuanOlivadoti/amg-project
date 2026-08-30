import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * `app.nap_publico` (0030) gana un segundo parámetro, `vertical`, y con él la allowlist deja de ser
 * la misma para cualquier cliente: las claves restaurante-only de `menu` (`video`/`alergenos`/
 * `etiquetas`/`nutricion`) solo sobreviven si `vertical = 'restauracion'`, y la nueva clave `seguros`
 * solo si `vertical = 'correduria_seguros'` — aunque el jsonb tenga la clave "equivocada" cargada.
 *
 * El escenario clave es el PERFIL_MIXTO: trae datos de las DOS verticales a la vez (alérgenos de
 * restauración Y seguros.numeroLicencia), a propósito, para probar que un dato dormido de la
 * vertical incorrecta no se filtra según qué vertical tenga el cliente — es el hallazgo 5 de la
 * revisión de Codex al spec de este subproyecto.
 */

let db: TestDb;
let s: Seed;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
});

after(async () => await db.close());

const PERFIL_MIXTO = {
  name: "Cliente de prueba",
  menu: [
    {
      name: "Ítem",
      category: "Cat",
      video: { src: "https://cdn.example.com/v.mp4" },
      alergenos: ["gluten"],
      etiquetas: ["vegano"],
      nutricion: { calorias: 400 },
    },
  ],
  seguros: { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" },
};

// Contador para que cada llamada use un dominio distinto — `clients.domain` tiene un unique index
// (0007) y hay DOS tests por vertical que llaman a esta función, cada uno con su propia fila.
let contador = 0;

async function publicoParaVertical(
  vertical: "restauracion" | "correduria_seguros",
): Promise<Record<string, unknown>> {
  const dominio = `mixto-${vertical}-${++contador}.test`;
  await db.asService(
    `insert into clients (tenant_id, nombre, domain, business_profile, vertical)
     values ($1, $2, $2, $3::jsonb, $4)`,
    [s.tenantA, dominio, JSON.stringify(PERFIL_MIXTO), vertical],
  );
  const [fila] = await db.asRender<{ publico: Record<string, unknown> }>(
    "select business_profile_publico as publico from clients where domain = $1",
    [dominio],
  );
  return fila!.publico;
}

test("restauración: expone video/alergenos/etiquetas/nutricion, NO expone seguros", async () => {
  const publico = await publicoParaVertical("restauracion");
  const item = (publico["menu"] as Record<string, unknown>[])[0]!;
  assert.deepEqual(item["video"], { src: "https://cdn.example.com/v.mp4" });
  assert.deepEqual(item["alergenos"], ["gluten"]);
  assert.deepEqual(item["etiquetas"], ["vegano"]);
  assert.deepEqual(item["nutricion"], { calorias: 400 });
  assert.equal(publico["seguros"], undefined);
});

test("correduría de seguros: expone seguros.*, NO expone video/alergenos/etiquetas/nutricion", async () => {
  const publico = await publicoParaVertical("correduria_seguros");
  const item = (publico["menu"] as Record<string, unknown>[])[0]!;
  assert.equal(item["video"], undefined);
  assert.equal(item["alergenos"], undefined);
  assert.equal(item["etiquetas"], undefined);
  assert.equal(item["nutricion"], undefined);
  assert.deepEqual(publico["seguros"], {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
  // Las claves base del ítem siguen presentes para cualquier vertical.
  assert.equal(item["name"], "Ítem");
  assert.equal(item["category"], "Cat");
});

// El spec exige el CONJUNTO EXACTO de claves, no solo que ciertas claves conocidas tengan el valor
// esperado — un campo privado nuevo que se colara sin que nadie lo agregara a esta lista tiene que
// tumbar este test, y los dos de arriba no lo detectarían (solo miran las claves que ya conocen).
test("restauración: el conjunto EXACTO de claves de un ítem del menú, ni una de más", async () => {
  const publico = await publicoParaVertical("restauracion");
  const clavesItem = Object.keys((publico["menu"] as Record<string, unknown>[])[0]!).sort();
  assert.deepEqual(clavesItem, ["alergenos", "category", "etiquetas", "name", "nutricion", "video"].sort());
  assert.deepEqual(Object.keys(publico).includes("seguros"), false);
});

test("correduría de seguros: el conjunto EXACTO de claves de un ítem del catálogo, ni una de más", async () => {
  const publico = await publicoParaVertical("correduria_seguros");
  const clavesItem = Object.keys((publico["menu"] as Record<string, unknown>[])[0]!).sort();
  assert.deepEqual(clavesItem, ["category", "name"].sort());
  assert.deepEqual(
    Object.keys(publico["seguros"] as Record<string, unknown>).sort(),
    ["anosExperiencia", "numeroLicencia", "redAfiliacion"].sort(),
  );
});
