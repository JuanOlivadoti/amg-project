# Registro de decisiones de arquitectura (ADR) — AMG OS

> Log de decisiones técnicas y de producto: **qué se decidió, qué se descartó y por qué**.
> Cada decisión se numera (ADR-XX). Si una se revierte, se marca *Reemplazada por ADR-YY*.
> Versión 1.0 — 2026-07-08

## Índice
| # | Decisión | Estado |
|---|---|---|
| ADR-01 | Núcleo de datos + identidad: **Supabase** | Aceptada |
| ADR-02 | Frontend: **Next.js + TypeScript + Tailwind + shadcn/ui** | ⚠️ Reemplazada por **ADR-16** |
| ADR-03 | Orquestación: **Inngest** en código, n8n solo como glue | Aceptada |
| ADR-04 | CMS del Módulo 1 (Creador de Webs): **Storyblok** | Aceptada · el render ya no es Next (ADR-16); lo sirve **ADR-19** |
| ADR-05 | Motor de datos del Módulo 2 (Keyword Research): **DataForSEO** | Aceptada |
| ADR-06 | Compuerta de aprobación humana entre Módulo 2 y Módulo 1 | Aceptada |
| ADR-07 | Output del Módulo 2: **JSON + informe legible** | Aceptada |
| ADR-08 | Mercado del Módulo 2: **ES-first, diseño market-aware** | Aceptada |
| ADR-09 | LLM: **proveedor abstracto** (OpenAI/Anthropic); embeddings OpenAI | Aceptada |
| ADR-10 | Endurecimiento del esquema del Módulo 2 (post-review) | Aceptada |
| ADR-11 | Política de salida/offboarding de webs de cliente | ⚠️ **Hay que reescribirla** en términos de ADR-19 antes de llevarla a un contrato |
| ADR-12 | Orquestador durable (Inngest): el evento dispara, la base decide | Aceptada |
| ADR-13 | El acceso a la base es SOLO por transacción con conexión reservada | Aceptada |
| ADR-14 | Idempotencia por `payload_hash` (con registro durable OBLIGATORIO en prod) + método Standard donde se puede (SERP/SV) | Aceptada · ampliada 2026-07-15 |
| ADR-15 | El rol no se declara: se deriva de `memberships` | Aceptada (cierra OBS-02) |
| ADR-16 | Portal en **Angular + Tailwind** (reemplaza ADR-02) | Aceptada |
| ADR-17 | **Un proceso, un login, un rol**: la separación la impone Postgres | Aceptada (corrige ADR-15) |
| ADR-18 | Un evento no porta autoridad: la API crea el run, el evento lo dispara | Aceptada |
| ADR-19 | **Renderizador propio en runtime**, multi-tenant (1 servicio, N dominios) | Aceptada · ✅ **implementada** en `renderer/` (etapa 6) |
| ADR-20 | El portal **también sirve al cliente, en modo lectura** (amplía ADR-16) | Aceptada |
| ADR-21 | **El stack del portal, cerrado**: solo habla con nuestra API · polling · Tailwind puro · standalone+signals | Aceptada (completa ADR-16) |
| ADR-22 | **La API en Hono**: comandos compuestos (fila bajo RLS → después el evento), auth = JWT + RLS | Aceptada (implementa 5.1) |
| OBS-01 | Solapamiento de alcance entre los dos documentos (Frank ≈ Franco) | Abierta — riesgo |
| OBS-02 | El rol y el `client_id` los declara el caller, no `memberships` | ✅ **CERRADA** por ADR-15 |
| OBS-03 | Nadie publica la web del cliente: ADR-16 quitó Next y no puso nada en su lugar | ✅ **CERRADA** por ADR-19 |

---

## ADR-01 — Núcleo de datos + identidad: Supabase
**Contexto.** El PRD exige multi-tenancy con aislamiento, RBAC (Maestro/Equipo/Cliente), alertas casi en tiempo real, RAG por cliente, object storage (para salir del Drive de clave única) y offboarding en <5 min.
**Decisión.** Usar **Supabase** como núcleo: Postgres + Row Level Security (multi-tenant), Auth (RBAC), Realtime (alertas), pgvector (RAG), Storage (objetos).
**Alternativas descartadas.** Ensamblar servicios separados (Auth0 + RDS + Pinecone + S3 + Pusher): más piezas, más costo, más integración.
**Justificación.** Un solo Postgres resuelve 5 requisitos a la vez → menor costo de desarrollo y presupuesto por fases defendible frente al cliente. Aislamiento vía RLS por `tenant_id`.

> ### ⚠️ Actualización (2026-07-14) — dos piezas de esta decisión ya no valen
>
> **Vigente:** Postgres, RLS, Auth (como **identidad**), pgvector y Storage.
>
> | Lo que decía | Lo que vale hoy |
> |---|---|
> | *"Auth **(RBAC)**"* | Supabase Auth aporta **autenticación e identidad**. El **RBAC lo resuelven Postgres y `memberships`** (**ADR-15**): el rol no viene del token, se **deriva** en la base. Decir "el RBAC lo hace Supabase Auth" es justo la confusión que me llevó a escribir un argumento falso en ADR-21. |
> | *"Realtime **(alertas)**"* | **Reemplazado por polling** en **ADR-21** para el portal: Realtime abriría un **segundo canal de datos** en contra de la decisión de que el portal hable solo con nuestra API. *(Sigue disponible si algún día hace falta para otra cosa; simplemente no se usa.)* |
>
> Lo registro porque es **la misma clase de agujero que OBS-03**: una decisión posterior anula una
> pieza de otra y nadie lo anota. La diferencia entre un ADR y un post-it es exactamente esto.

## ADR-02 — Frontend: Next.js + TypeScript + Tailwind + shadcn/ui ⚠️ REEMPLAZADA POR ADR-16
**Contexto.** El PRD pide SPA responsive, portal de cliente, tablero tipo Trello, mensajería y dashboards.
**Decisión.** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui; `@supabase/ssr` para sesión y RLS desde el cliente.
**Justificación.** SSR/RSC donde importa SEO (portal), componentes rápidos sin licencias de UI, un solo lenguaje de punta a punta.
**Por qué se reemplazó.** La premisa era que *un mismo frontend* renderizara el portal **y las webs públicas de cliente**. Al acotar el alcance al **portal interno** (privado, autenticado, sin SEO), todas las ventajas de Next en este proyecto se quedaron del lado de las webs de cliente — que hoy salen como HTML estático + Storyblok, mejor para SEO que cualquier framework. Ver **ADR-16**.

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

> ### ⚠️ Actualización (2026-07-14) — el "renderizados con Next.js" de arriba ya no aplica
>
> **ADR-16 quitó Next del stack** y resolvió que las webs de cliente salen como *HTML estático +
> Storyblok*. Lo escrito arriba se conserva como registro de por qué se eligió Storyblok —**esa
> parte sigue en pie**— pero el render **ya no es Next.js**.
>
> El problema es que ADR-16 **quitó Next sin poner nada en su lugar**: hoy `web-builder` genera el
> HTML y publica el contenido en Storyblok, pero **nada sirve esa web en un dominio** y **no hay
> rebuild**. Es decir: **una edición en el Visual Editor no llega a ninguna página publicada** — y
> "que un no-técnico edite sin devs" es *la justificación central de este ADR*.
>
> **La premisa de ADR-04 volvió a cumplirse con ADR-19**: un renderizador propio en runtime sirve la
> web en vivo desde Storyblok, con URL de preview y Bridge — que es lo que el Visual Editor necesita
> para funcionar de verdad. (OBS-03, cerrada.)

## ADR-05 — Motor de datos del Módulo 2: DataForSEO
**Contexto.** El doc original del Módulo 2 eligió SEMrush. Se reevaluó por costo y por ser un pipeline programático.
**Decisión.** **DataForSEO** (Labs + Keywords Data + SERP) como fuente de volumen/dificultad/CPC/tendencia/SERP.
**Alternativas descartadas.** *SEMrush API* (requiere plan Business ~450€+/mes + créditos, más caro); *Google Ads API* (gratis pero con fricción de developer token/OAuth y volúmenes en rangos); *Ahrefs API* (premium, costo alto).
**Justificación.** Pay-as-you-go barato por consulta, pensado para automatización a escala; agrega datos de Google Ads + SERP + related. El costo de API lo paga Frank y se documenta.

## ADR-06 — Compuerta de aprobación humana entre Módulo 2 y Módulo 1
**Contexto.** ¿El pipeline research→web corre 100% automático o con revisión humana?
**Decisión.** **Compuerta de aprobación humana**: el research genera el brief, un humano lo revisa/edita y recién ahí se dispara la creación de webs.
**Justificación.** Coherente con la "compuerta humana" del PRD; ninguna acción irreversible (publicar) sin confirmación; menor riesgo de publicar research equivocado.

> ### Actualización (2026-07-14) — el "**edita**" por fin existe
>
> Este ADR siempre dijo *"un humano lo revisa/**edita**"*. **Lo de editar no existía**: solo había
> `approvePage`, `approveRun` y `rejectRun`. Si una página estaba **casi** bien, la única salida era
> tirarla — y volver a pagar un research entero por un slug mal puesto. Una promesa del ADR llevaba
> meses sin dueño y nadie lo había notado (lo encontró la 5ª review, cruzando ADRs).
>
> **Ahora:** `PgStore.editPage()` permite corregir `url_slug`, `keyword_principal`, `seo`,
> `content_brief` y `preguntas_frecuentes`. Los campos son una **allowlist**: `approved`, `run_id` y
> `tenant_id` no se tocan desde ahí ni por accidente — construir el `update` con las claves que mande
> el llamador es cómo un endpoint de edición se convierte en una escalada de privilegios.
>
> **Y editar REVOCA la aprobación. Siempre.** No es una cortesía: la compuerta certifica que un
> humano miró **esto**. Si `esto` cambió después de que lo mirara, la certificación **ya no vale
> nada**. Sin esa regla, alguien aprueba una página inocua, la reescribe entera, y se publica algo
> que **nadie vio**. Hay un test que lo comprueba, y una mutación que quita la revocación lo tumba.
>
> La compuerta sigue siendo **del equipo, no del cliente** (ADR-20): repartir la aprobación entre
> agencia y cliente obligaría a decidir quién manda cuando no coinciden, y eso es un problema de
> producto que nadie pidió resolver.

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

> ### ⚠️ Actualización (2026-07-14) — este ADR está EN REVISIÓN
>
> Todo lo de arriba está redactado sobre **"el frontend Next.js"**, que **ADR-16 eliminó**. Como
> este ADR define una **promesa comercial** (snapshot gratis, handoff editable de pago), no puede
> quedar apoyado en una pieza que no se va a construir:
>
> - **"Snapshot estático (Next.js SSG export)"** → hoy el HTML lo genera `web-builder`
>   (`render/html.ts`), autocontenido y sin dependencias. **Probablemente ya está hecho** — pero
>   nadie lo ha usado como entregable de salida ni lo ha verificado como tal.
> - **"Handoff editable: entregar/hostear el frontend Next.js"** → **no hay frontend que entregar.**
>   Si el cliente se lleva el space de Storyblok, se lleva el *contenido* y nada que lo renderice.
>
> **Resuelto por ADR-19** (renderizador propio en runtime). Ahora sí hay **qué entregar**: el space
> de Storyblok **+ el renderizador**. Y el *snapshot* gratis sale de `renderStory()`, que ya existe —
> falta **verificarlo como entregable**, no construirlo.
>
> ⚠️ **Este ADR hay que reescribirlo en esos términos antes de llevarlo a un contrato.** Tal como
> está redactado arriba, promete un frontend Next.js que no existe.
>
> **Actualización (2026-07-19).** El renderizador **ya existe** (`renderer/`, etapa 6), así que la
> pieza que faltaba para poder firmar esto está construida. Dos cosas que el nuevo código aporta al
> offboarding y conviene anotar antes de redactar la cláusula:
>
> - **Archivar al cliente APAGA su web**, sin ningún paso extra: la política de `app_render` exige
>   `archived_at is null`. El "offboarding en <5 min" del PRD no depende de que alguien se acuerde
>   de tocar el renderizador.
> - **El dominio es único y no se libera solo.** Si un cliente se va y otro toma su dominio, tiene
>   que ser un acto explícito, no una carrera que resuelve el `order by` de una query.
>
> Lo que **sigue pendiente y es trabajo humano, no de código**: verificar el *snapshot estático* como
> entregable real (se puede sacar de `renderStory()`, nadie lo ha hecho) y poner precio a la "salida
> gestionada". El ADR sigue sin poder llevarse a un contrato tal como está redactado arriba.

---

## ADR-12 — Orquestador durable (Inngest): el evento dispara, la base decide

**Contexto.** ADR-03 eligió orquestación en código. El pipeline del M2 era un script secuencial: si
moría a mitad, se perdía lo pagado; la compuerta humana (ADR-06) se resolvía a mano editando un JSON;
y no había forma de esperar días a una aprobación sin un proceso vivo.

**Decisión.** Un paquete `orchestrator/` con Inngest, que es el **composition root**: el único punto
que conoce a los tres módulos. `kr-service` sigue sin saber que existe una base de datos y
`web-builder` sigue sin importar nada de `kr-service` — la frontera M2→M1 sigue siendo el brief JSON
validado con Zod (ADR-06/07), solo que ahora el brief se **reconstruye desde la base** antes de
publicar, y se vuelve a validar.

**Lo que NO es negociable: el evento es un disparador, nunca una autoridad.**
`research/aprobado` no aprueba nada. Solo despierta al workflow, que va a la base y pregunta qué
está realmente aprobado (`getPublishablePages`, que exige las dos condiciones de la compuerta, bajo
RLS y con el contexto del tenant que **pidió** el research — nunca el del evento de aprobación). Si
el evento fuera la autoridad, cualquiera capaz de emitirlo publicaría contenido que ningún humano
miró, y con el `runId` ajeno publicaría contenido de otro tenant. Hay cuatro tests que caen si se
invierte esa dependencia.

**Consecuencias de diseño, todas con un porqué:**

| Decisión | Por qué |
|---|---|
| El `runId` lo genera **quien emite el evento**, no la base | Inngest re-ejecuta todo el código fuera de un step en cada replay. Un `randomUUID()` en el workflow daría un id distinto por replay y los pasos siguientes escribirían en un run inexistente. De paso, hace el run **idempotente**: reprocesar el evento no abre un segundo run ni vuelve a pagar. |
| Tope de concurrencia **global**, no por tenant | El rate limit de DataForSEO es **por cuenta**, y la cuenta es una para toda la agencia. "2 por tenant" × 10 tenants = 20 corridas contra la misma cuenta → 40202. El segundo límite (1 por tenant) es de **equidad**, no de protección. |
| `retries: 1`, no el default de 4 | Un step que falla se reintenta **entero**, y el de research paga. Lo de DataForSEO (81% del costo) lo absorbe la cache; lo del LLM **no está cacheado y se re-paga**. Los fallos transitorios ya los reintenta el cliente HTTP de `kr-service`, mucho más barato. |
| Las keywords se persisten **dentro** del step de research | Checkpoint: si el paso revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO queda en la base en vez de perderse. |
| `onFailure` marca el run `failed` | Agotados los reintentos, el run no puede quedarse colgado en `running` para siempre. Solo es posible porque el `runId` viaja en el evento. |
| Vencido el plazo de aprobación (7d) **no se publica** | El silencio no es un "sí". El run se queda en `pending_approval`, visible, y alguien lo retoma. |

**Rol del orquestador: `servicio`, no `maestro`.** Es un proceso, no una persona: puede escribir los
resultados del research y nada más.

## ADR-13 — El acceso a la base es SOLO por transacción con conexión reservada

**Contexto.** El `PgStore` aplica el contexto de tenant con `set_config(..., true)` y `set local role
app_user`. Las dos cosas son **locales a la transacción**, y una transacción vive en **una conexión**.
La primera versión tenía un `query()` suelto y hacía `begin` / `set_config` / la query / `commit`
como cuatro llamadas sueltas al mismo objeto.

**El fallo.** Contra PGlite (una sola conexión) eso funciona por accidente. Contra un `pg.Pool`
real, **cada `query()` toma una conexión cualquiera**: el `begin` iría a la conexión 1, el
`set_config` a la 2 y el `insert` a la 3 — fuera de la transacción, sin tenant seteado y sin
`set local role app_user`, es decir **con el rol del pool, que salta RLS**. El aislamiento entre
clientes no se degradaba: desaparecía. Y bastaba con dos runs concurrentes —lo que el orquestador
crea **por diseño**— para que el contexto de un tenant pisara el del otro.

**Decisión.** El único acceso es `DbPool.transaction(fn)`, que **reserva una conexión** y se la pasa
a `fn` como `Tx`. El Store ya no tiene ningún `query()` al que llamar por fuera: no es que haya que
*acordarse* de usar la transacción, es que **no existe otra forma**. El tipo es lo que impide
reintroducir el bug. En `NodePgPool`, un `rollback` fallido **destruye** la conexión en vez de
reciclarla: una conexión que vuelve al pool con una transacción abierta y el tenant del usuario
anterior pegado es exactamente la fuga que esto viene a impedir.

---

## ADR-14 — Idempotencia de las peticiones facturables: `payload_hash` + método Standard donde se puede

**Contexto.** Cada POST a DataForSEO cuesta dinero. La review externa (#10) pedía migrar al **método
Standard** (`task_post` + `task_get`), que permitiría *recuperar* un resultado ya pagado cuya
respuesta se hubiera perdido.

**Por qué NO se hizo eso.** La **API DataForSEO Labs es live-only**: no existe `task_post` para ella
([docs](https://dataforseo.com/help-center/live-vs-standard-method)). Y Labs es donde está la mayor
parte del gasto:

| Endpoint | API | ¿Standard? | Coste (corrida real) |
|---|---|---|---|
| `keyword_suggestions` | **Labs** | ❌ live-only | ~$0.08 |
| `bulk_keyword_difficulty` | **Labs** | ❌ live-only | ~$0.056 |
| `search_volume` | KeywordsData | ✅ sí | ~$0.102 |
| `serp/organic` | SERP | ✅ sí | marginal |

Migrar a Standard habría blindado el endpoint **más barato** y dejado fuera **~54% del gasto**, a
cambio de convertir el pipeline de segundos en minutos (cola + polling). Mala relación.

**Decisión.** Registrar cada petición facturable en `kr_provider_tasks`, indexada por
`payload_hash` (endpoint + cuerpo + **entorno**), **antes** de enviarla. El registro alcanza a los
cuatro endpoints — **pero solo protege si de verdad se le inyecta un registro durable**. Un cliente
que corra con `NoopTaskLog` (o sin registro) no compara nada: toda petición sale como nueva. Por eso
`getProvider` **exige** un registro durable en live+producción y **falla cerrado** si no lo tiene
(ver el recuadro del CLI, abajo). Con esa condición cumplida, cubre el 100% de la superficie
facturable.

**La distinción que lo hace correcto — hay dos formas de fallar, y solo una es recuperable:**

- **Respuesta recibida con la task en error** (p. ej. 40501): el proveedor **no cobró**, y lo sabemos
  porque nos lo dijo → se marca `failed` → reintentar es seguro.
- **Sin respuesta** (timeout, 5xx, el proceso muere): **ambiguo**. La petición pudo llegar,
  ejecutarse y cobrarse. La reserva se deja en `pending` **a propósito** → el siguiente intento sabe
  que **puede estar repagando**, lo cuenta y lo grita. Marcarla `failed` sería afirmar que no cobró
  sin tener ni idea.

**Lo que este diseño NO puede hacer, y hay que decirlo:** con un endpoint live, un resultado cuya
respuesta se perdió **es irrecuperable**. Ese dinero está perdido y no hay diseño que lo rescate.

> ### ⚠️ Corrección (2026-07-14) — acá había una afirmación FALSA, y el propio código la desmentía
>
> Este ADR decía: *"lo que sí se garantiza es que **no se pague dos veces por la misma petición**"*.
>
> **Era falso.** Dos párrafos más arriba, este mismo ADR explicaba que una petición sin respuesta
> queda `pending` y que el siguiente intento **la reenvía sabiendo que puede estar repagando**. Y el
> código lo hacía —hasta 3 veces— imprimiendo `⚠️ REPAGO` por consola. O sea: **el código sabía que
> podía estar pagando dos veces, lo decía en voz alta, y lo hacía igual**, mientras el documento
> proclamaba una garantía de *exactly-once* que nadie estaba dando.
>
> El *lease* da **exclusión mutua mientras está vivo**. Eso no es *exactly-once*, y llamarlo así fue
> exactamente la clase de error que este registro existe para no repetir.
>
> **Lo que se hace ahora** (decisión de Juan, 2026-07-14; implementado 2026-07-15):
>
> 1. **Una petición ambigua NO se reenvía sola.** En los endpoints **live** (Labs), el run **se
>    detiene** con el `payload_hash` exacto, y un humano decide: comprobar en el panel de DataForSEO
>    si se cobró, o asumir el riesgo con `DFS_PERMITIR_REPAGO=1`. **Detener un research es barato;
>    pagarlo dos veces sin enterarse, no.**
> 2. **El 46% del gasto ya NO tiene ambigüedad.** SERP y Search Volume usan el **método Standard**
>    (`postStandard`: `task_post` cobra y devuelve un `task_id`; `task_get` recupera **gratis** 30
>    días). Persistimos el `task_id` **antes** de tener el resultado, con **dos capas de
>    recuperación**:
>    - *Capa 1* — si morimos tras postear, el siguiente intento hace `task_get` con el id anotado.
>    - *Capa 2* — si morimos **entre** postear y anotar, lo hallamos por `tag = payload_hash` en
>      `tasks_ready`.
>
>    En ambas, el rescate cuesta **cero**. Ahí la respuesta perdida **deja de ser dinero perdido**.
>    La API Labs (54%) es *live-only* y no tiene `task_post`: se queda con la garantía del punto 1.
>
> **Garantía real, dicha sin adornos:**
> - **SERP + Search Volume:** una respuesta perdida **se recupera** (la tarea pagada se rescata).
> - **Labs:** *nunca se paga dos veces **sin que alguien lo haya decidido***, pero un cobro cuya
>   respuesta se perdió es irrecuperable.
>
> Mutation-tested: quitar la recuperación (ignorar el `task_id`) o no anotarlo hace caer los tests de
> `client.test.ts`.

> ### ⚠️ La 6ª review encontró 4 bugs en la primera versión del método Standard (tandas 11→12)
>
> El recuadro de arriba describe el diseño; la **primera implementación no lo cumplía**, y Codex lo
> cazó. Corregido y mutation-tested en la tanda 12:
>
> - **Search Volume estaba roto en producción:** `task_get` iba siempre a `/advanced`, pero SV usa la
>   variante *regular* (`/task_get/{id}`). Ahora el modo es por endpoint (SV regular, SERP advanced).
> - **El coste desaparecía del ledger** tras una recuperación (`completar(0)` sin persistir el coste
>   del `task_post`). Ahora `anotarTareaRemota` guarda id **y coste**.
> - **El id hallado por `tasks_ready` no se persistía** antes del `task_get` → una segunda caída lo
>   perdía. Ahora se persiste apenas se halla.
> - **Consultar una huérfana consumía intentos** aunque no se enviara nada. Ahora el tope cuenta
>   **envíos** (`contarEnvio`), no reservas.

> ### ⚠️ La 7ª review encontró el agujero de raíz: el CLI de producción no registraba NADA (tanda 13)
>
> Todo lo de arriba blindaba el registro… **que el camino de producción documentado no usaba.** El
> CLI (`npm run spike`, acción 03) llama `runResearch()` **sin `deps.taskLog`**, y el cliente caía en
> `NoopTaskLog`: para él **toda petición es nueva**. El `payload_hash` se calculaba y no se comparaba
> con nada. Reproducido por Codex: dos `postStandard` idénticos → **dos cobros**. Y el caso que de
> verdad cuesta dinero es peor: un **crash + re-run** (aborta el presupuesto, se corta la red) vuelve a
> pagar los ~$0.25 enteros, porque en memoria no quedó ni rastro de lo ya enviado.
>
> **La lección, otra vez la misma:** las piezas estaban probadas por separado y **nadie probaba la
> costura del composition root real**. El test de la tanda 12 instanciaba `MemTaskLog` a mano; ninguno
> pasaba por `getProvider()`/`runResearch()` como el CLI.
>
> **Lo que se hace ahora (tanda 13):**
>
> 1. **`durable` es ahora un contrato**, no un detalle. `ProviderTaskLog.durable`: `false` en
>    `Noop`/`Mem` (mueren con el proceso), `true` solo en `PgTaskLog`.
> 2. **`getProvider` falla cerrado**: en live+producción, sin un registro durable **lanza antes de
>    tocar la red**. El doble pago silencioso pasó a ser un rechazo ruidoso — para *cualquier*
>    llamador, no solo el CLI.
> 3. **El CLI cablea `PgTaskLog`** (desde `db`, vía `DATABASE_URL_CACHE`, mismo namespace que el
>    orquestador → comparten ledger). El CLI es un composition root, como `orchestrator/deps.ts`: la
>    LIBRERÍA de kr-service sigue sin conocer la base. Sin `DATABASE_URL_CACHE`, una corrida de
>    producción **aborta** — no se gasta dinero real sin dónde anotarlo.
>
> Mutation-tested: neutralizar el guard (`!taskLog?.durable` → `false`) hace caer exactamente los tres
> tests de `getprovider-guard.test.ts` que exigen el rechazo.

### Lo que sigue sin estar cubierto por un test

- **Lotes que se solapan.** Dos procesos con `[a,b]` y `[b,c]` reservan **lotes enteros**: ambos ven
  `b` ausente y ambos la pagan. Cerrarlo exige reservar **por keyword**, no por lote. La ventana es
  estrecha (los dos tendrían que perder la cache a la vez), pero existe.
- **La carrera real entre dos conexiones.** El `for update` de `reservar()` **no está verificado**:
  PGlite tiene una sola conexión y serializa las transacciones, así que el test de concurrencia
  prueba la lógica, **no la carrera**. Verificarlo exige un Postgres con dos conexiones.
- **La ventana `task_post`→persistir del coste (capa 2).** Si el proceso muere entre postear y anotar,
  el id se rescata por `tasks_ready`, pero el **coste** de esa tarea no (el `task_get` lo reporta como
  0). El ledger de esa fila queda subestimado. Es la ventana de milisegundos que `tasks_ready` cubre
  para el *dato* pero no para el *coste*.

`PgTaskLog.huerfanas()` lista las peticiones que se enviaron y nunca volvieron. Es lo que hay que
mirar si el saldo de DataForSEO no cuadra.

---

## ADR-15 — El rol no se declara: se deriva de `memberships` (cierra OBS-02)

**Contexto.** Las políticas RLS leían el rol y el `client_id` del contexto que ponía la aplicación.
Era aceptable mientras el único caller fuese backend de confianza (el CLI, el orquestador): ningún
usuario final podía influirlo. **El portal rompe esa premisa.** En cuanto hay un endpoint HTTP con
una persona del otro lado, un rol declarado por quien llama es una escalada de privilegios servida
en bandeja: basta con mandar `role: "maestro"`. La tabla `memberships` existía con los datos
correctos y **no participaba en ninguna decisión de autorización**.

**Decisión.** `app.current_role()` y `app.current_client_id()` **derivan de una membresía real**
dentro de Postgres. El GUC `app.role` ya no lo lee nadie. La petición solo dice **quién eres**
(`app.user_id`, que la API pone tras verificar el JWT); **qué puedes hacer** lo decide la base.

**El rédito cobrado: NO se tocó ni una política.** Siempre llamaron a estas funciones en vez de leer
la variable de sesión, precisamente para que este cambio fuera posible sin reescribirlas.

**Consecuencias:**

- Reclamar un `tenant_id` ajeno **no sirve de nada**: no hay membresía allí → no hay rol → no hay
  acceso. La comprobación de pertenencia sale gratis, de la misma consulta.
- El `TenantContext` de TypeScript **ya no tiene dónde poner un rol**. No es cosmética: es la
  garantía, en el tipo, de que ningún caller futuro pueda declararse `maestro`.
- **El orquestador no usa membresías.** Es un proceso, no una persona: asume el rol de Postgres
  `app_service`. No hay nadie a quien suplantar, así que no hace falta provisionar nada.
- Lo que la API **sí** afirma es la identidad (`app.user_id`), y es legítimo porque acaba de validar
  el token contra la clave pública del emisor. Lo que ya **no** puede afirmar es qué puede hacer esa
  identidad.

Verificado por mutación: si la función vuelve a aceptar el rol declarado (aunque sea como respaldo),
un usuario **sin ninguna membresía** que se declara `maestro` entra — y solo ese test cae.

> ### ⚠️ CORRECCIÓN — este ADR contenía una afirmación FALSA
>
> Este documento decía: *"la autoridad del orquestador es una **credencial de base de datos**; para
> falsificarla hace falta la contraseña de Postgres"*. **No era verdad**, y el código no la
> respaldaba: `app_service` era `NOLOGIN`, había **un solo `DATABASE_URL`**, y era el CÓDIGO el que
> elegía con qué rol vestirse. `SET ROLE` **no pide contraseña** — Postgres lo autoriza según el
> `session_user`, así que el mismo login podía ponerse `app_user` **o** `app_service`.
>
> Era una frontera de **código** disfrazada de frontera de **credenciales**: la misma "autoridad
> declarada" que este ADR presume de haber eliminado, cerrada en la puerta de los humanos y dejada
> abierta en la del servicio.
>
> **Corregido en [ADR-17](#adr-17--un-proceso-un-login-un-rol-corrige-una-afirmación-falsa-de-adr-15).**
> Ahora sí es una credencial: tres logins `NOINHERIT`, cada uno autorizado a un solo rol.
>
> Se deja escrito en vez de borrarlo. Una documentación que afirma una propiedad de seguridad que el
> código no tiene es más peligrosa que no tener documentación: el que la lee deja de comprobarlo.

---

## ADR-16 — Portal en Angular + Tailwind (reemplaza ADR-02)

**Contexto.** ADR-02 eligió Next.js asumiendo que el mismo frontend renderizaría el portal **y las
webs públicas de cliente**. El alcance se acotó: lo que se construye es **solo el portal interno** —
donde el equipo lanza research, revisa el brief y **aprueba la compuerta** (ADR-06), que hoy se hace
editando un JSON a mano.

**Decisión.** **Angular + Tailwind, mobile-first.** Las webs de cliente siguen saliendo como HTML
estático + Storyblok (ADR-04), que para SEO es mejor que cualquier framework de aplicación.

**Justificación.**
- El portal es un **SPA autenticado y privado**: SSR, RSC y SEO —todo lo que justificaba Next— no
  aportan nada acá.
- **Quien lo mantiene es Juan, y su soltura está en Angular.** En una decisión sin ventaja técnica
  clara, la fluidez de quien mantiene el código es el factor decisivo, no la moda del framework.
- Lo único que se pierde es **shadcn/ui** (es React). Hay puerto para Angular (*Spartan UI*), y
  Angular Material / PrimeNG hacen el trabajo. Nada arquitectónico.

**Consecuencia que resuelve un problema, no que lo crea.** Angular no puede servir las funciones de
Inngest desde una API route, así que el orquestador **tiene que ser un servicio Node propio y de
larga duración**. Eso es justo lo que hacía falta: el research encadena llamadas live a DataForSEO y
generación por LLM (minutos), y **no habría entrado en el timeout de una función serverless de
Vercel** (60-300 s). Elegir Angular elimina el riesgo en vez de administrarlo.

**Pieza nueva.** Un SPA necesita una **API HTTP** (hoy el único caller es el CLI). Es exactamente la
ruta que hacía real el riesgo de OBS-02 — por eso se cerró **antes** de construirla (ADR-15): ese
endpoint no puede aceptar el rol que le mande el navegador.

**Sin medir.** No sé **cuánto tarda** un research real: tengo el coste ($0.31), nunca la duración.
Ya no bloquea el diseño, pero define la UX del portal (¿el usuario espera o se va y vuelve?). Se
mide en la primera corrida real.

---

## ADR-17 — Un proceso, un login, un rol (corrige una afirmación FALSA de ADR-15)

**Lo que ADR-15 decía, y era mentira.** *"La autoridad del servicio es una CREDENCIAL DE BASE DE
DATOS; para falsificarla hace falta la contraseña de Postgres."*

**Por qué era falso.** `app_service` es `NOLOGIN`. Había **un solo `DATABASE_URL`**, un solo pool, y
era el CÓDIGO el que decidía con qué rol vestirse (`set local role app_service`). Postgres autoriza
`SET ROLE` según el `session_user`, **sin pedir contraseña**: el mismo login podía ponerse
`app_user` o `app_service` indistintamente, y `RESET ROLE` devolvía sus privilegios originales.

Era una **frontera de código disfrazada de frontera de credenciales** — la misma "autoridad
declarada" que ADR-15 presumía de haber eliminado. La cerré en la puerta de los humanos y la dejé
abierta en la del servicio. Con la API compartiendo `DATABASE_URL`, cualquier bug de composición o
ruta que construyera el store equivocado escalaba a servicio.

**Decisión.** Tres logins (`amg_api`, `amg_orquestador`, `amg_cache`), **`NOINHERIT`**, cada uno
autorizado a **un solo rol**. El login de la API **no puede** hacer `set role app_service`: lo
rechaza Postgres. No es que el código no lo intente — es que no puede.

`NOINHERIT` no es opcional: sin él, el login tiene los privilegios de sus roles concedidos sin
siquiera hacer `SET ROLE`, y `RESET ROLE` se los devuelve.

**El rol de la conexión sale del STORE, no del contexto de la petición.** `TenantContext` ya no
tiene dónde poner `servicio: true`. Verificado contra `pg_auth_members` —la fuente de verdad, no el
código— y por mutación: conceder los dos roles al mismo login hace caer el test.

Ver [`docs/proyecto/12-credenciales.md`](proyecto/12-credenciales.md).

## ADR-18 — Un evento no porta autoridad: la API crea el run, el evento lo pone en marcha

**El agujero.** `research/solicitado` llevaba `tenantId` y `clientId` **elegidos por quien emitía el
evento**, y el workflow los convertía en contexto de servicio. La FK garantizaba que el cliente
pertenecía al tenant; **nadie garantizaba que el humano perteneciera al tenant**. El `userId` que
llevaba "para auditoría" no participaba en ninguna decisión.

Conocer (o filtrar) dos UUID ajenos y conseguir que se emitiera el evento bastaba para que el
orquestador **pagara un research de otra agencia con autoridad de servicio**.

**Decisión.**

1. La API crea la fila del run **bajo RLS, como `app_user`**, con la identidad del humano. Sin
   membresía en ese tenant, Postgres rechaza el insert. **La autorización ocurre ahí.**
2. El evento lleva **solo `runId` y `tenantId`** — y el `tenantId` no es autoridad, es una
   coordenada: si no cuadra con el run, RLS no lo deja ver y el workflow **aborta sin gastar**.
3. El orquestador lee el prompt, el cliente y el mercado **de la fila**, jamás del mensaje.

Es la misma disciplina que ADR-12 (`research/aprobado` no aprueba: despierta), aplicada al evento
de entrada. Verificado por mutación: si el workflow vuelve a crear el run desde el evento, caen los
dos tests de "no gasta un centavo".

---

## OBS-01 — Solapamiento de alcance entre los dos documentos (riesgo, no decisión)
**Observación.** `contexto-proyecto-frank.md` describe "Frank, cliente de la agencia" con 4 módulos; `A_PRD_AMG_Madrid_v1_Ilustrado.md` tiene sponsor "Franco · CEO" con 5 agentes y prioridades distintas. **Frank ≈ Franco es casi con seguridad la misma persona/proyecto**, con framings que no cierran (p. ej. el Creador de Webs es "Módulo 1 avanzado" en un doc y "web-por-prompt diferido a I+D / O10" en el otro).
**Riesgo.** Presupuestar o presentar dos alcances incompatibles al mismo cliente.
**Acción pendiente.** Unificar en un **único alcance coherente por fases** antes de consolidar la propuesta comercial. Confirmar con Juan el estado real del Creador de Webs.

## OBS-02 — El rol y el `client_id` los declara el caller ✅ RESUELTA (ver ADR-15)

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

---

## OBS-03 — Nadie publica la web del cliente ✅ CERRADA por ADR-19

> **Cerrada el 2026-07-14 con [ADR-19](#adr-19): un renderizador propio en runtime, multi-tenant.**
> Se conserva el diagnóstico porque explica *por qué* el renderizador existe — y porque es el ejemplo
> más claro de la clase de error que busco: **una decisión que invalida a otra sin reemplazarla.**
> ADR-16 quitó Next del stack en una línea, y esa línea dejó un agujero que ningún test podía
> detectar, porque no era un bug: era una **ausencia**.

**Observación.** ADR-02 asumía que **un frontend Next.js** renderizaría dos cosas: el portal interno
**y las webs públicas de cliente**. ADR-16 acotó el alcance al portal, eligió Angular y declaró —de
pasada, en una sola línea— que las webs de cliente *"siguen saliendo como HTML estático + Storyblok"*.

**Esa línea nunca se convirtió en un diseño.** El estado real del código, verificado:

| Pieza | Estado |
|---|---|
| Generar el HTML de la página | ✅ `web-builder/src/render/html.ts` — autocontenido, JSON-LD, validado en el Rich Results Test |
| Publicar el contenido en Storyblok | ✅ `StoryblokPublisher`, idempotente |
| **Servir esa web en un dominio** | ⛔ **No existe** |
| **Rebuild al editar en Storyblok** | ⛔ **No existe** — no hay un solo webhook en el repositorio |

**Por qué importa, y no es un detalle de infraestructura:**

1. **Rompe la premisa de ADR-04.** Se eligió Storyblok —contra WordPress y contra Payload—
   **porque tiene Visual Editor**, para que community managers editen sin devs. Pero si la web
   publicada es HTML generado una vez, **una edición en el Visual Editor no llega a ninguna parte**.
   Se está pagando el CMS por una capacidad que hoy no está conectada.
2. **Rompe una promesa comercial (ADR-11).** El *offboarding* vende "handoff editable" como servicio
   pago = space de Storyblok **+ el frontend**. **No hay frontend.** Eso no se puede firmar.
3. **El propio código todavía cree lo contrario.** El comentario de `render/html.ts` dice: *"para
   previsualizar sin frontend Next.js. En PROD, el render real lo hace Next.js"*. El código arrastra
   una suposición que ADR-16 invalidó.

**Lo que hay que decidir** (no lo resuelvo por mi cuenta: tiene consecuencias de costo y de venta):

- **(a) Sitio estático regenerado.** Un webhook de Storyblok dispara un rebuild del `web-builder` y
  redespliega a un host estático. Barato, SEO impecable, y **el snapshot de ADR-11 sale gratis**.
  El coste: la edición no es instantánea (hay un build de por medio).
- **(b) Un renderizador propio en runtime** que lea Storyblok y sirva la web. Edición instantánea,
  pero es **otro servicio** que mantener, y contradice el argumento de "menor mantenimiento" de ADR-04.
- **(c) Aceptar que la web es un entregable congelado** y que el Visual Editor **no se usa**. Es
  coherente y barato, **pero entonces Storyblok está de más** y hay que revisar ADR-04 entero.

**Riesgo si no se decide:** es la única pieza del Módulo 1 que separa "generamos una web" de
"tenés una web". Afecta directamente lo que se le puede prometer a Frank.

---

## ADR-19 — Un renderizador propio en runtime, multi-tenant (cierra OBS-03)

**Contexto.** ADR-16 quitó Next.js del stack y dejó **sin resolver** quién renderiza y sirve las
webs públicas de cliente (**OBS-03**). Mientras eso estuviera abierto, la premisa de ADR-04 —se
eligió Storyblok **por su Visual Editor**, para que un no-técnico edite sin devs— **no se cumplía**:
el HTML se generaba una vez y una edición en el editor no llegaba a ninguna página publicada.

**Decisión (2026-07-14).** **Un único servicio renderizador Node, multi-tenant**, que lee de la
Content Delivery API de Storyblok y sirve la web **en vivo**.

```
   Editor toca Storyblok  ──▶  (contenido)
                                   │
   navegante  ──▶  RENDERIZADOR (1 servicio, N dominios)  ──▶  HTML + JSON-LD
                        │  dominio → space del cliente
                        └─ reutiliza renderStory() de web-builder
```

**Por qué en runtime y no estático con webhook de rebuild.** Las dos servían, y el estático era más
barato. Decide el **Visual Editor**: para funcionar necesita una **URL de preview en vivo** con el
Storyblok Bridge. Con rebuild estático, el editor edita a ciegas y espera un build. Como el Visual
Editor **es la razón por la que se eligió Storyblok**, pagar por él y dejarlo a medias sería lo peor
de los dos mundos.

**Qué hay que construir es menos de lo que parece.** El render **ya existe**:
`web-builder/src/render/html.ts` (`renderStory()`) produce HTML semántico + JSON-LD, validado en el
Rich Results Test de Google. Lo que falta es el servicio que lo envuelve:

1. Mapear **dominio → space de Storyblok** (ADR-04/ADR-11: **un space por cliente**).
2. Leer la story por slug (Content Delivery API, **no** la Management API).
3. `renderStory()` → servir.
4. **Cache en el borde, invalidada por webhook** de Storyblok. Es lo que hace que "runtime" no
   signifique "lento ni caro": se renderiza al publicar, no en cada visita.
5. Exponer la **URL de preview + el Bridge** para el Visual Editor.

**El costo, dicho honestamente.** Es **otro servicio que mantener y desplegar**, y eso roza el
argumento de "menor mantenimiento" con el que ADR-04 descartó WordPress. **Pero la diferencia se
sostiene**, y es la que importa: WordPress son **N instalaciones** (updates, plugins, seguridad,
una por cliente). Esto es **un servicio para N dominios**. El trabajo no crece con la cartera —
que era exactamente la tesis del PRD (escalar sin crecer el equipo).

**Consecuencias sobre ADR-11 (offboarding), que estaba sin poder firmarse:**

- **Salida gratis (snapshot estático):** ya es posible sin construir nada nuevo — `renderStory()`
  sobre todas las páginas del cliente produce HTML plano, hosteable en cualquier lado. **Falta
  verificarlo como entregable**, no construirlo.
- **Salida editable (de pago):** ahora **sí hay algo que entregar** — el space de Storyblok **más
  el renderizador**. Dos variantes, como preveía ADR-11: el cliente lo hostea, o AMG lo hostea por
  una tarifa ("salida gestionada").

**Riesgo aceptado.** El renderizador se convierte en una pieza de **disponibilidad**: si se cae, se
caen **todas** las webs de cliente a la vez. Un sitio estático no tiene ese modo de fallo. Se mitiga
con la cache en el borde (que sigue sirviendo aunque el origen esté caído), pero **es un riesgo real
que un estático no tenía**, y hay que dimensionarlo antes de vender SLA.

**Estado.** Aceptada. **Cierra OBS-03.** No entra en la Fase 2 (API + portal): es su propia tanda.

> ### ✅ Implementada (2026-07-19) — etapa 6, paquete `renderer/` (60 tests)
>
> Los cinco puntos de "qué hay que construir" están. Lo que este ADR **no** había resuelto y hubo
> que decidir sobre la marcha:
>
> **1. El modelo de seguridad no cubría a un visitante anónimo.** ADR-15 deriva el rol de
> `memberships`; un navegante no tiene ninguna, así que `app.current_role()` le da NULL y no puede
> leer nada. Correcto, pero incompleto. La decisión: **el dominio ES la autorización**, con un login
> propio (`amg_render` → `app_render`) y *grants a nivel de columna* sobre `clients`. Es el rol más
> pobre del sistema, y a propósito: es la única pieza expuesta a internet anónimo, así que la
> pregunta no fue "¿qué necesita?" sino **"si me lo toman, ¿qué se llevan?"**. Se llevan el mapa
> dominio→space y el NAP, que ya está impreso en cada página pública. Ver `0007_render_publico.sql`.
>
> **2. La política no filtra por tenant, y es deliberado.** Sería teatro: el renderizador podría
> poner el tenant que quisiera, porque es él quien lo derivaría del dominio. Un control que el
> controlado se autoexpide no controla nada.
>
> **3. Los dos tokens de la CDA no son la misma clase de cosa.** El público lee contenido publicado
> (viaja en el bundle del navegador en cualquier setup normal: no es un secreto). El de **preview**
> lee borradores y **sí** lo es. El renderizador necesita el segundo para servir la URL del Visual
> Editor — o sea que **el token de borradores está dentro del radio de explosión del servicio más
> expuesto**. Es el costo real de haber elegido runtime sobre estático, y se paga a sabiendas: lo
> que lo hace tolerable es que servir draft exige además una **firma de preview atada al dominio y
> con vencimiento**, y que la Management API (la que puede *modificar* el space) nunca entra acá.
>
> **4. "Cache en el borde" es media frase.** Lo que se construyó es una cache **en proceso** con TTL,
> tope e invalidación por webhook firmado. El borde —una CDN delante— es una **decisión de
> despliegue**, no código de este repositorio. Las dos hacen falta y solo una está, y con más de una
> instancia el webhook llega a UNA sola: las demás sirven viejo hasta que venza el TTL. Dicho acá
> para que nadie lea el ADR como si estuviera hecho.
>
> **El riesgo de disponibilidad, dimensionado** (lo pide el propio ADR antes de vender SLA): el
> *health check* no toca ni la base ni Storyblok —si dependiera, el orquestador de despliegue mataría
> el servicio justo cuando el caído es Storyblok, cambiando una degradación por una caída total—;
> hay timeout de 5 s contra la CDA; y un fallo del origen es 503 **que no se cachea**. Sigue siendo
> un punto único: **una instancia caída son todas las webs de cliente caídas a la vez.**

> ### ⚠️ Corrección (2026-07-19) — la 10ª review: "no está lista para exponerse a internet"
>
> Codex revisó la etapa 6 y el veredicto fue ese. Tenía razón, y **cinco de los nueve hallazgos eran
> afirmaciones de este ADR y de la migración 0007 que nada hacía cumplir**:
>
> - **"Un space de Storyblok por cliente"** (ADR-04/ADR-11) no lo impedía nada. Con dos clientes en
>   el mismo space, el renderizador servía **el HTML de A bajo el dominio de B** desde su propia
>   cache, sin consultar el token de B. Ahora hay un `unique` (migración `0008`). Es exactamente el
>   mismo agujero que `0006` cerró del lado de la escritura, reaparecido del lado de la lectura —
>   porque en `0006` arreglé el síntoma y no el invariante.
> - **"Timeout de 5 s contra la CDA"**: cortaba al recibir los *headers*. El cuerpo podía quedar
>   abierto para siempre.
> - **"Lo que se llevan es el NAP, que ya era público"**: el grant daba la columna `jsonb` **entera**.
>   Ahora es una columna generada con allowlist de claves (`0008`), así que la frase es cierta *por
>   construcción* y no por buena voluntad de quien carga la ficha.
> - **"No puede ejecutar las funciones de `app`"**: sí puede. Lo que protege es que son
>   `SECURITY INVOKER`, un mecanismo mejor que el que yo había descrito — pero la frase estaba mal.
> - **La clave de cache** usaba un espacio de separador, y un espacio **puede aparecer en un slug**,
>   que lo controla quien pide. Ambigüedad de concatenación: el mismo error que el HMAC de preview
>   evita separando campos, cometido a diez metros de distancia.
>
> Los otros cuatro no eran afirmaciones falsas sino **ausencia de límites**: el camino anónimo no
> tenía ningún tope (ni de concurrencia, ni de cuerpo, ni cache negativa, ni coalescing), el pool de
> Postgres no tenía ningún plazo y la resolución de dominio ocurría **antes** de mirar la cache — así
> que una base colgada dejaba pendiente hasta una página cacheada, con `/_health` devolviendo 200.
>
> **Todo corregido y verificado por mutación** (`renderer/` pasó de 60 a 75 tests; `db/` de 93 a 99).
> Detalle en [08-testing-calidad.md](proyecto/08-testing-calidad.md), tanda 17.
>
> **La conclusión que me llevo, que es de método:** este ADR estaba escrito con la seguridad en
> prosa. Una garantía que no tiene ni una *constraint* que la imponga ni una mutación que la tumbe no
> es una garantía: es una intención. Van tres rondas seguidas con el mismo diagnóstico.

## ADR-20 — El portal también sirve al cliente, en modo lectura (amplía ADR-16)

**Contexto.** ADR-16 acotó el alcance a "**solo el portal interno**". Pero el esquema tiene un rol
`cliente` desde `0001_init.sql`, y el PRD habla de un "portal de cliente". Había que decidirlo antes
de construir el portal, no después.

**Decisión (2026-07-14).** El portal sirve a **dos audiencias**:

| Quién | Qué puede |
|---|---|
| **Equipo AMG** (`maestro`, `equipo`) | Todo: lanzar research, ver el brief, **aprobar la compuerta** (ADR-06), publicar. |
| **Cliente** (`cliente`) | **Solo lectura**, y **solo su propio negocio**: su brief, sus páginas, su web. **No aprueba ni lanza research.** |

**La compuerta de aprobación (ADR-06) sigue siendo del equipo.** No se reparte entre cliente y
agencia: si los dos pudieran aprobar, habría que decidir quién manda cuando no coinciden, y eso es
un problema de producto que nadie pidió resolver.

**Lo que cuesta: nada en la base.** El aislamiento **ya está construido y probado**:

- `app.puede_escribir()` → el rol `cliente` es **solo lectura** (`db/migrations/0001_init.sql`).
- `app.ve_cliente(cid)` → un `cliente` ve **únicamente su cliente**; el staff, toda la cartera del
  tenant.
- La constraint `cliente_exige_client_id` impide que un `cliente` quede "sin negocio" — que con la
  política vieja lo dejaba viendo **toda la cartera** (ese agujero ya se cerró).
- Las políticas de `memberships` impiden que un `cliente` se auto-asigne una membresía de `maestro`.

**Por eso esta decisión es barata y por eso se toma ahora:** la parte peligrosa —que un cliente vea
o toque lo ajeno— **la impide Postgres, no la UI**. Lo que falta es UI y rutas de API, y la API no
necesita lógica de autorización nueva: **le basta con no bloquear al cliente y dejar que RLS decida**
(ADR-15).

**Justificación comercial.** Que el dueño del restaurante entre y **vea la evidencia** —qué keywords,
qué volumen, qué se sabe y **qué no se sabe**— es el punto vendible del sistema: *dice lo que no
sabe*. Enseñarlo es más fuerte que mandarlo en un PDF.

**Estado.** Aceptada. Amplía el alcance de ADR-16 (no lo reemplaza: el portal sigue siendo uno solo).

---

## ADR-21 — El stack del portal, cerrado (completa ADR-16)

ADR-16 eligió **Angular + Tailwind, mobile-first**. Faltaban cuatro decisiones dentro. Se toman
juntas (2026-07-14) para no reabrirlas a mitad de la construcción.

### 1. El portal habla SOLO con nuestra API. Nunca con Postgres directamente.

Supabase permite que el navegador hable directo con Postgres vía **PostgREST**. **No se usa.**

> ### ⚠️ La primera versión de este ADR justificaba esto con un argumento FALSO
>
> Escribí que PostgREST *"hace `SET ROLE` según los claims del JWT, o sea que el rol vuelve a venir
> declarado desde afuera — lo que ADR-15 eliminó"*. **Es falso, y lo señaló la review externa.**
>
> - El claim `role` va **dentro de un JWT firmado**. El navegador **no puede cambiarlo** sin
>   invalidar la firma. No es un valor que declare el cliente: es uno que **verifica** PostgREST.
> - `authenticated` es un rol **técnico** ("hay un usuario logueado"), no un rol de negocio. La
>   autoridad podría seguir derivándose **íntegramente de `memberships` vía `auth.uid()`** —
>   exactamente el modelo de ADR-15. Es, de hecho, lo que Supabase recomienda.
> - ADR-17 tampoco queda contradicho: `authenticator → authenticated` es una transición que controla
>   la infraestructura **después** de verificar la firma.
>
> Confundí *"el rol viaja en el JWT"* con *"el rol lo declara el cliente"*. **No es lo mismo, y la
> diferencia era toda la cuestión.**
>
> Lo dejo escrito por dos motivos. Primero, porque es la **cuarta** vez que documento como cierta una
> propiedad de seguridad que no lo era (van: la "credencial" de ADR-15, la idempotencia de ADR-14, la
> concurrencia por tenant, y esto). El patrón ya no es mala suerte: **cuando un argumento me
> conviene, lo escribo y no lo verifico.** Segundo, porque acá llegué a la decisión **correcta por el
> camino equivocado** — y eso es peor que equivocarse del todo, porque una decisión "bien
> fundamentada" **nadie la vuelve a revisar**.

**La decisión se mantiene. Estas son las razones reales:**

1. **`POST /runs` es un comando compuesto, no un `insert`.** Tiene que crear la fila **bajo RLS** y
   **después** emitir el evento de Inngest (ADR-18). Un `insert` directo desde el navegador crearía
   el run y **no dispararía nada**.
2. **Una sola superficie que auditar.** Dos caminos de acceso son dos juegos de *grants*, dos
   contratos y dos cosas que probar. La complejidad de mantener ambos coherentes es el riesgo real —
   no una escalada de privilegios teórica.
3. **No se expone el esquema.** PostgREST publica las tablas; una API publica **operaciones**. El
   esquema puede cambiar sin romperle nada al portal.
4. **Es donde viven la validación de contratos, el rate limiting y la auditoría.** Todo eso hay que
   escribirlo igual; tenerlo en un solo sitio es más barato.

```
Portal ──JWT──▶ API (login amg_api) ──▶ set app.user_id ──▶ Postgres
                                         rol ← memberships (ADR-15)
```

*Costo aceptado:* hay que escribir los endpoints de lectura a mano en vez de recibirlos gratis.
Son pocos, y a cambio hay **una sola superficie**.

### 2. El progreso del research se ve por **polling**.

`GET /runs/:id` cada pocos segundos. Se descartan Supabase Realtime (acopla el portal a Supabase y
abriría un **segundo canal de datos**, en contra de la decisión 1) y SSE (más trabajo del que hoy se
justifica).

> ⚠️ **Esto se decide con un dato que no tenemos: cuánto tarda un research real.** Sabemos el coste
> ($0.31), nunca medimos la duración. Si resulta que tarda **mucho**, la UX correcta no es una barra
> de progreso sino "te aviso cuando esté", y el polling igual sirve para eso. **Se mide en la primera
> corrida real** (acción 06). Si el dato contradice esta decisión, se revisa.

### 3. **Tailwind puro**, sin librería de componentes.

El portal tiene **pocas pantallas**: login, lista de runs, detalle del brief, aprobar. Se descartan
Angular Material (su theming pelea con Tailwind y todo "se ve a Material"), PrimeNG
(sobredimensionado para 4 pantallas) y Spartan UI (encajaba bien, pero suma una dependencia joven
para un problema que no tenemos todavía).

*Si el portal crece hacia los dashboards del PRD, esta decisión se reabre.* Es barata de revertir:
añadir una librería después es fácil; sacarla, no.

### 4. Angular **moderno**: standalone + signals.

Componentes standalone (sin `NgModules`), **signals** para el estado, control flow nuevo
(`@if`/`@for`). **Sin NgRx**: para un portal de este tamaño, signals + servicios alcanzan, y NgRx
traería una ceremonia que no se paga.

No se va a *zoneless* todavía: es lo más nuevo, pero cualquier fricción con una librería que asuma
`zone.js` sería tiempo perdido en algo que no es el problema.

### Lo que queda fuera del portal, a propósito

**La compuerta de aprobación (ADR-06) es del equipo, no del cliente** (ADR-20). El cliente entra en
**modo lectura**, y lo que ve —qué keywords, qué volumen, **y qué NO se sabe**— es el argumento de
venta del sistema: *dice lo que no sabe*.

---

## ADR-22 — La API REST (`api/`): Hono, y la seguridad vive en Postgres

**Estado:** Aceptada · implementa la etapa 5.1 · 2026-07-15

**Contexto.** El único caller del sistema era el CLI. El portal (ADR-16/21) necesita una superficie
HTTP, y esa superficie es donde un usuario final toca el sistema por primera vez — o sea, donde una
autorización mal puesta se convierte en escalada de privilegios.

### Framework: **Hono**

Frente a Express (más viejo, callback, `@types` aparte) y a `http` de Node (routing y parseo a
mano), se eligió **Hono**: mínimo, TS nativo, y —lo que decidió— se **testea con `app.request(new
Request(...))` sin abrir un socket**. Es el mismo espíritu que PGlite le dio a los tests de RLS:
Postgres real sin Docker, ahora HTTP real sin red. La suite corre la API entera —auth, rutas,
errores— contra PGlite, un emisor de mentira y un verificador falso, sin una sola credencial.

### Las tres reglas que NO se rompen (y cada una nació de un agujero real)

**1. La API afirma quién sos; qué podés hacer lo decide Postgres (ADR-15).** El middleware verifica
el JWT (firma + expiración) y pone `app.user_id`. El rol NO viaja: lo deriva RLS de `memberships`.
Un endpoint que aceptara `role` del body sería escalada servida en bandeja.

**2. El `tenant` es una coordenada, no una autoridad.** Viaja en un header sin firmar `x-amg-tenant`,
y está bien que así sea: reclamar un tenant ajeno no sirve de nada — no hay membresía allí, RLS no
deriva rol, no se ve ni se escribe nada. Autorizar es trabajo de la base, no del header.

**3. Los comandos compuestos escriben bajo RLS y SOLO DESPUÉS emiten (ADR-18).**
- `POST /runs`: `createRun` bajo RLS (ahí se autoriza) → recién si no lanzó, emite `research/solicitado`.
- `POST /runs/:id/approve`: `approveRun` bajo RLS → recién si de verdad actualizó, emite `research/aprobado`.

Al revés —emitir y después escribir— el orquestador podría arrancar (o publicar) a nombre de algo
que la base nunca autorizó. **Probado por mutación:** invertir el orden hace caer los tests de "un
comando rechazado no emite".

### La conexión: `amg_api` → `app_user`, y nada más (ADR-17)

La API se conecta con el login `amg_api`, autorizado a **un solo rol**. Si intentara asumir
`app_service`, Postgres rechaza el `set role`: la frontera es una credencial, no un `if`.

### Qué se le exige al token (corregido por la 8ª review)

Verificar la firma **no alcanza**. La primera versión llamaba `jwtVerify(token, secret)` a secas, y
eso valida la expiración **solo si el claim está**: un token firmado con el secreto correcto y **sin
`exp` era eterno**. Ahora se exigen `exp` y `sub`, se verifica `aud` (`authenticated`, lo que emite
Supabase) y se puede fijar `iss` (`SUPABASE_JWT_ISS`) para que un token válido de **otro proyecto**
Supabase no abra esta puerta.

> El agujero sobrevivió porque **ningún test tocaba el verificador real**: los de la API inyectan uno
> falso (correcto para probar rutas y RLS sin criptografía), así que mutar el verdadero para aceptar
> cualquier token dejaba la suite entera en verde. Hoy hay 12 tests con JWT firmados de verdad.

También se **impone el algoritmo** (`algorithms: ["HS256"]`). La 9ª review mostró que un **HS512
firmado con el mismo secreto entraba**: no es un bypass —hay que tener el secreto— pero una política
declarada y no impuesta no es una política. `alg:none` y un `sub` en blanco también se rechazan.

### Los errores de permisos NO se clasifican por el texto

`42501` (`insufficient_privilege`) llega por **RLS** y por un **GRANT roto**, y Postgres **no los
distingue por código**. Hubo una versión que los separaba mirando si el mensaje decía
`row-level security`. Está mal, y la 9ª review lo cazó: Postgres **traduce** los mensajes según
`lc_messages`, así que en un servidor no-inglés un rechazo legítimo de RLS dejaba de coincidir y
salía **500 en vez de 403**. Parsear texto de errores es una dependencia del idioma disfrazada de
lógica.

Ahora no se adivina: al cliente **siempre 403 sin detalle** —que es lo correcto para los dos casos,
no se le filtra si fue RLS o configuración— y al log el error completo, que es donde un operador
puede ver si hay una credencial mal puesta (ADR-17).

### CORS: el navegador del portal llama desde otro origen

El portal (5.2) corre en otro origen, así que la API lleva CORS (`CORS_ORIGINS`, default `*`). Es
seguro con `*` porque la API autentica por **header `Authorization`**, no por cookies: no hay
credenciales de sesión que un origen ajeno pueda robar, y el token igual hay que tenerlo. El
preflight (OPTIONS) corre **antes** que el middleware de auth —si no, lo bloquearía—. Probado.

### Un lector-no-escritor no puede colarse por la puerta del 200

`approveRun` devuelve un booleano de filas afectadas. Sin él, el rol `cliente` —que RLS deja VER el
run pero no actualizarlo— pasaba el conteo de páginas, el `update` afectaba **0 filas en silencio**,
y la API devolvía 200 y **despertaba al workflow** por algo que la base no cambió. Ahora, si el
update no tocó ninguna fila, la API responde 403 y no emite. Probado (y mutation-tested).

### Endpoints

| Endpoint | Qué hace |
|---|---|
| `POST /runs` | Crea la fila bajo RLS y emite `research/solicitado`. |
| `GET /runs` (`?clientId=`) | Los runs visibles; RLS decide el conjunto según el rol. |
| `GET /runs/:id` | El brief: el run + sus páginas propuestas (evidencia + estado de aprobación). |
| `POST /pages/:id/approve` | Aprueba una página (media compuerta, ADR-06). |
| `PATCH /pages/:id` | Corrige una página; editar **revoca** la aprobación (ADR-06). |
| `POST /runs/:id/approve` | Aprueba el run bajo RLS y emite `research/aprobado`. |

**Lo que queda fuera a propósito:** el rechazo del run (el workflow aún no escucha `research/rechazado`;
hoy la compuerta vence por timeout) y un `/health` (se agrega al definir el deploy, etapa 5.3).
