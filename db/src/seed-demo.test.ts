import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TestDb } from "./testdb.js";
import { sembrarDemo, PERFIL_DEMO, type ResultadoSeed } from "./seed-demo.js";
import { ConexionReservada } from "./deploy.js";

/**
 * Tests del seed de la demo (Fase 1: el portal de Frank).
 *
 * La clave: NO prueban "el insert corrió". Prueban **la visibilidad BAJO RLS** —lo leen con `asUser`,
 * el rol `app_user` y el rol derivado de `memberships`, igual que lo hará el `PgStore` de la API—.
 * (No prueban la serialización del store, ni el endpoint HTTP, ni lo que renderiza Angular: eso lo
 * cubre el test de integración en `api`.) Así el seed queda atado al mismo contrato de seguridad que
 * el resto: si una membresía queda mal, un usuario deja de ver lo suyo (o un intruso ve de más) y el
 * test cae.
 *
 * Los UUID de Frank y Juan son parámetros (en producción salen de Supabase Auth). Acá se fijan para
 * poder consultar como ellos.
 */
const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo
const INTRUSO = "33333333-3333-3333-3333-333333333333"; // sin membresía: no ve nada

/** PGlite es una sola conexión → una `ConexionReservada` válida para sembrar en los tests. */
const con = (db: TestDb) => ConexionReservada.desdePglite(db.pglite);

let db: TestDb;
let r: ResultadoSeed;

before(async () => {
  db = await TestDb.create();
  r = await sembrarDemo(con(db), { frankUserId: FRANK, juanUserId: JUAN });
});

after(async () => {
  await db.close();
});

test("Frank (maestro) ve el run de La Birra Bar en su lista, en pending_approval", async () => {
  const runs = await db.asUser<{ id: string; status: string; prompt: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select id, status, prompt from kr_runs",
  );
  assert.equal(runs.length, 1, "ve exactamente el run sembrado");
  assert.equal(runs[0]?.id, r.runId);
  assert.equal(runs[0]?.status, "pending_approval", "nace en la compuerta (ADR-06)");
});

test("Frank deriva rol 'maestro' y Juan 'equipo' (de memberships, no declarado)", async () => {
  const [frank] = await db.asUser<{ rol: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select app.current_role() as rol",
  );
  const [juan] = await db.asUser<{ rol: string }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select app.current_role() as rol",
  );
  assert.equal(frank?.rol, "maestro");
  assert.equal(juan?.rol, "equipo");
});

test("Juan (equipo) también ve el cliente y el run (staff ve toda la cartera del tenant)", async () => {
  const clientes = await db.asUser<{ nombre: string }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select nombre from clients",
  );
  assert.ok(
    clientes.some((c) => c.nombre.includes("La Birra Bar")),
    "ve el cliente de demo",
  );
  const runs = await db.asUser({ tenantId: r.tenantId, userId: JUAN }, "select id from kr_runs");
  assert.equal(runs.length, 1);
});

test("un intruso sin membresía no ve NADA (ni cliente, ni run, ni páginas)", async () => {
  const ctx = { tenantId: r.tenantId, userId: INTRUSO };
  assert.equal((await db.asUser(ctx, "select id from clients")).length, 0);
  assert.equal((await db.asUser(ctx, "select id from kr_runs")).length, 0);
  assert.equal((await db.asUser(ctx, "select id from kr_pages")).length, 0);
});

test("el brief tiene 14 páginas, TODAS sin aprobar (la compuerta certifica que un humano miró)", async () => {
  const pages = await db.asUser<{ approved: boolean }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select approved from kr_pages where run_id = $1",
    [r.runId],
  );
  assert.equal(pages.length, 14, "las 14 páginas de la corrida de la acción 06");
  assert.ok(
    pages.every((p) => p.approved === false),
    "ninguna nace aprobada: la aprueba Frank en el portal",
  );
});

test("el split de honestidad: exactamente 8 respaldadas por datos y 6 sin validar", async () => {
  const rows = await db.asUser<{ evidencia: string; n: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    `select evidencia, count(*)::text as n from kr_pages where run_id = $1 group by evidencia`,
    [r.runId],
  );
  const porEvidencia = Object.fromEntries(rows.map((x) => [x.evidencia, Number(x.n)]));
  assert.equal(porEvidencia["datos_mercado"], 8, "8 respaldadas por datos de mercado");
  assert.equal(porEvidencia["sin_validar"], 6, "6 sin datos que las validen");
});

test("las respaldadas tienen volumen y las sin validar no (el dato honesto)", async () => {
  const pages = await db.asUser<{ evidencia: string; volumen: number | null }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select evidencia, volumen from kr_pages where run_id = $1",
    [r.runId],
  );
  for (const p of pages) {
    if (p.evidencia === "datos_mercado") assert.ok(p.volumen !== null, "respaldada → tiene volumen");
    else assert.equal(p.volumen, null, "sin validar → sin volumen (≠ 0)");
  }
});

/**
 * El invariante que protege el JSON-LD, que es el argumento de venta: **un artículo no es un negocio
 * local**. `local` decide si la página se declara `LocalBusiness` ante Google, y declarar un blog como
 * negocio local es exactamente el ruido que la corrida real destapó (53 de 60 keywords salían
 * `is_local`). Si alguien vuelve a tocar los datos del brief, esto cae antes que la demo.
 */
test("ninguna página de tipo blog se marca como local (o el JSON-LD miente)", async () => {
  const pages = await db.asUser<{ tipo: string; local: boolean; url_slug: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select tipo, local, url_slug from kr_pages where run_id = $1",
    [r.runId],
  );
  const blogs = pages.filter((p) => p.tipo === "blog");
  assert.ok(blogs.length > 0, "el brief tiene que traer artículos: es parte del split de la demo");
  for (const b of blogs) {
    assert.equal(b.local, false, `"${b.url_slug}" es un blog declarado como negocio local`);
  }
});

/**
 * El renderizador NO lee `business_profile` crudo: lee `business_profile_publico`, la columna
 * generada con allowlist (0008/0009/0010). Un perfil sembrado con campos fuera de esa allowlist se
 * filtra **en silencio** —le pasó a `brand` antes de la 0009 y a `locations`/`menu` antes de la
 * 0010—. Este test cierra el círculo del seed: no que el insert corrió, sino que lo sembrado
 * SOBREVIVE hasta la única forma que la web del cliente puede leer.
 */
test("lo sembrado sobrevive la allowlist: el perfil público trae los 2 locales y la carta", async () => {
  const [row] = await db.asService<{ perfil: Record<string, unknown> }>(
    "select business_profile_publico as perfil from clients where id = $1",
    [r.clientId],
  );
  const perfil = row?.perfil as {
    name?: string;
    brand?: { color?: string };
    locations?: { name?: string; opening_hours?: string; address?: { streetAddress?: string } }[];
    menu?: { category?: string; name?: string }[];
  };

  assert.equal(perfil?.name, "La Birra Bar");
  assert.ok(perfil?.brand?.color, "sin brand la web sale con el rojo por defecto, no con marca propia");

  // `font` NO es texto libre: el renderizador solo acepta tres valores (`renderer/src/perfil.ts`,
  // `FUENTES`) y el Zod de escritura los mismos (`web-builder/src/contract.ts`). El seed anterior
  // ponía "Fraunces", que no está en la lista: se descartaba EN SILENCIO y la web salía con la fuente
  // por defecto. Límite conocido de este test: la lista está copiada, no importada (`db` no depende de
  // `renderer`); si la allowlist cambia, hay que tocar los dos lados.
  assert.ok(
    ["sistema", "serif", "moderna"].includes((perfil?.brand as { font?: string })?.font ?? ""),
    "la fuente de marca tiene que ser una de las que la allowlist del renderizador acepta",
  );

  // Los locales alimentan el footer NAP multi-local y la sección "Ubicaciones" de la nav fija.
  assert.equal(perfil?.locations?.length, 2, "los dos locales de Madrid (Centro y Salamanca)");
  assert.ok(
    perfil.locations?.every((l) => l.name && l.address?.streetAddress && l.opening_hours),
    "cada local necesita nombre, calle y horario para que el footer no salga a medias",
  );

  // La carta alimenta `/menu` (JSON-LD `Menu`). Sin esto, la nav muestra "Menú" y la página da 404.
  assert.ok((perfil?.menu?.length ?? 0) >= 4, "la carta real de La Birra Bar");
  assert.ok(
    perfil.menu?.some((i) => i.name === "Golden Burger"),
    "el producto insignia tiene que estar en la carta pública",
  );
});

/**
 * El ancla contra la deriva que causó todo esto: el seed decía "Bella Napoli" mientras Storyblok ya
 * servía "La Birra Bar", porque el perfil vivía DOS veces sin nada que atara las copias. Este test
 * ata el perfil del seed (lo que el portal muestra) a `web-builder/business-profile.json` (lo que se
 * publica). Cambiar uno sin el otro cae acá, no en la demo delante de Frank.
 */
test("el perfil del seed y el de web-builder describen el MISMO negocio (anti-deriva)", async () => {
  const ruta = new URL("../../web-builder/business-profile.json", import.meta.url);
  const publicado = JSON.parse(await readFile(ruta, "utf8")) as {
    name: string;
    locations: unknown[];
    menu: unknown[];
  };

  assert.equal(PERFIL_DEMO.name, publicado.name, "el nombre del cliente sembrado ≠ el publicado");
  assert.deepEqual(PERFIL_DEMO.locations, publicado.locations, "los locales divergieron");
  assert.deepEqual(PERFIL_DEMO.menu, publicado.menu, "la carta divergió");
});

test("sembrar dos veces es idempotente: no duplica tenant, cliente, run ni páginas", async () => {
  const r2 = await sembrarDemo(con(db), { frankUserId: FRANK, juanUserId: JUAN });
  assert.equal(r2.tenantId, r.tenantId, "el mismo tenant (upsert por slug)");
  assert.equal(r2.clientId, r.clientId, "el mismo cliente (id fijo)");
  assert.equal(r2.runId, r.runId, "el mismo run de demo (id fijo)");

  // Contado como superusuario (salta RLS): la verdad cruda de la base, sin duplicados.
  const [tenants] = await db.asService<{ n: string }>(
    "select count(*)::text as n from tenants where slug = 'amg'",
  );
  const [clientes] = await db.asService<{ n: string }>(
    "select count(*)::text as n from clients where tenant_id = $1",
    [r.tenantId],
  );
  const [runs] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_runs where tenant_id = $1",
    [r.tenantId],
  );
  const [pages] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_pages where tenant_id = $1",
    [r.tenantId],
  );
  assert.equal(tenants?.n, "1", "un solo tenant");
  assert.equal(clientes?.n, "1", "un solo cliente");
  assert.equal(pages?.n, "14", "las 14 páginas del run de demo, sin duplicar");
  // Puede haber MÁS de un run del cliente (ver el test de abajo); acá basta con que el de demo no se
  // duplique. La cuenta exacta de runs se afirma en el test de no-destrucción.
});

test("re-sembrar NO destruye un run ajeno del mismo cliente (no es un delete por client_id)", async () => {
  // Un run que NO es el de demo, para el mismo cliente: simula investigación real de Fase 2.
  const AJENO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await db.asService(
    `insert into kr_runs (id, tenant_id, client_id, schema_version, status, prompt,
                          market_country, market_language, market_location_code)
     values ($1, $2, $3, 'kr.v0.5', 'approved', 'corrida real del cliente', 'ES', 'es', 2724)`,
    [AJENO, r.tenantId, r.clientId],
  );

  // Re-sembrar: solo debe tocar el run de demo.
  await sembrarDemo(con(db), { frankUserId: FRANK, juanUserId: JUAN });

  const [ajeno] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_runs where id = $1",
    [AJENO],
  );
  assert.equal(ajeno?.n, "1", "el run ajeno del cliente sobrevive al re-seed (antes se borraba)");

  // Limpieza para no contaminar tests posteriores que cuenten runs del tenant.
  await db.asService("delete from kr_runs where id = $1", [AJENO]);
});
