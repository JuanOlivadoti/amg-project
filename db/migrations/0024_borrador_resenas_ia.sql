-- =============================================================================
-- AMG OS — 0024: borrador de respuesta con IA para reseñas de Google
-- (Bloque F, fase 2, primera pieza)
--
-- Dos columnas nuevas en `resenas_google` y una tercera función `security definer`, propiedad de
-- `app_resenas` (0022), que es quien las escribe desde el polling. Mismo molde exacto que
-- `app.registrar_resena_google` -- ver el comentario largo de la 0022 para el porqué del baile de
-- dueño.
--
-- El `where` de la función lleva `puntuacion between 4 and 5 and borrador_respuesta is null`, y no
-- es cosmético (hallazgo de la revisión externa de diseño, ver la spec): sin esas dos condiciones,
-- cualquier llamador con `execute` (hoy solo `app_service`, vía el orquestador) podría sobrescribir
-- una edición del staff ya guardada, o escribir un borrador de IA sobre una reseña de 1-3* que el
-- PRD prohíbe tocar con IA. La condición la impone Postgres, no la disciplina del llamador.
--
-- Spec: docs/superpowers/specs/2026-08-18-borrador-ia-resenas-google-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Las dos columnas. `borrador_respuesta` es NULL hasta que se genera (o si la generación falló).
-- `borrador_generado_en` es CUÁNDO se generó -- no cuándo se editó por última vez: la fila no
-- distingue "generado por IA intacto" de "editado por el staff", porque ninguna regla de producto
-- depende hoy de esa distinción.
-- -----------------------------------------------------------------------------
alter table resenas_google
  add column if not exists borrador_respuesta   text,
  add column if not exists borrador_generado_en timestamptz;

comment on column resenas_google.borrador_respuesta is
  'Borrador de respuesta: generado por IA (4-5 estrellas unicamente) o escrito a mano por el staff. '
  'NULL = todavia no hay borrador. Nunca se genera con IA para 1-3 estrellas -- el PRD exige '
  'respuesta humana siempre para esas.';
comment on column resenas_google.borrador_generado_en is
  'Cuando se genero el borrador por ultima vez via IA. NULL si nunca se genero (p. ej. si el staff '
  'lo escribio a mano sobre una reseña cuya generacion habia fallado).';

-- -----------------------------------------------------------------------------
-- Grant de columna para `app_user`, aditivo sobre el `grant update (vista_en)` de la 0021 -- no hace
-- falta revocar ni reotorgar ese (verificado: los privilegios de columna de un mismo rol/tabla se
-- ACUMULAN). La política `resena_marcar_vista` (0021) ya exige `app.puede_escribir()` en su
-- `using`/`with check`; RLS es por fila, no por columna, así que la misma política gobierna también
-- este UPDATE sin necesitar una policy nueva.
-- -----------------------------------------------------------------------------
grant update (borrador_respuesta) on resenas_google to app_user;

-- -----------------------------------------------------------------------------
-- `app_resenas` (0022) gana UPDATE de estas dos columnas + una policy nueva -- hoy solo tenía
-- INSERT y SELECT. El aislamiento NO lo da esta policy (no hay contexto de tenant que mirar, mismo
-- motivo que las de 0022): lo da el `where` de la función de más abajo, que es la superficie real.
-- -----------------------------------------------------------------------------
grant update (borrador_respuesta, borrador_generado_en) on resenas_google to app_resenas;

create policy resena_actualizar_borrador_app_resenas on resenas_google
  for update to app_resenas
  using (true) with check (true);

-- -----------------------------------------------------------------------------
-- La función. Identifica la fila por (client_id, tenant_id, google_review_id) -- la misma clave
-- natural que ya usa `registrar_resena_google` -- para no tener que hacer viajar el `id` interno
-- desde el insert hasta el punto donde se genera el borrador.
-- -----------------------------------------------------------------------------
create or replace function app.guardar_borrador_resena(
  p_client_id        uuid,
  p_tenant_id        uuid,
  p_google_review_id text,
  p_borrador         text
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
    set borrador_respuesta = p_borrador, borrador_generado_en = now()
    where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
      and puntuacion between 4 and 5
      and borrador_respuesta is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.guardar_borrador_resena is
  'Escribe el borrador de IA de una reseña 4-5 estrellas que todavia no tiene uno. No pisa un '
  'borrador existente (de IA o editado por el staff) ni escribe sobre una reseña de 1-3 estrellas: '
  'las dos condiciones van en el WHERE, no en el llamador. security definer, propiedad de app_resenas.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, idéntico a 0022: dos permisos temporales, revocados al final, en ese orden.
-- -----------------------------------------------------------------------------
grant app_resenas to current_user;
grant create on schema app to app_resenas;

alter function app.guardar_borrador_resena(uuid, uuid, text, text) owner to app_resenas;

revoke execute on function app.guardar_borrador_resena(uuid, uuid, text, text) from public;
grant execute on function app.guardar_borrador_resena(uuid, uuid, text, text) to app_service;

revoke create on schema app from app_resenas;
revoke app_resenas from current_user;
