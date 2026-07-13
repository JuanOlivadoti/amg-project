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
| ✅ | 42 tests unitarios en verde + typecheck limpio en ambos módulos. |
| ✅ | Hallazgos de seguridad y correctitud de la review externa: **corregidos** (Tandas 1 y 2). |

## Lo que hay que entender antes de mostrarlo

**El research corre contra el *sandbox* de DataForSEO**, que devuelve **datos ficticios**. Por eso
el spike siempre arroja ~1 cluster / 1 página y coste $0. Los volúmenes y la dificultad **no son
reales**.

Esto no es un bug: es la decisión de validar la integración sin gastar. Pero significa que, para
una demo que aguante preguntas del cliente (*"¿esta keyword tiene 2.400 búsquedas/mes?"*), hay que
pasar a producción. Es un cambio de **una variable de entorno** + cargar saldo (~50 USD).

---

## Roadmap

### Paso inmediato (bajo esfuerzo, alto impacto en la demo)

| Tarea | Por qué | Bloqueante |
|---|---|---|
| **Pasar DataForSEO a producción** | Volúmenes, KD y clusters reales; medir el **costo real por research** (dato necesario para la propuesta comercial). | Cargar saldo (~50 USD). |
| **Rotar la API key de OpenAI** y separar por servicio | Hallazgo #2 de la review. | Acción humana en el dashboard. |
| **Probar Storyblok live** | Demostrar la edición visual — es *el* argumento de venta del CMS headless (ADR-04). | Crear un space gratis + token. |

### Tanda 3 — PROD-readiness

Los hallazgos de la review externa que quedan. **Encajan naturalmente con envolver el pipeline en
Inngest** ([ADR-03](../decisiones-arquitectura.md)): retries, timeouts, idempotencia y checkpoints
son justamente lo que aporta un orquestador durable. Conviene hacerlo como **fase propia**.

| # | Pendiente | Detalle |
|---|---|---|
| **#11** | **Timeouts, retries y backoff** | Hoy los `fetch` no tienen `AbortSignal`; un 429 de DataForSEO o Storyblok falla de inmediato. Falta clasificar errores retryables y respetar `Retry-After`. Además, **un solo fallo de SERP aborta toda la corrida** de clustering (a diferencia del enriquecimiento, que degrada parcialmente). |
| **#12** | **Idempotencia** | Dos ejecuciones concurrentes pueden crear stories duplicadas en Storyblok (se consulta y luego se crea, sin lock). Y los **`_uid` se regeneran en cada update**, destruyendo la identidad estable de los bloks y complicando la edición manual. Necesita un identificador externo estable por página/run. |
| **#5** | **Presupuesto preflight** | `options.max_cost_micros` **existe en los tipos pero no se aplica**. Debe estimar el costo antes de cada fase y **bloquear** si excede. Además, el costo reportado **solo cuenta DataForSEO**: falta sumar OpenAI/Anthropic. |
| **#6** | **`AnthropicContentGen`** | Cerrar la fuga de la abstracción (hoy `LLM_PROVIDER=anthropic` degrada a mock en intención/relevancia/contenido). |

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
| **Coste del LLM no medido** | `meta_run.coste_micros_usd` | La cifra de costo por research está incompleta → afecta la propuesta comercial. |
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
