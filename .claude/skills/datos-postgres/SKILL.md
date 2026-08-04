---
name: datos-postgres
description: Usar al tocar db/ — el esquema, una migración, una política de RLS, un rol o un grant, la capa de acceso (PgStore, PgClientes, PgMembresias, PgSitios) o cualquier decisión de autorización. Cubre por qué el rol se deriva dentro de Postgres y no se declara, por qué no existe un query() suelto, cómo se escribe una política que falle cerrado, y las trampas que ya produjeron fugas reales.
---

# Postgres en AMG OS

La seguridad de este sistema **no está en TypeScript** (ADR-22). Está en el esquema: en las
políticas, los roles, los grants y las constraints. La capa de acceso (`db/src/store.ts` y
compañía) no autoriza nada — solo pone el contexto y deja que Postgres decida.

La consecuencia práctica: cuando dudes de si algo es seguro, la pregunta no es *"¿el código lo
comprueba?"* sino **"¿qué lo impide si el código no lo comprueba?"**. Si la respuesta es "nada", eso
es el bug.

## Las tres decisiones de fondo

Están escritas en la cabecera de `db/src/store.ts` y las tres se pueden romper sin darse cuenta:

1. **`kr-service` NO conoce esta capa.** El pipeline es una librería pura que corre sin credenciales
   y sin base. Quien une pipeline y persistencia es el orquestador, que le inyecta implementaciones
   de `ProviderTaskLog` y `KeywordCache`. Un `import … from "db"` dentro de `kr-service/src/` es la
   señal de que algo se torció.
2. **Todo se escribe BAJO RLS, con el rol del PROCESO, nunca con la service-role.** Se podría usar la
   service-role (que salta RLS) y confiar en que el código pone bien el `tenant_id`. Entonces el
   aislamiento entre clientes dependería de no equivocarse nunca. Escribiendo bajo RLS, **un bug de
   aplicación no puede cruzar tenants: lo frena Postgres.**

   **El rol del proceso son DOS, y confundirlos borra ADR-17:** `app_user` para la API (login
   `amg_api`) y `app_service` para el orquestador (login `amg_orquestador`). Los dos están sujetos a
   RLS; ninguno de los dos es la service-role. El orquestador escribe los briefs como `app_service`
   (`orchestrator/src/deps.ts:100`), y su login **no puede** asumir `app_user` ni al revés. Esta línea
   decía "como `app_user`" a secas y la 13ª review lo marcó: un agente que la siguiera literalmente
   podría escribir un test con el rol equivocado, o "unificar" los dos roles y tirar la separación que
   Postgres impone.
3. **Toda query va por una conexión reservada (`Tx`).** Ver abajo — es lo que más fácil se rompe.

## `Tx`: por qué no existe un `query()` suelto (ADR-13)

`PgStore` aplica el contexto con `set_config(..., true)` y `set local role app_user`. Las dos cosas
son **locales a la transacción**, y una transacción vive en **una conexión**.

La versión anterior tenía un `query()` suelto y hacía `begin` / `set_config` / la query / `commit` en
cuatro llamadas. Contra PGlite —una sola conexión— eso funciona **por accidente**. Contra un
`pg.Pool` real, cada `query()` toma una conexión cualquiera: el `begin` va a la 1, el `set_config` a
la 2 y el `insert` a la 3, que corre **sin tenant y con el rol del pool, que salta RLS**. El
aislamiento no se degradaría: desaparecería.

Por eso el único acceso es `pool.transaction(fn)`, que reserva la conexión y se la pasa a `fn`
(`db/src/pool.ts`). No es que "haya que acordarse": **es que no hay otra forma**. El tipo impide
reintroducir el bug.

```ts
// El patrón, siempre: withTenant aplica identidad + rol y te da el tx.
private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> { … }
```

Dos consecuencias que se olvidan:

- **`NodePgPool.transaction` hace `release(err)` cuando el rollback falla** — así el pool **descarta**
  la conexión en vez de reciclarla. Una conexión envenenada (transacción abierta, con el rol y el
  tenant del usuario anterior pegados) devuelta al pool sirve el contexto de un cliente a la petición
  del siguiente.
- Las caches **no tienen contexto de tenant** que aplicar, así que usan `ejecutorDe(pool)`: una
  transacción por query. Tampoco hay un `query()` suelto ahí.

## El rol se DERIVA, no se declara (ADR-15)

`TenantContext` tiene `tenantId` y `userId`. **Y nada más.** Que no exista un campo `rol` es la
garantía, en el tipo, de que nadie pueda declararse `maestro`.

Las funciones que lo derivan, todas en el esquema `app`:

| Función | Qué contesta | Dónde nació |
|---|---|---|
| `app.current_user_id()` | quién es (del GUC `app.user_id`, que pone la API tras verificar el JWT) | 0002 |
| `app.current_role()` | su rol, **desde `memberships`** — con allowlist humana `maestro/equipo/cliente` | 0002, endurecida en 0003 |
| `app.es_servicio()` | `current_user = 'app_service'` — una **credencial**, no un campo | 0002 |
| `app.es_staff()` / `app.puede_escribir()` | ¿ve toda la cartera? ¿puede escribir? (el rol `cliente` es solo lectura) | 0001 |
| `app.ve_cliente(cid)` | staff → cualquiera de su tenant; `cliente` → solo el suyo | 0001 |
| `app.rol_propio_sin_recursion()` | **solo** para políticas sobre `memberships` (ver Recursión) | 0012 |

**Reclamar un tenant ajeno no sirve de nada**: no hay membresía allí, así que no hay rol, así que no
hay acceso. Por eso el header `x-amg-tenant` puede viajar sin firmar — es una coordenada, no una
autoridad.

## Fallar cerrado: la trampa que ya concedió privilegios de maestro

Las políticas usaban `app.current_role() is distinct from 'cliente'`. Con el rol ausente,
`current_role()` es NULL, y **`NULL IS DISTINCT FROM 'cliente'` es TRUE**: un tenant válido con rol
vacío obtenía visibilidad de maestro sobre la cartera entera (`db/migrations/0001_init.sql:360-378`).

**Siempre allowlist positiva.** Hay que ser explícitamente uno de los roles conocidos; cualquier NULL
o valor desconocido da FALSE y no ve nada.

El mismo criterio, en otras dos formas:

- **`nullif` al leer un GUC.** `current_setting('app.tenant_id', true)` devuelve `''` cuando no está,
  y `''::uuid` **lanza**. Sin el `nullif`, una petición sin identidad no devuelve cero filas:
  **revienta la query**. Un control de acceso tiene que fallar cerrado y en silencio.
- **`force row level security`, no solo `enable`.** Sin FORCE, el **dueño** de la tabla salta las
  políticas. Las seis tablas de tenant llevan las dos líneas (`db/migrations/0001_init.sql:346-358`).

## Escribir una política: `using` vs. `with check`

La diferencia no es sintáctica, **decide el código HTTP que ve el usuario**. La lección está medida en
`db/migrations/0012_membresias_perfil.sql:177-216`:

- La condición en **`using`** → la fila no se alcanza → **0 filas afectadas, en silencio** → la API lo
  traduce como **404** ("no existe").
- La condición en **`with check`** → la fila sí se alcanza, pero el resultado falla el chequeo →
  Postgres lanza **42501** → el `onError` de la API lo mapea a **403** ("no tenés permiso").

Elegí a propósito cuál de los dos querés, y escribí por qué.

Y una trampa concreta, también medida: **un UPDATE necesita que la fila vieja pase alguna política de
SELECT/ALL** para poder afectarla. Una política `for update using (true)` sin ninguna de SELECT que la
acompañe deja **0 filas visibles, silenciosamente** — ni el `maestro` podría cambiar un rol. De ahí
`membership_select_staff`.

## Recursión: una política sobre `memberships` no puede llamar a `current_role()`

`app.current_role()` **lee `memberships`**. Una política sobre esa misma tabla que la invoque entra en
recursión infinita al evaluarse. Por eso:

- `membership_select` (0003) solo compara `tenant_id` y `user_id`, que salen de GUCs.
- `app.rol_propio_sin_recursion()` (0012) existe para cuando la política **sí** necesita el rol: usa
  una bandera de sesión (`app.resolviendo_rol_propio`) y, si ya está resolviendo, **devuelve NULL** —
  corta el ciclo fallando cerrado, no autorizando.

Para cualquier otra tabla, `app.current_role()` / `app.es_staff()`.

## Grants por columna, y por qué no alcanzan

Un `grant select (col1, col2)` protege lo sensible de un `select *` futuro. Pero decide **qué
columnas**, y el aislamiento que importa acá es **de filas**.

El caso real (`db/migrations/0012_membresias_perfil.sql:24-37`): había un
`grant select (id, email, raw_app_meta_data) on auth.users to app_user`. Saltearse la vista era una
fuga **cross-tenant** — medido con PGlite: `equipoA` haciendo `select email from auth.users` obtenía
**2 filas, incluida una del tenant B**, mientras la vista le devolvía 1.

Se quitó el grant. Y no rompió nada, por un detalle que conviene saber: **una vista sin
`security_invoker = true` corre con los permisos de su OWNER**, así que `app_user` lee a través de
`membresias_perfil` sin tener ningún permiso sobre la tabla base. Lo fija un test que exige
`permission denied` (no cero filas) y cae si alguien repone la línea.

**La visibilidad se resuelve en la consulta, no en TypeScript.** `membresias_perfil` ya viene filtrada
por tenant **y por rol** (staff ve todo el tenant; un `cliente` ve solo su fila), así que
`listarMiembros` no filtra nada — no puede olvidarse.

## Columnas generadas como allowlist (y la trampa de re-materializarlas)

`clients.business_profile_publico` es `generated always as (app.nap_publico(business_profile)) stored`:
lo **único** que `app_render` puede leer de `clients`. La columna cruda está revocada para ese rol.

Dos trampas:

1. **Agregar un campo al perfil y no agregarlo a la allowlist no da error: no aparece.** Y al revés es
   peor — meter en la allowlist algo del CRM (contacto, contrato, score) lo publica a internet
   anónimo. Hay un test que exige que el CRM **no** aparezca ahí.
2. **Una columna STORED no se recalcula porque cambie la función.** Ampliar la allowlist obliga a
   `drop column if exists` + `add column … generated` de nuevo, y a repetir el
   `grant select (…) to app_render` (que el drop se llevó). Es exactamente lo que hacen la 0009 y la
   0010 (`db/migrations/0010_ubicaciones_y_carta_publicas.sql:93-104`).

## Un login por proceso, con NOINHERIT (ADR-17)

`app_service` es NOLOGIN. Antes había **un** `DATABASE_URL` y era el **código** el que decidía con qué
rol vestirse: Postgres autoriza `SET ROLE` según el `session_user`, **sin contraseña**, así que el
mismo login podía ponerse `app_user` **o** `app_service`, y `RESET ROLE` para volver. Una frontera de
código disfrazada de frontera de credenciales (`db/migrations/0003_credenciales.sql:1-20`).

Hoy, cuatro logins, cada uno autorizado a **un** rol:

| Login | Rol | Proceso |
|---|---|---|
| `amg_api` | `app_user` | la API. **No puede** asumir `app_service` |
| `amg_orquestador` | `app_service` | el orquestador. **No puede** asumir `app_user` |
| `amg_cache` | (grants directos + política propia) | solo las 3 tablas sin `tenant_id` |
| `amg_render` | `app_render` | el renderizador público (0007) |

**NOINHERIT es la mitad del mecanismo**: sin él, el login tendría los privilegios de sus roles
concedidos sin necesidad de `SET ROLE`. Las contraseñas no van en el repositorio: se ponen al
desplegar.

Las caches (`kr_metrics_cache`, `kr_serp_cache`, `kr_provider_tasks`) son **deny-all para `app_user` y
`app_service`**: no llevan `tenant_id`, así que exponerlas dejaría ver a un tenant qué investigó otro.

## Los defaults de Postgres, medidos y no supuestos

Escribir en un comentario lo que **creés** que hace Postgres es cómo nace una garantía falsa. Dos que
ya pasaron por acá:

- **`order by x asc` pone los NULL AL FINAL**, y `desc` los pone primero. Medido: `asc` sobre
  `1, null, 0` devuelve `0, 1, null`. O sea que `nulls last` en un `asc` es **redundante** — está bien
  escribirlo explícito (no depender de un default), pero **quitarlo no cambia nada y ningún test cae**.
  Un comentario que diga "sin esto los NULL irían primero" es falso; el `ORDEN_DEL_BRIEF` de
  `db/src/store.ts` lo decía hasta que una mutación lo desmintió.
- **Un GUC ausente es `''`, no NULL**, y `''::uuid` **lanza**. De ahí el `nullif` de
  `app.current_tenant_id()`.

La regla que sale de las dos: **si vas a afirmar un comportamiento del motor en un comentario,
comprobalo primero** — son cinco líneas de PGlite. Y si tu mutación no tumba nada, la primera
hipótesis no es "el test está mal": es que **esa línea no hace lo que decís que hace**.

## El upsert de `savePages`: el `where` gobierna el update ENTERO

Es el sitio más fino del paquete, y la trampa no se ve leyendo el SQL de arriba abajo. El upsert de
`kr_pages` tiene un `where` que compara todos los campos **materiales**, con dos propósitos a la vez:
que un reintento idéntico no escriba nada (y la aprobación sobreviva), y que un cambio real de
contenido **revoque** la aprobación de la compuerta.

Un campo **no material** —`orden_brief` es el caso— no puede ir en ninguno de los dos sitios obvios:

- **En el `where`**: revocaría la aprobación de una página que solo cambió de posición. El humano
  aprobó *esa página*, no su puesto.
- **Solo en el `set`**: el `where` gobierna el update **entero**, así que en un reintento donde
  cambió *únicamente* el orden ninguna condición material se cumple, el update no ocurre y el valor
  nuevo **se pierde en silencio**.

La salida es una **sentencia propia** después de los upserts, que escribe el campo sin tocar
`approved`. Y como son dos garantías opuestas, hacen falta **dos mutaciones** para probarlas: quitar la
sentencia (cae "el orden se actualiza") y meter el campo en el `where` (cae "la aprobación
sobrevive"). Si agregás otro campo derivado no material, es exactamente el mismo problema.

## Un `unique` no diferible revienta en una permutación

`unique (run_id, orden_brief)` parece la constraint natural de "no hay dos páginas en la misma
posición". No está, y no por descuido: **Postgres comprueba un índice único fila por fila, no al final
de la sentencia.** Un `update` que permuta posiciones (la que estaba en 0 pasa a 1 y la de 1 a 0) la
viola a mitad de camino.

Tenerla exigiría `deferrable initially immediate` + un `set constraints … deferred` en la transacción.
Antes de pagar eso, preguntá qué compra: si el valor lo escribe **una sola sentencia** desde una fuente
que ya es única (un array), y el `order by` de lectura es determinista aunque dos filas empataran, no
compra nada.

## Constraints: una fila vs. el conjunto

- Lo que se puede decidir mirando **una fila** va en un `check`: `cliente_exige_client_id`,
  `membresia_no_es_servicio`, los rangos del CRM (`score` 0-100, `tipo`, `estado_contrato`).
- Lo que depende del **conjunto** no puede: "siempre queda un maestro en el tenant" necesita contar
  después del cambio, y va en un **trigger AFTER** (`app.verificar_ultimo_maestro`, 0012).
- Lo que cruza tablas y tenants va en una **FK compuesta**: `memberships_client_del_mismo_tenant`
  impide atar una membresía a un cliente de otro tenant; la FK compuesta de la 0011 hace lo mismo con
  `asignado_a`, y su 23503 lo mapea la API a 400 — **no se valida a mano**.

## Migraciones

- **Orden alfabético**, `NNNN_nombre.sql`. **Un número libre en el disco NO es un número libre.** Hay
  números **reservados** para ramas que se ejecutan en otra máquina, y la reserva vive en
  `docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` (§4) — mirala antes de numerar. Hoy:
  `0013_ideas.sql` y `0014_fotos_publicas.sql` están reservadas y sin escribir, y por eso el orden del
  brief se llevó la **0015**. Ese error ya se pisó una vez.
  Al agregar una migración cuando hay reservas abiertas, **declará si depende de sus hermanas**: si no
  toca lo mismo, da igual en qué orden se apliquen, y eso hay que decirlo antes de mergear.
  La 0012 se **extendió** en vez de crear una 0013 por la misma razón, y porque aún no estaba
  desplegada. Si extendés una, escribí por qué.
- **Dos runners, y los dos tienen que funcionar:**
  `aplicarMigraciones` (`db/src/migrate.ts`) corre todo sobre una base nueva — es lo que usan los
  tests. `migrarConRegistro` (`db/src/deploy.ts`) es para una base que **persiste**: cada migración en
  su propia transacción, con el `insert` al registro **dentro** del mismo commit (si estuviera fuera,
  una caída entre commit e insert la re-aplicaría y reventaría).
- **Nunca editar una migración aplicada.** El registro guarda su SHA-256 y `migrarConRegistro`
  **aborta** si el archivo cambió. Se escribe una nueva.
- **El registro (`app.migraciones_aplicadas`) NO lleva RLS.** Lo protege no tener grants. Ponerle
  `force` + cero políticas fue un tiro en el pie: el `postgres` de Supabase alojado no es
  superusuario, así que se auto-bloqueaba y el runner no podía leer su propio registro.
- **`auth.users` es de Supabase, no nuestro.** La 0012 lo asume existente; en PGlite lo crea
  `asegurarAuthStandIn`, y en producción es un no-op (`if not exists`). Los dos runners lo llaman,
  porque cualquiera puede ser el primero en tocar la 0012.

## Al terminar

```bash
npm test -w db      # PGlite, Postgres real en WASM
```

Y la pregunta de cierre, que en este ámbito no es retórica: **la garantía que acabás de escribir, ¿la
impone una política, una constraint, un grant o un tipo — o solo un comentario?** Si es lo último, no
está impuesta. Ver `datos-testing` para probarla por mutación.
