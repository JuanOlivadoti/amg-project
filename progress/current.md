# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-07
**En curso:** nada. Cerrado el **tramo A del despliegue del orquestador**: el código quedó listo para que
desplegar sea ejecutar un runbook. Lo hicieron dos agentes en paralelo (`datos` en `api/`, `pipeline` en
`orchestrator/`), con una revisión interna que devolvió **3 bloqueantes** y su segunda vuelta. El relato
está en [`history.md`](history.md).
**Estado:** verificado en verde — **833 tests** del monorepo (venía de 786) + **285** del portal (207
`node:test` + 78 Karma) = **1118**, typecheck limpio en los 7 paquetes, sin secretos entre los 436 archivos
versionados. `npm run verificar` exit 0, medido tras la segunda vuelta.

**No hubo sesión de navegador, y es `n/a` justificado:** no se tocó `portal/` ni `renderer/`. El
equivalente para un servicio sin UI —**arrancar el proceso de verdad**— sí se hizo, en cinco escenarios:
Railway simulado con y sin variables, dev sin credenciales, cloud con la base inalcanzable, y una petición
**firmada** contra `/api/inngest`. El último destapó el bloqueante de la clave de firma, que ningún test
de la suite veía.

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

## ✅ Cerrado — KR-2b: el informe, en la pantalla

Las siete piezas están en `main`, y la migración **ya está desplegada** (2026-08-07): la tabla `kr_informes` (`0016`, política
`app.es_staff()` **y sus grants**), `guardarInforme`/`getInforme`, el step del orquestador **antes de
`cerrar-run`**, los dos endpoints, el seed de la demo con informe sin gastar $0.31, el parser de Markdown y
la pantalla. El detalle está en el
[`09`](../docs/proyecto/09-estado-y-roadmap.md) y el relato en [`history.md`](history.md).

**La próxima migración libre es la `0017`.** `0013` y `0014` siguen **reservadas** para ramas que se
ejecutan en otra máquina: un número libre en el disco no es un número libre.

## ✅ La demo está VIVA en producción (2026-08-07)

Desplegadas las migraciones y sembrada la demo contra Supabase real. **El informe se ve en el portal**:
las 14 páginas, el total de `$0.3097`, los tres `n/d` honestos, el aviso con las dos fechas y la descarga
bajando `informe-La-Birra-Bar.md`. Es la primera vez que el código de KR-2b toca datos reales y no PGlite.

## ✅ Desplegado el 2026-08-07 — y lo que el primer despliegue real destapó

Las **14** migraciones están aplicadas en producción, verificado contra la base. Se aplicaron tres (la
`0011` ya estaba, contra lo que decía esta nota). El orden importaba y sigue importando para el futuro:
`sembrarDemo` inserta en `kr_informes` y **el CLI de seed no corre migraciones**, así que migrar va primero.

**Lo que el despliegue encontró, y es la lección que vale guardar:** el runner moría **antes de la primera
migración**, en `asegurarAuthStandIn` — un stand-in de `auth.users` que existe para PGlite y que hacía
`create table if not exists auth.users`. Su comentario afirmaba que en Supabase era «un no-op porque el
`if not exists` no toca nada», y **nunca se había medido contra Supabase**: ahí el schema `auth` es de
`supabase_auth_admin`, y evaluar el `if not exists` **igual exige mirar dentro del schema**. Sin `usage`,
aborta con `permission denied for schema auth`. Arreglado en `78523b8` consultando `pg_class`/`pg_namespace`
—catálogos que se leen sin `usage`—, con la mutación que lo prueba: invertir el `if` deja 5 tests en pie de
187.

Que un helper de tests se ejecute en el camino de producción y afirme sin medir cómo se comporta ahí es el
mismo patrón que KR-2b persiguió doce veces. Éste solo podía aparecer desplegando.

## ✅ Cerrado — el tramo A del orquestador (2026-08-07)

El despliegue se partió en dos. El **A** —todo código, sin cuentas y sin gastar— está hecho; el **B** es
la cuenta de Inngest y el servicio en Railway, con
[runbook](../docs/proyecto/14-runbook-despliegue.md#desplegar-el-orquestador-fase-2--la-última-pieza)
escrito paso a paso.

Se hizo porque "solo faltan las cuentas" era falso. Lo que apareció al preparar el despliegue:

- **`POST /runs` ya estaba roto en producción**, y nada lo decía. Sin `INNGEST_EVENT_KEY` el SDK lanza en
  modo cloud —que se infiere por `RAILWAY_GIT_BRANCH`, no por `NODE_ENV`, que Railway ni define— y como
  la fila se crea antes de emitir (ADR-18), cada intento dejaba un **run huérfano** en `running`.
- **El orquestador caía a PGlite en memoria** sin su DSN: pagaba el research y lo escribía en una base
  que se evapora. Ahora en producción está prohibido, y `DATABASE_URL` tampoco alcanza (es el DSN del
  **dueño** que Railway inyecta solo: aceptarlo volvería ADR-17 una coincidencia de nombres).
- **No tenía health check.** `/_health` responde sin tocar Postgres ni Inngest.
- **`PIPELINE_MODO=mock|live`**, obligatoria en producción y sin default, decidida por Juan. No enciende
  nada: **declara**, y el arranque aborta si contradice a `DATAFORSEO_MODE` en cualquiera de las dos
  direcciones. Cierra el hermano del fallo de PGlite: un despliegue en mock escribiendo keywords
  **inventadas** en la base real, indistinguibles de un research legítimo.

**La lección que dejó, y que se repitió tres veces en la misma jornada:** afirmar el comportamiento de
una herramienta leyendo una parte de ella. Las tres veces el origen fue `helpers/consts.js`, que solo
lista **nombres** de variables, y de ahí se dedujo que el entorno era el único camino. Una vez lo escribí
yo en dos documentos; otra vez estaba en un comentario **y** en el código, donde la clave de firma se
validaba, se trimeaba y nunca llegaba a `serve()` — medido: **401 en toda invocación**, con `/_health`
diciendo `{"ok":true,"modo":"cloud"}`.

## ▶️ Lo próximo — cuatro candidatos, y por qué

**Ninguno está empezado.** Se eligió KR-2 y se cerró; esto es lo que queda sobre la mesa, con lo que cuesta
cada uno. La decisión es de Juan.

| Candidato | Qué desbloquea | Qué cuesta |
|---|---|---|
| **Desplegar el orquestador — tramo B** *(recomendado)* | Cierra Fase 2. Hoy **el pipeline real nunca corrió en producción**: todo lo que hay en Supabase está sembrado a mano. El **tramo A está hecho** (2026-08-07): el código ya no arranca mal configurado y el runbook tiene el paso a paso | Cuenta de Inngest + servicio en Railway. Se despliega y verifica con el provider **mock**, sin gastar. **Empieza por la API**, que ya no levanta sin `INNGEST_EVENT_KEY` |
| **El entregable del restaurante** | La única pieza que **Frank ve**. Es el informe *sin* el bloque de coste, y es la dueña del **PDF** que ADR-07 pedía | Solo código. Gran parte se reutiliza de KR-2b (mismo `renderReport`, misma tabla, misma pantalla) |
| **El margen legible por el rol `cliente`** | Cierra la deuda 🔴 del `09`. No es fuga activa (no hay usuarios con ese rol), pero la demo ya está en producción | Toca `RunSummary` y la pantalla del brief |
| **KR-1/KR-3: el dataset** | Llena los tres `n/d` del informe y calibra `VOLUMEN_PERCENTIL_TOPE` y `PESO_CONFIANZA_ORDEN`, hoy puestos sin dato | **~$0.31** y ~16 min contra DataForSEO en producción. **Y hay que volver a sandbox después** |

**Por qué el orquestador primero, y no por completitud:** es donde queda más superficie sin estrenar. El
step `guardar-informe` de KR-2b tiene 22 tests y **jamás se ejecutó fuera de PGlite**. El 2026-08-07 se
midió lo que eso vale: un helper con 204 tests en verde murió en el primer contacto con Supabase, porque
afirmaba sin medir cómo se comportaba en el único camino que ningún test recorre. El orquestador tiene esa
misma clase de superficie, entera.

## Deuda que deja el tramo A

- **Las tres variables obligatorias nuevas no están en ninguna plantilla del repo.**
  `INNGEST_EVENT_KEY` (api) y `INNGEST_SIGNING_KEY` + `PIPELINE_MODO` (orquestador) no están en el
  `MAPA` de `scripts/env-sync.mts`, y `orchestrator/` no tiene `.env.example` (los otros cinco paquetes
  sí). **No es un olvido: el `permissions.deny` cubre `.env*`** y bloqueó a los tres agentes y a la
  sesión principal, incluso para leer. Van los dos juntos o ninguno —`scripts/env-sync.test.mts` ata el
  `MAPA` al `.env.example`—, así que queda para cuando el permiso se abra. En producción no bloquea (las
  variables se cargan en Railway); molesta para correr el orquestador real en local.
- **La sonda del modo del SDK está duplicada** en `api/src/deps.ts` y `orchestrator/src/config.ts`, las
  dos leyendo la API privada `cliente["mode"]`. La revisión midió que **los dos chequeos de forma son
  equivalentes** hoy, y que nada los mantiene sincronizados mañana. Unificarlas no es un refactor: el
  único paquete compartido es `contrato/`, y `AGENTS.md` dice que solo depende de `zod`.
- **La coherencia de `PIPELINE_MODO` solo se comprueba contra DataForSEO**, no contra el LLM ni
  Storyblok. Es deliberado —la prosa mock se lee como mock y el publisher en dry-run reporta
  `published: false`; un volumen de búsqueda inventado es el único que pasa por dato real—, pero si
  alguien quiere cerrarlo, el lugar es `verificarCoherencia` y el costo es que `LLM_PROVIDER` pase a ser
  obligatoria en `live`.

## Deuda menor que dejó el despliegue del 2026-08-07

- **`env:sync` avisa de cuatro claves «en la fuente pero sin destino»** y no distingue las deliberadas de la
  basura. Tres lo son a propósito —`DATABASE_URL_RENDER`, `PREVIEW_SECRET` y `STORYBLOK_WEBHOOK_SECRET` no
  se reparten al renderizador, y hay un test que lo **impone**: *"el renderizador NUNCA recibe una
  credencial de base de datos"*—, pero **`SUPABASE_JWT_SECRET` sí es basura**: `api/src/auth.ts:84` dice que
  la firma se verifica contra el JWKS público desde hace tiempo. El aviso genera la misma duda cada vez que
  alguien corre el comando.
- **El CLI de despliegue no dice en qué punto falló** cuando el error es anterior al bucle de migraciones.
  El runner prefija sus fallos con *"La migración X falló y se revirtió"*, así que un error pelado significa
  *"falló antes"* — pero eso hay que deducirlo leyendo el código. Diagnosticar el fallo del 2026-08-07 costó
  cuatro lecturas por no tener esa línea.

## Deuda con nombre que deja KR-2b

- **Los `*.test.ts` del portal no los typechequea ningún tsconfig.** `tsconfig.app.json` los excluye y
  `tsconfig.spec.json` solo incluye `*.spec.ts` — así que los **207** tests `node:test` del portal nunca
  pasan por `tsc`. Medido metiendo un error de tipos descarado: el build pasa igual. Los `*.spec.ts` **sí**
  están cubiertos. El arreglo es un `include`, y quedó fuera de alcance a propósito.
- **`una-sola-fuente.test.ts` solo barre esquemas Zod.** No ve mirrors **de tipos**: por eso no pudo cazar el
  `BriefDelPipeline` del orquestador, que recortaba cinco campos del brief. Ese mirror se eliminó, pero el
  guardián sigue con el punto ciego — y hay un candidato nuevo, `ESCAPABLES` del portal contra el escapado de
  `contrato`, hoy idénticos y sin nada que los ate.
- **`force row level security` de `kr_informes` no tiene test propio.** La versión buena es un barrido de
  todas las tablas, no enumerar ésta.
- **El total del coste sigue visible para el rol `cliente`** en la pantalla del brief (`$0.3097`). No lo
  causa KR-2b y el plan lo declaró fuera de alcance; lo que KR-2b sí hizo fue **corregir la copy** que
  afirmaba lo contrario. Cerrarlo es una pieza propia: toca `RunSummary` y esa pantalla.

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

**~~Las migraciones `0011`, `0012`, `0015` y `0016` están escritas y NO desplegadas~~ — desplegadas el
2026-08-07.** Se aplicaron tres (la `0011` ya estaba), y la base quedó con las **14**, verificado contra
producción. No queda ninguna pendiente.

**Decisión que no toma un agente:** **regenerar el dataset crudo** cuesta **~$0.31** y ~16 min contra
DataForSEO en producción. Sin él, `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` quedan
sin calibrar y `TIPOS_MAP_PACK` sin verificar. **Y si se corre, hay que volver a sandbox** en
`kr-service/.env`. Con KR-2b ya **es** visible: el informe de la demo sale con **tres huecos**
en `n/d` (el desglose de coste y las dos coberturas) hasta que exista el dataset. El total, `$0.3097`, sí
está medido y se muestra.

**El margen de la agencia es legible por el rol `cliente`**, y no lo causa KR-2: `run_select` sobre
`kr_runs` usa `app.ve_cliente(client_id)`, así que un `cliente` ve `coste_micros_usd` de su propio run (el
`coste_breakdown` no: `getRun` no lo selecciona, verificado en la review de rama). **No es fuga activa** —no hay usuarios con ese rol— pero el rol existe y RLS lo
contempla. Cerrarlo toca `RunSummary` y la pantalla del brief: **es una pieza propia**.

**El entregable que la agencia le pasa al restaurante no existe.** Sería el informe **sin el bloque de
coste**, y es la pieza dueña del **PDF** que ADR-07 pedía (ver la nota fechada en ADR-07).

**Toda la configuración de skill-map es local a esta máquina.** `.skill-map/` está gitignoreado entero, así
que `respectGitignore`, `ignore` y `referencePaths` **no viajan con el repo**.

**~~Sin verificar contra producción~~ — verificado el 2026-08-07:** hay **14** migraciones aplicadas, que
son las 14 del repo. El `README` de `docs/proyecto/` decía 10 y quedó corregido.

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
