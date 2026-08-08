# Bitácora de AMG OS

Lo que **ya pasó**, en orden inverso: lo más reciente arriba. Cada entrada quedó escrita el día que
ocurrió y **no se reescribe después** — si algo resultó estar mal, se dice en una entrada nueva, no
se corrige la vieja. Una bitácora que se edita hacia atrás deja de servir para entender por qué se
decidió lo que se decidió.

Esto **no** es el estado del proyecto. Dónde estamos hoy y qué falta:
[`docs/proyecto/09-estado-y-roadmap.md`](../docs/proyecto/09-estado-y-roadmap.md). Lo que se está
haciendo ahora mismo: [`current.md`](current.md).

---

## 2026-08-08 (noche) — bloque E, entrega 1: el dato llega hasta la base y nadie lo dibuja todavía

Empieza el bloque **E**, el aspecto de las webs, y la primera entrega es deliberadamente la que **no
se ve**: ampliar las **tres primeras** de las cuatro fronteras que cruza un campo del perfil —Zod,
la allowlist de Postgres, `perfilValido`— y dejar el render intacto. La spec lo argumenta y tenía
razón: si el rediseño y el refactor entran juntos, un cambio inesperado no se puede atribuir a
ninguno de los dos.

**Lo primero fue una trampa que resultó no serlo.** El plan avisaba de un riesgo de orden: la `0014`
estaba reservada desde hacía días, así que en una base nueva corre **antes** de la `0015`-`0019`
(orden alfabético) y en producción **después** (`migrarConRegistro` saltea las registradas). Al ir a
verificarlo apareció que no era un descuido sino un proceso funcionando: la reserva era explícita y
**cada una de las cinco migraciones posteriores declara en su cabecera** que no depende de la `0014`.
Lo que faltaba era lo de siempre — esa independencia vivía en un comentario. Ahora un test aplica
todas las migraciones sobre **dos PGlite en los dos órdenes** y compara funciones, grant, columnas
generadas y la proyección de la allowlist.

**Lo que el navegador encontró y los 1001 tests no.** El único modo de ver el sitio sin credenciales
—el `dev-server`— tenía en su mock `body: "<p>Producto de temporada.</p>"`, y el render hace
`esc(s.body)` porque la prosa del LLM se pide en frases, no en HTML. O sea que la demo local llevaba
quién sabe cuánto imprimiendo etiquetas crudas en pantalla. Lo grave no es el defecto: es que
**invita a "arreglar" el escape**, que es exactamente la puerta de la inyección que ese `esc` cierra.

**Y un test que atrapó una regresión que yo estaba metiendo.** Al pasar el seed de demo al manual de
marca nuevo, saqué el legacy `{color, font}` — razonable, salvo que hasta la entrega 2 el CSS **solo
sabe leer la forma vieja**. La web de La Birra Bar se habría quedado con el rojo por defecto sin que
nada avisara. Las dos formas conviven a propósito hasta que la emisión aprenda a leer el manual.

De ahí salió el segundo hallazgo, del mismo tipo: **el ancla anti-deriva entre el seed y
`business-profile.json` comparaba tres claves a mano**, así que se quedó verde con el seed sin
ninguno de los cuatro campos nuevos. Un ancla que hay que acordarse de ampliar se queda corta justo
cuando hace falta; ahora recorre las claves del JSON publicado y crece sola.

**Siete mutaciones**, todas con `grep` de control, y dos que no estaban pedidas resultaron las más
elocuentes: quitar el `grant select (business_profile_publico)` tumba **23 tests** —literalmente
"caen las webs de todos los clientes a la vez", que es como la spec describe ese riesgo— y cambiar
`set` por `set local` deja el `lock_timeout` en cero con todo lo demás en verde.

**Y el test que más ata tampoco estaba pedido.** Las tres fronteras tenían tests cada una, y las tres
podían estar en verde con el campo sin llegar: lo que rompe el recorrido no es que una capa falle,
sino que **las tres listas no digan lo mismo**. Ahora hay un test que recorre el camino entero —JSON →
Zod → `business_profile` → la columna generada → `perfilValido`— y exige que el perfil salga completo,
comparando con `deepEqual` y no campo por campo, porque enumerar deja fuera justo el que alguien
olvide. Quitar `menu_categorias` de una sola de las tres capas lo tumba nombrando la clave.

**1001 tests** (venía de 956). El trabajo de la `0014` lo hizo el agente `datos`; el informe está en
`progress/informes/`, y una de sus mutaciones se reprodujo a mano antes de creerla.

**La revisión devolvió tres bloqueantes, y los tres eran de documentación de estado.** El más caro:
el `09` iba a afirmar que no quedaban migraciones pendientes justo cuando la `0014` sí lo estaba, y
esa migración es lo que decide si el renderizador desplegado puede ver una foto. El código salió
limpio; lo que estaba mal era lo que el repo decía de sí mismo. También cayó un hallazgo que me hizo
cambiar de opinión: yo había puesto importes concretos (`14,00 €`, `18,50 €`) para platos de **La
Birra Bar, que existe**, en el archivo que `reseed:demo` siembra en Supabase y que el renderizador
publica. Es la misma línea que el `postalCode` opcional —*antes ausente que inventado*—, con la
diferencia de que un código postal inventado ensucia el JSON-LD y un precio inventado hace que alguien
vaya al restaurante esperando pagarlo. Fuera; los campos de carta se ejercitan con los negocios
ficticios.

**Y esa misma noche Juan aplicó la `0014` en producción.** Dos cosas que ningún test en PGlite podía
contestar. La primera: **aplicó entre la `0012` y la `0015`, no al final** — `migrarConRegistro`
recorre el directorio ordenado y saltea las registradas, así que el escenario que motivó el test de
los dos órdenes no llegó a darse. El test no sobra por eso: lo que garantizaba es que **daba igual
cuál de los dos ocurriera**, y eso solo se sabe habiéndolo probado antes. La segunda: **el `grant`
sobrevivió al `drop column`**, verificado donde importa y no en PGlite — la web de La Birra Bar sigue
sirviendo su NAP, y ese dato solo puede salir de `business_profile_publico`.

---

## 2026-08-08 (tarde) — el paso que apareció al mirar el `/_health` que acabábamos de arreglar

Juan puso `WEB_PUBLISH_MODE=storyblok` y `STORYBLOK_DRY_RUN=1` en el orquestador y redesplegó. El
`/_health` volvió verde —`funciones: 2`, sin `degradado`— y ahí estaba el agujero: **no decía nada
del publisher**. Habíamos pasado el día metiéndole verdad a ese endpoint y el bloque C empezaba con
"comprobar el modo" sin nada con qué comprobarlo.

Lo que lo vuelve algo más que un campo que falta es que **el modo no sale de una variable sino de
tres** (`WEB_PUBLISH_MODE`, `STORYBLOK_DRY_RUN`, el token). Leer el panel de Railway entero no
contesta la pregunta. El argumento ya estaba escrito en `app.ts` para `PIPELINE_MODO` —*"una
declaración que solo vive en el panel de variables no se puede auditar mirando el servicio"*— sin
aplicar justo al caso del que dependía todo el bloque siguiente.

**El arreglo no es el campo: es que haya una sola decisión.** `getPublisher` decidía en línea, así que
`/_health` habría tenido que decidir otra vez. Dos derivaciones del mismo hecho es el fallo de la
clave de firma de Inngest otra vez (lo validado y lo usado eran dos lecturas del mismo nombre), y esa
ya la pagamos. Ahora hay una `decisionDelServicio()` y las dos cuelgan de ella.

**Dos cosas que solo aparecieron al escribir los tests:**

- **El modo es del proceso, no de la corrida.** Un cliente sin `storyblok_space_id` publica en dry-run
  aunque el servicio esté armado para publicar de verdad. `/_health` no tiene cliente, así que lo que
  puede afirmar es el **techo** — y eso hay que decirlo, porque un `dry-run` reportado por el cliente
  de turno sería la mentira tranquilizadora: el próximo cliente sí escribe. Quedó fijado en un test,
  no en un comentario.
- **Un typo en `WEB_PUBLISH_MODE` es `mock` en silencio**, con token y space puestos, y `mock` reporta
  `published: true`. O sea: la base anota como publicadas páginas que nunca salieron del contenedor.
  El test del estado mock usa el typo en vez de la ausencia por eso — mismo camino, y es el que nadie
  sospecha.

La mutación que pedía el plan cae limpio: reimplementar `modoPublicacion()` leyendo `process.env`
deja rojo **un** test —el del estado `storyblok` sin token, donde el entorno dice `live` y la verdad
es `dry-run`— y verde todo lo demás. Que caiga *solo* ése es la prueba de que el test apunta a la
divergencia y no a otra cosa.

**Y desplegado, lo primero que dijo fue `mock`.** No era la respuesta esperada —Juan había puesto las
dos variables y redesplegado— y era la respuesta correcta: no estaban tomando. Un campo escrito para
comprobar algo encontró que ese algo no se cumplía, en su primera lectura. Corregido en el panel,
ahora dice `dry-run`.

**Y en cuanto se fue a usar apareció el mismo agujero en el eje que gasta.** Antes de aprobar el run
fui a ver qué cuesta de verdad el paso de publicación, y ahí estaba: llama a `applyProse`, y
`getProseGen()` devuelve el generador real si hay `OPENAI_API_KEY` — con `PROSE_MODE` **sin
declarar**, porque ése es el default. `PIPELINE_MODO` no lo gobierna; su propio `config.ts` lo dice
con todas las letras (*"no enciende ni apaga nada"*). O sea que `pipeline: "mock"` en `/_health`
significa "DataForSEO no cobra" —el 81% del costo, y por eso es tan fácil leerlo como "es gratis"— y
el 19% restante no aparecía por ningún lado.

Lo interesante no es el campo `prosa` que se agregó: es **cómo apareció**. No lo encontró un test ni
una review, lo encontró preguntarse *"¿esto gasta?"* antes de apretar el botón, que es la única
pregunta que este proyecto se hace sistemáticamente. Y la respuesta era "no se puede saber desde
afuera" — la misma respuesta que había motivado C-0 dos horas antes, sobre otra variable.

**Y con los tres modos legibles, el circuito corrió entero por primera vez.** Research lanzado desde
el portal, 25 páginas en menos de un minuto y $0.00; una página aprobada, el run aprobado, cero
errores en consola. De paso, dos controles positivos que ningún test de una sola dirección daba: C0
eligió el motivo de las **páginas** en un run que sí tiene workflow —en el sembrado elige el del
workflow—, y el entregable salió sin coste ni metadatos mientras el informe llevaba las dos cosas.

**Lo que no se pudo cerrar es lo que el bloque venía a probar.** Aprobar el run se ve *idéntico* si
el workflow despertó y publicó en dry-run que si no despertó nunca: en dry-run el publisher reporta
`published: false` —que es lo correcto, la base no puede afirmar lo que el proveedor no confirma— así
que no se escribe nada, y el único rastro es un `log()` dentro del contenedor. Queda descartado
`failed`, eso sí: si hubiera despertado y hubiera reventado en `parseBrief` —el camino que este
bloque estrenaba— `onFailure` lo habría marcado. **O funcionó, o no corrió.**

Dicho de otro modo: **el modo que existe para ensayar es el único en el que el ensayo no se puede
observar**, y la verificación acaba dependiendo del panel de un tercero. Eso es C-1, y no se
improvisó: el arreglo correcto es que el intento de publicación deje una marca nuestra —cuándo, cuántas
mandadas, cuántas confirmadas— **sin afirmar que se publicó**, que es justo la distinción que el
código ya defiende bien y que sería fácil arruinar con las prisas.

**Juan lo miró y el run figuraba `Completed`** — que es más de lo que hacía falta: no despertó, sino
que *terminó*, o sea que `parseBrief` sobre el brief reconstruido desde la base funcionó en
producción. Bloque C cerrado.

**Y de paso apareció un segundo run, del día anterior a las 20:35, todavía vivo.** Escribí que era un
workflow *sin fila en la base* y me equivoqué. El razonamiento era: "si duerme en la compuerta, tuvo
que hacer el research antes, luego tendría que existir una fila de esa hora". Falso: si el workflow
arranca con el run **fuera de `running`** se salta el research y va directo a dormir siete días. O
sea que el candidato obvio era el run sembrado, que llevaba en `pending_approval` desde las 18:18 —y
que yo mismo había estado mirando toda la mañana—. El error no fue de datos sino de forma: **inferí
una ausencia** ("no hay fila") a partir de un modelo del flujo que no había releído, en vez de leer
el flujo.

Lo que sale de ahí sí es real, y es incómodo de la manera correcta: `solicitud_emitida_at` la escribe
**solo** la API. Un evento emitido a mano —lo primero que uno hace para comprobar un orquestador
recién desplegado— deja el run **con** workflow esperando y **sin** marca, y entonces el portal apaga
el botón diciendo *"no hay nada esperando su aprobación"*. Justo lo contrario de lo que pasaba.
Falla del lado seguro (bloquea de más), así que la decisión de C0 se mantiene; lo que sobra es la
frase, que afirma sobre Inngest algo que nosotros no podemos comprobar. Y quedó en evidencia que
**el barrido no cancela el workflow**: marca la fila y ya, con las dos verdades conviviendo sin que
nada avise.

La moraleja repetida, tercera vez en dos días: **una afirmación sobre el estado de un sistema externo
que no se miró es una suposición con tono de hecho.** Ya había pasado con `dry-run` como si fuera un
valor de `WEB_PUBLISH_MODE`, y con "las variables ya tomaron".

## 2026-08-08 — los bloques A, B y C0, y un despliegue que hay que hacer en orden

Seis piezas del plan cerradas seguidas, todas salidas de la 15ª review. Lo que vale guardar no es la
lista sino **tres cosas que solo aparecieron al hacerlas**.

**1. Verificar un hallazgo especulativo encontró un bug concreto.** Codex advirtió por inferencia que
el barrido futuro podría pisar el estado de un workflow lento. Al ir a comprobarlo apareció que
`failRun` ya era compare-and-set desde hace tiempo pero **`finishRun` no**: `where id = $1` pelado.
No mordía porque nada más escribía ese estado mientras el workflow vive — y el barrido iba a ser
exactamente eso. El hallazgo era sobre código que todavía no existía; el bug estaba en el que sí.

**2. El diseño correcto del barrido dependía de un hecho del motor que los tests no pueden ver.** Una
`security definer` cuyo dueño fuera el rol que corre las migraciones **funciona en PGlite y devuelve
cero filas en producción, en silencio**: `kr_runs` lleva `force row level security`, que alcanza al
dueño de la tabla, y en PGlite `postgres` es superusuario mientras que en Supabase alojado no lo es.
Este repo ya lo había pagado una vez (`force` + cero políticas sobre `app.migraciones_aplicadas`
auto-bloqueó al runner, 10ª review). La salida fue un rol propio, `app_barrido`, sin login y con el
permiso cross-tenant como **política auditable** en vez de un privilegio implícito. Es la primera
`security definer` del proyecto y quedó anotada en ADR-17.

**3. Los tests del orquestador se pusieron rojos con C0, y no era un fixture a parchear.** Su helper
declaraba *"crea el run como lo hará la API"* y había dejado de hacerlo el minuto en que la API
empezó a marcar la emisión. Se arregló haciendo cierto el docstring, no relajando el assert. Apareció
porque corrí los siete paquetes: el agente había corrido dos, y eso fue culpa de **mi** instrucción,
que decía `npm test -w db -w api`.

**Dos errores de método míos, los dos del mismo tipo — afirmar sin medir.** Dije que quitarle el
timeout a la sonda de salud *colgaba* el test: no lo había visto, lo había inferido, y mis dos
comprobaciones habían fallado porque **`timeout` no existe en macOS** y el `grep` posterior no
encontraba nada. Medido después con un job en segundo plano: sí cuelga, seguía vivo a los 12 s, y por
eso el test lleva su propio `{ timeout }`. Y en otra mutación di 60 tests verdes por buenos cuando el
`sed` no había sustituido nada — de ahí que ahora cada mutación se confirme con un `grep` antes de
creerse el rojo **o** el verde.

**El plan mismo tenía una cifra inventada.** Decía que `renderReport` tenía "6 sitios de llamada (3 de
producción, 3 de test)". Son **4 de producción** —el CLI de `kr-service` y el seed de `db` no
figuraban en ninguna parte— y ~24 en tests. Lo destapó migrarlos.

**Y queda una casilla operativa que no es opcional:** la `0019` agrega `tiene_workflow` a
`RUN_SUMMARY_COLS`, que usan las tres lecturas de run. Sin la columna aplicada, **el portal entero
falla**, y Railway autodespliega la API en cada push a `main`. Por eso ese commit quedó **sin
pushear** hasta que las migraciones estén en producción. Es la primera vez en el proyecto que el
orden entre migrar y desplegar es una precondición dura y no una recomendación.

## 2026-08-07 (15ª review externa) — el plan que mentía por omisión, y una guarda que faltaba desde antes

Codex revisó los ocho commits del día **y** el plan de la plataforma recién escrito. Veredicto: **NO
LISTO**, por un botón que en producción puede devolver 200 sin publicar nada. Siete hallazgos, todos
procesados: cinco verificados, uno aceptado por juicio, y **una mutación refutada**.

**Lo que más valió no fue un hallazgo, sino lo que apareció al medirlo.** Codex advirtió por
inferencia que el barrido de runs colgados podría matar un workflow lento y que el workflow, al
terminar, pisaría el `failed`. Al ir a comprobarlo apareció que la mitad **ya existe**: `failRun` es
compare-and-set desde hace tiempo (`and status = 'running'`), pero **`finishRun` no tiene ninguna
guarda** — `where id = $1` pelado. Hoy no muerde porque nada más escribe ese estado; el barrido
habría sido justo eso. Un hallazgo sobre código futuro destapó un bug del código presente.

**La mutación refutada, porque la distinción importa.** Codex propuso cambiar
`if (prod.features.aprobarRun)` por `if (false)` en `environment.prod.test.ts` para demostrar que la
garantía de coherencia se evapora. Eso muta **el test**, no el código: cualquier test desactivado deja
de garantizar lo suyo. La mutación válida es la de producción —`aprobarRun: true, lanzarResearch:
false` en `environment.prod.ts`— y ésa el test **sí** la caza. Lo que el test no puede dar, y Codex
acierta en su última frase, es que un run **concreto** tenga workflow: ese dato no vive en el
environment.

**Y lo que la review no vio, que salió de contrastar el plan contra el `09`:** el plan se saltaba las
**piezas 3 y 4 del programa del portal** —dos planes escritos, con la migración `0013` reservada para
Ideas—. Un plan que dice ser "lo que queda" y omite eso miente por omisión, que es exactamente lo que
el ritual de `AGENTS.md` nombra en su paso 3. Es el bloque **J**.

**La contradicción documental resultó ser el doble.** Codex citó tres sitios que seguían diciendo que
falta desplegar el orquestador; barriendo la misma clase de afirmación aparecieron **siete**, en tres
archivos: el `09` (tres), el `README` de `docs/proyecto/` (tres, incluida la cifra de tests y la de
migraciones) y `current.md` (su sección "Lo próximo", la única sin fecha). Descarté `current.md` en la
primera lectura con el argumento de que sus bloques viejos van fechados y con ✅ — vale para el
cuerpo y no para "Lo próximo", que es justo lo que una sesión nueva lee como estado vivo.

**De paso, `current.md` estaba entero duplicado** en las seis entradas del día de esta bitácora, así
que en vez de parchear la sección se reseteó al template. Antes hubo que rescatar lo que solo vivía
ahí: dos deudas de KR-2a (`endpoints_degradados` incompleto y el vocabulario propio de `web-builder`)
pasaron al bloque I del plan, y **el generador de credenciales no tenía entrada en esta bitácora** —
la de abajo.

## 2026-08-07 (herramientas) — `npm run credencial`, y por qué un generador ingenuo es peor que ninguno

Salió de necesitar el DSN del orquestador y descubrir que **no existía en ningún lado**: el `MAPA` de
`env-sync.mts` no tiene entrada para `orchestrator` —los cinco paquetes que sí la tienen son `api`,
`db`, `kr-service`, `renderer` y `web-builder`—. Nunca se le repartió nada porque nunca se desplegó.

Un script con argumento, no un `create-credential:<nombre>` por credencial: una lista de scripts npm
envejece sin que nada avise. Acá el catálogo vive en un sitio y **un test lo ata al `MAPA`** — agregar
una clave al reparto sin clasificarla rompe la suite.

**Lo que de verdad justifica el catálogo es la familia `tercero`.** Ante `OPENAI_API_KEY` un generador
ingenuo devolvería 32 caracteres al azar: algo que **parece** una key, entra en `credenciales.env` sin
chistar y falla mucho más tarde con un 401 que nadie relaciona con haberla "generado". El script se
niega y dice dónde sacarla. **Producir algo plausible y equivocado es peor que no producir nada.**

Escribe en la fuente (pedido de Juan), y por eso: escritura **atómica** (temporal + `rename`, porque
ese archivo no está en git y un write truncado no se recupera de ningún lado), **confirmación
escrita** al reemplazar, y `.bak-<timestamp>` al lado. Lo generado es **URL-safe** (`base64url`, 192
bits): estas cadenas viven dentro de un DSN y una `@` sin escapar no da error — **conecta a otro
sitio**.

**11 tests, con las dos mutaciones que importan medidas:** `base64url` → `base64` tumba 2 (los dos de
alfabeto seguro), y quitar el `=` del ancla del upsert tumba exactamente 1 (el que impide que
`DATABASE_URL` pise a `DATABASE_URL_API`).

## 2026-08-07 (madrugada) — el circuito entero corrió en producción, y hora y media de fallos que no fueron del código

Un research lanzado desde el portal recorrió `POST /runs` → Inngest → orquestador → `kr-service` →
Postgres → informe → `pending_approval`: **124 keywords, 25 páginas, 1 informe, $0.00**, en menos de
diez segundos. Es lo último que no se había probado nunca — hasta hoy, todo lo que había en Supabase
estaba sembrado a mano, y el step `guardar-informe` de KR-2b tenía **22 tests sin haber salido jamás
de PGlite**.

**Entre el despliegue y eso hubo hora y media de fallos, y ninguno fue del código.** Los tres
servicios se rompieron por edición manual de variables en el panel de Railway: el orquestador arrancó
con `@base:` de host (`getaddrinfo ENOTFOUND base`), al corregirlo se borraron las dos variables
enteras, y al renderizador le desaparecieron las suyas porque se editó el servicio equivocado. Eso
último tardó en verse porque **la web siguió sirviendo 200**: Railway mantiene el contenedor viejo
mientras el nuevo falla, así que "responde" y "está desplegado" dejaron de ser lo mismo.

**El dato del día, y no es agradable: cuatro hipótesis mías, las cuatro refutadas por la medición
siguiente.** Que faltaba el `alter role` —los dos DSN conectaban—. Que las claves eran de entornos
distintos —el evento estaba en production—. Que Inngest no llegaba —la función corrió y falló—. Que
el login no podía asumir su rol —`set local role app_service` funcionaba—. Lo cerró **el mensaje de
error** cuando por fin lo pedí, no el razonamiento; y cada hipótesis costó una vuelta entera.

**Lo que sí se ganó razonando** fue predecir, antes de tener el error, que el `onFailure` moriría con
el workflow: su única acción es `failRun()`, o sea escribir en la base, y el fallo era la base. La red
de seguridad que existe para que un run no se quede en `running` **comparte su punto de fallo con lo
que protege**. El stack del error lo confirmó línea por línea (`functions.ts:81`).

**Y dos veces en el mismo día, `/_health` dijo `{"ok":true}` sobre un servicio inservible**: por la
mañana con el 401 de la firma, por la noche con la base inalcanzable. Está escrito así a propósito
—que no dependa de terceros— pero para el orquestador la base no es un tercero: es todo lo que hace.

**El mock zanjó una decisión de producto que llevaba abierta desde la tarde.** Para un prompt de
hamburguesería gourmet argentina devolvió *pizzería madrid recomendado*, *mejor menú del día madrid
barato*, *pasta fresca madrid menú*. No son datos falsos plausibles: son de **otro negocio**. En mock
el circuito se prueba y no se enseña, así que la demo con Frank o corre un research `live` (~$0.31,
~16 min) o llega solo hasta la aprobación de páginas.

De paso, una herramienta nació coja: `probar-dsn`, escrito esa misma tarde, verifica el DSN de
`credenciales.env` — **la fuente**, no lo que tiene el proceso desplegado. Dio verde mientras Railway
tenía basura. No está mal, pero su nombre promete más de lo que mide.

---

## 2026-08-07 (noche cerrada) — el orquestador desplegado: Fase 2 entera en producción, y un botón que no hace nada

La quinta pieza del día y la que cierra Fase 2. El orquestador —la única de las cuatro que nunca
había corrido fuera de una máquina de desarrollo— está en Railway, y su app **sincronizada con
Inngest**.

**La verificación que valió por todas.** `{"message":"Successfully registered","modified":true}` no es
un OK cualquiera: para registrarse, el SDK **tuvo que autenticarse contra la API de Inngest** con
`INNGEST_SIGNING_KEY`. Esa era la incógnita que quedaba de la mañana, cuando el tramo A encontró que
la clave se validaba, se trimeaba y **nunca llegaba a `serve()`** — 401 en toda invocación, con el
health check diciendo `{"ok":true}`. Y hasta el sync no se podía saber: un `GET /api/inngest` sin
firmar devuelve **401**, y ese 401 **no distingue** "te rechaza a vos, que no sos Inngest" de "va a
rechazar también a Inngest". Medir lo que no separa los dos casos da un resultado limpio y falso; es
el mismo error que casi se comete por la mañana midiendo la clave saliente en vez de la entrante.

**Lo que el camino costó, y no estaba en el runbook.** Tres cosas, y las tres eran documentación que
afirmaba sin haberse ejecutado:

1. **`psql` no está instalado en la máquina de desarrollo.** El runbook mandaba comprobar cada DSN con
   `psql -c 'select current_user'` antes de desplegar, y llamaba a ese paso *el tropiezo número uno del
   despliegue del renderizador*. O sea: el paso que existía para evitar el error más común **no se
   podía ejecutar**. Se reemplazó por `npm run probar-dsn`, que usa `pg` —ya dependencia de `db`— y
   además **comprueba** el rol en vez de imprimirlo, porque el fallo real no es no conectar: es
   conectar con el rol equivocado, que conecta perfectamente y se lee como éxito.
2. **El runbook decía "no hace falta custom domain"**, que se lee como "no hace falta dominio". El
   servicio quedó sin URL pública y el `curl` de verificación apuntaba a un host inexistente. Son dos
   cosas distintas: no hace falta un dominio **propio**, pero **público sí**, porque Inngest le pega
   desde internet.
3. **`amg-orchestrator.railway.internal` no resuelve desde fuera** (medido: `NXDOMAIN`). Es la red
   privada de Railway. Un servicio que solo tiene ese nombre está vivo y sordo.

**Y el hallazgo que importa para la demo.** Encender `aprobarRun` —apagado toda la Fase 1 con el
motivo escrito de "no hay orquestador detrás"— **no hace que el run sembrado publique**. La compuerta
es un `paso.esperarEvento` **dentro** del workflow, y el orquestador registra **una sola función**,
disparada por `research/solicitado`: no hay listener suelto de `research/aprobado`. El run de
`sembrarDemo` se insertó directo en la base, así que jamás tuvo un workflow durmiendo. Aprobarlo emite
un evento que no espera nadie: la API responde bien y no se publica nada.

Un botón que parece funcionar y no hace nada es peor que no tenerlo, y delante de un cliente es peor
todavía. Quedó escrito en los dos sitios donde alguien lo leería (`environment.prod.ts` y
`features.ts`) y atado por un test: con `aprobarRun` encendido y `lanzarResearch` apagado, **cae**,
porque esa combinación deja el seed como única fuente de runs. La decisión de producto que abre —qué
se le enseña a Frank, si un research en `mock` con keywords inventadas o uno `live` de $0.31 y 16
minutos— **no la toma un agente**, y está anotada sin resolver.

Nota de método, tercera vez en el día: filtré con `head -60` la salida de la verificación contra
producción y me perdí justo las dos consultas que había ido a mirar. La lección lleva escrita desde la
mañana y aun así.

---

## 2026-08-07 (cierre) — el seed escribía cuatro campos fuera del contrato, y la base no tenía cómo avisar

La cuarta pieza del día, y la única que empezó **midiendo antes de opinar**. El estado listaba "el seed
de la demo escribe `kr_pages` con la forma equivocada" como tercer candidato, con dos campos y un
`ruta:línea`. Antes de recomendar un orden fui a comprobarlo, y la nota estaba mal **en las dos
direcciones**.

**Peor:** eran cuatro campos, no dos. Además de los dos `jsonb`, el insert escribía `page_strategy` e
`intencion` **en crudo** —`hub`, `comercial`— mientras el mismo archivo, 130 líneas más arriba, ya los
traducía en `aPaginaPropuesta()` con dos mapas escritos a propósito. Dos verdades del mismo dato, en el
mismo archivo, y ganaba la equivocada. Y la prueba no salió de leer: salió de sembrar la demo en PGlite,
reconstruir el brief igual que `briefDesdeLaBase` y pasarlo por `parseBrief`, que es el validador que
corre de verdad en el M1. **Lanza.** El síntoma no vivía en `db` ni en `api` — vivía en producción, con
el research ya pagado.

**Más chico:** no podía explotar en la demo. La compuerta humana es un `waitForEvent` de Inngest, y el
run sembrado se insertó **directo en la base**: no hay ningún workflow durmiendo sobre él, así que
aprobarlo no publica nada. Esa comprobación tumbó mi propia hipótesis quince minutos después de
formularla. Y la nota decía que esos campos los leía "la pantalla del brief": también falso — el portal
tipa `intencion: string` y no lee `meta_title` ni `h1`. Donde sí se ven es en el entregable que se había
cerrado seis horas antes, y lo que impide que reviente es la normalización que se escribió ahí **sin
saber que este bug existía**. Una mitigación que ya era portante para un defecto que nadie había
nombrado.

**La decisión que ordena la pieza: el síntoma es el seed, la enfermedad es que nada lo impedía.**
`tipo`, `intencion`, `page_strategy` y `evidencia` eran `text` pelado desde la `0001`, y el store las lee
casteando a los tipos del contrato — un cast que `tsc` no puede desmentir porque el dato viene del
driver. Arreglar el insert cierra el caso conocido; el `check` cierra la clase. Por eso la `0017` repara
las filas viejas **y después** les pone cuatro `check`, y por eso el `case` de reparación va **sin
`else`**: si quedara un valor que el mapeo no cubre, la migración se revierte entera y el despliegue se
detiene con el nombre de la constraint. Inventarle una traducción taparía el hallazgo justo cuando el
sistema por fin lo puede ver.

**El precio de la pieza es una copia**, y conviene decirlo: el vocabulario pasa a vivir en el `.sql` y en
`contrato/`, porque un `.sql` no puede importar un enum de TypeScript. Lo ata un test que extrae los
literales del `.sql` y los compara contra `emisionM2` introspeccionado en runtime — sin exportar los
enums, que `contrato/src/index.ts` prohíbe en una línea explícita. **Y el control positivo de ese test no
es ceremonia:** la primera versión ancló el regex mal, matcheó el `where` del `update` de reparación y
comparó el vocabulario **viejo** contra el del contrato. Un test que mira el sitio equivocado se ve igual
de verde que uno que mira el correcto.

**Tres correcciones a lo que yo había afirmado, y ninguna la encontré yo.**

1. Escribí que el `content_brief` equivocado "falla en silencio". Falso: `parseBrief` lo rechaza igual.
   Lo que pasa es que `formatIssues` recorta el mensaje a **cinco issues**, y los cuatro de
   `content_brief` se caían del texto — no de la validación. Medí el mensaje creyendo que medía la
   validación, que es la versión de bolsillo del error que este proyecto persigue hace tres días.
2. La revisión midió que el mapeo cubría lo que el seed escribe **hoy**, no todo lo que pudo escribir:
   hasta `f0c1387` producía `transaccional`. Hoy no queda ninguna fila así, pero el `update` corre contra
   una base que persiste desde julio, y comprobar que no queda ninguna cuesta más que traducirla.
3. La misma revisión señaló que `cartera-portal.test.ts` —el test que existe para que el dashboard y el
   brief no diverjan en silencio— **dejó de cubrir `intencion`**, porque compara el mock contra
   `PAGINAS_DEMO` y no contra la fila, y hasta hoy los dos decían lo mismo. Su docstring seguía
   prometiendo la garantía entera. Es exactamente el modo de fallo que `AGENTS.md` nombra, aparecido
   dentro de la pieza que vino a cerrarlo.

Y un error de método mío que no costó nada porque el siguiente comando lo destapó: tres `grep` volvieron
vacíos y casi concluyo que ningún código de producción valida los briefs leídos de la base. Estaban
vacíos porque un `cd portal` anterior me había dejado el shell en otro directorio. Un `grep` vacío se lee
igual que una ausencia real.

---

## 2026-08-07 (noche) — el entregable del restaurante: la frontera del coste, cerrada por los dos lados a la vez

El `09` las listaba como dos deudas separadas —*el entregable del restaurante no existe* y *🔴 el margen es
legible por el rol `cliente`*— y son **la misma pregunta desde dos lados**: qué ve alguien que no es la
agencia. Hacerlas por separado tenía un riesgo concreto y conocido: que la pantalla dejara de pintar el
coste mientras la API lo siguiera devolviendo. Eso no es una frontera, es un adorno.

**La decisión que ordena todo lo demás: el coste no se oculta, no se genera.** `renderReport(brief,
{ incluirCoste })` lleva el parámetro **obligatorio y sin default**, porque las dos respuestas son
correctas para documentos distintos —el informe interno lleva el margen, que ante Frank es el argumento
de venta; el entregable no— y ninguna es "la normal". Un default `true` haría que quien lo olvide filtre;
uno `false`, que el informe interno pierda su argumento en silencio. Es la misma forma que `PIPELINE_MODO`
del tramo A, doce horas antes: cuando la opción segura y la útil son distintas, no hay default correcto.

Y del lado de la base, el margen lo recorta **Postgres**: `case when app.es_staff() then
coste_micros_usd::int end`, **sin `else`**, dentro de la única definición de columnas que comparten
`getRun`, `listRuns` y `listAllRuns`. Los tres casos medidos caen del mismo lado, y el tercero es el que
se olvida: un usuario **sin membresía** no da `false`, da **`NULL`** —`app.current_role()` es NULL y
`NULL in (…)` es NULL—. Medido en los dos majors (16.4 en `db/`, 18.3 en `api/`), porque uno no se
extrapola del otro. Ningún `if` de rol en TypeScript: el único `if` del handler es `if (!datos) return
404`, y eso es el resultado de lo que Postgres decidió.

**Lo que encontró el navegador, y ningún test podía ver.** El PDF sale del navegador (Ctrl+P sobre una
vista con `@media print`) — decisión del dueño del proyecto, para no meter la primera dependencia de PDF
del repo contra el invariante de `tsx` sin build. Eso significa que **el CSS de pantalla llega al papel**:
medido en Chrome 151, el navegador no imprime fondos, así que la hoja salía blanca con el texto del tema
oscuro en `#f3f4f6` — **1.10:1**, cuando AA pide 4.5:1. La hoja era ilegible y nadie lo había pedido. El
arreglo es un `@media print` que redefine los 17 tokens, atado por el test de contraste como un **tercer
tema**. Cuando el entregable *es* la hoja impresa, la hoja impresa es la pieza.

**Dos documentos de la agencia contradiciéndose.** Generando el entregable real contra el seed y
leyéndolo: decía *"0 keywords analizadas"* donde el informe interno del mismo run dice **55**. Hay dos
fuentes del número —una declarada en `calidad_datos`, otra contada sobre `kr_keywords`— y ninguna cubre
todos los runs. No lo veía ningún test: hay que generar el documento y leerlo.

**Y un comentario que envejeció hasta decir lo contrario.** En la pantalla del informe había un párrafo
que razonaba sobre esta misma frontera: *"la pantalla del brief le muestra el coste TOTAL a cualquier rol
que vea el run (…) si el total debería o no ser visible es otra pieza, y no ésta"*. Era cierto cuando se
escribió. **Esa "otra pieza" es ésta**, y lo dejó falso — quien lo leyera después concluiría que al
`cliente` ya le llega el total y que no hace falta cuidarlo. Lo cazó la revisión interna, no el
implementador que tenía el archivo abierto.

Tres errores míos en la jornada, y los tres del mismo tipo: **filtré el output de un comando y llamé
verde a lo que no había mirado**. `npm run typecheck | tail -6` me mostró la cola limpia mientras arriba
había tres errores de los callers de `renderReport` que yo no había actualizado. Y al reescribir aquel
comentario puse los identificadores SQL entre backticks dentro de un template literal de Angular: 10
errores de compilación, cazados por el diagnóstico del IDE apuntando a una línea que yo no había tocado.
Descartarlo por no cuadrar con mi modelo habría commiteado un portal roto.

**Lo que no podía hacer un agente, y lo cerró Juan el mismo día: el PDF se descarga sin problemas.**
Quedaba pendiente porque el MCP no expone `Emulation.setEmulatedMedia` — se había compensado forzando
las reglas de impresión a pantalla y midiendo las propiedades `break-*` computadas una por una, pero el
documento impreso de verdad no lo había visto nadie. Con la descarga verificada, el camino que ADR-07
pedía está probado de punta a punta: pantalla → `@media print` → PDF real en la mano.

Vale la pena señalar por qué esta media hora de espera era el diseño y no una molestia: **la decisión de
que el PDF lo genere el navegador convirtió al humano en la última milla de la verificación**. Un PDF de
servidor se habría podido testear entero sin nadie mirando… y también habría escondido el 1.10:1 de la
hoja, porque el CSS de pantalla no habría llegado nunca al papel.

---

## 2026-08-07 (tarde) — el tramo A del orquestador: preparar el despliegue destapó que `POST /runs` ya estaba roto

El orquestador es la última pieza de Fase 2 sin desplegar, y el estado decía que solo faltaban las
cuentas. **Era falso.** El despliegue se partió en dos —tramo A: todo lo que es código y no cuesta
nada; tramo B: cuenta de Inngest y servicio en Railway— y el A encontró tres cosas que el B habría
pagado en caliente.

**`POST /runs` está roto en producción desde que la API vive en Railway, y nada lo dice.** El SDK de
Inngest lanza en `send()` cuando el modo es *cloud* y no hay `INNGEST_EVENT_KEY`
(`components/Inngest.js:563`), y el modo se infiere como cloud por `RAILWAY_GIT_BRANCH` — no por
`NODE_ENV`, que Railway ni define. No había ninguna clave de Inngest en el repo: `grep` sobre `api/src`,
`orchestrator/src`, `docs` y `scripts` daba **cero**. Y como la fila del run se crea **antes** de emitir
(ADR-18), cada intento dejaba un **run huérfano** en `running` que el portal polleaba para siempre,
mientras el usuario veía un error sin enterarse de que su run existía. Ahora la API no arranca sin la
clave, y si el evento falla igual, el run se marca `failed` con el motivo.

**El orquestador caía a PGlite en memoria** cuando no encontraba su DSN: un proceso que se declara
sano, acepta el evento, **paga el research** y lo escribe en una base que se evapora. En producción
ahora está prohibido — y `DATABASE_URL` tampoco alcanza, porque en Railway es el DSN que el plugin de
Postgres inyecta solo, apuntando al **dueño** de la base: aceptarlo dejaría al orquestador con un login
capaz de asumir cualquier rol, el `set local role app_service` seguiría funcionando, y ADR-17 pasaría a
ser una coincidencia de nombres sin que nada fallara.

**El patrón que se repitió tres veces, incluido en mí.** La afirmación *"el SDK lee las claves solo de
`process.env`"* la escribí yo en dos documentos sin ejecutarla; era falsa (`eventKey` es opción pública
y **gana** sobre el entorno). La corrigió quien fue a medirla. Y entonces la misma frase apareció otra
vez, escrita por otro, para `INNGEST_SIGNING_KEY` — y ahí no era solo doc: la clave se validaba, se
trimeaba, y **nunca llegaba a `serve()`**, así que una key pegada del dashboard con espacios pasaba la
validación y el SDK usaba el valor sucio. Medido: **HTTP 401, "Invalid signature"**, en toda invocación
de Inngest Cloud, con `/_health` respondiendo `{"ok":true,"modo":"cloud"}`. Un servicio que se declara
sano y no sirve para nada — el mismo modo de fallo que esta etapa vino a cerrar, adentro de la etapa.

Las tres veces el origen fue idéntico: leer `helpers/consts.js`, que solo lista **nombres** de
variables, y deducir de ahí que era el único camino. Deducir de una lectura parcial se siente igual que
medir.

**Y una que casi se reporta como "no reproduce".** La primera sonda del arreglo miró
`client.inngestApi.signingKey` y vio el valor sucio en los dos casos, lo que parecía refutar el
hallazgo. No: `inngestApi` es la clave **saliente**, sembrada cruda en el constructor; la verificación
de firmas **entrantes** usa otro campo. Medir el campo equivocado da un resultado limpio y falso.

**Decisión del dueño del proyecto: `PIPELINE_MODO`.** Quedaba un fallo silencioso hermano del de
PGlite: un despliegue sin `DATAFORSEO_MODE=live` corre entero, genera keywords **inventadas** por el
mock, las escribe en la base **real** del cliente y deja el run en `pending_approval` con su informe,
indistinguible de un research legítimo — un volumen de búsqueda falso es un número plausible en una
columna que nadie audita a ojo. Ahora `PIPELINE_MODO` es obligatoria en producción y **no tiene
default**: no enciende nada, **declara**, y el arranque aborta si contradice a `DATAFORSEO_MODE` en
cualquiera de las dos direcciones (research falso presentado como real, o gasto en un despliegue
anotado como gratuito). Se expone en `/_health`, porque una declaración que solo vive en el panel de
Railway no se puede auditar mirando el servicio.

**La revisión interna encontró un test que era un adorno**, y la mutación lo probó de la única forma
que vale: el test de fidelidad de la sonda comparaba dos veredictos que en la suite valen los dos
`false`. Con el test viejo puesto, la mutación que debía cazar (`isDev: true` en el cliente real) dejaba
**32/32 en verde**; con el nuevo, cae. Y al volverse `PIPELINE_MODO` obligatoria, el barrido de
combinaciones habría pasado **sin comprobar nada** —las 8 abortaban antes de la aserción—, así que
ahora lleva un contador que exige que al menos una llegue.

De paso, dos errores de doc que costaban dinero: el runbook decía `DATAFORSEO_MODE=production`, un
valor que **no existe** (`index.ts:26` compara contra `"live"`), o sea que daba mock creyéndose en vivo;
y `api/README.md` afirmaba una lista completa de variables a la que le faltaba la que hace que la API
no arranque.

---

## 2026-08-07 — el primer despliegue real, y el bug que solo podía aparecer desplegando

Aplicadas las migraciones pendientes contra Supabase y sembrada la demo: **el informe de KR-2b se ve en
producción**. Las 14 migraciones quedan aplicadas —se aplicaron tres, porque la `0011` ya estaba, contra lo
que la doc afirmaba— y el estado pasa de *"no se puede confirmar sin credenciales"* a verificado.

**El despliegue murió antes de la primera migración**, con `permission denied for schema auth` y sin decir
dónde. Lo que lo delató fue lo que el mensaje NO traía: el runner prefija sus fallos con *"La migración X
falló y se revirtió"*, así que un error pelado significaba que el fallo era **anterior al bucle**.

Era `asegurarAuthStandIn`, un stand-in de `auth.users` que existe para que PGlite tenga esa tabla en los
tests, y que hacía `create table if not exists auth.users`. Su comentario afirmaba que en Supabase era **un
no-op, «porque el `if not exists` no toca nada»** — y nunca se había medido contra Supabase. Ahí el schema
`auth` pertenece a `supabase_auth_admin`, y **evaluar el `if not exists` igual exige mirar dentro del
schema**: sin `usage`, aborta. Arreglado consultando `pg_class`/`pg_namespace`, catálogos que se leen sin
`usage` — por eso la comprobación funciona donde el `create` no.

Es el mismo patrón que KR-2b persiguió doce veces —una afirmación sobre una herramienta escrita sin
ejecutarla— con dos vueltas de tuerca: vivía en un **helper de tests que corre en el camino de producción**,
y afirmaba precisamente cómo se comportaba en el único camino que ningún test recorre. **Solo podía
aparecer el día que alguien desplegara.**

Y dos predicciones mías fallaron en el diagnóstico, las dos por leer en vez de medir: dije que el
`grant usage on schema auth` de la `0012` probablemente era innecesario (el archivo documenta, con test,
que sin él ni el camino legítimo funciona), y anticipé que ese grant sería el segundo muro (pasó sin
problema: el rol no puede *crear* en `auth`, pero sí *otorgar* sobre él).

---

## 2026-08-06 — KR-2b: el informe llega a la pantalla, y el plan se equivocó en cada tarea

Cerrada **KR-2b** en **17 commits**: la tabla `kr_informes` (`0016`, solo staff, con sus grants),
`guardarInforme`/`getInforme`, el step del orquestador **antes de `cerrar-run`**, los dos endpoints, el seed
de la demo con informe sin gastar $0.31, el parser de Markdown y la pantalla. **786 tests** en el monorepo
(venía de 743) y **285** en el portal (207 `node:test` + 78 Karma); `verificar --con-portal` exit 0. Siete tareas con un implementador
fresco cada una, review después de cada devolución, seis re-reviews, y una review de rama al final que
devolvió **cero defectos de lógica**.

**Lo que hay que escribir primero, porque es el dato de la jornada: el plan tenía errores en las siete
tareas.** Entre dos y siete por brief. Cuatro impedían compilar; uno pedía una mutación **imposible** (un
`if` de rol que el diseño hace inescribible); otro omitía **media tarea** (que el parser tenía que deshacer
el escapado del generador); y una aserción que yo escribí con un `*` **aceptaba el mismo valor que el test
debía rechazar**. El plan se escribió el día anterior "con las firmas reales a la vista", y aun así.

Lo que los encontró no fue leer código: fue **ejecutar**. Y el patrón de los defectos es uno solo.

**Un test que pasa no es un test que prueba.** Cuatro veces un test estaba verde por la razón equivocada, y
las cuatro se destapó mutando:

| Qué parecía cubierto | Qué pasaba al mutar |
|---|---|
| Los tres tests negativos de la tabla (otro tenant, rol `cliente`, rol ausente) | pasaban **si la fila no existía**: comprobaban la ausencia de algo que nunca se creó |
| El tope de 256 KiB | mover el límite en **cualquier** dirección no tumbaba nada |
| El saneado del `filename` | el test era **unitario**: borrar el saneo del endpoint dejaba **la suite entera en verde** |
| La distinción 404 / «no hay informe» | borrar la rama que las separa dejaba Karma en **75 SUCCESS** |

El tercero es el que más importa: nada probaba que el endpoint **usara** la allowlist. Y el cuarto habría
hecho que un run inexistente pintara *«Todavía no hay informe de este research»* — la pantalla afirmando que
el run existe.

**Siete afirmaciones sobre herramientas, escritas sin correrlas — y en una cadena se apilaron cuatro.** Un
implementador afirmó que el tipo del portal «no va a avisar»; yo lo corregí prescribiendo `=== null`; una
review escribió *mi prescripción literal* en una plantilla real y midió `TS2362`; yo añadí que el guard
«tiene que vivir en el componente porque la plantilla no admite `typeof`», y el implementador midió que **sí
lo admite**. Las cuatro capas tienen la misma forma: **razonar sobre una herramienta en vez de ejecutarla**,
que se siente igual que saber. La capa 3 solo se salvó de propagarse porque venía marcada como inferencia y
no como hecho. La formulación que dejó el implementador, y que va al `08`: *la regla de "lo medible tiene que
estar medido" vale también para las instrucciones que recibís, y sobre todo cuando llegan envueltas en la
corrección de un error propio, que es cuando menos ganas hay de dudar.*

**Y la mutación tiene un modo de fallo que no está en la regla: que no se aplique.** Pasó tres veces —una
aguja que era subcadena de otra línea, dos `perl` mal escapados— y las tres el síntoma fue un verde
perfecto. La tercera variante es la más fina: `grep "exposeHeaders"` **seguía dando dos hits con la mutación
puesta**, porque un comentario la nombraba. Así que la regla tiene dos mitades: confirmar que la aguja
entró, **y** que el hit es la cosa.

**Tres cosas las encontró el navegador, no los tests.** La peor: `hono/cors` no declaraba `exposeHeaders`,
así que el browser **le escondía `Content-Disposition` a JavaScript** y el archivo bajaba como
`informe-<runId>.md` — todo el saneado por allowlist, correcto y testeado, no llegaba al usuario. Ningún test
podía verlo porque el header estaba bien construido; lo que fallaba era que el navegador no lo dejaba leer.

**Dos hallazgos que corrigieron trabajo anterior.** El guardián que KR-2a puso para impedir una segunda
fuente de verdad del brief **tiene un punto ciego**: solo barre esquemas Zod, así que no vio el
`BriefDelPipeline` del orquestador, un mirror **de tipos** que recortaba cinco campos — justo los que el
informe necesita. Y el parser podía **reabrir el agujero que KR-2a cerró**: `renderReport` escapa diez
delimitadores, y partir celdas sin respetar el escape le devuelve a un `\|` hostil su columna extra.

**Lo que los implementadores aportaron por encima del plan**, y conviene que quede porque contradice la idea
de que el plan manda: un `satisfies` **no solo comprueba, también tipa contextualmente** —el objetivo laxo le
daba al literal el tipo `string[]` y lo lavaba a mutable, y de ahí que el `as const` no protegiera—; que un
fixture entrando en `approved: true` fija un campo **más fuerte** que meterlo en un `deepEqual`, porque la
aserción anterior valía por coincidencia; y que un test del preflight de CORS habría quedado verde si alguien
moviera la línea, así que el test correcto asevera sobre la **respuesta real**.

Tres veces un implementador **rechazó con razón** algo que yo le pedí, y las tres midiéndolo primero.

**Decisión del dueño del proyecto:** las dos fechas del informe —cuándo empezó el research y cuándo se
guardó el render, 16 min 15 s de diferencia en la corrida real— **se muestran las dos**, con el aviso
explicando cuál es cuál. Las otras dos salidas contradecían un test aprobado o el texto de la spec; ésta no
oculta ninguna de las dos verdades.

---

## 2026-08-05 (noche) — el arnés contaba 0 tests y lo decía en verde, y la nota de la tarde se equivocó al medirlo

Arreglado el contador de tests de `verificar.sh`. La deuda estaba anotada esa misma tarde en `current.md`,
así que lo que esta entrada agrega no es el bug: es **que la nota que lo anotaba se equivocó justo en la
parte que decidía la urgencia**.

La nota concluía que el riesgo «no está activo — está a una resolución de PATH de estarlo, y nada
avisaría». Las dos mitades resultaron ser lo contrario y lo mismo: **ya estaba activo** —`npm run verificar`
imprime `node v24.18.1` en su sección de entorno, porque el `npm` del PATH vive en la instalación de 24— y
**"nada avisaría" se había cumplido ya**, en la corrida de cierre de KR-2a, que informó su cifra en verde
con el contador ciego. El error de la nota: se apoyó en la línea `node v22.21.1` de una corrida vieja —o
sea en un recuerdo— en el mismo párrafo donde se felicitaba por haber medido. La regla del proyecto es
medir al momento, y **una medición vieja citada como actual es exactamente la forma en que esa regla se
incumple sin darse cuenta**: no se siente como recordar, se siente como citar.

**El cambio.** La lógica salió del bash a `scripts/contar-tests.mts`, por el motivo que ya declaraba la
cabecera de `verificar.sh` para `secretos.mts`: lo que necesita test no vive en el script. El patrón acepta
cualquier prefijo no alfanumérico —el `#` del reporter `tap` (Node 22) y el `ℹ` del `spec` (Node 24), los
dos medidos—, y el piso hace lo que importa: si no encuentra resúmenes, o si suman 0, **falla** en vez de
devolver 0. El patrón cubre los dos formatos que existen; el piso cubre el que todavía no existe.

**El diagnóstico verdadero no era el prefijo.** Node 24 no cambió el símbolo: cambió el **reporter por
defecto** de `tap` a `spec` cuando la salida no es una terminal. El prefijo era el síntoma visible.

**Y el test que no envejece se estrenó cazándose a sí mismo.** Es el que corre el runner de verdad en un
subproceso y exige que el formato del Node de hoy se pueda contar. Primera corrida: rojo, con la salida del
hijo **vacía y su status en 0** — el subproceso heredaba `NODE_TEST_CONTEXT`, Node avisaba "run() is being
called recursively", se salteaba todos los archivos y salía bien. O sea el test escrito para impedir que una
salida vacía cuente como verde tenía adentro, en su primera versión, una salida vacía contando como verde.
Lo cazó el assert de la cifra; el assert del status estaba en verde. **Por eso un test no puede conformarse
con "el proceso no falló": tiene que comprobar el número.** Es la tercera vez en dos días que el arnés falla
por el mismo molde —el piso de `N_PAQUETES`, el barrido que no puede quedar vacío, y ahora esto—: una cifra
ausente que se presenta como un cero legítimo.

Cierre: **743 tests** (734 + 9), `verificar` exit 0, y las 4 mutaciones caen —el patrón viejo tumba 5 tests,
quitar el piso tumba 3, y cada ancla del regex tumba exactamente el suyo.

---

## 2026-08-05 (tarde) — KR-2a: el paquete `contrato/`, y nueve tareas con un revisor detrás de cada una

Ejecutado el plan de KR-2a con **subagentes**: una tarea por implementador, el `revisor` después de cada
devolución, y una review de conjunto al final. **11 commits + una fix wave**, **734 tests** (venía de 698),
`verificar` exit 0. El 7º workspace `contrato/` tiene los tipos del contrato del brief, los **dos**
validadores Zod y `renderReport`.

**La deuda del Zod duplicado quedó cerrada, pero no como el plan decía**, y el matiz es lo que más
enseñó: al medir los dos esquemas campo por campo, **no eran dos copias del mismo contrato**. El del M1
acepta cuatro `schema_version` y hace `evidencia`/`score_confidence` opcionales **a propósito** —para no
rechazar briefs viejos que siguen siendo publicables—; el del M2 exige el brief completo. Fusionarlos
obligaba a que uno perdiera su garantía. Y el criterio de cierre que yo había escrito en el plan ("los
fixtures de los dos lados pasan contra el esquema unificado sin editarse") era **inalcanzable**: el fixture
del M1 no trae `run_id`, `generated_at`, `backlog` ni `meta_run`. Se unificaron los tipos, el render y las
piezas comunes, y quedaron tres lazos que impiden que se separen en silencio.

**Lo que la etapa destapó, ninguno previsto en el plan:**

- **Un riesgo de gasto real.** El gate que **aborta antes de pagar** leía `cobertura_volumen`, que pasó a
  ser nullable. Con `null`, `null === 0` y `null < 0.3` son los dos `false`: el corte se apagaba **en
  silencio** y el run seguía pagando sin un dato de mercado. La red que lo atrapa es `tsc`, no la suite —
  los 146 tests de `kr-service` pasan en las tres variantes medidas.
- **Un tipo que promete más de lo que su validador garantiza**, dos veces. `parseBrief` devolvía vía `as`
  un tipo que exigía cuatro campos que `consumoM1` no valida, y el síntoma fue tener que **engordar los
  fixtures** del M1 para que compilaran. Lo mismo con `coste_breakdown`, tipado con tres `number`
  obligatorios contra un guard de runtime que se protege de que falten porque `{}` es el default de la
  columna. Los dos arreglados haciendo que el tipo diga lo que el validador hace.
- **Tres comentarios que afirmaban algo falso.** Uno describía su propia medición **al revés** (decía que
  leer el campo pasaba el typecheck y que leer los locales reventaba, y era exactamente lo contrario); otro
  nombraba como red un diferencial de 1101 casos que ya **no se podía correr**, porque el esquema contra el
  que comparaba se había borrado en la misma etapa. Es la lección de la 13ª review un nivel más abajo: en el
  código, no en las skills.
- **Y el bug del informe que ya existía:** `renderReport` interpolaba texto de LLM sin escapar
  delimitadores, así que una keyword con `|` desalineaba la tabla y un `\n##` inventaba una sección. KR-2
  no lo introdujo — lo iba a hacer visible en una pantalla.

**Tres veces una mutación no tumbó nada, y las tres veces la respuesta fue distinta.** Es lo que más vale
de esta etapa: la regla ("una mutación que no cae dice una de dos cosas") se ejercitó de verdad.

1. En T3, con los 6 tests del brief, borrar los `.extend()` de `emisionM2` **no rompía nada** → faltaban
   tests, y se agregaron 3.
2. En T5, la mutación del enum no caía con los tres casos del brief → faltaba un **cuarto caso**, y la
   lección quedó escrita en el test: *el test de inclusión solo cubre lo que sus fixtures ejercitan*.
3. En T8, quitar el colapso de saltos de `celda()` **no tumbaba nada** → tampoco era la línea: ninguno de
   los cuatro tests metía un `\n` **en una celda**. Se demostró que la línea sí hacía algo (una keyword con
   `\n##` **parte la fila en dos**) y se escribió el test que faltaba.

**Dos hallazgos sobre mi propio plan, encontrados por los implementadores.** El comentario que el plan
mandaba escribir en el test de arquitectura —"también cubre el paquete que alguien agregue mañana"— **era
falso** con la lista fija de paquetes que el mismo plan daba: el test descubre *archivos*, no *paquetes*.
Y ese test tenía un modo de fallo silencioso que el plan no vio: **un barrido que no encuentra archivos
pasa**, y pasaría para siempre. Se demostró mutando el barrido a `return []` y viendo el test verde **sin
leer un byte**.

**La review de conjunto encontró siete bloqueantes que ninguna review por tarea podía ver**, y el peor era
de documentación: el ritual estaba diferido "al cierre", y el cierre era ese commit. Encontró **17 filas**
de drift, seis de ellas que mi propio ledger no tenía — entre ellas `AGENTS.md` y dos prompts de agentes
diciendo "6 paquetes". Ese es el archivo que **lee todo agente al arrancar**: uno que lo leyera hoy no
sabría que `contrato` existe, y ahí es donde se vuelve a escribir una segunda copia del contrato.

**Y un hallazgo del arnés, no del código:** durante una review, el agente `revisor` **modificó código con
Bash** para probar una mutación —no tiene `Edit`, pero sí `Bash`—, lo detectó cuando `permissions.deny` le
bloqueó el `git checkout`, lo revirtió y lo reportó por su cuenta. Es la primera ocurrencia **real** de lo
que la 13ª review señaló en teoría: las prohibiciones de los agentes son un **contrato, no un sandbox**. En
las reviews siguientes usó un `git worktree` aparte. El árbol se verificó después de cada una.

## 2026-08-05 — La spec de KR-2, y la primera review externa de un diseño

Nada de código. Se escribió la **spec de KR-2** (el informe legible del research, en el portal), se la
pasó por la **14ª review externa** y se la corrigió. Trece hallazgos, los trece verificados.

**Las decisiones de producto que faltaban, cerradas por Juan:** pantalla **+** descarga `.md`; el `.md`
**guardado ya renderizado**; y —tras la review— que el informe es un **documento interno de la agencia**.

**Lo que el diseño destapó antes de la review**, todo midiendo en vez de suponer: el `backlog` **no se
persiste** en ninguna parte, así que un informe reconstruido desde la base perdería esa sección sin
avisar; el run de la demo **lo siembra `sembrarDemo`**, no el pipeline, y el `out/informe.md` de la
corrida real no existe en ninguna máquina; `renderReport` **emite `NaN`** con datos incompletos; el
contrato **no admite "no sé"** en las coberturas; y el `cobertura_volumen: 0.571` del seed es **por
página** aunque el informe lo etiquete como por keyword.

**El cambio de fondo del diseño salió de aplicar un invariante, no de la review:** el informe iba a ser
una columna `kr_runs.informe_md`, y se movió a **tabla propia con política `app.es_staff()`** porque
**RLS es por fila, no por columna** — una columna habría dejado el coste interno de la agencia visible
para el rol `cliente`, que ve los runs de su negocio.

**Después, la 14ª review: la primera sobre un documento y no sobre un diff.** NO LISTO, 13 hallazgos.
El detalle está en el [`08` § tanda 20](../docs/proyecto/08-testing-calidad.md); lo que cambió el rumbo:

- **Un bloqueante que ningún test habría atajado: la migración no concedía ni un `grant`.** Los grants
  del proyecto son listas explícitas por tabla y no hay `on all tables` en ninguna migración, así que
  `kr_informes` habría nacido sin un solo privilegio: `42501` al guardar y al leer. Es la **primera tabla
  que el proyecto agrega desde que existen los cuatro logins**, y por eso el paso no estaba en ninguna
  rutina. No había test que lo cazara porque no había código.
- **"Un esquema Zod M2 = M1" era imposible, y el criterio de cierre que yo escribí era inalcanzable.**
  El de M1 acepta cuatro versiones y hace dos campos opcionales **a propósito**; el de M2 exige el brief
  completo. Son dos contratos con propósitos opuestos, no dos copias. Rediseñado a `esquemaBase` con dos
  derivados y un test de inclusión `emisionM2 ⊆ consumoM1`.
- **Dos garantías que declaré más fuertes de lo que eran, antes de que existieran.** Que la tabla propia
  hacía "estructural" el no-revocar-aprobaciones (falso: nada impide un `update kr_pages`, y usé esa
  conclusión para justificar que no hiciera falta test), y que la inyección era "imposible por
  construcción" (cierto para HTML/JS, falso para la estructura del Markdown — y **ese bug ya existe hoy**
  en el informe del CLI: una keyword con `|` rompe la tabla).
- **Cuatro mutaciones de la matriz no caían**, cada una por un motivo distinto. La más instructiva:
  `grant select … to app_render` no destapa nada, porque la política dice `to app_user, app_service` y
  sin política aplicable RLS niega igual. **Con RLS, quitar un grant y quitar una política producen el
  mismo síntoma observable**, así que una sola mutación no distingue qué garantía se está probando.
- **De trece hallazgos, cuatro eran afirmaciones mías sobre el código que el código desmiente** — entre
  ellas que la pantalla del brief no muestra el coste (lo muestra) y que `cartera-portal.test.ts` ata
  `calidad_datos` (no lo mira). Es el modo de fallo de la tanda 19 un nivel más arriba: **escribí sobre
  el código sin volver a abrirlo.**

**Y el hallazgo propio, que salió de verificar el último de la lista y es el más grave:** `run_select`
sobre `kr_runs` usa `app.ve_cliente(client_id)`, que da true para un rol `cliente` sobre su propio run.
**El margen ya está expuesto, hoy, sin KR-2** — `GET /runs/:id` devuelve `coste_micros_usd` y
`coste_breakdown`, y la pantalla los pinta. No es fuga activa (no hay usuarios `cliente`), pero la spec
presentaba la tabla propia **como si cerrara la exposición del coste**, y ya existía por otra vía.
Cerrarla es otra pieza.

**Lo que queda abierto:** qué pasa con el **PDF de ADR-07**. Con el informe convertido en documento
interno el PDF pierde su motivo —era un formato de entrega hacia afuera— y pasa a pertenecer al
entregable del restaurante, que no existe. La recomendación es registrarlo en ADR-07 con una nota
fechada **antes** de implementar, no después: hacerlo después sería cambiar una decisión aceptada con el
trabajo ya hecho.

## 2026-08-04 — Etapa B: el agente `datos`, y el orden del brief que se perdía en Postgres

Cerrada la **etapa B** del plan de agentes: el agente `datos` (`db/` + `api/`) con sus tres skills
—`datos-postgres`, `datos-api`, `datos-testing`—, estrenado con **KR-3**, la mitad que la etapa A dejó
abierta. Quedan **4 agentes y 12 skills**; 698 tests en el monorepo al cerrar la jornada (venía de 684), 169
del portal, 66 de Karma. Con la migración `0015` son 13.

**El estreno no fue el previsto, y eso fue una decisión.** El plan decía KR-2 (el informe en el
portal), pero KR-2 llegaba con tres decisiones abiertas y KR-3 tenía la suya ya razonada en el `09`. Se
estrenó con KR-3 y **de paso se tomó la decisión de KR-2** para que dejara de bloquear: paquete
compartido (opción b). Un estreno que arranca eligiendo arquitectura prueba la capacidad de decidir, no
las skills.

**Qué se arregló.** `kr-service` ordena las páginas en dos niveles (evidencia primero, después
`score_confidence`) y ese orden viajaba como **la posición del array** — así que `getRunPages` y
`getPublishablePages`, que ordenaban por `opportunity_score`, lo deshacían, y la columna "Confianza"
del portal no ordenaba nada. Ahora es un dato: `kr_pages.orden_brief`, escrita por `savePages` desde el
índice. **`kr-service` y `orchestrator` no se tocaron**: el contrato se fijó antes de escribir código, y
resultó que el array ya viajaba ordenado.

**Lo más fino del cambio, y lo que enseña.** `orden_brief` **no es material**: no puede ir en el `where`
del upsert de `savePages` (revocaría la aprobación de una página que solo cambió de puesto) ni solo en
su `set` (el `where` gobierna el update entero, así que en un reintento donde SOLO cambió el orden no se
escribiría). Va en una sentencia propia. Son dos garantías opuestas, y por eso hacen falta **dos
mutaciones** para probarlas.

**El hallazgo que más valió fue una mutación que NO cayó.** Quitar el `nulls last` del `order by` dejó
los 178 tests en verde. La primera hipótesis tentadora era "falta un test"; la correcta era otra:
**`nulls last` ya es el default de Postgres para `asc`** (medido: `order by n asc` sobre `1, null, 0` da
`0, 1, null`). El comentario afirmaba lo contrario **en tres archivos**, escrito por mí antes de medir.
La regla que queda: *una mutación que no cae dice una de dos cosas —falta el test, o la línea no hace lo
que su comentario dice—, y hay que averiguar cuál antes de tocar nada.*

**El `revisor` devolvió CAMBIOS_PEDIDOS con dos bloqueantes, los dos reales.** (1) Corregí el comentario
del test del portal y **dejé el de la fuente** afirmando que la API ordena por score — el próximo lector
tenía permiso escrito para restaurar el `sort` que el test acababa de blindar. (2) Mi skill decía
"PGlite es Postgres 18": **`db/` corre PostgreSQL 16.4 y `api/` 18.3**, dos majors distintos, así que un
comportamiento del motor medido en un paquete no se puede afirmar del otro. Lo verifiqué yo mismo, y
resultó que mi medición del `nulls last` había sido con el PGlite de `db/` (16.4): coincide en 18.3, pero
lo supe por suerte, no por método. Otros tres hallazgos eran cifras que puse **de memoria** al escribir
las skills (`12 migraciones`, `unas veinte rutas`), que es exactamente el modo de fallo que el proyecto
persigue. Y encontró uno de fondo: un `url_slug` repetido en el brief producía un orden **invertido y no
reproducible** (`update … from unnest` matchea la fila dos veces y Postgres elige una sin garantizar
cuál) — una precondición que vivía sin dueño en otro paquete. Ahora `savePages` rechaza el brief entero.

**Dos cosas que resultaron falsas y estaban escritas como ciertas.** Que `portal/.../cartera.ts:37`
deshacía el orden del brief: es `topOportunidades`, el widget de "las N de mayor score", con otro
propósito — el único que lo deshacía era `store.ts`, y **el portal no necesitó cambios** porque
`separarPorEvidencia` preserva el orden de entrada. Y que un agente nuevo no se puede invocar en la
sesión que lo escribe (lección de la etapa A): al guardar `agents/datos.md` el registro se recargó en el
acto.

**El test del portal que no mordía.** El que fijaba "conserva el orden de entrada" usaba dos páginas con
el **mismo** score, así que un `.sort()` por score lo dejaba pasar. Reescrito con el orden
contradiciendo al score: ahora cae. Un test de orden necesita que la entrada contradiga el criterio que
no quiere que se aplique.

**Siete mutaciones en total**, cada una con qué tumbó: el update del orden (2 tests), el orden en el
`where` (1), `nulls last` (**0** — el hallazgo), `nulls first` (1), el check de posición negativa (1), el
rechazo de slugs repetidos (1), el check de retirada sin posición (1), y el `sort` por score en el portal
(1).

**Y después, la 13ª review externa: la primera que miró el arnés.** Veredicto NO LISTO, nueve hallazgos,
ninguno refutado del todo. El detalle está en el
[`08` § tanda 19](../docs/proyecto/08-testing-calidad.md); lo que cambió el rumbo:

- **Cuatro de los nueve eran cifras o versiones que escribí de memoria** al redactar las skills
  (`Postgres 18` cuando `db/` corre 16.4, `12 migraciones`, `veinte rutas`, `~15s` cuando son 52s). Las
  doce rondas anteriores encontraron garantías escritas en comentarios y no impuestas; esta encontró lo
  mismo **un nivel más arriba**: afirmaciones falsas en las instrucciones que van a gobernar el trabajo
  futuro de un área. Una skill equivocada no rompe un test — dirige mal cada decisión posterior, con
  tono de certeza.
- **La carrera de `savePages` que ningún test podía ver.** Dos guardados concurrentes del mismo run
  dejaban la unión de dos briefs, con dos páginas en la posición 0. Hoy estaba tapado por el
  `{ key: tenantId, limit: 1 }` de Inngest — que está ahí por **equidad entre tenants**, no por
  integridad, así que quien lo suba a 2 abre una brecha de datos sin señal. Se cerró donde corresponde:
  `select … for update` sobre `kr_runs`. Y se escribió en el código que **PGlite serializa, así que esta
  propiedad no tiene test**: era eso o dejar creer que estaba cubierta.
- **La raíz de un hallazgo estaba en el código, no en la skill.** "Todo se escribe como `app_user`" es
  cita textual del comentario de `db/src/store.ts`, que también estaba mal (el orquestador escribe como
  `app_service`). La skill no inventó el error: lo propagó convertido en instrucción. Se corrigió en los
  tres sitios.
- **Un anclaje `ruta:línea` se rompió en la misma sesión que lo escribió**, porque el arreglo de otro
  hallazgo agregó diez líneas encima. Los anclajes por línea a código que estás tocando duran horas.
- **El arnés no impone lo que promete**, y ahora lo dice: los agentes de área heredan `Bash` y el
  `revisor` conserva `Write`, así que sus prohibiciones son un **contrato**, no un sandbox. Se ampliaron
  los `permissions.deny` para atajar el accidente y se declaró la diferencia en `AGENTS.md`. Refuté la
  parte fuerte del hallazgo: omitir `Edit` sí es un límite técnico; lo que es incompleto, no inexistente.
- **Un hallazgo propio, al pasar:** el test "sembrar dos veces … no duplica tenant, cliente, **run** ni
  páginas" consultaba el conteo de runs y no lo aseveraba. Una query muerta justo en la garantía que su
  nombre prometía.

**698 tests** al cerrar (+3 sobre los 695 de la mañana), 19 tandas y 13 rondas externas.

---

## 2026-08-03 — Ordenar la documentación, y lo que apareció debajo

Se reorganizó el corpus entero de documentación (74 archivos, ~24.000 líneas) y se puso el grafo de
referencias de skill-map en **cero errores**, desde 32. Pero lo importante de la sesión no fue eso.

**🔴 `docs/private.zip` estaba commiteado en un repo público.** Apareció mirando por qué el
`.gitignore` no lo cubría: la regla era `docs/private/` (con barra), que no alcanza a un zip del mismo
nombre. Adentro viajaban `credenciales.env` —el archivo maestro— y los cinco `.env` de backup de los
paquetes, incluidos `SUPABASE_JWT_SECRET`, los tres `DATABASE_URL_*`, `DATAFORSEO_PASSWORD`, las keys
de Anthropic y OpenAI y el `STORYBLOK_MANAGEMENT_TOKEN`. En `origin/main` desde el commit `15ae91a`
("priv", 2026-08-01), y el repositorio es **público** (verificado: la API de GitHub responde 200 sin
autenticar). Se sacó del índice con `git rm --cached` y se blindó el `.gitignore` con los cuatro
patrones de comprimido. **Decisión del usuario: rotar, y no reescribir el historial** — una vez
público, el secreto está quemado y purgar no lo des-expone; lo que devuelve la seguridad es rotar.

**Y la lección que deja, que es sobre el arnés y no sobre el zip:** `npm run verificar` daba **verde
en la compuerta de secretos** con ese archivo trackeado. Mi primer diagnóstico fue impreciso —escribí
que el detector "no mira dentro de los comprimidos"—, y leyendo `scripts/secretos.mts` la causa
resultó peor por lo simple: el detector **decide por ruta a propósito**, y su regla comparaba
`dirs[1] === "private"`, el segundo segmento de **directorio**. En `docs/private.zip` no hay segundo
directorio: `private.zip` es el **nombre del archivo**. Ninguna regla lo miraba. **El mismo error
conceptual que el `.gitignore`, en los dos lugares que tenían que atajarlo**: prohibir la carpeta y
olvidar el archivo que se llama igual. Otra vez lo mismo de siempre: la garantía existía, el test que
la ejercitaba no.

**Se cerró en la misma sesión**, con la disciplina completa: dos tests rojos primero, dos reglas
(`docs/private*` por nombre, y cualquier **comprimido versionado** — opaco para un detector de rutas,
y hoy no hay ninguno en el repo, así que la regla no le cuesta nada a nadie), y **mutación por
separado de cada una**: al quitar una, cae exactamente su test y ningún otro. Eso último no salió
gratis: la primera versión del test de `docs/private*` usaba solo nombres `.zip`, así que **la regla de
comprimidos lo mantenía verde** — el test pasaba por la razón equivocada y la mutación fue lo que lo
destapó. Se le agregó un caso con un `.md` bajo ese nombre —no un comprimido— para que el test pruebe
la regla que dice probar.

**Lo que se ordenó.** Tres cosas que estaban mezcladas ahora están separadas por la pregunta que
contesta cada carpeta: `docs/proyecto/` dice **cómo es el sistema hoy**, `docs/superpowers/` dice
**qué se va a construir y cómo se construyó**, y el nuevo `docs/historia/` dice **por qué el proyecto
es así**. Se archivaron los 11 planes y specs ya ejecutados (~9.400 líneas, el 52% del corpus) en
`superpowers/ejecutados/`, fuera del índice del grafo pero dentro de `referencePaths` para que sus
enlaces sigan resolviendo. Se movieron a `historia/` el PRD de origen, el contexto de Frank, las seis
acciones cerradas y los dos documentos del Módulo 2 previos a construirlo. Se resolvió la colisión de
numeración `12`/`12` (despliegue pasó a `13`, el runbook a `14`).

**Un archivo se quedó afirmando algo falso durante un mes:** `docs/historia/modulo-2-keyword-research.md`
decía "Motor elegido: **SEMrush**", cuando el motor es DataForSEO desde antes de la primera línea de código.
No se fusionó al documento vivo —habría contaminado el `04`—: se archivó con un aviso arriba que dice
exactamente qué de ahí es mentira.

**Lo que enseñó arreglar 32 errores de referencia.** Solo **6 eran defectos reales**. El resto eran
tres clases de falso positivo, y saber distinguirlas es lo que evita reescribir prosa correcta para
complacer a un linter:

1. **26 venían de carpetas que git ignora** y skill-map escaneaba igual (`respectGitignore: false`).
   Se fueron con una sola opción de configuración — que además saca de la base de skill-map el
   `docs/private/credenciales-deploy.md` que estaba indexado y era legible por cualquier cliente MCP.
2. **Un nombre de archivo suelto en un span de código se resuelve contra la carpeta del documento que
   lo menciona.** El nombre del `09` sin su carpeta, escrito en `AGENTS.md`, apunta a la raíz del repo
   y no a `docs/proyecto/`. Es la trampa que más veces se repitió, y por eso ahora hay una convención
   escrita en [`docs/README.md`](../docs/README.md). Esa sección tardó **tres intentos**: la primera
   versión rompía la regla que enseñaba, la segunda apostó a que meter los contraejemplos en un fence
   de código bastaba —**y no basta: el scan persigue las rutas también dentro de los bloques**—, y la
   tercera los silencia con su motivo escrito. Escribí "el scan hace code-strip" antes de comprobarlo;
   el scan me contestó que no.
3. **Lo que no es una referencia no debe escribirse como ruta**: el informe que el pipeline escribe en
   `out/`, un nombre de ejemplo, una unidad de medida (euros por mes, leída como slash-command).
   Esos 20 se silenciaron con `sm issues dismiss` **y su motivo escrito en el `.sm`**, que es lo que
   hace que la supresión sea una decisión y no un olvido.

**Y una asimetría de skill-map 1.2.1 que conviene recordar:** el `dismiss` de `reference-broken`
funciona y sobrevive a un scan completo; el de `reference-redundant` **no** — la supresión queda
activa y con el sidecar correcto, y el issue vuelve igual. Verificado con scan completo, no inferido.

---

## 2026-08-02 (etapa A) — El agente `pipeline`, y lo que se aprende estrenándolo

Se escribió el agente `pipeline` (128 líneas) y sus cuatro skills —`pipeline-gasto`,
`pipeline-research`, `pipeline-publicacion`, `pipeline-orquestacion`— y se estrenaron con trabajo
real: **KR-3 entero** y la mitad de **KR-1** que no cuesta dinero. 682 tests (subió de 624), y el
estreno se delegó de verdad en dos subagentes, en serie, con el contrato fijado antes de repartir.

**Lo que enseñó estrenarlas, que es la razón de que la etapa no se cierre sin trabajo real.** Las
tres cosas que las skills no traían **son las tres que cruzan el límite del paquete**:

1. La clave de la cache del SERP **la parsea `metaDeClave()` en `orchestrator/` por posición**, así
   que se puede cambiar un literal pero no la cantidad de segmentos. Sin eso, agregarle un segmento
   le habría desplazado `depth`, `location_code` y `language_code` a `kr_serp_cache` en silencio.
2. **El orden que produce `kr-service` no sobrevive a la persistencia**: `db/src/store.ts` y
   `portal/src/app/core/cartera.ts` reordenan por `opportunity_score` crudo. Lo encontró el subagente
   *al final*, revisando su propio trabajo, no al principio.
3. `config.ts` hace `import "dotenv/config"`, así que **un test que arranca el pipeline entero lee el
   `.env` real** —con keys y baseUrl de producción— sin que nadie se lo pida. Cuatro cerrojos.

Leyendo solo `kr-service` ninguna de las tres aparece: son precisamente lo que un agente encerrado en
su ámbito no puede ver. Para `datos` y `render` queda anotado escribir explícitamente la sección
*"qué de esto sobrevive al salir de tu área"*.

**Lo que se implementó.** `is_local` ahora sale del **map pack** del SERP (evidencia de Google) en vez
de una conjetura sobre el texto de la keyword —que daba 53 de 60 locales y publicaba `LocalBusiness`
falsos—, pero **solo cuando se observó**: `mapPack: null` respeta al LLM, porque tratar "no observado"
como "no es local" es el mismo error que `volumen ?? 0`. El volumen se normaliza contra el **percentil
90 winsorizado** en vez del máximo, así un pico deja de aplastar al resto. Y `score_confidence`
**ordena**, en dos niveles con la evidencia mandando siempre. El dataset crudo pasa a `datasets/`, y
que no vuelva a un directorio ignorado **lo impone un test que se lo pregunta a `git check-ignore`**,
no un comentario.

**Lo que quedó a medias, dicho como tal.** El percentil es *del run*, no *del mercado*: arregla el
aplastamiento, no la comparabilidad entre corridas. Los dos parámetros nuevos (`0.9` y `0.5`) son
juicio, no medición — barrerlos es gratis en cuanto exista el dataset, y el dataset **no existe**
(se perdió en `out/`, regenerarlo cuesta ~$0.31 y lo decide Juan). `TIPOS_MAP_PACK` no está verificado
contra la API real; si estuviera mal, falla hacia el lado conservador (sub-declara) pero KR-3 no
arreglaría nada. Y el orden nuevo gobierna **qué páginas existen** pero no **cuáles ve el cliente**.

**Un detalle del arnés:** un agente recién escrito **no se puede invocar por nombre en la sesión que
lo escribe** —el registro se carga al arrancar—, así que el estreno se hizo pasándole su definición al
subagente. Funciona, pero la etapa B conviene arrancarla en una sesión nueva.

## 2026-08-02 (cierre) — El plan de los tres agentes que faltan

Con `front` y `revisor` cerrados, quedaba decidir cómo se escriben los otros tres. El reparto ya
estaba acordado; lo que no estaba era **cómo se parten las skills dentro de cada área**, y eso ahora
se decidió leyendo el código en vez de imaginándolo: nueve skills, con un anclaje verificado por
cada una (el preflight de `budget.ts` que estaba 50× por debajo, el `published` de `publisher.ts` que
distingue "lo pedí" de "pasó", el orden `Host → dominio → sitio` de `renderer/src/app.ts` que **es** la
autorización). Vive en [`.claude/PLAN-AGENTES.md`](../.claude/PLAN-AGENTES.md): **una etapa por
sesión**, porque las tres juntas se cierran una vez al final, cansado, que es como se produjo el drift
de quince cifras.

Lo que se junta y lo que no: `db` + `api` en **un** agente (comparten PGlite y comparten el cuerpo de
conocimiento; partirlos pondría a dos agentes a escribir las dos mitades de un contrato en el caso más
frecuente), los tres paquetes del pipeline también (el hilo real es *"corre sin nadie mirando, gasta
dinero, tiene que ser idempotente"*), y `renderer/` solo, con 3.395 líneas, porque es la única
superficie pública anónima.

**La regla que salió de escribirlo:** una skill redactada leyendo código es una **hipótesis** hasta
que un agente la usa. `front` está escrito y todavía **sin estrenar**, así que cada etapa ahora
termina con un trabajo real que la ejercite —para `pipeline` son KR-1 y KR-3, que ya existen en el
`09`— y no se cierra sin él.

Y tres huecos que quedaron como decisión, no como olvido: no una skill transversal de TypeScript
(ya está en `AGENTS.md`, que se carga siempre; duplicarla crea dos copias que se desincronizan), no un
agente de documentación (no sabe qué pasó en la sesión: habría que contárselo, que es el teléfono
descompuesto), y no un agente de infra (es justo lo que `AGENTS.md` prohíbe delegar). El plan **no**
se enlazó desde el `09`: meter trabajo de arnés en el roadmap de producto es la misma contaminación
que se quiso evitar, al revés. El puntero vive en `AGENTS.md`, que se carga siempre.

## 2026-08-02 — El arnés de trabajo con agentes (`de6f8a4`, `3b4dbd0`, `620f5e4`)

Hasta hoy el "cómo se trabaja acá" era `AGENTS.md` y nada más. Ahora hay tres capas: `AGENTS.md` para
lo universal, **agentes** por área para el ámbito y los límites, y **skills** para las convenciones
—que también carga la sesión principal cuando no delega, que es la mitad de las veces—.

Existen `front` (portal Angular, con `portal-angular`, `portal-estilos` y `portal-testing`) y
`revisor` (transversal, no edita nada). Quedan planificados `datos`, `pipeline` y `render`: el reparto
es por **cuerpo de conocimiento**, no por carpeta, así que `db` + `api` van juntos y los tres paquetes
del pipeline también.

`npm run verificar` es el `init.sh` que faltaba —entorno, archivos del arnés, higiene de secretos,
typecheck y tests, con exit code— y sabe algo que se olvida siempre: **`portal/` no es workspace**, sus
tests no entran en `npm test`. `CHECKPOINTS.md` convierte el ritual en algo que se marca con
evidencia, y el hook `Stop` lo ejecuta el harness: condicional, porque se dispara al final de **cada**
turno (42s de suite completa contra 5s de typecheck, medidos).

Del harness de ejemplo se dejaron fuera tres cosas a propósito: `feature_list.json` (sería un segundo
roadmap desincronizándose), el hook que corre toda la suite tras cada edición, y el líder que nunca
toca código. En el mismo movimiento, la revisión de Codex pasó de ser un párrafo de `AGENTS.md` a la
skill `codex-review`, con la política de no-escritura como lista cerrada de prohibido/permitido.

**La primera revisión del `revisor`, sobre el arnés mismo.** Devolvió CAMBIOS_PEDIDOS con 4
bloqueantes, y los 4 eran reales (verificados uno por uno antes de aplicar nada). El más serio: la
detección de secretos de `verificar.sh` —la única comprobación automática de la regla más dura del
repo— **daba `[OK]` sin haber mirado** cuando `git` no respondía, y su patrón dejaba pasar
`credenciales.env`, `.envrc`, `docs/private/*.env.example` y `portal/node_modules/`. Los cuatro
huecos, medidos. Ahora la lógica vive en `scripts/secretos.mts` con 10 tests y **verificación por
mutación**: cada arreglo hace caer exactamente su test, ninguno de más. El chequeo además falla —en
vez de aprobar— cuando no hay repositorio git.

**La segunda ronda aprobó, y encontró un quinto hueco.** Se le pidió al revisor que verificara el
arreglo y no la explicación (la lección de la tanda 12). Rehízo las cuatro mutaciones por su cuenta,
sondeó 33 rutas raras —espacios, `..`, un `.env` dentro de un directorio llamado `.env.example`— y
encontró una que faltaba: **el detector distinguía mayúsculas**, y `.envrc` era el único de la familia
que `.gitignore` no cubría, así que ahí era la única defensa y se apagaba con Bloq Mayús. Cerrado en
las dos capas: comparación en minúsculas (con su test y su mutación) y `.envrc` agregado al
`.gitignore`.

Los otros tres: dos documentos mandaban escribir los informes a `progress/` (versionado) en vez de
`progress/informes/`; el `09` afirmaba como deuda unos tests de componente de research que **ya
existen** (`runs.spec.ts`, `brief.spec.ts`); y quedaban **quince** cifras de tests viejas repartidas
en ocho archivos, con el `09` contradiciéndose a sí mismo a veintitrés líneas de distancia.

**Cifras, medidas al cierre:** 859 = 624 en el monorepo (los 10 nuevos incluidos) + 235 en el portal
(169 `node:test` + 66 Karma). 12 migraciones, 24 ADRs.

Se revirtieron además 102 borrados de `portal/package-lock.json` que arrastraba el árbol desde antes
de esta sesión: eran campos `libc` de dependencias opcionales por plataforma (churn de un
`npm install` con otra versión de npm). Comprobado antes de descartarlos que ninguna versión cambiaba
y que no entraba ni salía ningún paquete; el portal sigue en 169 después.

## 2026-08-02 — Pieza 2 del portal de la agencia: usuarios (6 etapas), mergeada a `main`

Segunda pieza del [programa del portal de la agencia](../docs/superpowers/plans/2026-08-01-portal-agencia-programa.md):
quién tiene acceso al tenant, con qué rol, y cambiarlo — sin crear usuarios nuevos (eso lo sigue
haciendo Supabase Auth, la API nunca recibe esa credencial).

**Etapa 1** (`9614489`) agrega la vista `membresias_perfil` (0012) — `memberships` cruzada con
`auth.users` para traer el email, ya filtrada por tenant y por rol (staff ve el tenant entero, un rol
`cliente` ve solo su propia fila) — y `PgMembresias.listarMiembros`.

**Etapa 2** agrega `GET /members` y `PATCH /members/:userId` y extiende la MISMA migración (`0012`)
en vez de abrir una `0013` — reservada para la pieza 3 (Ideas) — para no colisionar la numeración
entre piezas del mismo programa. Tres piezas nuevas en la base:

- **`memberships` deja de ser solo lectura para `app_user`**, por primera vez desde `0001_init.sql`
  — pero solo para `UPDATE`, y solo lo que la política `membership_update` deja pasar.
- **La garantía "siempre queda un `maestro`" vive en un trigger**, no en un `check`: un `check` mira
  una fila, y esto depende del conjunto. Verificado por mutación (sacar el trigger hace caer
  exactamente el test del último maestro; puesto de nuevo, pasa).
- **`using` vs `with check` decide 403 contra 404**, y con una vuelta de tuerca que el brief no
  anticipaba: `membership_select` (0003, cierra la FUGA 1) ya restringe la lectura de `memberships`
  a "propia fila" — sin ampliarla, ni el propio `maestro` podría ver la fila de otro para cambiarla.
  La ampliación (`membership_select_staff`) no puede llamar a `app.current_role()`: esa función lee
  `memberships`, y una política de `memberships` que la llamara se re-evalúa a sí misma sin parar —
  **medido**: cuelga el proceso de Postgres, no lanza un error. La resuelve
  `app.rol_propio_sin_recursion()`, la misma pregunta con una bandera de sesión que corta la segunda
  entrada. Con esa visibilidad ya puesta, `membership_update.using` solo exige tenant (un `equipo` SÍ
  ve la fila que intenta tocar) y `with check` exige `maestro` **y** que no sea su propia fila
  (auto-degradación bloqueada en la base, no solo en la API) — así un `equipo` que intenta repartir
  roles cae con 403 real de RLS, no un 404 silencioso, y un `cliente` sigue dando 404.

El diseño sigue exactamente ADR-15 (el rol se deriva, nunca se declara) y ADR-17 (un solo login
`app_user`, sin asumir otro rol). Se construyeron creyendo que no hacía falta ADR nuevo; **sí hacía
falta, y ya está**: [ADR-24](../docs/decisiones-arquitectura.md) (aceptada el 2026-08-02) enmienda la
`0001`, que prometía que las membresías se escribirían "por el backend con service-role" — un backend
que nunca existió. ADR-24 autoriza exactamente lo que estas etapas construyeron y les fija cinco
condiciones: grant por columna, `using` + `with check`, `servicio` no asignable, auto-edición
rechazada en la base, y un trigger que sobreviva a degradaciones concurrentes.

**Las dos correcciones de seguridad que cerraron esas etapas**, las dos con test rojo primero y
verificación por mutación:

- **`grant select (id, email, raw_app_meta_data) on auth.users to app_user` era una fuga
  CROSS-TENANT y se quitó.** El razonamiento original —un grant por columna protege
  `encrypted_password` de un `select *` futuro— es cierto, pero decide *qué columnas* se leen, y el
  aislamiento que importa es de *filas*: eso lo hace la vista, no la tabla. Medido con PGlite:
  `equipoA` (tenant A) haciendo `select email from auth.users` obtenía **2 filas**, incluida la de un
  usuario del tenant B, mientras la vista le devolvía 1. Y nunca hizo falta: una vista sin
  `security_invoker = true` corre con los permisos de su *owner*.
- **El trigger del último maestro contaba sin serializar.** Con dos maestros, en READ COMMITTED, dos
  transacciones que degradan cada una al otro se aprueban entre sí —ninguna ve el cambio ajeno,
  todavía sin commitear— y el tenant queda con cero. No hay conflicto de filas que las ordene. Ahora
  toma un `pg_advisory_xact_lock` **por tenant** antes de contar. Advisory lock y no
  `select … for update`: eso exige el privilegio UPDATE de *tabla*, y `app_user` tiene solo el grant
  por columna. **La carrera no está reproducida en un test** —PGlite es un solo backend— y el test lo
  dice: fija que el punto de serialización existe y es por tenant.

**Etapas 3 a 6, en el portal.** El rol de la UI deja de salir de `app_metadata.rol`:
`MembresiaService` resuelve la **membresía efectiva** y ese valor alimenta la pantalla. Hacía falta
porque la API no puede reescribir ese metadata (no tiene credenciales de Supabase), así que en cuanto
esta pieza permite cambiar roles, el token queda viejo para siempre. No es escalada —RLS manda— pero
es una pantalla que miente. `capacidades.ts` reemplaza los 20 booleanos editables del origen por una
tabla derivada y read-only donde **cada fila cita el símbolo exacto de la política que la sostiene y
el test lo busca en el archivo**: un renombre en la base tira el test antes de que la pantalla empiece
a mentir. Se agregan `/usuarios` y `/usuarios/:id` (sin altas: crear una cuenta es crearla en Supabase
Auth), y la **integración de retorno** con la pieza 1 —el `<input placeholder="uuid del usuario
responsable">` pasa a ser un selector de miembros—. Un bug real que encontró su test: `[value]` en un
`<select>` se aplica antes de que existan las `<option>` del `@for`, así que el responsable guardado
se descartaba en silencio.

Verificado **en el navegador** (MCP chrome-devtools, API real sobre PGlite, tema claro y oscuro,
consola sin errores) con los tres roles, y forzando los rechazos por fuera de la UI: maestro→otro
`200`, equipo→otro `403`, cliente→otro `404`, auto-degradación `403`, `servicio` `400`, `cliente` sin
negocio `400`.

## 2026-08-02 — Pieza 1 del portal de la agencia: gestión de clientes (CRM), mergeada a `main`

Primera de cuatro piezas del [programa del portal de la agencia](../docs/superpowers/plans/2026-08-01-portal-agencia-programa.md):
lleva las cuatro pantallas de clientes del Angular viejo (`dashboard-project`, Firestore + NgRx) al
portal de AMG OS, con Postgres bajo RLS y API propia. Ejecutada con
`superpowers:subagent-driven-development` en un worktree aparte — `main` no se tocó ni una vez.

**Qué hay:** migración `0011_clientes_crm.sql` (tipo, industria, etiquetas, nivel de actividad,
estado de contrato, score, asignado a, contacto en jsonb, origen — **ningún grant nuevo a
`app_render`, la allowlist pública sigue exponiendo exactamente `brand, locations, menu, name,
priceRange`**); la clase `PgClientes` (`db/src/clientes.ts`); los endpoints `GET/POST /clients`,
`GET/PATCH /clients/:id`, `POST /clients/:id/archive` y `/desarchivar`; la capa de datos del portal
(`ClienteApi`, `ClienteAgencia`, `ClientesService` con signals); y las cuatro pantallas —listado,
alta, perfil (cuatro cards editables inline) y una vista con tres pestañas de **datos de ejemplo**
(ideas, Instagram, reseñas de Google — ninguno de los tres tiene backend en AMG OS todavía; decisión
explícita del usuario, portar la pantalla con mocks y decidir el cableado real después).
**Sin sucursales/`business_profile.locations`**: se difirió a propósito (toca el pipeline público del
renderizador, ADR-19, y merece su propio plan con tests de seguridad dedicados).

**Lo que encontró la revisión final de rama, y no cualquier revisión por etapa:** la política
`client_select` (existente, `0001_init.sql`, sin tocar por esta pieza) es RLS **por fila**, no por
columna — un usuario con rol `cliente` ya podía leer su propia fila de `clients` entera. Antes de esta
pieza eso era inofensivo; la `0011` le agregó a esa misma fila columnas que son **notas internas de la
agencia sobre ese cliente** (`contacto.notas`, `score`, `estado_contrato`, `asignado_a`). Cada revisión
por etapa preguntó "¿puede escribir el rol cliente?" (no) y "¿lo lee `app_render`?" (no) — ninguna
preguntó "¿qué más puede LEER el rol cliente de su propia fila, ahora que hay más ahí?". **Cerrado el
mismo día**: `db/src/clientes.ts` enmascara las 10 columnas de CRM a `null` para quien no sea staff,
con un `case when app.es_staff() then <col> else null end` — la MISMA función que ya usan las
políticas RLS, evaluada dentro de Postgres, no un `if` de TypeScript. La primera versión usaba la
forma denylist (`= 'cliente'`), que un rol NULL/desconocido dejaba pasar sin enmascarar — corregido a
la allowlist positiva (`app.es_staff()`). Verificado por mutación.

## 2026-08-01 (cierre del día) — Tres arreglos que salieron de manejar la app, no de la suite

Verificar el re-seed **en el portal** (y no solo por consulta) destapó que la primera siembra había
corrido doce minutos antes de `f0c1387`: en producción, **Cartera y Research mostraban las mismas
métricas con nombres distintos**, a dos clics. El re-seed desde `HEAD` lo cerró, y ahora
`db/src/cartera-portal.test.ts` ata las dos copias campo por campo — el comentario que declaraba esa
atadura *imposible* («el portal vive fuera del monorepo») era falso: eso impide importar el paquete,
no leer el archivo. Además, **el contraste de los ejes en oscuro** pasó de **1.53:1 a 11.49:1** (31
etiquetas que ApexCharts pintaba con su gris, invisible para `contraste.test.ts` porque no sale de
`styles.css`), y **`npm run typecheck` dejó de pisar `dist/portal`** con el bundle de desarrollo. Los
tres, con rojo primero y verificación por mutación.

## 2026-08-01 (mañana de la demo) — El renderizador está desplegado

La web del cliente dejó de vivir en `localhost`:
[`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app) sirve **La
Birra Bar** desde internet, leyendo de Supabase con `app_render`. Es medio Fase 2 en producción, y se
hizo **con la reunión encima** porque el riesgo estaba acotado: un **servicio nuevo**, sin tocar
`main`, ni el portal, ni la API — el peor caso era no llegar y seguir con `localhost`.

Verificado en el navegador, no por el "✔" del deploy: las 5 rutas en 200, 14 páginas enlazadas,
`/menu` con 3 categorías, `/blog` con los 2 artículos, footer con los 2 locales, y JSON-LD por tipo
(`LocalBusiness` en landings, `Article` en blogs). Y el aislamiento comprobado **con savepoints**:
`app_render` no puede leer `business_profile` crudo, ni `kr_runs`, ni `memberships`.

**Cuatro tropiezos que dejaron enseñanza** (todos en el
[runbook](../docs/proyecto/14-runbook-despliegue.md#desplegar-el-renderizador-fase-2)): el DSN quedó
con el usuario `amg_api` al copiarlo —lo que habría dado al proceso anónimo la credencial de la API,
no un typo sino ADR-17 roto—; el **session pooler (5432) aceptó una conexión y rechazó la siguiente
con la misma password**, así que el DSN va por **6543**; el dominio se agregó primero al servicio **de
la API**, donde habría servido la API en vez de la web; y los primeros 404 eran **caché negativa** del
propio renderizador, que vence sola.

## 2026-08-01 — El re-seed de producción, en un comando (y la `0010` que faltaba aplicar)

El paso 0 de los próximos pasos (re-sembrar Supabase) pedía exportar tres variables a mano, y la forma
obvia de hacerlo —`DATABASE_URL_ADMIN=… npm run seed:demo -w db`— deja la password de ADMIN en el
historial de la shell, justo lo que `db/.env.example` advierte. Ahora hay `npm run reseed:demo`: lee
las tres de `docs/private/credenciales.env` (la fuente única), **valida antes de conectar**, muestra a
qué base va con la password tapada y pide confirmación. Invoca el CLI del seed **sin `--env-file`** a
propósito: `db/.env` es generado y puede estar desincronizado de la fuente, y no se apuesta una
escritura en producción a la precedencia entorno-vs-`--env-file`. De paso caza un fallo silencioso que
el CLI no veía —si los UUID de Frank y Juan son el mismo, la segunda membresía upserta sobre la
primera y Frank pierde `maestro` sin que nada avise—.

**Y se corrió: producción quedó re-sembrada.** 1 cliente (La Birra Bar; el italiano ya no está), 14
páginas con el split 8/6 intacto, 0 aprobadas, run en `pending_approval`, y el `app_metadata` de los
dos usuarios ya apuntaba al tenant correcto — todo **verificado por consulta contra Supabase**, no por
el "✔" del comando. La consulta destapó un pendiente que el re-seed no toca: **la migración `0010` no
estaba aplicada en producción**, así que `business_profile_publico` exponía solo `brand, name,
priceRange` y los locales y la carta se filtraban en silencio. **Aplicada el 2026-08-01**
(`npm run migrate:deploy -w db`) y verificada por consulta: las **10** migraciones en el registro, y la
allowlist ahora deja pasar `brand, locations, menu, name, priceRange` — **2 locales y 4 items de carta**
públicos.

## 2026-08-01 — El cliente de la demo, unificado

Se preguntó qué le faltaba al portal para una demo completa y la respuesta no fue una funcionalidad:
**las tres pantallas hablaban de tres negocios distintos**. El dashboard listaba seis restaurantes
inventados, el brief mostraba el italiano de ejemplo (`db/src/seed-demo.ts` seguía sembrando "Bella
Napoli") y la web servía **La Birra Bar** — el recorrido de tres golpes contaba tres historias sin
relación en tres clics. Ahora el seed, el dashboard y el `dev-server` de la API son el mismo cliente, y
**un test ata el perfil del seed a `web-builder/business-profile.json`** para que la deriva no pueda
repetirse en silencio.

## 2026-08-01 — La navegación del sitio del cliente, mergeada a `main`

El sitio público mostraba una barra armada con los títulos SEO de todas las páginas de investigación —
parecía un blog, no el sitio de un restaurante. Reemplazada por Inicio/Menú/Ubicaciones/Contacto fijos,
un footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. 10 tareas (9 planeadas + una
migración de Postgres que apareció como gap real durante la ejecución), revisadas una por una más una
revisión final de rama, más una revisión externa (Codex) que encontró 4 hallazgos reales (la allowlist
de Postgres no validaba la *forma* de los valores, solo el nombre de la clave; `locations` tenía la
precedencia invertida contra su propio comentario; los topes de tamaño se aplicaban tarde; `/blog` se
autoenlazaba con una story real) — los 4 corregidos y verificados por mutación. Detalle en el
[plan](../docs/superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente.md).

## 2026-08-01 — Las cuatro piezas de la demo con Frank, resueltas

Pieza A (login ES256), pieza B (modo oscuro del portal) y pieza C (dashboard de cartera) mergeadas a
`main`; la pieza D (research en vivo durante la demo) quedó **desaconsejada** con datos reales. La
demo está lista para mostrarle a Frank: lo que sigue es trabajo de producto, no de preparación de demo.

## 2026-07-30 — Acción 06: la corrida final contra producción

Research real para **La Birra Bar** (14 páginas, $0.3097), republicado en Storyblok con `kr.v0.5` y
verificado en el navegador. Midió por primera vez cuánto tarda un research real —**16m15s**, por encima
del umbral de ~12 min que la pieza D necesitaba para mostrarse en vivo en la demo— así que **la pieza D
queda desaconsejada tal como se la había imaginado**.

## 2026-07-30 — El login estaba roto en producción; la pieza A lo arregló

C.8 —manejar la app en el navegador— destapó lo que la verificación desde afuera no podía ver: todo
login terminaba en `401 Token inválido o expirado`. **El proyecto de Supabase firma con `ES256`** (se
creó el 2026-07-25, ya con claves asimétricas) y la API solo aceptaba `HS256` con un secreto
compartido. No era un error de despliegue: era deuda de contexto en el código.

Es la lección de siempre, otra vez: **verificar desde afuera y manejar la app encuentran cosas
distintas.** `/health` daba 200, el CORS aceptaba solo el portal, el `401` sin token era correcto — y
aun así nada funcionaba para un usuario real.

**Cerrado el 2026-07-30: Juan se logueó en `bigballs.es`.** Y hasta ese momento no estaba cerrado, a
propósito: entre el merge (2026-07-27) y ese login hubo tres días en que el código correcto ya estaba
desplegado y el estado seguía siendo 🟡, porque *20/20 chequeos de `/health` en 200* prueban que
`emisorSupabase` aceptó la variable de entorno y **nada más**. `/health` responde igual con el código
viejo, y un token basura da 401 con los dos. **No había ninguna señal externa que distinguiera
"arreglado" de "roto"** — solo entrar y loguearse.

## 2026-07-25 — Fase 1 desplegada

El portal en [`bigballs.es`](https://bigballs.es) (Hostinger, autodeploy desde `main`), la API en
`api.bigballs.es` (Railway, `europe-west4`) y la base con RLS forzada en Supabase (`eu-west-2`).
