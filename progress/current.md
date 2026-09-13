# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión (2026-09-10 → 13):** el checklist de decisiones de Juan, el **lote corto entero** que salió
de él (3 etapas, cerradas y pusheadas a `main`), y ahora **la ejecución del plan de comparativas de
seguros** con `superpowers:subagent-driven-development` — implementador + revisor por tarea, en la
rama `feature/comparativas-seguros`.

**Dónde está AHORA:** van **4 de 9 tareas** cerradas con revisión limpia. La **Task 5 está
implementada y commiteada** (`8a13953`: provider real de OpenAI, preflight de gasto y regla de fallar
en vez de inventar) y **su revisión está corriendo** en segundo plano con el agente `revisor`. No hay
nada a medio escribir: el árbol está limpio. La Task 5 costó tres intentos — dos con Opus murieron por
límite de sesión sin dejar archivos, el tercero con Sonnet salió — y el implementador volvió a quedarse
esperando un proceso en background; hubo que retomarlo con `SendMessage` para que commiteara.

| | Etapa / Tarea | Commit |
|---|---|---|
| — | Checklist de decisiones de Juan (cierra **OBS-04**) | `428571b` (en `main`) |
| — | Guardarraíl de «Conectar Google» en modo mock | `c82399f` (en `main`) |
| — | Reescritura de **ADR-11** | `223abb2` (en `main`) |
| — | Snapshot estático de salida (cierra el lote corto) | `68132bf` (en `main`) |
| — | Plan de comparativas de seguros, 9 tareas | `8f666dd` (en `main`) |
| pre | Corrección del plan en el pre-flight | `cc1d610` |
| 1 | Migración `0033` + `PgComparativasSeguros` | `be6a8ca` ✅ revisada |
| 2 | Parser de CSV + topes | `6adb0e9..5d1bc4f` ✅ revisada |
| 3 | Bajar el Google Sheet | `476f90b..889e290` ✅ revisada |
| — | (progreso, no es tarea) | `c25128a` |
| 4 | Provider: interfaz + mock | `c914a5c..89aef3d` ✅ revisada |
| 5 | Provider OpenAI + preflight de gasto | `8a13953` ✅ revisada |
| — | (progreso, no es tarea) | `3cfb647` |

Los 11 commits de la rama están **sin pushear** (`git log --oneline origin/main..HEAD`): la rama es local.

## En vuelo (sin commitear)

**Nada de la sesión principal: working tree limpio** salvo `progress/current.md`, que se está
actualizando ahora. **Ojo, un estado que va y viene:** mientras la revisión de la Task 5 corre, el
agente `revisor` muta y restaura `api/src/comparativas/openai-provider.ts` para comprobar los tests
(se lo vio a mitad de la mutación de "aceptar confianza baja", `if (false && json["confianza"] !== "alta")`,
con respaldo en `$TEMP/openai-provider.ts.bak`; un comando después ya estaba restaurado a `HEAD`).
**No lo toques ni lo commitees si aparece modificado.** Si la sesión se corta y queda modificado:
`git checkout -- api/src/comparativas/openai-provider.ts` — `8a13953` tiene la versión buena.

Lo único en vuelo es la **revisión de la Task 5**. No commitea nada, pero sí toca el árbol mientras muta y
restaura archivos para comprobar los tests (ver arriba). Su informe va a
`.superpowers/sdd/2026-09-12-comparativas-seguros/task-5-review.md` (gitignoreado).

## Próximo paso

1. **Leer el veredicto de la revisión de la Task 5** en
   `.superpowers/sdd/2026-09-12-comparativas-seguros/task-5-review.md`.
   - Si es **CAMBIOS_PEDIDOS**: despachar **un solo** subagente de fix con todos los hallazgos
     bloqueantes, pidiéndole foreground y **qué suite correr** (`npx tsx --test
     api/src/comparativas/provider.test.ts` y `npm run typecheck`, **no** `npm test -w api`). Después,
     regenerar el paquete con `review-package 89aef3d HEAD` y re-revisar.
   - Si es **APROBADO**: marcar la Task 5 `[x]` en el ledger.
2. **Despachar la Task 6** (los cuatro endpoints). **El brief ya está extraído** en
   `.superpowers/sdd/2026-09-12-comparativas-seguros/task-6-brief.md`. Anotar el `HEAD` antes de
   despachar: es el `BASE` del paquete de revisión. Agente `datos`, modelo `sonnet`. En el prompt:
   foreground obligatorio, **no correr `npm test -w api` entero** sino los tests de los endpoints
   nuevos, y el patrón de las constantes de producción si declara alguna.
3. **Seguir con las tareas 7 a 9** con el mismo ciclo. Los briefs se sacan con el script `task-brief`
   (`$HOME/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/skills/subagent-driven-development/scripts/`)
   sobre `docs/superpowers/plans/2026-09-12-comparativas-seguros.md`.
4. **Antes del cierre, dos pendientes de integración que dejó la Task 5** (anotados en el ledger):
   agregar `OPENAI_API_KEY`/`OPENAI_MODEL` al reparto de `scripts/env-sync.mts` hacia `api/`, y calibrar
   la proporción caracteres/token del preflight con una corrida real (cuesta dinero: la corre Juan o la
   autoriza).
5. **Al terminar las nueve**: review final de rama con el modelo más capaz disponible, manejar la app
   en un navegador con el provider mock, `bash ./scripts/verificar.sh --con-portal`, actualizar `09`/`15`,
   y merge a `main` con `--no-ff`.

**El ledger manda sobre la memoria**:
`.superpowers/sdd/2026-09-12-comparativas-seguros/progress.md`. Una tarea marcada `[x]` ahí está hecha —
no la relances.

## Decisiones tomadas

*(Se añaden, no se borran. Las de las etapas anteriores siguen más abajo en este archivo.)*

- **La ejecución va en rama simple `feature/comparativas-seguros`, sin worktree** (2026-09-12, Juan).
  Es lo que ya hicieron el módulo de Ideas y el sub-proyecto 3; el worktree se descartó por la
  indirección que Juan pidió evitar para poder levantar la app en local.
- **El `.xlsx` lo convierte el NAVEGADOR; la API nunca recibe un binario** (2026-09-12, Juan). Misma
  doctrina que el PDF (2026-08-07). Se descartó meter una librería de parsing de binarios en el
  servicio autenticado. El link de Google Sheet es la excepción y lo baja el servidor, porque **CORS
  impide al navegador hacerlo** — pero baja texto, no un binario.
- **`parsearCsv` LANZA ante una comilla sin cerrar** (2026-09-13, al revisar la Task 2). Sin cambiar
  su firma. Se descartó documentar la limitación: fusionar filas en silencio le daría al LLM datos
  mezclados sin que nada avise, que es el fallo que el propio plan prohíbe («media comparativa que
  parece completa es peor que un error, porque un corredor la manda»).
- **`CASOS_CSV` y `CASOS_CSV_INVALIDOS` viven en `filas.test.ts`, no en `filas.ts`** — una fixture no
  va en el código que se despliega, y el test cruzado de la Task 7 vive en ese mismo archivo.
- **Sonnet como modelo por defecto de los implementadores.** Opus se agotó por límite de sesión y
  además la skill dice usar el modelo más barato que sirva: los briefs de este plan llevan el código,
  así que la mayoría son transcripción más verificación.
- **La Task 4 se hizo con Haiku** (2026-09-13): el brief traía la interfaz y los tests escritos. Salió
  bien — no redeclaró `OpcionSeguro`, que era el riesgo real — y lo que se le escapó (el mail sin marca
  de mock) lo cazó la revisión. El corte de modelo fue correcto para esa tarea.
- **La marca de mock va en el informe Y en el mail, asunto y cuerpo** (2026-09-13, revisión de la Task 4).
  El mail es el entregable que se copia con un botón y sale al cliente final sin pasar por la vista del
  informe. Se reusó la misma constante `PREFIJO_MOCK_COMPARATIVA` en vez de un tag corto aparte, con
  `PREFIJO_MOCK_POST` como precedente; la re-revisión lo dio por bueno.
- **`PLAZO_DESCARGA_MS` y `MAX_REDIRECCIONES` de `sheet.ts` se fijan por literal en un `describe` de
  defaults** (2026-09-13, revisión de la Task 3), con rangos tomados del criterio de `snapshot.test.ts`.
- **La Task 5 se relanza con Sonnet y no se espera a Opus** (2026-09-13). Esperar al reset bloqueaba el
  plan entero por una tarea; se compensa exigiéndole a la revisión más dureza que a las demás.
- **Los commits de progreso van DESPUÉS del commit de la tarea, nunca en medio de su rango** (2026-09-13).
  En la Task 3 uno quedó dentro del rango revisado y hubo que avisarle al revisor que lo ignorara; en la
  Task 5 se commiteó `progress/current.md` recién tras `8a13953`.
- **Los briefs dicen QUÉ suite correr, no solo "en foreground"** (2026-09-13). La suite entera de `api`
  tarda decenas de minutos, ninguna tarea la necesita y es la que los implementadores mandan a
  background. Se corre una sola vez al cerrar el plan con `verificar.sh`.

## Callejones sin salida

*(Se añaden, no se borran.)*

- **Despachar la Task 1 con Opus falló por límite de sesión** (2026-09-12). No dejó nada a medias: el
  árbol quedó limpio, sin archivos ni commits. Relanzada con Sonnet, salió bien a la primera. **No
  reintentes con Opus antes de que el límite se restablezca** — el agente muere sin escribir informe.
- **El agente `render` NO está registrado en esta sesión**, aunque `.claude/agents/render.md` existe y
  `verificar.sh` cuenta los 5 agentes. Se usó `general-purpose` cargándole las skills del área
  (`render-seguridad`, `render-plantillas`, `render-cda-cache`) y funcionó. Para que aparezca hay que
  reiniciar la sesión.
- **Un heredoc de bash para escribir el plan se rompió** con las comillas y backticks del contenido.
  Para documentos con bloques de código, usar la herramienta `Write`, no `cat <<EOF`.
- **La Task 5 con Opus falló DOS veces más por límite de sesión** (2026-09-12 y 2026-09-13; el último
  aviso dice que se restablece a las 3:30 de Madrid). Ningún intento dejó archivos. Opus no es
  confiable en esta ventana: no planificar nada crítico que dependa de él hasta después del reset.
- **Un subagente que lanza un proceso con `run_in_background` NO recibe su notificación** (Task 3,
  2026-09-13). Se quedó esperando `npm test -w api`, terminó el turno sin commitear ni escribir informe,
  y hubo que retomarlo con `SendMessage` pidiéndole foreground. Es el mismo patrón que el `09` ya
  documentó en el sub-proyecto 3.
- **Tener el molde delante no transmite la salvaguarda** (Task 3, 2026-09-13). El implementador copió
  de `renderer/src/snapshot.ts` el `plazoMs` inyectable pero no el `describe` de defaults que ese mismo
  archivo tiene para fijar el valor de producción. **Tercera vez en tres días** del mismo fallo: una
  constante que ningún test fija porque los tests eligen el parámetro.
- **Advertir en el brief contra el background NO alcanza** (Task 5, 2026-09-13). El brief lo prohibía
  en mayúsculas y el implementador igual lanzó `npm test -w api` en background y terminó el turno
  esperándolo. Lo que funciona es acotar qué suite correr (ver Decisiones). En cambio, **nombrar el
  patrón de las constantes de producción sí funcionó**: el test que fija `MAX_COSTO_USD` por literal
  apareció a la primera (`api/src/comparativas/provider.test.ts:233`).

## Archivos calientes

- `.superpowers/sdd/2026-09-12-comparativas-seguros/progress.md` — **el ledger**. Manda sobre la
  memoria tras un `/compact` o un reinicio. Gitignoreado (`.gitignore:67`).
- `.superpowers/sdd/2026-09-12-comparativas-seguros/task-5-review.md` — el veredicto que se espera
  ahora (todavía no existe mientras corre la revisión).
- `.superpowers/sdd/2026-09-12-comparativas-seguros/task-6-brief.md` — ya extraído, listo para
  despachar en cuanto la Task 5 quede aprobada.
- `api/src/comparativas/openai-provider.ts` — lo que se está revisando: el preflight y la validación
  de la respuesta del LLM.
- `api/src/comparativas/provider.test.ts:233` — el test que fija `MAX_COSTO_USD` por literal.
- `api/src/comparativas/provider.ts` — el selector `getComparativaProvider`; la Task 5 cableó el
  camino `"openai"`.
- `scripts/env-sync.mts` — donde falta repartir `OPENAI_API_KEY`/`OPENAI_MODEL` hacia `api/` (pendiente
  de integración de la Task 5).
- `db/src/comparativas-seguros.ts` — la capa de acceso de la Task 1, con un menor pendiente en el
  docstring de `crear` (anotado en el ledger para el review final).

## Verificaciones

- **`npm run verificar`: NO corrido en esta rama.** Se deja para el cierre del plan: la suite entera
  de `api` tarda decenas de minutos y no aporta por tarea.
- **Último verde completo conocido:** `bash ./scripts/verificar.sh --con-portal` sobre `main`
  (`68132bf`): **1947** tests del monorepo, typecheck limpio, sin secretos, **332** `node:test` del
  portal. Karma: **278**.
- **Verde por tarea en esta rama, corrido por la sesión principal con salida real** (no tomado de los
  informes): Task 1 → `db` 522/522 y typecheck limpio; Task 2 →
  `npx tsx --test api/src/comparativas/filas.test.ts` 13/13; Task 3 →
  `npx tsx --test api/src/comparativas/sheet.test.ts` 17/17; Task 4 →
  `npx tsx --test api/src/comparativas/provider.test.ts` 5/5; Task 5 → el mismo comando, 23/23.

---

# Historial de esta sesión (etapas ya cerradas y pusheadas a `main`)

> Lo que sigue es el registro de las etapas **ya cerradas y pusheadas** de esta sesión. Se conserva
> porque explica decisiones que siguen vigentes, pero **no describe el estado actual**: para eso, la
> parte de arriba.

**Sesión (2026-09-10 → 12):** el checklist de decisiones de Juan, y después **el lote corto entero**
que salió de él. **Las tres etapas están hechas y revisadas**; la tercera es la que se commitea ahora.

| | Etapa | Commit |
|---|---|---|
| — | Checklist de decisiones de Juan (cierra **OBS-04**) | `428571b` |
| 1 | Guardarraíl de «Conectar Google» en modo mock | `c82399f` |
| 2 | Reescritura de **ADR-11** | `223abb2` |
| 3 | **Snapshot estático como entregable** | revisado y corregido; se commitea con este cambio |

**Con la etapa 3, el Bloque H se queda sin trabajo de código y a ADR-11 le falta UNA sola cosa: los
dos importes de Juan.**

### Etapa 3 del lote corto — el snapshot estático (ya commiteado en `68132bf`)

El **snapshot estático de salida** (ADR-11). Implementado por un subagente sobre un contrato fijado
por la sesión principal; la documentación, por la sesión principal.

    npm run snapshot -w renderer -- <dominio> <directorio-destino>

Produce `index.html`, `<slug>/index.html`, `_assets/fonts/` y `_assets/img/`, **con las imágenes
descargadas** — decisión del usuario, y es lo que hace honesta la cláusula: el entregable no depende
de que siga viva ninguna cuenta de Storyblok.

**Lo que más importa de cómo se hizo:** la paridad con el sitio vivo se impone **por construcción**.
La decisión «qué HTML le toca a cada slug» se **extrajo** del handler de `app.ts` a
`renderer/src/pagina.ts`, y ahora la comparten el servicio y el snapshot. Copiar las reglas habría
cumplido la letra del contrato y fallado a los seis meses: una regla nueva se cambia en un sitio y el
snapshot se desincroniza **sin error y sin log**. Los 178 tests del renderizador siguieron en verde
sin tocar ninguno, que es la prueba de que la extracción no cambió comportamiento.

**Verificado en un navegador** (lo que ningún test ve, y en esta pieza el entregable ES lo que se ve):
6 páginas, 10 imágenes, 7 tipografías, **cero peticiones a hosts externos** y **cero JavaScript
ejecutable**. (Esta frase decía «ni un `<script>` que no sea `application/ld+json`», y el `revisor` la
comprobó en cinco segundos contra los artefactos: es falsa. Hay **dos** tipos de `<script>` — el
JSON-LD y el `<script type="application/json" id="research-trace">` de las landings. Ninguno es
ejecutable y el sitio vivo ya los emite, pero la frase no se sostenía.)

### Hallazgos del snapshot estático

1. **Los emisores de `<img>` eran CUATRO, no tres.** El contrato enumeraba tres y avisaba de que esa
   multiplicidad ya había sorprendido al proyecto (Bloque E). Faltaba `renderVideo`, que emite
   `<video src>` **y** `poster`. El escaneo final no va por emisor sino por **posición fetchable**, así
   que el quinto entra solo.
2. **Dos mutaciones no hicieron caer nada**, y las dos destaparon tests que pasaban por el motivo
   equivocado: el de `og:image` (lo salvaba que el JSON-LD trae la misma URL) y el filtro del índice
   de la home, que **no lo fijaba ningún test, ni antes ni después**. El de paridad no lo ve: una
   mutación en el código *compartido* mueve los dos lados igual. Es la debilidad conocida de un test
   de paridad, ahora escrita. Los dos tests que faltaban, agregados.
3. **🔴 `brand.tema` no cruza TRES de las cuatro fronteras: hoy ningún cliente puede tener modo
   oscuro.** No es del snapshot **y no es nueva**: estaba **declarada como deuda desde el 2026-08-10**
   en el `15` (Bloque E, Etapa 1), sin arreglar. La sesión principal la presentó primero como hallazgo
   fresco y con dos fronteras en vez de tres; lo corrigió el `revisor`, y tenía razón en lo que
   importa: **el dato no es que se descubrió, es que se conocía y se dejó pasar un mes.** El CSS
   oscuro existe y `ensamblarCss` lo emite solo con `brand.tema === "auto"`, pero `tema` no está en el
   `brandSchema` de Zod, ni lo construye la allowlist de `app.nap_publico`, ni lo copia `perfilValido`.
   Sube a `09` § Deuda conocida con dueño; la fila del `15` Bloque I ahora **enlaza** en vez de
   duplicar. **No se arregló acá**: son los tres arreglos que la nota de agosto ya enumeraba.


### Lo que corrigió la revisión del snapshot (CAMBIOS_PEDIDOS, 4 bloqueantes)

Veredicto textual del `revisor`: *«el código está bien; lo que no está cerrado es la documentación de
la propia etapa y tres constantes de producción que ninguna mutación tumba»*.

1. **[Bloqueante] Tres defaults de producción sin test.** Mutó `PLAZO_DESCARGA_MS = 15000 → 1`,
   `MAX_REDIRECCIONES = 3 → 0` y `ARCHIVO_INFORME → "otro-nombre.txt"`, y **no cayó ni un test** en las
   tres. La causa es literalmente la de `CHECKPOINTS.md`: los tests que cubrían esos caminos **elegían
   el parámetro** (`plazoMs: 30`, un solo salto rechazado), así que ejercitaban la mecánica y no el
   valor de producción; y el del informe **importaba la constante y la componía**, comparándose consigo
   mismo. Consecuencia real: con `PLAZO_DESCARGA_MS = 1` todo snapshot de producción habría salido con
   código 2 y las fotos rotas, con el arnés en verde. Los tres fijados por valor, mutación confirmada.
2. **[Bloqueante] El `15` se contradecía consigo mismo.** La etapa actualizó «El orden que recomiendo»
   pero **no la sección del Bloque H**, que es la que trata este trabajo — y `16-pendientes-juan.md`
   seguía diciéndole a Juan que faltaban **dos** cosas para firmar ADR-11 cuando falta una.
3. **[Bloqueante] `brand.tema` presentada como hallazgo nuevo, y con el conteo mal.** Ver arriba.
4. **[Bloqueante] ADR-11 promete el nombre `_snapshot-informe.txt` y ningún test lo fijaba.** Incluido
   en el punto 1.

**Menores corregidos:** la frase de los `<script>` (ver arriba); la **precedencia de clase
`contenido` > `social`** no tenía test —era la decisión de seguridad más sutil del archivo, sostenida
solo por su comentario, porque en las fixturas las dos URLs son siempre distintas— así que se extrajo
a `referenciasDe()` para poder ejercitarla, con su mutación; y se incorporó al docstring de
`hostAlcanzable` la **medición** del `revisor` (las formas decimal, hexadecimal, octal y corta de una
IPv4 las normaliza `new URL` antes de llegar, así que la regex no se esquiva) para que no se
re-litigue en cada revisión.

**Lo que el `revisor` dio por bueno con evidencia propia:** la extracción `app.ts` → `pagina.ts` es
fiel caso por caso (comparó el bloque borrado contra el nuevo línea a línea, y confirmó que el
`conBridge` invertido es equivalente porque la única rama que no lo llevaba era la del `null`); siete
de sus nueve mutaciones cayeron exactamente donde debían; y auditó los artefactos reales del navegador
en vez de creerle al relato.
### Deuda que dejó el snapshot estático

- **`file://` no sirve**: las rutas son absolutas a propósito (es lo que evita reescribir enlaces).
  Cualquier hosting estático vale.
- **El directorio de destino no se limpia**: regenerar sobre uno usado deja páginas viejas. Borrar
  recursivamente una ruta que nos pasan por argumento es destructivo sobre algo que no controlamos.
- **El camino feliz del CLI con credenciales reales** no lo cubre ningún test de subproceso — no se
  puede sin credenciales. Sí está cubierto todo lo demás, con dependencias inyectadas.
- **El `favicon.ico` da 404**, en el snapshot y en la web viva. Preexistente, pero en un entregable a
  cliente se nota más.

### (histórico) El próximo paso de entonces, ya hecho

1. Verificación completa, **`revisor`**, y commit + push.
2. ✅ **El plan de comparativas de seguros está escrito** (2026-09-12):
   `docs/superpowers/plans/2026-09-12-comparativas-seguros.md`, 9 tareas. Falta **ejecutarlo**. Lo
   anterior decía: el `writing-plans` sobre la spec aprobada
   (`docs/superpowers/specs/2026-09-04-comparativas-seguros-design.md`). Dos cosas a mirar con lupa:
   el **preflight de presupuesto** del provider real y el **parsing de formato libre**.
3. **Lo que espera de Juan:** los dos importes de la salida gestionada (lo único que separa a ADR-11
   de ser firmable); poner `CACHE_TTL_MS=60000` en Railway; comprobar si hay algún cliente con
   conexión de Google en producción; y, opcional, si quiere que la salida self-hosted se ofrezca.

### Verificaciones de aquella etapa

- `bash ./scripts/verificar.sh --con-portal`: **1947 tests del monorepo** en verde (sube de 1900),
  typecheck limpio (7 paquetes + `scripts/`), sin secretos, 332 `node:test` del portal. Confirmado con
  la salida real. `renderer` pasó de 178 a **225** (219 del subagente + 6 al corregir la revisión).
- **Karma NO se re-corrió, y es correcto**: esta etapa no tocó ni un archivo de `portal/`. Sigue en
  278 desde el commit del guardarraíl.
- **Revisión del código de descarga hecha por la sesión principal**, no solo por el informe:
  redirecciones manuales revalidadas en cada salto, tope por `content-length` declarado **y** por
  bytes reales del stream, plazo con `Promise.race` (no solo la señal), y el guard de hosts internos
  **declarado como parcial** —no hay resolución de DNS, así que un nombre que resuelva a 127.0.0.1
  pasa igual— en vez de vendido como completo.
