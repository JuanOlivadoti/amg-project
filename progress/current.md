# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-04
**En curso:** **KR-2 — el informe legible en el portal.** Spec escrita y aprobada, **sin implementar**:
[`docs/superpowers/specs/2026-08-04-informe-kr-portal-design.md`](../docs/superpowers/specs/2026-08-04-informe-kr-portal-design.md).
Lo próximo es el plan de implementación (writing-plans), partido en **KR-2a** (el paquete `contrato/`) y
**KR-2b** (migración `0016` + endpoints + pantalla + seed).

Antes, en esta misma sesión: cerrada la **etapa B** del [plan de agentes](../.claude/PLAN-AGENTES.md): el
agente `datos` (`db/` + `api/`) con `datos-postgres`, `datos-api` y `datos-testing`, estrenado con
**KR-3** —el orden del brief, persistido—. El relato está en [`history.md`](history.md).
**Estado:** verificado en verde — **698 tests** del monorepo (venía de 684), 169 del portal, 66 de Karma,
typecheck limpio, sin secretos entre los 405 archivos versionados. Pasó por **dos** revisiones: la interna
del `revisor` (2 bloqueantes) y la **13ª ronda externa de Codex** (NO LISTO, 9 hallazgos). Los once
resueltos; el detalle en [`08` § tanda 19](../docs/proyecto/08-testing-calidad.md).

---

## 🔴 Riesgo abierto — las credenciales expuestas, **postergado por decisión del usuario (2026-08-04)**

> **No lo levantes como bloqueante en cada sesión.** Juan decidió posponer la rotación; sigue siendo un
> riesgo real y abierto, no un asunto cerrado. Lo que corresponde es dejarlo anotado y seguir con el
> trabajo, no volver a proponerlo cada vez.

`docs/private.zip` estuvo **commiteado en este repositorio, que es público**, desde el 2026-08-01
(commit `15ae91a`). Ya se sacó del índice y el `.gitignore` quedó blindado —y desde la 13ª review cubre
también los directorios hermanos tipo `docs/private-backup/`—, pero **el objeto sigue en el historial de
GitHub** por decisión tomada: purgar no des-expone, lo que devuelve la seguridad es rotar.

**La lista priorizada vive fuera del repo:** `docs/private/rotacion-credenciales.md` (gitignoreado).
Está ahí y no acá a propósito — es un análisis de impacto ordenado por daño, o sea un mapa de qué
buscar y por dónde empezar, y este repositorio es público. El hecho va al repo; el mapa, no.

Cuando la rotación se complete, dejar acá una línea con la fecha. Eso sí es el hecho.

---

## Lo que esta sesión dejó abierto

**La migración `0015` está escrita y NO desplegada.** Igual que la `0011` y la `0012`. Se aplica con
`npm run migrate:deploy -w db` contra la base real — que **no** se corrió acá, y no se corre sin
decidirlo. `0013` y `0014` siguen **reservadas** para las ramas de las piezas "ideas" y "fotos
públicas", que se ejecutan en otra máquina: la reserva vive en
`docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` (§4), y **un número libre en el disco no
es un número libre**.

**Lo que ningún script vio: la app en el navegador.** El ritual lo pide y esta vez **no se hizo**, con
un motivo medido y no como excusa: con el seed actual la demo se ve **exactamente igual** que antes de
la 0015 — los 14 scores de `PAGINAS_DEMO` son estrictamente descendentes, sin empates, con las 8
respaldadas antes de las 6 sin validar, así que el orden del array coincide índice por índice con el de
dos niveles. Una sesión de navegador **no podría distinguir** si el cambio funciona. Lo que sí queda sin
comprobar visualmente es que la pantalla del brief siga pintando bien; los 66 tests de componentes
pasan.

**KR-2 tiene spec aprobada y sigue sin implementar.** Las tres decisiones cerradas: paquete compartido
(opción b, que de paso cierra la deuda del Zod duplicado M2/M1), **pantalla + descarga `.md`**, y el
**`.md` guardado**. Lo que el diseño destapó y no se sabía antes: el **backlog no se persiste**, el run
de la demo **lo siembra `sembrarDemo`** (no el pipeline), `renderReport` **emite `NaN`** con datos
incompletos, el contrato **no admite "no sé"** en las coberturas, y el informe va en **tabla propia** con
`app.es_staff()` porque una columna de `kr_runs` habría filtrado el coste interno al rol `cliente`.
Detalle en la [spec](../docs/superpowers/specs/2026-08-04-informe-kr-portal-design.md).

## Lo que sigue pendiente de antes

**Decisión que no toma un agente:** **regenerar el dataset crudo** cuesta **~$0.31** y ~16 min contra
DataForSEO en producción. Sin él, `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` quedan
sin calibrar y `TIPOS_MAP_PACK` sin verificar. El destino ya es durable, así que el dataset sobrevive.
**Y si se corre, hay que volver a sandbox** en `kr-service/.env`.

**Pendiente inmediato:** el **plan de implementación de KR-2** (writing-plans), y después KR-2a.

Sigue en la cola, sin apuro: la **etapa C** del [plan de agentes](../.claude/PLAN-AGENTES.md) — el agente
`render` con `render-seguridad` y `render-cda-cache`. Va última a propósito y **no tiene trabajo real
que la estrene**: lo que le queda al renderizador (CDN en el borde, cache compartida entre instancias)
es decisión de despliegue, no código. Es razonable que espere a que aparezca trabajo real en vez de
escribirse por completitud.

**Toda la configuración de skill-map es local a esta máquina.** `.skill-map/` está gitignoreado entero,
así que `respectGitignore`, `ignore` y `referencePaths` **no viajan con el repo**. Si tiene que valer
para todos, hay que versionar `.skill-map/settings.json`.

**Sin verificar contra producción:** `docs/proyecto/README.md` afirma que hay **10 migraciones
aplicadas en producción**, y en el repo hay **13**. No se puede confirmar sin credenciales.

---

## Plantilla (dejar así al cerrar)

```markdown
**Sesión:** YYYY-MM-DD
**En curso:** <qué se está haciendo>
**Estado:** <en progreso | bloqueado | listo para revisión>

**Decisiones de esta sesión:**
- <qué se decidió y por qué>

**Pendiente inmediato:** <lo próximo>
```
