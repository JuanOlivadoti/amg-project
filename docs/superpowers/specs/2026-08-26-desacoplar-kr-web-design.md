# Desacoplar keyword research de creación de webs — diseño

**Sub-proyecto 2 de 3** de la iniciativa "generalizar AMG OS" (ver `progress/current.md`). Diseñado
en serie después del sub-proyecto 1 (multi-vertical de clientes, spec+plan completos, sin
implementar). No se implementa nada de esto hasta que los tres sub-proyectos tengan spec+plan y
pasen una revisión conjunta.

## Problema

Hoy, terminar un keyword research y publicar una web son la misma operación durable: una sola
función Inngest (`workflowResearch`, `orchestrator/src/workflow.ts:150-381`) hace el research,
espera hasta 7 días a que un humano apruebe (`paso.esperarEvento`, líneas 290-301), y si aprueba,
publica el sitio en el mismo `paso.run("publicar", ...)` (líneas 304-380). No existe la posibilidad
de terminar un research, quedarse con el informe, y decidir más tarde (o nunca) construir un sitio.

El propio informe ya es un producto vendible por separado — auditoría SEO, input para campañas
pagas, brief para el equipo de contenido del cliente, benchmarking recurrente, lead magnet
comercial — y hoy no hay forma de ofrecerlo sin arrastrar la publicación.

## Estado actual del código (verificado)

- **Arranque:** `POST /runs` → `solicitarResearch` (`api/src/solicitar.ts:52-126`) → fila en
  `kr_runs` bajo RLS → evento `research/solicitado` → `marcarSolicitudEmitida` (ADR-18: fila, evento,
  marca).
- **Un solo workflow hace todo:** `crearFuncionResearch` (`orchestrator/src/functions.ts:59-96`)
  dispara `workflowResearch`, que:
  1. Corre el research, guarda páginas e informe, cierra el run en `pending_approval`
     (`workflow.ts:192-282`).
  2. **Duerme** hasta 7 días esperando `research/aprobado` (`workflow.ts:290-301`); si vence, termina
     en `"sin_respuesta"` sin publicar.
  3. Si llega la aprobación, en la misma ejecución: relee páginas, arma el brief
     (`briefDesdeLaBase`), lo valida contra el contrato M1 y llama a `deps.publicar(...)`
     (`workflow.ts:341-346`).
- **El estado `pending_approval` ya separa research de decisión** en la base (`kr_runs.status`,
  enum `run_status` en `db/migrations/0001_init.sql:114`) — el comentario del propio código dice
  *"un run en `pending_approval` (o posterior) siempre tiene informe"* (`workflow.ts:216-223`).
- **El portal ya trata "ver el informe" y "aprobar y publicar" como dos cosas separadas**: dos
  feature flags distintos (`mostrarLanzarResearch`, `mostrarAprobarRun`,
  `portal/src/app/core/features.ts:18-20,36-38`), y en `brief.ts:58-63` un comentario explícito:
  *"el que decide qué se cuenta es el destino, no el link"* — el link al informe ya no depende de si
  se publicó algo.
- **`GET /runs/:id/informe`** (`api/src/app.ts:234`) y **`GET /runs/:id/entregable.md`**
  (`api/src/app.ts:301`) ya funcionan sin que la web esté publicada — solo requieren que el run tenga
  informe / al menos una página aprobada.
- **El contrato del brief** (`contrato/src/tipos.ts:115-152`) no tiene ningún campo de "destino" —
  asume implícitamente que el research siempre termina en una web (de ahí la nomenclatura M1/M2 y los
  dos validadores `emisionM2`/`consumoM1`).
- **El costo ya se registra en el paso del research**, no en el de publicación: `finishRun`
  (`workflow.ts:260-271`) escribe `coste_micros_usd` al cerrar el research, antes de siquiera
  preguntar si se aprueba. `kr-service` no depende en absoluto de que después haya publicación — el
  acoplamiento vive enteramente en `orchestrator/src/workflow.ts`.
- **Ya existe un barrido programado para runs colgados**: rol `app_barrido`,
  `db/migrations/0018_barrido_runs_colgados.sql`, método `store.expirarRunsColgados(plazo)`
  (`db/src/store.ts:989`). Apunta hoy a runs atascados en `running`, no a `pending_approval` sin
  decisión — sus policies (`run_barrido_ve`/`run_barrido_expira`, `0018:123-141`) ni siquiera dejan
  ver ese estado. No se toca ni se extiende (ver "Arquitectura": el timeout que motivaría extenderlo
  deja de tener sentido con el desacople).

## La decisión

| # | Decisión | Alternativa descartada |
|---|---|---|
| 1 | El destino (`crear_web` / `solo_informe` / `crear_posts`) se elige **al aprobar el run**, no al lanzar el research | Elegirlo al lanzar — más simple, pero el valor del informe standalone es que a veces no se sabe qué hacer con él hasta verlo |
| 2 | `crear_posts` es un **destino reconocido en el modelo de datos pero rechazado por la API** hasta que exista el sub-proyecto 3 (publicar en blog externo) | Implementar el pipeline de posts acá — duplicaría diseño con el sub-proyecto 3, que todavía no tiene spec |
| 3 | Un run cerrado en `solo_informe` es **retomable**: puede recibir una segunda decisión (`crear_web`) más adelante, reusando el research ya pagado, sin volver a consultar DataForSEO | Destino definitivo de una sola vez — más simple pero le cuesta plata al cliente si cambia de idea después de ver el informe |
| 4 | El historial de decisiones vive en una **tabla nueva** (`kr_run_decisiones`), no en una columna de `kr_runs` sobrescrita cada vez | Una columna `destino` en `kr_runs` — pierde el historial cuando el run es retomado, y no hay dónde registrar un intento fallido de `crear_posts` sin inventar un estado ad hoc |
| 5 | **No hay timeout automático nuevo.** El de 7 días existía porque una ejecución de Inngest dormida ocupa un recurso que hay que liberar; al desacoplar, `pending_approval` es solo una fila quieta en Postgres, sin nada que liberar — dejarla indefinidamente no cuesta nada. Una alerta de "run esperando hace mucho" es un feature de producto aparte, fuera de alcance | Extender el barrido existente para marcar algo a los 7 días — la ronda de Codex encontró que no hay ningún estado del enum `run_status` donde aterrizar esa marca, y la razón original del timeout (liberar una ejecución dormida) ya no aplica |
| 6 | `RunSinWorkflowError`/`RUN_SIN_WORKFLOW` **se retiran** — la columna `solicitud_emitida_at` queda como dato histórico (la API la sigue escribiendo tras emitir `research/solicitado`, sin cambios), pero deja de bloquear la aprobación. Bajo el diseño nuevo ninguna decisión "despierta" una ejecución dormida — un run sin esa marca (demo, importación) puede recibir una decisión igual que cualquier otro | Mantener el chequeo redefiniendo su semántica — más complejidad para preservar una garantía que ya no protege nada real |

## Arquitectura

**Partir `workflowResearch` en dos funciones Inngest independientes, ninguna espera a la otra:**

### 1. `crearFuncionResearch` (recortada)

Mismo `id: "research-workflow"`, mismo disparador (`research/solicitado`). Hace research, persiste
páginas e informe, cierra el run en `pending_approval` (pasos 1 de `workflow.ts:192-282`, sin
cambios). **Se elimina el `paso.esperarEvento` y todo lo que sigue** — la función termina ahí. El
"esperar aprobación" deja de ser un paso embebido: es, simplemente, que el run queda en
`pending_approval` en la base, tal como el portal ya lo trata hoy.

### 2. `crearFuncionDecision` (nueva)

**El evento no porta autoridad — ni siquiera el destino.** `orchestrator/src/events.ts:1-27` documenta
el principio con nombre y ejemplo real (`tenantId` es "coordenada, no autoridad"; sobre
`research/aprobado` dice textualmente: *"solo DESPIERTA... si el evento fuera la autoridad, cualquiera
capaz de emitirlo publicaría contenido que ningún humano miró"*). Mi primer borrador de este spec
violaba eso — el evento llevaba `destino` y la función bifurcaba directamente por el payload. Codex lo
marcó Critical. El evento señala **qué decisión revisar**, nunca **qué hacer**:

```ts
// orchestrator/src/events.ts — ResearchAprobado extendido
export interface ResearchAprobado {
  data: {
    /** Coordenada para localizar la decisión bajo RLS. NO es autoridad — igual que tenantId en
     *  ResearchSolicitado (events.ts:19-21). */
    tenantId: string;
    /** El evento solo señala QUÉ decisión revisar. El destino real se lee de la fila. */
    decisionId: string;
    /** Solo trazabilidad, igual que en el ResearchAprobado actual. */
    aprobadoPor?: string;
  };
}
```

Reusa el mismo `Deps` (`workflow.ts:39-72`) que ya usa `crearFuncionResearch` — no necesita `research`
pero sí `store`, `publicar`, `validarContrato`.

```ts
// orchestrator/src/functions.ts — nueva función, mismo estilo que crearFuncionResearch
export function crearFuncionDecision(deps: Deps) {
  return inngest.createFunction(
    {
      id: "research-decision-workflow",
      concurrency: [...CONCURRENCIA],   // sigue siendo por tenantId — el evento lo sigue trayendo
      retries: 1,
      // Comodidad, NO la garantía (mismo principio que crearFuncionResearch, functions.ts:65-70):
      // un replay después de 24h todavía tiene que encontrar la decisión ya cerrada y no repetirla.
      // Eso lo impone el guard de kr_run_decisiones.resultado, no esta key.
      idempotency: "event.data.decisionId",
      onFailure: async ({ event, error }) => {
        const d = event.data.event.data as Eventos["research/aprobado"]["data"];
        const ctx: TenantContext = { tenantId: d.tenantId };
        await deps.store.cerrarDecision(ctx, d.decisionId, "error", error.message);
      },
    },
    { event: "research/aprobado" },
    async ({ event, step }) => {
      const d = event.data as Eventos["research/aprobado"]["data"];
      const ctx: TenantContext = { tenantId: d.tenantId };
      return workflowDecision(adaptarPasos(step as StepTools), ctx, d.decisionId, deps);
    },
  );
}
```

`workflowDecision` — la autoridad se relee siempre de la base, nunca del evento:

1. **Carga la decisión** (`deps.store.getDecision(ctx, decisionId)`) bajo RLS. Si no existe o el
   `ctx` no la ve, aborta — el evento no puede inventar una decisión que la API no autorizó.
2. **Guard de reproceso** (Major #7 de la ronda de Codex — la idempotencia de Inngest es una
   comodidad de 24h, no una garantía): si `decision.resultado !== 'pendiente'`, la función retorna
   sin hacer nada más. Un replay o un evento duplicado después de la ventana de Inngest encuentra la
   fila ya cerrada y no repite el efecto.
3. **Bifurca por `decision.destino`** (el de la fila, nunca el que pudiera traer el evento):
   - **`crear_web`**: relee el **cliente** (`deps.store.getClient`) y aborta si `archived_at` no es
     null — un cliente archivado entre la aprobación y la ejecución no se publica (Major #10). Si
     sigue activo: relee páginas, `briefDesdeLaBase`, `validarContrato`, `deps.publicar(...)`.
   - **`solo_informe`**: no hace nada más — el informe ya existe desde el paso 1.
   - **`crear_posts`**: nunca debería llegar acá — la API lo rechaza antes de emitir el evento (ver
     "API"). Si llegara igual, la función no publica nada y cierra la decisión en `error` con mensaje
     explícito.
4. **Cierra la decisión** con `deps.store.cerrarDecision(ctx, decisionId, resultado, detalleError?)`
   — un `update ... where id = $1 and resultado = 'pendiente'` (mismo guard defensivo que
   `approveRun`, que devuelve 0 filas en vez de lanzar cuando ya no aplica). Si dos ejecuciones
   llegaran a correr en paralelo (no debería, ver "Modelo de datos"), solo una cierra la fila; la
   otra ve que ya no está `pendiente` y no pisa el resultado.

**Por qué esto habilita "retomable" sin máquina de estados nueva:** al no ser una ejecución dormida
sino disparada por evento, un run que ya cerró una decisión `solo_informe` puede recibir *otra*
decisión (`crear_web`) más tarde con una nueva invocación del mismo evento — misma función, mismo
patrón, no hace falta un tercer tipo de workflow.

### No hay timeout automático nuevo

El de 7 días (`paso.esperarEvento(..., timeout: "7d")`, hoy) existe por una razón operativa: una
ejecución de Inngest dormida ocupa un recurso, y hay que liberarlo si nadie responde. Al desacoplar,
`pending_approval` deja de ser "una ejecución esperando" y pasa a ser, sin más, una fila quieta en
Postgres — no hay nada que liberar, y dejarla indefinidamente no cuesta nada (es justo lo que hace
posible el retomable). La ronda de Codex encontró además que no hay ningún valor del enum
`run_status` (`db/migrations/0001_init.sql:114`) donde aterrizar un `sin_respuesta` persistido — hoy
es solo un resultado en memoria del workflow viejo, nunca se escribió en la base.

**Conclusión: no se extiende el barrido existente para esto.** Si más adelante se quiere una alerta
de "run esperando hace mucho" para nudgear al staff, es un feature de producto aparte (reporting,
no una transición de estado) — fuera de alcance de este sub-proyecto.

## Modelo de datos

Las tablas de este proyecto **no llevan prefijo de schema** (`tenants`, `kr_runs`, `clients` viven
sin calificar — solo las funciones helper como `app.current_tenant_id()` están en el schema `app`,
ver `db/migrations/0001_init.sql:54,64,116`). Tampoco existe una tabla `users`: `memberships.user_id`
es un `uuid` suelto sin FK (`0001_init.sql:69`), porque la identidad vive fuera de este esquema. El
modelo de abajo sigue esas dos convenciones, y agrega `client_id` denormalizado con la misma razón
que ya tiene `kr_keywords.client_id` (`0001_init.sql:182-185`): la política RLS no se hereda del
padre, y sin esa columna un rol `'cliente'` vería decisiones de negocios ajenos del mismo tenant.

```sql
create type destino_run as enum ('crear_web', 'solo_informe', 'crear_posts');

create table kr_run_decisiones (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  client_id      uuid not null,
  destino        destino_run not null,
  decidido_por   uuid,
  decidido_en    timestamptz not null default now(),
  resultado      text not null default 'pendiente'
    check (resultado in ('pendiente', 'completado', 'error')),
  detalle_error  text,
  completado_en  timestamptz,

  -- Coherencia entre resultado y sus timestamps/detalle — sin esto eran válidos un 'completado' sin
  -- completado_en, o un 'pendiente' con detalle_error (hallazgo Minor de la ronda de Codex).
  check (
    (resultado = 'pendiente'  and completado_en is null     and detalle_error is null)
    or (resultado = 'completado' and completado_en is not null and detalle_error is null)
    or (resultado = 'error'      and completado_en is not null and detalle_error is not null)
  ),

  -- FK compuesta con el mismo motivo que kr_runs (0001_init.sql:147-161): sin el tenant Y el client
  -- en la referencia, una fila podría declararse del tenant propio pero apuntar al run de otro.
  foreign key (run_id, tenant_id, client_id)
    references kr_runs (id, tenant_id, client_id) on delete cascade
);

create index on kr_run_decisiones (run_id, decidido_en desc);

-- LA defensa real contra la carrera de doble aprobación (Critical de la ronda de Codex: un
-- `insert...select...where` sin esto no serializa nada bajo READ COMMITTED — dos transacciones
-- concurrentes ven la misma foto y ninguna ve el insert sin commit de la otra). Un índice único
-- parcial SÍ lo cierra: Postgres serializa las inserciones que compiten por la misma entrada del
-- índice, gane quien gane la carrera la otra espera y después falla por violación de unicidad — es
-- una garantía del motor, no de la aplicación. "Como mucho una decisión pendiente por run" también
-- es, de paso, el invariante de negocio real (no tiene sentido tener dos decisiones abiertas a la vez).
create unique index kr_run_decisiones_una_pendiente
  on kr_run_decisiones (run_id)
  where resultado = 'pendiente';

alter table kr_run_decisiones enable row level security;
alter table kr_run_decisiones force row level security;

-- Mismo patrón que run_select/run_write (0001_init.sql:441-447), client_id incluido.
create policy decision_select on kr_run_decisiones
  for select using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy decision_write on kr_run_decisiones
  for all
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (
    tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id)
  );

-- Tabla nueva: los grants de tabla de app_user/app_service sobre kr_runs (0001:413, 0002:93)
-- NO cubren esta tabla automáticamente. Grant explícito, mismo alcance que kr_runs.
grant select, insert, update on kr_run_decisiones to app_user;
grant select, insert, update on kr_run_decisiones to app_service;
-- app_render: sin grant, igual que sobre kr_runs (0007_render_publico.sql:35-36).
-- app_barrido: SIN GRANT tampoco — ya no hay barrido de expiración que tocar (ver "Arquitectura").
```

**Registrar una decisión y (cuando corresponde) promover el run a `approved` pasan por la MISMA
sentencia** — Major #6 de la ronda de Codex encontró que mi primer borrador nunca especificaba esa
relación, y `getPublishablePages` (`db/src/store.ts:1638`) exige `r.status = 'approved'` para
publicar. El nuevo método de `PgStore`, `registrarDecision(ctx, runId, destino, decididoPor?)`:

```sql
with decision as (
  insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, decidido_por)
  select r.id, r.tenant_id, r.client_id, $2, $3
  from kr_runs r
  where r.id = $1
    and (
      -- Primera decisión: el run recién salió del research.
      r.status = 'pending_approval'
      -- Retomable: la ÚLTIMA decisión completada de este run fue 'solo_informe' y la nueva es
      -- distinta — el único camino retomable que confirmó el usuario (decisión #3 de este spec).
      or (
        r.status = 'approved'
        and $2 <> 'solo_informe'
        and (
          select d.destino from kr_run_decisiones d
          where d.run_id = r.id and d.resultado = 'completado'
          order by d.decidido_en desc limit 1
        ) = 'solo_informe'
      )
    )
  returning id, run_id
)
update kr_runs
set status = 'approved'
from decision
where kr_runs.id = decision.run_id and kr_runs.status = 'pending_approval'
returning (select id from decision) as decision_id;
```

Si la fila no calificaba, el `with` no inserta nada y la sentencia entera devuelve cero filas — el
método traduce eso a `null`, mismo estilo defensivo que ya usa `approveRun` (devuelve `boolean` en
vez de lanzar). El índice único parcial de arriba es quien impide que dos ejecuciones concurrentes de
esta sentencia ambas encuentren la condición cierta y ambas inserten.

`kr_runs.status` no gana valores nuevos: `'approved'` pasa a significar *"se tomó al menos una
decisión"*, no *"se publicó una web"* — el destino real y su resultado se leen de
`kr_run_decisiones`. Esto es un cambio de significado, no de forma; el plan tiene que inventariar
quién lee `status === 'approved'` asumiendo publicación (ver "Riesgos").

**Cerrar una decisión** (`cerrarDecision(ctx, decisionId, resultado, detalleError?)`, llamado por
`workflowDecision` al terminar) es un `update kr_run_decisiones set resultado = $2, detalle_error =
$3, completado_en = now() where id = $1 and resultado = 'pendiente' returning id` — el guard
`and resultado = 'pendiente'` es lo que hace el cierre idempotente ante un replay de Inngest después
de la ventana de 24h (Major #7): la segunda ejecución no encuentra fila `pendiente` y no pisa el
resultado de la primera.

## API

`POST /runs/:id/approve` (`api/src/app.ts:365-378`) cambia de body y de regla:

```ts
// Body nuevo, requerido:
{ destino: "crear_web" | "solo_informe" }
// "crear_posts" existe en el enum de datos pero la API lo rechaza con 501 antes de tocar la base:
// { error: "Destino 'crear_posts' todavía no está implementado." }
```

- `200 { ok: true, decisionId }` si `registrarDecision` califica y el evento se emite.
- `409 { error, codigo: "TRANSICION_INVALIDA" }` si `registrarDecision` devuelve `null` (no
  calificaba la transición) — nuevo código en `api/src/codigos.ts`, mismo estilo que el que retira
  este spec (ver debajo).
- `501` si `destino === "crear_posts"`.
- Se mantienen los códigos existentes (`403` RLS, `400` violaciones de constraint) sin cambios.

**Se retira el chequeo de `solicitud_emitida_at`** (decisión #6 de este spec): `registrarDecision` no
verifica esa columna, `RunSinWorkflowError` y el código `409 RUN_SIN_WORKFLOW` desaparecen del
handler. La columna en sí **no se borra** — la API la sigue escribiendo tras emitir
`research/solicitado` (sin cambios en `solicitar.ts`), queda como dato histórico de auditoría, pero
deja de condicionar si un run puede recibir una decisión. Esto es un cambio coordinado con el portal
(ver "Portal").

Mismo patrón fila-evento-marca que `solicitar.ts` (ADR-18), con la corrección Critical de la ronda de
Codex — **el evento no lleva `destino`, solo la coordenada para releerlo**: `registrarDecision` bajo
RLS primero (el `insert` sucede o no, ver "Modelo de datos"); si calificó, se emite `research/aprobado`
con `{ tenantId, decisionId }` — nunca el destino. Si el `send` falla, se cierra la decisión en
`error` (mismo manejo que `failRun` en `solicitar.ts:83-95`).

**Read model nuevo** (Major #9 de la ronda de Codex: `GET /runs/:id` solo devolvía `{run, pages}`, sin
forma de que el portal supiera si un run terminó en `solo_informe` para ofrecer "construir la web
ahora"). `GET /runs/:id` gana un campo `ultimaDecision: { destino, resultado, decididoEn } | null` —
la última fila de `kr_run_decisiones` para ese run, o `null` si todavía no hay ninguna. Nuevo método
de lectura en `PgStore`, `getUltimaDecision(ctx, runId)`, bajo la misma RLS que el resto.

## Portal

- `brief.ts:147-160` — el botón único "Aprobar el run y publicar" se convierte en un selector de
  destino con dos opciones habilitadas (`crear_web`, `solo_informe`) y una tercera
  (`crear_posts`) visible pero deshabilitada detrás de un feature flag nuevo
  (`mostrarDestinoPosts`, mismo patrón que `mostrarAprobarRun` en `features.ts`), con copy "Próximamente".
- **Se retira el gate `tiene_workflow`** (`brief.ts:304-333`, hoy deshabilita "aprobar" si
  `solicitud_emitida_at` es null) — coordinado con la API (decisión #6): si el backend ya no exige esa
  marca, el portal tampoco puede seguir bloqueando el botón por ella.
- Cuando `GET /runs/:id` devuelve `ultimaDecision.destino === 'solo_informe'` y `resultado ===
  'completado'`, `brief.ts` muestra la opción "Construir la web ahora" (la ruta retomable) en vez de
  ocultar el botón por completo.
- `informe.ts` y `entregable.ts` no cambian — ya funcionan independientemente de la publicación.

## Fuera de alcance

- Implementación real de `crear_posts` (generación y publicación en un blog externo) — sub-proyecto 3.
- Cambios al contrato `contrato/` (`KeywordResearchBrief`, `emisionM2`/`consumoM1`) — el destino es
  metadata de orquestación, no del brief.
- Retomar un run hacia `crear_posts` (la ruta retomable definida acá es únicamente
  `solo_informe → crear_web`; ampliarla a posts es parte del sub-proyecto 3).
- Una alerta de "run esperando hace mucho" (feature de producto/reporting — no es lo mismo que el
  timeout operativo que este spec elimina, ver "Arquitectura") — se puede agregar después si hace
  falta, no es parte de este sub-proyecto.
- Multi-vertical de clientes (sub-proyecto 1) — ortogonal; `destino` es por run, `vertical` es por
  cliente.

## Riesgos

- **Inventario de `status === 'approved'`**: cualquier código que hoy asuma que `approved` implica
  "publicado" (portal, `api/src/app.ts`, `entregable.md`) necesita revisión — el plan tiene que
  listar cada sitio, mismo tipo de barrido que hizo el sub-proyecto 1 con `insert into clients`.
- **Grants de la tabla nueva**: `kr_run_decisiones` no hereda nada de los grants de `kr_runs` — si el
  plan olvida el `grant` explícito, el error aparece recién contra Postgres real, no contra PGlite en
  modo superusuario (mismo hallazgo Critical que tuvo el sub-proyecto 1).
- **`crear_posts` silencioso**: si el rechazo en la API se olvida y el evento llega igual al
  orchestrator, `workflowDecision` tiene que fallar con mensaje explícito — nunca cerrar la decisión
  como `completado` sin haber hecho nada.
- **Coordinación API↔portal al retirar `tiene_workflow`** (decisión #6): si uno de los dos lados se
  actualiza y el otro no, queda un estado inconsistente (el backend acepta una aprobación que el
  portal sigue bloqueando, o viceversa). El plan tiene que tratarlos como una sola task, no dos.

## Verificación

- Tests de `kr_run_decisiones`: transición válida (`pending_approval` → cualquier destino),
  transición retomable (`approved`+`solo_informe` → `crear_web`), y las combinaciones que deben
  fallar (repetir destino, retomar después de `crear_web`, run `rejected`).
- **Test de concurrencia real** (no solo dos llamadas secuenciales): dos conexiones distintas con una
  barrera que garantice solapamiento, ambas intentando `registrarDecision` sobre el mismo run al
  mismo tiempo — exactamente una debe calificar, la otra debe recibir `null`/409, ejercitando el
  índice único parcial `kr_run_decisiones_una_pendiente`, no solo la lógica del `where`.
- Test de grants bajo `app_user`/`app_service` reales (no PGlite superusuario) para
  `kr_run_decisiones`.
- **Dos contratos separados para `crear_posts`** (no uno solo, que sería una afirmación que ningún
  test individual puede sostener): (a) la API rechaza la request con 501 sin insertar fila ni emitir
  evento; (b) si `crearFuncionDecision` recibe igual una decisión persistida con
  `destino = 'crear_posts'` (evento emitido a mano, bug), cierra la decisión en `error`, nunca en
  `completado`.
- **Guard de reproceso**: llamar `workflowDecision` dos veces sobre la misma decisión ya `completada`
  — la segunda debe ser un no-op (no publicar dos veces), verificando `cerrarDecision`'s
  `where resultado = 'pendiente'`.
- **Cliente archivado a mitad de camino**: decisión `crear_web` registrada, cliente archivado antes de
  que `crearFuncionDecision` corra — el worker no debe publicar; la decisión cierra en `error`.
- `npm run verificar` en verde + manejar el flujo completo en el portal (lanzar research → ver
  informe sin aprobar → aprobar con `solo_informe` → retomar con `crear_web`) antes de cerrar.

## Historial de revisión

**Ronda 1 (Codex, sobre este spec), 2026-08-26** — veredicto NECESITA REDISEÑO, 12 hallazgos
(3 Critical, 7 Major, 2 Minor). Reporte completo en
[`progress/informes/codex-desacoplar-kr-spec.md`](../../../progress/informes/codex-desacoplar-kr-spec.md).
Los 12 fueron verificados empíricamente contra el código real (no aceptados por juicio, ninguno
refutado) y aplicados:

1. [Critical] El evento perdía el contexto de tenant → `ResearchAprobado` gana `tenantId` como
   coordenada (sección "Arquitectura").
2. [Critical] `destino` viajaba como autoridad en el evento, violando el principio documentado en
   `events.ts:1-27` → el evento solo lleva `decisionId`; `workflowDecision` relee el destino de
   `kr_run_decisiones` bajo RLS (sección "Arquitectura").
3. [Critical] `insert...select...where` no serializa la carrera de doble decisión → índice único
   parcial `kr_run_decisiones_una_pendiente` (sección "Modelo de datos").
4. [Major] El timeout de 7 días proponía un estado (`sin_respuesta`) que no existe en el enum → se
   retira la idea de extender el barrido; la razón operativa del timeout (liberar una ejecución
   dormida) desaparece con el desacople (sección "Arquitectura", decisión #5 actualizada).
5. [Major] `app_barrido` no podía ver `pending_approval` ni con el grant propuesto → resuelto al
   eliminar el barrido de expiración del alcance (hallazgo 4 lo vuelve innecesario).
6. [Major] Sin definir cuándo `kr_runs.status` pasa a `approved` en relación a la decisión → CTE
   único que inserta la decisión y promueve el status en la misma sentencia (sección "Modelo de
   datos").
7. [Major] La idempotencia de Inngest (24h) no es la garantía durable → guard
   `resultado = 'pendiente'` en `cerrarDecision`, más el chequeo de reproceso al inicio de
   `workflowDecision` (sección "Arquitectura").
8. [Major] `solicitud_emitida_at`/`RUN_SIN_WORKFLOW` quedaban describiendo una ejecución dormida que
   ya no existe → decisión #6 (nueva): se retira el chequeo, coordinado entre API y portal.
9. [Major] El portal no tenía forma de leer la última decisión → `GET /runs/:id` gana
   `ultimaDecision` (sección "API").
10. [Major] Un cliente archivado seguía siendo publicable → `workflowDecision` relee `getClient` y
    aborta si `archived_at` no es null (sección "Arquitectura").
11. [Minor] La verificación de `crear_posts` afirmaba algo que un solo test no puede demostrar →
    separado en dos contratos (sección "Verificación").
12. [Minor] La tabla permitía combinaciones incoherentes de `resultado`/timestamps → `check` de
    coherencia agregado (sección "Modelo de datos").

Una decisión de producto quedó pendiente de confirmación explícita del usuario (hallazgo 8): retirar
`RUN_SIN_WORKFLOW` en vez de redefinirlo. Confirmado — ver decisión #6.
