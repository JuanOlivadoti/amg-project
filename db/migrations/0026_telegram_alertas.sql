-- =============================================================================
-- AMG OS — 0026: alertas por Telegram para reseñas 1-3★ (Bloque F, fase 2)
--
-- RF-018 del PRD: "alerta inmediata (WhatsApp/email) al CM ante 1-3★". El destinatario es
-- personal INTERNO de AMG (el Community Manager asignado al cliente, `clients.asignado_a`), no el
-- cliente externo -- por eso el canal elegido es Telegram y no WhatsApp Business (investigado:
-- verificación de negocio ante Meta, plantillas pre-aprobadas, costo por mensaje -- ver
-- docs/proyecto/15-plan-plataforma.md § Bloque F). Sin gatekeeper externo: este módulo tiene modo
-- `live` real desde el día uno, no mock-first.
--
-- Spec: docs/proyecto/15-plan-plataforma.md § Bloque F.
-- Revisado por Codex antes de escribirse (2026-08-23): ver el encabezado del plan
-- (docs/superpowers/plans/2026-08-23-alertas-telegram.md) para los ocho hallazgos incorporados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tres columnas en `memberships`. `telegram_chat_id` NUNCA lo escribe el usuario directo (solo el
-- orquestador, tras confirmar el código real contra Telegram) -- si `app_user` pudiera escribirlo
-- a mano, cualquiera podría poner el chat_id de otra persona y robarle sus alertas sin que
-- Telegram mediara en nada.
-- -----------------------------------------------------------------------------
alter table memberships
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_link_code text,
  add column if not exists telegram_link_code_expira timestamptz;

comment on column memberships.telegram_chat_id is
  'El chat_id de Telegram vinculado a esta membresía. NULL = no vinculado. Lo escribe SOLO el '
  'orquestador (app_telegram, security definer, app.vincular_telegram) tras confirmar el código '
  'contra un /start real -- app_user nunca tiene grant de escritura sobre esta columna.';
comment on column memberships.telegram_link_code is
  'Código de un solo uso que el propio usuario pide generar desde el portal para vincular su '
  'Telegram. NULL = no hay vinculación pendiente. Se limpia al confirmarse -- un código VENCIDO '
  'no se limpia solo, simplemente deja de matchear en el WHERE de app.vincular_telegram (el '
  'próximo código que se pida lo pisa igual). El VALOR y el vencimiento los genera Postgres, '
  'nunca el caller -- ver el trigger membresias_guardia_telegram: un app_user con acceso directo '
  'a SQL podría, si no fuera por ese trigger, escribir un código elegido por él o una expiración '
  'arbitraria (Codex review 2026-08-23, hallazgo 3).';
comment on column memberships.telegram_link_code_expira is
  'Vencimiento del código de arriba, SIEMPRE now() + 10 minutos -- impuesto por el trigger '
  'membresias_guardia_telegram, no por quien pide el código. Sin esto, un código viejo filtrado '
  'en un log seguiría siendo válido para siempre.';

-- -----------------------------------------------------------------------------
-- Una columna en `resenas_google`: si ya se mandó (o se intentó y confirmó) la alerta de
-- Telegram para esta reseña. Decisión de Juan tras la revisión de Codex (hallazgo 4): un fallo
-- de Telegram NO puede perder la alerta para siempre -- el próximo ciclo de polling (30 min)
-- vuelve a intentar CUALQUIER reseña 1-3★ sin esta columna puesta, sin cola ni botón nuevo. Es
-- ortogonal a si la reseña es "nueva" en ese ciclo: una reseña vieja cuya alerta falló hace tres
-- ciclos se sigue reintentando hasta que se marque.
-- -----------------------------------------------------------------------------
alter table resenas_google
  add column if not exists alerta_telegram_enviada_en timestamptz;

comment on column resenas_google.alerta_telegram_enviada_en is
  'Cuándo se confirmó el envío de la alerta de Telegram al CM asignado. NULL = todavía no (nunca '
  'se intentó, el CM no tiene Telegram vinculado, o el último intento falló). El polling reintenta '
  'toda reseña 1-3★ con esta columna en NULL en cada ciclo -- ver app.marcar_alerta_telegram_enviada.';

-- Aditivo sobre el grant de update de la 0024 (los privilegios de columna del mismo rol/tabla se
-- ACUMULAN) -- la política resena_actualizar_borrador_app_resenas (0024, using true/check true)
-- ya cubre CUALQUIER UPDATE de app_resenas sobre esta tabla, no hace falta una política nueva.
grant update (alerta_telegram_enviada_en) on resenas_google to app_resenas;

-- -----------------------------------------------------------------------------
-- La vista gana el booleano -- NO el chat_id crudo (no hace falta exponerlo al portal, y es
-- exactamente el mismo criterio que ya evitó devolver el token OAuth de Google en cualquier
-- lectura de `clients`).
-- -----------------------------------------------------------------------------
create or replace view membresias_perfil as
  select
    m.id,
    m.tenant_id,
    m.user_id,
    m.rol,
    m.client_id,
    m.created_at,
    u.email,
    u.raw_app_meta_data,
    (m.telegram_chat_id is not null) as telegram_vinculado
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = app.current_tenant_id()
    and (app.es_staff() or m.user_id = app.current_user_id());

comment on view membresias_perfil is
  'Lectura de memberships + auth.users (email, metadata, si vinculó Telegram), YA filtrada por '
  'tenant y por rol -- ver 0012 para el resto del razonamiento. telegram_vinculado es un booleano '
  'derivado, nunca el chat_id crudo.';

-- -----------------------------------------------------------------------------
-- Segunda política UPDATE permisiva sobre `memberships` (self-service, para vincular Telegram),
-- y el trigger que la vuelve segura. Ver el comentario largo en el plan
-- (docs/superpowers/plans/2026-08-23-alertas-telegram.md, Step 3) para el razonamiento completo:
-- Postgres combina políticas permisivas del mismo comando con OR (el `using` de todas se OR-ea
-- entre sí, y el `with check` de todas se OR-ea entre sí, POR SEPARADO), así que sin un backstop
-- que corra SIEMPRE, un UPDATE que tocara `rol` Y `telegram_link_code` en la misma fila podría
-- colarse por el `with check` más laxo de la política nueva.
-- -----------------------------------------------------------------------------

-- app_user puede generar y borrar SU PROPIO código de vinculación pendiente -- nunca
-- `telegram_chat_id`, que queda reservado a `app_telegram` (más abajo).
grant update (telegram_link_code, telegram_link_code_expira) on memberships to app_user;

create policy membership_vincular_telegram on memberships
  for update
  to app_user
  using      (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
  with check (tenant_id = app.current_tenant_id() and user_id = app.current_user_id());

comment on policy membership_vincular_telegram on memberships is
  'Un usuario autenticado puede generar/borrar SU PROPIO código de vinculación de Telegram, '
  'cualquiera sea su rol -- a diferencia de membership_update (0012), acá no importa ser maestro. '
  'Ver el trigger membresias_guardia_telegram para por qué esto no debilita la protección de '
  'auto-degradación de membership_update al combinarse por OR, y para por qué el VALOR del código '
  'no lo elige quien lo pide.';

-- -----------------------------------------------------------------------------
-- Un solo trigger BEFORE UPDATE, dos guardias independientes. Codex review 2026-08-23:
--
-- (a) Backstop de rol/client_id (hallazgo de diseño original, confirmado por Codex contra
--     PGlite): repite la condición que membership_update YA impone en su WITH CHECK, pero corre
--     INCONDICIONALMENTE, antes de que RLS decida nada. Un WITH CHECK no puede comparar
--     limpiamente contra el valor VIEJO de la fila (no hay una forma segura de referenciar OLD
--     dentro de una expresión de política); un trigger BEFORE sí tiene OLD y NEW. Necesario
--     porque esta migración agrega una segunda política permisiva sobre el mismo UPDATE
--     (vincular Telegram): las políticas permisivas se combinan con OR en Postgres, así que sin
--     este trigger una sentencia que tocara rol Y telegram_link_code en la misma fila podría
--     colarse por el WITH CHECK más laxo de la política nueva.
--
-- (b) El código y su vencimiento los genera ESTA función, nunca el caller (hallazgo 3 de Codex):
--     `membership_vincular_telegram` le da a `app_user` UPDATE directo sobre
--     `telegram_link_code`/`telegram_link_code_expira` -- sin este trigger, una sentencia SQL
--     directa (fuera de `PgMembresias.generarCodigoTelegram`) podría escribir un código elegido
--     por quien la ejecuta, o una expiración arbitraria (incluso "nunca"), rompiendo las dos
--     garantías de seguridad que el diseño da por sentadas: impredecibilidad y TTL de 10 min.
--     Cuando alguien PIDE un código nuevo (`new.telegram_link_code is distinct from
--     old.telegram_link_code and new.telegram_link_code is not null`), el trigger IGNORA el
--     valor que mandó el caller y genera el suyo: `gen_random_uuid()::text` (mismo generador de
--     aleatoriedad que ya usan las primary keys de este esquema -- sin depender de `pgcrypto`,
--     que no está habilitado acá) y `now() + interval '10 minutes'`. `PgMembresias.
--     generarCodigoTelegram` (Step 7) manda un valor cualquiera en el UPDATE y lee de vuelta lo
--     que Postgres realmente escribió, vía `returning`.
-- -----------------------------------------------------------------------------
create or replace function app.membresias_guardia_telegram() returns trigger
language plpgsql as $$
begin
  if (new.rol is distinct from old.rol or new.client_id is distinct from old.client_id)
     and (app.rol_propio_sin_recursion() <> 'maestro' or new.user_id = app.current_user_id()) then
    raise exception 'No autorizado para cambiar rol/cliente de esta membresía.'
      using errcode = '42501';
  end if;

  if new.telegram_link_code is distinct from old.telegram_link_code
     and new.telegram_link_code is not null then
    new.telegram_link_code := gen_random_uuid()::text;
    new.telegram_link_code_expira := now() + interval '10 minutes';
  end if;

  return new;
end;
$$;

comment on function app.membresias_guardia_telegram is
  'Dos guardias BEFORE UPDATE sobre memberships, en una sola función porque las dos corren '
  'SIEMPRE, sin importar qué política RLS haya dejado pasar la fila: (a) repite la condición de '
  'autorización de rol/client_id que membership_update (0012) ya impone en su WITH CHECK -- '
  'necesario porque esta migración agrega una segunda política UPDATE permisiva sobre la misma '
  'tabla, y Postgres combina políticas permisivas con OR; (b) fuerza el VALOR y el vencimiento de '
  'un código de vinculación nuevo, ignorando lo que el caller haya mandado -- sin esto, app_user '
  '(con UPDATE directo sobre esas dos columnas) podría elegir un código predecible o un '
  'vencimiento infinito. Codex review 2026-08-23, hallazgos de diseño y hallazgo 3.';

create trigger membresias_guardia_telegram
  before update on memberships
  for each row
  execute function app.membresias_guardia_telegram();

-- -----------------------------------------------------------------------------
-- El rol cross-tenant `app_telegram`, mismo baile que `app_barrido`/`app_resenas`.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_telegram') then
    create role app_telegram nologin;
  end if;
end $$;

grant usage on schema public, app to app_telegram;

-- **Codex review 2026-08-23, hallazgo 2, verificado contra PGlite: el grant original solo
-- concedía UPDATE (escritura) y le faltaba SELECT (lectura).** Postgres exige SELECT sobre
-- cualquier columna que una sentencia LEA -- en el WHERE, en el RETURNING, o del lado derecho de
-- un SET -- además de UPDATE sobre las que escribe. `app.vincular_telegram` lee
-- `telegram_link_code`/`telegram_link_code_expira` en su WHERE y devuelve `id`;
-- `app.desvincular_telegram_propio` (Step 5) lee `tenant_id`/`user_id`/`telegram_chat_id` en su
-- WHERE y también devuelve `id`. Sin el SELECT de las seis, las dos funciones fallan con
-- "permission denied for table memberships" (42501) apenas se las ejecuta -- exactamente el
-- mismo tipo de bug que ya documentó la 0022 con `archived_at` ("la función NUNCA la DEVUELVE,
-- pero SÍ la lee... un where normal SÍ lo exige").
grant select (id, tenant_id, user_id, telegram_chat_id, telegram_link_code, telegram_link_code_expira)
  on memberships to app_telegram;
grant update (telegram_chat_id, telegram_link_code, telegram_link_code_expira)
  on memberships to app_telegram;

create policy membership_telegram_actualizar on memberships
  for update to app_telegram
  using (true) with check (true);

create policy membership_telegram_leer on memberships
  for select to app_telegram
  using (true);

comment on policy membership_telegram_leer on memberships is
  'app_telegram necesita SELECT (no solo UPDATE) para poder evaluar el WHERE y el RETURNING de '
  'sus propias funciones -- ver el comentario del grant, arriba. Mismo criterio "using (true), el '
  'aislamiento lo da el WHERE de la función" que membership_telegram_actualizar.';

comment on policy membership_telegram_actualizar on memberships is
  'app_telegram (security definer, app.vincular_telegram) puede actualizar CUALQUIER fila -- el '
  'aislamiento no lo da esta política (no hay contexto de tenant que mirar, mismo motivo que '
  'app_resenas en la 0022): lo da el WHERE de la función, que exige código exacto y no vencido.';

create or replace function app.vincular_telegram(p_codigo text, p_chat_id text) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update memberships
    set telegram_chat_id = p_chat_id, telegram_link_code = null, telegram_link_code_expira = null
    where telegram_link_code = p_codigo
      and telegram_link_code_expira > now()
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.vincular_telegram is
  'Confirma la vinculación: matchea por código de un solo uso, exige que no haya vencido. Lo '
  'llama el orquestador (app_service) tras leer "/start <codigo>" de getUpdates. security '
  'definer, propiedad de app_telegram.';

-- El "asignado" de un cliente y su vinculación de Telegram, cruzando `clients` con `memberships`.
-- `nombre` se agrega al grant de `app_resenas` sobre `clients` (Step 6) para el texto del mensaje
-- -- acá `app_telegram` solo necesita `asignado_a`. El SELECT sobre `memberships` ya se concedió
-- arriba (`id, tenant_id, user_id, telegram_chat_id, telegram_link_code, telegram_link_code_expira`
-- cubre lo que esta función lee: `tenant_id`, `user_id`, `telegram_chat_id`) -- no se repite acá.
grant select (id, tenant_id, asignado_a) on clients to app_telegram;

create policy client_ve_app_telegram on clients
  for select to app_telegram
  using (true);

create or replace function app.telegram_del_asignado(p_client_id uuid) returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.telegram_chat_id
  from clients c
  join memberships m on m.tenant_id = c.tenant_id and m.user_id = c.asignado_a
  where c.id = p_client_id;
$$;

comment on function app.telegram_del_asignado is
  'El chat_id de Telegram del CM asignado a un cliente, o NULL si no hay asignado o no vinculó '
  'Telegram. security definer, propiedad de app_telegram, para que el orquestador (app_service) '
  'pueda mandar la alerta sin tener grant directo sobre clients.asignado_a ni memberships.';

-- Offset de `getUpdates`: sin persistirlo entre corridas, cada ciclo del orquestador volvería a
-- ver los mismos mensajes /start ya procesados. Fila única (mismo patrón "singleton" que
-- `app.migraciones_aplicadas`): sin RLS, no es dato de tenant -- ver AGENTS.md, "app.migraciones_
-- aplicadas no tiene RLS en absoluto, y vive en app, fuera del universo que recorre public".
create table app.telegram_polling_estado (
  id                boolean primary key default true,
  ultimo_update_id  bigint not null default 0,
  constraint telegram_polling_singleton check (id)
);
insert into app.telegram_polling_estado (id) values (true);

comment on table app.telegram_polling_estado is
  'Fila única: el último update_id de Telegram ya procesado. Sin RLS -- no es dato de tenant, '
  'mismo criterio que app.migraciones_aplicadas.';

grant select, update on app.telegram_polling_estado to app_service;

-- El cambio de dueño, idéntico a 0018/0022/0024/0025.
grant app_telegram to current_user;
grant create on schema app to app_telegram;
alter function app.vincular_telegram(text, text) owner to app_telegram;
alter function app.telegram_del_asignado(uuid) owner to app_telegram;
revoke execute on function app.vincular_telegram(text, text) from public;
revoke execute on function app.telegram_del_asignado(uuid) from public;
grant execute on function app.vincular_telegram(text, text) to app_service;
grant execute on function app.telegram_del_asignado(uuid) to app_service;
revoke create on schema app from app_telegram;
revoke app_telegram from current_user;

-- -----------------------------------------------------------------------------
-- El usuario puede desvincularse a sí mismo SIN pasar por Telegram de nuevo -- simétrico con
-- POST /clients/:id/google/desconectar. Necesita tocar telegram_chat_id, que app_user NO tiene
-- concedido (a propósito, más arriba) -- por eso es una función security definer angosta, no un
-- grant nuevo: el cuerpo entero es "poné NULL en MI PROPIA fila", nada más que eso puede hacer.
-- -----------------------------------------------------------------------------
create or replace function app.desvincular_telegram_propio() returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update memberships
    set telegram_chat_id = null
    where tenant_id = app.current_tenant_id()
      and user_id = app.current_user_id()
      and telegram_chat_id is not null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.desvincular_telegram_propio is
  'Limpia telegram_chat_id de la PROPIA fila del que llama -- lee app.current_user_id() y '
  'app.current_tenant_id() (session GUCs, no recursivo: a diferencia de app.current_role(), estas '
  'dos no consultan memberships). security definer solo para poder tocar una columna que app_user '
  'no tiene concedida en absoluto; el alcance lo impone el WHERE, no el rol de quien ejecuta.';

grant app_telegram to current_user;
grant create on schema app to app_telegram;
alter function app.desvincular_telegram_propio() owner to app_telegram;
revoke execute on function app.desvincular_telegram_propio() from public;
grant execute on function app.desvincular_telegram_propio() to app_user;
revoke create on schema app from app_telegram;
revoke app_telegram from current_user;

-- -----------------------------------------------------------------------------
-- `nombre` en `clientes_conectados_google`, y las dos funciones de la alerta con retry -- todo
-- propiedad de `app_resenas`.
--
-- **Codex review 2026-08-23, hallazgo 5, verificado contra PGlite: `CREATE OR REPLACE FUNCTION`
-- NO puede agregarle una columna a un `RETURNS TABLE` existente** (Postgres lo rechaza con
-- `42P13 cannot change return type of existing function`). Agregar `nombre` a
-- `app.clientes_conectados_google()` (0022) exige `DROP FUNCTION` y recrearla entera, repitiendo
-- el baile de dueño completo -- no un simple `create or replace`.
-- -----------------------------------------------------------------------------
grant select (nombre) on clients to app_resenas;

drop function app.clientes_conectados_google();

create function app.clientes_conectados_google()
returns table (client_id uuid, tenant_id uuid, location_id text, refresh_token text, nombre text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select id, tenant_id, google_location_id, google_refresh_token, nombre
  from clients
  where google_refresh_token is not null
    and archived_at is null;
$$;

comment on function app.clientes_conectados_google() is
  'Lista, cruzando TODOS los tenants, los clientes con Google conectado -- ahora con `nombre`, '
  'para el texto de la alerta de Telegram (0026). Recreada con DROP + CREATE porque CREATE OR '
  'REPLACE no puede agregar una columna a un RETURNS TABLE existente (42P13). security definer y '
  'propiedad de app_resenas, igual que antes de la 0026.';

grant app_resenas to current_user;
grant create on schema app to app_resenas;
alter function app.clientes_conectados_google() owner to app_resenas;
revoke execute on function app.clientes_conectados_google() from public;
grant execute on function app.clientes_conectados_google() to app_service;
revoke create on schema app from app_resenas;
revoke app_resenas from current_user;

-- -----------------------------------------------------------------------------
-- Las dos piezas del retry automático (decisión de Juan, hallazgo 4 de Codex): qué reseñas 1-3★
-- siguen sin alerta confirmada (para CUALQUIER cliente conectado, no solo las nuevas de este
-- ciclo), y cómo confirmar una. Mismo molde exacto que `guardar_borrador_resena` (0024): las
-- condiciones van en el WHERE, no en el llamador.
-- -----------------------------------------------------------------------------
create function app.resenas_pendientes_alerta_telegram(p_client_id uuid)
returns table (google_review_id text, tenant_id uuid, puntuacion smallint, autor text, texto text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select google_review_id, tenant_id, puntuacion, autor, texto
  from resenas_google
  where client_id = p_client_id
    and puntuacion between 1 and 3
    and alerta_telegram_enviada_en is null;
$$;

comment on function app.resenas_pendientes_alerta_telegram is
  'Las reseñas 1-3★ de un cliente sin alerta de Telegram confirmada todavía -- incluye tanto las '
  'nuevas de este ciclo de polling como las de ciclos anteriores cuyo envío falló. Es lo que le da '
  'retry automático a la alerta sin cola ni botón: el próximo ciclo (30 min) vuelve a intentar '
  'cualquier fila que siga en NULL. security definer, propiedad de app_resenas.';

create function app.marcar_alerta_telegram_enviada(
  p_client_id uuid, p_tenant_id uuid, p_google_review_id text
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update resenas_google
    set alerta_telegram_enviada_en = now()
    where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
      and alerta_telegram_enviada_en is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.marcar_alerta_telegram_enviada is
  'Confirma que la alerta de Telegram salió. No marca nada si ya estaba confirmada -- la condición '
  'va en el WHERE. security definer, propiedad de app_resenas.';

grant app_resenas to current_user;
grant create on schema app to app_resenas;
alter function app.resenas_pendientes_alerta_telegram(uuid) owner to app_resenas;
alter function app.marcar_alerta_telegram_enviada(uuid, uuid, text) owner to app_resenas;
revoke execute on function app.resenas_pendientes_alerta_telegram(uuid) from public;
revoke execute on function app.marcar_alerta_telegram_enviada(uuid, uuid, text) from public;
grant execute on function app.resenas_pendientes_alerta_telegram(uuid) to app_service;
grant execute on function app.marcar_alerta_telegram_enviada(uuid, uuid, text) to app_service;
revoke create on schema app from app_resenas;
revoke app_resenas from current_user;

-- Nota: `resenas_pendientes_alerta_telegram`/`marcar_alerta_telegram_enviada` leen/escriben
-- columnas de `resenas_google` que `app_resenas` YA puede leer por completo (SELECT de tabla
-- entera, 0022) y ya puede escribir la columna nueva (`grant update (alerta_telegram_enviada_en)`,
-- más arriba) -- no hace falta ningún grant adicional para estas dos funciones, a diferencia de
-- las de `app_telegram` (que SÍ partían de cero).
