-- =============================================================================
-- AMG OS — 0032: kr_publicacion_intentos — el rastro de un intento de publicación
--
-- ## El problema que esto cierra (Bloque C-1 del plan, docs/proyecto/15-plan-plataforma.md)
--
-- El publisher de `web-builder` reporta `published: false` en modo `dry-run` — correctamente: la
-- base no puede afirmar algo que Storyblok no confirmó. Pero eso significaba que NO se escribía
-- nada en la base, y el único rastro era un `log()` dentro del contenedor: "el workflow despertó y
-- publicó en dry-run" era indistinguible de "nunca despertó". Esta tabla es la marca nuestra —
-- cuándo se intentó, cuántas páginas se mandaron y cuántas confirmó el proveedor— SIN afirmar que
-- se publicó. Esa distinción la sigue llevando `published_at` por página (`marcarPublicadas`,
-- `db/src/store.ts`), que esta tabla no reemplaza ni condiciona.
--
-- ## Por qué se escribe en los TRES modos (mock/dry-run/live), no solo en dry-run
--
-- Un caso especial ("solo registrar cuando NO se publicó de verdad") es una rama que alguien puede
-- olvidar mantener el día que se agregue un cuarto modo. Escribir siempre da un rastro UNIFORME: en
-- `live`, esta fila convive con `published_at` por página (dos marcas del mismo intento, una del
-- intento y otra del hecho confirmado); en `dry-run`/`mock` sin páginas confirmadas, esta fila es la
-- ÚNICA prueba de que el paso corrió. El llamador (`workflowDecision`, `orchestrator/src/workflow.ts`)
-- no tiene que decidir SI registrar — siempre lo hace, y decide solo QUÉ contó.
--
-- ## `client_id` denormalizado — mismo motivo que en `kr_run_decisiones`
--
-- La política RLS no se hereda del padre (`kr_run_decisiones.client_id`, comentario de cabecera de
-- `0027_kr_run_decisiones.sql:18-21`, que a su vez repite el de `kr_keywords.client_id`,
-- `0001_init.sql:182-185`): sin el `client_id` acá, un rol `cliente` vería intentos de publicación
-- de OTROS negocios del mismo tenant en cuanto alguna política los expusiera. Se denormaliza desde
-- la decisión en el momento del insert; la FK compuesta abajo impide que diverja de su padre.
--
-- ## Grants: SOLO `app_service`, y por qué
--
-- Quien escribe acá es el orquestador, dentro del paso `publicar` de `workflowDecision` — nunca la
-- API ni un humano. Hoy no hay ningún endpoint de API ni pantalla del portal que necesite LEER esta
-- tabla, así que `app_user` no recibe grant (mismo criterio que el comentario de grants de
-- `0019_marca_solicitud_emitida.sql:53-59`: cada grant se explica, y la ausencia de uno también). Si
-- en el futuro el portal necesita mostrar el historial de intentos, ESE es el momento de agregar
-- `grant select on kr_publicacion_intentos to app_user` — no antes, y no "por si acaso".
--
-- ## `modo` como `text` con `check`, no un enum
--
-- Tres valores conocidos y estables (a diferencia de `destino_run`, que sí es `enum` en 0027 porque
-- el enum ahí modela un dominio con reglas propias en `registrarDecision`). Acá el CHECK es la única
-- validación que hace falta, y el store la pasa como `string` sin duplicar la lista en TypeScript
-- (ver `PgStore.registrarIntentoPublicacion`, `db/src/store.ts`) — un solo lugar de verdad.
--
-- ## Numeración: 0032, sin dependencia de sus hermanas
--
-- Sigue a la `0031_posts_blog_externo.sql`, la última en disco. No depende de ninguna migración
-- reservada: crea una tabla nueva y no toca ninguna existente. Da igual en qué orden se aplique
-- respecto de ramas paralelas que no toquen `kr_run_decisiones`, `tenants` ni esta tabla.
-- =============================================================================

create table kr_publicacion_intentos (
  id                   uuid primary key default gen_random_uuid(),
  decision_id          uuid not null references kr_run_decisiones (id) on delete cascade,
  tenant_id            uuid not null references tenants (id) on delete cascade,
  client_id            uuid not null,
  modo                 text not null check (modo in ('mock', 'dry-run', 'live')),
  paginas_enviadas     int not null check (paginas_enviadas >= 0),
  paginas_confirmadas  int not null check (
                          paginas_confirmadas >= 0 and paginas_confirmadas <= paginas_enviadas
                        ),
  intentado_at         timestamptz not null default now()
);

create index on kr_publicacion_intentos (decision_id, intentado_at desc);

comment on column kr_publicacion_intentos.modo is
  'Se escribe SIEMPRE — mock, dry-run o live — no solo en dry-run: un caso especial por modo es una '
  'rama que alguien olvida mantener cuando se agregue un cuarto modo. El motivo por el que esta '
  'tabla existe (dry-run no deja rastro) es un caso particular de "el rastro es uniforme".';

comment on column kr_publicacion_intentos.client_id is
  'Denormalizado desde kr_run_decisiones, mismo motivo que kr_run_decisiones.client_id '
  '(0027_kr_run_decisiones.sql:18-21): la política RLS no se hereda del padre.';

comment on column kr_publicacion_intentos.paginas_confirmadas is
  'Cuántas confirmó el PROVEEDOR (Storyblok), no cuántas cree el orquestador que mandó. En '
  'dry-run/mock siempre 0 — el publisher no puede afirmar algo que Storyblok no confirmó — y esta '
  'fila es entonces la ÚNICA marca del intento, porque marcarPublicadas (db/src/store.ts) no corre.';

alter table kr_publicacion_intentos enable row level security;
alter table kr_publicacion_intentos force row level security;

-- Mismo check en select e insert (a propósito: no se le agrega app.puede_escribir() porque el
-- GRANT ya es la frontera — ver más abajo por qué eso hace que la política, sola, no baste como
-- guarantía contra roles humanos). Plantilla de estilo: decision_select/decision_write
-- (0027_kr_run_decisiones.sql:58-67).
create policy intento_publicacion_select on kr_publicacion_intentos
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

-- `for insert`, no `for all`: esta tabla es un log de intentos, no se actualiza ni se borra desde la
-- aplicación (no hay grant de update/delete para nadie), así que una política de ALL sería inerte en
-- esas dos operaciones y prestaría a confusión sobre qué se puede hacer acá.
create policy intento_publicacion_insert on kr_publicacion_intentos
  for insert with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

-- Grants: SOLO app_service. app_user NO recibe nada (ver el comentario de cabecera): sin él, un
-- intento de insert desde la API (que no debería existir, pero si existiera por error) falla en el
-- GRANT antes de llegar a evaluar la política — la frontera real contra roles humanos es esta línea,
-- no `intento_publicacion_insert` (que, sola, dejaría escribir a cualquier staff de su propio tenant:
-- app.ve_cliente() da true para 'maestro'/'equipo'/'servicio' sobre cualquier cliente del tenant).
grant select, insert on kr_publicacion_intentos to app_service;
-- app_user: sin grant — ver comentario de cabecera ("si aparece un endpoint o pantalla...").
-- app_render: sin grant — no es un dato público (ADR-19, mismo criterio que kr_runs, 0007:35-36).
-- app_barrido: sin grant — el barrido de runs colgados no tiene nada que hacer con intentos de
-- publicación (mismo criterio que 0019:57-58 sobre solicitud_emitida_at).
