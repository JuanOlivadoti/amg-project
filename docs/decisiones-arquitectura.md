# Registro de decisiones de arquitectura (ADR) — AMG OS

> Log de decisiones técnicas y de producto: **qué se decidió, qué se descartó y por qué**.
> Cada decisión se numera (ADR-XX). Si una se revierte, se marca *Reemplazada por ADR-YY*.
> Versión 1.0 — 2026-07-08

## Índice
| # | Decisión | Estado |
|---|---|---|
| ADR-01 | Núcleo de datos + identidad: **Supabase** | Aceptada |
| ADR-02 | Frontend: **Next.js + TypeScript + Tailwind + shadcn/ui** | Aceptada |
| ADR-03 | Orquestación: **Inngest** en código, n8n solo como glue | Aceptada |
| ADR-04 | CMS del Módulo 1 (Creador de Webs): **Storyblok** | Aceptada (a confirmar por flujo de edición) |
| ADR-05 | Motor de datos del Módulo 2 (Keyword Research): **DataForSEO** | Aceptada |
| ADR-06 | Compuerta de aprobación humana entre Módulo 2 y Módulo 1 | Aceptada |
| ADR-07 | Output del Módulo 2: **JSON + informe legible** | Aceptada |
| ADR-08 | Mercado del Módulo 2: **ES-first, diseño market-aware** | Aceptada |
| ADR-09 | LLM: **proveedor abstracto** (OpenAI/Anthropic); embeddings OpenAI | Aceptada |
| ADR-10 | Endurecimiento del esquema del Módulo 2 (post-review) | Aceptada |
| ADR-11 | Política de salida/offboarding de webs de cliente | Aceptada |
| OBS-01 | Solapamiento de alcance entre los dos documentos (Frank ≈ Franco) | Abierta — riesgo |
| OBS-02 | El rol y el `client_id` los declara el caller, no `memberships` | Abierta — riesgo de seguridad |

---

## ADR-01 — Núcleo de datos + identidad: Supabase
**Contexto.** El PRD exige multi-tenancy con aislamiento, RBAC (Maestro/Equipo/Cliente), alertas casi en tiempo real, RAG por cliente, object storage (para salir del Drive de clave única) y offboarding en <5 min.
**Decisión.** Usar **Supabase** como núcleo: Postgres + Row Level Security (multi-tenant), Auth (RBAC), Realtime (alertas), pgvector (RAG), Storage (objetos).
**Alternativas descartadas.** Ensamblar servicios separados (Auth0 + RDS + Pinecone + S3 + Pusher): más piezas, más costo, más integración.
**Justificación.** Un solo Postgres resuelve 5 requisitos a la vez → menor costo de desarrollo y presupuesto por fases defendible frente al cliente. Aislamiento vía RLS por `tenant_id`.

## ADR-02 — Frontend: Next.js + TypeScript + Tailwind + shadcn/ui
**Contexto.** El PRD pide SPA responsive, portal de cliente, tablero tipo Trello, mensajería y dashboards.
**Decisión.** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui; `@supabase/ssr` para sesión y RLS desde el cliente.
**Justificación.** SSR/RSC donde importa SEO (portal), componentes rápidos sin licencias de UI, un solo lenguaje de punta a punta.

## ADR-03 — Orquestación en código (Inngest/Trigger.dev); n8n solo como glue
**Contexto.** El PRD proponía **n8n como "motor de automatización" de todo**. Al revisarlo: el proyecto tiene multi-tenancy, compuerta de aprobación humana (pausar→esperar→reanudar), orquestación de agentes con RAG y exigencia de trazabilidad de IA.
**Decisión.** El **backbone de orquestación va en código** con un motor durable (**Inngest** o **Trigger.dev**). n8n queda **degradado a capa de integración/glue** (polling GBP, Metricool, WhatsApp, email) y prototipado rápido.
**Alternativas descartadas.** n8n como columna vertebral: los flujos son JSON en una DB → no se versionan bien, no se testean, no se revisan como código; su multi-tenancy es frágil; sus nodos de IA son limitados.
**Justificación.** Flujos como código = versionables, testeables, con reintentos e idempotencia; `waitForEvent` resuelve la compuerta humana con elegancia; observabilidad y trazabilidad de serie. Coherente con el principio de "coste predecible / self-host" que ya motivó elegir n8n en el PRD.
**Elegido: Inngest** (confirmado usuario, 2026-07-08). Motivos: menos infra sobre Next.js/Vercel, `waitForEvent` para la compuerta humana, control nativo de concurrencia/throttle (útil para los rate limits de DataForSEO), time-to-first-run corto. *Fallback:* Trigger.dev self-host si la soberanía del dato se vuelve requisito duro.

## ADR-04 — CMS del Módulo 1 (Creador de Webs): Storyblok
**Contexto.** El flujo objetivo es: keyword research → crear página automática con SEO → **editar páginas sin depender de desarrolladores**. El trabajo previo de Juan estaba sobre WordPress/Elementor; el usuario pidió la mejor solución aunque haya cosas hechas.
**Decisión.** **Storyblok** (headless + Visual Editor) como CMS de los sitios generados, renderizados con Next.js.
**Alternativas evaluadas.**
- *WordPress/Elementor*: el JSON serializado de Elementor es opaco y frágil para generación por IA. Descartado.
- *Payload CMS* (open-source, self-host): superior en costo/soberanía y coherencia de stack, **pero** su edición es por formularios, no visual sobre el lienzo. Pierde contra el requisito de edición por no-técnicos.
- *Builder.io*: aún más orientado a generación visual + IA, pero más caro y con más lock-in.
**Justificación.** Storyblok cumple los tres requisitos sin compromiso: Management API para creación programática, contenido estructurado (buen target para el LLM), campos SEO nativos y **Visual Editor** para que community managers/creadoras editen sin devs. Dos razones adicionales que confirmaron la decisión (usuario, 2026-07-08):
- **Menor mantenimiento:** WordPress implica actualizaciones/plugins/seguridad por sitio → trabajo recurrente que contradice la tesis del PRD (reducir coste por cliente, escalar sin crecer el equipo). Headless + Next.js no tiene ese peaje.
- **SEO + buscadores IA (AEO/GEO):** la tesis del producto es atacar SEO y la conexión con IA (creación *y* buscadores IA: AI Overviews, ChatGPT Search, Perplexity). Headless + Next.js es superior para esto: datos estructurados/JSON-LD impecables, HTML semántico, Core Web Vitals top, contenido machine-readable vía API. El mismo pipeline (keyword research → contenido con SEO) deja la web lista para ser citada por buscadores IA. El Módulo 2 ya emite `schema_type` y FAQs con este fin.
**Implicancia de diseño (frontend).** El frontend Next.js debe construirse *AI-search-first*: JSON-LD por tipo de página, sitemaps, HTML semántico, `llms.txt`, entidades limpias.
**Costo/atención.** Precio por space/seat crece con la cartera → contemplar en la propuesta a Frank (lo absorbe la agencia o se traslada al cliente). El lock-in de headless (frontend separado del contenido) se gestiona con la política de salida → ver **ADR-11**.
**Estado.** Confirmada. Descartado reabrir WordPress.

## ADR-05 — Motor de datos del Módulo 2: DataForSEO
**Contexto.** El doc original del Módulo 2 eligió SEMrush. Se reevaluó por costo y por ser un pipeline programático.
**Decisión.** **DataForSEO** (Labs + Keywords Data + SERP) como fuente de volumen/dificultad/CPC/tendencia/SERP.
**Alternativas descartadas.** *SEMrush API* (requiere plan Business ~450€+/mes + créditos, más caro); *Google Ads API* (gratis pero con fricción de developer token/OAuth y volúmenes en rangos); *Ahrefs API* (premium, costo alto).
**Justificación.** Pay-as-you-go barato por consulta, pensado para automatización a escala; agrega datos de Google Ads + SERP + related. El costo de API lo paga Frank y se documenta.

## ADR-06 — Compuerta de aprobación humana entre Módulo 2 y Módulo 1
**Contexto.** ¿El pipeline research→web corre 100% automático o con revisión humana?
**Decisión.** **Compuerta de aprobación humana**: el research genera el brief, un humano lo revisa/edita y recién ahí se dispara la creación de webs.
**Justificación.** Coherente con la "compuerta humana" del PRD; ninguna acción irreversible (publicar) sin confirmación; menor riesgo de publicar research equivocado.

## ADR-07 — Output del Módulo 2: JSON + informe legible
**Decisión.** Doble entregable: **JSON estructurado** (alimenta al Módulo 1) + **informe legible** (Markdown→PDF) para revisión humana.
**Alternativas descartadas.** Solo JSON (sin entregable de revisión); JSON + dashboard interactivo (más esfuerzo — queda como opción para F3).

## ADR-08 — Mercado del Módulo 2: ES-first, diseño market-aware
**Contexto.** Se evaluó multi-idioma/internacional; se decidió acotar el arranque.
**Decisión.** Arrancar **solo con España (es-ES), un mercado por corrida**, con el mercado **parametrizado** (`country`/`language_code`/`location_code`), no hardcodeado.
**Justificación.** Sumar otro idioma después es trivial (pasar otro `market`), no una reescritura, **siempre que** se use un modelo de **embeddings multilingüe** desde el v0 y no se mezclen idiomas en un cluster.
**Pieza a respetar desde ya.** Embeddings multilingües (evita que el multi-idioma se vuelva una desviación grande).

## ADR-09 — LLM: proveedor abstracto (OpenAI / Anthropic), embeddings con OpenAI
**Decisión.** El LLM va detrás de una **interfaz intercambiable** (`TextGen` + `Embedder`), igual que DataForSEO. Implementaciones: `mock` (sin key), `openai`, `anthropic`. Se elige por `LLM_PROVIDER` o autodetección por key.
- **Generación** (seeds, briefs): OpenAI (`gpt-4o` por default) o Claude Opus 4.8 — ambos válidos.
- **Embeddings** (clustering): **OpenAI `text-embedding-3-small`** (multilingüe, barato). Motivo decisivo: **Anthropic no tiene API de embeddings propia** (recomienda Voyage AI, un tercero).
- **Clasificación** (intención, copys cortos): modelo económico (Haiku 4.5 o `gpt-4o-mini`).
**Cambio respecto a v1.** Antes fijaba Claude Opus+Haiku (ADR original). Se reabrió a pedido del usuario (usar OpenAI) y se resolvió con abstracción → no quedamos casados con ningún proveedor.
**Justificación.** Mantiene el criterio del PRD (gama alta + económico), suma flexibilidad de proveedor y resuelve el hueco de embeddings de Anthropic. Costo de LLM lo paga Frank vía su cuenta.

## ADR-10 — Endurecimiento del esquema del Módulo 2 (post-review Codex)
**Contexto.** Una revisión externa (Codex) del esquema tipo v0 encontró riesgos de fondo antes de construir.
**Decisiones adoptadas (esquema v0.2).**
- **1 run = 1 market** (confirmado); `project_run_id` para agrupar corridas en el futuro multi-market.
- **`tenant_id` + policy RLS de aislamiento en TODAS las tablas** de tenant (no solo `enable`), con tests RLS antes de F1.
- **Cache split y solo service-role:** `kr_metrics_cache` / `kr_serp_cache` con keys completas (endpoint/engine/device/serp_type/depth/`expires_at`) y RLS deny-all.
- **Idempotencia real:** tabla `kr_provider_tasks` (`payload_hash`, `provider_task_id`, `attempt`, coste).
- **FKs y CHECKs** (status/intent/page_type/rangos); **HNSW parcial** en vez de ivfflat.
- **`business_relevance` como gate/cap** (no peso blando); **`score_confidence`** y tratamiento explícito de nulls.
- **Intención sin compuestos:** `intent` (5 valores) + flag `is_local`.
- **`schema_version`** en el brief; validación con Zod recomendada.
- **Coste en micros** (`cost_micros_usd`); **presupuesto preflight** que bloquea antes de gastar.
- **RGPD reforzado** para prompts/trazas LLM; **contrato editorial/legal** (`claims_permitidos/prohibidos`) en el brief.
**Diferido a implementación/post-pruebas.** Normalización de scoring por percentiles, algoritmo fino de SERP-overlap ponderado, lógica hub/spoke, tuning de índices. Se calibra con datos reales en la Fase 0.

## ADR-11 — Política de salida/offboarding de webs de cliente
**Contexto.** En headless, "una web" = contenido (Storyblok) + frontend (Next.js). Entregar solo el space de Storyblok NO deja una web funcionando: falta el render. Hay que definir qué se lleva un cliente al darse de baja.
**Decisión.**
- **Salida por defecto (incluida): snapshot estático.** Build estático (Next.js SSG export) de las páginas del cliente → HTML/CSS/JS plano, hosteable en cualquier lado, sin dependencia de AMG OS ni de Storyblok. Web **online pero congelada** (sin edición).
- **Salida editable (extra, pago): handoff completo.** Transferir el space de Storyblok a la cuenta del cliente + entregar/hostear el frontend Next.js + el cliente asume la suscripción de Storyblok. Dos variantes: (b1) el cliente lo hostea (requiere perfil técnico) o (b2) AMG lo hostea por una tarifa ("salida gestionada").
**Alternativas descartadas.** "Entregar solo el space de Storyblok y ya está" → insuficiente (no hay web renderizada). Migrar a WordPress en la baja → descartado junto con ADR-04 por mantenimiento.
**Justificación.** La clientela (restaurantes, no técnica) mayoritariamente quiere que su web no se caiga, no seguir maquetando. El snapshot cubre eso con coste casi nulo; el handoff editable se cobra y protege la relación.
**Implicancia de diseño (día 1).** (1) **Un space de Storyblok por cliente** (no compartido) → transferencia limpia. (2) **Frontend por-tenant exportable** (config/tema por tenant, no hardcodeado) → snapshot estático de un solo cliente trivial. (3) Capacidad de **export estático** en el frontend.
**Pendiente comercial.** Reflejar en el contrato: la web es servicio recurrente; snapshot incluido, handoff editable con tarifa.

---

## OBS-01 — Solapamiento de alcance entre los dos documentos (riesgo, no decisión)
**Observación.** `contexto-proyecto-frank.md` describe "Frank, cliente de la agencia" con 4 módulos; `A_PRD_AMG_Madrid_v1_Ilustrado.md` tiene sponsor "Franco · CEO" con 5 agentes y prioridades distintas. **Frank ≈ Franco es casi con seguridad la misma persona/proyecto**, con framings que no cierran (p. ej. el Creador de Webs es "Módulo 1 avanzado" en un doc y "web-por-prompt diferido a I+D / O10" en el otro).
**Riesgo.** Presupuestar o presentar dos alcances incompatibles al mismo cliente.
**Acción pendiente.** Unificar en un **único alcance coherente por fases** antes de consolidar la propuesta comercial. Confirmar con Juan el estado real del Creador de Webs.

## OBS-02 — El rol y el `client_id` los declara el caller, no `memberships` (riesgo abierto)

**Contexto.** Las políticas RLS leen el rol y el cliente del contexto de la petición
(`app.current_role()`, `app.current_client_id()`), que hoy **pone la aplicación** al abrir la
transacción (`PgStore.withTenant`). La tabla `memberships` existe y tiene los datos correctos, pero
**no participa en ninguna decisión de autorización**.

**Por qué es aceptable HOY.** El único caller es backend de confianza (el CLI, y pronto el
orquestador). No hay ninguna ruta por la que un usuario final influya ese contexto.

**Por qué NO es suficiente.** Es una autoridad declarada, no verificada. Cualquier ruta futura que
permita influir el contexto —un endpoint HTTP que tome el rol de un header, un job que reciba
parámetros sin validar— convierte esto en escalada de privilegios directa: basta con declararse
`maestro`.

**Decisión pendiente (al integrar Supabase Auth).** Derivar rol y cliente **dentro de Postgres**,
desde `auth.uid()` + una fila real de `memberships`:

```sql
create or replace function app.current_role() returns text
language sql stable as $$
  select m.rol::text from memberships m
  where m.user_id = auth.uid() and m.tenant_id = app.current_tenant_id()
$$;
```

Las **políticas no cambian**: por eso se las hizo pasar por funciones de `app` en vez de leer la
variable de sesión directamente. Para los jobs del backend (Inngest) se usa el rol `servicio`, con
una identidad de servicio explícita y separada de la de las personas.

**Mitigación ya aplicada.** Las políticas **fallan cerrado**: una allowlist positiva de roles, así
que un rol ausente o inventado no ve nada (antes, `NULL IS DISTINCT FROM 'cliente'` era `true` y
concedía visibilidad de maestro sobre toda la cartera). El rol `cliente` es de **solo lectura** y no
puede tocar `memberships`.
