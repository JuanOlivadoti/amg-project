import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgStore } from "./store.js";
import type { DbPool } from "./pool.js";

/**
 * Publicar posts en el blog externo del cliente (sub-proyecto 3, Task 3). Mismo molde que
 * `resenas.test.ts`: `kr_pages` gana columnas nuevas (migración 0031) en vez de una tabla propia —
 * el post vive en la fila del recurso. Brief: `.superpowers/sdd/task-3-brief.md`.
 *
 * Etapa 1 (arriba) prueba `PgStore` con `db.asService` para sembrar el estado que cada test
 * necesita, mismo criterio que `crearResena` en `resenas.test.ts`.
 */

let db: TestDb;
let s: Seed;
let pool: DbPool;
let store: PgStore;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  // PGlite y TestDb comparten instancia: el pool de PgStore va contra la MISMA base ya sembrada.
  pool = new PglitePool(db.pglite);
  store = new PgStore(pool); // default: app_user
});

after(async () => {
  await db.close();
});

/**
 * Crea una página APROBADA con la autoridad de INFRAESTRUCTURA (superusuario: salta RLS y grants).
 * Usa el run ya sembrado del cliente/tenant (`s.runA1`/`s.runB1`) salvo que se pase uno explícito.
 */
async function crearPaginaAprobada(clientId: string, tenantId: string, runId?: string): Promise<string> {
  const [row] = await db.asService<{ id: string }>(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
                           intencion, evidencia, approved, approved_at)
     values ($1, $2, $3, gen_random_uuid(), 'blog', $4, 'kw', 'informational', 'sin_validar', true, now())
     returning id`,
    [tenantId, runId ?? (tenantId === s.tenantA ? s.runA1 : s.runB1), clientId, `/post-${crypto.randomUUID()}`],
  );
  return row!.id;
}

/** Misma idea, pero SIN aprobar (`approved` nace en `false`). */
async function crearPaginaSinAprobar(clientId: string, tenantId: string, runId?: string): Promise<string> {
  const [row] = await db.asService<{ id: string }>(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
                           intencion, evidencia)
     values ($1, $2, $3, gen_random_uuid(), 'blog', $4, 'kw', 'informational', 'sin_validar')
     returning id`,
    [tenantId, runId ?? (tenantId === s.tenantA ? s.runA1 : s.runB1), clientId, `/post-${crypto.randomUUID()}`],
  );
  return row!.id;
}

/** Un run nuevo para un cliente que no es `clientA1`/`clientB1` (los únicos con run en el seed). */
async function crearRun(clientId: string, tenantId: string): Promise<string> {
  const [row] = await db.asService<{ id: string }>(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                          market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'prompt de prueba', 'ES', 'es', 2724) returning id`,
    [tenantId, clientId],
  );
  return row!.id;
}

/** Configura las credenciales del blog externo del cliente (las tres columnas de la 0031). */
async function configurarBlogExterno(
  clientId: string,
  opciones?: { url?: string; credencial?: string },
): Promise<void> {
  await db.asService(
    `update clients set blog_externo_tipo = 'wordpress', blog_externo_url = $2, blog_externo_credencial = $3
     where id = $1`,
    [clientId, opciones?.url ?? "https://x.com", opciones?.credencial ?? "sek-test"],
  );
}

// ============================================================ guardarPost / editarPost

test("guardarPost escribe título/cuerpo sanitizado y post_generado_en", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  const ok = await store.guardarPost(
    { tenantId: s.tenantA, userId: s.equipoA },
    pageId,
    { titulo: "Los mejores tacos de la ciudad", cuerpo: "<p>Hola</p><script>alert(1)</script>" },
  );
  assert.equal(ok, true);
  const [row] = await db.asService<{ post_cuerpo: string; post_generado_en: string | null }>(
    "select post_cuerpo, post_generado_en from kr_pages where id = $1",
    [pageId],
  );
  assert.ok(!row!.post_cuerpo.includes("<script"), "el cuerpo persistido está sanitizado");
  assert.ok(row!.post_generado_en, "post_generado_en quedó seteado");
});

test("🔴 guardarPost sobre una página de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearPaginaAprobada(s.clientB1, s.tenantB);
  const ok = await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, ajena, {
    titulo: "Intento cruzado",
    cuerpo: "<p>x</p>",
  });
  assert.equal(ok, false);
  const [row] = await db.asService<{ post_titulo: string | null }>(
    "select post_titulo from kr_pages where id = $1",
    [ajena],
  );
  assert.equal(row?.post_titulo, null, "el intento de A no tocó la página de B");
});

test("editarPost NO revoca approved (a diferencia de editPage)", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.editarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { postTitulo: "T editado" });
  const [row] = await db.asService<{ approved: boolean }>("select approved from kr_pages where id = $1", [pageId]);
  assert.equal(row!.approved, true, "editar el post no toca la aprobación de la página");
});

test("editarPost sanitiza post_cuerpo si viene presente", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.editarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, {
    postCuerpo: "<p>Editado</p><script>alert(1)</script>",
  });
  const [row] = await db.asService<{ post_cuerpo: string }>(
    "select post_cuerpo from kr_pages where id = $1",
    [pageId],
  );
  assert.ok(!row!.post_cuerpo.includes("<script"), "el cuerpo editado también pasa por sanitizarHtml");
});

test("🔴 editarPost rechaza mientras hay una publicación en curso sin confirmar", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const ok = await store.editarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { postTitulo: "T pisado" });
  assert.equal(ok, false, "🔴 el WHERE rechaza post_solicitado_en not null and post_publicado_en null");
});

test("editarPost sin cambios (objeto vacío) devuelve false y no toca la fila", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const ok = await store.editarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, {});
  assert.equal(ok, false);
});

// ============================================================ solicitarPublicacionPost

test("solicitarPublicacionPost devuelve true con post generado en una página aprobada", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(ok, true);
});

test("🔴 solicitarPublicacionPost rechaza una página SIN post generado", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await configurarBlogExterno(s.clientA1);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza post_titulo/post_cuerpo is null");
});

test("🔴 solicitarPublicacionPost rechaza una página NO aprobada", async () => {
  // Sin configurar el blog acá a propósito: clientA2 (no clientA1) para no ensuciar el estado de
  // clientA1 que otros tests de este archivo leen -- blog_externo_* vive en `clients`, no en la
  // reseña/página, así que un `update` acá sobrevive a este test (no hay rollback entre tests, mismo
  // criterio que `crearResena` con `asService`).
  const runA2 = await crearRun(s.clientA2, s.tenantA);
  const pageId = await crearPaginaSinAprobar(s.clientA2, s.tenantA, runA2);
  await db.asService("update kr_pages set post_titulo = 'T', post_cuerpo = '<p>C</p>' where id = $1", [pageId]);
  await configurarBlogExterno(s.clientA2);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza approved = false");
});

test("🔴 solicitarPublicacionPost rechaza si el cliente no tiene blog_externo_tipo/url configurados", async () => {
  // Codex, ronda 1 sobre el plan, hallazgo Major: sin este chequeo, no había ningún camino que
  // impidiera "solicitar" la publicación de un cliente que nunca configuró su blog externo.
  // clientB1 a propósito: ningún otro test de este archivo llama configurarBlogExterno(clientB1),
  // así que este test no depende del orden de ejecución de los demás.
  const pageId = await crearPaginaAprobada(s.clientB1, s.tenantB);
  await store.guardarPost({ tenantId: s.tenantB, userId: s.equipoB }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantB, userId: s.equipoB }, pageId);
  assert.equal(ok, false, "🔴 blog_externo_tipo/url siguen NULL — clientB1 nunca configuró su blog");
});

test("solicitarPublicacionPost REINTENTA sobre una fila ya solicitada pero no publicada, y limpia post_error_en", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1); // helper: setea blog_externo_tipo/url/credencial vía db.asService
  const primera = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  await db.asService("update kr_pages set post_error_en = now() where id = $1", [pageId]); // simula un fallo previo
  const segunda = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(primera, true);
  assert.equal(segunda, true, "un segundo pedido sobre 'ya solicitada, no publicada' vuelve a calificar");
  const [row] = await db.asService<{ post_error_en: string | null }>(
    "select post_error_en from kr_pages where id = $1", [pageId],
  );
  assert.equal(row!.post_error_en, null, "reintentar limpia el error del intento anterior");
});

test("🔴 solicitarPublicacionPost rechaza una página YA publicada", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  await db.asService("update kr_pages set post_publicado_en = now() where id = $1", [pageId]);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza post_publicado_en not null");
});

test("🔴 solicitarPublicacionPost con rol 'cliente' devuelve false (ADR-20)", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.duenoA1 }, pageId);
  assert.equal(ok, false);
});

test("🔴 solicitarPublicacionPost sobre una página de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearPaginaAprobada(s.clientB1, s.tenantB);
  await store.guardarPost({ tenantId: s.tenantB, userId: s.equipoB }, ajena, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientB1);
  const ok = await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, ajena);
  assert.equal(ok, false);
  const [row] = await db.asService<{ post_solicitado_en: string | null }>(
    "select post_solicitado_en from kr_pages where id = $1",
    [ajena],
  );
  assert.equal(row?.post_solicitado_en, null, "el intento de A no tocó la página de B");
});

// ============================================================ postParaPublicar (rol app_service)

test("postParaPublicar (rol app_service, sinTenant) trae lo necesario para publicar", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1, { credencial: "sek" });
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service"); // mismo patrón que el orquestador
  const info = await storeServicio.postParaPublicar(pageId);
  assert.equal(info?.titulo, "T");
  assert.equal(info?.blogCredencial, "sek");
});

test("postParaPublicar devuelve null si la solicitud ya no aplica", async () => {
  const storeServicio = new PgStore(pool, "app_service");
  const info = await storeServicio.postParaPublicar("00000000-0000-0000-0000-000000000000");
  assert.equal(info, null);
});

test("🔴 postParaPublicar devuelve null si el cliente configuró tipo/url pero NO la credencial", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  // A propósito: tipo/url por columna suelta, SIN credencial -- app_user no puede escribir la
  // credencial vía configurarBlogExterno con opciones.credencial = null porque la columna es texto
  // libre; se simula el estado directo con asService (infra), que sí puede dejarla NULL.
  await db.asService(
    "update clients set blog_externo_tipo = 'wordpress', blog_externo_url = 'https://x.com', blog_externo_credencial = null where id = $1",
    [s.clientA1],
  );
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service");
  const info = await storeServicio.postParaPublicar(pageId);
  assert.equal(info, null, "🔴 credenciales incompletas es el mismo caso que 'la solicitud ya no aplica'");
});

// ============================================================ marcarPostPublicado / marcarPostFallido

test("marcarPostPublicado confirma, limpia post_error_en, y NO deja reconfirmar", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service");
  const primera = await storeServicio.marcarPostPublicado(pageId, "https://x.com/t");
  const segunda = await storeServicio.marcarPostPublicado(pageId, "https://x.com/t-otra-vez");
  assert.equal(primera, true);
  assert.equal(segunda, false, "🔴 el WHERE rechaza post_publicado_en not null — no se puede repisar la URL");
});

test("marcarPostPublicado sin solicitud previa (nadie la pidió) devuelve false", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const storeServicio = new PgStore(pool, "app_service");
  const ok = await storeServicio.marcarPostPublicado(pageId, "https://x.com/t");
  assert.equal(ok, false, "🔴 el WHERE exige post_solicitado_en not null");
});

test("marcarPostFallido limpia post_solicitado_en (desbloquea editarPost) y marca post_error_en", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service");
  const ok = await storeServicio.marcarPostFallido(pageId);
  assert.equal(ok, true);

  const puedeEditar = await store.editarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { postTitulo: "T corregido" });
  assert.equal(puedeEditar, true, "editarPost ya no está bloqueado tras el fallo");

  const [row] = await db.asService<{ post_error_en: string | null }>(
    "select post_error_en from kr_pages where id = $1",
    [pageId],
  );
  assert.ok(row?.post_error_en, "queda el rastro del fallo para el portal");
});

test("🔴 marcarPostFallido sobre una fila ya publicada no hace nada (idempotencia: no se puede 'des-publicar')", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service");
  await storeServicio.marcarPostPublicado(pageId, "https://x.com/t");

  const ok = await storeServicio.marcarPostFallido(pageId);
  assert.equal(ok, false, "🔴 el WHERE exige post_publicado_en is null");
  const [row] = await db.asService<{ post_url_externa: string | null }>(
    "select post_url_externa from kr_pages where id = $1",
    [pageId],
  );
  assert.equal(row?.post_url_externa, "https://x.com/t", "la publicación confirmada no se deshace");
});

// ============================================================ getPost

test("getPost devuelve null si la página no existe O si nunca se generó un post", async () => {
  const paginaSinPost = await crearPaginaAprobada(s.clientA1, s.tenantA);
  const resultado = await store.getPost({ tenantId: s.tenantA, userId: s.equipoA }, paginaSinPost);
  assert.equal(resultado, null, "🔴 página real pero sin post: getPost trata esto igual que 'no existe'");

  const resultadoInexistente = await store.getPost(
    { tenantId: s.tenantA, userId: s.equipoA }, "00000000-0000-0000-0000-000000000000",
  );
  assert.equal(resultadoInexistente, null);
});

test("getPost trae el post una vez generado, incluido errorEn tras un fallo", async () => {
  const pageId = await crearPaginaAprobada(s.clientA1, s.tenantA);
  await store.guardarPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await configurarBlogExterno(s.clientA1);
  await store.solicitarPublicacionPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  await new PgStore(pool, "app_service").marcarPostFallido(pageId);

  const resultado = await store.getPost({ tenantId: s.tenantA, userId: s.equipoA }, pageId);
  assert.equal(resultado?.titulo, "T");
  assert.ok(resultado?.errorEn, "el portal necesita esto para mostrar 'Reintentar' en vez de 'Publicando…'");
  assert.equal(resultado?.solicitadoEn, null, "el fallo ya limpió el intento en curso");
});

test("🔴 getPost sobre una página de OTRO tenant devuelve null (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearPaginaAprobada(s.clientB1, s.tenantB);
  await store.guardarPost({ tenantId: s.tenantB, userId: s.equipoB }, ajena, { titulo: "T", cuerpo: "<p>C</p>" });

  const resultado = await store.getPost({ tenantId: s.tenantA, userId: s.equipoA }, ajena);
  assert.equal(resultado, null);
});
