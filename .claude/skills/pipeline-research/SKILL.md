---
name: pipeline-research
description: Usar al tocar kr-service/ — el orden de las fases del research, expansión de keywords, clave canónica, clasificación de intención, scoring y su gate de relevancia, clustering híbrido, el mapeo cluster→página, el brief y el informe, y los endpoints de DataForSEO. Cubre por qué el pipeline degrada en vez de fallar, y dónde eso se vuelve peligroso.
---

# El research (M2) de AMG OS

`kr-service/` convierte **un prompt de negocio** en un **brief de páginas propuestas**. El brief es
la frontera M2→M1 y el entregable que un humano aprueba (ADR-06/07).

**`kr-service` es una librería pura: no sabe que existe una base de datos.** Conoce las interfaces
`ProviderTaskLog` y `KeywordCache`; las implementaciones las inyecta quien es composition root (el
orquestador, o `cli/spike.ts`). Si te encontrás importando `db` desde `src/pipeline/`, algo se torció.

Si el cambio puede costar dinero —y casi todo acá puede—, cargá también **`pipeline-gasto`**.

## El orden de las fases, y por qué es ese

[`pipeline/run.ts`](../../../kr-service/src/pipeline/run.ts) es la única pieza que conoce el orden.
Cada paso tiene su preflight de presupuesto antes.

```
2  seeds            LLM → keywords semilla        · dedupe canónico ACÁ
3  expansión        DataForSEO suggestions (Labs) · una llamada por seed, tope 10
4  enriquecimiento  search_volume + bulk KD       · en paralelo, escala con N
   ── gate de cobertura ── CHECKPOINT 1: el dataset pago se persiste ACÁ
4b intención        LLM en batch → intent + is_local (fallback heurístico)
4c relevancia       LLM → business_relevance (activa el gate del scoring)
8  scoring          opportunity_score + score_confidence · sin costo externo
6  clustering       embeddings + validación SERP de las 15 cabezas top
6b is_local         map pack del SERP → corrige la conjetura del LLM · sin costo externo
   ── CHECKPOINT 2: dataset + scoring + clusters
9  mapeo            clusters → páginas propuestas · sin costo externo
10 contenido        LLM: una llamada por página
11 brief            assembleBrief()
```

Tres cosas que la numeración esconde y conviene saber:

- **El dedupe va antes de pagar, no después.** El LLM devuelve seeds equivalentes con frecuencia
  ("Pasta fresca Madrid" / "pasta fresca madrid") y cada una disparaba **su propia llamada de
  expansión facturada**. Deduplicar después limpiaba el resultado con la llamada ya pagada.
- **El checkpoint del dataset se invoca apenas los datos pagos existen**, no al final. Si el
  presupuesto aborta o fallan los embeddings, los ~$0.25 ya gastados **no se pierden**. Es lo que
  hace que el tuning posterior sea gratis incluso cuando el run no termina.
- **`is_local` se conjetura en 4b, se corrige en 6b y se consume en el 9** (tipo de página →
  `schema_type`). El paso 6b existe porque el SERP del clustering —que ya se pagó— cae justo en esa
  ventana: la señal real llega después de la conjetura y antes de que decida algo.

## La clave canónica: si no la usás, perdés el dato

`canonicalKey()` ([`lib/text.ts`](../../../kr-service/src/lib/text.ts)) es la forma normalizada de
una keyword. **Todo lookup entre lo que enviamos y lo que devuelve un proveedor va por ella**, porque
el proveedor puede devolver otro casing, espaciado o forma Unicode. Sin eso, el lookup falla en
silencio y la métrica —ya pagada— se pierde.

Está usada en: el dedupe de seeds, `dedupeByCanonical` del universo, el índice de volumen y de KD, el
re-indexado de lo que devuelve el LLM en `applyIntents` y `applyBusinessRelevance`, y las claves de
cache. Si agregás un cruce nuevo entre dos listas de keywords, va por ahí.

## Degradar con elegancia, y dónde eso se vuelve peligroso

El pipeline atrapa los fallos de fase y sigue (`catch → null`). Está bien... salvo que **el fallo era
indistinguible del éxito**: si el endpoint de volumen se caía entero, el run seguía gastando en
intención, relevancia, clustering y contenido, y escupía un brief igual de confiado con páginas
basadas en **cero datos de mercado**.

Por eso existen tres cosas que **no se tocan sin entenderlas**:

1. **`DataQuality`** (`cobertura_volumen`, `cobertura_kd`, `endpoints_degradados`) viaja en el brief
   y se imprime **arriba** de las páginas en el informe: quien aprueba tiene que saber sobre qué base
   está aprobando **antes** de mirar la lista.
2. **Cobertura 0% aborta** — pero **solo si el dinero es real** (`mode === "live" && !isSandbox`). El
   mock y el sandbox no cobran y no devuelven volúmenes de verdad; abortar ahí rompería el loop de
   desarrollo gratis sin proteger nada.
3. **Una task fallida rompe la llamada entera.** Antes solo se avisaba y se omitía su resultado. Con
   la cache eso se volvió peligroso: el pipeline recibe un array más corto, no puede distinguir "el
   proveedor no tiene dato" de "la task que traía esa keyword se cayó", y **cachea la ausencia**. Un
   fallo transitorio quedaba fosilizado 7-30 días sirviendo `null` como hecho del mercado.

La regla, en una línea: **ausencia de datos y ausencia de respuesta no son lo mismo.** Un HTTP 200
sin `tasks`, con `tasks` vacío, con `tasks_count` que no cuadra, o una task OK sin `result`, **todos
lanzan** — ninguno se toma por "sin datos".

## `null` no es `0`, y no es un detalle de tipos

`volumen` y `dificultad` son `number | null` desde `kr.v0.4`. `null` significa **el proveedor no
devolvió el dato**; `0` significa **nadie busca eso**. Confundirlos le miente al cliente en el
entregable, y el informe escribe **`n/d`**, nunca `0`.

El mismo razonamiento, un nivel más arriba: `evidenceOf()` usa `volume != null && volume > 0`, no
`!= null`. Un cluster cuyo único dato era un `0` salía como `datos_mercado` y el informe declaraba
"hay demanda de búsqueda demostrable" — falso. **Un cero prueba que el dato existe, no que haya
demanda.**

## Scoring: el gate, la confianza y lo que sigue sin usarse

[`pipeline/scoring.ts`](../../../kr-service/src/pipeline/scoring.ts) — `opportunity_score` (0..100) y
`score_confidence` (0..1). Pesos por defecto: volumen 0.3, dificultad 0.3, intención 0.2, negocio 0.2.

- **`business_relevance` es un GATE, no solo un peso** (ADR-10). Debajo de `0.4` la keyword se
  **descarta**.
- **"Irrelevante" y "desconocido" no son lo mismo.** Si el LLM no la evaluó, **no se promueve**: el
  score se capea en `RELEVANCE_UNKNOWN_CAP = 35` y se anota el motivo. Queda visible para revisión,
  pero no llega a página.
- **`score_confidence` baja con cada dato que falta** (−0.4 volumen, −0.3 KD, −0.4 relevancia sin
  evaluar). La relevancia pesa fuerte a propósito: es la señal de negocio decisiva del gate.
- **El 40% del score (intención + relevancia) no depende de ningún dato de mercado.** Una keyword de
  la que no sabemos nada arranca en ~50 puntos. Eso es exactamente lo que `evidencia` compensa en el
  mapeo, y lo que hace que la normalización del volumen importe.

**La normalización del volumen es por percentil, winsorizada.** El tope es
`VOLUMEN_PERCENTIL_TOPE = 0.9` calculado con `percentilNearestRank()` sobre los volúmenes
**conocidos** (los ceros entran, los `null` no), y todo lo que lo supera **satura en 1.0**. Antes se
normalizaba contra el `volume_max`: con un solo pico (1300 en la corrida real) el resto se aplastaba,
y eso cambia qué páginas *parecen* valiosas. **Lo que sigue pendiente**, y está escrito como TODO en
el código: es el percentil **del run**, no el del mercado — los scores no son comparables entre
corridas. Una distribución cruzada necesita el dataset persistido (KR-1).

**`score_confidence` ordena** — ver la sección siguiente. Los dos parámetros (`0.9` y
`PESO_CONFIANZA_ORDEN = 0.5`) son **defensables por construcción pero no barridos contra el dataset
real**, a diferencia de `CLUSTER_SIM_THRESHOLD_DEFAULT`. Barrerlos es gratis **si el dataset existe**;
hoy no existe.

## Clustering: híbrido, y calibrado con datos reales

[`pipeline/cluster.ts`](../../../kr-service/src/pipeline/cluster.ts)

1. **Semántico**: greedy por coseno de embeddings, barato, cubre todo.
2. **Validación SERP**: solo las **15 cabezas top** (control de costo); si comparten ≥3 URLs, se
   fusionan.

`CLUSTER_SIM_THRESHOLD_DEFAULT = 0.75`, **calibrado barriendo 0.55…0.85 sobre el dataset real**. El
0.55 original colapsaba 41 de 45 keywords vivas en **un** cluster (todas comparten "madrid" +
"italiano"), fusionando tres páginas comercialmente distintas: 3 páginas en vez de 8. Por encima de
0.85 se fragmenta. Es configurable por run (`options.sim_threshold`) y **queda registrado en el
dataset** — sin eso, el dataset no es comparable entre corridas.

Si un SERP falla, esa cabeza **no se valida** y queda sin fusionar: el comportamiento conservador es
no agrupar lo que no se pudo confirmar. Antes, un solo fallo abortaba la corrida entera.

## Del cluster a la página: la evidencia manda sobre el score

[`pipeline/cluster-map.ts`](../../../kr-service/src/pipeline/cluster-map.ts)

El orden tiene **dos niveles**:

- **Nivel 1: la evidencia manda, siempre.** Una página `sin_validar` NUNCA se ordena por encima de una
  `datos_mercado`, aunque tenga score 100 y confianza 1.0.
- **Nivel 2, dentro de cada grupo: `scoreEfectivo`**, que pondera la confianza —
  `score * (1 - P + P * score_confidence)` con `PESO_CONFIANZA_ORDEN = 0.5` (confianza 0.3 deja el
  score en el 65%: penalización moderada, no descalificación). **El corte al backlog usa este orden**,
  y esa es la mitad irreversible del cambio: una página de baja confianza cae al backlog y nunca se
  persiste. La entrada del backlog, en cambio, lleva el `opportunity_score` **crudo**, que es el campo
  declarado del contrato.

Y el resto de las reglas del mapeo:

- Las `sin_validar` **no se descartan**: suelen ser servicios que el propio negocio declaró (un
  restaurante quiere su "menú del día" tenga o no volumen medible). Se conservan **etiquetadas**, y
  el informe las separa en su propia tabla. Presentarlas mezcladas era el problema.
- **La intención informativa gana sobre `is_local`.** Antes `is_local` cortocircuitaba todo y una
  guía ("cómo se hace la pasta fresca") salía `landing_local`.
- **`schema_type` es una decisión SEPARADA del tipo de página.** Declarar `LocalBusiness` es afirmarle
  a Google "esta página ES la ficha de un negocio físico". Colgaba del `page_type`, así que la
  sobre-detección de `is_local` se propagaba hasta el marcado y **publicábamos afirmaciones falsas**.
  Regla: `LocalBusiness` solo en una landing local con intención de negocio; una guía es `Article`,
  siempre.

**`is_local` se corrige con el SERP, y solo para las cabezas.** La heurística
(`intent.ts:detectLocal`) marca local con mencionar "madrid" o "centro" y el LLM tampoco tiene señal
de mercado: **53 de 60** keywords y 7 de 8 páginas como `LocalBusiness` en la corrida real.
[`pipeline/local-signal.ts`](../../../kr-service/src/pipeline/local-signal.ts) lo refina con la
presencia de **map pack**, que es Google diciendo que considera local esa búsqueda. Tres reglas, y la
primera es la que importa:

1. **Solo se pisa `is_local` cuando `mapPack !== null`.** Sin observación se respeta el LLM. Tratar
   "no observado" como "no es local" es el mismo error que `volumen ?? 0` — y acá además caro en la
   dirección equivocada: un timeout desmarcaría una landing local legítima.
2. Con observación, **el SERP manda** sobre la conjetura del LLM.
3. **Solo se observan las ~15 cabezas** (`serpValidateTop`). Es lo esperado y es lo que importa: la
   cabeza decide el tipo de página. El resto del dataset queda **intacto**, no "no local".

Va en el paso 6b: después del clustering (donde se pagan los SERP), antes de `mapClustersToPages`
(donde `is_local` decide el tipo) **y antes del CHECKPOINT 2**, para que el dataset persistido lleve
el `is_local` que de verdad gobernó las páginas.

Lo que **no** hace: tocar `intent`. Una keyword que pasa a `is_local: false` conserva el
`intent: "local"` que le puso la heurística. Hoy no rompe nada, pero es una incoherencia interna del
dataset que puede morder al tocar el mapeo.

## DataForSEO: los cuatro endpoints y su camino

[`dataforseo/endpoints.ts`](../../../kr-service/src/dataforseo/endpoints.ts)

| Endpoint | Camino | Detalle |
|---|---|---|
| `keywords_data/google_ads/search_volume` | **Standard** | `modoGet: "regular"` |
| `serp/google/organic` | **Standard** | `modoGet: "advanced"` · se extraen los `item.type === "organic"` **y** la señal de map pack (`TIPOS_MAP_PACK`) |
| `dataforseo_labs/…/keyword_suggestions/live` | **live** | Labs no tiene `task_post` |
| `dataforseo_labs/…/bulk_keyword_difficulty/live` | **live** | Labs no tiene `task_post` |

El detalle de por qué esa división existe, y qué se rompe si se cruza, está en **`pipeline-gasto`**.
Dos cosas que importan acá:

- **Si cambia la FORMA del valor cacheado, tiene que cambiar la clave.** Es lo que pasó al agregarle
  el map pack al SERP: el valor era `string[]` y pasó a ser `SerpResultado`. Sin tocar la clave, las
  entradas viejas (7 días de TTL) se leen como si tuvieran el campo nuevo, `urls` sale `undefined` y
  revienta el overlap. El literal `organic+mappack` **es** esa versión.
- ⚠️ **La clave del SERP se parsea POR POSICIÓN fuera de `kr-service`.** `metaDeClave()` en
  [`orchestrator/src/deps.ts`](../../../orchestrator/src/deps.ts) la corta por `|` para poblar las
  columnas de `kr_serp_cache`. **Se puede cambiar un literal; no se puede cambiar la cantidad de
  segmentos** sin desplazarle `depth`, `location_code` y `language_code` en silencio.

## El brief y el informe

[`pipeline/brief.ts`](../../../kr-service/src/pipeline/brief.ts) — `assembleBrief()` arma la
estructura y `renderReport()` produce el Markdown, que **es el entregable humano de la compuerta**.

`SCHEMA_VERSION` está en [`types.ts`](../../../kr-service/src/types.ts) y hoy es `kr.v0.5`. **Un
cambio semántico sube la versión** y hay que reflejarlo en `SUPPORTED_SCHEMA_VERSIONS` de
`web-builder/src/contract.ts` — que es la deuda del **esquema Zod duplicado** entre M2 y M1: dos
fuentes de verdad del mismo contrato.

El informe hoy **solo existe como archivo local** tras correr el CLI (`out/informe.md`). Llevarlo al
portal es KR-2, y tiene una decisión de diseño abierta anotada en el `09`.

El **dataset crudo** va a `datasets/keywords.json` (versionado; `KR_DATASET_PATH` lo cambia). Estuvo
en `out/`, que git ignora, y por eso el dataset de la corrida real **se perdió** con el clon — junto
con la promesa de que retocar scoring o clustering fuera gratis. Que el destino no vuelva a un
directorio ignorado lo impone un test que le pregunta a `git check-ignore`, no un comentario.

## ⚠️ Qué de lo que produce `kr-service` sobrevive a la persistencia

La frontera declarada es M2→M1 (el brief JSON validado con Zod), pero hay una **segunda** frontera
que atraviesa el mismo dato: `kr-service` → `db` → `api` → `portal`. Y puede **deshacer** una decisión
tomada acá. Antes de dar por cerrado un cambio, preguntate qué le pasa del otro lado:

| Lo que produce el pipeline | ¿Sobrevive? |
|---|---|
| El **corte al backlog** | ✅ Sí, es irreversible: lo que queda fuera nunca se persiste como página |
| Los **campos** de cada página (score, confianza, evidencia, tipo, schema) | ✅ Sí, son columnas de `kr_pages` |
| El **orden** de `paginas_propuestas` | ❌ **No.** `db/src/store.ts` (`getRunPages`, `getPublishablePages`) reordena por `opportunity_score desc`, y `portal/src/app/core/cartera.ts` vuelve a ordenar por el score crudo |
| El **informe Markdown** (`renderReport`) | ✅ Sí — se genera dentro de `kr-service`, sin pasar por la base |

O sea: hoy el orden en dos niveles gobierna **qué páginas existen**, pero no **en qué orden las ve el
cliente en el portal**. Cerrarlo necesita a `datos` y a `front`, y la opción recomendada es
**persistir el orden** (una columna en `kr_pages`), no duplicar la fórmula en SQL y en TypeScript —
eso serían tres fuentes de verdad del mismo criterio, desincronizándose sin que ningún test lo vea.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Cruzar dos listas de keywords sin `canonicalKey` | El lookup falla en silencio y la métrica pagada se pierde |
| Escribir `volumen ?? 0` | Afirma "0 búsquedas/mes" donde no hay dato. Es el bug que costó el bump a v0.4 |
| Tomar un 200 raro por "sin datos" | Se cachea la ausencia y un fallo transitorio queda fosilizado 7-30 días |
| Deduplicar después de expandir | La llamada duplicada ya se pagó |
| Colgar `schema_type` del tipo de página | Se publican afirmaciones falsas a Google |
| Mover el checkpoint del dataset al final | Un aborto tira a la basura lo ya pagado |
| Cambiar la forma del valor cacheado sin cambiar la clave | Las entradas viejas se leen como si tuvieran el campo nuevo |
| Calibrar un umbral contra el sandbox | Devuelve ficción. La calibración necesita datos reales |

## Verificación

```bash
npm test -w kr-service     # providers mock, deterministas, sin red ni credenciales
npm run typecheck
```

El inventario de qué archivo prueba qué **no vive acá a propósito**: se desincroniza cada vez que
alguien agrega un test. Está en
[`docs/proyecto/08-testing-calidad.md`](../../../docs/proyecto/08-testing-calidad.md), y `ls
kr-service/src/**/*.test.ts` es la fuente que no miente.

**Rojo primero y verificación por mutación.** Y ojo con lo que un test verde acá *no* prueba: los
providers mock son deterministas, así que ningún test ve la forma real de una respuesta de
DataForSEO. Todo lo que dependa de esa forma —un campo nuevo del SERP, un `modoGet`— se valida
leyendo la documentación del proveedor y **en una corrida real que decide un humano**.
