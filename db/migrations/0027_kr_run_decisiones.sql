-- =============================================================================
-- AMG OS — 0027: kr_run_decisiones — el historial de decisiones de un run de KR
--
-- Desacopla "terminar el research" de "publicar la web"
-- (docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md). Antes, aprobar un run SIEMPRE
-- terminaba en publicar. Ahora la aprobación elige un DESTINO (crear_web / solo_informe /
-- crear_posts), y esa elección queda en esta tabla en vez de sobrescribir una columna de kr_runs
-- — así un run puede recibir una SEGUNDA decisión más adelante (retomable: solo_informe →
-- crear_web) sin perder el rastro de la primera.
-- =============================================================================

create type destino_run as enum ('crear_web', 'solo_informe', 'crear_posts');

create table kr_run_decisiones (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  -- Denormalizado desde el run, mismo motivo que kr_keywords.client_id (0001_init.sql:182-185): la
  -- política RLS no se hereda del padre, y sin esto un rol 'cliente' vería decisiones de otros
  -- negocios del mismo tenant.
  client_id      uuid not null,
  destino        destino_run not null,
  decidido_por   uuid,
  decidido_en    timestamptz not null default now(),
  resultado      text not null default 'pendiente'
    check (resultado in ('pendiente', 'completado', 'error')),
  detalle_error  text,
  completado_en  timestamptz,

  check (
    (resultado = 'pendiente'     and completado_en is null     and detalle_error is null)
    or (resultado = 'completado' and completado_en is not null and detalle_error is null)
    or (resultado = 'error'      and completado_en is not null and detalle_error is not null)
  ),

  -- FK compuesta con el mismo motivo que kr_runs (0001_init.sql:147-161): sin el tenant Y el
  -- client en la referencia, una fila podría declararse del tenant propio pero apuntar al run de
  -- otro.
  foreign key (run_id, tenant_id, client_id)
    references kr_runs (id, tenant_id, client_id) on delete cascade
);

create index on kr_run_decisiones (run_id, decidido_en desc);

-- La defensa real contra la carrera de doble aprobación (Critical #3 de la ronda de Codex): un
-- `insert...select...where` sin esto no serializa nada bajo READ COMMITTED — dos transacciones
-- concurrentes ven la misma foto y ninguna ve el insert sin commit de la otra. Un índice único
-- parcial SÍ lo cierra: Postgres serializa las inserciones que compiten por la misma entrada del
-- índice, gane quien gane la carrera la otra espera y después falla por violación de unicidad. Es
-- una garantía del motor, no de la aplicación.
create unique index kr_run_decisiones_una_pendiente
  on kr_run_decisiones (run_id)
  where resultado = 'pendiente';

alter table kr_run_decisiones enable row level security;
alter table kr_run_decisiones force row level security;

-- Mismo patrón que run_select/run_write (0001_init.sql:441-447), client_id incluido.
create policy decision_select on kr_run_decisiones
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy decision_write on kr_run_decisiones
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (
    tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id)
  );

-- Tabla nueva: los grants de tabla de app_user/app_service sobre kr_runs (0001:413, 0002:93) NO
-- cubren esta tabla automáticamente.
grant select, insert, update on kr_run_decisiones to app_user;
grant select, insert, update on kr_run_decisiones to app_service;
-- app_render: sin grant, igual que sobre kr_runs (0007_render_publico.sql:35-36).
-- app_barrido: sin grant — no hay barrido de expiración que la necesite (ver el spec, sección
-- "No hay timeout automático nuevo").
