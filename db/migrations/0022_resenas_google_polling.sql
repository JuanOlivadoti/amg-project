-- =============================================================================
-- AMG OS — 0022: `app_resenas`, el rol cross-tenant del polling de reseñas
--
-- Segunda `security definer` del proyecto (la primera fue `app_barrido`, 0018). Mismo motivo
-- exacto: el polling tiene que leer el refresh token y el location_id de TODOS los clientes
-- conectados de TODOS los tenants, y ninguna sesión con identidad puede hacer eso bajo RLS. Y
-- tiene que insertar reseñas bajo el tenant_id de cada cliente, uno por uno, en la misma corrida.
--
-- Confinar el privilegio a DOS funciones cuyo cuerpo entero es "listar conectados" y "insertar una
-- reseña bajo el tenant que se le pasa" concede algo que no puede filtrar nada más (ninguna de las
-- dos toca `kr_runs`, `ideas`, ni ninguna otra tabla) y no puede hacer otra cosa (los cuerpos son
-- fijos).
--
-- `set search_path = pg_catalog, public` en las dos, por el mismo motivo que 0018: sin eso, una
-- `security definer` es una escalada clásica si alguien puede anteponer un schema propio.
--
-- El dueño de las funciones NO puede ser quien corre la migración -- ver el comentario largo de
-- 0018 para el porqué completo (RLS forzada + `postgres` no-superusuario en Supabase alojado).
-- Esta migración repite la misma secuencia de grants temporales, en el mismo orden.
--
-- Spec: docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_resenas') then
    create role app_resenas nologin;
  end if;
end $$;

grant usage on schema public, app to app_resenas;

-- Lectura cross-tenant: SOLO lo que el polling necesita para pedirle reseñas a Google. Ni
-- business_profile, ni storyblok_*, ni ninguna otra columna de `clients`.
--
-- `archived_at` está acá aunque la función nunca la DEVUELVE, porque SÍ la lee: el `where
-- ... and archived_at is null` de `app.clientes_conectados_google()` la referencia en el propio
-- `select`, y eso exige privilegio de columna igual que devolverla -- a diferencia de una política
-- de RLS (donde `has_column_privilege` no aplica, ver el comentario de la 0018 sobre `memberships`),
-- un `where` normal SÍ lo exige. Medido con PGlite: sin esta columna en el grant,
-- `clientes_conectados_google()` falla con "permission denied for table clients" -- el primer intento
-- de esta migración la omitió y un test lo cazó.
grant select (id, tenant_id, google_location_id, google_refresh_token, archived_at) on clients to app_resenas;

-- Escritura cross-tenant: solo insertar reseñas. Nada de update/delete -- el polling nunca
-- modifica una reseña existente, solo agrega las que todavía no vio.
grant insert on resenas_google to app_resenas;

-- Lectura de `resenas_google`, y NO es de más: `on conflict (client_id, google_review_id) do
-- nothing` (dentro de `app.registrar_resena_google`, más abajo) necesita comprobar si YA hay una
-- fila que choque con el índice único, y esa comprobación exige privilegio de SELECT sobre la
-- tabla -- documentado por Postgres, medido acá porque sin este grant el INSERT entero fallaba con
-- "permission denied for table resenas_google" (aclcheck_error), un error que no menciona ON
-- CONFLICT para nada y que el primer intento de esta migración confundió con un problema del INSERT.
grant select on resenas_google to app_resenas;

-- Mismo motivo que la política `run_barrido_ve` de 0018: las políticas de `clients` (0001) no
-- llevan `to`, así que aplican a PUBLIC también para `app_resenas` -- y evaluarlas exige poder
-- leer `memberships`, o la sentencia entera aborta con "permission denied for table memberships".
grant select on memberships to app_resenas;

-- -----------------------------------------------------------------------------
-- Las políticas que el brief original no traía, y sin las cuales los dos grants de arriba no
-- alcanzan para VER ninguna fila (RLS sigue en pie: un grant de columna/tabla es necesario pero
-- no suficiente). Medido con PGlite: sin esto, las dos funciones compilan y ejecutan sin error, pero
-- devuelven SIEMPRE cero filas -- exactamente el modo de fallo silencioso que la 0018 advierte
-- ("daría verde en los tests y cero filas en producción"), salvo que acá pasaría en los DOS lados
-- por igual, porque `app_resenas` nunca tiene contexto de tenant (no hay `set_config('app.tenant_id',
-- ...)` en `sinTenant`, a propósito: no hay ningún tenant que sea "el" contexto de un cruce).
--
-- `client_select` (0001) no lleva `to`, así que en teoría alcanza a `app_resenas` -- pero exige
-- `tenant_id = app.current_tenant_id()`, que sin contexto es siempre NULL. Hace falta una política
-- PROPIA, cross-tenant, igual que `run_barrido_ve` le dio a `app_barrido` visibilidad sobre
-- `kr_runs` que las políticas genéricas de 0001 no le daban.
--
-- `using (true)` es seguro acá por el mismo motivo que lo es en 0018: `app_resenas` no tiene login,
-- ningún login puede asumirlo (hay un test que lo exige), y es inalcanzable salvo llamando a estas
-- dos funciones -- cuyo cuerpo entero ya está fijado más abajo. La política no es la superficie de
-- ataque; el cuerpo de la función lo es, y ESE es fijo.
-- -----------------------------------------------------------------------------
create policy client_ve_app_resenas on clients
  for select to app_resenas
  using (true);

create policy resena_ve_app_resenas on resenas_google
  for select to app_resenas
  using (true);

create policy resena_insertar_app_resenas on resenas_google
  for insert to app_resenas
  with check (true);

-- =============================================================================
-- El hallazgo de la Task 1 (ver `.superpowers/sdd/task-1-report.md`, "Qué queda afuera para la
-- 0022"), cerrado acá: `app_service` (el orquestador) TAMBIÉN tiene SELECT de tabla sobre
-- `clients`, desde `0002_auth.sql:93`
-- (`grant select, insert, update, delete on clients, kr_runs, kr_keywords, kr_pages to
-- app_service;`). Un grant de tabla es un privilegio atómico sobre TODAS las columnas, incluidas
-- las que una `alter table` agregue después (medido en la 0021, mismo mecanismo exacto para
-- `app_user`) -- así que, sin tocar nada, `app_service` puede leer `google_refresh_token`
-- directamente por SQL, bypaseando por completo la función `security definer` que esta migración
-- introduce como supuesto único camino de lectura del token.
--
-- ## Qué columnas necesita `app_service` de verdad -- investigado, no asumido
--
-- Se buscó cada lugar de `orchestrator/src/` (`deps.ts`, `workflow.ts`) que llama a un método de
-- `PgStore`/`PgClientes` que termine tocando `clients`, y cada `select ... from clients` de
-- `db/src/store.ts`/`clientes.ts`. El resultado:
--
--  · `PgClientes` (la capa del CRM, con la lista ancha de columnas) SOLO se instancia en `api/`
--    (`api/src/deps.ts:172`, con rol `app_user` explícito) -- el orquestador nunca la usa.
--  · `db/src/store.ts` tiene UN SOLO `select ... from clients`: `PgStore.getClient()`
--    (`db/src/store.ts:1194-1202`), que trae `id, nombre, storyblok_space_id, business_profile` --
--    exactamente las cuatro columnas de `ClientRow` (`db/src/store.ts:191-198`). La llama tanto la
--    API (`api/src/app.ts:181`, rol `app_user`) como el orquestador
--    (`orchestrator/src/workflow.ts:321`, rol `app_service`).
--  · Ningún otro método que el orquestador llame (`getRun`, `saveKeywords`, `savePages`,
--    `guardarInforme`, `finishRun`, `getPublishablePages`, `marcarPublicadas`) toca `clients`.
--  · El único `insert into clients` que aparece en el árbol de `orchestrator/` es en
--    `workflow.test.ts:334`, y es un `pg.query` directo del SEED del test (conexión de
--    superusuario, sin pasar por el rol `app_service`) -- no es código de producción.
--
-- O sea que, a diferencia de `app_user` (que la 0021 dejó con 26 de las 27 columnas, porque el
-- CRM entero -- muchas pantallas, muchos campos -- corre con ese rol), `app_service` tiene EXACTAMENTE
-- un camino de lectura de producción y es angosto. Se le da la lista mínima que ese camino usa, no
-- "todo menos el token": es la aplicación directa del mismo principio que confina las dos funciones
-- `security definer` de más abajo -- conceder lo que el uso real necesita, nada que "por si acaso"
-- amplíe lo que se lleva un proceso comprometido. Si el orquestador necesita leer otra columna en el
-- futuro, esa necesidad nueva pasa por una migración nueva, no por un grant de tabla que ya cubría
-- de más.
--
-- La lista completa de columnas de `clients` (27, tras la 0021) se confirmó contra
-- `information_schema.columns` con 0001..0021 aplicadas -- no de memoria -- y sirvió para verificar
-- que las cuatro que sigue no son un subconjunto inventado, sino las únicas que `getClient()` pide.
--
-- `insert`/`update`/`delete` de `app_service` sobre `clients` NO se tocan: son privilegios
-- independientes del `select` (mismo hecho que usó la 0021), y ningún código de producción del
-- orquestador escribe en `clients` hoy -- angostarlos sin evidencia de uso sería una decisión de
-- diseño que esta migración no tiene que tomar.
-- =============================================================================
revoke select on clients from app_service;
grant select (id, nombre, storyblok_space_id, business_profile) on clients to app_service;

-- -----------------------------------------------------------------------------
-- Función 1: listar los clientes conectados, de TODOS los tenants.
-- -----------------------------------------------------------------------------
create or replace function app.clientes_conectados_google()
returns table (client_id uuid, tenant_id uuid, location_id text, refresh_token text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select id, tenant_id, google_location_id, google_refresh_token
  from clients
  where google_refresh_token is not null
    and archived_at is null;
$$;

comment on function app.clientes_conectados_google() is
  'Lista, cruzando TODOS los tenants, los clientes con Google conectado. Solo devuelve lo que el '
  'polling necesita para pedir reseñas -- ni business_profile ni ningún otro dato. security '
  'definer y propiedad de app_resenas (no del dueño de la tabla, sujeto a FORCE RLS en producción).';

-- -----------------------------------------------------------------------------
-- Función 2: registrar una reseña, bajo el tenant_id que el LLAMADOR ya conoce (no el que decida
-- el motor). `on conflict do nothing` es la idempotencia: el unique (client_id, google_review_id)
-- de la 0021 es lo que hace que un segundo polling con la misma reseña no falle ni duplique.
-- -----------------------------------------------------------------------------
create or replace function app.registrar_resena_google(
  p_client_id uuid, p_tenant_id uuid, p_google_review_id text,
  p_puntuacion smallint, p_autor text, p_texto text, p_publicada_en timestamptz
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  insertadas int;
begin
  insert into resenas_google
    (tenant_id, client_id, google_review_id, puntuacion, autor, texto, publicada_en)
  values
    (p_tenant_id, p_client_id, p_google_review_id, p_puntuacion, p_autor, p_texto, p_publicada_en)
  on conflict (client_id, google_review_id) do nothing;

  get diagnostics insertadas = row_count;
  return insertadas > 0;
end;
$$;

comment on function app.registrar_resena_google is
  'Inserta una reseña bajo el tenant/cliente que el llamador ya trae (del propio '
  'clientes_conectados_google). Idempotente vía el unique (client_id, google_review_id) de la 0021: '
  'devuelve false si ya existía, sin error. security definer, propiedad de app_resenas.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, idéntico a 0018: dos permisos temporales, revocados al final, en ese orden.
-- -----------------------------------------------------------------------------
grant app_resenas to current_user;
grant create on schema app to app_resenas;

alter function app.clientes_conectados_google() owner to app_resenas;
alter function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  owner to app_resenas;

-- EXECUTE es de PUBLIC por defecto (mismo default que documenta la 0018): sin este revoke,
-- app_user podría llamar a las dos funciones nuevas.
revoke execute on function app.clientes_conectados_google() from public;
revoke execute on function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  from public;
grant execute on function app.clientes_conectados_google() to app_service;
grant execute on function app.registrar_resena_google(uuid, uuid, text, smallint, text, text, timestamptz)
  to app_service;

revoke create on schema app from app_resenas;
revoke app_resenas from current_user;
