import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TestDb } from "./testdb.js";
import { sembrarDemo, PAGINAS_DEMO, PERFIL_DEMO, type ResultadoSeed } from "./seed-demo.js";
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

/**
 * 🔴 El run de la demo NO es publicable, y eso es la VERDAD sobre él, no un defecto del seed.
 *
 * `sembrarDemo` inserta el run directo en la base: nunca hubo un `research/solicitado`, así que no
 * hay ninguna ejecución durable esperando el `research/aprobado`. Aprobarlo devolvía 200 y no
 * publicaba nada (bloque C0; migración 0019 + `PgStore.approveRun`).
 *
 * Este test existe para que a nadie se le ocurra "arreglarlo" poniéndole la marca al seed: eso
 * volvería a fabricar el 200 falso, ahora con una columna que lo respalda. El portal muestra el botón
 * apagado, que es lo correcto.
 */
test("🔴 el run de la demo NO tiene marca de solicitud: nadie está esperando su aprobación", async () => {
  const runs = await db.asUser<{ tiene_marca: boolean }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select solicitud_emitida_at is not null as tiene_marca from kr_runs where id = $1",
    [r.runId],
  );
  assert.equal(runs.length, 1, "el run sembrado tiene que estar ahí (si no, este test no mide nada)");
  assert.equal(
    runs[0]?.tiene_marca,
    false,
    "el seed NO puede marcar el run como solicitado: no hay ningún workflow durmiendo sobre él",
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

test("🔴 el run de la demo tiene informe, y no costó $0.31", async () => {
  const filas = await db.asService<{ informe_md: string }>(
    "select informe_md from kr_informes where run_id = $1",
    [r.runId],
  );
  assert.equal(filas.length, 1, "sembrar la demo deja el informe listo para la pantalla");
  assert.match(filas[0]!.informe_md, /^# Keyword Research/);
});

/**
 * 🔴 Los huecos del informe de la demo, uno por uno.
 *
 * El desglose de coste por proveedor y las dos coberturas se perdieron con `out/` (KR-1). El informe
 * tiene que decir `n/d`, no un `0` ni un número plausible: el sistema dice lo que sabe y lo que no. Y de
 * paso esto pone el camino de datos incompletos EN LA PANTALLA DE LA DEMO, así que si el endurecimiento
 * de KR-2a estuviera mal, se ve enseguida.
 *
 * **Las aserciones son específicas a propósito.** Un `assert.match(md, /n\/d/)` a secas pasa con
 * CUALQUIER `n/d` del documento, y casi ninguno es uno de estos huecos: el informe de la demo trae
 * **27** `n/d` medidos, de los cuales solo **2** son las coberturas —doce en la tabla de páginas sin
 * validar, doce más en su detalle por página y uno en la leyenda—. Así que la versión laxa no probaría
 * nada de lo que este test promete. Cada hueco se comprueba en su lugar y con su texto.
 */
test("🔴 el informe de la demo declara sus huecos en vez de inventarlos", async () => {
  const [fila] = await db.asService<{ informe_md: string }>(
    "select informe_md from kr_informes where run_id = $1",
    [r.runId],
  );
  const md = fila!.informe_md;

  assert.doesNotMatch(md, /NaN/, "nunca NaN");
  assert.match(md, /n\/d/, "los huecos se declaran");
  assert.match(md, /0\.3097/, "el total SÍ está medido y se muestra");

  // Hueco 1 — el desglose por proveedor. Sin los tres números NO se pinta la tabla (una tabla de tres
  // `n/d` ocuparía el lugar del argumento comercial sin decirlo): se muestra el total y una nota.
  assert.doesNotMatch(md, /\| DataForSEO \|/, "sin desglose no se pinta la tabla de desglose");
  assert.match(md, /desglose\*\* por proveedor no quedó registrado/, "y se dice que falta");

  // Huecos 2 y 3 — las dos coberturas, en la tabla de calidad de datos.
  assert.match(md, /\| Keywords con \*\*volumen\*\* conocido \| \*\*n\/d\*\* \|/, "cobertura de volumen");
  assert.match(md, /\| Keywords con \*\*dificultad \(KD\)\*\* conocida \| \*\*n\/d\*\* \|/, "cobertura de KD");

  // `endpoints_degradados: null` (no `[]`): el informe OMITE la advertencia de fallo y dice que la omite.
  assert.match(md, /\*\*No se registró\*\* si algún endpoint de datos falló/, "ni afirma ni niega fallos");

  // Y el hueco que la spec no anticipó: el `h1` de cada página lo generó el LLM
  // (`kr-service/src/pipeline/enrich-content.ts` lo sobrescribe) y se perdió con `out/`. El detalle por
  // página lo declara en vez de reciclar el meta title, que sería afirmar que el h1 de la web ES el
  // title. Si alguien "arregla" el encabezado inventando un h1 plausible, cae acá.
  assert.match(md, /### 1\. \(h1 sin registrar\)/, "el h1 no se inventa");
  assert.doesNotMatch(
    md,
    /### 1\. La Mejor Hamburguesa del Mundo en Madrid/,
    "el meta title NO es el h1 de la página publicada",
  );
});

test("🔴 `calidad_datos` de la demo no afirma lo que no se midió", async () => {
  const [run] = await db.asService<{ calidad_datos: Record<string, unknown> }>(
    "select calidad_datos from kr_runs where id = $1",
    [r.runId],
  );
  const cd = run!.calidad_datos;

  assert.equal(cd["cobertura_volumen"], null, "era 0.571 por PÁGINA, no por keyword: no se sabe");
  assert.equal(cd["cobertura_kd"], null, "no quedó registrado");
  assert.equal(
    cd["endpoints_degradados"],
    null,
    "`[]` diría «ninguno falló», y la corrida no registró NADA sobre endpoints: es una certeza inventada",
  );
  assert.equal(cd["keywords_analizadas"], 55, "esto sí está medido");
  // Los dos campos cuyo NOMBRE mentía (son páginas, no keywords) y que `DataQuality` no define.
  assert.ok(!("keywords_con_volumen" in cd), "se fue");
  assert.ok(!("keywords_totales" in cd), "se fue");
});

/**
 * El seed persiste la POSICIÓN de cada página en `PAGINAS_DEMO` (KR-3, migración 0015).
 *
 * **Cómo se comprueba, y por qué así.** La versión anterior de este test ordenaba la consulta por
 * `orden_brief` y comparaba la lista resultante contra el array. **No probaba el orden**, y lo midió la
 * 13ª review con una mutación: cambiando el `order by` de la consulta al criterio viejo
 * (`opportunity_score desc`) las dos aserciones seguían verdes, porque los 14 scores de `PAGINAS_DEMO`
 * ya son estrictamente descendentes. Peor: el comentario concluía que esa coincidencia era lo que hacía
 * valioso el test, cuando para una aserción de orden es exactamente lo que lo anula.
 *
 * Así que ahora **no se ordena la consulta**: se comprueba la ASOCIACIÓN `slug → índice`, que es lo que
 * el seed de verdad escribe y lo único que no depende de la coincidencia. Si alguien deja de sembrar
 * `orden_brief`, o siembra las posiciones corridas, cae acá y no en la demo. El orden que sale de la
 * base ya lo prueban los tests de `getRunPages` en `store.test.ts`, con un fixture que **sí** contradice
 * al score.
 */
test("el seed persiste la posición de cada página del brief (slug → índice)", async () => {
  const pages = await db.asUser<{ url_slug: string; orden_brief: number | null }>(
    { tenantId: r.tenantId, userId: FRANK },
    // Sin `order by` a propósito: lo que se prueba es la asociación, no el orden de la consulta.
    "select url_slug, orden_brief from kr_pages where run_id = $1",
    [r.runId],
  );

  const esperado = new Map(PAGINAS_DEMO.map((p, i) => [p.slug, i]));
  const obtenido = new Map(pages.map((p) => [p.url_slug, p.orden_brief]));

  assert.equal(obtenido.size, esperado.size, "una fila por página del array, sin duplicados");
  for (const [slug, i] of esperado) {
    assert.equal(
      obtenido.get(slug),
      i,
      `${slug} tiene que estar en la posición ${i} de PAGINAS_DEMO, y está en ${obtenido.get(slug)}`,
    );
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
  // El run DE DEMO, por id: no puede haber dos. Se cuenta por `id` y no por `tenant_id` porque el
  // cliente puede tener otros runs legítimos (lo prueba el test de abajo), así que un conteo por tenant
  // no diría nada. Antes acá había un `count(*) where tenant_id` cuyo resultado **no se aseveraba**:
  // una query muerta y una variable sin usar, en el test cuyo nombre promete "no duplica … run …".
  const [runDemo] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_runs where id = $1",
    [r.runId],
  );
  const [pages] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_pages where tenant_id = $1",
    [r.tenantId],
  );
  // El informe se inserta PELADO, sin `on conflict`: lo que lo hace re-sembrable es que
  // `kr_informes.run_id` referencia a `kr_runs(id) on delete cascade` (0016), así que el `delete from
  // kr_runs where id = <demo>` del seed se lo lleva antes. Si esa cascada desapareciera, el segundo
  // `sembrarDemo` de este test revienta por PK duplicada — que es el fallo correcto, y visible.
  const [informes] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_informes where run_id = $1",
    [r.runId],
  );
  assert.equal(tenants?.n, "1", "un solo tenant");
  assert.equal(clientes?.n, "1", "un solo cliente");
  assert.equal(runDemo?.n, "1", "un solo run de demo: el id es fijo y el upsert no lo duplica");
  assert.equal(pages?.n, "14", "las 14 páginas del run de demo, sin duplicar");
  assert.equal(informes?.n, "1", "un solo informe del run de demo (la cascada lo repone, no lo duplica)");
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
