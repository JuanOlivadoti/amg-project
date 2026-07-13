# 4. Módulo 2 — Keyword Research (`kr-service`)

## Qué hace

Recibe **un prompt de negocio en texto libre** y devuelve un **brief SEO estructurado**: qué
páginas debería tener el sitio, con qué keyword principal cada una, por qué, y con el contenido
on-page ya redactado.

**Entrada:**
```
"Restaurante italiano en Madrid centro. Especialidades: pizza napolitana,
 pasta fresca, menú del día, cenas para grupos y brunch de fin de semana."
```

**Salida:** `out/brief.json` (contrato para el Módulo 1) + `out/informe.md` (entregable legible
para que un humano lo revise en la compuerta de aprobación — [ADR-07](../decisiones-arquitectura.md)).

## Cómo correrlo

```bash
cd kr-service
npm install
npm run spike                     # caso por defecto (restaurante en Madrid)
npm run spike "Clínica dental en Valencia. Servicios: implantes, ortodoncia."
npm run typecheck
npm test
```

Sin ninguna credencial funciona igual (modo mock). Ver [Configuración](07-configuracion.md).

---

## El pipeline, paso a paso

Orquestado en `src/pipeline/run.ts`, en este orden de ejecución:

### 1. Seeds (LLM)
`llm/seeds.ts` → `TextGen.generateSeeds()`

El LLM genera 15-30 keywords semilla a partir del prompt, en el idioma del mercado. Se le
instruye explícitamente **no inventar servicios que el negocio no mencionó**.

### 2. Expansión (DataForSEO)
`KeywordDataProvider.keywordSuggestions()` — endpoint `dataforseo_labs/google/keyword_suggestions/live`

Por cada una de las **primeras 10 seeds**, pide hasta 20 sugerencias. Todo se acumula en un `Set`
(deduplicado). El límite de 10 seeds es un **control de costo** deliberado.

### 3. Enriquecimiento (DataForSEO, en paralelo)
- `searchVolume()` → volumen, CPC, competencia (`keywords_data/google_ads/search_volume/live`)
- `bulkKeywordDifficulty()` → KD 0-100 (`dataforseo_labs/google/bulk_keyword_difficulty/live`)

Ambas llamadas van en `Promise.all` y **cada una tiene su propio `catch`**: si una falla, la otra
sigue y los campos quedan `null` (el scoring lo penaliza vía `score_confidence`).

> **Matching canónico:** los resultados se indexan por `canonicalKey()` (`lib/text.ts`: NFC +
> trim + colapso de espacios + minúsculas). Sin esto, un proveedor que devuelve
> `"Pizza  Napolitana"` en vez de `"pizza napolitana"` haría fallar el lookup y **la métrica se
> perdería en silencio**.

### 4. Intención de búsqueda (LLM, en batch)
`pipeline/enrich-content.ts` → `applyIntents()` → `ContentGen.classifyIntents()`

**Una sola llamada** al LLM clasifica todas las keywords a la vez (barato y rápido). Devuelve:
- `intent`: `transactional` | `commercial` | `local` | `informational` | `navigational`
- `is_local`: booleano (intención geográfica real)

Se separan a propósito: la intención local es una **señal compuesta**, no un sexto valor del enum
([ADR-10](../decisiones-arquitectura.md)).

**Fallback:** cualquier keyword que el LLM no devuelva (o si la llamada entera falla) cae al
clasificador **heurístico** de `pipeline/intent.ts` (regex sobre `precio|reservar|mejor|cómo|...`).
El pipeline reporta cuántas resolvió cada vía: `[intent] clasificadas 23 · LLM 23 · heurística 0`.

> **Pendiente:** usar señales del SERP (presencia de *map pack*) para `is_local` en vez de
> inferirlo. Requiere datos de producción.

### 5. Relevancia de negocio (LLM)
`applyBusinessRelevance()` → `ContentGen.businessRelevance()`

Puntúa cada keyword de 0 a 1: *¿qué tan relevante es para captar clientes de ESTE negocio?*
Es lo que evita que el research proponga páginas sobre keywords con volumen pero sin relación
con el negocio.

### 6. Scoring
`pipeline/scoring.ts` → `scoreKeywords()`

Calcula `opportunity_score` (0-100) y `score_confidence` (0-1).

**Fórmula** (pesos configurables, defaults en `WEIGHTS_DEFAULT`):
```
score = 0.30 · volumen_normalizado(log)     # log10 sobre el máximo del run
      + 0.30 · (1 - KD/100)                 # menos dificultad = más oportunidad
      + 0.20 · peso_de_intención            # transactional/local 1.0 … navigational 0.4
      + 0.20 · business_relevance
```

**`business_relevance` no es solo un peso: es un gate** ([ADR-10](../decisiones-arquitectura.md)):

| Caso | Comportamiento |
|---|---|
| Evaluada y **< 0.4** | **Descartada** (`discarded = true`, score 0). Es irrelevante para el negocio. |
| Evaluada y ≥ 0.4 | Score normal, confianza plena. |
| **No evaluada** (`null`) | **No se promueve**: score **capeado a 35** y `score_confidence` −0.4, con motivo registrado. |

Ese último caso es importante: si el LLM se cae, antes las keywords sin evaluar pasaban como
"neutras" (0.6) y **superaban el gate sin haber sido evaluadas nunca**. Ahora se distingue
*"irrelevante"* (evaluado, se descarta) de *"desconocido"* (sin evaluar, se demota y se marca
para revisión).

`score_confidence` baja cuando faltan datos: −0.4 sin volumen, −0.3 sin KD, −0.4 sin relevancia.

### 7. Clustering híbrido
`pipeline/cluster.ts` → `clusterKeywords()`

Dos etapas:

1. **Semántico (barato, cubre todo):** se embeben todas las keywords (OpenAI
   `text-embedding-3-small`, multilingüe) y se agrupan *greedy* por **similitud coseno ≥ 0.55**.
   Las de mayor `opportunity_score` quedan como **cabezas** de cluster.
2. **Validación por SERP (caro, solo el top):** para las **15 cabezas** de mayor score se pide el
   SERP orgánico real. Si dos cabezas comparten **≥ 3 URLs**, se **fusionan** (Google las considera
   la misma intención → deben ser una sola página, no dos que compitan entre sí).

El uso de un modelo de embeddings **multilingüe** desde el v0 es lo que permite sumar otro idioma
después sin reescribir ([ADR-08](../decisiones-arquitectura.md)).

> El SERP es el endpoint más caro de DataForSEO; limitarlo a 15 cabezas es un control de costo.

### 8. Mapeo cluster → páginas
`pipeline/cluster-map.ts` → `mapClustersToPages()`

Un cluster = una página. Se ordenan por score; las primeras `max_pages` (default 25) se
convierten en páginas propuestas, el resto va al **backlog**.

El `page_type` se deriva de la intención:

| Condición | `page_type` | `schema_type` (JSON-LD) |
|---|---|---|
| `is_local` | `landing_local` | `LocalBusiness` |
| `transactional` / `commercial` | `servicio` | `WebPage` |
| `informational` | `blog` | `Article` |
| resto | `institucional` | `WebPage` |

**Toda página nace con `approved: false`.**

### 9. Contenido on-page (LLM)
`applyPageContent()` → `ContentGen.pageContent()` — una llamada por página.

Genera: `meta_title`, `meta_description`, `h1`, secciones sugeridas, `word_count_objetivo`, FAQs,
CTA, tono, y el **contrato editorial**: `claims_permitidos` y `claims_prohibidos`.

Los claims prohibidos importan: el sistema opera en **sectores regulados** (gastronomía, salud).
El prompt instruye no prometer resultados garantizados ni hacer claims médicos indebidos, y la
lista viaja con la página para que quien redacte (o el LLM del Módulo 1) la respete.

### 10. Ensamblado y validación
`pipeline/brief.ts` → `assembleBrief()` + `renderReport()`

Produce el brief (`status: "pending_approval"`, `schema_version: "kr.v0.2"`, `run_id`, `meta_run`
con keywords analizadas / páginas / coste en micros) y el informe Markdown.

El CLI **valida el brief contra el esquema Zod** (`validation/brief.schema.ts`) antes de escribirlo.
Si no valida, sale con código de error.

---

## Costos

El `KeywordDataProvider` acumula el coste reportado por DataForSEO en cada llamada
(`costMicros`, en millonésimas de USD) y viaja en `brief.meta_run.coste_micros_usd`.

> ⚠️ **Ese coste NO incluye OpenAI/Anthropic**, solo DataForSEO. Y el **presupuesto preflight**
> (`options.max_cost_micros`) está **declarado en los tipos pero no implementado**: hoy no bloquea
> nada. Es una de las tareas pendientes de producción.

## Estado

| Pieza | Estado |
|---|---|
| Provider DataForSEO mock/live | ✅ |
| Provider LLM mock/openai/anthropic (generación + embeddings) | ✅ |
| Seeds, expansión, enriquecimiento | ✅ |
| Intención por LLM (+ fallback heurístico) | ✅ |
| `business_relevance` como gate real | ✅ |
| Scoring con confianza y manejo de nulls | ✅ |
| Clustering híbrido (embeddings + SERP overlap) | ✅ |
| Mapeo a páginas + contenido on-page + brief + informe | ✅ |
| Señales de SERP para `is_local` | ⛔ Requiere producción |
| Presupuesto preflight, retries, timeouts | ⛔ Ver [roadmap](09-estado-y-roadmap.md) |
| Persistencia, multi-tenancy, Inngest | ⛔ Fase 2-3 |
