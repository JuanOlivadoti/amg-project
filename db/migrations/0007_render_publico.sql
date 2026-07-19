-- =============================================================================
-- AMG OS — El renderizador (ADR-19) y el caso que el modelo de seguridad no tenía
--
-- ## El agujero conceptual
--
-- ADR-15 cerró OBS-02 con una regla tajante: **el rol no se declara, se DERIVA de `memberships`**.
-- Funciona porque hasta hoy todo el que llamaba a la base era, o una persona autenticada, o un
-- proceso con credencial propia. Los dos tienen identidad.
--
-- **El renderizador atiende a alguien que no tiene ninguna.** Un navegante que abre la web de un
-- restaurante no tiene usuario, ni tenant, ni membresía. `app.current_role()` le devuelve NULL —
-- que es la respuesta CORRECTA y lo deja sin poder leer una sola fila. O sea: el modelo no estaba
-- mal, simplemente no cubría este caso, y había que decidirlo en vez de resolverlo con la
-- service-role "porque es más fácil".
--
-- ## La decisión: el DOMINIO es la autorización
--
-- No hay tenant que setear porque no hay a quién preguntárselo. Lo único que el visitante aporta es
-- el `Host` de su petición, y eso alcanza: si el dominio está publicado, su contenido ES público —
-- esa es la definición de publicar. La política de abajo no menciona `app.current_tenant_id()` a
-- propósito. Sería teatro: el renderizador podría poner el tenant que quisiera, porque es él quien
-- lo derivaría del dominio. Un control que el controlado se autoexpide no es un control.
--
-- Lo que SÍ es real es el recorte de privilegios, y por eso este rol es el más pobre del sistema.
--
-- ## Por qué importa que sea el más pobre
--
-- El renderizador es la ÚNICA pieza expuesta a internet anónimo. La API exige un JWT; el
-- orquestador no atiende a nadie de afuera. Este atiende a cualquiera. Es, por lejos, la superficie
-- más probable de un compromiso — así que la pregunta de diseño no es "¿qué necesita?" sino "si me
-- lo toman, ¿qué se llevan?".
--
-- Con los grants de abajo, se llevan: qué dominios hay, en qué space de Storyblok vive cada uno, y
-- el NAP del negocio — que ya está impreso en el JSON-LD de cada página pública. Es decir, se
-- llevan lo que ya era público. NO se llevan: `kr_runs`, `kr_pages`, `kr_keywords`, `memberships`,
-- `tenants`, ni las caches del proveedor (o sea, qué investigó cada cliente y cuánto costó).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El dominio del cliente
--
-- Se guarda SIEMPRE en minúsculas y sin puerto: el `Host` que manda un navegador no tiene forma
-- canónica (`Example.COM`, `example.com:443` y `example.com` son el mismo sitio), y si la
-- normalización viviera solo en TypeScript, una fila insertada a mano por otra vía dejaría un
-- dominio inalcanzable — o peor, dos filas compitiendo por el mismo host.
--
-- `unique` sin `where`: dos clientes NO pueden reclamar el mismo dominio ni aunque uno esté
-- archivado. Es deliberado. Si un cliente se va y otro toma su dominio, que sea un acto explícito
-- (liberar y reasignar), no una carrera que resuelve el `order by` de una query.
-- -----------------------------------------------------------------------------
alter table clients
  add column if not exists domain text;

alter table clients
  add constraint clients_domain_canonico
  check (domain is null or (domain = lower(domain) and domain !~ ':' and length(domain) between 4 and 253));

create unique index if not exists clients_domain_key on clients (domain);

comment on column clients.domain is
  'Dominio publico donde el renderizador (ADR-19) sirve la web de ESTE cliente. En minusculas y '
  'sin puerto. NULL = el cliente todavia no tiene web publicada. Es la clave que el renderizador '
  'usa como AUTORIZACION: no hay usuario ni tenant del otro lado.';

-- -----------------------------------------------------------------------------
-- Los tokens de la Content Delivery API, que NO son la misma clase de cosa
--
-- Storyblok emite dos tokens de lectura por space, y la diferencia importa:
--
--   · **público** — lee solo contenido PUBLICADO. En cualquier setup normal de Storyblok viaja en
--     el bundle del navegador. No es un secreto y tratarlo como tal es teatro.
--   · **preview**  — lee BORRADORES. Es lo que el Visual Editor necesita, y con él se lee lo que un
--     cliente escribió y todavía no publicó. Esto SÍ es un secreto.
--
-- Los dos son legibles por `app_render`, y hay que decir por qué en vez de disimularlo: el
-- renderizador tiene que servir la URL de preview del Visual Editor (es la razón por la que ADR-19
-- eligió runtime sobre estático), y para eso necesita el token de preview. **O sea que el token de
-- borradores está dentro del radio de explosión del servicio más expuesto.** Es el costo real de la
-- decisión de ADR-19, y se paga a sabiendas.
--
-- Lo que lo hace tolerable no es el grant, es lo que protege el borrador aguas arriba: servir draft
-- exige una firma de preview válida (ver `renderer/src/preview.ts`), así que tener el token no
-- alcanza para pedirle un borrador al renderizador. Y lo que se filtraría en el peor caso son
-- borradores de páginas de restaurante, no credenciales de escritura: la Management API —la que
-- puede MODIFICAR el space— nunca entra acá. Esa vive en el orquestador y `app_render` no la ve.
-- -----------------------------------------------------------------------------
alter table clients
  add column if not exists storyblok_public_token text,
  add column if not exists storyblok_preview_token text;

comment on column clients.storyblok_public_token is
  'Token de lectura de contenido PUBLICADO (Content Delivery API). No es un secreto: en un setup '
  'normal de Storyblok viaja en el bundle del navegador.';

comment on column clients.storyblok_preview_token is
  'Token de lectura de BORRADORES. SI es un secreto. Lo necesita el Visual Editor (ADR-19) y por '
  'eso lo ve el renderizador; servir draft exige ademas una firma de preview valida.';

-- -----------------------------------------------------------------------------
-- El rol del renderizador
--
-- Mismo patrón que 0003: un login por proceso, NOINHERIT, autorizado a UN rol. `amg_render` no
-- puede hacer `set role app_user` ni `app_service` — Postgres lo rechaza, no es que el código se
-- porte bien.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_render') then
    create role app_render nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'amg_render') then
    create role amg_render login noinherit;
  end if;
end $$;

grant app_render to amg_render;
grant usage on schema public, app to app_render;

-- OJO: `execute on all functions in schema app` NO se concede acá, al revés que a los otros roles.
-- Ese schema tiene `app.current_role()` y compañía, que existen para derivar autoridad desde una
-- membresía. El renderizador no tiene ninguna y no debe poder preguntar por la de nadie.

-- -----------------------------------------------------------------------------
-- El grant, por COLUMNA
--
-- Postgres sabe conceder select sobre columnas concretas, y es exactamente la herramienta que hace
-- falta: `clients` tiene `prompt_negocio` (el brief comercial que el cliente escribió) y
-- `market_country`, que no son asunto de un visitante anónimo.
--
-- Un `select *` desde este rol FALLA — no devuelve las columnas permitidas y calla las otras. Es
-- ruidoso a propósito: prefiero que se rompa una query a que se filtre una columna que alguien
-- agregue dentro de seis meses sin acordarse de este archivo. El default de una tabla que crece
-- tiene que ser "no visible".
-- -----------------------------------------------------------------------------
grant select (id, domain, storyblok_space_id, storyblok_public_token, storyblok_preview_token,
              business_profile, market_language)
  on clients to app_render;

-- -----------------------------------------------------------------------------
-- La política
--
-- `domain is not null` es lo que impide enumerar la cartera: un cliente sin web publicada no
-- existe para este rol. Y `archived_at is null` hace que dar de baja a un cliente APAGUE su web sin
-- ningun paso extra — el offboarding de ADR-11 no depende de que alguien se acuerde de tocar el
-- renderizador.
--
-- No hay `with check`: este rol no tiene insert, update ni delete sobre nada. Ni acá ni en ninguna
-- otra tabla del esquema.
-- -----------------------------------------------------------------------------
-- Antes de agregar la política nueva hay que acotar las viejas. Ver el bloque de abajo.
drop policy if exists client_select on clients;
drop policy if exists client_write on clients;

create policy client_select on clients
  for select to app_user, app_service
  using (tenant_id = app.current_tenant_id() and app.ve_cliente(id));

create policy client_write on clients
  for all to app_user, app_service
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir());

-- -----------------------------------------------------------------------------
-- POR QUÉ HUBO QUE TOCAR LAS POLÍTICAS DE 0001 (lo encontró el test, no yo)
--
-- `client_select` y `client_write` se crearon sin cláusula `to`, o sea que aplican a PUBLIC — a
-- todos los roles, incluido uno que no existía cuando se escribieron. Y las dos llaman a
-- `app.ve_cliente()`, que por dentro lee `memberships`.
--
-- Las políticas de un mismo comando se combinan con OR, así que uno espera que "la mía da true,
-- listo". **No es así: si CUALQUIERA de las políticas aplicables lanza, la query entera muere.**
-- `app_render` no tiene execute sobre `app` ni select sobre `memberships` (a propósito), así que
-- evaluar `client_select` daba `42501 permission denied for table memberships` — y el renderizador
-- no podía leer ni la fila que su propia política le autorizaba.
--
-- Lo que más me interesa de esto: si le hubiera concedido `execute on all functions in schema app`
-- —que es lo que hacen los otros tres roles, y lo que iba a copiar por inercia— **habría
-- funcionado en silencio**. `app.current_tenant_id()` sería NULL, la política vieja daría false, la
-- nueva true, y el OR resolvía. Nunca me habría enterado de que el rol público estaba evaluando
-- políticas pensadas para usuarios autenticados, ni de que leía `memberships` en cada visita a la
-- web de un restaurante. El fallo ruidoso es lo que hizo visible el acoplamiento.
--
-- Conclusión que vale para la próxima política: **una política sin `to` es una política que aplica
-- a roles que todavía no existen.** Nombrar el rol no es verbosidad, es acotar el alcance.
-- -----------------------------------------------------------------------------

drop policy if exists client_render_select on clients;

create policy client_render_select on clients
  for select to app_render
  using (domain is not null and archived_at is null);

comment on policy client_render_select on clients is
  'ADR-19. El renderizador ve SOLO clientes con dominio publicado y no archivados, y solo las '
  'columnas del grant. No filtra por tenant a proposito: el visitante no tiene uno, y un filtro '
  'que el propio renderizador rellenaria no controla nada.';
