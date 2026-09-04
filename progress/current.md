# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** C-1 del plan — la marca de intento de publicación (`docs/proyecto/15-plan-plataforma.md`
§ Bloque C). El editor de contenido del Bloque E se cerró antes en esta misma jornada y su resumen ya
está en
[`history.md`](history.md#2026-09-04--editor-de-contenido-del-portal-cierra-el-bloque-e-y-la-marca-de-intento-de-publicación-c-1).
Este trabajo es distinto: hasta ahora, publicar un run en modo `dry-run` no dejaba rastro en la
base — el publisher reporta `published: false` correctamente y por eso no se escribía nada, dejando
el único rastro en un `log()` del contenedor efímero. Elegido por recomendación de la sesión
principal, tras preguntarle al usuario "con qué seguimos" y ofrecer dos candidatos (el otro era
unificar la sonda duplicada del modo del SDK, deuda menor de bajo valor — sigue sin tocarse).

**Implementado en paralelo por los agentes `datos` (db) y `pipeline` (orchestrator) sobre un
contrato fijado por la sesión principal antes de delegar**: tabla nueva `kr_publicacion_intentos`
(migración `0032`, sin desplegar todavía) + `PgStore.registrarIntentoPublicacion`, llamado SIEMPRE
(mock/dry-run/live) desde el paso `publicar` de `workflowDecision`, antes de `marcarPublicadas`.
`Deps.publicar` pasa a devolver `{ modo, resultados }`. De paso se cerró **C-2 punto 3** (si el
barrido de runs colgados debería cancelar el workflow de Inngest) como una decisión documentada de
NO hacerlo — ver `Decisiones tomadas` más abajo. Revisado por `revisor` sobre el diff completo:
**CAMBIOS_PEDIDOS (1 bloqueante, documental, + 3 no bloqueantes)** — cero hallazgos de código ni de
seguridad. Los cuatro, corregidos en el mismo cierre.

## En vuelo (sin commitear)

Todo el trabajo de C-1 sigue sin commitear — pendiente del commit+push que cierra esta etapa:

- `db/migrations/0032_intento_publicacion.sql` (nueva) — tabla `kr_publicacion_intentos`.
- `db/src/store.ts` — método `registrarIntentoPublicacion`.
- `db/src/kr-publicacion-intentos.test.ts` (nuevo) + `db/src/store.test.ts` — 12 tests nuevos.
- `orchestrator/src/workflow.ts` — `Deps.publicar` cambia de forma; el paso `publicar` llama al
  método nuevo; comentario nuevo sobre el perfil de reintento del insert.
- `orchestrator/src/deps.ts` — `crearDeps().publicar` arma `{modo: modoPublicacion(), resultados}`.
- `orchestrator/src/workflow.test.ts` — 3 tests nuevos.
- `docs/proyecto/15-plan-plataforma.md` — el diseño de C-1 documentado + la decisión de C-2.
- `docs/proyecto/09-estado-y-roadmap.md` — cifras de tests (2500) y migraciones (32) actualizadas.
- `progress/history.md` — entrada nueva del 2026-09-04 (Bloque E + C-1 juntos).

`npm run verificar` corrió en verde después de aplicar las correcciones del `revisor` (1891 tests del
monorepo, typecheck limpio, sin secretos; portal no cambió). Falta: commitear, pushear, y correr
`npm run migrate:deploy` (lo hace el usuario, fuera de Claude Code — ver `12-credenciales.md`) para
desplegar la `0032`.

## Próximo paso

1. **Commitear y pushear C-1** — todo lo listado en "En vuelo" arriba, un solo commit (mismo criterio
   que el editor de contenido: `datos`+`pipeline` no commitean, lo hace la sesión principal con todo
   el cambio a la vista).
2. **Avisarle al usuario que falta desplegar la migración `0032`** (`npm run migrate:deploy`, fuera
   de Claude Code) para que la marca empiece a escribirse en producción.
3. Después de eso, **no hay tarea de desarrollo pendiente**: preguntarle al usuario con qué seguir.
   El backlog general depende de Juan — ver
   [`16-pendientes-juan.md`](../docs/proyecto/16-pendientes-juan.md). La única deuda técnica conocida
   sin dueño es unificar la sonda del modo del SDK, duplicada entre `api/src/deps.ts:184-194`
   (`exigirEventKeySiEsCloud`) y `orchestrator/src/config.ts:152-169` (`esModoProduccion`) — deuda
   menor, bajo riesgo, bajo valor (Bloque I).

## Decisiones tomadas

- **Contrato fijado por la sesión principal antes de delegar**: nombre y columnas de
  `kr_publicacion_intentos`, firma exacta de `PgStore.registrarIntentoPublicacion`, y la nueva forma
  de `Deps.publicar` (`{modo, resultados}`). Motivo: permitió despachar a `datos` y `pipeline` **en
  paralelo**, no en serie — misma desviación razonada de la regla general de `AGENTS.md` que ya se
  usó para el editor de contenido del Bloque E.
- **`modo` se escribe SIEMPRE (mock/dry-run/live), no solo en dry-run.** Da un rastro uniforme en los
  tres modos en vez de un caso especial en el código que llama al método.
- **`modo` viaja como `string` por `Deps.publicar`, sin importar `ModoPublicacion` de `web-builder`.**
  No es la misma frontera que `brief: unknown` en la misma firma (esa protege una revalidación real
  con Zod) — la razón real es más simple: `orchestrator/src/workflow.ts` hoy no importa nada de
  `web-builder`, y esto no le agrega el primer import. El `revisor` señaló que la analogía original
  con `brief: unknown` no sostenía la comparación (`app.ts`/`config.ts` sí importan `ModoPublicacion`
  sin problema) — el comentario del código se corrigió para dar la razón real.
- **C-2 punto 3 (cancelar el workflow de Inngest desde el barrido): decisión de NO hacerlo, sin
  código.** Cancelar exigiría `cancelOn` + que el orquestador emita un evento propio
  (`research/expirado`), y "el orquestador no emite eventos" es un invariante probado
  (`scripts/env-sync.test.mts:64`, `"el orquestador no emite eventos (medido: no hay send)"`) y
  documentado (`14-runbook-despliegue.md:834`) — su credencial de despliegue ni siquiera lleva
  `INNGEST_EVENT_KEY`. Revertirlo metería la misma superficie de fallo que ya sufrió la API (crash
  loop por falta de `INNGEST_EVENT_KEY`, `14-runbook-despliegue.md:1138`) a cambio de un beneficio
  acotado: `retries: 1` limita a un segundo intento, y `finishRun`/`failRun` ya guardan
  `where status = 'running'`, así que un workflow zombi no puede pisar el `failed` que ya escribió el
  barrido. La asimetría documentada queda, pero acotada — se cierra con la nota en el plan, no con
  código nuevo.
- **El insert de `registrarIntentoPublicacion` NO es idempotente frente a un reintento del step
  `publicar`** (a diferencia de `marcarPublicadas`/`cerrarDecision`, que son no-op en un reintento).
  Detectado por `revisor`: un segundo intento del mismo step agrega una fila nueva, no la actualiza.
  Aceptado tal cual — acotado por `retries: 1` (como mucho dos filas por decisión) y sin consecuencia
  hoy (nadie lee la tabla todavía). Documentado en el plan y en el comentario del código, para el día
  que alguien cuente filas de esta tabla.
- **La política de insert de la migración `0032` NO lleva `app.puede_escribir()`**, a diferencia de
  otras políticas de escritura del proyecto. Verificado por `revisor` (no solo aceptado por juicio):
  el único login con grant sobre la tabla es `amg_orquestador` → `app_service` (`NOINHERIT`, sin
  ningún camino de un humano hacia ese rol), así que toda fila que llegue a evaluar la política YA
  satisface `puede_escribir()` — agregarlo sería una condición que nunca puede dar `false` en la
  práctica. La frontera real es el GRANT (`app_user` no tiene ninguno), no la política.

## Callejones sin salida

— Nada nuevo en esta pieza. El `revisor` esta vez SÍ corrió en foreground sin caer en la trampa de
"esperar la notificación" documentada en entradas anteriores — pero la sesión coordinadora se
reinició a mitad de su revisión (el `status: stopped` del `task-notification`, sin informe escrito
todavía) y hubo que retomarlo con `SendMessage` para que terminara y escribiera
`progress/informes/revision-c1-intento-publicacion.md`. No fue el mismo error de siempre (el agente
no se quedó esperando mal) — fue la sesión coordinadora la que se cayó y perdió el hilo del agente en
vuelo. Si vuelve a pasar: `ListAgents` no lo muestra como "Subagents" tras un reinicio, pero
`SendMessage` al `agentId` original SÍ lo retoma desde su transcript guardado.

## Archivos calientes

- `docs/proyecto/15-plan-plataforma.md` § C-1/C-2 — el diseño completo con su razonamiento, incluida
  la nota de retención y la corrección de las citas de línea.
- Informes completos (no versionados): `progress/informes/impl-intento-publicacion-datos.md`,
  `impl-intento-publicacion-pipeline.md`, `revision-c1-intento-publicacion.md`.

## Verificaciones

- **`revisor` sobre el diff completo (2026-09-04): CAMBIOS_PEDIDOS (1 bloqueante + 3 no
  bloqueantes).** Corrió `bash ./scripts/verificar.sh` él mismo (1891 tests, typecheck limpio, sin
  secretos; portal no aplica — no cambió), más `npm test -w db` (514/514) y
  `npm test -w orchestrator` (184/184) por separado para confirmar las cifras de los informes de área
  con su propia corrida. Verificó por lectura los invariantes de `CHECKPOINTS.md` (rol derivado,
  NOINHERIT, `Tx`, grants con test de login real) — todos ✅, uno con salvedad no bloqueante (la nota
  de retención faltante). No pudo reproducir las mutaciones de los agentes de área (sin `Edit`), pero
  auditó que el código coincide con lo que cada informe describe. Informe completo:
  `progress/informes/revision-c1-intento-publicacion.md`.
- **Sesión principal, después de corregir los 4 hallazgos (2026-09-04): VERDE de nuevo.**
  `bash ./scripts/verificar.sh`: 1891 tests, typecheck limpio, sin secretos, portal no cambió.
