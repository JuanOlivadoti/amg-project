# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** iniciativa nueva — generalizar AMG OS a cualquier tipo de cliente, no solo restauración.
**En curso (2026-08-29): sub-proyecto 2 CERRADO y mergeado a `main` local. Sub-proyecto 1
(multi-vertical de clientes) EN IMPLEMENTACIÓN, worktree `multivertical-clientes`.**

1. **Multi-vertical de clientes** (restauración + correduría de seguros) — **en implementación, ver
   detalle abajo.** Worktree: `C:\Users\oliva\Documents\projects\AMG\.claude\worktrees\multivertical-clientes`,
   rama `worktree-multivertical-clientes`, rebasada sobre el `main` local real (no `origin/main`).
2. **Desacoplar keyword research de creación de webs** — **implementado, cerrado y mergeado a `main`
   local (2026-08-28/29).** `main` local queda 20 commits adelante de `origin/main` — el `git push`
   está BLOQUEADO por el clasificador de auto mode del harness (pidió confirmación explícita del
   usuario y la dio, pero el clasificador lo frena igual) — pendiente: el usuario agrega una regla de
   permiso de Bash, o pushea él mismo desde la terminal.
3. **Publicar posts a un blog ya existente en otra plataforma** — **diseño y plan completos, sin
   implementar.**

**⚠️ Si esta sesión se compactó y estás retomando desde acá:** el ledger vivo de la skill
`subagent-driven-development` para el sub-proyecto 1 está en
`.superpowers/sdd/progress.md` **dentro del worktree** `multivertical-clientes` — ese archivo NO está
en git (gitignoreado a propósito, es scratch de la skill), así que solo existe en el disco de esta
máquina. Leelo primero, tiene el detalle task-por-task con hallazgos y commits. Este archivo
(`progress/current.md`) da el resumen de alto nivel; el ledger da el detalle de ejecución.

### Estado exacto del sub-proyecto 1 al momento de este checkpoint (2026-08-29)

- **Task 1 (migración `clients.vertical`): COMPLETA.** Migración real `0029_clientes_vertical.sql`
  (no `0027` — ya ocupados por el sub-proyecto 2). Incluye, tras un fix round del reviewer, un trigger
  `clients_vertical_inmutable` (before update, Postgres) que hace la inmutabilidad real, no solo de
  tipos — antes solo la garantizaba la ausencia de `vertical` en `CambiosCliente`/`COLUMNAS_EDITABLES`.
  Commits `b1ed4d3..104d663`. Revisado, review clean tras 1 fix round.
- **Task 2 (`app.nap_publico` por vertical): EN CURSO, sin commitear todavía.** El implementador
  (`datos`) encontró que `db/src/fotos-publicas.test.ts:462` llama a `app.nap_publico($1::jsonb)` con
  la firma vieja de 1 parámetro — fuera del alcance que le di originalmente, así que frenó (NEEDS_CONTEXT)
  en vez de tocarlo sin permiso. Le amplié el alcance para ese archivo puntual (una línea, agregar el
  segundo argumento `'restauracion'::app.vertical_cliente`) y quedé esperando su confirmación y commit
  cuando se cortó esta sesión. **Próximo paso al retomar: revisar la respuesta del agente `a9fe2ec786c0e3bc0`
  (si sigue vivo) o redespachar la Task 2 si no — generar el brief con
  `task-brief docs/superpowers/plans/2026-08-26-multivertical-clientes.md 2`, ya existe en
  `.superpowers/sdd/task-2-brief.md`.**
- **Tasks 3-15: sin empezar.** Delegación por área ya fijada (ver nota del propio plan y el ledger):
  Tasks 1-5 → `datos`; Tasks 6-10 → `render` (Task 9 también toca `orchestrator/`, coordinar con
  `pipeline`); Task 11 → `datos`; Tasks 12-14 → `front`; Task 15 (verificación final + docs + commit) →
  sesión principal, nunca un subagente.

**Lección de esta sesión, aplicada esta vez desde el arranque:** `EnterWorktree(name=...)` ramifica
desde `origin/main`, no desde el `main` local — antes de instalar/verificar en un worktree nuevo,
comparar `git log -1 origin/main` contra `main` y `git rebase main` si divergen. También: revisar
`git worktree list` al arrancar cualquier tarea larga, por si ya hay otra sesión trabajando el mismo
plan en paralelo (pasó una vez con el sub-proyecto 2 — dos worktrees implementando lo mismo sin
saberlo).

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

## Sub-proyecto 2 — Desacoplar keyword research de creación de webs: IMPLEMENTADO (2026-08-28)

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

**El sub-proyecto 2 está cerrado.** Quedan el 1 (multi-vertical de clientes) y el 3 (publicar posts
en blog externo), ambos con spec+plan completos y ya pasados por la revisión exhaustiva conjunta —
nada de diseño pendiente en ninguno de los dos. **Implementar en cualquier orden entre ellos, pero
SIEMPRE en serie, nunca en paralelo** (comparten archivos con éste y entre sí: `db/src/store.ts`,
`api/src/app.ts`, `orchestrator/src/workflow.ts` y sus tests). Antes de arrancar cualquiera de los
dos: correr `migrate:deploy` para la `0027` (o confirmar si conviene desplegarla junto con la
migración del siguiente sub-proyecto), y verificar `ls db/migrations` para el número real que le
toque — los tres planes numeraban `0027`/`0028` sin cruzarse entre sí.

## Deuda no relacionada, heredada de antes de esta iniciativa (sin tocar, no bloquea)

- Rotación de credenciales expuestas en `docs/private.zip` (riesgo de seguridad real, pospuesto por
  decisión de Juan el 2026-08-04) — ver `docs/proyecto/15-plan-plataforma.md § Riesgo abierto`.
- Acceso real a la Business Profile API de Google, bloqueado por trámite externo de Juan.
- `CACHE_TTL_MS` en Railway sin fijar al valor real del SLA (Bloque G).
- OBS-04 y el precio de la salida gestionada (Bloque H) — decisiones de negocio de Juan.
