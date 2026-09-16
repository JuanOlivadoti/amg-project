# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** ninguna en curso. Las dos que estaban en vuelo se cerraron y ya están mergeadas a `main`
(confirmado con `git log --oneline origin/main..HEAD` vacío y `git status --short` limpio, 2026-09-16):

- **Comparativas de seguros** (plan de 9 tareas, `feature/comparativas-seguros`) — mergeada a `main`
  en `17b8f87`.
- **MCP local para Claude Desktop** (paquete nuevo `mcp-server/`, sin plan previo, implementado en un
  worktree aislado en paralelo con la de arriba) — mergeada a `main` en `1371a25`, fast-forward desde
  `17b8f87`, sin reescribir nada.

Verificación conjunta sobre el resultado real del merge (no sobre cada rama por separado):
`bash ./scripts/verificar.sh --con-portal` → **2755 tests en verde** (2092 monorepo, 8 paquetes +
`scripts/`; 663 portal — 357 `node:test` + 306 Karma), typecheck limpio, sin secretos.

## En vuelo (sin commitear)

Nada — `git status --short` vacío.

## Próximo paso

No hay desarrollo pendiente de ninguna de las dos etapas. Lo que queda es todo **manual, fuera del
alcance de una sesión de Claude Code**:

1. **mcp-server**: la prueba real contra Claude Desktop instalado (login real, las seis tools
   ejercitadas, una aprobación real que llegue a la base) — spec §10, detalle en
   `mcp-server/README.md`.
2. **Comparativas de seguros**: avisarle a Juan el riesgo de bus-factor de `read-excel-file` (toda la
   cadena de dependencias depende de una sola cuenta de npm) — informativo, no bloquea nada.
3. Calibrar la proporción caracteres/token del preflight de gasto del provider de OpenAI de
   comparativas-seguros contra una corrida real — cuesta dinero, la corre Juan o la autoriza. El
   default `mock` no la necesita.
4. El checklist general de Juan (`docs/proyecto/16-pendientes-juan.md`) sigue con ítems abiertos,
   sin relación con ninguna de las dos etapas de arriba.

Si alguien retoma una sesión de desarrollo, es trabajo nuevo — no hay nada a medio hacer que
continuar.

## Decisiones tomadas

*(Se añaden, no se borran. Las de las etapas anteriores siguen más abajo en este archivo.)*

- **Este archivo se reseteó al estado "nada en vuelo" el 2026-09-16**, en vez de arrastrar la
  narrativa detallada de las dos etapas ya cerradas y mergeadas. El detalle de decisiones y
  callejones de `comparativas-seguros` (lo que había acá abajo hasta esta edición) sigue existiendo
  en el historial de git de este mismo archivo y en `.superpowers/sdd/2026-09-12-comparativas-seguros/progress.md`
  (el ledger, gitignoreado); el de `mcp-server`, en `progress/history.md § 2026-09-15`. Arrastrar acá
  las ~250 líneas de decisiones de trabajo ya cerrado no ayuda a retomar nada —no hay nada que
  retomar— y viola la regla de cabecera de este archivo ("si acá dice algo de hace tres semanas,
  está mintiendo").
- Las decisiones y callejones específicos de cada etapa (modelos usados, bugs de merge de rama,
  trampas de testing) quedan documentados en el commit final de cada una y en `progress/history.md`
  para lo que ya se cerró ahí — no se duplican acá.

## Callejones sin salida

*(Se añaden, no se borran.)*

- **Dos sesiones trabajando en paralelo sobre el mismo repo, en checkouts distintos, tienen que
  coordinar el merge de `progress/current.md` a mano** (2026-09-15/16): las dos prependían su propia
  entrada a la misma celda de `docs/proyecto/09-estado-y-roadmap.md` § Tests, y eso sí generó un
  conflicto real de merge (resuelto combinando ambas narrativas en orden cronológico). `current.md`
  en cambio NO tuvo conflicto porque una sola sesión lo tocaba por vez — la lección: en trabajo
  paralelo real (no solo subagentes de una misma sesión), avisarle a la otra sesión por
  `SendMessage` antes de tocar un archivo de estado compartido evita el conflicto en vez de
  resolverlo después.

## Archivos calientes

- Ninguno — nada en vuelo.

## Verificaciones

- **`bash ./scripts/verificar.sh --con-portal`, sobre el resultado real del merge de las dos etapas
  (2026-09-16): verde entero.** 2755 tests (2092 monorepo, 8 paquetes + `scripts/`, + 663 portal —
  357 `node:test` + 306 Karma), typecheck limpio, sin secretos entre los 741 archivos versionados.
