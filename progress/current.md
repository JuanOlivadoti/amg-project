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

**Dónde está AHORA:** **las 9 tareas del plan están cerradas** con revisión limpia, Y **la ronda de
fixes antes del merge también está cerrada** (commit `70dcf27`). Despachados dos subagentes en
paralelo sin cruce de archivos (`datos` para `db/`+`api/`, `front` para `portal/`): la carrera de
`revisar` arreglada con `and revisado_en is null` en el `where` de `marcarRevisada`, la prima `<= 0`
rechazada en el provider de OpenAI, y los cuatro menores del portal (dead code de `Subscription`,
destructuración redundante, XOR simétrico, comentario de `MembresiaService.resolver()`). Los dos
agentes verificaron sus mutaciones con restauración confirmada. Al correr el gate completo, la sesión
principal encontró y arregló DOS problemas de integración que ninguno de los dos agentes había tocado:
el test nuevo de la carrera comparaba `revisadoEn` como `string` (su tipo declarado) cuando en runtime
es un `Date` (el driver de `pg` lo devuelve así para `timestamptz` — discrepancia preexistente, ahora
documentada inline, no arreglada de raíz); y `filas.test.ts` (Task 7) tenía un `assert.throws` con un
`undefined` de más que rompía el typecheck y que ninguna revisión anterior había cazado porque
`npx tsx --test` no typechequea. **Verificación final conjunta, todo verde:**
`bash ./scripts/verificar.sh --con-portal` → 2035 tests del monorepo, typecheck limpio, 357 `node:test`
del portal; Karma 305/305 (303 + 2, del test del XOR). **No hay Task 10.** Falta cerrar el plan: los
pendientes de integración (env-sync, calibración del preflight), el review final de rama, manejar la
app en un navegador, actualizar `09`/`15`, y el merge.

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
| — | (progreso, no es tarea) | `3cfb647`, `c71c032` |
| 6 | Los cuatro endpoints | `7edafe7` ✅ revisada |
| — | (progreso, no es tarea) | `8638ca5`, `b4533bb` |
| 7 | El navegador convierte la hoja | `3f05e23` ✅ revisada |
| — | (progreso, no es tarea) | `89e0a16`, `f05a8ab` |
| 8 | Pantalla de carga + `ApiService` | `88ed782` ✅ revisada |
| 9 | Resultado + gate + historial + tab + rutas | `f3d1399` ✅ revisada |
| — | Ronda de fixes antes del merge (carrera de `revisar`, prima ≤0, menores del portal) | `70dcf27` |
| — | `OPENAI_API_KEY`/`OPENAI_MODEL`/`COMPARATIVAS_MODO` reparten hacia `api/` | `98cd8c1` |
| — | Fix: el `<input type="file">` nativo no se limpiaba visualmente en el XOR (hallado en el navegador) | `8e8d4c6` |
| — | Review final de rama (opus): CAMBIOS_PEDIDOS 3 bloqueantes, ya cerrados + docs `09`/`15` | `e487791` |

Los 18 commits de la rama están **sin pushear** (`git log --oneline origin/main..HEAD`): la rama es local.

## En vuelo (sin commitear)

**Nada, working tree limpio** (`git status --short` vacío), salvo este mismo archivo mientras se
actualiza. Las 9 tareas y la ronda de fixes están commiteadas y verificadas juntas (`70dcf27`).

## Próximo paso

**El plan está terminado en código y documentación. Solo falta el merge (con confirmación del
usuario) y, opcional, avisos a Juan.**

1. ✅ **La review final de rama volvió CAMBIOS_PEDIDOS (3 bloqueantes), los 3 ya están cerrados**
   (commit `e487791`): `COMPARATIVAS_MODO` clasificada en el catálogo de credenciales (rompía
   `verificar.sh`), test nuevo de que el rol `cliente` no puede cerrar el gate (con mutación
   confirmada sobre la política RLS), y `09`/`15` actualizados. Más 4 menores (topes de longitud
   movidos antes de llamar al provider, tres comentarios corregidos).
2. ✅ **Verificación final, corrida DOS veces de forma independiente** (el subagente y la sesión
   principal por separado): `bash ./scripts/verificar.sh --con-portal` → **exit 0, todo verde** —
   la primera corrida completa de toda la rama. 2038 tests del monorepo, 357 `node:test` + 306 Karma
   del portal.
3. **Lo único que falta:**
   - Mencionarle a Juan el riesgo de bus-factor de `read-excel-file` (toda la cadena de dependencias
     depende de una sola cuenta de npm) — informativo, no bloquea el merge.
   - **Merge a `main` con `--no-ff`, y push** — pedir confirmación del usuario antes de hacerlo, es
     una acción visible sobre rama compartida.
   - Calibrar la proporción caracteres/token del preflight de gasto contra una corrida real de OpenAI
     queda **pendiente y fuera del alcance del merge** — cuesta dinero real, la corre Juan o la
     autoriza explícitamente. El default `mock` no la necesita.
   - **Apagar los dos procesos de desarrollo** que quedaron corriendo para la prueba manual en
     navegador: `npm run dev:server -w api` (puerto 3000) y `npm --prefix portal run start` (puerto
     4200). Ninguno de los dos afecta al merge, pero no hace falta dejarlos vivos.

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
- **Los commits de progreso van FUERA del rango revisado** (2026-09-13). En la Task 3 uno quedó dentro
  y hubo que avisarle al revisor que lo ignorara. Desde la Task 5: se commitea `progress/current.md`
  después del commit de la tarea, y el `BASE` de la siguiente es el último commit antes de despacharla.
- **Los briefs dicen QUÉ suite correr, no solo "en foreground"** (2026-09-13). La suite entera de `api`
  tarda decenas de minutos, ninguna tarea la necesita y es la que los implementadores mandan a
  background. Se corre una sola vez al cerrar el plan con `verificar.sh`. Para `app.test.ts`, filtrar
  con `--test-name-pattern` mientras se itera — con la salvedad de los Callejones.
- **`COMPARATIVAS_MODO` elige el provider** (2026-09-13, resuelto al despachar la Task 6 porque el plan
  no lo fijaba): valores `mock|openai`, leída en `leerConfig` de `api/src/deps.ts`, **default `mock`** y
  un valor inválido **lanza al arrancar** (mismo criterio que `GOOGLE_REVIEWS_MODO`). Se descartó un
  default derivado de la API key, como el de `BORRADOR_RESENAS_MODO`: acá el default tiene que ser el que
  no gasta, y el mock ya se marca como mock en informe y mail.
- **Orden del `POST /clients/:id/comparativas-seguros`: lo que no gasta, primero** (2026-09-13): forma
  del body (400 si vienen las dos formas o ninguna) → vertical (409, **antes** de bajar nada o llamar al
  LLM) → filas → provider → `crear` **solo si el provider salió bien**. Entrada mala es 400, el provider
  negándose es 422, nunca 500 y nunca una fila huérfana.
- **Se aceptó que la Task 6 tocara `api/src/dev-server.ts` y cuatro archivos de test fuera de su lista**
  (2026-09-13): `ApiDeps` ganó dos campos obligatorios y el typecheck obliga a cada constructor a
  cablearlos. El revisor confirmó que ahí solo hay cableado.
- **La carrera de `revisar` se arregla antes del merge, no dentro de la Task 6** (2026-09-13). El revisor
  la confirmó real pero no bloqueante para la tarea: el arreglo va en `db/`, fuera de sus archivos, y el
  test secuencial que pedía el brief pasa. Se descartó dejarla como menor para después del merge: toca el
  control central del módulo —quién revisó— y la doctrina del repo es que esa garantía la imponga la
  base, no un `if` de la API.
- **El parser de CSV del portal va en un módulo puro, `portal/src/app/core/csv.ts`** (2026-09-13, al
  despachar la Task 7). El test cruzado corre en Node e importa ese archivo por ruta; si viviera en el
  mismo archivo que usa la librería de `.xlsx`, el `import` desde Node podría reventar antes de probar
  nada. El plan decía importar `hoja-a-filas.ts`; se cambió por esta razón técnica.
- **La librería de `.xlsx` del portal es `read-excel-file@9.3.10`, CONFIRMADA** (2026-09-13, Task 7),
  import `read-excel-file/universal`. MIT, 4 dependencias directas, sin scripts de instalación. Se
  descartaron `xlsx` (última versión en el registro de npm del 2022-03-24) y `exceljs` (9 dependencias,
  no pensada para el navegador). La revisión despejó las dos señales: `worker-f` y `unzipper-esm` son
  del **mismo mantenedor** y la ráfaga de versiones es su propio desarrollo. **Riesgo residual
  aceptado:** toda la cadena depende de una sola cuenta de npm; se le menciona a Juan al merge.
- **Las celdas de `.xlsx` salen con fechas en ISO y números en decimal de JS** (2026-09-13, Task 7), no
  con el formato regional de la planilla (`portal/src/app/core/hoja-a-filas.ts:57-58`). Para que un LLM
  interprete cotizaciones, ISO es preferible; la presentación la decide quien lo muestre.
- **La pantalla de carga navega a una ruta que registra la Task 9** (2026-09-13, al despachar la Task 8):
  `['/clientes', clienteId, 'comparativas', id]`. La Task 8 no toca `app.routes.ts` para no pisar a la 9;
  su test solo comprueba el `router.navigate`. Además: todo error se pinta (un rechazo de `hojaAFilas`
  corta antes de llamar a la API), y el botón se deshabilita en vuelo porque cada generación cuesta.
- **La ronda de fixes se despachó en DOS subagentes en paralelo, no uno solo** (2026-09-14): `datos`
  para `db/`+`api/`, `front` para `portal/`. Los archivos no se cruzaban, así que corrieron a la vez sin
  riesgo de pisarse. Se descartó un único subagente transversal: hubiera tenido que cargar las
  convenciones de las tres áreas a la vez sin ganar nada.
- **El chequeo de "ya resuelto" en `MembresiaService.resolver()` se descartó, no se implementó**
  (2026-09-14, Fix 4 de la ronda pre-merge). `refrescar()` (usado por `cambiarRol`) reutiliza
  `resolver()` invalidando solo `enVuelo`, no un hipotético `_resueltoPara`: un chequeo de "ya resuelto
  para este userId" en `resolver()` habría hecho que `refrescar()` devolviera sin pedir nada, rompiendo
  la re-lectura de membresía tras cambiar un rol. Se corrigió el comentario que sobreestimaba la
  deduplicación en vez de arreglar el código a medias — documentado en
  `portal/src/app/pages/comparativas/resultado.ts:241-250`.
- **La discrepancia de tipo en `revisadoEn` (declarado `string`, runtime `Date`) NO se corrigió de
  raíz** (2026-09-14, al integrar la ronda de fixes). Es preexistente a este plan, el cast
  `as Parameters<typeof aComparativa>[0]` en `db/src/comparativas-seguros.ts` la esconde, y arreglarla
  bien implica revisar todo lo que consume `ComparativaSeguros.revisadoEn` (serialización JSON hacia el
  portal incluida) — fuera del alcance de una ronda de fixes acotada. Se documentó inline en el test
  afectado y queda como deuda conocida, no como bloqueante.

## Callejones sin salida

*(Se añaden, no se borran.)*

- **Despachar la Task 1 con Opus falló por límite de sesión** (2026-09-12). No dejó nada a medias: el
  árbol quedó limpio, sin archivos ni commits. Relanzada con Sonnet, salió bien a la primera. **No
  reintentes con Opus antes de que el límite se restablezca** — el agente muere sin escribir informe.
- **Sonnet TAMBIÉN se agotó por límite de sesión** (2026-09-14), no solo Opus. El primer intento de la
  Task 8 murió sin dejar archivos, igual que los de Opus en la Task 5. Reset avisado a las 17:20 de
  Madrid. Relanzada con **Haiku**, el único modelo con cupo en ese momento — salió bien. **Confirmado
  que el límite ya se restableció**: la Task 9 se despachó con Sonnet sin problema y está corriendo.
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
  esperándolo. Lo que funciona es acotar qué suite correr (ver Decisiones): desde la Task 6, con la
  lista explícita de suites, ningún implementador volvió a colgarse. En cambio, **nombrar el patrón de
  las constantes de producción sí funcionó**: el test que fija `MAX_COSTO_USD` por literal apareció a la
  primera (`api/src/comparativas/provider.test.ts:233`).
- **"El árbol está limpio" puede dejar de ser cierto entre dos comandos mientras corre un revisor**
  (2026-09-13). El `revisor` muta y restaura archivos para comprobar los tests: se vio
  `api/src/comparativas/openai-provider.ts` modificado a mitad de una mutación y, un comando después,
  ya restaurado. No commitear ni tocar un archivo de código que aparezca modificado mientras hay una
  revisión en curso; y al documentar, escribir el estado de forma que sobreviva a eso.
- **Las citas de línea del revisor pueden venir corridas** (Task 5, 2026-09-13). Dio
  `openai-provider.ts:258-259` para la validación de la prima (era la de "sin opciones"; la real es
  `:212-213`) y `provider.test.ts:645-646` para un `3` mágico en un archivo de 258 líneas (la real es
  `:250`). Se habían copiado al ledger y a este archivo sin mirarlas. **Verificar cada cita leyendo el
  archivo antes de copiarla** — desde la Task 6 se buscan con `grep` en vez de copiarse.
- **Filtrar un archivo de tests por nombre da una verificación engañosamente parcial** (Task 6,
  2026-09-13). `--test-name-pattern="comparativa"` sobre `api/src/app.test.ts` agarró 4 tests, cuando la
  tarea agregó 20: muchos no llevan esa palabra en el título. Pasó en verde y parecía verificado. Lo
  cubrió el revisor corriendo el archivo entero. **Contar primero cuántos tests nuevos declara el
  informe y comprobar que la corrida dé ese número.** En la Task 7 se aplicó y cuadró: 332 + 11 = 343.
- **Confiar en el tipo declarado de un campo, sin verificar el runtime, rompió un fix** (ronda pre-merge,
  2026-09-14). El agente `datos` escribió un test que comparaba `revisadoEn` como si fuera un `Date`
  (`getTime()`), correcto. La sesión principal, al ver que el TYPECHECK decía `revisadoEn: string |
  null`, "corrigió" el test a comparación directa de string — y rompió el test en runtime, porque el
  driver de `pg` sí devuelve un `Date` para `timestamptz`, pese al tipo declarado. El typecheck y el
  runtime no siempre cuentan la misma historia cuando hay un `as` de por medio (acá,
  `as Parameters<typeof aComparativa>[0]`). **Lección:** cuando el typecheck y el comportamiento
  observado en la corrida real se contradicen, confiar en la corrida real y tratar el tipo declarado
  como sospechoso, no al revés.
- **Un subagente de un área puede introducir un typecheck roto que su propio `npx tsx --test`
  filtrado no detecta** (ronda pre-merge, 2026-09-14). `tsx --test` corre sin typechequear; el
  `assert.throws(fn, undefined, msg)` de la Task 7 (preexistente, no de esta ronda) solo salió a la luz
  al correr `npm run verificar` completo. Ningún brief de esta ronda pedía typecheck explícito porque
  se asumía que ya estaba limpio de tareas anteriores — no lo estaba. **Correr el typecheck completo es
  parte del cierre, no algo que se pueda inferir de que los tests pasen.**

## Archivos calientes

- `.superpowers/sdd/2026-09-12-comparativas-seguros/progress.md` — **el ledger**, ya con la ronda de
  fixes cerrada documentada. Manda sobre la memoria tras un `/compact` o un reinicio. Gitignoreado
  (`.gitignore:67`).
- `progress/informes/fix-premerge-datos.md` y `fix-premerge-front.md` — los informes de los dos
  subagentes de la ronda de fixes, con el detalle de cada mutación. Gitignoreados.
- `scripts/env-sync.mts` — donde falta repartir `OPENAI_API_KEY`/`OPENAI_MODEL` hacia `api/`. Es lo
  próximo que falta tocar.
- `db/src/comparativas-seguros.ts:39` — el tipo `revisadoEn: string | null` que en runtime es un
  `Date` (deuda documentada, no arreglada — ver Decisiones).

## Verificaciones

- **Último verde completo, DESPUÉS de la ronda de fixes (commit `70dcf27`):**
  `bash ./scripts/verificar.sh --con-portal` → **2035** tests del monorepo, typecheck limpio (7
  paquetes + `scripts/` + portal), sin secretos, **357** `node:test` del portal. Karma, corrido aparte:
  **305/305** (303 + 2, los del Fix 3 del XOR simétrico).
- **`npm test -w db`** (tras el fix de la carrera): **523/523**. **`npx tsx --test
  api/src/comparativas/provider.test.ts`** (tras el fix de la prima): **25/25**.
- Falta, para el cierre del plan: manejar la app en un navegador real (MCP chrome-devtools) y volver a
  correr `verificar.sh --con-portal` + Karma sobre el estado final, después de la review final de rama.

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
