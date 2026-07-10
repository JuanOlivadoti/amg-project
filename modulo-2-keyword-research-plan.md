# Módulo 2 — Keyword Research · Plan técnico completo

> Documento de diseño e implementación. Complementa a `modulo-2-keyword-research.md` (alcance) con la arquitectura, modelo de datos, pipeline detallado, costos y roadmap.
> Versión 1.0 — 2026-07-08

---

## 0. Decisiones cerradas y supuestos

### 0.1 Decisiones confirmadas
| Decisión | Elección | Implicancia |
|---|---|---|
| Motor de datos SEO | **DataForSEO** | Pay-as-you-go, barato por consulta, pensado para pipelines programáticos. Reemplaza a SEMrush del doc original. |
| Grado de automatización | **Compuerta de aprobación humana** | El research genera un brief; un humano lo revisa/edita antes de disparar el Módulo 1. |
| Output | **JSON para M1 + informe legible** | Doble entregable: JSON estructurado (máquina) + informe Markdown/PDF (humano). |
| Mercado | **ES-first, diseño market-aware** | Arrancamos **solo con España (es-ES), un mercado por corrida**. El mercado va parametrizado (`country`/`language_code`/`location_code`), no hardcodeado, para escalar a otros idiomas sin reescritura. Ver §9. |

### 0.2 Supuestos con default (confirmar — ver §17)
- **Stack heredado del proyecto:** Next.js + TypeScript + Supabase (Postgres/RLS/Auth/Realtime/Storage/pgvector). Orquestación durable en código (Inngest o Trigger.dev). LLM: Claude (Opus 4.8 para generación/análisis, Haiku 4.5 para clasificación).
- **Consumidor del output:** Módulo 1 (Creador de Webs) sobre **Storyblok**. El JSON se adapta al esquema de bloks de Storyblok mediante un adaptador (§9.3).
- **Pesos de scoring por default:** volumen 0.30 · dificultad 0.30 · intención 0.20 · relevancia de negocio 0.20 (configurable por cliente).
- **Cache de enriquecimiento:** 30 días (los datos de volumen no cambian a diario).
- **Tope de páginas por run:** 25 por default (configurable) para evitar dumps de cientos de páginas.

---

## 1. Objetivo del módulo

Convertir un **prompt que describe un negocio** en un **brief estructurado de páginas priorizadas y clusterizadas**, con keyword principal, secundarias, intención, SEO on-page y FAQs, listo para alimentar al Módulo 1 tras aprobación humana.

Es la **entrada del pipeline**: decide *qué páginas crear, con qué keyword y qué intención cubrir*. El valor no está en el listado de keywords, está en que las decisiones ya vienen tomadas y encadenan con la creación de webs.

---

## 2. Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│  AMG OS (Next.js + Supabase)                                       │
│                                                                    │
│  [UI/API: crear run] ──POST──▶ Orquestador durable (Inngest)       │
│                                        │                           │
│   ┌────────────────────────────────────┼─────────────────────┐    │
│   │  PIPELINE (steps durables, con reintentos e idempotencia) │    │
│   │                                                           │    │
│   │  1. Validar input (mercado/idioma)                        │    │
│   │  2. Generar seeds ............... Claude Opus 4.8          │    │
│   │  3. Expandir keywords ........... DataForSEO Labs          │    │
│   │  4. Enriquecer métricas ......... DataForSEO (batch+cache) │    │
│   │  5. Embeddings .................. pgvector                 │    │
│   │  6. Clustering (semántico+SERP) . DataForSEO SERP          │    │
│   │  7. Clasificar intención ........ Haiku 4.5 + señales SERP │    │
│   │  8. Scoring y priorización ...... función determinista     │    │
│   │  9. Mapear clusters → páginas ... capa de decisión         │    │
│   │  10. Generar JSON + informe ..... Claude + plantilla       │    │
│   │  11. Persistir · status=pending_approval                  │    │
│   │                                                           │    │
│   └───────────────────────┬───────────────────────────────────┘    │
│                           ▼                                        │
│              [Compuerta de aprobación humana]                      │
│              UI de revisión · editar/aprobar/rechazar             │
│                           │ (evento: approved)                    │
│                           ▼                                        │
│              Adaptador → Módulo 1 (Storyblok)                     │
└──────────────────────────────────────────────────────────────────┘

Fuentes externas:  DataForSEO (Labs · Keywords Data · SERP) · Anthropic API
Persistencia:      Supabase Postgres (RLS por tenant) + Storage (informe PDF)
```

---

## 3. Stack técnico del módulo

| Capa | Tecnología | Rol |
|---|---|---|
| Orquestación | **Inngest** (o Trigger.dev) | Flujo durable, reintentos, `waitForEvent` para la compuerta humana, observabilidad. |
| Datos SEO | **DataForSEO** (Labs + Keywords Data + SERP) | Volumen, dificultad, CPC, tendencia, related, SERP. |
| LLM | **Claude Opus 4.8** (seeds, briefs, informe) · **Haiku 4.5** (clasificación de intención, tareas cortas) | Generación y clasificación. |
| Embeddings + clustering | Modelo de embeddings multilingüe + **pgvector** | Clustering semántico. |
| Persistencia | **Supabase Postgres** (RLS) + **Storage** | Estado, cache, informes. |
| API/UI | **Next.js** (API routes + páginas de revisión) | Disparo, estado en tiempo real, aprobación. |
| Tiempo real | **Supabase Realtime** | Progreso del run y notificación de "listo para aprobar". |

**Por qué Inngest/Trigger y no n8n aquí:** el pipeline tiene estado, reintentos por paso, una espera larga por aprobación humana y necesidad de trazabilidad — todo eso pertenece a un motor durable *en código* (versionable, testeable), no a un flujo visual. n8n queda para el *glue* de integraciones de otros módulos.

---

## 4. Modelo de datos (Postgres)

> **Fuente canónica:** [`modulo-2-esquema/schema.sql`](modulo-2-esquema/schema.sql) (v0.2). El bloque de abajo es un resumen; ante diferencias, manda el `.sql`.

**Todas** las tablas de tenant llevan `tenant_id` con **RLS y policy de aislamiento** (`tenant_id = current_tenant_id()`), no solo `enable`. Deltas v0.2 (post-review): `tenant_id` en todas las tablas hijas; cache **split** (`kr_metrics_cache` / `kr_serp_cache`) y **solo service-role** (RLS deny-all, no accesible desde cliente); tabla de idempotencia `kr_provider_tasks` (task_id de proveedor + `payload_hash`); coste en **micros** (`cost_micros_usd`); FKs y CHECKs; `score_confidence`; intención sin compuestos (`intent` + `is_local`). Las tablas de cache guardan solo datos SEO públicos (nunca prompt/tenant/source).

```sql
-- Corrida de research
kr_runs (
  id uuid pk, tenant_id uuid, client_id uuid,
  input_prompt text,
  -- mercado (ES-first, un mercado por corrida). Explícito para no hardcodear idioma.
  country text default 'ES', language_code text default 'es', location_code int default 2724,
  options jsonb,           -- pesos de scoring, max_pages, etc.
  status text,             -- queued|running|pending_approval|approved|rejected|failed
  cost_cents int default 0,
  created_by uuid, created_at timestamptz, updated_at timestamptz
)

-- Keyword enriquecida (por run y mercado)
kr_keywords (
  id uuid pk, run_id uuid fk, market jsonb,
  keyword text, source text,          -- seed|suggestion|related|ideas
  volume int, difficulty numeric, cpc numeric, competition numeric,
  trend jsonb,                         -- serie mensual
  intent text,                         -- transactional|informational|local|navigational|commercial
  embedding vector(1024),
  cluster_id uuid, opportunity_score numeric,
  discarded boolean default false, discard_reason text
)

-- Cluster temático
kr_clusters (
  id uuid pk, run_id uuid fk,
  label text, intent text, page_type text,
  primary_keyword_id uuid,
  aggregate_score numeric,
  serp_overlap jsonb                   -- URLs compartidas que justifican el cluster
)

-- Página propuesta (unidad que consume M1)
kr_pages (
  id uuid pk, run_id uuid fk, cluster_id uuid fk,
  page_type text, url_slug text,
  keyword_principal text, keywords_secundarias jsonb,
  intent text, volume int, difficulty numeric, opportunity_score numeric,
  seo jsonb,                           -- meta_title, meta_description, schema_type, canonical
  faqs jsonb, content_brief jsonb,     -- H1, secciones sugeridas, word_count, internal_links
  approved boolean, edited_by uuid
)

-- Cache compartida de enriquecimiento (ahorro de costo DataForSEO)
kr_cache (
  keyword text, location_code int, language_code text,
  metrics jsonb, serp jsonb, fetched_at timestamptz,
  unique(keyword, location_code, language_code)
)

-- Auditoría de la compuerta humana (trazabilidad IA del PRD)
kr_approvals (
  id uuid pk, run_id uuid fk, reviewer uuid,
  decision text, edits jsonb, note text, created_at timestamptz
)
```

---

## 5. Pipeline detallado

### Paso 1 — Validación de input
Entrada mínima:
```json
{
  "prompt": "Clínica dental en Valencia, España. Servicios: implantes, ortodoncia invisible, blanqueamiento.",
  "market": { "country": "ES", "location_code": 2724, "language_code": "es" },
  "options": { "max_pages": 25, "weights": { "volume": 0.30, "difficulty": 0.30, "intent": 0.20, "business": 0.20 } }
}
```
- **ES-first:** por ahora `market` es un único mercado; si no viene, se asume `es-ES` por default (España, `location_code` 2724).
- El campo existe explícito para no hardcodear idioma; sumar otro idioma más adelante = pasar otro `market` (ver §9).
- Se resuelven ISO country/language → `location_code`/`language_code` de DataForSEO.

### Paso 2 — Generación de seeds (Claude Opus 4.8)
El LLM extrae del prompt: servicios, ubicación, modificadores comerciales/locales, y genera 15–40 keywords semilla **en el idioma del mercado**. Salida estructurada (JSON) con `keyword` + `intent_hint` + `service`.
- Prompt fuerza el idioma objetivo y evita inventar servicios no mencionados (`business_relevance` alto).

### Paso 3 — Expansión de keywords (DataForSEO Labs)
Por cada seed, se llama en batch:
- `Keyword Suggestions` → variantes long-tail y preguntas (útiles para FAQs).
- `Related Keywords` → keywords semánticamente relacionadas.
- `Keyword Ideas` → ideas por término.

Resultado: universo de cientos–miles de candidatas. Se deduplica por texto normalizado (lowercase, sin tildes para el match, colapsar espacios) **conservando la forma canónica** para mostrar.

### Paso 4 — Enriquecimiento de métricas (DataForSEO + cache)
Para el universo deduplicado:
- `Keywords Data / Search Volume` (Google Ads) → volumen mensual + tendencia.
- `Bulk Keyword Difficulty` (Labs) → KD%.
- CPC y competencia (de Keywords Data).

Optimizaciones:
- **Cache** `kr_cache` con TTL 30 días: antes de llamar, se consulta cache por `(keyword, location_code, language_code)`.
- Endpoints **Standard (en cola)**, no Live: más barato; la latencia no importa porque hay compuerta humana después.
- Batching máximo por request (DataForSEO acepta arrays de keywords).
- **Budget guard:** tope de gasto por run; si se excede, se pausa y se marca para revisión.

### Paso 5 — Embeddings (pgvector)
Se generan embeddings multilingües de cada keyword y se guardan en `kr_keywords.embedding`. Base del clustering semántico y de la deduplicación fina (keywords casi idénticas).

### Paso 6 — Clustering (híbrido: semántico + validación SERP)
Enfoque profesional en dos niveles:
1. **Primera pasada — semántica (barata):** clustering por similitud coseno (pgvector) dentro del **mismo idioma**. Agrupa todo el universo sin coste de SERP.
2. **Validación SERP de cabezas (precisa):** solo para las keywords candidatas a *cabeza de cluster*, se pide `SERP API` (top 10). Si dos clusters comparten URLs en el top 10 → se **fusionan** (Google los trata como el mismo tema = una sola página). Es el criterio estándar (SERP-overlap) que usan las herramientas SEO serias, aplicado solo donde importa para controlar costo.

> **Refinamiento del overlap (Codex, a implementar en F2):** el umbral crudo "≥3 URLs" fusiona mal. Usar **overlap ponderado por ranking** (compartir el #1 pesa más que el #9), **canonicalizar por host/path**, **excluir SERP features y directorios/marketplaces** (Amazon, Doctoralia, etc. aparecen en todo y no implican mismo tema) y **validar semánticamente** el par antes de fusionar. Para clusters valiosos, comparar head + medoid + top secundaria.

Regla transversal (aplica ya, aunque en ES-only sea trivial): el clustering **nunca mezcla idiomas**. Cuando se activen más mercados, una misma keyword podrá existir en varios con volumen distinto (§9.2).

### Paso 7 — Clasificación de intención (Haiku 4.5 + señales SERP)
Intención granular por cluster:
`transactional · commercial · informational · local · navigational`.
Señales combinadas:
- Endpoint de search intent de DataForSEO (si disponible) como señal base.
- Features del SERP (packs locales → local; shopping/ads → transactional; People-Also-Ask → informational).
- Refinamiento con Haiku 4.5 sobre la keyword + snippet del SERP.

### Paso 8 — Scoring y priorización (determinista)
Ver §7. Cada keyword recibe `opportunity_score` (0–100); cada cluster, un `aggregate_score`. La keyword con mayor score y con intención coherente al `page_type` se elige como **principal**; el resto, **secundarias**.

### Paso 9 — Mapeo clusters → páginas (capa de decisión)
| Intención dominante del cluster | Tipo de página |
|---|---|
| transactional / commercial | Página de servicio |
| local (+ transactional) | Landing por ubicación |
| informational | Post de blog |
| navigational | Página institucional |

Reglas:
- **Un cluster = una página** (evita canibalización).
- Se aplica el tope `max_pages` priorizando por `aggregate_score`; lo que sobra queda como *backlog* (no descartado, marcado para fases futuras).
- Genera `url_slug` limpio y SEO (sin tildes, con keyword principal).

### Paso 10 — Generación de brief JSON + informe (Claude)
- **JSON** (§8.1): brief por página con SEO on-page, secundarias, FAQs y `content_brief` (H1, secciones sugeridas, word count objetivo, sugerencias de enlazado interno).
- **Informe legible** (§8.2): Markdown → PDF a Supabase Storage.

### Paso 11 — Persistencia y estado
Se guardan `kr_keywords`, `kr_clusters`, `kr_pages`; `kr_runs.status = pending_approval`; `cost_cents` actualizado. Realtime notifica "listo para aprobar".

### Paso 12 — Compuerta de aprobación humana
`waitForEvent('kr.run.approved')` durable. En la UI el revisor puede:
- Editar keyword principal/secundarias, tipo de página, slug, meta, FAQs.
- Aprobar/rechazar por página o en bloque.
- Cada acción queda en `kr_approvals` (quién, cuándo, qué editó).

### Paso 13 — Handoff al Módulo 1
Al aprobar, se emite evento con el payload adaptado al esquema de bloks de **Storyblok** (§9.3) y arranca la creación de webs.

---

## 6. Integración DataForSEO

| Necesidad | Endpoint | Nota de costo |
|---|---|---|
| Volumen + tendencia | Keywords Data → Search Volume (Google Ads) | Muy barato por keyword en batch. |
| Expansión | Labs → Keyword Suggestions / Related / Ideas | Barato por request. |
| Dificultad | Labs → Bulk Keyword Difficulty | Barato en bulk. |
| Intención | Labs → Search Intent | Barato. |
| SERP (clustering + intención) | SERP API (Standard) | El más caro; **solo para cabezas de cluster**. |

Buenas prácticas:
- **Standard (task POST + GET)** en vez de Live → menor costo.
- **Cache** con `expires_at`: `kr_metrics_cache` (por `keyword+location+language+endpoint`) y `kr_serp_cache` (además por `engine+device+serp_type+depth`, para no contaminar el clustering con SERP de device/tipo distinto).
- **Presupuesto preflight:** antes de cada fase se estima el gasto restante y se **bloquea** si supera `max_cost_micros`; el gasto real se registra en `cost_micros_usd`. (No solo un guard reactivo).
- **Idempotencia real** vía `kr_provider_tasks`: cada llamada externa (DataForSEO async `task_id`, LLM) se registra con `payload_hash`, `attempt` y `status`, para que los reintentos no dupliquen gasto ni mezclen resultados parciales. Inngest maneja el estado de steps; esta tabla cubre las tareas async del proveedor.

---

## 7. Modelo de scoring

Normalización y fórmula (score 0–100):

```
volume_norm   = log10(1 + volume) / log10(1 + volume_max_del_run)
difficulty_inv= 1 - (difficulty / 100)
intent_weight = { transactional:1.0, local:1.0, commercial:0.8, informational:0.6, navigational:0.4 }
business_rel  = relevancia 0..1 evaluada por LLM contra los servicios reales del cliente

opportunity_score = 100 * (
    w_v * volume_norm +
    w_d * difficulty_inv +
    w_i * intent_weight +
    w_b * business_rel
)
```

- **Pesos default:** `w_v=0.30, w_d=0.30, w_i=0.20, w_b=0.20` (configurables por cliente/campaña).
- **Log en volumen:** el volumen es long-tail; el log evita que un único término gigante aplaste todo.
- **`business_rel` como gate, no solo peso:** si `business_rel < 0.4` → la keyword se **descarta o se le limita el score máximo** (no basta con pesar 20%). Evita que una keyword irrelevante de alto volumen se cuele. Con override humano en la compuerta.
- **Tratamiento de nulls:** `difficulty` nula NO se trata como fácil; se **penaliza** y baja `score_confidence`. Idem volumen faltante.
- **`score_confidence` (0..1):** refleja cuántos datos reales respaldan el score; se muestra en el informe para que el revisor priorice con criterio.
- **Quick-win flag:** `volume_norm alto` + `difficulty < 30` + `confidence alto` → se destaca en el informe.
- **Score de cluster:** media ponderada por volumen de sus miembros.

> **A afinar tras pruebas (Codex):** normalizar `volume_norm` por **percentiles del mercado/vertical** en vez de `volume_max_del_run` (los scores no son comparables entre runs de distinto tamaño), y winsorizar outliers. Se calibra con datos reales en la Fase 0; el default por-run alcanza para el primer spike.

---

## 8. Esquemas de output

### 8.1 JSON (brief para Módulo 1)
```json
{
  "run_id": "uuid",
  "cliente": "Clínica dental Valencia",
  "market": { "country": "ES", "language": "es" },
  "generated_at": "2026-07-08T12:00:00Z",
  "paginas_propuestas": [
    {
      "cluster_id": "uuid",
      "tipo": "servicio",
      "url_slug": "/implantes-dentales-valencia",
      "keyword_principal": "implantes dentales Valencia",
      "keywords_secundarias": ["precio implantes Valencia", "implantes all-on-4 Valencia"],
      "intencion": "transactional-local",
      "volumen": 1900,
      "dificultad": 42,
      "opportunity_score": 78,
      "seo": {
        "meta_title": "Implantes Dentales en Valencia | Clínica X",
        "meta_description": "…",
        "schema_type": "LocalBusiness",
        "canonical": "https://…/implantes-dentales-valencia"
      },
      "content_brief": {
        "h1": "Implantes dentales en Valencia",
        "secciones_sugeridas": ["Qué son", "Precios", "All-on-4", "Proceso", "FAQ"],
        "word_count_objetivo": 1200,
        "enlazado_interno": ["/ortodoncia-invisible-valencia"]
      },
      "preguntas_frecuentes": [
        "¿Cuánto cuesta un implante en Valencia?",
        "¿Cuánto dura un implante dental?"
      ]
    }
  ],
  "backlog": [ { "keyword_principal": "…", "opportunity_score": 41 } ],
  "meta_run": { "keywords_analizadas": 812, "paginas_propuestas": 12, "coste_api_cents": 34 }
}
```

### 8.2 Informe legible (Markdown → PDF)
Secciones: resumen ejecutivo · nº keywords analizadas · páginas propuestas por tipo · tabla de clusters (cabeza, volumen, KD, score, intención) · **quick wins** destacados · keywords descartadas y por qué · costo de API consumido · backlog para fases futuras.

---

## 9. Mercado (ES-first, market-aware) y handoff

### 9.1 Alcance actual y diseño
**Arrancamos con España (es-ES), un mercado por corrida.** El mercado va parametrizado (`country + language_code + location_code`), no hardcodeado, así que sumar otro idioma no implica reescritura. Regla transversal: el clustering **nunca mezcla idiomas**.

Costo de escalar a otros idiomas más adelante:
| Extensión futura | Esfuerzo | Por qué |
|---|---|---|
| Otro idioma (EN, PT, …) | Trivial — pasar otro `market` | Seeds, DataForSEO, intención y scoring ya son agnósticos al idioma |
| Varios mercados en una misma corrida | Pequeño/aditivo | `market` (uno) → `markets[]` (varios); no es rewrite |
| Deduplicar keyword entre países (ES-ES vs ES-MX) | Pequeño/aditivo | Lógica de consolidación, solo relevante con >1 mercado hispano |

**Pieza a respetar desde ya:** usar un **modelo de embeddings multilingüe** (no solo-ES). Es lo único que, si se hace mal ahora, convierte el multi-idioma en una desviación grande.

### 9.2 Deduplicación entre mercados (futuro)
Cuando se active más de un mercado: la misma keyword en ES y MX se conserva por separado (volumen y SERP difieren); el informe podrá consolidar o separar por mercado según config. Fuera de alcance en la fase ES-only.

### 9.3 Adaptador al Módulo 1 (Storyblok)
Un adaptador traduce cada `kr_pages` → **story de Storyblok** con sus bloks (`hero`, `servicios`, `faq`, `seo`). El brief es neutral; el acoplamiento a Storyblok vive solo en el adaptador, así que cambiar de CMS no toca el pipeline.

> **Dependencia abierta:** necesito el **contrato de bloks del Módulo 1** para fijar el mapeo exacto. Ver §17.

---

## 10. Orquestación, errores y observabilidad

- **Steps durables** (Inngest) con reintentos por paso y backoff; un fallo de DataForSEO no reinicia todo el run.
- **Idempotencia** por keyword+mercado (cache) → reintentos no re-cobran API.
- **Compuerta** como `waitForEvent` con timeout configurable (ej. 7 días) → si nadie aprueba, se escala/notifica.
- **Observabilidad:** log por step, costo por step, métricas de calidad de clustering, alertas de fallo de integración y de sobre-costo de LLM/DataForSEO (RNF de monitoreo del PRD).
- **Trazabilidad IA:** se registran prompts, salidas y aprobaciones (`kr_approvals`).

---

## 11. Seguridad, multi-tenancy y RGPD

- **RLS con policy de aislamiento** (`tenant_id = current_tenant_id()`) en **todas** las tablas de tenant; **tests RLS** (un tenant no ve datos de otro) antes de F1.
- **Cache solo service-role:** `kr_metrics_cache`/`kr_serp_cache` con RLS deny-all → nunca accesibles desde cliente/dashboard/API pública (evita usarla como *oracle*). Guardan solo datos SEO públicos, nunca prompt/tenant/source.
- **Secretos** (DataForSEO, Anthropic) en variables de entorno / gestor de secretos; nunca expuestos por tenant.
- **RGPD reforzado:** el research usa datos SEO públicos (bajo riesgo), pero **el prompt y las trazas de LLM pueden contener datos personales/confidenciales** que salen a proveedores externos. Medidas: **no guardar el prompt completo** si no hace falta, **redacción de PII** antes de enviar/loguear, **retención con borrado en cascada real** por tenant, **DPA** con proveedores (Anthropic/DataForSEO) y auditoría de acceso.
- **Contrato editorial/legal en el brief:** `content_brief` incluye `claims_permitidos`/`claims_prohibidos`, `cta` y `tono` — crítico en sectores regulados (salud, gastronomía) para que el Módulo 1 no genere páginas comercialmente aprobables pero legalmente peligrosas.
- **Sin acciones irreversibles automáticas:** la creación de webs solo se dispara tras aprobación humana explícita (restricción de seguridad del PRD).

---

## 12. Estrategia de testing

- **Unitarios:** función de scoring y normalización, mapeo de intención, deduplicación, generación de slug.
- **Contract tests / mocks:** DataForSEO y Anthropic con fixtures grabados (sin gastar API en CI).
- **Golden set:** prompt fijo → snapshot esperado de clusters/páginas (regresión de calidad).
- **Eval de clustering:** muestra etiquetada a mano → medir precisión de agrupación.
- **Regresión de costo:** el golden run no debe exceder un presupuesto de API definido.

---

## 13. Interfaces (API + UI)

| Método | Endpoint | Rol |
|---|---|---|
| POST | `/api/kr/runs` | Crear run (prompt, market, options). |
| GET | `/api/kr/runs/:id` | Estado + resultados. |
| GET | `/api/kr/runs/:id/report` | Descargar informe PDF. |
| POST | `/api/kr/runs/:id/approve` | Aprobar (con edits) → dispara M1. |
| POST | `/api/kr/runs/:id/reject` | Rechazar con motivo. |

- **UI de revisión** (Next.js): lista de páginas propuestas, edición inline, aprobar/rechazar por página o en bloque, progreso en tiempo real (Realtime).

---

## 14. Costos

### 14.1 Operativos (por research, orden de magnitud)
- **DataForSEO:** con cache y SERP solo en cabezas, un research típico (cientos–pocos miles de keywords) ronda **centavos a pocos dólares**. Se registra el costo real por run (`cost_cents`).
- **Claude:** seeds + clasificación + brief + informe → costo bajo por run (Haiku para clasificación, Opus para generación).
- Ambos los **paga Frank** vía su cuenta; se documentan en la propuesta.

### 14.2 Desarrollo (nuestro) — ver §15.

---

## 15. Roadmap de implementación y esfuerzo

> Estimación en **días-desarrollador (dd)**, rangos. Asume 1 dev senior full-stack familiarizado con el stack. Sirve para presupuestar; se ajusta con la velocidad real del equipo.

| Fase | Alcance | Esfuerzo |
|---|---|---|
| **F0 · Setup & spikes** | Cuenta DataForSEO, spike de endpoints y validación de costo real, esquema Postgres + RLS, esqueleto Inngest. | 3–5 dd |
| **F1 · Pipeline núcleo** | Input→seeds→expansión→enriquecimiento→scoring→JSON, un mercado, sin clustering fino. Output JSON básico. | 8–12 dd |
| **F2 · Clustering + priorización** | Embeddings multilingües/pgvector, clustering híbrido con validación SERP, clasificación de intención, scoring y mapeo a páginas. (ES-only; el diseño multilingüe queda listo pero no se activan otros mercados). | 8–12 dd |
| **F3 · Compuerta + informe + handoff** | UI de revisión/edición/aprobación, generación de informe PDF, adaptador a Storyblok (Módulo 1). | 6–10 dd |
| **F4 · Hardening** | Cache, budget guard, observabilidad, alertas de costo, suite de tests + golden set. | 5–8 dd |
| **Total** | | **~30–47 dd** |

Vendible por fases: F0+F1 ya entrega un research automatizado con JSON; F2 sube la calidad; F3 cierra el flujo con humano y encadena a webs; F4 lo vuelve productivo y confiable.

---

## 16. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Costo de API sin control | Media | Medio | Cache 30d, SERP solo en cabezas, budget guard por run, endpoints Standard. |
| Calidad de clustering pobre | Media | Alto | Híbrido semántico + validación SERP; eval con golden set; ajuste de umbral de overlap. |
| Intención mal clasificada → página equivocada | Media | Medio | Señales SERP + LLM; la compuerta humana corrige antes de crear la web. |
| Datos de DataForSEO inexactos en algún mercado | Baja | Medio | Validar por mercado en F0; permitir override manual en la UI. |
| Contrato de bloks del M1 aún indefinido | Alta | Alto | Brief neutral + adaptador aislado; cerrar contrato con quien haga M1 antes de F3. |
| Escalar a multi-idioma después sale caro si se hardcodea ES ahora | Media | Medio | Diseño market-aware desde el v0 + embeddings multilingües; arrancar ES-only sin hardcodear idioma. |
| LLM inventa servicios/keywords irrelevantes | Media | Medio | `business_rel` en el scoring + prompt restrictivo + revisión humana. |

---

## 17. Decisiones abiertas (necesito de vos)

1. **Contrato del Módulo 1:** ¿el creador de webs (Storyblok) ya tiene definido su esquema de bloks/entrada? Sin eso, el adaptador de §9.3 queda estimado. **Bloquea F3.**
2. **Pesos de scoring:** ¿los defaults (0.30/0.30/0.20/0.20) reflejan la prioridad de negocio, o querés más peso a volumen (tráfico) o a baja dificultad (quick wins)?
3. **Tope de páginas por run** (default 25): ¿te sirve o querés otro límite?
4. **Informe:** ¿PDF alcanza, o querés también el dashboard interactivo (era la 3ª opción del output — implica +esfuerzo en F3)?

**Resueltas:** ~~Mercado inicial~~ → **ES-only, un mercado por corrida** (§9). ~~Run multi-mercado vs. por mercado~~ → **un mercado por corrida**. ~~Inngest vs Trigger.dev~~ → **Inngest** (ADR-03).

---

## 18. Definition of Done

- Un prompt de negocio produce un brief JSON válido + informe PDF, en el/los mercado(s) indicado(s).
- Keywords enriquecidas con volumen/KD/CPC/tendencia/intención reales de DataForSEO.
- Clusters coherentes (validados por SERP en cabezas) mapeados a páginas sin canibalización.
- Compuerta humana funcional con edición y auditoría.
- Costo por run registrado y dentro de presupuesto.
- Handoff al Módulo 1 disparado solo tras aprobación.
- Suite de tests (unit + golden set) en verde en CI sin gastar API real.
```

