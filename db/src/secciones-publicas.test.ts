import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { seed, TestDb, type Seed } from "./testdb.js";

/**
 * La FRONTERA 2 de los tres campos que trajo el rediseño de la plantilla base (bloque K, etapa 3):
 * `bienvenida`, `destacados` y `testimonios`, dentro de `app.nap_publico` (migración `0020`).
 *
 * Mismo criterio que `fotos-publicas.test.ts`, que es de donde sale la forma de este archivo: cada
 * campo se asevera en **exactamente un test**, para que quitarlo de la allowlist tumbe uno solo y se
 * pueda leer cuál era su garantía. Y se lee **como `app_render`**, el rol más pobre del sistema:
 * leerlo como superusuario probaría que la función proyecta y no probaría nada del grant.
 */
async function publicar(
  db: TestDb,
  s: Seed,
  dominio: string,
  perfil: unknown,
): Promise<Record<string, unknown>> {
  await db.asService(
    `update clients set domain = $2, storyblok_space_id = 'SB-0020', business_profile = $3::jsonb
       where id = $1`,
    [s.clientA2, dominio, JSON.stringify(perfil)],
  );
  const [fila] = await db.asRender<{ p: Record<string, unknown> | null }>(
    "select business_profile_publico as p from clients where domain = $1",
    [dominio],
  );
  return fila?.p ?? {};
}

describe("0020 — frontera 2: las tres secciones de plantilla en la allowlist del renderizador", () => {
  let db: TestDb;
  let s: Seed;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);
  });

  after(async () => await db.close());

  it("`bienvenida`: cruza como texto, y cualquier otra forma sale AUSENTE", async () => {
    const perfil = await publicar(db, s, "bienvenida-0020.es", {
      name: "Casa Lucio",
      bienvenida: "Un comedor pequeño en el centro.",
    });
    assert.equal(perfil["bienvenida"], "Un comedor pequeño en el centro.");

    // `app.texto_publico` solo deja pasar strings. Un objeto escondido en un campo declarado de texto
    // es el agujero que cerró la 0010, y se vuelve a comprobar en cada campo nuevo: si esto cruzara,
    // el renderizador recibiría un objeto donde espera una frase.
    const raro = await publicar(db, s, "bienvenida-objeto-0020.es", {
      name: "Casa Lucio",
      bienvenida: { es: "hola", en: "hi" },
    });
    assert.equal(raro["bienvenida"], undefined, "un objeto en un campo de texto sale ausente, no crudo");
  });

  it("`destacados`: cruza con titulo/texto, exige `titulo`, corta en 6 sobre la FUENTE y cierra la sub-allowlist", async () => {
    const perfil = await publicar(db, s, "destacados-0020.es", {
      name: "Casa Lucio",
      destacados: [
        { titulo: "Horno de leña", texto: "48 horas de fermentación.", icono_interno: "flame" },
        { texto: "sin título: no es un motivo, es una tarjeta sin rótulo" },
        { titulo: "Dos locales" },
      ],
    });

    assert.deepEqual(
      perfil["destacados"],
      [{ titulo: "Horno de leña", texto: "48 horas de fermentación." }, { titulo: "Dos locales" }],
      "cruzan titulo y texto y NADA más; la entrada sin `titulo` se descarta ella sola",
    );

    // El tope va sobre la posición en la FUENTE (`with ordinality`), igual que los 20 locales y los
    // 200 platos de la 0010: una entrada inválida gasta su cupo, así que el corte nunca depende de
    // cuánta basura traiga la ficha.
    const muchos = Array.from({ length: 9 }, (_, i) => ({ titulo: `M${i}` }));
    const cortado = await publicar(db, s, "destacados-tope-0020.es", { name: "Casa Lucio", destacados: muchos });
    const lista = cortado["destacados"] as Record<string, unknown>[];
    assert.equal(lista.length, 6, "el tope corta en 6");
    assert.equal(lista[0]?.["titulo"], "M0", "se quedan los PRIMEROS");
    assert.equal(lista[5]?.["titulo"], "M5");
  });

  it("🔴 `testimonios`: cruza texto y autor, y una PUNTUACIÓN no cruza aunque esté en la ficha", async () => {
    const perfil = await publicar(db, s, "testimonios-0020.es", {
      name: "Casa Lucio",
      testimonios: [
        { texto: "Se come muy bien.", autor: "Una clienta", estrellas: 5, puntuacion: "5/5" },
        { autor: "Sin texto" },
      ],
    });

    // **Esta es la garantía de este test, y no es de forma sino de política.** Una allowlist enumera
    // NOMBRES de clave, así que es exactamente acá donde queda impuesto que la web de un negocio no
    // pueda publicar su propia valoración numérica: aunque alguien escriba `estrellas` directo en
    // `business_profile` —que es una columna `jsonb` que nadie valida al escribir— el renderizador no
    // la ve. El Zod y `perfilValido` dicen lo mismo; ésta es la capa que lo sostiene cuando el dato
    // no pasó por ninguno de los dos.
    assert.deepEqual(
      perfil["testimonios"],
      [{ texto: "Se come muy bien.", autor: "Una clienta" }],
      "cruzan texto y autor; `estrellas` y `puntuacion` no existen para el renderizador",
    );

    const muchos = Array.from({ length: 15 }, (_, i) => ({ texto: `T${i}` }));
    const cortado = await publicar(db, s, "testimonios-tope-0020.es", { name: "Casa Lucio", testimonios: muchos });
    assert.equal((cortado["testimonios"] as unknown[]).length, 12, "el tope corta en 12");
  });
});
