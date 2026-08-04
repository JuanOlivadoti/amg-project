# 9. Estado y roadmap

## Resumen ejecutivo

> **Dónde estamos, al 2026-08-02.** La demo con Frank está lista y lo que sigue es **trabajo de
> producto**, no de preparación de demo. En curso: el
> [programa del portal de la agencia](../superpowers/plans/2026-08-01-portal-agencia-programa.md) —
> las piezas **1 (CRM de clientes)** y **2 (usuarios)** están mergeadas a `main`; quedan la 3 (Ideas)
> y la 4.
>
> 📓 **La historia está en [`progress/history.md`](../../progress/history.md)**: qué se hizo cada día,
> con sus tropiezos y sus lecciones. Acá vive solo el estado de hoy y lo que falta — si buscás *por
> qué* algo terminó como terminó, es allá.

**La cadena completa está construida, de punta a punta y sin huecos:**

```
  prompt  →  research (M2)  →  persistencia bajo RLS  →  COMPUERTA HUMANA  →
          →  contenido (M1)  →  publicación en Storyblok  →  web servida en vivo
```

Todo lo que depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido
on-page, prose final). Todo lo que depende de aislamiento entre clientes lo impone **Postgres**, no
el código de la aplicación. Y las tres interfaces por las que pasa un humano —la API, el portal y la
web pública del cliente— **existen y se manejaron en un navegador real**.

**Qué está desplegado.** Fase 1, desde el 2026-07-25: el portal en [`bigballs.es`](https://bigballs.es)
(Hostinger, autodeploy desde `main`), la API en `api.bigballs.es` (Railway, `europe-west4`) y la base
con RLS forzada en Supabase (`eu-west-2`). De Fase 2, el **renderizador** desde el 2026-08-01
([`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app), Railway,
servicio aparte): la web del cliente se sirve desde internet.

**Qué falta para cerrar Fase 2:** el **orquestador** (la última pieza sin desplegar), el **dominio
propio del cliente** —el plan de Railway está en su límite de custom domains— y una **CDN** delante
del renderizador. El detalle, ordenado por lo que realmente bloquea, en
[Lo que queda por delante](#lo-que-queda-por-delante).

| | |
|---|---|
| **Paquetes** | 6 workspaces (`db`, `kr-service`, `web-builder`, `orchestrator`, `api`, `renderer`) + `portal/` (Angular, fuera del monorepo a propósito) |
| **Tests** | **917** — 682 en el monorepo + 235 en el portal (169 `node:test` + 66 Karma). Los de seguridad, contra Postgres real. Medido con `npm run verificar` el 2026-08-02. |
| **Migraciones** | 12 en `main` (`0001`..`0012`) · **las 10 primeras aplicadas en producción** (la `0010`, el 2026-08-01); la `0011` (CRM) y la `0012` (membresías) están mergeadas y **pendientes de aplicar** |
| **ADRs** | 24 (la `ADR-24`, membresías escribibles bajo RLS, aceptada el 2026-08-02), más 4 observaciones — 3 cerradas y **`OBS-04` abierta** (quién edita la web no lo gobierna nuestro RBAC; bloquea reescribir ADR-11) |
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
| ✅ | **682 tests en verde** (+235 en el portal) + typecheck limpio en los 6 paquetes. Los de seguridad, contra Postgres real. |
| ✅ | **El dashboard y el brief no pueden divergir en silencio**: un test ata las 14 páginas de `cartera-mock.ts` (portal) a `PAGINAS_DEMO` (seed), campo por campo y en orden. Estar fuera del monorepo impedía importar el paquete, no leer el archivo. |
| ✅ | **Un solo cliente en toda la demo**: el dashboard, el brief y la web hablan de **La Birra Bar**, y el perfil del seed está **atado por test** al que se publica (`web-builder/business-profile.json`). |
| ✅ | **Navegación fija del sitio del cliente**: barra de 4 secciones (Inicio/Menú/Ubicaciones/Contacto, condicionales), footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. Datos reales de **La Birra Bar** cargados (dos locales, carta). Verificado en el navegador. |
| ✅ | **Doce reviews externas (Codex): todos los hallazgos, corregidos.** Varias de las brechas eran suposiciones MÍAS que Postgres no cumplía, o afirmaciones de seguridad **falsas** que documenté y el código desmentía. Las últimas cazaron cosas que yo había declarado hechas: el CLI de producción sin registro de idempotencia, un verificador de JWT que **ningún test tocaba**, carreras asincrónicas en el portal, y una allowlist de Postgres que restringía el **nombre** de la clave pero no la **forma** del valor. Ver [ADR-13..23 y el registro de correcciones](../decisiones-arquitectura.md). |
| ✅ | **Gestión de clientes (CRM) en el portal — pieza 1 de 4, mergeada a `main` el 2026-08-01.** Listado, alta, perfil editable y vista con datos de ejemplo, sobre Postgres/RLS. La revisión final de la rama encontró y cerró una fuga real (el rol `cliente` podía leer notas internas de la agencia sobre sí mismo) antes de cerrar la pieza. Detalle arriba y en [11-plan-fase-2.md](11-plan-fase-2.md). |

## Próximos pasos

*Actualizado 2026-08-01, tras re-sembrar producción. El paso operativo que quedaba (0) **está hecho**;
lo que sigue no es código de la demo, y apareció un pendiente nuevo que sí es de despliegue (0.b).*

0. **✅ Producción re-sembrada** (2026-08-01, con `npm run reseed:demo`). Verificado por consulta
   contra Supabase, no por el "✔" del comando:

   | | |
   |---|---|
   | Clientes | **1**: La Birra Bar. El italiano **ya no está** — el id fijo lo reemplazó en su lugar, no dejó los dos |
   | Páginas | **14**: 8 `datos_mercado` (todas con volumen) + 6 `sin_validar` (ninguna con volumen), **0 aprobadas** — la compuerta la cruza Frank en vivo |
   | Run | `pending_approval`, `kr.v0.5`, coste 309 700 micros (\$0.3097) |
   | Perfil | 2 locales y 4 items de carta en `business_profile` |
   | Membresías | Frank `maestro`, Juan `equipo`, las dos con `client_id` NULL |
   | `app_metadata` | **Ya estaba bien**: el `tenant_id` de los dos usuarios coincide con el tenant sembrado y el `rol` con `memberships`. No hubo que tocar Supabase Auth (el tenant se upsertó por slug, así que el UUID no cambió) |

0.b **✅ La migración `0010`, aplicada a producción** (2026-08-01, `npm run migrate:deploy -w db`).
   El re-seed **no la necesitaba** —sembró los 14 registros sin problema— pero sí cambiaba lo que el
   renderizador podrá leer: `business_profile_publico` exponía solo `brand, name, priceRange`, así que
   **`locations` y `menu` se filtraban en silencio** aunque el perfil sembrado los tuviera. No rompía
   nada *en ese momento* (el renderizador todavía no estaba desplegado y el portal no lee esa
   columna), y **esa misma tarde se desplegó el renderizador**: sin la `0010`, la web habría salido
   con el footer sin locales y `/menu` en 404 — el fallo que la migración existe para arreglar, y que
   **no da error**. Se adelantó por si acaso, y el "por si acaso" llegó a las pocas horas.

   Se aplicó con `db/.env` recién sincronizado desde la fuente única (`npm run env:sync`), porque el
   CLI lo lee y es un archivo generado. **Verificado por consulta, no por el "✔"**:

   | | |
   |---|---|
   | Registro | las **10** migraciones (`0001`..`0010`) |
   | Allowlist efectiva | `brand, locations, menu, name, priceRange` (antes: `brand, name, priceRange`) |
   | Datos que ahora sobreviven | **2 locales** y **4 items de carta** |

0.c **✅ El re-seed, verificado también EN EL PORTAL** (2026-08-01, después de la consulta a la base).
   Consultar Supabase prueba que las filas están bien, no que el recorrido de la demo cierre — y esa
   distinción ya costó tres días una vez. Manejando `bigballs.es` con sesión real: los **14 slugs del
   brief coinciden uno a uno, y en el mismo orden**, con las keywords que grafica el dashboard; el
   split 8/6 y los `n/d` se ven donde deben; consola limpia en las tres pantallas.

   > **Lo que esta verificación destapó, y la consulta a la base no podía ver.** Entre la primera
   > siembra (11:55) y `f0c1387` (12:07) pasaron doce minutos, así que la primera corrida sembró los
   > **slugs inventados**: en producción, Cartera y Research mostraban **las mismas métricas con
   > nombres distintos** —"cerveza Ale Ogham Madrid — 74" contra "hamburgueseria barrio salamanca —
   > 74"—, a dos clics de distancia. El re-seed desde `HEAD` lo cerró, y ahora un test impide que
   > vuelva a pasar (ver `db/src/cartera-portal.test.ts` en «Qué funciona hoy»).

1. **Mostrarle la demo a Frank.** Depende de Juan, no de código. Tres cosas que conviene tener
   decididas antes, porque son del guion y no del software (ninguna bloquea, todas se notan):
   - **La puerta de entrada es `/runs`, no el dashboard** (`app.routes.ts` redirige `''` a `runs`):
     el primer golpe del recorrido queda a un clic en el sidebar.
   - **`aprobarRun` está apagado en producción** (decisión de Fase 1: no hay orquestador detrás), así
     que el cierre del ciclo —"aprobar y publicar"— **no se puede mostrar en `bigballs.es`**. O se
     enseña en local, o se narra.
   - **La web del cliente ya está en internet** (2026-08-01):
     `amg-renderer-production.up.railway.app`. El salto "esto es lo que se publica" dejó de ser un
     `localhost`. **Sigue sin haber un link desde el portal** —eso es código y no se tocó antes de la
     demo—, así que el salto es cambiar de pestaña, pero a una URL real.
   - **El dashboard sigue siendo una maqueta**: los KPIs y la serie de coste incluyen cinco clientes
     de muestra. La fila y las keywords de La Birra Bar sí son reales.
2. **Módulo 3 — respondedor de reseñas de Google (GBP).** Lo único del alcance base (OBS-01) sin
   ni una línea escrita. Es la pieza de producto más grande que falta.
3. **🟠 La demo del módulo de Keyword Research** — decidida el 2026-08-01. Las **tres mejoras de
   calidad** están **implementadas** (2026-08-02): `is_local` por map pack del SERP,
   `score_confidence` ordenando, y el volumen normalizado por percentil con winsorización. Queda
   **regenerar el dataset crudo** (~$0.31, decide Juan — el destino ya es durable), llevar el
   **informe legible al portal**, y que el orden nuevo **llegue al portal**, que hoy lo deshace.
   Guion de dos niveles: entregable primero, pipeline después. Detalle en
   [§2.b](#-2b-la-demo-del-módulo-de-keyword-research-decidido-2026-08-01).
   *(Hub & spoke y el enlazado interno vacío siguen fuera de la demo: ver la tabla de mejoras.)*
4. **Desplegar la Fase 2** — **el renderizador ya está** (2026-08-01); queda el **orquestador**.

   ✅ **Renderizador desplegado en Railway**, servicio aparte del de la API, sirviendo
   [`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app).
   Verificado en el navegador contra la base de producción: las 5 rutas en 200, las 14 páginas
   enlazadas, `/menu` con sus 3 categorías, `/blog` con los 2 artículos, footer con los 2 locales y
   JSON-LD correcto por tipo. El aislamiento del rol, comprobado con savepoints: `app_render` **no**
   puede leer `business_profile` crudo, ni `kr_runs`, ni `memberships`. Procedimiento y tropiezos
   reales en el [runbook](14-runbook-despliegue.md#desplegar-el-renderizador-fase-2).

   Lo que sigue faltando de este paso:
   - **El orquestador** (Inngest). Sin él, `lanzarResearch` y `aprobarRun` no tienen consumidor.
   - **Encender `lanzarResearch` y `aprobarRun`** en `portal/src/environments/environment.prod.ts`,
     **cuando el orquestador esté**. Se apagaron *porque no había nada detrás* (decisión de Fase 1,
     con test que lo fija). Si se despliega el orquestador y nadie los toca, **el portal sigue
     capado**. Los dos tests de `environment.prod.test.ts` que hoy exigen `false` hay que
     **invertirlos** en el mismo cambio, no borrarlos.
   - **Un link del portal a la web del cliente.** Ahora sí hay adónde apuntar, pero el link no existe:
     el salto sigue siendo cambiar de pestaña a mano.
   - **El dominio propio del cliente.** Hoy sirve por el dominio de Railway.
     `labirrabar.bigballs.es` ya tiene el CNAME puesto en Hostinger, pero apunta al servicio **de la
     API** (se agregó ahí por error y se quitó). Moverlo exige agregarlo como custom domain del
     servicio nuevo, actualizar el CNAME con el target que dé Railway y esperar propagación — y
     **el plan actual está en su límite de custom domains**, así que hay que liberar uno o subir de
     plan.
   - ~~Aplicar la migración `0010`~~ — ✅ hecha el 2026-08-01 (ver 0.b). Era el bloqueante silencioso
     de este despliegue: sin ella la web habría salido **sin locales y con `/menu` en 404**, sin un
     solo error en los logs.
5. **Cerrar lo que ADR-19 dejó a medias antes de un SLA**: CDN en el borde, invalidación con más de
   una instancia, punto único de disponibilidad (ver §3 más abajo).
6. **Deuda técnica menor, sin apuro**: esquema Zod duplicado M2/M1, ADR-11 (offboarding) reescrito
   sobre un frontend que ya no existe, y — de la revisión de Codex a la navegación del sitio — dos
   huecos de test documentados (falta un test positivo de que `/blog` muestra su link en una story
   normal, y la validación de forma de la allowlist de Postgres solo tiene test en un campo de ~20).
7. ✅ **Contraste de los ejes en modo oscuro** — **arreglado y desplegado (2026-08-01, `521daaf`).**
   Las etiquetas las pintaba **ApexCharts** con su gris por defecto, que no sale de `styles.css`, así
   que `contraste.test.ts` no podía verlo por construcción. Medido en producción antes de tocar nada:
   **1.53:1** sobre `--superficie` en oscuro, contra el 4.5:1 de AA, en **31 etiquetas**. Ahora salen
   de `--texto-medio` vía `estiloEjes()`, que recibe el lector del token en vez de tocar `document`
   —así el contrato se prueba en `node:test`, sin navegador—. **Los dos ejes**, no uno: en la barra
   horizontal las categorías van en el Y, y fijar solo el X dejaba las keywords con el gris viejo.
   El test **descubre** los componentes con `<apx-chart>` en vez de listarlos, así que el próximo
   gráfico que alguien agregue sin el token también falla. Verificado en el navegador y en producción:
   **oscuro 11.49:1, claro 10.31:1**, y repinta en vivo al cambiar de tema.
8. ✅ **`npm run typecheck` ya no escribe donde escribe el build de producción** (2026-08-01,
   `9b7b7f4`). `typecheck` es `ng build --configuration development` y, sin `outputPath` propio,
   dejaba en `dist/portal` un bundle con los valores-plantilla y `lanzarResearch: true`, **sin pasar
   por el `prebuild`** que verifica la config. Comprobado: tras un typecheck, `dist/portal/browser/`
   contenía `TU-PROYECTO`. No llegaba a producción porque Hostinger autodespliega desde `main` y no
   sube `dist/`, pero el runbook ya listaba el síntoma ("Frank SÍ ve el botón lanzar research") sin
   nombrar esta causa. Ahora va a `dist/portal-dev`, con un test que lee `angular.json` y cae si
   alguien le quita la salida propia.

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
([detalle](../historia/acciones/03-research-produccion-dataforseo.md)):

1. **Se le decía al cliente "0 búsquedas/mes" donde no teníamos el dato.** DataForSEO devuelve
   `null` (le pasó en 41 de 60 keywords en KD) y el código lo coaccionaba a `0`. Ahora se propaga
   como `null` y el informe muestra **`n/d`** → esquema **`kr.v0.4`**.
2. **Se pagaban keywords duplicadas.** `"pasta fresca Madrid"` y `"pasta fresca madrid"` iban como
   dos, y a DataForSEO se le paga por keyword. Ahora hay dedupe canónico.
3. **El clustering colapsaba el sitio entero en 3 páginas.** Con coseno ≥ 0.55, 41 de 45 keywords
   caían en un cluster. Recalibrado a **0.75** con el dataset real: **8 páginas**, cada una sobre un
   servicio real del negocio.

> El dataset crudo se persiste en `datasets/keywords.json`. Antes se tiraba: se pagaba por datos
> que no sobrevivían al proceso, y cualquier ajuste de scoring obligaba a pagar otra corrida.
> Ahora el tuning es **offline y gratis** — con la salvedad de que el dataset de la corrida real se
> perdió igual, porque hasta el 2026-08-02 se escribía en `out/`, que git ignora (ver KR-1 en §2.b).

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
[13-runbook-despliegue.md](14-runbook-despliegue.md).

**Lo verificado en producción** (no "el deploy dio verde", sino comprobado desde afuera):

- **C.1 — las 9 migraciones** *(las que existían el 2026-07-25)*, verificadas por **introspección de
  la base**: 9 tablas con RLS **forzada** (`relforcerowsecurity`),
  `clients.business_profile_publico` como columna generada (la allowlist de ADR-19 vive en la base),
  runner idempotente confirmado con una segunda corrida.
  > ✅ **La `0010` también está aplicada** (2026-08-01, posterior a esta verificación). Producción va
  > con las **10**, y la allowlist de `business_profile_publico` ya deja pasar `locations` y `menu`.
  > Ver 0.b en [próximos pasos](#próximos-pasos) y el
  > [runbook § migraciones sobre una base ya desplegada](14-runbook-despliegue.md#aplicar-migraciones-nuevas-a-una-base-ya-desplegada).
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

Son **tres procesos** de larga duración más una SPA estática. **Dos están desplegados** (API y
renderizador, los dos en Railway y en servicios separados); falta el orquestador:

| Qué | Puerto dev | Necesita | Desplegado |
|---|---|---|---|
| `api/` | 3000 | `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS` | ✅ `api.bigballs.es` |
| `orchestrator/` | — | `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, Inngest | ⚪ no |
| `renderer/` | 8080 | `DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`, `PREVIEW_SECRET`, `TRUST_PROXY` | ✅ `amg-renderer-production.up.railway.app` |
| `portal/` | 4200 | estático, se compila con AOT | ✅ `bigballs.es` |

La restricción del **renderizador** sigue viva y ahora está a medio resolver: necesita **DNS por
cliente apuntando al mismo servicio** (es un `Host` → dominio → space), más certificados TLS por
dominio. Railway lo admite —el despliegue lo confirmó—, pero **el plan actual tiene un límite de
custom domains que ya se alcanzó con dos**. Con una cartera de clientes eso deja de ser un detalle:
o se sube de plan, o la CDN de §3 pasa a ser también quien termina el TLS. La elección de Fase 1 no
cierra la puerta, pero el costo por dominio ahora tiene un número.

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

**Pieza A** ([spec](../superpowers/ejecutados/2026-07-26-verificacion-jwt-es256-design.md) ·
[plan](../superpowers/ejecutados/2026-07-26-verificacion-jwt-es256.md)): 4 tareas, **las 4 hechas** en la
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
Ver [13-runbook-despliegue.md § Actualizar una instalación ya desplegada](14-runbook-despliegue.md#actualizar-una-instalación-ya-desplegada).

**B — modo oscuro:** solo el portal; el renderizador queda afuera a propósito (la web pública es la
marca del restaurante). Va por **tokens semánticos**, no por variantes `dark:`, para que la pieza C
herede el tema por construcción en vez de tener que acordarse
([spec](../superpowers/ejecutados/2026-07-30-modo-oscuro-portal-design.md) ·
[plan](../superpowers/ejecutados/2026-07-30-modo-oscuro-portal.md)).

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
([spec](../superpowers/ejecutados/2026-07-30-dashboard-ui-portal-design.md) ·
[plan de Tailwind v4](../superpowers/ejecutados/2026-07-30-tailwind-v4-migracion-portal.md), cerrado y
mergeado ·
[plan del shell + dashboard](../superpowers/ejecutados/2026-07-30-dashboard-ui-portal.md), 13/13 tasks,
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
> **✅ Cerrado el mismo día: los slugs ahora salen de Storyblok.** Con las credenciales disponibles se
> leyeron las 14 stories publicadas por la **Content Delivery API**, y el seed usa sus **slugs,
> keywords (`source_keyword`), títulos y descripciones SEO, tipo de página, intención y FAQs reales**.
> El brief que Frank aprueba en el portal lista **exactamente** las páginas vivas en la web, con sus
> mismos textos. Solo dos de los 14 slugs inventados coincidían con los reales, así que sin esto el
> hilo seguía roto en el último salto.
>
> **Lo único que queda reconstruido son las métricas** (volumen, dificultad, score, confianza): vivían
> en `out/brief.json`, perdido con el directorio `out/` (KR-1). Están asignadas por demanda plausible
> y **respetan el split real 8/6**; se reemplazan por las medidas cuando se regenere el dataset.
>
> Y un invariante nuevo, con test: **ninguna página de tipo `blog` puede marcarse `local`** — `local`
> decide si la página se declara `LocalBusiness` ante Google, y un artículo no es un negocio local.

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
  ([spec](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente-design.md) ·
  [plan](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente.md)). El sitio público mostraba
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
- ✅ **[Corrida final + republicar](../historia/acciones/06-corrida-final-demo.md)** — **hecha (2026-07-30)**,
  $0.3097. Publicado en Storyblok con `kr.v0.5`: 14 páginas de **La Birra Bar** (cliente real de la
  agencia, reemplazó al caso de ejemplo "Bella Napoli" en el mismo space), verificado en el
  navegador — evidencia separada (8 respaldadas / 6 sin validar), JSON-LD correcto por tipo de
  página (`LocalBusiness` solo donde corresponde, `Article` en los blogs), marca consistente. De
  paso se encontró y cerró un hueco real: `npm run spike` en producción exige `DATABASE_URL_CACHE`
  desde ADR-14 y la guía no lo pedía — corregido en la guía y en `scripts/env-sync.mts` /
  `kr-service/.env.example`. Detalle completo en la guía. Lo publicado en Storyblok **ya no es
  anterior a `kr.v0.5`**: ahora sí muestra la evidencia etiquetada, que es *el argumento de venta*.
- ✅ ~~Unificar el alcance (OBS-01)~~ — **hecho** (2026-07-19): manda `docs/historia/contexto-proyecto-frank.md`,
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
| **Calidad del research** | **Las tres, antes de la demo** | `is_local` por señales del SERP, `score_confidence` que ordene, y volumen normalizado por percentiles. Dejan de ser "mejoras algún día": son **pre-demo**. ✅ **Las tres implementadas el 2026-08-02** — con un matiz que hay que leer: la normalización es por percentil **del run**, no del mercado. El otro matiz —que el orden nuevo no llegaba al portal— se cerró el 2026-08-04 con la migración `0015`. Ver KR-3 abajo. |

#### 🔴 La precondición: **falta el dataset crudo** — el destino ya está arreglado, el dato no

La tanda 4 dejó escrito que el dataset se persiste y que por eso *"el tuning es offline y gratis"*,
pero lo escribía en `out/keywords.json` y **`out/` está gitignoreado**: el archivo no viajó con el
clon y **no está en ninguna máquina** (buscado el 2026-08-02, incluido fuera del repo). Tres salidas,
en orden de preferencia:

1. ~~Aparece el `out/` de la corrida del 2026-07-30~~ — **descartada**: no existe.
2. **Regenerar el dataset** con una corrida real contra producción → **~$0.31** y ~16 min. Barato, y
   de paso vuelve a ejercitar el camino live. **Es la única salida, y la decide Juan.**
3. ~~Calibrar contra sandbox~~ — **no sirve**: los datos son ficticios, y `is_local` depende
   justamente de señales reales del SERP (presencia de *map pack*).

> ✅ **La otra mitad —guardar el dataset donde sobreviva— está hecha (2026-08-02).** El destino por
> defecto es `datasets/keywords.json`, un directorio **versionado** (`KR_DATASET_PATH` lo cambia). La
> decisión de commitearlo: son datos de mercado públicos más el prompt del negocio, nada secreto —
> el motivo real de que estuvieran en un directorio ignorado era que el CLI escribía todas sus
> salidas en el mismo sitio. Y **no lo garantiza un comentario**: lo impone `dataset-path.test.ts`,
> que le pregunta a `git check-ignore` y falla si el destino cae en un directorio ignorado. Es el
> test que habría cazado el bug original.

#### Las piezas de trabajo

| # | Pieza | Estado | Nota |
|---|---|---|---|
| **KR-1** | **El dataset crudo, recuperado o regenerado** | 🟠 **A medias** | El **destino durable** ✅ hecho. El **dato** falta: cuesta ~$0.31 y **decide Juan**. Ver arriba. |
| **KR-2** | **El informe legible, en el portal** | 🟠 **Spec aprobada, sin implementar** | Las tres decisiones cerradas el 2026-08-04: **(b) paquete compartido**, **pantalla + descarga `.md`**, **el `.md` guardado**. La spec está en [`2026-08-04-informe-kr-portal-design.md`](../superpowers/specs/2026-08-04-informe-kr-portal-design.md), partida en KR-2a (el paquete) y KR-2b (la feature). Ver abajo. |
| **KR-3** | **Las tres mejoras de calidad** | 🟠 **Implementadas, sin calibrar** | ✅ Las tres en `kr-service` (2026-08-02), y ✅ **el orden ya llega al portal** (2026-08-04, migración `0015`). Queda **una** cosa abierta: los parámetros no están barridos contra datos reales (necesita KR-1). |
| **KR-4** | **El guion de dos niveles, escrito** | ⚪ Sin empezar | Qué se muestra, en qué orden, y dónde se corta si no hay interés técnico. |

**KR-3 — lo que quedaba abierto: ✅ CERRADO el 2026-08-04** (etapa B del
[plan de agentes](../../.claude/PLAN-AGENTES.md), que estrena con esto al agente `datos`).

El orden en dos niveles (evidencia primero, después `score_confidence`) gobierna **qué páginas
existen** —el corte al backlog es irreversible y ocurre dentro de `kr-service`—, pero **no llegaba al
cliente**: en cuanto el brief pasaba por Postgres, `getRunPages` y `getPublishablePages` reordenaban
por `opportunity_score` crudo, así que la columna "Confianza" del portal no ordenaba nada. Se cerró con
la **(a) persistir el orden**, que era la recomendada: el orden lo decide quien tiene el contexto, y es
la única que sobrevive a que alguien cambie la fórmula. La (b) —duplicar la fórmula en SQL y en el
portal— se descartó: eran tres fuentes de verdad del mismo criterio.

Qué quedó, con el contrato **el orden ES la posición en `brief.paginas_propuestas`**:

- **`kr_pages.orden_brief`** (migración `0015`, `0` = primera), escrita por `PgStore.savePages` desde el
  índice del array. `kr-service` y `orchestrator` **no cambiaron**: el array ya viajaba ordenado.
- Las **dos** lecturas ordenan por una única definición (`ORDEN_DEL_BRIEF`), para que el revisor no
  pueda aprobar una lista y publicarse otra.
- **El portal no necesitó cambios**, y esto corrige lo que este documento afirmaba: el que deshacía el
  orden era solo `store.ts`. `separarPorEvidencia` **preserva** el orden de entrada
  (`portal/src/app/core/evidence.ts:35`) y las plantillas no re-ordenan. Y
  `portal/src/app/core/cartera.ts:37` **no era una violación**: es `topOportunidades`, el widget de "las
  N de mayor score" del dashboard, con un propósito distinto del orden del brief. Sí se agregó un test
  🔴 en el portal que **muerde** —su fixture entra con el orden contradiciendo al score—, porque el que
  había usaba dos páginas con el mismo score y pasaba igual con un `sort` metido en medio.
- Dos garantías nuevas que antes no las imponía nada: un brief con **`url_slug` repetido se rechaza
  entero** (producía un orden invertido y **no reproducible**), y una página **retirada no puede tener
  posición** (`check retirada_sin_posicion`).

**Con el seed actual la demo se ve igual**, y está medido: los 14 scores de `PAGINAS_DEMO` son
estrictamente descendentes y sin empates, con las 8 respaldadas antes de las 6 sin validar, así que el
orden del array coincide índice por índice con el de dos niveles. Lo que cambia es que **deja de
depender de esa coincidencia**.

**KR-2 — la decisión técnica, ✅ TOMADA el 2026-08-04: la (b), paquete compartido.** Se decidió sin
implementar, para que no siguiera bloqueando. `renderReport()` vive en `kr-service`, y
`api/package.json` **hoy solo depende de `db`**. Los tres caminos que se compararon:

- **(a) La API importa `kr-service`** y `GET /runs/:id` devuelve el informe ya renderizado. Lo más
  rápido, pero mete el pipeline de research entero como dependencia de la API — que es la superficie
  autenticada, y hasta ahora solo depende de la base.
- **(b) Extraer el contrato + `renderReport` a un paquete compartido.** ✅ **ELEGIDA.** Más trabajo,
  pero **cierra de paso la deuda del esquema Zod duplicado M2/M1**, que ya está anotada como deuda
  técnica. Y mantiene la API dependiendo solo de datos, no del pipeline de research.
- **(c) El portal renderiza el informe desde el `brief` JSON que ya recibe.** Cero cambios en el
  backend, pero **duplica la lógica del informe** en un tercer lugar y en otro lenguaje de plantilla:
  la misma clase de deriva que acaba de costar la unificación del cliente.

**Las dos preguntas de producto se cerraron el 2026-08-04**, y con eso la spec quedó escrita
([`2026-08-04-informe-kr-portal-design.md`](../superpowers/specs/2026-08-04-informe-kr-portal-design.md)):
**pantalla + botón de descarga `.md`**, y el **`.md` guardado ya renderizado**.

Lo que el diseño destapó, y que no se sabía al tomar esas decisiones:

- **El `backlog` no se persiste en ninguna parte** — `savePages` solo guarda páginas. Un informe
  reconstruido desde la base saldría sin esa sección **sin avisar**. Guardar el `.md` renderizado desde
  el brief en memoria lo evita.
- **El run de la demo no lo produjo el pipeline: lo siembra `sembrarDemo`.** Escribir el informe solo "al
  terminar el research" lo habría dejado sin informe, y el `out/informe.md` de la corrida real no existe
  en ninguna máquina (KR-1). De ahí que haya **dos productores** que escriben el informe.
- **`renderReport` emite `NaN` con datos incompletos**, y el contrato **no admite "no sé"** en las
  coberturas de `calidad_datos` (son `number` no-nullable). Las dos cosas se arreglan en KR-2a.
- **El informe va en tabla propia (`kr_informes`), no en una columna de `kr_runs`.** RLS es por fila: una
  columna habría dejado el **coste interno de la agencia** visible para el rol `cliente`, que ve los runs
  de su negocio. La política exige `app.es_staff()`.
- **El informe de la demo va a tener tres huecos** (desglose de coste y las dos coberturas) hasta que se
  regenere el dataset. Es el momento en que el ~$0.31 de KR-1 deja de ser mejora interna y se vuelve
  visible en la demo.

Partida en dos etapas: **KR-2a** (el paquete `contrato/`, cero cambios visibles) y **KR-2b** (migración
`0016`, endpoints, pantalla, seed).

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

- **Tests de componente del portal** (Karma). El núcleo está cubierto (**169** tests `node:test`) y
  hay **66** de componente en Karma. Ya no es deuda: cubren el tema y el shell, las pantallas de
  clientes y usuarios, **y las de research** (`runs.spec.ts`, `brief.spec.ts`). Lo que sigue sin red
  de componente son las pantallas que se agreguen de acá en adelante — la regla está en la skill
  `portal-testing`.
- **El polling del brief (4 s) es a ojo**, y la lista de runs no pollea. Se calibra con la duración
  real de una corrida.
- **ADR-11 (offboarding) sigue sin poder firmarse.** Ahora *hay* qué entregar (el space + el
  renderizador), pero falta **verificar el snapshot estático como entregable**, ponerle precio a la
  "salida gestionada" y **cerrar OBS-04** (quién edita durante el servicio, del que depende qué
  significa "editable" en la baja). Es redacción comercial, no código.
- **El enlace de preview del Visual Editor se emite a mano.** `firmarPreview()` existe y está
  probado, pero solo lo usan `dev-server` y `demo-server`: en producción el enlace se genera con un
  script fuera del repo y se pega en la configuración del space. Funciona, y **la firma vence** — así
  que hoy se compensa con un vencimiento largo. Parte de OBS-04.
- **El clic-para-editar del Visual Editor no funciona.** `desShapeBlok()`
  (`web-builder/src/storyblok/content.ts`) descarta el atributo `_editable` al normalizar el blok, y
  es de ahí de donde el Bridge saca el resaltado y el salto al campo. Se edita desde el panel de
  campos. Pesa poco si edita la agencia, y bastante si el día de mañana edita el cliente.
- **Esquema Zod duplicado** entre M2 y M1: dos fuentes de verdad del contrato.
- **Sin tests de integración**: el camino live se ejecutó a mano contra DataForSEO, OpenAI y
  Storyblok, pero no está automatizado.
- **Calidad del research**: las tres mejoras están implementadas (2026-08-02) pero **sin calibrar
  contra datos reales** — `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` son
  defendibles por construcción, no barridos como sí lo está `CLUSTER_SIM_THRESHOLD_DEFAULT = 0.75`.
  Barrerlos es **gratis en cuanto exista el dataset** (KR-1). Y `TIPOS_MAP_PACK` (`local_pack`,
  `map`) **no está verificado contra la API real**: si estuviera mal, `is_local` saldría `false` para
  todo — falla hacia el lado conservador, pero KR-3 no estaría arreglando nada.

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
| ~~Unificar el alcance (OBS-01)~~ | ✅ **Hecha (2026-07-19).** Manda [`docs/historia/contexto-proyecto-frank.md`](../historia/contexto-proyecto-frank.md); alcance base = 3 módulos; ADR-04 se mantiene. | — |
| ~~`SUPABASE_JWT_ISS` en Railway~~ | ✅ **Hecha (2026-07-27).** Cargada antes del merge; la API arrancó con ella. `SUPABASE_JWT_SECRET` se **deja** en Railway a propósito: es la red de rollback (el código viejo la exige para arrancar) y no molesta, porque `leerConfig` ya no la lee. | — |
| ~~Verificar el login en el navegador~~ | ✅ **Hecha (2026-07-30).** Era lo único que podía cerrar la pieza A. Queda **sin verificar** el detalle del logout: que revoca en Supabase (Auth → Users → Sessions) y que es **local** (cerrar sesión en un dispositivo no cierra la del otro). Lo cubren 7 tests, pero no se miró en producción. | — |
| ~~**[Corrida final + republicar](../historia/acciones/06-corrida-final-demo.md)**~~ | ✅ **Hecha (2026-07-30).** Publicado `kr.v0.5` para La Birra Bar (cliente real), verificado en el navegador. De paso: se midió la duración real del research (16m15s) y se cerró el gap de `DATABASE_URL_CACHE` que la guía no pedía. | $0.3097 |

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
| **Dataset crudo persistido** | Ajustar scoring/clustering es gratis, sin pagar otra corrida. *(El destino era `out/`, gitignoreado, y el dataset se perdió; desde el 2026-08-02 va a `datasets/`.)* |
| **Tope de gasto en el CLI** | `MAX_COST_USD=1.00 npm run spike` aborta antes de gastar. |

### Fase 2-3 — Plataforma

| Pieza | ADR | Estado |
|---|---|---|
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y **182 tests** contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`, JWT con `exp`/`aud`/`alg` impuestos. **95 tests** contra PGlite. Desde la pieza A la firma se verifica contra el **JWKS público** del emisor (ES256), sin secreto compartido, y un fallo de infraestructura responde **503** en vez de confundirse con un token inválido. |
| **Portal Angular** | ADR-16, ADR-21 | ✅ **Hecho** (funcional). Login + lista + brief por evidencia + compuerta doble + refresh del token + polling, y las carreras asincrónicas cerradas (`Vigencia`). **235 tests** (169 de núcleo `node:test` + 66 de componente Karma, las pantallas de research incluidas); el flujo, verificado en un navegador real. **Falta:** calibrar el polling contra los 16m15s medidos. |
| **Renderizador público** (la web del cliente) | ADR-19, ADR-04 | ✅ **Hecho.** `renderer/`: 1 servicio, N dominios. Hono, lee la Content Delivery API y sirve `renderStory()`. Cache con invalidación por webhook firmado, preview firmado + Bridge para el Visual Editor, y el rol de BD más pobre del sistema (`app_render`, sin escritura). Endurecido tras la 10ª review (límites del camino anónimo, timeouts de BD, replay). **114 tests**; **verificado contra el Storyblok REAL** con `npm run demo -w renderer`. ✅ **Desplegado el 2026-08-01** en Railway (servicio aparte del de la API): sirve `amg-renderer-production.up.railway.app` leyendo de Supabase con `amg_render` → `app_render`, verificado en el navegador. **Falta:** el dominio propio del cliente (el plan de Railway está en su límite de custom domains) y una CDN delante. |
| **Diseño de las webs** (marca + imágenes + navegación) | ADR-04, ADR-11 | ✅ **Hecho.** Tema por tenant (color/fuente/logo desde `business_profile.brand`, allowlist en `0009`) → cada web se ve **propia**. Imágenes editables en los bloks `hero`/`section` (campos `asset`). **Nav fijo de 4 secciones** (Inicio/Menú/Ubicaciones/Contacto, cada una condicionada a que el perfil tenga el dato — reemplaza a la barra vieja derivada de las páginas SEO publicadas) + **footer compartido** con NAP multi-local (`locations`) y link a Blog + `/menu`/`/blog` sintetizados desde el perfil (allowlist en `0010`, ver [spec](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente-design.md)) + **home sintetizada** en la raíz (la raíz ya no da 404; si el cliente crea su `home`, esa gana). Validación anti-inyección en tres capas, también en el `name`/`slug` de la nav y en NAP/carta. **Falta (deuda):** republicar desde un brief pisa las imágenes que suba el cliente — **el nav/footer/menú/blog YA NO dependen del brief**: se calculan en vivo desde `business_profile` en cada request, así que republicar no los toca. **Lo "hecho" es la infraestructura de marca, no el aspecto:** las landings publicadas se ven sin terminar (ni una foto, CTA que es un párrafo, siete secciones idénticas) y eso tiene su propio diseño, 🟡 **sin empezar** — [spec de plantillas de landing](../superpowers/specs/2026-08-01-plantillas-landings-design.md), migración `0014`, tres entregas. **Enmendado el 2026-08-02** con el **manual de marca** (tokens de color y roles tipográficos self-hosted, en vez de los tres campos actuales) y el **rediseño de la carta** (categorías con foto, precios por ración), tomando como referencia visual un template real de restaurante sin adoptar ni una línea suya. |
| **La costura publish→serve** (`fromStoryblokContent`) | ADR-19 | ✅ **Hecho.** El contenido que Storyblok guarda está **aplanado** y `renderStory` esperaba la forma anidada → daba 503. Lo cazó la demo, no un test (era OBS-03: nadie leía de vuelta lo publicado). Adaptador inverso + tests de ida-y-vuelta. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno — ahora **cuatro**: `amg_api`, `amg_orquestador`, `amg_cache` y `amg_render`. El JWT de Supabase **ya está enchufado y probado** (**27 tests** en `auth.test.ts`, con tokens firmados de verdad, ES256 contra un JWKS local). |
| **Idempotencia de peticiones facturables** | ADR-10, ADR-14 | ✅ **Hecho.** `kr_provider_tasks` + `payload_hash`, escrito ANTES de enviar: cubre el **100%** del gasto. **Además**, SERP y Search Volume (46%) usan el **método Standard** (`task_post`/`task_get`): la tarea pagada se **recupera gratis**, así que una respuesta perdida no es dinero perdido. Labs (54%) es live-only → ahí una petición ambigua detiene el run. |

### Mejoras de calidad del research (priorizadas con los datos reales)

**Las tres primeras eran pre-demo** desde el 2026-08-01 y están **implementadas el 2026-08-02**; las
dos últimas quedan fuera. Lo que **sigue dependiendo de KR-1** no es implementarlas sino
**calibrarlas**: sin el dataset crudo, los parámetros nuevos son juicio y no medición.

| Mejora | Estado | Qué la motivó, y qué quedó |
|---|---|---|
| **`is_local` por señales del SERP** (presencia de *map pack*) en vez de inferirlo por LLM | ✅ **Hecho** — `pipeline/local-signal.ts` | **53 de 60** keywords salieron `is_local` → 7 de 8 páginas como `LocalBusiness`. Ahora el map pack pisa la conjetura del LLM, pero **solo cuando se observó** (`mapPack: null` respeta al LLM: tratar "no observado" como "no local" sería el mismo error que `volumen ?? 0`), y solo en las ~15 cabezas cuyo SERP se paga. **Falta:** verificar `TIPOS_MAP_PACK` contra la API real (~$0.003). |
| **Usar `score_confidence` al ordenar páginas** | 🟠 **Hecho en `kr-service`; no llega al portal** | 5 de 8 páginas no tienen volumen, y el 40% del score no depende de datos de mercado. Ahora el orden es en dos niveles: evidencia, y dentro de cada grupo `score × (1 − P + P·confianza)` con `PESO_CONFIANZA_ORDEN = 0.5`. **El corte al backlog sí se arregla** (es irreversible y ocurre en el pipeline); **el orden de presentación no**: lo pisan `db` y el portal. Ver §2.b. |
| **Normalizar el volumen por percentiles del mercado** en vez del máximo del run; winsorizar outliers | 🟠 **Hecho a medias, a propósito** | Con un solo pico (1300) el resto se aplasta. Ahora el tope es el **percentil 90 del run** (`VOLUMEN_PERCENTIL_TOPE`) y todo lo que lo supera satura: eso arregla el aplastamiento. Lo que **no** se hizo es "del mercado": la escala sigue siendo relativa a cada corrida, así que los scores no son comparables entre runs. Una distribución cruzada necesita el dataset (KR-1). |
| **Estrategia hub & spoke** en el mapeo cluster→página | ⚪ No | Hoy todo es `single`. |
| **Enlazado interno** entre las páginas propuestas | ⚪ No | Hoy `enlazado_interno` sale vacío. |

---

## Deudas técnicas conocidas

| Deuda | Dónde | Impacto |
|---|---|---|
| **El secreto legacy de Supabase sigue vivo, y no se puede revocar sin migrar antes el portal** | Supabase (Project Settings → API) · `portal/src/environments/environment.prod.ts` | Con ese secreto se puede acuñar un token `service_role` que **bypassea RLS por completo** — el radio de daño no depende de que nuestra API ya no lo acepte. Pero **no se puede revocar sin más**: el `anon key` del portal es un JWT legacy firmado con él (`alg: HS256`, verificado), así que revocarlo rompe el login. Hay que migrar el portal a las claves nuevas (*publishable*), desplegar, verificar, y recién ahí revocar. Ver [12-credenciales.md](12-credenciales.md). |
| ~~**La compuerta de secretos dejaba pasar la carpeta de secretos empaquetada**~~ ✅ **cerrada (2026-08-03)** | `scripts/secretos.mts` | Dio **verde durante tres días** con `docs/private.zip` trackeado en un repo público (ver Riesgos abiertos). La causa no era que no mirara *dentro* del zip —decide por ruta, a propósito—: la regla de `docs/private/` comparaba el **segundo segmento de directorio**, y ahí `private.zip` era el **nombre del archivo**, así que ninguna regla lo miraba. Mismo error conceptual que tenía el `.gitignore`. Cerrado con dos reglas y dos tests: `docs/private*` como nombre, y **cualquier comprimido versionado** —opaco para un detector que decide por ruta—. Las dos caen por mutación. |
| **Esquema Zod duplicado** entre M2 y M1 | `kr-service/src/validation/` y `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. Extraer a paquete compartido. |
| **Estimaciones del presupuesto sin calibrar** | `lib/budget.ts` | Las **tarifas de los modelos están verificadas** ✅, pero las estimaciones por fase **siguen a ojo**. Se calibran con `datasets/keywords.json` — **que hoy no está** (ver KR-1 en §2.b): la promesa de "calibrar es gratis" depende de regenerar ese dataset. |
| **🟠 El dataset crudo del research no existe** | `datasets/keywords.json` | ✅ **El destino ya es durable** (versionado, con un test que se lo pregunta a `git check-ignore`). Lo que falta es **el dato**: el de la corrida del 2026-07-30 se perdió en `out/` y regenerarlo cuesta ~$0.31 en producción. Bloquea la **calibración** de las tres mejoras de calidad (§2.b) y la del presupuesto — ya no su implementación. |
| **El orden del pipeline no sobrevive a la persistencia** | `db/src/store.ts:715,743` · `portal/src/app/core/cartera.ts:37` | `kr-service` ordena por evidencia y confianza; la base y el portal reordenan por `opportunity_score` crudo. La columna "Confianza" del dashboard sigue sin ordenar nada. Detalle y las dos salidas, en §2.b. |
| **`gpt-4o` quedó legacy** | `config.ts` (`OPENAI_MODEL`) | Los modelos actuales son 2-3× más baratos. **Pero la corrida real bajó la urgencia**: el LLM es solo el **19%** del costo, así que el ahorro total sería de ~10%. Ver [guía 02](../historia/acciones/02-precios-modelos.md). |
| **`is_local` sigue siendo conjetura fuera de las cabezas observadas** | `pipeline/enrich-content.ts` (LLM) · `pipeline/intent.ts` (heurística) · `pipeline/local-signal.ts` | ✅ Desde el 2026-08-02 el **map pack** del SERP corrige `is_local`, pero **solo en las ~15 cabezas** cuyo SERP se paga (`serpValidateTop`). Para las otras ~45 keywords sigue decidiendo el LLM o la heurística, que sobre-detecta (53 de 60 en la corrida real). Pesa menos de lo que pesaba —es la **cabeza** la que fija el `schema_type`—, pero el dataset crudo conserva `is_local` sin validar en la mayoría de sus filas. ⚠️ **Y las páginas no están cubiertas del todo:** `max_pages` vale 25 por defecto y `serpValidateTop` 15, y como el mapeo reordena por evidencia, un cluster de la posición ≥16 con datos de mercado puede subir a página **con la cabeza sin observar**. Con 8 páginas no muerde; con más clusters compitiendo, sí. |
| **Sin tests de integración** | — | El camino live ya **se ejecutó a mano** contra DataForSEO, OpenAI y Storyblok, pero no está **automatizado**. |
| **Una rotación de Supabase a otro algoritmo daría 401, no 503** | `api/src/auth.ts` (`CODIGOS_DE_TOKEN`) | `ERR_JOSE_ALG_NOT_ALLOWED` es un código de token, así que si el proyecto pasara a RS256 todos los logins fallarían **y quemarían refresh tokens**. Hoy el JWKS sirve una sola clave ES256 (verificado). Si Supabase anuncia un cambio de algoritmo, hay que tocar `algorithms` antes, no después. |
| **Durante una caída del JWKS, cada request paga el timeout de 5 s antes de su 503** | `api/src/auth.ts` (`jwksDeSupabase`, vía `crearDeps`) | El caché vence a los 10 minutos y `_local` solo se reemplaza cuando el fetch tiene éxito, así que cada petición secuencial reintenta. Falla cerrado y es correcto, pero se lee como un cuelgue. Si molesta, el lugar para afinar `timeoutDuration`/`cacheMaxAge` es `crearDeps` — con una medición, no a ojo. |
| **El session pooler de Supabase (5432) puede rechazar la primera conexión de un rol recién usado** | `docs/private/credenciales.env` (`DATABASE_URL_*`) | Descubierto con `amg_cache`: password recién puesta y confirmada por `pg_roles`, y aun así `password authentication failed` por el session pooler — es Supavisor, no la credencial (`amg_api` seguía andando en paralelo por el mismo host). El **transaction pooler (6543)** conectó al toque. Si `amg_orquestador` o `amg_render` hacen su primera conexión real y da el mismo error, probar 6543 antes de sospechar de la password — siempre que el código solo use transacciones autocontenidas (`pool.transaction()`, sin `SET LOCAL` de sesión ni `LISTEN`, que es el caso de `PgTaskLog`). |

## Riesgos abiertos

### 🔴 Credenciales expuestas en el repositorio público · **ABIERTA (detectada 2026-08-03)**

`docs/private.zip` estuvo **commiteado en `origin/main`** desde el commit `15ae91a` (2026-08-01), y el
repositorio es público. Adentro viajaban `credenciales.env` —el maestro— y los cinco `.env` de backup
de los paquetes: `SUPABASE_JWT_SECRET`, los tres `DATABASE_URL_*`, `DATAFORSEO_PASSWORD`, las keys de
Anthropic y OpenAI, y el `STORYBLOK_MANAGEMENT_TOKEN`.

**Por qué pasó:** el `.gitignore` tenía `docs/private/` (con barra), que **no cubre** un archivo
`docs/private.zip`. Ya se corrigió, con los cuatro patrones de comprimido.

**Por qué el arnés no lo vio, y ya está tapado (2026-08-03).** `npm run verificar` daba **verde en la
compuerta de secretos** con ese archivo trackeado. La causa exacta: `scripts/secretos.mts` decide por
ruta —a propósito— y su regla de `docs/private/` comparaba el **segundo segmento de directorio**;
para `docs/private.zip` ese segmento no existe, porque `private.zip` es el nombre del archivo. Ninguna
otra regla lo miraba. **Es el mismo error conceptual que tenía el `.gitignore`**: prohibir la carpeta y
olvidar el archivo que se llama igual, en los dos lugares que tenían que atajarlo. Cerrado con dos
reglas nuevas y sus tests, verificadas por mutación (ver la deuda tachada arriba).

**Qué se hizo y qué falta.** Hecho: `git rm --cached` del zip y el `.gitignore` blindado. **Falta la
rotación**, que es la única cosa que devuelve la seguridad: el objeto sigue en el historial de GitHub
por decisión tomada —purgarlo no des-expone, porque hay forks, clones y cachés—, así que **todo lo que
estuvo en ese zip hay que tratarlo como comprometido**. La lista priorizada, con el orden por daño y
dónde se rota cada una, está en [`../../progress/current.md`](../../progress/current.md).

### 🔴 OBS-04 — Quién edita la web no lo gobierna nuestro RBAC · **ABIERTA (2026-08-01)**

Con el Visual Editor ya funcionando en producción, quedó a la vista una frontera que ningún ADR
había nombrado: **el portal y Storyblok son dos sistemas de identidad que no se cruzan.** Nuestro
RBAC se deriva de `memberships` dentro de Postgres (ADR-15); el de Storyblok son seats y permisos
por space. Nada los sincroniza, así que **quién puede reescribir la carta de un restaurante lo
decide la lista de colaboradores del space**, no `memberships`.

ADR-04 ya respondió esto entre líneas —eligió Storyblok *"para que community managers/creadoras
editen sin devs"*— pero quedó implícito, y de ahí cuelgan dos cosas que no pueden colgar de un
implícito: **el número de seats** (fijos si edita solo la agencia; uno por cliente si no) y la
cláusula de *handoff editable* de **ADR-11**, que no se puede redactar sin saber qué acceso tenía el
cliente **durante** el servicio.

Las tres salidas y la decisión adyacente —un botón *"Editar la web"* en el portal que firme el
enlace de preview al vuelo— están en
[OBS-04](../decisiones-arquitectura.md). **No urge decidirlo hoy**, pero bloquea llevar ADR-11 a un
contrato.

### ✅ OBS-01 — Solapamiento de alcance · **CERRADA (2026-07-19)**

Era el último riesgo de producto abierto. Los dos documentos describían alcances distintos
(`docs/historia/contexto-proyecto-frank.md`: 4 módulos con "Frank"; el PRD: 5 agentes con "Franco · CEO", y el
Creador de Webs "diferido a I+D"). **Decidido:**

- **Manda `docs/historia/contexto-proyecto-frank.md`.** El PRD queda como visión de largo plazo.
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

**El número de seats no se puede estimar hasta cerrar OBS-04** (arriba): si edita solo la agencia
son unos pocos y fijos; si edita cada cliente, crece con la cartera igual que los spaces.
