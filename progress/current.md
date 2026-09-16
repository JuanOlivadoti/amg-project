# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** ninguna en curso. El instalador de `mcp-server` para Claude Desktop (a pedido del usuario,
"no se puede tener un instalador?") quedó commiteado y pusheado a `main` en `d6ae22f`
(fast-forward desde `743f3c8`).

Las tres etapas de `mcp-server`/comparativas-seguros están mergeadas a `main`: **comparativas de
seguros** (`17b8f87`), **MCP local para Claude Desktop** (`1371a25`) y el **instalador**
(`d6ae22f`).

Verificación completa con el instalador adentro: `bash ./scripts/verificar.sh` → **2105 tests en
verde en el monorepo** (8 paquetes + `scripts/`; portal sin cambios, 663 aparte — 357 `node:test` +
306 Karma; total 2768), typecheck limpio, sin secretos. `npm test -w mcp-server`: 67/67 (54
preexistentes + 13 del instalador). Verificación por mutación en `mergearConfig` confirmada (el catch
de JSON inválido devolviendo `{}` en vez de `throw` hizo caer exactamente 1 test).

## En vuelo (sin commitear)

Nada — `git status --short` vacío, todo pusheado a `main` en `d6ae22f`.

## Próximo paso

No hay desarrollo pendiente de ninguna de las tres piezas (comparativas-seguros, mcp-server, el
instalador). Lo que sigue es manual, fuera del alcance de una sesión de Claude Code:

1. **mcp-server**: la prueba real contra Claude Desktop instalado (login real, las seis tools
   ejercitadas, una aprobación real que llegue a la base) — spec §10, detalle en
   `mcp-server/README.md`. El instalador (`npm run mcp:instalar -w mcp-server`) saca de encima la
   edición manual del JSON, pero no reemplaza esta prueba.
2. **Comparativas de seguros**: avisarle a Juan el riesgo de bus-factor de `read-excel-file`.
3. Calibrar la proporción caracteres/token del preflight de gasto de OpenAI contra una corrida
   real — cuesta dinero, la corre o autoriza Juan.
4. El checklist general de Juan (`docs/proyecto/16-pendientes-juan.md`), sin relación con lo de
   arriba.

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

- **`bash ./scripts/verificar.sh`, con el instalador de `mcp-server` adentro (2026-09-16): verde
  entero.** 2105 tests en el monorepo (8 paquetes + `scripts/`; portal sin cambios, 663 aparte — 357
  `node:test` + 306 Karma; total 2768), typecheck limpio, sin secretos entre los 739 archivos
  versionados. `npm test -w mcp-server`: 67/67. Verificación por mutación en `mergearConfig`
  confirmada por dos sesiones distintas (yo y el `revisor`, cada uno por su cuenta).
