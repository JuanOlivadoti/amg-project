-- =============================================================================
-- AMG OS — clients.vertical: el rubro del cliente (restauración, correduría de seguros)
--
-- Deliberadamente NO es la columna `tipo` que ya existe (0011_clientes_crm.sql): esa es clasificación
-- CRM de forma jurídica/comercial (empresa/autonomo/particular), enmascarada al rol `cliente` y
-- editable. `vertical` es un atributo de PRODUCTO — determina qué campos de perfil, qué catálogo y qué
-- plantilla de render tiene el cliente — y el rol `cliente` lo necesita sin enmascarar para que su
-- propio portal sepa qué mostrarle.
--
-- Sin default a propósito, mismo criterio que PIPELINE_MODO: una vertical que cae en un valor por
-- omisión es una decisión sin dueño. Backfill EXPLÍCITO para los clientes existentes (todos
-- restaurantes hoy) antes de exigir NOT NULL.
--
-- INMUTABLE tras el alta: no entra a COLUMNAS_EDITABLES (db/src/clientes.ts) ni al tipo CambiosCliente
-- — ver Task 3. Es la forma más simple de que cambiar la vertical de un cliente ya publicado no pueda
-- exponer campos dormidos del otro rubro a través de la allowlist (app.nap_publico, Task 2): si el
-- cambio no existe, no hace falta modelar una transición validada.
--
-- Esa ausencia en TypeScript NO es la garantía completa: `clients` tiene un grant de UPDATE de TABLA
-- para app_user (0001_init.sql), no angostado por columna, así que un `UPDATE clients SET vertical =
-- ...` directo por SQL se saltearía `CambiosCliente` sin que Postgres se diera cuenta. Por eso, más
-- abajo, el trigger `clients_vertical_inmutable` la impone también en la base — mismo patrón que
-- `app.idea_transicion_valida` (0013) y `app.membresias_guardia_telegram` (0026).
-- =============================================================================

set lock_timeout = '5s';

create type app.vertical_cliente as enum ('restauracion', 'correduria_seguros');

alter table clients add column vertical app.vertical_cliente;

-- Backfill explícito, no inferido: todos los clientes de hoy son restaurantes.
update clients set vertical = 'restauracion' where vertical is null;

alter table clients alter column vertical set not null;

-- app_user (la API), app_service (orquestador) y app_render (renderizador público) tienen grants de
-- columna CERRADOS sobre `clients` desde 0021/0022/0007 — agregar una columna a la tabla no la suma
-- a un grant ya angosto, y ESO incluye a app_user: la 0021 revocó su SELECT de tabla completo y lo
-- reemplazó por una lista explícita de columnas (comentario de esa migración, línea ~94-110), así que
-- el `grant select ... on clients ... to app_user` de la 0001 —que el resto de este archivo cita como
-- si todavía rigiera (ver más abajo)— dejó de aplicar en la 0021, tres migraciones antes de que
-- naciera `vertical`. Sin esta línea, Task 3 (db/src/clientes.ts exponiendo `vertical` sin enmascarar
-- en `ClienteCRM`/`CLIENTE_CRM_COLS` para app_user) falla en runtime con "permission denied for table
-- clients" para CUALQUIER lectura del CRM — no solo la de `vertical` — porque el select entero se
-- arma en una sola sentencia. Extendida acá (0029 no está desplegada en ningún lado) en vez de una
-- migración nueva, por ser el mismo grant de columna que ya escribe esta migración para los otros dos
-- roles, dos líneas más abajo.
grant select (vertical) on clients to app_user, app_service, app_render;

-- -----------------------------------------------------------------------------
-- La inmutabilidad, impuesta en Postgres, no solo por ausencia en TypeScript
--
-- `CambiosCliente`/`COLUMNAS_EDITABLES` (db/src/clientes.ts) nunca mencionan `vertical` — pero
-- `clients` tiene un grant de TABLA sin restringir por columna para `app_user`
-- (`grant select, insert, update, delete on clients ... to app_user`, 0001_init.sql), a diferencia de
-- `ideas` (0013) o las columnas de Telegram de `memberships` (0021/0026), que sí angostaron su grant
-- por columna. Sin este trigger, cualquier código futuro bajo `app_user` — un endpoint nuevo, un
-- script, un bug en otra feature — que arme un `UPDATE clients SET vertical = ...` directo se saltea
-- `COLUMNAS_EDITABLES` por completo: RLS gobierna FILAS, no columnas, así que la política
-- `client_write` (0001) lo dejaría pasar igual que cualquier otro `UPDATE` legítimo del staff.
--
-- Mismo patrón que `app.idea_transicion_valida` (0013) y `app.membresias_guardia_telegram` (0026):
-- un trigger BEFORE UPDATE, con `old`/`new` disponibles (cosa que un `with check` de RLS no puede dar
-- limpiamente), que corre INCONDICIONALMENTE sin importar qué política haya dejado pasar la fila.
-- `when (old.vertical is distinct from new.vertical)` limita el disparo al caso que importa: un
-- `UPDATE` que no toca `vertical` (editar el nombre, el score, la carta) sigue funcionando igual.
create or replace function app.vertical_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'clients.vertical es inmutable tras el alta: no se puede cambiar % → % (cliente %)',
    old.vertical, new.vertical, old.id
    using errcode = '23514';  -- check_violation: el onError de la API ya lo mapea a 400, no a 500.
end;
$$;

comment on function app.vertical_inmutable() is
  'Bloquea cualquier UPDATE que cambie clients.vertical, sin importar el rol o la política RLS que '
  'haya dejado pasar la fila. Complementa (no reemplaza) la ausencia de `vertical` en '
  'CambiosCliente/COLUMNAS_EDITABLES: esa ausencia es la única barrera para el camino normal '
  '(PgClientes.actualizarCliente), pero clients tiene un grant de UPDATE de TABLA para app_user '
  '(0001_init.sql), así que un UPDATE directo por SQL evadiría esa capa por completo si no fuera '
  'por este trigger.';

create trigger clients_vertical_inmutable
  before update on clients
  for each row
  when (old.vertical is distinct from new.vertical)
  execute function app.vertical_inmutable();
