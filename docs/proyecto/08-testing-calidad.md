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

## Cobertura actual: 1395 tests (monorepo) + 425 (portal)

> Las cifras de esta tabla se miden con `npm run verificar`, que las cuenta de la salida de
> `node:test`. Si no coinciden, la que está mal es la tabla. Última medición: **2026-08-13** —
> `npm run verificar -- --con-portal` en verde de punta a punta (typecheck, 1395 tests del monorepo,
> 282 `node:test` del portal), más `npm run test:components` (Karma, 143) aparte, al cierre de la
> revisión final de integración de la Pieza 4 (2 bloqueantes + 4 minor arreglados en el mismo commit).

| Paquete | Tests | Qué cubre |
|---|---|---|
| `contrato` | **39** | El contrato del brief compartido (KR-2a). Los **dos** validadores y por qué son dos: fixtures **negativos** de `emisionM2` (lo que el M2 debe rechazar) y de `consumoM1` (las cuatro `schema_version`), más el test de **inclusión** `emisionM2 ⊆ consumoM1` — lo único que impide que los dos se separen en silencio. El informe con **datos incompletos**: `n/d` en vez de `NaN`, la tabla de desglose que **no se pinta** sin datos, y `endpoints_degradados` distinguiendo `[]` ("ninguno falló") de `null` ("no se sabe"). El **escapado de delimitadores** de Markdown, que evita que una keyword con `|` desalinee la tabla o que un `\n##` invente una sección. Y dos tests de arquitectura: que **ningún paquete** defina su propio esquema del brief, y que ese barrido **no pueda quedar vacío** y pasar para siempre. |
| `db` | **316** | RLS, aislamiento multi-tenant, compuerta de aprobación (aprobar **y editar**), **la seguridad de `kr_informes`** (los dos `grant` con el login real, el `cliente` que ve su run y **no** el informe, el rol ausente, `app_render` sin acceso, la FK compuesta y el tope de 256 KiB **en bytes**) y **`guardarInforme`** (idempotente, que no revoca aprobaciones, y que lanza si el run no es visible en vez de escribir cero filas en silencio), credenciales (`pg_has_role`, con caminos transitivos), idempotencia del gasto, **allowlist de `locations`/`menu` en `business_profile_publico`** (`0010`), y que la allowlist restrinja también la **forma** de cada valor —no solo el nombre de la clave— con tope de tamaño aplicado en la fuente (`app.texto_publico`, revisión externa Codex). Desde la pieza 3 del portal (**Ideas**, `0013`): permisos **por verbo y por columna** (mover una idea de tenant es un `42501` que dicta Postgres, no una allowlist de TypeScript), la **máquina de estados como trigger** con un test cartesiano que ata sus dos copias, el test de fuga contra `app_render` que exige **`permission denied`** y no "cero filas" —con `force RLS` sin policy, contar filas da cero y la mutación no cae—, y el **seed de ejemplo** con su idempotencia (`delete`+`insert`, porque un upsert dispararía el trigger de transiciones). |
| `kr-service` | **146** | Pipeline, costos, presupuesto, HTTP, cache, registro de tareas, **la costura: que el POST facturable pase por el registro** (`client.test.ts`), **y que producción falle cerrado sin registro durable** (`getprovider-guard.test.ts`). Desde KR-3: el **map pack** del SERP corrigiendo `is_local`, el **percentil winsorizado** del volumen, el **orden en dos niveles**, y que el **destino del dataset no caiga en un directorio que git ignore**. |
| `web-builder` | **387** | Contrato, handoff, render, XSS, idempotencia de publicación, marca por tenant, imágenes, **nav fijo de 4 secciones, footer NAP multi-local, `/menu` y `/blog` sintetizados** (con escape de `name`/`slug`/`price`), que **`locations` manda** sobre los campos clásicos (JSON-LD y footer, no solo cuando faltan), y que `parseProfile` rechace un perfil con más de 20 locales o 200 ítems de carta. |
| `orchestrator` | **77** | Workflow durable, compuerta humana, autorización del evento, **el orden `guardar-paginas` → `guardar-informe` → `cerrar-run`** (el invariante: un run en `pending_approval` siempre tiene informe) y **los 16 campos de la conversión de página fijados contra la fila persistida**, **cada cliente publica en SU space**, drafts no se marcan publicados. |
| `api` | **184** | Los **tres** resultados del informe (200 con `null` si no hay, 404 solo si no hay run, y el rol `cliente` indistinguible del primero **sin ningún `if` de rol**), el **`filename` por allowlist** con su fallback y su test end-to-end del header, y que el `Content-Disposition` esté **expuesto** por CORS. Auth (**JWT firmados de verdad**: exige `exp`/`sub`, verifica `aud`/`iss`, rechaza otro secreto), **comando compuesto: RLS rechaza → NO se emite el evento**, las dos audiencias (equipo escribe, cliente solo lee), aislamiento entre tenants, la compuerta doble (ADR-06), CORS. Contra PGlite, sin red ni Supabase. Desde **Ideas** (etapa 3): los tres endpoints con **ni un `if` de rol** —abrir la política de Postgres tumba los tests, que es lo que no pasaría si la autorización viviera en TypeScript—, el 404 **indistinguible** entre "idea ajena" e "id inexistente" fijado comparando **cuerpos** y no status, y el **contrato del seed** atado desde acá (`ideas-seed-contrato.test.ts`), que es el único sitio donde se tocan las dos puntas: el seed inserta con la infraestructura y **se salta entero** el borde HTTP, así que el vocabulario de `analisis` y el esquema de las URL no los comprueba nadie más. |
| `renderer` | **151** | Resolución de dominio (**el `Host` como dato hostil**: inyección, IPs, puerto, `X-Forwarded-Host`), cache (colisión de slug entre spaces, TTL, LRU, invalidación por space), **webhook firmado** (sin firma / con otro secreto / sin secreto = cerrado), **preview firmado** (otro dominio, vencido, sin secreto, y que **no se cachee**), CDA (`../` e inyección de query, 404 vs 503, timeout), `perfilValido` (un NAP mal cargado degrada, no tira la web; **`locations`/`menu` sobreviven al validador y llegan al render**), **los límites del camino anónimo** (10ª review), y **navegación + home** (barra desde la Links API con las mismas defensas; **la nav falla → sin barra, no 503**; nav de preview en draft sin cachear; la raíz sin `home` **sintetiza un índice**, no 404; `/blog` no se autoenlaza aunque exista una story real con ese slug). |
| `scripts` | **95** | El reparto de credenciales (`env-sync`), el re-seed de producción y **el contador de tests del propio arnés** (9, ver abajo: los dos formatos de reporter, el piso que impide reportar 0 en verde, y uno que corre el runner de verdad). No prueba la implementación: prueba la **compartimentación**. El `MAPA` debe coincidir exactamente con cada `.env.example` **en las dos direcciones** —agregar una clave a un example rompe el test hasta que alguien decida quién puede verla—, el renderizador nunca recibe el token de **escritura** de Storyblok ni una `DATABASE_URL_*`, y la API nunca recibe la conexión de admin (ADR-17). Verificado por mutación. |
| `portal` | **425** | *(fuera del monorepo)* **282 con `node:test`** — el núcleo puro: cliente HTTP (headers, errores tipados, **refresh del token + retry en 401**), login de Supabase, **validación de la sesión guardada**, **la separación por evidencia** (✅/⚠️), las **carreras asincrónicas** (`Vigencia`) y el **contraste WCAG AA** de los 17 pares × 2 temas leído de `styles.css`, más un test que recorre `src/app` y **falla si una plantilla incrusta un color**. Más el guard de config de producción: que `environment.prod.ts` esté **listo para desplegar** (sin placeholders, todo HTTPS) — importa porque el portal se despliega solo en cada push. Y **143 de componente con Karma** (`ng test`) para el DOM: tema, shell, y las pantallas de clientes, usuarios e ideas (incluido el `<select>` cuyo `[value]` se aplicaba antes de existir las `<option>`). Desde KR-2b: el **parser de Markdown** (que el HTML crudo sale como **texto** y una marca desconocida **literal**, que **no existe** ninguna variante que transporte marcado, y que **deshace el escapado del generador sin reabrirlo** — un `\|` hostil no recupera su columna), un **barrido del árbol** que falla si alguna plantilla usa `innerHTML`/`bypassSecurityTrustHtml` (descubre archivos, así que cubre las pantallas futuras), y la pantalla del informe: los **tres** estados distinguidos —informe, run sin informe y run inexistente— con el par de tests que impide confundir los dos últimos. Desde la pieza 3 (Ideas): el listado y el detalle por cliente, la máquina de transiciones atada por test a `db/src/ideas.ts`, y las carreras de cliente/filtro/idea. Desde la pieza 4 (Dashboard): la pantalla `InicioPage` — seis tiles y la tabla de últimas ideas con TRES fuentes independientes en su falla (incluida la simétrica: si clientes falla, la tabla igual pinta con "Cliente desconocido"), el límite real de 5 filas fijado con más ideas que el límite, y el guardarraíl de que `/inicio` sigue siendo hija del shell con `authGuard`. Con `fetch` de mentira — los 282 corren sin navegador. |

### La disciplina que más ha valido: **mutation testing**

Cada fix de seguridad se verifica **reintroduciendo el bug** y comprobando que el test cae. Sin eso,
un test de seguridad que siempre pasa es peor que no tenerlo — y me pasó: el test del doble cobro
comprobaba *"solo una reserva es `nueva`"*, que era cierto **e irrelevante** (la otra salía
`huerfana`, que también autoriza gastar). Pasaba con el bug dentro.

Volvió a pagar el 2026-08-03, en la compuerta de secretos. Se cerraron dos huecos con una regla cada
uno, y al mutarlas **por separado** salió que el test de `docs/private*` seguía verde sin su regla:
todos sus casos eran `.zip`, así que **los cazaba la otra**. Verde por la razón equivocada, y la
mutación fue lo único que lo dijo. La forma de la trampa se repite: cuando dos reglas se solapan, un
test que las cubre juntas no prueba ninguna de las dos.

#### Las tres veces que una mutación NO cayó (KR-2a, 2026-08-05), y por qué valen

La regla dice que **una mutación que no tumba nada es un resultado, no un fallo del método**: o falta el
test, o la línea no hace lo que su comentario dice. En KR-2a pasó **tres veces en nueve tareas**, y la
respuesta fue distinta cada vez. Por eso quedan escritas: es el ejercicio real de la regla.

| Mutación | ¿Cayó? | Cuál de las dos causas era |
|---|---|---|
| Borrar los `.extend()` de `emisionM2`, con los 6 tests que traía el plan | no | **Faltaban tests.** Se agregaron 3, y ahora caen exactamente esos 3. |
| Agregar un valor de enum a `emisionM2` sin agregarlo en `consumoM1`, con los 3 casos del plan | no | **Faltaba un caso**, no un test. El cuarto recorre el otro extremo del vocabulario. La lección quedó en el código: *el test de inclusión solo cubre lo que sus fixtures ejercitan.* |
| Quitar el colapso de saltos de `celda()` en el informe | no | **Tampoco era la línea, y tampoco era "falta un test genérico":** ninguno de los cuatro tests metía un `\n` **en una celda**. Se demostró que la línea sí hace algo —una keyword con `\n##` **parte la fila de la tabla en dos**, una de 3 columnas y una huérfana— y se escribió el test que faltaba. |

Y una cuarta, que sí cayó pero enseñó lo contrario de lo que su comentario decía: en el gate de gasto de
`run.ts`, el comentario afirmaba que leer el campo nullable **pasaba** el typecheck y que leer los locales
**reventaba**. Medido en un worktree: es al revés (leer el campo → 4 errores y exit 2). **La conclusión del
código era correcta y la justificación escrita estaba invertida** — y lo que sí era cierto es la mitad más
instructiva: los 146 tests de `kr-service` pasan en **las tres** variantes, así que la red que atrapa eso es
`tsc`, nunca la suite.

#### El molde que ya apareció tres veces: **una cifra ausente disfrazada de un cero legítimo**

No es un bug repetido, es una **forma**. Las tres veces, algo que debía contar no contó, y el resultado
—cero— era indistinguible de una respuesta válida:

| Dónde | Qué contaba | Por qué el cero pasaba por bueno |
|---|---|---|
| `verificar.sh`, sección 2 | los paquetes del monorepo | Un `find` que no encuentra nada devuelve 0 sin error, y el mensaje decía "6 paquetes" a mano. |
| `contrato`, test de arquitectura | los paquetes barridos buscando un `z.object` del brief | Un barrido con el glob mal escrito recorre **cero** archivos y **pasa para siempre**. |
| `verificar.sh`, secciones 5 y 6 | los tests en verde | `grep '^# pass'` no matcheaba nada bajo Node 24, `awk` sumaba 0, y el arnés imprimía `[OK] 0 tests en verde`. |

La defensa es siempre la misma y **no es un test: es un piso**. Si la cuenta da cero, no hay salida verde —
falla y dice qué mirar. Un contador que no puede contar no está autorizado a reportar `[OK]`.

Y hay un corolario que costó una corrida entera de KR-2a: **el cero no lo detecta la suite, porque la suite
no se mira a sí misma.** La cifra del arnés era la única señal de cuántos tests corrieron, así que cuando
ella se rompió, todo lo demás siguió en verde legítimamente. Por eso ahora esa cifra tiene tests propios.

#### El test que no envejece (y que se estrenó cazándose a sí mismo)

`scripts/contar-tests.test.mts` tiene dos clases de test. Siete usan **fixtures medidos** —la salida literal
de `node --test` bajo v22.21.1 (`# pass 34`, reporter `tap`) y v24.18.1 (`ℹ pass 34`, reporter `spec`)—, y
esos envejecen: fijan el pasado. El noveno **corre el runner de verdad** en un subproceso y exige que el
formato que imprime *el Node que está resolviendo el PATH ahora* se pueda contar. Ése es el único que se
habría puesto rojo el día del bug, y el único que se pondrá rojo cuando Node vuelva a cambiar el formato.

Su primera versión estaba en verde **midiendo una salida vacía**. El subproceso heredaba `NODE_TEST_CONTEXT`
del runner padre, con lo cual Node avisaba `run() is being called recursively within a test file. skipping
running files`, **no ejecutaba ningún test y salía con status 0**. O sea: el test escrito para impedir que
una salida vacía cuente como verde tenía adentro, en su primera versión, una salida vacía contando como
verde. Lo cazó el `assert` de la cifra; el `assert` del status estaba conforme.

**La regla que deja:** un test que lanza un subproceso no puede conformarse con *"el proceso no falló"*.
Tiene que comprobar el **resultado**, porque el camino que no hace nada también termina bien. Vale igual para
el arreglo: se borran `NODE_TEST_CONTEXT` y `NODE_TEST_WORKER_ID` del entorno del hijo, **y** se afirma que
su stderr no trae `recursively` — para que el día que Node renombre esas variables, el test lo diga en vez
de volver a medir el vacío.

#### La mutación que no se aplicó, y el verde que era su ausencia (KR-2b, 2026-08-06)

La regla de mutar y ver qué cae tiene un modo de fallo que no está en la regla: **que la mutación no
entre**. Pasó tres veces en KR-2b, y las tres el síntoma fue un verde perfecto.

| Cómo falló el reemplazo | Qué pareció |
|---|---|
| La aguja de 4 espacios era **subcadena** de una línea de 6 | 22/22 verde: la mutación nunca se escribió |
| `perl` con la aguja mal escapada (dos veces) | verde, cazado por el `grep` posterior |
| `grep "exposeHeaders"` daba **dos hits con la mutación puesta** — un comentario y un marcador | el rojo parecía confirmado por la razón equivocada |

**Las dos mitades de la regla, entonces:** antes de creerle al verde, confirmar con `grep` que **la aguja
entró**; y confirmar que **el hit es la cosa**, no un comentario que la nombra. El tercer caso es el que
enseña que "el grep lo encuentra" no equivale a "la mutación está".

#### Cuatro capas de la misma equivocación, y ninguna era el código

El defecto más repetido de KR-2b —**siete** veces— no fue código roto: fue una afirmación sobre una
herramienta escrita sin ejecutarla. Y en un caso se apilaron cuatro:

1. Un implementador afirmó que el tipo del portal «no va a avisar» de un `unknown`. **Razonado, no
   compilado.**
2. El coordinador lo corrigió y prescribió `=== null` como el estrechamiento correcto. **También razonado.**
3. Una review escribió *esa prescripción literal* en una plantilla real y corrió `ngtsc`: `TS2362`. `=== null`
   **no** estrecha `unknown` a `number`.
4. El coordinador añadió que el guard «tiene que vivir en el componente porque la plantilla no admite
   `typeof`». El implementador lo midió con dos controles positivos: **la plantilla sí lo admite y sí
   estrecha**. Era preferencia de estilo disfrazada de exigencia del compilador.

**La regla que deja, y es más amplia que "medí lo que escribís":** vale también para las **instrucciones que
recibís** — y sobre todo cuando llegan envueltas en la corrección de un error propio, que es cuando menos
ganas hay de dudar. La capa 3 solo se salvó de propagarse porque venía marcada como inferencia y no como
hecho.

Corolario práctico: **un control positivo en cada sonda.** La capa 4 se resolvió porque la sonda incluía un
caso que *debía* fallar (`{{ valor * 100 }}` → `TS2571`); sin él, "compiló limpio" no distingue entre *el
compilador lo aceptó* y *el compilador no miró el archivo*.

### `kr-service` (146 tests)

| Archivo | Qué fija |
|---|---|
| `lib/text.test.ts` | `canonicalKey`: casing, espacios múltiples, **normalización Unicode NFD→NFC**. |
| `pipeline/scoring.test.ts` | El gate de `business_relevance`: evaluada-alta (score alto, confianza plena), evaluada-bajo-gate (**descartada**), **no evaluada (score capeado a 35 + confianza baja)**, y que una no-evaluada **nunca supere** a una evaluada equivalente. Más el **percentil winsorizado**: que un outlier ya no aplaste al resto, que la población sean los volúmenes **conocidos** (los ceros entran, los `null` no), los casos degenerados (vacía, un solo elemento, todos en cero) y el valor de `VOLUMEN_PERCENTIL_TOPE`. |
| `pipeline/cluster-map.test.ts` | El orden en dos niveles: que **la evidencia mande siempre** (una `sin_validar` con score 100 y confianza 1.0 sigue debajo de una `datos_mercado` con score 10), que dentro del grupo ordene la confianza, que la penalización sea **moderada** (si no, subir `PESO_CONFIANZA_ORDEN` a 1.0 pasaría desapercibido), y que el corte al backlog use el orden nuevo pero guarde el score **crudo**. |
| `pipeline/intent.test.ts` | El clasificador heurístico de fallback (transactional / commercial / informational / señal local). |
| `pipeline/local-signal.test.ts` | El refinamiento de `is_local` por map pack. Lo que fija de verdad: **`mapPack: null` no pisa nada** ("no observado" ≠ "no es local", el mismo error que `volumen ?? 0`), que con observación **el SERP gana** al LLM, que una keyword sin señal queda intacta, y que el cruce **canoniza las dos puntas**. |
| `pipeline/run-local-signal.test.ts` | La **costura** en `run.ts`: que la señal viaje del clustering al refinamiento, que corrija de verdad, y que corra entre `[cluster]` y `[map]`. Arranca `runResearch()` entero con cuatro cerrojos para que no pueda gastar (dotenv apagado, config mock verificada aparte, `fetch` roto). |
| `pipeline/cluster.test.ts` | El callback `onSerp`: que reporte en el camino OK, que un **SERP fallido reporte `mapPack: null`** y no `false`, y que el overlap lea `.urls`. |
| `dataforseo/endpoints.test.ts` | La extracción del map pack de la respuesta *advanced*, y que un SERP que respondió dé `false` —nunca `null`—. |
| `dataforseo/mock-provider.test.ts` | Que el mock sea determinista y **produzca las dos ramas** del map pack: si siempre devolviera lo mismo, ningún test recorrería el camino que importa. |
| `cli/dataset-path.test.ts` | Que el destino por defecto del dataset **no caiga en un directorio ignorado por git**, preguntándoselo a `git check-ignore`. Con **control positivo**: comprueba antes que `out/keywords.json` sí se detecta como ignorado, para que un `git` ausente no deje la aserción pasando por vacío. |
| `lib/cost.test.ts` | El total suma **todos los proveedores**; costo del LLM calculado desde tokens; embeddings solo pagan entrada; un **modelo sin tarifa no inventa costo** (queda en `unpricedModels`); `reset()`. |
| `lib/budget.test.ts` | El **preflight bloquea ANTES de gastar** si la estimación no entra; tiene en cuenta lo ya gastado; sin tope nunca bloquea; corte post-fase si la estimación se quedó corta. |
| `lib/http.test.ts` | Clasificación de errores (429/5xx reintentables, 4xx no); backoff dentro del tope; `Retry-After` en segundos y fecha HTTP; **un 500 se reintenta y termina bien**; **un 400 NO se reintenta**; se propaga `HttpError` con el status al agotar reintentos; fallos de red. *(Con `fetch` stubeado: sin red.)* |

### `web-builder` (96 tests)

| Archivo | Qué fija |
|---|---|
| `contract.test.ts` | Brief válido; **rechazo** de `schema_version` no soportada, de página malformada (`content_brief: null`) y de enum inválido. Perfil válido; rechazo de URL inválida y de `name` faltante; `locations`/`menu` con varios locales/ítems; **`.max()` rechaza más de 20 locales o 200 ítems de carta** (tope en la puerta, antes de que llegue a Postgres). |
| `handoff/adapter.test.ts` | Mapeo `hero + section* + faq`, slugs, preservación de SEO / intención / contrato editorial. |
| `storyblok/content.test.ts` | `_uid` en el page raíz y en **todos** los bloks; FAQs como bloks **`faq_item`**; preservación de canonical / OG / claims / `source_keyword`; SEO aplanado. |
| `render/html.test.ts` | **XSS neutralizado** (un título con `</script><script>` no puede cerrar la etiqueta); `<html lang>` desde el brief; ids `contacto`/`faq` **sin duplicar**; canonical resuelto (absoluto con perfil, relativo sin él); JSON-LD `@graph` con `LocalBusiness` + `FAQPage`; **nav fijo de 4 secciones** (condicional a que haya datos); **footer compartido multi-local**, con **`locations` mandando** sobre `telephone`/`address` de nivel superior (JSON-LD y HTML); `/menu` agrupado por categoría con JSON-LD `Menu`; `/blog` con solo las páginas `Article`, sin autoenlazarse en su propio pie. |
| `llm/content.test.ts` | `reconcile` ante respuestas LLM parciales: respuesta completa, **`sections` como string (no-array)**, **elemento sin `heading`**, y que siempre devuelva una entrada por cada sección/pregunta de entrada; `buildUserPrompt` no filtra la palabra `undefined` cuando falta el código postal. |
| `lib/uid.test.ts` | `stableUid`: determinista, claves distintas dan uids distintos, forma de UUID v5 válida. |
| (en `storyblok/content.test.ts`) | **Republicar el mismo contenido produce los MISMOS `_uid`**; los `_uid` dependen de la identidad del blok, **no del orden** (agregar una sección no cambia los uids de las existentes). |

`src/fixtures.ts` centraliza los datos de prueba (brief, página y perfil válidos).

## Revisiones internas (el agente `revisor`) — la contabilidad que faltaba

**Esta sección existe porque no existía.** Las revisiones internas se venían haciendo —el ritual de
[AGENTS.md](../../AGENTS.md) las exige después de que un agente de área devuelva trabajo— pero su
registro vivía **solo** en `progress/informes/`, que está **gitignoreado**. O sea: encontraban
bloqueantes reales y el repo se quedaba con el arreglo y sin el porqué. Es el mismo modo de fallo que
las notas de enmienda de los planes cierran, un piso más arriba, y hubo que tropezarlo cuatro veces en
un día para verlo.

Se anota **una línea por revisión**: qué se revisó, qué encontró y qué se hizo. El detalle vive en el
commit; esto es el índice que sobrevive.

| Fecha | Qué se revisó | Veredicto | Lo que encontró, y por qué importaba |
|---|---|---|---|
| 2026-08-09 | **Bloque E**, las seis piezas con foto (`web-builder`) | CAMBIOS_PEDIDOS (1 bloqueante) | `--decorativo` **podía pintar texto** y ningún test lo impedía: era la **puerta de atrás del mismo 2.62:1** que se había cerrado dos entregas antes por `--muted`. El revisor lo encontró **mutando**, no leyendo: cambió una etiqueta a `color:var(--decorativo)` y no cayó nada. Y su gemelo en modo oscuro tampoco lo fijaba nadie. Cerrado con un detector que recorre el catálogo, con control positivo. |
| 2026-08-09 | **Ideas, etapas 1-2** — la `0013`, `PgIdeas`, las transiciones (`db`) | CAMBIOS_PEDIDOS (3 bloqueantes) | Una **afirmación técnica del implementador, medida y falsa**: decía que `select … for update` era imposible con el `grant` por columna, y el revisor midió que **funciona**. Era la única razón escrita para dejar abierta una ventana de carrera, y quien escribiera la etapa 3 la habría leído como una restricción del motor. Además: el `with check` de la política **no lo sostenía ningún test** (hacían falta *dos* mutaciones simultáneas para tumbarlo, así que ninguna individual lo cazaba). |
| 2026-08-09 | **Ideas, etapa 3** — los tres endpoints (`api`) | CAMBIOS_PEDIDOS (2 bloqueantes) | Los dos bloqueantes fueron **de documentación**, y el segundo es el que enseña: las siete decisiones de contrato vivían en un informe gitignoreado **y una ya contradecía al plan versionado** (`client_id` contra `clientId`). Manejando la API con `curl` —no con los tests— encontró que `?clientId=` vacío daba 400 hablando de `market`, y que `PATCH {"titulo":12345}` contestaba `{"ok":true}` **sin guardar nada**. También corrigió una premisa: dos validaciones declaradas redundantes porque "el status es idéntico" — el status sí, **el cuerpo no**, y el cuerpo es contrato. |
| 2026-08-10 | **Ideas, etapa 4** — el seed de ejemplo (`db` + `api`) | CAMBIOS_PEDIDOS (1 bloqueante) | Verificó **ocho mutaciones por su cuenta** en vez de creer el informe. El bloqueante, otra vez documentación. De los menores, uno real: un test estructural titulado *"ningún camino que **escriba** en la base real"* solo miraba los dos caminos de **siembra** — y como `db/src/index.ts` exporta el seed, el camino real a producción era un `import` de una línea en el servidor. Y cazó una **cifra de tests que no era de la corrida que decía ser**, que es la que se copia al `09`. |
| 2026-09-03 | **Sub-proyecto 3, rama completa** (16 commits, publicar posts en blog externo) — **sustituyendo a Codex, indisponible ese día** | APROBADO (sin bloqueantes) | No es una revisión por task: es la revisión final de rama que la enmienda de flujo del sub-proyecto exigía ANTES de mergear, con el mismo nivel de exigencia adversarial que se le pediría a Codex (no se aceptó ningún informe previo sin releer el código real). Re-verificó los tres cambios de la enmienda de flujo contra el código, re-confirmó que el fix Critical de la Task 8 (bug de "run bricked" en `crear_posts`) no tenía una variante sin corregir en las otras ramas de `workflowDecision`, y evaluó uno por uno los 6 Minor ya conocidos — ninguno subió de severidad. 2 hallazgos nuevos, informativos, no bloqueantes (`editarPost` sin exigir post ya generado; el camino de portapapeles denegado sin test) — **los dos cerrados el 2026-09-03 mismo, con rojo→fix→mutación** (`db/src/store.ts`, `db/src/posts-blog.test.ts`, `portal/src/app/pages/posts/posts.spec.ts`). Informe: `progress/informes/revisor-sub-proyecto-3-rama-final.md` (no versionado). No cuenta como ronda de Codex en la sección de abajo — es la misma disciplina, aplicada por el agente interno porque la externa no estaba disponible. |

**Cinco revisiones, cuatro CAMBIOS_PEDIDOS y un APROBADO.** Ninguna aprobó a la primera, y eso es la
señal de que sirven: quien implementa no se autoaprueba porque **no puede** — no ve lo que dio por
supuesto. Las lecciones que se repiten:

- **La mitad de los bloqueantes fueron de documentación**, no de código. No es un formalismo: en tres
  de los cuatro casos, lo que faltaba escribir era una decisión que el plan versionado contradecía o
  que la siguiente etapa no podía reconstruir sola.
- **Manejar la app encuentra lo que los tests no ven**, y encontró algo en todas las rondas donde había
  algo que manejar. Un `curl` contra el `dev-server` destapó tres defectos que 32 tests no vieron.
- **"Verificalo vos, no lo aceptes narrado"** cambió el resultado dos veces: una afirmación técnica del
  implementador resultó falsa al medirla, y una cifra de tests resultó ser de otra corrida.

## Revisiones externas (Codex) — qué encontraron y qué se corrigió

**Dieciséis rondas de revisión adversarial**, en 22 tandas de correcciones. Todos los hallazgos están
corregidos y **los tests los fijan como contrato** para que no reaparezcan.

El patrón que se repite —y por eso las reviews están en el proceso— es que **casi siempre encuentran
algo que yo ya había declarado hecho**. Las últimas: el aislamiento multi-tenant se perdía al
salir por la puerta (Storyblok), el CLI de producción corría **sin registro de idempotencia**, el
verificador de JWT **no lo tocaba ningún test**, el portal tenía **carreras asincrónicas**, y la
allowlist de Postgres restringía el **nombre** de la clave pero no la **forma** del valor. En
varios casos la documentación afirmaba una garantía que el código desmentía.

**Cómo se cuenta.** Una *ronda* es una revisión externa de código; una *tanda* es el bloque de
correcciones que salió de ella (más las que salieron de autorevisiones y de manejar la app). No
coinciden: la tanda 14 se partió en dos (14a autorevisión, 14b review externa) y la 11ª ronda —la de
`fix/jwt-es256`— se corrigió dentro de la propia rama, sin tanda numerada aparte. Aparte de estas
doce hubo revisiones de Codex sobre **specs y planes** (piezas A y C) que no cuentan acá: corrigieron
el diseño antes de escribir código, no el código.

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
humana → ver [Acciones pendientes](../historia/10-acciones-pendientes.md).

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

### Tanda 14a — la API (etapa 5.1), y esta vez la revisión la hice yo ✅

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

### Tanda 14b — 8ª review: la etapa 5 (API + portal) ✅

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

### Tanda 18 — 12ª review: la allowlist validaba el nombre, no la forma ✅

Codex revisó la rama de **navegación del sitio del cliente** ya cerrada (2026-08-01), con el encargo
explícito de **no tocar código: solo reportar**. Cuatro hallazgos, los cuatro reales, los cuatro
corregidos **y verificados por mutación**:

| Hallazgo | Por qué importaba |
|---|---|
| **`app.nap_publico` restringía los nombres de clave, pero no la forma de los valores** | Un objeto podía colarse donde se esperaba un string (`menu[].price = {"secreto":"x"}`) y **sobrevivir intacto hasta el rol `app_render`**. La allowlist parecía una frontera y era media frontera. Se agregó `app.texto_publico()` —solo deja pasar `jsonb_typeof(v) = 'string'`— aplicado a **los ~20 campos de texto**, no solo a los nuevos. |
| **`locations` tenía la precedencia invertida contra su propio comentario** | `profile.telephone ?? principal?.telephone` le daba prioridad al campo clásico, justo al revés de lo que el comentario prometía. En `homeLd`, `primaryEntity` y el footer: los tres corregidos. |
| **Los topes de tamaño se aplicaban tarde** | 20 locales / 200 ítems se chequeaban en `renderer/perfilValido`, **después** de que Postgres ya materializó el array completo con `jsonb_agg`. Se agregó el tope en la fuente (`with ordinality ... where i <= N`) y en la puerta de escritura (`.max()` en el Zod de `web-builder`). |
| **`/blog` se autoenlazaba** | El fix anterior solo cubría el `/blog` sintetizado; una story **real** con slug `blog` seguía enlazándose a sí misma. |

> **La lección de esta ronda es la de siempre, en su forma más cara:** *una garantía en un comentario
> es una intención, no una garantía.* Las cuatro son sitios donde el código decía una cosa (en un
> comentario, en un nombre de función, en una validación que parecía completa) y hacía otra. La
> primera es la que más duele: la allowlist es **la** frontera de ADR-19 hacia internet anónimo, y
> llevaba desde la `0008` validando media cosa.

**Deuda dicha, no bloqueante:** falta un test positivo de que `/blog` **sí** muestra su link en una
story normal (solo hay test de que no se autoenlaza), y la validación de forma tiene test en **un**
campo de los ~20 que ahora protege.

### Tanda 19 — 13ª review: la primera que miró el ARNÉS, y encontró lo que el arnés enseña mal ✅

Codex revisó las **etapas A y B del plan de agentes** (los agentes `pipeline` y `datos` con sus siete
skills) y el trabajo real que las estrenó, con el encargo explícito de **no tocar código**. Es la
primera ronda externa sobre `.claude/`: hasta acá las doce anteriores solo habían mirado los paquetes.
Veredicto **NO LISTO**, nueve hallazgos, **ninguno refutado del todo** y uno parcialmente.

| Hallazgo | Por qué importaba |
|---|---|
| **Dos `savePages` concurrentes del mismo run dejan la UNIÓN de dos briefs** | En READ COMMITTED —lo que abre `NodePgPool`— ninguna reconciliación ve las filas no confirmadas de la otra, así que ninguna retira las ajenas: quedan los dos briefs activos con **dos páginas en la posición 0**. Cerrado con `select … for update` sobre `kr_runs` al inicio de la transacción. **PGlite serializa sus transacciones, así que esta propiedad NO tiene test y eso quedó escrito en el código**: un test que no puede fallar es peor que ninguno. Lo que sí se testeó es el contrato observable (si el run no se puede bloquear, no se escribe nada), y de paso arregló un 400 que culpaba al payload cuando el problema era el run. |
| **La skill enseñaba "todo se escribe como `app_user`"** | El orquestador escribe como `app_service`, y su login **no puede** asumir `app_user` (ADR-17). Un agente que siguiera la skill al pie de la letra podía escribir un test con el rol equivocado o "unificar" los dos roles. La raíz estaba en el comentario de `db/src/store.ts`, que la skill citó textualmente: **el error nació en el código y la skill lo propagó convertido en instrucción**. Corregido en los tres sitios. |
| **`docs/private-backup/` evadía el detector Y el `.gitignore`** | Tercera forma del mismo error: la carpeta (cubierta el día uno), el archivo que se llama igual (`docs/private.zip`, cerrado el 2026-08-03) y ahora el **directorio hermano con sufijo**. La regla comparaba el segundo segmento con `=== "private"`. Medido: exit 0 del detector y `check-ignore` exit 1 — las dos defensas. |
| **El test de `app_service` no fijaba que PRODUCCIÓN elija ese rol** | Mutar `"app_service"` → `"app_user"` en `orchestrator/src/deps.ts` dejaba **199 tests y el typecheck en verde**, y el fallo aparecía solo en producción. El test probaba `PgStore` con ese rol *cuando el test lo elige*. Ahora hay un test del **composition root**, con un pool espía que afirma el `set local role` que la conexión ejecuta. |
| **La aserción de orden del seed no distinguía el orden nuevo del viejo** | Los 14 scores de `PAGINAS_DEMO` ya son descendentes, así que volver el `order by` del test al criterio viejo lo dejaba verde. Y el comentario **concluía que esa coincidencia hacía valioso el test**, cuando para una aserción de orden es justo lo que la anula. Reescrito para comprobar la asociación `slug → índice` **sin ordenar la consulta**. |
| **El arnés no impone los límites que atribuye a sus agentes** | Los agentes de área heredan `Bash`, y el `revisor` conserva `Write` y `Bash`: con eso se lee cualquier archivo y se corre cualquier comando. Las prohibiciones de los prompts son un **contrato**, no un sandbox. Se ampliaron los `permissions.deny` (los cuatro comandos que tocan servicios reales, y los patrones `.env.*`/`*.env`/`.envrc`/`docs/private*`) **y se declaró explícitamente la diferencia** en `AGENTS.md` y en los tres agentes: un límite que se cree técnico y es textual es peor que uno declarado como textual. |
| **Tres anclajes `ruta:línea` inexactos** | Uno de ellos —`evidence.ts:35`— **se rompió en la misma sesión que lo escribió**, porque el arreglo de otro hallazgo agregó diez líneas encima. Los anclajes por número de línea a código que estás tocando duran horas: se cambiaron por el nombre de la función. |
| **Los tiempos de la skill estaban desfasados por 3×** | Decía "~15s" para `db + api`; medido, **52s** (`db` ~6s, `api` ~46s, porque `app.test.ts` rehace PGlite y las migraciones en cada `beforeEach`). Escrito de memoria. |
| **`origin: "*"` etiquetado como "default de producción"** | Es el fallback de `createApp` para el montaje inyectado; en producción `leerConfig` **exige** `CORS_ORIGINS` y **prohíbe** `*`. La etiqueta invitaba a "arreglar" un agujero que no existe. |

**Lo parcialmente refutado:** que el `tools` del `revisor` "no convierte no-editar en una restricción
técnica". Omitir `Edit` **sí** es técnico —el agente no recibe la herramienta—; lo correcto es que la
restricción es **incompleta**, porque `Write` y `Bash` siguen ahí. La distinción importa porque de ella
depende el arreglo. También su cita de línea del `deny` estaba mal (`:90-93`, no `:16-29`).

**Y un hallazgo propio, encontrado al pasar por el archivo:** el test *"sembrar dos veces es idempotente:
no duplica tenant, cliente, **run** ni páginas"* consultaba el conteo de runs y **no lo aseveraba** —una
query muerta y una variable sin usar, justo en la garantía que el nombre promete—. Ahora cuenta el run de
demo **por id** y lo afirma.

> **La lección de esta ronda es distinta de las doce anteriores, y por eso vale.** Las otras encontraron
> garantías escritas en comentarios y no impuestas por el código. Esta encontró lo mismo un nivel más
> arriba: **afirmaciones falsas en las instrucciones que gobiernan el trabajo futuro**. Cuatro de los
> nueve hallazgos son cifras o versiones que escribí de memoria mientras redactaba las skills
> (`Postgres 18` cuando `db/` corre 16.4, `12 migraciones`, `veinte rutas`, `~15s`). Una skill
> equivocada no rompe un test: dirige mal cada decisión que se tome a partir de ella, con tono de
> certeza. La regla que queda escrita en `datos-testing`: **si vas a citar una cifra o un
> comportamiento del motor, medilo en el momento; si no lo vas a medir, no des el número.**
>
> Y la segunda, que salió de una mutación que **no** cayó: cuando una mutación no tumba nada, la primera
> hipótesis no es "falta el test" — puede ser que **la línea que mutaste no haga lo que su comentario
> dice**. Fue el caso de `nulls last`, que ya era el default de Postgres.

### Tanda 20 — 14ª review: la primera **de diseño**, y encontró un bloqueante que ningún test habría atajado ✅

Codex revisó la **spec de KR-2** (el informe legible en el portal) **antes de escribir una línea de
código** — es la primera ronda del proyecto sobre un documento de diseño y no sobre un diff. Veredicto
**NO LISTO**, **13 hallazgos**: 2 Critical, 8 Major, 3 Minor. **Los 13 verificados, ninguno refutado.**

| Hallazgo | Por qué importaba |
|---|---|
| **[Critical] La migración no concedía ni un `grant`** | La spec tenía `create table`, `force RLS` y `create policy`. Los grants del proyecto son **listas explícitas por tabla** (`0001_init.sql:413`, `0002_auth.sql:93`) y no hay `on all tables` ni `default privileges` en ninguna migración: una tabla nueva nace sin un solo privilegio. Codex lo midió en PGlite —`42501 permission denied`— y el efecto habría sido que **ningún informe se guarda ni se lee**. `kr_informes` es la **primera tabla que el proyecto agrega desde que existen los cuatro logins** (ADR-17), así que el paso no estaba en ninguna rutina. Ningún test lo habría atajado: no había test porque no había código. |
| **[Critical] El `.md` staff-only se ofrecía "para mandárselo al cliente"** | La spec movía el informe a una tabla `es_staff()` **porque revela el margen** y en la misma página lo presentaba como el archivo que se le manda al restaurante. Resuelto por decisión de Juan: **es un documento interno**. Y el encuadre correcto apareció ahí: **Frank es la agencia**, así que el coste en el informe no es una fuga hacia él — es el argumento de venta ("te costó $0.31"). Lo que queda abierto es que **el entregable del restaurante no existe**: es otra pieza. |
| **[Major] "Un esquema Zod M2 = M1" era imposible** | El de M1 acepta **cuatro** versiones (`kr.v0.2`…`kr.v0.5`) y hace `evidencia`/`score_confidence` **opcionales a propósito**; el de M2 exige el brief completo de la versión actual. No son dos copias: son **dos contratos con propósitos opuestos**. Fusionarlos obliga a que uno pierda su garantía. Peor: el criterio de cierre que yo había escrito —"los fixtures de los dos lados pasan sin editarse"— era **inalcanzable**, porque el fixture de M1 no trae `run_id`, `generated_at`, `backlog` ni `meta_run`. Rediseñado: se comparten **tipos y `renderReport`**, y una `esquemaBase` con dos derivados (`emisionM2` estricto, `consumoM1` laxo), más un test de inclusión `emisionM2 ⊆ consumoM1`. |
| **[Major] "No puede revocar aprobaciones" no era estructural** | La tabla propia elimina el acoplamiento **accidental** con el upsert de `savePages`, pero nada impide que `guardarInforme` haga *además* un `update kr_pages` — `app_service` tiene ese privilegio. Yo había convertido una garantía **debilitada** en una **inexistente**, y usé esa conclusión para justificar que no hiciera falta test. **La mutación existe** y ahora está en la matriz. |
| **[Major] El seed no puede usar `PgStore.guardarInforme`** | `sembrarDemo` abre su propio `begin` y cierra con `commit` sobre una `ConexionReservada`; `withTenant` **siempre** abre `pool.transaction`, otra conexión que no ve el run sin confirmar. La promesa "un método, dos llamadores" era falsa. Corregido: el seed inserta con **su** conexión, como ya hace con `kr_runs` y `kr_pages`. Lo único que tiene que ser único es el **render**, no el `INSERT`. |
| **[Major] Sin invariante entre estado del run y existencia del informe** | El workflow tiene **tres steps con transacciones separadas** y la spec no decía en cuál cae el guardado → cuatro estados inconsistentes, entre ellos que un run nuevo sin informe se vea igual que uno anterior a la `0016`. Fijado: step propio **entre `guardar-paginas` y `cerrar-run`**, lo que hace enunciable el invariante *un run `pending_approval` siempre tiene informe*, más los cuatro estados (`running`/`failed`/`rejected`/`approved`) explícitos. |
| **[Major] El parser evitaba XSS, no la inyección estructural de Markdown** | `renderReport` interpola texto de LLM **sin escapar delimitadores**: una keyword con `\|` agrega columnas, un `h1` con `\n##` inventa un encabezado, un slug con backticks abre un bloque de código. No ejecuta nada, pero **altera el significado del entregable** y puede simular u ocultar los avisos de evidencia, que son el argumento de venta. Mi frase "inyección imposible por construcción" era cierta para HTML/JS y **no delimitaba su alcance**. **Y el bug ya existe hoy** en el `out/informe.md` del CLI: KR-2 no lo introduce, lo hace visible. |
| **[Major] Cuatro mutaciones de la matriz no caían** | Cuatro modos de fallo distintos del método: (1) `grant select … to app_render` **no destapa nada** porque la política dice `to app_user, app_service` y sin política aplicable RLS niega igual —con RLS, quitar un grant y quitar una política dan el **mismo síntoma**, así que una sola mutación no distingue qué se prueba—; (2) relajar un campo no hace fallar un fixture **positivo** (un validador se prueba con **negativos**); (3) **`cartera-portal.test.ts` no ata `calidad_datos`** —compara nueve campos de página— y la spec afirmaba que ya lo cazaba; (4) "allowlist por denylist" no es exacta, la mutación es **quitar el saneado**. |
| **[Major] ADR-07 decide «Markdown→PDF»** | KR-2 entrega pantalla y `.md`, y la spec proponía actualizar el ADR **después** de implementar: eso es cambiar una decisión aceptada con el trabajo hecho. Y hay una razón de fondo que la decisión de Juan destapó: **el PDF perdió su motivo**, porque era un formato de entrega hacia afuera y el informe pasó a ser interno. El PDF **cambia de pieza**, al entregable del restaurante. |
| **[Major] El seed afirmaba `endpoints_degradados: []` sin fuente** | `[]` significa "ninguno falló" y la corrida **no registró nada** sobre endpoints. La spec trataba tres datos como desconocidos y **convertía el cuarto en certeza** — en la misma sección donde argumentaba por qué no hay que hacer eso. Va `null`. |
| **[Minor] Sin topes con números** | `informe_md text` sin límite, y el `filename` descrito con "longitud tope" y "fallback fijo" **sin decir cuáles**. Un default sin número no es un default. Ahora: `check (octet_length(informe_md) <= 262144)` **en la base** —un solo punto de control, así el endpoint y la pantalla no necesitan lógica de tamaño— y allowlist `[A-Za-z0-9._-]`, 60 chars, fallback `informe.md`. |
| **[Minor] El 7º workspace podía quedar fuera del verde** | `npm test` y `npm run typecheck` usan `--workspaces --if-present`: si `contrato/package.json` no declara esos scripts, **se salta en silencio** y el arnés anuncia verde. La spec solo hablaba de corregir los dos mensajes que dicen "6 paquetes", que era el síntoma cosmético. Ahora el conteo se **deriva** y hay un test de que el paquete declara sus scripts. |
| **[Minor] "El brief no muestra coste" era falso** | `brief.ts:29` pinta `Coste: ${{ usd(...) }}`. Lo que falta es el **desglose**. |

**El hallazgo propio que salió de verificar el último, y que es el más grave de la ronda:** si la pantalla
del brief pinta el coste, ¿quién puede leerlo? `run_select` sobre `kr_runs` usa `app.ve_cliente(client_id)`
(`0001_init.sql:441`), que da **true** para un rol `cliente` sobre su propio run. **El margen ya está
expuesto al rol `cliente`, hoy, sin KR-2**: `GET /runs/:id` devuelve `coste_micros_usd` y `coste_breakdown`.
Eso no invalida `kr_informes` —no agrava, y el informe lleva mucho más que el total— pero la spec la
presentaba **como si cerrara la exposición del coste**, y la exposición ya existía por otra vía. No es fuga
activa (no hay usuarios `cliente`), y cerrarla toca `RunSummary` y la pantalla del brief: **otra pieza**.

> **Por qué esta ronda vale distinto de las trece anteriores.** Todas las otras miraron código escrito (y
> la 13ª, el arnés). Esta miró un **diseño**, y encontró dos cosas que un review de código no habría
> podido: un bloqueante que **ningún test habría atajado** —los grants, porque no había código que
> testear— y **dos garantías que yo había declarado más fuertes de lo que eran** antes de que existieran
> (la "estructural" del §5.2 y la "imposible por construcción" del §7.1). Revisar el diseño encontró los
> errores mientras **corregirlos costaba editar un documento**, no revertir una migración desplegada.
>
> **Cómo terminó la tanda 21** (se completó el 2026-08-08, ver abajo): de los siete hallazgos, seis se
> arreglaron y uno —la mutación propuesta sobre `environment.prod.test.ts`— se refutó. Los seis cerraron
> en seis commits, y el bloqueante (C0) quedó **sin pushear** hasta aplicar sus migraciones.
>
> Y la lección de método de la tanda 20: **de trece hallazgos, cuatro son afirmaciones mías sobre el código que el código
> desmiente** (que el brief no muestra coste, que `cartera-portal.test.ts` ata `calidad_datos`, que el seed
> podía usar el store, que los dos esquemas Zod eran dos copias del mismo contrato). Es el mismo modo de
> fallo que la tanda 19 encontró en las skills, un nivel más arriba otra vez: **escribí sobre el código sin
> volver a abrirlo**. La regla de `datos-testing` —medilo en el momento— no era solo para las cifras.

### Tanda 21 — 15ª review: un hallazgo sobre código futuro destapó un bug del presente ✅

Primera ronda **híbrida**: los ocho commits del cierre de Fase 2 (`b227a80..81c891f`, 25 archivos,
+2318/−112) **y** el plan de la plataforma recién escrito, como revisión de diseño. Veredicto **NO
LISTO**, **7 hallazgos**: 4 Major, 3 Minor. **Cinco verificados, uno aceptado por juicio, una mutación
refutada.**

| Hallazgo | Cómo terminó |
|---|---|
| **[Major] Aprobar el run puede devolver 200 sin publicar** | **Verificado.** `approveRun` (`db/src/store.ts:914`) exige una página aprobada y que el `update` toque fila, y **nada** sobre que exista un workflow durable; el botón (`brief.ts:233`) mira solo rol y flag. Lo nuevo es que **desde el 2026-08-07 es alcanzable en producción**: el run sembrado está en `pending_approval`, los flags en `true`, y ese run se insertó directo en la base. Es el bloqueante del veredicto, y entró al plan como **C0**. |
| **[Major] El barrido de A2 podría matar un workflow lento** | **Verificado, y peor de lo que decía.** Codex lo dio por inferencia; al medirlo apareció que `failRun` **ya** es compare-and-set (`and status = 'running'`) pero **`finishRun` no tiene guarda ninguna** (`where id = $1` pelado). Así que el escenario se cumple exacto, y además **es un bug de hoy**: cualquier cosa que escriba `failed` mientras el workflow vive queda pisada al terminar. Un hallazgo sobre código futuro destapó uno del presente. |
| **[Major] `200 degradado` no es una señal operativa** | **Aceptado por juicio**, con la recomendación corregida. Codex proponía una readiness consumida por **alerta externa**: no hay alerta externa en este proyecto, y un endpoint que nadie consulta es el mismo defecto un piso más arriba. Lo que se acepta es que la sonda vaya por **`Tx` con el rol real** —`select 1` prueba TCP y credencial, no que el proceso pueda asumir `app_service`— y que cada **transición** sano→degradado se loguee una vez. El 200-en-vez-de-503 se mantiene y queda registrado como decisión. |
| **[Major] Las fuentes de verdad se contradicen** | **Verificado, y son siete sitios, no tres.** Codex citó el `09` (dos) y `current.md`; barriendo la misma clase de afirmación aparecieron siete, en tres archivos: el `09`, el `README` de esta carpeta (incluida la cifra de tests, `1181`, y la de migraciones, `14`) y `current.md`. Yo había descartado `current.md` porque sus bloques viejos van fechados con ✅ — vale para el cuerpo y **no** para "▶️ Lo próximo", que no lleva fecha y es justo lo que una sesión nueva lee. |
| **[Minor] La reparación de `transaccional` no está probada** | **Verificado.** El fixture de `seed-contrato.test.ts:178` cubre `comercial`, `navegacional`, `informacional` y una fila ya correcta; **ninguna `transaccional`**, aunque el comentario de arriba dice cubrir "las cinco combinaciones". Como el `case` de la `0017` no tiene `else`, quitar ese `when` deja el test verde. Es exactamente donde la revisión interna del día había pedido cubrir. |
| **[Minor] El bloque D omite dos deudas del mismo dataset** | **Verificado** contra `09:920` (las estimaciones de `lib/budget.ts`) y `09:924` (`max_pages = 25` frente a `serpValidateTop = 15`). Las dos entraron a D, con el aviso de que D **no** cierra el hueco de las cabezas no observadas. |
| **[Minor] A3 depende de un inventario que A4 reconoce incompleto** | **Verificado, y más fuerte.** Al `MAPA` de `env-sync.mts` no le faltan variables del orquestador: **falta el servicio entero** (están los otros cinco). Y hay una segunda razón que Codex no vio: el `MAPA` **nunca** podrá ser el inventario de producción, porque omite tres claves **a propósito** que en Railway sí están. A3 quedó detrás de A4 y con inventario propio. |

**La mutación refutada, porque la distinción importa.** Codex propuso cambiar
`if (prod.features.aprobarRun)` por `if (false)` en `environment.prod.test.ts:48` para demostrar que la
garantía de coherencia se evapora. Eso muta **el test**, no el código — y cualquier test desactivado
deja de garantizar lo suyo. La mutación válida es la de producción (`aprobarRun: true,
lanzarResearch: false` en `environment.prod.ts`), y ésa el test **sí** la caza. Lo que ningún test de
flags puede dar, y Codex acierta en decirlo, es que un run **concreto** tenga workflow: ese dato vive
en la fila, no en el environment.

**El hallazgo propio, que salió de contrastar el plan contra el `09` y no de la review:** el plan se
saltaba las **piezas 3 (Ideas) y 4 (Dashboard) del programa del portal** — dos planes escritos, la 4
dependiente de la 3, y la migración `0013` **reservada** para Ideas. Un plan que dice ser "lo que
queda" y omite eso miente por omisión. Es el bloque **J**.

> **Lo que esta ronda enseña sobre el método, y es nuevo:** el hallazgo más valioso no fue ninguno de
> los siete, sino **lo que apareció al ir a verificarlos**. Codex advirtió por inferencia sobre un
> mecanismo que todavía no existe (el barrido); comprobarlo obligó a leer las transiciones de estado
> reales, y ahí estaba `finishRun` sin guarda desde hace tiempo. **Verificar un hallazgo especulativo
> encontró un bug concreto que el hallazgo no mencionaba.** Es el argumento contra aplicar findings a
> ciegas, por el lado contrario al habitual: no por los falsos positivos, sino porque medir el terreno
> encuentra cosas que el revisor externo no podía ver.

### Tanda 22 — 16ª review: la carrera de un componente Angular reusado entre clientes, y una posición JSON-LD que no era global ✅

Ronda de código sobre la implementación ya cerrada y mergeada del sub-proyecto 1 (multi-vertical de
clientes, commits `b1ed4d3..1f477f7`, 79 archivos). Veredicto **NO LISTO**, **2 hallazgos** (1 Major,
1 Minor), **ambos verificados y corregidos** con un commit directo sobre `main` — la rama ya estaba
mergeada, no había nada que revertir. Reporte completo y clasificación en
`progress/informes/codex-multivertical-clientes-implementacion.md` (no versionado).

| Hallazgo | Cómo terminó |
|---|---|
| **[Major] El guard `idVigente` protegía la carga pero no la edición ni el guardado** | **Verificado** contra `cliente-seguros-card.ts:179-223`. `cargar()` solo reseteaba `cargando`/`error` al cambiar de cliente, dejando visible el formulario (y el `guardando`) del cliente anterior; `guardar()` nunca comparaba contra `idVigente` antes de aplicar el resultado del `PATCH`, así que una resolución tardía del cliente A podía pisar el perfil o el error ya mostrado del cliente B — Angular reutiliza la instancia del componente mientras el `@if` de vertical en `cliente-perfil.ts` sigue en `true`. Arreglado: `cargar()` resetea `editando`/`form`/`guardando` al cambiar de id, y `guardar()` captura `idVigente` al entrar y descarta tanto el éxito como el error si ya cambió mientras el `PATCH` estaba en vuelo. Dos tests nuevos con promesas controladas en `cliente-seguros-card.spec.ts`, verificados por mutación en dos pasos: quitar el reset de `cargar()` tumba los dos; con el reset restaurado, quitar solo el guard de `guardar()` tumba exactamente el del PATCH pendiente. |
| **[Minor] `ItemList.position` se reiniciaba en cada categoría** | **Verificado** contra `json-ld.ts:150-157` — el índice usado era el del `.map` interno de cada grupo, no uno global sobre `itemListElement`; con dos categorías de 2 y 1 pólizas daba `[1, 2, 1]` en vez de `[1, 2, 3]`. El único test existente (`html.test.ts`) usaba una sola categoría y no comprobaba `position`. Arreglado con un contador fuera del `flatMap`. Test nuevo con dos categorías que exige `[1, 2, 3]`, verificado por mutación (volver a `i + 1` del `.map` anidado lo tumba). |

Los otros ocho ángulos que pidió el prompt salieron limpios: inmutabilidad de `vertical` (trigger +
ausencia en `COLUMNAS_EDITABLES` + filtrado HTTP), la allowlist de seguros exacta en las cuatro
fronteras, la defensa en profundidad de `unPlato()`/`platoDesdeFormulario()`, los 4 call sites de
render de producción pasando `vertical`, RBAC/RLS de `GET`/`PATCH /clients/:id/seguros`, y los grants
de las migraciones `0029`/`0030`. Codex no pudo ejercitar el escenario de carrera manejando la app
(solo corrió los tests existentes, que no lo cubrían) ni aplicar mutaciones, por su política de solo
lectura — quedó en el reporte como "recomendación con mutación exacta", que es lo que se verificó acá.

Verificación tras el arreglo: **1780 tests del monorepo** (sube de 1779, +1 en `web-builder`),
typecheck limpio, **304 `node:test`** del portal (sin cambio) y **240 Karma** (sube de 238, +2) —
corrida con el directorio y el HEAD confirmados en el propio log (`PWD-CHECK`/`HEAD-CHECK`), mismo
blindaje que dejó la ronda anterior tras el bug de cwd documentado en `progress/current.md`.

### 🔑 Acción humana — ✅ cerrada

**#2 — Secretos:** la misma API key de OpenAI estaba duplicada en los dos `.env`. **Rotada el
2026-07-13**: dos keys distintas, una por servicio, cada una con límite de gasto. Ver
[acción 01](../historia/acciones/01-rotar-key-openai.md) y [Configuración](07-configuracion.md).

## Qué NO está cubierto por tests

Honestidad sobre los límites de la suite actual:

- **No hay tests de integración**: nada ejercita las llamadas reales a DataForSEO, OpenAI o Storyblok.
  *(El helper HTTP sí está testeado con `fetch` stubeado, pero no contra los servicios reales.)*
- **No hay tests del orquestador** (`run.ts` / `build.ts` end-to-end); se verifican corriendo los CLIs a mano.
- **El camino live de Storyblok no está automatizado.** Sí se ejecutó a mano contra un space real
  —14 páginas de La Birra Bar publicadas con `kr.v0.5`, y el renderizador leyéndolas por la CDA con
  `npm run demo -w renderer`— pero ningún test lo ejercita.
- **No hay tests de concurrencia real**: la idempotencia está implementada y el determinismo de los
  `_uid` sí está testeado, pero la carrera de creación (dos publicaciones simultáneas) solo se
  puede ejercitar contra un Storyblok real.
