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

## Cobertura actual: 377 tests (monorepo) + 29 (portal)

| Paquete | Tests | Qué cubre |
|---|---|---|
| `db` | **100** | RLS, aislamiento multi-tenant, compuerta de aprobación (aprobar **y editar**), credenciales (`pg_has_role`, con caminos transitivos), idempotencia del gasto. |
| `kr-service` | **88** | Pipeline, costos, presupuesto, HTTP, cache, registro de tareas, **la costura: que el POST facturable pase por el registro** (`client.test.ts`), **y que producción falle cerrado sin registro durable** (`getprovider-guard.test.ts`). |
| `web-builder` | **60** | Contrato, handoff, render, XSS, idempotencia de publicación. |
| `orchestrator` | **18** | Workflow durable, compuerta humana, autorización del evento, **cada cliente publica en SU space**, drafts no se marcan publicados. |
| `api` | **33** | Auth (**JWT firmados de verdad**: exige `exp`/`sub`, verifica `aud`/`iss`, rechaza otro secreto), **comando compuesto: RLS rechaza → NO se emite el evento**, las dos audiencias (equipo escribe, cliente solo lee), aislamiento entre tenants, la compuerta doble (ADR-06), CORS. Contra PGlite, sin red ni Supabase. |
| `renderer` | **78** | Resolución de dominio (**el `Host` como dato hostil**: inyección, IPs, puerto, `X-Forwarded-Host`), cache (colisión de slug entre spaces, TTL, LRU, invalidación por space), **webhook firmado** (sin firma / con otro secreto / sin secreto = cerrado), **preview firmado** (otro dominio, vencido, sin secreto, y que **no se cachee**), CDA (`../` e inyección de query, 404 vs 503, timeout), `perfilValido` (un NAP mal cargado degrada, no tira la web), y **los límites del camino anónimo** (10ª review): plazo de la respuesta COMPLETA, topes de bytes, cache negativa, coalescing, semáforo→503, cuerpo del webhook y replay. |
| `portal` | **29** | *(fuera del monorepo)* El núcleo puro: cliente HTTP (headers, errores tipados, **refresh del token + retry en 401**), login de Supabase, **validación de la sesión guardada**, y **la separación por evidencia** (✅/⚠️). Con `node:test` y `fetch` de mentira — sin navegador. |

### La disciplina que más ha valido: **mutation testing**

Cada fix de seguridad se verifica **reintroduciendo el bug** y comprobando que el test cae. Sin eso,
un test de seguridad que siempre pasa es peor que no tenerlo — y me pasó: el test del doble cobro
comprobaba *"solo una reserva es `nueva`"*, que era cierto **e irrelevante** (la otra salía
`huerfana`, que también autoriza gastar). Pasaba con el bug dentro.

### `kr-service` (88 tests)

| Archivo | Qué fija |
|---|---|
| `lib/text.test.ts` | `canonicalKey`: casing, espacios múltiples, **normalización Unicode NFD→NFC**. |
| `pipeline/scoring.test.ts` | El gate de `business_relevance`: evaluada-alta (score alto, confianza plena), evaluada-bajo-gate (**descartada**), **no evaluada (score capeado a 35 + confianza baja)**, y que una no-evaluada **nunca supere** a una evaluada equivalente. |
| `pipeline/intent.test.ts` | El clasificador heurístico de fallback (transactional / commercial / informational / señal local). |
| `lib/cost.test.ts` | El total suma **todos los proveedores**; costo del LLM calculado desde tokens; embeddings solo pagan entrada; un **modelo sin tarifa no inventa costo** (queda en `unpricedModels`); `reset()`. |
| `lib/budget.test.ts` | El **preflight bloquea ANTES de gastar** si la estimación no entra; tiene en cuenta lo ya gastado; sin tope nunca bloquea; corte post-fase si la estimación se quedó corta. |
| `lib/http.test.ts` | Clasificación de errores (429/5xx reintentables, 4xx no); backoff dentro del tope; `Retry-After` en segundos y fecha HTTP; **un 500 se reintenta y termina bien**; **un 400 NO se reintenta**; se propaga `HttpError` con el status al agotar reintentos; fallos de red. *(Con `fetch` stubeado: sin red.)* |

### `web-builder` (60 tests)

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

## Revisiones externas (Codex) — qué encontraron y qué se corrigió

**Diez rondas de revisión adversarial**, en 17 tandas de correcciones. Todos los hallazgos están
corregidos y **los tests los fijan como contrato** para que no reaparezcan.

El patrón que se repite —y por eso las reviews están en el proceso— es que **casi siempre encuentran
algo que yo ya había declarado hecho**. Las cuatro últimas: el aislamiento multi-tenant se perdía al
salir por la puerta (Storyblok), el CLI de producción corría **sin registro de idempotencia**, el
verificador de JWT **no lo tocaba ningún test**, y el portal tenía **carreras asincrónicas**. En
varios casos la documentación afirmaba una garantía que el código desmentía.

> **Las lecciones, en una línea cada una:** probar el contrato y no la implementación · el
> *mutation testing* es lo que distingue un test de un adorno · leer el código y manejar la app
> encuentran cosas **distintas** · y cuando un argumento me conviene, tiendo a escribirlo sin
> verificarlo · y **un default sin test es una decisión sin dueño** (si el test elige el parámetro,
> no está fijando el que corre en producción).

### Tanda 1 — Seguridad, validación y compuerta ✅ *(1ª review, 18 hallazgos)*

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

### Tanda 13 — 7ª review: el agujero de raíz que las 5 correcciones dejaban intacto ✅

Codex verificó las 5 correcciones de la tanda 12: **cerradas, todas caen por mutación, ninguna es
falso-verde.** Pero encontró lo que ninguna tanda anterior había tocado: **el CLI de producción no
registraba nada.** `npm run spike` (acción 03) llama `runResearch()` sin `deps.taskLog` → el cliente
usa `NoopTaskLog` → **toda petición es nueva**. Toda la idempotencia de ADR-14 estaba puesta y el
camino de producción documentado la salteaba entera. Reproducido: dos `postStandard` idénticos, dos
cobros; y el caso caro de verdad, un **crash + re-run**, repaga los ~$0.25.

| Corrección | Cómo |
|---|---|
| `durable` pasa a ser **contrato** de `ProviderTaskLog` | `false` en `Noop`/`Mem`, `true` solo en `PgTaskLog`. |
| `getProvider` **falla cerrado** en live+prod sin registro durable | Lanza **antes de tocar la red** — para cualquier llamador, no solo el CLI. |
| El CLI **cablea `PgTaskLog`** | Vía `DATABASE_URL_CACHE`, mismo namespace que el orquestador (comparten ledger). Sin esa var, la corrida de producción aborta. |

`getprovider-guard.test.ts` (4 tests): sin registro / con `Noop` / con `Mem` en live+prod → lanza sin
tocar la red; con un registro durable → no lanza. **Mutación:** neutralizar el guard hace caer
exactamente los tres tests del rechazo.

> La lección, otra vez la misma y por eso la anoto: las piezas estaban todas probadas, pero **el
> composition root real (el CLI) no lo probaba nadie**. El test de la tanda 12 instanciaba
> `MemTaskLog` a mano — nunca pasaba por `getProvider()`/`runResearch()` como lo hace producción.

### Tanda 14 — la API (etapa 5.1), y esta vez la revisión la hice yo ✅

Se construyó la API REST (`api/`, Hono, ADR-22). El foco de los 20 tests es el **contrato de
seguridad**, no la mecánica de Hono:

- **El comando compuesto**: un `POST /runs` que RLS rechaza (un intruso, o el rol `cliente`) devuelve
  403 **y NO emite ningún evento**. Mutación: invertir el orden (emitir antes de crear) tumba
  exactamente esos tests.
- **Las dos audiencias (ADR-20)**, impuestas por la base, no por la UI: el equipo escribe; el
  `cliente` lee su brief pero no lanza research ni aprueba.
- **El lector-no-escritor que se colaba por el 200**: autorevisión encontró que `approveRun` no
  miraba las filas afectadas, así que un `cliente` (que RLS deja VER el run) recibía 200 y
  **despertaba al workflow** con un update de 0 filas. Ahora devuelve un booleano y la API solo emite
  si de verdad aprobó. Mutación: forzar `return true` tumba el test del cliente.
- **Aislamiento**: el equipo de un tenant no ve —ni por id ni en la lista— los runs de otro.

Todo contra **PGlite** (Postgres real) con un emisor y un verificador de mentira: la API entera se
ejercita sin red y sin Supabase, igual que RLS se prueba sin Docker.

> Esta ronda **no fue a review externa** (decisión de Juan: "basta de reviews, revisalo vos"). La
> autorevisión encontró dos cosas reales antes del commit —el 500 tosco por uuid malformado y el
> `approveRun` sin booleano— y las dos quedaron con test + mutación. El registro queda acá para que
> la próxima review (externa o no) tenga dónde empezar a dudar.

### Tanda 14 — 8ª review: la etapa 5 (API + portal) ✅

Codex revisó la etapa 5 completa. Confirmó cerrado lo que más importaba —ningún camino toca tablas de
tenant fuera de `PgStore.withTenant`; el comando compuesto emite el evento **solo** después del
`createRun`; `evidence.ts` usa la MISMA etiqueta (`datos_mercado`) que el pipeline; el refresh no
entra en bucle— pero encontró cuatro cosas, dos serias:

| # | Hallazgo | Corrección |
|---|---|---|
| **#1** HIGH | **`verificadorSupabase` no exigía `exp`, `aud` ni `iss`.** Un token firmado con el secreto correcto y **sin `exp` no caducaba nunca** y era aceptado. Peor: **ningún test lo tocaba** — mutarlo para aceptar cualquier token dejaba los 21 tests en verde. | `requiredClaims: ["exp","sub"]`, `aud` verificado (`authenticated`) e `iss` configurable. **9 tests nuevos con JWT firmados de verdad**; la mutación tumba 3. |
| **#2** HIGH | El brief leía el `runId` del **snapshot** en `ngOnInit`. Angular **reutiliza el componente** al ir de `/runs/A` a `/runs/B`: la pantalla decía B y **aprobar iba contra A**. | Se **suscribe** a `paramMap`; al cambiar, corta el polling, limpia el estado y recarga. |
| **#3** MEDIUM | Todo `42501` se mapeaba a 403. Pero ese código llega por RLS **y** por un GRANT roto: una rotura de deploy se disfrazaba de "no autorizado" y quedaba invisible. | Se distingue por mensaje: RLS → **403**; `permission denied`/rol → **500 + log ruidoso** (ADR-17). |
| **#4** LOW | La sesión de `localStorage` se casteaba sin validar: un `{}` creaba una **sesión fantasma** (autenticado sin token). | `parseSesion` valida la forma. Conserva el `tenantId` vacío a propósito (caso real del usuario sin `app_metadata`). |

> La lección de esta ronda, otra vez la mía: **escribí el verificador de JWT y no lo probé**. Los tests
> de la API inyectan un verificador falso —correcto para probar rutas y RLS sin criptografía— y eso
> dejó la **puerta de entrada** sin un solo test. Probar lo fácil en vez de lo que se rompe, en el
> lugar exacto donde más caro sale.

#### Verificación en un navegador real (Chrome DevTools)

El hallazgo **#2 estaba en PLAUSIBLE**: "el bug sale de la lógica, pero no lo reproduje porque el
portal no corre en vivo acá". Sí corre. `npm run dev:server -w api` levanta la **API real sobre
PGlite** (posible porque `createApp` recibe todo inyectado), y con eso se manejó el portal en Chrome:

- **El #2, CONFIRMADO y luego cerrado.** Con `snapshot`, navegar de `/runs/A` a `/runs/B` dejaba la
  URL en B y **la pantalla entera en A** —título y páginas—: aprobar ahí habría aprobado una página
  de A. Con la suscripción a `paramMap`, el brief cambia entero. **Mutación hecha en el navegador**:
  volver a `snapshot` reprodujo el bug; restaurar lo cerró.
- **La cadena completa, en vivo:** portal → API (Hono) → PGlite con RLS. Login, lista de runs,
  el brief **separado por evidencia** (✅ 2 / ⚠️ 1, con `n/d` donde no hay dato), aprobar una página
  (el botón de aprobar el run pasa de deshabilitado a habilitado: la compuerta doble de ADR-06), y
  aprobar el run → el evento `research/aprobado` sale **después** de que la base lo aprobó (ADR-18).
- **Cero errores y cero warnings** en la consola del navegador.

> Sigue sin haber tests de componente automatizados. Esto fue una verificación **manual asistida**, no
> una suite: vale como evidencia de que funciona hoy, no como red de seguridad contra regresiones.

### Tanda 15 — 9ª review: lo que encontró Codex, y lo que encontré yo en el navegador ✅

Dos verificaciones distintas sobre la etapa 5, y conviene no mezclarlas: **Codex leyó y mutó el
código**; **yo manejé el portal en un navegador real** con la API levantada sobre PGlite
(`npm run dev:server -w api`). Encontraron cosas distintas, y las dos hacían falta.

#### Lo que encontré yo (Chrome DevTools)

| Qué | Resultado |
|---|---|
| **El hallazgo #2 de la 8ª review estaba en PLAUSIBLE** porque yo había dicho "no lo puedo reproducir, necesita un navegador". **Era falso: sí podía.** | **CONFIRMADO y cerrado.** Con `snapshot`, ir de `/runs/A` a `/runs/B` dejaba la URL en B y **la pantalla entera en A**. Mutación hecha *en el navegador*: volver a `snapshot` reprodujo el bug; la suscripción a `paramMap` lo cerró. |
| **El polling huérfano** (hallazgo #1 de esta ronda), medido en la red | Con un run `running`, el brief pollea cada 4 s. Al salir de la pantalla, **cero peticiones** en 14 s (3+ ticks). Antes del arreglo, el intervalo sobrevivía. |
| La cadena completa, en vivo | portal → API (Hono) → PGlite con RLS: login, lista, brief por evidencia, aprobar página (habilita el botón del run), aprobar run → evento **después** de la base. Cero errores en consola. |

#### Lo que encontró Codex

| # | Hallazgo | Verificado | Corrección |
|---|---|---|---|
| **#1** HIGH | **Carreras en el brief.** (a) `cargar(A)` → navegar a B → B pinta → **llega A y la pisa**, con la URL en B. (b) Si el componente se destruye con una carga en vuelo, la promesa resuelve después y **crea un `setInterval` sin dueño**: pollea para siempre. | Sí, ambos. Y su crítica de fondo también: **no había ni un test atribuible** al componente. | `Vigencia` (clase pura, `core/vigencia.ts`): se anota a qué run corresponde el trabajo **antes** de pedirlo y al volver se pregunta si sigue vigente; destruir es definitivo. **5 tests**; la mutación tumba 4. El polling huérfano, además, **medido en el navegador**. |
| **#2** HIGH | La clasificación de `42501` **dependía del mensaje en inglés** (`/row-level security/i`). Postgres **traduce** según `lc_messages`: en un servidor no-inglés, un rechazo legítimo de RLS **salía 500 en vez de 403**. | Sí. Peor de lo que yo creía: no era ruido de log, era comportamiento visible roto. | Se **dejó de adivinar**. `42501` es `insufficient_privilege` y Postgres no distingue RLS de GRANT por código: al cliente **siempre 403 sin detalle** (correcto para ambos), y al log el error completo para el operador. Sin dependencia del idioma. |
| **#3** HIGH | La política decía **HS256** y no se imponía: un **HS512 firmado con el mismo secreto entraba**. No es bypass (hay que tener el secreto), pero *una política declarada y no impuesta no es una política*. Además `sub: "   "` pasaba. | Sí. | `algorithms: ["HS256"]` + `sub` con `trim()`. **3 tests nuevos** (HS512, `alg:none`, `sub` en blanco); la mutación tumba el de HS512. |
| **#4** LOW | `parseSesion` validaba **tipos, no semántica**: aceptaba `expiraEn: -1` y cualquier string como `rol` (un `superadmin-inventado` mostraba controles de equipo — cosmético, la API decide igual). | Sí. | `expiraEn` tiene que ser un instante posible (`> 0`); el rol se normaliza contra el dominio real. **Una sesión vencida SÍ se acepta a propósito**: el refresh token vive más y el 401 la resuelve — deslogear ahí obligaría a re-entrar sin necesidad. |

> **La lección de esta ronda es sobre el método, no sobre un bug.** Codex encontró carreras
> asincrónicas que un navegador no muestra salvo con el timing exacto; yo encontré, manejando la app,
> cosas que leer el código no revela. **Ninguna de las dos verificaciones sustituye a la otra**, y
> declarar "hecho" con una sola ha sido, sistemáticamente, declarar de más.

> ⚠️ **Sigue sin haber tests de componente.** La lógica de la carrera ahora **sí** está cubierta
> (`Vigencia`), pero que `BriefPage` la use correctamente se verificó a mano en el navegador: eso es
> evidencia de que funciona hoy, **no una red contra regresiones**.

### Tanda 16 — Etapa 6, el renderizador: dos bugs que encontró la verificación, no yo ✅

Sin review externa todavía. Estos salieron **escribiendo el código y manejándolo**, y los dos son de
la misma familia: *yo había afirmado algo que no era cierto*.

| | Qué pasó | Cómo apareció | Qué se hizo |
|---|---|---|---|
| **#1** HIGH | **Una política de RLS sin cláusula `to` aplica a roles que todavía no existen.** `client_select` (de `0001`) llamaba a `app.ve_cliente()` → lee `memberships`. Al agregar el rol público `app_render`, esa política vieja se evaluaba también para él y lanzaba `42501`: el renderizador no podía leer **ni la fila que su propia política le autorizaba**. Las políticas se combinan con OR, pero **si cualquiera lanza, la query entera muere**. | El **test de RLS**, en rojo, antes de que existiera el servicio. | `client_select`/`client_write` acotadas con `to app_user, app_service`. **Lo importante es lo que casi pasa:** si le hubiera dado `execute on schema app` por inercia —como tienen los otros tres roles— habría funcionado **en silencio**, con el rol público evaluando políticas de usuarios autenticados y leyendo `memberships` en cada visita a la web de un restaurante. El fallo ruidoso fue lo que lo hizo visible. |
| **#2** HIGH | **Un NAP mal cargado tiraba la web entera del cliente.** `renderStory()` **lanza** si `business_profile` trae `address` como texto plano en vez de un `PostalAddress` → 503. La columna es `jsonb`: Postgres garantiza JSON válido y **nada más**. Y en `app.ts` yo había escrito que un perfil mal formado *"degrada la página en vez de romperla"* — **falso**: el `typeof p === "object"` que tenía deja pasar `{address: "Calle Mayor 1"}` sin pestañear. | **El navegador**, en la primera carga del dev-server. Los tests no lo vieron porque **todos** usaban `businessProfile: null`. | `perfil.ts`: valida forma, descarta lo irreconocible, y la página sale sin bloque de contacto. **Una página sin dirección es mucho mejor que ninguna página.** 10 tests, incluido uno que documenta que `renderStory` lanza — si algún día se vuelve tolerante, ese test cae y avisa. |
| **#3** MED | `encodeURIComponent` **no** neutraliza `..`: el punto es un carácter no reservado, pasa intacto, y `new URL()` colapsa la ruta **después** — un slug `../../spaces/111` se salía de `/stories/` y le pegaba a otro endpoint de la API de Storyblok. | Un test que escribí **esperando que ya estuviera cubierto**. | Los segmentos `.` y `..` se descartan antes de escapar. |

> **La lección: el comentario es donde las afirmaciones no se ejecutan.** El #2 no fue un descuido de
> implementación — fue que escribí la garantía en prosa, me la creí, y nunca la ejercité. Es la misma
> forma exacta de los hallazgos de las reviews 7, 8 y 9. La diferencia es que esta vez la encontré
> antes de decir "hecho", y solo porque **levanté el servicio y lo miré**.

**Verificado en un navegador real** (Chrome DevTools, contra el dev-server sobre PGlite): la web
sirve con su JSON-LD `LocalBusiness` + `FAQPage`; el cliente con el NAP roto **degrada en vez de
caerse**; dominio desconocido → 404 sin fallback; `miss`→`hit` en la cache y `miss` de nuevo tras el
webhook firmado, **sin tocar el otro space**; y el preview firmado sirve el borrador con el Bridge y
`noindex`, mientras que sin firma, con firma de otro dominio o con la firma alterada **sirve lo
publicado**.

### Tanda 17 — 10ª review: la mejor de las diez, y el mismo error mío cinco veces ✅

Codex revisó la etapa 6 y su veredicto fue **"no está lista para exponerse a internet"**. Tenía
razón. Nueve hallazgos, todos corregidos.

**Lo que importa no son los bugs, es que cinco de los nueve son garantías que yo declaré y nada
hacía cumplir.** Prosa que daba por ejecutada:

| Yo había escrito | La verdad | Ahora lo impone |
|---|---|---|
| "un space de Storyblok por cliente" (ADR-04/11) | nada lo impedía → dos clientes con el mismo space **comparten cache**: la web de B servía el HTML de A, sin consultar el token de B | `unique` en `clients.storyblok_space_id` (`0008`) |
| "timeout de 5 s contra la CDA" | cortaba al recibir los **headers**; el cuerpo podía colgar para siempre | el plazo cubre la respuesta completa |
| "lo que se llevan es el NAP, que ya era público" | el grant daba el `jsonb` **entero**: notas internas, emails, lo que hubiera en la ficha | columna generada con allowlist (`0008`) |
| "no puede ejecutar las funciones de `app`" | sí puede; lo que protege es que son `SECURITY INVOKER` | corregido en la doc |
| la clave de cache aísla clientes | el separador era un **espacio**, que puede aparecer en un slug → `("11","1 menu")` y `("11 1","menu")` colisionaban | clave con longitud prefijada |

Los otros cuatro son **ausencia de límites**, no afirmaciones falsas. El servicio estaba escrito para
el camino feliz:

| # | Hallazgo | Qué se hizo |
|---|---|---|
| **#3** HIGH | El camino anónimo **no tenía un solo tope**: cada path aleatorio era un lookup de Postgres + una llamada a la CDA; los 404 no se cacheaban (`/a-1`, `/a-2`… amplificaban sin fin); N visitas al mismo slug frío eran N llamadas al origen; el webhook leía el cuerpo **antes** de verificar la firma. No hace falta ingenio: es un bucle con `curl`, y lo paga nuestra cuenta. | `limites.ts`: coalescing, cache negativa (30 s) y semáforo (**503, no cola infinita**). Tope de 256 KB en el webhook, comprobado antes de leer. |
| **#4** HIGH | El pool de Postgres **sin ningún plazo** (los defaults de `pg` son esperar para siempre), y la resolución de dominio ocurría **antes** de mirar la cache: una base colgada dejaba pendiente hasta una página cacheada, mientras `/_health` devolvía 200. | Timeouts en todo el pool (2 s), cache de resolución de 60 s **antes** de la base, y un health check que reporta presión interna. |
| **#5** MED | El preview llevaba `noindex`, que evita que se **indexe** pero no que se **cachee**. Una CDN que ignore la query —default frecuente— guardaría el borrador y se lo serviría a un anónimo. | `Cache-Control: private, no-store` + `Vary: *`. Y las públicas declaran su cacheabilidad explícitamente, en vez de dejar que cada CDN invente. |
| **#7** MED | La firma del webhook autentica el cuerpo **y nada más**: sin timestamp ni id de entrega, una petición legítima capturada se repite para siempre. Cache busting gratis. | Dedupe por hash del cuerpo en ventana de 5 min. No es perfecto (quien capture dos entregas distintas las alterna), pero convierte "infinitas" en "una por ventana". |

**#6** (la firma de preview vale para todo el dominio) se revisó y **se deja como está**: el Visual
Editor es un editor donde se *navega* entre páginas, y firmar por-path obligaría a re-firmar en cada
clic. Lo que acota el riesgo es que está atada al dominio, que vence y que solo la emite la agencia.
Estaba bien; lo que faltaba era **decirlo**.

**Los falsos-verdes que encontró, que son el hallazgo metodológico:**

- Subió el tope por defecto de la cache de 500 a **infinito** y los ocho tests siguieron verdes:
  todos pasaban `maxEntradas` explícito, así que **ninguno fijaba el valor de producción**.
- El test de timeout usaba un `fetch` que rechazaba *antes* de los headers: probaba el mecanismo del
  abort, **no el contrato** "la petición completa termina en N ms".

> **La lección de esta ronda.** Las nueve reviews anteriores me encontraron tests que probaban la
> implementación en vez del contrato. Esta encontró algo peor: **tests que fijan el parámetro que el
> test elige, no el que corre en producción**. Un default sin test es una decisión sin dueño.
>
> Y sobre lo otro: ya sé que escribo garantías en comentarios y no las ejercito. Van tres rondas
> seguidas con el mismo diagnóstico. Lo que cambió acá es que **cinco de golpe** dejan claro que no
> es descuido puntual sino un hábito — y que el antídoto no es "tener más cuidado" sino que cada
> afirmación de seguridad tenga o una constraint que la imponga, o una mutación que la tumbe.

**Verificado en un navegador real** tras los arreglos: `hit/hit/hit` del lado del servidor, la cache
negativa anotando el 404, el webhook firmado invalidando (`invalidadas: 2`) y el **repetido**
devolviendo `repetido: true`, un cuerpo de 300 KB rechazado con 413, el preview con `no-store` +
`noindex, nofollow` + Bridge, y la firma alterada cayendo a contenido público.

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
