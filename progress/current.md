# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** iniciativa nueva — generalizar AMG OS a cualquier tipo de cliente, no solo restauración.
**En curso (2026-08-28): el sub-proyecto 2 quedó IMPLEMENTADO Y CERRADO.** Se decidió partir el
pedido en **tres sub-proyectos independientes**, cada uno con su propio spec → plan → revisión
externa (Codex), ejecutados en serie (uno se implementa antes de arrancar el diseño del
siguiente — decisión explícita, no en paralelo):

1. **Multi-vertical de clientes** (restauración + correduría de seguros) — **diseño y plan
   completos, sin implementar.**
2. **Desacoplar keyword research de creación de webs** — **implementado y cerrado (2026-08-28),
   con una revisión final (2026-08-29) que encontró 4 hallazgos más — los cuatro corregidos, ver
   la sección del sub-proyecto 2 abajo.**
3. **Publicar posts a un blog ya existente en otra plataforma** — **diseño y plan completos, sin
   implementar.**

Los tres tuvieron spec+plan revisados por Codex, más una revisión exhaustiva conjunta (ver más abajo,
ya cerrada). El sub-proyecto 2, que el orden fijado exigía primero, ya tiene código real y pasó una
revisión final propia (no solo la conjunta de los tres). **Qué sigue:** implementar el 1 o el 3 (en
cualquier orden entre ellos, pero siempre en serie) — ver "## Próximo paso" más abajo para el detalle.

## En vuelo (sin commitear)

Nada — working tree limpio (`git status --short` vacío, verificado 2026-08-30). La revisión final
del sub-proyecto 2 dejó 4 commits sin pushear (`a2fec1c`, `c37de0a`, `82237bc`, `b1ed4d3`), encima
de `cb3a314` (el commit de cierre, tampoco pusheado) — 29 commits por delante de `origin/main` en
total.

## Próximo paso

1. Decidir si pushear los 29 commits pendientes a `origin/main` ahora (el ritual pide push al
   cerrar cada etapa, y la revisión final del sub-proyecto 2 ya cerró) o esperar a acumular más.
2. Elegir sub-proyecto 1 (multi-vertical de clientes) o 3 (publicar posts en blog externo) para
   implementar — cualquier orden entre ellos, pero **siempre en serie**, nunca en paralelo (comparten
   archivos: `db/src/store.ts`, `api/src/app.ts`, `orchestrator/src/workflow.ts` y sus tests). Los
   dos tienen spec+plan completos y pasados por la revisión conjunta — arrancar directo con
   `superpowers:subagent-driven-development` sobre el plan elegido.
3. Antes de la primera task de cualquiera de los dos: correr `ls db/migrations` para confirmar el
   número real que le toca a la migración del plan elegido (los tres planes numeraban `0027`/`0028`
   sin cruzarse — ver `docs/proyecto/15-plan-plataforma.md`) y decidir si desplegar la `0027`
   (`kr_run_decisiones`, del sub-proyecto 2, todavía sin desplegar a producción a propósito) junto
   con la migración del siguiente.

**Decisión de secuencia (2026-08-26, confirmada con el usuario):** los tres sub-proyectos se diseñan
uno por uno (spec + plan + revisión de Codex, igual que el 1) **sin implementar** hasta tener los tres
"aterrizados". Recién ahí: una ronda de revisión **exhaustiva y general** (esta sesión + Codex) sobre
los tres a la vez, y después arranca la implementación. El motivo: los tres tocan superficies
superpuestas (perfil de cliente, catálogo, portal), y revisarlos juntos antes de tocar código evita
descubrir una incompatibilidad entre sub-proyectos recién al implementar el tercero.

**Orden de implementación (fijado durante la revisión conjunta, 2026-08-26): sub-proyecto 2 primero,
1 y 3 después — en cualquier orden entre ellos, pero SIEMPRE en serie, nunca en paralelo.** No es
una preferencia — lo exige una dependencia real que ninguna de las dos revisiones individuales había
detectado: la Task 9 del sub-proyecto 1 y la Task 8 del sub-proyecto 3 modifican código que solo
existe una vez que `workflowDecision` (introducido por el sub-proyecto 2) está implementado. El
sub-proyecto 2 retira el mecanismo viejo de aprobación-y-publicación-inline de `workflowResearch`
(donde vive hoy el código que la Task 9 del sub-proyecto 1 pensaba editar) y lo traslada, con otra
forma, a `workflowDecision`. 1 y 3 no dependen LÓGICAMENTE entre sí (tocan ramas distintas de esa
misma función: `crear_web` y `crear_posts`), **pero sí comparten archivos** (`db/src/store.ts`,
`api/src/app.ts`, `orchestrator/src/workflow.ts` y sus tests, ronda 2 de la revisión conjunta,
hallazgo Major) — ejecutarlos con dos agentes a la vez sobre el mismo working tree arriesga que se
pisen las ediciones. Serializar, no paralelizar.

**Migraciones: los tres planes numeraban 0027/0028 sin cruzarse** (sub-proyecto 1: `0027_clientes_vertical.sql`
+ `0028_nap_publico_vertical.sql`; sub-proyecto 2: `0027_kr_run_decisiones.sql`; sub-proyecto 3:
`0028_posts_blog_externo.sql`, ya con el hedge de verificar el número real). Los tres planes ahora
llevan la misma advertencia: verificar `ls db/migrations` antes de crear el archivo — el número real
depende del orden de implementación de arriba, no está fijo en el documento.

## Sub-proyecto 1 — Multi-vertical de clientes: estado detallado

- **Spec:** [`docs/superpowers/specs/2026-08-26-multivertical-clientes-design.md`](../docs/superpowers/specs/2026-08-26-multivertical-clientes-design.md).
  Escrita, revisada por Codex una vez (veredicto NECESITA REDISEÑO → 1 Critical + 6 Major + 2 Minor,
  los 9 corregidos e incorporados al documento).
- **Plan:** [`docs/superpowers/plans/2026-08-26-multivertical-clientes.md`](../docs/superpowers/plans/2026-08-26-multivertical-clientes.md).
  15 tasks (db → web-builder/renderer → orchestrator → api → portal → verificación). Revisado por
  Codex una vez (veredicto NECESITA REDISEÑO → 1 Critical + 8 Major + 4 Minor, los 13 corregidos e
  incorporados al plan). **Ninguna task se ejecutó todavía** — cero código tocado, cero migración
  aplicada.
- **Informes de las dos rondas de Codex**, guardados tal cual llegaron:
  [`progress/informes/codex-multivertical-clientes.md`](informes/codex-multivertical-clientes.md)
  (ronda sobre el spec) y
  [`progress/informes/codex-multivertical-plan.md`](informes/codex-multivertical-plan.md) (ronda
  sobre el plan, con la clasificación completa de los 13 hallazgos y qué cambió por cada uno).
- **Decisión de implementación que NO estaba en el pedido original del usuario, ya confirmada:** los
  tipos `MenuItem`/`MenuCategoria` y los endpoints `GET`/`PATCH /clients/:id/menu` **no se renombran**
  a `Catalogo*`/`/catalogo` — el spec original lo proponía, se revirtió por costo/beneficio (ver
  "Global Constraints" del plan y la sección "API" del spec).
- **Qué falta para este sub-proyecto:** nada de diseño — está listo para pasar a
  `superpowers:subagent-driven-development` cuando le toque el turno de implementación (después de que
  los sub-proyectos 2 y 3 tengan su spec+plan, según la decisión de secuencia de arriba). Si se decide
  adelantar la implementación de este antes de diseñar los otros dos, es un cambio de secuencia
  explícito a confirmar con el usuario, no algo que se pueda asumir leyendo este archivo solo.

## Sub-proyecto 2 — Desacoplar keyword research de creación de webs: IMPLEMENTADO (2026-08-28), revisión final cerrada (2026-08-29)

- **Spec:** [`docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`](../docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md)
  y **plan:** [`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`](../docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md)
  (12 tasks), ambos revisados por Codex — ver el historial de revisión de cada documento para el
  detalle de hallazgos.
- **Las 12 tasks ejecutadas con `superpowers:subagent-driven-development`** — implementador y
  revisor independiente por task, con fix rounds donde hizo falta. Retiró `RunSinWorkflowError`/
  `approveRun`/`RUN_SIN_WORKFLOW` de punta a punta (`db`, `orchestrator`, `api`, `portal`),
  introdujo `kr_run_decisiones` (migración `0027`, sin desplegar todavía a propósito — ver `09`) y
  partió `workflowResearch` en investigación (sin publicar) + `workflowDecision` (bifurca por
  destino, releído siempre bajo RLS, nunca del evento).
- **Hallazgo real encontrado al implementar, no anticipado por ninguna de las dos rondas de Codex
  sobre el plan:** un fallo de `emisor.send()` después de que `registrarDecision` ya insertó la fila
  dejaba la decisión `pendiente` para siempre (el índice único parcial bloqueaba cualquier otra sobre
  el mismo run). Cerrado con `PgStore.compensarAprobacionFallida` — revierte el run a
  `pending_approval` SOLO si no hay una decisión previa ya completada (protege el camino retomable).
- **Tropiezo real de esta etapa:** el plan se implementó DOS VECES en paralelo, en dos worktrees
  distintos, sin que ninguna sesión supiera de la otra (`EnterWorktree` ramificó desde `origin/main`,
  9 commits detrás del `main` local, en vez de desde el `main` local real). Detectado a mitad de
  camino, comparadas ambas implementaciones (mismo diff, mismos hallazgos independientes), se adoptó
  la más completa y se descartó la otra — sin pérdida real, ninguna había llegado a `main`. Detalle
  completo en la entrada del `09` de esta fecha.
- **Qué falta para este sub-proyecto:** nada — cerrado. `npm run verificar --con-portal`: 1725 tests
  del monorepo + 300 `node:test` y 213 Karma del portal, todos en verde. Un hueco explícito y
  documentado (no oculto): el camino positivo de "Construir la web ahora" no se verificó end-to-end
  en un navegador real (requiere Postgres real compartido entre API y orquestador) — cubierto en
  cambio por 7 tests de Karma contra datos mockeados. El resto del flujo sí se verificó contra la API
  real en un navegador.
- **Revisión final del sub-proyecto 2 (2026-08-29): 4 hallazgos más, los cuatro corregidos y
  commiteados (sin pushear todavía).** No hay un informe de Codex separado para esta ronda — los
  hallazgos y su corrección quedaron documentados en el cuerpo de cada commit:
  1. **[Critical] Runs bricked de verdad, no solo en la carrera de doble aprobación.** Los tres
     cierres en error de `workflowDecision` (cliente archivado, cero páginas publicables, y el
     `onFailure` de `crearFuncionDecision` tras agotar reintentos) usaban `cerrarDecision` en vez de
     `compensarAprobacionFallida`. Un run cuya PRIMERA decisión caía en cualquiera de esas tres
     ramas quedaba `approved` sin ninguna decisión `completado`, y el `WHERE` retomable de
     `registrarDecision` nunca lo volvía a calificar (`NULL = 'solo_informe'` es `NULL`, no `true`)
     — bloqueado para siempre salvo SQL manual. Commit `a2fec1c`
     (`db/src/store.ts`, `orchestrator/src/functions.ts:110-122`, `orchestrator/src/workflow.ts:365-404`):
     los tres call sites ahora usan `compensarAprobacionFallida`; agregado también el desempate
     `, id desc` en las dos consultas que ordenan por `decidido_en` y el prefijo `kr_runs.` en
     `RUN_SUMMARY_COLS` (evita una futura columna ambigua en el `left join lateral` de
     `getRunConUltimaDecision`).
  2. **[Important] El selector de destino y "Confirmar" se mostraban en cualquier estado del run**,
     incluido `approved` sin decisión retomable — el caso común tras la primera decisión exitosa —,
     y confirmar ahí siempre devolvía 409 `TRANSICION_INVALIDA`: la misma confusión que el retiro
     del gate `tiene_workflow` debía eliminar, reintroducida de otra forma. Commit `b1ed4d3`
     (`portal/src/app/pages/brief/brief.ts:390-424`): `puedeDecidirseRunUI()` nuevo (`pending_approval`
     siempre califica, `approved` solo si `esRetomable()`), y "Construir la web ahora" ahora respeta
     `motivoNoAprobar()` en su `[disabled]`, no solo `trabajando()`.
  3. **[Important] Dos comentarios (`portal/src/app/core/features.ts`,
     `portal/src/environments/environment.prod.ts`) describían la compuerta vieja** (un
     `paso.esperarEvento` dentro de un único workflow, sin listener de `research/aprobado`) —
     literalmente falso desde que este sub-proyecto agregó `crearFuncionDecision`. Sobrevivieron
     porque el diff que retiró el mecanismo nunca tocó estos dos archivos, solo el código que
     describían. Corregido en `82237bc`.
  4. **[Minor] El 501 de `crear_posts` usaba el literal `"NO_IMPLEMENTADO"` inline** en vez de una
     constante en `codigos.ts` (la fuente única que el test de sincronía porta-api exige). Promovido
     a constante en `c37de0a`, junto con el retiro de un branch muerto en `api/src/app.ts`
     (`err.message.includes("ninguna página aprobada")`, ya no alcanzable desde que
     `registrarDecision` devuelve `null` en vez de lanzar esa cadena).

## Sub-proyecto 3 — Publicar posts a un blog externo: estado detallado

- **Spec:** [`docs/superpowers/specs/2026-08-26-publicar-posts-blog-externo-design.md`](../docs/superpowers/specs/2026-08-26-publicar-posts-blog-externo-design.md).
  Escrita, autorevisada, revisada por Codex una vez (veredicto NECESITA REDISEÑO → 3 Critical + 5
  Major + 1 Minor + 1 Nit, los 10 corregidos e incorporados al documento — sección "Historial de
  revisión" con la tabla completa). Los más caros: el reintento de publicación era simultáneamente
  imposible (el propio spec lo bloqueaba) y capaz de duplicar posts (la analogía con el borrador de
  reseñas se rompe: responder una reseña es idempotente por naturaleza, crear un post no); y los
  grants de `clients` NO cubren columnas nuevas automáticamente (a diferencia de `kr_pages`) — la
  0021/0022 angostaron `clients` a grants por columna para `app_user` y `app_service` por igual.
- **Informe de Codex**, guardado tal cual llegó:
  [`progress/informes/codex-publicar-posts-spec.md`](informes/codex-publicar-posts-spec.md).
- **La dependencia con `registrarDecision` (hallazgo #7 de la ronda de Codex sobre el spec) ya está
  resuelta, no solo flaggeada:** se enmendó directamente el plan del sub-proyecto 2
  (`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`, Task 3 y su "Historial de revisión") —
  `registrarDecision` ya exige página aprobada también para `crear_posts`, con sus tests. Edición de
  documento de diseño, no de código.
- **Corrección de ruta encontrada al escribir el plan (no fue un hallazgo de Codex):** la ruta real
  de edición de páginas es `PATCH /pages/:id` (plana), no `/clients/:id/pages/:pageId` como decía la
  primera versión del spec — corregido en ambos documentos.
- **Plan:** [`docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md`](../docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md).
  12 tasks (migración → `db` → `orchestrator` → `api` → portal → verificación), autorevisado,
  revisado por Codex una vez (veredicto NECESITA REDISEÑO → 2 Critical + 4 Major + 4 Minor, los 10
  corregidos e incorporados — sección "Historial de revisión" con la tabla completa). Los más caros:
  las Tasks 8 y 9 originales no eran ejecutables (firma inventada de `workflowDecision`, helpers de
  test que no existen, un wiring que hubiera desregistrado `crearFuncionDecision` del sub-proyecto 2
  en producción) — reescritas enteras contra el contrato real de
  `docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`; y una publicación fallida dejaba el post
  bloqueado para siempre (agregada la columna `post_error_en` + `marcar_post_fallido`).
  **Depende de que el sub-proyecto 2 esté implementado antes de la Task 8 en adelante** — las Tasks
  1-7 (migración, capa de datos, piezas aisladas del orquestador) no dependen de eso. Solo
  `MockBlogPublisher` en este plan — ninguna plataforma real (WordPress u otra) sin cliente
  confirmado. **Ninguna task se ejecutó todavía.**
- **Informe de Codex de esta ronda**, guardado tal cual llegó:
  [`progress/informes/codex-publicar-posts-plan.md`](informes/codex-publicar-posts-plan.md).
- **Qué falta:** nada de diseño individual — los tres sub-proyectos de la iniciativa tienen spec+plan
  completos, cada uno con sus rondas de Codex procesadas.

## Revisión exhaustiva conjunta de los tres sub-proyectos (2026-08-26) — en curso

Mi propia pasada (antes de la ronda de Codex) encontró dos hallazgos reales que ninguna revisión
individual podía ver — cada plan se había revisado contra el código de HOY, y el conflicto solo
existe *entre* dos planes:

1. **[Serio] El sub-proyecto 1 dependía, sin saberlo, del sub-proyecto 2.** La Task 9 del plan
   multi-vertical (`docs/superpowers/plans/2026-08-26-multivertical-clientes.md`) editaba
   `orchestrator/src/workflow.ts:342-346` — la construcción de `deps.publicar(...)` dentro de
   `workflowResearch`. El plan del sub-proyecto 2 **retira ese bloque entero** de `workflowResearch`
   (el mecanismo de aprobación-y-publicación-inline) y traslada el mismo `deps.publicar(...)`, sin
   `vertical`, a la rama `crear_web` de la función nueva `workflowDecision`. **Corregido:** la Task 9
   se reescribió apuntando a la ubicación nueva (buscada por contenido, no por línea), con una
   precondición ejecutable al principio, mismo criterio que ya llevaba la Task 8 del sub-proyecto 3.
2. **[Serio] Colisión de numeración de migraciones.** Los tres planes numeraban `0027`/`0028` sin
   cruzarse entre sí (sub-proyecto 1: dos migraciones, `0027` y `0028`; sub-proyecto 2: `0027`;
   sub-proyecto 3: `0028`, tentativo). **Corregido:** los tres llevan ahora la misma advertencia de
   verificar `ls db/migrations` antes de crear el archivo, y el número real queda atado al orden de
   implementación (ver abajo).
3. **[Menor, corregido igual]** El prompt de `OpenAIPostProvider` (sub-proyecto 3) decía "negocio
   gastronómico" sin condición — lenguaje incorrecto para un cliente de correduría de seguros
   (sub-proyecto 1). Se hizo `vertical` un parámetro OPCIONAL de `PostProvider.generar`, con una base
   de prompt genérica y un contexto por vertical que se agrega solo si `vertical` está disponible —
   deliberadamente opcional, para no atar el sub-proyecto 3 al orden de implementación del 1.
4. Notado, sin acción necesaria: los sub-proyectos 1 y 2 tocan los mismos archivos "core" del portal
   (`api-core.ts`, `models.ts`) — no es un defecto, solo algo para tener presente al integrar en
   serie (leer el archivo real, no fiarse de los números de línea del plan que va segundo).

**Orden de implementación fijado, consecuencia directa del hallazgo 1:** sub-proyecto 2 primero — el
1 y el 3 dependen de código que ese sub-proyecto introduce (`workflowDecision`). 1 y 3 no dependen
LÓGICAMENTE entre sí (tocan ramas distintas de esa misma función), pero SÍ en serie — ver la
corrección de la ronda 2, abajo.

Documentos tocados por mi pasada (ronda 1, antes de Codex): los tres planes (Task 1 de multi-vertical
y de desacoplar-kr-web con el hedge de migración; Task 9 de multi-vertical reescrita; Tasks 4 y 8 de
publicar-posts con `vertical` opcional), más este archivo y el `09`.

### Ronda 2 — Codex sobre la revisión conjunta (2026-08-26)

Veredicto: NECESITA REDISEÑO. 4 hallazgos (1 Critical, 3 Major), los cuatro verificados y aplicados:

1. **[Critical] `crear_posts` seguía inalcanzable después de los tres planes.** El sub-proyecto 2
   deja `POST /runs/:id/approve` con un `501` explícito, `aprobarRun` tipado sin `crear_posts`, y el
   selector del portal con la opción deshabilitada tras un feature flag — y el plan del sub-proyecto
   3, pese a que su spec promete "retira ese rechazo", nunca lo hacía. Agregados: Task 10 Step 0.1
   (retira el `501`, amplía el `400`) y Task 11 Step 0 (`aprobarRun` acepta `crear_posts`, la opción
   del selector deja de estar `disabled`, `destinoPosts: true` **solo en `environment.ts` de dev** —
   `environment.prod.ts` queda en `false` a propósito, decisión de lanzamiento separada, confirmada
   con el usuario).
2. **[Major] La Task 4 del sub-proyecto 1 pisaba `archived_at`.** Daba un bloque de reemplazo
   completo de `ClientRow`/`getClient` con `vertical` que omitía la columna `archived_at` que el
   sub-proyecto 2 ya había agregado ahí — reescrita como edición aditiva, con precondición ejecutable.
3. **[Major] `crear_posts` no heredaba la protección contra clientes archivados** que sí tiene
   `crear_web` — agregado el mismo chequeo (`cliente.archived_at !== null` → error) a la Task 8 del
   sub-proyecto 3, confirmado con el usuario.
4. **[Major] 1 y 3 no son seguros en paralelo literal** — comparten archivos (`db/src/store.ts`,
   `api/src/app.ts`, `orchestrator/src/workflow.ts` y sus tests) aunque no dependan lógicamente entre
   sí. Corregida la redacción de "en cualquier orden, o en paralelo" a "en cualquier orden, pero
   siempre en serie" en las dos menciones de este archivo.

Informe completo: [`progress/informes/codex-revision-conjunta.md`](informes/codex-revision-conjunta.md).

## Qué sigue

Ver "## Próximo paso" al principio de este archivo — el sub-proyecto 2 (con su revisión final) está
cerrado, quedan el 1 y el 3, spec+plan completos, listos para implementar en serie.

## Archivos calientes

- [orchestrator/src/workflow.ts:365-404](../orchestrator/src/workflow.ts#L365-L404) — los tres
  cierres en error de `workflowDecision` (cliente archivado, cero páginas publicables) usan
  `compensarAprobacionFallida`, no `cerrarDecision` — es el fix del bug Critical de la revisión
  final (commit `a2fec1c`).
- [orchestrator/src/functions.ts:110-122](../orchestrator/src/functions.ts#L110-L122) — el
  `onFailure` de `crearFuncionDecision` (agotados los reintentos) usa el mismo
  `compensarAprobacionFallida`.
- [db/src/store.ts:383-398](../db/src/store.ts#L383-L398) — `RUN_SUMMARY_COLS` prefijado con
  `kr_runs.`; y las dos consultas retomables (`registrarDecision` ~L1400, `getUltimaDecision`
  ~L1551) con el desempate `, id desc`.
- [portal/src/app/pages/brief/brief.ts:390-424](../portal/src/app/pages/brief/brief.ts#L390-L424) —
  `esRetomable()`/`puedeDecidirseRunUI()` nuevos, gatean el selector de destino y "Confirmar" por
  el estado real del run, no solo rol+flag.
- `api/src/codigos.ts`, `portal/src/app/core/codigos.ts` — `NO_IMPLEMENTADO` promovida a constante
  (antes literal inline en `api/src/app.ts`).

## Verificaciones

- **`npm run verificar` (sin `--con-portal`): VERDE** (corrido 2026-08-30, invocado como
  `bash ./scripts/verificar.sh` porque `npm run verificar` a secas falla en esta sesión de Git
  Bash — resuelve el script vía `cmd.exe` en vez de respetar el shebang; investigar el
  `script-shell` de npm si se repite). Entorno, arnés, higiene de secretos (655 archivos
  versionados, ninguno con secretos), typecheck (7 paquetes + `scripts/`) y 1725 tests del
  monorepo, todos en verde. Portal: typecheck limpio + 300 tests `node:test`, también verde.
- **`npm --prefix portal run test:components` (Karma): VERDE — 218/218** (corrido aparte, 2026-08-30,
  porque `npm run verificar` sin `--con-portal` no los incluye). Sube de 213 a 218: los 5 tests
  nuevos del gate `puedeDecidirseRunUI()`/`esRetomable()` (commit `b1ed4d3`,
  `portal/src/app/pages/brief/brief.spec.ts`) están adentro y pasan. **La revisión final del
  sub-proyecto 2 queda así totalmente verificada** — gate completo + Karma, ambos en verde.

## Deuda no relacionada, heredada de antes de esta iniciativa (sin tocar, no bloquea)

- Rotación de credenciales expuestas en `docs/private.zip` (riesgo de seguridad real, pospuesto por
  decisión de Juan el 2026-08-04) — ver `docs/proyecto/15-plan-plataforma.md § Riesgo abierto`.
- Acceso real a la Business Profile API de Google, bloqueado por trámite externo de Juan.
- `CACHE_TTL_MS` en Railway sin fijar al valor real del SLA (Bloque G).
- OBS-04 y el precio de la salida gestionada (Bloque H) — decisiones de negocio de Juan.
