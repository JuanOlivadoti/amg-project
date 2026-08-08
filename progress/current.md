# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-07 → 2026-08-08
**En curso:** el bloque **C** del [plan de la plataforma](../docs/proyecto/15-plan-plataforma.md)
—aprobar → publicar—, después de procesar la **15ª review externa** (Codex) y cerrar los bloques
**A**, **B** y **C0**.
**Estado:** en progreso. **Lo próximo: el paso 2 del bloque C** (lanzar un research desde el portal,
aprobar una página, aprobar el run y ver si el workflow despierta en Inngest). El paso 1 —comprobar
el modo— ya se puede hacer: `/_health` lo dice desde el **C-0**.

**Los siete hallazgos, clasificados** (el reporte completo, en `progress/informes/`, no versionado):
cinco verificados, uno aceptado por juicio, **una mutación refutada**. Ninguno contradice una decisión
del usuario. El relato está en [`history.md`](history.md).

**Lo que ya se hizo de esta ronda** (seis commits, todos pusheados):

| Commit | Qué |
| --- | --- |
| `152854b` | **La documentación que mentía.** Siete afirmaciones en el `09`, el `README` de `docs/proyecto/` y este archivo seguían diciendo que falta desplegar el orquestador. Y el plan quedó enmendado: **A1**/**A2** con garantías de verdad, **C0** como precondición bloqueante de C, **A3** detrás de **A4**, **D** con las dos deudas que el `09` le atribuía, y el bloque **J** (piezas 3 y 4 del portal), que no existía |
| `29625e6` | **H5** (la fila `transaccional` del fixture) y la **guarda de `finishRun`** — el bug de hoy que destapó verificar un hallazgo sobre código futuro |
| `18790f0` | **A2**: el barrido de runs colgados. Migración `0018` con la primera `security definer` del proyecto y un rol propio, `app_barrido` |
| `f47a1b4` | **A1**: `/_health` con sonda por `Tx`, y el log de la transición sano→degradado |
| `9e06576` | **B2**: `renderReport` pasa de flags a `audiencia`, y el entregable pierde la línea de metadatos |
| `3e71767` | **B1**: 409 con código en la API, link apagado en el portal |

**`current.md` se reseteó** al empezar: estaba entero duplicado en las seis entradas del 2026-08-07 de
la bitácora. Antes de vaciarlo se rescató lo que solo vivía acá — dos deudas de KR-2a pasaron al
bloque **I** del plan, y el generador de credenciales ganó su entrada en `history.md`.

| `bfda1c5` | **C0**: la condición durable de publicabilidad. Migración `0019`, `approveRun` con guarda, 409 `RUN_SIN_WORKFLOW`, y el botón apagado con motivo. Cae el único hallazgo con veredicto NO LISTO |

Y una corrección que salió de ahí: este archivo y el plan decían *"en `dry-run` el publisher no
escribe nada"* como si `dry-run` fuera un valor de `WEB_PUBLISH_MODE`. **No lo es** — los valores son
`mock` | `storyblok`, y dry-run es un estado al que se llega por tres caminos. Medido y corregido en
el plan, con lo que reporta cada uno.

## ✅ C-0 — `/_health` ya dice en qué modo publica

Juan puso `WEB_PUBLISH_MODE=storyblok` y `STORYBLOK_DRY_RUN=1` y redesplegó, y entonces se vio que
**no había forma de confirmar desde afuera que esas variables tomaran**: `/_health` reportaba
`pipeline` y nada del publisher. Sin eso, el paso 1 del bloque C —"comprobar el modo"— no tenía con
qué.

Ahora responde `publicacion: "mock" | "dry-run" | "live"`, derivado de la **misma
`decisionDelServicio()` que construye el publisher**. Que sean la misma es el punto entero: si se
calcularan por separado, `/_health` podría decir `dry-run` mientras se publica de verdad — la forma
exacta en que la clave de firma de Inngest ya mordió una vez.

Tres tests, uno por estado y cada uno en su archivo (`config` se congela al importarse, y
`node --test` da un proceso por archivo). La **mutación** que pide el plan cae y solo cae ella:
reimplementar `modoPublicacion()` leyendo `process.env` deja rojo el estado
`storyblok` **sin token** —donde el entorno dice `live` y la verdad es `dry-run`— y verde todo lo
demás.

Dos cosas que aparecieron al medirlo:

- **El modo es del proceso, no de la corrida.** Un cliente sin space publica en dry-run aunque el
  servicio esté en `live`; `/_health` reporta el **techo**, y un test lo fija.
- **Un typo en `WEB_PUBLISH_MODE` es mock en silencio**, con token y space puestos. Por eso el test
  del estado mock usa el typo y no la ausencia: es el mismo camino y es el que nadie sospecha.

### 🔴 Y lo primero que reportó desplegado fue `mock` — el bloque C sigue bloqueado

Commit `e926231`, desplegado y leído en producción:

```json
{"ok":true,"funciones":2,"modo":"cloud","pipeline":"mock","publicacion":"mock","uptimeSegundos":40}
```

`publicacion: "mock"`, no `dry-run`. O sea: **`WEB_PUBLISH_MODE=storyblok` no está tomando en el
servicio `amg-orchestrator`** — ausente, mal escrita, con un espacio de más, o puesta en otro
servicio o entorno. La leí tres veces seguidas con la misma respuesta y con el proceso ya
redesplegado (uptime 40 s), así que no es una ventana de arranque.

**Esto es exactamente para lo que existe C-0**, y lo cazó en la primera lectura: sin el campo, el
paso siguiente habría corrido en `mock` creyéndose en dry-run, y `MockPublisher` reporta
`published: true` — la base habría anotado como publicadas unas páginas que nunca salieron del
contenedor.

**El paso 2 del bloque C no se hace hasta que esto diga `dry-run`.** Depende del panel de Railway,
así que es de Juan.

> Nota al margen, sin consecuencia: `amg-api-production.up.railway.app` ya no resuelve
> («Application not found»). La API vive en su dominio propio, `api.bigballs.es`, y ahí responde
> `{"status":"ok"}`. El renderizador, 200.

---

## ✅ Desplegado el 2026-08-08 — y lo que costó la `0018`

`must be able to SET ROLE "app_barrido"`. **Falló bien** —se revirtió, las 15 anteriores intactas—
pero falló **solo en producción**, con 238 tests en verde: en PGlite el rol que migra es superusuario
y puede asumir cualquier rol; en Supabase alojado `postgres` no lo es.

Es el mismo modo de fallo que la cabecera de la `0018` argumenta para elegir el dueño de la función
—*"daría verde en los tests y cero filas en producción"*— **un piso más arriba**: el razonamiento era
correcto y el entorno donde se comprobó, no.

Reproducido y arreglado. `ALTER … OWNER TO` exige **dos** permisos y el mensaje solo nombra el
primero: poder `SET ROLE` al nuevo dueño (en PG16+ crear un rol da `ADMIN OPTION` pero no `SET`) y que
ese dueño tenga `CREATE` en el schema. Los dos se conceden temporalmente y **se revocan al final del
archivo, no justo después del `alter`** — porque `revoke execute`, `grant execute` y
`comment on function` también exigen ser dueño, y la membresía es lo que los hace pasar. Esa segunda
mitad la cazó el test, no el razonamiento: la primera versión del arreglo habría vuelto a fallar en la
línea siguiente.

**El test nuevo aplica la `0018` con un rol `createrole` no-superusuario dueño de lo que la migración
concede.** Sin los grants reproduce el mensaje literal de producción.

## ✅ Todo en producción, verificado en el navegador

Las **17** migraciones aplicadas, los tres commits pusheados, y los tres servicios redesplegados:

- **`/_health` del orquestador**: `{"ok":true,"funciones":2,"modo":"cloud","pipeline":"mock"}` — **dos**
  funciones (el workflow y el barrido) y **sin `degradado`**, o sea que la sonda nueva atravesó `Tx` y
  el `set local role app_service` contra Supabase real. A1 verificado donde importa.
- **La lista de research y el brief cargan**: `getRun`/`listAllRuns` funcionan con la columna nueva, que
  era lo único que podía tumbar el portal entero.
- **La API devuelve `tiene_workflow: false`** para el run sembrado — la respuesta correcta: ese run se
  insertó directo en la base y nadie espera su aprobación.
- **B1 vivo**: el entregable es un `StaticText`, no un `link`, mientras el informe sigue siendo `link`.

- **C0 vivo, sobre el escenario exacto de la review**: en el run sembrado el botón «Aprobar el run y
  publicar» está **deshabilitado**, con el motivo *"este research no lo lanzó el pipeline… aprobarlo no
  publicaría nada. Para publicar, lanzá un research nuevo"* — y **no** aparece el de las páginas, aunque
  también se cumple. El colapso a un solo motivo hace lo que se diseñó: gana el que quien mira no puede
  resolver desde ahí. Cero errores en consola.

Hubo una ventana en la que la API ya servía `tiene_workflow` y el portal seguía en el build anterior
(mostraba el motivo viejo). Se resolvió sola al terminar Hostinger. **Vale anotarlo**: la API y el
portal se despliegan por caminos distintos y no llegan a la vez, así que un campo nuevo tiene que ser
inofensivo para el portal viejo — lo fue, porque el viejo simplemente lo ignora.

## ⏳ Lo que espera a Juan

| Qué | Por qué él | Bloquea |
| --- | --- | --- |
| **Abrir la lectura de `**/.env.example`** | Es una línea de `.claude/settings.json` | El bloque **A4** (el `MAPA` y el `.env.example` del orquestador van juntos) |
| **Un token de solo lectura de Railway** | Es una credencial | El bloque **A3**, que además va **después** de A4 |

Y lo que ya hizo, para no volver a pedirlo: desplegó la `0018` y la `0019` (`migrate:deploy -w db`) y
puso `WEB_PUBLISH_MODE=storyblok` + `STORYBLOK_DRY_RUN=1` en el orquestador, **sin token de
Storyblok**. Eso último es correcto y deliberado: en dry-run el token no se usa, así que su ausencia
es una segunda red que no depende de que la variable esté bien escrita.

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

Cuando la rotación se complete, dejar acá una línea con la fecha. Eso sí es el hecho.

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
