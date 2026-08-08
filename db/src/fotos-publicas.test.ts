import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { asegurarAuthStandIn, MIGRATIONS_DIR } from "./migrate.js";
import { seed, TestDb, type Seed } from "./testdb.js";

/**
 * La FRONTERA 2 de las cuatro que tiene que cruzar un campo del perfil para llegar al HTML
 * (`docs/superpowers/specs/2026-08-01-plantillas-landings-design.md`, §Las cuatro fronteras):
 * la allowlist de Postgres, `app.nap_publico`, materializada en `clients.business_profile_publico`.
 *
 * Por qué estos tests y no "probar la migración": el renderizador es la ÚNICA pieza expuesta a
 * internet anónimo (ADR-19) y lo único que puede leer de `clients` es esta columna. Un campo que la
 * allowlist no enumera **no da error: no aparece** — y al revés, un campo de más se publica en
 * silencio a internet. Las dos direcciones se prueban acá.
 *
 * Cada campo nuevo se asevera en EXACTAMENTE UN test DE ESTE ARCHIVO, a propósito: así una mutación
 * de la allowlist (quitarle un campo a la 0014) tumba exactamente un test y se puede leer cuál es la
 * garantía que ese campo tenía. Un campo aseverado en tres tests hace ilegible la verificación por
 * mutación.
 *
 * **Fuera de este archivo hay dos que también caen, y es correcto que caigan**: el del seed
 * (`seed-demo.test.ts`, "lo sembrado sobrevive la allowlist") comprueba que el perfil del cliente de
 * demo llega entero —una garantía distinta: que lo SEMBRADO cruza, no que el campo exista—, y el del
 * recorrido encadenado (`renderer/src/tres-fronteras.test.ts`) comprueba que las tres capas enumeran
 * lo mismo. Así que quitar `colores.primario` de la 0014 tumba tres tests, uno por garantía. Medido,
 * no supuesto: lo reportó una revisión que reprodujo la mutación.
 */

/** El dominio es la autorización del renderizador (ADR-19); acá solo sirve para direccionar la fila. */
async function publicar(
  db: TestDb,
  s: Seed,
  dominio: string,
  perfil: unknown,
): Promise<Record<string, unknown>> {
  await db.asService(
    `update clients set domain = $2, storyblok_space_id = 'SB-0014', business_profile = $3::jsonb
       where id = $1`,
    [s.clientA2, dominio, JSON.stringify(perfil)],
  );
  // Se lee COMO app_render: el rol más pobre del sistema. Leerlo como superusuario probaría que la
  // función proyecta bien y no probaría nada del grant que hace posible la lectura en producción.
  const [fila] = await db.asRender<{ p: Record<string, unknown> | null }>(
    "select business_profile_publico as p from clients where domain = $1",
    [dominio],
  );
  return fila?.p ?? {};
}

describe("0014 — frontera 2: fotos, carta y manual de marca en la allowlist del renderizador", () => {
  let db: TestDb;
  let s: Seed;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);
  });

  after(async () => await db.close());

  it("`portada`: cruza la allowlist con su sub-allowlist (src/alt), y una foto que no es objeto queda AUSENTE", async () => {
    // `Foto` es un OBJETO, así que `app.texto_publico` (que solo deja pasar strings) no alcanza:
    // hace falta una sub-allowlist propia, como ya tienen `address` y `brand`. Y el caso borde de la
    // spec —`foto` como string— tiene que salir ausente, nunca como basura que la frontera 3 tenga
    // que limpiar.
    const perfil = await publicar(db, s, "portada-0014.es", {
      name: "Casa Lucio",
      portada: { src: "https://a.storyblok.com/f/1/hero.jpg", alt: "Fachada", credito_interno: "©Fotógrafo X" },
    });

    assert.deepEqual(
      perfil["portada"],
      { src: "https://a.storyblok.com/f/1/hero.jpg", alt: "Fachada" },
      "la portada cruza con src y alt, y NADA más: la sub-allowlist está cerrada",
    );

    const comoString = await publicar(db, s, "portada-string-0014.es", {
      name: "Casa Lucio",
      portada: "https://a.storyblok.com/f/1/hero.jpg",
    });
    assert.equal(comoString["portada"], undefined, "una foto que no es objeto sale AUSENTE, no cruda");
  });

  it("`fotos`: cruza la allowlist, corta en 30 en la FUENTE y descarta los elementos que no son objeto", async () => {
    // El tope se aplica cortando la fuente (`with ordinality` + `where i <= 30`), igual que la 0010
    // con los 200 platos: sin eso, `jsonb_agg` materializa las 35 antes de que nada las recorte y el
    // tope pasa a depender de que el renderizador se acuerde de aplicarlo.
    const muchas = Array.from({ length: 35 }, (_, i) => ({ src: `https://a.storyblok.com/f/${i}.jpg` }));
    const perfil = await publicar(db, s, "galeria-0014.es", { name: "Casa Lucio", fotos: muchas });

    const fotos = perfil["fotos"] as Record<string, unknown>[];
    assert.equal(fotos.length, 30, "el tope corta en 30");
    assert.equal(fotos[0]?.["src"], "https://a.storyblok.com/f/0.jpg", "se quedan las PRIMERAS");
    assert.equal(fotos[29]?.["src"], "https://a.storyblok.com/f/29.jpg");

    // Un elemento que no es una foto se descarta ENTERO y no deja un hueco (`jsonb_agg` habría
    // producido un `[null]` en su lugar, que la frontera 3 tendría que limpiar). El tope y este
    // filtro se miden por separado a propósito: `i` es la posición en la FUENTE, así que un elemento
    // inválido gasta su cupo del tope — misma semántica que el `where i <= 20` de los locales.
    const conBasura = await publicar(db, s, "galeria-basura-0014.es", {
      name: "Casa Lucio",
      fotos: [
        { src: "https://a.storyblok.com/f/a.jpg" },
        "https://a.storyblok.com/no-soy-objeto.jpg",
        { credito_interno: "©Fotógrafo X" },
        { src: "https://a.storyblok.com/f/b.jpg" },
      ],
    });
    assert.deepEqual(
      conBasura["fotos"],
      [{ src: "https://a.storyblok.com/f/a.jpg" }, { src: "https://a.storyblok.com/f/b.jpg" }],
      "un string y un objeto sin ninguna clave conocida salen ausentes, sin dejar huecos",
    );
  });

  it("`menu_categorias`: cruza con nombre/foto/orden, `orden` sigue siendo NÚMERO, y corta en 20", async () => {
    // `orden` es el único campo numérico de todo el perfil público: `app.texto_publico` lo mataría
    // (solo deja pasar strings), así que necesita su equivalente para números. Y la forma importa:
    // un `orden` que viene como texto sale ausente — la frontera 3 no tiene que adivinar tipos.
    const muchas = Array.from({ length: 25 }, (_, i) => ({ nombre: `Cat ${i}` }));
    const perfil = await publicar(db, s, "categorias-0014.es", {
      name: "Casa Lucio",
      menu_categorias: [
        {
          nombre: "Postres",
          foto: { src: "https://a.storyblok.com/f/postres.jpg", alt: "Tarta" },
          orden: 3,
          margen_categoria: "62%",
        },
        { nombre: "Bebidas", orden: "7" },
        ...muchas,
      ],
    });

    const cats = perfil["menu_categorias"] as Record<string, unknown>[];
    assert.deepEqual(
      cats[0],
      { nombre: "Postres", foto: { src: "https://a.storyblok.com/f/postres.jpg", alt: "Tarta" }, orden: 3 },
      "nombre, foto y orden cruzan; el margen interno de la categoría NO",
    );
    assert.equal(typeof cats[0]?.["orden"], "number", "`orden` llega como número, no como texto");
    assert.deepEqual(cats[1], { nombre: "Bebidas" }, "un `orden` de forma equivocada (texto) sale ausente");
    assert.equal(cats.length, 20, "el tope corta en 20");
  });

  it("`menu[].precios`: cruza con etiqueta/importe, corta en 3 y descarta la ENTRADA incompleta, no el plato", async () => {
    // Caso borde de la enmienda 2026-08-02: "Una entrada de `precios` sin `etiqueta` o sin `importe`
    // se descarta esa entrada, no el plato". Si se descartara el plato, un dato mal cargado en el
    // portal borraría comida de la carta pública sin que nadie se entere.
    const perfil = await publicar(db, s, "precios-0014.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Cochinillo",
          price: "24 €",
          precios: [
            { etiqueta: "Media", importe: "14 €" },
            { importe: "24 €" }, // sin etiqueta: se cae ESTA, no el plato
            { etiqueta: "Ración", importe: "24 €" },
            { etiqueta: "Familiar", importe: "40 €" },
            { etiqueta: "Sexta", importe: "99 €" },
          ],
        },
      ],
    });

    const plato = (perfil["menu"] as Record<string, unknown>[])[0]!;
    assert.equal(plato["name"], "Cochinillo", "el plato sobrevive a una entrada de precio inválida");
    assert.deepEqual(
      plato["precios"],
      [
        { etiqueta: "Media", importe: "14 €" },
        { etiqueta: "Ración", importe: "24 €" },
      ],
      "la entrada sin etiqueta se descarta, y el tope de 3 corta sobre la posición en la FUENTE " +
        "(la entrada inválida gasta su cupo, igual que en la 0010)",
    );
  });

  it("`menu[]`: `nota` y `foto` cruzan la allowlist, y el coste interno del plato sigue sin cruzar", async () => {
    const perfil = await publicar(db, s, "plato-0014.es", {
      name: "Casa Lucio",
      menu: [
        {
          category: "Carnes",
          name: "Chuletón",
          nota: "Sin gluten",
          foto: { src: "https://a.storyblok.com/f/chuleton.jpg" },
          costo_interno: "9,80 €",
        },
      ],
    });

    assert.deepEqual((perfil["menu"] as unknown[])[0], {
      category: "Carnes",
      name: "Chuletón",
      nota: "Sin gluten",
      foto: { src: "https://a.storyblok.com/f/chuleton.jpg" },
    });
  });

  it("`locations[].foto`: cruza la allowlist dentro de cada local", async () => {
    const perfil = await publicar(db, s, "local-foto-0014.es", {
      name: "Casa Lucio",
      locations: [
        {
          name: "Centro",
          foto: { src: "https://a.storyblok.com/f/centro.jpg", alt: "Salón" },
          alquiler_mensual: "4.200 €",
        },
      ],
    });

    assert.deepEqual((perfil["locations"] as unknown[])[0], {
      name: "Centro",
      foto: { src: "https://a.storyblok.com/f/centro.jpg", alt: "Salón" },
    });
  });

  it("`brand.colores`: los seis tokens cruzan, uno inventado no, y un color con `</style>` TAMBIÉN cruza (a propósito)", async () => {
    // ⚠️ Postgres NO valida hex, y no es un olvido. La allowlist SQL restringe **nombres de clave** y
    // **forma de valor** (string / objeto / número); si un color es un hex válido lo deciden las
    // fronteras 1 (Zod), 3 (`perfilValido`) y 4 (el render, que revalida porque en producción el dato
    // llega desde la base sin pasar por Zod). Meter la validación de hex acá daría una falsa
    // sensación de defensa y, peor, dejaría que alguien quitara la de las otras tres creyendo que
    // Postgres cubre. Lo que este test fija es que `</style>` llega hasta la frontera 3 — no que sea
    // seguro emitirlo.
    const perfil = await publicar(db, s, "colores-0014.es", {
      name: "Casa Lucio",
      brand: {
        colores: {
          primario: "#0a7d34",
          secundario: "#123",
          titulo: "#111111",
          texto: "#222222",
          fondo: "#ffffff",
          fondoAlt: "#f5f5f5",
          acento_secreto: "#000000",
        },
      },
    });

    const brand = perfil["brand"] as Record<string, unknown>;
    assert.deepEqual(brand["colores"], {
      primario: "#0a7d34",
      secundario: "#123",
      titulo: "#111111",
      texto: "#222222",
      fondo: "#ffffff",
      fondoAlt: "#f5f5f5",
    });

    const hostil = await publicar(db, s, "colores-hostiles-0014.es", {
      name: "Casa Lucio",
      brand: { colores: { primario: "#0a7d34</style><script>alert(1)</script>" } },
    });
    assert.equal(
      ((hostil["brand"] as Record<string, unknown>)["colores"] as Record<string, unknown>)["primario"],
      "#0a7d34</style><script>alert(1)</script>",
      "es un string, así que la allowlist SQL lo deja pasar: quien lo descarta es el validador de hex",
    );
  });

  it("`brand.fuentes` y `brand.plantilla` cruzan, y el legacy `{color, font, logo}` SIGUE cruzando", async () => {
    // El legacy no es cortesía: TODAS las fichas sembradas hasta hoy tienen `{color, font, logo}`.
    // Quitarlos de la allowlist les cambiaría el aspecto de golpe a todas las webs publicadas, y es
    // la única regresión que el manual de marca puede causar.
    const perfil = await publicar(db, s, "marca-0014.es", {
      name: "Casa Lucio",
      brand: {
        plantilla: "base",
        fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script", pie: "comic" },
        color: "#0a7d34",
        font: "serif",
        logo: "https://a.storyblok.com/f/logo.png",
      },
    });

    assert.deepEqual(perfil["brand"], {
      plantilla: "base",
      fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script" },
      color: "#0a7d34",
      font: "serif",
      logo: "https://a.storyblok.com/f/logo.png",
    });
  });

  it("🔴 ampliar la allowlist no abre la puerta: una clave del perfil que no está enumerada sigue sin cruzar", async () => {
    // Mismo espíritu que los tests de `notas_internas` (0008) y `margen_secreto` (0009). La 0014 casi
    // duplica el tamaño de la allowlist; ese es exactamente el momento en que una clave de más se
    // cuela sin que nada avise, y del otro lado está el rol anónimo.
    const perfil = await publicar(db, s, "defensa-0014.es", {
      name: "Casa Lucio",
      notas_internas: "no paga hace tres meses",
      fotos_internas: [{ src: "https://a.storyblok.com/f/contrato.jpg" }],
      portada: { src: "https://a.storyblok.com/f/hero.jpg" },
    });

    assert.equal(perfil["notas_internas"], undefined, "una clave no listada no cruza");
    assert.equal(
      perfil["fotos_internas"],
      undefined,
      "ni una que se parece a una nueva: la allowlist enumera nombres exactos, no prefijos",
    );
  });

  it("el `lock_timeout` de la migración queda PUESTO (con `set local` no aplicaría nada)", async () => {
    // Medido antes de escribirlo (PGlite 16.4): fuera de una transacción —que es como
    // `aplicarMigraciones` ejecuta cada archivo— `set local lock_timeout` deja el valor en `0`, o sea
    // que la línea sería decoración y nadie se enteraría. Este test es lo que distingue una línea que
    // hace algo de una que no: cambiar el `set` de la 0014 por `set local` lo tumba.
    const [fila] = await db.asService<{ v: string }>("select current_setting('lock_timeout') as v");
    assert.equal(fila?.v, "5s", "la 0014 dejó el lock_timeout puesto, no en el default `0`");
  });

  it("🔴 el grant sobrevive al `drop column`: app_render lee la columna PÚBLICA y sigue sin poder leer la cruda", async () => {
    // El riesgo real de esta migración, y es una línea de SQL: `drop column` **borra el grant de
    // columna**. Si la 0014 no lo vuelve a conceder, `app_render` pierde el select y caen las webs de
    // todos los clientes a la vez. No basta con que la línea esté escrita en el archivo: esto lo
    // comprueba conectando COMO app_render, después de aplicar todas las migraciones.
    await publicar(db, s, "grant-0014.es", { name: "Casa Lucio" });

    const filas = await db.asRender<{ p: unknown }>(
      "select business_profile_publico as p from clients where domain = 'grant-0014.es'",
    );
    assert.equal(filas.length, 1, "app_render SIGUE pudiendo leer la columna pública tras la 0014");

    await assert.rejects(
      () => db.asRender("select business_profile from clients"),
      /permission denied|no tiene permiso/i,
      "y la columna CRUDA sigue fuera de su alcance: el drop/add no la reabrió",
    );
  });
});

/**
 * Independencia de orden entre la 0014 y sus cinco hermanas posteriores.
 *
 * El problema real: en una base NUEVA la 0014 corre ANTES de la 0015-0019 (orden alfabético,
 * `migrate.ts`), y en una base ya desplegada corre DESPUÉS (`migrarConRegistro` saltea las
 * registradas, `deploy.ts`). Las cinco declaran POR ESCRITO, en un comentario, que son independientes
 * de la 0014. Esto convierte ese comentario en una garantía: si alguien agrega a la 0015-0019 algo
 * que toque `clients` o `app.nap_publico`, las dos bases dejan de ser equivalentes y este test cae.
 *
 * El testigo anti-degeneración es `app.foto_publica`, que SOLO existe si la 0014 se aplicó. Se eligió
 * a propósito una función y no un campo de la allowlist: así una mutación de `portada`, de
 * `colores.primario` o de `precios` no tumba también este test, y la verificación por mutación sigue
 * señalando un único culpable.
 */
describe("0014 — es independiente del orden en que se aplique respecto de la 0015-0019", () => {
  const LA_0014 = "0014_fotos_publicas.sql";

  async function aplicarEnOrden(pg: PGlite, archivos: string[]): Promise<void> {
    await asegurarAuthStandIn(pg);
    for (const f of archivos) {
      await pg.exec(await readFile(join(MIGRATIONS_DIR, f), "utf8"));
    }
  }

  it("🔴 aplicarla en su sitio o al final produce el mismo esquema, el mismo grant y la misma allowlist", async () => {
    const alfabetico = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    assert.ok(alfabetico.includes(LA_0014), `${LA_0014} tiene que existir, o este test no compara nada`);

    const alFinal = [...alfabetico.filter((f) => f !== LA_0014), LA_0014];
    assert.notDeepEqual(
      alfabetico,
      alFinal,
      "los dos órdenes tienen que ser DISTINTOS: si la 0014 ya fuera la última, este test pasaría " +
        "comparando una base consigo misma",
    );

    const a = new PGlite();
    const b = new PGlite();
    try {
      await aplicarEnOrden(a, alfabetico);
      await aplicarEnOrden(b, alFinal);

      const enAmbas = async <T>(sql: string, params: unknown[] = []): Promise<[T[], T[]]> => [
        (await a.query<T>(sql, params)).rows,
        (await b.query<T>(sql, params)).rows,
      ];

      // 1) Las funciones de la allowlist, cuerpo a cuerpo.
      const [fnA, fnB] = await enAmbas<{ proname: string; def: string }>(`
        select p.proname, pg_get_functiondef(p.oid) as def
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and p.proname in ('nap_publico', 'texto_publico', 'foto_publica', 'numero_publico')
         order by p.proname
      `);
      assert.ok(
        fnA.some((f) => f.proname === "foto_publica"),
        "testigo: `app.foto_publica` solo existe si la 0014 se aplicó de verdad",
      );
      assert.deepEqual(fnA, fnB, "las funciones de la allowlist son idénticas en los dos órdenes");

      // 2) El grant de columna para el rol anónimo, en las dos direcciones.
      const [privA, privB] = await enAmbas<{ publica: boolean; cruda: boolean }>(`
        select has_column_privilege('app_render', 'clients', 'business_profile_publico', 'select') as publica,
               has_column_privilege('app_render', 'clients', 'business_profile', 'select')          as cruda
      `);
      assert.deepEqual(privA, [{ publica: true, cruda: false }], "orden alfabético: grant puesto, cruda cerrada");
      assert.deepEqual(privB, privA, "y exactamente lo mismo aplicando la 0014 al final");

      // 3) Las columnas de las tablas que tocan las hermanas (`kr_pages`, `kr_runs`) y la que toca la
      //    0014 (`clients`). Si alguna de las cinco empezara a tocar `clients`, esto se rompe.
      const [colsA, colsB] = await enAmbas<Record<string, unknown>>(`
        select table_name, column_name, data_type, is_generated, generation_expression
          from information_schema.columns
         where table_schema = 'public' and table_name in ('clients', 'kr_pages', 'kr_runs')
         order by table_name, column_name
      `);
      assert.deepEqual(colsA, colsB, "mismas columnas, mismos tipos y misma expresión generada");

      // 4) La prueba que de verdad importa: el MISMO perfil produce el MISMO público en las dos.
      const perfil = JSON.stringify({
        name: "Casa Lucio",
        notas_internas: "privado",
        portada: { src: "https://a.storyblok.com/f/hero.jpg", alt: "Fachada" },
        fotos: [{ src: "https://a.storyblok.com/f/1.jpg" }],
        menu_categorias: [{ nombre: "Postres", orden: 2 }],
        menu: [{ name: "Cochinillo", precios: [{ etiqueta: "Ración", importe: "24 €" }] }],
        brand: { colores: { primario: "#0a7d34" }, fuentes: { titulo: "condensada" } },
      });
      const [pubA, pubB] = await enAmbas<{ p: unknown }>("select app.nap_publico($1::jsonb) as p", [perfil]);
      assert.deepEqual(pubA, pubB, "la allowlist proyecta igual en los dos órdenes");
      assert.equal(
        (pubA[0]?.p as Record<string, unknown>)["notas_internas"],
        undefined,
        "y en los dos sigue siendo una allowlist, no una copia del perfil",
      );
    } finally {
      await a.close();
      await b.close();
    }
  });
});
