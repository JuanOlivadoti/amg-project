-- =============================================================================
-- AMG OS — 0018: un run no puede quedarse en `running` para siempre
--
-- ## El problema, medido en producción el 2026-08-07
--
-- Un run nace en `running` (`POST /runs`: la fila primero, el evento después — ADR-18). Si nadie
-- consume el evento, o si el workflow muere de una forma que su `onFailure` no puede registrar, el
-- run se queda en `running` PARA SIEMPRE. Y el `onFailure` no puede registrarlo justo cuando más
-- falta hace: su única acción es `failRun()`, o sea **escribir en la misma base que no responde**.
-- La red de seguridad comparte su punto de fallo con lo que protege.
--
-- El único plazo del sistema, `PLAZO_APROBACION` (`orchestrator/src/workflow.ts`), vive DENTRO del
-- workflow: si el workflow no arranca, no hay reloj. Hace falta un reloj de afuera.
--
-- ## Por qué una función `security definer` y no un `select` desde el store
--
-- Es la PRIMERA `security definer` del proyecto, así que el motivo va escrito y no supuesto.
--
-- RLS en `kr_runs` exige `tenant_id = app.current_tenant_id()`: un barrido es cross-tenant por
-- naturaleza y ninguna sesión con identidad puede hacerlo. Enumerar tenants desde afuera tiene el
-- mismo problema (la política de `tenants` es igual de estricta). La alternativa —darle al
-- orquestador un rol que vea TODOS los tenants— sería muchísimo más ancha: valdría para cualquier
-- query, no solo para ésta.
--
-- Confinar el privilegio a UNA función cuyo cuerpo entero es "expirar runs vencidos" concede algo
-- que **no puede filtrar datos** (devuelve ids y tenant_ids, nada del research ni del prompt) y que
-- **no puede hacer otra cosa** (el cuerpo es fijo; el único parámetro es el plazo).
--
-- ## `set search_path` explícito: sin eso, una `security definer` es una escalada clásica
--
-- Una función `security definer` corre con los privilegios de su DUEÑO. Si el `search_path` lo
-- pusiera el llamador, podría anteponer un schema propio con un `now()` o un operador falsos y
-- hacérselos ejecutar al dueño. `pg_catalog` va PRIMERO para que nada de `public` pueda tapar un
-- builtin.
--
-- =============================================================================
-- ## El dueño de la función NO puede ser quien corre la migración. Medido.
-- =============================================================================
--
-- Ésta es la parte contraintuitiva, y es la que separa "funciona en los tests" de "funciona en
-- producción":
--
--   · `kr_runs` lleva `force row level security` (0001), y FORCE significa que **ni el dueño de la
--     tabla salta las políticas**.
--   · En PGlite las migraciones corren como `postgres`, que ahí **sí es superusuario** — y un
--     superusuario salta RLS pase lo que pase. Medido: una `security definer` de su propiedad expira
--     los dos runs colgados sin problema.
--   · En Supabase alojado, **`postgres` NO es superusuario**. Este repo ya lo pagó una vez: poner
--     `force` + cero políticas sobre `app.migraciones_aplicadas` auto-bloqueó al propio runner de
--     migraciones (ver el comentario de esa tabla). O sea que en producción el dueño SÍ está sujeto
--     a RLS.
--
-- Si la función quedara con el dueño por defecto, el barrido **daría verde en los tests y devolvería
-- CERO FILAS en producción**, en silencio, que es exactamente el modo de fallo que este proyecto
-- persigue. Por eso la función pertenece a un rol propio, `app_barrido`, cuyo permiso para cruzar
-- tenants es una POLÍTICA explícita y no un privilegio implícito del dueño. Así el comportamiento es
-- el mismo en PGlite y en Supabase, y además es AUDITABLE: se lee en `pg_policies`.
--
-- `app_barrido` no es un cuarto proceso y no contradice ADR-17 ("un proceso, un login, un rol"): no
-- tiene login, ningún login lo tiene concedido (hay un test que lo exige con `pg_has_role(...,
-- 'SET')`) y no hay forma de llegar a él salvo llamando a esta función.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El dueño de la función: un rol SIN login, con la política más estrecha que permite el trabajo.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_barrido') then
    create role app_barrido nologin;
  end if;
end $$;

grant usage on schema public, app to app_barrido;

/*
 * Grants POR COLUMNA, no por tabla.
 *
 * Aunque nadie pueda asumir este rol, lo que se le concede define el peor caso. Leer: las cuatro
 * columnas que el barrido necesita para decidir (y ninguna es dato de cliente — ni `prompt`, ni el
 * coste, ni la config). Escribir: las tres que marca la expiración.
 *
 * `client_id` NO está, y sin embargo las políticas de 0001 lo mencionan (`app.ve_cliente(client_id)`):
 * medido, la evaluación de una política NO exige privilegio de columna. Los grants acotan lo que el
 * rol puede pedir, no lo que el motor mira para decidir.
 */
grant select (id, tenant_id, status, created_at) on kr_runs to app_barrido;
grant update (status, error, finished_at)        on kr_runs to app_barrido;

/*
 * Y este grant, que parece de más, NO lo es — y no sirve para leer nada.
 *
 * Las políticas `run_select` / `run_write` de 0001 se crearon SIN cláusula `to`, así que aplican a
 * PUBLIC: también a `app_barrido`. Sus expresiones llaman a `app.ve_cliente()` → `app.current_role()`
 * → que hace un `select` sobre `memberships`. Sin este grant, **evaluar la política ajena aborta la
 * sentencia entera** con `permission denied for table memberships` (medido: es lo primero que falló).
 *
 * Lo que `app_barrido` ve realmente de `memberships` es CERO FILAS: `membership_select` exige
 * `tenant_id = app.current_tenant_id()`, y el barrido corre sin ningún contexto de tenant. Por eso
 * `app.current_role()` le da NULL y `app.es_staff()` le da **NULL, no FALSE** (medido: `NULL in
 * ('maestro','equipo','servicio')` es NULL) — que en una política es lo mismo que FALSE, porque solo
 * TRUE concede. La allowlist positiva de 0001 falla cerrado también para este rol. Hay un test que
 * lo exige, y exige el NULL: escribir `false` acá sería una afirmación no medida sobre el motor.
 */
grant select on memberships to app_barrido;

/*
 * ## Las DOS políticas, y por qué la de SELECT es obligatoria
 *
 * Medido en PostgreSQL **16.4 y 18.3** —los dos majors que corren en este repo (`db/` y `api/`)— y no
 * en uno solo, porque el comportamiento del motor no se extrapola de un major al otro. Da idéntico en
 * los dos, y es un default que NO se puede suponer:
 *
 *  · **Sin ninguna política de SELECT, el UPDATE afecta CERO filas.** Un UPDATE con `where` tiene que
 *    poder VER la fila vieja, y eso lo gobiernan las políticas de SELECT.
 *  · **La política de SELECT se aplica también a la fila NUEVA**, con o sin `RETURNING`. Con
 *    `for select using (status = 'running')` el UPDATE a `failed` muere con *"new row violates
 *    row-level security policy"*: la fila se estaría actualizando hacia la invisibilidad.
 *
 * De ahí `status in ('running', 'failed')`: los dos únicos estados que el barrido toca, el de antes
 * y el de después. Nada más. Un `using (true)` habría funcionado igual y le habría dado al rol
 * visibilidad sobre todos los runs de la plataforma.
 */
create policy run_barrido_ve on kr_runs
  for select to app_barrido
  using (status in ('running', 'failed'));

/*
 * La política que concede el cruce de tenants, y lo hace en UNA dirección sola.
 *
 * `using` = qué filas puede tocar: solo las que están corriendo. `with check` = en qué se pueden
 * convertir: solo en `failed`. Este rol no puede aprobar un run, ni resucitarlo, ni devolverlo a
 * `running`. La única transición que existe para él es la que el barrido necesita.
 *
 * El plazo NO va acá a propósito: es del llamador (`PLAZO_RUN_COLGADO` en `db/src/store.ts`, con su
 * test), no del esquema. Meterlo en la política lo congelaría en una migración y haría falta otra
 * para cambiarlo.
 */
create policy run_barrido_expira on kr_runs
  for update to app_barrido
  using      (status = 'running')
  with check (status = 'failed');

-- -----------------------------------------------------------------------------
-- Índice parcial: el barrido pregunta por lo que casi nunca hay.
--
-- La condición del `where` es la del propio índice, así que el índice solo contiene los runs vivos —
-- unos pocos en cualquier momento— y no crece con el histórico. Sin él, cada pasada del barrido es un
-- seq scan sobre todos los runs que la plataforma haya hecho jamás.
-- -----------------------------------------------------------------------------
create index if not exists kr_runs_colgados
  on kr_runs (status, created_at)
  where status = 'running';

-- -----------------------------------------------------------------------------
-- La función.
--
-- `plpgsql` y no `sql` por una sola línea: el `raise` del piso del plazo. Un `language sql` no puede
-- rechazar un argumento, y acá un argumento malo no da error — da un desastre silencioso.
-- -----------------------------------------------------------------------------
create or replace function app.expirar_runs_colgados(plazo interval)
returns table (id uuid, tenant_id uuid)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  /*
   * El piso del plazo, impuesto por la BASE y no por quien llama.
   *
   * Esta función es el único punto del sistema que puede escribir en los runs de TODOS los tenants.
   * Con `plazo => '0 seconds'` mataría todos los runs vivos de la plataforma, incluido el que arrancó
   * hace un segundo — y sería una llamada perfectamente válida.
   *
   * El piso sale del mismo dato que el default: la única duración real medida de un research es
   * **16m15s** (2026-07-30, contra DataForSEO producción). Una hora es ~3,7x eso: por debajo de ahí no
   * hay ningún barrido legítimo, y sí hay un run legítimo al que matar. NULL entra por el mismo sitio
   * porque `NULL < interval` es NULL y se colaría como "no hay piso".
   *
   * 22023 = invalid_parameter_value: la API lo mapearía a 400, no a 500. No es un fallo del motor.
   */
  if plazo is null or plazo < interval '1 hour' then
    raise exception 'plazo demasiado corto para expirar runs colgados: % (minimo 1 hour)', plazo
      using errcode = '22023';
  end if;

  /*
   * `r.` en todas partes: los parámetros de salida se llaman `id` y `tenant_id` igual que las
   * columnas, y en plpgsql un nombre que valga para las dos cosas es un error de ambigüedad.
   *
   * `error` y `finished_at` se escriben junto al estado porque son parte de la MISMA transición: un
   * run expirado sin motivo escrito obliga a adivinar quién lo mató.
   */
  return query
    update kr_runs r set
      status = 'failed',
      error = 'Expirado por el barrido de runs colgados: seguia en running mas de '
              || plazo || '. El workflow nunca registro su propio fallo.',
      finished_at = now()
    where r.status = 'running'
      and r.created_at < now() - plazo
    returning r.id, r.tenant_id;
end;
$$;

/*
 * -----------------------------------------------------------------------------
 * El cambio de dueño necesita DOS permisos temporales. Medido, no supuesto.
 * -----------------------------------------------------------------------------
 *
 * El primer intento de desplegar esta migración murió acá:
 *
 *     ✖ La migración 0018 falló y se revirtió: must be able to SET ROLE "app_barrido"
 *
 * y falló **solo en producción**, porque en PGlite el rol que migra es superusuario y un superusuario
 * puede asumir cualquier rol. En Supabase alojado `postgres` NO lo es. Reproducido después con un rol
 * `createrole` no-superusuario dueño del schema, que es la condición real: da el mismo mensaje.
 *
 * `ALTER … OWNER TO` exige **dos** cosas, y el mensaje solo nombra la primera:
 *
 *  1. **Poder hacer `SET ROLE` al nuevo dueño.** En PG16+ un rol `CREATEROLE` que crea otro recibe
 *     `ADMIN OPTION` pero **no `SET`** — lo gobierna el GUC `createrole_self_grant`, que viene vacío.
 *     O sea que crear el rol no alcanza para poder cedérselo. Un `grant` explícito sí: quien tiene
 *     ADMIN OPTION puede concederlo, y un `grant` normal sí trae `SET`.
 *  2. **Que el nuevo dueño tenga `CREATE` en el schema del objeto.** Ésta no aparece hasta que se
 *     resuelve la primera, y entonces el error cambia a `permission denied for schema app`. Medido en
 *     ese orden: membresía sola → sigue fallando.
 *
 * Los dos son **temporales**: se revocan tres líneas más abajo, y la propiedad de la función
 * **sobrevive** al revoke (medido). El estado final es el que el diseño quería — `app_barrido` con
 * `usage` y nada más, y ningún rol que pueda asumirlo.
 *
 * Con un superusuario (PGlite, los tests) estas cuatro sentencias son inocuas: ya podía hacer todo.
 * Con uno normal (producción) son lo que hace que la migración pase. Un test las cubre aplicando la
 * `0018` como un rol no-superusuario: sin ellas, ese test reproduce el fallo de producción.
 */
grant app_barrido to current_user;
grant create on schema app to app_barrido;

alter function app.expirar_runs_colgados(interval) owner to app_barrido;

/*
 * EXECUTE es de PUBLIC por defecto en Postgres — medido: sin este `revoke`, `app_user` (la API) puede
 * llamarla, y el test que lo exige cae. Es el default que más fácil se pasa por alto, porque una
 * función nueva parece nacer cerrada como nace cerrada una tabla nueva, y es al revés.
 *
 * Los `grant execute on all functions in schema app` de 0001/0002/0003 NO alcanzan a esta función:
 * se ejecutaron antes de que existiera y no hay `alter default privileges` en ninguna migración.
 * O sea que lo único que la abría era el default de PUBLIC.
 *
 * Solo `app_service` (el orquestador, login `amg_orquestador`). NO `app_user`: la API atiende
 * peticiones de personas y ninguna persona expira los runs de todos los tenants. NO `app_render`, que
 * es el rol más pobre del sistema (ADR-19). NO `amg_cache`.
 */
revoke execute on function app.expirar_runs_colgados(interval) from public;
grant  execute on function app.expirar_runs_colgados(interval) to app_service;

comment on function app.expirar_runs_colgados(interval) is
  'Marca failed los kr_runs que siguen en running pasado el plazo, en TODOS los tenants, y devuelve '
  'sus ids con su tenant. security definer y propiedad de app_barrido (no del dueño de la tabla, que '
  'en Supabase esta sujeto a FORCE RLS y devolveria cero filas). Unico privilegio cross-tenant del '
  'sistema: no devuelve ningun dato del research y solo puede hacer running -> failed. El plazo lo '
  'pone el llamador (PLAZO_RUN_COLGADO), con un piso de 1 hour impuesto aca.';

comment on index kr_runs_colgados is
  'Indice parcial para el barrido de runs colgados: solo contiene los runs vivos, asi que no crece '
  'con el historico.';

/*
 * -----------------------------------------------------------------------------
 * Y recién ACÁ se devuelven los dos permisos temporales. El orden no es cosmético.
 * -----------------------------------------------------------------------------
 *
 * Estaban justo debajo del `alter … owner` y la migración moría en la sentencia siguiente:
 *
 *     ✖ must be owner of function app.expirar_runs_colgados
 *
 * porque `revoke execute`, `grant execute` y `comment on function` **también** exigen ser dueño, y
 * el dueño acababa de dejar de ser quien migra. Lo que hace que esas tres pasen es la membresía en
 * `app_barrido`: Postgres resuelve "¿sos el dueño?" con `pg_has_role(current_user, dueño, 'USAGE')`,
 * así que un miembro con `inherit` cuenta como dueño. Devolverla antes de tiempo la rompe.
 *
 * Lo cazó el test que aplica esta migración con un rol no-superusuario. La primera versión del
 * arreglo —los dos revokes acá arriba— habría vuelto a fallar en producción, en la línea siguiente a
 * la que falló la primera vez.
 */
revoke create on schema app from app_barrido;
revoke app_barrido from current_user;
