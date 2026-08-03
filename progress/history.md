# Bitácora de AMG OS

Lo que **ya pasó**, en orden inverso: lo más reciente arriba. Cada entrada quedó escrita el día que
ocurrió y **no se reescribe después** — si algo resultó estar mal, se dice en una entrada nueva, no
se corrige la vieja. Una bitácora que se edita hacia atrás deja de servir para entender por qué se
decidió lo que se decidió.

Esto **no** es el estado del proyecto. Dónde estamos hoy y qué falta:
[`docs/proyecto/09-estado-y-roadmap.md`](../docs/proyecto/09-estado-y-roadmap.md). Lo que se está
haciendo ahora mismo: [`current.md`](current.md).

---

## 2026-08-03 — Ordenar la documentación, y lo que apareció debajo

Se reorganizó el corpus entero de documentación (74 archivos, ~24.000 líneas) y se puso el grafo de
referencias de skill-map en **cero errores**, desde 32. Pero lo importante de la sesión no fue eso.

**🔴 `docs/private.zip` estaba commiteado en un repo público.** Apareció mirando por qué el
`.gitignore` no lo cubría: la regla era `docs/private/` (con barra), que no alcanza a un zip del mismo
nombre. Adentro viajaban `credenciales.env` —el archivo maestro— y los cinco `.env` de backup de los
paquetes, incluidos `SUPABASE_JWT_SECRET`, los tres `DATABASE_URL_*`, `DATAFORSEO_PASSWORD`, las keys
de Anthropic y OpenAI y el `STORYBLOK_MANAGEMENT_TOKEN`. En `origin/main` desde el commit `15ae91a`
("priv", 2026-08-01), y el repositorio es **público** (verificado: la API de GitHub responde 200 sin
autenticar). Se sacó del índice con `git rm --cached` y se blindó el `.gitignore` con los cuatro
patrones de comprimido. **Decisión del usuario: rotar, y no reescribir el historial** — una vez
público, el secreto está quemado y purgar no lo des-expone; lo que devuelve la seguridad es rotar.

**Y la lección que deja, que es sobre el arnés y no sobre el zip:** `npm run verificar` daba **verde
en la compuerta de secretos** con ese archivo trackeado. El detector de `scripts/secretos.mts` mira
archivos de texto; un `.zip` le pasa por al lado. Tres reviews externas y doce tandas no lo
encontraron, porque nadie miró *dentro* de un binario versionado. Otra vez lo mismo: la garantía
existía, el test que la ejercitaba no.

**Lo que se ordenó.** Tres cosas que estaban mezcladas ahora están separadas por la pregunta que
contesta cada carpeta: `docs/proyecto/` dice **cómo es el sistema hoy**, `docs/superpowers/` dice
**qué se va a construir y cómo se construyó**, y el nuevo `docs/historia/` dice **por qué el proyecto
es así**. Se archivaron los 11 planes y specs ya ejecutados (~9.400 líneas, el 52% del corpus) en
`superpowers/ejecutados/`, fuera del índice del grafo pero dentro de `referencePaths` para que sus
enlaces sigan resolviendo. Se movieron a `historia/` el PRD de origen, el contexto de Frank, las seis
acciones cerradas y los dos documentos del Módulo 2 previos a construirlo. Se resolvió la colisión de
numeración `12`/`12` (despliegue pasó a `13`, el runbook a `14`).

**Un archivo se quedó afirmando algo falso durante un mes:** `docs/historia/modulo-2-keyword-research.md`
decía "Motor elegido: **SEMrush**", cuando el motor es DataForSEO desde antes de la primera línea de código.
No se fusionó al documento vivo —habría contaminado el `04`—: se archivó con un aviso arriba que dice
exactamente qué de ahí es mentira.

**Lo que enseñó arreglar 32 errores de referencia.** Solo **6 eran defectos reales**. El resto eran
tres clases de falso positivo, y saber distinguirlas es lo que evita reescribir prosa correcta para
complacer a un linter:

1. **26 venían de carpetas que git ignora** y skill-map escaneaba igual (`respectGitignore: false`).
   Se fueron con una sola opción de configuración — que además saca de la base de skill-map el
   `docs/private/credenciales-deploy.md` que estaba indexado y era legible por cualquier cliente MCP.
2. **Un nombre de archivo suelto en un span de código se resuelve contra la carpeta del documento que
   lo menciona.** El nombre del `09` sin su carpeta, escrito en `AGENTS.md`, apunta a la raíz del repo
   y no a `docs/proyecto/`. Es la trampa que más veces se repitió, y por eso ahora hay una convención
   escrita en [`docs/README.md`](../docs/README.md). Esa sección tardó **tres intentos**: la primera
   versión rompía la regla que enseñaba, la segunda apostó a que meter los contraejemplos en un fence
   de código bastaba —**y no basta: el scan persigue las rutas también dentro de los bloques**—, y la
   tercera los silencia con su motivo escrito. Escribí "el scan hace code-strip" antes de comprobarlo;
   el scan me contestó que no.
3. **Lo que no es una referencia no debe escribirse como ruta**: el informe que el pipeline escribe en
   `out/`, un nombre de ejemplo, una unidad de medida (euros por mes, leída como slash-command).
   Esos 20 se silenciaron con `sm issues dismiss` **y su motivo escrito en el `.sm`**, que es lo que
   hace que la supresión sea una decisión y no un olvido.

**Y una asimetría de skill-map 1.2.1 que conviene recordar:** el `dismiss` de `reference-broken`
funciona y sobrevive a un scan completo; el de `reference-redundant` **no** — la supresión queda
activa y con el sidecar correcto, y el issue vuelve igual. Verificado con scan completo, no inferido.

---

## 2026-08-02 (etapa A) — El agente `pipeline`, y lo que se aprende estrenándolo

Se escribió el agente `pipeline` (128 líneas) y sus cuatro skills —`pipeline-gasto`,
`pipeline-research`, `pipeline-publicacion`, `pipeline-orquestacion`— y se estrenaron con trabajo
real: **KR-3 entero** y la mitad de **KR-1** que no cuesta dinero. 682 tests (subió de 624), y el
estreno se delegó de verdad en dos subagentes, en serie, con el contrato fijado antes de repartir.

**Lo que enseñó estrenarlas, que es la razón de que la etapa no se cierre sin trabajo real.** Las
tres cosas que las skills no traían **son las tres que cruzan el límite del paquete**:

1. La clave de la cache del SERP **la parsea `metaDeClave()` en `orchestrator/` por posición**, así
   que se puede cambiar un literal pero no la cantidad de segmentos. Sin eso, agregarle un segmento
   le habría desplazado `depth`, `location_code` y `language_code` a `kr_serp_cache` en silencio.
2. **El orden que produce `kr-service` no sobrevive a la persistencia**: `db/src/store.ts` y
   `portal/src/app/core/cartera.ts` reordenan por `opportunity_score` crudo. Lo encontró el subagente
   *al final*, revisando su propio trabajo, no al principio.
3. `config.ts` hace `import "dotenv/config"`, así que **un test que arranca el pipeline entero lee el
   `.env` real** —con keys y baseUrl de producción— sin que nadie se lo pida. Cuatro cerrojos.

Leyendo solo `kr-service` ninguna de las tres aparece: son precisamente lo que un agente encerrado en
su ámbito no puede ver. Para `datos` y `render` queda anotado escribir explícitamente la sección
*"qué de esto sobrevive al salir de tu área"*.

**Lo que se implementó.** `is_local` ahora sale del **map pack** del SERP (evidencia de Google) en vez
de una conjetura sobre el texto de la keyword —que daba 53 de 60 locales y publicaba `LocalBusiness`
falsos—, pero **solo cuando se observó**: `mapPack: null` respeta al LLM, porque tratar "no observado"
como "no es local" es el mismo error que `volumen ?? 0`. El volumen se normaliza contra el **percentil
90 winsorizado** en vez del máximo, así un pico deja de aplastar al resto. Y `score_confidence`
**ordena**, en dos niveles con la evidencia mandando siempre. El dataset crudo pasa a `datasets/`, y
que no vuelva a un directorio ignorado **lo impone un test que se lo pregunta a `git check-ignore`**,
no un comentario.

**Lo que quedó a medias, dicho como tal.** El percentil es *del run*, no *del mercado*: arregla el
aplastamiento, no la comparabilidad entre corridas. Los dos parámetros nuevos (`0.9` y `0.5`) son
juicio, no medición — barrerlos es gratis en cuanto exista el dataset, y el dataset **no existe**
(se perdió en `out/`, regenerarlo cuesta ~$0.31 y lo decide Juan). `TIPOS_MAP_PACK` no está verificado
contra la API real; si estuviera mal, falla hacia el lado conservador (sub-declara) pero KR-3 no
arreglaría nada. Y el orden nuevo gobierna **qué páginas existen** pero no **cuáles ve el cliente**.

**Un detalle del arnés:** un agente recién escrito **no se puede invocar por nombre en la sesión que
lo escribe** —el registro se carga al arrancar—, así que el estreno se hizo pasándole su definición al
subagente. Funciona, pero la etapa B conviene arrancarla en una sesión nueva.

## 2026-08-02 (cierre) — El plan de los tres agentes que faltan

Con `front` y `revisor` cerrados, quedaba decidir cómo se escriben los otros tres. El reparto ya
estaba acordado; lo que no estaba era **cómo se parten las skills dentro de cada área**, y eso ahora
se decidió leyendo el código en vez de imaginándolo: nueve skills, con un anclaje verificado por
cada una (el preflight de `budget.ts` que estaba 50× por debajo, el `published` de `publisher.ts` que
distingue "lo pedí" de "pasó", el orden `Host → dominio → sitio` de `renderer/src/app.ts` que **es** la
autorización). Vive en [`.claude/PLAN-AGENTES.md`](../.claude/PLAN-AGENTES.md): **una etapa por
sesión**, porque las tres juntas se cierran una vez al final, cansado, que es como se produjo el drift
de quince cifras.

Lo que se junta y lo que no: `db` + `api` en **un** agente (comparten PGlite y comparten el cuerpo de
conocimiento; partirlos pondría a dos agentes a escribir las dos mitades de un contrato en el caso más
frecuente), los tres paquetes del pipeline también (el hilo real es *"corre sin nadie mirando, gasta
dinero, tiene que ser idempotente"*), y `renderer/` solo, con 3.395 líneas, porque es la única
superficie pública anónima.

**La regla que salió de escribirlo:** una skill redactada leyendo código es una **hipótesis** hasta
que un agente la usa. `front` está escrito y todavía **sin estrenar**, así que cada etapa ahora
termina con un trabajo real que la ejercite —para `pipeline` son KR-1 y KR-3, que ya existen en el
`09`— y no se cierra sin él.

Y tres huecos que quedaron como decisión, no como olvido: no una skill transversal de TypeScript
(ya está en `AGENTS.md`, que se carga siempre; duplicarla crea dos copias que se desincronizan), no un
agente de documentación (no sabe qué pasó en la sesión: habría que contárselo, que es el teléfono
descompuesto), y no un agente de infra (es justo lo que `AGENTS.md` prohíbe delegar). El plan **no**
se enlazó desde el `09`: meter trabajo de arnés en el roadmap de producto es la misma contaminación
que se quiso evitar, al revés. El puntero vive en `AGENTS.md`, que se carga siempre.

## 2026-08-02 — El arnés de trabajo con agentes (`de6f8a4`, `3b4dbd0`, `620f5e4`)

Hasta hoy el "cómo se trabaja acá" era `AGENTS.md` y nada más. Ahora hay tres capas: `AGENTS.md` para
lo universal, **agentes** por área para el ámbito y los límites, y **skills** para las convenciones
—que también carga la sesión principal cuando no delega, que es la mitad de las veces—.

Existen `front` (portal Angular, con `portal-angular`, `portal-estilos` y `portal-testing`) y
`revisor` (transversal, no edita nada). Quedan planificados `datos`, `pipeline` y `render`: el reparto
es por **cuerpo de conocimiento**, no por carpeta, así que `db` + `api` van juntos y los tres paquetes
del pipeline también.

`npm run verificar` es el `init.sh` que faltaba —entorno, archivos del arnés, higiene de secretos,
typecheck y tests, con exit code— y sabe algo que se olvida siempre: **`portal/` no es workspace**, sus
tests no entran en `npm test`. `CHECKPOINTS.md` convierte el ritual en algo que se marca con
evidencia, y el hook `Stop` lo ejecuta el harness: condicional, porque se dispara al final de **cada**
turno (42s de suite completa contra 5s de typecheck, medidos).

Del harness de ejemplo se dejaron fuera tres cosas a propósito: `feature_list.json` (sería un segundo
roadmap desincronizándose), el hook que corre toda la suite tras cada edición, y el líder que nunca
toca código. En el mismo movimiento, la revisión de Codex pasó de ser un párrafo de `AGENTS.md` a la
skill `codex-review`, con la política de no-escritura como lista cerrada de prohibido/permitido.

**La primera revisión del `revisor`, sobre el arnés mismo.** Devolvió CAMBIOS_PEDIDOS con 4
bloqueantes, y los 4 eran reales (verificados uno por uno antes de aplicar nada). El más serio: la
detección de secretos de `verificar.sh` —la única comprobación automática de la regla más dura del
repo— **daba `[OK]` sin haber mirado** cuando `git` no respondía, y su patrón dejaba pasar
`credenciales.env`, `.envrc`, `docs/private/*.env.example` y `portal/node_modules/`. Los cuatro
huecos, medidos. Ahora la lógica vive en `scripts/secretos.mts` con 10 tests y **verificación por
mutación**: cada arreglo hace caer exactamente su test, ninguno de más. El chequeo además falla —en
vez de aprobar— cuando no hay repositorio git.

**La segunda ronda aprobó, y encontró un quinto hueco.** Se le pidió al revisor que verificara el
arreglo y no la explicación (la lección de la tanda 12). Rehízo las cuatro mutaciones por su cuenta,
sondeó 33 rutas raras —espacios, `..`, un `.env` dentro de un directorio llamado `.env.example`— y
encontró una que faltaba: **el detector distinguía mayúsculas**, y `.envrc` era el único de la familia
que `.gitignore` no cubría, así que ahí era la única defensa y se apagaba con Bloq Mayús. Cerrado en
las dos capas: comparación en minúsculas (con su test y su mutación) y `.envrc` agregado al
`.gitignore`.

Los otros tres: dos documentos mandaban escribir los informes a `progress/` (versionado) en vez de
`progress/informes/`; el `09` afirmaba como deuda unos tests de componente de research que **ya
existen** (`runs.spec.ts`, `brief.spec.ts`); y quedaban **quince** cifras de tests viejas repartidas
en ocho archivos, con el `09` contradiciéndose a sí mismo a veintitrés líneas de distancia.

**Cifras, medidas al cierre:** 859 = 624 en el monorepo (los 10 nuevos incluidos) + 235 en el portal
(169 `node:test` + 66 Karma). 12 migraciones, 24 ADRs.

Se revirtieron además 102 borrados de `portal/package-lock.json` que arrastraba el árbol desde antes
de esta sesión: eran campos `libc` de dependencias opcionales por plataforma (churn de un
`npm install` con otra versión de npm). Comprobado antes de descartarlos que ninguna versión cambiaba
y que no entraba ni salía ningún paquete; el portal sigue en 169 después.

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
[runbook](../docs/proyecto/14-runbook-despliegue.md#desplegar-el-renderizador-fase-2)): el DSN quedó
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
[plan](../docs/superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente.md).

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
