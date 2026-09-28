-- =============================================================================
-- AMG OS — 0034: el nonce del `state` de OAuth es de UN SOLO USO
--
-- La deuda que cierra (abierta desde el Bloque F, fase 1): `EstadoOAuth.nonce`
-- (`api/src/oauth-state.ts`) se generaba en `POST /clients/:id/google/conectar` y NUNCA se
-- invalidaba. Un `state` filtrado —la barra del navegador, el historial, el log de un proxy, un
-- `Referer`— se podía REPRODUCIR cuantas veces se quisiera durante su ventana de 10 minutos
-- (`VENTANA_ESTADO_MS`). Y ese `state` no es un dato cualquiera: lleva `tenantId`/`userId` firmados
-- y es la ÚNICA identidad con la que el callback anónimo escribe `google_refresh_token` en un
-- cliente. La única defensa era que la ventana fuese corta.
--
-- ## Por qué una tabla con `primary key` y no un `select` seguido de un `insert`
--
-- La defensa es la UNICIDAD, impuesta por el índice de la clave primaria. Dos callbacks simultáneos
-- con el mismo `state` (que es exactamente la forma que tiene un replay automatizado) se resuelven
-- DENTRO de Postgres: uno inserta, el otro se lleva un 23505. Un `select ... if (existe) return` en
-- TypeScript, en cambio, es una carrera: los dos leen "no existe" antes de que ninguno haya escrito,
-- y los dos siguen. Mismo criterio que el `on conflict` de `registrarDecision` (`db/src/store.ts`).
-- =============================================================================

create table oauth_nonces_usados (
  -- `uuid` y no `text`: el nonce lo acuña `crypto.randomUUID()` y el tipo es lo que impide que
  -- alguien empiece a meter cadenas arbitrarias como clave de un registro de seguridad.
  nonce      uuid primary key,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  usado_en   timestamptz not null default now()
);

comment on table oauth_nonces_usados is
  'Registro de nonces de `state` de OAuth ya consumidos. La PRIMARY KEY es la garantia: un segundo '
  'callback con el mismo state choca con 23505 y `consumirNonceOAuth` (db/src/resenas.ts) lo '
  'traduce a false, que el handler convierte en 400. Se purga sola -- ver la politica nonce_purga.';

alter table oauth_nonces_usados enable row level security;
alter table oauth_nonces_usados force row level security;

-- -----------------------------------------------------------------------------
-- Grants: los MÍNIMOS. `insert` para quemar el nonce y `delete` para la purga oportunista. NINGÚN
-- `select`, y eso no es decoración:
--
--  * `insert ... ` SIN `returning` no necesita SELECT — por eso `consumirNonceOAuth` detecta el
--    replay por el código de error 23505 y no por un `returning` que contar. Es lo que permite que
--    este rol no pueda LEER jamás la tabla.
--  * `delete from oauth_nonces_usados` SIN `where` tampoco lo necesita: un DELETE solo exige SELECT
--    sobre las columnas que su propio WHERE menciona, y acá el WHERE es la POLÍTICA (abajo), cuya
--    expresión no se evalúa con los privilegios de quien llama.
--
-- Resultado: `app_user` puede quemar un nonce y no puede enumerarlos. Y como no hay ninguna política
-- de SELECT, con `force row level security` un `select` devolvería cero filas aunque el grant
-- existiera — las dos capas apuntan al mismo lado.
-- -----------------------------------------------------------------------------
grant insert, delete on oauth_nonces_usados to app_user;

-- -----------------------------------------------------------------------------
-- Quemar el nonce. `to app_user` explícito (mismo motivo que `resena_select` en la 0021: sin la
-- cláusula `to`, la política aplicaría a PUBLIC).
--
-- Deliberadamente SIN `app.puede_escribir()` y SIN `app.ve_cliente(...)`, y conviene decir por qué,
-- porque es lo contrario de lo que hace toda otra política de escritura del esquema:
--
--  1. Esto no es una escritura de negocio, es un consumo de credencial. Quien completa el
--     consentimiento de Google puede ser un usuario con rol `cliente` (solo lectura, ADR-20): su
--     `conectarGoogle` fallará después, por RLS, como ya falla hoy — pero su nonce TIENE que quedar
--     quemado igual, o el replay sigue abierto justo para el rol menos privilegiado.
--  2. No hay ningún `client_id` acá a propósito. El nonce identifica un `state`, no un cliente; el
--     cliente que ese state nombra ya lo autoriza `conectarGoogle` bajo RLS, y meter `ve_cliente()`
--     acá sería una segunda fuente de la misma verdad.
--
-- Lo que sí se exige es el tenant, como en todas: el nonce que quema el tenant A no puede aterrizar
-- con el `tenant_id` de B. Va en `with check` (no hay `using` posible en un INSERT), así que un
-- intento de marcar otro tenant es un 42501 → 403, no un silencio.
-- -----------------------------------------------------------------------------
create policy nonce_quemar on oauth_nonces_usados
  for insert to app_user
  with check (tenant_id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- La purga, y es una GARANTÍA DE SEGURIDAD disfrazada de limpieza.
--
-- Una fila más vieja que la ventana del `state` no aporta nada: a un nonce de esa edad ya lo rechaza
-- `verificarEstado` por `emitidoEn` antes de que nadie pregunte por esta tabla. Sin borrarlas, la
-- tabla crece para siempre.
--
-- Pero el `using` no dice solo "vieja": dice vieja Y de tu tenant. Sin la condición de edad,
-- `app_user` (o cualquier bug de la API que llegue a ejecutar un DELETE) podría BORRAR UN NONCE
-- RECIÉN QUEMADO y habilitar exactamente el replay que esta migración viene a cerrar. Con ella,
-- des-quemar un nonce vigente es imposible desde la API: lo impide Postgres, no un `if`.
--
-- 1 hora, y no los 10 minutos de `VENTANA_ESTADO_MS`: es un TECHO con holgura, no la caducidad
-- operativa. La caducidad real la impone la firma (`verificarEstado`), y este número solo tiene que
-- ser MAYOR que aquella ventana para que nunca se borre una fila que todavía podría hacer falta.
-- Duplicar acá los 10 minutos exactos ataría dos archivos de dos paquetes al mismo literal, y el día
-- que alguien ampliara la ventana en TypeScript la purga empezaría a borrar nonces vivos sin que
-- nada avisara. `api/src/oauth-state.test.ts` fija la desigualdad.
-- -----------------------------------------------------------------------------
create policy nonce_purga on oauth_nonces_usados
  for delete to app_user
  using (tenant_id = app.current_tenant_id() and usado_en < now() - interval '1 hour');
