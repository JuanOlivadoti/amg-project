# Pieza 3 — El módulo de ideas en el portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Leé primero el [programa](2026-08-01-portal-agencia-programa.md).** Ahí están el orden, la lista de
> qué no se toca, la reserva de números de migración (esta pieza usa `0013`) y la regla de la
> allowlist. Este plan asume todo eso.
>
> ---
>
> ## ⛔ Enmendado el 2026-08-02 — NO ejecutar sin leer esto
>
> Una revisión externa de los cinco planes abiertos encontró tres cosas en este:
>
> 1. **Los permisos estaban descritos por visibilidad, no por verbo.** El plan decía "`grant` a
>    `app_user` sobre `ideas`" y enumeraba quién ve qué. Con un grant amplio y una policy de solo
>    `using`, **un rol `cliente` podría editar, aprobar o rechazar su propia idea** — que es
>    exactamente lo contrario del producto (la agencia revisa) y contradice ADR-20. Ver Etapa 1.
> 2. **El test de fuga contra `app_render` podía ser vacuo.** Decía "leer como `app_render` y
>    confirmar que no hay forma de llegar", con mutación "agregar un `grant` y ver que cae". Pero si
>    el test afirma *cero filas* y la tabla tiene `force row level security` sin policy para
>    `app_render`, **agregar el grant sigue devolviendo cero filas y la mutación no cae**. Un test de
>    seguridad que no puede fallar es peor que no tenerlo. Tiene que afirmar `permission denied`.
> 3. **Falta el contrato de exposición**, y de eso depende la pieza 4. `GET /ideas` sin proyección
>    devolvería transcripción y análisis de todas las filas; el dashboard quiere esa lista para
>    contar estados. Se acabaría mandando el dato más sensible del sistema al navegador para pintar
>    un contador. Ver Etapa 3.
>
> Y una cuarta, que es trabajo **añadido**: la pieza 1 dejó un módulo de ideas **mock** dentro de
> `/clientes/:id/ver` (`cliente-vista.ts`, tab "Ideas", datos iguales para todos los clientes). Esta
> pieza construye el real y tiene que retirar o conectar aquel. Ver Etapa 7.

**Goal:** que las ideas que el cliente manda por audio se puedan revisar, editar y aprobar/rechazar
desde el portal, con los datos en Postgres bajo RLS. Origen:
`dashboard-project/src/app/pages/idea` (104 líneas), `shared/components/idea/*` (3 cards),
`shared/components/tables/ideas-table`, y `core/models/idea.model.ts`.

**Rama:** `feature/modulo-ideas`. **Depende de:** pieza 1 (una idea pertenece a un cliente).

## Esto NO es un port: es funcionalidad nueva

Las otras piezas mueven pantallas sobre datos que AMG ya tiene o casi. Ideas **no existe** en AMG OS:
no hay tabla, ni endpoints, ni concepto. Hay que construir el módulo entero. Y hay un hecho que
cambia el alcance:

> **Las ideas no se crean en la aplicación.** `dashboard-project/src/app/core/services/ideas.service.ts`
> solo **lee** (`collectionData`, `collectionGroup`) y **actualiza** (`updateDoc`): no hay un solo
> `addDoc`. Las ideas entran por un flujo de **n8n** (`n8n workflows/Agency Dashboard - DEV (3).json`)
> que recibe un audio, lo transcribe, lo analiza y escribe en Firestore, en
> `clients/{clientId}/ideas`.

**Decidido:** esta pieza construye **el modelo, los endpoints y las pantallas**, con un **seed de
ejemplo** para poder verlas funcionando. **El ingreso real (n8n) se decide después** — pero el diseño
deja el hueco preparado y documentado, para que conectarlo luego no exija rehacer nada.

Lo que "dejar el hueco preparado" significa concretamente:

- La tabla admite todos los campos que n8n produce hoy (transcripción, análisis, checklist, ideas
  complementarias), aunque el portal todavía no los escriba.
- El estado nace en `nueva`, que es lo que n8n produciría.
- **Se anota, sin implementarlo,** que el ingreso será un endpoint de escritura autenticado con un
  secreto propio (HMAC), separado del token de usuario: n8n no es una persona y no debería llevar un
  JWT de nadie. Ese endpoint es de otro plan.
- **No se inventa el pipeline de audio.** Sin storage en AMG OS (ver el programa), `audio_url` y
  `carpeta_url` son **URLs a donde el audio ya vive**. Nada se sube.

## Architecture

```text
(futuro) n8n ─HMAC─►  POST /ideas          ← NO en esta pieza, solo el hueco documentado

portal/  pages/ideas/*  ──►  services/ideas.ts (signals)  ──►  core/api-core.ts
                                                                    ▼
api/     GET /ideas · GET /ideas/:id · PATCH /ideas/:id  ──►  db/ ideas.ts (bajo RLS)
                                                                    ▼
db/      migrations/0013_ideas.sql  ──►  tabla ideas (tenant_id, client_id, estado, análisis jsonb)
```

**Columna vs `jsonb`, igual criterio que en clientes:** columna para lo que se filtra y ordena
(`estado`, `client_id`, `titulo`, `creada_en`, `actualizada_en`); un `jsonb analisis` para el bloque
que produce el LLM y que solo se muestra (`audiencia_objetivo`, `canales_comunicacion`, `intencion`,
`materiales_formatos`, `observaciones`, `checklist_interpretacion`, `ideas_complementarias`,
`tipo_accion`). La tabla de ideas filtra por estado y por cliente; el análisis no se filtra nunca.

**El estado es una máquina, no un texto libre.** `nueva → en_revision → aprobada | rechazada`. Va como
enum de Postgres (`idea_estado`), no como `text`: un `text` acepta `'aprovada'` y nadie se enteraría
hasta que la pantalla filtre y no encuentre nada.

**Aislamiento:** `ideas` lleva `tenant_id` **y** `client_id`, con la **FK compuesta**
`(client_id, tenant_id) references clients (id, tenant_id)` — el mismo mecanismo que usa `kr_runs`
(`0001_init.sql`), que es lo que impide que una fila de un tenant referencie datos de otro. RLS
controla qué filas ves; la FK compuesta controla la integridad entre tablas. Hacen falta las dos.

**El rol `cliente` ve solo sus ideas.** Un `cliente` está atado a un `client_id`
(`cliente_exige_client_id`), así que su política es más estrecha que la de `equipo`/`maestro`. Esto va
con test, porque es exactamente el caso que la política vieja de `clients` resolvía mal (le mostraba
toda la cartera).

## Global Constraints

Las del [programa](2026-08-01-portal-agencia-programa.md#cómo-no-interrumpir-la-demo), más:

- **Las transcripciones son datos del cliente y son internas.** Ni el texto, ni el análisis, ni la URL
  del audio entran en la allowlist pública (regla 5 del programa). Test de fuga con mutación.
- **Una transcripción es una superficie de inyección.** Es texto generado a partir de un audio de
  WhatsApp: llega con lo que sea. En el portal se renderiza como **texto**, nunca como HTML
  (`innerHTML` prohibido); si algún día una idea alimenta al renderizador, pasa por `esc()` como todo
  lo demás.
- **El estado cambia por transiciones válidas, no por asignación libre.** `aprobada → nueva` no es una
  transición: se rechaza en la API y hay un test por cada transición inválida que importe.
- **`nueva` es el default de producción**, y por lo tanto lleva su propio test (un default sin test es
  una decisión sin dueño): insertar sin estado y verificar que queda `nueva`, sin que el test lo pase
  como parámetro.
- **El seed de ejemplo va en un archivo nuevo.** `db/src/seed-ideas-demo.ts`, con su propio CLI si hace
  falta. **No** se toca `db/src/seed-demo.ts` (producción está sembrada con él y dos tests lo atan:
  `seed-demo.test.ts` y `cartera-portal.test.ts`).

## Etapa 1 — El esquema (`db`)

- [ ] **Rojo primero** en `db/src/ideas.test.ts`: guardar y leer una idea con todo el análisis;
      insertar sin estado deja `nueva`; un estado inválido se rechaza; una idea con `client_id` de otro
      tenant se rechaza (FK compuesta); `analisis` que no es objeto se rechaza.
- [ ] Escribir `db/migrations/0013_ideas.sql`:
      - `create type idea_estado as enum ('nueva', 'en_revision', 'aprobada', 'rechazada')`.
      - `create table ideas (id, tenant_id, client_id, titulo, resumen, estado idea_estado not null
        default 'nueva', transcripcion text, audio_url text, carpeta_url text, mensaje_de text,
        analisis jsonb not null default '{}'::jsonb, creada_en, actualizada_en, ...)`.
      - FK compuesta `(client_id, tenant_id) references clients (id, tenant_id)`.
      - `check (jsonb_typeof(analisis) = 'object')` — la forma del valor, no solo el nombre de la clave.
      - `alter table ideas enable row level security` **y `force row level security`** (es lo que hace
        el resto del esquema: sin `force`, el dueño de la tabla se saltea las políticas).
      - **Permisos por VERBO, no por visibilidad** (enmienda del 2026-08-02). Cada uno con su test:
        - `select`: staff del tenant (`equipo`/`maestro`) todas las del tenant; `cliente`, **solo las
          de su `client_id`**.
        - `update`: **solo `equipo`/`maestro`**. Un `cliente` NO edita, NO aprueba y NO rechaza su
          propia idea — la revisa la agencia, que es el producto entero (ADR-20).
        - `insert`: **nadie desde `app_user`** mientras el ingreso real (n8n/audio) esté fuera de
          alcance. Una idea la crea el seed o el futuro ingreso, no una pantalla.
        - `delete`: **sin grant.** Si algún día hace falta, se decide entonces.
        - `servicio`: **sin privilegios especulativos.** Si el ingreso futuro los necesita, se los da
          el plan que lo construya.
      - `grant` a `app_user` **enumerando los verbos concedidos**, nunca `all`. **Ningún grant a
        `app_render`.**
      - Índices: `(tenant_id, estado)`, `(tenant_id, client_id)`.
- [ ] Verificación por mutación de cada constraint, del `force row level security` y del default
      `nueva`.
- [ ] **Test de fuga contra `app_render`, afirmando el error y no el conjunto vacío.** El test tiene
      que exigir **`permission denied`** (fallo de ACL), no "devuelve cero filas". Con `force row
      level security` y sin policy para `app_render`, un `select` da cero filas *aunque exista el
      grant*: si el test mira el conteo, **la mutación de control no cae y el test no prueba nada**.
      Mutación: agregar `grant select on ideas to app_render` en una copia local y confirmar que el
      test cae de verdad.
- [ ] **Tests de escritura por rol, no solo de visibilidad:** un `cliente` que hace `update` de su
      propia idea no afecta filas; un `equipo` sí. Es el vector que la enmienda encontró abierto —
      "ve las suyas" no implica "no puede tocarlas".
- [ ] **Test del rol `cliente`:** dos clientes en el mismo tenant, una idea cada uno; el `cliente` A
      ve una sola. Mutación: relajar la política a "todas las del tenant" y confirmar que cae.

## Etapa 2 — Datos y transiciones (`db`)

- [ ] **Rojo primero:** `listarIdeas` filtra por estado y por cliente; `cambiarEstado` acepta las
      transiciones válidas y rechaza el resto; `editarIdea` no permite cambiar `tenant_id` ni
      `client_id` (mover una idea de cliente es otra operación, y si no existe, no se ofrece).
- [ ] Implementar `db/src/ideas.ts` con el patrón de `db/src/store.ts` (`withTenant`, `Tx`).
- [ ] La máquina de estados vive en un solo lugar (`db/src/ideas.ts`, exportada) y **la usan la API y
      el portal** — no dos copias que se desincronizan. El portal la importa vía su propia constante si
      no puede importar el paquete; si se duplica, un test ata las dos copias (como hace
      `db/src/cartera-portal.test.ts` con el brief: el portal está fuera del monorepo, lo que impide
      importar el paquete, **no** leer el archivo).

> ### ✅ Etapas 1 y 2, hechas el 2026-08-09 — y seis decisiones que este plan no fijaba
>
> Van acá y no en un informe de sesión porque `progress/informes/` está **gitignoreado**: quien escriba
> la Etapa 3 tiene que poder leer esto. Lo detectó la revisión interna.
>
> 1. **La máquina de estados quedó en DOS sitios, y contradice al punto de arriba a propósito.** El
>    trigger `ideas_transicion_estado` de la `0013` la impone en Postgres, y `esTransicionValida()` la
>    repite en TypeScript. El motivo: un `update` que no pasara por `cambiarEstado` podía retroceder un
>    estado, y una garantía que depende de que todos usen la función correcta no es una garantía. El
>    TypeScript queda para dar un **400 con motivo** en vez de un 500 con un `23514` crudo. Las dos
>    copias las ata un test que recorre los **12 pares** — y ojo, ese test solo es completo junto con
>    el que comprueba que `TRANSICIONES_IDEA` cubre los cuatro estados: por sí solo no ve un estado que
>    exista en Postgres y no en TypeScript.
> 2. **Los permisos se conceden por VERBO y además por COLUMNA.** `grant update (titulo, resumen,
>    estado, …)`, nunca `grant update on ideas`. Con eso, "no se puede mover una idea de tenant ni de
>    cliente" deja de ser una allowlist de TypeScript y pasa a ser un `42501` que dicta Postgres.
>    Efecto lateral a saber: `has_table_privilege('app_user','ideas','update')` devuelve **`false`**, y
>    hay un test que lo fija así a propósito.
> 3. **`cambiarEstado` bloquea la fila con `select … for update`**, y eso decide el contrato de la
>    Etapa 3: Postgres aplica a las filas bloqueadas **también el `using` de las políticas de UPDATE**,
>    así que un rol `cliente` obtiene 0 filas y recibe siempre `no_encontrada` (**404**). Sin el
>    bloqueo recibía 400 o 404 según *qué* transición pidiera sobre una idea que en ningún caso puede
>    tocar. **Medido, no supuesto** — y la primera versión de este código afirmaba en un comentario que
>    `for update` era imposible con un grant por columna, lo cual es **falso**: cuando la cláusula de
>    bloqueo no nombra columnas, Postgres comprueba si hay privilegio sobre *alguna*. La misma frase
>    falsa vive en la `0012`, que está aplicada en producción con el checksum congelado: **no se puede
>    arreglar allí**, solo no propagarla.
> 4. **Los techos de tamaño nacen con la tabla**, no en la Etapa 3 como decía el punto correspondiente:
>    `titulo` 200 B, `resumen` 2 KB, `transcripcion` 64 KB, `analisis` 32 KB, las dos URL 2 KB. Mismo
>    criterio que la `0016` (*"con la constraint puesta, ni el endpoint ni la pantalla necesitan lógica
>    de tamaño — no pueden recibir algo que no entró"*). La Etapa 3 **ya no tiene que implementarlos**;
>    lo que sí le toca es validar `audio_url`/`carpeta_url` como http(s) y las claves de `analisis`.
> 5. **`listarIdeas` devuelve un resumen de 5 campos, sin transcripción ni análisis.** El contrato de
>    exposición de la Etapa 3 empieza en el `select`: lo que no sale de Postgres no se puede olvidar de
>    filtrar después. El test compara el conjunto **exacto** de claves.
> 6. **`LIMITE_IDEAS = { porDefecto: 200, maximo: 500 }`** y el orden es `creada_en desc, id desc` (el
>    desempate evita que un listado paginado repita o saltee). `aprobada` y `rechazada` son
>    **terminales**: reabrir no existe, y si el producto lo quiere, hay que tocar las dos copias.
>
> **Lo que la Etapa 3 hereda sin hacer nada:** `PgIdeas` exportado desde `db/src/index.ts`, el mapeo
> `23514 → 400` que `api/src/app.ts` ya hace, y el recorte del listado. **Lo que sigue sin resolver:**
> la serialización de `creada_en` (`Date` → JSON → portal), que es de las que revientan en la frontera
> y que ningún test del monorepo ve porque `portal/` no es workspace — fijala con un test de la
> respuesta HTTP, no con un tipo.

## Etapa 3 — Endpoints (`api`)

- [ ] **Rojo primero**, un test por vector: sin token → 401; otro tenant → no ve; un `cliente` solo ve
      las suyas; `PATCH` con transición inválida → 400 (no 500); `PATCH` con `tenant_id` en el body →
      se ignora; `PATCH` de una idea de otro tenant → 404 sin revelar existencia.
- [ ] **El contrato de exposición — dos DTO distintos, y esto es lo que consume la pieza 4**
      (enmienda del 2026-08-02):
      - **`GET /ideas` devuelve un RESUMEN**: `id`, `client_id`, `titulo`, `estado`, `creada_en`.
        **Sin `transcripcion`, sin `analisis`, sin `audio_url`.** Con filtros (`estado`,
        `clientId` — camelCase en el query, ver la enmienda del 2026-08-09 al pie de esta etapa),
        orden y **límite**. Es lo que el dashboard y los listados necesitan; mandar la
        transcripción de cada idea al navegador para pintar un contador es filtrar el dato más
        sensible del sistema por comodidad.
      - **`GET /ideas/:id` devuelve el detalle completo**, incluida la transcripción y el análisis.
        Una idea a la vez, abierta a propósito por alguien que la está revisando.
      - `PATCH /ideas/:id` (contenido y estado).
- [ ] Test de que `GET /ideas` **no** trae `transcripcion` ni `analisis` en ningún ítem, ni siquiera
      cuando el que pregunta es `maestro`. Es un contrato, no un permiso: nadie necesita 200
      transcripciones en una respuesta de listado.
- [ ] **Límites de tamaño en la base**, no solo en el cliente: largo máximo de `titulo`, `resumen` y
      `transcripcion`; tamaño y claves admitidas de `analisis`; `audio_url`/`carpeta_url` validadas
      como URL http(s). Un jsonb sin tope es una fila que puede crecer sin techo.
- [ ] ¿Aprobar una idea dispara algo? Hoy, no. **No se inventa un evento**: si en el futuro una idea
      aprobada arranca un research, será fila primero y evento después (ADR-18), y lo decide otro plan.
- [ ] `api/src/dev-server.ts` con ideas de ejemplo sobre PGlite.

> ### ✅ Etapa 3, hecha el 2026-08-09 — el contrato que consumen la 4 y la 5
>
> Misma razón que la enmienda de la Etapa 2: esto vivía en `progress/informes/`, que está
> **gitignoreado**, y una de las decisiones ya contradecía a este plan. Lo cazó la revisión interna.
>
> **Tres endpoints** en `api/src/app.ts` (`GET /ideas`, `GET /ideas/:id`, `PATCH /ideas/:id`) más
> `api/src/ideas-http.ts` para el borde (validación y serialización). **No hay `POST`**: `app_user` no
> tiene grant de `insert`, porque el ingreso real por n8n no existe. **No se emite ningún evento** al
> aprobar, tal como decide el punto de arriba.
>
> **El contrato con el portal, literal:**
>
> ```text
> GET   /ideas?estado=&clientId=&limite=   → { ideas: [{ id, client_id, titulo, estado, creada_en }] }
> GET   /ideas/:id                         → { idea: { …resumen, resumen, transcripcion, audio_url,
>                                                      carpeta_url, mensaje_de, analisis, actualizada_en } }
> PATCH /ideas/:id  { estado }             → { ok: true, estado } | 400 { error, desde, hacia } | 404
> PATCH /ideas/:id  { …contenido }         → { ok: true }         | 400 | 404
> ```
>
> 1. **El query param es `clientId`, en camelCase**, no `client_id` como decía este plan (ya corregido
>    arriba). Manda la consistencia con `GET /runs?clientId=`, que existe desde antes: **query params en
>    camelCase, campos del JSON en snake_case** (que son los nombres de las columnas). Un `clientId=`
>    **vacío** se trata como "sin filtro", igual que `limite=` — el `<select>` de "todos los clientes"
>    de la Etapa 5 emite exactamente eso.
> 2. **`creada_en` y `actualizada_en` salen como string ISO-8601 UTC**, no como `Date`. Es la frontera
>    donde `ClienteCRM.created_at` ya miente, así que acá lo fija un test de la **respuesta HTTP**, no
>    un tipo — `portal/` no es workspace y ningún test del monorepo ve si esto se rompe.
> 3. **El listado son cinco campos.** La pantalla de detalle **tiene que pedir `GET /ideas/:id`**: la
>    transcripción no viaja en un listado ni para un `maestro`. El recorte vive en el `select` de
>    `listarIdeas`, y el serializador HTTP usa `spread` a propósito (enumerar sería una allowlist
>    positiva, que falla en silencio: un campo legítimo olvidado desaparecería sin error). Lo que caza
>    la deriva es el test del conjunto **exacto** de claves.
> 4. **`PATCH` rechaza mezclar `estado` con contenido** (400). Son dos escrituras en **dos
>    transacciones** (`cambiarEstado` y `editarIdea`), y aceptarlas juntas podría aplicar la primera,
>    fallar la segunda y contestar error habiendo cambiado algo. Si el producto necesita las dos en una
>    petición, hace falta un método nuevo en `db/src/ideas.ts` que las haga en una sola transacción:
>    **es deuda declarada**, no un olvido.
> 5. **`analisis` valida los NOMBRES de sus 8 claves, no la forma de los valores.** Medido: un
>    `canales_comunicacion: {…}` en vez de un array entra y se guarda. No es un agujero (el vocabulario
>    está cerrado, el tamaño topado en 32 KiB y no cruza tenant), pero **`@for` sobre un objeto lanza en
>    Angular**, y las tres claves que la Etapa 5 va a listar son justo las que pueden no ser arrays: la
>    pantalla **comprueba `Array.isArray()` antes de listar**.
> 6. **`titulo: ""` se acepta**: la `0013` le puso techo (200 B) y no piso. La Etapa 5 necesita un
>    fallback visible o un `required` en el formulario, o la tabla muestra una fila en blanco.
> 7. **El seed de `api/src/dev-server.ts` es provisional** — cuatro ideas, una por estado, marcadas
>    `[EJEMPLO]`, insertadas con la infraestructura porque `app_user` no puede insertar (que ahí haga
>    falta el superusuario es la forma de notar el hueco). **La Etapa 4 lo reemplaza** por
>    `db/src/seed-ideas-demo.ts`, que además lleva su test de idempotencia.
>
> **Del ítem "límites de tamaño" de esta etapa:** la mitad de la base **ya la hizo la `0013`** (ver la
> enmienda de la Etapa 2). Lo que se hizo acá es lo que la base no mira: `audio_url`/`carpeta_url`
> validadas como **http(s)** —el portal las pinta en `<a href>` y `<audio src>`, donde `javascript:`
> es XSS— y la **allowlist de claves** de `analisis`.

## Etapa 4 — El seed de ejemplo

- [x] `db/src/seed-ideas-demo.ts` (**archivo nuevo**): un puñado de ideas para La Birra Bar en los
      cuatro estados, con transcripción y análisis realistas pero **claramente de ejemplo** — que nadie
      las confunda con datos de un cliente. Idempotente por id fijo, como `sembrarDemo`.
- [x] Su test: sembrar dos veces no duplica; las ideas sembradas se leen bajo RLS con el rol correcto.
- [x] **No** engancharlo al `reseed:demo` de producción sin pedirlo: producción tiene datos reales de
      la demo y este seed es para desarrollo. Si se quiere en producción, es una decisión aparte.

> ### ✅ Etapa 4, hecha el 2026-08-10 — lo que decidió el seed
>
> Tercera nota de enmienda por el mismo motivo que las dos anteriores: esto vivía en
> `progress/informes/`, que está **gitignoreado**. Lo volvió a cazar la revisión interna.
>
> 1. **`delete` + `insert`, no `on conflict do update`.** Un upsert es un `UPDATE`, y sobre `ideas` los
>    `UPDATE` los gobierna el trigger de transiciones: re-sembrar después de que alguien apruebe una
>    idea daría `23514`. **Medido**, no supuesto — un upsert sería idempotente *solo mientras nadie
>    hubiera tocado la pantalla*, que es justo cuando no hace falta re-sembrar. El `delete` va por los
>    **ids fijos**, nunca por `client_id`, así que cuando exista el ingreso por n8n no se lleva por
>    delante una idea real. Efecto a saber: como los ids son globales, `sembrarIdeasDemo` **solo puede
>    tener un destino vivo a la vez**; hoy hay un único llamador.
> 2. **Cinco ideas, no cuatro.** La quinta es una **recién llegada sin transcripción ni análisis**
>    (`analisis: {}`), que es el estado real de una fila entre que entra el audio y el LLM la procesa.
>    Sin ella, la Etapa 5 se escribiría contra un dato que en producción no siempre existe. Y está
>    comprobado que sus `null` no le dan un 400 al `PATCH`.
> 3. **`creada_en`/`actualizada_en` se siembran a mano**, porque `now()` es el instante de la
>    *transacción* y las cinco nacían empatadas al milisegundo — con lo que el `order by creada_en desc,
>    id desc` se resolvía entero por el desempate y nadie veía nunca el criterio principal. Las
>    antigüedades están elegidas para que **el orden por fecha contradiga al de los ids**: con los dos
>    de acuerdo, un test de orden no distingue cuál se aplicó.
> 4. **Marcadas `[EJEMPLO]` en cinco campos visibles** —título (como **prefijo**, para que un truncado
>    corte la cola y no la marca), resumen, remitente, primera línea de la transcripción y
>    observaciones—, con test que lo impone. Y la otra mitad de la regla: **el seed no inventa nada
>    sobre el negocio** (sin precios ni horarios, prohibido por test), porque La Birra Bar existe. URL a
>    `example.invalid` (RFC 2606): un `<audio src>` de ejemplo no puede terminar sonando algo real.
>    ⚠️ **Para la Etapa 5:** los campos del *análisis* que la pantalla va a listar no llevan marca y
>    leídos aislados pasan por análisis real. La pantalla entera se distingue; una tarjeta recortada,
>    no. Una etiqueta de "datos de ejemplo" a nivel de pantalla lo cierra.
> 5. **Sin CLI propio** (el plan lo dejaba abierto): sumaría una superficie que podría apuntar a
>    producción. Y **un test estructural fija que esto NO está enganchado**, mirando los dos caminos de
>    siembra *y* los dos del proceso que habla con Supabase — porque `db/src/index.ts` exporta
>    `sembrarIdeasDemo` y el camino real a producción sería un `import` de una línea que nadie nota en
>    un diff.
> 6. **El contrato con el borde HTTP se ata desde `api/`** (`api/src/ideas-seed-contrato.test.ts`): el
>    seed inserta con la infraestructura y **se salta entero** el borde, así que el vocabulario de
>    `analisis` y el esquema de las URL no los comprueba nadie más. `db` no puede importar de `api`, así
>    que ése es el único sitio donde se tocan las dos puntas.
>
> **Deuda que hereda la Etapa 5:** el fallback de `titulo` vacío (la `0013` le puso techo y no piso; el
> seed no lo ejercita porque todos sus títulos tienen texto), y que **el ingreso real por n8n sigue sin
> existir** — el seed es hoy la única vía de creación, y que necesite la conexión de infraestructura es
> lo que mantiene visible ese hueco.

## Etapa 5 — Las pantallas ✅ hecha el 2026-08-12

> **Desviación del plan, acordada con el usuario antes de ejecutar.** Este plan es del 2026-08-01 y
> asume un listado global `/ideas` (de toda la cartera) con filtro de cliente, más `/ideas/:id`. El
> rediseño de navegación del 2026-08-11 ([spec](2026-08-11-ficha-cliente-navegacion-design.md)) hizo
> el portal 100% cliente-céntrico — no existe `/runs` ni ningún listado global. El listado real quedó
> en `clientes/:id/ideas` (reemplazando el placeholder `ClienteIdeasPage`, que ya señalaba el hueco) y
> el detalle en `clientes/:id/ideas/:ideaId`, siguiendo el mismo patrón que el tab hermano
> `cliente-research.ts` (Vigencia, `paramMap` heredado, sin pedir el cliente de nuevo). No hay
> selector de cliente en la pantalla de ideas: el cliente lo fija la URL, igual que en research.

- [x] **Listado, en `clientes/:id/ideas`** (no un `/ideas` global — ver desviación arriba). Filtro de
      estado con signals/`computed`. Task 1 de `feature/modulo-ideas`, commit `340fb51`.
- [x] **Detalle, en `clientes/:id/ideas/:ideaId`** (no `/ideas/:id`). El audio se ofrece como enlace a
      `audio_url` (y `<audio>` si el navegador puede reproducirlo), nunca se sube nada. Task 2, commits
      `f34eb24` + fix `c86e5aa`.
- [x] La transcripción y el análisis se renderizan como texto/listas (por `Array.isArray` en runtime,
      no por nombre de clave fijo). Nada de `innerHTML` — confirmado por el test estructural que
      recorre `src/` completo.
- [x] Aprobar/rechazar: acciones explícitas contra `ideas-transiciones.ts` (la máquina de estados del
      portal, atada por test a `db/src/ideas.ts` con el mismo mecanismo de import en runtime que
      `codigos.test.ts` — la primera versión de esa atadura era falsa, hallazgo de la revisión,
      corregido). El servidor rechaza igual una transición inválida.
- [x] Tests de componente (Karma): 136/136 (128 antes de esta etapa + 8 nuevos).

## Etapa 6 — Rutas, navegación y cierre ✅ hecha el 2026-08-12

- [x] Ruta `ideas/:ideaId` agregada como hija de `clientes/:id`, hereda `authGuard` del padre. El tab
      "Ideas" ya estaba en `TABS_FICHA` desde el rediseño del 2026-08-11 (no hizo falta tocar
      navegación de nivel superior). `app.routes.test.ts` actualizado.
- [x] **Navegador**, verificado dos veces (por los implementadores por task, y por el controlador de
      forma integrada al cerrar la etapa): listar, filtrar, abrir, editar, aprobar, rechazar,
      transición inválida deshabilitada, tema claro y oscuro, consola sin errores propios. Un detalle
      preexistente y no de esta pieza, encontrado y no corregido (no es de este diff): un id de idea
      malformado (no-UUID) da un mensaje de error genérico y equivocado del `onError` compartido de
      `api/src/app.ts` — con un UUID válido pero inexistente el 404 real dice correctamente "Idea no
      encontrada."
- [x] Confirmado intactas: `/clientes`, `/clientes/:id/perfil`, `/clientes/:id/research`,
      `/clientes/:id/research/:runId`, `/cartera` (no hay `/runs` desde el rediseño del 2026-08-11).
- [x] `npm test` + `npm run typecheck` desde la raíz: limpio, sin fallas nuevas. `npm test -w portal`:
      265/262/3 (los 3 son el mismo bug preexistente de Windows). `npm run test:components -w portal`:
      136/136.
- [x] Docs actualizadas: `09-estado-y-roadmap.md`, `15-plan-plataforma.md` (que reemplazó al `11` como
      plan activo), pieza marcada en la tabla del [programa](2026-08-01-portal-agencia-programa.md) vía
      el estado en el `15`. Cifras sincronizadas.
- [x] **El hueco explícito:** el ingreso real de ideas (n8n) no existe. Documentado acá y en
      `09-estado-y-roadmap.md`; las 5 ideas que se ven en el portal son el seed de ejemplo
      (`db/src/seed-ideas-demo.ts`), marcadas `[EJEMPLO]` en el propio título.

## Etapa 7 — Retirar el módulo de ideas mock de la pieza 1

> Añadida el 2026-08-02. `/clientes/:id/ver` (`cliente-vista.ts`) ya tiene un tab "Ideas" con datos
> de ejemplo: sus propios tipos, estados y contadores, en `core/cliente-vista-mock.ts`. El propio
> archivo declara que **el contenido es el mismo para cualquier cliente** porque cuando se escribió no
> había ideas reales de las que filtrar. Ahora las hay. Si esta pieza no lo cierra, el portal queda
> con dos representaciones de "ideas": una real en `/ideas` y una ficticia dentro del cliente —
> y la pieza 4 va a reutilizar la real, con lo que la contradicción queda a dos clics.

- [ ] Decidir y ejecutar **una** de las dos: (a) el tab pasa a mostrar las ideas **reales** filtradas
      por `client_id`, reutilizando el modelo, el servicio y el componente de tabla de esta pieza —
      no una segunda implementación; o (b) el tab se retira hasta que alguien lo pida.
      Recomendado (a): la pantalla ya existe y es donde un cuentas mira a su cliente.
- [ ] **Los mocks de Instagram y Reseñas siguen siendo mocks y tienen que verse como tales.** Si el
      tab de ideas pasa a datos reales, que un tab real conviva con dos ficticios sin distinción es
      peor que tener los tres ficticios. Marcarlos explícitamente en la UI o retirarlos.
- [ ] Limpiar de `core/cliente-vista-mock.ts` lo que deje de usarse. Un generador de ideas falsas que
      ya no llama nadie es una trampa para el próximo que lo encuentre.

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| Una transcripción o el audio se filtran al renderizador anónimo | Test de fuga que exige **`permission denied`**, no cero filas — con `force row level security` el conteo vacío no prueba nada. Ningún `grant` a `app_render` |
| **Un `cliente` edita o aprueba su propia idea** | Permisos por verbo: `update` solo para staff, con test de escritura por rol (no solo de visibilidad) |
| **La transcripción viaja al navegador para pintar un contador** | `GET /ideas` devuelve resumen sin transcripción/análisis; el detalle solo por `GET /ideas/:id`, con su test |
| Un `cliente` ve las ideas de otro cliente del mismo tenant | Política estrecha por `client_id` + su test con mutación |
| El estado se corrompe (`'aprovada'`) o retrocede | Enum de Postgres + máquina de transiciones en un solo lugar, validada en la API |
| La pantalla parece enchufada al pipeline de audio y no lo está | Informe de cierre + aviso en la UI. El seed es "de ejemplo" y se nota |
| El módulo se construye asumiendo storage que no existe | `audio_url` es una URL externa. Subir archivos es otro plan |
| Dos copias de la máquina de estados (db y portal) se desincronizan | Un test que ata las dos, como `cartera-portal.test.ts` |
