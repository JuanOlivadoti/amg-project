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
| ADR-04 | CMS del Módulo 1 (Creador de Webs): **Storyblok** | Aceptada (a confirmar por flujo de edición) |
| ADR-05 | Motor de datos del Módulo 2 (Keyword Research): **DataForSEO** | Aceptada |
| ADR-06 | Compuerta de aprobación humana entre Módulo 2 y Módulo 1 | Aceptada |
| ADR-07 | Output del Módulo 2: **JSON + informe legible** | Aceptada |
| ADR-08 | Mercado del Módulo 2: **ES-first, diseño market-aware** | Aceptada |
| ADR-09 | LLM: **proveedor abstracto** (OpenAI/Anthropic); embeddings OpenAI | Aceptada |
| ADR-10 | Endurecimiento del esquema del Módulo 2 (post-review) | Aceptada |
| ADR-11 | Política de salida/offboarding de webs de cliente | Aceptada |
| ADR-12 | Orquestador durable (Inngest): el evento dispara, la base decide | Aceptada |
| ADR-13 | El acceso a la base es SOLO por transacción con conexión reservada | Aceptada |
| ADR-14 | Idempotencia por `payload_hash`, **no** método Standard de DataForSEO | Aceptada |
| ADR-15 | El rol no se declara: se deriva de `memberships` | Aceptada (cierra OBS-02) |
| ADR-16 | Portal en **Angular + Tailwind** (reemplaza ADR-02) | Aceptada |
| ADR-17 | **Un proceso, un login, un rol**: la separación la impone Postgres | Aceptada (corrige ADR-15) |
| ADR-18 | Un evento no porta autoridad: la API crea el run, el evento lo dispara | Aceptada |
| OBS-01 | Solapamiento de alcance entre los dos documentos (Frank ≈ Franco) | Abierta — riesgo |
| OBS-02 | El rol y el `client_id` los declara el caller, no `memberships` | ✅ **CERRADA** por ADR-15 |

---

## ADR-01 — Núcleo de datos + identidad: Supabase
**Contexto.** El PRD exige multi-tenancy con aislamiento, RBAC (Maestro/Equipo/Cliente), alertas casi en tiempo real, RAG por cliente, object storage (para salir del Drive de clave única) y offboarding en <5 min.
**Decisión.** Usar **Supabase** como núcleo: Postgres + Row Level Security (multi-tenant), Auth (RBAC), Realtime (alertas), pgvector (RAG), Storage (objetos).
**Alternativas descartadas.** Ensamblar servicios separados (Auth0 + RDS + Pinecone + S3 + Pusher): más piezas, más costo, más integración.
**Justificación.** Un solo Postgres resuelve 5 requisitos a la vez → menor costo de desarrollo y presupuesto por fases defendible frente al cliente. Aislamiento vía RLS por `tenant_id`.

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

## ADR-14 — Idempotencia de las peticiones facturables: registro por `payload_hash`, NO método Standard

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
`payload_hash` (endpoint + cuerpo + **entorno**), **antes** de enviarla. Cubre el **100%** de la
superficie facturable, los cuatro endpoints.

**La distinción que lo hace correcto — hay dos formas de fallar, y solo una es recuperable:**

- **Respuesta recibida con la task en error** (p. ej. 40501): el proveedor **no cobró**, y lo sabemos
  porque nos lo dijo → se marca `failed` → reintentar es seguro.
- **Sin respuesta** (timeout, 5xx, el proceso muere): **ambiguo**. La petición pudo llegar,
  ejecutarse y cobrarse. La reserva se deja en `pending` **a propósito** → el siguiente intento sabe
  que **puede estar repagando**, lo cuenta y lo grita. Marcarla `failed` sería afirmar que no cobró
  sin tener ni idea.

**Lo que este diseño NO puede hacer, y hay que decirlo:** con un endpoint live, un resultado cuya
respuesta se perdió **es irrecuperable**. Ese dinero está perdido y no hay diseño que lo rescate. Lo
que sí se garantiza es que **no se pague dos veces por la misma petición** — que con los reintentos
de Inngest re-ejecutando el pipeline entero (ADR-12) dejó de ser hipotético. Los reenvíos se cortan
a los 3 intentos: insistir sin respuesta es vaciar el saldo por nada.

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
- **El orquestador no usa membresías.** Es un proceso, no una persona: se conecta como el rol de
  Postgres `app_service`. Su autoridad es una **credencial de base de datos**, no un campo en una
  petición — y eso sí es una autoridad: para falsificarla hace falta la contraseña de Postgres, y
  quien la tiene ya ganó. No hay nadie a quien suplantar, así que no hace falta provisionar nada.
- Lo que la API **sí** afirma es la identidad (`app.user_id`), y es legítimo porque acaba de validar
  el token contra la clave pública del emisor. Lo que ya **no** puede afirmar es qué puede hacer esa
  identidad.

Verificado por mutación: si la función vuelve a aceptar el rol declarado (aunque sea como respaldo),
un usuario **sin ninguna membresía** que se declara `maestro` entra — y solo ese test cae.

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
