# 8. Testing y calidad

## Herramientas

| Qué | Cómo |
|---|---|
| **Tipos** | `npm run typecheck` (`tsc --noEmit`), con `strict` y `noUncheckedIndexedAccess`. |
| **Tests** | `npm test` → `node --import tsx --test "src/**/*.test.ts"` |
| **Runner** | `node:test` + `node:assert/strict` — **nativo de Node, cero dependencias nuevas**. |

Los tests son **deterministas**: no tocan la red, no usan API keys, no dependen del reloj.

**Los de seguridad corren contra Postgres REAL** (PGlite: Postgres 18 compilado a WASM, en proceso),
no contra un mock. No es un capricho: el aislamiento entre tenants depende de la semántica exacta de
Postgres (`FORCE` vs `ENABLE`, `USING` vs `WITH CHECK`, el cast de un GUC vacío, `SET ROLE`), y un
mock reproduciría mis suposiciones en vez de la realidad. Ya pasó: **tres de las cuatro brechas
críticas que encontraron las reviews eran suposiciones mías que Postgres no cumplía.** Sin Docker y
sin cuenta.

## Cobertura actual: 223 tests

| Paquete | Tests | Qué cubre |
|---|---|---|
| `db` | **80** | RLS, aislamiento multi-tenant, compuerta de aprobación (aprobar **y editar**), credenciales (`pg_has_role`, con caminos transitivos), idempotencia del gasto. |
| `kr-service` | **84** | Pipeline, costos, presupuesto, HTTP, cache, registro de tareas, **y la costura: que el POST facturable pase por el registro** (`client.test.ts`). |
| `web-builder` | **41** | Contrato, handoff, render, XSS, idempotencia de publicación. |
| `orchestrator` | **18** | Workflow durable, compuerta humana, autorización del evento, **cada cliente publica en SU space**, drafts no se marcan publicados. |

### La disciplina que más ha valido: **mutation testing**

Cada fix de seguridad se verifica **reintroduciendo el bug** y comprobando que el test cae. Sin eso,
un test de seguridad que siempre pasa es peor que no tenerlo — y me pasó: el test del doble cobro
comprobaba *"solo una reserva es `nueva`"*, que era cierto **e irrelevante** (la otra salía
`huerfana`, que también autoriza gastar). Pasaba con el bug dentro.

### `kr-service` (84 tests)

| Archivo | Qué fija |
|---|---|
| `lib/text.test.ts` | `canonicalKey`: casing, espacios múltiples, **normalización Unicode NFD→NFC**. |
| `pipeline/scoring.test.ts` | El gate de `business_relevance`: evaluada-alta (score alto, confianza plena), evaluada-bajo-gate (**descartada**), **no evaluada (score capeado a 35 + confianza baja)**, y que una no-evaluada **nunca supere** a una evaluada equivalente. |
| `pipeline/intent.test.ts` | El clasificador heurístico de fallback (transactional / commercial / informational / señal local). |
| `lib/cost.test.ts` | El total suma **todos los proveedores**; costo del LLM calculado desde tokens; embeddings solo pagan entrada; un **modelo sin tarifa no inventa costo** (queda en `unpricedModels`); `reset()`. |
| `lib/budget.test.ts` | El **preflight bloquea ANTES de gastar** si la estimación no entra; tiene en cuenta lo ya gastado; sin tope nunca bloquea; corte post-fase si la estimación se quedó corta. |
| `lib/http.test.ts` | Clasificación de errores (429/5xx reintentables, 4xx no); backoff dentro del tope; `Retry-After` en segundos y fecha HTTP; **un 500 se reintenta y termina bien**; **un 400 NO se reintenta**; se propaga `HttpError` con el status al agotar reintentos; fallos de red. *(Con `fetch` stubeado: sin red.)* |

### `web-builder` (41 tests)

| Archivo | Qué fija |
|---|---|
| `contract.test.ts` | Brief válido; **rechazo** de `schema_version` no soportada, de página malformada (`content_brief: null`) y de enum inválido. Perfil válido; rechazo de URL inválida y de `name` faltante. |
| `handoff/adapter.test.ts` | Mapeo `hero + section* + faq`, slugs, preservación de SEO / intención / contrato editorial. |
| `storyblok/content.test.ts` | `_uid` en el page raíz y en **todos** los bloks; FAQs como bloks **`faq_item`**; preservación de canonical / OG / claims / `source_keyword`; SEO aplanado. |
| `render/html.test.ts` | **XSS neutralizado** (un título con `</script><script>` no puede cerrar la etiqueta); `<html lang>` desde el brief; ids `contacto`/`faq` **sin duplicar**; canonical resuelto (absoluto con perfil, relativo sin él); JSON-LD `@graph` con `LocalBusiness` + `FAQPage`; `telephone` y `address` en el `LocalBusiness`. |
| `llm/content.test.ts` | `reconcile` ante respuestas LLM parciales: respuesta completa, **`sections` como string (no-array)**, **elemento sin `heading`**, y que siempre devuelva una entrada por cada sección/pregunta de entrada. |
| `lib/uid.test.ts` | `stableUid`: determinista, claves distintas dan uids distintos, forma de UUID v5 válida. |
| (en `storyblok/content.test.ts`) | **Republicar el mismo contenido produce los MISMOS `_uid`**; los `_uid` dependen de la identidad del blok, **no del orden** (agregar una sección no cambia los uids de las existentes). |

`src/fixtures.ts` centraliza los datos de prueba (brief, página y perfil válidos).

## Revisión externa (Codex) — qué encontró y qué se corrigió

Se sometió el código a una revisión adversarial externa. Encontró **18 hallazgos**; la mayoría eran
bugs reales. Se corrigieron en dos tandas y **los tests de arriba los fijan como contrato** para
que no reaparezcan.

### Tanda 1 — Seguridad, validación y compuerta ✅

| # | Hallazgo | Corrección |
|---|---|---|
| **#9** | **XSS** vía JSON-LD y comentario de traza: `JSON.stringify` no escapa `</script>`. | `safeJson()` escapa `<`, `>`, `&`. La traza pasó de comentario HTML a `<script type="application/json">`. |
| **#1** | La compuerta solo miraba el `status` global → cambiarlo publicaba páginas nunca aprobadas. | Se exige `status === "approved"` **y** `page.approved === true`; las no aprobadas se omiten. |
| **#3** | El M1 no validaba el brief en runtime → crash tardío o stories incorrectas. | `parseBrief()` con Zod + rechazo de `schema_version` no soportada. |
| **#14** | `loadProfile()` ocultaba corrupción como "sin perfil". | Solo `ENOENT` = ausencia; JSON inválido o tipos malos **lanzan**. |
| **#8** | Respuestas LLM parciales rompían el `reconcile` que debía protegerlas. | `asArray()` + guardas de tipo; se descartan elementos inválidos uno a uno. |
| **#6** | `LLM_PROVIDER=anthropic` degradaba a mock **en silencio**. | Warning explícito. *(La implementación completa llegó en la Tanda 3.)* |
| **#17** | `id="contacto"` duplicado → el CTA aterrizaba en las FAQs. | FAQ pasó a `id="faq"`; ancla del CTA condicional. |
| **#15** | `<html lang>` hardcodeado a `es`. | Sale de `brief.market.language_code`. |
| **#18** | Comentario engañoso en el mock publisher. | Aclarado (modelo canónico ≠ payload Storyblok). |

### Tanda 2 — Correctitud y datos ✅

| # | Hallazgo | Corrección |
|---|---|---|
| **#4** | **`business_relevance` fallaba abierto**: si el LLM se caía, las keywords sin evaluar tomaban el default neutral (0.6) y **superaban el gate (0.4)** sin haberse evaluado nunca. | Se distingue "irrelevante" (evaluado bajo → descartado) de "desconocido" (sin evaluar → **score capeado a 35**, confianza −0.4, marcado para revisión). |
| **#7** | Matching **exacto** de keywords: `"Pizza Napolitana"` no casaba con `"pizza napolitana"` → **volumen, KD e intención se perdían en silencio**. | `canonicalKey()` (NFC + trim + colapso de espacios + minúsculas) en todos los lookups. |
| **#10** | El cliente DataForSEO trataba tasks fallidas como exitosas (respuesta global 20000 con tasks en error). | Valida `status_code` **por task**, avisa y omite sus resultados. |
| **#16** | Canonical con **dos fuentes de verdad**: el brief decía una cosa, el render re-derivaba otra del slug. | El canonical del brief manda, resuelto contra la base. |
| **#13** | El payload de Storyblok **perdía** canonical, OG, claims y traza → el frontend no podía reconstruir la página. | Se añadieron al componente `page` y al shaping. |

### Tanda 3 — PROD-readiness ✅

| # | Hallazgo | Corrección |
|---|---|---|
| **#5** | **El presupuesto preflight declarado no estaba implementado**, y el costo reportado **solo contaba DataForSEO** (no el LLM). | `CostMeter` mide todos los proveedores con desglose; `Budget` estima cada fase y **aborta antes de gastar**. Contrato bumpeado a `kr.v0.3`. |
| **#11** | **Sin timeouts ni retries**: un `fetch` colgado colgaba el run; un 429 fallaba de inmediato. Además, **un solo fallo de SERP abortaba toda la corrida** de clustering. | `lib/http.ts`: timeout por intento (`AbortSignal`), reintentos con **backoff exponencial + jitter**, respeto de `Retry-After`, y clasificación (429/5xx se reintentan; el resto de 4xx **no**). Aplicado a DataForSEO y Storyblok. El clustering ahora **degrada parcialmente** ante fallos de SERP. |
| **#12** | **Idempotencia**: los `_uid` se regeneraban en cada publicación (destruyendo la identidad de los bloks), y dos corridas concurrentes podían **duplicar stories**. | `lib/uid.ts`: `_uid` **deterministas** derivados de la identidad natural del blok (slug + tipo + heading/pregunta). Publicación con **upsert idempotente**: si la creación choca con un slug ya tomado (carrera), re-resuelve y actualiza en vez de duplicar. |
| **#6** | `LLM_PROVIDER=anthropic` **degradaba a mock** en intención, relevancia y contenido (solo los seeds usaban Claude). | **`AnthropicContentGen`** implementado (tool use para JSON estructurado; Haiku para clasificar, modelo de gama alta para redactar, según ADR-09). Los tres proveedores implementan ahora **la misma interfaz**. |

**Los 18 hallazgos de la review están corregidos**, salvo **#2 (secretos)**, que requiere acción
humana → ver [Acciones pendientes](10-acciones-pendientes.md).

### Tanda 10 — 5ª review: el aislamiento se perdía AL SALIR, y los tests probaban lo fácil ✅

La quinta review no encontró CRITICAL ni una fuga de RLS. Encontró que **el aislamiento multi-tenant
—impecable dentro de Postgres— se evaporaba en los pasos que escriben hacia afuera**, y que los
tests estaban mirando para otro lado.

| # | Hallazgo | Corrección |
|---|---|---|
| **#1** HIGH | **La publicación cruzaba clientes.** `clients.storyblok_space_id` existía y **no lo leía nadie**: se publicaba todo en el space global, así que la `/menu` de un cliente **pisaba** la del otro. | El destino (space + perfil) sale de la fila del cliente **bajo RLS**; el publisher se construye **por publicación**. Sin space, no se publica. |
| **#2** HIGH | **El publisher guardaba drafts** (faltaba `publish: 1`) y la base escribía `published_at` igual: el run decía `publicado` con **nada publicado**. | Se manda `publish: 1` y **solo se marca lo que el proveedor confirma**. |
| **#3/#4** HIGH | **Doble cobro a DataForSEO**: el hash no ordenaba arrays (mismo lote, distinto orden → dos cobros), y una petición ambigua **se reenviaba** sabiendo que podía repagar. | Lote canónico (dedupe + orden) antes de hash; la petición ambigua **detiene el run** salvo `DFS_PERMITIR_REPAGO=1`. |
| **#5** MEDIUM | **Ningún test instanciaba `DataForSeoClient`**: la mutación "saltarse el registro" sobrevivía a los 199 tests → todos los POST de prod sin idempotencia. | `client.test.ts` con `fetch` stubeado: cuenta **POST facturables a la red**. Esa mutación ahora tumba 4 tests. |
| **#6** MEDIUM | El test de roles leía membresías **directas**: un `grant` transitivo pasaba. | `pg_has_role(...,'SET')`, que incluye caminos transitivos. |
| **#7** MEDIUM | El test de concurrencia **no probaba concurrencia** (PGlite serializa) y yo lo presentaba como si sí. | Renombrado a lo que prueba; el hueco (carrera real entre 2 conexiones) queda **anotado en ADR-14**, no disfrazado. |
| **#9/#11** | `DATABASE_URL_CACHE` heredaba una credencial imposible; la clave de concurrencia apuntaba a un campo inexistente. | Aborta al arrancar si falta; clave corregida a `event.data.tenantId`. |
| **#3b** | El 46% del gasto (SERP + Search Volume) seguía en modo live: una respuesta perdida era **dinero perdido**. | **Método Standard** (`postStandard`): `task_post` cobra + guarda el `task_id`; `task_get` recupera **gratis**. Dos capas (id persistido + `tasks_ready` por tag). Mutar la recuperación tumba `client.test.ts`. |

**Cada fix, mutado uno por uno** (space global, marcar sin confirmar, editar sin revocar, saltarse
el registro, no ordenar el hash, grant transitivo): cada mutación hace caer **exactamente** el test
que le corresponde.

> Tres afirmaciones **mías** que la review encontró falsas —y que dejo registradas en sus ADR en vez
> de borrar—: ADR-14 proclamaba una idempotencia estricta que el propio código desmentía imprimiendo
> `REPAGO`; ADR-21 justificaba "portal → API" con un argumento sobre PostgREST **incorrecto** (el
> claim del JWT va firmado); y la "equidad entre tenants" de Inngest no existía porque la clave
> apuntaba a un campo inexistente. El patrón, dicho sin adornos: **cuando un argumento me conviene,
> lo escribo y no lo verifico.** Por eso las reviews externas están en el proceso.

### Tanda 12 — 6ª review: "verificá el arreglo, no la re-explicación" ✅

Se le pidió a Codex que **verificara** las tandas 10-11 (no que buscara de cero). No dio OK: encontró
que el cruce de Storyblok **no** estaba cerrado y que el método Standard —escrito rápido en la tanda
11— tenía **cuatro bugs**. Y, de nuevo, varios tests pasaban por **reproducir la implementación** en
vez del contrato.

| # | Hallazgo | Corrección |
|---|---|---|
| **#1** HIGH | El cruce de Storyblok seguía vivo: `getPublisher` hacía `spaceId ?? global`, y el workflow pasa `null` cuando el cliente no tiene space → caía al space de otro. | `null` (cliente sin destino) va a dry-run; solo `undefined` (CLI) usa el global. **Ahora hay test del publisher real.** |
| **#2** HIGH | **Search Volume roto en producción:** `task_get` iba siempre a `/advanced`, pero SV usa la variante regular. | Modo por endpoint. Test de **URL exacta**. |
| **#3** HIGH | El coste pagado desaparecía del ledger tras una recuperación. | `anotarTareaRemota` persiste id **y coste**; la recuperación lo contabiliza. |
| **#4** HIGH | El id de `tasks_ready` no se persistía antes del `task_get` → una 2ª caída lo perdía. | Se persiste apenas se halla. Test de doble caída. |
| **#5** HIGH | Consultar una huérfana consumía intentos sin enviar nada. | El tope cuenta **envíos** (`contarEnvio`), no reservas. |

**Todo mutation-tested**, y los tests que Codex marcó como "verdes por reproducir la implementación"
ahora verifican el contrato: el publisher real (`publish:1` + space exacto), la URL de `task_get`, el
ledger de coste, el lote canónico **inspeccionado** (no solo contado), la clave de Inngest y el guard
de `DATABASE_URL_CACHE`.

> La lección de esta ronda: la tanda 11 (el método Standard) la escribí **rápido y con tests que
> reproducían mis propias suposiciones** — el mismo error que vengo señalando. Que una review externa
> lo cazara **después** de que yo declarara "hecho" es exactamente para lo que está.

### 🔑 Pendiente de acción humana

**#2 — Secretos:** la misma API key de OpenAI está duplicada en los dos `.env` (gitignoreados,
nunca commiteados). **Requiere rotar la key** y separar por servicio. Ver [Configuración](07-configuracion.md).

## Qué NO está cubierto por tests

Honestidad sobre los límites de la suite actual:

- **No hay tests de integración**: nada ejercita las llamadas reales a DataForSEO, OpenAI o Storyblok.
  *(El helper HTTP sí está testeado con `fetch` stubeado, pero no contra los servicios reales.)*
- **No hay tests del orquestador** (`run.ts` / `build.ts` end-to-end); se verifican corriendo los CLIs a mano.
- **El camino live de Storyblok nunca se probó** contra un space real (solo dry-run) → [acción C](10-acciones-pendientes.md).
- **No hay tests de concurrencia real**: la idempotencia está implementada y el determinismo de los
  `_uid` sí está testeado, pero la carrera de creación (dos publicaciones simultáneas) solo se
  puede ejercitar contra un Storyblok real.
