# 9. Estado y roadmap

## Resumen ejecutivo

> Actualizado 2026-07-30: **pieza A cerrada** (el login **funciona en `bigballs.es`**, verificado en
> el navegador por Juan — lo único que podía cerrarla, porque desde afuera no había señal que
> distinguiera el código viejo del nuevo) y **pieza B construida y verificada en el navegador**: el
> portal tiene modo oscuro por tokens semánticos. **Sin mergear a `main` todavía**, a pedido.
>
> **Acción 06 (corrida final) cerrada el mismo día**: research real contra producción para **La
> Birra Bar** (14 páginas, $0.3097), republicado en Storyblok con `kr.v0.5` y verificado en el
> navegador. Midió por primera vez cuánto tarda un research real —**16m15s**, por encima del umbral
> de ~12 min que la pieza D necesitaba para mostrarse en vivo en la demo— así que **la pieza D queda
> desaconsejada tal como se la había imaginado** (ver §2 más abajo).

**La cadena completa está construida, de punta a punta y sin huecos:**

```
  prompt  →  research (M2)  →  persistencia bajo RLS  →  COMPUERTA HUMANA  →
          →  contenido (M1)  →  publicación en Storyblok  →  web servida en vivo
```

Todo lo que depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido
on-page, prose final). Todo lo que depende de aislamiento entre clientes lo impone **Postgres**, no
el código de la aplicación. Y las tres interfaces por las que pasa un humano —la API, el portal y la
web pública del cliente— **existen y se manejaron en un navegador real**.

**Fase 1 está desplegada** (2026-07-25): el portal en [`bigballs.es`](https://bigballs.es)
(Hostinger, autodeploy desde `main`), la API en `api.bigballs.es` (Railway, `europe-west4`) y la base
con RLS forzada en Supabase (`eu-west-2`).

> ### ✅ El login estaba roto; la pieza A lo arregló y **está verificado en producción**
>
> C.8 —manejar la app en el navegador— destapó lo que la verificación desde afuera no podía ver: todo
> login terminaba en `401 Token inválido o expirado`. **El proyecto de Supabase firma con `ES256`**
> (se creó el 2026-07-25, ya con claves asimétricas) y la API solo aceptaba `HS256` con un secreto
> compartido. No era un error de despliegue: era deuda de contexto en el código.
>
> Es la lección de siempre, otra vez: **verificar desde afuera y manejar la app encuentran cosas
> distintas.** `/health` daba 200, el CORS aceptaba solo el portal, el `401` sin token era correcto —
> y aun así nada funcionaba para un usuario real.
>
> **Cerrado el 2026-07-30: Juan se logueó en `bigballs.es`.** Y hasta ese momento no estaba cerrado, a
> propósito: entre el merge (2026-07-27) y ese login hubo tres días en que el código correcto ya
> estaba desplegado y el estado seguía siendo 🟡, porque *20/20 chequeos de `/health` en 200* prueban
> que `emisorSupabase` aceptó la variable de entorno y **nada más**. `/health` responde igual con el
> código viejo, y un token basura da 401 con los dos. **No había ninguna señal externa que
> distinguiera "arreglado" de "roto"** — solo entrar y loguearse.

Lo de Fase 2 —orquestador y renderizador— **no está desplegado** todavía.

| | |
|---|---|
| **Paquetes** | 6 workspaces (`db`, `kr-service`, `web-builder`, `orchestrator`, `api`, `renderer`) + `portal/` (Angular, fuera del monorepo a propósito) |
| **Tests** | **516** en el monorepo + **87** en el portal. Los de seguridad, contra Postgres real |
| **Migraciones** | 10 (`0001`..`0010`) |
| **ADRs** | 23, más 3 observaciones (**las 3 cerradas**) |
| **Reviews externas** | 12 rondas (Codex), 18 tandas de correcciones |
| **Corre sin credenciales** | Sí — providers mock + PGlite en memoria |

## Qué funciona hoy

| | |
|---|---|
| ✅ | Pipeline M2 completo: prompt → brief SEO validado + informe legible. |
| ✅ | Pipeline M1 completo: brief → stories Storyblok + preview HTML con JSON-LD válido. |
| ✅ | Providers abstractos: todo corre **sin credenciales** en modo mock. |
| ✅ | Compuerta de aprobación humana (global + por página), **operable desde el portal** — ya no se edita un JSON a mano. |
| ✅ | **API REST autenticada** (Hono): JWT verificado, RLS decide, comandos compuestos (fila primero, evento después). |
| ✅ | **Portal Angular**: login, lista de research, brief **separado por evidencia**, compuerta doble, refresh de token. |
| ✅ | **La web del cliente se sirve en vivo** (`renderer/`): 1 servicio, N dominios, con preview firmado para el Visual Editor. |
| ✅ | **Research real contra DataForSEO producción**: 52 keywords → 8 páginas, **$0.31 por research**. |
| ✅ | **8 páginas publicadas en vivo en Storyblok**, con contenido redactado por IA. |
| ✅ | JSON-LD validado en el Rich Results Test de Google (`LocalBusiness` + `FAQPage`, sin errores). |
| ✅ | **Costo completo del research** (DataForSEO + LLM) con desglose, y **presupuesto preflight** que aborta antes de gastar. |
| ✅ | **Resiliencia**: timeouts, reintentos con backoff y `Retry-After` — **probados contra un 429 real de Storyblok**. |
| ✅ | **Idempotencia**: republicar produce los mismos `story:` IDs, cero duplicados. Verificado en vivo. |
| ✅ | **516 tests en verde** + typecheck limpio en los 6 paquetes. Los de seguridad, contra Postgres real. |
| ✅ | **Navegación fija del sitio del cliente**: barra de 4 secciones (Inicio/Menú/Ubicaciones/Contacto, condicionales), footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. Datos reales de **La Birra Bar** cargados (dos locales, carta). Verificado en el navegador. |
| ✅ | **Diez reviews externas (Codex): todos los hallazgos, corregidos.** Varias de las brechas eran suposiciones MÍAS que Postgres no cumplía, o afirmaciones de seguridad **falsas** que documenté y el código desmentía. Las tres últimas cazaron cosas que yo había declarado hechas: el CLI de producción sin registro de idempotencia, un verificador de JWT que **ningún test tocaba**, y carreras asincrónicas en el portal. Ver [ADR-13..22 y el registro de correcciones](../decisiones-arquitectura.md). |

## El número para la propuesta comercial

> ### Un research completo cuesta **~$0.31**
> 52 keywords analizadas → 8 páginas con contenido on-page. Estable en tres corridas.

| Proveedor | Coste | % |
|---|---|---|
| **DataForSEO** | $0.2522 | **81%** |
| LLM (generación) | $0.0586 | 19% |
| LLM (embeddings) | $0.0000 | ~0% |

El costo marginal de un research es de **centavos**: lo que se le cobre al cliente no está limitado
por el costo de la API, sino por el valor del entregable.

## Lo que la corrida real destapó

El sandbox devuelve datos ficticios, y eso **ocultaba tres bugs** que solo aparecieron con datos de
verdad. Encontrarlos era exactamente el punto de correr en producción. **Los tres están corregidos**
([detalle](../acciones/03-research-produccion-dataforseo.md)):

1. **Se le decía al cliente "0 búsquedas/mes" donde no teníamos el dato.** DataForSEO devuelve
   `null` (le pasó en 41 de 60 keywords en KD) y el código lo coaccionaba a `0`. Ahora se propaga
   como `null` y el informe muestra **`n/d`** → esquema **`kr.v0.4`**.
2. **Se pagaban keywords duplicadas.** `"pasta fresca Madrid"` y `"pasta fresca madrid"` iban como
   dos, y a DataForSEO se le paga por keyword. Ahora hay dedupe canónico.
3. **El clustering colapsaba el sitio entero en 3 páginas.** Con coseno ≥ 0.55, 41 de 45 keywords
   caían en un cluster. Recalibrado a **0.75** con el dataset real: **8 páginas**, cada una sobre un
   servicio real del negocio.

> El dataset crudo ahora se persiste en `out/keywords.json`. Antes se tiraba: se pagaba por datos
> que no sobrevivían al proceso, y cualquier ajuste de scoring obligaba a pagar otra corrida.
> Ahora el tuning es **offline y gratis**.

---

## Lo que queda por delante

*Ordenado por lo que realmente bloquea. Lo de arriba impide vender; lo de abajo, no.*

### ✅ 1. El despliegue (etapa 5.3) — **COMPLETO (2026-07-25)**

**Fase 1 está en producción.** Ya no bloquea nada.

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Portal | `https://bigballs.es` — Hostinger, autodeploy desde `main` | ✅ |
| API | `https://api.bigballs.es` — Railway, `europe-west4` | ✅ |
| Base + login | Supabase `eu-west-2` (Londres) | ✅ |

Runbook paso a paso, con los tropiezos reales, en
[13-runbook-despliegue.md](13-runbook-despliegue.md).

**Lo verificado en producción** (no "el deploy dio verde", sino comprobado desde afuera):

- **C.1 — las 9 migraciones**, verificadas por **introspección de la base**: 9 tablas con RLS
  **forzada** (`relforcerowsecurity`), `clients.business_profile_publico` como columna generada (la
  allowlist de ADR-19 vive en la base), runner idempotente confirmado con una segunda corrida.
- **C.2 — los 4 logins con contraseña** y los 4 **conectando de verdad** por el pooler, con
  `INHERIT=false` intacto tras el `alter role` (ADR-17 sigue en pie).
- **C.4 — seed verificado**: 2 `memberships` con `user_id` distintos, Frank `maestro` / Juan
  `equipo`, 1 run y 8 páginas, `business_profile_publico` poblado.
- **C.5 — la API**: `/health` 200, **TLS válido**, CORS que **acepta** `bigballs.es` y `www.` y
  **rechaza** cualquier otro origen, y `401` sin token en `/runs` y `/clients`.
- **C.6 — el portal**: 200 con TLS, redirect 301 de http a https, y las rutas profundas (`/runs`,
  `/login`, `/runs/abc123`) devolviendo el `index.html` — el fallback de SPA funciona. El bundle
  servido contiene `api.bigballs.es` y el ref de Supabase, y **cero `localhost`**: es el build de
  producción, no uno de desarrollo disfrazado.
- **C.7 — DNS**: CNAME y TXT de verificación propagados, custom domain *verified* en Railway.

**Credenciales centralizadas**: una fuente privada única + `npm run env:sync` reparte a cada paquete
solo sus claves, con la separación impuesta por tests (ver `scripts/env-sync.mts`).

**C.8 —la verificación de punta a punta en el navegador— se hizo, y encontró lo que todo lo anterior
no podía ver: ningún login funcionaba.** Los siete puntos de arriba seguían siendo ciertos:
comprueban que la infraestructura está bien, no que el producto sirva. Es exactamente el hueco que
C.8 existe para cubrir. **Arreglado por la pieza A y verificado el 2026-07-30** (ver el recuadro del
resumen): el login funciona.

Son **tres procesos** de larga duración más una SPA estática (el orquestador y el renderizador son
de Fase 2 y **aún no están desplegados**):

| Qué | Puerto dev | Necesita |
|---|---|---|
| `api/` | 3000 | `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS` |
| `orchestrator/` | — | `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, Inngest |
| `renderer/` | 8080 | `DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`, `PREVIEW_SECRET` |
| `portal/` | 4200 | estático, se compila con AOT |

La restricción que queda viva es del **renderizador** (Fase 2, aún sin desplegar): necesita **DNS por
cliente apuntando al mismo servicio** (es un `Host` → dominio → space), más certificados TLS por
dominio. Eso descarta cualquier hosting que no permita dominios personalizados arbitrarios, y hace
que "una CDN delante" deje de ser opcional (ver §3). Railway sí admite dominios personalizados, así
que la elección de Fase 1 no cierra esa puerta.

### 🟡 2. La demo con Frank — cuatro piezas, la A **ya no bloquea** a las demás

De la sesión de diseño sobre la demo salió un recorrido de tres golpes: **dashboard** (panorama de
cartera + economía), **entrar a un cliente** (la compuerta humana, que no se cuenta: se ve) y
**entrar a una página** (la evidencia ✅/⚠️). Los pasos 2 y 3 **ya existen**; solo se construye el 1.

La objeción que mata esta venta no es el precio: es *"si esto publica una barbaridad en el sitio de
mi cliente, pierdo al cliente"*. Por eso el rigor y la compuerta **no compiten** con velocidad y
panorama — son lo que las hace creíbles.

| # | Pieza | Estado | Depende de |
| --- | --- | --- | --- |
| **A** | **Verificación JWT ES256 + logout que revoca** | ✅ **Cerrada** — mergeada, desplegada y el login **verificado en el navegador** (2026-07-30) | — |
| **B** | Modo oscuro (**solo el portal**) | ✅ **Cerrada** — mergeada a `main` y migrada además a Tailwind v4 | — |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | ✅ **Cerrada** — esqueleto UI + shell + `/cartera` sobre datos de muestra, mergeada a `main` (2026-07-31) | B (hereda los tokens) ✅ |
| **D** | Research en vivo (desplegar el orquestador) | ⚪ Sin empezar, **y condicionado** | la medición |

**Pieza A** ([spec](../superpowers/specs/2026-07-26-verificacion-jwt-es256-design.md) ·
[plan](../superpowers/plans/2026-07-26-verificacion-jwt-es256.md)): 4 tareas, **las 4 hechas** en la
rama.

| Tarea | Estado |
| --- | --- |
| 1 — El verificador exige ES256 contra el JWKS y distingue "no pude comprobar" (503) | ✅ Hecha (`9706bec`) |
| 2 — El contrato de variables pierde el secreto | ✅ Hecha (`2630878`) |
| 3 — El logout revoca en Supabase, sin bloquear la UI ni pisar sesiones nuevas | ✅ Hecha (`c0ead5b`, `9f57376`) |
| 4 — Documentación, credenciales y despliegue | ✅ Hecha (revisión final, esta misma pieza) |

**Nada queda pendiente de la pieza A.** El despliegue se ejecutó (`SUPABASE_JWT_ISS` en Railway,
merge a `main`) y el login se verificó en el navegador. `SUPABASE_JWT_SECRET` **se deja** en Railway a
propósito, como red de rollback: `leerConfig` ya no la lee, y el código viejo la exige para arrancar.
Ver [13-runbook-despliegue.md § Actualizar una instalación ya desplegada](13-runbook-despliegue.md#actualizar-una-instalación-ya-desplegada).

**B — modo oscuro:** solo el portal; el renderizador queda afuera a propósito (la web pública es la
marca del restaurante). Va por **tokens semánticos**, no por variantes `dark:`, para que la pieza C
herede el tema por construcción en vez de tener que acordarse
([spec](../superpowers/specs/2026-07-30-modo-oscuro-portal-design.md) ·
[plan](../superpowers/plans/2026-07-30-modo-oscuro-portal.md)).

> **Lo que la hace exigible, y no un acuerdo de buena voluntad.** 21 tests nuevos (66 → 87). El
> contraste WCAG AA de los **17 pares × 2 temas** se lee de `styles.css`, no de una copia. Tras la
> migración a Tailwind v4 (que borró `tailwind.config.js`), el triángulo quedó en dos archivos:
> `TOKENS` (en `contraste.ts`) y `styles.css`, y este último es internamente consistente entre
> `:root`/`.oscuro` y el bloque `@theme inline` que Tailwind usa para emitir las utilidades — un test
> ata los nombres de los tres lados y otro verifica que cada `--color-X` de `@theme inline` apunte a
> `--X`, no solo que exista: borrar o desapuntar un token ahí dejaba `text-respaldo` sin emitir (el
> título ✅ en gris) con toda la suite en verde. Y un test recorre `src/app` y **falla si una
> plantilla incrusta un color o usa la paleta cruda** — descubre los archivos en vez de listarlos, así
> que también cubre las pantallas que la pieza C todavía no escribió.
>
> **Lo que solo apareció manejando la app** (cuatro cosas que ningún test veía): el `☀` se pintaba
> como emoji naranja y no seguía al tema; el `placeholder` de todo input estaba clavado por el
> preflight de Tailwind (`color-mix(in oklab, currentcolor 50%, transparent)` en v4) por debajo del
> 4.5:1 de AA en claro; poner la barra siempre visible dejó el login con 44 px de scroll; y el botón
> del tema tenía la mitad del área táctil que pide WCAG. Las cuatro, corregidas.

**C — el dashboard:** los datos para poblarlo **ya existen y están sin explotar** — cada página trae
`volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `local`, `cluster_id`
y `evidencia`; cada run trae `coste_micros_usd` y `calidad_datos`. Se puede construir **sin tocar la
API**: la pantalla arranca con datos de muestra (misma forma que los DTOs reales), no contra un
endpoint agregado nuevo — eso queda para más adelante, como trabajo de backend separado.

**Cerrada (2026-07-31).** Se trajo el esqueleto de layout (sidebar + header + backdrop) y una
librería chica de componentes del `dashboard-project` (TailAdmin) de referencia, adaptados a los
tokens semánticos de la pieza B — no una librería genérica sin uso, solo lo que `/cartera` necesita
([spec](../superpowers/specs/2026-07-30-dashboard-ui-portal-design.md) ·
[plan de Tailwind v4](../superpowers/plans/2026-07-30-tailwind-v4-migracion-portal.md), cerrado y
mergeado ·
[plan del shell + dashboard](../superpowers/plans/2026-07-30-dashboard-ui-portal.md), 13/13 tasks,
review final de rama aplicado). Las dos ramas (`feat/modo-oscuro-portal` y `feat/dashboard-ui-portal`)
están mergeadas a `main` (`d670c23`). 103 tests `node:test` + 17 Karma + build de producción, todo en
verde tras el merge. El detalle task-by-task, con SHAs y resultado de cada review, vive en
`.superpowers/sdd/progress.md`.

Pendiente real, sin bloquear el cierre: la verificación manual en navegador de `/cartera` y del
drawer mobile todavía no se hizo (el MCP de chrome-devtools no conectó durante toda la sesión de
implementación) — conviene un vistazo rápido la próxima vez que alguien abra el portal.

**D — research en vivo:** el orquestador **ya está construido** (Inngest, `workflow.ts`,
`functions.ts`, 18 tests). Falta desplegarlo y conectarlo, no escribirlo.

> ### ✅ Medido (2026-07-30): **16 min 15 s**, contra el corte de ~12 minutos que mataba la demo
>
> Corrida real contra producción (La Birra Bar, 55 keywords → 14 páginas, $0.3097): **16m15s** de
> punta a punta (`spike.ts`, sin el publish). Eso está **por encima** del umbral de ~12 minutos que
> este mismo documento fijaba como el punto en que "Frank mira un spinner y la demo se muere ahí".
> Parte del tiempo se fue en 3 tareas SERP que agotaron 60 sondeos de `task_get` cada una antes de
> registrarse como recuperables (ver ADR-14) — el research **no abortó ni cobró de más** por eso,
> pero sí sumó minutos.
>
> **Decisión que esto implica para la pieza D:** con este dato, mostrar el research **en vivo**
> durante la demo con Frank es un riesgo alto de que la demo se estanque mirando un spinner. La
> alternativa más segura es **correrlo antes** (como se hizo acá) y mostrar el resultado ya
> publicado — que es exactamente lo que dejó lista la Acción 06. Pieza D, tal como se imaginó
> originalmente (lanzar el research delante de Frank), queda **desaconsejada** hasta que haya una
> optimización real de la duración (paralelizar más las tareas SERP, o mostrar progreso incremental
> en vez de esperar el brief completo).

Aparte de las cuatro piezas:

- ✅ **[Corrida final + republicar](../acciones/06-corrida-final-demo.md)** — **hecha (2026-07-30)**,
  $0.3097. Publicado en Storyblok con `kr.v0.5`: 14 páginas de **La Birra Bar** (cliente real de la
  agencia, reemplazó al caso de ejemplo "Bella Napoli" en el mismo space), verificado en el
  navegador — evidencia separada (8 respaldadas / 6 sin validar), JSON-LD correcto por tipo de
  página (`LocalBusiness` solo donde corresponde, `Article` en los blogs), marca consistente. De
  paso se encontró y cerró un hueco real: `npm run spike` en producción exige `DATABASE_URL_CACHE`
  desde ADR-14 y la guía no lo pedía — corregido en la guía y en `scripts/env-sync.mts` /
  `kr-service/.env.example`. Detalle completo en la guía. Lo publicado en Storyblok **ya no es
  anterior a `kr.v0.5`**: ahora sí muestra la evidencia etiquetada, que es *el argumento de venta*.
- ✅ ~~Unificar el alcance (OBS-01)~~ — **hecho** (2026-07-19): manda `contexto-proyecto-frank.md`,
  alcance base = 3 módulos, ADR-04 se mantiene. Era la última observación abierta del proyecto.

### 🟡 3. Lo que ADR-19 dejó a medias y hay que cerrar antes de un SLA

- **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
  **en proceso**. El borde es una decisión de despliegue.
- **Más de una instancia rompe la invalidación.** El webhook llega a UNA sola; las demás sirven
  contenido viejo hasta que venza el TTL. Con una instancia no pasa. Antes de escalar: cache
  compartida, o bajar el TTL a sabiendas.
- **Es un punto único de disponibilidad.** Si el renderizador se cae, **se caen todas las webs de
  cliente a la vez**. Ya está mitigado (health check que no toca dependencias, timeout de 5 s, 503
  que no se cachea), pero el modo de fallo existe y un sitio estático no lo tenía.

### 🟢 4. Deuda conocida, ninguna bloqueante

- **Tests de componente del portal** (karma). El núcleo está cubierto (87 tests) y los componentes se
  verifican compilando con AOT y a mano. Es evidencia de que funciona hoy, **no una red contra
  regresiones**.
- **El polling del brief (4 s) es a ojo**, y la lista de runs no pollea. Se calibra con la duración
  real de una corrida.
- **ADR-11 (offboarding) sigue sin poder firmarse.** Ahora *hay* qué entregar (el space + el
  renderizador), pero falta **verificar el snapshot estático como entregable** y ponerle precio a la
  "salida gestionada". Es redacción comercial, no código.
- **Esquema Zod duplicado** entre M2 y M1: dos fuentes de verdad del contrato.
- **Sin tests de integración**: el camino live se ejecutó a mano contra DataForSEO, OpenAI y
  Storyblok, pero no está automatizado.
- **Calidad del research**: `is_local` se dispara de más (53 de 60 keywords) y `score_confidence` se
  calcula pero **no se usa** para priorizar. Detalle en la tabla de mejoras, más abajo.

### ⚪ 5. Lo que ni siquiera empezó

El PRD describe cuatro módulos. **Están hechos el 1 y el 2** (Creador de Webs y Keyword Research).
Los otros —tablero tipo Trello, mensajería, dashboards, los agentes de contenido social— no tienen
ni una línea. Con OBS-01 cerrada, eso ya no es una incógnita sino una decisión: el **módulo 3** (respondedor de reseñas de Google) es lo único del alcance base sin construir; el calendario de redes y el gestor de tareas quedaron en **línea futura**, fuera del presupuesto inicial.

---

## Roadmap

### 🔴 Lo que depende de Juan

**Todo lo que dependía de cuentas, saldo y credenciales está hecho.** Las cuatro se cerraron:

| Tarea | Por qué | Costo |
|---|---|---|
| ~~Unificar el alcance (OBS-01)~~ | ✅ **Hecha (2026-07-19).** Manda ; alcance base = 3 módulos; ADR-04 se mantiene. | — |
| ~~`SUPABASE_JWT_ISS` en Railway~~ | ✅ **Hecha (2026-07-27).** Cargada antes del merge; la API arrancó con ella. `SUPABASE_JWT_SECRET` se **deja** en Railway a propósito: es la red de rollback (el código viejo la exige para arrancar) y no molesta, porque `leerConfig` ya no la lee. | — |
| ~~Verificar el login en el navegador~~ | ✅ **Hecha (2026-07-30).** Era lo único que podía cerrar la pieza A. Queda **sin verificar** el detalle del logout: que revoca en Supabase (Auth → Users → Sessions) y que es **local** (cerrar sesión en un dispositivo no cierra la del otro). Lo cubren 7 tests, pero no se miró en producción. | — |
| ~~**[Corrida final + republicar](../acciones/06-corrida-final-demo.md)**~~ | ✅ **Hecha (2026-07-30).** Publicado `kr.v0.5` para La Birra Bar (cliente real), verificado en el navegador. De paso: se midió la duración real del research (16m15s) y se cerró el gap de `DATABASE_URL_CACHE` que la guía no pedía. | $0.3097 |

### Tanda 3 — PROD-readiness ✅ COMPLETA

| # | Hecho | Qué cambió |
|---|---|---|
| ✅ **#5** | Costo completo + presupuesto preflight | El costo suma DataForSEO + LLM (con desglose) y `max_cost_micros` **aborta antes de gastar**. Contrato `kr.v0.3`. |
| ✅ **#11** | Timeouts, retries y backoff | `lib/http.ts`: timeout por intento, backoff exponencial + jitter, `Retry-After`, 429/5xx reintentables y 4xx no. El clustering **ya no aborta** por un fallo de SERP. |
| ✅ **#12** | Idempotencia | `_uid` **deterministas** (misma página → mismos uids entre corridas) y **upsert** que resuelve la carrera de creación sin duplicar stories. |
| ✅ **#6** | `AnthropicContentGen` | Los tres proveedores implementan la misma interfaz: cambiar de proveedor ya **no degrada capacidades**. |

**Lo que queda del código está listo para envolverse en Inngest**
([ADR-03](../decisiones-arquitectura.md)): retries, idempotencia y presupuesto ya existen, que era
justo lo que un orquestador durable necesita como base. Y los tres se ejercitaron contra servicios
reales, no solo contra tests.

### Tanda 4 — Corridas reales ✅ COMPLETA

| Hecho | Qué cambió |
|---|---|
| **Métricas ausentes ya no mienten** | `volumen`/`dificultad` son nullable; el informe muestra `n/d`. Contrato `kr.v0.4`. |
| **Dedupe canónico antes de pagar** | Los duplicados de casing ya no se le facturan a DataForSEO. |
| **Clustering recalibrado (0.55 → 0.75)** | Con datos reales: 3 páginas → **8 páginas**. |
| **Dataset crudo persistido** | `out/keywords.json` → ajustar scoring/clustering es gratis, sin pagar otra corrida. |
| **Tope de gasto en el CLI** | `MAX_COST_USD=1.00 npm run spike` aborta antes de gastar. |

### Fase 2-3 — Plataforma

| Pieza | ADR | Estado |
|---|---|---|
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y **116 tests** contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`, JWT con `exp`/`aud`/`alg` impuestos. **66 tests** contra PGlite. Desde la pieza A la firma se verifica contra el **JWKS público** del emisor (ES256), sin secreto compartido, y un fallo de infraestructura responde **503** en vez de confundirse con un token inválido. |
| **Portal Angular** | ADR-16, ADR-21 | ✅ **Hecho** (funcional). Login + lista + brief por evidencia + compuerta doble + refresh del token + polling, y las carreras asincrónicas cerradas (`Vigencia`). **87 tests** de núcleo; el flujo, verificado en un navegador real. **Falta:** tests de componente y calibrar el polling con la duración real. |
| **Renderizador público** (la web del cliente) | ADR-19, ADR-04 | ✅ **Hecho.** `renderer/`: 1 servicio, N dominios. Hono, lee la Content Delivery API y sirve `renderStory()`. Cache con invalidación por webhook firmado, preview firmado + Bridge para el Visual Editor, y el rol de BD más pobre del sistema (`app_render`, sin escritura). Endurecido tras la 10ª review (límites del camino anónimo, timeouts de BD, replay). **113 tests**; **verificado contra el Storyblok REAL** con `npm run demo -w renderer`. **Falta:** desplegarlo en un dominio (5.3) y una CDN delante. |
| **Diseño de las webs** (marca + imágenes + navegación) | ADR-04, ADR-11 | ✅ **Hecho.** Tema por tenant (color/fuente/logo desde `business_profile.brand`, allowlist en `0009`) → cada web se ve **propia**. Imágenes editables en los bloks `hero`/`section` (campos `asset`). **Nav fijo de 4 secciones** (Inicio/Menú/Ubicaciones/Contacto, cada una condicionada a que el perfil tenga el dato — reemplaza a la barra vieja derivada de las páginas SEO publicadas) + **footer compartido** con NAP multi-local (`locations`) y link a Blog + `/menu`/`/blog` sintetizados desde el perfil (allowlist en `0010`, ver [spec](../superpowers/specs/2026-07-31-navegacion-sitio-cliente-design.md)) + **home sintetizada** en la raíz (la raíz ya no da 404; si el cliente crea su `home`, esa gana). Validación anti-inyección en tres capas, también en el `name`/`slug` de la nav y en NAP/carta. **Falta (deuda):** republicar desde un brief pisa las imágenes que suba el cliente — **el nav/footer/menú/blog YA NO dependen del brief**: se calculan en vivo desde `business_profile` en cada request, así que republicar no los toca. |
| **La costura publish→serve** (`fromStoryblokContent`) | ADR-19 | ✅ **Hecho.** El contenido que Storyblok guarda está **aplanado** y `renderStory` esperaba la forma anidada → daba 503. Lo cazó la demo, no un test (era OBS-03: nadie leía de vuelta lo publicado). Adaptador inverso + tests de ida-y-vuelta. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno — ahora **cuatro**: `amg_api`, `amg_orquestador`, `amg_cache` y `amg_render`. El JWT de Supabase **ya está enchufado y probado** (**27 tests** en `auth.test.ts`, con tokens firmados de verdad, ES256 contra un JWKS local). |
| **Idempotencia de peticiones facturables** | ADR-10, ADR-14 | ✅ **Hecho.** `kr_provider_tasks` + `payload_hash`, escrito ANTES de enviar: cubre el **100%** del gasto. **Además**, SERP y Search Volume (46%) usan el **método Standard** (`task_post`/`task_get`): la tarea pagada se **recupera gratis**, así que una respuesta perdida no es dinero perdido. Labs (54%) es live-only → ahí una petición ambigua detiene el run. |

### Mejoras de calidad del research (priorizadas con los datos reales)

| Mejora | Evidencia de la corrida real |
|---|---|
| **`is_local` por señales del SERP** (presencia de *map pack*) en vez de inferirlo por LLM | **53 de 60** keywords salieron `is_local` → 7 de 8 páginas como `LocalBusiness`. Algunas deberían ser `Article`. Es el que más ensucia el JSON-LD. |
| **Usar `score_confidence` al ordenar páginas** | 5 de 8 páginas no tienen volumen. El 40% del score (intención + relevancia) no depende de datos de mercado, así que una keyword de la que no sabemos nada arranca en ~50 puntos. La confianza lo detecta (0.3) pero **no se usa** para priorizar. |
| **Normalizar el volumen por percentiles del mercado** en vez del máximo del run; winsorizar outliers | Con un solo pico (1300) el resto se aplasta. |
| **Estrategia hub & spoke** en el mapeo cluster→página | Hoy todo es `single`. |
| **Enlazado interno** entre las páginas propuestas | Hoy `enlazado_interno` sale vacío. |

---

## Deudas técnicas conocidas

| Deuda | Dónde | Impacto |
|---|---|---|
| **El secreto legacy de Supabase sigue vivo, y no se puede revocar sin migrar antes el portal** | Supabase (Project Settings → API) · `portal/src/environments/environment.prod.ts` | Con ese secreto se puede acuñar un token `service_role` que **bypassea RLS por completo** — el radio de daño no depende de que nuestra API ya no lo acepte. Pero **no se puede revocar sin más**: el `anon key` del portal es un JWT legacy firmado con él (`alg: HS256`, verificado), así que revocarlo rompe el login. Hay que migrar el portal a las claves nuevas (*publishable*), desplegar, verificar, y recién ahí revocar. Ver [12-credenciales.md](12-credenciales.md). |
| **Esquema Zod duplicado** entre M2 y M1 | `kr-service/src/validation/` y `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. Extraer a paquete compartido. |
| **Estimaciones del presupuesto sin calibrar** | `lib/budget.ts` | Las **tarifas de los modelos están verificadas** ✅ y ahora **hay datos reales** para calibrar las estimaciones por fase, pero todavía **no se aplicaron**: siguen a ojo. Se calibran con `out/keywords.json`, gratis. |
| **`gpt-4o` quedó legacy** | `config.ts` (`OPENAI_MODEL`) | Los modelos actuales son 2-3× más baratos. **Pero la corrida real bajó la urgencia**: el LLM es solo el **19%** del costo, así que el ahorro total sería de ~10%. Ver [guía 02](../acciones/02-precios-modelos.md). |
| **`is_local` se dispara de más** | `pipeline/enrich-content.ts` | 53 de 60 keywords → casi todo sale `LocalBusiness`. Ensucia el JSON-LD. |
| **Sin tests de integración** | — | El camino live ya **se ejecutó a mano** contra DataForSEO, OpenAI y Storyblok, pero no está **automatizado**. |
| **Una rotación de Supabase a otro algoritmo daría 401, no 503** | `api/src/auth.ts` (`CODIGOS_DE_TOKEN`) | `ERR_JOSE_ALG_NOT_ALLOWED` es un código de token, así que si el proyecto pasara a RS256 todos los logins fallarían **y quemarían refresh tokens**. Hoy el JWKS sirve una sola clave ES256 (verificado). Si Supabase anuncia un cambio de algoritmo, hay que tocar `algorithms` antes, no después. |
| **Durante una caída del JWKS, cada request paga el timeout de 5 s antes de su 503** | `api/src/auth.ts` (`jwksDeSupabase`, vía `crearDeps`) | El caché vence a los 10 minutos y `_local` solo se reemplaza cuando el fetch tiene éxito, así que cada petición secuencial reintenta. Falla cerrado y es correcto, pero se lee como un cuelgue. Si molesta, el lugar para afinar `timeoutDuration`/`cacheMaxAge` es `crearDeps` — con una medición, no a ojo. |
| **El session pooler de Supabase (5432) puede rechazar la primera conexión de un rol recién usado** | `docs/private/credenciales.env` (`DATABASE_URL_*`) | Descubierto con `amg_cache`: password recién puesta y confirmada por `pg_roles`, y aun así `password authentication failed` por el session pooler — es Supavisor, no la credencial (`amg_api` seguía andando en paralelo por el mismo host). El **transaction pooler (6543)** conectó al toque. Si `amg_orquestador` o `amg_render` hacen su primera conexión real y da el mismo error, probar 6543 antes de sospechar de la password — siempre que el código solo use transacciones autocontenidas (`pool.transaction()`, sin `SET LOCAL` de sesión ni `LISTEN`, que es el caso de `PgTaskLog`). |

## Riesgos abiertos

### ✅ OBS-01 — Solapamiento de alcance · **CERRADA (2026-07-19)**

Era el último riesgo de producto abierto. Los dos documentos describían alcances distintos
(`contexto-proyecto-frank.md`: 4 módulos con "Frank"; el PRD: 5 agentes con "Franco · CEO", y el
Creador de Webs "diferido a I+D"). **Decidido:**

- **Manda `contexto-proyecto-frank.md`.** El PRD queda como visión de largo plazo.
- **Alcance base: 3 módulos.** El 4 (calendario de redes / Trello) pasa a línea futura.
- **El Creador de Webs va en la propuesta base**, y **ADR-04 se mantiene** (Storyblok, no WordPress).

**Dos de los tres módulos base ya están construidos.** Eso cambia la conversación comercial: el
presupuesto deja de ser *"cuánto cuesta construir esto"* y pasa a ser *"cuánto vale esto, que ya
funciona, más un módulo por hacer"*.

| Módulo | Estado |
|---|---|
| 1 — Creador de Webs | ✅ Construido, de punta a punta |
| 2 — Keyword Research | ✅ Construido, corrido en producción (**$0.31**/research) |
| 3 — Respondedor de reseñas (GBP) | ⛔ Sin empezar — lo único del alcance base por construir |

Registrado en [decisiones de arquitectura](../decisiones-arquitectura.md).

### Costo de Storyblok

El precio por space/seat crece con la cartera de clientes (ADR-04 exige **un space por cliente**
para un offboarding limpio). Hay que contemplarlo en la propuesta: lo absorbe la agencia o se
traslada al cliente.
