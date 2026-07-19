import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PglitePool } from "./pool.js";
import { MemSitios, PgSitios } from "./sitios.js";
import { seed, TestDb, type Seed } from "./testdb.js";

/**
 * El renderizador es la única pieza expuesta a internet anónimo (ADR-19), así que la pregunta que
 * estos tests contestan no es "¿funciona?" sino **"si me lo toman, ¿qué se llevan?"**.
 *
 * Por eso la mitad de abajo prueba lo que `app_render` NO puede hacer. Un test que solo comprueba
 * que resuelve dominios pasaría igual si el rol fuera superusuario.
 */
describe("PgSitios — el dominio como autorización (ADR-19)", () => {
  let db: TestDb;
  let s: Seed;
  let sitios: PgSitios;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);

    await db.asService(
      `update clients set domain = $2, storyblok_space_id = $3,
                          storyblok_public_token = 'pub-111', storyblok_preview_token = 'prv-111',
                          business_profile = '{"name":"Trattoria Bella Napoli"}'::jsonb
         where id = $1`,
      [s.clientA1, "bellanapoli.es", "111"],
    );
    // Cliente de OTRO tenant, también publicado: el renderizador sirve a los dos.
    await db.asService(
      "update clients set domain = $2, storyblok_space_id = $3 where id = $1",
      [s.clientB1, "sushizen.es", "222"],
    );

    // PGlite y TestDb comparten instancia; el pool va contra la misma base sembrada.
    sitios = new PgSitios(new PglitePool(db.pglite));
  });

  after(async () => await db.close());

  it("resuelve un dominio publicado y trae solo lo que es público", async () => {
    const sitio = await sitios.porDominio("bellanapoli.es");

    assert.ok(sitio, "el dominio publicado tiene que resolver");
    assert.equal(sitio.clientId, s.clientA1);
    assert.equal(sitio.spaceId, "111");
    assert.equal(sitio.publicToken, "pub-111");
    assert.equal(sitio.previewToken, "prv-111");
    assert.equal(sitio.languageCode, "es");
    assert.deepEqual(sitio.businessProfile, { name: "Trattoria Bella Napoli" });
  });

  it("resuelve el dominio de OTRO tenant: no hay tenant que filtrar, y es a propósito", async () => {
    // El renderizador es un servicio multi-tenant (1 servicio, N dominios). Si filtrara por
    // tenant, tendría que sacarlo del propio dominio — un control autoexpedido.
    const sitio = await sitios.porDominio("sushizen.es");
    assert.equal(sitio?.clientId, s.clientB1);
  });

  it("normaliza el host: el `Host` de un navegador no viene en forma canónica", async () => {
    const sitio = await sitios.porDominio("BellaNapoli.ES");
    assert.equal(sitio?.clientId, s.clientA1);
  });

  it("un dominio desconocido es null, sin decir por qué", async () => {
    assert.equal(await sitios.porDominio("no-existe.es"), null);
  });

  it("un cliente SIN dominio no es alcanzable ni enumerable", async () => {
    // clientA2 (Bar Pepe) existe, pero nunca publicó. Para el renderizador no existe.
    const filas = await db.asRender("select id from clients where id = $1", [s.clientA2]);
    assert.equal(filas.length, 0);
  });

  it("archivar al cliente APAGA su web, sin tocar el renderizador", async () => {
    // El offboarding de ADR-11 no puede depender de que alguien se acuerde de un segundo paso.
    await db.asService("update clients set archived_at = now() where id = $1", [s.clientB1]);
    try {
      assert.equal(await sitios.porDominio("sushizen.es"), null);
    } finally {
      await db.asService("update clients set archived_at = null where id = $1", [s.clientB1]);
    }
  });

  // ------------------------------------------------------------------ el radio de explosión

  it("app_render NO puede leer las columnas privadas de clients", async () => {
    // `prompt_negocio` es el brief comercial que escribió el cliente. No es asunto de un visitante.
    await assert.rejects(
      () => db.asRender("select prompt_negocio from clients"),
      /permission denied|no tiene permiso/i,
      "el grant es por columna: pedir una de fuera de la lista tiene que fallar",
    );
  });

  it("un `select *` sobre clients FALLA en vez de devolver de más", async () => {
    // Es ruidoso a propósito. Si mañana alguien agrega una columna sensible a `clients`, el default
    // tiene que ser "no visible", no "visible hasta que alguien lo note".
    await assert.rejects(() => db.asRender("select * from clients"), /permission denied|no tiene permiso/i);
  });

  it("app_render NO puede leer el research de nadie", async () => {
    for (const tabla of ["kr_runs", "kr_pages", "kr_keywords"]) {
      await assert.rejects(
        () => db.asRender(`select * from ${tabla}`),
        /permission denied|no tiene permiso/i,
        `${tabla} tiene que estar fuera del alcance del renderizador`,
      );
    }
  });

  it("app_render NO puede leer memberships ni tenants: la cartera no se enumera", async () => {
    for (const tabla of ["memberships", "tenants"]) {
      await assert.rejects(
        () => db.asRender(`select * from ${tabla}`),
        /permission denied|no tiene permiso/i,
      );
    }
  });

  it("app_render NO puede escribir nada, ni siquiera en la tabla que lee", async () => {
    await assert.rejects(
      () => db.asRender("update clients set domain = 'robado.es'"),
      /permission denied|no tiene permiso/i,
    );
  });

  it("app_render NO puede derivar autoridad desde una membresía", async () => {
    // `app.current_role()` existe para convertir una membresía en permisos. Falla — pero OJO con
    // por qué: **no** porque falte EXECUTE (el schema tiene USAGE y las funciones son ejecutables
    // por defecto), sino porque su cuerpo lee `memberships`, que este rol no puede tocar.
    //
    // La distinción importa y yo la había escrito mal: el README decía "no puede ejecutar las
    // funciones de `app`", y eso es falso (10ª review, #9). Lo que protege no es el permiso de
    // ejecución, es que las funciones son SECURITY INVOKER: corren con los privilegios de quien
    // llama, así que no pueden alcanzar nada que el llamador no alcance por su cuenta.
    await assert.rejects(
      () => db.asRender("select app.current_role()"),
      /permission denied|no tiene permiso/i,
    );
  });

  it("las funciones de `app` que SÍ puede ejecutar no le dan nada", async () => {
    // Son ejecutables, y está bien que lo sean: sin contexto de sesión devuelven vacío.
    const [t] = await db.asRender<{ v: string | null }>("select app.current_tenant_id() as v");
    assert.equal(t?.v, null, "sin GUC de tenant no hay tenant que reclamar");

    const [s] = await db.asRender<{ v: boolean }>("select app.es_servicio() as v");
    assert.equal(s?.v, false, "y no es el servicio");
  });
});

describe("Las garantías que estaban escritas y no impuestas (10ª review)", () => {
  let db: TestDb;
  let s: Seed;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);
  });

  after(async () => await db.close());

  it("🔴 #1 — dos clientes NO pueden compartir el mismo space de Storyblok", async () => {
    // ADR-04/ADR-11 lo afirmaban desde el día uno y nada lo impedía. Con el space compartido, los
    // dos clientes se pisan el contenido en Storyblok Y comparten entradas de cache en el
    // renderizador: una visita a la web de B devuelve el HTML de A, sin consultar el token de B.
    await db.asService("update clients set storyblok_space_id = 'DUP' where id = $1", [s.clientA1]);

    await assert.rejects(
      () => db.asService("update clients set storyblok_space_id = 'DUP' where id = $1", [s.clientB1]),
      /duplicate key|unique/i,
      "el segundo cliente con el mismo space tiene que rebotar",
    );
  });

  it("varios clientes SIN space conviven: `unique` deja pasar los NULL", async () => {
    // Un cliente todavía sin space es lo normal al darlo de alta. No puede ser un error.
    const filas = await db.asService<{ n: string }>(
      "select count(*) as n from clients where storyblok_space_id is null",
    );
    assert.ok(Number(filas[0]?.n) >= 2, "tiene que haber varios clientes sin space, sin conflicto");
  });

  it("🔴 un space vacío o con espacios se rechaza: parece un dato válido y no lo es", async () => {
    for (const malo of ["", "   ", "11 1"]) {
      await assert.rejects(
        () => db.asService("update clients set storyblok_space_id = $2 where id = $1", [s.clientA2, malo]),
        /check|constraint/i,
        `debería rechazar el space ${JSON.stringify(malo)}`,
      );
    }
  });

  it("🔴 #8 — app_render ve el NAP, NO los campos privados de la ficha", async () => {
    // La afirmación de 0007 ("lo que se llevan ya era público") era falsa: el grant daba el jsonb
    // entero. Ahora la allowlist la impone una columna generada, no el código que la consume.
    await db.asService(
      `update clients set domain = 'napolitana.es', storyblok_space_id = 'S1',
                          business_profile = $2::jsonb
         where id = $1`,
      [
        s.clientA2,
        JSON.stringify({
          name: "Trattoria",
          telephone: "+34 910 000 000",
          address: { streetAddress: "Mayor 1", postalCode: "28013", addressLocality: "Madrid", piso: "3ºB" },
          notas_internas: "no paga hace tres meses",
          email_dueno: "privado@ejemplo.es",
        }),
      ],
    );

    const [fila] = await db.asRender<{ p: Record<string, unknown> }>(
      "select business_profile_publico as p from clients where domain = 'napolitana.es'",
    );
    const perfil = fila?.p ?? {};

    assert.equal(perfil["name"], "Trattoria", "el NAP sí pasa");
    assert.equal(perfil["notas_internas"], undefined, "las notas internas NO");
    assert.equal(perfil["email_dueno"], undefined, "el email del dueño tampoco");

    const dir = perfil["address"] as Record<string, unknown>;
    assert.equal(dir["postalCode"], "28013");
    assert.equal(dir["piso"], undefined, "ni siquiera escondido dentro de `address`");
  });

  it("🔴 #8 — la columna CRUDA sigue estando fuera de su alcance", async () => {
    await assert.rejects(
      () => db.asRender("select business_profile from clients"),
      /permission denied|no tiene permiso/i,
    );
  });
});

describe("MemSitios", () => {
  it("se comporta igual que PgSitios ante un host en mayúsculas y uno desconocido", async () => {
    const m = new MemSitios([
      {
        clientId: "c1",
        domain: "bellanapoli.es",
        spaceId: "111",
        publicToken: null,
        previewToken: null,
        businessProfile: null,
        languageCode: "es",
      },
    ]);

    assert.equal((await m.porDominio("BELLANAPOLI.es"))?.clientId, "c1");
    assert.equal(await m.porDominio("otro.es"), null);
  });
});
