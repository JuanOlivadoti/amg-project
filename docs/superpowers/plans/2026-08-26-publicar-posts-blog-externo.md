# Publicar posts en un blog externo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar el mecanismo `crear_posts` (reservado por el sub-proyecto 2): al aprobar un run
con ese destino, generar por IA un post de blog por cada página aprobada, dejarlo editable en el
portal, y publicarlo en el blog externo del cliente (WordPress u otra plataforma) solo cuando el
staff lo pide explícitamente y el `BlogPublisher` confirma la publicación.

**Architecture:** Mismo molde que el borrador de reseñas de Google (Bloque F, fase 2), aplicado a
`kr_pages` en vez de `resenas_google`: el post vive como columnas nuevas en la fila de la página. La
generación corre dentro de `workflowDecision` (ya tiene contexto de tenant, a diferencia del
polling de reseñas — no hace falta un rol cross-tenant para generar). La publicación SÍ es
cross-tenant (el evento solo trae `pageId`), así que usa el mismo patrón de función `security
definer` confinada que resolvió `resenaParaPublicar`/`publicar_respuesta_resena` — acá
`post_para_publicar`/`marcar_post_publicado`, con un rol nuevo `app_posts`.

**Tech Stack:** TypeScript ESM, PostgreSQL (PGlite en tests), Hono (API), Inngest (orquestador),
Angular (portal), `sanitize-html` (dependencia nueva del paquete `db`), SDK de OpenAI (ya usado en
el proyecto).

## Global Constraints

- **Este plan depende de que el plan del sub-proyecto 2**
  (`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`) **ya esté ejecutado antes de empezar la
  Task 8** (`workflow.ts`) **en adelante**: `workflowDecision`, el stub `crear_posts` que esa Task 6
  introduce, y `registrarDecision` con el chequeo de página aprobada ya extendido a `crear_posts`
  (enmienda del 2026-08-26 en ese plan) tienen que existir. Las Tasks 1-7 de este plan (migración,
  capa de datos, piezas aisladas del orquestador) NO dependen de eso — se pueden hacer en cualquier
  momento, incluso antes de que el sub-proyecto 2 se implemente.
- **`BlogPublisher`: solo mock en este plan.** Ninguna plataforma real (WordPress u otra) se
  construye acá — decisión tomada al escribir este plan (spec, "Fuera de alcance": sin cliente real
  confirmado, no hay a qué API concreta apuntar). La interfaz queda lista para una implementación
  futura.
- **Sanitización de HTML: librería `sanitize-html`** (dependencia nueva del paquete `db` — no existe
  ningún sanitizador reutilizable en el repo, verificado). Allowlist mínimo (sin `img` — YAGNI, se
  agrega cuando haga falta de verdad).
- **Migración**: verificar el próximo número libre en `db/migrations/` antes de crear el archivo
  (Task 1). Este plan asume `0028`, asumiendo que el sub-proyecto 2 ya aplicó su
  `0027_kr_run_decisiones.sql` — si no es así, ajustar el número (y las referencias a `0028` en todo
  este plan) al que corresponda.
- **Ruta API real**: `PATCH /pages/:id` (existente, `api/src/app.ts:348-356`) se EXTIENDE, no se crea
  una ruta anidada nueva — corrección encontrada al investigar el código real (ver spec,
  "Arquitectura"). `GET /pages/:id/post` es nueva.
- **Nombres de dominio en español** (`guardarPost`, `editarPost`, `solicitarPublicacionPost`), mismo
  criterio que el resto del proyecto.
- Todo corre sin credenciales: PGlite en memoria + providers mock. Si una task necesita OpenAI real
  para probarse manualmente, se prueba con el mock primero.

---

### Task 1: Migración — columnas, grants, rol `app_posts`, funciones `security definer`

**Files:**
- Create: `db/migrations/0028_posts_blog_externo.sql` (verificar el número real primero, ver
  "Global Constraints")
- Test: `db/src/rls.test.ts` (o el archivo de tests de RLS/grants que uses de referencia — agregar
  una sección nueva, mismo patrón que la sección de `resenas_google`/`app_resenas`)

**Interfaces:**
- Produce: columnas `kr_pages.post_titulo/post_cuerpo/post_generado_en/post_solicitado_en/
  post_publicado_en/post_url_externa`; columnas `clients.blog_externo_tipo/blog_externo_url/
  blog_externo_credencial`; rol `app_posts`; funciones `app.post_para_publicar(uuid)` y
  `app.marcar_post_publicado(uuid, text)`, con `execute` concedido a `app_service`.
- Las Tasks 2 y 3 consumen las columnas. La Task 3 consume las dos funciones.

- [ ] **Step 1: Escribir el archivo de migración**

```sql
-- db/migrations/0028_posts_blog_externo.sql
--
-- AMG OS — 0028: publicar posts generados por IA en el blog externo del cliente (sub-proyecto 3)
--
-- Mismo molde que resenas_google (0021/0022/0024/0025), aplicado a kr_pages en vez de una tabla
-- nueva: el post vive como columnas en la fila del recurso. A diferencia de reseñas, la GENERACIÓN
-- no necesita un rol cross-tenant: corre dentro de workflowDecision, que ya tiene contexto de
-- tenant (el polling de reseñas es cross-tenant desde el arranque, esto no). Solo la PUBLICACIÓN
-- es cross-tenant (el evento solo trae pageId, ADR-18) -- por eso el rol confinado nuevo (app_posts)
-- y las dos funciones security definer están acá, no un tercer par para "generar" o "editar".
--
-- Spec: docs/superpowers/specs/2026-08-26-publicar-posts-blog-externo-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El post: columnas nuevas en kr_pages. El grant de tabla de app_user/app_service (0001/0002)
-- las cubre automáticamente -- kr_pages nunca se angostó a nivel de columna (a diferencia de
-- `clients`, ver más abajo). Verificado releyendo 0001:413 y 0002:93.
-- -----------------------------------------------------------------------------
alter table kr_pages
  add column if not exists post_titulo         text,
  add column if not exists post_cuerpo          text,
  add column if not exists post_generado_en     timestamptz,
  add column if not exists post_solicitado_en   timestamptz,
  add column if not exists post_publicado_en    timestamptz,
  add column if not exists post_url_externa     text;

comment on column kr_pages.post_titulo is
  'Título del post generado por IA para el blog externo del cliente. NULL = sin generar.';
comment on column kr_pages.post_cuerpo is
  'Cuerpo HTML del post, sanitizado por allowlist ANTES de escribirse acá (db/src/store.ts, '
  'guardarPost/editarPost, vía sanitizarHtml) -- nunca se persiste HTML sin pasar por ahí.';
comment on column kr_pages.post_generado_en is
  'Cuando la IA generó el post. NULL = todavía no, o falló la generación para esta página.';
comment on column kr_pages.post_solicitado_en is
  'Cuando se pidió publicar. Un segundo pedido sobre una fila ya solicitada pero no publicada '
  'REINTENTA (pisa este timestamp de nuevo) -- mismo criterio que respuesta_solicitada_en en '
  'resenas_google (0025).';
comment on column kr_pages.post_publicado_en is
  'Cuando el BlogPublisher CONFIRMÓ la publicación externa. NULL = no publicado (nunca pedido, en '
  'curso, o el último intento falló).';
comment on column kr_pages.post_url_externa is
  'La URL del post publicado, tal como la devolvió el BlogPublisher. NULL hasta la confirmación.';

-- -----------------------------------------------------------------------------
-- Las credenciales del blog externo: columnas nuevas en `clients`.
--
-- A DIFERENCIA de kr_pages, `clients` NO tiene grant de tabla completo: la 0021 lo angostó a
-- columna por columna para app_user (revoke select on clients + grant select (lista)), y la 0022
-- hizo lo mismo con app_service. Una columna nueva acá NO la puede leer nadie hasta que se le
-- conceda explícitamente -- verificado releyendo 0021:112-121 y 0022:140-141 (la primera versión
-- del spec de este sub-proyecto asumía que el grant de tabla de 0001/0002 cubría esto, y no es así
-- para `clients`).
-- -----------------------------------------------------------------------------
alter table clients
  add column if not exists blog_externo_tipo        text,
  add column if not exists blog_externo_url          text,
  add column if not exists blog_externo_credencial   text;

comment on column clients.blog_externo_tipo is
  'Plataforma del blog externo del cliente (''wordpress'', valores futuros). NULL = no configurado.';
comment on column clients.blog_externo_url is
  'URL base del blog externo del cliente.';
comment on column clients.blog_externo_credencial is
  'Credencial de publicación (ej. application password de WordPress). NUNCA en el select de '
  'app_user -- mismo criterio que clients.google_refresh_token (0021): app_user puede ESCRIBIRLA '
  '(la pantalla de configuración) pero no LEERLA de vuelta. Solo la lee app.post_para_publicar.';

-- app_user: tipo/url son dato de negocio visible; la credencial solo se puede escribir.
grant select (blog_externo_tipo, blog_externo_url) on clients to app_user;
grant update (blog_externo_tipo, blog_externo_url, blog_externo_credencial) on clients to app_user;

-- =============================================================================
-- `app_posts`: el rol cross-tenant confinado que necesita la publicación -- mismo motivo que
-- `app_resenas` (0022): el evento `posts/publicacion.solicitada` solo trae `pageId` (ADR-18), el
-- orquestador no tiene contexto de tenant en ese punto. Dos funciones cuyo cuerpo entero es "leer
-- lo que hace falta para publicar UNA página" y "confirmar que se publicó" conceden algo que no
-- puede filtrar nada más y no puede hacer otra cosa.
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_posts') then
    create role app_posts nologin;
  end if;
end $$;

grant usage on schema public, app to app_posts;

-- Lectura confinada: nada de content_brief, seo, ni ninguna otra columna de kr_pages; nada de
-- business_profile ni ninguna otra columna de clients.
grant select (id, tenant_id, client_id, url_slug, post_titulo, post_cuerpo, post_solicitado_en,
  post_publicado_en) on kr_pages to app_posts;
grant select (id, blog_externo_tipo, blog_externo_url, blog_externo_credencial) on clients to app_posts;
grant update (post_publicado_en, post_url_externa) on kr_pages to app_posts;

-- RLS sigue en pie: un grant de columna es necesario pero no suficiente (mismo comentario que deja
-- la 0022 sobre esto). `using (true)` es seguro por el mismo motivo que ahí: app_posts no tiene
-- login, nada puede asumirlo, y es inalcanzable salvo llamando a las dos funciones de abajo -- cuyo
-- cuerpo entero queda fijo en esta misma migración.
create policy kr_pages_ve_app_posts on kr_pages
  for select to app_posts
  using (true);

create policy kr_pages_actualiza_app_posts on kr_pages
  for update to app_posts
  using (true)
  with check (true);

create policy clients_ve_app_posts on clients
  for select to app_posts
  using (true);

-- -----------------------------------------------------------------------------
-- Función 1: lo que el orquestador necesita para publicar UNA página puntual.
-- -----------------------------------------------------------------------------
create or replace function app.post_para_publicar(p_page_id uuid)
returns table (
  page_id            uuid,
  client_id          uuid,
  tenant_id          uuid,
  titulo             text,
  cuerpo             text,
  slug               text,
  blog_tipo          text,
  blog_url           text,
  blog_credencial    text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id, p.client_id, p.tenant_id, p.post_titulo, p.post_cuerpo, p.url_slug,
         c.blog_externo_tipo, c.blog_externo_url, c.blog_externo_credencial
  from kr_pages p
  join clients c on c.id = p.client_id
  where p.id = p_page_id
    and p.post_solicitado_en is not null
    and p.post_publicado_en is null
    and p.post_titulo is not null
    and p.post_cuerpo is not null;
$$;

comment on function app.post_para_publicar(uuid) is
  'Lo que el orquestador necesita para publicar UNA página, incluida la credencial del blog. Cero '
  'filas = la solicitud ya no aplica (publicada, sin post, o inexistente) -- el evento que dispara '
  'esto no porta autoridad (ADR-18), esta consulta es la que decide. security definer, propiedad de '
  'app_posts -- app_service solo puede EJECUTARLA, nunca leer blog_externo_credencial por SQL directo.';

-- -----------------------------------------------------------------------------
-- Función 2: confirmar que se publicó. Solo lo que el BlogPublisher CONFIRMA se marca.
-- -----------------------------------------------------------------------------
create or replace function app.marcar_post_publicado(p_page_id uuid, p_url_externa text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update kr_pages
    set post_publicado_en = now(), post_url_externa = p_url_externa
    where id = p_page_id
      and post_solicitado_en is not null
      and post_publicado_en is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.marcar_post_publicado(uuid, text) is
  'Confirma la publicación. false si nadie la pidió o ya estaba publicada -- el WHERE decide, no '
  'quien llama. security definer, propiedad de app_posts.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, mismo patrón que 0022/0024/0025: dos permisos temporales, revocados al final.
-- -----------------------------------------------------------------------------
grant app_posts to current_user;
grant create on schema app to app_posts;

alter function app.post_para_publicar(uuid) owner to app_posts;
alter function app.marcar_post_publicado(uuid, text) owner to app_posts;

revoke execute on function app.post_para_publicar(uuid) from public;
revoke execute on function app.marcar_post_publicado(uuid, text) from public;
grant execute on function app.post_para_publicar(uuid) to app_service;
grant execute on function app.marcar_post_publicado(uuid, text) to app_service;

revoke create on schema app from app_posts;
revoke app_posts from current_user;
```

- [ ] **Step 2: Escribir los tests de grants/RLS que fallan**

```ts
// db/src/rls.test.ts — sección nueva, mismo patrón que la de app_resenas

test("🔴 app_service NO puede leer clients.blog_externo_credencial por SQL directo", async () => {
  await db.asService(
    "insert into clients (id, tenant_id, nombre, blog_externo_credencial) values (gen_random_uuid(), $1, 'x', 'secreto')",
    [tenantA],
  ).catch(() => {}); // el insert puede fallar por otras columnas obligatorias; lo que importa es el select de abajo
  await assert.rejects(
    () => db.asService("select blog_externo_credencial from clients limit 1"),
    /permission denied for table clients|permission denied for column blog_externo_credencial/,
  );
});

test("🔴 app_user NO puede leer clients.blog_externo_credencial por SQL directo (solo escribirla)", async () => {
  await assert.rejects(
    () => db.asUser("select blog_externo_credencial from clients limit 1", tenantA, equipoA),
    /permission denied/,
  );
});

test("app.post_para_publicar devuelve la fila cuando hay una solicitud pendiente", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(clientA1, tenantA); // helper: kr_page con
    // post_titulo/post_cuerpo/post_solicitado_en, client con blog_externo_* seteados
  const [row] = await db.asService<{ titulo: string; blog_credencial: string }>(
    "select * from app.post_para_publicar($1)",
    [pageId],
  );
  assert.ok(row);
  assert.equal(row.blog_credencial, "secreto-test");
});

test("app.post_para_publicar devuelve cero filas si ya está publicado", async () => {
  const pageId = await sembrarPaginaConPostPublicado(clientA1, tenantA); // helper
  const rows = await db.asService("select * from app.post_para_publicar($1)", [pageId]);
  assert.equal(rows.length, 0);
});
```

Run: `npm test -w db -- --test-name-pattern="post_para_publicar|blog_externo_credencial"`
Expected: FAIL — la tabla/columnas/funciones no existen todavía.

- [ ] **Step 3: Correr la migración y los tests**

Run: `npm test -w db -- --test-name-pattern="post_para_publicar|blog_externo_credencial"`
Expected: PASS (las migraciones se aplican automáticamente contra PGlite al levantar el test harness).

- [ ] **Step 4: Confirmar que `business_profile_publico` no filtra la credencial (defensa en profundidad, ADR-19)**

```ts
test("blog_externo_credencial no aparece en business_profile_publico", async () => {
  const [row] = await db.asService<{ business_profile_publico: Record<string, unknown> }>(
    "select business_profile_publico from clients where id = $1",
    [clientA1],
  );
  assert.ok(!JSON.stringify(row?.business_profile_publico ?? {}).includes("secreto"));
});
```

Run: `npm test -w db` completo.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0028_posts_blog_externo.sql db/src/rls.test.ts
git commit -m "db: migración de posts en blog externo — columnas, rol app_posts, funciones security definer"
```

---

### Task 2: Sanitizador de HTML

**Files:**
- Create: `db/src/sanitizar-html.ts`
- Test: `db/src/sanitizar-html.test.ts`
- Modify: `db/package.json` — agregar dependencia `sanitize-html` (y `@types/sanitize-html` en dev)

**Interfaces:**
- Produce: `sanitizarHtml(html: string): string`
- La Task 3 lo consume desde `guardarPost`/`editarPost`.

- [ ] **Step 1: Agregar la dependencia**

```bash
npm install sanitize-html -w db
npm install --save-dev @types/sanitize-html -w db
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// db/src/sanitizar-html.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizarHtml } from "./sanitizar-html.js";

test("permite las tags de la allowlist", () => {
  const entrada = "<p>Hola <strong>mundo</strong>, mirá <a href=\"https://x.com\">esto</a>.</p>";
  assert.equal(sanitizarHtml(entrada), entrada);
});

test("🔴 descarta <script> por completo", () => {
  const salida = sanitizarHtml('<p>Hola</p><script>alert(1)</script>');
  assert.ok(!salida.includes("<script"), "el tag script no debe sobrevivir");
  assert.ok(!salida.includes("alert(1)"), "el contenido del script tampoco");
});

test("🔴 descarta un atributo onerror/onclick", () => {
  const salida = sanitizarHtml('<p onclick="alert(1)">Hola</p>');
  assert.ok(!salida.includes("onclick"));
});

test("🔴 descarta un href javascript:", () => {
  const salida = sanitizarHtml('<a href="javascript:alert(1)">click</a>');
  assert.ok(!salida.includes("javascript:"));
});

test("🔴 descarta un tag fuera de la allowlist (ej. <img>) pero conserva el texto de alrededor", () => {
  const salida = sanitizarHtml('<p>antes<img src="x">después</p>');
  assert.ok(!salida.includes("<img"));
  assert.ok(salida.includes("antes"));
  assert.ok(salida.includes("después"));
});
```

Run: `npm test -w db -- --test-name-pattern="sanitizarHtml"`
Expected: FAIL — `Cannot find module './sanitizar-html.js'`.

- [ ] **Step 3: Implementar**

```ts
// db/src/sanitizar-html.ts
import sanitizeHtml from "sanitize-html";

/**
 * Allowlist mínimo para el cuerpo de un post de blog: párrafos, énfasis, listas, subtítulos y
 * enlaces http(s). Sin `img` a propósito (YAGNI — se agrega cuando un caso real lo necesite, no
 * antes). Cualquier tag/atributo fuera de esta lista se descarta; el texto de adentro se conserva.
 */
const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "b", "i", "u", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https"],
};

/**
 * Sanitiza HTML por allowlist (ADR-19: todo valor que termina en HTML es superficie de inyección).
 * Se llama en los DOS puntos donde `kr_pages.post_cuerpo` cambia — `guardarPost` (después del LLM) y
 * `editarPost` (después de un humano) — nunca se persiste sin pasar por acá.
 */
export function sanitizarHtml(html: string): string {
  return sanitizeHtml(html, OPCIONES);
}
```

- [ ] **Step 4: Correr y confirmar**

Run: `npm test -w db -- --test-name-pattern="sanitizarHtml"`
Expected: PASS, los seis tests.

- [ ] **Step 5: Exportar desde `db/src/index.ts`** (por si algún consumidor externo al paquete
  necesita sanitizar HTML con el mismo criterio más adelante — hoy solo lo usa `store.ts`, adentro
  del propio paquete, así que este export es opcional; agregalo solo si tu editor te marca que
  `store.ts` no puede resolver el import relativo).

- [ ] **Step 6: Commit**

```bash
git add db/package.json db/package-lock.json db/src/sanitizar-html.ts db/src/sanitizar-html.test.ts
git commit -m "db: sanitizarHtml — allowlist para el cuerpo de un post antes de persistirlo"
```

---

### Task 3: `db/src/store.ts` — guardar, editar, solicitar y confirmar publicación

**Files:**
- Modify: `db/src/store.ts` — tipos nuevos cerca de `ClientRow`/`CambiosPagina` (línea ~207), métodos
  nuevos después de `getPublishablePages` (línea ~1644, fin de la clase `PgStore`)
- Test: `db/src/store.test.ts` (o `db/src/posts-blog.test.ts` si preferís un archivo separado —
  dado que son ~6 métodos nuevos con su propia lógica, un archivo separado sigue el mismo criterio
  de `resenas.ts`/`resenas.test.ts`: una pieza, un archivo)

**Interfaces:**
- Consume: `sanitizarHtml` (Task 2), las columnas y funciones de la Task 1, `TenantContext`/`Tx`
  (ya existentes).
- Produce:
  - `interface PostBlog { titulo: string; cuerpo: string }`
  - `interface PostParaPublicar { pageId: string; clientId: string; tenantId: string; titulo: string; cuerpo: string; slug: string; blogTipo: string; blogUrl: string; blogCredencial: string }`
  - `guardarPost(ctx: TenantContext, pageId: string, post: PostBlog): Promise<boolean>`
  - `editarPost(ctx: TenantContext, pageId: string, cambios: { postTitulo?: string; postCuerpo?: string }): Promise<boolean>`
  - `solicitarPublicacionPost(ctx: TenantContext, pageId: string): Promise<boolean>`
  - `postParaPublicar(pageId: string): Promise<PostParaPublicar | null>`
  - `marcarPostPublicado(pageId: string, urlExterna: string): Promise<boolean>`

  Las Tasks 7, 8 y 10 consumen estos cinco métodos.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// db/src/posts-blog.test.ts (setup: mismo patrón que resenas.test.ts — before/after, helpers
// crearPaginaAprobada/crearPaginaConPost, sembrado directo con db.asService para preparar estado)

test("guardarPost escribe título/cuerpo sanitizado y post_generado_en", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  const ok = await store.guardarPost(
    { tenantId: tenantA, userId: equipoA },
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

test("editarPost NO revoca approved (a diferencia de editPage)", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.editarPost({ tenantId: tenantA, userId: equipoA }, pageId, { postTitulo: "T editado" });
  const [row] = await db.asService<{ approved: boolean }>("select approved from kr_pages where id = $1", [pageId]);
  assert.equal(row!.approved, true, "editar el post no toca la aprobación de la página");
});

test("🔴 editarPost rechaza mientras hay una publicación en curso sin confirmar", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  const ok = await store.editarPost({ tenantId: tenantA, userId: equipoA }, pageId, { postTitulo: "T pisado" });
  assert.equal(ok, false, "🔴 el WHERE rechaza post_solicitado_en not null and post_publicado_en null");
});

test("solicitarPublicacionPost devuelve true con post generado en una página aprobada", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const ok = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  assert.equal(ok, true);
});

test("🔴 solicitarPublicacionPost rechaza una página SIN post generado", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  const ok = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza post_titulo/post_cuerpo is null");
});

test("🔴 solicitarPublicacionPost rechaza una página NO aprobada", async () => {
  const pageId = await crearPaginaSinAprobar(clientA1, tenantA);
  await db.asService("update kr_pages set post_titulo = 'T', post_cuerpo = '<p>C</p>' where id = $1", [pageId]);
  const ok = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza approved = false");
});

test("solicitarPublicacionPost REINTENTA sobre una fila ya solicitada pero no publicada", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const primera = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  const segunda = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  assert.equal(primera, true);
  assert.equal(segunda, true, "un segundo pedido sobre 'ya solicitada, no publicada' vuelve a calificar");
});

test("🔴 solicitarPublicacionPost rechaza una página YA publicada", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  await db.asService("update kr_pages set post_publicado_en = now() where id = $1", [pageId]);
  const ok = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  assert.equal(ok, false, "🔴 el WHERE rechaza post_publicado_en not null");
});

test("🔴 solicitarPublicacionPost con rol 'cliente' devuelve false (ADR-20)", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  const ok = await store.solicitarPublicacionPost({ tenantId: tenantA, userId: duenoA1 }, pageId);
  assert.equal(ok, false);
});

test("postParaPublicar (rol app_service, sinTenant) trae lo necesario para publicar", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  await db.asService(
    "update clients set blog_externo_tipo = 'wordpress', blog_externo_url = 'https://x.com', blog_externo_credencial = 'sek' where id = $1",
    [clientA1],
  );
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

test("marcarPostPublicado confirma y NO deja reconfirmar", async () => {
  const pageId = await crearPaginaAprobada(clientA1, tenantA);
  await store.guardarPost({ tenantId: tenantA, userId: equipoA }, pageId, { titulo: "T", cuerpo: "<p>C</p>" });
  await store.solicitarPublicacionPost({ tenantId: tenantA, userId: equipoA }, pageId);
  const storeServicio = new PgStore(pool, "app_service");
  const primera = await storeServicio.marcarPostPublicado(pageId, "https://x.com/t");
  const segunda = await storeServicio.marcarPostPublicado(pageId, "https://x.com/t-otra-vez");
  assert.equal(primera, true);
  assert.equal(segunda, false, "🔴 el WHERE rechaza post_publicado_en not null — no se puede repisar la URL");
});
```

> Nota sobre los helpers: `crearPaginaAprobada`/`crearPaginaSinAprobar` son helpers nuevos —
> insertan un `kr_run` + una `kr_page` con `approved`/`retirada` según corresponda, mismo patrón que
> `crearResena` en `resenas.test.ts`.

Run: `npm test -w db -- --test-name-pattern="guardarPost|editarPost|solicitarPublicacionPost|postParaPublicar|marcarPostPublicado"`
Expected: FAIL — ninguno de los métodos existe todavía.

- [ ] **Step 2: Implementar los tipos**

```ts
// db/src/store.ts — cerca de ClientRow/CambiosPagina, línea ~207

/** El post generado por IA para una página — lo que persisten `guardarPost`/`editarPost`. */
export interface PostBlog {
  titulo: string;
  cuerpo: string;
}

/** Lo que el orquestador necesita para publicar UNA página, vía `app.post_para_publicar` (0028). */
export interface PostParaPublicar {
  pageId: string;
  clientId: string;
  tenantId: string;
  titulo: string;
  cuerpo: string;
  slug: string;
  blogTipo: string;
  blogUrl: string;
  blogCredencial: string;
}
```

- [ ] **Step 3: Implementar los métodos**

```ts
// db/src/store.ts — al final de la clase PgStore, después de getPublishablePages (línea ~1644)
// Agregar `import { sanitizarHtml } from "./sanitizar-html.js";` al principio del archivo.

/**
 * Guarda el post generado por IA para una página — dentro de `workflowDecision` (ADR-06, segunda
 * compuerta: el humano lo revisa después). `ctx` ya tiene el tenant del run: a diferencia de
 * reseñas, esto NO es cross-tenant (la generación corre adentro de un `workflowDecision` con
 * contexto). `post_cuerpo` se sanitiza ACÁ, antes de persistir — nunca se guarda HTML crudo del LLM.
 */
async guardarPost(ctx: TenantContext, pageId: string, post: PostBlog): Promise<boolean> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `update kr_pages
          set post_titulo = $2, post_cuerpo = $3, post_generado_en = now()
        where id = $1
        returning id`,
      [pageId, post.titulo, sanitizarHtml(post.cuerpo)],
    );
    return rows.length > 0;
  });
}

/**
 * Edita el post generado — a diferencia de `editPage`, NO revoca `approved`: editar el TEXTO del
 * post no es editar el BRIEF que la página aprobó (son cosas distintas). Rechaza (`false`, sin
 * lanzar) si hay una publicación en curso sin confirmar todavía —
 * `post_solicitado_en is not null and post_publicado_en is null` — para que lo que se publique sea
 * exactamente lo que el humano tenía delante cuando pidió "Publicar". `post_cuerpo` se sanitiza acá
 * si viene presente, mismo criterio que `guardarPost`.
 */
async editarPost(
  ctx: TenantContext,
  pageId: string,
  cambios: { postTitulo?: string; postCuerpo?: string },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [pageId];
  if (cambios.postTitulo !== undefined) {
    params.push(cambios.postTitulo);
    sets.push(`post_titulo = $${params.length}`);
  }
  if (cambios.postCuerpo !== undefined) {
    params.push(sanitizarHtml(cambios.postCuerpo));
    sets.push(`post_cuerpo = $${params.length}`);
  }
  if (sets.length === 0) return false;

  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `update kr_pages
          set ${sets.join(", ")}
        where id = $1
          and (post_solicitado_en is null or post_publicado_en is not null)
        returning id`,
      params,
    );
    return rows.length > 0;
  });
}

/**
 * Pide publicar el post en el blog externo — comando compuesto (ADR-18). `false` sin lanzar si la
 * página no existe, no es de este tenant, no tiene post, no está aprobada, está retirada, ya está
 * publicada, o `puede_escribir()` da falso — el WHERE decide. Un segundo llamado sobre una fila ya
 * solicitada pero no publicada REINTENTA (pisa el timestamp de nuevo) — mismo criterio que
 * `solicitarPublicacion` en `resenas.ts`.
 */
async solicitarPublicacionPost(ctx: TenantContext, pageId: string): Promise<boolean> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `update kr_pages set post_solicitado_en = now()
       where id = $1
         and approved
         and not retirada
         and post_titulo is not null
         and post_cuerpo is not null
         and post_publicado_en is null
       returning id`,
      [pageId],
    );
    return rows.length > 0;
  });
}

/**
 * Lo que el orquestador necesita para publicar UNA página, vía `app.post_para_publicar` (0028).
 * `null` si la solicitud ya no aplica — el evento que dispara esto no porta autoridad (ADR-18), esta
 * consulta es la que decide. Cross-tenant por el mismo motivo que `resenaParaPublicar`: el evento
 * solo trae el `pageId`, sin contexto de tenant. Solo funciona con `this.rol === "app_service"`
 * (mismo patrón que `resenaParaPublicar` — la función `security definer` solo le concede `execute` a
 * ese rol).
 */
async postParaPublicar(pageId: string): Promise<PostParaPublicar | null> {
  return this.sinTenant(async (tx) => {
    const { rows } = await tx.query<{
      page_id: string; client_id: string; tenant_id: string; titulo: string; cuerpo: string;
      slug: string; blog_tipo: string; blog_url: string; blog_credencial: string;
    }>("select * from app.post_para_publicar($1)", [pageId]);
    const r = rows[0];
    if (!r) return null;
    return {
      pageId: r.page_id, clientId: r.client_id, tenantId: r.tenant_id, titulo: r.titulo,
      cuerpo: r.cuerpo, slug: r.slug, blogTipo: r.blog_tipo, blogUrl: r.blog_url,
      blogCredencial: r.blog_credencial,
    };
  });
}

/**
 * Confirma que se publicó, vía `app.marcar_post_publicado` (0028). `false` si nadie la pidió o ya
 * estaba publicada — el WHERE de la función decide.
 */
async marcarPostPublicado(pageId: string, urlExterna: string): Promise<boolean> {
  return this.sinTenant(async (tx) => {
    const { rows } = await tx.query<{ marcar_post_publicado: boolean }>(
      "select app.marcar_post_publicado($1, $2) as marcar_post_publicado",
      [pageId, urlExterna],
    );
    return rows[0]?.marcar_post_publicado ?? false;
  });
}
```

- [ ] **Step 4: Exportar los tipos nuevos desde `db/src/index.ts`**

Agregar `PostBlog`, `PostParaPublicar` al bloque `export type { ... }`.

- [ ] **Step 5: Correr y confirmar que todos los tests pasan**

Run: `npm test -w db -- --test-name-pattern="guardarPost|editarPost|solicitarPublicacionPost|postParaPublicar|marcarPostPublicado"`
Expected: PASS, los trece.

- [ ] **Step 6: Correr toda la suite de `db/`**

Run: `npm test -w db && npm run typecheck -w db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/src/store.ts db/src/index.ts db/src/posts-blog.test.ts
git commit -m "db: guardarPost/editarPost/solicitarPublicacionPost/postParaPublicar/marcarPostPublicado"
```

---

### Task 4: `orchestrator/src/post-blog/` — `PostProvider` (generación por IA)

**Files:**
- Create: `orchestrator/src/post-blog/provider.ts`
- Create: `orchestrator/src/post-blog/mock-provider.ts`
- Create: `orchestrator/src/post-blog/openai-provider.ts`
- Test: `orchestrator/src/post-blog/mock-provider.test.ts`
- Modify: `orchestrator/src/config.ts` — `ModoPostBlog`, `postBlog` en `ConfigOrquestador`,
  `leerModoPostBlog()`/`validarModoPostBlog()`, mismo molde EXACTO que `ModoBorrador`/
  `borradorResenas`/`leerModoBorrador()` (líneas 77, 101-102, 170, 233, 264, 326-345 de
  `config.ts`).
- Test: `orchestrator/src/config.test.ts` — agregar los casos de `POST_BLOG_MODO` espejando los de
  `BORRADOR_RESENAS_MODO`.

**Interfaces:**
- Produce:
  - `interface PostBlogGenerado { titulo: string; cuerpo: string }`
  - `interface PostProvider { generar(args: { contentBrief: Record<string, unknown>; keywordPrincipal: string; perfilCliente: Record<string, unknown> | null }): Promise<PostBlogGenerado> }`
  - `getPostProvider(modo?: ModoPostBlog): PostProvider`
- Las Tasks 8 y 9 consumen `PostProvider`/`getPostProvider`.

- [ ] **Step 1: Extender `config.ts` — test que falla**

```ts
// orchestrator/src/config.test.ts — agregar junto a los tests de BORRADOR_RESENAS_MODO

test("postBlog: default 'openai' si hay OPENAI_API_KEY, 'mock' si no", () => {
  delete process.env["POST_BLOG_MODO"];
  process.env["OPENAI_API_KEY"] = "sk-x";
  assert.equal(leerConfig().postBlog, "openai");
  delete process.env["OPENAI_API_KEY"];
  assert.equal(leerConfig().postBlog, "mock");
});

test("🔴 postBlog: POST_BLOG_MODO inválido lanza", () => {
  process.env["POST_BLOG_MODO"] = "algo-raro";
  assert.throws(() => leerConfig(), /POST_BLOG_MODO inválido/);
  delete process.env["POST_BLOG_MODO"];
});
```

Run: `npm test -w orchestrator -- --test-name-pattern="postBlog"`
Expected: FAIL — `leerConfig().postBlog` es `undefined`, no lanza el error esperado.

- [ ] **Step 2: Implementar en `config.ts`** (mismo molde exacto que `ModoBorrador`)

```ts
// Agregar al final del bloque de tipos ModoX (cerca de línea 101-102):
export type ModoPostBlog = "mock" | "openai";
const MODOS_POST_BLOG: readonly string[] = ["mock", "openai"];

// Agregar a la interfaz ConfigOrquestador (cerca de línea 77), con el mismo docblock que
// borradorResenas pero para posts:
readonly postBlog: ModoPostBlog;

// Agregar a leerConfig(), en las dos ramas (líneas ~170, ~233, ~264) igual que borradorResenas:
const postBlog = leerModoPostBlog();
// ... incluir postBlog en los dos objetos de retorno, junto a borradorResenas

// Agregar las dos funciones, mismo molde que validarModoBorrador/leerModoBorrador (líneas ~326-345):
function validarModoPostBlog(crudo: string): ModoPostBlog {
  if (!MODOS_POST_BLOG.includes(crudo)) {
    throw new Error(`POST_BLOG_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`openai\`.`);
  }
  return crudo as ModoPostBlog;
}

function leerModoPostBlog(): ModoPostBlog {
  const crudo = process.env["POST_BLOG_MODO"]?.trim();
  if (crudo) return validarModoPostBlog(crudo);
  return process.env["OPENAI_API_KEY"]?.trim() ? "openai" : "mock";
}
```

- [ ] **Step 3: Correr y confirmar `config.test.ts`**

Run: `npm test -w orchestrator -- --test-name-pattern="postBlog"`
Expected: PASS.

- [ ] **Step 4: `provider.ts` + `mock-provider.ts` — test que falla**

```ts
// orchestrator/src/post-blog/mock-provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPostProvider, PREFIJO_MOCK_POST } from "./mock-provider.js";

test("MockPostProvider devuelve título y cuerpo con el prefijo inconfundible", async () => {
  const provider = new MockPostProvider();
  const post = await provider.generar({
    contentBrief: { tema: "tacos" },
    keywordPrincipal: "mejores tacos zona norte",
    perfilCliente: null,
  });
  assert.ok(post.titulo.includes(PREFIJO_MOCK_POST));
  assert.ok(post.cuerpo.includes(PREFIJO_MOCK_POST));
  assert.ok(post.titulo.includes("mejores tacos zona norte"));
});
```

Run: `npm test -w orchestrator -- --test-name-pattern="MockPostProvider"`
Expected: FAIL — el módulo no existe.

- [ ] **Step 5: Implementar `provider.ts` y `mock-provider.ts`**

```ts
// orchestrator/src/post-blog/provider.ts
import { leerConfig, type ModoPostBlog } from "../config.js";
import { MockPostProvider } from "./mock-provider.js";
import { OpenAIPostProvider } from "./openai-provider.js";

export interface PostBlogGenerado {
  titulo: string;
  // Formato canónico: HTML crudo del LLM. Se sanitiza recién al persistir (db/src/store.ts,
  // guardarPost) — este provider no sanitiza, no es su responsabilidad.
  cuerpo: string;
}

export interface PostProvider {
  generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
  }): Promise<PostBlogGenerado>;
}

// Mismo criterio que getBorradorProvider: el selector lee su propio default de leerConfig(), quien
// llama NO relee el entorno.
export function getPostProvider(modo: ModoPostBlog = leerConfig().postBlog): PostProvider {
  return modo === "openai" ? new OpenAIPostProvider() : new MockPostProvider();
}
```

```ts
// orchestrator/src/post-blog/mock-provider.ts
import type { PostBlogGenerado, PostProvider } from "./provider.js";

export const PREFIJO_MOCK_POST = "[POST MOCK — no generado por IA]";

export class MockPostProvider implements PostProvider {
  async generar(args: { keywordPrincipal: string }): Promise<PostBlogGenerado> {
    return {
      titulo: `${PREFIJO_MOCK_POST} ${args.keywordPrincipal}`,
      cuerpo: `<p>${PREFIJO_MOCK_POST} Contenido de ejemplo para "${args.keywordPrincipal}".</p>`,
    };
  }
}
```

- [ ] **Step 6: Correr y confirmar**

Run: `npm test -w orchestrator -- --test-name-pattern="MockPostProvider"`
Expected: PASS.

- [ ] **Step 6.1: Verificar que `content_brief` alcanza como insumo de prompt sin transformación**
  (spec, "Riesgos" — pendiente explícito, no resuelto en el spec ni hasta este punto del plan)

`content_brief` (jsonb) se diseñó para plantillas del M1, no para prompts de LLM. Antes de escribir
el prompt del Step 7, corré esto contra la demo sembrada (`npm run reseed:demo -- --dry-run` está
prohibido para subagentes, pero **leer** una fila sembrada no gasta nada):

```bash
npm run dev:server -w api   # o inspeccionar directo con psql/PGlite
```

y mirá el `content_brief` de una `kr_page` real (`select content_brief from kr_pages where content_brief is not null limit 1`).
Confirmá que trae texto descriptivo suficiente (tema, ángulo, puntos a cubrir) — no solo campos
estructurales de plantilla (slots, referencias a componentes). Si falta contexto, el prompt del Step
7 tiene que combinarlo con `seo`/`keywords_secundarias` (ya disponibles en `PaginaPropuesta`) antes
de mandarlo al LLM — ajustá `args.contentBrief` en `workflowDecision` (Task 8) para incluir lo que
haga falta. Documentá acá qué encontraste antes de seguir.

- [ ] **Step 7: Implementar `openai-provider.ts`** (sin test unitario contra la API real — mismo
  criterio que `OpenAIBorradorProvider`, que tampoco lo tiene; se prueba manualmente con una
  `OPENAI_API_KEY` real fuera de este harness)

```ts
// orchestrator/src/post-blog/openai-provider.ts
import OpenAI from "openai";
import type { PostBlogGenerado, PostProvider } from "./provider.js";
// Reuso deliberado: OPENAI_MODEL es compartida por todo el pipeline (kr-service, web-builder,
// borrador de reseñas) — leerModeloBorrador/costoEstimadoUsd no son específicas de reseñas pese al
// nombre del archivo, ver su propio docblock.
import { costoEstimadoUsd, leerModeloBorrador } from "../borrador/openai-provider.js";

const PROMPT_SISTEMA =
  "Sos un redactor SEO para un negocio gastronómico. Te doy una keyword principal, un brief de " +
  "contenido (JSON) y el perfil del negocio. Escribís un post de blog en español, HTML simple " +
  "(<p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>, <a href>), 400-600 palabras, que desarrolle el " +
  "brief para esa keyword. Devolvé SOLO un objeto JSON con dos claves: \"titulo\" (string, sin " +
  "HTML) y \"cuerpo\" (string, HTML). Nada de texto fuera del JSON.";

/**
 * Genera el post llamando a OpenAI de verdad. El cuerpo sale de acá SIN sanitizar — la garantía real
 * es que ningún HTML se persiste sin pasar por `sanitizarHtml` (db/src/store.ts, `guardarPost`),
 * mismo límite que ya documenta `OpenAIBorradorProvider` sobre el texto sin escapar.
 */
export class OpenAIPostProvider implements PostProvider {
  private readonly client: OpenAI;
  private readonly modelo: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      timeout: 45_000,
      maxRetries: 1,
    });
    this.modelo = leerModeloBorrador();
  }

  async generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
  }): Promise<PostBlogGenerado> {
    const contexto = JSON.stringify({
      keyword_principal: args.keywordPrincipal,
      content_brief: args.contentBrief,
      perfil_negocio: args.perfilCliente,
    });

    const res = await this.client.chat.completions.create({
      model: this.modelo,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: contexto },
      ],
    });

    const texto = res.choices[0]?.message.content?.trim();
    if (!texto) throw new Error("OpenAI no devolvió texto para el post");

    let parsed: unknown;
    try {
      parsed = JSON.parse(texto);
    } catch {
      throw new Error("OpenAI devolvió un JSON inválido para el post");
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj !== "object" || obj === null || typeof obj["titulo"] !== "string" || typeof obj["cuerpo"] !== "string") {
      throw new Error("OpenAI devolvió un JSON sin las claves titulo/cuerpo");
    }

    if (res.usage) {
      const costo = costoEstimadoUsd(res.usage, this.modelo);
      console.log(
        `[post-blog] costo estimado: ${costo != null ? `$${costo.toFixed(6)}` : "modelo sin tarifa conocida"} ` +
          `(${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out, modelo ${this.modelo})`,
      );
    }

    return { titulo: obj["titulo"] as string, cuerpo: obj["cuerpo"] as string };
  }
}
```

- [ ] **Step 8: `npm run typecheck -w orchestrator`**

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add orchestrator/src/config.ts orchestrator/src/config.test.ts orchestrator/src/post-blog/
git commit -m "orchestrator: PostProvider (mock + OpenAI) para generar posts de blog por IA"
```

---

### Task 5: `orchestrator/src/post-blog/publisher.ts` — `BlogPublisher` (solo mock)

**Files:**
- Create: `orchestrator/src/post-blog/publisher.ts`
- Create: `orchestrator/src/post-blog/mock-publisher.ts`
- Test: `orchestrator/src/post-blog/mock-publisher.test.ts`

**Interfaces:**
- Produce:
  - `interface CredencialesBlogExterno { tipo: "wordpress"; url: string; credencial: string }`
  - `interface BlogPublisher { publicar(post: { titulo: string; cuerpo: string; slug: string }, identificadorExterno: string, credenciales: CredencialesBlogExterno): Promise<{ url: string; publicado: boolean }> }`
  - `class MockBlogPublisher implements BlogPublisher`
- Las Tasks 8 y 9 consumen `BlogPublisher`.

- [ ] **Step 1: Test que falla**

```ts
// orchestrator/src/post-blog/mock-publisher.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBlogPublisher } from "./mock-publisher.js";

test("MockBlogPublisher confirma publicado y arma la URL a partir del slug", async () => {
  const publisher = new MockBlogPublisher();
  const resultado = await publisher.publicar(
    { titulo: "T", cuerpo: "<p>C</p>", slug: "mejores-tacos" },
    "page-id-1",
    { tipo: "wordpress", url: "https://blog.cliente.com/", credencial: "sek" },
  );
  assert.equal(resultado.publicado, true);
  assert.equal(resultado.url, "https://blog.cliente.com/mejores-tacos");
});
```

Run: `npm test -w orchestrator -- --test-name-pattern="MockBlogPublisher"`
Expected: FAIL — el módulo no existe.

- [ ] **Step 2: Implementar**

```ts
// orchestrator/src/post-blog/publisher.ts
export interface CredencialesBlogExterno {
  tipo: "wordpress"; // único valor hoy — el enum crece cuando haya una segunda plataforma real
  url: string;
  credencial: string;
}

export interface BlogPublisher {
  publicar(
    post: { titulo: string; cuerpo: string; slug: string },
    // Clave de idempotencia — siempre el pageId de kr_pages. Una implementación real DEBE usarla
    // para no duplicar en un reintento: buscar un post existente marcado con este identificador
    // antes de crear uno nuevo (ver la spec, "Idempotencia de la publicación").
    identificadorExterno: string,
    credenciales: CredencialesBlogExterno,
  ): Promise<{ url: string; publicado: boolean }>;
}
```

```ts
// orchestrator/src/post-blog/mock-publisher.ts
import type { BlogPublisher, CredencialesBlogExterno } from "./publisher.js";

/**
 * No sale del proceso — mismo criterio que `MockPublisher` de web-builder (Storyblok). Devuelve una
 * URL determinística a partir del slug. `identificadorExterno` no se usa acá (no hay estado real que
 * deduplicar en un mock) — una implementación real SÍ tiene que usarlo, ver `BlogPublisher`.
 */
export class MockBlogPublisher implements BlogPublisher {
  async publicar(
    post: { titulo: string; cuerpo: string; slug: string },
    _identificadorExterno: string,
    credenciales: CredencialesBlogExterno,
  ): Promise<{ url: string; publicado: boolean }> {
    return { url: `${credenciales.url.replace(/\/$/, "")}/${post.slug}`, publicado: true };
  }
}
```

- [ ] **Step 3: Correr y confirmar**

Run: `npm test -w orchestrator -- --test-name-pattern="MockBlogPublisher"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add orchestrator/src/post-blog/publisher.ts orchestrator/src/post-blog/mock-publisher.ts orchestrator/src/post-blog/mock-publisher.test.ts
git commit -m "orchestrator: BlogPublisher — interfaz genérica + mock (sin plataforma real todavía)"
```

---

### Task 6: `orchestrator/src/events.ts` — el evento de publicación

**Files:**
- Modify: `orchestrator/src/events.ts` — agregar `PostPublicacionSolicitada` al final (después de
  `ResenaPublicacionSolicitada`, línea 69) y a `Eventos` (línea 71-76).

**Interfaces:**
- Produce: `"posts/publicacion.solicitada": PostPublicacionSolicitada`.
- Las Tasks 7 y 10 lo consumen.

- [ ] **Step 1: Editar directamente** (es tipado puro, sin lógica que testear por separado — el test
  real es que `functions.ts`/`app.ts` typechequen contra este tipo, Tasks 7 y 10)

```ts
// orchestrator/src/events.ts — después de ResenaPublicacionSolicitada (línea 69)

export interface PostPublicacionSolicitada {
  data: {
    /**
     * El `id` de `kr_pages`. La fila YA quedó marcada bajo RLS antes de este evento (ADR-18) — esto
     * solo despierta al orquestador, que vuelve a preguntarle a la base qué publicar
     * (`postParaPublicar`). Nunca se confía en otro dato del evento para decidir qué escribir.
     */
    pageId: string;
    /** Solo trazabilidad — igual que `solicitadoPor` en `ResenaPublicacionSolicitada`. */
    solicitadoPor?: string;
  };
}

export type Eventos = {
  "research/solicitado": ResearchSolicitado;
  "research/aprobado": ResearchAprobado;
  "research/rechazado": ResearchRechazado;
  "resenas/respuesta.solicitada": ResenaPublicacionSolicitada;
  "posts/publicacion.solicitada": PostPublicacionSolicitada;
};
```

- [ ] **Step 2: `npm run typecheck -w orchestrator`**

Expected: PASS (nada lo consume todavía — este step solo confirma que el archivo sigue compilando).

- [ ] **Step 3: Commit**

```bash
git add orchestrator/src/events.ts
git commit -m "orchestrator: evento posts/publicacion.solicitada — solo el pageId, sin autoridad"
```

---

### Task 7: `orchestrator/src/functions.ts` + `server.ts` — publicar el post

**Files:**
- Modify: `orchestrator/src/functions.ts` — agregar `publicarPost`/`crearFuncionPublicarPost`
  después de `crearFuncionPublicarResena` (línea ~456, fin del archivo). `server.ts` NO se toca en
  esta task — sumar la función al array `funciones` requiere `deps.postPublisher`, que recién existe
  después de la Task 9; esa task hace el cambio completo de `server.ts` de una sola vez.
- Test: `orchestrator/src/functions.test.ts` — agregar sección nueva, mismo patrón que
  `publicarRespuestaResena` (líneas 712-799 del archivo).

**Interfaces:**
- Consume: `Deps.store.postParaPublicar`/`marcarPostPublicado` (Task 3), `Deps.postPublisher`
  (Task 5, wireado en Task 9), evento `PostPublicacionSolicitada` (Task 6).
- Produce: `publicarPost(deps, pageId, log?): Promise<{ publicada: boolean }>`,
  `crearFuncionPublicarPost(deps): InngestFunction`.

- [ ] **Step 1: Test que falla**

```ts
// orchestrator/src/functions.test.ts — sección nueva

test("publicarPost: con info válida, llama al publisher con los argumentos correctos y confirma", async () => {
  const llamadas: string[] = [];
  let publicarArgs: unknown[] | null = null;

  const deps = {
    store: {
      postParaPublicar: async (pageId: string) => {
        llamadas.push(`postParaPublicar(${pageId})`);
        return {
          pageId, clientId: "c1", tenantId: "t1", titulo: "T", cuerpo: "<p>C</p>", slug: "slug-1",
          blogTipo: "wordpress" as const, blogUrl: "https://x.com", blogCredencial: "sek",
        };
      },
      marcarPostPublicado: async (pageId: string, url: string) => {
        llamadas.push(`marcarPostPublicado(${pageId}, ${url})`);
        return true;
      },
    },
    postPublisher: {
      publicar: async (...args: unknown[]) => {
        llamadas.push("publicar");
        publicarArgs = args;
        return { url: "https://x.com/slug-1", publicado: true };
      },
    },
  };

  const resultado = await publicarPost(deps as never, "page-1");

  assert.deepEqual(resultado, { publicada: true });
  assert.deepEqual(llamadas, ["postParaPublicar(page-1)", "publicar", "marcarPostPublicado(page-1, https://x.com/slug-1)"]);
  assert.deepEqual(publicarArgs, [
    { titulo: "T", cuerpo: "<p>C</p>", slug: "slug-1" },
    "page-1",
    { tipo: "wordpress", url: "https://x.com", credencial: "sek" },
  ]);
});

test("publicarPost: postParaPublicar devuelve null → no llama al publisher", async () => {
  const llamadas: string[] = [];
  const deps = {
    store: { postParaPublicar: async () => { llamadas.push("postParaPublicar"); return null; }, marcarPostPublicado: async () => { llamadas.push("marcarPostPublicado"); return true; } },
    postPublisher: { publicar: async () => { llamadas.push("publicar"); return { url: "", publicado: true }; } },
  };
  const resultado = await publicarPost(deps as never, "page-1");
  assert.deepEqual(resultado, { publicada: false });
  assert.deepEqual(llamadas, ["postParaPublicar"]);
});

test("🔴 publicarPost: el publisher no confirma (publicado: false) → NO llama a marcarPostPublicado", async () => {
  const llamadas: string[] = [];
  const deps = {
    store: {
      postParaPublicar: async () => ({ pageId: "p1", clientId: "c1", tenantId: "t1", titulo: "T", cuerpo: "C", slug: "s", blogTipo: "wordpress" as const, blogUrl: "u", blogCredencial: "k" }),
      marcarPostPublicado: async () => { llamadas.push("marcarPostPublicado"); return true; },
    },
    postPublisher: { publicar: async () => ({ url: "", publicado: false }) },
  };
  const resultado = await publicarPost(deps as never, "page-1");
  assert.deepEqual(resultado, { publicada: false });
  assert.deepEqual(llamadas, [], "🔴 solo lo que el publisher CONFIRMA se marca — 'se mandó' no alcanza");
});
```

Run: `npm test -w orchestrator -- --test-name-pattern="publicarPost"`
Expected: FAIL — `publicarPost is not a function`.

- [ ] **Step 2: Implementar**

```ts
// orchestrator/src/functions.ts — al final del archivo, después de crearFuncionPublicarResena

/**
 * Publica el post en el blog externo. Reacciona a `posts/publicacion.solicitada`, que NO PORTA
 * AUTORIDAD (ver events.ts): la fila ya quedó marcada bajo RLS por la API antes de emitirlo
 * (ADR-18), y esta función vuelve a preguntarle a la base qué publicar (`postParaPublicar`) en vez
 * de confiar en el evento. Cero filas = la solicitud ya no aplica — no es un error, es una carrera
 * perdida (u otra corrida ya publicó).
 */
export async function publicarPost(
  deps: Pick<Deps, "store" | "postPublisher">,
  pageId: string,
  log: (msg: string) => void = () => {},
): Promise<{ publicada: boolean }> {
  const info = await deps.store.postParaPublicar(pageId);
  if (!info) {
    log(`[publicar-post] ${pageId}: la solicitud ya no aplica (publicada, sin post, o inexistente)`);
    return { publicada: false };
  }

  const resultado = await deps.postPublisher.publicar(
    { titulo: info.titulo, cuerpo: info.cuerpo, slug: info.slug },
    info.pageId,
    { tipo: info.blogTipo as "wordpress", url: info.blogUrl, credencial: info.blogCredencial },
  );

  if (!resultado.publicado) {
    log(`[publicar-post] ${pageId}: el publisher no confirmó la publicación`);
    return { publicada: false };
  }

  const ok = await deps.store.marcarPostPublicado(pageId, resultado.url);
  if (!ok) {
    log(`[publicar-post] ${pageId}: publicado externamente pero la confirmación no pisó ninguna fila`);
  }
  return { publicada: ok };
}

export function crearFuncionPublicarPost(deps: Deps) {
  return inngest.createFunction(
    {
      id: "publicar-post-blog",
      // Sin reintentos: mismo criterio que publicar-respuesta-resena — el reintento real es que el
      // staff vuelva a apretar "Publicar", que pisa post_solicitado_en y remite el evento.
      retries: 0,
    },
    { event: "posts/publicacion.solicitada" },
    async ({ event, step }) =>
      step.run("publicar", () => publicarPost(deps, event.data.pageId, console.log)),
  );
}
```

- [ ] **Step 3: Correr y confirmar**

Run: `npm test -w orchestrator -- --test-name-pattern="publicarPost"`
Expected: PASS.

- [ ] **Step 4: Commit** (`server.ts` NO se toca acá — `crearFuncionPublicarPost` queda exportada
  pero sin sumar al array `funciones` todavía; eso, junto con el resto del wiring de `Deps`, lo hace
  la Task 9 de una sola vez, para no dejar `server.ts` a medio editar entre dos tasks)

```bash
git add orchestrator/src/functions.ts orchestrator/src/functions.test.ts
git commit -m "orchestrator: publicarPost/crearFuncionPublicarPost — publica en el blog externo, confirmación real"
```

---

### Task 8: `orchestrator/src/workflow.ts` — reemplazar el stub `crear_posts`

> ⚠️ **Depende del sub-proyecto 2 ya implementado** (ver "Global Constraints"). Esta task busca
> código por su CONTENIDO, no por número de línea — el stub lo introduce la Task 6 del plan
> `2026-08-26-desacoplar-kr-web.md`, y no existe todavía en el repo al momento de escribir este plan.

**Files:**
- Modify: `orchestrator/src/workflow.ts` — buscar el bloque `if (decision.destino === "crear_posts")`
  (el stub que cierra en `error`, introducido por el sub-proyecto 2) y reemplazarlo.
- Test: `orchestrator/src/workflow.test.ts` — agregar los tests de la rama `crear_posts` (reemplazan
  el test del stub, que probaba que cerraba en `error` con un mensaje fijo).

**Interfaces:**
- Consume: `Deps.store.getRunPages`, `Deps.store.getClient`, `Deps.store.guardarPost`,
  `Deps.store.cerrarDecision` (ya existentes, sub-proyecto 2 y anteriores), `Deps.postProvider`
  (Task 4, wireado en Task 9).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// orchestrator/src/workflow.test.ts — reemplaza el test del stub de crear_posts

test("workflowDecision: crear_posts genera un post por cada página aprobada y cierra 'completado'", async () => {
  const guardados: Array<{ pageId: string; post: { titulo: string; cuerpo: string } }> = [];
  const deps = depsDeDecision({
    getRunPages: async () => [
      { id: "p1", approved: true, url_slug: "a", keyword_principal: "kw-a", content_brief: {}, /* ...resto de PaginaPropuesta */ },
      { id: "p2", approved: false, url_slug: "b", keyword_principal: "kw-b", content_brief: {}, /* ... */ },
    ],
    getClient: async () => ({ id: "c1", nombre: "Cliente", storyblok_space_id: null, business_profile: null }),
    guardarPost: async (ctx, pageId, post) => { guardados.push({ pageId, post }); return true; },
    cerrarDecision: async () => true,
  });
  const resultado = await workflowDecision(deps, decisionCrearPosts());
  assert.equal(resultado.resultado, "completado");
  assert.equal(guardados.length, 1, "solo la página aprobada (p1) genera post");
  assert.equal(guardados[0]!.pageId, "p1");
});

test("workflowDecision: crear_posts con fallo puntual — 1 de 2 páginas falla, la otra se genera y cierra 'completado'", async () => {
  let intento = 0;
  const deps = depsDeDecision({
    getRunPages: async () => [
      { id: "p1", approved: true, url_slug: "a", keyword_principal: "kw-a", content_brief: {} },
      { id: "p2", approved: true, url_slug: "b", keyword_principal: "kw-b", content_brief: {} },
    ],
    postProviderGenerar: async () => {
      intento++;
      if (intento === 1) throw new Error("OpenAI caído");
      return { titulo: "T", cuerpo: "<p>C</p>" };
    },
    guardarPost: async () => true,
    cerrarDecision: async () => true,
  });
  const resultado = await workflowDecision(deps, decisionCrearPosts());
  assert.equal(resultado.resultado, "completado", "1 de 2 generado igual cierra completado");
});

test("🔴 workflowDecision: crear_posts con TODAS las páginas fallando cierra 'error'", async () => {
  let detalleCerrado: string | undefined;
  const deps = depsDeDecision({
    getRunPages: async () => [{ id: "p1", approved: true, url_slug: "a", keyword_principal: "kw-a", content_brief: {} }],
    postProviderGenerar: async () => { throw new Error("OpenAI caído"); },
    cerrarDecision: async (ctx, id, cierre) => { if (cierre.resultado === "error") detalleCerrado = cierre.detalleError; return true; },
  });
  const resultado = await workflowDecision(deps, decisionCrearPosts());
  assert.equal(resultado.resultado, "error", "🔴 cero posts generados no puede cerrar 'completado'");
  assert.ok(detalleCerrado?.includes("Falló la generación"));
});

test("🔴 workflowDecision: crear_posts sin ninguna página aprobada cierra 'error' sin llamar al provider", async () => {
  let provierLlamado = false;
  const deps = depsDeDecision({
    getRunPages: async () => [{ id: "p1", approved: false, url_slug: "a", keyword_principal: "kw-a", content_brief: {} }],
    postProviderGenerar: async () => { provierLlamado = true; return { titulo: "T", cuerpo: "C" }; },
  });
  const resultado = await workflowDecision(deps, decisionCrearPosts());
  assert.equal(resultado.resultado, "error");
  assert.equal(provierLlamado, false, "🔴 sin páginas aprobadas no se llama al provider ni una vez");
});
```

> Nota: `depsDeDecision`/`decisionCrearPosts` son helpers que ya existen en el archivo (el sub-proyecto
> 2 los introduce para probar `crear_web`/`solo_informe`) — extendé el objeto de deps que ya arman
> con `postProvider: { generar: opciones.postProviderGenerar ?? (async () => ({ titulo: "T", cuerpo: "<p>C</p>" })) }`
> y `guardarPost`.

Run: `npm test -w orchestrator -- --test-name-pattern="crear_posts"`
Expected: FAIL — el stub actual cierra siempre en `error` con un mensaje fijo distinto al esperado.

- [ ] **Step 2: Reemplazar el stub**

```ts
// orchestrator/src/workflow.ts — reemplaza el bloque `if (decision.destino === "crear_posts") { ... }`
// que el sub-proyecto 2 (Task 6 de su plan) dejó cerrando siempre en error.

if (decision.destino === "crear_posts") {
  // getRunPages ya existe (usada por el revisor del brief) y trae `id`/`approved` — no hace falta
  // un método nuevo (Codex, ronda 1 sobre el spec, hallazgo Nit). registrarDecision (sub-proyecto 2,
  // enmendado 2026-08-26) ya garantizó que el run tiene al menos una página aprobada antes de llegar
  // acá — el filtro de abajo es sobre CUÁLES, no una repetición de esa garantía.
  const todas = await deps.store.getRunPages(ctx, decision.run_id);
  const paginas = todas.filter((p) => p.approved);
  if (paginas.length === 0) {
    await deps.store.cerrarDecision(ctx, decisionId, {
      resultado: "error",
      detalleError: "El run no tiene páginas publicables.",
    });
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
  }

  const cliente = await deps.store.getClient(ctx, decision.client_id);
  let generados = 0;
  for (const pagina of paginas) {
    // Falla puntual: si el LLM revienta en UNA página, las demás se generan igual — mismo criterio
    // que pollearResenas con el borrador de reseñas. Sin reintento automático acá.
    try {
      const post = await deps.postProvider.generar({
        contentBrief: pagina.content_brief,
        keywordPrincipal: pagina.keyword_principal,
        perfilCliente: cliente?.business_profile ?? null,
      });
      await deps.store.guardarPost(ctx, pagina.id, post); // sanitiza antes de persistir
      generados++;
    } catch (e) {
      log(`[decision ${decisionId}] falló la generación del post para ${pagina.url_slug}: ${(e as Error).message}`);
    }
  }

  // 'completado' acá significa "hay al menos un borrador esperando revisión" — NUNCA "publicados".
  // Distinto de crear_web, donde 'completado' sí significa publicado.
  if (generados === 0) {
    await deps.store.cerrarDecision(ctx, decisionId, {
      resultado: "error",
      detalleError: `Falló la generación de los ${paginas.length} posts del run — ver logs.`,
    });
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
  }
  await deps.store.cerrarDecision(ctx, decisionId, { resultado: "completado" });
  return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "completado" };
}
```

- [ ] **Step 3: Correr y confirmar**

Run: `npm test -w orchestrator -- --test-name-pattern="crear_posts"`
Expected: PASS.

- [ ] **Step 4: `npm run typecheck -w orchestrator`**

Expected: PASS (con `Deps.postProvider` ya agregado por la Task 9 — si no, es esperado que falle,
mismo criterio que la nota de la Task 7 Step 4).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/workflow.ts orchestrator/src/workflow.test.ts
git commit -m "orchestrator: workflowDecision — crear_posts genera un post por página aprobada"
```

---

### Task 9: `orchestrator/src/deps.ts` — wiring de `postProvider`/`postPublisher`

**Files:**
- Modify: `orchestrator/src/deps.ts` — import de `getPostProvider` (línea ~15, junto a
  `getBorradorProvider`), import de `MockBlogPublisher` (no hay selector — solo mock, ver "Global
  Constraints"), y las dos propiedades nuevas en el objeto que devuelve `crearDeps` (línea ~194-203,
  junto a `resenasProvider`/`borradorProvider`).
- Modify: `orchestrator/src/workflow.ts` — agregar `postProvider: PostProvider` y (si `Deps` no las
  trae ya de otra parte) `guardarPost`/`getRunPages`/`getClient` a la interfaz `Deps`/`Store` — estos
  últimos tres probablemente ya están si el sub-proyecto 2 los usa; confirmá antes de duplicar.
- Modify: `orchestrator/src/server.ts` — importar `crearFuncionPublicarPost` (Task 7) y sumarlo al
  array `funciones` (línea 56-62, actualizar el comentario "Cinco" → "Seis"), y agregar
  `postBlog: config.postBlog` al log de arranque (mismo patrón que `borrador: config.borradorResenas`,
  líneas 72, 85, 106).

**Interfaces:**
- Consume: `getPostProvider` (Task 4), `MockBlogPublisher` (Task 5), `crearFuncionPublicarPost`
  (Task 7).
- Produce: `Deps.postProvider: PostProvider`, `Deps.postPublisher: BlogPublisher`.

- [ ] **Step 1: Editar `deps.ts`**

```ts
// orchestrator/src/deps.ts — imports, junto a getBorradorProvider (línea 15)
import { getPostProvider } from "./post-blog/provider.js";
import { MockBlogPublisher } from "./post-blog/mock-publisher.js";

// En el objeto que devuelve crearDeps (línea ~194-203), junto a borradorProvider/telegramProvider:

    // Mismo criterio que borradorProvider: el selector lee su propio default de leerConfig(), acá
    // NO se relee el entorno.
    postProvider: getPostProvider(),

    // Sin selector: solo hay implementación mock (ver "Global Constraints" del plan). Cuando exista
    // una plataforma real confirmada, este wiring pasa a un selector como los de arriba.
    postPublisher: new MockBlogPublisher(),
```

- [ ] **Step 2: Confirmar/extender la interfaz `Deps` en `workflow.ts`**

Buscá la definición de `interface Deps` en `orchestrator/src/workflow.ts` (la usan `research`,
`validarContrato`, `publicar`, `resenasProvider`, etc. — ya visibles en `deps.ts`). Si el
sub-proyecto 2 no la extendió ya con `getRunPages`/`getClient`/`guardarPost` (revisá su plan, Tasks
6-7), agregalas junto con:

```ts
postProvider: PostProvider; // import type { PostProvider } from "./post-blog/provider.js";
```

`postPublisher` NO va en esta interfaz — solo lo usa `functions.ts` (`publicarPost`), no
`workflowDecision`. Mantenerla afuera de `Deps` de workflow evita pasarle a la lógica de generación
una dependencia que no usa.

- [ ] **Step 3: Editar `server.ts`**

```ts
// orchestrator/src/server.ts — imports (línea ~20-27): agregar crearFuncionPublicarPost

// línea 56-62:
const funciones = [
  crearFuncionResearch(deps),
  crearFuncionBarrido(deps),
  crearFuncionPollingResenas(deps),
  crearFuncionPublicarResena(deps),
  crearFuncionVincularTelegram(deps),
  crearFuncionPublicarPost(deps),
];
// actualizar el comentario de la línea 51-55: "Cinco" → "Seis: ... y la publicación de posts en el
// blog externo del cliente (sub-proyecto 3)".

const postBlog = config.postBlog; // junto a `const borrador = config.borradorResenas;`, línea ~72

// pasar `postBlog` al objeto de crearServidor, junto a `borrador` (línea ~85)

// en el log de arranque (línea ~106), agregar:
console.log(`  Post-blog IA: ${postBlog}${postBlog === "openai" ? " ⚠️  GASTA DINERO al generar posts" : ""}`);
```

- [ ] **Step 4: `npm run typecheck -w orchestrator && npm test -w orchestrator`**

Expected: PASS — este es el punto donde las Tasks 4, 5, 6, 7, 8 y 9 quedan integradas y compilando
juntas.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/deps.ts orchestrator/src/workflow.ts orchestrator/src/server.ts
git commit -m "orchestrator: wiring de postProvider/postPublisher, servidor expone la sexta función"
```

---

### Task 10: `api/src/app.ts` — extender `PATCH /pages/:id`, agregar `GET /pages/:id/post`

**Files:**
- Modify: `api/src/app.ts` — extender el handler de `PATCH /pages/:id` (línea 348-356) y agregar
  `GET /pages/:id/post` cerca de él.
- Modify: `api/src/deps.ts` (o donde se resuelva `deps.store`) — sin cambios si `PgStore` ya expone
  los métodos nuevos (Task 3) a través de la misma instancia que usa `editPage`/`approvePage`.
- Test: `api/src/app.test.ts` — agregar sección nueva, mismo patrón que los tests de
  `PATCH /clients/:id/resenas/:resenaId` (líneas 1486-1565).

**Interfaces:**
- Consume: `deps.store.editPage` (ya existente), `deps.store.editarPost`/`solicitarPublicacionPost`
  (Task 3), `deps.emisor.send` (ya existente, interfaz `EmisorEventos`), evento
  `posts/publicacion.solicitada` (Task 6).

- [ ] **Step 1: Tests que fallan**

```ts
// api/src/app.test.ts — sección nueva

test("PATCH /pages/:id con {post_titulo, post_cuerpo}: edita el post, NO revoca approved", async () => {
  const pageId = await sembrarPaginaAprobadaConPost(clientA1); // helper: página approved=true con post ya generado
  const res = await req("PATCH", `/pages/${pageId}`, {
    user: equipoA, tenant: tenantA,
    body: { post_titulo: "Nuevo título", post_cuerpo: "<p>Nuevo cuerpo</p>" },
  });
  assert.equal(res.status, 200);
  const [fila] = await sql<{ post_titulo: string; approved: boolean }>(
    "select post_titulo, approved from kr_pages where id = $1", [pageId],
  );
  assert.equal(fila!.post_titulo, "Nuevo título");
  assert.equal(fila!.approved, true, "editar el post no revoca la aprobación de la página");
});

test("PATCH /pages/:id con {publicar_post: true}: marca post_solicitado_en y emite EXACTAMENTE posts/publicacion.solicitada", async () => {
  const pageId = await sembrarPaginaAprobadaConPost(clientA1);
  const res = await req("PATCH", `/pages/${pageId}`, { user: equipoA, tenant: tenantA, body: { publicar_post: true } });
  assert.equal(res.status, 200);
  const [fila] = await sql<{ post_solicitado_en: string | null }>(
    "select post_solicitado_en from kr_pages where id = $1", [pageId],
  );
  assert.ok(fila!.post_solicitado_en);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0], { name: "posts/publicacion.solicitada", data: { pageId, solicitadoPor: equipoA } });
});

test("🔴 PATCH /pages/:id con {publicar_post: true} sobre página SIN post: 404, sin evento", async () => {
  const pageId = await sembrarPaginaAprobadaSinPost(clientA1);
  const res = await req("PATCH", `/pages/${pageId}`, { user: equipoA, tenant: tenantA, body: { publicar_post: true } });
  assert.equal(res.status, 404);
  assert.equal(eventos.length, 0, "🔴 sin fila marcada, no se emite nada");
});

test("🔴 PATCH /pages/:id mezclando un campo de brief con uno de post: 400", async () => {
  const pageId = await sembrarPaginaAprobadaConPost(clientA1);
  const res = await req("PATCH", `/pages/${pageId}`, {
    user: equipoA, tenant: tenantA, body: { url_slug: "nuevo-slug", post_titulo: "T" },
  });
  assert.equal(res.status, 400);
});

test("GET /pages/:id/post — staff ve el post, cliente también (solo lectura)", async () => {
  const pageId = await sembrarPaginaAprobadaConPost(clientA1);
  const resStaff = await req("GET", `/pages/${pageId}/post`, { user: equipoA, tenant: tenantA });
  assert.equal(resStaff.status, 200);
  const resCliente = await req("GET", `/pages/${pageId}/post`, { user: duenoA1, tenant: tenantA });
  assert.equal(resCliente.status, 200);
});

test("🔴 PATCH /pages/:id con {post_titulo} desde rol cliente: 404 (ADR-20, no un 403 que confirme la fila)", async () => {
  const pageId = await sembrarPaginaAprobadaConPost(clientA1);
  const res = await req("PATCH", `/pages/${pageId}`, { user: duenoA1, tenant: tenantA, body: { post_titulo: "intento" } });
  assert.equal(res.status, 404);
});
```

Run: `npm test -w api -- --test-name-pattern="post_titulo|publicar_post|pages.*post"`
Expected: FAIL — la ruta no distingue las formas nuevas todavía.

- [ ] **Step 2: Extender el handler**

```ts
// api/src/app.ts — reemplaza el handler actual de PATCH /pages/:id (línea 348-356)

/**
 * PATCH /pages/:id — dirige por FORMA del body, sin mezclar formas en un mismo request:
 *  - Campos del brief (url_slug, keyword_principal, seo, content_brief, preguntas_frecuentes) →
 *    editPage (comportamiento ya existente, revoca approved).
 *  - { post_titulo?, post_cuerpo? } (al menos una) → editarPost (NO revoca approved).
 *  - { publicar_post: true } → comando compuesto (ADR-18).
 * Mezclar campos de brief con campos de post, o cualquier combinación no reconocida → 400.
 */
app.patch("/pages/:id", async (c) => {
  const ctx = c.get("ctx");
  const pageId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);
  const b = body as Record<string, unknown>;

  const clavesBrief = ["url_slug", "keyword_principal", "seo", "content_brief", "preguntas_frecuentes"];
  const clavesPost = ["post_titulo", "post_cuerpo"];
  const tieneBrief = clavesBrief.some((k) => b[k] !== undefined);
  const tienePost = clavesPost.some((k) => b[k] !== undefined);
  const esPublicar = Object.keys(b).length === 1 && b["publicar_post"] === true;

  if (tieneBrief && tienePost) {
    return c.json({ error: "No se puede editar el brief y el post en el mismo PATCH." }, 400);
  }

  if (esPublicar) {
    const ok = await deps.store.solicitarPublicacionPost(ctx, pageId);
    if (!ok) {
      return c.json(
        { error: "Página no encontrada, no aprobada, retirada, sin post, ya publicada, o sin permiso." },
        404,
      );
    }
    await deps.emisor.send({
      name: "posts/publicacion.solicitada",
      data: ctx.userId ? { pageId, solicitadoPor: ctx.userId } : { pageId },
    });
    return c.json({ ok: true });
  }

  if (tienePost) {
    const cambios: { postTitulo?: string; postCuerpo?: string } = {};
    if (typeof b["post_titulo"] === "string") cambios.postTitulo = b["post_titulo"];
    if (typeof b["post_cuerpo"] === "string") cambios.postCuerpo = b["post_cuerpo"];
    const ok = await deps.store.editarPost(ctx, pageId, cambios);
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "Página no encontrada, sin permiso, o con una publicación en curso." }, 404);
  }

  if (tieneBrief) {
    const ok = await deps.store.editPage(ctx, pageId, filtrarCambios(b));
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "Página no encontrada, retirada, o sin cambios válidos." }, 404);
  }

  return c.json({ error: "El body no reconoce ningún campo válido." }, 400);
});

/** GET /pages/:id/post — ver el borrador del post (staff y cliente, solo lectura para cliente). */
app.get("/pages/:id/post", async (c) => {
  const ctx = c.get("ctx");
  const post = await deps.store.getPost(ctx, c.req.param("id")); // ver Step 2.1, método nuevo simple
  return post ? c.json({ post }) : c.json({ error: "Página no encontrada, o sin post generado." }, 404);
});
```

- [ ] **Step 2.1: Agregar `getPost` a `db/src/store.ts`** (faltaba en la Task 3 — es un `SELECT`
  simple bajo RLS normal, no necesita comando compuesto ni sanitización de nuevo — lo que está en la
  base ya está sanitizado)

```ts
// db/src/store.ts — junto a los otros métodos de la Task 3

export interface PostDePagina {
  titulo: string | null;
  cuerpo: string | null;
  generadoEn: string | null;
  solicitadoEn: string | null;
  publicadoEn: string | null;
  urlExterna: string | null;
}

async getPost(ctx: TenantContext, pageId: string): Promise<PostDePagina | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{
      post_titulo: string | null; post_cuerpo: string | null; post_generado_en: string | null;
      post_solicitado_en: string | null; post_publicado_en: string | null; post_url_externa: string | null;
    }>(
      `select post_titulo, post_cuerpo, post_generado_en, post_solicitado_en, post_publicado_en, post_url_externa
       from kr_pages where id = $1`,
      [pageId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      titulo: r.post_titulo, cuerpo: r.post_cuerpo, generadoEn: r.post_generado_en,
      solicitadoEn: r.post_solicitado_en, publicadoEn: r.post_publicado_en, urlExterna: r.post_url_externa,
    };
  });
}
```

Agregá un test rojo→verde para `getPost` en `db/src/posts-blog.test.ts` (Task 3) antes de seguir acá
— mismo ritual, aunque sea un método simple: el caso "página de otro tenant devuelve null, no lanza"
es el que vale la pena fijar.

- [ ] **Step 3: Correr y confirmar**

Run: `npm test -w api -- --test-name-pattern="post_titulo|publicar_post|pages.*post"`
Expected: PASS.

- [ ] **Step 4: Suite completa de `api/`**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/app.ts db/src/store.ts db/src/posts-blog.test.ts api/src/app.test.ts
git commit -m "api: PATCH /pages/:id extendido (post, publicar) + GET /pages/:id/post"
```

---

### Task 11: Portal — pantalla de posts generados

> Delegable al agente `front` (portal Angular) — esta task describe el comportamiento y el
> contrato con la API; los detalles de Angular (signals, standalone components, estilos) siguen las
> convenciones de `portal-angular`/`portal-estilos` y el patrón exacto de
> `portal/src/app/pages/clientes/cliente-resenas.ts`, que es la referencia más cercana (misma forma
> de estado: lista + edición + botón con tres estados).

**Files:**
- Create (o extender, a decidir mirando `cliente-research.ts`/`brief.ts` — si ya hay una pantalla de
  "brief de un run", un tab nuevo ahí es más consistente que una ruta separada):
  `portal/src/app/pages/clientes/cliente-posts.ts` (o el nombre que el agente `front` decida al
  mirar la convención real de nombres de archivo del portal).
- Modify: rutas del portal, para exponer la pantalla nueva.
- Test: `*.spec.ts` correspondiente, vía Karma (`npm --prefix portal run test:components`).

**Interfaces:**
- Consume: `GET /pages/:id/post`, `PATCH /pages/:id` (con `post_titulo`/`post_cuerpo` o
  `publicar_post: true`) — Task 10.

- [ ] **Step 1: Listar los posts de un run `crear_posts`**

Lista título editable, cuerpo editable (textarea o editor simple), y estado derivado de las
columnas: sin post → "generando…" (o vacío si falló, ver más abajo); generado sin publicar →
editable + botón "Publicar"; solicitado sin confirmar → botón deshabilitado ("Publicando…"); ya
publicado → "Publicada — [link a `postUrlExterna`]" + botón "Reintentar publicación" (habilitado
mientras `publicadoEn` sea `null` — que ahora SÍ es un estado alcanzable de nuevo tras un reintento,
a diferencia de la primera versión del spec).

- [ ] **Step 2: Edición**

Título y cuerpo en un único formulario, un solo `PATCH /pages/:id` con `{post_titulo, post_cuerpo}`
al guardar — no dos requests separados. Mientras `post_solicitado_en` esté seteado y
`post_publicado_en` no, deshabilitar los campos de edición en la UI (el `PATCH` los rechazaría
igual — esto es solo UX, no la garantía real).

- [ ] **Step 3: Rol `cliente`**

Mismo contenido, controles de edición y de "Publicar" ocultos o deshabilitados — nunca mostrar un
control que la API rechazaría en silencio (mismo criterio que `cliente-resenas.ts:137-141`).

- [ ] **Step 4: Tests de componente**

Cubrir como mínimo: la lista renderiza los tres estados (sin publicar / publicando / publicado), el
botón "Publicar" llama al `PATCH` correcto, el rol `cliente` no ve el botón.

Run: `npm --prefix portal run test:components -- --include='**/cliente-posts*.spec.ts'` (o el
patrón real que uses)
Expected: PASS.

- [ ] **Step 5: Manejar en el navegador** (ritual de AGENTS.md — encuentra lo que los tests no ven)

`npm run dev:server -w api`, aprobar un run con `crear_posts`, ver los borradores generados
(mock), editar uno, publicarlo con `MockBlogPublisher`, confirmar que el link aparece.

- [ ] **Step 6: Commit**

```bash
git add portal/
git commit -m "portal: pantalla de posts generados — editar y publicar en el blog externo del cliente"
```

---

### Task 12: Verificación final

**Files:** ninguno nuevo — este es el cierre del ritual de `AGENTS.md`.

- [ ] **Step 1: Suite completa**

Run: `npm run verificar`
Expected: PASS — entorno, arnés, higiene de secretos, typecheck y tests de los 7 paquetes + scripts,
en verde.

- [ ] **Step 2: Portal**

Run: `npm run verificar -- --con-portal`
Expected: PASS.

- [ ] **Step 3: Flujo completo en el navegador** (ya cubierto parcialmente en la Task 11, Step 5 —
  repetir de punta a punta con los tres sub-sistemas integrados)

1. Aprobar un run con `crear_posts` (requiere que la UI de aprobación del sub-proyecto 2 lo ofrezca
   — si esa pieza del portal no está implementada todavía, aprobar directo contra la API con
   `curl`/`httpie`).
2. Confirmar que se generaron los posts (mock) — `GET /pages/:id/post` por cada página aprobada.
3. Editar uno desde el portal.
4. Publicarlo — confirmar `post_publicado_en`/`post_url_externa` en la base y el link en el portal.
5. Reintentar publicar una página YA publicada desde la API directamente (`{"publicar_post": true}`)
   y confirmar que `solicitarPublicacionPost` lo rechaza (`404`) — es el caso que el mock no puede
   mostrar visualmente (el botón ya está oculto), pero el contrato tiene que sostenerlo igual.

- [ ] **Step 4: Documentación** (ritual de `AGENTS.md`, paso 3)

Actualizar `progress/current.md` (mover el resumen de este sub-proyecto a `progress/history.md` si
la etapa se da por cerrada), `docs/proyecto/09-estado-y-roadmap.md`, y el ADR-06 si esta pieza
confirma o ajusta algo de la compuerta humana doble que no estuviera ya documentado.

- [ ] **Step 5: Commit + push** (con confirmación explícita del usuario antes del `push`, por la
  disciplina de acciones que afectan estado compartido)

```bash
git add -A
git commit -m "Cierra el sub-proyecto 3: publicar posts en blog externo, de punta a punta"
```
