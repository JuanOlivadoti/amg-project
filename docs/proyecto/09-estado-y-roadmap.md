# 9. Estado y roadmap

## Resumen ejecutivo

> Actualizado 2026-08-01: **las cuatro piezas de la demo con Frank están resueltas.** Pieza A (login
> ES256), pieza B (modo oscuro del portal) y pieza C (dashboard de cartera) están **mergeadas a
> `main`**; la pieza D (research en vivo durante la demo) quedó **desaconsejada** con datos reales
> (ver más abajo). La Acción 06 (corrida final con La Birra Bar) también está cerrada. **La demo está
> lista para mostrarle a Frank** — lo que sigue es trabajo de producto, no de preparación de demo (ver
> [Próximos pasos](#próximos-pasos) más abajo).
>
> **Nuevo (2026-08-01): la navegación del sitio del cliente, mergeada a `main`.** El sitio público
> mostraba una barra armada con los títulos SEO de todas las páginas de investigación — parecía un
> blog, no el sitio de un restaurante. Reemplazada por Inicio/Menú/Ubicaciones/Contacto fijos, un
> footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. 10 tareas (9 planeadas + una
> migración de Postgres que apareció como gap real durante la ejecución), revisadas una por una más
> una revisión final de rama, más una revisión externa (Codex) que encontró 4 hallazgos reales
> (la allowlist de Postgres no validaba la *forma* de los valores, solo el nombre de la clave;
> `locations` tenía la precedencia invertida contra su propio comentario; los topes de tamaño se
> aplicaban tarde; `/blog` se autoenlazaba con una story real) — los 4 corregidos y verificados por
> mutación. **516 tests** (subió de 466). Detalle en [§2](#-2-la-demo-con-frank--cuatro-piezas-la-a-ya-no-bloquea-a-las-demás)
> y en el [plan](../superpowers/plans/2026-07-31-navegacion-sitio-cliente.md).
>
> **Nuevo (2026-08-01, más tarde): el cliente de la demo, unificado.** Se preguntó qué le faltaba al
> portal para una demo completa y la respuesta no fue una funcionalidad: **las tres pantallas hablaban
> de tres negocios distintos**. El dashboard listaba seis restaurantes inventados, el brief mostraba
> el italiano de ejemplo (`db/src/seed-demo.ts` seguía sembrando "Bella Napoli") y la web servía **La
> Birra Bar** — el recorrido de tres golpes contaba tres historias sin relación en tres clics. Ahora
> el seed, el dashboard y el `dev-server` de la API son el mismo cliente, y **un test ata el perfil del
> seed a `web-builder/business-profile.json`** para que la deriva no pueda repetirse en silencio.
> Detalle en [§2](#-2-la-demo-con-frank--cuatro-piezas-la-a-ya-no-bloquea-a-las-demás). **518 tests**
> (516 → 518) y **124 en el portal** (107 `node:test` + 17 Karma).
>
> **Acción 06 (corrida final) cerrada el 2026-07-30**: research real contra producción para **La
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
| **Tests** | **518** en el monorepo + **124** en el portal (107 `node:test` + 17 Karma). Los de seguridad, contra Postgres real |
| **Migraciones** | 10 en el repo (`0001`..`0010`) · **9 aplicadas en producción** — la `0010` está pendiente (ver abajo) |
| **ADRs** | 23, más 3 observaciones (**las 3 cerradas**) |
| **Reviews externas** | 12 rondas (Codex), 18 tandas de correcciones. El detalle, tanda por tanda, en [08-testing-calidad.md](08-testing-calidad.md#revisiones-externas-codex--qué-encontraron-y-qué-se-corrigió) |
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
| ✅ | **518 tests en verde** + typecheck limpio en los 6 paquetes. Los de seguridad, contra Postgres real. |
| ✅ | **Un solo cliente en toda la demo**: el dashboard, el brief y la web hablan de **La Birra Bar**, y el perfil del seed está **atado por test** al que se publica (`web-builder/business-profile.json`). |
| ✅ | **Navegación fija del sitio del cliente**: barra de 4 secciones (Inicio/Menú/Ubicaciones/Contacto, condicionales), footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. Datos reales de **La Birra Bar** cargados (dos locales, carta). Verificado en el navegador. |
| ✅ | **Doce reviews externas (Codex): todos los hallazgos, corregidos.** Varias de las brechas eran suposiciones MÍAS que Postgres no cumplía, o afirmaciones de seguridad **falsas** que documenté y el código desmentía. Las últimas cazaron cosas que yo había declarado hechas: el CLI de producción sin registro de idempotencia, un verificador de JWT que **ningún test tocaba**, carreras asincrónicas en el portal, y una allowlist de Postgres que restringía el **nombre** de la clave pero no la **forma** del valor. Ver [ADR-13..23 y el registro de correcciones](../decisiones-arquitectura.md). |

## Próximos pasos

*Actualizado 2026-08-01, tras unificar el cliente de la demo. Con las cuatro piezas resueltas (A/B/C
cerradas, D desaconsejada), la Acción 06 hecha y el hilo del recorrido unificado, lo que queda antes
de la reunión es **un paso operativo**, no código:*

0. **🔴 Re-sembrar producción.** El cambio del seed **no llega solo** a Supabase: hasta que se corra
   `npm run seed:demo -w db` contra la base desplegada, `bigballs.es` **sigue mostrando "Trattoria
   Bella Napoli"** con sus 8 páginas. El seed es idempotente y conserva los UUID fijos, así que
   reemplaza ese cliente y ese run **en su lugar** (no deja los dos). Necesita `DATABASE_URL_ADMIN`,
   `SEED_FRANK_USER_ID` y `SEED_JUAN_USER_ID` — los mismos de la primera siembra.
1. **Mostrarle la demo a Frank.** Depende de Juan, no de código. Tres cosas que conviene tener
   decididas antes, porque son del guion y no del software (ninguna bloquea, todas se notan):
   - **La puerta de entrada es `/runs`, no el dashboard** (`app.routes.ts` redirige `''` a `runs`):
     el primer golpe del recorrido queda a un clic en el sidebar.
   - **`aprobarRun` está apagado en producción** (decisión de Fase 1: no hay orquestador detrás), así
     que el cierre del ciclo —"aprobar y publicar"— **no se puede mostrar en `bigballs.es`**. O se
     enseña en local, o se narra.
   - **No hay link del portal a la web del cliente**, porque el renderizador no está desplegado (§4):
     el salto "esto es lo que se publica" es cambiar de ventana a `localhost:8080`.
   - **El dashboard sigue siendo una maqueta**: los KPIs y la serie de coste incluyen cinco clientes
     de muestra. La fila y las keywords de La Birra Bar sí son reales.
2. **Módulo 3 — respondedor de reseñas de Google (GBP).** Lo único del alcance base (OBS-01) sin
   ni una línea escrita. Es la pieza de producto más grande que falta.
3. **🟠 La demo del módulo de Keyword Research** — decidida el 2026-08-01 y con trabajo por delante:
   recuperar o regenerar el **dataset crudo** (bloquea todo lo demás), llevar el **informe legible al
   portal**, y las **tres mejoras de calidad** (`is_local` por SERP, `score_confidence` que ordene,
   volumen por percentiles), que pasaron de "algún día" a **pre-demo**. Guion de dos niveles:
   entregable primero, pipeline después. Detalle en [§2.b](#-2b-la-demo-del-módulo-de-keyword-research-decidido-2026-08-01).
   *(Hub & spoke y el enlazado interno vacío siguen fuera de la demo: ver la tabla de mejoras.)*
4. **Desplegar la Fase 2** (`orchestrator` + `renderer`, hoy solo en `localhost`) — servicio Node de
   larga duración, no serverless. Sin esto, `/menu`, `/blog` y todo lo que se acaba de construir
   siguen sin un dominio real. Tres cosas que van **dentro** de este paso y es fácil que se olviden,
   porque el código ya está y nada avisa de que faltan:
   - **Aplicar la migración `0010` a la base de producción** (está en el repo, no en Supabase, ver
     §1): sin ella el footer sale sin locales y `/menu` da 404 en cuanto el renderizador esté arriba.
   - **Encender `lanzarResearch` y `aprobarRun`** en `portal/src/environments/environment.prod.ts`.
     Se apagaron *porque no había orquestador detrás* (decisión de Fase 1, con test que lo fija). Si
     se despliega el orquestador y nadie los toca, **el portal sigue capado**: no se puede lanzar
     research ni cerrar la compuerta desde producción. Los dos tests de `environment.prod.test.ts`
     que hoy exigen `false` hay que **invertirlos** en el mismo cambio, no borrarlos.
   - **Un link del portal a la web del cliente.** Hoy no existe ninguno (§2.b): mientras el
     renderizador no tenga dominio, el salto "esto es lo que se publica" es cambiar de ventana.
5. **Cerrar lo que ADR-19 dejó a medias antes de un SLA**: CDN en el borde, invalidación con más de
   una instancia, punto único de disponibilidad (ver §3 más abajo).
6. **Deuda técnica menor, sin apuro**: esquema Zod duplicado M2/M1, ADR-11 (offboarding) reescrito
   sobre un frontend que ya no existe, y — de la revisión de Codex a la navegación del sitio — dos
   huecos de test documentados (falta un test positivo de que `/blog` muestra su link en una story
   normal, y la validación de forma de la allowlist de Postgres solo tiene test en un campo de ~20).
7. **Contraste del gráfico de barras en modo oscuro** (encontrado en el navegador el 2026-08-01, sin
   arreglar). Las etiquetas de los ejes las pinta **ApexCharts** con su gris por defecto (`#373d3f`),
   no un token nuestro: en claro se leen bien y **en oscuro quedan casi ilegibles**. Los tests de
   contraste no pueden verlo porque leen `styles.css`, y ese color no sale de ahí. El arreglo es
   pasarle `xaxis`/`yaxis` `labels.style.colors` desde el token, con el mismo patrón que ya usa
   `colores()` en `bar-chart.ts` — con su test, como el resto de los pares.

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

- **C.1 — las 9 migraciones** *(las que existían el 2026-07-25)*, verificadas por **introspección de
  la base**: 9 tablas con RLS **forzada** (`relforcerowsecurity`),
  `clients.business_profile_publico` como columna generada (la allowlist de ADR-19 vive en la base),
  runner idempotente confirmado con una segunda corrida.
  > ⚠️ **La `0010` no está aplicada en producción.** Es del 2026-08-01 (allowlist de
  > `locations`/`menu`), posterior a esta verificación. Hoy no rompe nada porque su único lector —el
  > renderizador— no está desplegado; cuando se despliegue, sin ella el footer sale **sin locales** y
  > `/menu` da **404**. Aplicarla es parte del despliegue de Fase 2: ver
  > [runbook § migraciones sobre una base ya desplegada](13-runbook-despliegue.md#aplicar-migraciones-nuevas-a-una-base-ya-desplegada).
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

**Verificado en el navegador el 2026-08-01** (era el pendiente que quedó abierto porque el MCP de
chrome-devtools no conectó durante la implementación): `/cartera` en oscuro y en claro, el drawer
mobile a 390 px —abre, el backdrop lo cierra, `aria-expanded` acompaña y el `aside` vuelve a
`-translate-x-full`—, y cero mensajes de consola. Y encontró lo que los tests no veían: ver el bloque
de abajo.

> ### 🔗 El cliente de la demo, unificado (2026-08-01)
>
> **El problema no era una funcionalidad que faltara: era que las tres pantallas hablaban de tres
> negocios distintos.** El dashboard listaba seis restaurantes inventados, el brief mostraba el
> italiano de ejemplo (el seed seguía sembrando "Trattoria Bella Napoli") y la web servía La Birra Bar
> desde la acción 06. El recorrido de tres golpes contaba tres historias sin relación.
>
> Qué se hizo, con test primero y verificación por mutación en cada paso:
>
> - **`db/src/seed-demo.ts`** siembra **La Birra Bar**: 14 páginas (8 respaldadas / 6 sin validar,
>   el split real de la acción 06), coste `309700` micros (**$0.3097**, el real), perfil con los **dos
>   locales** y la **carta**. `sembrarBellaNapoli` pasó a llamarse **`sembrarDemo`** para que el nombre
>   no vuelva a envejecer con el cliente. Los UUID fijos del cliente y del run **no cambian**: re-sembrar
>   la instalación desplegada reemplaza esas dos filas en su lugar, no deja las dos.
> - **Un test ata el perfil del seed a `web-builder/business-profile.json`** (nombre, `locations`,
>   `menu`). Es el ancla contra la deriva que causó todo esto: el perfil vivía dos veces sin nada que
>   atara las copias.
> - **Otro test comprueba que lo sembrado sobrevive la allowlist** (`business_profile_publico`). Ahí
>   apareció un bug real que nadie había visto: el perfil viejo no tenía **ni `locations` ni `menu`**,
>   así que la web del cliente sembrado se habría servido **sin Ubicaciones y con `/menu` en 404** —la
>   navegación que se acababa de construir— y además ponía `font: "Fraunces"`, que **no está en la
>   allowlist de fuentes** (`sistema | serif | moderna`) y se descartaba **en silencio**.
> - **El `dev-server` de la API usa `sembrarDemo`** en vez de inventar su propio dataset (era la cuarta
>   copia): verificar el portal en local ahora es ver lo que verá Frank.
> - **El dashboard abre con el cliente real**, con sus IDs, su coste y sus keywords.
>
> **Lo que solo apareció manejando la app** (y que ningún test veía): al mezclar un cliente real con
> cinco de muestra, el generador de muestra sacaba scores de hasta 98 y **el gráfico "Top
> oportunidades" quedaba dominado por relleno** (`keyword run-5-1 0`), con solo 2 de 8 barras reales —
> el primer golpe de la demo mostraba basura. Y la tabla listaba las 44 páginas: 14 reales seguidas de
> 30 de relleno. Corregido: la muestra tiene un techo de score por debajo del más bajo real, y la tabla
> lista solo las páginas del cliente principal. Los dos, con su test.
>
> **Límite honesto:** los 14 slugs del seed son *representativos*, no un volcado del space — este clon
> no tiene la credencial de lectura de la CDA, así que no se pudieron leer los que quedaron publicados
> en Storyblok. Lo que está atado por test es el negocio (perfil, locales, carta, split y coste).

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

- ✅ **Navegación del sitio del cliente** — **hecha y mergeada a `main` (2026-08-01)**
  ([spec](../superpowers/specs/2026-07-31-navegacion-sitio-cliente-design.md) ·
  [plan](../superpowers/plans/2026-07-31-navegacion-sitio-cliente.md)). El sitio público mostraba
  una barra con los títulos SEO de las 14 páginas de research — parecía un blog. Reemplazada por
  **Inicio · Menú · Ubicaciones · Contacto** fijos (condicionales a que haya datos), un **footer
  compartido** con NAP multi-local, y dos páginas sintetizadas nuevas: `/menu` (la carta, agrupada
  por categoría, JSON-LD `Menu`) y `/blog` (solo los artículos, separados de las landings
  comerciales). 10 tareas — 9 planeadas más una migración de Postgres (`0010`) que apareció como gap
  real durante la ejecución: la allowlist de `business_profile_publico` no incluía `locations`/
  `menu`, así que se hubieran filtrado en silencio en producción, el mismo bug que ya le había
  pasado a `brand`. Una revisión final de rama y una revisión externa (Codex) encontraron y
  corrigieron 4 hallazgos reales, verificados por mutación: la allowlist de Postgres no validaba la
  **forma** de los valores (un objeto podía colarse donde se esperaba un string), la precedencia de
  `locations` estaba invertida contra su propio comentario, los topes de tamaño se aplicaban después
  de que Postgres ya había materializado el array completo, y `/blog` se autoenlazaba con una story
  real. **516 tests** (subió de 466), typecheck limpio, verificado en el navegador dos veces (una
  vez por el implementador de la última tarea, otra por el controlador, con capturas).
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

### 🟠 2.b La demo del **módulo de Keyword Research** (decidido 2026-08-01)

Hasta acá, "la demo" quería decir *la demo de la plataforma*: el recorrido de tres golpes de §2, que
vende multi-tenancy, compuerta humana y web viva. **La demo del módulo KR es otra cosa** y no estaba
escrita en ninguna parte — este bloque la fija.

#### Las cuatro decisiones

| Decisión | Elegido | Qué implica |
|---|---|---|
| **Objetivo** | **Entregable primero, pipeline después** | Abre con lo que el restaurante recibe (informe + evidencia + precio) y, si hay interés técnico, se baja al recorrido `prompt → keywords → clustering → páginas`. Hay que preparar **dos guiones** y decidir dónde se corta. |
| **¿En vivo?** | **No: se muestra el ya corrido** | Confirma lo que midió la acción 06 (16m15s). La **pieza D queda cerrada, no pendiente**: paralelizar SERP y el progreso incremental **salen del alcance de la demo** y quedan como mejora de producto (§4). |
| **El informe** | **Se ve en el portal** | `out/informe.md` es el mejor entregable del módulo y hoy **solo existe como archivo local** tras correr el CLI. Pieza de trabajo nueva (ver abajo). |
| **Calidad del research** | **Las tres, antes de la demo** | `is_local` por señales del SERP, `score_confidence` que ordene, y volumen normalizado por percentiles. Dejan de ser "mejoras algún día": son **pre-demo**. |

#### 🔴 La precondición que hay que resolver primero: **falta el dataset crudo**

La tanda 4 dejó escrito que el dataset se persiste en `out/keywords.json` y que por eso *"el tuning es
offline y gratis"*. **Ese archivo no está en el repo** (`out/` está gitignoreado y no existe en el
clon actual). Sin él, las tres mejoras de calidad **no tienen contra qué calibrarse**, y la promesa de
tuning gratis no se puede cobrar. Tres salidas, en orden de preferencia:

1. **Aparece el `out/` de la corrida del 2026-07-30** en la máquina donde se corrió → coste **$0**.
2. **Regenerar el dataset** con una corrida real contra producción → **~$0.31** y ~16 min. Barato, y
   de paso vuelve a ejercitar el camino live.
3. ~~Calibrar contra sandbox~~ — **no sirve**: los datos son ficticios, y `is_local` depende
   justamente de señales reales del SERP (presencia de *map pack*).

> **Y guardar el dataset donde sobreviva.** Que el tuning sea gratis depende de que el archivo exista;
> hoy vive en un directorio ignorado por git, que es exactamente donde se pierde. Decidir dónde va
> (`docs/private/`, un bucket, o commitearlo si no lleva nada sensible) es parte de esta tarea.

#### Las piezas de trabajo

| # | Pieza | Estado | Nota |
|---|---|---|---|
| **KR-1** | **El dataset crudo, recuperado o regenerado** | ⚪ Sin empezar | **Bloquea a KR-3.** Ver arriba. |
| **KR-2** | **El informe legible, en el portal** | ⚪ Sin empezar | Diseño abierto (ver abajo). |
| **KR-3** | **Las tres mejoras de calidad** | ⚪ Sin empezar | Depende de KR-1. Detalle en [Mejoras de calidad](#mejoras-de-calidad-del-research-priorizadas-con-los-datos-reales). |
| **KR-4** | **El guion de dos niveles, escrito** | ⚪ Sin empezar | Qué se muestra, en qué orden, y dónde se corta si no hay interés técnico. |

**KR-2 — la decisión técnica que hay que tomar antes de escribir código.** `renderReport()` vive en
`kr-service`, y `api/package.json` **hoy solo depende de `db`**. Tres caminos:

- **(a) La API importa `kr-service`** y `GET /runs/:id` devuelve el informe ya renderizado. Lo más
  rápido, pero mete el pipeline de research entero como dependencia de la API — que es la superficie
  autenticada, y hasta ahora solo depende de la base.
- **(b) Extraer el contrato + `renderReport` a un paquete compartido.** Más trabajo, pero **cierra de
  paso la deuda del esquema Zod duplicado M2/M1**, que ya está anotada como deuda técnica. Es la que
  recomiendo.
- **(c) El portal renderiza el informe desde el `brief` JSON que ya recibe.** Cero cambios en el
  backend, pero **duplica la lógica del informe** en un tercer lugar y en otro lenguaje de plantilla:
  la misma clase de deriva que acaba de costar la unificación del cliente.

Falta decidir además si es **pantalla** o **descarga** (`.md`), y si el informe se genera al vuelo o
se guarda con el run.

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

- **Tests de componente del portal** (Karma). El núcleo está cubierto (**103** tests `node:test`) y
  hay **17** de componente en Karma, traídos con la pieza B/C — pero cubren el tema y el shell, no
  las pantallas de research. Esas se siguen verificando compilando con AOT y a mano: es evidencia de
  que funcionan hoy, **no una red contra regresiones**.
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
| ~~Unificar el alcance (OBS-01)~~ | ✅ **Hecha (2026-07-19).** Manda [`contexto-proyecto-frank.md`](../contexto-proyecto-frank.md); alcance base = 3 módulos; ADR-04 se mantiene. | — |
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
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y **118 tests** contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`, JWT con `exp`/`aud`/`alg` impuestos. **66 tests** contra PGlite. Desde la pieza A la firma se verifica contra el **JWKS público** del emisor (ES256), sin secreto compartido, y un fallo de infraestructura responde **503** en vez de confundirse con un token inválido. |
| **Portal Angular** | ADR-16, ADR-21 | ✅ **Hecho** (funcional). Login + lista + brief por evidencia + compuerta doble + refresh del token + polling, y las carreras asincrónicas cerradas (`Vigencia`). **120 tests** (103 de núcleo `node:test` + 17 de componente Karma); el flujo, verificado en un navegador real. **Falta:** tests de componente de las pantallas de research, y calibrar el polling contra los 16m15s medidos. |
| **Renderizador público** (la web del cliente) | ADR-19, ADR-04 | ✅ **Hecho.** `renderer/`: 1 servicio, N dominios. Hono, lee la Content Delivery API y sirve `renderStory()`. Cache con invalidación por webhook firmado, preview firmado + Bridge para el Visual Editor, y el rol de BD más pobre del sistema (`app_render`, sin escritura). Endurecido tras la 10ª review (límites del camino anónimo, timeouts de BD, replay). **114 tests**; **verificado contra el Storyblok REAL** con `npm run demo -w renderer`. **Falta:** desplegarlo en un dominio (5.3) y una CDN delante. |
| **Diseño de las webs** (marca + imágenes + navegación) | ADR-04, ADR-11 | ✅ **Hecho.** Tema por tenant (color/fuente/logo desde `business_profile.brand`, allowlist en `0009`) → cada web se ve **propia**. Imágenes editables en los bloks `hero`/`section` (campos `asset`). **Nav fijo de 4 secciones** (Inicio/Menú/Ubicaciones/Contacto, cada una condicionada a que el perfil tenga el dato — reemplaza a la barra vieja derivada de las páginas SEO publicadas) + **footer compartido** con NAP multi-local (`locations`) y link a Blog + `/menu`/`/blog` sintetizados desde el perfil (allowlist en `0010`, ver [spec](../superpowers/specs/2026-07-31-navegacion-sitio-cliente-design.md)) + **home sintetizada** en la raíz (la raíz ya no da 404; si el cliente crea su `home`, esa gana). Validación anti-inyección en tres capas, también en el `name`/`slug` de la nav y en NAP/carta. **Falta (deuda):** republicar desde un brief pisa las imágenes que suba el cliente — **el nav/footer/menú/blog YA NO dependen del brief**: se calculan en vivo desde `business_profile` en cada request, así que republicar no los toca. |
| **La costura publish→serve** (`fromStoryblokContent`) | ADR-19 | ✅ **Hecho.** El contenido que Storyblok guarda está **aplanado** y `renderStory` esperaba la forma anidada → daba 503. Lo cazó la demo, no un test (era OBS-03: nadie leía de vuelta lo publicado). Adaptador inverso + tests de ida-y-vuelta. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno — ahora **cuatro**: `amg_api`, `amg_orquestador`, `amg_cache` y `amg_render`. El JWT de Supabase **ya está enchufado y probado** (**27 tests** en `auth.test.ts`, con tokens firmados de verdad, ES256 contra un JWKS local). |
| **Idempotencia de peticiones facturables** | ADR-10, ADR-14 | ✅ **Hecho.** `kr_provider_tasks` + `payload_hash`, escrito ANTES de enviar: cubre el **100%** del gasto. **Además**, SERP y Search Volume (46%) usan el **método Standard** (`task_post`/`task_get`): la tarea pagada se **recupera gratis**, así que una respuesta perdida no es dinero perdido. Labs (54%) es live-only → ahí una petición ambigua detiene el run. |

### Mejoras de calidad del research (priorizadas con los datos reales)

**Las tres primeras son pre-demo** desde el 2026-08-01 (ver [§2.b](#-2b-la-demo-del-módulo-de-keyword-research-decidido-2026-08-01)); las dos últimas quedan fuera. Todas
dependen de **KR-1**: sin el dataset crudo no hay contra qué calibrarlas.

| Mejora | ¿Pre-demo? | Evidencia de la corrida real |
|---|---|---|
| **`is_local` por señales del SERP** (presencia de *map pack*) en vez de inferirlo por LLM | 🟠 **Sí** | **53 de 60** keywords salieron `is_local` → 7 de 8 páginas como `LocalBusiness`. Algunas deberían ser `Article`. Es el que más ensucia el JSON-LD, y en la demo se ve. |
| **Usar `score_confidence` al ordenar páginas** | 🟠 **Sí** | 5 de 8 páginas no tienen volumen. El 40% del score (intención + relevancia) no depende de datos de mercado, así que una keyword de la que no sabemos nada arranca en ~50 puntos. La confianza lo detecta (0.3) pero **no ordena nada** — y el dashboard **ya la muestra** como columna "Confianza": exhibir una confianza que no hace nada invita a la pregunta *"¿y entonces qué hago con esto?"* justo en la demo. |
| **Normalizar el volumen por percentiles del mercado** en vez del máximo del run; winsorizar outliers | 🟠 **Sí** | Con un solo pico (1300) el resto se aplasta, y eso cambia **qué páginas parecen valiosas** en el brief que se enseña. |
| **Estrategia hub & spoke** en el mapeo cluster→página | ⚪ No | Hoy todo es `single`. |
| **Enlazado interno** entre las páginas propuestas | ⚪ No | Hoy `enlazado_interno` sale vacío. |

---

## Deudas técnicas conocidas

| Deuda | Dónde | Impacto |
|---|---|---|
| **El secreto legacy de Supabase sigue vivo, y no se puede revocar sin migrar antes el portal** | Supabase (Project Settings → API) · `portal/src/environments/environment.prod.ts` | Con ese secreto se puede acuñar un token `service_role` que **bypassea RLS por completo** — el radio de daño no depende de que nuestra API ya no lo acepte. Pero **no se puede revocar sin más**: el `anon key` del portal es un JWT legacy firmado con él (`alg: HS256`, verificado), así que revocarlo rompe el login. Hay que migrar el portal a las claves nuevas (*publishable*), desplegar, verificar, y recién ahí revocar. Ver [12-credenciales.md](12-credenciales.md). |
| **Esquema Zod duplicado** entre M2 y M1 | `kr-service/src/validation/` y `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. Extraer a paquete compartido. |
| **Estimaciones del presupuesto sin calibrar** | `lib/budget.ts` | Las **tarifas de los modelos están verificadas** ✅, pero las estimaciones por fase **siguen a ojo**. Se calibran con `out/keywords.json` — **que hoy no está** (ver KR-1 en §2.b): la promesa de "calibrar es gratis" depende de recuperar o regenerar ese dataset. |
| **🔴 El dataset crudo del research no sobrevive** | `out/keywords.json` (gitignoreado) | La tanda 4 lo persistió para que *"ajustar scoring/clustering sea offline y gratis"*, pero vive en un directorio que git ignora y **no está en el clon actual**. Bloquea las tres mejoras de calidad pre-demo (§2.b) y la calibración del presupuesto. Hay que decidir dónde se guarda para que dure. |
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
