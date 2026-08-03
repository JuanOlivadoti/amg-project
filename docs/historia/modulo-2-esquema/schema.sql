-- Módulo 2 — Keyword Research · Esquema tipo v0.2 (ES-first) — post-review Codex
-- Supabase / Postgres. Requiere pgvector.
-- Cambios v0.2: tenant_id en todas las tablas + policies RLS; cache split y solo
-- service-role; FKs y CHECKs; índice HNSW; idempotencia (kr_provider_tasks);
-- coste en micros; intención sin compuestos + flag local; score_confidence.
-- Sigue siendo v0: se afina tras las pruebas. Diseño market-aware, 1 run = 1 market.

create extension if not exists vector;
create extension if not exists pgcrypto;   -- gen_random_uuid() fuera de Supabase

-- Helper: tenant del JWT (asume claim tenant_id; se ata al RBAC de AMG OS).
create or replace function current_tenant_id() returns uuid
language sql stable as $$ select nullif(auth.jwt() ->> 'tenant_id','')::uuid $$;

-- Corrida de research (1 run = 1 market) ------------------------------
create table kr_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  client_id      uuid,
  project_run_id uuid,                       -- agrupa varias corridas (multi-market futuro)
  schema_version text not null default 'kr.v0.2',
  input_prompt   text not null,
  -- mercado (ES-first, un mercado por corrida). Explícito para no hardcodear idioma.
  country        text not null default 'ES',
  language_code  text not null default 'es',
  location_code  int  not null default 2724,
  options        jsonb not null default '{}',       -- weights, max_pages, max_cost_micros
  status         text not null default 'queued'
                 check (status in ('queued','running','pending_approval','approved','rejected','failed')),
  cost_micros_usd bigint not null default 0,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on kr_runs (tenant_id);

-- Keyword enriquecida -------------------------------------------------
create table kr_keywords (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  run_id             uuid not null references kr_runs(id) on delete cascade,
  keyword            text not null,
  source             text check (source in ('seed','suggestion','related','ideas')),
  volume             int    check (volume >= 0),
  difficulty         numeric check (difficulty between 0 and 100),
  cpc                numeric check (cpc >= 0),
  competition        numeric check (competition between 0 and 1),
  trend              jsonb,
  intent             text check (intent in ('transactional','commercial','local','informational','navigational')),
  is_local           boolean not null default false,   -- modificador local (intención compuesta)
  business_relevance numeric check (business_relevance between 0 and 1),
  opportunity_score  numeric check (opportunity_score between 0 and 100),
  score_confidence   numeric check (score_confidence between 0 and 1),
  embedding          vector(1024),   -- modelo de embeddings MULTILINGÜE (clave para escalar idiomas)
  cluster_id         uuid,           -- FK añadida abajo (referencia circular con kr_clusters)
  discarded          boolean not null default false,
  discard_reason     text
);
create index on kr_keywords (run_id);
create index on kr_keywords (tenant_id);
-- HNSW parcial: mejor recall que ivfflat y no requiere datos previos para construir.
create index on kr_keywords using hnsw (embedding vector_cosine_ops) where embedding is not null;

-- Cluster -------------------------------------------------------------
create table kr_clusters (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  run_id             uuid not null references kr_runs(id) on delete cascade,
  label              text,
  intent             text check (intent in ('transactional','commercial','local','informational','navigational')),
  is_local           boolean not null default false,
  page_type          text check (page_type in ('servicio','landing_local','blog','institucional')),
  page_strategy      text not null default 'single'
                     check (page_strategy in ('single','hub_spoke','merge','backlog')),
  primary_keyword_id uuid references kr_keywords(id),
  aggregate_score    numeric check (aggregate_score between 0 and 100),
  serp_overlap       jsonb
);
create index on kr_clusters (run_id);
create index on kr_clusters (tenant_id);

-- FK de keyword→cluster (tras crear kr_clusters). Garantía de mismo run vía trigger/app.
alter table kr_keywords
  add constraint kr_keywords_cluster_fk
  foreign key (cluster_id) references kr_clusters(id) on delete set null;

-- Página propuesta ----------------------------------------------------
create table kr_pages (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  run_id               uuid not null references kr_runs(id) on delete cascade,
  cluster_id           uuid references kr_clusters(id),
  schema_version       text not null default 'kr.v0.2',
  page_type            text check (page_type in ('servicio','landing_local','blog','institucional')),
  page_strategy        text not null default 'single'
                       check (page_strategy in ('single','hub_spoke','merge','backlog')),
  url_slug             text,
  keyword_principal    text,
  keywords_secundarias jsonb not null default '[]',
  intent               text check (intent in ('transactional','commercial','local','informational','navigational')),
  is_local             boolean not null default false,
  volume               int     check (volume >= 0),
  difficulty           numeric check (difficulty between 0 and 100),
  opportunity_score    numeric check (opportunity_score between 0 and 100),
  seo                  jsonb,   -- meta_title, meta_description, schema_type, canonical
  content_brief        jsonb,   -- h1, secciones, word_count, enlazado_interno, cta, claims_*
  faqs                 jsonb not null default '[]',
  approved             boolean not null default false,
  edited_by            uuid
);
create index on kr_pages (run_id);
create index on kr_pages (tenant_id);

-- Idempotencia: llamadas externas (DataForSEO async task_id, LLM) por step ---------
create table kr_provider_tasks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  run_id           uuid not null references kr_runs(id) on delete cascade,
  step             text not null,          -- seeds|expand|enrich|serp|cluster|score|brief|report
  provider         text not null,          -- dataforseo|anthropic
  payload_hash     text not null,          -- hash del request → idempotencia
  provider_task_id text,                    -- id de tarea async del proveedor
  status           text not null default 'pending'
                   check (status in ('pending','submitted','done','failed')),
  attempt          int not null default 0,
  cost_micros_usd  bigint not null default 0,
  result_ref       text,                    -- puntero al resultado (row/objeto)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (run_id, step, payload_hash)
);
create index on kr_provider_tasks (run_id);

-- Auditoría de la compuerta humana ------------------------------------
create table kr_approvals (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  run_id     uuid not null references kr_runs(id) on delete cascade,
  reviewer   uuid,
  scope      text not null default 'page' check (scope in ('page','run')),
  page_id    uuid references kr_pages(id),
  decision   text check (decision in ('approved','rejected')),
  edits      jsonb,
  note       text,
  created_at timestamptz not null default now()
);
create index on kr_approvals (run_id);

-- ======================= CACHE (compartida, service-role) =======================
-- Datos SEO públicos. RLS habilitado SIN policies = deny-all para cliente;
-- solo el service role (que bypassa RLS) accede. No guardar prompt/tenant/source.

-- Métricas (no dependen de device/serp_type)
create table kr_metrics_cache (
  keyword        text not null,
  location_code  int  not null,
  language_code  text not null,
  source_endpoint text not null,           -- search_volume|bulk_kd|...
  data_version   text,
  metrics        jsonb,
  fetched_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  primary key (keyword, location_code, language_code, source_endpoint)
);

-- SERP (varía por engine/device/serp_type/depth)
create table kr_serp_cache (
  keyword        text not null,
  location_code  int  not null,
  language_code  text not null,
  search_engine  text not null default 'google',
  device         text not null default 'desktop',
  serp_type      text not null default 'organic',
  depth          int  not null default 10,
  serp           jsonb,
  fetched_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  primary key (keyword, location_code, language_code, search_engine, device, serp_type, depth)
);

-- ============================== RLS ==============================
alter table kr_runs           enable row level security;
alter table kr_keywords       enable row level security;
alter table kr_clusters       enable row level security;
alter table kr_pages          enable row level security;
alter table kr_provider_tasks enable row level security;
alter table kr_approvals      enable row level security;
alter table kr_metrics_cache  enable row level security;  -- sin policy = deny-all (service-role only)
alter table kr_serp_cache     enable row level security;  -- sin policy = deny-all (service-role only)

-- Aislamiento por tenant (aplica a select/insert/update/delete)
create policy tenant_isolation on kr_runs
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy tenant_isolation on kr_keywords
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy tenant_isolation on kr_clusters
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy tenant_isolation on kr_pages
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy tenant_isolation on kr_provider_tasks
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy tenant_isolation on kr_approvals
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
-- Nota: escribir tests RLS (un tenant no ve datos de otro) antes de F1.
