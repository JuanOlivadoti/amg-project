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

-- `servicio` = identidad de los jobs del backend (el orquestador). Necesita escribir los
-- resultados del research, pero NO es una persona: se separa para no tener que darle privilegios de
-- 'maestro' a un proceso automático.
create type user_role as enum ('maestro', 'equipo', 'cliente', 'servicio');

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,
  rol         user_role not null,
  -- Si rol = 'cliente', queda atado a UN cliente y no puede ver los demás del tenant.
  client_id   uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id),

  -- El rol 'cliente' EXIGE un cliente; los demás no deben tener uno. Sin esta constraint, un
  -- 'cliente' sin client_id quedaba en un limbo (y con la política vieja, veía toda la cartera).
  constraint cliente_exige_client_id check (
    (rol = 'cliente' and client_id is not null) or (rol <> 'cliente' and client_id is null)
  )
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

-- La membresía no puede apuntar a un cliente de OTRO tenant. Misma familia que la FK compuesta de
-- kr_runs: RLS controla qué filas ves, no la integridad de las referencias entre tablas.
alter table memberships
  add constraint memberships_client_del_mismo_tenant
  foreign key (client_id, tenant_id) references clients (id, tenant_id) on delete cascade;

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
  -- El `location_code` es LA dimensión que define qué mercado se pagó (entra en la clave de cache
  -- de DataForSEO). Sin él, el run no es reproducible y el brief no cumple el contrato del M1.
  market_location_code int not null,

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

  -- Habilitan las FK compuestas de kr_keywords / kr_pages. La segunda incluye `client_id` para que
  -- los hijos puedan denormalizarlo SIN poder mentir: el trío tiene que existir tal cual en el run.
  unique (id, tenant_id),
  unique (id, tenant_id, client_id)
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
  -- Denormalizado desde el run. Lo necesita la política RLS: el aislamiento NO se hereda del padre,
  -- y sin esto un usuario con rol 'cliente' podía leer las keywords de TODOS los negocios del
  -- tenant. La FK compuesta de abajo impide que este valor mienta.
  client_id          uuid not null,

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
  -- El trío (run, tenant, cliente) tiene que existir TAL CUAL en kr_runs: ni la keyword cuelga de
  -- un run ajeno, ni el client_id denormalizado puede apuntar a otro cliente del que dice el run.
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade
);

create index on kr_keywords (tenant_id, run_id);
create index on kr_keywords (tenant_id, client_id);

create table kr_pages (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  run_id             uuid not null references kr_runs(id) on delete cascade,
  -- Igual que en kr_keywords: la política RLS lo necesita porque el aislamiento no se hereda.
  client_id          uuid not null,

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
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade
);

create index on kr_pages (tenant_id, run_id);
create index on kr_pages (tenant_id, client_id);

-- -----------------------------------------------------------------------------
-- Caches de proveedor (ADR-10: split, claves completas, expires_at, RLS deny-all)
--
-- NO llevan tenant_id A PROPÓSITO: el volumen de búsqueda de "pizza napolitana madrid" es un dato
-- del MERCADO, no de un cliente. Compartirlo entre tenants es correcto y es lo que hace que la
-- segunda corrida de una keyword ya buscada salga gratis.
--
-- Pero justamente por no tener tenant_id, no pueden quedar expuestos a la política de tenant: para
-- `app_user` y `app_service` van con RLS DENY-ALL. Las toca UN login dedicado, `amg_cache`, con su
-- propio grant + política (ver 0003_credenciales.sql). NADIE usa BYPASSRLS. Ningún usuario final
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

-- Rol de aplicación: es el que usan las peticiones de usuario. Las caches NO las toca este rol ni
-- una service-role con bypassrls (no se usa bypassrls en ningún lado): las toca el login `amg_cache`,
-- con grant + política propios (0003_credenciales.sql).
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

/*
 * ============================ FALLAR CERRADO ============================
 *
 * La versión anterior de estas políticas usaba:
 *
 *     app.current_role() is distinct from 'cliente'   -- ❌ FALLA ABIERTO
 *
 * Con el rol ausente, `current_role()` es NULL, y `NULL IS DISTINCT FROM 'cliente'` es **TRUE**.
 * O sea: un tenant_id válido con el rol vacío o inválido obtenía visibilidad de MAESTRO sobre toda
 * la cartera de la agencia. La política concedía privilegios ante la duda.
 *
 * Ahora se usa una ALLOWLIST POSITIVA: hay que ser explícitamente uno de los roles conocidos.
 * Cualquier NULL o valor desconocido da FALSE y no ve nada.
 *
 * ⚠️ El rol y el client_id siguen viniendo del contexto que pone la aplicación. Eso es aceptable
 * mientras el único caller sea backend de confianza, pero NO es una autoridad: la fuente de verdad
 * debe ser `memberships`. Al integrar Supabase Auth hay que derivarlos de `auth.uid()` + membresía
 * real dentro de las funciones de `app`, sin tocar ni una política. Ver OBS-02 en los ADR.
 */

/** ¿Es staff de la agencia (ve toda la cartera del tenant)? Un rol desconocido NO lo es. */
create or replace function app.es_staff() returns boolean
language sql stable as $$
  select app.current_role() in ('maestro', 'equipo', 'servicio')
$$;

/** ¿Puede escribir? El rol `cliente` (dueño del negocio en el portal) es SOLO LECTURA. */
create or replace function app.puede_escribir() returns boolean
language sql stable as $$
  select app.current_role() in ('maestro', 'equipo', 'servicio')
$$;

/**
 * ¿Este `client_id` es visible para quien pregunta?
 * - staff  → cualquier cliente de su tenant.
 * - cliente → SOLO el suyo (y tiene que tener uno: sin client_id no ve nada).
 */
create or replace function app.ve_cliente(cid uuid) returns boolean
language sql stable as $$
  select case
    when app.es_staff() then true
    when app.current_role() = 'cliente'
      then app.current_client_id() is not null and cid = app.current_client_id()
    else false   -- rol NULL o desconocido: no ve nada
  end
$$;

-- --- Grants: NO todos los roles pueden todo -----------------------------------
--
-- Antes había `grant select, insert, update, delete` sobre TODO para `app_user`, incluida
-- `memberships`: un usuario con rol 'cliente' podía insertarse una membresía de 'maestro' y
-- escalar privilegios. Los grants son la primera línea; las políticas, la segunda.
grant select on tenants, memberships to app_user;
grant select, insert, update, delete on clients, kr_runs, kr_keywords, kr_pages to app_user;

-- El tenant solo se ve a sí mismo. Nadie lo modifica desde la app.
create policy tenant_select on tenants
  for select using (id = app.current_tenant_id());

-- Membresías: se LEEN (para resolver permisos), no se escriben desde la app. Crear membresías y
-- cambiar roles va por el backend con service-role: es una operación de administración, no de uso.
create policy membership_select on memberships
  for select using (tenant_id = app.current_tenant_id());

/*
 * Clientes: aislamiento por tenant + visibilidad por rol.
 * Escribir (alta/baja de clientes) es cosa de staff: el dueño de un restaurante no da de alta
 * clientes en la agencia.
 */
create policy client_select on clients
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(id));

create policy client_write on clients
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir());

/*
 * Runs. El `with check` exige TAMBIÉN que el client_id sea visible: sin eso, un usuario podía
 * crear runs FACTURABLES a nombre de otro cliente del mismo tenant.
 */
create policy run_select on kr_runs
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy run_write on kr_runs
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id));

/*
 * Keywords y páginas: EL AISLAMIENTO NO SE HEREDA.
 *
 * Antes solo comprobaban `tenant_id`. Como `kr_runs` sí filtraba por cliente pero los hijos no, un
 * usuario con rol 'cliente' podía hacer `select * from kr_keywords` y ver el research, la
 * estrategia, los claims y el contenido de TODOS los negocios de la agencia. RLS es POR TABLA: la
 * política del padre no protege al hijo.
 *
 * Se denormaliza `client_id` en los hijos (con FK compuesta que lo ata al run) en vez de un EXISTS
 * contra kr_runs: la política queda igual de estricta, se lee mejor y no cuesta una subconsulta por
 * fila.
 */
create policy keyword_select on kr_keywords
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy keyword_write on kr_keywords
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id));

create policy page_select on kr_pages
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy page_write on kr_pages
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id));

-- --- Caches y tareas del proveedor: DENY-ALL para app_user/app_service -------
-- RLS habilitado SIN NINGUNA POLÍTICA acá = ni app_user ni app_service pasan. El acceso lo da un
-- login dedicado, `amg_cache`, con grant + política explícitos en 0003_credenciales.sql (no bypassrls).
-- No se otorga ningún grant a app_user: defensa en profundidad (grant + RLS).
alter table kr_metrics_cache  enable row level security;
alter table kr_metrics_cache  force  row level security;
alter table kr_serp_cache     enable row level security;
alter table kr_serp_cache     force  row level security;
alter table kr_provider_tasks enable row level security;
alter table kr_provider_tasks force  row level security;
