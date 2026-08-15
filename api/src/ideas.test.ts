import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore, PgClientes, PgMembresias, PgIdeas, PgResenas } from "db";
import { createApp } from "./app.js";
import { MockGoogleOAuthProvider } from "./google-oauth.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

/**
 * Los tres endpoints de IDEAS (pieza 3 del portal, Etapa 3), contra Postgres REAL (PGlite).
 *
 * El montaje es el de `app.test.ts`: lo único de mentira son la criptografía del token y el emisor de
 * Inngest. **La autorización la hace RLS de verdad**, que es justo lo que hay que probar acá — una
 * idea guarda la voz de un cliente real y lo que un LLM dedujo de ella, y quién la ve y quién puede
 * tocarla lo deciden `idea_select` e `idea_update` (migración 0013), no un `if` de este paquete.
 *
 * Lo que estos tests fijan, y por qué cada uno:
 *
 *  · **el listado NO lleva transcripción ni análisis** — contrato de exposición, no permiso: nadie
 *    necesita 200 transcripciones para pintar un contador (el recorte ya empieza en el `select` de
 *    `listarIdeas`, y esto lo ata desde el otro extremo, el que ve el navegador);
 *  · **un rol `cliente` ve solo las ideas de su negocio y no puede tocarlas** (ADR-20);
 *  · **una transición inválida es un 400 con motivo**, no un 500 con un `23514` crudo;
 *  · **las marcas de tiempo salen por el cable como string ISO-8601 UTC** — la frontera que ningún
 *    test del monorepo ve, porque `portal/` no es workspace.
 */

let pg: PGlite;
let app: ReturnType<typeof createApp>;

let tenantA: string;
let tenantB: string;
let clientA1: string; // el negocio de duenoA1
let clientA2: string; // OTRO negocio del MISMO tenant: sin él no hay nada cuya ausencia comprobar
let clientB1: string;
let equipoA: string; // rol equipo en A: ve todo el tenant y puede escribir
let maestroA: string;
let duenoA1: string; // rol cliente en A, atado a clientA1: SOLO lectura, y solo lo suyo
let equipoB: string;

let ideaA1: string; // de clientA1, estado `nueva`, con transcripción y análisis
let ideaA2: string; // de clientA2 (mismo tenant, otro negocio)
let ideaB1: string; // del tenant B
let ideaA1EnRevision: string; // de clientA1, ya `en_revision`: para aprobar/rechazar

const verificar: VerificadorToken = async (token) =>
  token.startsWith("valid:") ? { userId: token.slice(6) } : null;

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const res = await pg.query<T>(q, params);
  return res.rows;
}

/** El análisis del LLM tal cual lo produce el flujo de audio: las ocho claves admitidas. */
const ANALISIS_EJEMPLO = {
  audiencia_objetivo: "familias del barrio",
  canales_comunicacion: ["instagram", "whatsapp"],
  intencion: "promocionar el menú del día",
  materiales_formatos: ["reel", "carta impresa"],
  observaciones: "el dueño habla rápido",
  checklist_interpretacion: ["confirmar precios"],
  ideas_complementarias: ["sorteo de dos menús"],
  tipo_accion: "campaña",
};

beforeEach(async () => {
  pg = new PGlite();
  await aplicarMigraciones(pg);
  const pool = new PglitePool(pg);
  const emisor: EmisorEventos = { send: async () => ({}) };
  app = createApp({
    store: new PgStore(pool),
    clientes: new PgClientes(pool),
    membresias: new PgMembresias(pool),
    ideas: new PgIdeas(pool),
    resenas: new PgResenas(pool),
    googleOAuth: new MockGoogleOAuthProvider(),
    emisor,
    verificar,
    portalUrl: "http://localhost:4200",
  });

  // --- seed (superusuario: saltea RLS, que es lo que hace la infraestructura, no la app) ---
  [tenantA, tenantB] = (
    await sql<{ id: string }>(
      `insert into tenants (nombre, slug)
       values ('Agencia A','agencia-a'), ('Agencia B','agencia-b') returning id`,
    )
  ).map((r) => r.id) as [string, string];

  [clientA1, clientA2] = (
    await sql<{ id: string }>(
      `insert into clients (tenant_id, nombre) values ($1,'Borcelle Burger'), ($1,'Bella Napoli') returning id`,
      [tenantA],
    )
  ).map((r) => r.id) as [string, string];

  [clientB1] = (
    await sql<{ id: string }>("insert into clients (tenant_id, nombre) values ($1,'Sushi Zen') returning id", [
      tenantB,
    ])
  ).map((r) => r.id) as [string];

  const mkMembresia = async (tenantId: string, rol: string, clientId: string | null) =>
    (
      await sql<{ user_id: string }>(
        `insert into memberships (tenant_id, user_id, rol, client_id)
         values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
        [tenantId, rol, clientId],
      )
    )[0]!.user_id;

  equipoA = await mkMembresia(tenantA, "equipo", null);
  maestroA = await mkMembresia(tenantA, "maestro", null);
  duenoA1 = await mkMembresia(tenantA, "cliente", clientA1);
  equipoB = await mkMembresia(tenantB, "equipo", null);

  // Las ideas se insertan con la infraestructura a propósito: `app_user` NO tiene grant de insert
  // sobre `ideas` (0013), porque el ingreso real (el flujo de audio de n8n) todavía no existe.
  const mkIdea = async (
    tenantId: string,
    clientId: string,
    titulo: string,
    estado: string | null,
  ): Promise<string> =>
    (
      await sql<{ id: string }>(
        `insert into ideas (tenant_id, client_id, titulo, estado, resumen, transcripcion, audio_url,
                            carpeta_url, mensaje_de, analisis)
         values ($1, $2, $3, coalesce($4::idea_estado, 'nueva'), 'Resumen de ejemplo',
                 'Hola, quería contarles una idea para el finde', 'https://audios.example/a1.ogg',
                 'https://drive.example/carpeta', 'Frank', $5::jsonb)
         returning id`,
        [tenantId, clientId, titulo, estado, JSON.stringify(ANALISIS_EJEMPLO)],
      )
    )[0]!.id;

  ideaA1 = await mkIdea(tenantA, clientA1, "Menú del día en Instagram", null);
  ideaA1EnRevision = await mkIdea(tenantA, clientA1, "Sorteo de dos menús", "en_revision");
  ideaA2 = await mkIdea(tenantA, clientA2, "Carta nueva de pizzas", null);
  ideaB1 = await mkIdea(tenantB, clientB1, "Promoción de sushi", null);
});

afterEach(async () => {
  await pg.close();
});

async function req(
  method: string,
  path: string,
  opts: { user?: string; tenant?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  else if (opts.user) headers["authorization"] = `Bearer valid:${opts.user}`;
  if (opts.tenant) headers["x-amg-tenant"] = opts.tenant;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

/** El estado de una idea leído SIN pasar por la API (superusuario): "¿de verdad no cambió?". */
async function estadoDe(id: string): Promise<string | undefined> {
  return (await sql<{ estado: string }>("select estado from ideas where id = $1", [id]))[0]?.estado;
}

type ItemListado = Record<string, unknown>;

// ---------------------------------------------------------------- GET /ideas

test("GET /ideas sin token → 401", async () => {
  const res = await req("GET", "/ideas", { tenant: tenantA });
  assert.equal(res.status, 401);
});

test("🔴 GET /ideas: el tenant A NO ve las ideas del tenant B", async () => {
  const res = await req("GET", "/ideas", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  const ids = body.ideas.map((i) => i["id"]);
  assert.ok(!ids.includes(ideaB1), "la idea del tenant B NO puede aparecer");
  assert.ok(ids.includes(ideaA1) && ids.includes(ideaA2), "y sí las suyas, las de los dos negocios");
});

test("🔴 GET /ideas: un rol `cliente` ve SOLO las ideas de su negocio", async () => {
  const res = await req("GET", "/ideas", { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  const ids = body.ideas.map((i) => i["id"]);
  assert.ok(!ids.includes(ideaA2), "NO ve la idea del otro negocio del MISMO tenant");
  assert.deepEqual(new Set(ids), new Set([ideaA1, ideaA1EnRevision]));
});

test("🔴 GET /ideas NO devuelve transcripción ni análisis en NINGÚN ítem, ni para un maestro", async () => {
  const res = await req("GET", "/ideas", { user: maestroA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  assert.ok(body.ideas.length > 0, "sin ítems este test no comprobaría nada");
  for (const item of body.ideas) {
    // Conjunto EXACTO: una clave nueva en el resumen tiene que ser una decisión, no un descuido.
    assert.deepEqual(
      new Set(Object.keys(item)),
      new Set(["id", "client_id", "titulo", "estado", "creada_en"]),
      "el listado son cinco campos y ninguno es el contenido de la idea",
    );
  }
});

test("GET /ideas?estado= filtra por estado", async () => {
  const res = await req("GET", "/ideas?estado=en_revision", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  assert.deepEqual(
    body.ideas.map((i) => i["id"]),
    [ideaA1EnRevision],
  );
});

test("GET /ideas?clientId= filtra por cliente", async () => {
  const res = await req("GET", `/ideas?clientId=${clientA2}`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  assert.deepEqual(
    body.ideas.map((i) => i["id"]),
    [ideaA2],
  );
});

test("GET /ideas?estado=aprovada (un typo) → 400, y no un 500 ni un listado vacío", async () => {
  // Un listado vacío sería lo peor de los tres: parecería "no hay ideas en ese estado".
  const res = await req("GET", "/ideas?estado=aprovada", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 400);
});

test("GET /ideas?limite= acota el número de ítems", async () => {
  const res = await req("GET", "/ideas?limite=1", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ideas: ItemListado[] };
  assert.equal(body.ideas.length, 1);
});

test("un filtro VACÍO es un filtro ausente: `?estado=`, `?clientId=` y `?limite=` devuelven el listado entero", async () => {
  /*
   * Los tres se comportaban distinto: `limite=` caía al default (200), `estado=` daba 400 con su
   * mensaje y `clientId=` daba 400 con un mensaje genérico que además menciona `market`, que no
   * existe en ideas (medido con curl contra el dev-server durante la revisión). Un `<select>` de
   * "todos los clientes" en Angular con `[(ngModel)]` sobre `''` emite exactamente `clientId=`, así
   * que la inconsistencia se volvía un bug de la Etapa 5 el primer día.
   *
   * Un parámetro presente y vacío es la forma en que un formulario dice "sin filtro", no un valor.
   */
  const completo = await req("GET", "/ideas", { user: equipoA, tenant: tenantA });
  const esperado = ((await completo.json()) as { ideas: ItemListado[] }).ideas.map((i) => i["id"]);
  assert.ok(esperado.length > 1, "sin varias ideas este test no distinguiría 'todo' de 'filtrado'");

  for (const query of ["?estado=", "?clientId=", "?limite=", "?estado=&clientId=&limite=", "?clientId=%20"]) {
    const res = await req("GET", `/ideas${query}`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200, `${query} no puede ser un 400`);
    const body = (await res.json()) as { ideas: ItemListado[] };
    assert.deepEqual(
      body.ideas.map((i) => i["id"]),
      esperado,
      `${query} tiene que devolver lo mismo que no mandar el parámetro`,
    );
  }
});

// ---------------------------------------------------------------- GET /ideas/:id

test("GET /ideas/:id: el detalle SÍ lleva la transcripción y el análisis", async () => {
  const res = await req("GET", `/ideas/${ideaA1}`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { idea: Record<string, unknown> };
  assert.equal(body.idea["id"], ideaA1);
  assert.equal(body.idea["transcripcion"], "Hola, quería contarles una idea para el finde");
  assert.deepEqual(body.idea["analisis"], ANALISIS_EJEMPLO);
  assert.equal(body.idea["audio_url"], "https://audios.example/a1.ogg");
});

test("🔴 GET /ideas/:id de OTRO tenant → 404 con el MISMO cuerpo que un id inexistente", async () => {
  const ajena = await req("GET", `/ideas/${ideaB1}`, { user: equipoA, tenant: tenantA });
  assert.equal(ajena.status, 404);
  const inexistente = await req("GET", "/ideas/00000000-0000-4000-8000-000000000000", {
    user: equipoA,
    tenant: tenantA,
  });
  assert.equal(inexistente.status, 404);
  assert.deepEqual(await ajena.json(), await inexistente.json(), "el 404 no revela que la idea exista");
});

test("🔴 GET /ideas/:id: un rol `cliente` pidiendo la idea de OTRO negocio del mismo tenant → 404", async () => {
  const res = await req("GET", `/ideas/${ideaA2}`, { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 404);
});

test("GET /ideas/:id con un id que no es uuid → 400 (no 500)", async () => {
  const res = await req("GET", "/ideas/no-soy-un-uuid", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------- las marcas de tiempo por el cable

test("las marcas de tiempo salen por el CABLE como string ISO-8601 UTC, no como objeto", async () => {
  /*
   * La frontera que ningún test del monorepo ve: `portal/` no es workspace. `db/src/ideas.ts` tipa
   * `creada_en` como `Date`, y lo que el navegador recibe es lo que haya salido de `JSON.stringify`.
   * Este test mira el JSON crudo, no el tipo.
   */
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  const listado = await req("GET", "/ideas", { user: equipoA, tenant: tenantA });
  const { ideas } = JSON.parse(await listado.text()) as { ideas: Array<Record<string, unknown>> };
  assert.ok(ideas.length > 0);
  for (const i of ideas) assert.match(String(i["creada_en"]), ISO);

  const detalle = await req("GET", `/ideas/${ideaA1}`, { user: equipoA, tenant: tenantA });
  const { idea } = JSON.parse(await detalle.text()) as { idea: Record<string, unknown> };
  assert.match(String(idea["creada_en"]), ISO);
  assert.match(String(idea["actualizada_en"]), ISO);
  assert.ok(Number.isFinite(new Date(String(idea["creada_en"])).getTime()), "y el portal lo puede parsear");
});

test("🔴 si la capa de datos entregara las fechas como STRING de Postgres, la API las normaliza igual", async () => {
  /*
   * Ésta es la mutación que muerde. El test de arriba pasa aunque la API devuelva la fila cruda,
   * porque el driver actual (PGlite, y `pg` en producción) ya entrega `timestamptz` como `Date` y
   * `JSON.stringify` lo escribe en ISO. O sea: aquel test fija el CONTRATO con el portal, pero no
   * fija que la API haga algo.
   *
   * Acá se inyecta una capa de datos que devuelve lo que devolvería un driver configurado para no
   * parsear fechas (`'2026-08-09 12:34:56.789+00'`, el formato de salida de Postgres, que **no** es
   * ISO-8601: lleva espacio en vez de `T` y offset sin dos puntos en algunas versiones). Si alguien
   * quita la normalización, el portal recibe eso y `new Date(...)` se vuelve dependiente del motor
   * de JS. Es legítimo inyectar acá: lo que se está probando es la serialización de la API, no RLS.
   */
  const CRUDO = "2026-08-09 12:34:56.789+00";
  const fila = {
    id: ideaA1,
    client_id: clientA1,
    titulo: "Con fecha en crudo",
    estado: "nueva",
    creada_en: CRUDO,
    resumen: null,
    transcripcion: null,
    audio_url: null,
    carpeta_url: null,
    mensaje_de: null,
    analisis: {},
    actualizada_en: CRUDO,
  };
  const ideasFalsas = {
    listarIdeas: async () => [fila],
    obtenerIdea: async () => fila,
    cambiarEstado: async () => ({ ok: true, estado: "nueva" }),
    editarIdea: async () => true,
  } as unknown as PgIdeas;
  const pool = new PglitePool(pg);
  const appFalsa = createApp({
    store: new PgStore(pool),
    clientes: new PgClientes(pool),
    membresias: new PgMembresias(pool),
    ideas: ideasFalsas,
    resenas: new PgResenas(pool),
    googleOAuth: new MockGoogleOAuthProvider(),
    emisor: { send: async () => ({}) },
    verificar,
    portalUrl: "http://localhost:4200",
  });

  const res = await appFalsa.request("/ideas", {
    headers: { authorization: `Bearer valid:${equipoA}`, "x-amg-tenant": tenantA },
  });
  const { ideas } = JSON.parse(await res.text()) as { ideas: Array<Record<string, unknown>> };
  assert.equal(ideas[0]!["creada_en"], "2026-08-09T12:34:56.789Z", "la API normaliza a ISO-8601 UTC");
});

// ---------------------------------------------------------------- PATCH /ideas/:id — el estado

test("PATCH /ideas/:id: el equipo mueve una idea de `nueva` a `en_revision`", async () => {
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "en_revision" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, estado: "en_revision" });
  assert.equal(await estadoDe(ideaA1), "en_revision");
});

test("PATCH /ideas/:id: `en_revision` → `aprobada` funciona (el camino feliz de la compuerta)", async () => {
  const res = await req("PATCH", `/ideas/${ideaA1EnRevision}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "aprobada" },
  });
  assert.equal(res.status, 200);
  assert.equal(await estadoDe(ideaA1EnRevision), "aprobada");
});

test("🔴 PATCH /ideas/:id con una transición INVÁLIDA → 400 con el estado de origen, y la fila no cambia", async () => {
  // `nueva → aprobada` se saltearía la revisión, que es el producto entero (ADR-20).
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "aprobada" },
  });
  assert.equal(res.status, 400, "400, no 500: la petición es del cliente y el motivo se puede explicar");
  const body = (await res.json()) as { error: string; desde?: string; hacia?: string };
  assert.equal(body.desde, "nueva", "el motivo dice DE DÓNDE venía, para que la pantalla lo explique");
  assert.equal(body.hacia, "aprobada");
  assert.equal(await estadoDe(ideaA1), "nueva", "y la idea sigue donde estaba");
});

test("🔴 PATCH /ideas/:id con un estado que no existe ('aprovada') → 400 sin tocar la base, y NO como error de transición", async () => {
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "aprovada" },
  });
  assert.equal(res.status, 400);
  assert.equal(await estadoDe(ideaA1), "nueva");

  /*
   * La aserción que hace mordible a la validación, y es ESTRUCTURAL, no de redacción: `desde`/`hacia`
   * son la firma de un error **de transición**, y un estado que no existe no es una transición
   * inválida — no hay tal transición. Sin el `esEstadoIdea` del handler, `esTransicionValida` cae por
   * el otro camino y el portal recibe `{"error":"Transición de estado inválida: nueva → aprovada.",
   * "desde":"nueva","hacia":"aprovada"}`: mismo status, cuerpo que MIENTE. El cuerpo es contrato.
   *
   * Acoplar el test a la frase del mensaje sería peor (los tests prueban el contrato, no el texto);
   * la ausencia de una clave sí es contrato.
   */
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body["desde"], undefined, "un estado inexistente no es un error de transición");
  assert.equal(body["hacia"], undefined);
});

test("🔴 PATCH /ideas/:id: un rol `cliente` NO puede mover SU PROPIA idea → 404, sin efecto (ADR-20)", async () => {
  /*
   * 404 y no 403, y está decidido en la BASE: `app.puede_escribir()` va en el `using` de
   * `idea_update` (0013), así que la fila ni siquiera se alcanza — `cambiarEstado` bloquea con
   * `select … for update`, obtiene 0 filas y devuelve `no_encontrada`. Si el producto quisiera un
   * 403, lo que hay que mover es esa condición al `with check`; no es un detalle de la API.
   */
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { estado: "en_revision" },
  });
  assert.equal(res.status, 404);
  assert.equal(await estadoDe(ideaA1), "nueva", "el dueño del negocio no movió su idea");
});

test("🔴 PATCH /ideas/:id de OTRO tenant → 404 con el MISMO cuerpo que un id inexistente, y sin efecto", async () => {
  const ajena = await req("PATCH", `/ideas/${ideaB1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "en_revision" },
  });
  assert.equal(ajena.status, 404);
  const inexistente = await req("PATCH", "/ideas/00000000-0000-4000-8000-000000000000", {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "en_revision" },
  });
  assert.equal(inexistente.status, 404);
  assert.deepEqual(await ajena.json(), await inexistente.json());
  assert.equal(await estadoDe(ideaB1), "nueva", "el tenant A no tocó la idea de B");
});

// ---------------------------------------------------------------- PATCH /ideas/:id — el contenido

test("PATCH /ideas/:id: el equipo corrige el contenido (título, resumen, transcripción, análisis)", async () => {
  const analisisNuevo = { ...ANALISIS_EJEMPLO, observaciones: "corregido a mano" };
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: {
      titulo: "Menú del día — corregido",
      resumen: "Otro resumen",
      transcripcion: "Transcripción revisada",
      mensaje_de: "Frank (WhatsApp)",
      audio_url: "https://audios.example/a1-v2.ogg",
      carpeta_url: null,
      analisis: analisisNuevo,
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const [fila] = await sql<Record<string, unknown>>(
    "select titulo, resumen, transcripcion, mensaje_de, audio_url, carpeta_url, analisis from ideas where id = $1",
    [ideaA1],
  );
  assert.equal(fila!["titulo"], "Menú del día — corregido");
  assert.equal(fila!["transcripcion"], "Transcripción revisada");
  assert.equal(fila!["carpeta_url"], null);
  assert.deepEqual(fila!["analisis"], analisisNuevo);
});

test("🔴 PATCH /ideas/:id: `tenant_id`, `client_id` e `id` en el body NO tienen por dónde entrar", async () => {
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { titulo: "Nuevo título", tenant_id: tenantB, client_id: clientB1, id: ideaB1, estado_: "x" },
  });
  assert.equal(res.status, 200, "los campos ajenos se ignoran; el título sí se aplica");

  const [fila] = await sql<{ tenant_id: string; client_id: string; titulo: string }>(
    "select tenant_id, client_id, titulo from ideas where id = $1",
    [ideaA1],
  );
  assert.equal(fila!["tenant_id"], tenantA, "la idea no se mudó de tenant");
  assert.equal(fila!["client_id"], clientA1, "ni de negocio");
  assert.equal(fila!["titulo"], "Nuevo título");
});

test("🔴 PATCH /ideas/:id: un rol `cliente` NO puede editar el contenido de SU PROPIA idea → 404", async () => {
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { titulo: "Lo edito yo" },
  });
  assert.equal(res.status, 404);
  const [fila] = await sql<{ titulo: string }>("select titulo from ideas where id = $1", [ideaA1]);
  assert.equal(fila!["titulo"], "Menú del día en Instagram", "sin efecto: la revisa la agencia");
});

test("🔴 PATCH /ideas/:id: una `audio_url` que no es http(s) → 400 sin tocar la base", async () => {
  // `javascript:` en un `<a href>` del portal es XSS. La base solo mira el TAMAÑO de la URL (0013):
  // el esquema no lo mira nadie más que esta validación.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "ftp://x/y", "no-es-una-url"]) {
    const res = await req("PATCH", `/ideas/${ideaA1}`, {
      user: equipoA,
      tenant: tenantA,
      body: { audio_url: url },
    });
    assert.equal(res.status, 400, `${url} tendría que rechazarse`);
  }
  const [fila] = await sql<{ audio_url: string }>("select audio_url from ideas where id = $1", [ideaA1]);
  assert.equal(fila!["audio_url"], "https://audios.example/a1.ogg", "ninguna de las cuatro entró");
});

test("PATCH /ideas/:id: `carpeta_url` con http:// se acepta, y `null` borra la URL", async () => {
  const conHttp = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { carpeta_url: "http://intranet.local/carpeta" },
  });
  assert.equal(conHttp.status, 200);

  const borrada = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { carpeta_url: null },
  });
  assert.equal(borrada.status, 200);
  const [fila] = await sql<{ carpeta_url: string | null }>("select carpeta_url from ideas where id = $1", [
    ideaA1,
  ]);
  assert.equal(fila!["carpeta_url"], null);
});

test("🔴 PATCH /ideas/:id: una clave desconocida en `analisis` → 400, y no se descarta en silencio", async () => {
  // Descartarla en silencio haría que la pantalla crea que guardó algo que no guardó.
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { analisis: { ...ANALISIS_EJEMPLO, precio_interno: 1200 } },
  });
  assert.equal(res.status, 400);
  const [fila] = await sql<{ analisis: Record<string, unknown> }>("select analisis from ideas where id = $1", [
    ideaA1,
  ]);
  assert.deepEqual(fila!["analisis"], ANALISIS_EJEMPLO, "el análisis quedó como estaba");
});

test("🔴 PATCH /ideas/:id: un tipo equivocado en una clave CONOCIDA → 400, y ninguna otra clave se aplica", async () => {
  /*
   * Antes esto devolvía `{"ok":true}` con el título sin guardar (medido con curl en la revisión): la
   * clave se descartaba en silencio. Es exactamente lo que la cabecera de `ideas-http.ts` argumenta
   * que no hay que hacer con `analisis` —"le haría creer a la pantalla que guardó algo que no
   * guardó"— y las URL ya rechazaban. Un criterio que vale para dos claves y no para las otras cinco
   * es un criterio a medias.
   *
   * Las claves DESCONOCIDAS siguen ignorándose (eso es otra cosa, y tiene su propio test): lo que se
   * rechaza es una clave que el endpoint SÍ acepta, con un valor que no puede guardar.
   */
  /*
   * Cada caso lleva UNA clave mala y UNA buena, y eso es lo que lo hace morder. Con la clave mala
   * sola, el body queda sin campos aplicables y sale 400 por la otra rama ("no hay ningún campo
   * editable"): el test pasaría con el rechazo de tipos quitado, midiendo otra cosa. Medido — así
   * empezó este test, y la mutación M14 lo dejaba en verde.
   *
   * El vector real es justamente éste: una clave mala **acompañada** de una buena, que es cuando el
   * descarte silencioso devolvía `{"ok":true}` habiendo aplicado la mitad.
   */
  const BUENA = "acompañante válido";
  const casos: Array<Record<string, unknown>> = [
    { titulo: 12345, resumen: BUENA },
    { titulo: null, resumen: BUENA }, // `titulo` es `not null`: null no es "borrar", es un error
    { resumen: 42, titulo: BUENA },
    { transcripcion: { a: 1 }, titulo: BUENA },
    { mensaje_de: ["Frank"], titulo: BUENA },
    { audio_url: 42, titulo: BUENA },
    { carpeta_url: true, titulo: BUENA },
  ];
  for (const body of casos) {
    const res = await req("PATCH", `/ideas/${ideaA1}`, { user: equipoA, tenant: tenantA, body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} tendría que rechazarse`);
  }

  const [fila] = await sql<{ titulo: string; resumen: string | null }>(
    "select titulo, resumen from ideas where id = $1",
    [ideaA1],
  );
  assert.equal(fila!["titulo"], "Menú del día en Instagram");
  assert.equal(fila!["resumen"], "Resumen de ejemplo", "la clave BUENA de cada caso tampoco se aplicó");
});

test("PATCH /ideas/:id: `analisis` que no es un objeto (array, string, null) → 400", async () => {
  for (const v of [[1, 2], "texto", 5, null]) {
    const res = await req("PATCH", `/ideas/${ideaA1}`, { user: equipoA, tenant: tenantA, body: { analisis: v } });
    assert.equal(res.status, 400, `analisis = ${JSON.stringify(v)} tendría que rechazarse`);
  }
});

test("PATCH /ideas/:id mezclando `estado` con campos de contenido → 400, sin aplicar ninguna mitad", async () => {
  /*
   * Son DOS escrituras (`cambiarEstado` y `editarIdea`) en dos transacciones distintas: aceptarlas
   * juntas podría dejar la primera aplicada y fallar la segunda, o sea un PATCH que aplica la mitad
   * y contesta error. Se rechaza la mezcla en vez de mentir sobre la atomicidad.
   */
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { estado: "en_revision", titulo: "Y de paso el título" },
  });
  assert.equal(res.status, 400);
  assert.equal(await estadoDe(ideaA1), "nueva");
  const [fila] = await sql<{ titulo: string }>("select titulo from ideas where id = $1", [ideaA1]);
  assert.equal(fila!["titulo"], "Menú del día en Instagram", "ninguna de las dos mitades se aplicó");
});

test("PATCH /ideas/:id sin ningún campo aplicable → 400 (y no un 404 que mentiría sobre la existencia)", async () => {
  for (const body of [{}, { cualquier_cosa: 1 }]) {
    const res = await req("PATCH", `/ideas/${ideaA1}`, { user: equipoA, tenant: tenantA, body });
    assert.equal(res.status, 400);
  }
});

test("PATCH /ideas/:id con body que no es JSON → 400", async () => {
  const res = await app.request(`/ideas/${ideaA1}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer valid:${equipoA}`,
      "x-amg-tenant": tenantA,
      "content-type": "application/json",
    },
    body: "{no soy json",
  });
  assert.equal(res.status, 400);
});

test("🔴 PATCH /ideas/:id: un título que pasa el techo de 200 bytes → 400 (el 23514 de la base, no un 500)", async () => {
  /*
   * El tope lo impone `idea_titulo_razonable` (0013) y llega como `23514`, que el `onError` de la API
   * ya mapea a 400. Este test comprueba que ese mapeo ATERRIZA acá y no que existe en otra ruta: con
   * el mapeo quitado, esto sería un 500.
   */
  const res = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { titulo: "a".repeat(201) },
  });
  assert.equal(res.status, 400);
  const [fila] = await sql<{ titulo: string }>("select titulo from ideas where id = $1", [ideaA1]);
  assert.equal(fila!["titulo"], "Menú del día en Instagram");
});

test("🔴 GET /ideas y PATCH /ideas/:id con el tenant de OTRO reclamado a mano: cero filas, nunca un dato", async () => {
  // equipoB reclama el tenant A. No tiene membresía ahí, así que no deriva rol (ADR-15).
  const listado = await req("GET", "/ideas", { user: equipoB, tenant: tenantA });
  assert.equal(listado.status, 200);
  assert.deepEqual((await listado.json()) as { ideas: unknown[] }, { ideas: [] });

  const patch = await req("PATCH", `/ideas/${ideaA1}`, {
    user: equipoB,
    tenant: tenantA,
    body: { estado: "en_revision" },
  });
  assert.equal(patch.status, 404);
  assert.equal(await estadoDe(ideaA1), "nueva");
});
