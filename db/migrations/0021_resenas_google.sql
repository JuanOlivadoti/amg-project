-- =============================================================================
-- AMG OS — 0021: el módulo de reseñas de Google (Bloque F, fase 1) — SOLO lectura de agencia
--
-- Esta migración cubre la mitad "normal" del módulo: la tabla de reseñas bajo RLS igual que
-- `ideas` (0013), y las tres columnas de conexión en `clients`. La mitad cross-tenant (el rol
-- `app_resenas` y sus dos funciones `security definer` que el polling necesita para leer el
-- refresh token de TODOS los clientes conectados) va en la `0022`, separada a propósito: son dos
-- unidades revisables por separado, mismo motivo que `0018` mantiene el barrido en un solo bloque
-- pero ese bloque es autocontenido — acá el equivalente autocontenido es "la tabla + RLS normal"
-- por un lado y "el cruce de tenants" por otro.
--
-- Spec: docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- La conexión: tres columnas en `clients`, mismo patrón que los tokens de Storyblok (0007).
--
-- `google_refresh_token` es lo único de las tres que es una CREDENCIAL (acceso continuo a la
-- cuenta de Google del cliente) y no un dato de negocio. Por eso el grant de más abajo es
-- asimétrico: app_user puede ESCRIBIRLA (el callback de OAuth corre con su identidad) pero no
-- LEERLA de vuelta. Ver el detalle completo del razonamiento en la 0022, que es donde se concede
-- el único SELECT que existe sobre esa columna.
-- -----------------------------------------------------------------------------
alter table clients
  add column if not exists google_location_id   text,
  add column if not exists google_refresh_token  text,
  add column if not exists google_conectado_en   timestamptz;

comment on column clients.google_location_id is
  'El id de la ficha de Google Business Profile del cliente. NULL = no conectado.';
comment on column clients.google_refresh_token is
  'Credencial OAuth de acceso continuo a la cuenta de Google del cliente. app_user puede escribirla '
  '(el callback de OAuth) pero NUNCA leerla de vuelta -- ver los grants por columna de la 0022. Solo '
  'la lee app_resenas, vía una funcion security definer.';
comment on column clients.google_conectado_en is
  'Cuando se completo el flujo de OAuth. NULL = no conectado. Hoy se limpia (junto a las otras dos) '
  'SOLO via POST /clients/:id/google/desconectar -- el polling (Task 4) todavia no lo hace cuando '
  'detecta un refresh token revocado: cuenta el fallo y lo loguea, nada mas. Ver la lista de fase 2 '
  'en docs/proyecto/15-plan-plataforma.md (Bloque F).';

-- -----------------------------------------------------------------------------
-- La tabla. Mismo esqueleto que `ideas` (0013): tenant_id + client_id con FK compuesta, para que
-- un cliente no pueda apuntar a un tenant ajeno.
-- -----------------------------------------------------------------------------
create table resenas_google (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  client_id         uuid not null,

  -- El id de Google, no el nuestro. Es la clave de idempotencia del polling: sin el unique de más
  -- abajo, correr el polling dos veces con la misma reseña la insertaria dos veces.
  google_review_id  text not null,
  puntuacion        smallint not null check (puntuacion between 1 and 5),
  autor             text not null,
  -- Una reseña de solo estrellas, sin comentario, es real en Google Maps -- por eso nullable.
  texto             text,
  -- La fecha que dice GOOGLE, no la del polling: es la que decide el orden real de aparicion.
  publicada_en      timestamptz not null,
  -- NULL = todavia nadie la vio en el portal. Es lo que separa "alerta pendiente" de "ya la vio
  -- alguien", y es lo unico que este modulo permite escribir fuera de la conexion misma.
  vista_en          timestamptz,

  creada_en         timestamptz not null default now(),

  foreign key (tenant_id, client_id) references clients (tenant_id, id) on delete cascade,
  unique (client_id, google_review_id)
);

comment on table resenas_google is
  'Reseñas de Google Business Profile, una fila por reseña real. Material interno de la agencia -- '
  'ADR-19: cero grants para app_render. El rol cliente puede VERLAS (ADR-20) pero no marcarlas '
  'como vistas ni gestionar la conexion.';

create index resenas_google_client_puntuacion
  on resenas_google (client_id, puntuacion, vista_en);

alter table resenas_google enable row level security;
alter table resenas_google force row level security;

-- -----------------------------------------------------------------------------
-- Grants. `app_user` es el único rol con login que toca esta tabla en esta migración
-- (`app_resenas`, cross-tenant, llega en la 0022).
-- -----------------------------------------------------------------------------
grant select                 on resenas_google to app_user;
grant update (vista_en)      on resenas_google to app_user;

-- -----------------------------------------------------------------------------
-- El refresh token: escribible por app_user (el callback de OAuth), pero SIN select.
--
-- ## Por qué esto NO es un `grant select (...) on clients to app_user` seguido de un
-- `revoke select (google_refresh_token) on clients from app_user`, que es lo que un primer intento
-- de esta migración escribió y un test hizo caer
--
-- `app_user` YA tiene `grant select ... on clients` A NIVEL DE TABLA desde la 0001
-- (`grant select, insert, update, delete on clients, kr_runs, kr_keywords, kr_pages to app_user;`).
-- Un grant de tabla es UN privilegio atómico sobre TODAS sus columnas, incluidas las que una
-- `alter table` agregue después -- no hay forma de que una columna "nazca" fuera de un grant de
-- tabla ya concedido. Y un `revoke select (columna) ... from app_user` NO puede angostar ese
-- privilegio: MEDIDO con PGlite (no supuesto -- ver el informe de la etapa), un rol con SELECT de
-- tabla sigue leyendo cualquier columna después de revocar el select de esa columna en particular,
-- porque `has_column_privilege` da `true` si CUALQUIERA de los dos (el de tabla o el de columna)
-- alcanza. La única forma real de acotar una columna cuando el rol ya tiene SELECT de tabla es
-- quitarle el de tabla entero y re-concederlo por columna, enumerando las que sí puede leer.
--
-- Por eso acá se REVOCA el SELECT de tabla completo (sin tocar insert/update/delete, que siguen
-- intactos: son privilegios independientes) y se vuelve a conceder columna por columna: todas las
-- que `clients` tenía hasta la 0020 -- app_user seguía pudiendo leerlas todas, y sigue -- más
-- `google_location_id` y `google_conectado_en`, MENOS `google_refresh_token`. La lista es la que
-- devuelve `select column_name from information_schema.columns where table_name = 'clients'`
-- corrida contra una base con la 0001..0020 aplicadas (medido, no de memoria).
-- -----------------------------------------------------------------------------
revoke select on clients from app_user;
grant select (
  id, tenant_id, nombre, prompt_negocio, market_country, market_language, storyblok_space_id,
  created_at, archived_at, business_profile, domain, storyblok_public_token, storyblok_preview_token,
  tipo, industria, etiquetas, nivel_actividad, estado_contrato, contrato_vence_en, score, asignado_a,
  contacto, origen, business_profile_publico,
  google_location_id, google_conectado_en
  -- google_refresh_token deliberadamente AFUERA: es la única columna de `clients` que app_user no
  -- puede leer. Ver el comentario de la columna, más arriba, y el test que lo fija.
) on clients to app_user;

grant update (google_location_id, google_refresh_token, google_conectado_en) on clients to app_user;

-- -----------------------------------------------------------------------------
-- Políticas. `to app_user` explícito -- mismo motivo que `idea_select` en la 0013: sin la
-- cláusula `to`, la política aplicaría a PUBLIC y también correría (inútilmente, porque no hay
-- grant de tabla) para `app_resenas`.
--
-- `tenant_id = app.current_tenant_id()` va SIEMPRE junto a `app.ve_cliente(client_id)`, nunca
-- solo. `ve_cliente()` para un rol staff (`maestro`/`equipo`/`servicio`) devuelve `true` para
-- CUALQUIER `client_id` sin mirar de qué tenant es -- lo que aísla por tenant es el rol, resuelto
-- vía `current_tenant_id()`. Sin el `tenant_id = ...` explícito, un `equipo` del tenant A vería
-- TODAS las reseñas de TODOS los tenants: `ve_cliente(cid)` es `true` para cualquier `cid` cuando
-- quien pregunta es staff. Medido con PGlite -- ver el test de aislamiento cross-tenant en
-- `resenas.test.ts`. Mismo patrón que `idea_select`/`idea_update` (0013) y cada política de
-- `0001_init.sql` (`client_select`, `run_select`, `keyword_select`, `page_select`).
-- -----------------------------------------------------------------------------
create policy resena_select on resenas_google
  for select to app_user
  using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

-- Solo marcar como vista, y solo agencia (ADR-20: el rol cliente no escribe). `using` decide qué
-- filas puede tocar (las suyas, agencia), `with check` que la fila resultante siga siendo del
-- mismo tenant/cliente -- no se puede reasignar una reseña a otro cliente por esta vía.
create policy resena_marcar_vista on resenas_google
  for update to app_user
  using      (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir())
  with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir());
