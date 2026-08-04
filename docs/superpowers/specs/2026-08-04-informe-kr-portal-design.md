# KR-2 — El informe legible del research, en el portal

**Fecha:** 2026-08-04 · **Estado:** spec aprobada, sin implementar
**Pieza:** KR-2 de la demo del módulo de Keyword Research
([`09` § 2.b](../../proyecto/09-estado-y-roadmap.md))

---

## 1. Qué se construye, y para qué

`renderReport()` produce **el mejor entregable del módulo 2**: el informe legible que recibe el
restaurante — coste, calidad de los datos, páginas separadas por evidencia, detalle por página y
backlog. Hoy solo existe como `out/informe.md` después de correr el CLI a mano, así que **no se puede
mostrar**: el guion de la demo KR abre por el entregable ("entregable primero, pipeline después") y el
entregable no está en ninguna pantalla.

KR-2 lo lleva al portal. Al terminar, la agencia abre un run y ve el informe; y se lo puede descargar
como `.md` para mandárselo al cliente.

**Lo que KR-2 no es.** La pantalla del brief que ya existe
([`portal/src/app/pages/brief/brief.ts`](../../../portal/src/app/pages/brief/brief.ts)) es para
**operar la compuerta**: aprobar y editar páginas. No muestra coste, ni calidad de datos, ni el detalle
por página, ni el backlog. El informe no la duplica — la complementa.

## 2. Las decisiones que ya estaban tomadas

| Decisión | Elegido | Cuándo |
|---|---|---|
| Cómo se comparte `renderReport()` | **(b) paquete compartido** — y de paso cierra la deuda del Zod duplicado M2/M1 | 2026-08-04 |
| Superficie | **Pantalla en el portal + botón de descarga `.md`** | 2026-08-04 (Juan) |
| Vigencia | **El `.md` se guarda ya renderizado** con el run | 2026-08-04 (Juan) |
| El informe congelado no refleja las ediciones del revisor | **Se declara en la pantalla**, no se esconde | 2026-08-04 (Juan) |
| Markdown → HTML | **Parser propio**, sin `innerHTML` ni dependencia nueva | 2026-08-04 (Juan) |
| Entrega | **Dos etapas**: KR-2a (paquete) y KR-2b (feature) | 2026-08-04 (Juan) |

## 2.1 Qué dice ADR-07, y qué de eso cumple esta spec

**ADR-07 decidió un doble entregable: JSON estructurado + informe legible «Markdown→PDF»**
([`decisiones-arquitectura.md`](../../decisiones-arquitectura.md) § ADR-07). Esta spec **cumple la mitad
del informe legible y posterga el PDF**, y hay que decirlo en lugar de dejar la promesa flotando:

- ✅ El informe legible existe (`renderReport`) y ahora **llega a un humano sin correr un CLI**. Eso es
  lo que ADR-07 quería del entregable.
- ⏸️ **El PDF queda fuera** (§10). ADR-07 lo nombra como formato, no como requisito con fecha, y la
  pantalla + `.md` cubren el caso de uso real (revisar en el portal, mandar el archivo). Si el PDF llega
  a hacer falta, se genera **desde el mismo `.md`** y no obliga a rehacer nada de esto.
- ❗ La alternativa que ADR-07 **descartó** fue "JSON + dashboard interactivo (queda para F3)". Una
  pantalla que **muestra un informe** no es ese dashboard: no hay filtros, ni agregaciones, ni
  exploración. Vale decirlo porque el parecido superficial invita a leer esta spec como una violación de
  ADR-07, y no lo es.

**Al implementar KR-2b hay que actualizar ADR-07** con el estado real del entregable: el Markdown se
sirve, el PDF sigue diferido. Un ADR que promete un formato que nadie construyó es una promesa vieja que
envejece sola.

## 3. Lo que se midió antes de escribir esta spec

Cinco hechos que cambiaron el diseño. Están acá porque cada uno habría producido una degradación
silenciosa si se hubiera asumido lo contrario.

1. **El `backlog` no se persiste en ninguna parte.** `mapClustersToPages` lo produce y viaja en el
   brief ([`run.ts:398`](../../../kr-service/src/pipeline/run.ts#L398)), pero `savePages` solo guarda
   páginas. Un informe reconstruido desde la base saldría **sin la sección "Backlog", sin avisar**.
   Guardar el `.md` renderizado desde el brief en memoria lo resuelve: el backlog está ahí.
2. **El run de la demo no lo produjo el pipeline: lo siembra `sembrarDemo`** con un `insert` a mano
   ([`seed-demo.ts:489`](../../../db/src/seed-demo.ts#L489)). Escribir el `.md` "al terminar el
   research" lo dejaría **sin informe** — y el `out/informe.md` de la corrida real **no existe en
   ninguna máquina** (`out/` no existe: es el mismo incidente de KR-1). De ahí sale el ajuste del §4:
   hay **dos productores de runs**, y los dos escriben el informe.
3. **`brief.cliente` se deriva del prompt**, no de `clients.nombre`
   ([`run.ts:395`](../../../kr-service/src/pipeline/run.ts#L395)). Es un argumento a favor de guardar
   el `.md`: el informe guardado dice lo que el pipeline dijo, sin que dos fuentes produzcan dos textos.
4. **`renderReport` emite `NaN` con datos incompletos.** Con `coste_breakdown: {}` —que es el default
   de la columna y lo que el seed deja hoy— las tres filas de la tabla de coste
   ([`brief.ts:61`](../../../kr-service/src/pipeline/brief.ts#L61)) y `cobertura_kd`
   ([`brief.ts:80`](../../../kr-service/src/pipeline/brief.ts#L80)) salen mal. Es un bug real, hoy
   invisible porque el único llamador es el CLI, que siempre tiene el brief completo.
5. **El desglose de coste por proveedor de la corrida de la demo NO quedó registrado.**
   `docs/historia/acciones/06-corrida-final-demo.md` registra el **total** (`$0.3097`, `309700` micros)
   y nada más. La tabla de desglose del `09` (`$0.2522 / $0.0586 / $0.0000`) es de **otra corrida** —52
   keywords → 8 páginas—, y con 14 páginas hay más llamadas LLM de contenido, así que el LLM de
   generación **no puede ser el mismo número**. Copiarlo al seed sería inventar una cifra. Ver §8.

Lo que sí está registrado de esa corrida: **55 keywords → 14 páginas, $0.3097**
([`09:428`](../../proyecto/09-estado-y-roadmap.md)).

6. **El contrato no admite "no sé" en la calidad de los datos.** `DataQuality.cobertura_volumen` y
   `cobertura_kd` son `number` no-nullable ([`types.ts:38`](../../../kr-service/src/types.ts#L38)) y el
   esquema Zod exige `z.number().min(0).max(1)`. Así que **para que el informe pueda decir `n/d` hay que
   relajar el contrato**: es la misma corrección que la tanda 4 le hizo a volumen y dificultad, que
   quedó sin aplicar a `DataQuality`. Relajarlo es seguro: nadie los lee como número —el orquestador y
   el portal los pasan como `Record<string, unknown>` opaco—, el único lector es `renderReport`.
7. **El `cobertura_volumen: 0.571` que el seed guarda hoy es por PÁGINA, no por keyword** — lo dice su
   propio comentario ([`seed-demo.ts:503`](../../../db/src/seed-demo.ts#L503)): 8 de 14 páginas. Pero el
   informe lo pinta como _"Keywords con **volumen** conocido"_
   ([`brief.ts:79`](../../../kr-service/src/pipeline/brief.ts#L79)). **En cuanto el informe lo muestre,
   el entregable de la demo afirma algo falso** — 57% de las keywords, cuando el dato es de páginas y
   las keywords eran 55. Hoy no se ve porque nada lo pinta.
8. **La columna `calidad_datos` es un `jsonb` que no valida nada**, y lo que el seed le pone **no cumple
   `DataQuality`**: le falta `cobertura_kd` y `endpoints_degradados`, y tiene dos campos que el tipo no
   define (`keywords_con_volumen`, `keywords_totales`). El tipo existe en TypeScript y la base no lo
   conoce.

## 4. Arquitectura

```
                        ┌──────────────────────────────────┐
                        │  contrato/  (7º workspace)        │
                        │  · tipos del brief                │
                        │  · UN esquema Zod (M2 = M1)       │
                        │  · renderReport()                 │
                        │  dependencias: zod                │
                        └──────────────────────────────────┘
                          ▲          ▲          ▲        ▲
              kr-service ─┘  web-builder │      api │    │ db (solo el seed)
                                          └──────────┘

  DOS productores de runs, UN método del store:

  orchestrator ─ al terminar el research ─┐
                                           ├─→ PgStore.guardarInforme(ctx, runId, md)
  sembrarDemo  ─ al sembrar la demo ──────┘         └─→ kr_informes  (migración 0016, solo staff)

  UN consumidor:  api  ──→  GET /runs/:id/informe      (pantalla)
                            GET /runs/:id/informe.md   (descarga)
                                     └─→ portal
```

### 4.1 El paquete `contrato/`

Nuevo workspace. Contiene los tipos del brief, **un** esquema Zod y `renderReport()`. Única
dependencia de producción: `zod`. No conoce Postgres, ni HTTP, ni UI.

No hay ciclo: `contrato` no depende de nadie, y hoy `kr-service → db`, `api → db`, `orchestrator →
{db, kr-service, web-builder}`.

**Cierra la deuda del Zod duplicado M2/M1** ([`09` § 4](../../proyecto/09-estado-y-roadmap.md)): hoy el
contrato del brief vive en [`kr-service/src/validation/brief.schema.ts`](../../../kr-service/src/validation/brief.schema.ts)
y en [`web-builder/src/contract.ts`](../../../web-builder/src/contract.ts).

> **Riesgo con nombre.** Si los dos esquemas divergieron, unificarlos **relaja uno o rompe el otro**.
> Se diffean antes de tocar nada, la divergencia se escribe en el plan campo por campo, y los fixtures
> de los dos lados tienen que pasar contra el esquema unificado **sin editarlos**. Si un fixture hay
> que editarlo, eso no es un ajuste: es la divergencia, y se decide explícitamente cuál de los dos
> lados tenía razón.

### 4.2 `renderReport()` endurecido, y el contrato que admite "no sé"

Un dato ausente se muestra como **`n/d`**, nunca como `0` ni como `NaN`. Es la regla que ya gobierna
volumen y dificultad ([`brief.ts:42`](../../../kr-service/src/pipeline/brief.ts#L42)), extendida a
`coste_breakdown` y a `calidad_datos`.

Para eso hay que **relajar el contrato**: `DataQuality.cobertura_volumen` y `cobertura_kd` pasan de
`number` a `number | null`, en el tipo y en el esquema Zod (§3.6). No es un extra: hoy el tipo obliga a
poner un número, y **poner un número que no se midió es inventarlo**. Es seguro porque el único lector
que los interpreta es `renderReport`; el resto los pasa como `Record<string, unknown>`.

`endpoints_degradados` **no** se relaja: un array vacío ya significa "ninguno falló", que es un dato, no
una ausencia.

**Y una decisión de forma, no solo de valor:** cuando no hay desglose por proveedor, **no se pinta la
tabla de desglose**. Se pinta el total —que sí es un dato— con una nota de que el desglose no quedó
registrado. Una tabla de tres `n/d` es peor que no tenerla: ocupa el lugar del argumento comercial
("81% DataForSEO / 19% LLM") sin decirlo, y parece un fallo del sistema en vez de un dato que falta.

## 5. La migración `0016`

`0013` y `0014` están **reservadas** para las ramas que se ejecutan en otra máquina
([`plan del portal-agencia` §4](../plans/2026-08-01-portal-agencia-programa.md)). La `0016` es la
próxima libre; un número libre en el disco no es un número libre.

### 5.1 Tabla propia, no una columna de `kr_runs` — y el motivo es de seguridad

La versión anterior de esta spec ponía `informe_md` como **columna de `kr_runs`**. Está mal, y el motivo
es concreto: **RLS es por fila, no por columna.** Cualquiera que pueda ver el run vería el informe — y el
informe lleva el **coste que la agencia le paga a DataForSEO**, o sea su margen.

El rol `cliente` existe en el esquema, es el dueño del negocio en el portal, y **ve los runs de su
cliente**. Un grant por columna no lo distingue de `equipo`: los dos conectan con el **mismo** rol de
Postgres (`app_user`); lo que los separa es la política RLS, que opera sobre filas. Ya hubo una fuga de
exactamente esta clase con `kr_keywords`
([`0001_init.sql:453`](../../../db/migrations/0001_init.sql#L453)) y otra con las notas internas del CRM.

Con el informe en su propia tabla, la fila **es** el informe, así que la política puede exigir staff:

```sql
create table kr_informes (
  run_id       uuid primary key references kr_runs(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  client_id    uuid not null,
  informe_md   text not null,
  generado_at  timestamptz not null default now(),
  -- Misma FK compuesta que kr_pages: la fila no puede mentir sobre a qué run/tenant/cliente pertenece.
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade
);

alter table kr_informes enable row level security;
alter table kr_informes force  row level security;

-- `app.es_staff()` es una ALLOWLIST POSITIVA que falla cerrado: un rol NULL o desconocido no ve nada
-- (0001_init.sql § FALLAR CERRADO). NO se usa `is distinct from 'cliente'`, que falla abierto.
create policy informe_staff on kr_informes
  for all to app_user, app_service
  using      (tenant_id = app.current_tenant_id() and app.es_staff())
  with check (tenant_id = app.current_tenant_id() and app.es_staff());
```

**Un `cliente` no recibe un 403: no recibe la fila.** El endpoint devuelve `informe_md: null` y la API
no tiene ni un `if` de rol — la autorización la impone Postgres (ADR-15). Que un run **sin** informe y
un `cliente` **sin permiso** se vean igual desde afuera es correcto: la API no debe revelar que existe
algo que no puede mostrar.

> Con `run_id` como PK hay **un** informe por run. El día que haga falta una variante para el cliente
> (sin coste) va a necesitar migración igual — la PK pasa a `(run_id, variante)`. Se dice acá para no
> dejar escrita la promesa cómoda de que "ya está preparado": no lo está, y creerlo es peor que saberlo.

### 5.2 La tabla propia también elimina la trampa de `orden_brief`

Cuando el informe era una columna de `kr_runs`, había que escribirlo **en sentencia propia** por la
lección de la etapa B: dentro del upsert de `savePages`, en el `where` habría revocado la aprobación de
páginas que no cambiaron, y solo en el `set` no se habría escrito en un reintento.

**Con la tabla propia esa trampa no existe:** el informe no toca `kr_pages`, así que no puede revocar
una aprobación. La garantía pasó de **disciplinaria** (acordarse de la sentencia propia) a
**estructural** (el esquema no lo permite).

Y por lo tanto **no hay mutación de una línea que la pruebe** — la única forma de reintroducir el bug
sería mover la escritura dentro de `savePages`, que es un cambio de estructura, no una mutación. Se
escribe así en el código, en lugar de dejar creer que hay un test cubriéndola. (Es el mismo criterio con
que se documentó que PGlite serializa y por eso la carrera de `savePages` no tiene test.)

`guardarInforme` sí es **idempotente**: `insert … on conflict (run_id) do update`. Un reintento del step
del orquestador reescribe el informe en lugar de fallar por PK duplicada.

**Quién NO puede leerlo.** Tres capas, y las tres se prueban:

| Quién | Por qué no llega | Se prueba con |
|---|---|---|
| Otro tenant | `tenant_id = app.current_tenant_id()` | el patrón de aislamiento: probar que el OTRO no ve |
| El rol `cliente` **del mismo tenant** | `app.es_staff()`, allowlist positiva | un `cliente` con el run visible que **no** recibe la fila |
| `app_render` | sin ningún grant sobre `kr_informes` | mutación: concederle `select` y ver caer el test |

`app_render` es el rol más pobre del sistema (ADR-19): sus grants son `usage` en los schemas y `select`
**por columna** sobre `clients`
([`0007_render_publico.sql:116`](../../../db/migrations/0007_render_publico.sql#L116),
[`0008`](../../../db/migrations/0008_render_endurecido.sql#L114)). La `0016` **no le concede nada** — y
eso se prueba, no se afirma acá.

## 6. Los endpoints

| Método | Ruta | Devuelve |
|---|---|---|
| `GET` | `/runs/:id/informe` | `{ informe_md: string \| null, generado_at: string \| null }` |
| `GET` | `/runs/:id/informe.md` | `text/markdown` + `Content-Disposition: attachment` |

**Run inexistente o de otro tenant → `404`.** Run que existe **sin** informe → **`200` con `null`**. Un
404 mentiría: el run existe, y el portal necesita distinguir "no hay run" de "hay run sin informe" para
decir cuál de las dos cosas pasa.

**Un rol `cliente` cae en el mismo `200` con `null`**, porque la política no le devuelve la fila (§5.1).
La API no lo distingue de "no hay informe" **a propósito**: no debe revelar que existe algo que no puede
mostrar. Y no hay ni un `if` de rol en el endpoint — la decisión es de Postgres (ADR-15).

En `/runs/:id/informe.md`, la ausencia de informe (por cualquiera de las dos razones) es un **`404`**: no
hay archivo que bajar.

> **El `filename` de la descarga es una superficie de inyección de header.** Sale del nombre del
> cliente, que es texto que un humano escribe en el CRM: un `\r\n` ahí parte la respuesta HTTP, y un
> `"` rompe el header. Se sanea con **allowlist** de caracteres (no con una lista de prohibidos), con
> longitud tope, y con un fallback fijo si no queda nada. Test con un nombre que trae `\r\n`, `"` y
> caracteres no-ASCII.

## 7. La pantalla

Ruta `/runs/:id/informe`, con link desde la pantalla del brief. **El link aparece siempre**, incluso
cuando el run no tiene informe: esconderlo haría que nadie sepa que la función existe. Es la pantalla la
que explica qué pasa.

### 7.1 Markdown → HTML sin `innerHTML`, y por qué no es negociable

El informe contiene texto generado por LLM: `h1`, `meta_title`, `meta_description`, FAQs, secciones
sugeridas. El paso Markdown → HTML es, por definición, **superficie de inyección**.

- **`marked` + `DOMPurify`** falla **abierto**: si el sanitizador se configura mal, pasa todo. Y suma
  dos dependencias a un portal que hoy no tiene ninguna de esa clase.
- **`bypassSecurityTrustHtml`** es exactamente lo que Angular tiene para no usar.

Se hace así: **el Markdown se parsea a una estructura de datos y se pinta con `@if`/`@for`.** Angular
escapa el texto por defecto, así que la inyección es **imposible por construcción**, no evitada por
configuración. El subconjunto es cerrado porque **escribimos el generador**: encabezados `#`/`##`/`###`,
tablas, listas `-`, blockquote `>`, `**negrita**`, `_cursiva_`, `` `código` ``. Cualquier cosa fuera de
ese conjunto se pinta como **texto literal** — falla cerrado.

> **Esto no es la opción (c) que se descartó.** La (c) era que el portal *generara* el informe desde el
> brief, duplicando qué secciones tiene y cómo se calculan. Acá el portal **pinta un Markdown ya
> generado**: no decide nada del contenido. Lo compartido es un formato, no lógica de dominio.

El parser vive en el **portal** (`portal/src/app/core/`), no en `contrato/`: el paquete compartido no
sabe de UI.

### 7.2 Lo que la pantalla dice de sí misma

El informe está **congelado en el momento en que se generó** — es la consecuencia directa de guardarlo
renderizado. La pantalla lo declara, en vez de dejar que el revisor descubra la discrepancia solo:

> _Informe generado el <fecha>. Refleja el brief original; las ediciones posteriores del revisor no
> están incluidas._

Es la misma honestidad que `n/d` en lugar de `0`: el sistema dice lo que sabe y lo que no.

Y cuando el run no tiene informe (todos los anteriores a la `0016`), la pantalla lo dice con esas
palabras. No un spinner infinito, no un error.

## 8. El seed

El run de la demo se siembra con campos que `renderReport` necesita y que hoy no están —o están mal:

| Campo | Hoy | Qué se siembra |
|---|---|---|
| `coste_breakdown` | default `'{}'` | **nada**: el desglose de esa corrida no quedó registrado (§3.5). Se muestra el **total** `$0.3097`, que sí está medido, y se omite la tabla de desglose con una nota |
| `calidad_datos.cobertura_volumen` | `0.571`, **por página** | **`null`**: el dato por keyword se perdió con `out/brief.json`. Sale `n/d` (§3.7) |
| `calidad_datos.cobertura_kd` | ausente | **`null`** — no quedó registrado en ninguna parte. Sale `n/d` |
| `calidad_datos.endpoints_degradados` | ausente | `[]` — la corrida no reportó fallos de endpoint |
| `keywords_analizadas` | no existe | **55** ([`09:428`](../../proyecto/09-estado-y-roadmap.md)) |
| `backlog` | no existe | **`[]`**: qué clusters quedaron fuera no se registró. Con `[]` la sección no se pinta, que es correcto — **no se inventa un backlog plausible** |

`keywords_con_volumen: 8` y `keywords_totales: 14` se van: son campos que `DataQuality` no define (§3.8)
y cuyo nombre miente (son páginas). El mock del portal
([`cartera-mock.ts:116`](../../../portal/src/app/core/cartera-mock.ts#L116)) lleva la misma copia, y
`cartera-portal.test.ts` los ata: **el test va a exigir el cambio en los dos lados**, que es exactamente
para lo que existe.

Después, `sembrarDemo` renderiza el informe con `renderReport()` y lo guarda con `guardarInforme`. Eso
hace que **el run de la demo tenga informe sin gastar $0.31**, y de paso pone el camino de datos
incompletos **en la pantalla de la demo**: si el endurecimiento del §4.2 estuviera mal, se ve enseguida.

### 8.1 La consecuencia que hay que aceptar antes de empezar

**El informe de la demo va a tener tres huecos:** el desglose de coste por proveedor, y las dos
coberturas. El total (`$0.3097`), las 55 keywords, las 14 páginas, el split 8/6 por evidencia y el
detalle completo por página **sí** están.

Eso es la verdad del estado actual, no una decisión de diseño: los datos se perdieron con `out/`
(KR-1). Las dos salidas son mostrar `n/d` —honesto, y de paso demuestra en vivo que el sistema no
inventa— o **regenerar el dataset** (~$0.31, ~16 min, decide Juan), que los llena todos y de paso
calibra `VOLUMEN_PERCENTIL_TOPE` y `PESO_CONFIANZA_ORDEN`.

**KR-2 no depende de esa decisión** —el informe funciona con huecos— pero es el momento en que el $0.31
deja de ser una mejora interna y se vuelve visible en la demo.

## 9. Tests, y la mutación que prueba cada uno

**Rojo primero**, después el arreglo, después **reintroducir el bug y confirmar que cae exactamente su
test**. Y una mutación que no tumba nada es un resultado: o falta el test, o la línea no hace lo que su
comentario dice — hay que averiguar cuál antes de tocar el test.

| Garantía | Dónde | Mutación que la prueba |
|---|---|---|
| Un tenant no lee el informe de otro | `db` | quitar el `tenant_id = app.current_tenant_id()` de la política |
| El rol `cliente` **no** recibe el informe de su propio run | `db` | quitar `app.es_staff()` de la política |
| Un rol **ausente o desconocido** tampoco lo recibe | `db` | cambiar `app.es_staff()` por `app.current_role() is distinct from 'cliente'` |
| `app_render` **no** puede leer `kr_informes` | `db` | `grant select on kr_informes to app_render` |
| Un reintento reescribe el informe en vez de fallar | `db` | quitar el `on conflict (run_id) do update` |
| Sin desglose, el informe **no** emite `NaN` ni una tabla de `n/d` | `contrato` | devolver `usdFromMicros(undefined)` sin el guard |
| Una cobertura `null` sale **`n/d`**, no `NaN%` ni `0%` | `contrato` | volver `pct()` a `Math.round(n * 100)` sin el guard |
| Un `backlog` vacío **no pinta** la sección | `contrato` | quitar el `if (brief.backlog.length)` |
| Los fixtures de M2 **y** de M1 pasan el esquema unificado | `contrato` | relajar un campo que solo uno de los dos exigía |
| El seed y el mock del portal siguen diciendo lo mismo | `db` | cambiar `calidad_datos` en un lado solo (lo caza `cartera-portal.test.ts`, que ya existe) |
| Run sin informe → `200` con `null`, no `404` | `api` | devolver 404 cuando `informe_md` es null |
| El `filename` no puede inyectar un header | `api` | cambiar la allowlist por una lista de prohibidos |
| El parser **escapa** `<script>` y `<img onerror>` | `portal` | pintar la marca desconocida como HTML en vez de texto |
| Ninguna plantilla usa `innerHTML` / `bypassSecurityTrustHtml` | `portal` | agregar uno y ver caer el test |
| El link al informe existe en la pantalla del brief | `portal` | borrar el `routerLink` |

> ⚠️ **Ninguno de los tests de política puede usar la conexión del seed.** `sembrarDemo` recibe una
> `ConexionReservada` y **no pone contexto de tenant ni de rol**: el CLI conecta con
> `DATABASE_URL_ADMIN` (el `postgres.<project-ref>` de Supabase) y en PGlite el usuario es superuser, así
> que **RLS no lo alcanza** — ni siquiera con `force row level security`, que somete al _owner_, no al
> superuser. Un test de la política escrito con esa conexión **pasa siempre y no prueba nada**. Los tests
> de la tabla van con `app_user` y contexto puesto, como el resto de la batería de RLS.
>
> Esto también responde por qué la política no rompe el seed: el seed la esquiva por construcción. Es una
> excepción que ya existe para las otras nueve tablas, no algo que la `0016` introduzca.

**Las dos últimas filas de `db` van juntas y son la razón de que sean dos.** Un test con el rol `cliente`
correctamente puesto **no** caza la forma que falla abierto (`'cliente' is distinct from 'cliente'` es
FALSE, así que sigue negando): esa solo se destapa con el rol **ausente**, donde
`NULL is distinct from 'cliente'` da TRUE y concede visibilidad de maestro. Es el bug que
[`0001_init.sql` § FALLAR CERRADO](../../../db/migrations/0001_init.sql#L360) documenta como ya ocurrido.

El test que recorre el árbol de `src/app` buscando `innerHTML` sigue el patrón que el portal ya usa
para colores incrustados: **descubre** los archivos en vez de listarlos, así que cubre también las
pantallas que todavía no existen.

**Verificación en el navegador** (MCP chrome-devtools), porque leer el código y manejar la app
encuentran cosas distintas: el informe en claro y en oscuro, la tabla sin scroll horizontal en 390 px,
la descarga bajando un archivo con nombre correcto, y la consola limpia.

## 10. Fuera de alcance, a propósito

PDF · envío por email · informe interno vs. informe de cliente · versionado de informes · regenerar por
lote los informes de runs viejos · gráficos en el informe.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Los dos esquemas Zod divergieron y unificarlos relaja uno | Diff antes de tocar; los fixtures pasan **sin editarse** o la divergencia se decide explícitamente (§4.1) |
| `scripts/verificar.sh` dice **"6 paquetes"** en dos mensajes (líneas 120 y 140) | Con el 7º workspace queda mintiendo. Se deriva el número en vez de escribirlo |
| `scripts/env-sync.mts` reparte `.env` por paquete | `contrato/` no usa credenciales; hay que verificar que el reparto no falle con un paquete que no espera |
| ~~El informe lleva coste interno y el rol `cliente` ve los runs de su negocio~~ | ✅ **Resuelto en la spec**: tabla propia con política `app.es_staff()` (§5.1). Era el único riesgo que podía cambiar el diseño, y lo cambió |
| El informe de la demo sale con tres huecos | Consecuencia del dataset perdido, no del diseño (§8.1). Se acepta o se resuelve con KR-1 (~$0.31, decide Juan) |
| La migración no está desplegada | Se suma a `0011`, `0012` y `0015`, que tampoco lo están. No se despliega en esta pieza |
| `db/` corre PostgreSQL **16.4** y `api/` **18.3** | Cualquier comportamiento del motor que el plan afirme hay que **medirlo en el paquete donde corre**, no extrapolarlo del otro |

## 12. Las dos etapas

### KR-2a — el paquete `contrato/`

Extracción de tipos + `renderReport`, unificación de los dos esquemas Zod, **`DataQuality` con coberturas
nullable** (§4.2), endurecimiento contra datos incompletos, y el 7º workspace enganchado al arnés.
**Cero cambios visibles.**

Se cierra con: `npm run verificar` en verde, y los tests de `kr-service` y `web-builder` pasando **sin
editarse** (si hay que editarlos, es la divergencia del §4.1).

### KR-2b — la feature

Migración `0016` + `guardarInforme` + los dos productores + los dos endpoints + la pantalla + el parser
+ el seed.

**Por qué partido:** un refactor de contrato que toca cuatro paquetes no se mezcla con una feature
nueva. Si algo se rompe, hay que poder saber cuál de las dos fue.

### Reparto

| Etapa | Quién | Qué |
|---|---|---|
| KR-2a | `pipeline` | el paquete, la unificación Zod, `renderReport` endurecido (`kr-service` + `web-builder`) |
| KR-2a | `datos` | enganchar `contrato` como dependencia de `api`/`db` |
| KR-2b | `datos` | migración `0016`, `guardarInforme`, los dos endpoints, el seed |
| KR-2b | `front` | la pantalla, el parser, el link, los tests de componente |

**En serie donde comparten contrato:** `datos` fija la forma del endpoint antes de que `front` lo
consuma. El `revisor` va después de cada devolución — quien implementa no se autoaprueba. Integrar,
verificar el conjunto y commitear es de la sesión principal.
