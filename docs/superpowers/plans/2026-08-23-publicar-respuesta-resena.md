# Publicar la respuesta de vuelta a Google (Bloque F, fase 2, segunda pieza) — Plan

> **Para quien ejecute esto:** tres tareas, una por agente de área (`datos`, `pipeline`, `front`),
> en ESE orden porque cada una consume el contrato que fija la anterior. Después de las tres,
> `revisor` sobre el diff completo. La sesión principal integra, corre `npm run verificar`, actualiza
> la documentación del ritual y commitea — ningún agente hace esas tres cosas.

**Goal:** el staff puede pedir, desde el portal, que el borrador de respuesta (ya escrito/editado)
se publique de vuelta en la reseña de Google. Mock-first, mismo patrón que toda la fase 1: el
`GoogleReviewsProvider` mock "publica" siempre con éxito sin salir a internet; `live` sigue sin
implementación hasta que AMG pida acceso real a la Business Profile API — este plan NO lo desbloquea,
deja lista la costura para cuando llegue.

**Arquitectura:** comando compuesto (ADR-18): la API marca `respuesta_solicitada_en` bajo RLS
(`app_user`) y SOLO SI la fila cambió emite un evento (`resenas/respuesta.solicitada`) que no porta
autoridad — lleva únicamente el `id` de la reseña. El orquestador, al recibirlo, vuelve a
preguntarle a la base qué publicar (`app.resena_para_publicar`, cross-tenant vía `app_resenas`,
mismo rol que ya lee el refresh token), llama al provider, y si tuvo éxito confirma
(`app.publicar_respuesta_resena`). Cero reintento automático: si falla, la fila queda "solicitada,
no publicada" y el staff reintenta con el mismo botón — mismo criterio que ya rige la generación del
borrador de IA (sin retry automático en llamadas externas).

**Tech Stack:** el ya establecido del monorepo — Postgres/RLS (`db`), Hono (`api`), Inngest
(`orchestrator`), Angular standalone + signals (`portal`).

## Global Constraints

- Español para nombres de dominio, comentarios explican el POR QUÉ.
- `node:test` + `node:assert`, rojo→verde→mutación en cada pieza de lógica nueva.
- RLS: cualquier UPDATE nuevo se apoya en una política YA EXISTENTE cuando cubre el caso (ver Task 1
  — no crear una política nueva si una ya cubre el UPDATE por rol).
- Un evento nunca porta autoridad (ADR-18): el payload es el mínimo necesario para RELOCALIZAR la
  fila, nunca los datos a escribir.
- Sin reintento automático contra APIs externas (`retries: 0` en la función de Inngest, mismo
  criterio que `crearFuncionPollingResenas`).
- No tocar nada de `GOOGLE_REVIEWS_MODO=live` (sigue lanzando, sin implementación — fuera de alcance).

---

### Task 1 (agente `datos`): migración 0025 + capa de acceso + endpoint

**Files:**
- Create: `db/migrations/0025_publicar_respuesta_resena.sql`
- Modify: `db/src/resenas.ts` (interfaz `ResenaGoogle`, `COLS`, `aResena`, nuevo método
  `solicitarPublicacion`)
- Modify: `db/src/store.ts` (nuevo tipo `ResenaParaPublicar`, nuevos métodos `resenaParaPublicar` y
  `marcarRespuestaPublicada` en `PgStore`)
- Modify: `api/src/app.ts` (tercera forma del `PATCH /clients/:id/resenas/:resenaId`)
- Test: `db/src/resenas.test.ts`, `db/src/store.test.ts` (o el archivo donde ya vivan los tests de
  `guardarBorradorResena`/`clientesConectadosGoogle` — mirarlo antes de crear uno nuevo),
  `api/src/app.test.ts`

**Interfaces:**
- Consume: nada de tareas anteriores (es la primera).
- Produce, para la Task 2 (`pipeline`):
  - `PgStore.resenaParaPublicar(resenaId: string): Promise<ResenaParaPublicar | null>`
  - `PgStore.marcarRespuestaPublicada(r: { clientId: string; tenantId: string; googleReviewId: string }): Promise<boolean>`
  - `export interface ResenaParaPublicar { clientId: string; tenantId: string; googleReviewId: string; borrador: string; locationId: string; refreshToken: string; }`
  - El endpoint emite el evento `"resenas/respuesta.solicitada"` con `{ resenaId, solicitadoPor? }` —
    la Task 2 registra ese nombre y esa forma en `orchestrator/src/events.ts`.
- Produce, para la Task 3 (`front`):
  - `GET /clients/:id/resenas` ahora devuelve también `respuesta_solicitada_en`/`respuesta_publicada_en`
    en cada fila (mismo objeto JSON que ya arma `aResena`, con las dos claves nuevas).
  - `PATCH /clients/:id/resenas/:resenaId` con body `{"publicar": true}` — 200 `{ok:true}` si
    aceptó la solicitud, 404 si la reseña no existe, no tiene borrador, ya está publicada, o el rol
    no puede escribir (mismo criterio de 404 que ya usan `vista`/`borrador_respuesta`).

**Paso a paso:**

- [ ] **Step 1: Migración `0025_publicar_respuesta_resena.sql`**

  Mismo molde exacto que `0024_borrador_resenas_ia.sql` (leerla primero, es la plantilla). Contenido:

  ```sql
  -- =============================================================================
  -- AMG OS — 0025: publicar la respuesta de vuelta a Google (Bloque F, fase 2, segunda pieza)
  --
  -- Mock-first, mismo criterio que toda la fase 1: el staff pide publicar (bajo RLS, app_user), la
  -- API emite un evento (ADR-18: la fila manda, no el evento) y el orquestador -- que es quien tiene
  -- el refresh token vía `app_resenas` -- hace el trabajo real y confirma. `GOOGLE_REVIEWS_MODO`
  -- sigue siendo mock/live (orchestrator/src/google/provider.ts): el mock "publica" siempre con
  -- éxito; `live` sigue sin implementación hasta que exista acceso real a la Business Profile API.
  --
  -- Spec: docs/proyecto/15-plan-plataforma.md § Bloque F.
  -- =============================================================================

  alter table resenas_google
    add column if not exists respuesta_solicitada_en timestamptz,
    add column if not exists respuesta_publicada_en   timestamptz;

  comment on column resenas_google.respuesta_solicitada_en is
    'El staff pidio publicar el borrador de vuelta en Google. NULL = nadie lo pidio. Un click nuevo '
    'sobre una fila ya solicitada pero no publicada REINTENTA (pisa el timestamp y remite el evento) '
    '-- no hay cola de reintento automatico, el reintento es que el staff vuelva a apretar el boton.';
  comment on column resenas_google.respuesta_publicada_en is
    'Confirmado publicado en Google por el orquestador. NULL = no publicado (nunca pedido, pedido y '
    'todavia en curso, o el ultimo intento fallo).';

  -- app_user pide la publicacion. Aditivo sobre los grants de columna de 0021/0024 (los privilegios
  -- de columna del mismo rol/tabla se ACUMULAN, medido en la 0021 -- no hace falta revocar nada). La
  -- politica `resena_marcar_vista` (0021) ya exige `app.puede_escribir()` para CUALQUIER UPDATE de
  -- app_user sobre esta tabla -- RLS es por fila, no por columna -- asi que no hace falta una politica
  -- nueva, mismo razonamiento que ya documenta la 0024 para `borrador_respuesta`.
  grant update (respuesta_solicitada_en) on resenas_google to app_user;

  -- app_resenas confirma la publicacion. Aditivo sobre el grant de 0024. La politica
  -- `resena_actualizar_borrador_app_resenas` (0024, `using (true) with check (true)`) ya cubre
  -- CUALQUIER UPDATE de app_resenas sobre esta tabla -- mismo razonamiento, no hace falta otra.
  grant update (respuesta_publicada_en) on resenas_google to app_resenas;

  -- -----------------------------------------------------------------------------
  -- Confirma la publicacion. Mismo molde que `app.guardar_borrador_resena` (0024): las condiciones
  -- van en el WHERE, no en el llamador -- sin `respuesta_solicitada_en is not null` cualquiera con
  -- `execute` podria marcar publicada una fila que nadie pidio; sin `respuesta_publicada_en is null`,
  -- una confirmacion duplicada (dos corridas del mismo evento, o una carrera) no pisa nada dos veces.
  -- -----------------------------------------------------------------------------
  create or replace function app.publicar_respuesta_resena(
    p_client_id        uuid,
    p_tenant_id        uuid,
    p_google_review_id text
  ) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, public
  as $$
  declare
    v_id uuid;
  begin
    update resenas_google
      set respuesta_publicada_en = now()
      where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
        and respuesta_solicitada_en is not null
        and respuesta_publicada_en is null
      returning id into v_id;
    return v_id is not null;
  end;
  $$;

  comment on function app.publicar_respuesta_resena is
    'Confirma que el orquestador publico la respuesta en Google. No marca nada si nadie la pidio o '
    'si ya estaba publicada -- las dos condiciones van en el WHERE. security definer, propiedad de '
    'app_resenas.';

  -- -----------------------------------------------------------------------------
  -- Trae lo que el orquestador necesita para publicar UNA reseña, cruzando `resenas_google` con
  -- `clients` (el refresh token vive ahi). `app_resenas` ya tiene SELECT de
  -- `(id, tenant_id, google_location_id, google_refresh_token, archived_at)` sobre `clients` desde
  -- la 0022 -- no hace falta un grant nuevo. Cero filas si la solicitud ya no aplica (otra corrida
  -- ya publico, o el borrador se borro entretanto): el llamador no distingue el motivo, el evento
  -- que dispara esto no porta autoridad (ADR-18), esta funcion es la que decide.
  -- -----------------------------------------------------------------------------
  create or replace function app.resena_para_publicar(p_resena_id uuid)
  returns table (
    client_id          uuid,
    tenant_id          uuid,
    google_review_id   text,
    borrador_respuesta text,
    location_id        text,
    refresh_token      text
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
  as $$
    select r.client_id, r.tenant_id, r.google_review_id, r.borrador_respuesta,
           c.google_location_id, c.google_refresh_token
    from resenas_google r
    join clients c on c.id = r.client_id
    where r.id = p_resena_id
      and r.respuesta_solicitada_en is not null
      and r.respuesta_publicada_en is null
      and r.borrador_respuesta is not null;
  $$;

  comment on function app.resena_para_publicar is
    'Lo que el orquestador necesita para publicar una reseña puntual: el borrador y las credenciales '
    'del cliente. Cero filas si la solicitud ya no aplica (publicada, sin borrador, o no existe) -- '
    'el evento que dispara esto no porta autoridad, esta funcion decide (ADR-18).';

  -- El cambio de dueño, identico a 0022/0024: dos permisos temporales, revocados al final, en ese orden.
  grant app_resenas to current_user;
  grant create on schema app to app_resenas;

  alter function app.publicar_respuesta_resena(uuid, uuid, text) owner to app_resenas;
  alter function app.resena_para_publicar(uuid) owner to app_resenas;

  revoke execute on function app.publicar_respuesta_resena(uuid, uuid, text) from public;
  revoke execute on function app.resena_para_publicar(uuid) from public;
  grant execute on function app.publicar_respuesta_resena(uuid, uuid, text) to app_service;
  grant execute on function app.resena_para_publicar(uuid) to app_service;

  revoke create on schema app from app_resenas;
  revoke app_resenas from current_user;
  ```

- [ ] **Step 2: Correr las migraciones contra PGlite y confirmar que aplica sin error**

  El arnés de tests de `db/` levanta PGlite y aplica todas las migraciones en cada corrida — alcanza
  con `npm test -w db` para confirmar que la 0025 no rompe nada. Si hay un test de "orden de
  migraciones" o de "todas aplican limpio" (mirar `db/src/deploy.test.ts`), tiene que seguir en verde.

- [ ] **Step 3: `db/src/resenas.ts` — extender el tipo y `PgResenas`**

  En `ResenaGoogle`, agregar:
  ```typescript
  /** `null` = nadie pidió publicar todavía. */
  respuestaSolicitadaEn: string | null;
  /** `null` = no publicado (nunca pedido, en curso, o el último intento falló). */
  respuestaPublicadaEn: string | null;
  ```
  En `COLS`, agregar `, respuesta_solicitada_en, respuesta_publicada_en`. En `aResena()`, mapear los
  dos campos nuevos (mismo `snake_case` → `camelCase` que el resto). Nuevo método en `PgResenas`,
  inmediatamente después de `editarBorrador`:
  ```typescript
  /**
   * Pide publicar el borrador de vuelta en Google (Bloque F, fase 2, segunda pieza). `false` sin
   * lanzar si la reseña no existe, es de otro cliente, no tiene borrador, ya está publicada, o
   * `puede_escribir()` da falso (ADR-20) -- el WHERE decide, no este método. Un segundo llamado
   * sobre una fila ya solicitada pero no publicada REINTENTA (pisa el timestamp de nuevo).
   */
  async solicitarPublicacion(ctx: TenantContext, clientId: string, resenaId: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update resenas_google set respuesta_solicitada_en = now()
         where id = $1 and client_id = $2
           and borrador_respuesta is not null
           and respuesta_publicada_en is null
         returning id`,
        [resenaId, clientId],
      );
      return rows.length > 0;
    });
  }
  ```

- [ ] **Step 4: Tests de `resenas.test.ts` para `solicitarPublicacion`**

  Mirar los tests existentes de `editarBorrador`/`marcarVista` en el mismo archivo y seguir su mismo
  molde exacto (mismo fixture/seed, mismo estilo de aserciones). Casos mínimos, cada uno con su
  propio `test(...)`:
  - Con un borrador ya guardado y sin publicar: `solicitarPublicacion` devuelve `true`, y
    `listarResenas` después muestra `respuestaSolicitadaEn` no nulo.
  - Sin borrador (`borrador_respuesta` NULL): devuelve `false`, no toca la fila.
  - Ya publicada (`respuesta_publicada_en` no nulo, sembrado a mano en el test): devuelve `false`.
  - Otro cliente/tenant (aislamiento, mismo patrón que el resto del archivo): devuelve `false`.
  - Rol `cliente` (ADR-20, `puede_escribir()` falso): devuelve `false` — mirar cómo ya lo prueba
    `editarBorrador` o `marcarVista` para el mismo rol y replicar el fixture.

  Verificar por mutación AL MENOS un caso: por ejemplo, sacar `and borrador_respuesta is not null`
  del WHERE del método y confirmar que el test "sin borrador" (que debía dar `false`) ahora da `true`
  y cae. Volver a poner la condición antes de seguir.

- [ ] **Step 5: `db/src/store.ts` — `PgStore.resenaParaPublicar` y `marcarRespuestaPublicada`**

  Cerca de `guardarBorradorResena`/`clientesConectadosGoogle` (mismo archivo). Exportar el tipo:
  ```typescript
  export interface ResenaParaPublicar {
    clientId: string;
    tenantId: string;
    googleReviewId: string;
    borrador: string;
    locationId: string;
    refreshToken: string;
  }
  ```
  Métodos, mismo molde `sinTenant` que `clientesConectadosGoogle`/`guardarBorradorResena`:
  ```typescript
  /**
   * Lo que el orquestador necesita para publicar UNA reseña puntual, vía `app.resena_para_publicar`
   * (0025). `null` si la solicitud ya no aplica (publicada, sin borrador, o no existe) -- el evento
   * que dispara esto no porta autoridad (ADR-18), esta consulta es la que decide.
   */
  async resenaParaPublicar(resenaId: string): Promise<ResenaParaPublicar | null> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{
        client_id: string; tenant_id: string; google_review_id: string;
        borrador_respuesta: string; location_id: string; refresh_token: string;
      }>("select * from app.resena_para_publicar($1)", [resenaId]);
      const r = rows[0];
      if (!r) return null;
      return {
        clientId: r.client_id, tenantId: r.tenant_id, googleReviewId: r.google_review_id,
        borrador: r.borrador_respuesta, locationId: r.location_id, refreshToken: r.refresh_token,
      };
    });
  }

  /**
   * Confirma que se publicó, vía `app.publicar_respuesta_resena` (0025). `false` si nadie la pidió
   * o ya estaba publicada -- el WHERE de la función decide, no este método.
   */
  async marcarRespuestaPublicada(
    r: { clientId: string; tenantId: string; googleReviewId: string },
  ): Promise<boolean> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ publicar_respuesta_resena: boolean }>(
        "select app.publicar_respuesta_resena($1, $2, $3) as publicar_respuesta_resena",
        [r.clientId, r.tenantId, r.googleReviewId],
      );
      return rows[0]?.publicar_respuesta_resena ?? false;
    });
  }
  ```

- [ ] **Step 6: Tests de `store.test.ts` (o donde vivan los de `guardarBorradorResena`)**

  Mismo molde que los tests existentes de `guardarBorradorResena`/`clientesConectadosGoogle`
  (rol `app_service`, `sinTenant`, y el test que exige 42501 si se llama con `app_user` — mirar si
  existe ese test para `guardarBorradorResena` y replicarlo acá). Casos:
  - `resenaParaPublicar` devuelve los seis campos correctos para una fila sembrada con
    `respuesta_solicitada_en` puesto, borrador presente y sin publicar.
  - `resenaParaPublicar` devuelve `null` si `respuesta_solicitada_en` es NULL (nadie la pidió).
  - `resenaParaPublicar` devuelve `null` si ya está publicada.
  - `marcarRespuestaPublicada` devuelve `true` y dos llamadas seguidas: la segunda da `false`
    (idempotencia — no publica dos veces).
  - Un `PgStore` con rol `app_user` NO puede llamar a ninguna de las dos funciones (42501) — mismo
    test que ya exista para `guardarBorradorResena`, adaptado.

  Verificar por mutación: sacar `and respuesta_publicada_en is null` de
  `app.publicar_respuesta_resena` y confirmar que el test de "segunda llamada da false" cae.

- [ ] **Step 7: `api/src/app.ts` — tercera forma del PATCH**

  Extender el bloque de `PATCH /clients/:id/resenas/:resenaId` (buscar el comentario que dice
  "acepta EXACTAMENTE una de dos formas fijas" y actualizarlo a "una de TRES"). Agregar, después del
  bloque de `borrador_respuesta` y antes del `return c.json({ error: ... }, 400)` final:
  ```typescript
  if (claves.length === 1 && (body as Record<string, unknown>)["publicar"] === true) {
    const ok = await deps.resenas.solicitarPublicacion(ctx, clientId, resenaId);
    if (!ok) {
      return c.json(
        { error: "Reseña no encontrada, sin borrador, ya publicada, o sin permiso." },
        404,
      );
    }
    await deps.emisor.send({
      name: "resenas/respuesta.solicitada",
      data: ctx.userId ? { resenaId, solicitadoPor: ctx.userId } : { resenaId },
    });
    return c.json({ ok: true });
  }
  ```
  Y actualizar el mensaje del 400 final a:
  `'El body tiene que ser {"vista": true}, {"borrador_respuesta": string} o {"publicar": true}.'`

  `deps.emisor` ya existe en el archivo (usado en `POST /runs/:id/approve`, línea ~364) — no hace
  falta agregarlo a `Deps`.

- [ ] **Step 8: Tests de `app.test.ts` para el PATCH nuevo**

  Mirar los tests existentes del PATCH de `resenas` (`vista`/`borrador_respuesta`) y replicar el
  molde para `publicar`. Casos:
  - Con borrador y sin publicar: `{"publicar": true}` da 200, Y el test comprueba que se emitió
    EXACTAMENTE el evento `resenas/respuesta.solicitada` con `{resenaId, solicitadoPor: userId}`
    (mismo patrón que el test de `research/aprobado` en la línea ~283 de este archivo,
    `assert.deepEqual(eventos[0], {...})`).
  - Sin borrador: 404, y NINGÚN evento emitido (`eventos.length === 0`).
  - Rol `cliente`: 404 (ADR-20), sin evento.
  - Body inválido (`{"publicar": "sí"}`, string en vez de boolean, o dos claves a la vez): 400.

  Verificar por mutación: comentar el `if (!ok) return ...` y confirmar que el caso "sin borrador"
  ahora emite un evento igual — debe caer el test que asegura `eventos.length === 0`.

- [ ] **Step 9: Verificar y cerrar la tarea**

  `npm test -w db && npm test -w api`. Todo en verde. Escribir el resultado en
  `progress/informes/datos-publicar-respuesta.md` (qué se hizo, comandos corridos, resultado) y
  responder con una sola línea: `done -> progress/informes/datos-publicar-respuesta.md`.

---

### Task 2 (agente `pipeline`): provider + función de Inngest

**Depende de:** Task 1 completa y mergeada/commiteada (usa `PgStore.resenaParaPublicar`,
`PgStore.marcarRespuestaPublicada`, y el evento `resenas/respuesta.solicitada`).

**Files:**
- Modify: `orchestrator/src/google/provider.ts` (interfaz `GoogleReviewsProvider`)
- Modify: `orchestrator/src/google/mock-provider.ts` (implementación mock)
- Modify: `orchestrator/src/events.ts` (registrar el evento)
- Modify: `orchestrator/src/functions.ts` (nueva función)
- Modify: `orchestrator/src/server.ts` (registrar la función)
- Test: `orchestrator/src/google/provider.test.ts`, `orchestrator/src/functions.test.ts`

**Interfaces:**
- Consume: `PgStore.resenaParaPublicar(resenaId): Promise<ResenaParaPublicar | null>`,
  `PgStore.marcarRespuestaPublicada(r): Promise<boolean>`, tipo `ResenaParaPublicar` (los tres, de
  `db`, ya existen tras la Task 1). Evento `"resenas/respuesta.solicitada"` con
  `{ resenaId: string; solicitadoPor?: string }` (lo emite `api/`, Task 1).
- Produce: nada que otra task consuma (Task 3 solo consume el contrato HTTP de la Task 1).

**Paso a paso:**

- [ ] **Step 1: `orchestrator/src/google/provider.ts` — extender la interfaz**

  Agregar a `GoogleReviewsProvider`:
  ```typescript
  /**
   * Publica la respuesta de vuelta en la reseña, en Google (Bloque F, fase 2, segunda pieza).
   * `live` no la implementa todavía -- ver {@link getGoogleReviewsProvider}.
   */
  publicarRespuesta(
    accessToken: string,
    locationId: string,
    googleReviewId: string,
    texto: string,
  ): Promise<void>;
  ```
  No tocar `getGoogleReviewsProvider`: ya lanza para `modo !== "mock"` sin listar métodos, así que
  cubre el nuevo también sin cambios.

- [ ] **Step 2: `orchestrator/src/google/mock-provider.ts` — implementar**

  ```typescript
  async publicarRespuesta(
    _accessToken: string,
    _locationId: string,
    _googleReviewId: string,
    _texto: string,
  ): Promise<void> {
    // Determinista: "publica" siempre con éxito, sin salir a internet -- mismo criterio que el
    // resto de este mock (fixtures fijas, sin estado).
  }
  ```

- [ ] **Step 3: Test de `provider.test.ts`**

  Mirar el test existente de `refrescarToken`/`listarResenas` del mock y agregar uno simétrico:
  `publicarRespuesta` resuelve sin lanzar para cualquier input (incluido texto vacío).

- [ ] **Step 4: `orchestrator/src/events.ts` — registrar el evento**

  ```typescript
  export interface ResenaPublicacionSolicitada {
    data: {
      /**
       * El `id` interno de `resenas_google`. La fila YA quedó marcada bajo RLS antes de este
       * evento (ADR-18) -- esto solo despierta al orquestador, que vuelve a preguntarle a la base
       * qué publicar (`resenaParaPublicar`). Nunca se confía en otro dato del evento para decidir
       * qué escribir.
       */
      resenaId: string;
      /** Solo trazabilidad -- igual que `aprobadoPor` en `ResearchAprobado`. */
      solicitadoPor?: string;
    };
  }
  ```
  Y agregar `"resenas/respuesta.solicitada": ResenaPublicacionSolicitada;` al tipo `Eventos`.

- [ ] **Step 5: `orchestrator/src/functions.ts` — la función nueva**

  Cerca de `pollearResenas`/`crearFuncionPollingResenas` (mismo archivo). Función pura primero
  (testeable sin Inngest), después el wrapper:
  ```typescript
  /**
   * Publica la respuesta de vuelta en Google (Bloque F, fase 2, segunda pieza). Reacciona al evento
   * `resenas/respuesta.solicitada`, que NO PORTA AUTORIDAD (ver events.ts): la fila ya quedó
   * marcada bajo RLS por la API antes de emitirlo (ADR-18), y esta función vuelve a preguntarle a
   * la base qué publicar (`resenaParaPublicar`) en vez de confiar en el evento. Cero filas = la
   * solicitud ya no aplica (otra corrida ya publicó, o se borró el borrador entretanto) -- no es un
   * error, es el resultado correcto de una carrera perdida.
   */
  export async function publicarRespuestaResena(
    deps: Pick<Deps, "store" | "resenasProvider">,
    resenaId: string,
    log: (msg: string) => void = () => {},
  ): Promise<{ publicada: boolean }> {
    const info = await deps.store.resenaParaPublicar(resenaId);
    if (!info) {
      log(
        `[publicar-resena] ${resenaId}: la solicitud ya no aplica (publicada, sin borrador, o inexistente)`,
      );
      return { publicada: false };
    }

    const accessToken = await deps.resenasProvider.refrescarToken(info.refreshToken);
    await deps.resenasProvider.publicarRespuesta(
      accessToken, info.locationId, info.googleReviewId, info.borrador,
    );
    const ok = await deps.store.marcarRespuestaPublicada({
      clientId: info.clientId, tenantId: info.tenantId, googleReviewId: info.googleReviewId,
    });
    if (!ok) {
      log(
        `[publicar-resena] ${resenaId}: publicada en Google pero la confirmación no pisó ninguna fila`,
      );
    }
    return { publicada: ok };
  }

  export function crearFuncionPublicarResena(deps: Deps) {
    return inngest.createFunction(
      {
        id: "publicar-respuesta-resena",
        // Sin reintentos: reintentar en caliente un publish contra Google es el mismo error que ya
        // se descartó en `crearFuncionPollingResenas`. El reintento real es que el staff vuelva a
        // apretar "Publicar" -- eso pisa `respuesta_solicitada_en` y remite el evento.
        retries: 0,
      },
      { event: "resenas/respuesta.solicitada" },
      async ({ event, step }) =>
        step.run("publicar", () => publicarRespuestaResena(deps, event.data.resenaId, console.log)),
    );
  }
  ```

- [ ] **Step 6: Tests de `functions.test.ts` para `publicarRespuestaResena`**

  Mirar los tests existentes de `pollearResenas` (mismo archivo) para el molde de deps fake
  (`store`/`resenasProvider` con implementaciones a medida por test, sin PGlite -- esta función no
  toca RLS directamente, ya lo hizo la Task 1). Casos:
  - `resenaParaPublicar` devuelve info válida: llama a `refrescarToken`, después
    `publicarRespuesta` con los 4 argumentos correctos (`accessToken` del refresh, `locationId`,
    `googleReviewId`, `borrador`), después `marcarRespuestaPublicada` con `{clientId, tenantId,
    googleReviewId}` -- y devuelve `{publicada: true}`.
  - `resenaParaPublicar` devuelve `null`: no llama a NINGÚN otro método del provider ni del store, y
    devuelve `{publicada: false}` sin lanzar.
  - `marcarRespuestaPublicada` devuelve `false` (carrera): la función NO lanza, devuelve
    `{publicada: false}`, y logueó (comprobar con un `log` fake que junta mensajes en un array).
  - Un error de `refrescarToken`/`publicarRespuesta` SE PROPAGA (no se traga) -- a diferencia de
    `pollearResenas`, acá no hay "otros clientes" que proteger con un try/catch interno.

  Verificar por mutación: invertir la condición `if (!info)` a `if (info)` y confirmar que el
  primer test (info válida) ahora cae.

- [ ] **Step 7: `orchestrator/src/server.ts` — registrar la función**

  En el import de `./functions.js`, agregar `crearFuncionPublicarResena`. En el array `funciones`,
  agregarla: `crearFuncionPublicarResena(deps)`.

- [ ] **Step 8: Verificar y cerrar la tarea**

  `npm test -w orchestrator`. Todo en verde. Escribir el resultado en
  `progress/informes/pipeline-publicar-respuesta.md` y responder con una sola línea:
  `done -> progress/informes/pipeline-publicar-respuesta.md`.

---

### Task 3 (agente `front`): el botón "Publicar" en el portal

**Depende de:** Task 1 completa (usa el endpoint `PATCH .../resenas/:id` con `{"publicar": true}` y
los dos campos nuevos de `GET .../resenas`). No depende de la Task 2 para funcionar en la demo:
igual que el resto del módulo, el mock hace que el ciclo se vea completo sin esperar al orquestador
real corriendo — pero para probarlo de punta a punta en el navegador (Step final) hace falta el
orquestador procesando el evento, así que verificar DESPUÉS de que la Task 2 también esté lista.

**Files:**
- Modify: `portal/src/app/core/models.ts` (`ResenaGoogle`)
- Modify: `portal/src/app/core/api-core.ts` (interfaz `ApiCore` + implementación)
- Modify: `portal/src/app/pages/clientes/cliente-resenas.ts` (componente + template)
- Test: `portal/src/app/pages/clientes/cliente-resenas.spec.ts`

**Interfaces:**
- Consume: `PATCH /clients/:id/resenas/:resenaId` con `{"publicar": true}` (200/`{ok:true}` o 404);
  `GET /clients/:id/resenas` devuelve ahora `respuesta_solicitada_en`/`respuesta_publicada_en` por
  fila (snake_case tal como los manda `api/`, igual que el resto de los campos de `ResenaGoogle`
  hoy — mirar cómo `pedir<T>` ya deserializa el resto para seguir el mismo criterio de naming).
- Produce: nada (hoja de la cadena).

**Paso a paso:**

- [ ] **Step 1: `portal/src/app/core/models.ts` — extender `ResenaGoogle`**

  ```typescript
  /** `null` = nadie pidió publicar todavía. */
  respuestaSolicitadaEn: string | null;
  /** `null` = no publicado (nunca pedido, en curso, o el último intento falló). */
  respuestaPublicadaEn: string | null;
  ```

- [ ] **Step 2: `portal/src/app/core/api-core.ts` — nuevo método**

  En la interfaz `ApiCore`, junto a `editarBorradorResena`:
  ```typescript
  publicarRespuestaResena(clientId: string, resenaId: string): Promise<void>;
  ```
  Implementación, mismo molde exacto que `marcarResenaVista`/`editarBorradorResena`:
  ```typescript
  async publicarRespuestaResena(clientId, resenaId) {
    await pedir(
      'PATCH',
      `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`,
      { publicar: true },
    );
  },
  ```

- [ ] **Step 3: `cliente-resenas.ts` — el botón y los tres estados**

  Dentro del bloque `@if (r.puntuacion >= 4) { @if (membresia.esEquipo()) { ... } }`, DESPUÉS del
  botón "Guardar" existente, agregar el estado de publicación. Los tres estados, mutuamente
  excluyentes, en este orden de prioridad:

  1. `r.respuestaPublicadaEn` no nulo → texto fijo, sin botón: `Publicada el {{ fecha }}` (formatear
     igual que el resto del portal formatea fechas — mirar si hay un pipe/helper ya usado en esta
     misma pantalla o en `cliente-ideas.ts` antes de escribir uno nuevo).
  2. `r.respuestaPublicadaEn` nulo Y `r.respuestaSolicitadaEn` no nulo → botón con texto
     "Reintentar publicación" (ya se pidió antes y sigue sin confirmarse — podría estar en curso o
     haber fallado, no se distingue).
  3. Ninguno de los dos → botón con texto "Publicar respuesta".

  El botón (casos 2 y 3) llama a un método nuevo del componente:
  ```typescript
  async publicar(r: ResenaGoogle): Promise<void> {
    await this.api.publicarRespuestaResena(this.clienteId(), r.id);
    this.resenas.update((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, respuestaSolicitadaEn: new Date().toISOString() } : x)),
    );
  }
  ```
  (Actualiza el estado local a "solicitada" de inmediato — el mismo criterio optimista que ya usa
  `verla()`. La confirmación real de `respuestaPublicadaEn` llega en el próximo `GET` completo, que
  ya dispara `cargar()` al volver a esta pantalla o cambiar de cliente; no hace falta agregar
  polling nuevo para esto.)

  El botón de publicar SOLO debe verse si `r.borradorRespuesta` tiene contenido (no tiene sentido
  publicar un borrador vacío) — condición adicional en el `@if`, coherente con que "Guardar" ya
  existe para escribirlo primero.

- [ ] **Step 4: Tests de `cliente-resenas.spec.ts`**

  Mirar los tests existentes de `guardarBorrador`/`verla` en el mismo spec y replicar el molde
  (fake de `ApiService`, `TestBed`, disparar el click, comprobar la llamada y el estado local).
  Casos:
  - Con borrador y sin solicitud: se ve el botón "Publicar respuesta"; al hacer click, llama a
    `publicarRespuestaResena(clientId, resenaId)` y el estado local pasa a tener
    `respuestaSolicitadaEn` no nulo (el botón cambia a "Reintentar publicación" sin recargar).
  - Con `respuestaPublicadaEn` puesto: se ve el texto fijo, NO hay botón.
  - Sin `borradorRespuesta`: no se ve ningún botón de publicar (ni "Publicar" ni "Reintentar").
  - Rol `cliente` (no `esEquipo()`): no se ve ningún botón (mismo criterio que ya rige el resto de
    los controles de esta pantalla).

- [ ] **Step 5: Verificar en el navegador**

  Con la Task 2 ya integrada: levantar `orchestrator` + `api` + `portal` en modo mock
  (`GOOGLE_REVIEWS_MODO=mock`, `BORRADOR_RESENAS_MODO=mock`), conectar Google, esperar (o forzar) un
  borrador, click en "Publicar respuesta", confirmar que el botón pasa a "Reintentar publicación" al
  toque y a "Publicada el ..." después de que el orquestador procese el evento y de refrescar la
  pantalla. Consola limpia, los dos temas.

- [ ] **Step 6: Verificar y cerrar la tarea**

  `npm --prefix portal run test:components` (o el comando que ya use este spec) en verde. Escribir
  el resultado en `progress/informes/front-publicar-respuesta.md` y responder con una sola línea:
  `done -> progress/informes/front-publicar-respuesta.md`.

---

## Cierre (sesión principal, no un agente)

1. `revisor` sobre el diff completo de las tres tareas juntas — CHECKPOINTS.md contra el diff real.
2. `npm run verificar` desde la raíz, output a la vista.
3. Documentar en `docs/proyecto/15-plan-plataforma.md` § Bloque F (mover este ítem de "sin empezar" a
   hecho, con el detalle real de lo que se hizo — no lo que este plan proponía, lo que terminó
   siendo), `docs/proyecto/09-estado-y-roadmap.md` (Tests, resumen ejecutivo), `progress/history.md`
   (entrada nueva) y `progress/current.md` (reset a plantilla o al siguiente pendiente).
4. Commit + push a `main`.
