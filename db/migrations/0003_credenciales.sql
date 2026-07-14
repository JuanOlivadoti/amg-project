-- =============================================================================
-- AMG OS — Credenciales de verdad, y tres fugas que dejó abiertas la 0002
--
-- ## Lo que la 0002 NO arregló (y yo dije que sí)
--
-- ADR-15 afirmaba: "la autoridad del servicio es una CREDENCIAL DE BASE DE DATOS; para falsificarla
-- hace falta la contraseña de Postgres". **Era falso.**
--
-- `app_service` es NOLOGIN. Había UN solo DATABASE_URL, un solo pool, y era el CÓDIGO el que
-- decidía con qué rol vestirse (`set local role app_service`). Postgres autoriza `SET ROLE` según
-- el `session_user`, sin pedir ninguna contraseña: el mismo login podía ponerse `app_user` O
-- `app_service` indistintamente, y hacer `RESET ROLE` para volver a sus privilegios originales.
--
-- Es decir: una frontera de CÓDIGO disfrazada de frontera de CREDENCIALES. Exactamente la
-- "autoridad declarada" que la 0002 presumía de haber eliminado — cerrada en la puerta de los
-- humanos y dejada abierta en la del servicio.
--
-- Acá se convierte en una frontera real: cada login está autorizado a UN SOLO rol, con NOINHERIT.
-- El login de la API **no puede** hacer `set role app_service`: Postgres lo rechaza.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Logins. Uno por proceso, con NOINHERIT.
--
-- NOINHERIT es la mitad del mecanismo: sin él, el login tendría los privilegios de sus roles
-- concedidos SIN necesidad de `SET ROLE`, y `RESET ROLE` los devolvería. Con NOINHERIT, el login
-- por sí mismo no puede nada; solo puede lo del rol que asume explícitamente — y solo puede asumir
-- el suyo.
--
-- Las contraseñas NO van acá: se ponen al desplegar (`alter role ... with password`), nunca en el
-- repositorio. Ver `docs/proyecto/12-credenciales.md`.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'amg_api') then
    create role amg_api login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'amg_orquestador') then
    create role amg_orquestador login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'amg_cache') then
    create role amg_cache login noinherit;
  end if;
end $$;

-- Cada login, a UN rol. Esta es la línea que convierte la separación en real.
grant app_user    to amg_api;          -- la API NO puede asumir app_service
grant app_service to amg_orquestador;  -- el orquestador NO puede asumir app_user

grant usage on schema public, app to amg_cache;
grant execute on all functions in schema app to amg_cache;

-- -----------------------------------------------------------------------------
-- Las caches y el registro de tareas: un rol propio, no el dueño de las migraciones
--
-- Estas tablas no tienen `tenant_id` (son datos del MERCADO, compartidos entre tenants: es lo que
-- hace que la 2ª corrida salga gratis). Siguen `force row level security` SIN políticas para
-- app_user/app_service — o sea, deny-all para ellos.
--
-- Pero el pipeline tiene que escribirlas. Antes eso lo hacía "la service-role", que en la práctica
-- era el superusuario que corre las migraciones — matar una mosca a cañonazos: ese rol salta RLS en
-- TODAS las tablas, incluidas las de tenant. Ahora hay un rol mínimo que solo puede tocar estas
-- tres, y RLS sigue en pie (la política es explícita y solo para él).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on kr_metrics_cache, kr_serp_cache, kr_provider_tasks to amg_cache;

create policy cache_metrics_amg on kr_metrics_cache to amg_cache using (true) with check (true);
create policy cache_serp_amg    on kr_serp_cache    to amg_cache using (true) with check (true);
create policy tasks_amg         on kr_provider_tasks to amg_cache using (true) with check (true);

-- -----------------------------------------------------------------------------
-- FUGA 1 — un `cliente` podía leer TODAS las membresías de su tenant
--
-- La política era `using (tenant_id = app.current_tenant_id())`: sin filtro por usuario. El dueño
-- de un restaurante entraba al portal y podía enumerar los UUID de usuario, los roles y los
-- `client_id` de TODOS los negocios de la cartera. No veía las filas de `clients`, pero la
-- estructura de la cartera —que el RBAC existe para ocultar— se filtraba igual por el costado.
--
-- Ahora cada uno ve SOLO SU membresía. Es todo lo que `app.current_role()` necesita para resolver
-- permisos: su propia fila.
--
-- Ojo con la recursión: esta política NO llama a `app.current_role()` (que a su vez lee
-- `memberships`). Si lo hiciera, Postgres entraría en recursión infinita al evaluarla. Por eso solo
-- compara tenant + usuario, que salen de GUCs.
-- -----------------------------------------------------------------------------
drop policy if exists membership_select on memberships;

create policy membership_select on memberships
  for select using (
    tenant_id = app.current_tenant_id()
    and user_id = app.current_user_id()
  );

-- -----------------------------------------------------------------------------
-- FUGA 2 — una PERSONA podía tener rol `servicio`
--
-- El enum `user_role` incluía 'servicio', y `current_role()` devolvía el rol de la membresía tal
-- cual. Una membresía mal provisionada le daba a un humano los privilegios del orquestador,
-- contradiciendo lo que ADR-15 dice.
--
-- La identidad de servicio existe SOLO como rol de conexión. No hay ninguna membresía que la
-- otorgue. (El valor sigue en el enum porque Postgres no permite quitar valores de un enum sin
-- recrearlo; la constraint hace el trabajo y es más explícita que un enum mutilado.)
-- -----------------------------------------------------------------------------
alter table memberships
  add constraint membresia_no_es_servicio check (rol <> 'servicio');

-- Doble cierre: aunque alguien lograra insertar la membresía, la función no la aceptaría.
create or replace function app.current_role() returns text
language sql stable as $$
  select case
    when app.es_servicio() then 'servicio'
    else (
      select m.rol::text from memberships m
      where m.tenant_id = app.current_tenant_id()
        and m.user_id   = app.current_user_id()
        -- Allowlist HUMANA. 'servicio' no se puede obtener por membresía, nunca.
        and m.rol in ('maestro', 'equipo', 'cliente')
    )
  end
$$;

comment on function app.current_role() is
  'Rol HUMANO derivado de memberships (allowlist maestro/equipo/cliente), o ''servicio'' si la '
  'conexion asumio el rol app_service. El GUC app.role NO se lee. Ver ADR-15 / ADR-17.';
