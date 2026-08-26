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
   completos, sin implementar todavía.**
2. **Desacoplar keyword research de creación de webs** — **diseño y plan completos, sin
   implementar todavía.**
3. Publicar posts a un blog ya existente en otra plataforma — **spec completo, revisado por Codex
   una vez; falta el plan de implementación.**

**Decisión de secuencia (2026-08-26, confirmada con el usuario):** los tres sub-proyectos se diseñan
uno por uno (spec + plan + revisión de Codex, igual que el 1) **sin implementar** hasta tener los tres
"aterrizados". Recién ahí: una ronda de revisión **exhaustiva y general** (esta sesión + Codex) sobre
los tres a la vez, y después arranca la implementación. El motivo: los tres tocan superficies
superpuestas (perfil de cliente, catálogo, portal), y revisarlos juntos antes de tocar código evita
descubrir una incompatibilidad entre sub-proyectos recién al implementar el tercero.

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
- **Decisión de proceso pendiente, no de diseño:** el hallazgo #7 de esta ronda (la extensión del
  chequeo "al menos una página aprobada" a `crear_posts` en `registrarDecision`, sub-proyecto 2, no
  es una precondición ejecutable todavía) se resuelve así: la primera tarea del plan de este
  sub-proyecto va a ser una modificación explícita al plan del sub-proyecto 2 — sigue siendo edición
  de documentos de diseño, no adelanta la secuencia de implementación.
- **Qué falta:** escribir el plan de implementación (`writing-plans`), autorevisión, una ronda de
  Codex sobre el plan — mismo proceso que los sub-proyectos 1 y 2.

## Qué sigue

**Escribir el plan de implementación del sub-proyecto 3** con la skill `writing-plans`, mismo
proceso que los dos anteriores: autorevisión, revisión de Codex, aplicar hallazgos. **No implementar
nada de los tres sub-proyectos hasta que estén los tres diseñados (spec+plan) y pasada la revisión
exhaustiva conjunta.**

## Deuda no relacionada, heredada de antes de esta iniciativa (sin tocar, no bloquea)

- Rotación de credenciales expuestas en `docs/private.zip` (riesgo de seguridad real, pospuesto por
  decisión de Juan el 2026-08-04) — ver `docs/proyecto/15-plan-plataforma.md § Riesgo abierto`.
- Acceso real a la Business Profile API de Google, bloqueado por trámite externo de Juan.
- `CACHE_TTL_MS` en Railway sin fijar al valor real del SLA (Bloque G).
- OBS-04 y el precio de la salida gestionada (Bloque H) — decisiones de negocio de Juan.
