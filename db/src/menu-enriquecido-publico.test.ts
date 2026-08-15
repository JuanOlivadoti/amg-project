import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { seed, TestDb, type Seed } from "./testdb.js";

/**
 * La FRONTERA 2 de las cuatro que cruza un campo del perfil para llegar al HTML — mismo criterio y
 * mismo patrón que `fotos-publicas.test.ts` (la `0014`): cada campo nuevo se asevera en EXACTAMENTE
 * UN test de este archivo, para que la verificación por mutación señale un único culpable.
 */
async function publicar(
  db: TestDb,
  s: Seed,
  dominio: string,
  perfil: unknown,
): Promise<Record<string, unknown>> {
  await db.asService(
    `update clients set domain = $2, storyblok_space_id = 'SB-0023', business_profile = $3::jsonb
       where id = $1`,
    [s.clientA2, dominio, JSON.stringify(perfil)],
  );
  const [fila] = await db.asRender<{ p: Record<string, unknown> | null }>(
    "select business_profile_publico as p from clients where domain = $1",
    [dominio],
  );
  return fila?.p ?? {};
}

describe("0023 — frontera 2: menú enriquecido en la allowlist del renderizador", () => {
  let db: TestDb;
  let s: Seed;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);
  });

  after(async () => await db.close());

  it("`menu[].video`: cruza con src+poster, y un video sin `src` sale ausente", async () => {
    const perfil = await publicar(db, s, "video-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          video: {
            src: "https://a.storyblok.com/f/1/margherita.mp4",
            poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza" },
            duracion_interna_segundos: 42,
          },
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["video"], {
      src: "https://a.storyblok.com/f/1/margherita.mp4",
      poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza" },
    });

    const sinSrc = await publicar(db, s, "video-sin-src-0023.es", {
      name: "Casa Lucio",
      menu: [{ name: "P", video: { poster: { src: "https://a.storyblok.com/f/1/poster.jpg" } } }],
    });
    assert.equal((sinSrc["menu"] as Record<string, unknown>[])[0]?.["video"], undefined);
  });

  it("`menu[].alergenos` y `menu[].etiquetas`: cruzan como array de strings, cortan en 14 y 7", async () => {
    const perfil = await publicar(db, s, "alergenos-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          alergenos: [...Array(15).fill("gluten")],
          etiquetas: [...Array(8).fill("vegano")],
        },
      ],
    });
    const item = (perfil["menu"] as Record<string, unknown>[])[0]!;
    assert.equal((item["alergenos"] as unknown[]).length, 14, "el tope corta en 14");
    assert.equal((item["etiquetas"] as unknown[]).length, 7, "el tope corta en 7");
  });

  it("`menu[].alergenos`: un elemento que no es string se descarta, el resto sobrevive", async () => {
    const perfil = await publicar(db, s, "alergenos-basura-0023.es", {
      name: "Casa Lucio",
      menu: [{ name: "P", alergenos: ["gluten", { objeto: true }, "lacteos"] }],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["alergenos"], ["gluten", "lacteos"]);
  });

  it("`menu[].nutricion`: cruzan los cuatro campos numéricos, y uno con forma de texto sale ausente", async () => {
    const perfil = await publicar(db, s, "nutricion-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          nutricion: { calorias: 820, proteinas_g: "34", carbohidratos_g: 96, grasas_g: 28, azucar_interno: 4 },
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["nutricion"], {
      calorias: 820,
      carbohidratos_g: 96,
      grasas_g: 28,
    });
  });

  it("`menu[].precios[].comensales`: cruza junto con etiqueta e importe", async () => {
    const perfil = await publicar(db, s, "comensales-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          precios: [{ etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" }],
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["precios"], [
      { etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" },
    ]);
  });

  it("🔴 el grant sobrevive al `drop column`: app_render sigue leyendo la pública y no la cruda", async () => {
    await publicar(db, s, "grant-0023.es", { name: "Casa Lucio" });
    const filas = await db.asRender<{ p: unknown }>(
      "select business_profile_publico as p from clients where domain = 'grant-0023.es'",
    );
    assert.equal(filas.length, 1);
    await assert.rejects(
      () => db.asRender("select business_profile from clients"),
      /permission denied|no tiene permiso/i,
    );
  });
});
