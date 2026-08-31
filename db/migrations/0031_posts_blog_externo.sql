-- =============================================================================
-- AMG OS — 0031: publicar posts generados por IA en el blog externo del cliente (sub-proyecto 3)
--
-- Mismo molde que resenas_google (0021/0022/0024/0025), aplicado a kr_pages en vez de una tabla
-- nueva: el post vive como columnas en la fila del recurso. A diferencia de reseñas, la GENERACIÓN
-- no necesita un rol cross-tenant: corre dentro de workflowDecision, que ya tiene contexto de
-- tenant (el polling de reseñas es cross-tenant desde el arranque, esto no). Solo la PUBLICACIÓN
-- es cross-tenant (el evento solo trae pageId, ADR-18) -- por eso el rol confinado nuevo (app_posts)
-- y las tres funciones security definer (leer, confirmar, marcar fallo) están acá, no un cuarto par
-- para "generar" o "editar".
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
  add column if not exists post_url_externa     text,
  add column if not exists post_error_en        timestamptz;

comment on column kr_pages.post_titulo is
  'Título del post generado por IA para el blog externo del cliente. NULL = sin generar.';
comment on column kr_pages.post_cuerpo is
  'Cuerpo HTML del post, sanitizado por allowlist ANTES de escribirse acá (db/src/store.ts, '
  'guardarPost/editarPost, vía sanitizarHtml) -- nunca se persiste HTML sin pasar por ahí.';
comment on column kr_pages.post_generado_en is
  'Cuando la IA generó el post. NULL = todavía no, o falló la generación para esta página.';
comment on column kr_pages.post_solicitado_en is
  'Cuando HAY UN INTENTO DE PUBLICACIÓN EN CURSO sin confirmar todavía. Un pedido nuevo la pisa '
  '(reintento, mismo criterio que respuesta_solicitada_en en resenas_google/0025); un intento que '
  'FALLA la vuelve a NULL (marcar_post_fallido, 0031) -- por eso "solicitada" siempre significa "en '
  'curso ahora mismo", nunca "se intentó alguna vez y no se sabe cómo terminó". Ver post_error_en.';
comment on column kr_pages.post_publicado_en is
  'Cuando el BlogPublisher CONFIRMÓ la publicación externa. NULL = no publicado (nunca pedido, en '
  'curso, o el último intento falló).';
comment on column kr_pages.post_url_externa is
  'La URL del post publicado, tal como la devolvió el BlogPublisher. NULL hasta la confirmación.';
comment on column kr_pages.post_error_en is
  'Cuando el ÚLTIMO intento de publicación falló (excepción del publisher, `publicado: false`, o '
  'credenciales del blog incompletas). Se limpia al pedir de nuevo (solicitarPublicacionPost) o al '
  'confirmarse la publicación. Codex, ronda 1 sobre el plan, hallazgo Major: sin esta columna, un '
  'intento fallido dejaba post_solicitado_en atascado para siempre -- indistinguible de "publicando '
  'ahora mismo" y sin forma de reintentar ni editar.';

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
  'Etiqueta LIBRE de la plataforma del blog externo del cliente (''wordpress'', ''wix'', ''otro'' -- '
  'texto informativo, no un enum: hoy la publicación real es manual, copiando el post con el botón '
  'de la Task 11, así que este campo no gobierna ninguna lógica). NULL = no configurado.';
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
grant update (post_publicado_en, post_url_externa, post_solicitado_en, post_error_en) on kr_pages to app_posts;

-- RLS sigue en pie: un grant de columna es necesario pero no suficiente (mismo comentario que deja
-- la 0022 sobre esto). `using (true)` es seguro por el mismo motivo que ahí: app_posts no tiene
-- login, nada puede asumirlo, y es inalcanzable salvo llamando a las tres funciones de abajo -- cuyo
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
    and p.post_cuerpo is not null
    -- Codex, ronda 1 sobre el plan, hallazgo Major: sin este filtro, un cliente sin blog configurado
    -- (columnas nullable, ver arriba) hacía que el orquestador recibiera tipo/url/credencial en
    -- null y reventara adentro de BlogPublisher.publicar (ej. `null.replace(...)`). Acá se decide
    -- que credenciales incompletas es EXACTAMENTE el mismo caso que "la solicitud ya no aplica":
    -- cero filas, publicarPost lo trata como tal (y limpia post_solicitado_en vía
    -- marcar_post_fallido -- ver Task 7).
    and c.blog_externo_tipo is not null
    and c.blog_externo_url is not null
    and c.blog_externo_credencial is not null;
$$;

comment on function app.post_para_publicar(uuid) is
  'Lo que el orquestador necesita para publicar UNA página, incluida la credencial del blog. Cero '
  'filas = la solicitud ya no aplica (publicada, sin post, credenciales incompletas, o inexistente) '
  '-- el evento que dispara esto no porta autoridad (ADR-18), esta consulta es la que decide. '
  'security definer, propiedad de app_posts -- app_service solo puede EJECUTARLA, nunca leer '
  'blog_externo_credencial por SQL directo.';

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
    set post_publicado_en = now(), post_url_externa = p_url_externa, post_error_en = null
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
-- Función 3: cerrar un intento FALLIDO (Codex, ronda 1 sobre el plan, hallazgo Major). Deja la fila
-- lista para reintentar (post_solicitado_en vuelve a NULL, así que editarPost/solicitarPublicacionPost
-- dejan de estar bloqueados) y con un rastro de que el último intento no salió (post_error_en).
-- Idempotente por el mismo WHERE que las otras dos: llamarla sobre una fila que ya no está "en
-- curso" (porque otra corrida ya la publicó, o ya se limpió) no hace nada -- false, sin lanzar.
-- -----------------------------------------------------------------------------
create or replace function app.marcar_post_fallido(p_page_id uuid)
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
    set post_solicitado_en = null, post_error_en = now()
    where id = p_page_id
      and post_solicitado_en is not null
      and post_publicado_en is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.marcar_post_fallido(uuid) is
  'Cierra un intento de publicación que falló (excepción, publicado:false, o credenciales '
  'incompletas -- ver post_para_publicar). Limpia post_solicitado_en (desbloquea edición y permite '
  'reintentar) y marca post_error_en (rastro para el portal). security definer, propiedad de '
  'app_posts. Llamado por publicarPost (Task 7) en TODOS los caminos de fallo, incluido el best-effort '
  'cuando post_para_publicar devuelve cero filas -- ver el comentario de esa función más arriba.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, mismo patrón que 0022/0024/0025: dos permisos temporales, revocados al final.
-- -----------------------------------------------------------------------------
grant app_posts to current_user;
grant create on schema app to app_posts;

alter function app.post_para_publicar(uuid) owner to app_posts;
alter function app.marcar_post_publicado(uuid, text) owner to app_posts;
alter function app.marcar_post_fallido(uuid) owner to app_posts;

revoke execute on function app.post_para_publicar(uuid) from public;
revoke execute on function app.marcar_post_publicado(uuid, text) from public;
revoke execute on function app.marcar_post_fallido(uuid) from public;
grant execute on function app.post_para_publicar(uuid) to app_service;
grant execute on function app.marcar_post_publicado(uuid, text) to app_service;
grant execute on function app.marcar_post_fallido(uuid) to app_service;

revoke create on schema app from app_posts;
revoke app_posts from current_user;
