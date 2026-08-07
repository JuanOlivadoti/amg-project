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
| **A** | Fiabilidad del despliegue | Operar sin sustos | — |
| **B** | Deuda de producto ya decidida | — | ya tomadas |
| **C** | Aprobar → publicar, ejercitado | Cerrar el circuito entero | modo de publicación |
| **D** | Calibrar el research (KR-1) | La calidad del módulo 2 | **gasta ~$0.31** |
| **E** | El aspecto de las webs | Vender el módulo 1 | diseño |
| **F** | Módulo 3 — reseñas de Google | Completar el alcance base | alcance |
| **G** | Lo que ADR-19 dejó a medias | Un SLA | infraestructura |
| **H** | Offboarding y OBS-04 | Firmar ADR-11 | comercial |
| **I** | Deuda menor, sin bloqueo | — | — |

---

## Bloque A — fiabilidad del despliegue

**Por qué primero.** El 2026-08-07, entre desplegar el orquestador y verlo funcionar, hubo **hora y
media de fallos y ninguno fue del código**. Todo lo de este bloque sale de ahí, y su valor no es
teórico: es el tiempo que costó, medido.

### A1. `/_health` del orquestador tiene que decir la verdad sobre Postgres

**El problema.** Responde `{"ok":true}` con la base inalcanzable. Está escrito así a propósito —para
que el health check no dependa de terceros— pero **para el orquestador la base no es un tercero: es
todo lo que hace**. Es la segunda vez en el mismo día que un health check declara sano un servicio
inservible (la primera fue el 401 de la firma de Inngest).

**Qué hacer.** `/_health` comprueba la base **sin volverse frágil**: un `select 1` con timeout corto,
cacheado unos segundos para que un chequeo no abra una conexión por request.

**La trampa, y hay que decidirla explícitamente:** si `/_health` devuelve un código de error, Railway
considera el deploy enfermo y lo **reinicia o lo revierte** — y volveríamos a tener el servicio caído
por otra puerta, que es exactamente el error del tramo A ("fallar ancho no es fallar ruidoso"). La
propuesta es **200 con un campo `degradado`** que nombre lo que no responde, no un 503.

- **Archivos:** `orchestrator/src/app.ts`, `orchestrator/src/config.ts`, sus tests.
- **Verificación:** un test que, con la base caída, exige **200** y `degradado` no vacío; y otro que
  con la base sana exige el campo ausente. Mutación: quitar la comprobación deja el primero rojo.
- **Coste:** pieza chica, un solo paquete.

### A2. Un run no puede quedarse en `running` para siempre

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

- **Archivos:** `orchestrator/src/functions.ts`, `db/src/store.ts` (el barrido), migración si hace
  falta un índice por `(status, created_at)`.
- **Verificación:** un test que siembre un run `running` viejo y exija que el barrido lo marque; y
  **la mutación que importa**: que un run reciente **no** se toque.
- **Coste:** pieza mediana. Cruza `orchestrator/` y `db/`, así que el contrato se fija antes.

### A3. Verificar el DESPLIEGUE, no solo la fuente

**El problema.** `npm run probar-dsn` verifica el DSN de `docs/private/credenciales.env` — la fuente
de verdad — y **no** lo que tiene el proceso desplegado. El 2026-08-07 dio verde mientras Railway
tenía `@base:` de host. La herramienta no está mal; su nombre promete más de lo que mide.

Y el problema de fondo es mayor: **`env:sync` reparte a los `.env` locales y producción se sigue
editando a mano**, sin validación, sin aviso y con el fallo apareciendo minutos después en el arranque.
Tres servicios rotos en una hora salieron de ahí.

**Qué hacer.** Un comando que **compare** la fuente con lo que tiene cada servicio y diga qué falta,
qué sobra y qué difiere — sin imprimir valores, solo nombres y un hash corto. Requiere la API de
Railway (token de solo lectura).

- **Archivos:** `scripts/` (nuevo), su test, `docs/proyecto/12-credenciales.md`.
- **Verificación:** el test compara mapas de claves, no valores. Control positivo obligatorio: si la
  lectura del servicio devuelve vacío, tiene que **fallar**, no reportar "todo bien".
- **Coste:** pieza chica + una credencial nueva de Railway (de solo lectura).

### A4. Cerrar la deuda del `MAPA` y los `.env.example`

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

### B1. El entregable sin páginas aprobadas

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

### B2. `renderReport` pasa de flags a audiencia

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

**Antes de tocarlo hay que mirar `WEB_PUBLISH_MODE`** en el servicio del orquestador: en `dry-run` el
publisher reporta `published: false` y no escribe nada — que es como se prueba sin consecuencias.

**El orden:**

1. Comprobar el modo. Si no es `dry-run`, decidir explícitamente antes de seguir.
2. Lanzar un research en mock, aprobar **una** página, aprobar el run.
3. Comprobar que el workflow **despierta** (Inngest → Runs) y que el publisher reporta lo que debe.
4. Recién entonces, si se quiere, repetir con publicación real y verificar la web servida.

**Lo que este paso puede destapar, y por eso se hace aparte:** el brief que el orquestador reconstruye
desde la base pasa por `parseBrief` antes de publicar. Ese camino se arregló el 2026-08-07 (migración
`0017` + re-seed) pero **nunca se ejecutó de verdad** — se verificó que el dato ahora es válido, no que
la publicación funcione con él.

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

El dataset ya no se pierde: desde el 2026-08-02 va a `datasets/`, con un test que se lo pregunta a
`git check-ignore`.

---

## Bloque E — el aspecto de las webs

**Es lo más grande que queda del alcance base, y es lo que se ve.** Lo hecho es la **infraestructura
de marca** (tema por tenant, imágenes editables, navegación, footer, `/menu`, `/blog`, home
sintetizada), no el aspecto: las landings publicadas se ven **sin terminar** — ni una foto, un CTA que
es un párrafo, siete secciones idénticas.

Hay tres piezas, con spec escrita y **sin empezar**:

1. **Plantillas de landing** — [spec](../superpowers/specs/2026-08-01-plantillas-landings-design.md),
   migración `0014` (**reservada**, no escrita), tres entregas.
2. **Manual de marca** — tokens de color y roles tipográficos self-hosted, en vez de los tres campos
   actuales de `business_profile.brand`.
3. **Rediseño de la carta** — categorías con foto, precios por ración.

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
| `PIPELINE_MODO` solo se contrasta contra **DataForSEO** | `orchestrator/` | Deliberado: la prosa mock se lee como mock y el publisher en dry-run lo reporta. Cerrarlo haría `LLM_PROVIDER` obligatoria en `live` |
| `cartera-portal.test.ts` dejó de cubrir `intencion` | `db/` | Ata el mock contra `PAGINAS_DEMO` (español), no contra la fila (inglés desde la `0017`). Cerrarlo cruza `db/` y `portal/` |
| Deriva del portal por la `0017` | `portal/` | `cartera-mock.ts:147` genera `page_strategy: 'hub'/'spoke'`, valores que **la base ya no puede contener**; y `cartera-tabla.ts:29` pinta `{{ p.intencion }}` crudo |

---

## Riesgo abierto — las credenciales expuestas

`docs/private.zip` estuvo commiteado en este repositorio **público** desde el 2026-08-01. Se sacó del
índice y el `.gitignore` quedó blindado, pero **el objeto sigue en el historial de GitHub**: purgar no
des-expone, lo que devuelve la seguridad es **rotar**.

**Pospuesto por decisión de Juan el 2026-08-04.** Sigue abierto, no cerrado. La lista priorizada vive
fuera del repo (`docs/private/rotacion-credenciales.md`).

---

## El orden que recomiendo, y por qué

1. **A1 + A2** — fiabilidad. Son las dos que ya nos costaron tiempo real y las dos que hacen que un
   fallo se vea en vez de esconderse. Chicas, sin decisiones pendientes.
2. **B1 + B2** — deuda decidida. Cierra lo que quedó a medias del entregable, que es lo último que se
   construyó y lo que la agencia le manda al cliente.
3. **C** — aprobar → publicar en `dry-run`. Deja el circuito **entero** ejercitado, que es la
   diferencia entre "Fase 2 desplegada" y "Fase 2 probada".
4. **A3 + A4** — las herramientas de credenciales, cuando el permiso esté abierto.
5. **E** — el aspecto de las webs. Es lo más grande y lo que más cambia lo que se puede vender, pero
   necesita decisiones de diseño y tiene su propia spec.
6. **D** cuando Juan quiera gastar; **F** cuando haya sesión de diseño; **G** y **H** antes de un SLA
   o de firmar una baja.
