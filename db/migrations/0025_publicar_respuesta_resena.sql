-- =============================================================================
-- AMG OS — 0025: publicar la respuesta de vuelta a Google (Bloque F, fase 2, segunda pieza)
--
-- Mock-first, mismo criterio que toda la fase 1: el staff pide publicar (bajo RLS, app_user), la
-- API emite un evento (ADR-18: la fila manda, no el evento) y el orquestador -- que es quien tiene
-- el refresh token vía `app_resenas` -- hace el trabajo real y confirma. `GOOGLE_REVIEWS_MODO`
-- sigue siendo mock/live (orchestrator/src/google/provider.ts): el mock "publica" siempre con
-- éxito; `live` sigue sin implementación hasta que exista acceso real a la Business Profile API.
--
-- Spec: docs/proyecto/15-plan-plataforma.md § Bloque F.
-- =============================================================================

alter table resenas_google
  add column if not exists respuesta_solicitada_en timestamptz,
  add column if not exists respuesta_publicada_en   timestamptz;

comment on column resenas_google.respuesta_solicitada_en is
  'El staff pidio publicar el borrador de vuelta en Google. NULL = nadie lo pidio. Un click nuevo '
  'sobre una fila ya solicitada pero no publicada REINTENTA (pisa el timestamp y remite el evento) '
  '-- no hay cola de reintento automatico, el reintento es que el staff vuelva a apretar el boton.';
comment on column resenas_google.respuesta_publicada_en is
  'Confirmado publicado en Google por el orquestador. NULL = no publicado (nunca pedido, pedido y '
  'todavia en curso, o el ultimo intento fallo).';

-- app_user pide la publicacion. Aditivo sobre los grants de columna de 0021/0024 (los privilegios
-- de columna del mismo rol/tabla se ACUMULAN, medido en la 0021 -- no hace falta revocar nada). La
-- politica `resena_marcar_vista` (0021) ya exige `app.puede_escribir()` para CUALQUIER UPDATE de
-- app_user sobre esta tabla -- RLS es por fila, no por columna -- asi que no hace falta una politica
-- nueva, mismo razonamiento que ya documenta la 0024 para `borrador_respuesta`.
grant update (respuesta_solicitada_en) on resenas_google to app_user;

-- app_resenas confirma la publicacion. Aditivo sobre el grant de 0024. La politica
-- `resena_actualizar_borrador_app_resenas` (0024, `using (true) with check (true)`) ya cubre
-- CUALQUIER UPDATE de app_resenas sobre esta tabla -- mismo razonamiento, no hace falta otra.
grant update (respuesta_publicada_en) on resenas_google to app_resenas;

-- -----------------------------------------------------------------------------
-- Confirma la publicacion. Mismo molde que `app.guardar_borrador_resena` (0024): las condiciones
-- van en el WHERE, no en el llamador -- sin `respuesta_solicitada_en is not null` cualquiera con
-- `execute` podria marcar publicada una fila que nadie pidio; sin `respuesta_publicada_en is null`,
-- una confirmacion duplicada (dos corridas del mismo evento, o una carrera) no pisa nada dos veces.
-- -----------------------------------------------------------------------------
create or replace function app.publicar_respuesta_resena(
  p_client_id        uuid,
  p_tenant_id        uuid,
  p_google_review_id text
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
    set respuesta_publicada_en = now()
    where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
      and respuesta_solicitada_en is not null
      and respuesta_publicada_en is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.publicar_respuesta_resena is
  'Confirma que el orquestador publico la respuesta en Google. No marca nada si nadie la pidio o '
  'si ya estaba publicada -- las dos condiciones van en el WHERE. security definer, propiedad de '
  'app_resenas.';

-- -----------------------------------------------------------------------------
-- Trae lo que el orquestador necesita para publicar UNA reseña, cruzando `resenas_google` con
-- `clients` (el refresh token vive ahi). `app_resenas` ya tiene SELECT de
-- `(id, tenant_id, google_location_id, google_refresh_token, archived_at)` sobre `clients` desde
-- la 0022 -- no hace falta un grant nuevo. Cero filas si la solicitud ya no aplica (otra corrida
-- ya publico, o el borrador se borro entretanto): el llamador no distingue el motivo, el evento
-- que dispara esto no porta autoridad (ADR-18), esta funcion es la que decide.
-- -----------------------------------------------------------------------------
create or replace function app.resena_para_publicar(p_resena_id uuid)
returns table (
  client_id          uuid,
  tenant_id          uuid,
  google_review_id   text,
  borrador_respuesta text,
  location_id        text,
  refresh_token      text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.client_id, r.tenant_id, r.google_review_id, r.borrador_respuesta,
         c.google_location_id, c.google_refresh_token
  from resenas_google r
  join clients c on c.id = r.client_id
  where r.id = p_resena_id
    and r.respuesta_solicitada_en is not null
    and r.respuesta_publicada_en is null
    and r.borrador_respuesta is not null;
$$;

comment on function app.resena_para_publicar is
  'Lo que el orquestador necesita para publicar una reseña puntual: el borrador y las credenciales '
  'del cliente. Cero filas si la solicitud ya no aplica (publicada, sin borrador, o no existe) -- '
  'el evento que dispara esto no porta autoridad, esta función decide (ADR-18).';

-- El cambio de dueño, identico a 0022/0024: dos permisos temporales, revocados al final, en ese orden.
grant app_resenas to current_user;
grant create on schema app to app_resenas;

alter function app.publicar_respuesta_resena(uuid, uuid, text) owner to app_resenas;
alter function app.resena_para_publicar(uuid) owner to app_resenas;

revoke execute on function app.publicar_respuesta_resena(uuid, uuid, text) from public;
revoke execute on function app.resena_para_publicar(uuid) from public;
grant execute on function app.publicar_respuesta_resena(uuid, uuid, text) to app_service;
grant execute on function app.resena_para_publicar(uuid) to app_service;

revoke create on schema app from app_resenas;
revoke app_resenas from current_user;
