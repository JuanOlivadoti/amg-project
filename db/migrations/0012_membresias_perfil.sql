-- =============================================================================
-- AMG OS — Etapa 1 de la pieza 2 (Usuarios): lectura de membresías + email
--
-- Plan: docs/superpowers/plans/2026-08-01-paginas-usuarios-portal.md ("De dónde sale el email y el
-- nombre"). `memberships` (0001) guarda solo `user_id` -- el email vive en `auth.users`, el esquema
-- de SUPABASE, no nuestro. Esta migración NO lo crea (no es nuestro): asume que YA EXISTE, como pasa
-- en producción. El helper de test (`db/src/testdb.ts`) crea un stand-in MÍNIMO antes de aplicar
-- migraciones, precisamente para que esta suposición sea cierta también en PGlite.
--
-- Dos piezas, las dos con el mismo espíritu que ya usan `app.es_staff()`/`app.ve_cliente()` para
-- `clients` (0001/0011): la garantía vive en SQL, no en un `if` de TypeScript que un caller futuro
-- pueda rodear.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) `usage` sobre el esquema, y NINGÚN grant sobre `auth.users`.
--
-- `usage` sobre el esquema hace falta aparte: a diferencia de `public`, un esquema nuevo (`auth`) NO
-- tiene `usage` concedido a `PUBLIC` por default -- sin esta línea, CUALQUIER referencia a
-- `auth.users` (aunque sea a través de la vista) falla con "permission denied for schema auth". Es
-- justo lo que atrapó el test de este mismo archivo (`membresias.test.ts`) al escribirse: sin el
-- `usage`, hasta el camino LEGÍTIMO fallaba. Deja NOMBRAR el esquema, no leer nada de él.
--
-- Acá vivía `grant select (id, email, raw_app_meta_data) on auth.users to app_user`, y se quitó.
-- El razonamiento original era correcto pero incompleto: un grant POR COLUMNA sí protege lo sensible
-- (`encrypted_password`, `confirmation_token`, `recovery_token`, ...) frente a un `select *` que
-- alguien agregara en el futuro. Solo que eso decide QUÉ COLUMNAS se leen, y el aislamiento que
-- importa acá es de FILAS: quién pertenece a qué tenant lo impone la vista de abajo, no la tabla.
-- Con el grant puesto, saltearse la vista era una fuga CROSS-TENANT -- medido con PGlite: `equipoA`
-- (tenant A) haciendo `select email from auth.users` obtenía 2 filas, incluida la de un usuario del
-- tenant B, mientras la vista le devolvía 1.
--
-- Y nunca hizo falta: una vista sin `security_invoker = true` corre con los permisos de su OWNER, así
-- que `app_user` lee A TRAVÉS de `membresias_perfil` sin tener ningún permiso sobre la tabla base.
-- Quitarlo no rompe el camino legítimo, solo cierra el atajo. Lo fija el test "app_user NO puede leer
-- auth.users directamente", que exige `permission denied` (no cero filas) y cae si alguien repone
-- esta línea.
-- -----------------------------------------------------------------------------
grant usage on schema auth to app_user;

-- -----------------------------------------------------------------------------
-- 2) La vista: `memberships` cruzado con `auth.users`, YA filtrado por tenant y por rol.
--
-- Por qué la visibilidad se resuelve ACÁ y no en TypeScript: `TenantContext` (db/src/store.ts) no
-- tiene un campo `rol` -- el rol se DERIVA de `memberships` (ADR-15), nunca se declara. La única
-- forma de que "un cliente ve solo su propia fila" sea una garantía real (no una convención que
-- alguien puede olvidar) es que la propia consulta la imponga.
--
--   - staff (maestro/equipo/servicio, `app.es_staff()`) ve TODAS las membresías del tenant.
--   - un rol `cliente` ve SOLO su propia fila -- decisión ya cerrada (ver el plan de la pieza 2):
--     NUNCA la lista completa de miembros del tenant, aunque `membership_select` (0001) ya la
--     aislara por tenant -- ese aislamiento es por TENANT, no por rol, y esta vista añade la
--     segunda dimensión.
--   - un rol NULL o desconocido (sin membresía en el tenant) no matchea ninguna fila: ni siquiera
--     entra en el `or`, porque el `where` de tenant ya lo excluye antes de llegar ahí.
--
-- Por qué el `join` NO es una puerta a listar `auth.users` completo: nace de `memberships`, ya
-- restringido por `m.tenant_id = app.current_tenant_id() and (staff u own row)`. `auth.users` solo
-- aporta columnas para las filas de MEMBERSHIPS que ese `where` ya dejó pasar -- no hay ninguna rama
-- que lea `auth.users` sin pasar antes por ese filtro.
-- -----------------------------------------------------------------------------
create view membresias_perfil as
  select
    m.id,
    m.tenant_id,
    m.user_id,
    m.rol,
    m.client_id,
    m.created_at,
    u.email,
    u.raw_app_meta_data
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = app.current_tenant_id()
    and (app.es_staff() or m.user_id = app.current_user_id());

comment on view membresias_perfil is
  'Lectura de memberships + auth.users (email, metadata), YA filtrada por tenant y por rol: staff '
  've todo el tenant, un rol cliente ve solo su propia fila. Ver PgMembresias.listarMiembros '
  '(db/src/membresias.ts) y el test de fuga verificado por mutación en membresias.test.ts.';

grant select on membresias_perfil to app_user;

-- =============================================================================
-- Etapa 2 de la pieza 2 (Usuarios): cambiar el rol de un miembro.
--
-- Se EXTIENDE este archivo (no una 0013 nueva) porque la 0012 todavía no está mergeada ni
-- desplegada a ningún lado -- ver el brief de la Etapa 2. `0013` queda reservado para la pieza 3
-- (Ideas), así que crear una acá hubiera colisionado la numeración entre piezas del mismo programa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3) El problema que hay que resolver ANTES del grant/política: `memberships` es AUTO-REFERENCIAL.
--
-- `app.current_role()`/`app.es_staff()` (0002/0003) YA derivan el rol leyendo `memberships`, y se
-- usan sin problema en las políticas de `clients`/`kr_runs`/etc. -- ahí no hay ciclo porque esas
-- tablas NO son `memberships`.
--
-- Acá sí lo son: una política de SELECT o UPDATE sobre `memberships` que llamara directo a
-- `app.current_role()` haría que esa función corriera un `select ... from memberships`, que a su vez
-- tiene que volver a evaluar TODAS las políticas de `memberships` -- incluida esa misma -- para
-- decidir qué filas son visibles. Es geniunamente recursivo, y NO es un CTE con caso base: se midió
-- (un experimento con PGlite, fuera del repo) que el motor NO corta el ciclo por evaluación perezosa
-- del `or` entre políticas -- se cuelga/crashea el proceso, no lanza un error de Postgres legible.
--
-- La 0003 ya dejó un comentario exactamente sobre este riesgo en `membership_select`
-- ("Ojo con la recursión... si lo hiciera, Postgres entraría en recursión infinita"). Esta función es
-- la manera segura de tener, DENTRO de una política de `memberships`, la misma pregunta ("¿qué rol
-- tiene el que pregunta, en su PROPIA fila?") sin reabrir ese ciclo: una bandera de sesión corta la
-- SEGUNDA entrada (la que la propia política dispara al volver a evaluarse desde adentro) antes de
-- que se repita una tercera vez. La primera entrada (la real) sigue completando su trabajo con
-- normalidad, porque la propia fila del que pregunta YA es visible por `membership_select` (own-row,
-- sin llamar a ninguna función) -- ese caso base no necesita la bandera para resolverse.
--
-- Para cualquier OTRA tabla del sistema, seguir usando `app.current_role()`/`app.es_staff()` de
-- siempre: esta variante es SOLO para políticas que viven sobre `memberships`.
-- -----------------------------------------------------------------------------
create or replace function app.rol_propio_sin_recursion() returns text
language plpgsql stable as $$
declare
  r text;
begin
  if current_setting('app.resolviendo_rol_propio', true) = '1' then
    return null; -- corta el ciclo: NO autoriza (ver el comentario de arriba) -- falla cerrado.
  end if;
  perform set_config('app.resolviendo_rol_propio', '1', true);
  -- Doble cierre, mismo criterio que app.current_role() (0003, comentario "Doble cierre"): la
  -- constraint membresia_no_es_servicio ya impide insertar rol='servicio', pero esta función no
  -- debería depender de esa única capa -- si esa constraint fallara o se sacara, una fila
  -- 'servicio' colada acá NO debe poder pasar membership_select_staff como si fuera staff humano.
  -- Allowlist HUMANA explícita, no "todo lo que no sea NULL".
  select rol::text into r
    from memberships
    where tenant_id = app.current_tenant_id()
      and user_id = app.current_user_id()
      and rol in ('maestro', 'equipo', 'cliente');
  perform set_config('app.resolviendo_rol_propio', '0', true);
  return r;
end;
$$;

comment on function app.rol_propio_sin_recursion() is
  'Variante de app.current_role(), SOLO para políticas sobre `memberships` (auto-referencial). Usa '
  'una bandera de sesión para no recursar infinitamente al re-evaluar las políticas de la propia '
  'tabla. Mismo doble cierre que app.current_role() (allowlist maestro/equipo/cliente -- servicio '
  'nunca sale de acá, ni siquiera si la constraint membresia_no_es_servicio fallara). Para cualquier '
  'otra tabla, usar app.current_role()/app.es_staff().';

-- -----------------------------------------------------------------------------
-- 4) Visibilidad ampliada para staff, DIRECTO sobre la tabla (no solo vía la vista).
--
-- `membership_select` (0003) restringe a "propia fila" -- lo justo para cerrar la FUGA 1 (un
-- `cliente` enumerando toda la cartera). Pero un UPDATE necesita que la fila VIEJA pase alguna
-- política de SELECT/ALL para poder afectarla -- no alcanza con la política de UPDATE sola (medido:
-- una política `for update using (true)` sin ninguna política de SELECT que la acompañe deja 0 filas
-- visibles, silenciosamente). Sin esto, ni el propio `maestro` podría cambiarle el rol a otro.
--
-- Esta política agrega esa visibilidad SOLO para staff (maestro/equipo/servicio) -- un `cliente`
-- sigue viendo nada más que su propia fila (rol_propio_sin_recursion() nunca da 'cliente' acá adentro
-- porque no está en la lista): la fuga que cerró la 0003 sigue cerrada.
-- -----------------------------------------------------------------------------
create policy membership_select_staff on memberships
  for select
  using (
    tenant_id = app.current_tenant_id()
    and app.rol_propio_sin_recursion() in ('maestro', 'equipo', 'servicio')
  );

-- -----------------------------------------------------------------------------
-- 5) El grant de escritura. Antes memberships era SOLO LECTURA para app_user (0001 lo dice
-- explícito: "no se escriben desde la app"). Esta etapa lo cambia para UNA operación puntual: cambiar
-- el rol de un miembro. ADR-17 prohíbe que `amg_api` (→ solo `app_user`, NOINHERIT) asuma ningún otro
-- rol para hacerlo -- así que `app_user` necesita este grant, no un login aparte.
-- -----------------------------------------------------------------------------
grant update (rol, client_id) on memberships to app_user;

-- -----------------------------------------------------------------------------
-- 6) La política de escritura -- el punto más fino de esta etapa.
--
-- `using` SOLO exige tenant (no rol): así un `equipo` SÍ "ve" la fila que intenta tocar (mismo
-- tenant) -- no lo filtra en silencio. `with check` exige, ADEMÁS, que quien pregunta sea `maestro`.
--
-- Por qué importa el orden: si la condición de rol viviera en `using`, un `equipo` ni siquiera vería
-- la fila -- 0 filas afectadas, sin excepción, y la API lo traduce como 404 ("no encontrado"). Con la
-- condición en `with check`, la fila SÍ se alcanza (pasa `using`), pero el resultado post-update
-- falla el chequeo -- Postgres lanza 42501 (`insufficient_privilege`), que el `onError` de la API YA
-- mapea a 403. Es la diferencia entre "no existe" y "no tenés permiso", y el brief pide
-- explícitamente el segundo para un `equipo` que intenta repartir roles.
--
-- Un `cliente` que lo intentara tampoco pasaría `with check` (tampoco es 'maestro') -- mismo 403.
-- Un intento contra OTRO tenant sí lo filtra `using` (0 filas, silencioso) -- correcto: no hay que
-- revelar si la fila existe en un tenant ajeno, mismo criterio que el resto de la API (ver
-- PATCH /clients/:id, que da el mismo 404 para "de otro tenant" y para "no existe").
--
-- `user_id <> app.current_user_id()`: la auto-degradación (un maestro cambiándose el rol A SÍ
-- MISMO) también queda prohibida, y ACÁ -- no solo en la API. La API la resuelve comparando el
-- `:userId` de la ruta contra `ctx.userId` (una comparación de identidad, no una decisión de rol —
-- ver `api/src/app.ts`), pero esta condición es la que hace que la garantía no dependa de que nadie
-- se olvide de ese `if`: aunque algo llame a `cambiarRol` sin pasar por la API, la base igual lo
-- rechaza con 42501.
-- -----------------------------------------------------------------------------
create policy membership_update on memberships
  for update
  using (tenant_id = app.current_tenant_id())
  with check (
    tenant_id = app.current_tenant_id()
    and app.rol_propio_sin_recursion() = 'maestro'
    and user_id <> app.current_user_id()
  );

comment on policy membership_update on memberships is
  'using SOLO tenant (para que un equipo "vea" la fila y el rechazo sea 403, no 404 -- ver el '
  'comentario arriba); with check exige además ser maestro Y que no sea su propia fila '
  '(auto-degradación prohibida en la base, no solo en la API). cliente_exige_client_id (0001) sigue '
  'aplicando sobre el resultado: pasar a rol cliente sin client_id, o dejarlo con un rol distinto de '
  'cliente, sigue fallando por esa constraint (23514 -> 400).';

-- -----------------------------------------------------------------------------
-- 7) "Siempre queda un maestro", impuesto en la BASE -- un `check` no alcanza porque mira UNA fila;
-- esta garantía depende del CONJUNTO (¿queda algún maestro en el tenant, después del cambio?). Va con
-- un trigger AFTER, para que el conteo se haga sobre el estado YA aplicado.
--
-- `for each row ... when (old.rol = 'maestro')`: solo dispara si la fila que cambió (o se borró) YA
-- era maestro -- tocar la fila de un `equipo` no dispara ningún chequeo, ahorra el conteo en el caso
-- común. `after update or delete`: cubre las dos formas de perder un maestro (degradarlo o borrar su
-- membresía) -- hoy solo el UPDATE es alcanzable desde la API (no hay endpoint de borrado de
-- membresías en esta etapa), pero la garantía tiene que sostenerse para cualquier camino futuro, no
-- solo el que existe hoy.
--
-- El `select` de adentro corre como quien hizo el UPDATE (la función NO es security definer) -- para
-- un `maestro` (el único que puede llegar hasta acá, ver membership_update) eso es exactamente lo que
-- hace falta: `membership_select_staff` ya le da visibilidad de TODO el tenant, así que el conteo ve
-- a todos los maestros que quedan, no solo al que él mismo pueda ver por su propia fila.
--
-- Verificado por mutación: se sacó el trigger, corrió `db/src/membresias.test.ts` y el test "quitar
-- el último maestro falla" pasó a fallar (el update se completaba) -- se repuso el trigger y el
-- mismo test volvió a pasar. Ver `.superpowers/sdd/etapa-2-report.md`.
--
-- CONCURRENCIA (la condición que ADR-24 pone explícita: el trigger tiene que sobrevivir a dos
-- degradaciones simultáneas). Contar no alcanza si dos transacciones cuentan a la vez. Con dos
-- maestros M1 y M2, en READ COMMITTED (el default, y lo que usa `Tx`):
--
--   T1 degrada a M2 -> cuenta -> ve a M1 todavía maestro (el cambio de T2 no está commiteado) -> OK
--   T2 degrada a M1 -> cuenta -> ve a M2 todavía maestro (el cambio de T1 no está commiteado) -> OK
--   commit, commit -> el tenant se quedó con CERO maestros, y cada transacción "verificó" que no.
--
-- No hay conflicto de filas que las serialice: cada una toca una fila distinta. Por eso hace falta un
-- punto de serialización EXPLÍCITO, y va antes de contar: el segundo en llegar espera, y cuando entra
-- su `select` es un statement nuevo -- en READ COMMITTED eso significa snapshot nuevo, que YA incluye
-- lo que el primero commiteó. Ahí sí ve cero maestros y falla, que es lo correcto.
--
-- Por qué un advisory lock y no `select ... for update` sobre `memberships`: `for update` exige el
-- privilegio UPDATE **de tabla**, y `app_user` tiene solo el grant POR COLUMNA (`update (rol,
-- client_id)`) -- pedirlo rompería el camino legítimo, o forzaría a ampliar el grant, que es
-- justamente lo que no queremos. Tampoco sirve bloquear la fila de `tenants` (mismo problema de
-- privilegios). Los advisory locks los puede tomar cualquiera, no necesitan grant, y `_xact_` los
-- suelta solo al terminar la transacción -- sin `unlock` que alguien pueda olvidar en un camino de
-- error.
--
-- La clave es POR TENANT, no global: dos agencias distintas no se hacen cola entre sí. El primer
-- argumento es un espacio de nombres (para no chocar con cualquier otro advisory lock del sistema),
-- el segundo identifica al tenant.
--
-- Lo que este arreglo NO tiene es un test que reproduzca la carrera: PGlite es un solo backend, así
-- que no hay dos transacciones simultáneas que interleavear. Lo que el test SÍ fija es que el punto
-- de serialización existe y es por tenant (lock tomado, clave distinta para tenants distintos) --
-- cae si alguien saca esta línea. La carrera en sí es semántica documentada de READ COMMITTED, no
-- una conjetura, pero conviene saber que está razonada y no medida.
-- -----------------------------------------------------------------------------
create or replace function app.verificar_ultimo_maestro() returns trigger
language plpgsql as $$
declare
  tid uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  perform pg_advisory_xact_lock(hashtext('memberships_ultimo_maestro'), hashtext(tid::text));
  if not exists (select 1 from memberships where tenant_id = tid and rol = 'maestro') then
    raise exception 'El tenant % se quedaría sin ningún maestro.', tid
      using errcode = '23514'; -- check_violation: el onError de la API ya lo mapea a 400.
  end if;
  return null; -- trigger AFTER: el valor de retorno se ignora.
end;
$$;

comment on function app.verificar_ultimo_maestro() is
  'Garantía "siempre queda un maestro", como trigger y no como CHECK: un CHECK de columna/tabla mira '
  'UNA fila, y esta garantía depende del CONJUNTO (¿queda algún maestro en el tenant?). Toma un '
  'advisory lock POR TENANT antes de contar: sin él, dos degradaciones simultáneas se aprueban entre '
  'sí y el tenant se queda con cero maestros (ver el comentario de arriba, y ADR-24). Ver también el '
  'comentario del trigger memberships_ultimo_maestro para la verificación por mutación.';

create trigger memberships_ultimo_maestro
  after update or delete on memberships
  for each row
  when (old.rol = 'maestro')
  execute function app.verificar_ultimo_maestro();
