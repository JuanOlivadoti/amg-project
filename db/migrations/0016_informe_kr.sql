-- =============================================================================
-- AMG OS — 0016: el informe del keyword research, en su propia tabla (KR-2b)
--
-- ## Por qué una tabla y no una columna de `kr_runs`
--
-- Porque **RLS es por fila, no por columna**. El informe lleva el desglose del coste que la agencia le
-- paga a DataForSEO — su margen — y el rol `cliente` (el dueño del negocio) VE los runs de su cliente:
-- `run_select` usa `app.ve_cliente(client_id)`. Una columna en `kr_runs` sería visible para él, y un grant
-- por columna no lo distingue de `equipo`: los dos conectan con el MISMO rol de Postgres (`app_user`), y
-- lo que los separa es la política, que opera sobre filas.
--
-- Ya hubo una fuga de exactamente esta clase con `kr_keywords` (0001_init.sql § kr_keywords) y otra con
-- las notas internas del CRM. Con la fila propia, la fila ES el informe, así que la política puede exigir
-- staff y el `cliente` no recibe la fila — no recibe un 403.
--
-- ## Un informe por run, y lo que eso NO deja preparado
--
-- `run_id` es la PK, así que hay UN informe por run. El día que haga falta una variante para el cliente
-- (el mismo informe sin el bloque de coste) va a necesitar migración igual: la PK pasaría a
-- `(run_id, variante)`. Se dice acá para no dejar escrita la promesa cómoda de que "ya está preparado":
-- no lo está, y creerlo es peor que saberlo.
--
-- ## Numeración: por qué 0016
--
-- `0013_ideas.sql` y `0014_fotos_publicas.sql` están RESERVADAS y sin escribir, en ramas que corren en
-- otra máquina (`docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` §4): un número libre en el
-- disco no es un número libre. Ésta toma el primer número libre después de la 0015.
--
-- No depende de ninguna de sus hermanas reservadas: crea una tabla nueva y no toca `app.nap_publico` (la
-- 0014) ni ninguna tabla que la 0013 vaya a crear, así que da igual en qué orden se apliquen — que es la
-- condición que el programa exige declarar antes de mergear.
-- =============================================================================

-- `create table` PELADO, sin `if not exists`, igual que las 9 tablas de la 0001. El `if not exists` no
-- protege de nada real —`migrarConRegistro` registra el checksum y no re-aplica— y sí esconde un fallo:
-- si `kr_informes` ya existiera con OTRA forma, el `create` no fallaría y los grants y la política se
-- aplicarían silenciosamente a esa tabla ajena. Que reviente es el comportamiento correcto.
create table kr_informes (
  run_id       uuid primary key references kr_runs(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  client_id    uuid not null,
  informe_md   text not null,
  generado_at  timestamptz not null default now(),

  -- Misma FK compuesta que `kr_pages`: la fila no puede MENTIR sobre a qué run/tenant/cliente pertenece.
  -- Sin esto, un `client_id` cualquiera entraría mientras el `run_id` fuera válido, y el informe del
  -- restaurante A quedaría contabilizado contra el cliente B.
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade,

  /*
   * TOPE DE TAMAÑO, en la base y no en un comentario. El informe de 14 páginas mide decenas de KB; el
   * tope está una orden de magnitud arriba, así que solo lo toca un dato patológico (un LLM que devuelve
   * una FAQ de 2 MB). Va acá porque es el ÚNICO punto de escritura: con la constraint puesta, ni el
   * endpoint ni la pantalla necesitan lógica de tamaño — no pueden recibir algo que no entró.
   */
  constraint informe_tamano_razonable check (octet_length(informe_md) <= 262144)  -- 256 KiB
);

alter table kr_informes enable row level security;
alter table kr_informes force  row level security;

-- -----------------------------------------------------------------------------
-- LOS GRANTS. Una política SIN grant no da acceso: Postgres rechaza con 42501 ANTES de evaluar RLS.
--
-- Los grants de este proyecto son listas EXPLÍCITAS por tabla (0001_init.sql para `app_user`, 0002_auth
-- para `app_service`) y no hay `on all tables` ni `alter default privileges` en ninguna migración: **una
-- tabla nueva nace SIN un solo privilegio para nadie**. `kr_informes` es la primera tabla que el proyecto
-- agrega desde que existen los cuatro logins (ADR-17), así que este paso no estaba en ninguna rutina — y
-- la primera versión de la spec se olvidó de él. Lo cazó una review midiéndolo en PGlite: `app_service`
-- recibía 42501 al insertar contra una política que autorizaba filas de una tabla inalcanzable.
--
-- `app_render` NO recibe nada, y eso es la mitad de la decisión de ADR-19: el proceso anónimo es el rol
-- más pobre del sistema y el informe es lo más interno que hay.
-- -----------------------------------------------------------------------------
grant select                         on kr_informes to app_user;     -- la API lee (staff, vía RLS)
grant select, insert, update, delete on kr_informes to app_service;  -- el orquestador escribe

-- -----------------------------------------------------------------------------
-- `app.es_staff()` es una ALLOWLIST POSITIVA que FALLA CERRADO: un rol NULL o desconocido no ve nada.
--
-- NO se usa `app.current_role() is distinct from 'cliente'`, que falla ABIERTO: con un rol ausente,
-- `NULL is distinct from 'cliente'` da TRUE y concedería visibilidad de maestro. Es el bug que
-- 0001_init.sql § FALLAR CERRADO documenta como YA OCURRIDO en este esquema.
-- -----------------------------------------------------------------------------
create policy informe_staff on kr_informes
  for all to app_user, app_service
  using      (tenant_id = app.current_tenant_id() and app.es_staff())
  with check (tenant_id = app.current_tenant_id() and app.es_staff());

comment on table kr_informes is
  'El informe de keyword research ya renderizado en Markdown, tal como se genero. Tabla propia y no una '
  'columna de kr_runs porque RLS es por fila: el informe lleva el coste que la agencia paga a DataForSEO '
  'y el rol cliente ve los runs de su cliente. Solo staff (app.es_staff()). Un informe por run.';
