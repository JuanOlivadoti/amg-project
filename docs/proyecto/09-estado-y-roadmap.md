# 9. Estado y roadmap

## Resumen ejecutivo

**La cadena completa `prompt → research → web publicable` funciona end-to-end.** Todo lo que
depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido on-page,
prose final). La arquitectura está preparada para producción, no es un prototipo desechable.

**Persistencia multi-tenant, orquestación durable e idempotencia del gasto: hechas.** Lo que falta
para que lo use alguien que no sea yo es la **API + el portal**: hoy la compuerta de aprobación
(ADR-06) **se ejecuta editando un JSON a mano**. Ver el [Plan de la Fase 2](11-plan-fase-2.md).

## Qué funciona hoy

| | |
|---|---|
| ✅ | Pipeline M2 completo: prompt → brief SEO validado + informe legible. |
| ✅ | Pipeline M1 completo: brief → stories Storyblok + preview HTML con JSON-LD válido. |
| ✅ | Providers abstractos: todo corre **sin credenciales** en modo mock. |
| ✅ | Compuerta de aprobación humana (global + por página). |
| ✅ | **Research real contra DataForSEO producción**: 52 keywords → 8 páginas, **$0.31 por research**. |
| ✅ | **8 páginas publicadas en vivo en Storyblok**, con contenido redactado por IA. |
| ✅ | JSON-LD validado en el Rich Results Test de Google (`LocalBusiness` + `FAQPage`, sin errores). |
| ✅ | **Costo completo del research** (DataForSEO + LLM) con desglose, y **presupuesto preflight** que aborta antes de gastar. |
| ✅ | **Resiliencia**: timeouts, reintentos con backoff y `Retry-After` — **probados contra un 429 real de Storyblok**. |
| ✅ | **Idempotencia**: republicar produce los mismos `story:` IDs, cero duplicados. Verificado en vivo. |
| ✅ | **248 tests en verde** + typecheck limpio en los 5 paquetes. Los de seguridad, contra Postgres real. |
| ✅ | **Cinco reviews externas (Codex): todos los hallazgos, corregidos.** Varias de las brechas eran suposiciones MÍAS que Postgres no cumplía (o afirmaciones de seguridad **falsas** que documenté y el código desmentía). Ver [ADR-13..21 y el registro de correcciones](../decisiones-arquitectura.md). |

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

## Roadmap

### 🔴 Lo que depende de Juan

**Todo lo que dependía de cuentas, saldo y credenciales está hecho.** Quedan dos:

| Tarea | Por qué | Costo |
|---|---|---|
| **[Unificar el alcance (OBS-01)](../acciones/05-unificar-alcance.md)** | Evitar presentarle al cliente dos alcances incompatibles. Es una charla, no código. | gratis |
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
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y 54 tests contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`. 21 tests contra PGlite. |
| **Portal Angular** | ADR-16, ADR-21 | ⏳ **Casi cerrado.** Login + lista + brief con evidencia + compuerta doble + **refresh del token** + **polling** del research en curso. 19 tests de núcleo (node:test). Falta: tests de componente y calibrar el intervalo de polling con la duración real. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno. Falta solo enchufar el JWT de Supabase (la función ya está aislada). |
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

### OBS-01 — Solapamiento de alcance (riesgo de producto, no técnico)

Los dos documentos de producto describen alcances distintos: `contexto-proyecto-frank.md` habla de
4 módulos con "Frank, cliente de la agencia"; el PRD tiene sponsor "Franco · CEO" con 5 agentes y
prioridades diferentes (el Creador de Webs es "Módulo 1 avanzado" en uno y "diferido a I+D" en el
otro).

**Casi con seguridad son la misma persona/proyecto**, pero con framings que no cierran.
**Hay que unificar en un único alcance coherente por fases antes de consolidar la propuesta
comercial**, o se corre el riesgo de presentarle al cliente dos alcances incompatibles.

Registrado en [decisiones de arquitectura](../decisiones-arquitectura.md).

### Costo de Storyblok

El precio por space/seat crece con la cartera de clientes (ADR-04 exige **un space por cliente**
para un offboarding limpio). Hay que contemplarlo en la propuesta: lo absorbe la agencia o se
traslada al cliente.
