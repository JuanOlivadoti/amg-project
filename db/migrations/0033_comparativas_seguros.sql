-- =============================================================================
-- AMG OS — 0033: comparativas de seguros (módulo de correduría) — tabla + RLS + el gate de revisión
--
-- Una correduría sube las cotizaciones que juntó de varias aseguradoras y recibe un informe
-- comparativo imprimible más un borrador de mail, generados por IA. `revisado_en`/`revisado_por`
-- es el control humano que impide que esa recomendación salga (se imprima o se copie) sin que
-- alguien la haya mirado -- no es un flag de pantalla, es el hecho persistido.
--
-- Molde: `db/migrations/0021_resenas_google.sql` (tabla + RLS estándar sobre `client_id`).
--
-- Spec: .superpowers/sdd/2026-09-12-comparativas-seguros/task-1-brief.md
-- =============================================================================

create table comparativas_seguros (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  client_id             uuid not null,
  creado_por            uuid not null,
  cliente_final_nombre  text not null check (length(cliente_final_nombre) between 1 and 200),
  cliente_final_email   text check (cliente_final_email is null or length(cliente_final_email) <= 320),
  opciones              jsonb not null,
  recomendacion         text not null,
  informe_md            text not null,
  mail_asunto           text not null,
  mail_cuerpo_md        text not null,
  costo_usd             numeric not null default 0 check (costo_usd >= 0),
  revisado_en           timestamptz,
  revisado_por          uuid,
  created_at            timestamptz not null default now(),
  -- La FK compuesta impide que una fila apunte a un cliente de OTRO tenant: no basta con que
  -- `client_id` exista en `clients`, tiene que existir CON el mismo `tenant_id` que esta fila.
  foreign key (tenant_id, client_id) references clients (tenant_id, id) on delete cascade,
  -- Los dos campos del gate viajan juntos o no viajan: media revisión no existe, y sin este check
  -- un update parcial dejaría una fila que la UI leería como revisada sin saber por quién.
  check ((revisado_en is null) = (revisado_por is null))
);

comment on table comparativas_seguros is
  'Comparativas de seguros generadas por IA para el módulo de correduría. Nace SIN revisar '
  '(revisado_en/revisado_por en null): esa revisión humana es el control que impide que una '
  'recomendación de IA se imprima o se copie sin que nadie la haya mirado. v1 es de solo lectura '
  'tras crear -- no hay UPDATE de los campos de contenido, solo del gate (ver los grants de abajo).';

create index comparativas_seguros_cliente on comparativas_seguros (client_id, created_at desc);

alter table comparativas_seguros enable row level security;
alter table comparativas_seguros force row level security;

-- -----------------------------------------------------------------------------
-- Grants. `app_user` es el único rol con login que toca esta tabla -- no hay cruce de tenants acá,
-- así que no hace falta un rol de servicio como en `resenas_google`/`app_resenas` (0022).
-- -----------------------------------------------------------------------------
grant select, insert on comparativas_seguros to app_user;
-- Update SOLO de las dos columnas del gate: revisar es confirmar, no corregir. Es la mitad de lo que
-- hace cumplir el "v1 es de solo lectura" de la spec; la otra mitad es que no hay endpoint de edición.
grant update (revisado_en, revisado_por) on comparativas_seguros to app_user;

create policy comparativa_select on comparativas_seguros
  for select to app_user
  using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy comparativa_insert on comparativas_seguros
  for insert to app_user
  with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir());

create policy comparativa_revisar on comparativas_seguros
  for update to app_user
  using      (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir())
  with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir());
