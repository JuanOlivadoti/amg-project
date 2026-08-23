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
| **D** | Calibrar el research (KR-1) | La calidad del módulo 2 | ✅ corrida real hecha el 2026-08-22 (parcial, ver detalle) |
| **E** | El aspecto de las webs | Vender el módulo 1 | diseño |
| **F** | Módulo 3 — reseñas de Google | Completar el alcance base | ✅ fase 1 y fase 2 (dos piezas) cerradas; resto en cascada bloqueado por acceso real a Google |
| **G** | Lo que ADR-19 dejó a medias | Un SLA | SLA real en curso — invalidación multi-instancia ✅ resuelta el 2026-08-23 (era config, no código); CDN y dominio custom quedan |
| **H** | Offboarding y OBS-04 | Firmar ADR-11 | comercial (un ítem, sin decisión de negocio, ✅ resuelto el 2026-08-22) |
| **J** | Piezas 3 y 4 del portal | Cerrar el programa del portal | ✅ cerrado el 2026-08-13 |
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

**✅ Corrida real hecha el 2026-08-22.** `MAX_COST_USD=1.00 npm run spike -w kr-service "Hamburguesería
gourmet en Madrid, especializada en carne madurada"` contra DataForSEO en producción: **$0.2124**
($0.1849 DFS + $0.0275 LLM), 23 keywords, 3 páginas. Dataset persistido en `datasets/keywords.json`
(commit de esta corrida). Un intento previo corrió sin querer contra **sandbox** (el `env:sync` para
arreglar una `OPENAI_API_KEY` vencida revirtió `DATAFORSEO_BASE_URL` a su default seguro) — quedó
descartado, sin gasto ($0.00 DFS), antes de repetirlo bien.

**Lo que este dataset SÍ cierra:**

- **`TIPOS_MAP_PACK` verificado contra la API real.** Las 3 cabezas del run mostraron `local_pack`/`map`
  en el SERP real y corrigieron 1 `is_local` — los nombres de tipo que usa `endpoints.ts` son correctos.
- **`lib/budget.ts` recalibrado con un dato real**, no heredado de una corrida perdida. El estimado
  anterior ($0.1145 para 23 keywords) quedaba **~60% por debajo** del gasto real de enriquecimiento
  ($0.1831) — la dirección peligrosa para un preflight que existe para frenar antes de gastar. Nuevos
  valores en `DEFAULT_ESTIMATES`, con ~17% de margen sobre el dato real, fijados por test
  (`budget.test.ts`, verificado por mutación). `dfsSerp` no se tocó: salió ~5× **por encima** del real
  (~$0.0006/SERP vs. $0.003 estimado) — ya sobreestima, que es el lado seguro.
- Los tres `n/d` del informe: confirmado en `out/informe.md` de esta corrida que se muestran como
  `n/d`, nunca como `0` — ya eran correctos en código, esto solo lo verificó contra datos reales.

**Lo que este dataset NO alcanza a cerrar, y por qué no se fuerza igual:**

- **`VOLUMEN_PERCENTIL_TOPE` (0.9) y `PESO_CONFIANZA_ORDEN` (0.5) siguen sin recalibrar.** Solo 4 de
  23 keywords trajeron volumen conocido (17% de cobertura, y 3 de esas 4 son nombres de competidores
  reales, no términos genéricos) — barrer un percentil sobre una población de 4 puntos no mide nada,
  solo inventa precisión donde no la hay. El propio código ya lo dice
  (`scoring.ts:67-72`): esto necesita una distribución de mercado real —muchas corridas, muchos
  rubros— no una corrida más de $0.21.
- **La hipótesis de `max_pages`/`serpValidateTop`** (cluster ≥16 con la cabeza sin observar) sigue sin
  un caso real: este run produjo 3 clusters, muy por debajo de los 16 que hacen falta para que el
  escenario aparezca. Ver [`09:1220`](09-estado-y-roadmap.md#L1220).

No se cierra el bloque como "calibrado" sin más — sería la misma trampa que advertía el texto
original: con el dataset se calibra lo que se puede medir con 23 keywords (los tipos de SERP, un
punto real de costo), no la señal de volumen ni la hipótesis de páginas.

El dataset ya no se pierde: desde el 2026-08-02 va a `datasets/`, versionado, con un test que se lo
pregunta a `git check-ignore`. Si hace falta más señal de volumen para VOLUMEN_PERCENTIL_TOPE/
PESO_CONFIANZA_ORDEN, la vía es correr research contra negocios reales según se vayan sumando
clientes (gratis, ya está pagado) — no un spike de calibración dedicado.

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

   > 🧭 **Ampliado el 2026-08-16: el menú digital enriquecido.** `MenuItem` suma `video`, `alergenos`
   > (14, Reglamento UE 1169/2011), `etiquetas` dietéticas (7), `nutricion` (calorías + macros de la
   > ración de referencia) y `precios[].comensales` — cruzando las cuatro fronteras. `cartaCategorias`
   > los dibuja: el video reemplaza a la foto en la miniatura cuando el plato tiene los dos, badges de
   > texto (no iconos) para alérgenos/etiquetas, un `<details>` sin JS para la nutrición. Migración
   > `0023`. Spec y plan en
   > [2026-08-14-menu-digital-enriquecido-design.md](../superpowers/specs/2026-08-14-menu-digital-enriquecido-design.md)
   > y [2026-08-14-menu-digital-enriquecido.md](../superpowers/plans/2026-08-14-menu-digital-enriquecido.md).
   > Detalle completo en el `09`.
   >
   > 🧭 **Editor en el portal, 2026-08-17.** `equipo`/`maestro` ya cargan la carta completa desde
   > `/clientes/:id/menu` — sin SQL/seed. `GET`/`PATCH /clients/:id/menu` sobre `PgClientes`
   > existente, sin migración nueva (el `grant update` de la 0001 sigue vigente). El rol `cliente`
   > queda afuera de esta etapa, a propósito — diferido, anotado junto a ADR-20/OBS-04. Spec y plan en
   > [2026-08-17-editor-menu-portal-design.md](../superpowers/specs/2026-08-17-editor-menu-portal-design.md)
   > y [2026-08-17-editor-menu-portal.md](../superpowers/plans/2026-08-17-editor-menu-portal.md).
   > `npm run verificar`: 1538 tests del monorepo + 291 (`node:test`) y 176 (Karma) del portal, todos
   > en verde.

### 🟡 Entrega 3 — piezas nuevas y arreglos visuales (A ✅, C ✅, B a medias)

**Es la entrega donde el sitio cambia de aspecto**, y por eso va después de que la 2 haya demostrado
paridad: si el rediseño y el refactor entran juntos, un cambio inesperado no se puede atribuir a
ninguno de los dos.

| Mitad | Qué | Estado |
| --- | --- | --- |
| **A** | Los **cinco arreglos visuales** (modo oscuro completo, doble borde de la carta, enlaces del pie, contraste del acento en oscuro, CTA largo) y el **uso real de los 9 tokens de marca** en el CSS de las piezas | ✅ |
| **C** | Las **tipografías self-hosted**: servidas desde `/_assets/fonts/` **y** pedidas por el CSS emitido, con `preload` de la familia de titulares y el test de *cero terceros* | ✅ |
| **B.1** | La **§Política de imágenes**: allowlist de hosts, `referrerpolicy`, https obligatorio y el tope de 60 `<img>` por documento | ✅ |
| **B.2** | `heroPortada`, `barraDatos`, `platosDestacados`, `galeria`, `ctaFinal`, `cartaCategorias` — las piezas que **dibujan** las fotos | ✅ |

La mitad **A** es la que hace que dos restaurantes dejen de distinguirse solo por un color de acento.

#### ✅ Mitad B, parte 2 — las seis piezas con foto (2026-08-09)

Las recetas quedaron así. `story` es literal de la spec §4; las otras las decidió esta entrega, porque
la spec dice **qué pieza usa cada página** pero no escribe las listas:

```text
story: heroPortada · barraDatos · seccionProsa · platosDestacados · galeria · faq · ctaFinal
home:  hero · barraDatos · platosDestacados · galeria · indice · ctaFinal
menu:  hero · barraDatos · cartaCategorias · ctaFinal
blog:  sin tocar
```

**`barraDatos` y `ctaFinal` van en las tres páginas de negocio, no solo en la landing.** El punto 4 de
la spec —«lo que la gente busca está enterrado en el pie: teléfono, horarios y direcciones… y en un
restaurante eso es el grueso de las visitas»— no se arregla si el arreglo llega solo a la landing,
porque la portada es donde entra más gente. `galeria` no va en `/menu` (ahí ya hay fotos de categoría y
de plato, y una segunda rejilla compite por la misma atención) y `platosDestacados` tampoco: su único
gancho es el enlace a `/menu`, que dentro de `/menu` no lleva a ninguna parte.

**`carta` se retiró del catálogo.** `cartaCategorias` cubre también el caso sin `menu_categorias` —que
la spec pide como test—, así que `carta` se quedaba sin ninguna receta que la nombrara: código que no
llega a ningún navegador con tests que pasan para siempre. Migraron con sus tests el arreglo del doble
borde, el modo oscuro completo, el `--acento-legible` del precio y el escapado. Cambio de conducta
deliberado: `carta` emitía «La carta todavía no está cargada» y `cartaCategorias` devuelve `""`, que es
lo que la spec dice.

**`--marca-secundario` por fin tiene consumidor.** La mitad A lo dejó emitido y sin usar porque atarlo
al gris del texto secundario fallaba AA (2.62:1). Entra por `--decorativo` y lo consumen tres filetes
decorativos —bajo el titular tipográfico, bajo cada categoría y en el borde de cada dato de la barra—.
**Nunca texto**, que era la condición exacta.

**El LCP, arreglado y no anotado.** Desde que `heroPortada` dibuja `profile.portada`, esa foto es el
elemento **LCP** de toda landing, y salía con `loading="lazy"` — diferir lo que la métrica mide.
`renderImagen` acepta ahora `prioridad: "alta"` (sin `loading`, con `fetchpriority="high"`) y **solo
`heroPortada` la usa**: marcar dos imágenes como prioritarias es no marcar ninguna.

**Verificado en un navegador**, que es el gate que sustituye a la paridad en esta entrega: con fotos
(claro/oscuro, escritorio/móvil), **sin fotos** —el hero tipográfico, que es el estado de todas las
fichas de producción— y con foto rota. Contraste medido sobre el HTML servido en oscuro: precio
**5.36:1**, etiqueta 7.18:1, título de categoría 15.41:1.

⚠️ **Con la foto declarada pero rota, la portada colapsa a 26 px.** El navegador trata una imagen sin
píxeles como texto alternativo en línea e ignora `width:100%` y `aspect-ratio`, y el titular no crece
porque `sin-img` mira si hay `src`, no si carga. **No se arregla**: detectarlo exige JS (`onerror`) y
meter JavaScript en el proceso anónimo por una ficha mal cargada es peor que el síntoma. Lo mitiga que
`renderImagen` emita `width`/`height` cuando la URL de Storyblok los lleva.

##### El gate de paridad, cerrado y re-capturado ✅

**7 de los 10 casos cambian, y es correcto**: la entrega 3 cambia el aspecto a propósito y el gate de
la entrega 2 existía para demostrar que el **refactor** no cambiaba el sitio — contrato cumplido y
cerrado. Los tres que **no** cambian son la señal de control: `landing-sin-perfil` (sin datos las
piezas nuevas devuelven `""` y `heroPortada` emite exactamente lo mismo que `hero`) y los dos de
`/blog`, cuya receta no se tocó.

La verificación había que hacerla **antes** de re-capturar y no después, y ése era el punto entero:
re-capturar deja el gate comparándose consigo mismo, así que la prueba de que el cambio es benigno solo
existe mientras las fixturas viejas siguen en `HEAD`. Se comparó rostro a rostro `git show HEAD:<fixtura>`
contra el disco en los diez casos, con las mismas cinco caras de `huellaDe`: **cero palabras perdidas,
cero `href` perdidos, cero `id` perdidos, y JSON-LD y traza de research idénticos**. Los siete que
cambian añaden entre 22 y 49 palabras; los tres de control dan **+0/+0**. Ejecutado **con autorización
explícita**, porque `capturar:paridad` está en `permissions.deny` y borra la única foto pre-refactor.

Dos precisiones que salieron de medirlo en vez de suponerlo:

- **Las diez fixturas aparecen modificadas en el diff, no siete.** El HTML de los tres de control
  también cambia —CSS y clases nuevas—; lo que no cambia son sus cinco rostros, que es lo único que el
  gate miraba. Decir "los tres no cambian" a secas era impreciso.
- **En `/menu` el precio se reordenó**, de ir tras el nombre a ir tras la descripción, porque el layout
  nuevo lo lleva a su columna derecha. El comparador cuenta multiconjuntos y por eso no lo ve; lo vieron
  los ojos sobre el texto visible. No se pierde ninguna palabra, pero **es una decisión**, y la
  diferencia entre "solo se añadió" y "además se reordenó una lista de producto" es justo la que un gate
  existe para no dejar pasar en silencio. Queda declarada en el mensaje del commit.

⚠️ **Este documento decía que la B estaba bloqueada esperando fotos, y era falso.** Los tests del
render no descargan nada: una URL inventada del host de la allowlist ejercita las piezas igual que una
real. Lo que las fotos desbloquean es **verlo en un navegador**, que es el último paso de la B y no el
primero — su gate pide *"el sitio manejado en un navegador … con fotos y sin fotos"*. La afirmación
equivocada tuvo coste: dejó la mitad B parada esperando un asset que no le hacía falta para escribirse.
Desde el 2026-08-08 las fotos están en Storyblok y `borcelle.es` (dev-server) las sirve.

**Ampliadas el 2026-08-09** (`0da56cd`): portada **sin la marca incrustada** —salía dos veces, en la
cabecera y quemada en el JPG—, **seis** fotos de galería y **una por categoría** donde había una sola
repetida. Tres cosas que solo aparecen con fotos distintas, y la primera es la que importa:

1. ⚠️ **Reemplazar un asset en Storyblok CAMBIA la URL.** La portada vieja devuelve `403 AccessDenied`
   (verificado con `curl`). Sustituir una foto **no es editar un archivo**: es un asset nuevo, y toda
   ficha que guarde la URL anterior queda con un `<img>` roto **sin que nada avise** — la portada
   colapsa a 26 px y no hay error en ningún log. Al cambiar la foto de un cliente real, se actualiza su
   ficha en la misma operación.
2. La rejilla de galería es de 4 columnas: seis fotos quedan 4+2 en escritorio (en móvil son 2 y no se
   nota). Con 4 —múltiplo— no se veía.
3. La cabecera de categoría es más alta que el contenido cuando la categoría tiene un solo plato.

**Y una deuda preexistente que salió de medir en vez de leer:** el logo se dibuja a **250×250, su
tamaño natural, `max-height: none`** — sin tope, y en móvil ocupa el **64 %** del ancho. El README de
`template1` afirmaba "unos 40 px de alto". No se manifiesta en producción porque **ninguna ficha real
tiene logo**; el arreglo es un tope en el CSS de `cabecera` con su test.

#### ✅ Mitad B, parte 1 — la §Política de imágenes (2026-08-09)

La puerta, puesta **antes** de dibujar una sola foto. Allowlist de hosts **en el código**
(`a.storyblok.com`), nunca en la ficha; comparación **exacta** contra un `Set` sobre
`new URL(...).hostname`; https obligatorio; `referrerpolicy="no-referrer"` en cada `<img>`; y **60
imágenes por documento**, con el contador naciendo y muriendo con el documento — si viviera en el
módulo, el renderizador (proceso largo que atiende a todos los clientes) serviría la primera web con
fotos y **todas las siguientes sin ellas**, y casi ningún test lo vería porque casi todos renderizan
una sola vez.

**Tres premisas del brief resultaron falsas, y las tres importaban:**

1. **No hay un emisor de `<img>`, hay tres.** Además de `renderImagen` está el **logo**
   (`cabecera.ts`), que es pieza de shell y por tanto aparece en **todas** las páginas: como vector de
   fuga es el peor de los tres. Y `og:image` + el `image` del JSON-LD son el tercero.
2. **El gate de paridad es ciego a `referrerpolicy`.** Sus cinco caras son texto visible, `href`,
   `id`, JSON-LD y traza. Verificado por mutación: quitarlo deja los diez casos en verde. No se
   retocó ninguna fixture.
3. **`"a.storyblok.com.evil.tld".endsWith("storyblok.com")` es `false`.** Ese caso lo mata `includes`
   o la comparación sobre el string crudo, no `endsWith` — así que hubo que correr varias variantes
   para no dejar ningún caso nominal del que no se supiera si puede fallar.

**`og:image` exige https y NO la allowlist**, y la asimetría es deliberada: aplicársela tumbó cinco
fixturas del gate porque la imagen social vive normalmente en el **dominio del propio cliente**. Ahí
la allowlist no defiende de nada —la pide el crawler de la red social al compartir el enlace, no el
navegador del visitante— y a cambio le quita la tarjeta social a todo cliente que no haya subido su
foto a nuestro space. Tiene test propio para que nadie la "arregle" por simetría.

**El logo entró en la política**, endureciendo una conducta que tenía test propio (`cdn.ej`). Se
comprobó antes que ninguna ficha sembrada tiene logo fuera de Storyblok y que el fallo es benigno: un
logo rechazado cae al nombre del negocio en texto, igual que si no hubiera logo. Zod se alineó a https.

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

## Bloque K — el rediseño de la plantilla base (2026-08-10)

**El bloque E dejó la infraestructura de marca; esto es el aspecto.** Juan pidió rehacer las webs de
cliente tomando como referencia visual un template comercial de restaurante (`Foodu`, `home-6`),
sección por sección. La regla es la misma de siempre: **se replica estructura y aire, no se adopta ni
una línea de su código**; sus archivos y sus imágenes no entran en el repo.

Los valores medidos, qué se copió y qué no, y por qué, están en
[`renderer/docs/04-plantilla-base.md`](../../renderer/docs/04-plantilla-base.md).

### ✅ Etapa 1 — tema claro, cabecera y portada (2026-08-10)

Lo primero no fue estético sino **un bug de producto**: el sitio obedecía a `prefers-color-scheme`,
así que el fondo de marca del cliente lo decidía el sistema operativo del visitante. Hoy lo dice la
ficha (`brand.tema`, default `claro`).

```text
cabecera     barra superior con teléfono y horario · sticky · nav centrado en la fuente de titulares
             · CTA `tel:` · la barra superior se esconde en móvil
heroSlider   portada a dos columnas: titular + carrusel de fotos, SIN una línea de JavaScript
             (radios + `:checked`, porque las anclas movían la página 203 px)
heroPortada  RETIRADA: se quedó sin receta, mismo criterio que retiró a `carta`
tokens       --ancho-pagina 1320 / --ancho-lectura 760 · el CSS oscuro a un campo `cssOscuro` aparte
```

**Verificado en el navegador** (escritorio 1440 y móvil 390), que en esta área no es opcional: de los
defectos que aparecieron, **tres los encontró el navegador y ninguno un test**. El gate de paridad se
**re-capturó** con autorización explícita, midiendo antes que no se perdía nada.

**Deuda declarada:** `brand.tema: "auto"` no cruza las tres primeras fronteras, así que en producción
es inalcanzable —el default se cumple siempre, que es la conducta que se quería, pero la opción no
existe hasta que se agregue a Zod, a la allowlist de la `0014` y a `perfilValido`—.

### ✅ Etapa 2 — el resto de las secciones y el pie (2026-08-10)

Doce piezas de contenido rediseñadas y **el andamio del ancho de lectura eliminado del todo**.

```text
1ª tanda   barraDatos · platosDestacados · cartaCategorias · galeria · ctaFinal
2ª tanda   hero (cabezal de /menu y /blog) · seccionProsa · faq · indice · blogIndice
el pie     contacto + locales, en columnas: contacto + UNA POR LOCAL
base       `main` deja de declarar ancho y respiro → las secciones con fondo son full-bleed
           `.cards` pasa de `auto-fill` a 3 columnas fijas (el auto-fill daba 5 en la banda de 1320)
```

**El pie no son cuatro columnas fijas como en la referencia, y es deliberado:** las dos que faltarían
son un menú de enlaces que duplica el nav y un formulario de newsletter sin backend. Nunca una
columna vacía. El detalle, en [`renderer/docs/04-plantilla-base.md`](../../renderer/docs/04-plantilla-base.md).

### ✅ Etapa 3 — las secciones sin origen de datos, con contenido por defecto (2026-08-10)

**Decidido el 2026-08-10 por el usuario:** se replican las secciones que faltan **inventando un
contenido por defecto**, en vez de esperar a que existan los campos y las pantallas del portal. Es una
excepción consciente a *antes ausente que inventado*, y el porqué —y su límite— están escritos en
[`renderer/docs/04-plantilla-base.md`](../../renderer/docs/04-plantilla-base.md) § La decisión sobre
el contenido por defecto.

| Sección | Campo nuevo | Default |
| --- | --- | --- |
| Bienvenida ("Welcome at X" + horarios) | `bienvenida` (texto) | Prosa neutra, editable |
| Bullets de "por qué nosotros" | `destacados` (lista) | Tres frases genéricas |
| Testimonios | `testimonios` (lista) | ⚠️ Texto de muestra **sin nombres de persona ni valoraciones numéricas presentadas como reales** |
| Contadores y sponsors | — | **Siguen descartados**: relleno de template |

**La regla que gobierna esta etapa:** un default puede rellenar una sección, **nunca afirmar un hecho
sobre el negocio** (años, clientes, premios, una reseña firmada). Y el campo tiene que existir igual,
cruzando las cuatro fronteras: si no, el cliente no puede cambiar el default, que es lo único que lo
hace aceptable.

**Lo que se hizo, y en qué se apartó de la tabla de arriba.** Los tres campos cruzan las cuatro
fronteras: `types.ts` + el Zod de `contract.ts`, la migración **`0020`**, `perfilValido` y la pieza. Los
topes (6 destacados, 12 testimonios) quedan atados por un test entre las dos fronteras del
`web-builder`, y la mutación se verificó: quitarle `autor` a la allowlist tumba exactamente su test y
el del recorrido encadenado.

**`testimonios` se implementó SIN default**, que es la única desviación y es la que la propia regla
pedía: una reseña es una afirmación sobre el negocio atribuida a una persona, así que no hay texto de
plantilla que la vuelva inocua. Sin datos, la sección no se dibuja. **Y no existe campo de
puntuación** en ninguna de las cuatro capas — lo impone sobre todo la allowlist SQL, que enumera
`texto` y `autor`: un `estrellas` escrito a mano en `business_profile` no llega al renderizador.

Los defaults de `bienvenida` y `destacados` **hablan de la página, no del negocio**, y eso lo sostiene
un test con una lista de palabras prohibidas (`temporada`, `mercado`, `artesan`, `desde 19`, `mejor`,
`premi`…) en vez de la buena memoria de quien edite el texto.

⏭️ **Lo que falta y no es de esta etapa: las pantallas del portal** para que la agencia cargue los tres
campos. Hasta que existan, solo se pueden escribir a mano en `business_profile` — que es lo que hace
al default aceptable **y temporal**: un default que el cliente no puede cambiar deja de ser una
propuesta. Es trabajo del agente `front`.

## Bloque F — módulo 3: respondedor de reseñas de Google

**Fase 1 (monitoreo + alerta): ✅ COMPLETA el 2026-08-15.** El PRD describe cuatro módulos; están
hechos el 1, el 2 y ahora la primera fase del 3 (el "Gestor de Reseñas" — RF-016 a RF-018). El
calendario de redes y el gestor de tareas quedaron en **línea futura**, fuera del presupuesto inicial
(OBS-01, cerrada el 2026-07-19).

La sesión de diseño ([spec](../superpowers/specs/2026-08-13-modulo-resenas-google-design.md)) resolvió
las cuatro preguntas abiertas: **alcance** — solo monitoreo + alerta esta vuelta, el borrador de IA y
la publicación de respuestas son fase 2 (el PRD ya exige que las negativas las redacte siempre un
humano); **acceso a Google** — mock-first, AMG todavía no pidió acceso a la Business Profile API;
**conexión** — OAuth por cliente, `refresh_token` en `clients` bajo RLS, escribible pero no legible
para `app_user` ni `app_service`; **detección** — polling periódico, no Pub/Sub. El
[plan de 8 tasks](../superpowers/plans/2026-08-13-modulo-resenas-google.md) se ejecutó completo con
`superpowers:subagent-driven-development` sobre `feature/resenas-google` (mergeada a `main` y
desplegada — ver más abajo):

| Task | Qué | Migración/commit |
| --- | --- | --- |
| 1 | Tabla `resenas_google` + columnas de conexión en `clients`, RLS estándar (mismo molde que `ideas`) | `0021` |
| 2 | Rol cross-tenant `app_resenas` (sin login) + 2 funciones `security definer` para el polling — mismo molde que `app_barrido` (`0018`) | `0022` |
| 3 | `GoogleReviewsProvider` mock/live en `orchestrator/` (`live` lanza explícito, fase 1 no lo implementa) | `fc6cb71` |
| 4 | El polling: función Inngest programada, aislamiento por cliente, idempotente | `f2632cd` |
| 5 | Endpoints de conexión OAuth (`conectar`/`callback`/`desconectar`) + `GoogleOAuthProvider` mock/live | `553e47f` |
| 6 | `GET`/`PATCH` de reseñas por cliente | `abdeb2e` |
| 7 | El tab `/clientes/:id/resenas` real (los cuatro estados) + botón "Conectar Google" | `9811ec6` |
| fix | El callback OAuth firmado — ver abajo | `cb39245` |

**El hallazgo más serio de la pieza, y por qué importa manejar la app en un navegador y no solo
confiar en los tests.** La Task 7, probando el flujo en un navegador real (no el mock de los tests),
encontró que `GET /clients/:id/google/callback` estaba roto de punta a punta: vivía detrás del
middleware de autenticación global, pero lo pega una **navegación anónima del navegador**
(`window.location.href`) que nunca puede llevar el header `Authorization` — ninguna navegación
`href` lo lleva, no era un detalle de esta implementación. Los tests de la Task 5 no lo agarraron
porque simulaban el callback adjuntando el header a mano, algo que un navegador real no puede hacer.
Cerrado moviendo el callback fuera de `autenticar()` (mismo lugar que `/health`) y firmando el
`state` con HMAC-SHA256 (`OAUTH_STATE_SECRET`, obligatorio en producción, catálogo de credenciales
sincronizado — familia `secreto`, como `PREVIEW_SECRET`) para que la identidad de quien conecta viaje
sin depender de un header que la navegación no puede llevar; RLS queda como segunda capa de defensa
independiente (si alguien lograra firmar un `state` para un cliente ajeno, la escritura de todos
modos falla por `client_write`).

**Tres tasks (1, 2 y 5) encontraron bugs de seguridad reales en el SQL que el propio plan proponía**,
los tres verificados por mutación real: un `revoke select` por columna no angosta un `grant` de tabla
ya concedido (`app_user` y `app_service` tenían SELECT de tabla sobre `clients` desde antes de este
bloque — la 0021/0022 tuvieron que revocarlo y re-concederlo columna por columna); y las políticas RLS
de `resenas_google` no llevaban `tenant_id = app.current_tenant_id()` (cualquier staff de cualquier
tenant habría visto las reseñas de todos los demás — `app.ve_cliente()` da `true` para cualquier
`client_id` cuando quien pregunta es staff, sin mirar el tenant).

Verificado en el navegador: el flujo completo de conexión (botón → mock → callback → escritura bajo
RLS → redirect de vuelta al tab) persistiendo tras un refresh, rol `cliente` con acceso de solo
lectura, claro y oscuro, consola limpia. `db` 352/352, `api` 211/211, `orchestrator` 92/92, `scripts`
95/95, portal 288 `node:test` + 154 Karma.

**Deuda anotada, no bloqueante:** el `nonce` del `state` no se invalida tras el primer uso — la única
defensa contra un `state` filtrado es la ventana de 10 minutos; invalidarlo tras el primer uso exige
una migración (una tabla o columna de nonces usados). Las migraciones `0021`/`0022` **desplegadas a
producción el 2026-08-18** (confirmado en `app.migraciones_aplicadas`).

**Fase 2, primera pieza (borrador de respuesta con IA para 4-5★): ✅ COMPLETA el 2026-08-21.** Spec
([diseño](../superpowers/specs/2026-08-18-borrador-ia-resenas-google-design.md), con 8 hallazgos de
Codex aplicados) y [plan de 7 tasks](../superpowers/plans/2026-08-18-borrador-ia-resenas-google.md),
ejecutados con `superpowers:subagent-driven-development` sobre un worktree (`worktree-borrador-ia-resenas`),
mergeados a `main` el 2026-08-21:

| Task | Qué | Migración/commit |
| --- | --- | --- |
| 1 | Migración `0024`: columnas `borrador_respuesta`/`borrador_generado_en` + `app.guardar_borrador_resena` (`security definer`, `where puntuacion between 4 and 5 and borrador_respuesta is null` — Postgres impone la regla, no el llamador) | `dff4a02` |
| 2 | `PgResenas.editarBorrador` — el staff edita el borrador desde el portal | `2e35ad8` |
| 3 | `BorradorProvider` mock/OpenAI (`BORRADOR_RESENAS_MODO`, default derivado de `OPENAI_API_KEY`, mismo patrón que `PROSE_MODE`) | `a3dc0e8` |
| 4 | `pollearResenas` genera el borrador para reseñas 4-5★ nuevas, dentro del mismo ciclo de polling | `b72a982` |
| 5 | `/_health` reporta el modo del borrador | `86dc467` |
| 6 | `PATCH /clients/:id/resenas/:id` acepta editar el borrador | `a28a990` |
| 7 | El tab del portal: textarea editable, con el borrador de IA precargado | `e1725c5` |

**Un bug real de punta a punta, encontrado manejando la app en el navegador y no por ningún test:**
`listarResenas` (`db/src/resenas.ts`) nunca devolvía `borrador_respuesta` — `COLS` y `aResena()` no se
habían extendido cuando la Task 2 agregó el lado de escritura. El campo viajaba hasta `PgResenas` pero
nunca llegaba a la respuesta HTTP: el portal jamás podía mostrar un borrador, sin que ningún test de
las 7 tasks lo agarrara (ninguna brief pidió el cableado del lado de lectura). Fix con test rojo→verde
(`b0c004e`) más un guardarraíl nuevo: un test en `db/src/resenas.test.ts` que compara
`Object.keys()` de una fila de `listarResenas()` contra el set exacto de `ResenaGoogle` **y** que
ningún valor sea `undefined` (la sola comparación de claves no alcanza — `aResena()` arma el objeto con
las 8 claves siempre presentes, así que una columna que se cae de `COLS` pasa desapercibida con
`undefined` en vez de la ausencia de la clave).

La revisión final de rama (most-capable model) dio "Ready to merge: with fixes" — sin Critical, con
varios Important/Minor: timeout (30s) y `maxRetries: 1` en el cliente de OpenAI (evita que una llamada
colgada consuma el ciclo de 30 min del polling — la doctrina de este proyecto rechaza reintentos
automáticos en llamadas facturables, igual que `kr-service/src/dataforseo/client.ts`), `max_tokens: 300`
como tope duro a la respuesta, el guard de TypeScript alineado con el `check` SQL (`>=4 && <=5`, no solo
`>=4`), un log cuando `guardar_borrador_resena` descarta un borrador ya generado, limpiar `ediciones`
locales del portal al cambiar de cliente, y documentar la interpolación sin escapar de `autor`/`texto`
en el prompt (decisión consciente: la garantía real es la revisión humana, esta pieza no publica nada).
**La re-revisión de ese lote de fixes encontró un segundo bug real**, no menor: agregar `OPENAI_MODEL`
como clave activa de `orchestrator/.env.example` (necesario para no romper el contrato
`MAPA`/`CATALOGO` de `env-sync.mts`/`credencial.mts`) exponía a `openai-provider.ts` al mismo patrón
que `env:sync` ya sabía que hacía falta evitar en `config.ts`: `env:sync` escribe `""` (no omite la
clave) cuando falta en `credenciales.env`, y un `??` no cae al default ante `""` — solo ante
`null`/`undefined`. Sin el fix, el primer `env:sync` sin `OPENAI_MODEL` declarada mandaría `model:""`
a OpenAI en cada borrador real. Extraído a `leerModeloBorrador()` con `?.trim() || "gpt-4o-mini"`,
verificado por mutación.

Verificado en el navegador (worktree, servidor propio en :3000/:4201): conectar Google, los tres
estados a la vista a la vez (1-3★ sin textarea — la IA nunca las toca; 4★ con textarea vacía; 5★ con
el borrador de IA precargado), editar el borrador, guardar, y confirmar la persistencia server-side
tras un reload. Consola limpia. `db` 381/381, `api` 226/226, `orchestrator` 117/117, `scripts` 98/98,
portal 298 `node:test` + 192 Karma (conjunto final, con el merge a `main`).

La migración `0024` se desplegó a producción el **2026-08-22**.

**Fase 2, segunda pieza (publicar la respuesta de vuelta a Google): ✅ COMPLETA el 2026-08-23,
mock-first.** [Plan de 3 tasks](../superpowers/plans/2026-08-23-publicar-respuesta-resena.md),
ejecutado con los agentes de área del proyecto (`datos` → `pipeline` → `front`, en serie porque cada
uno consume el contrato que fija el anterior) en vez de la skill genérica de subagentes — contrato
fijado por la sesión principal antes de delegar. Comando compuesto, mismo molde que
`POST /runs/:id/approve` (ADR-18): la API marca `respuesta_solicitada_en` bajo RLS y SOLO SI la fila
cambió emite `resenas/respuesta.solicitada` — el evento lleva únicamente el `id` de la reseña, nunca
el texto ni las credenciales; el orquestador vuelve a preguntarle a la base qué publicar
(`app.resena_para_publicar`, cross-tenant vía `app_resenas`, mismo rol que ya lee el refresh token) en
vez de confiar en el payload.

| Task | Qué | Migración/commit |
| --- | --- | --- |
| 1 (`datos`) | Migración `0025`: columnas `respuesta_solicitada_en`/`respuesta_publicada_en`, dos funciones `security definer` (`resena_para_publicar`, `publicar_respuesta_resena`) sin política nueva —las de 0021/0024 ya cubren cualquier UPDATE de esos roles—, `PgResenas.solicitarPublicacion`, `PgStore.resenaParaPublicar`/`marcarRespuestaPublicada`, tercera forma del `PATCH /clients/:id/resenas/:resenaId` (`{"publicar": true}`) | `0025` |
| 2 (`pipeline`) | `GoogleReviewsProvider.publicarRespuesta` (mock determinista, `live` sigue sin implementación), evento `resenas/respuesta.solicitada` en `events.ts`, función pura `publicarRespuestaResena` + `crearFuncionPublicarResena` (Inngest, `retries: 0`, mismo criterio que el polling) | — |
| 3 (`front`) | Botón de tres estados en el tab de reseñas (Publicar respuesta / Reintentar publicación / Publicada el ...), visible solo con borrador y solo para `esEquipo()` | — |

**Sin reintento automático, a propósito** (mismo criterio que la generación del borrador de IA): si
falla, la fila queda "solicitada, no publicada" y el staff reintenta con el mismo botón — un segundo
click pisa el timestamp y remite el evento.

Verificado en el navegador con Chrome DevTools MCP (harness descartable del agente `front`, limpiado
al terminar — no tocó `api/` ni `orchestrator/`, solo simuló lo que Inngest haría con el
`publicarRespuestaResena` real): ciclo completo `Publicar respuesta → Reintentar publicación →
Publicada el ...`, guardarraíl de rol `cliente` en vivo (sin ningún botón), los dos temas. `revisor`
verificó por mutación de primera mano los dos guardarraíles centrales (sin borrador no se puede pedir
publicar; sin permiso o sin borrador el endpoint da 404 sin emitir evento) — veredicto **APROBADO**,
detalle completo en `progress/informes/revision-publicar-respuesta.md`.

**Lo que sigue siendo fase 2, sin empezar, y por qué:** alertas por WhatsApp/email (decisión de
proveedor pendiente — vendor a elegir, no ingeniería lista) y el acceso real a la Business Profile
API (`GOOGLE_REVIEWS_MODO=live`, trámite externo de Juan con Google) bloquean también, en cascada,
"limpiar la conexión cuando el polling detecta un refresh token revocado": sin acceso real no hay
forma de conocer la forma real del error de revocación de Google, así que construir esa detección
ahora sería adivinar contra una API que todavía no existe en este proyecto.

---

## Bloque G — lo que ADR-19 dejó a medias

Nada de esto bloquea hoy; **todo bloquea un SLA**.

- **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
  **en proceso**. El borde es una decisión de despliegue.
- ~~**Más de una instancia rompe la invalidación.**~~ **No es una brecha de código — ya está resuelto
  por diseño, 2026-08-23.** El webhook llega a UNA instancia, pero el TTL (`CACHE_TTL_MS`,
  `renderer/src/deps.ts`) ya es una variable de entorno de producción, leída y propagada de punta a
  punta (`leerConfig()` → `crearDeps()` → `CacheRender`), documentada en `renderer/README.md` y sin
  test hasta ahora (`renderer/src/deps.test.ts`, 10 casos, verificado por mutación: apagar el guard
  `ttl > 0` tumba exactamente el caso de `CACHE_TTL_MS=0`). Con el TTL como único mecanismo (sin
  depender de a qué instancia le llegó el webhook), la peor propagación cruzando toda la flota queda
  acotada por el valor de `CACHE_TTL_MS`, sin importar cuántas instancias corran. Lo único que falta
  es **el número**: fijar `CACHE_TTL_MS` en Railway al valor que pida el SLA (el default sigue siendo
  5 min si no se toca). La alternativa de cache compartida (Redis, invalidación casi en tiempo real)
  se evaluó y se descartó por ahora — el SLA en curso solo pide acotar la propagación, no tiempo real.
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
- ~~**El enlace de preview del Visual Editor se emite a mano**~~ ✅ **Resuelto el 2026-08-22.**
  `npm run preview:firmar -w renderer -- <dominio> [minutos]` (`renderer/src/cli/firmar-preview.ts`,
  5 tests, verificado por mutación) envuelve `firmarPreview()` en un comando del repo, versionado y
  probado — antes vivía como script fuera del repo, sin test, sin historia en git. `PREVIEW_SECRET`
  sigue sin viajar por `env:sync` a propósito (es config de producción de Railway, como
  `DATABASE_URL_RENDER` y `STORYBLOK_WEBHOOK_SECRET`: el renderizador es la única pieza expuesta a
  internet anónimo, sus credenciales reales no tienen por qué estar en ninguna máquina local) — hay
  que ponerla a mano en `renderer/.env` cada vez, documentado en `renderer/.env.example`. La firma
  sigue **venciendo** (1h por defecto), eso no cambió.
- **El clic-para-editar del Visual Editor no funciona**: `desShapeBlok()` descarta `_editable` al
  normalizar el blok, y de ahí saca el Bridge el resaltado. Se edita desde el panel de campos. Pesa
  poco si edita la agencia y bastante si el día de mañana edita el cliente.

---

## Bloque J — el programa del portal: piezas 3 (Ideas) y 4 (Dashboard) — CERRADO

**Esto faltaba en la primera versión de este plan, y es el hueco más grande que tenía.** No lo
encontró la review externa: apareció al contrastar el plan contra el `09`, que lo declara *en curso*
desde el 2026-08-02 ([`09:5-9`](09-estado-y-roadmap.md#L5)).

Era un programa de **cuatro piezas**, y las cuatro están **completas** (la última, el 2026-08-13):

| Pieza | Qué | Estado |
| --- | --- | --- |
| 1 | **CRM de clientes** — listado, alta, perfil editable | ✅ mergeada el 2026-08-01 |
| 2 | **Usuarios** — 6 etapas | ✅ mergeada el 2026-08-02 |
| 3 | **Ideas** — módulo nuevo completo | ✅ **completa el 2026-08-12** ([plan](../superpowers/plans/2026-08-01-modulo-ideas-portal.md)). **Etapas 1–4** (`db`/`api`): la `0013`, `PgIdeas` y las transiciones (47 tests) y los tres endpoints con su borde HTTP (34 tests) el 2026-08-09; el **seed de ejemplo** (19 tests) el 2026-08-10. **Etapa 7** (retirar el mock de la pieza 1): hecha el 2026-08-11, junto con el rediseño de navegación. **Etapas 5–6** (pantallas, rutas, cierre): hechas el 2026-08-12 en `feature/modulo-ideas`, con `superpowers:subagent-driven-development` — listado en `clientes/:id/ideas`, detalle con edición y aprobar/rechazar en `clientes/:id/ideas/:ideaId`. Un hallazgo bloqueante real en la revisión (la atadura de la máquina de transiciones del portal contra `db/src/ideas.ts` no leía el archivo real), corregido y verificado por mutación. Portal: 265 `node:test` (262 + 3 del mismo bug preexistente de Windows en `codigos.test.ts`/`ideas-transiciones.test.ts`) + 136 Karma. Verificado en navegador, claro y oscuro. **El hueco que queda, a propósito y documentado:** el ingreso real de ideas (n8n) no existe — las que se ven son el seed de ejemplo. Detalle completo en `.superpowers/sdd/progress.md` |
| 4 | **Dashboard** — la home con métricas | ✅ **completa el 2026-08-13** ([plan](../superpowers/plans/2026-08-01-dashboard-home-portal.md)). Tres tasks sobre `feature/dashboard-home`: `metricas.ts` (funciones puras) + `listarTodasLasIdeas` en `api-core.ts`; la pantalla `InicioPage` (seis tiles + tabla de últimas ideas, tres fuentes independientes en su falla); ruta `/inicio` + ítem primero en el sidebar + cierre. **No hizo falta ningún endpoint ni migración nueva** — se calcula todo en el cliente sobre lo que las piezas 1 y 3 ya exponían. El test de aislamiento de los conteos ya estaba cubierto por piezas anteriores con la misma forma de consulta; se confirmó en verde, no se duplicó. Drift resuelto con el usuario: el `redirectTo` de la puerta de entrada ya no es `runs` (retirado el 2026-08-11) sino `clientes` — esa es la regla que no se tocó. Verificado en navegador: datos reales, sin datos (ceros reales, no huecos), API caída (error explícito, sin pantalla en blanco), los dos temas. **Revisión final de integración de rama, cerrada el 2026-08-13**: `CAMBIOS_PEDIDOS` con 2 bloqueantes (cifras de tests desincronizadas, y el límite real de 5 filas sin test que lo distinguiera de otro número) + 4 Minor agrupados en el mismo commit (se borró `calcularMetricas` código muerto y sus tests, los tres signals `cargando*` write-only, se sumó el caso simétrico "clientes falla" y el guardarraíl de ruta de `inicio`). Portal, cifras finales: **282 `node:test` + 143 Karma**. Root: 1395/1395, sin regresiones. Detalle completo en `.superpowers/sdd/task-3-report.md` y `.superpowers/sdd/final-fix-report.md`. **Post-merge (2026-08-13): Juan respondió la primera pregunta abierta del cierre — sí, `/inicio` pasa a ser la ruta por defecto.** `redirectTo: 'clientes'` → `'inicio'` en `app.routes.ts` y el post-login de `login.ts`, atados por `app.routes.test.ts` para que las dos decisiones no se desincronicen; el comodín `**` se queda en `clientes` a propósito (decisión distinta). Verificado en navegador con datos reales. Portal sigue en 282/143 (no se agregaron tests nuevos, solo se movió el valor esperado de los existentes) |

**El programa del portal de la agencia queda cerrado con sus cuatro piezas.** Lo que sigue del portal
es trabajo nuevo, no deuda de este programa.

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
| ~~El polling del brief (4 s) es **a ojo**~~ | `portal/` | **Resuelto 2026-08-18.** `POLL_MS` se movió a `core/brief-polling.ts` (15s, con el porqué contra los 16m15s medidos, y su propio `node:test` que fija el valor y un rango razonable). La lista de runs sigue sin pollear — confirmado, no era parte de esta fila |
| ~~Los `*.test.ts` del portal **no los typechequea ningún tsconfig**~~ | `portal/tsconfig.*` | **Resuelto 2026-08-18.** `tsconfig.test.json` nuevo (`types: ["node"]`, `@types/node` sumado como devDependency explícita) + `npm run typecheck` ahora encadena `ng build` con `tsc --noEmit -p tsconfig.test.json`. Verificado por mutación (un error de tipos cae con `typecheck`, no con `test`) — y de paso destapó 2 bugs reales preexistentes (`google_conectado_en` faltante en dos factorías de fixtures), corregidos |
| ~~`una-sola-fuente.test.ts` solo barre esquemas **Zod**~~ | `contrato/` | **Resuelto 2026-08-18**, el candidato que la fila señalaba. `CARACTERES_ESCAPADOS_EN_INFORME` (nueva, exportada en `contrato/src/informe.ts`) y `ESCAPABLES` (exportada en `portal/src/app/core/markdown.ts`, antes privada) atadas por dos tests: uno liga la constante contra lo que `texto()` escapa de verdad (no solo la documenta), el otro importa `markdown.ts` en runtime (mismo mecanismo que `cartera-portal.test.ts`, ADR-21) y compara los dos alfabetos como conjuntos. Verificado por mutación: agregar `~` a `ESCAPABLES` sin tocar `contrato` hace caer el test cruzado |
| ~~`force row level security` de `kr_informes` sin test propio~~ | `db/` | **Resuelto 2026-08-21.** `db/src/rls-forzada.test.ts` nuevo: barre **todas** las tablas de `public` con `enable row level security` (12 hoy) y exige `force` en cada una, en vez de enumerar `kr_informes` sola — así una tabla nueva que se olvide del `force` cae sola, sin acordarse de extender una lista. Investigado antes de escribir el barrido: no hay ninguna tabla con RLS habilitada y `force` deliberadamente ausente (`app.migraciones_aplicadas` no es la excepción — no tiene RLS en absoluto, y vive en `app`, fuera del universo que recorre `public`). Verificado por mutación: sacar el `force` de `kr_informes` (0016) tumba exactamente ese test, nombrando la tabla |
| ~~Republicar **pisa las imágenes** que suba el cliente~~ | `web-builder/` | **Medido y resuelto 2026-08-21.** El texto de la fila estaba desactualizado: `nav`/`footer`/`/menu`/`/blog` NUNCA salieron de un `Story` de Storyblok — se sintetizan en vivo en `renderer/src/app.ts` desde `clients.business_profile` (portada, `menu_categorias[].foto`, etc.), así que republicar jamás los tocó. El riesgo real vivía en las **landing pages del research** (`HeroBlok.image`/`SectionBlok.image`, `web-builder/src/types.ts:57-73`): el handoff (`briefToStories`) nunca pone `image` — la sube el cliente desde el Visual Editor **después** de publicar —, y `StoryblokPublisher.updateStory` mandaba un `PUT` con `content` completo (Storyblok reemplaza, no fusiona), así que una republicación (research nuevo, reintento del orquestador) volvía a mandar el body sin `image` y la foto subida se perdía sin error ni log. Arreglado con `preservarImagenes()` (`web-builder/src/storyblok/content.ts`): antes de cada `PUT` de update, `conImagenesPreservadas()` (`storyblok-publisher.ts`) lee la story existente con `fromStoryblokContent` y copia la imagen de hero/sección que el nuevo contenido no trae (matcheando por `heading`, misma identidad que ya usan los `_uid` deterministas); si la lectura previa falla, se publica igual sin fusionar — no bloquea. 4 tests nuevos (`content.test.ts`, `publisher.test.ts`), rojo→verde→mutación (2 mutaciones: desactivar la fusión en `updateStory`, y matchear la sección sin `heading` — cada una tumba exactamente su test) |
| **Sin tests de integración** del camino live | — | DataForSEO, OpenAI y Storyblok se ejercitaron a mano |
| ~~`env:sync` avisa de 4 claves «sin destino» y no distingue~~ | `scripts/` | **Resuelto 2026-08-18.** `clasificarSobrantes()` nueva en `env-sync.mts` separa `SUPABASE_JWT_SECRET` del resto con su propio aviso (⚠️, no el genérico): sigue siendo un riesgo real —puede acuñar un `service_role` que bypassea RLS— hasta que se revoque en Supabase, y no se puede revocar todavía porque el portal firma su `apikey` de login con el mismo secreto (`12-credenciales.md`). Las otras claves sin destino no se identificaron una por una (viven en `docs/private/`, fuera de mi alcance de lectura); quedan en el aviso genérico sin distinguir |
| ~~El CLI de despliegue **no dice en qué punto falló**~~ | `db/src/cli/` | **Resuelto 2026-08-21.** La fase de preparación de `migrarConRegistro` (`db/src/deploy.ts`: `asegurarAuthStandIn` + `create schema`/`create table` del registro + el `select` inicial, todo ANTES del bucle) ahora va en su propio try/catch que re-lanza con `"Falló preparando el registro de migraciones, antes de aplicar ninguna: …"`, conservando el mensaje original del driver. Antes salía crudo, indistinguible de un fallo dentro de una migración (que ya venía envuelto con el nombre del archivo). Test rojo→verde en `deploy.test.ts` con una `ConexionReservada` cuyo primer `query` explota; verificado por mutación (sacar el try/catch tumba exactamente ese test) |
| La **sonda del modo del SDK está duplicada** | `api/`, `orchestrator/` | Los dos chequeos son equivalentes hoy y nada los mantiene sincronizados. Unificar no es trivial: el único paquete compartido es `contrato/`, que solo depende de `zod` |
| ~~🔴 `PIPELINE_MODO` solo se contrasta contra **DataForSEO**~~ **Resuelto (2026-08-18)** | `orchestrator/` | `verificarPublicacion()` en `orchestrator/src/config.ts` exige, cuando `PIPELINE_MODO=live`, que `modoPublicacion()` (de `web-builder`) sea `"live"` o `"dry-run"` — nunca `"mock"` — en los dos entornos, igual que `verificarCoherencia`. `dry-run` no aborta (reporta `published: false` con honestidad); el DEFAULT sin `WEB_PUBLISH_MODE` sí (es `mock` y miente). La función se inyecta como parámetro (`obtenerModoPublicacion`) en vez de importarse en `config.ts`, para no arrastrar el `import "dotenv/config"` de `web-builder` a los tests del orquestador. `server.ts` la conecta con el `modoPublicacion` que ya importaba para `/_health`. Tests en `config.test.ts` (seis nuevos, § "PIPELINE_MODO x publicación") |
| ~~`cartera-portal.test.ts` dejó de cubrir `intencion`~~ | `db/` | **Resuelto 2026-08-21.** El test comparaba el mock contra `PAGINAS_DEMO` (la fuente en TypeScript, español), no contra la fila real de `kr_pages` (inglés desde la `0017`) — dos eslabones que dicen lo mismo salvo en `intencion`, así que la deriva quedaba invisible. Ahora siembra con `sembrarDemo` y lee la fila bajo RLS (`asUser`, rol staff) para los 9 campos comparados; los nombres de columna no coinciden 1:1 con los del mock (`url_slug`↔`slug`, `opportunity_score`↔`score`, `score_confidence`↔`confianza`), mapeados explícitamente. Verificado por mutación: forzar `intencion: "transactional"` en `aPaginaPropuesta` (valor válido del contrato pero equivocado) tumba exactamente el test de comparación, señalando la página y el campo |
| ~~Deriva del portal por la `0017`~~ (cerrada, 2026-08-21) | `portal/` | `cartera-mock.ts` ya generaba `page_strategy: 'hub'/'spoke'` e `intencion` en español, y `paginaMuestra()` además colaba `tipo: 'comercial'` (vocabulario ajeno) — los tres son valores que la base ya no puede contener desde la `0017`. Se tradujo todo al vocabulario del contrato (`hub_spoke`/`single`, `commercial`/`navigational`/`informational`/`local`/`transactional`, y se corrigió también el typo preexistente `evidencia: 'sin_datos'` → `'sin_validar'`, que ya violaba el check aunque nadie lo hubiera notado). `cartera-tabla.ts:29` ahora pasa `p.intencion` por `etiquetaIntencion()` (`core/intencion-labels.ts`, nuevo, mismo patrón que `menu-taxonomia.ts`) en vez de pintarlo crudo. Confirmado en `/cartera` con el navegador, tema claro y oscuro. La fila de `cartera-portal.test.ts` de arriba sigue abierta — es del lado `db/` |
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
7. **D** cuando Juan quiera gastar; ~~F cuando haya sesión de diseño~~ — ✅ la sesión pasó y la fase 1
   de **F** ya está completa (2026-08-15); **G** y **H** antes de un SLA o de firmar una baja.
