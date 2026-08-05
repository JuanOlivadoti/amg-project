# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-05
**En curso:** nada. Cerrado **KR-2a**: el paquete `contrato/` (7º workspace) con los tipos del contrato del
brief, los **dos** validadores Zod y `renderReport`. 11 commits por las 9 tareas del
[plan](../docs/superpowers/plans/2026-08-05-kr2a-paquete-contrato.md) —cada una con su review— más una fix
wave de la review de conjunto. El relato está en [`history.md`](history.md). Después, **arreglado el
contador de tests del arnés**, que estaba reportando en cero (abajo).
**Estado:** verificado en verde — **743 tests** del monorepo (venía de 734) + 235 del portal, typecheck
limpio en los 7 paquetes, sin secretos entre los 419 archivos versionados.

**No hubo sesión de navegador, y esta vez el motivo es estructural:** KR-2a no toca el portal ni el
renderizador. Esa mitad del ritual le corresponde a **KR-2b**, que trae la pantalla.

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

## Lo próximo: KR-2b

El plan **se escribe ahora**, con el paquete `contrato/` a la vista en vez de con firmas inventadas — que
es la razón por la que no se escribió antes. Lo que trae, según la
[spec](../docs/superpowers/specs/2026-08-04-informe-kr-portal-design.md):

- **Migración `0016`**: la tabla `kr_informes` con política `app.es_staff()` **y sus grants** — que faltaban
  en la spec y los cazó la 14ª review: los grants del proyecto son listas explícitas por tabla, así que una
  tabla nueva nace sin un solo privilegio y todo daría `42501`.
- **`guardarInforme`** y el step del orquestador **entre `guardar-paginas` y `cerrar-run`**, que es lo que
  hace enunciable el invariante *un run `pending_approval` siempre tiene informe*.
- **Los dos endpoints** (`/runs/:id/informe` y `/runs/:id/informe.md`), con el `filename` saneado por
  allowlist.
- **La pantalla**, con parser propio de Markdown y **sin `innerHTML`**.
- **El seed**, completado sin inventar los datos que no quedaron registrados.

**La próxima migración libre sigue siendo la `0016`.** `0013` y `0014` están **reservadas** para ramas que
se ejecutan en otra máquina: un número libre en el disco no es un número libre.

## ✅ Cerrado — el arnés reportaba "0 tests en verde", **en verde**

Se arregló el 2026-08-05, al arrancar la sesión siguiente. La deuda estaba anotada acá abajo con una
predicción **que era falsa**, y conviene que quede escrito por qué:

> «el script se ejecuta bajo 22 aunque el shell tenga 24 (...) el riesgo hoy no está activo — está a una
> resolución de PATH de estarlo, y nada avisaría»

**El riesgo ya estaba activo.** La sesión siguiente midió `npm run verificar` y su sección de entorno dijo
`node v24.18.1`, no v22: el `npm` que resuelve el PATH vive en la instalación de 24, así que los scripts
corren con 24. La nota se apoyó en la línea `node v22.21.1` que había impreso una corrida vieja, o sea en un
recuerdo, en el mismo párrafo donde se felicitaba por medir. **Y "nada avisaría" también se cumplió**: la
corrida de cierre de KR-2a informó su cifra en verde sin que nada indicara que el contador estaba ciego.

Lo que se hizo, con las dos mitades que la nota pedía:

- La lógica salió del bash a **`scripts/contar-tests.mts`** (mismo motivo que `secretos.mts`: lo que
  necesita test no vive en el script). El patrón acepta **cualquier prefijo** no alfanumérico, no solo el
  `#` de tap y el `ℹ` de spec — medidos los dos, v22.21.1 y v24.18.1.
- **El piso, que es la mitad que importa:** si no encuentra ninguna línea de resumen, o si los resúmenes
  suman 0, **no devuelve 0: falla**, y el arnés cierra la compuerta con `[FALLA]` y exit 1. El patrón cubre
  los dos formatos que existen; el piso cubre el tercero, que todavía no existe.
- **9 tests**, y las **4 mutaciones** caen: volver al patrón viejo tumba 5 (incluido el que se describe
  abajo), quitar el piso tumba 3, y quitar cada ancla del regex tumba exactamente su test.

**El test que no envejece.** Uno de los 9 corre el runner de verdad en un subproceso y exige que el formato
que imprime *el Node de esta máquina* se pueda contar. Es el único que se habría puesto rojo ayer, y el
único que se pondrá rojo cuando Node 26 vuelva a cambiar el formato.

**Y ese test se estrenó cazándose a sí mismo.** El subproceso heredaba `NODE_TEST_CONTEXT`, con lo cual Node
avisaba "run() is being called recursively", **no corría ningún test y salía con status 0**: la salida vacía
contada como verde, el mismo fallo que el archivo existe para impedir, escondido adentro. Lo cazó el assert
del conteo, no el del status — por eso el test comprueba la cifra y no le alcanza con "el hijo no falló".

**El arnés ahora cuenta 743** (los 734 de KR-2a + los 9 del contador). Los dos sitios que contaban —el
monorepo y el portal— usan el mismo contador.

## Lo que quedó abierto de KR-2a (deuda con nombre, no silenciosa)

- **No hay test del corte por cobertura 0** en el gate de gasto de `kr-service/src/pipeline/run.ts`. El
  propio comentario lo declara: la red que atrapa un `null` ahí es `tsc`, **no la suite** — los 146 tests
  pasan en las tres variantes que se midieron.
- **`endpoints_degradados` sigue incompleto** como dato: omite los fallos de suggestion/SERP. Lo que KR-2a
  arregló es que ahora **puede decir "no se sabe"** (`null`) en vez de afirmar `[]`.
- **`web-builder/src/types.ts` conserva `SchemaType`/`PageType`/`SearchIntent` propios**, para el contrato
  de **bloks** (`web.v0.1`), que es del M1 y va versionado aparte. Es un duplicado *nominal* del vocabulario
  de `contrato`, pero **se autodelata**: si el contrato agrega un `PageType`, `pageToStory()` deja de
  typecheckear. Falla fuerte, no en silencio.

## Lo que sigue pendiente de antes

**Las migraciones `0011`, `0012` y `0015` están escritas y NO desplegadas.** Se aplican con
`npm run migrate:deploy -w db` contra la base real, y no se corre sin decidirlo.

**Decisión que no toma un agente:** **regenerar el dataset crudo** cuesta **~$0.31** y ~16 min contra
DataForSEO en producción. Sin él, `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` quedan
sin calibrar y `TIPOS_MAP_PACK` sin verificar. **Y si se corre, hay que volver a sandbox** en
`kr-service/.env`. Con KR-2b esto se vuelve visible: el informe de la demo va a salir con **tres huecos**
en `n/d` (el desglose de coste y las dos coberturas) hasta que exista el dataset.

**El margen de la agencia es legible por el rol `cliente`**, y no lo causa KR-2: `run_select` sobre
`kr_runs` usa `app.ve_cliente(client_id)`, así que un `cliente` ve `coste_micros_usd` y `coste_breakdown`
de su propio run. **No es fuga activa** —no hay usuarios con ese rol— pero el rol existe y RLS lo
contempla. Cerrarlo toca `RunSummary` y la pantalla del brief: **es una pieza propia**.

**El entregable que la agencia le pasa al restaurante no existe.** Sería el informe **sin el bloque de
coste**, y es la pieza dueña del **PDF** que ADR-07 pedía (ver la nota fechada en ADR-07).

**Toda la configuración de skill-map es local a esta máquina.** `.skill-map/` está gitignoreado entero, así
que `respectGitignore`, `ignore` y `referencePaths` **no viajan con el repo**.

**Sin verificar contra producción:** `docs/proyecto/README.md` afirma que hay **10 migraciones aplicadas en
producción**, y en el repo hay **13**. No se puede confirmar sin credenciales.

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
