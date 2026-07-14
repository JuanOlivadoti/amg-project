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

Por cada una de las **primeras 10 seeds**, pide hasta 20 sugerencias. El límite de 10 seeds es un
**control de costo** deliberado.

> **Dedupe canónico** (`dedupeByCanonical`, `lib/text.ts`): un `Set` de strings crudos **no
> alcanza**. `"pasta fresca Madrid"` y `"pasta fresca madrid"` son la misma keyword para Google,
> pero el `Set` las guarda como dos — y a DataForSEO **se le paga por keyword**. En la primera
> corrida real eran 4 de 60 (~7% de sobrecosto), y además ensuciaban los clusters con miembros
> redundantes.

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
   `text-embedding-3-small`, multilingüe) y se agrupan *greedy* por **similitud coseno ≥ 0.75**.
   Las de mayor `opportunity_score` quedan como **cabezas** de cluster.

   > **El umbral está calibrado contra datos reales, no elegido a ojo.** El 0.55 original era
   > demasiado permisivo: las keywords locales cortas comparten todas *"madrid"* + *"italiano"*,
   > así que el coseno las unía casi todas. En el primer dataset real colapsaba **41 de 45**
   > keywords vivas en UN cluster, fusionando *pasta fresca*, *pizza napolitana* y *restaurante
   > italiano centro* —tres páginas comercialmente distintas— en una sola: **3 páginas propuestas
   > en vez de 8**. Se barrió 0.55→0.85 sobre `out/keywords.json` y 0.75 es donde las cabezas caen
   > sobre los servicios reales del negocio. Por encima de 0.85 se fragmenta.
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

Produce el brief (`status: "pending_approval"`, `schema_version: "kr.v0.5"`, `run_id`, `meta_run`
con keywords analizadas / páginas / coste en micros) y el informe Markdown.

El CLI **valida el brief contra el esquema Zod** (`validation/brief.schema.ts`) antes de escribirlo.
Si no valida, sale con código de error.

> ### ⚠️ `null` no es `0` (contrato `kr.v0.4`, hoy `kr.v0.5`)
>
> `volumen` y `dificultad` son **nullable**. `null` significa *"el proveedor no devolvió la
> métrica"*, que **no es lo mismo** que *"esta keyword tiene 0 búsquedas al mes"*.
>
> Antes se coaccionaba a `0` (`head.volume ?? 0`) y el informe —el entregable que ve el cliente—
> afirmaba que una keyword no tenía búsquedas cuando en realidad no teníamos el dato. Con datos
> reales el problema es masivo: DataForSEO devolvió KD `null` en **41 de 60** keywords.
>
> Ahora el informe muestra **`n/d`** y lo explica. Es el mismo principio que el medidor de costo,
> que se niega a inventar el precio de un modelo sin tarifa: **mejor un dato honestamente ausente
> que uno inventado.**

### 11. Persistencia del dataset crudo
`out/keywords.json` — las keywords enriquecidas + los clusters.

El brief solo lleva las **páginas propuestas**. Sin este volcado, los datos por los que se le pagó
a DataForSEO **se perdían al terminar el proceso**, y cualquier ajuste de scoring o clustering
obligaba a pagar OTRA corrida. Con el volcado, el tuning es **offline y gratis**: así se calibró
el umbral de clustering.

---

## Costos y presupuesto

El costo se mide en **micros de USD** (millonésimas) para evitar errores de coma flotante
([ADR-10](../decisiones-arquitectura.md)).

### Medición (`lib/cost.ts`)

El `CostMeter` acumula **todos los proveedores** y devuelve el desglose:

| Fuente | Cómo se obtiene |
|---|---|
| **DataForSEO** | **Real**: la API reporta el `cost` de cada task. |
| **LLM (generación)** | **Calculado**: tokens reales que reporta el proveedor × tarifa configurable. |
| **LLM (embeddings)** | Ídem (los embeddings solo pagan la entrada). |

Va al brief en `meta_run.coste_micros_usd` (total) + `meta_run.coste_breakdown` (por proveedor),
y al informe humano como una tabla. En el log del run:

```
[cost] total $0.3108 · DFS $0.2522 · LLM $0.0586 · emb $0.0000
```

### 📊 Costo real medido (producción, 2026-07-13)

> **Un research completo cuesta ~$0.31** — 52 keywords analizadas → 8 páginas con contenido
> on-page. Estable en tres corridas ($0.2765 / $0.2783 / $0.3108).

| Proveedor | Coste | % |
|---|---|---|
| **DataForSEO** | $0.2522 | **81%** |
| LLM (generación) | $0.0586 | 19% |
| LLM (embeddings) | $0.0000 | ~0% |

**El 81% del costo es DataForSEO, no la IA.** Es contraintuitivo y tiene una consecuencia directa:
cambiar a un modelo de LLM más barato mueve poco la aguja (el LLM es el 19%); lo que sí importa es
**cuántas keywords se le mandan a DataForSEO** — de ahí que el dedupe canónico y el límite de 10
seeds sean controles de costo reales.

> ✅ **Las tarifas están verificadas** contra las páginas oficiales de OpenAI (2026-07-13):
> `gpt-4o` $2.50/$10.00 y `text-embedding-3-small` $0.02 por 1M de tokens. Están en
> `DEFAULT_PRICES` (`lib/cost.ts`) y se sobrescriben con la variable `LLM_PRICES` (JSON).
> Los precios cambian: re-verificar antes de cerrar una propuesta comercial.
>
> Si se usa un modelo **sin tarifa configurada**, el costo **no se inventa**: se cuenta 0, el
> modelo se registra en `modelos_sin_precio` y el total se marca como **incompleto**. Es preferible
> un total honestamente incompleto a uno inventado. *(No hay tarifas de Anthropic cargadas.)*

### Presupuesto preflight (`lib/budget.ts`)

`options.max_cost_micros` **bloquea de verdad**: antes de cada fase se estima su costo y, si no
entra en el remanente, **se aborta sin haber gastado**.

```
[budget] tope del run: $0.0010
✖ Presupuesto insuficiente para la fase "seeds": estimado $0.0030,
  gastado $0.0000, tope $0.0010. No se ejecutó la fase.
```

Hay preflight antes de: seeds, expansión, enriquecimiento, intención, relevancia, clustering
(la fase más cara: incluye SERP) y contenido on-page. Al final hay un **corte post-fase** por si
la estimación se quedó corta.

Desde el CLI se activa con `MAX_COST_USD`:

```bash
MAX_COST_USD=1.00 npm run spike "Restaurante italiano en Madrid centro..."
```

Sin tope, nunca bloquea.

> Las **estimaciones por llamada** (`DEFAULT_ESTIMATES`) siguen siendo aproximadas y sirven solo
> para decidir si arrancar una fase; el costo **real** se mide aparte. Ya hay datos de producción
> para calibrarlas (`out/keywords.json`), pero **todavía no se aplicaron**.

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
| **Costo completo (DataForSEO + LLM) con desglose** | ✅ |
| **Presupuesto preflight (bloquea antes de gastar)** | ✅ |
| **Resiliencia HTTP** (timeout, retries con backoff, `Retry-After`) | ✅ |
| **`ContentGen` completo en los 3 proveedores** (openai / anthropic / mock) | ✅ |
| **Corrida real contra DataForSEO producción** (costo medido: **$0.31**) | ✅ |
| **Dedupe canónico** (deja de pagar keywords duplicadas) | ✅ |
| **Métricas ausentes como `null`, no como `0`** (`kr.v0.4`) | ✅ |
| **Clustering calibrado con datos reales** (0.55 → 0.75) | ✅ |
| **Dataset crudo persistido** (`out/keywords.json` → tuning gratis) | ✅ |
| Señales de SERP para `is_local` | ⛔ Hoy se dispara de más (53/60) |
| Usar `score_confidence` para priorizar páginas | ⛔ Se calcula pero no se usa al ordenar |
| Calibrar las estimaciones del presupuesto | ⛔ Ya hay datos; falta aplicarlo |
| Persistencia, multi-tenancy, Inngest | ✅ **Hechos** — ver `db/` y `orchestrator/` |
