# 15. Plan de la plataforma — lo que queda

> **Este es el plan de la fase en curso.** Dice **el orden y el detalle**; el estado global lo dice
> [`09-estado-y-roadmap.md`](09-estado-y-roadmap.md), y **cuando se contradigan, gana el `09`**.
> El plan de la fase anterior, cerrado, es [`11-plan-fase-2.md`](11-plan-fase-2.md).
>
> Escrito el **2026-08-07**, el día que se cerró Fase 2.

---

## De dónde partimos

**Fase 2 está cerrada.** Las cuatro piezas desplegadas y el circuito probado de punta a punta en
producción: un research lanzado desde el portal recorrió `POST /runs` → Inngest → orquestador →
`kr-service` → Postgres → informe → `pending_approval` (124 keywords, 25 páginas, $0.00 con los
providers en mock).

Lo que **existe y funciona**: los módulos 1 (creador de webs) y 2 (keyword research), la persistencia
multi-tenant con RLS forzada, la API autenticada, el portal de la agencia, el renderizador público, y
la compuerta humana con orquestación durable.

Lo que **no existe todavía** es lo que ordena este documento.

---

## Cómo leer este plan

Cada bloque dice **qué**, **por qué ahora**, **qué archivos**, **cómo se verifica** y **qué cuesta**.
El orden no es por tamaño: es por lo que bloquea a lo demás y por lo que ya nos costó tiempo.

Los bloques **A** y **B** son de fiabilidad y de deuda decidida: piezas chicas, sin decisiones
pendientes, que se pueden hacer seguidas. El **C** es el único tramo del producto sin ejercitar. Del
**D** en adelante hay decisiones de negocio o gasto de por medio.

| Bloque | Qué | Bloquea a | Decisión previa |
| --- | --- | --- | --- |
| **A** | Fiabilidad del despliegue | Operar sin sustos | A3 y A4 dependen de Juan |
| **B** | Deuda de producto ya decidida | — | ya tomadas |
| **C** | Aprobar → publicar, ejercitado | Cerrar el circuito entero | modo de publicación |
| **D** | Calibrar el research (KR-1) | La calidad del módulo 2 | **gasta ~$0.31** |
| **E** | El aspecto de las webs | Vender el módulo 1 | diseño |
| **F** | Módulo 3 — reseñas de Google | Completar el alcance base | alcance |
| **G** | Lo que ADR-19 dejó a medias | Un SLA | infraestructura |
| **H** | Offboarding y OBS-04 | Firmar ADR-11 | comercial |
| **J** | Piezas 3 y 4 del portal | Cerrar el programa del portal | ninguna: hay plan escrito |
| **I** | Deuda menor, sin bloqueo | — | — |

> **Enmendado el 2026-08-07 tras la 15ª review externa** (Codex). Cambió más de lo que parece: **A1**
> y **A2** no definían garantías suficientes, **C** ganó una precondición bloqueante (**C0**), **A3**
> quedó detrás de **A4**, **D** absorbió dos deudas que el `09` le atribuía, y el bloque **J** no
> existía. La clasificación hallazgo por hallazgo está en `progress/informes/` (no versionado).

---

## Bloque A — fiabilidad del despliegue

**Por qué primero.** El 2026-08-07, entre desplegar el orquestador y verlo funcionar, hubo **hora y
media de fallos y ninguno fue del código**. Todo lo de este bloque sale de ahí, y su valor no es
teórico: es el tiempo que costó, medido.

### A1. `/_health` del orquestador tiene que decir la verdad sobre Postgres — ✅ **hecho el 2026-08-07**

> **Hecho, y verificado manejando el proceso, no solo con tests.** `orchestrator/src/salud.ts` (sonda
> con cache, timeout y log de transición) + `PgStore.comprobarAcceso()`, 13 tests nuevos.
> **Se reprodujo el incidente**: arrancando el orquestador con el host `base` —el DSN exacto que rompió
> producción el 2026-08-07— `/_health` devuelve
> `{"ok":true,…,"degradado":["postgres"]}` con **una sola** línea `[salud] DEGRADADO: postgres no
> responde — getaddrinfo ENOTFOUND base`, pese a tres consultas cruzando el TTL. Lo de abajo queda como
> el razonamiento.

**El problema.** Responde `{"ok":true}` con la base inalcanzable. Está escrito así a propósito —para
que el health check no dependa de terceros— pero **para el orquestador la base no es un tercero: es
todo lo que hace**. Es la segunda vez en el mismo día que un health check declara sano un servicio
inservible (la primera fue el 401 de la firma de Inngest).

**Qué hacer.** `/_health` comprueba la base **sin volverse frágil**: una sonda con timeout corto,
cacheada unos segundos para que un chequeo no abra una conexión por request.

**La sonda va por `Tx` con el rol real, no un `select 1` sobre la conexión cruda.** Lo señaló la 15ª
review (Codex, H3) y tiene razón: `select 1` prueba que hay TCP y credencial, no que el proceso pueda
**asumir su rol**. El orquestador entra como `amg_orquestador` y hace `set local role app_service`
(ADR-17); si eso falla, el workflow no puede hacer nada y `select 1` seguiría diciendo que sí. La
sonda tiene que recorrer el mismo camino que el trabajo real.

**La trampa, y está decidida explícitamente:** si `/_health` devuelve un código de error, Railway
considera el deploy enfermo y lo **reinicia o lo revierte** — y volveríamos a tener el servicio caído
por otra puerta, que es exactamente el error del tramo A ("fallar ancho no es fallar ruidoso"). Va
**200 con un campo `degradado`** que nombre lo que no responde, no un 503.

**Pero un campo que nadie lee no es una señal.** La misma review propuso una readiness consumida por
alerta externa; **no hay alerta externa en este proyecto**, y agregar un endpoint que nadie consulta
es el mismo defecto un piso más arriba. Lo que sí existe son los **logs de Railway**, así que:

- Cada **transición** sano→degradado y degradado→sano se escribe a `stderr` con nivel error, **una vez
  por transición** y no por request — si no, una base caída inunda el log y la señal se pierde otra vez.

- **Archivos:** `orchestrator/src/app.ts`, `orchestrator/src/config.ts`, sus tests.
- **Verificación:** un test que, con la base caída, exige **200** y `degradado` no vacío; otro que con
  la base sana exige el campo ausente; y un tercero que exige **una sola línea de log** aunque se
  llame a `/_health` tres veces seguidas en estado degradado. Mutación: quitar la comprobación deja el
  primero rojo; hacer la sonda con `query()` suelto en vez de `Tx` deja rojo el que niega el rol.
- **Coste:** pieza chica, un solo paquete.

### A2. Un run no puede quedarse en `running` para siempre — ✅ **el código, hecho el 2026-08-07**

> **Hecho, con una casilla operativa abierta.** La guarda de `finishRun` (`29625e6`) y el barrido
> completo —migración `0018`, `app.expirar_runs_colgados`, `PLAZO_RUN_COLGADO = "3 hours"` y la función
> programada de Inngest cada hora— están en `main` con 16 tests y sus mutaciones verificadas.
> **Falta desplegar la `0018`**: hasta entonces el barrido está en el código y no corre. Es un paso de
> Juan (`migrate:deploy` toca Supabase). Lo de abajo queda como el razonamiento que produjo el diseño.

**El problema, medido.** El `onFailure` del workflow existe para que un run no quede colgado, y su
única acción es `failRun()` — o sea **escribir en Postgres**. Cuando el workflow muere porque no
alcanza la base, el manejador muere por lo mismo. **La red de seguridad comparte su punto de fallo con
lo que protege.** Confirmado por el stack del 2026-08-07: `functions.ts:81`.

La compensación de ADR-18 cubre que `send()` **lance**; no cubre que el envío tenga éxito y nadie
consuma el evento. El único plazo del sistema es `PLAZO_APROBACION`, y vive **dentro** del workflow: si
el workflow no arranca, no hay reloj.

**Qué hacer.** Hay dos caminos y conviene elegir con criterio, no por gusto:

1. **Reintento del `onFailure`** con backoff: barato, pero sigue dependiendo de la misma base.
2. **Un barrido independiente** que marque `failed` los runs en `running` más viejos que un plazo.
   No comparte el punto de fallo, pero es un mecanismo nuevo (una función programada de Inngest).

La segunda es la que de verdad cierra la clase. La primera es una mejora del mismo diseño.

### Y hay un bug HOY, anterior al barrido — lo destapó la 15ª review

Codex advirtió (H2) que el barrido podría matar un workflow lento y que el workflow, al terminar,
**pisaría el `failed`**. Al medirlo apareció que la mitad del problema **ya existe**:

- `failRun` ([`db/src/store.ts:773`](../../db/src/store.ts#L773)) **ya es compare-and-set**:
  `where id = $1 and status = 'running'`, con un `else` que anota el error sin tocar el estado. Eso se
  arregló en su día porque un fallo del workflow no puede deshacer una publicación.
- **`finishRun` no lo es** ([`db/src/store.ts:745`](../../db/src/store.ts#L745)): `update kr_runs set
  status = 'pending_approval', … where id = $1`, sin guarda de estado. Así que **cualquier** cosa que
  ponga el run en `failed` o `rejected` mientras el workflow sigue vivo queda pisada al terminar — y
  encima con `finished_at` reescrito. Hoy no muerde porque nada más escribe ese estado; **el barrido
  sería justo eso**.

**El umbral no puede salir de `PLAZO_APROBACION`.** Esa constante vale `"7d"`
([`orchestrator/src/workflow.ts:130`](../../orchestrator/src/workflow.ts#L130)) y gobierna la espera
**posterior**, cuando el run ya está en `pending_approval`. Lo que el barrido tiene que superar es la
duración de la **fase de research**: medida una sola vez, **16m15s**. El umbral se deriva de ahí con
margen, y se escribe de dónde sale.

- **Archivos:** `db/src/store.ts` (la guarda de `finishRun` y el barrido),
  `orchestrator/src/functions.ts`, migración si hace falta un índice por `(status, started_at)`.
- **Verificación**, cuatro tests y no uno:
  1. un run `running` viejo → el barrido lo marca `failed`;
  2. un run `running` **reciente** → no se toca (la mutación que importa);
  3. **el escenario de Codex**: run marcado `failed` por el barrido, el workflow termina después →
     `finishRun` **no** lo devuelve a `pending_approval`;
  4. el camino sano: `running` → `finishRun` → `pending_approval`, que es el control positivo sin el
     cual el 3 pasaría con una guarda que bloquea todo.
- **Coste:** pieza mediana. Cruza `orchestrator/` y `db/`, así que el contrato se fija antes.

### A3. Verificar el DESPLIEGUE, no solo la fuente — ✅ **hecho el 2026-08-08**

> **`npm run auditar:railway`.** Y encontró cosas a la primera corrida, que es de lo que se trataba.
>
> **🔴 La API tenía las credenciales de los otros dos procesos.** En `amg-project` estaban
> `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, `DATABASE_URL_RENDER`, `INNGEST_SIGNING_KEY`,
> `PREVIEW_SECRET` y `STORYBLOK_WEBHOOK_SECRET`. Postgres sigue impidiendo que `amg_api` **asuma**
> `app_service` (ADR-17), pero **un proceso que tiene el DSN del orquestador no necesita asumir nada:
> se conecta como él**. La compartimentación que `env:sync` impone en local con un test no la imponía
> nadie en producción — y eso es exactamente lo que este comando existe para ver. El informe no lo
> llama "sobra una variable": lo llama *credencial de otro proceso*, con su dueño.
>
> **🟠 El renderizador no tiene ni un token de Storyblok** (`STORYBLOK_PUBLIC_TOKEN`,
> `STORYBLOK_PREVIEW_TOKEN`, `STORYBLOK_SPACE_ID`, `STORYBLOK_REGION`, `DEMO_DOMAIN`). Arranca igual
> —ninguna es obligatoria en su `leerConfig`— y no puede leer la Content Delivery API. Es la respuesta
> medida a *"quiero que funcione el Visual Editor"*: hoy no puede.
>
> **🟠 Tres valores del orquestador difieren de la fuente** (`PIPELINE_MODO`, `WEB_PUBLISH_MODE`,
> `STORYBLOK_DRY_RUN`): se editaron en el panel y no en `credenciales.env`. Es la deriva que el
> comando existe para detectar, en su forma más benigna.
>
> **Dos cosas que solo se supieron corriéndolo:**
>
> - **El servicio de la API se llama `amg-project`**, no `amg-api`. La primera versión asumió el
>   nombre y no encontró nada; por eso el error de descubrimiento ahora lista los servicios reales.
> - **El token es de PROYECTO**, y va en la cabecera `Project-Access-Token`. Con `Authorization:
>   Bearer` toda query responde **HTTP 200 con `errors: ["Not Authorized"]`** — un 200 que no es un
>   éxito, la misma forma de fallo que este bloque combate. Y es mejor que uno de cuenta: viene
>   acotado a un proyecto y un entorno, y él mismo dice cuáles.
>
> **El diseño que sobrevivió al contacto con la realidad:** la primera versión tenía **un** inventario
> y gritaba catorce veces por el orquestador, cuyas ausencias son todas correctas (sin `DATAFORSEO_*`
> el research es mock, sin `OPENAI_API_KEY` la prosa es mock, sin token de Storyblok se publica en
> dry-run). Un comparador que grita por un despliegue sano se ignora a la tercera corrida. Así que hay
> **dos niveles**: `OBLIGATORIAS` (medidas en el `faltan` de cada `leerConfig`; su ausencia es fallo) y
> `SEGUN_MODO` (su ausencia **no es un olvido, es una declaración**, y el informe dice qué declara).

**El problema.** `npm run probar-dsn` verifica el DSN de `docs/private/credenciales.env` — la fuente
de verdad — y **no** lo que tiene el proceso desplegado. El 2026-08-07 dio verde mientras Railway
tenía `@base:` de host. La herramienta no está mal; su nombre promete más de lo que mide.

Y el problema de fondo es mayor: **`env:sync` reparte a los `.env` locales y producción se sigue
editando a mano**, sin validación, sin aviso y con el fallo apareciendo minutos después en el arranque.
Tres servicios rotos en una hora salieron de ahí.

**Qué hacer.** Un comando que **compare** la fuente con lo que tiene cada servicio y diga qué falta,
qué sobra y qué difiere — sin imprimir valores, solo nombres y un hash corto. Requiere la API de
Railway (token de solo lectura).

### ⚠️ Va DESPUÉS de A4, y necesita su propio inventario

Lo señaló la 15ª review (H7) y al medirlo resultó más fuerte de lo que decía. Para comparar hace falta
saber **qué espera cada servicio**, y el candidato natural a ese contrato es el `MAPA` de
`scripts/env-sync.mts`. Dos problemas:

1. **El `MAPA` no tiene clave `orchestrator`.** No le faltan variables: falta el servicio entero
   ([`scripts/env-sync.mts:25`](../../scripts/env-sync.mts#L25) — están `api`, `db`, `kr-service`,
   `renderer` y `web-builder`). Sin A4, A3 no puede producir el conjunto esperado del orquestador, y un
   comparador que no sabe qué buscar informa "no falta nada" — el falso verde que existe para evitar.
2. **El `MAPA` no puede ser el inventario de producción tal cual, ni siquiera arreglado.** Omite
   `DATABASE_URL_RENDER`, `PREVIEW_SECRET` y `STORYBLOK_WEBHOOK_SECRET` **a propósito** —hay un test que
   impone *"el renderizador NUNCA recibe una credencial de base de datos"* en el reparto local— pero el
   renderizador **sí** las tiene en Railway. El `MAPA` es el contrato del `.env` **local**; el de
   producción es otro conjunto, más amplio.

Así que A3 lleva su **propio** inventario por servicio, derivado del `MAPA` pero explícitamente
distinto, y **un test que ata la diferencia**: cada clave que el inventario de producción agrega sobre
el `MAPA` tiene que estar justificada por nombre, o el test falla. Si no, la diferencia se convierte en
el sitio donde se esconden los olvidos.

- **Archivos:** `scripts/` (nuevo), su test, `docs/proyecto/12-credenciales.md`.
- **Verificación:** el test compara mapas de claves, no valores. Control positivo obligatorio: si la
  lectura del servicio devuelve vacío, tiene que **fallar**, no reportar "todo bien".
- **Coste:** pieza chica + una credencial nueva de Railway (de solo lectura).

### A4. Cerrar la deuda del `MAPA` y los `.env.example` — ✅ **hecho el 2026-08-08**

> **Hecho.** Al `MAPA` no le faltaban variables: **le faltaba el paquete entero**. Ahora tiene
> `orchestrator` con las cuatro que lee su `config.ts`, la `api` gana `INNGEST_EVENT_KEY`, y
> `orchestrator/.env.example` existe — ya no hay paquete sin plantilla. Dos invariantes nuevos, en el
> test y no en un comentario: **las dos claves de Inngest no se cruzan** (envío ↔ API, recepción ↔
> orquestador; cruzarlas no da error de arranque, falla mucho después) y **el orquestador no recibe la
> conexión de admin ni la de la API**.
>
> Y una cosa que el `.env.example` daba por hecha sin estarlo: `orchestrator/.env` se cargaba **de
> rebote**, porque `kr-service` y `web-builder` hacen `import "dotenv/config"` y este proceso los
> importa. Ahora lo carga `server.ts` explícitamente. Va en el **punto de entrada** y no en `config.ts`
> a propósito: ese módulo sí lo importan los tests, y un `orchestrator/.env` presente en la máquina de
> alguien le metería variables a `config.test.ts` —que comprueba justamente qué pasa cuando **faltan**—
> y el suite pasaría a depender de qué archivos tenga cada uno.
>
> **Lo desbloqueó** que el `permissions.deny` dejara de tapar los `.env.example` con un comodín. Ese
> cambio vino con el archivo en JSON inválido (comentarios `//` y una coma final) y con
> `docs/private/**` comentado: lo primero habría desactivado el archivo entero —incluidos los cuatro
> `Bash` denegados y los seis hooks— y lo segundo destapaba las credenciales. Reparado en el mismo
> commit; el porqué quedó en `$comment_env_example`.

**El problema.** Las tres variables de Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`PIPELINE_MODO`) no están en el `MAPA` de `scripts/env-sync.mts`, y **`orchestrator/` no tiene
`.env.example`** — es el único de los seis que no lo tiene. No fue un olvido: el `permissions.deny`
cubre `.env*` y bloqueó a los agentes y a la sesión principal, incluso para leer.

Van los dos juntos o ninguno: `scripts/env-sync.test.mts` ata el `MAPA` al `.env.example` **en las dos
direcciones**.

- **Bloqueado por:** que Juan abra el permiso de lectura de `**/.env.example`.
- **Archivos:** `scripts/env-sync.mts`, `orchestrator/.env.example`, `scripts/credencial.mts`
  (el `CATALOGO` ya las clasifica; el test que ata `MAPA` ⊆ `CATALOGO` se pondrá rojo al agregarlas si
  faltara alguna).
- **Coste:** pieza chica, una vez desbloqueada.

---

## Bloque B — deuda de producto ya decidida

Las dos decisiones están tomadas (Juan, 2026-08-07). No hay nada que consultar: hay que hacerlas.

### B1. El entregable sin páginas aprobadas — ✅ **hecho el 2026-08-07**

> **Hecho, con las dos mitades y verificado en el navegador.** La API responde **409** con
> `codigo: "SIN_PAGINAS_APROBADAS"` (`api/src/codigos.ts`, nuevo) y el portal apaga el link con un
> `<span>` —no un `<a>` con clase de apagado, que seguiría navegando—, reusando `puedeAprobar()`, la
> **misma** señal del botón de aprobar el run. El ciclo se manejó en vivo: link apagado → aprobar una
> página → se enciende sin recargar → editarla (revoca, ADR-06) → se apaga solo. **+5 tests de núcleo,
> +7 de Karma, +3 de API**, con 10 mutaciones.

**Hoy** sale una hoja con dos títulos de sección vacíos. El backend hace lo correcto —genera lo
aprobado, que es nada— y el riesgo es humano: mandar ese PDF sin mirarlo.

**Decidido: las dos cosas.** La API responde **409 con motivo** y el portal **deshabilita el link**.
La UI evita el clic inútil; el backend impone la regla para quien llame al endpoint directo.

- **Archivos:** `api/src/entregable.ts`, `api/src/app.ts`, `portal/` (el link y su tooltip), tests de
  los dos lados.
- **Contrato a fijar ANTES de partir el trabajo:** el cuerpo del 409 (código y mensaje) — lo consume
  el portal.
- **Verificación:** test de API que exige 409 sobre un run sin páginas aprobadas y 200 con una;
  test de componente que exige el botón deshabilitado. Navegador para el tooltip.

### B2. `renderReport` pasa de flags a audiencia — ✅ **hecho el 2026-08-07**

> **Hecho.** El plan decía "6 sitios de llamada (3 de producción, 3 de test)" y **las dos cifras
> estaban mal**: son **4 de producción** —el CLI de `kr-service` y el seed de `db` no figuraban— y ~24
> en tests. Contado al migrarlo.

**Hoy** el entregable imprime `_ES · es · 2026-08-07T18:35:27.490Z_` bajo la fecha legible: metadato
del pipeline delante de un dueño de restaurante. **Decidido: quitar la línea del entregable**, no
formatearla — formatearla dejaría bonito un dato que ahí no va, mientras que en el informe interno los
tres datos sí sirven (identifican mercado y momento cuando hay varios runs).

Y el parámetro deja de ser una bolsa de flags: con dos booleanos, de las cuatro combinaciones solo dos
significan algo. Pasa a **`audiencia: "agencia" | "restaurante"`**, que es como ADR-20 ya nombra la
división, **sin default** (conservando la propiedad que hizo bien `incluirCoste`).

- **Archivos:** `contrato/src/informe.ts` y sus tests; los **6 sitios de llamada** (3 de producción,
  3 de test). Barato ahora, caro cuando sean veinte.
- **Verificación:** que el entregable **no** contenga la línea de metadatos y el informe interno **sí**;
  mutación: invertir la audiencia tumba los dos.

---

## Bloque C — aprobar → publicar, ejercitado en producción

**Es el único tramo del circuito que sigue siendo una promesa.** El resto se probó el 2026-08-07; esto
no, porque **escribe en el espacio real de Storyblok del cliente**.

### C0. El botón no puede devolver 200 sobre un run que nadie va a publicar — ✅ **hecho el 2026-08-08**

> **Hecho, y con esto cae el único hallazgo que le dio a la 15ª review el veredicto NO LISTO.**
> Migración **`0019`**: `kr_runs.solicitud_emitida_at`, nullable, **sin relleno** —los runs que ya
> existen quedan nulos, que es la verdad sobre ellos—. `solicitarResearch` la escribe **después** del
> `send()` (fila → evento → marca), `approveRun` la exige lanzando `RunSinWorkflowError`, el endpoint
> responde **409 `RUN_SIN_WORKFLOW`**, y `tiene_workflow` viaja por los tres lectores para que el
> portal apague el botón por adelantado con un motivo accionable. **⚠️ La `0019` no está desplegada.**
> Lo de abajo queda como el razonamiento.

Lo encontró la 15ª review (H1) y es lo único que devolvió el veredicto NO LISTO. Verificado contra el
código, no solo contra la nota que ya lo describía:

- [`db/src/store.ts:914`](../../db/src/store.ts#L914) `approveRun` impone **dos** condiciones —al menos
  una página aprobada, y que el `update` toque fila— y **ninguna** sobre que exista una ejecución
  durable esperando el evento.
- [`portal/src/app/pages/brief/brief.ts:233`](../../portal/src/app/pages/brief/brief.ts#L233)
  `puedeAprobarRunUI` mira **rol y flag**. Ni el estado del run ni su origen entran en la decisión.

**Y desde el 2026-08-07 es alcanzable en producción**, que es lo que lo convirtió en bloqueante: el run
sembrado de la demo está en `pending_approval`, los dos flags están en `true`, y ese run se insertó
**directo en la base**. Aprobarlo devuelve 200, deja el run en `approved` para siempre y emite un
evento que nadie consume. Un botón que parece funcionar y no hace nada es peor que no tenerlo.

> ⚠️ **Acá decía además "no hay `waitForEvent` durmiendo sobre él", y el 2026-08-08 se comprobó que
> era falso**: había uno, desde las 20:35 de esa misma noche. Era una afirmación sobre el estado de
> Inngest hecha sin mirar Inngest — el argumento de fondo no se cae (la marca no estaba, y por eso el
> botón se apagó), pero la frase afirmaba de más. Ver **C-2**.

**Qué hacer.** Una **condición durable** en la base, no una heurística: una marca en `kr_runs` que la
API escribe **después** de que `send()` haya tenido éxito. El orden de ADR-18 se mantiene y se extiende:
**fila → evento → marca**. `approveRun` exige la marca; sin ella responde 409 con motivo, y el portal
deshabilita el botón con el mismo motivo en el tooltip.

Un run sembrado la deja nula por construcción — no hay que acordarse de nada en el seed, que es
justamente la propiedad que se busca.

**Lo que NO se hace, y por qué:** preguntarle a Inngest en el momento de aprobar. Metería un tercero en
el camino de la aprobación, y entonces una caída de Inngest impediría aprobar algo que ya está en
nuestra base. El dato tiene que ser nuestro.

- **Archivos:** migración `0018`, `db/src/store.ts`, `api/src/app.ts`, `portal/` (el botón y su
  tooltip), tests de los dos lados.
- **Contrato a fijar ANTES de partir el trabajo:** el nombre de la marca y el cuerpo del 409 — lo
  consume el portal. Es el mismo 409 que B1, así que **los dos códigos se deciden juntos**.
- **Verificación:** test que exige 409 sobre un run sembrado y 200 sobre uno nacido del pipeline;
  mutación: quitar la exigencia de la marca deja el primero rojo. Y el navegador para el tooltip.

### Y recién entonces, el bloque C propiamente dicho

**Antes de tocarlo hay que decidir en qué modo publica el orquestador, y no es una variable con un
valor "seguro": son dos variables y tres estados.** Lo de abajo está medido el 2026-08-08 en
`web-builder/src/publish/publisher.ts`.

| Estado | Cómo se llega | Qué hace | Qué reporta |
| --- | --- | --- | --- |
| **mock** | `WEB_PUBLISH_MODE` ausente o ≠ `storyblok` (**el default**) | Escribe story + preview en `out/` | ⚠️ **`published: true`** |
| **dry-run** | `storyblok` **y** (`STORYBLOK_DRY_RUN=1` **o** sin token **o** el cliente sin space) | Escribe en `out/storyblok/` el payload **exacto** que enviaría | `published: false` |
| **live** | `storyblok`, con token y con space | Publica de verdad | `published: true` |

**El default NO sirve para el bloque C**, y es lo contrario de lo que decía este plan: en `mock` no se
toca Storyblok (bien) pero el publisher dice `published: true`, así que **la base anotaría como
publicadas páginas que nunca salieron del contenedor** — en un `out/` que además se evapora en el
próximo deploy. Peor que no probar.

Lo que ejercita el bloque C sin consecuencias es **`WEB_PUBLISH_MODE=storyblok` + `STORYBLOK_DRY_RUN=1`**:
construye el payload real, exige que el cliente tenga su space, y reporta `published: false` —con un
comentario en el código que dice justamente por qué no puede decir `true`—. Los dos juntos, no uno:
con `storyblok` a secas, si el token está puesto, publica de verdad.

### C-0. `/_health` tiene que decir en qué modo publica — ✅ **hecho el 2026-08-08**

> **Hecho.** `/_health` responde ahora `publicacion: "mock" | "dry-run" | "live"`, y sale de
> `modoPublicacion()` (`web-builder/src/publish/publisher.ts`) — **la misma `decisionDelServicio()`
> que construye el publisher**, no una relectura de `process.env`. Tres tests, uno por estado, cada
> uno en su archivo porque `config` se congela al importarse y `node --test` da un proceso por
> archivo. La mutación pedida cae: reimplementar `modoPublicacion()` leyendo el entorno deja rojo
> `modo-publicacion-degradado.test.ts` **y ningún otro** — que es exactamente la divergencia.
>
> Dos cosas que aparecieron al medirlo, y que el plan no preveía:
>
> - **El modo es del PROCESO, no de la corrida.** Un cliente sin `storyblok_space_id` publica en
>   dry-run aunque el servicio esté en `live`. `/_health` reporta el **techo** —"¿este proceso está
>   armado para escribir de verdad?"—, que es la pregunta que hay que contestar antes de lanzar nada;
>   lo otro es un hecho de esa publicación y lo reporta `published: false`. Un test lo fija en vez de
>   dejarlo en un comentario.
> - **Un typo en `WEB_PUBLISH_MODE` es mock en silencio**, con token y space puestos. Es el mismo
>   camino que la ausencia (`!== "storyblok"`) pero es el que nadie sospecha, así que el test del
>   estado mock usa el typo y no la ausencia.

Detectado el 2026-08-08, al redesplegar el orquestador con `WEB_PUBLISH_MODE=storyblok` y
`STORYBLOK_DRY_RUN=1`: **no hay forma de confirmar desde afuera que tomaron.** `/_health` responde
`{"ok":true,"funciones":2,"modo":"cloud","pipeline":"mock"}` — reporta `pipeline` (de `PIPELINE_MODO`)
y **nada** del publisher.

Es el mismo argumento que ya está escrito en `orchestrator/src/app.ts` para `pipeline` —*"que se pueda
leer desde afuera es la mitad de su valor: una declaración que solo vive en el panel de variables no se
puede auditar mirando el servicio"*— sin aplicar justo al caso del que depende todo este bloque. Y con
un agravante: el modo de publicación **no sale de una variable sino de tres** (`WEB_PUBLISH_MODE`,
`STORYBLOK_DRY_RUN`, el token), así que leer el panel tampoco alcanza para saber en qué estado quedó.

**Qué hacer.** Agregar `publicacion: "mock" | "dry-run" | "live"` al cuerpo, **derivado de la misma
lógica que decide el publisher**, no de una relectura del entorno. Si se calculara aparte, `/_health`
podría decir `dry-run` mientras `getPublisher` devuelve otra cosa — que es exactamente el fallo que la
clave de firma de Inngest ya causó una vez (lo validado y lo usado eran dos lecturas distintas).

- **Verificación:** un test por estado, y la **mutación que importa**: que `/_health` derive el valor de
  `process.env` en vez de la decisión real deja pasar la incoherencia y tiene que caer.
- **Sin esto, el paso 1 de abajo no se puede hacer**: "comprobar el modo" no tiene con qué.

### C-0b. Y el tercer modo: con qué se genera la PROSA — ✅ **hecho el 2026-08-08**

Apareció al ir a hacer el paso 2, comprobando qué gasta de verdad antes de aprobar el run. **El paso
de publicación llama a `applyProse`**, y quién lo atiende sale de `getProseGen()`:

```ts
config.prose.mode === "openai" && config.openai.hasKey ? new OpenAIProseGen() : new MockProseGen()
```

con `config.prose.mode = PROSE_MODE || (hay key ? "openai" : "mock")`. O sea: **con
`OPENAI_API_KEY` puesta y `PROSE_MODE` sin declarar, publicar factura**, y nadie tuvo que decidirlo.

Y `PIPELINE_MODO` **no lo gobierna** — lo dice su propio `config.ts`: *"no enciende ni apaga nada"*,
solo declara y comprueba coherencia con `DATAFORSEO_MODE`. Así que `pipeline: "mock"` en `/_health`
significa "DataForSEO no cobra" (el 81% del costo) y **no** significa "esta publicación es gratis",
que es exactamente lo que uno entiende al leerlo.

Es el mismo agujero que C-0 acaba de cerrar, en el eje que mueve dinero. Mismo arreglo: `/_health`
gana `prosa: "mock" | "openai"`, derivado de `modoProsa()` — y acá la divergencia es
**estructuralmente imposible**, porque `getProseGen()` llama a esa misma función en vez de repetir la
condición. Dos tests, y los dos muerden en direcciones opuestas: `openai` declarado sin key (el
entorno dice `openai`, la verdad es `mock`) y key sin `PROSE_MODE` (el entorno no dice nada, la
verdad es `openai` — **el default que factura**).

**El orden:**

1. Comprobar el modo **con `/_health`** (pasos C-0 y C-0b): `publicacion` **y** `prosa`. Si
   `publicacion` no es `dry-run`, o si `prosa` es `openai` y no se quiere gastar, decidir
   explícitamente antes de seguir.
2. Lanzar un research en mock, aprobar **una** página, aprobar el run. ✅ **hecho el 2026-08-08** —
   ver abajo.
3. Comprobar que el workflow **despierta** (Inngest → Runs) y que el publisher reporta lo que debe.
   ✅ **hecho el 2026-08-08**: Juan lo confirmó en Inngest — el run de las 11:12 figura
   **completado**. Ver abajo lo que eso cierra, y la anomalía que destapó de paso.
4. Recién entonces, si se quiere, repetir con publicación real y verificar la web servida.

**Lo que este paso puede destapar, y por eso se hace aparte:** el brief que el orquestador reconstruye
desde la base pasa por `parseBrief` antes de publicar. Ese camino se arregló el 2026-08-07 (migración
`0017` + re-seed) pero **nunca se ejecutó de verdad** — se verificó que el dato ahora es válido, no que
la publicación funcione con él.

### Lo que pasó al hacerlo (2026-08-08)

Run `14bda962-4eae-44c7-a49e-f79c20d0cad1`, lanzado desde el portal contra La Birra Bar. `$0.00`,
`running` → `pending_approval` en menos de un minuto, 25 páginas respaldadas por datos y 0 sin
validar. Aprobada una página, aprobado el run: **`approved`, cero errores en consola.**

Dos controles positivos de paso, sobre datos nuevos y no sobre el seed:

- **C0 al revés.** En este run —que sí lo lanzó el pipeline— el botón salió deshabilitado con el
  motivo de las **páginas**, no con el del workflow. En el sembrado sale el del workflow. El colapso
  a un solo motivo elige bien en los dos casos, que es lo único que un test de una sola dirección no
  podía probar.
- **B1 y B2.** El link del entregable se encendió en cuanto hubo una página aprobada. Y el entregable
  sale **sin bloque de coste y sin la línea de metadatos**, con solo la página aprobada, mientras el
  informe lleva las dos cosas y las 25.

### C-1. El dry-run no deja rastro, y por eso el paso 3 no se puede cerrar

**Aprobar el run se ve exactamente igual si el workflow despertó y publicó en dry-run que si no
despertó nunca.** El run queda en `approved` en los dos casos:

- en `live`, `publicadas.length > 0` → `marcarPublicadas` → las páginas quedan con `published_at`, y
  eso sí se ve;
- en `dry-run` el publisher reporta `published: false` —correctamente: *"la base no puede afirmar
  algo que el proveedor no confirma"*— así que **no se escribe nada**, y el único rastro es un
  `log()` dentro del contenedor.

Lo que sí queda descartado es `failed`: si el workflow hubiera despertado y el paso de publicación
hubiera lanzado —`parseBrief` sobre el brief reconstruido, que es justo el camino que este bloque
venía a estrenar—, `onFailure` habría dejado el run en `failed`. O sea: **o funcionó, o no corrió.**

La consecuencia incómoda es que **el modo que existe para ensayar es el único en el que el ensayo no
se puede observar**, y que la verificación depende de mirar el panel de un tercero. Lo que
corresponde es que el intento de publicación deje una marca nuestra —cuándo se intentó, cuántas
páginas se mandaron y cuántas confirmó el proveedor— **sin afirmar que se publicó**, que es la
distinción que el código ya defiende bien. Diseño pendiente; no se improvisa acá.

Mientras tanto el paso 3 lo cierra Juan mirando **Inngest → Runs** (o el token de solo lectura de
Railway del bloque **A3**, que serviría para lo mismo por los logs).

**Y lo cerró: el run figura `Completed`.** «Completado» no es "despertó": es que **terminó**, o sea que
pasó el `esperar-aprobacion` **y** el step `publicar` corrió hasta el final sin lanzar. Con eso caen
las tres promesas que quedaban del bloque:

- la compuerta durable funciona en producción — nunca se había ejercitado;
- **`parseBrief` sobre el brief reconstruido desde la base funciona**, que es exactamente lo que este
  bloque marcaba como *"se verificó que el dato ahora es válido, no que la publicación funcione con
  él"*;
- el publisher de dry-run construye y escribe el payload dentro del contenedor sin reventar.

### 🟠 C-2. La marca de C0 y el workflow de verdad pueden discrepar — y ya discrepaban

Al mirar el panel apareció otro run, del **2026-08-07 a las 20:35, todavía `Running`**, y Juan
confirmó que **estaba parado en `esperar-aprobacion`** (lo canceló; run de Inngest
`01KZER4898BS0H4SA7WS9H91YP`).

**Mi primera lectura fue que era un workflow sin fila en la base, y era falsa.** El razonamiento
—"si duerme en la compuerta tiene que haber una fila en `pending_approval` de esa hora, y no la
hay"— daba por hecho que un workflow solo llega a la compuerta *después* de hacer el research. No es
así: si arranca con el run **fuera de `running`**, se salta el research
([`workflow.ts:270`](../../orchestrator/src/workflow.ts#L270)) y va **directo a dormir 7 días**. O
sea que el candidato natural es el run **sembrado**, que está en `pending_approval` desde las 18:18.
`inferencia`, no verificado: falta el `runId` del payload para confirmarlo.

Lo que no es inferencia es la consecuencia, porque el propio portal la enseña: **ese run muestra
`tiene_workflow: false`** y el botón deshabilitado diciendo *"este research no lo lanzó el
pipeline… aprobarlo no publicaría nada"* — mientras había un `waitForEvent` esperándolo.

**Por qué pasa.** `solicitud_emitida_at` la escribe **solo** `solicitarResearch`, en la API. Un
workflow arrancado por cualquier otro camino —un *Send event* a mano desde el panel de Inngest, un
replay, un `curl` con la event key: justo lo que uno hace para comprobar un orquestador recién
desplegado— deja el run **con** workflow y **sin** marca.

**Qué NO se cambia.** Preguntarle a Inngest al aprobar sigue descartado por lo que ya dice C0: metería
un tercero en el camino de la aprobación. Y el error cae del lado seguro —**bloquea** una aprobación
que habría funcionado, en vez de aceptar una que no hace nada—, que es exactamente la asimetría que
C0 eligió. La decisión se mantiene.

**Qué sí sale de acá:**

1. **Una regla operativa:** si emitís `research/solicitado` a mano, el run no se va a poder aprobar
   desde el portal. El camino soportado es el portal → API, y todo lo demás es depuración.
2. **Una frase demasiado fuerte** — ✅ **suavizada el 2026-08-08.** El tooltip afirmaba *"no hay nada
   esperando su aprobación"*, que es una afirmación sobre Inngest que no podemos comprobar; ahora dice
   *"aprobarlo **probablemente** no publique nada"*. Lo que sabemos es lo nuestro —`solicitud_emitida_at`
   vacía, o sea que la API no lo lanzó— y la redacción ya no finge más. **Un test impide que la
   afirmación fuerte vuelva**, con las cuatro formas de escribirla y un control positivo que exige el
   matiz: sin él, una frase que no mencione la publicación pasaría sin decir nada.
3. **Y el barrido no cancela el workflow.** `barrerRunsColgados` marca la fila `running → failed` y
   nada más ([`functions.ts:131`](../../orchestrator/src/functions.ts#L131)): un workflow puede
   seguir vivo sobre un run que la base ya dio por muerto, y las dos verdades conviven sin que nada
   avise. No es un bug del barrido —cancelar en Inngest es otra cosa, y meterla a las apuradas es
   peor— pero es una asimetría que hay que decidir a propósito.

---

## Bloque D — calibrar el research (KR-1)

**Depende de Juan porque gasta dinero.** ~**$0.31** y ~16 minutos contra DataForSEO en producción, y
**hay que volver a sandbox después** (`kr-service/.env`).

**Qué desbloquea, en concreto:**

- Los **tres `n/d`** del informe (el desglose de coste y las dos coberturas) dejan de ser huecos.
- **`VOLUMEN_PERCENTIL_TOPE = 0.9`** y **`PESO_CONFIANZA_ORDEN = 0.5`**: hoy son juicio, no medición.
  Barrerlos es **gratis en cuanto exista el dataset**, igual que se barrió
  `CLUSTER_SIM_THRESHOLD_DEFAULT = 0.75`.
- **`TIPOS_MAP_PACK`** (`local_pack`, `map`) sin verificar contra la API real (~$0.003). Si estuviera
  mal, `is_local` saldría `false` para todo: falla hacia el lado conservador, pero entonces KR-3 no
  estaría arreglando nada.
- **Las estimaciones por fase de `lib/budget.ts`.** Las tarifas de los modelos están verificadas; las
  estimaciones **siguen a ojo**, y el `09` dice que se calibran con este mismo dataset
  ([`09:920`](09-estado-y-roadmap.md#L920)). Estaban fuera de este bloque y no debían estarlo (15ª
  review, H6).
- **Las páginas cuya cabeza nadie observó.** `max_pages` vale 25 y `serpValidateTop` 15
  ([`09:924`](09-estado-y-roadmap.md#L924)): como el mapeo reordena por evidencia, un cluster de la
  posición ≥16 con datos de mercado puede subir a página **con la cabeza sin observar**, y recibir su
  `schema_type` por conjetura del LLM. Con 8 páginas no muerde; con más clusters compitiendo, sí. El
  dataset es lo que permite medir cuántas páginas caen ahí — hoy es una hipótesis sin número.

El dataset ya no se pierde: desde el 2026-08-02 va a `datasets/`, con un test que se lo pregunta a
`git check-ignore`.

**Ojo con lo que este bloque puede declarar de más.** Con el dataset se calibra la señal local de las
cabezas observadas; **no** se cierra el hueco de las ≥16. Si D se da por cerrado sin decirlo, el `09`
pasa a afirmar "señal local calibrada" mientras la mayoría de las keywords sigue decidiéndose por LLM.

---

## Bloque E — el aspecto de las webs

**Es lo más grande que queda del alcance base, y es lo que se ve.** Lo hecho es la **infraestructura
de marca** (tema por tenant, imágenes editables, navegación, footer, `/menu`, `/blog`, home
sintetizada), no el aspecto: las landings publicadas se ven **sin terminar** — ni una foto, un CTA que
es un párrafo, siete secciones idénticas.

Hay tres piezas, con spec escrita y **sin empezar**:

1. **Plantillas de landing** — [spec](../superpowers/specs/2026-08-01-plantillas-landings-design.md),
   tres entregas. **Entregas 1 ✅ y 2 ✅ el 2026-08-08** (contrato y recorrido de datos; ensamblado con
   paridad); queda la **3** (piezas nuevas y arreglos visuales), partida en una mitad que **no**
   necesita fotos y otra que sí.
2. **Manual de marca** — tokens de color y roles tipográficos self-hosted, en vez de los tres campos
   actuales de `business_profile.brand`. **El modelo de datos ✅ entró con la entrega 1**; falta
   emitir los tokens (entrega 2) y usarlos, con las tipografías self-hosted (entrega 3).
3. **Rediseño de la carta** — categorías con foto, precios por ración. **Los campos ✅ entraron con la
   entrega 1**; falta la pieza `cartaCategorias` (entrega 3).

### 🟡 Entrega 3 — piezas nuevas y arreglos visuales (mitad A ✅, mitad B pendiente)

**Es la entrega donde el sitio cambia de aspecto**, y por eso va después de que la 2 haya demostrado
paridad: si el rediseño y el refactor entran juntos, un cambio inesperado no se puede atribuir a
ninguno de los dos.

Se parte sola en dos mitades por una razón que no es de diseño sino de disponibilidad del dato:

| Mitad | Qué | ¿Necesita fotos? |
| --- | --- | --- |
| **A** ✅ | Los **cinco arreglos visuales** (modo oscuro completo, doble borde de la carta, enlaces del pie, contraste del acento en oscuro, CTA largo) y el **uso real de los 9 tokens de marca** en el CSS de las piezas | **No** |
| **B** | `heroPortada`, `barraDatos`, `platosDestacados`, `galeria`, `ctaFinal`, `cartaCategorias`, la allowlist de hosts de imagen con su `referrerpolicy` y el presupuesto de 60 `<img>` | **Sí** |
| **C** 🟡 | Las **tipografías self-hosted**. **Servidas ✅**; falta **enchufarlas** al CSS emitido y el test de *cero terceros* | No, pero traen una **ruta pública nueva** al proceso anónimo |

La mitad **A** es la que hace que dos restaurantes dejen de distinguirse solo por un color de acento,
y hoy se puede verificar entera en un navegador. La **B** no: su gate pide *"el sitio manejado en un
navegador … con fotos y sin fotos"*, y **las fichas de producción no tienen ni una**.

**Precondición, y no es código.** Los assets van a `docs/plantillas/template1/` (ver su
[README](../plantillas/template1/README.md), con las medidas de cada campo y por qué). Los binarios
**no se versionan**: el repo es público y el destino real es Storyblok, porque la allowlist del
renderizador solo acepta `a.storyblok.com`. Las URLs de foto del seed apuntan hoy a assets que **no
existen**, así que hasta subirlos la web de demo saldría con imágenes rotas en cuanto el render las
dibuje. La paleta y los roles tipográficos ya están decididos en
[`marca.json`](../plantillas/template1/marca.json).


#### ✅ Mitad A — hecha el 2026-08-08

**La decisión que ordena el resto: dos capas de tokens.** Los `--marca-*` dicen lo que dice la ficha
del cliente; una capa semántica en medio (`--fg`, `--titulo`, `--accent`, `--acento-legible`,
`--sobre-acento`…) es la que consumen las piezas, y la única que reescribe el modo oscuro. Sin esa
capa, corregir el contraste del acento en oscuro habría exigido **reescribir el token del cliente**,
o sea mentir sobre lo que dice su ficha.

**`colores.primario` ya gana sobre el legacy `color`**, y lo que lo consigue es que `tokensDeMarca()`
dejó de emitir `--accent`/`--font`: emitirlos era exactamente lo que lo impedía, porque iban después
de la capa semántica y la pisaban por cascada.

**`--marca-secundario` queda emitido y SIN consumidor**, a propósito. Estuvo alimentando `--muted`
—el color del lede, las direcciones, los horarios, el nav y la línea técnica— hasta que se midió: el
`secundario` de la paleta ya decidida (`docs/plantillas/template1/marca.json`, `#c8963e`) sobre su
fondo da **2.62:1** y falla AA. «Secundario» en un manual de marca es el segundo color **de marca**,
decorativo; no el gris del texto secundario. Espera consumidor en la mitad B, donde hay superficie
decorativa de verdad.

**Lo que encontró la revisión**, y es todo del mismo tipo — una decisión deliberada que solo vivía en
un comentario: el umbral de 28 caracteres del CTA no lo fijaba ningún test (cualquier valor entre 15
y 39 pasaba, y el JSDoc afirmaba que «tiene que doler en un test»); la decisión de `--muted` tampoco,
porque el test usaba una ficha sin marca y el default coincidía con el neutro, así que resolvía igual
por los dos caminos; y el `@supports` del `color-mix` se podía quitar sin que cayera nada. Los tres,
ahora con test de borde y mutación comprobada.


#### ✅ Mitad C — las tipografías: servidas y enchufadas (2026-08-08)

**Lo que está hecho.** Cuatro familias **SIL OFL 1.1** —Oswald (`condensada`), Jost (`geometrica`),
Source Sans 3 (`humanista`), Dancing Script (`script`)—, verificadas **una por una** contra el
repositorio de Google Fonts y con su licencia commiteada al lado: *una fuente sin su licencia en el
repo no se sirve*, como manda la spec. Subsets latinos en `woff2`, **148 KB los siete archivos**.

**Los tres roles legacy (`sistema`, `serif`, `moderna`) NO se self-hostean.** Son los tres valores del
campo viejo `brand.font` y todas las fichas sembradas usan uno: darles familia propia les cambiaría el
aspecto de golpe. Un test lo impide.

**La ruta `/_assets/fonts/`** sirve desde un `Map` en memoria cargado al arrancar, y **falla cerrado**
—si falta un archivo el renderizador no arranca, en vez de dar 404 en la web de un cliente—. Los
hashes van escritos en el código para poder emitir el CSS sin tocar el disco, y un test recalcula el
SHA-256 de cada archivo: sin él, editar un `.woff2` sin cambiar su hash lo dejaría servido desde la
cache `immutable` para siempre.

**Una afirmación corregida, y vale como aviso.** El comentario del test de path traversal decía que
era fuerte «porque hay un `Map` y no un path». Mutando el handler para que volviera a leer del
filesystem, **el test siguió pasando**: quien para esas URLs primero es el **router**, porque
`:nombre` no captura `/`. Cierto como diseño, falso como descripción de lo que el test demostraba. Hay
dos capas y ahora cada una tiene su test. ⚠️ **Si algún día se cambia el patrón a `/_assets/fonts/*`
—que sí captura `/`— la primera capa desaparece sin ruido.**

**El cable, puesto.** `--marca-fuente-*` resuelve a `stackDe(rol)`, el `<style>` incluye
`cssDeFuentes(rolesUsados)` —las `@font-face` **solo de las familias que la página usa**, igual que el
CSS de las piezas— y el `<head>` un `preload` de **una sola** familia: la de titulares. *(La firma de
`ensamblarCss` no hizo falta cambiarla: de `brand` ya salían los roles. Este documento decía que sí.)*
Y llegó el test que la enmienda pedía: **cero terceros en la ruta de render bloqueante** — todo
`url()` del `<style>` empieza por `/_assets/fonts/`, ningún `rel="stylesheet"`, ningún `@import`,
ningún host de Google. La garantía de ADR-19 convertida en test en vez de en costumbre.

**El `crossorigin` del preload no es cosmético.** Las fuentes se piden siempre en modo CORS anónimo,
también desde el mismo origen; sin él, el preload no casa con la petición de la `@font-face` y el
navegador **descarga el archivo dos veces**. No da error en ningún log. Tiene test propio, y en el
navegador se confirmó que `oswald-700` se pide una sola vez.

**El peso precargado (700) se midió.** Ninguna pieza declara `font-weight` en los titulares, así que
heredan el `bold` de la hoja del navegador — que lo corroboró: `Oswald 500 unloaded, Oswald 700
loaded`. Un test sobre el CSS emitido lo fija: si una pieza le pone `font-weight` a un titular, cae.

##### Lo que solo apareció mutando

Cuatro garantías que estaban escritas y que no sostenía nada:

1. **Dos tablas de stacks que decían cosas distintas.** `fuentes.ts` y una tabla privada de `css.ts`
   discrepaban en `moderna` (`Inter,…` contra `'Helvetica Neue',Arial,sans-serif`). La que llegaba al
   `<style>` era la de `css.ts`, así que unificar hacia la otra habría cambiado la tipografía de toda
   ficha sembrada con `font: moderna` — **la regresión que esta sección prohíbe tres párrafos más
   arriba**. El test que decía cubrirlo comprobaba *existencia*, nunca valores. Ahora compara el
   literal exacto de producción, **escrito a mano en el test**: leerlo de la constante sería comprobar
   que es igual a sí misma, que es justo por lo que la divergencia sobrevivió.
2. **El agujero de prototipos, reabierto.** `css.ts` lo tenía cerrado con `Object.hasOwn` y
   documentado; `fuentes.ts` se escribió después con indexación directa, y `stackDe("toString")`
   devolvía `Object.prototype.toString` → `'undefined',undefined` como familia. En producción el
   perfil llega de Storyblok **sin pasar por Zod**. Cerrado en los cuatro puntos que indexan.
3. **Las dos allowlists, separadas solo por un comentario.** Que el campo legacy `brand.font` aceptara
   los cuatro nombres nuevos dejaba los 299 tests en verde.
4. **«Cero terceros» no cae si desaparecen las fuentes**: pasa recorriendo cero `url()`. Va con un
   test de **no-vacuidad** que exige al menos 3 `url()` en el `<style>` de la ficha con manual.

⚠️ **Una fixture del gate de paridad, retocada a mano (+1 línea).** El `preload` es un `<link href=…>`
y `hrefsDe()` captura todo `href`, así que esa cara de la huella cambió en el único caso del gate cuya
ficha pide familia propia. Se añadió esa línea y **no se re-capturó** — re-capturar habría sobrescrito
las diez con la foto de "después" y el gate pasaría a compararse contra sí mismo. Se descartó excluir
`rel="preload"` de `hrefsDe`: habría debilitado el comparador para los diez casos y para siempre.
Dos mutaciones confirman que la fixture sigue cayendo, tanto si el preload cambia como si desaparece.

**Lo que la entrega 2 dejó preparado y esta consume:** los 9 tokens `--marca-*` ya se emiten en el
`<style>` con los valores actuales como default, sin que nadie los use. Esta entrega es la que los
enchufa — y ahí `colores.primario` pasa a ganar sobre el legacy `color`, que es el momento en que una
ficha con manual de marca deja de verse igual que antes.

**Dos avisos para quien la implemente**, de la ronda anterior:

- **El gate de paridad NO mira el `<style>`.** Fue el punto ciego de la entrega 2 y ahí se coló una
  regresión de cascada. Esta entrega cambia CSS a propósito, así que la paridad deja de aplicar como
  criterio: lo que la sustituye es **el navegador**, en claro y oscuro, escritorio y móvil, con ficha
  legacy y con manual completo.
- **Las tipografías traen una ruta pública nueva** (`/_assets/fonts/…`) en el **único proceso expuesto
  a internet anónimo**. La spec lo resuelve sirviendo desde un **mapa fijo compilado**, no desde el
  filesystem: así no hay path traversal que buscar porque no hay path. Un test pide
  `/_assets/fonts/../../etc/passwd` y espera 404.

---

### ✅ Entrega 2 — ensamblado y piezas existentes, con paridad (2026-08-08)

`web-builder/src/render/html.ts` pasa de **751 líneas a 177**. Las cuatro funciones que repetían cada
una su propio `<!doctype>`, `<head>`, `<style>` y pie —la razón por la que el bug de modo oscuro
sobrevivió: había que arreglarlo cuatro veces— son ahora **cuatro recetas del mismo ensamblador**.

| Pieza | Qué |
| --- | --- |
| `render/shell.ts` | El documento: head, cabecera, `<main>`, pie. **Fijo, fuera de la receta** — el tipo `Plantilla` solo ordena contenido, así que ninguna receta puede omitir la cabecera ni mover el pie |
| `render/piezas/` | **9 piezas**, una por archivo, cada una con su CSS bajo una clase raíz `p-<id>` |
| `render/css.ts` | Tokens + base + el CSS de **las piezas que dibujaron algo**, en orden de catálogo |
| `render/plantilla.ts` | `brand.plantilla` elige un **juego de cuatro recetas**, una por tipo de documento |
| `render/aislamiento.ts` | El detector que impone §3 **mecánicamente**, no por revisión humana |

**El gate fue paridad de contenido contra 10 fixtures capturadas ANTES del refactor** y commiteadas
en un commit propio (`4c75e47`), para que el historial pruebe que la referencia es anterior al cambio.
Compara texto visible, `href`, `id` de ancla, JSON-LD byte a byte y la traza de research. Reorganizar
clases, envoltorios e indentación queda permitido: es el trabajo.

**Las dos ambigüedades de la spec, cerradas al implementar** (§4 define *una* receta mientras
§Arquitectura de render habla de cuatro):

- **`brand.plantilla` elige un JUEGO de cuatro recetas**, una por tipo de documento, y `base` es el
  único juego que existe. Con la otra lectura, `cartaCategorias` no tendría dónde vivir en la 3.
- **`hero` está en las cuatro recetas**, no solo en la de landing. Las tres páginas sintetizadas
  emiten hoy su propio `<header class="hero">`, y ni `indice` ni `carta` ni `blogIndice` son "las
  tarjetas"/"la carta" *más un titular*. La alternativa —que cada pieza de contenido emitiera su
  titular— triplicaba el CSS y obligaba a que `carta` nunca devolviera `""`, con lo que la pieza
  perdía su contrato.

**El modo oscuro se repartió CON SUS HUECOS, no se completó.** Hoy es una sola regla que nombra
`.sitebar`, `.hero`, `footer`, `section` y `.card` a la vez, y por eso `.carta li` y `details` quedaron
fuera sin que nadie lo notara. Completarlo es un arreglo visual y pertenece a la entrega 3: hacerlo
aquí habría cambiado cómo se ve el sitio, que es justo lo prohibido.

**Lo que encontró la revisión y ningún test veía:** el gate **no mira el `<style>`**, así que el
reparto del CSS era el punto ciego del cambio. Un comparador de cascada sobre las 10 fixtures encontró
que los dos `<h2>` del pie perdían `letter-spacing:-.01em` — venía de `section h2`, que empataba en
especificidad con `footer h2` y ganaba esa propiedad porque era el único que la declaraba. El método
del implementador (buscar dueño por declaración) **no podía verlo**: la declaración tenía dueño y aun
así dejaba de llegar a dos elementos.

**Un bug de seguridad arreglado de paso:** `themeCss` hacía `brand.font in FONT_STACKS`, y `in`
recorre la cadena de prototipos — `brand.font = "toString"` metía `function toString() { [native
code] }` dentro del `<style>`. Reproducido y cerrado con `Object.hasOwn`. En producción el perfil
llega de Storyblok sin pasar por Zod, así que era alcanzable.

---

### ✅ Entrega 1 — contrato y recorrido de datos (2026-08-08)

**Un campo del perfil no llega al HTML si no cruza cuatro fronteras.** Esta entrega amplió las
**tres primeras** y dejó la cuarta —el render— intacta a propósito: así una pérdida de datos no se
puede confundir con una regresión de refactor ni con un defecto visual.

| Frontera | Dónde | Qué se amplió |
| --- | --- | --- |
| 1. Zod, la puerta | `web-builder/src/contract.ts` | `fotoSchema`, `menuCategoriaSchema`, `brand.colores`/`fuentes`/`plantilla`, `menu[].precios`/`nota`/`foto` |
| 2. La allowlist de Postgres | `db/migrations/0014_fotos_publicas.sql` | `app.foto_publica` y `app.numero_publico` (nuevas), la columna generada re-materializada y **el `grant` recuperado** |
| 3. `perfilValido` | `renderer/src/perfil.ts` | `foto()`, `precios()`, `categorias()`, `galeria()` y `objetoDe()` para los sub-objetos de marca |
| 4. El render | — | **Sin tocar en la entrega 1**; reorganizado en la 2, dibuja los campos nuevos en la 3 |

✅ **La `0014` está aplicada en producción** (2026-08-08 por la noche). Dos cosas que solo se saben
corriéndola: aplicó **en la posición que el test de orden predecía** —el runner la insertó entre la
`0012` y la `0015`, no al final, porque `migrarConRegistro` recorre el directorio ordenado y saltea
las registradas—, y **el `grant` sobrevivió al `drop column`**, que era el riesgo que esta spec eleva
a crítico. Verificado donde importa y no en PGlite: la web de La Birra Bar sigue sirviendo su NAP, y
ese dato solo puede salir de `business_profile_publico`.

> **Lo que la `0014` NO trae por sí sola:** las fichas de producción siguen sin los campos nuevos. La
> columna se recalculó, pero `business_profile` no tiene fotos ni manual de marca hasta que la agencia
> los cargue o se re-siembre la demo. Para la entrega 3 —la que los dibuja— eso pasa a ser un paso
> previo, no un detalle.

**Los topes, en las tres capas:** 30 fotos, 3 precios, 20 categorías (más los 20 locales y 200 platos
que ya estaban). Con una asimetría deliberada: **Zod rechaza el archivo y las otras dos cortan**,
porque el Zod valida un JSON escrito a mano donde fallar fuerte avisa a quien lo escribió, mientras
las otras reciben datos ya guardados donde tirar la página entera sería peor que recortar.

**Lo que la `0014` NO valida, y es a propósito:** ni hex, ni https, ni hosts. La allowlist SQL
restringe **nombres de clave** y **forma de valor**; el contenido lo validan las fronteras 1, 3 y 4.
Un test lo fija con un caso hostil —un color con `</style>` **cruza** Postgres— para que nadie quite
la validación de las otras capas creyendo que la base ya cubre.

**El riesgo de orden de la `0014`, cerrado con un test.** La `0014` estaba reservada desde el
2026-08-05, así que corre **antes** de la `0015`-`0019` en una base nueva (orden alfabético) y
**después** en producción (`migrarConRegistro` saltea las registradas). Las cinco posteriores lo
declaraban en un comentario; ahora un test aplica las migraciones sobre **dos PGlite en los dos
órdenes** y compara las funciones, el grant, las columnas generadas y la proyección de la allowlist.

**El test que ata las tres capas entre sí** (`renderer/src/tres-fronteras.test.ts`): cada frontera
tiene sus tests, pero lo que rompe el recorrido no es que una falle, sino que **las tres listas no
digan lo mismo** — y un campo enumerado en dos de tres desaparece sin error y sin log. Recorre el
camino real (JSON → Zod → `business_profile` → la columna generada → `perfilValido`) y exige que el
perfil salga **entero**, con `deepEqual` y no campo por campo, porque enumerar deja fuera justo el que
alguien olvide. Mutación: quitar `menu_categorias` **solo** de `perfilValido` lo tumba con nombre.

**Verificación por mutación**, siete en total y todas con `grep` de control: `portada` en Zod (caen 3
tests de frontera 1), `colores.primario` y `precios` en `perfilValido` (2 y 1), `menu_categorias` en
el test encadenado (1), y en la `0014` `portada`, `colores.primario` y `precios` (1 cada una). Dos
extra que no estaban pedidas: quitar el `grant` tumba **23** tests —literalmente "caen las webs de
todos los clientes a la vez"— y cambiar `set` por `set local` deja el `lock_timeout` en cero con todo
lo demás en verde.

**Dos cosas que aparecieron al hacerlo:**

- **El seed de demo necesita el legacy `{color, font}` junto al manual nuevo.** Hasta que la entrega 2
  emita los tokens, el CSS solo sabe leer la forma vieja: un perfil solo con `colores.primario`
  dejaría la web de La Birra Bar con el rojo por defecto. Lo cazó un test, no una lectura.
- **El ancla anti-deriva entre el seed y `business-profile.json` comparaba tres claves a mano**, así
  que se quedó verde con el seed sin ninguno de los cuatro campos nuevos. Ahora recorre las claves del
  JSON publicado, y crece sola.

**Deuda que arrastra:** republicar desde un brief **pisa las imágenes que suba el cliente**. El
nav/footer/menú/blog ya no dependen del brief (se calculan en vivo desde `business_profile`), así que
republicar no los toca — pero las imágenes de las landings sí.

---

## Bloque F — módulo 3: respondedor de reseñas de Google

**Lo único del alcance base sin construir.** El PRD describe cuatro módulos; están hechos el 1 y el 2.
El calendario de redes y el gestor de tareas quedaron en **línea futura**, fuera del presupuesto
inicial (OBS-01, cerrada el 2026-07-19).

No tiene ni una línea de código ni una spec. Antes de planificarlo hace falta una sesión de diseño:
qué reseñas, con qué autorización de Google, con qué compuerta humana (¿se publica sola una respuesta
generada por IA en el perfil de un cliente?), y qué pasa con el multi-tenancy de las credenciales de
Google.

---

## Bloque G — lo que ADR-19 dejó a medias

Nada de esto bloquea hoy; **todo bloquea un SLA**.

- **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
  **en proceso**. El borde es una decisión de despliegue.
- **Más de una instancia rompe la invalidación.** El webhook llega a UNA, las demás sirven contenido
  viejo hasta que venza el TTL (5 min por defecto). Antes de escalar: cache compartida, o bajar el TTL
  a sabiendas.
- **Punto único de disponibilidad.** Si el renderizador se cae, **se caen todas las webs de cliente a
  la vez**. Mitigado (health check sin dependencias, timeout de 5 s, 503 que no se cachea), pero el
  modo de fallo existe y un sitio estático no lo tenía.
- **El dominio propio del cliente.** El plan de Railway está **en su límite de custom domains** (se
  alcanzó con dos). Con una cartera, o se sube de plan o la CDN termina también el TLS.

---

## Bloque H — offboarding (ADR-11) y OBS-04

**ADR-11 no se puede firmar todavía**, y lo que falta no es código:

- **OBS-04 está ABIERTA**: quién edita la web durante el servicio no lo gobierna nuestro RBAC. De eso
  depende qué significa "editable" en la baja.
- **Falta verificar el snapshot estático como entregable** y ponerle precio a la "salida gestionada".
- **El enlace de preview del Visual Editor se emite a mano**: `firmarPreview()` existe y está probado,
  pero en producción el enlace se genera con un script fuera del repo. La firma **vence**, así que hoy
  se compensa con un vencimiento largo.
- **El clic-para-editar del Visual Editor no funciona**: `desShapeBlok()` descarta `_editable` al
  normalizar el blok, y de ahí saca el Bridge el resaltado. Se edita desde el panel de campos. Pesa
  poco si edita la agencia y bastante si el día de mañana edita el cliente.

---

## Bloque J — el programa del portal: piezas 3 (Ideas) y 4 (Dashboard)

**Esto faltaba en la primera versión de este plan, y es el hueco más grande que tenía.** No lo
encontró la review externa: apareció al contrastar el plan contra el `09`, que lo declara *en curso*
desde el 2026-08-02 ([`09:5-9`](09-estado-y-roadmap.md#L5)).

Es un programa de **cuatro piezas** y van **dos**:

| Pieza | Qué | Estado |
| --- | --- | --- |
| 1 | **CRM de clientes** — listado, alta, perfil editable | ✅ mergeada el 2026-08-01 |
| 2 | **Usuarios** — 6 etapas | ✅ mergeada el 2026-08-02 |
| 3 | **Ideas** — módulo nuevo completo | 🔵 [plan escrito](../superpowers/plans/2026-08-01-modulo-ideas-portal.md), sin empezar |
| 4 | **Dashboard** — la home con métricas | 🔵 [plan escrito](../superpowers/plans/2026-08-01-dashboard-home-portal.md), sin empezar |

**El orden no es negociable: la 4 depende de la 3.** El dashboard es stats de ideas más una tabla de
ideas, así que sin el modelo de la pieza 3 no hay nada que mostrar.

**Y explica un misterio del repo:** la migración **`0013` está reservada para Ideas**
(`0013_ideas.sql`), que es la mitad de por qué `0013`/`0014` no se usan y la próxima libre es la
`0018`. Un número reservado sin que el plan diga para qué es un número que alguien va a reutilizar.

**Lo que la pieza 3 deja fuera a propósito:** la integración con **n8n**, decidida como posterior. La
pantalla se ve funcionando con datos sembrados, y el ingreso real de ideas se decide después.

- **Coste:** la pieza más grande que queda después del bloque **E**, y a diferencia de E **no necesita
  decisiones de diseño**: los dos planes están escritos.

---

## Bloque I — deuda menor, sin bloqueo

| Deuda | Dónde | Nota |
| --- | --- | --- |
| El polling del brief (4 s) es **a ojo** | `portal/` | Se calibra contra los **16m15s** medidos de una corrida real. La lista de runs no pollea |
| Los `*.test.ts` del portal **no los typechequea ningún tsconfig** | `portal/tsconfig.*` | Medido metiendo un error descarado: el build pasa igual. Los `*.spec.ts` sí están cubiertos. El arreglo es un `include` |
| `una-sola-fuente.test.ts` solo barre esquemas **Zod** | `contrato/` | No ve mirrors **de tipos**. Candidato vivo: `ESCAPABLES` del portal contra el escapado de `contrato` |
| `force row level security` de `kr_informes` sin test propio | `db/` | La versión buena es un barrido de **todas** las tablas, no enumerar ésta |
| Republicar **pisa las imágenes** que suba el cliente | `web-builder/` | El nav/footer/menú/blog ya no: se calculan en vivo |
| **Sin tests de integración** del camino live | — | DataForSEO, OpenAI y Storyblok se ejercitaron a mano |
| `env:sync` avisa de 4 claves «sin destino» y no distingue | `scripts/` | Tres son deliberadas; **`SUPABASE_JWT_SECRET` sí es basura** (`api/src/auth.ts:84`: la firma se verifica contra el JWKS) |
| El CLI de despliegue **no dice en qué punto falló** | `db/src/cli/` | Un error pelado significa "falló antes del bucle", y eso hay que deducirlo leyendo el código |
| La **sonda del modo del SDK está duplicada** | `api/`, `orchestrator/` | Los dos chequeos son equivalentes hoy y nada los mantiene sincronizados. Unificar no es trivial: el único paquete compartido es `contrato/`, que solo depende de `zod` |
| 🔴 `PIPELINE_MODO` solo se contrasta contra **DataForSEO**, y esa omisión **sí muerde** | `orchestrator/` | Esta fila decía que era deliberado porque *"el publisher en dry-run lo reporta"*. **Medido el 2026-08-08: es falso**, y el error está en confundir dry-run con mock. Sin `WEB_PUBLISH_MODE`, `config.publishMode` cae a **`mock`** (`web-builder/src/config.ts:24`) y `MockPublisher` reporta **`published: true`** (`mock-publisher.ts:31`) — así que la base anotaría `published_at` para páginas que nunca salieron del contenedor, y encima en un `out/` efímero. El `StoryblokDryRunPublisher` sí reporta `published: false`, **a propósito y con el comentario que lo explica**; el mock no. Es exactamente el fallo que `PIPELINE_MODO` existe para cerrar —un mock presentado como real— por la puerta que quedó sin cerrar |
| `cartera-portal.test.ts` dejó de cubrir `intencion` | `db/` | Ata el mock contra `PAGINAS_DEMO` (español), no contra la fila (inglés desde la `0017`). Cerrarlo cruza `db/` y `portal/` |
| Deriva del portal por la `0017` | `portal/` | `cartera-mock.ts:147` genera `page_strategy: 'hub'/'spoke'`, valores que **la base ya no puede contener**; y `cartera-tabla.ts:29` pinta `{{ p.intencion }}` crudo |
| `endpoints_degradados` sigue **incompleto** como dato | `kr-service/` (`meta_run`) | Omite los fallos de suggestion/SERP. Lo que KR-2a arregló es que ahora **puede decir "no se sabe"** (`null`) en vez de afirmar `[]`. Vivía solo en el plan de Fase 2, que ya está cerrado |
| `web-builder` conserva su propio `SchemaType`/`PageType`/`SearchIntent` | `web-builder/src/types.ts` | Duplicado **nominal** del vocabulario de `contrato`, a propósito: es el contrato de **bloks** (`web.v0.1`), del M1 y versionado aparte. **Se autodelata** —si el contrato agrega un `PageType`, `pageToStory()` deja de typecheckear—, así que falla fuerte y no en silencio |

---

## Riesgo abierto — las credenciales expuestas

`docs/private.zip` estuvo commiteado en este repositorio **público** desde el 2026-08-01. Se sacó del
índice y el `.gitignore` quedó blindado, pero **el objeto sigue en el historial de GitHub**: purgar no
des-expone, lo que devuelve la seguridad es **rotar**.

**Pospuesto por decisión de Juan el 2026-08-04.** Sigue abierto, no cerrado. La lista priorizada vive
fuera del repo (`docs/private/rotacion-credenciales.md`).

---

## El orden que recomiendo, y por qué

> ### ✅ Del 0 al 4, hechos (2026-08-07 / 08). Se sigue por el **5**
>
> La documentación mentirosa, **A2**, **A1**, **B1+B2**, **C0** y **C entero** —incluidos los pasos
> **C-0** y **C-0b**, que aparecieron sobre la marcha—. El circuito está **ejercitado en producción**,
> no solo desplegado: run `14bda962…` lanzado desde el portal, aprobado, y `Completed` en Inngest.
>
> De hacerlo salieron **tres cosas que el plan no preveía**, y las tres viven arriba en sus bloques:
> **C-1** (en dry-run el intento de publicación no deja rastro nuestro), **C-2** (la marca de C0 y el
> workflow real pueden discrepar; y el barrido no cancela el workflow) y la frase del tooltip, ya
> suavizada.
>
> **C-1 y C-2 no bloquean nada** y no son mecánicos: los dos piden decidir *qué* se registra y *qué*
> se cancela. Van cuando haya rato para pensarlos, no a continuación por inercia.

0. **La documentación que miente.** No es un bloque: es el peaje de arrancar. La 15ª review encontró
   que **siete** afirmaciones repartidas en el `09`, el `README` de esta carpeta y `progress/current.md`
   seguían diciendo que falta desplegar el orquestador. Una sesión nueva las lee como estado y repite
   un despliegue ya hecho. Se arregla **antes** de tocar código, no después.
1. **A2 primero, y no A1.** Cambió el orden: A2 dejó de ser solo diseño futuro cuando se midió que
   **`finishRun` ya no tiene guarda de estado**. Eso es un bug hoy, y además la precondición para que
   el barrido no cree uno nuevo.
2. **A1** — que `/_health` diga la verdad, con la sonda por `Tx` y el log de transición.
3. **B1 + B2** — deuda decidida. Cierra lo que quedó a medias del entregable, que es lo último que se
   construyó y lo que la agencia le manda al cliente. **B1 comparte el código del 409 con C0**, así que
   los dos se deciden juntos aunque se hagan por separado.
4. **C0 + C** — la condición durable primero, y recién entonces aprobar → publicar en `dry-run`. Deja
   el circuito **entero** ejercitado, que es la diferencia entre "Fase 2 desplegada" y "Fase 2 probada".
5. **A4 y después A3** — las herramientas de credenciales. **En ese orden** (ver A3): A3 sin A4 no sabe
   qué esperar del orquestador, y un comparador que no sabe qué buscar informa "no falta nada".
   Las dos esperan a Juan: el permiso de lectura y el token de Railway.
6. **J o E**, y acá hay una elección real. **J** (piezas 3 y 4 del portal) es grande pero **no necesita
   decisiones**: los dos planes están escritos. **E** (el aspecto de las webs) es lo que más cambia lo
   que se puede vender, pero necesita decisiones de diseño. Si hay ganas de avanzar sin reuniones, J;
   si lo que aprieta es enseñar algo vendible, E.
7. **D** cuando Juan quiera gastar; **F** cuando haya sesión de diseño; **G** y **H** antes de un SLA
   o de firmar una baja.
