# 9. Estado y roadmap

## Resumen ejecutivo

**La cadena completa `prompt → research → web publicable` funciona end-to-end.** Todo lo que
depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido on-page,
prose final). La arquitectura está preparada para producción, no es un prototipo desechable.

**No está en producción todavía.** Faltan tres cosas grandes: datos reales de DataForSEO,
orquestación durable (Inngest) con persistencia, y el frontend.

## Qué funciona hoy

| | |
|---|---|
| ✅ | Pipeline M2 completo: prompt → brief SEO validado + informe legible. |
| ✅ | Pipeline M1 completo: brief → stories Storyblok + preview HTML con JSON-LD válido. |
| ✅ | Providers abstractos: todo corre **sin credenciales** en modo mock. |
| ✅ | Compuerta de aprobación humana (global + por página). |
| ✅ | Autenticación DataForSEO verificada contra sandbox (`status_code: 20000`). |
| ✅ | JSON-LD validado en el Rich Results Test de Google (`LocalBusiness` + `FAQPage`, sin errores). |
| ✅ | **Costo completo del research** (DataForSEO + LLM) con desglose, y **presupuesto preflight** que aborta antes de gastar. |
| ✅ | **Resiliencia**: timeouts, reintentos con backoff y `Retry-After`; degradación parcial ante fallos de SERP. |
| ✅ | **Idempotencia**: `_uid` deterministas y publicación sin duplicados ante carreras. |
| ✅ | 71 tests unitarios en verde + typecheck limpio en ambos módulos. |
| ✅ | **Los 18 hallazgos de la review externa: corregidos** (salvo #2, secretos → acción humana). |

## Lo que hay que entender antes de mostrarlo

**El research corre contra el *sandbox* de DataForSEO**, que devuelve **datos ficticios**. Por eso
el spike siempre arroja ~1 cluster / 1 página y coste $0. Los volúmenes y la dificultad **no son
reales**.

Esto no es un bug: es la decisión de validar la integración sin gastar. Pero significa que, para
una demo que aguante preguntas del cliente (*"¿esta keyword tiene 2.400 búsquedas/mes?"*), hay que
pasar a producción. Es un cambio de **una variable de entorno** + cargar saldo (~50 USD).

---

## Roadmap

### 🔴 Paso inmediato: DEPENDE DE JUAN (no de código)

**Todo el trabajo de código que se podía hacer sin cuentas ni saldo está hecho.** Lo que sigue
requiere acción humana. Está detallado con pasos exactos en
**[Acciones pendientes](10-acciones-pendientes.md)**:

| Tarea | Por qué | Costo |
|---|---|---|
| **Rotar la API key de OpenAI** | Hallazgo #2 de la review — el único que sigue abierto. | gratis |
| **Confirmar los precios de los modelos** | Las tarifas del código son aproximadas → el costo por research todavía no es confiable para una propuesta. | gratis |
| **Un research de prueba en producción (DataForSEO)** | Volúmenes/KD/clusters reales + el **costo real por research**, y me permite calibrar las estimaciones del presupuesto. | ~50 USD |
| **Space de Storyblok (gratis)** | Probar el camino live y demostrar la **edición visual** — es *el* argumento de venta del CMS (ADR-04). | gratis |
| **Unificar el alcance (OBS-01)** | Evitar presentarle al cliente dos alcances incompatibles. | gratis |

### Tanda 3 — PROD-readiness ✅ COMPLETA

| # | Hecho | Qué cambió |
|---|---|---|
| ✅ **#5** | Costo completo + presupuesto preflight | El costo suma DataForSEO + LLM (con desglose) y `max_cost_micros` **aborta antes de gastar**. Contrato `kr.v0.3`. |
| ✅ **#11** | Timeouts, retries y backoff | `lib/http.ts`: timeout por intento, backoff exponencial + jitter, `Retry-After`, 429/5xx reintentables y 4xx no. El clustering **ya no aborta** por un fallo de SERP. |
| ✅ **#12** | Idempotencia | `_uid` **deterministas** (misma página → mismos uids entre corridas) y **upsert** que resuelve la carrera de creación sin duplicar stories. |
| ✅ **#6** | `AnthropicContentGen` | Los tres proveedores implementan la misma interfaz: cambiar de proveedor ya **no degrada capacidades**. |

**Lo que queda del código está listo para envolverse en Inngest**
([ADR-03](../decisiones-arquitectura.md)): retries, idempotencia y presupuesto ya existen, que era
justo lo que un orquestador durable necesita como base.

> ⚠️ **Pendiente de calibración:** las tarifas de los modelos y las estimaciones por fase del
> presupuesto son **aproximadas**. Ver [Acciones pendientes](10-acciones-pendientes.md).

### Fase 2-3 — Plataforma

| Pieza | ADR | Nota |
|---|---|---|
| **Persistencia + multi-tenancy** (Supabase, RLS por `tenant_id`) | ADR-01, ADR-10 | Incluye tests de RLS **antes** de la Fase 1, cache de métricas/SERP con `expires_at`, y tabla de idempotencia de tareas del proveedor. |
| **Orquestación con Inngest** | ADR-03 | `waitForEvent` para la compuerta humana; control de concurrencia para los rate limits de DataForSEO. |
| **Frontend Next.js** | ADR-02, ADR-04 | Portal + render de las webs de cliente desde Storyblok, *AI-search-first*. |
| **Export estático / offboarding** | ADR-11 | Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |

### Mejoras de calidad del research (necesitan datos reales)

- **Señales de SERP para `is_local`** (presencia de *map pack*) en vez de inferirlo por LLM/heurística.
- **Normalizar el volumen por percentiles del mercado** en vez del máximo del run; winsorizar outliers.
- **Estrategia hub & spoke** en el mapeo cluster→página (hoy todo es `single`).
- **Enlazado interno** entre las páginas propuestas (hoy `enlazado_interno` sale vacío).

---

## Deudas técnicas conocidas

| Deuda | Dónde | Impacto |
|---|---|---|
| **Esquema Zod duplicado** entre M2 y M1 | `kr-service/src/validation/` y `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. Extraer a paquete compartido. |
| **Tarifas y estimaciones de costo sin calibrar** | `lib/cost.ts`, `lib/budget.ts` | El *mecanismo* de costo/presupuesto está hecho, pero las **tarifas de los modelos son aproximadas** y las estimaciones por fase son a ojo. **Confirmar precios y calibrar con una corrida real** antes de usar el número en la propuesta. |
| **Sin tests de integración** | — | El camino live (DataForSEO, OpenAI, Storyblok) no está cubierto. |
| **Storyblok live sin probar** | `publish/storyblok-publisher.ts` | Código escrito y typechequeado, nunca ejecutado contra un space real. |

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
