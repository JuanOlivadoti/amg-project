-- =============================================================================
-- AMG OS — Cierra OBS-02: el rol DEJA DE PODER DECLARARSE
--
-- Hasta acá, `app.current_role()` y `app.current_client_id()` leían el contexto que ponía la
-- aplicación. Era aceptable mientras el único caller fuese backend de confianza (el CLI, el
-- orquestador): ningún usuario final podía influirlo.
--
-- **El portal rompe esa premisa.** En cuanto hay un endpoint HTTP con un usuario del otro lado, un
-- rol declarado por quien llama es una escalada de privilegios servida en bandeja: basta con
-- mandar `role: maestro`. La tabla `memberships` existía con los datos correctos y NO participaba
-- en ninguna decisión de autorización.
--
-- Ahora el rol y el cliente se DERIVAN dentro de Postgres, desde una membresía real. Declararse
-- `maestro` no tiene ningún efecto: el GUC `app.role` deja de leerse.
--
-- ⚠️ NO SE TOCA NI UNA POLÍTICA. Las políticas siempre llamaron a estas funciones en vez de leer
-- la variable de sesión — precisamente para que este cambio fuera posible sin reescribirlas. Es el
-- rédito de esa decisión, cobrado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quién es el usuario
--
-- Hoy sale del GUC `app.user_id`, que pone la API DESPUÉS de verificar el JWT. En Supabase se
-- redefine el cuerpo para leer `auth.uid()` y no cambia nada más.
--
-- Ojo con lo que esto SÍ y NO garantiza: la API es la que afirma "este es el usuario", y eso es
-- legítimo porque acaba de validar su token con la clave pública del emisor. Lo que ya NO puede
-- afirmar —y es lo que importa— es QUÉ PUEDE HACER ese usuario. Eso lo dice la base.
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

/**
 * El proceso del backend (el orquestador). NO es una persona.
 *
 * Su autoridad es una CREDENCIAL DE BASE DE DATOS (se conecta como el rol `app_service`), no un
 * campo en una petición. Eso sí es una autoridad: para falsificarla hay que tener la contraseña de
 * Postgres, y quien la tiene ya ganó.
 *
 * Por eso no necesita membresía: no hay nadie a quien suplantar.
 */
create or replace function app.es_servicio() returns boolean
language sql stable as $$
  select current_user = 'app_service'
$$;

/**
 * Rol del usuario en el tenant — DERIVADO de `memberships`, no declarado.
 *
 * Sin membresía en ese tenant → NULL → no ve nada (las políticas usan allowlist positiva).
 * Ojo: esto también significa que reclamar un `tenant_id` ajeno no sirve de nada. No hay membresía
 * allí, así que no hay rol, así que no hay acceso.
 */
create or replace function app.current_role() returns text
language sql stable as $$
  select case
    when app.es_servicio() then 'servicio'
    else (
      select m.rol::text from memberships m
      where m.tenant_id = app.current_tenant_id()
        and m.user_id   = app.current_user_id()
    )
  end
$$;

/** Cliente al que está atado el usuario, si su rol es `cliente`. También DERIVADO. */
create or replace function app.current_client_id() returns uuid
language sql stable as $$
  select m.client_id from memberships m
  where m.tenant_id = app.current_tenant_id()
    and m.user_id   = app.current_user_id()
$$;

-- -----------------------------------------------------------------------------
-- El rol de servicio
--
-- Separado de `app_user` a propósito: el orquestador escribe resultados del research, pero no
-- debería poder hacer lo que hace un `maestro` humano. Y al revés: un humano no puede hacerse pasar
-- por el servicio, porque para eso haría falta la credencial de Postgres.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service nologin;
  end if;
end $$;

grant usage on schema public, app to app_service;
grant execute on all functions in schema app to app_service;
grant select on tenants, memberships to app_service;
grant select, insert, update, delete on clients, kr_runs, kr_keywords, kr_pages to app_service;

-- Las caches y el registro de tareas del proveedor siguen deny-all para AMBOS roles de aplicación:
-- no llevan tenant_id, así que exponerlas dejaría ver a un tenant qué investigó otro. Solo las toca
-- la service-role de la infraestructura (la que salta RLS), que es la que corre el pipeline.

-- -----------------------------------------------------------------------------
-- `app.role` ya no se lee. Se deja constancia para que nadie lo "arregle" volviéndolo a usar.
-- -----------------------------------------------------------------------------
comment on function app.current_role() is
  'DERIVADO de memberships (o de la credencial de BD, para el servicio). El GUC app.role ya NO se '
  'lee: era declarable por quien llamaba, y con un portal HTTP eso es escalada de privilegios. '
  'Ver OBS-02 / ADR-15.';
