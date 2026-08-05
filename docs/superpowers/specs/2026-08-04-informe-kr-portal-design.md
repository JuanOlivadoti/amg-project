# KR-2 — El informe legible del research, en el portal

**Fecha:** 2026-08-04 · **Estado:** spec aprobada, sin implementar
**Pieza:** KR-2 de la demo del módulo de Keyword Research
([`09` § 2.b](../../proyecto/09-estado-y-roadmap.md))

---

## 1. Qué se construye, y para qué

`renderReport()` produce **el informe de trabajo del módulo 2**: coste del research con su desglose,
calidad de los datos, páginas separadas por evidencia, detalle por página y backlog. Hoy solo existe
como `out/informe.md` después de correr el CLI a mano, así que **no se puede mostrar**: el guion de la
demo KR abre por el entregable ("entregable primero, pipeline después") y no está en ninguna pantalla.

KR-2 lo lleva al portal. La agencia abre un run, ve el informe, y puede descargarlo como `.md`.

### 1.1 El informe es un DOCUMENTO INTERNO de la agencia (decidido 2026-08-05)

La primera versión de esta spec decía que el `.md` servía "para mandárselo al cliente" **y** justificaba
la tabla staff-only porque el informe revela el margen. Las dos cosas no pueden ser ciertas. Resuelto:
**el informe es interno**. No es lo que recibe el restaurante.

Lo que **sí** es correcto —y es el motivo por el que el coste tiene que estar— es que **Frank es la
agencia**. El informe con el coste adentro no es una fuga hacia él: es el argumento de venta. "Este
research te costó $0.31; lo que le cobrás al restaurante no lo limita la API." Mostrárselo en la demo es
exactamente el punto.

**Lo que esto deja abierto, fuera del alcance de KR-2:** el entregable que la agencia le pasa al
restaurante **no existe todavía**. Sería este informe sin el bloque de coste, y probablemente en otro
formato (ver §2.1). Es una pieza de producto propia, no una variante que se cuele acá.

**Lo que KR-2 no es.** La pantalla del brief que ya existe
([`portal/src/app/pages/brief/brief.ts`](../../../portal/src/app/pages/brief/brief.ts)) es para
**operar la compuerta**: aprobar y editar páginas. Muestra el **coste total**
([`brief.ts:29`](../../../portal/src/app/pages/brief/brief.ts#L29)) — la primera versión de esta spec
decía que no mostraba coste, y era falso. Lo que no muestra es el **desglose**, la calidad de los datos,
el detalle por página ni el backlog. El informe no la duplica: la complementa.

> ### 🔴 El margen ya está expuesto al rol `cliente`, y no lo causa KR-2
>
> Verificado al comprobar lo anterior: `run_select` sobre `kr_runs` usa `app.ve_cliente(client_id)`
> ([`0001_init.sql:441`](../../../db/migrations/0001_init.sql#L441)), que da **true** para un rol
> `cliente` sobre su propio run. Así que un `cliente` puede leer `coste_micros_usd` y `coste_breakdown`
> **hoy**: `GET /runs/:id` devuelve el `RunSummary` completo y la pantalla del brief lo pinta.
>
> `kr_informes` con `app.es_staff()` sigue siendo la decisión correcta —**no agrava**, y el informe lleva
> mucho más que el total—, pero esta spec no puede presentarla como si cerrara la exposición del coste:
> la exposición ya existía por otra vía. Afirmar lo contrario sería una garantía de seguridad más fuerte
> de lo que el sistema cumple, que es el error que este proyecto persigue.
>
> **No hay usuarios con rol `cliente` hoy** (Frank `maestro`, Juan `equipo`), así que no es una fuga
> activa. Cerrarla toca `RunSummary` y la pantalla del brief: **es otra pieza**, y queda anotada como
> tal.

## 2. Las decisiones que ya estaban tomadas

| Decisión | Elegido | Cuándo |
|---|---|---|
| Cómo se comparte `renderReport()` | **(b) paquete compartido** — y de paso cierra la deuda del Zod duplicado M2/M1 | 2026-08-04 |
| Superficie | **Pantalla en el portal + botón de descarga `.md`** | 2026-08-04 (Juan) |
| Vigencia | **El `.md` se guarda ya renderizado** con el run | 2026-08-04 (Juan) |
| El informe congelado no refleja las ediciones del revisor | **Se declara en la pantalla**, no se esconde | 2026-08-04 (Juan) |
| Markdown → HTML | **Parser propio**, sin `innerHTML` ni dependencia nueva | 2026-08-04 (Juan) |
| Entrega | **Dos etapas**: KR-2a (paquete) y KR-2b (feature) | 2026-08-04 (Juan) |

## 2.1 ADR-07 pedía «Markdown→PDF», y el PDF cambió de dueño

**ADR-07 decidió un doble entregable: JSON estructurado + informe legible «Markdown→PDF»**
([`decisiones-arquitectura.md:133`](../../decisiones-arquitectura.md#L133)). KR-2 entrega pantalla y
`.md`, **no PDF**. La primera versión de esta spec proponía actualizar ADR-07 *después* de implementar,
y eso está mal: sería cambiar una decisión aceptada con el trabajo ya hecho, que es la forma más
cómoda de convertir una deuda en una decisión que nadie aprobó. Lo señaló la 14ª review.

**Lo que hay que ver primero: la decisión de §1.1 le quitó el motivo al PDF.** ADR-07 pedía PDF porque
el informe era el entregable de revisión para un humano, y el PDF es un formato de **entrega hacia
afuera** — se manda, se archiva, se imprime. Un documento **interno** que se lee en una pantalla del
portal no necesita PDF: necesita ser legible en el portal, que es exactamente lo que KR-2 hace.

Y el PDF **sí va a hacer falta** el día que exista el entregable del restaurante (§1.1) — que es otro
documento, sin el bloque de coste. Ahí el formato importa. **El PDF no desaparece: cambia de pieza.**

Aparte, generarlo hoy costaría una dependencia que el proyecto no tiene en ningún paquete (headless
Chrome o una librería de PDF) para la única superficie que la necesitaría, contra un invariante que dice
`tsx` sin paso de build.

> ### 📌 Recomendación, pendiente del OK de Juan
>
> **Registrar el cambio en ADR-07 con una nota fechada, ANTES de implementar KR-2b** — no un ADR nuevo:
> el precedente del propio repo es el bloque `> **Cumplido a medias el 2026-08-02**` de ADR-10. La nota
> dice tres cosas: que el informe legible se sirve como **pantalla + Markdown**, que el **PDF se traslada
> a la pieza del entregable del cliente** (que no existe y no tiene fecha), y por qué (§1.1: el informe
> es interno).
>
> Costo: un párrafo de documento, cero código. Lo que compra: que KR-2 no se cierre con una promesa
> incumplida flotando, y que la decisión quede con su motivo escrito el día que se tomó.

Y una cosa que ADR-07 **no** prohíbe, contra lo que el parecido sugiere: la alternativa que descartó fue
"JSON + dashboard interactivo (queda para F3)". Una pantalla que **muestra un informe** no es ese
dashboard —no tiene filtros, ni agregaciones, ni exploración— y la 14ª review lo confirmó
explícitamente.

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
                    ┌────────────────────────────────────────┐
                    │  contrato/  (7º workspace)              │
                    │  · tipos del brief        (compartidos) │
                    │  · renderReport()         (compartido)  │
                    │  · esquemaBase                          │
                    │      ├─ emisionM2  (estricto)           │
                    │      └─ consumoM1  (laxo, 4 versiones)  │
                    │  dependencias: zod                      │
                    └────────────────────────────────────────┘
                      ▲          ▲          ▲        ▲
          kr-service ─┘  web-builder │      api │    │ db (solo el seed)
                                      └──────────┘

  DOS productores del informe, UN render, DOS escrituras (§4.3):

  orchestrator ─ step `guardar-informe` ──→ PgStore.guardarInforme(ctx, runId, md)
  sembrarDemo  ─ dentro de SU transacción ─→ con.query("insert into kr_informes …")
                                                  └─→ kr_informes  (0016, solo staff)

  UN consumidor:  api  ──→  GET /runs/:id/informe      (pantalla)
                            GET /runs/:id/informe.md   (descarga)
                                     └─→ portal
```

### 4.1 El paquete `contrato/`

Nuevo workspace. Contiene los tipos del brief, `renderReport()` y **una base de esquema con dos
derivados**. Única dependencia de producción: `zod`. No conoce Postgres, ni HTTP, ni UI.

No hay ciclo: `contrato` no depende de nadie, y hoy `kr-service → db`, `api → db`, `orchestrator →
{db, kr-service, web-builder}`.

#### Los dos esquemas Zod NO se fusionan, y eso corrige esta spec

La primera versión decía "**un** esquema Zod (M2 = M1)" y ponía como criterio de cierre que los fixtures
de los dos lados pasaran **sin editarse**. **Las dos cosas eran imposibles**, y lo demostró la 14ª
review:

| | `kr-service/src/validation/brief.schema.ts` | `web-builder/src/contract.ts` |
|---|---|---|
| Versiones | la actual | **cuatro**: `kr.v0.2`…`kr.v0.5` ([`:17`](../../../web-builder/src/contract.ts#L17)) |
| `evidencia`, `score_confidence` | exigidos | **`.optional()`** a propósito ([`:46-47`](../../../web-builder/src/contract.ts#L46)) |
| `run_id`, `generated_at`, `backlog`, `meta_run` | exigidos | no los consume ni los pide |
| Para qué existe | validar **lo que M2 emite** | aceptar **lo que M1 puede recibir**, incluido lo viejo |

No son dos copias del mismo esquema: son **dos contratos con propósitos opuestos** que coinciden en la
parte de en medio. Fusionarlos obliga a que uno pierda su garantía — o M1 deja de aceptar briefs
históricos, o M2 deja de exigir campos que hoy exige. El comentario de `contract.ts` dice que la laxitud
es deliberada, así que no es deriva: es diseño.

**Lo que se comparte, entonces:** los **tipos** (una sola definición de `ProposedPage`,
`KeywordResearchBrief`, `DataQuality`…), **`renderReport()`**, y una **`esquemaBase`** de la que salen
`emisionM2` (estricta, versión actual) y `consumoM1` (laxa, multi-versión). La duplicación que se elimina
es la de los **tipos y las formas comunes**; los dos validadores siguen siendo dos, ahora con un ancestro
único en vez de dos archivos que se copiaron a mano.

> **Esto redefine qué significa "cerrar la deuda del Zod duplicado M2/M1"** del
> [`09` § 4](../../proyecto/09-estado-y-roadmap.md). La deuda real era *"dos fuentes de verdad del mismo
> contrato"*: eso se cierra. Lo que **no** se cierra —porque no era la deuda— es que haya dos
> validadores; son dos porque emitir y recibir no son la misma operación.

**Criterio de cierre corregido:** los fixtures de cada lado pasan **contra su propio derivado** sin
editarse. Y hay un test nuevo que fija la relación: **todo brief que valide `emisionM2` valida
`consumoM1`** (lo que M2 emite, M1 lo acepta). Al revés no: hay briefs `kr.v0.2` que M1 acepta y M2 ya no
emite, y eso es correcto.

### 4.2 `renderReport()` endurecido, y el contrato que admite "no sé"

Un dato ausente se muestra como **`n/d`**, nunca como `0` ni como `NaN`. Es la regla que ya gobierna
volumen y dificultad ([`brief.ts:42`](../../../kr-service/src/pipeline/brief.ts#L42)), extendida a
`coste_breakdown` y a `calidad_datos`.

Para eso hay que **relajar el contrato**: `DataQuality.cobertura_volumen` y `cobertura_kd` pasan de
`number` a `number | null`, en el tipo y en el esquema Zod (§3.6). No es un extra: hoy el tipo obliga a
poner un número, y **poner un número que no se midió es inventarlo**. Es seguro porque el único lector
que los interpreta es `renderReport`; el resto los pasa como `Record<string, unknown>`.

**`endpoints_degradados` también admite ausencia, y esto corrige la spec.** La primera versión decía que
no hacía falta relajarlo porque "un array vacío ya significa «ninguno falló», que es un dato, no una
ausencia". Eso es cierto **para el pipeline**, que sabe si falló un endpoint; es **falso para el seed**,
que no lo sabe — el registro de la corrida no lo conserva (§8). Sembrarlo como `[]` sería afirmar una
calidad que nadie midió, que es exactamente el error que las tres filas de arriba evitan. Lo señaló la
14ª review: yo trataba tres datos como desconocidos y **convertía el cuarto en certeza**.

Así que: `endpoints_degradados: string[] | null`. `[]` = "ninguno falló" (lo dice el pipeline);
`null` = "no se sabe" → el informe **omite** la advertencia y **dice que la omite**, en vez de callar.

### 4.3 Dos productores, un render, dos escrituras

La primera versión prometía "un solo método del store, dos llamadores". **No se puede**, y lo demostró la
14ª review: `sembrarDemo(con: ConexionReservada)` abre su propio `begin`, escribe todo con `con.query(…)`
y cierra con `commit` ([`seed-demo.ts:555`](../../../db/src/seed-demo.ts#L555)), mientras
`PgStore.withTenant` **siempre abre `pool.transaction`** — otra conexión, que no vería el run sin
confirmar. Llamarlo desde el seed fallaría por FK; llamarlo después del `commit` rompería la atomicidad
del seed.

| Productor | Cómo escribe |
|---|---|
| `orchestrator` | `PgStore.guardarInforme(ctx, runId, md)` — bajo RLS, rol `app_service`, dentro de `withTenant` (ADR-13) |
| `sembrarDemo` | `con.query("insert into kr_informes …")` **dentro de su propia transacción**, igual que ya inserta `kr_runs` y `kr_pages` |

**No es una excepción nueva: es el precedente que ya existe.** El seed inserta a mano todas sus tablas.
Lo que **sí** tiene que ser único es el **render** (`renderReport` en `contrato/`) — la lógica del
informe, no el `INSERT`. La unicidad importa donde vive una decisión, no donde vive una sentencia SQL.

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
  foreign key (run_id, tenant_id, client_id) references kr_runs (id, tenant_id, client_id) on delete cascade,

  /*
   * TOPE DE TAMAÑO, en la base y no en un comentario. El informe de 14 páginas mide decenas de KB; el
   * tope está una orden de magnitud arriba, así que solo lo toca un dato patológico (un LLM que
   * devuelve una FAQ de 2 MB). Va acá porque es el ÚNICO punto de escritura: con la constraint puesta,
   * ni el endpoint ni la pantalla necesitan lógica de tamaño — no pueden recibir algo que no entró.
   */
  constraint informe_tamano_razonable check (octet_length(informe_md) <= 262144)  -- 256 KiB
);

alter table kr_informes enable row level security;
alter table kr_informes force  row level security;

/*
 * LOS GRANTS. Una política SIN grant no da acceso: Postgres rechaza con 42501 ANTES de evaluar RLS.
 * Los grants del proyecto son listas EXPLÍCITAS por tabla (0001_init.sql:413 para app_user,
 * 0002_auth.sql:93 para app_service) y no hay `on all tables` ni `alter default privileges` en
 * ninguna migración: una tabla nueva nace SIN un solo privilegio para nadie.
 *
 * `app_render` NO recibe nada, y eso es la mitad de la decisión de ADR-19.
 */
grant select                         on kr_informes to app_user;     -- la API lee (staff, vía RLS)
grant select, insert, update, delete on kr_informes to app_service;  -- el orquestador escribe

-- `app.es_staff()` es una ALLOWLIST POSITIVA que falla cerrado: un rol NULL o desconocido no ve nada
-- (0001_init.sql § FALLAR CERRADO). NO se usa `is distinct from 'cliente'`, que falla abierto.
create policy informe_staff on kr_informes
  for all to app_user, app_service
  using      (tenant_id = app.current_tenant_id() and app.es_staff())
  with check (tenant_id = app.current_tenant_id() and app.es_staff());
```

> ### 🔴 Los grants faltaban, y era un bloqueante que ningún test habría atajado
>
> La primera versión de esta spec tenía la tabla, el `force RLS` y la política — **y ni un `grant`**. Lo
> encontró la 14ª review midiéndolo en PGlite: `app_service` recibía `42501 permission denied for table
> kr_informes` al insertar. La política autorizaba filas de una tabla a la que ninguno de los dos roles
> podía llegar.
>
> **`kr_informes` es la primera tabla que el proyecto agrega desde que existen los cuatro logins**
> (ADR-17, migración `0003`), así que el paso no estaba en ninguna rutina ni en ningún checklist. Queda
> como fila propia en la matriz de garantías (§9) y como línea nueva en
> [CHECKPOINTS.md](../../../CHECKPOINTS.md) al implementar: *toda tabla nueva necesita su `grant`, y el
> test que lo prueba es un `insert`/`select` con el login real, no con el superuser*.

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

**Con la tabla propia, el acoplamiento ACCIDENTAL desaparece:** `guardarInforme` no comparte el upsert
de páginas, así que no puede revocar una aprobación *de refilón*.

> **Pero NO es una garantía estructural, y la primera versión de esta spec decía que sí.** Lo corrigió la
> 14ª review: nada en el esquema impide que `guardarInforme` ejecute *además* un `update` sobre
> `kr_pages` — `app_service` tiene ese privilegio
> ([`0002_auth.sql:93`](../../../db/migrations/0002_auth.sql#L93)). Yo había convertido una garantía
> **debilitada** en una garantía **inexistente**, y encima usé esa conclusión para justificar que no
> hiciera falta un test. Es el patrón de la tanda 17, cometido en la sección que existe para evitarlo.
>
> **La mutación existe y va en la matriz (§9):** agregar
> `update kr_pages set approved = false where run_id = $1` dentro de `guardarInforme` tiene que tumbar un
> test que guarde un informe sobre un run con páginas aprobadas y verifique que **siguen aprobadas**.
> Lo que la tabla propia compra es que el bug ahora requiere que alguien lo escriba a propósito, en vez
> de heredarlo de un `where` compartido.

`guardarInforme` sí es **idempotente**: `insert … on conflict (run_id) do update`. Un reintento del step
del orquestador reescribe el informe en lugar de fallar por PK duplicada. **`generado_at` se reescribe con
el reintento** (es la fecha del último render, no del primero): la pantalla la muestra, así que tiene que
significar una sola cosa, y tiene fila en §9.

### 5.3 Dónde va la escritura en el workflow, y el invariante que eso fija

La primera versión no decía en qué punto del orquestador se guarda el informe. El workflow tiene **tres
steps con transacciones separadas** ([`workflow.ts:174-204`](../../../orchestrator/src/workflow.ts#L174)):
`research` → `guardar-paginas` → `cerrar-run`. Sin fijar el lugar, la 14ª review enumeró cuatro estados
inconsistentes posibles — entre ellos que un run nuevo sin informe se viera igual que un run anterior a la
`0016`.

**Va como step propio, entre `guardar-paginas` y `cerrar-run`:**

```
research → guardar-paginas → guardar-informe → cerrar-run
                                                  └─ status = 'pending_approval'
```

**El invariante que eso fija, y que es enunciable y testeable:** _un run en `pending_approval` (o
posterior) **siempre** tiene informe._ El brief vive en la memoización de Inngest (`paso.run("research")`),
así que un reintento del step lo tiene entero sin volver a pagar.

Y con el invariante, el mensaje de la pantalla deja de ser ambiguo: un run **sin** informe es uno anterior
a la `0016` o uno que **nunca llegó a `pending_approval`** — no un fallo silencioso de persistencia.

Los cuatro estados, explícitos:

| Estado del run | ¿Tiene informe? | Qué muestra la pantalla |
|---|---|---|
| `running` | no (todavía no se generó) | "el research está en curso" |
| `pending_approval`, `approved` | **sí**, por el invariante | el informe |
| `failed` | puede no tenerlo (cayó antes del step) | "el research falló; no hay informe" |
| `rejected` | sí, si llegó a `pending_approval` | el informe, con el estado a la vista |

Un run `failed` **que sí alcanzó a guardar informe lo conserva**: es evidencia de qué se pagó y qué se
obtuvo antes de caer, y borrarlo perdería justamente lo que sirve para el post-mortem.

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
> `"` rompe el header. Se sanea con **allowlist**, no con lista de prohibidos. Y con valores concretos,
> porque un default sin número no es un default — la primera versión decía "longitud tope" y "fallback
> fijo" sin decir cuáles:
>
> | | |
> |---|---|
> | Allowlist | `[A-Za-z0-9._-]`; todo lo demás → `-`, y los `-` consecutivos se colapsan |
> | Longitud máxima | **60** caracteres del nombre, más el sufijo |
> | Forma | `informe-<nombre-saneado>.md` |
> | Fallback | `informe.md`, si tras sanear no queda ningún carácter de la allowlist |
>
> Test con un nombre que trae `\r\n`, `"`, caracteres no-ASCII (`Ñ`, acentos, emoji) y uno que **queda
> vacío** después de sanear — ese último es el que ejercita el fallback, y es el que se olvida.

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
escapa el texto por defecto, así que **la inyección de HTML/JS es imposible por construcción**, no
evitada por configuración. El subconjunto es cerrado porque **escribimos el generador**: encabezados
`#`/`##`/`###`, tablas, listas `-`, blockquote `>`, `**negrita**`, `_cursiva_`, `` `código` ``. Cualquier
cosa fuera de ese conjunto se pinta como **texto literal** — falla cerrado.

#### Hay una SEGUNDA clase de inyección, y el generador es el que la deja pasar

La primera versión decía "la inyección es imposible por construcción" **sin delimitar de qué inyección
hablaba**. Para HTML/JS es cierto. Para la **estructura del propio Markdown** es falso, y lo encontró la
14ª review.

`renderReport` interpola texto de LLM **sin escapar delimitadores**
([`brief.ts:99-101`](../../../kr-service/src/pipeline/brief.ts#L99) para las celdas,
[`:133-147`](../../../kr-service/src/pipeline/brief.ts#L133) para el detalle por página):

```ts
`| ${offset + i + 1} | ${p.tipo} | ${p.keyword_principal} | ${metric(p.volumen)} | …`
```

| Lo que trae el dato | Qué le hace al informe |
|---|---|
| una keyword con `\|` | agrega columnas: la tabla se desalinea de ahí para abajo |
| un `h1` con `\n##` | inventa un encabezado y parte la sección |
| un slug con `` ` `` | abre un bloque de código que se come el resto |
| una FAQ con `_` o `**` | cambia el énfasis; en el peor caso simula una advertencia del sistema |

No ejecuta nada, pero **altera el significado del entregable** y puede **simular u ocultar** secciones —
incluidos los avisos de evidencia ⚠️, que son el argumento de venta.

**El arreglo va en `renderReport`, no en el parser:** escapar los delimitadores al interpolar (en celdas,
además, colapsar saltos de línea). El parser es el consumidor; el generador es el que produce el Markdown
mal formado.

> **Y esto es un bug que ya existe hoy**, en el `out/informe.md` del CLI: una keyword con `|` ya rompe la
> tabla. **KR-2 no lo introduce — lo hace visible en una pantalla.** Va en KR-2a, con el resto del
> endurecimiento de `renderReport`, porque es del generador y no de la feature.

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
| `calidad_datos.endpoints_degradados` | ausente | **`null`**, no `[]` — ver abajo |
| `keywords_analizadas` | no existe | **55** ([`09:428`](../../proyecto/09-estado-y-roadmap.md)) |
| `backlog` | no existe | **`[]`**: qué clusters quedaron fuera no se registró. Con `[]` la sección no se pinta, que es correcto — **no se inventa un backlog plausible** |

> **`endpoints_degradados: []` habría sido una certeza inventada.** La primera versión lo sembraba así
> ("la corrida no reportó fallos"), y eso es falso: la corrida **no registró nada** sobre endpoints. `[]`
> significa "ninguno falló" y lo habría afirmado sin fuente — el mismo error que las tres filas de arriba
> evitan, cometido en la cuarta. Lo señaló la 14ª review: trataba tres datos como desconocidos y
> **convertía el cuarto en dato**. Va `null`, y el informe dice que no lo sabe.

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
| **Los dos logins pueden usar la tabla** (§5.1) | `db` | borrar los dos `grant` → `insert` y `select` con el login real fallan con 42501 |
| `app_render` **no** puede leer `kr_informes` | `db` | los **dos** cambios juntos: `grant select … to app_render` **y** agregar `app_render` al `to` de la política |
| Un tenant no lee el informe de otro | `db` | quitar el `tenant_id = app.current_tenant_id()` de la política |
| El rol `cliente` **no** recibe el informe de su propio run | `db` | quitar `app.es_staff()` de la política |
| Un rol **ausente o desconocido** tampoco lo recibe | `db` | cambiar `app.es_staff()` por `app.current_role() is distinct from 'cliente'` |
| **Guardar el informe NO revoca aprobaciones** (§5.2) | `db` | agregar `update kr_pages set approved = false where run_id = $1` dentro de `guardarInforme` |
| Un reintento reescribe el informe en vez de fallar | `db` | quitar el `on conflict (run_id) do update` |
| **Un reintento actualiza `generado_at`** | `db` | quitar `generado_at` del `do update set` → la fecha queda la del primer render |
| **La fila no puede apuntar a un run de otro tenant/cliente** | `db` | bajar la FK compuesta a `references kr_runs(id)` a secas |
| **Un informe de más de 256 KiB se rechaza** | `db` | quitar el `check informe_tamano_razonable` |
| **Un run `pending_approval` siempre tiene informe** (§5.3) | `orchestrator` | mover el step `guardar-informe` **después** de `cerrar-run` |
| Sin desglose, el informe **no** emite `NaN` ni una tabla de `n/d` | `contrato` | devolver `usdFromMicros(undefined)` sin el guard |
| Una cobertura `null` sale **`n/d`**, no `NaN%` ni `0%` | `contrato` | volver `pct()` a `Math.round(n * 100)` sin el guard |
| `endpoints_degradados: null` **omite la advertencia y lo dice**; `[]` la omite en silencio | `contrato` | tratar `null` como `[]` |
| Un `backlog` vacío **no pinta** la sección | `contrato` | quitar el `if (brief.backlog.length)` |
| **Un `\|` en una keyword no agrega una columna** (§7.1) | `contrato` | quitar el escapado al interpolar la celda |
| **Un `\n##` en un `h1` no inventa un encabezado** | `contrato` | quitar el colapso de saltos de línea |
| **`emisionM2` ⊆ `consumoM1`**: todo lo que M2 emite, M1 lo acepta | `contrato` | agregar a `consumoM1` un campo requerido que `emisionM2` no emita |
| **Cada derivado rechaza lo que debe** | `contrato` | fixtures **negativos**: a `emisionM2` un brief sin `meta_run`; a `consumoM1` un `schema_version` fuera de las cuatro |
| **El seed y el mock del portal dicen lo mismo en `calidad_datos`** | `db` | cambiarlo en un lado solo — **hace falta un test nuevo**: `cartera-portal.test.ts` compara nueve campos de página y **no** mira `calidad_datos` |
| Run sin informe → `200` con `null`, no `404` | `api` | devolver 404 cuando no hay fila |
| **Un run que existe pero no es visible se ve igual que uno sin informe** | `api` | devolver 403 en vez de `200` con `null` |
| El `filename` no puede inyectar un header | `api` | quitar el saneado → el test con `\r\n` parte la respuesta |
| **El `filename` cae al fallback cuando el nombre queda vacío** | `api` | devolver el string vacío en vez de `informe.md` |
| El parser **escapa** `<script>` y `<img onerror>` | `portal` | pintar la marca desconocida como HTML en vez de texto |
| Ninguna plantilla usa `innerHTML` / `bypassSecurityTrustHtml` | `portal` | agregar uno y ver caer el test |
| El link al informe existe en la pantalla del brief | `portal` | borrar el `routerLink` |
| **El 7º workspace está en el verde** (§11) | `scripts` | quitar el script `test` de `contrato/package.json` → `--if-present` lo saltaría en silencio |

> ### Cuatro mutaciones de la primera versión NO caían, y por qué importa
>
> Las corrigió la 14ª review, y son cuatro modos de fallo distintos del método:
>
> 1. **`grant select on kr_informes to app_render`** no destapaba nada: la política dice
>    `to app_user, app_service`, así que para `app_render` **no hay política aplicable** y RLS devuelve
>    cero filas de todas formas. Medido por Codex: `render_after_grant_rows=0`. La mutación real son los
>    **dos** cambios juntos. Lección: con RLS, quitar un `grant` y quitar una política producen el mismo
>    síntoma observable, y por eso una sola de las dos mutaciones no distingue qué garantía se está
>    probando.
> 2. **"Relajar un campo del esquema"** no hace fallar un fixture **positivo**: lo que ya era válido
>    sigue siéndolo. Un validador se prueba con fixtures **negativos** — de ahí las dos filas nuevas.
> 3. **`cartera-portal.test.ts` no ata `calidad_datos`.** Compara nueve campos de página
>    ([`:76-81`](../../../db/src/cartera-portal.test.ts#L76)) y `grep calidad_datos` sobre el archivo no
>    devuelve nada. La spec afirmaba que ese test ya lo cazaba: **hace falta escribirlo**.
> 4. **"Cambiar la allowlist por una denylist"** no es una mutación exacta: una denylist completa puede
>    seguir rechazando el único caso hostil del test. La mutación es **quitar el saneado**.

> ⚠️ **Ninguno de los tests de política puede usar la conexión del seed.** `sembrarDemo` recibe una
> `ConexionReservada` y **no pone contexto de tenant ni de rol**: el CLI conecta con
> `DATABASE_URL_ADMIN` (el `postgres.<project-ref>` de Supabase) y en PGlite el usuario es superuser, así
> que **RLS no lo alcanza** — ni siquiera con `force row level security`, que somete al _owner_, no al
> superuser. Un test de la política escrito con esa conexión **pasa siempre y no prueba nada**. Los tests
> de la tabla van con `app_user` y contexto puesto, como el resto de la batería de RLS.
>
> Esto también responde por qué la política no rompe el seed: el seed la esquiva por construcción. Es una
> excepción que ya existe para las otras nueve tablas, no algo que la `0016` introduzca.
>
> **Y el test de los `grant` tampoco:** un `insert` como superuser pasa aunque no haya ni un privilegio
> concedido. Ese test **tiene que** conectar con el login real (`amg_api` / `amg_orquestador`) o asumir el
> rol con `set role`.

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
| **El 7º workspace puede quedar FUERA del verde sin que nada falle** | `npm test` y `npm run typecheck` de la raíz usan `--workspaces --if-present`: si `contrato/package.json` no declara esos scripts, **se salta en silencio** y el arnés anuncia verde igual. Es el hallazgo real; lo de abajo era su síntoma cosmético |
| `scripts/verificar.sh` dice **"6 paquetes"** en dos mensajes (líneas 120 y 140) | Con el 7º queda mintiendo. Se **deriva** el número de los workspaces declarados en vez de escribirlo, así el 8º no vuelve a requerir acordarse |
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

**Criterio de cierre** (corregido tras la 14ª review — el anterior era inalcanzable, §4.1):

1. `npm run verificar` en verde, y el conteo de paquetes que imprime **derivado**, no escrito a mano.
2. `contrato/package.json` declara `test` y `typecheck`, con un test que lo **verifica** — si no, el
   `--if-present` lo saltaría en silencio y el paquete compartido quedaría fuera del verde.
3. Los tests de `kr-service` y `web-builder` pasan **sin editarse**, cada uno contra **su** derivado del
   esquema (`emisionM2` / `consumoM1`). Que un fixture de M1 no valide contra `emisionM2` **no es un
   fallo**: es el diseño (§4.1).
4. El test de inclusión `emisionM2 ⊆ consumoM1` en verde, y los fixtures negativos de los dos derivados.

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
