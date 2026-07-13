-- =============================================================================
-- AMG OS — Esquema inicial (Fase 2)
--
-- Implementa ADR-01 (Supabase/Postgres + RLS) y ADR-10 (endurecimiento del esquema):
--   · tenant_id + política RLS de aislamiento en TODAS las tablas de tenant
--   · cache SPLIT (métricas / SERP) con claves completas y expires_at, RLS deny-all
--   · idempotencia real de tareas del proveedor (payload_hash)
--   · 1 run = 1 market; project_run_id para agrupar corridas multi-market a futuro
--
-- El aislamiento entre tenants es LA garantía que se le vende al cliente. Por eso ADR-10 exige
-- tests de RLS ANTES de la Fase 1: una política que no se testea es una política que no existe.
-- =============================================================================

-- `gen_random_uuid()` es NATIVO desde Postgres 13 — no hace falta la extensión pgcrypto.

-- -----------------------------------------------------------------------------
-- Contexto de la petición
--
-- Las políticas NO leen la variable de sesión directamente: pasan por estas funciones. Así hay UN
-- solo lugar donde cambia el origen del tenant. En Supabase se redefine el cuerpo para leerlo del
-- JWT (auth.jwt()) sin tocar ni una política.
-- -----------------------------------------------------------------------------
create schema if not exists app;

/*
 * Tenant de la petición actual. NULL si no se seteó.
 *
 * El `nullif(..., '')` NO es cosmético: una variable de sesión ausente devuelve '' (string vacío),
 * no NULL, y `''::uuid` LANZA UN ERROR de Postgres. Sin el nullif, una petición sin tenant no
 * devuelve "cero filas": revienta la query. Con él, `current_tenant_id()` da NULL, la comparación
 * de la política da NULL y no se ve NADA. Falla CERRADO, que es la única forma aceptable de fallar
 * en un control de acceso.
 */
create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

/** Rol del usuario en el tenant: 'maestro' | 'equipo' | 'cliente' (RBAC del PRD). */
create or replace function app.current_role() returns text
language sql stable as $$
  select nullif(current_setting('app.role', true), '')
$$;

/** Cliente al que está atado el usuario, si su rol es 'cliente'. NULL para maestro/equipo. */
create or replace function app.current_client_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.client_id', true), '')::uuid
$$;

-- -----------------------------------------------------------------------------
-- Tenants y membresías (RBAC)
-- -----------------------------------------------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create type user_role as enum ('maestro', 'equipo', 'cliente');

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,
  rol         user_role not null,
  -- Si rol = 'cliente', queda atado a UN cliente y no puede ver los demás del tenant.
  client_id   uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Clientes (los negocios de la agencia)
-- -----------------------------------------------------------------------------
create table clients (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  nombre              text not null,
  prompt_negocio      text,
  market_country      text not null default 'ES',
  market_language     text not null default 'es',
  -- ADR-04: un space de Storyblok POR CLIENTE, para un offboarding limpio (ADR-11).
  storyblok_space_id  text,
  created_at          timestamptz not null default now(),
  archived_at         timestamptz,

  -- Redundante como clave (id ya es PK), pero habilita la FK COMPUESTA de abajo. Es el mecanismo
  -- que impide que una fila de un tenant referencie datos de otro. Ver kr_runs.
  unique (id, tenant_id)
);

create index on clients (tenant_id);

-- -----------------------------------------------------------------------------
-- Módulo 2 — Keyword Research
-- -----------------------------------------------------------------------------
create type run_status as enum ('running', 'pending_approval', 'approved', 'rejected', 'failed');

create table kr_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  -- ADR-10: 1 run = 1 market. `project_run_id` agrupa corridas hermanas (multi-market a futuro).
  project_run_id    uuid not null default gen_random_uuid(),
  schema_version    text not null,
  status            run_status not null default 'running',
  prompt            text not null,
  market_country    text not null,
  market_language   text not null,

  -- Costo en MICROS de USD (ADR-10: nunca coma flotante para dinero).
  coste_micros_usd  bigint not null default 0,
  coste_breakdown   jsonb  not null default '{}'::jsonb,
  -- Modelos usados sin tarifa → el total está INCOMPLETO. No se inventa el costo.
  modelos_sin_precio text[] not null default '{}',

  -- kr.v0.5: cobertura real de los datos. Un fallo del proveedor deja de ser invisible.
  calidad_datos     jsonb  not null default '{}'::jsonb,

  -- Config del run: sin esto el resultado no es reproducible ni comparable.
  config            jsonb  not null default '{}'::jsonb,

  error             text,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,

  /*
   * FK COMPUESTA — cierra un agujero que RLS NO cubre.
   *
   * La política de `kr_runs` solo comprueba `tenant_id = mi tenant`. Nada le impedía a un tenant
   * crear un run marcado como SUYO pero apuntando al `client_id` de OTRO tenant: la fila pasa el
   * `with check` (el tenant_id es correcto) y queda referenciando datos ajenos.
   *
   * RLS controla QUIÉN VE QUÉ FILA; no controla la integridad de las referencias entre tablas. Para
   * eso hace falta que la FK incluya el tenant: así el par (client_id, tenant_id) tiene que existir
   * tal cual en `clients`, y un cliente de otro tenant no matchea.
   *
   * Lo encontró un test ("crear un run para un cliente de OTRO tenant falla") que esperaba un
   * rechazo y no lo obtuvo.
   */
  foreign key (client_id, tenant_id) references clients (id, tenant_id) on delete cascade,

  -- Habilita la misma FK compuesta desde kr_keywords / kr_pages.
  unique (id, tenant_id)
);

create index on kr_runs (tenant_id, client_id, created_at desc);
create index on kr_runs (project_run_id);

/*
 * Keywords enriquecidas del run.
 *
 * Se persisten TODAS, no solo las que llegaron a página: son los datos por los que se le pagó a
 * DataForSEO. Tirarlas obliga a pagar otra corrida para cualquier ajuste de scoring o clustering.
 */
create table kr_keywords (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  run_id             uuid not null references kr_runs(id) on delete cascade,

  keyword            text not null,
  -- Clave canónica (NFC + trim + espacios + minúsculas). Es por la que se deduplica y se matchea
  -- contra el proveedor; sin ella las métricas se pierden en silencio por diferencias de casing.
  canonical_key      text not null,
  source             text not null,

  -- NULL = el proveedor NO devolvió el dato. Distinto de 0. Ver kr.v0.4.
  volume             integer,
  difficulty         smallint,
  cpc                numeric(10, 4),
  competition        numeric(5, 4),

  intent             text,
  is_local           boolean not null default false,
  business_relevance numeric(4, 3),
  opportunity_score  numeric(5, 2),
  score_confidence   numeric(4, 3),

  discarded          boolean not null default false,
  discard_reason     text,

  unique (run_id, canonical_key),
  -- Misma razón que en kr_runs: una keyword no puede colgar de un run de otro tenant.
  foreign key (run_id, tenant_id) references kr_runs (id, tenant_id) on delete cascade
);

create index on kr_keywords (tenant_id, run_id);

create table kr_pages (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  run_id             uuid not null references kr_runs(id) on delete cascade,

  cluster_id         uuid not null,
  tipo               text not null,
  url_slug           text not null,
  keyword_principal  text not null,
  keywords_secundarias text[] not null default '{}',
  intencion          text not null,
  local              boolean not null default false,

  volumen            integer,   -- NULL = sin dato (≠ 0)
  dificultad         smallint,  -- NULL = sin dato (≠ 0)
  -- kr.v0.5: 'datos_mercado' | 'sin_validar'. Una página sin evidencia NO se presenta como
  -- oportunidad SEO validada, aunque pueda ser una página legítima.
  evidencia          text not null,
  opportunity_score  numeric(5, 2) not null default 0,
  score_confidence   numeric(4, 3) not null default 0,

  seo                jsonb not null default '{}'::jsonb,
  content_brief      jsonb not null default '{}'::jsonb,
  preguntas_frecuentes text[] not null default '{}',

  -- Compuerta de aprobación humana (ADR-06). Nace en false SIEMPRE.
  approved           boolean not null default false,
  approved_by        uuid,
  approved_at        timestamptz,

  -- Publicación (Módulo 1).
  storyblok_story_id text,
  published_at       timestamptz,

  unique (run_id, url_slug),
  -- Misma razón que en kr_runs: una página no puede colgar de un run de otro tenant.
  foreign key (run_id, tenant_id) references kr_runs (id, tenant_id) on delete cascade
);

create index on kr_pages (tenant_id, run_id);

-- -----------------------------------------------------------------------------
-- Caches de proveedor (ADR-10: split, claves completas, expires_at, RLS deny-all)
--
-- NO llevan tenant_id A PROPÓSITO: el volumen de búsqueda de "pizza napolitana madrid" es un dato
-- del MERCADO, no de un cliente. Compartirlo entre tenants es correcto y es lo que hace que la
-- segunda corrida de una keyword ya buscada salga gratis.
--
-- Pero justamente por no tener tenant_id, no pueden quedar expuestos a la política de tenant: van
-- con RLS DENY-ALL y solo se acceden con la service-role (que salta RLS). Ningún usuario final
-- llega nunca a estas tablas.
-- -----------------------------------------------------------------------------
create table kr_metrics_cache (
  cache_key    text primary key,
  endpoint     text not null,
  canonical_key text not null,
  location_code integer not null,
  language_code text not null,
  payload      jsonb not null,
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index on kr_metrics_cache (expires_at);

create table kr_serp_cache (
  cache_key     text primary key,
  canonical_key text not null,
  engine        text not null,
  device        text not null,
  serp_type     text not null,
  depth         integer not null,
  location_code integer not null,
  language_code text not null,
  payload       jsonb not null,
  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index on kr_serp_cache (expires_at);

/*
 * Idempotencia REAL de las tareas del proveedor (ADR-10).
 *
 * Cada POST a DataForSEO es una task FACTURABLE. Si la respuesta se pierde (timeout, corte de red),
 * no sabemos si el proveedor la ejecutó y la cobró. Esta tabla registra el intento ANTES de
 * lanzarlo, con el hash del payload: al reintentar, si el hash ya está y tiene resultado, se
 * reutiliza en vez de pagar de nuevo.
 *
 * Sin esto, el reintento paga dos veces y el medidor solo ve el segundo cargo: se paga doble y el
 * brief informa la mitad.
 */
create table kr_provider_tasks (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'dataforseo',
  endpoint          text not null,
  payload_hash      text not null,
  provider_task_id  text,
  attempt           integer not null default 1,
  status            text not null default 'pending',
  cost_micros_usd   bigint not null default 0,
  result            jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  unique (provider, endpoint, payload_hash)
);

-- =============================================================================
-- ROW LEVEL SECURITY
--
-- `force row level security` además de `enable`: sin FORCE, el DUEÑO de la tabla salta las
-- políticas. Es exactamente el agujero que ADR-10 marca ("no solo enable").
-- =============================================================================

-- Rol de aplicación: es el que usan las peticiones de usuario. La service-role de Supabase
-- (bypassrls) es la única que puede tocar las caches.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant usage on schema public, app to app_user;
grant execute on all functions in schema app to app_user;

-- --- Tablas de tenant: aislamiento por tenant_id -----------------------------
alter table tenants          enable row level security;
alter table tenants          force  row level security;
alter table memberships      enable row level security;
alter table memberships      force  row level security;
alter table clients          enable row level security;
alter table clients          force  row level security;
alter table kr_runs          enable row level security;
alter table kr_runs          force  row level security;
alter table kr_keywords      enable row level security;
alter table kr_keywords      force  row level security;
alter table kr_pages         enable row level security;
alter table kr_pages         force  row level security;

grant select, insert, update, delete on tenants, memberships, clients, kr_runs, kr_keywords, kr_pages to app_user;

-- El tenant solo se ve a sí mismo.
create policy tenant_isolation on tenants
  using (id = app.current_tenant_id())
  with check (id = app.current_tenant_id());

create policy tenant_isolation on memberships
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

/*
 * Clientes: aislamiento por tenant Y, si el rol es 'cliente', solo SU cliente.
 *
 * El rol 'cliente' es un usuario del negocio final (el dueño del restaurante), que entra al portal
 * y no puede ver la cartera del resto de la agencia. Maestro y equipo ven todos los del tenant.
 *
 * El `with check` es tan importante como el `using`: sin él, un tenant podría INSERTAR filas
 * marcadas con el tenant_id de otro.
 */
create policy tenant_isolation on clients
  using (
    tenant_id = app.current_tenant_id()
    and (app.current_role() is distinct from 'cliente' or id = app.current_client_id())
  )
  with check (tenant_id = app.current_tenant_id());

create policy tenant_isolation on kr_runs
  using (
    tenant_id = app.current_tenant_id()
    and (app.current_role() is distinct from 'cliente' or client_id = app.current_client_id())
  )
  with check (tenant_id = app.current_tenant_id());

create policy tenant_isolation on kr_keywords
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

create policy tenant_isolation on kr_pages
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- --- Caches y tareas del proveedor: DENY-ALL --------------------------------
-- RLS habilitado SIN NINGUNA POLÍTICA = nadie pasa. Solo la service-role (bypassrls) entra.
-- No se otorga ningún grant a app_user: defensa en profundidad (grant + RLS).
alter table kr_metrics_cache  enable row level security;
alter table kr_metrics_cache  force  row level security;
alter table kr_serp_cache     enable row level security;
alter table kr_serp_cache     force  row level security;
alter table kr_provider_tasks enable row level security;
alter table kr_provider_tasks force  row level security;
