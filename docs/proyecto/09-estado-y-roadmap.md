# 9. Estado y roadmap

## Resumen ejecutivo

*(Actualizado 2026-07-19, al cerrar la etapa 6.)*

**La cadena completa está construida, de punta a punta y sin huecos:**

```
  prompt  →  research (M2)  →  persistencia bajo RLS  →  COMPUERTA HUMANA  →
          →  contenido (M1)  →  publicación en Storyblok  →  web servida en vivo
```

Todo lo que depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido
on-page, prose final). Todo lo que depende de aislamiento entre clientes lo impone **Postgres**, no
el código de la aplicación. Y las tres interfaces por las que pasa un humano —la API, el portal y la
web pública del cliente— **existen y se manejaron en un navegador real**.

**Lo que separa esto de estar en producción ya no es código de producto: es despliegue.** Nada corre
en ningún servidor. El hosting sigue sin decidirse (etapa 5.3). Hasta que eso ocurra, el sistema
funciona entero pero en `localhost`.

| | |
|---|---|
| **Paquetes** | 6 workspaces (`db`, `kr-service`, `web-builder`, `orchestrator`, `api`, `renderer`) + `portal/` (Angular, fuera del monorepo a propósito) |
| **Tests** | **377** en el monorepo + **29** en el portal. Los de seguridad, contra Postgres real |
| **Migraciones** | 9 (`0001`..`0009`) |
| **ADRs** | 22, más 3 observaciones (**las 3 cerradas**) |
| **Reviews externas** | 10 rondas (Codex), 17 tandas de correcciones |
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
| ✅ | **377 tests en verde** + typecheck limpio en los 6 paquetes. Los de seguridad, contra Postgres real. |
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

### 🔴 1. El despliegue (etapa 5.3) — **es lo único que bloquea de verdad**

Nada corre en ningún servidor. Son **tres procesos** de larga duración más una SPA estática:

| Qué | Puerto dev | Necesita |
|---|---|---|
| `api/` | 3000 | `DATABASE_URL_API`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISS` |
| `orchestrator/` | — | `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, Inngest |
| `renderer/` | 8080 | `DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`, `PREVIEW_SECRET` |
| `portal/` | 4200 | estático, se compila con AOT |

**La decisión de hosting sigue abierta.** Y hay una restricción que la condiciona y conviene decidir
antes: el renderizador necesita **DNS por cliente apuntando al mismo servicio** (es un `Host` →
dominio → space), más certificados TLS por dominio. Eso descarta cualquier hosting que no permita
dominios personalizados arbitrarios, y hace que "una CDN delante" deje de ser opcional (ver §3).

### 🟡 2. La demo, antes de ver a Frank

- **[Corrida final + republicar](../acciones/06-corrida-final-demo.md)** (~$0.31) — lo publicado en
  Storyblok es **anterior a `kr.v0.5`**: no muestra la evidencia etiquetada, que es *el argumento de
  venta*. Acción humana.
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

- **Tests de componente del portal** (karma). El núcleo está cubierto (29 tests) y los componentes se
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

**Todo lo que dependía de cuentas, saldo y credenciales está hecho.** Quedan dos:

| Tarea | Por qué | Costo |
|---|---|---|
| ~~Unificar el alcance (OBS-01)~~ | ✅ **Hecha (2026-07-19).** Manda ; alcance base = 3 módulos; ADR-04 se mantiene. | — |
| **[Corrida final + republicar](../acciones/06-corrida-final-demo.md)** ⚠️ | **Lo publicado en Storyblok es de ANTES de la tanda 5**: no muestra la evidencia etiquetada y 7 de 8 páginas declaran `LocalBusiness` sin serlo. Hacerlo **antes de ver a Frank**. | ~$0.31 |

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
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y **93 tests** contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`, JWT con `exp`/`aud`/`alg` impuestos. **33 tests** contra PGlite. |
| **Portal Angular** | ADR-16, ADR-21 | ✅ **Hecho** (funcional). Login + lista + brief por evidencia + compuerta doble + refresh del token + polling, y las carreras asincrónicas cerradas (`Vigencia`). **29 tests** de núcleo; el flujo, verificado en un navegador real. **Falta:** tests de componente y calibrar el polling con la duración real. |
| **Renderizador público** (la web del cliente) | ADR-19, ADR-04 | ✅ **Hecho.** `renderer/`: 1 servicio, N dominios. Hono, lee la Content Delivery API y sirve `renderStory()`. Cache con invalidación por webhook firmado, preview firmado + Bridge para el Visual Editor, y el rol de BD más pobre del sistema (`app_render`, sin escritura). Endurecido tras la 10ª review (límites del camino anónimo, timeouts de BD, replay). **78 tests**; **verificado contra el Storyblok REAL** con `npm run demo -w renderer`. **Falta:** desplegarlo en un dominio (5.3) y una CDN delante. |
| **Diseño de las webs** (marca + imágenes) | ADR-04, ADR-11 | ✅ **Hecho.** Tema por tenant (color/fuente/logo desde `business_profile.brand`, allowlist en `0009`) → cada web se ve **propia**. Imágenes editables en los bloks `hero`/`section` (campos `asset`) → el cliente las sube en el Visual Editor. Validación anti-inyección en tres capas. **Falta (deuda):** navegación entre páginas + una `home` real (hoy son landing pages sueltas), y republicar pisa las imágenes que suba el cliente. |
| **La costura publish→serve** (`fromStoryblokContent`) | ADR-19 | ✅ **Hecho.** El contenido que Storyblok guarda está **aplanado** y `renderStory` esperaba la forma anidada → daba 503. Lo cazó la demo, no un test (era OBS-03: nadie leía de vuelta lo publicado). Adaptador inverso + tests de ida-y-vuelta. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno — ahora **cuatro**: `amg_api`, `amg_orquestador`, `amg_cache` y `amg_render`. El JWT de Supabase **ya está enchufado y probado** (12 tests con tokens firmados de verdad). |
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
| **Esquema Zod duplicado** entre M2 y M1 | `kr-service/src/validation/` y `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. Extraer a paquete compartido. |
| **Estimaciones del presupuesto sin calibrar** | `lib/budget.ts` | Las **tarifas de los modelos están verificadas** ✅ y ahora **hay datos reales** para calibrar las estimaciones por fase, pero todavía **no se aplicaron**: siguen a ojo. Se calibran con `out/keywords.json`, gratis. |
| **`gpt-4o` quedó legacy** | `config.ts` (`OPENAI_MODEL`) | Los modelos actuales son 2-3× más baratos. **Pero la corrida real bajó la urgencia**: el LLM es solo el **19%** del costo, así que el ahorro total sería de ~10%. Ver [guía 02](../acciones/02-precios-modelos.md). |
| **`is_local` se dispara de más** | `pipeline/enrich-content.ts` | 53 de 60 keywords → casi todo sale `LocalBusiness`. Ensucia el JSON-LD. |
| **Sin tests de integración** | — | El camino live ya **se ejecutó a mano** contra DataForSEO, OpenAI y Storyblok, pero no está **automatizado**. |

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
