# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** iniciativa nueva — generalizar AMG OS a cualquier tipo de cliente, no solo restauración.
**En curso:** ninguna implementación todavía. Se decidió partir el pedido en **tres sub-proyectos
independientes**, cada uno con su propio spec → plan → revisión externa (Codex), ejecutados en serie
(uno se implementa antes de arrancar el diseño del siguiente — decisión explícita, no en paralelo):

1. **Multi-vertical de clientes** (restauración + correduría de seguros) — **diseño y plan
   completos.**
2. **Desacoplar keyword research de creación de webs** — **diseño y plan completos.**
3. **Publicar posts a un blog ya existente en otra plataforma** — **diseño y plan completos.**

Los tres, con spec+plan revisados por Codex, sin implementar todavía. **En curso: la revisión
exhaustiva conjunta de los tres** (ver más abajo).

**Decisión de secuencia (2026-08-26, confirmada con el usuario):** los tres sub-proyectos se diseñan
uno por uno (spec + plan + revisión de Codex, igual que el 1) **sin implementar** hasta tener los tres
"aterrizados". Recién ahí: una ronda de revisión **exhaustiva y general** (esta sesión + Codex) sobre
los tres a la vez, y después arranca la implementación. El motivo: los tres tocan superficies
superpuestas (perfil de cliente, catálogo, portal), y revisarlos juntos antes de tocar código evita
descubrir una incompatibilidad entre sub-proyectos recién al implementar el tercero.

**Orden de implementación (fijado durante la revisión conjunta, 2026-08-26): sub-proyecto 2 primero,
1 y 3 después (en cualquier orden entre ellos, o en paralelo).** No es una preferencia — lo exige una
dependencia real que ninguna de las dos revisiones individuales había detectado: la Task 9 del
sub-proyecto 1 y la Task 8 del sub-proyecto 3 modifican código que solo existe una vez que
`workflowDecision` (introducido por el sub-proyecto 2) está implementado. El sub-proyecto 2 retira el
mecanismo viejo de aprobación-y-publicación-inline de `workflowResearch` (donde vive hoy el código que
la Task 9 del sub-proyecto 1 pensaba editar) y lo traslada, con otra forma, a `workflowDecision`. 1 y 3
no dependen entre sí — tocan ramas distintas de esa misma función (`crear_web` y `crear_posts`).

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

## Sub-proyecto 2 — Desacoplar keyword research de creación de webs: estado detallado

- **Spec:** [`docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`](../docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md).
  Revisada por Codex una vez (veredicto NECESITA REDISEÑO → 3 Critical + 7 Major + 2 Minor, los 12
  corregidos e incorporados — el más caro: un evento llevaba el `destino` como autoridad, violando
  el principio ya documentado en `orchestrator/src/events.ts`).
- **Plan:** [`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`](../docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md).
  12 tasks (db → orchestrator → api → portal → verificación). Revisado por Codex una vez (veredicto
  NECESITA REDISEÑO → 1 Critical + 8 Major + 3 Minor, los 12 corregidos). **Ninguna task se ejecutó
  todavía** — cero código tocado, cero migración aplicada.
- **Informes de las dos rondas de Codex**, guardados tal cual llegaron:
  [`progress/informes/codex-desacoplar-kr-spec.md`](informes/codex-desacoplar-kr-spec.md) y
  [`progress/informes/codex-desacoplar-kr-plan.md`](informes/codex-desacoplar-kr-plan.md).
- **Decisión de producto confirmada durante el procesamiento del plan, no estaba en el spec
  original:** el chequeo "al menos una página aprobada" (ADR-06) aplica solo a `crear_web`, no a
  `solo_informe` — ver "Global Constraints" del plan.
- **Qué falta para este sub-proyecto:** nada de diseño — listo para implementación cuando le toque
  el turno, después de que el sub-proyecto 3 tenga su spec+plan y pase la revisión exhaustiva
  conjunta de los tres.

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
entre sí (tocan ramas distintas de esa misma función) y pueden ir en cualquier orden, o en paralelo,
después del 2.

Documentos tocados por esta ronda: los tres planes (Task 1 de multi-vertical y de desacoplar-kr-web
con el hedge de migración; Task 9 de multi-vertical reescrita; Tasks 4 y 8 de publicar-posts con
`vertical` opcional), más este archivo y el `09`.

## Qué sigue

**Falta la ronda de Codex sobre esta revisión conjunta** — mismo proceso que las rondas individuales
de cada sub-proyecto: armar el prompt, procesar los hallazgos, aplicar lo que corresponda. Recién
después de esa ronda arranca cualquier implementación.

## Deuda no relacionada, heredada de antes de esta iniciativa (sin tocar, no bloquea)

- Rotación de credenciales expuestas en `docs/private.zip` (riesgo de seguridad real, pospuesto por
  decisión de Juan el 2026-08-04) — ver `docs/proyecto/15-plan-plataforma.md § Riesgo abierto`.
- Acceso real a la Business Profile API de Google, bloqueado por trámite externo de Juan.
- `CACHE_TTL_MS` en Railway sin fijar al valor real del SLA (Bloque G).
- OBS-04 y el precio de la salida gestionada (Bloque H) — decisiones de negocio de Juan.
