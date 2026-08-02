# Bitácora de AMG OS

Lo que **ya pasó**, en orden inverso: lo más reciente arriba. Cada entrada quedó escrita el día que
ocurrió y **no se reescribe después** — si algo resultó estar mal, se dice en una entrada nueva, no
se corrige la vieja. Una bitácora que se edita hacia atrás deja de servir para entender por qué se
decidió lo que se decidió.

Esto **no** es el estado del proyecto. Dónde estamos hoy y qué falta:
[`docs/proyecto/09-estado-y-roadmap.md`](../docs/proyecto/09-estado-y-roadmap.md). Lo que se está
haciendo ahora mismo: [`current.md`](current.md).

---

## 2026-08-02 — Pieza 2 del portal de la agencia: usuarios (6 etapas), mergeada a `main`

Segunda pieza del [programa del portal de la agencia](../docs/superpowers/plans/2026-08-01-portal-agencia-programa.md):
quién tiene acceso al tenant, con qué rol, y cambiarlo — sin crear usuarios nuevos (eso lo sigue
haciendo Supabase Auth, la API nunca recibe esa credencial).

**Etapa 1** (`9614489`) agrega la vista `membresias_perfil` (0012) — `memberships` cruzada con
`auth.users` para traer el email, ya filtrada por tenant y por rol (staff ve el tenant entero, un rol
`cliente` ve solo su propia fila) — y `PgMembresias.listarMiembros`.

**Etapa 2** agrega `GET /members` y `PATCH /members/:userId` y extiende la MISMA migración (`0012`)
en vez de abrir una `0013` — reservada para la pieza 3 (Ideas) — para no colisionar la numeración
entre piezas del mismo programa. Tres piezas nuevas en la base:

- **`memberships` deja de ser solo lectura para `app_user`**, por primera vez desde `0001_init.sql`
  — pero solo para `UPDATE`, y solo lo que la política `membership_update` deja pasar.
- **La garantía "siempre queda un `maestro`" vive en un trigger**, no en un `check`: un `check` mira
  una fila, y esto depende del conjunto. Verificado por mutación (sacar el trigger hace caer
  exactamente el test del último maestro; puesto de nuevo, pasa).
- **`using` vs `with check` decide 403 contra 404**, y con una vuelta de tuerca que el brief no
  anticipaba: `membership_select` (0003, cierra la FUGA 1) ya restringe la lectura de `memberships`
  a "propia fila" — sin ampliarla, ni el propio `maestro` podría ver la fila de otro para cambiarla.
  La ampliación (`membership_select_staff`) no puede llamar a `app.current_role()`: esa función lee
  `memberships`, y una política de `memberships` que la llamara se re-evalúa a sí misma sin parar —
  **medido**: cuelga el proceso de Postgres, no lanza un error. La resuelve
  `app.rol_propio_sin_recursion()`, la misma pregunta con una bandera de sesión que corta la segunda
  entrada. Con esa visibilidad ya puesta, `membership_update.using` solo exige tenant (un `equipo` SÍ
  ve la fila que intenta tocar) y `with check` exige `maestro` **y** que no sea su propia fila
  (auto-degradación bloqueada en la base, no solo en la API) — así un `equipo` que intenta repartir
  roles cae con 403 real de RLS, no un 404 silencioso, y un `cliente` sigue dando 404.

El diseño sigue exactamente ADR-15 (el rol se deriva, nunca se declara) y ADR-17 (un solo login
`app_user`, sin asumir otro rol). Se construyeron creyendo que no hacía falta ADR nuevo; **sí hacía
falta, y ya está**: [ADR-24](../docs/decisiones-arquitectura.md) (aceptada el 2026-08-02) enmienda la
`0001`, que prometía que las membresías se escribirían "por el backend con service-role" — un backend
que nunca existió. ADR-24 autoriza exactamente lo que estas etapas construyeron y les fija cinco
condiciones: grant por columna, `using` + `with check`, `servicio` no asignable, auto-edición
rechazada en la base, y un trigger que sobreviva a degradaciones concurrentes.

**Las dos correcciones de seguridad que cerraron esas etapas**, las dos con test rojo primero y
verificación por mutación:

- **`grant select (id, email, raw_app_meta_data) on auth.users to app_user` era una fuga
  CROSS-TENANT y se quitó.** El razonamiento original —un grant por columna protege
  `encrypted_password` de un `select *` futuro— es cierto, pero decide *qué columnas* se leen, y el
  aislamiento que importa es de *filas*: eso lo hace la vista, no la tabla. Medido con PGlite:
  `equipoA` (tenant A) haciendo `select email from auth.users` obtenía **2 filas**, incluida la de un
  usuario del tenant B, mientras la vista le devolvía 1. Y nunca hizo falta: una vista sin
  `security_invoker = true` corre con los permisos de su *owner*.
- **El trigger del último maestro contaba sin serializar.** Con dos maestros, en READ COMMITTED, dos
  transacciones que degradan cada una al otro se aprueban entre sí —ninguna ve el cambio ajeno,
  todavía sin commitear— y el tenant queda con cero. No hay conflicto de filas que las ordene. Ahora
  toma un `pg_advisory_xact_lock` **por tenant** antes de contar. Advisory lock y no
  `select … for update`: eso exige el privilegio UPDATE de *tabla*, y `app_user` tiene solo el grant
  por columna. **La carrera no está reproducida en un test** —PGlite es un solo backend— y el test lo
  dice: fija que el punto de serialización existe y es por tenant.

**Etapas 3 a 6, en el portal.** El rol de la UI deja de salir de `app_metadata.rol`:
`MembresiaService` resuelve la **membresía efectiva** y ese valor alimenta la pantalla. Hacía falta
porque la API no puede reescribir ese metadata (no tiene credenciales de Supabase), así que en cuanto
esta pieza permite cambiar roles, el token queda viejo para siempre. No es escalada —RLS manda— pero
es una pantalla que miente. `capacidades.ts` reemplaza los 20 booleanos editables del origen por una
tabla derivada y read-only donde **cada fila cita el símbolo exacto de la política que la sostiene y
el test lo busca en el archivo**: un renombre en la base tira el test antes de que la pantalla empiece
a mentir. Se agregan `/usuarios` y `/usuarios/:id` (sin altas: crear una cuenta es crearla en Supabase
Auth), y la **integración de retorno** con la pieza 1 —el `<input placeholder="uuid del usuario
responsable">` pasa a ser un selector de miembros—. Un bug real que encontró su test: `[value]` en un
`<select>` se aplica antes de que existan las `<option>` del `@for`, así que el responsable guardado
se descartaba en silencio.

Verificado **en el navegador** (MCP chrome-devtools, API real sobre PGlite, tema claro y oscuro,
consola sin errores) con los tres roles, y forzando los rechazos por fuera de la UI: maestro→otro
`200`, equipo→otro `403`, cliente→otro `404`, auto-degradación `403`, `servicio` `400`, `cliente` sin
negocio `400`.

## 2026-08-02 — Pieza 1 del portal de la agencia: gestión de clientes (CRM), mergeada a `main`

Primera de cuatro piezas del [programa del portal de la agencia](../docs/superpowers/plans/2026-08-01-portal-agencia-programa.md):
lleva las cuatro pantallas de clientes del Angular viejo (`dashboard-project`, Firestore + NgRx) al
portal de AMG OS, con Postgres bajo RLS y API propia. Ejecutada con
`superpowers:subagent-driven-development` en un worktree aparte — `main` no se tocó ni una vez.

**Qué hay:** migración `0011_clientes_crm.sql` (tipo, industria, etiquetas, nivel de actividad,
estado de contrato, score, asignado a, contacto en jsonb, origen — **ningún grant nuevo a
`app_render`, la allowlist pública sigue exponiendo exactamente `brand, locations, menu, name,
priceRange`**); la clase `PgClientes` (`db/src/clientes.ts`); los endpoints `GET/POST /clients`,
`GET/PATCH /clients/:id`, `POST /clients/:id/archive` y `/desarchivar`; la capa de datos del portal
(`ClienteApi`, `ClienteAgencia`, `ClientesService` con signals); y las cuatro pantallas —listado,
alta, perfil (cuatro cards editables inline) y una vista con tres pestañas de **datos de ejemplo**
(ideas, Instagram, reseñas de Google — ninguno de los tres tiene backend en AMG OS todavía; decisión
explícita del usuario, portar la pantalla con mocks y decidir el cableado real después).
**Sin sucursales/`business_profile.locations`**: se difirió a propósito (toca el pipeline público del
renderizador, ADR-19, y merece su propio plan con tests de seguridad dedicados).

**Lo que encontró la revisión final de rama, y no cualquier revisión por etapa:** la política
`client_select` (existente, `0001_init.sql`, sin tocar por esta pieza) es RLS **por fila**, no por
columna — un usuario con rol `cliente` ya podía leer su propia fila de `clients` entera. Antes de esta
pieza eso era inofensivo; la `0011` le agregó a esa misma fila columnas que son **notas internas de la
agencia sobre ese cliente** (`contacto.notas`, `score`, `estado_contrato`, `asignado_a`). Cada revisión
por etapa preguntó "¿puede escribir el rol cliente?" (no) y "¿lo lee `app_render`?" (no) — ninguna
preguntó "¿qué más puede LEER el rol cliente de su propia fila, ahora que hay más ahí?". **Cerrado el
mismo día**: `db/src/clientes.ts` enmascara las 10 columnas de CRM a `null` para quien no sea staff,
con un `case when app.es_staff() then <col> else null end` — la MISMA función que ya usan las
políticas RLS, evaluada dentro de Postgres, no un `if` de TypeScript. La primera versión usaba la
forma denylist (`= 'cliente'`), que un rol NULL/desconocido dejaba pasar sin enmascarar — corregido a
la allowlist positiva (`app.es_staff()`). Verificado por mutación.

## 2026-08-01 (cierre del día) — Tres arreglos que salieron de manejar la app, no de la suite

Verificar el re-seed **en el portal** (y no solo por consulta) destapó que la primera siembra había
corrido doce minutos antes de `f0c1387`: en producción, **Cartera y Research mostraban las mismas
métricas con nombres distintos**, a dos clics. El re-seed desde `HEAD` lo cerró, y ahora
`db/src/cartera-portal.test.ts` ata las dos copias campo por campo — el comentario que declaraba esa
atadura *imposible* («el portal vive fuera del monorepo») era falso: eso impide importar el paquete,
no leer el archivo. Además, **el contraste de los ejes en oscuro** pasó de **1.53:1 a 11.49:1** (31
etiquetas que ApexCharts pintaba con su gris, invisible para `contraste.test.ts` porque no sale de
`styles.css`), y **`npm run typecheck` dejó de pisar `dist/portal`** con el bundle de desarrollo. Los
tres, con rojo primero y verificación por mutación.

## 2026-08-01 (mañana de la demo) — El renderizador está desplegado

La web del cliente dejó de vivir en `localhost`:
[`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app) sirve **La
Birra Bar** desde internet, leyendo de Supabase con `app_render`. Es medio Fase 2 en producción, y se
hizo **con la reunión encima** porque el riesgo estaba acotado: un **servicio nuevo**, sin tocar
`main`, ni el portal, ni la API — el peor caso era no llegar y seguir con `localhost`.

Verificado en el navegador, no por el "✔" del deploy: las 5 rutas en 200, 14 páginas enlazadas,
`/menu` con 3 categorías, `/blog` con los 2 artículos, footer con los 2 locales, y JSON-LD por tipo
(`LocalBusiness` en landings, `Article` en blogs). Y el aislamiento comprobado **con savepoints**:
`app_render` no puede leer `business_profile` crudo, ni `kr_runs`, ni `memberships`.

**Cuatro tropiezos que dejaron enseñanza** (todos en el
[runbook](../docs/proyecto/13-runbook-despliegue.md#desplegar-el-renderizador-fase-2)): el DSN quedó
con el usuario `amg_api` al copiarlo —lo que habría dado al proceso anónimo la credencial de la API,
no un typo sino ADR-17 roto—; el **session pooler (5432) aceptó una conexión y rechazó la siguiente
con la misma password**, así que el DSN va por **6543**; el dominio se agregó primero al servicio **de
la API**, donde habría servido la API en vez de la web; y los primeros 404 eran **caché negativa** del
propio renderizador, que vence sola.

## 2026-08-01 — El re-seed de producción, en un comando (y la `0010` que faltaba aplicar)

El paso 0 de los próximos pasos (re-sembrar Supabase) pedía exportar tres variables a mano, y la forma
obvia de hacerlo —`DATABASE_URL_ADMIN=… npm run seed:demo -w db`— deja la password de ADMIN en el
historial de la shell, justo lo que `db/.env.example` advierte. Ahora hay `npm run reseed:demo`: lee
las tres de `docs/private/credenciales.env` (la fuente única), **valida antes de conectar**, muestra a
qué base va con la password tapada y pide confirmación. Invoca el CLI del seed **sin `--env-file`** a
propósito: `db/.env` es generado y puede estar desincronizado de la fuente, y no se apuesta una
escritura en producción a la precedencia entorno-vs-`--env-file`. De paso caza un fallo silencioso que
el CLI no veía —si los UUID de Frank y Juan son el mismo, la segunda membresía upserta sobre la
primera y Frank pierde `maestro` sin que nada avise—.

**Y se corrió: producción quedó re-sembrada.** 1 cliente (La Birra Bar; el italiano ya no está), 14
páginas con el split 8/6 intacto, 0 aprobadas, run en `pending_approval`, y el `app_metadata` de los
dos usuarios ya apuntaba al tenant correcto — todo **verificado por consulta contra Supabase**, no por
el "✔" del comando. La consulta destapó un pendiente que el re-seed no toca: **la migración `0010` no
estaba aplicada en producción**, así que `business_profile_publico` exponía solo `brand, name,
priceRange` y los locales y la carta se filtraban en silencio. **Aplicada el 2026-08-01**
(`npm run migrate:deploy -w db`) y verificada por consulta: las **10** migraciones en el registro, y la
allowlist ahora deja pasar `brand, locations, menu, name, priceRange` — **2 locales y 4 items de carta**
públicos.

## 2026-08-01 — El cliente de la demo, unificado

Se preguntó qué le faltaba al portal para una demo completa y la respuesta no fue una funcionalidad:
**las tres pantallas hablaban de tres negocios distintos**. El dashboard listaba seis restaurantes
inventados, el brief mostraba el italiano de ejemplo (`db/src/seed-demo.ts` seguía sembrando "Bella
Napoli") y la web servía **La Birra Bar** — el recorrido de tres golpes contaba tres historias sin
relación en tres clics. Ahora el seed, el dashboard y el `dev-server` de la API son el mismo cliente, y
**un test ata el perfil del seed a `web-builder/business-profile.json`** para que la deriva no pueda
repetirse en silencio.

## 2026-08-01 — La navegación del sitio del cliente, mergeada a `main`

El sitio público mostraba una barra armada con los títulos SEO de todas las páginas de investigación —
parecía un blog, no el sitio de un restaurante. Reemplazada por Inicio/Menú/Ubicaciones/Contacto fijos,
un footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. 10 tareas (9 planeadas + una
migración de Postgres que apareció como gap real durante la ejecución), revisadas una por una más una
revisión final de rama, más una revisión externa (Codex) que encontró 4 hallazgos reales (la allowlist
de Postgres no validaba la *forma* de los valores, solo el nombre de la clave; `locations` tenía la
precedencia invertida contra su propio comentario; los topes de tamaño se aplicaban tarde; `/blog` se
autoenlazaba con una story real) — los 4 corregidos y verificados por mutación. Detalle en el
[plan](../docs/superpowers/plans/2026-07-31-navegacion-sitio-cliente.md).

## 2026-08-01 — Las cuatro piezas de la demo con Frank, resueltas

Pieza A (login ES256), pieza B (modo oscuro del portal) y pieza C (dashboard de cartera) mergeadas a
`main`; la pieza D (research en vivo durante la demo) quedó **desaconsejada** con datos reales. La
demo está lista para mostrarle a Frank: lo que sigue es trabajo de producto, no de preparación de demo.

## 2026-07-30 — Acción 06: la corrida final contra producción

Research real para **La Birra Bar** (14 páginas, $0.3097), republicado en Storyblok con `kr.v0.5` y
verificado en el navegador. Midió por primera vez cuánto tarda un research real —**16m15s**, por encima
del umbral de ~12 min que la pieza D necesitaba para mostrarse en vivo en la demo— así que **la pieza D
queda desaconsejada tal como se la había imaginado**.

## 2026-07-30 — El login estaba roto en producción; la pieza A lo arregló

C.8 —manejar la app en el navegador— destapó lo que la verificación desde afuera no podía ver: todo
login terminaba en `401 Token inválido o expirado`. **El proyecto de Supabase firma con `ES256`** (se
creó el 2026-07-25, ya con claves asimétricas) y la API solo aceptaba `HS256` con un secreto
compartido. No era un error de despliegue: era deuda de contexto en el código.

Es la lección de siempre, otra vez: **verificar desde afuera y manejar la app encuentran cosas
distintas.** `/health` daba 200, el CORS aceptaba solo el portal, el `401` sin token era correcto — y
aun así nada funcionaba para un usuario real.

**Cerrado el 2026-07-30: Juan se logueó en `bigballs.es`.** Y hasta ese momento no estaba cerrado, a
propósito: entre el merge (2026-07-27) y ese login hubo tres días en que el código correcto ya estaba
desplegado y el estado seguía siendo 🟡, porque *20/20 chequeos de `/health` en 200* prueban que
`emisorSupabase` aceptó la variable de entorno y **nada más**. `/health` responde igual con el código
viejo, y un token basura da 401 con los dos. **No había ninguna señal externa que distinguiera
"arreglado" de "roto"** — solo entrar y loguearse.

## 2026-07-25 — Fase 1 desplegada

El portal en [`bigballs.es`](https://bigballs.es) (Hostinger, autodeploy desde `main`), la API en
`api.bigballs.es` (Railway, `europe-west4`) y la base con RLS forzada en Supabase (`eu-west-2`).
