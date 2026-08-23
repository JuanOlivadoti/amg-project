# Alertas por Telegram para reseñas 1-3★ (Bloque F, fase 2) — Plan

> **Para quien ejecute esto:** tres tareas, una por agente de área (`datos`, `pipeline`, `front`),
> en ESE orden porque cada una consume el contrato que fija la anterior. Después de las tres,
> `revisor` sobre el diff completo. La sesión principal integra, corre `npm run verificar`, actualiza
> la documentación del ritual y commitea.
>
> **Revisado por Codex antes de ejecutar (2026-08-23).** Veredicto original: NECESITA REDISEÑO —
> ocho hallazgos, ninguno reabrió Telegram ni "por CM asignado" (las dos decisiones ya tomadas). Este
> documento ya incorpora los ocho ajustes aceptados: el offset de `getUpdates` separado de los
> mensajes parseables (Hallazgo 1), los grants de `app_telegram` completos (Hallazgo 2), el código y
> el TTL de vinculación generados por Postgres y no por el caller (Hallazgo 3), la alerta con retry
> automático en el próximo ciclo de polling en vez de perderse para siempre — decisión de Juan (Hallazgo 4),
> `DROP FUNCTION` en vez de `CREATE OR REPLACE` para agregarle una columna a
> `clientes_conectados_google` (Hallazgo 5), el cableado completo de `TELEGRAM_BOT_USERNAME` por
> `env:sync`/`credencial.mts` (Hallazgo 6), validación de enteros seguros y del campo `ok` en las
> respuestas de Telegram (Hallazgo 7), y los tests negativos que faltaban (Hallazgo 8). El diseño
> central que motivó la revisión —el trigger que cierra la combinación por OR de las dos políticas
> UPDATE sobre `memberships`— lo confirmó Codex corriéndolo contra PGlite: aguanta.

**Goal:** cuando llega una reseña nueva de 1-3★, el Community Manager asignado a ese cliente recibe
un mensaje de Telegram al instante (dentro del mismo ciclo de polling de 30 min que ya detecta la
reseña). RF-018 del PRD lo pide "al CM", no al cliente — el destinatario es personal interno de AMG.

**Por qué Telegram y no WhatsApp:** investigado antes de este plan. WhatsApp Business exige
verificación de negocio ante Meta (documentos, días), plantillas pre-aprobadas para cualquier mensaje
que AMG inicie, y se paga por mensaje entregado. Telegram: un bot se crea con `@BotFather` en dos
minutos, gratis para siempre, sin aprobación de nadie. La única restricción (el bot no puede
escribirle a quien nunca le escribió primero) es un no-problema acá: el destinatario es el propio
equipo de AMG, no un cliente externo — le pedimos a nuestra gente que mande `/start` una vez.

**A diferencia de todo lo demás que queda de fase 2** (publicar en vivo contra Google, que sigue
bloqueado por un trámite externo de Juan): Telegram **no tiene ningún gatekeeper externo**. Este plan
implementa el modo `live` DE VERDAD, no un mock que espera una aprobación — el día que Juan cree el
bot (`@BotFather`, autoservicio, sin espera), esto funciona en producción.

**Arquitectura, en tres piezas:**

1. **Vincular la cuenta** (self-service, sin OAuth real porque Telegram no tiene redirect-back): el
   CM pide un código desde su perfil en el portal (`app_user`, bajo RLS, escribe SOLO su propia fila
   de `memberships`); abre `t.me/<bot>?start=<código>`; el orquestador, con polling periódico sobre
   `getUpdates` (mismo criterio que ya eligió este proyecto para las reseñas de Google en vez de
   Pub/Sub — "menos infraestructura nueva"), encuentra el `/start <código>` y confirma la
   vinculación vía una función `security definer`.
2. **Disparar la alerta**: se engancha en el `pollearResenas` que ya existe — en CADA ciclo (no solo
   cuando la reseña es nueva), busca las reseñas de 1-3★ sin alerta confirmada todavía
   (`alerta_telegram_enviada_en is null`), resuelve el CM asignado al cliente
   (`clients.asignado_a` → `memberships`) y, si tiene Telegram vinculado, le manda el mensaje y
   marca la columna. Esto es lo que le da **retry gratis**: si Telegram falló en un ciclo, el
   próximo (30 min después) vuelve a intentarlo solo, sin cola ni botón — decisión de Juan tras la
   revisión de Codex (Hallazgo 4), ver el detalle en la Task 1/2.
3. **Un fallo puntual no frena el resto**: mismo criterio que el borrador de IA — un error de
   Telegram en una reseña no impide que se procesen las demás del mismo ciclo.

**Tech Stack:** el ya establecido — Postgres/RLS (`db`), Hono (`api`), Inngest (`orchestrator`),
Angular standalone + signals (`portal`). Sin dependencias nuevas: Telegram se llama con `fetch` nativo
(Node 24), mismo criterio que ya usa el resto del proyecto para HTTP a servicios externos.

## Global Constraints

- Español para nombres de dominio, comentarios explican el POR QUÉ.
- `node:test` + `node:assert`, rojo→verde→mutación en cada pieza de lógica nueva — con ÉNFASIS en el
  trigger de la Task 1 (es la pieza de más riesgo de este plan).
- El rol se deriva de `memberships`, nunca se declara (ADR-15).
- Un proceso, un login, un rol, `NOINHERIT` (ADR-17): el orquestador sigue siendo `app_service`,
  nunca asume otro rol de sesión.
- Cualquier valor externo (el texto de un mensaje de Telegram, la respuesta de `getUpdates`) se trata
  como no confiable hasta parsearlo explícitamente — mismo criterio que `parsearEvento` en
  `renderer/src/webhook.ts`.
- Sin reintento automático contra APIs externas (`retries: 0` en las funciones de Inngest nuevas).
- El `TELEGRAM_BOT_TOKEN` es un secreto real de producción: va por `env:sync` igual que
  `OPENAI_API_KEY`/`STORYBLOK_WEBHOOK_SECRET` (a diferencia de `PREVIEW_SECRET`, que es config de
  Railway — acá SÍ hace falta el token en el `.env` local del orquestador para poder probar en modo
  `live` fuera de producción, si Juan decide crear un bot de prueba).

---

### Task 1 (agente `datos`): migración 0026 + capa de acceso + endpoints de auto-servicio

**Files:**
- Create: `db/migrations/0026_telegram_alertas.sql`
- Modify: `db/src/membresias.ts` (nuevos métodos de auto-servicio)
- Modify: `db/src/store.ts` (nuevos métodos cross-tenant para el orquestador)
- Modify: `db/src/index.ts` (reexportar los tipos nuevos, mismo patrón que `ResenaParaPublicar`)
- Modify: `api/src/app.ts`, `api/src/deps.ts` (tres endpoints nuevos bajo `/me/telegram`,
  `TELEGRAM_BOT_USERNAME` obligatoria)
- Modify: `api/.env.example`, `scripts/env-sync.mts`, `scripts/credencial.mts`
  (`TELEGRAM_BOT_USERNAME`, familia `config` — ver Step 12)
- Test: `db/src/membresias.test.ts`, `db/src/store.test.ts`, `api/src/app.test.ts`

**Interfaces:**
- Consume: nada de tareas anteriores (es la primera).
- Produce, para la Task 2 (`pipeline`):
  - `PgStore.telegramDelAsignado(clientId: string): Promise<string | null>` — el `chat_id` del CM
    asignado, o `null` si no hay asignado o no vinculó Telegram.
  - `PgStore.vincularTelegramPorCodigo(codigo: string, chatId: string): Promise<boolean>`.
  - `PgStore.offsetTelegramActual(): Promise<number>` y
    `PgStore.avanzarOffsetTelegram(nuevoOffset: number): Promise<void>`.
  - `PgStore.resenasPendientesAlertaTelegram(clientId: string): Promise<ResenaPendienteAlerta[]>` y
    `PgStore.marcarAlertaTelegramEnviada(r): Promise<boolean>` — el mecanismo de retry automático
    (decisión de Juan tras el hallazgo 4 de la revisión de Codex, ver Step 6).
  - `PgStore.clientesConectadosGoogle()` gana el campo `nombre` en `ClienteConectadoGoogle` (el
    nombre del negocio, para el texto del mensaje de alerta) — vía `DROP`+`CREATE`, no
    `CREATE OR REPLACE` (hallazgo 5 de Codex, ver Step 6).
- Produce, para la Task 3 (`front`):
  - `POST /me/telegram/vincular` → `200 { url: string }` (el deep link `t.me/<bot>?start=<código>`).
  - `GET /me/telegram` → `200 { vinculado: boolean }`.
  - `POST /me/telegram/desvincular` → `200 { ok: boolean }` — `false` es una respuesta VÁLIDA (no
    había nada que desvincular), no un error.
  - `membresias_perfil` (la vista que ya consume el portal para `GET /members`) gana la columna
    `telegram_vinculado: boolean`.

**Paso a paso:**

- [ ] **Step 1: Leer el precedente ANTES de escribir nada**

  Leer `db/migrations/0012_membresias_perfil.sql` completo (la vista `membresias_perfil`, la función
  `app.rol_propio_sin_recursion()`, la política `membership_update`, y el trigger
  `verificar_ultimo_maestro` con su comentario sobre concurrencia). Esta migración nueva se apoya en
  las tres cosas y tiene que entender por qué existen antes de tocar la tabla que gobiernan.

- [ ] **Step 2: Migración `0026_telegram_alertas.sql` — columnas y vista**

  ```sql
  -- =============================================================================
  -- AMG OS — 0026: alertas por Telegram para reseñas 1-3★ (Bloque F, fase 2)
  --
  -- RF-018 del PRD: "alerta inmediata (WhatsApp/email) al CM ante 1-3★". El destinatario es
  -- personal INTERNO de AMG (el Community Manager asignado al cliente, `clients.asignado_a`), no el
  -- cliente externo -- por eso el canal elegido es Telegram y no WhatsApp Business (investigado:
  -- verificación de negocio ante Meta, plantillas pre-aprobadas, costo por mensaje -- ver
  -- docs/proyecto/15-plan-plataforma.md § Bloque F). Sin gatekeeper externo: este módulo tiene modo
  -- `live` real desde el día uno, no mock-first.
  --
  -- Spec: docs/proyecto/15-plan-plataforma.md § Bloque F.
  -- =============================================================================

  -- -----------------------------------------------------------------------------
  -- Tres columnas en `memberships`. `telegram_chat_id` NUNCA lo escribe el usuario directo (solo el
  -- orquestador, tras confirmar el código real contra Telegram) -- si `app_user` pudiera escribirlo
  -- a mano, cualquiera podría poner el chat_id de otra persona y robarle sus alertas sin que
  -- Telegram mediara en nada.
  -- -----------------------------------------------------------------------------
  alter table memberships
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_link_code text,
    add column if not exists telegram_link_code_expira timestamptz;

  comment on column memberships.telegram_chat_id is
    'El chat_id de Telegram vinculado a esta membresía. NULL = no vinculado. Lo escribe SOLO el '
    'orquestador (app_telegram, security definer, app.vincular_telegram) tras confirmar el código '
    'contra un /start real -- app_user nunca tiene grant de escritura sobre esta columna.';
  comment on column memberships.telegram_link_code is
    'Código de un solo uso que el propio usuario pide generar desde el portal para vincular su '
    'Telegram. NULL = no hay vinculación pendiente. Se limpia al confirmarse -- un código VENCIDO '
    'no se limpia solo, simplemente deja de matchear en el WHERE de app.vincular_telegram (el '
    'próximo código que se pida lo pisa igual). El VALOR y el vencimiento los genera Postgres, '
    'nunca el caller -- ver el trigger membresias_guardia_telegram: un app_user con acceso directo '
    'a SQL podría, si no fuera por ese trigger, escribir un código elegido por él o una expiración '
    'arbitraria (Codex review 2026-08-23, hallazgo 3).';
  comment on column memberships.telegram_link_code_expira is
    'Vencimiento del código de arriba, SIEMPRE now() + 10 minutos -- impuesto por el trigger '
    'membresias_guardia_telegram, no por quien pide el código. Sin esto, un código viejo filtrado '
    'en un log seguiría siendo válido para siempre.';

  -- -----------------------------------------------------------------------------
  -- Una columna en `resenas_google`: si ya se mandó (o se intentó y confirmó) la alerta de
  -- Telegram para esta reseña. Decisión de Juan tras la revisión de Codex (hallazgo 4): un fallo
  -- de Telegram NO puede perder la alerta para siempre -- el próximo ciclo de polling (30 min)
  -- vuelve a intentar CUALQUIER reseña 1-3★ sin esta columna puesta, sin cola ni botón nuevo. Es
  -- ortogonal a si la reseña es "nueva" en ese ciclo: una reseña vieja cuya alerta falló hace tres
  -- ciclos se sigue reintentando hasta que se marque.
  -- -----------------------------------------------------------------------------
  alter table resenas_google
    add column if not exists alerta_telegram_enviada_en timestamptz;

  comment on column resenas_google.alerta_telegram_enviada_en is
    'Cuándo se confirmó el envío de la alerta de Telegram al CM asignado. NULL = todavía no (nunca '
    'se intentó, el CM no tiene Telegram vinculado, o el último intento falló). El polling reintenta '
    'toda reseña 1-3★ con esta columna en NULL en cada ciclo -- ver app.marcar_alerta_telegram_enviada.';

  -- Aditivo sobre el grant de update de la 0024 (los privilegios de columna del mismo rol/tabla se
  -- ACUMULAN) -- la política resena_actualizar_borrador_app_resenas (0024, using true/check true)
  -- ya cubre CUALQUIER UPDATE de app_resenas sobre esta tabla, no hace falta una política nueva.
  grant update (alerta_telegram_enviada_en) on resenas_google to app_resenas;

  -- -----------------------------------------------------------------------------
  -- La vista gana el booleano -- NO el chat_id crudo (no hace falta exponerlo al portal, y es
  -- exactamente el mismo criterio que ya evitó devolver el token OAuth de Google en cualquier
  -- lectura de `clients`).
  -- -----------------------------------------------------------------------------
  create or replace view membresias_perfil as
    select
      m.id,
      m.tenant_id,
      m.user_id,
      m.rol,
      m.client_id,
      m.created_at,
      u.email,
      u.raw_app_meta_data,
      (m.telegram_chat_id is not null) as telegram_vinculado
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = app.current_tenant_id()
      and (app.es_staff() or m.user_id = app.current_user_id());

  comment on view membresias_perfil is
    'Lectura de memberships + auth.users (email, metadata, si vinculó Telegram), YA filtrada por '
    'tenant y por rol -- ver 0012 para el resto del razonamiento. telegram_vinculado es un booleano '
    'derivado, nunca el chat_id crudo.';
  ```

- [ ] **Step 3: La parte sutil — dos políticas UPDATE permisivas + un código que Postgres tiene que
  generar él mismo**

  **Confirmado por Codex contra PGlite antes de escribir código (2026-08-23):** el diseño de esta
  sección es correcto, pero el plan original solo escribía la MITAD del trigger que hacía falta.

  `membership_update` (0012) ya permite que un `maestro` cambie `rol`/`client_id` de OTRA fila.
  Ahora agregamos una SEGUNDA política UPDATE (self-service, para vincular Telegram). **Postgres
  combina políticas permisivas del mismo comando con OR — el `using` de todas se OR-ea entre sí, y el
  `with check` de todas se OR-ea entre sí, POR SEPARADO.** Sin cuidado acá, una sentencia que tocara
  `rol` Y `telegram_link_code` en la MISMA fila (la propia) podría colarse: el `with check` de
  `membership_update` la rechazaría (no es sobre "otra fila"), pero el `with check` de la política
  nueva (que solo mira "¿es mi fila?") la aprobaría — y con el OR, basta con que UNA la apruebe.

  Ningún código de este repo arma ese UPDATE combinado hoy (`cambiarRol` y los métodos nuevos de este
  plan usan sentencias separadas, con columnas fijas cada una) — pero **"ningún código lo hace hoy"
  es una intención, no una garantía** (AGENTS.md). La arregla un trigger `BEFORE UPDATE`, que corre
  SIEMPRE, sin importar qué política haya dejado pasar la fila — no se toca `membership_update`, que
  sigue exactamente igual que en la 0012.

  **Segundo problema, que el plan original no había resuelto (hallazgo 3 de Codex):** el grant de
  arriba le da a `app_user` UPDATE directo sobre `telegram_link_code`/`telegram_link_code_expira`.
  Que el CÓDIGO del plan (`PgMembresias.generarCodigoTelegram`, Step 7) genere un valor
  impredecible con `crypto.randomBytes` y calcule un vencimiento de 10 minutos es una garantía en
  TypeScript — no en Postgres. Una sentencia SQL directa, fuera de ese método, podría escribir
  cualquier código y cualquier vencimiento (incluso uno que nunca venza). El MISMO trigger de arriba
  cierra esto también: cuando detecta que se está pidiendo un código nuevo, IGNORA el valor que
  mandó el caller y genera el suyo.

  ```sql
  -- app_user puede generar y borrar SU PROPIO código de vinculación pendiente -- nunca
  -- `telegram_chat_id`, que queda reservado a `app_telegram` (más abajo).
  grant update (telegram_link_code, telegram_link_code_expira) on memberships to app_user;

  create policy membership_vincular_telegram on memberships
    for update
    to app_user
    using      (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
    with check (tenant_id = app.current_tenant_id() and user_id = app.current_user_id());

  comment on policy membership_vincular_telegram on memberships is
    'Un usuario autenticado puede generar/borrar SU PROPIO código de vinculación de Telegram, '
    'cualquiera sea su rol -- a diferencia de membership_update (0012), acá no importa ser maestro. '
    'Ver el trigger membresias_guardia_telegram para por qué esto no debilita la protección de '
    'auto-degradación de membership_update al combinarse por OR, y para por qué el VALOR del código '
    'no lo elige quien lo pide.';

  -- -----------------------------------------------------------------------------
  -- Un solo trigger BEFORE UPDATE, dos guardias independientes. Codex review 2026-08-23:
  --
  -- (a) Backstop de rol/client_id (hallazgo de diseño original, confirmado por Codex contra
  --     PGlite): repite la condición que membership_update YA impone en su WITH CHECK, pero corre
  --     INCONDICIONALMENTE, antes de que RLS decida nada. Un WITH CHECK no puede comparar
  --     limpiamente contra el valor VIEJO de la fila (no hay una forma segura de referenciar OLD
  --     dentro de una expresión de política); un trigger BEFORE sí tiene OLD y NEW. Necesario
  --     porque esta migración agrega una segunda política permisiva sobre el mismo UPDATE
  --     (vincular Telegram): las políticas permisivas se combinan con OR en Postgres, así que sin
  --     este trigger una sentencia que tocara rol Y telegram_link_code en la misma fila podría
  --     colarse por el WITH CHECK más laxo de la política nueva.
  --
  -- (b) El código y su vencimiento los genera ESTA función, nunca el caller (hallazgo 3 de Codex):
  --     `membership_vincular_telegram` le da a `app_user` UPDATE directo sobre
  --     `telegram_link_code`/`telegram_link_code_expira` -- sin este trigger, una sentencia SQL
  --     directa (fuera de `PgMembresias.generarCodigoTelegram`) podría escribir un código elegido
  --     por quien la ejecuta, o una expiración arbitraria (incluso "nunca"), rompiendo las dos
  --     garantías de seguridad que el diseño da por sentadas: impredecibilidad y TTL de 10 min.
  --     Cuando alguien PIDE un código nuevo (`new.telegram_link_code is distinct from
  --     old.telegram_link_code and new.telegram_link_code is not null`), el trigger IGNORA el
  --     valor que mandó el caller y genera el suyo: `gen_random_uuid()::text` (mismo generador de
  --     aleatoriedad que ya usan las primary keys de este esquema -- sin depender de `pgcrypto`,
  --     que no está habilitado acá) y `now() + interval '10 minutes'`. `PgMembresias.
  --     generarCodigoTelegram` (Step 7) manda un valor cualquiera en el UPDATE y lee de vuelta lo
  --     que Postgres realmente escribió, vía `returning`.
  -- -----------------------------------------------------------------------------
  create or replace function app.membresias_guardia_telegram() returns trigger
  language plpgsql as $$
  begin
    if (new.rol is distinct from old.rol or new.client_id is distinct from old.client_id)
       and (app.rol_propio_sin_recursion() <> 'maestro' or new.user_id = app.current_user_id()) then
      raise exception 'No autorizado para cambiar rol/cliente de esta membresía.'
        using errcode = '42501';
    end if;

    if new.telegram_link_code is distinct from old.telegram_link_code
       and new.telegram_link_code is not null then
      new.telegram_link_code := gen_random_uuid()::text;
      new.telegram_link_code_expira := now() + interval '10 minutes';
    end if;

    return new;
  end;
  $$;

  comment on function app.membresias_guardia_telegram is
    'Dos guardias BEFORE UPDATE sobre memberships, en una sola función porque las dos corren '
    'SIEMPRE, sin importar qué política RLS haya dejado pasar la fila: (a) repite la condición de '
    'autorización de rol/client_id que membership_update (0012) ya impone en su WITH CHECK -- '
    'necesario porque esta migración agrega una segunda política UPDATE permisiva sobre la misma '
    'tabla, y Postgres combina políticas permisivas con OR; (b) fuerza el VALOR y el vencimiento de '
    'un código de vinculación nuevo, ignorando lo que el caller haya mandado -- sin esto, app_user '
    '(con UPDATE directo sobre esas dos columnas) podría elegir un código predecible o un '
    'vencimiento infinito. Codex review 2026-08-23, hallazgos de diseño y hallazgo 3.';

  create trigger membresias_guardia_telegram
    before update on memberships
    for each row
    execute function app.membresias_guardia_telegram();
  ```

- [ ] **Step 4: El rol cross-tenant `app_telegram`, mismo baile que `app_barrido`/`app_resenas`**

  ```sql
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'app_telegram') then
      create role app_telegram nologin;
    end if;
  end $$;

  grant usage on schema public, app to app_telegram;

  -- **Codex review 2026-08-23, hallazgo 2, verificado contra PGlite: el grant original solo
  -- concedía UPDATE (escritura) y le faltaba SELECT (lectura).** Postgres exige SELECT sobre
  -- cualquier columna que una sentencia LEA -- en el WHERE, en el RETURNING, o del lado derecho de
  -- un SET -- además de UPDATE sobre las que escribe. `app.vincular_telegram` lee
  -- `telegram_link_code`/`telegram_link_code_expira` en su WHERE y devuelve `id`;
  -- `app.desvincular_telegram_propio` (Step 5) lee `tenant_id`/`user_id`/`telegram_chat_id` en su
  -- WHERE y también devuelve `id`. Sin el SELECT de las seis, las dos funciones fallan con
  -- "permission denied for table memberships" (42501) apenas se las ejecuta -- exactamente el
  -- mismo tipo de bug que ya documentó la 0022 con `archived_at` ("la función NUNCA la DEVUELVE,
  -- pero SÍ la lee... un where normal SÍ lo exige").
  grant select (id, tenant_id, user_id, telegram_chat_id, telegram_link_code, telegram_link_code_expira)
    on memberships to app_telegram;
  grant update (telegram_chat_id, telegram_link_code, telegram_link_code_expira)
    on memberships to app_telegram;

  create policy membership_telegram_actualizar on memberships
    for update to app_telegram
    using (true) with check (true);

  create policy membership_telegram_leer on memberships
    for select to app_telegram
    using (true);

  comment on policy membership_telegram_leer on memberships is
    'app_telegram necesita SELECT (no solo UPDATE) para poder evaluar el WHERE y el RETURNING de '
    'sus propias funciones -- ver el comentario del grant, arriba. Mismo criterio "using (true), el '
    'aislamiento lo da el WHERE de la función" que membership_telegram_actualizar.';

  comment on policy membership_telegram_actualizar on memberships is
    'app_telegram (security definer, app.vincular_telegram) puede actualizar CUALQUIER fila -- el '
    'aislamiento no lo da esta política (no hay contexto de tenant que mirar, mismo motivo que '
    'app_resenas en la 0022): lo da el WHERE de la función, que exige código exacto y no vencido.';

  create or replace function app.vincular_telegram(p_codigo text, p_chat_id text) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, public
  as $$
  declare
    v_id uuid;
  begin
    update memberships
      set telegram_chat_id = p_chat_id, telegram_link_code = null, telegram_link_code_expira = null
      where telegram_link_code = p_codigo
        and telegram_link_code_expira > now()
      returning id into v_id;
    return v_id is not null;
  end;
  $$;

  comment on function app.vincular_telegram is
    'Confirma la vinculación: matchea por código de un solo uso, exige que no haya vencido. Lo '
    'llama el orquestador (app_service) tras leer "/start <codigo>" de getUpdates. security '
    'definer, propiedad de app_telegram.';

  -- El "asignado" de un cliente y su vinculación de Telegram, cruzando `clients` con `memberships`.
  -- `nombre` se agrega al grant de `app_resenas` sobre `clients` (Step 5) para el texto del mensaje
  -- -- acá `app_telegram` solo necesita `asignado_a`. El SELECT sobre `memberships` ya se concedió
  -- arriba (`id, tenant_id, user_id, telegram_chat_id, telegram_link_code, telegram_link_code_expira`
  -- cubre lo que esta función lee: `tenant_id`, `user_id`, `telegram_chat_id`) -- no se repite acá.
  grant select (id, tenant_id, asignado_a) on clients to app_telegram;

  create policy client_ve_app_telegram on clients
    for select to app_telegram
    using (true);

  create or replace function app.telegram_del_asignado(p_client_id uuid) returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
  as $$
    select m.telegram_chat_id
    from clients c
    join memberships m on m.tenant_id = c.tenant_id and m.user_id = c.asignado_a
    where c.id = p_client_id;
  $$;

  comment on function app.telegram_del_asignado is
    'El chat_id de Telegram del CM asignado a un cliente, o NULL si no hay asignado o no vinculó '
    'Telegram. security definer, propiedad de app_telegram, para que el orquestador (app_service) '
    'pueda mandar la alerta sin tener grant directo sobre clients.asignado_a ni memberships.';

  -- Offset de `getUpdates`: sin persistirlo entre corridas, cada ciclo del orquestador volvería a
  -- ver los mismos mensajes /start ya procesados. Fila única (mismo patrón "singleton" que
  -- `app.migraciones_aplicadas`): sin RLS, no es dato de tenant -- ver AGENTS.md, "app.migraciones_
  -- aplicadas no tiene RLS en absoluto, y vive en app, fuera del universo que recorre public".
  create table app.telegram_polling_estado (
    id                boolean primary key default true,
    ultimo_update_id  bigint not null default 0,
    constraint telegram_polling_singleton check (id)
  );
  insert into app.telegram_polling_estado (id) values (true);

  comment on table app.telegram_polling_estado is
    'Fila única: el último update_id de Telegram ya procesado. Sin RLS -- no es dato de tenant, '
    'mismo criterio que app.migraciones_aplicadas.';

  grant select, update on app.telegram_polling_estado to app_service;

  -- El cambio de dueño, idéntico a 0018/0022/0024/0025.
  grant app_telegram to current_user;
  grant create on schema app to app_telegram;
  alter function app.vincular_telegram(text, text) owner to app_telegram;
  alter function app.telegram_del_asignado(uuid) owner to app_telegram;
  revoke execute on function app.vincular_telegram(text, text) from public;
  revoke execute on function app.telegram_del_asignado(uuid) from public;
  grant execute on function app.vincular_telegram(text, text) to app_service;
  grant execute on function app.telegram_del_asignado(uuid) to app_service;
  revoke create on schema app from app_telegram;
  revoke app_telegram from current_user;
  ```

- [ ] **Step 5: el desvincular propio**

  ```sql
  -- El usuario puede desvincularse a sí mismo SIN pasar por Telegram de nuevo -- simétrico con
  -- POST /clients/:id/google/desconectar. Necesita tocar telegram_chat_id, que app_user NO tiene
  -- concedido (a propósito, Step 2) -- por eso es una función security definer angosta, no un grant
  -- nuevo: el cuerpo entero es "poné NULL en MI PROPIA fila", nada más que eso puede hacer.
  create or replace function app.desvincular_telegram_propio() returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, public
  as $$
  declare
    v_id uuid;
  begin
    update memberships
      set telegram_chat_id = null
      where tenant_id = app.current_tenant_id()
        and user_id = app.current_user_id()
        and telegram_chat_id is not null
      returning id into v_id;
    return v_id is not null;
  end;
  $$;

  comment on function app.desvincular_telegram_propio is
    'Limpia telegram_chat_id de la PROPIA fila del que llama -- lee app.current_user_id() y '
    'app.current_tenant_id() (session GUCs, no recursivo: a diferencia de app.current_role(), estas '
    'dos no consultan memberships). security definer solo para poder tocar una columna que app_user '
    'no tiene concedida en absoluto; el alcance lo impone el WHERE, no el rol de quien ejecuta.';

  grant app_telegram to current_user;
  grant create on schema app to app_telegram;
  alter function app.desvincular_telegram_propio() owner to app_telegram;
  revoke execute on function app.desvincular_telegram_propio() from public;
  grant execute on function app.desvincular_telegram_propio() to app_user;
  revoke create on schema app from app_telegram;
  revoke app_telegram from current_user;
  ```

  Nota para quien implemente: `app.current_user_id()`/`app.current_tenant_id()` ya existen desde
  0002/0003 — confirmar sus firmas exactas leyendo esos archivos antes de usarlas acá (no
  reinventarlas).

- [ ] **Step 6: `nombre` en `clientes_conectados_google`, y las dos funciones de la alerta con
  retry — todo propiedad de `app_resenas`**

  **Codex review 2026-08-23, hallazgo 5, verificado contra PGlite: `CREATE OR REPLACE FUNCTION` NO
  puede agregarle una columna a un `RETURNS TABLE` existente** (Postgres lo rechaza con `42P13
  cannot change return type of existing function`). Agregar `nombre` a
  `app.clientes_conectados_google()` (0022) exige `DROP FUNCTION` y recrearla entera, repitiendo el
  baile de dueño completo — no un simple `create or replace`.

  ```sql
  -- -----------------------------------------------------------------------------
  -- `nombre`, para que el mensaje de alerta pueda decir "reseña nueva en <negocio>". DROP + CREATE,
  -- no CREATE OR REPLACE (ver el comentario de arriba) -- repite el mismo baile de dueño que la
  -- creó en la 0022, con la firma vieja borrada primero.
  -- -----------------------------------------------------------------------------
  grant select (nombre) on clients to app_resenas;

  drop function app.clientes_conectados_google();

  create function app.clientes_conectados_google()
  returns table (client_id uuid, tenant_id uuid, location_id text, refresh_token text, nombre text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
  as $$
    select id, tenant_id, google_location_id, google_refresh_token, nombre
    from clients
    where google_refresh_token is not null
      and archived_at is null;
  $$;

  comment on function app.clientes_conectados_google() is
    'Lista, cruzando TODOS los tenants, los clientes con Google conectado -- ahora con `nombre`, '
    'para el texto de la alerta de Telegram (0026). Recreada con DROP + CREATE porque CREATE OR '
    'REPLACE no puede agregar una columna a un RETURNS TABLE existente (42P13). security definer y '
    'propiedad de app_resenas, igual que antes de la 0026.';

  grant app_resenas to current_user;
  grant create on schema app to app_resenas;
  alter function app.clientes_conectados_google() owner to app_resenas;
  revoke execute on function app.clientes_conectados_google() from public;
  grant execute on function app.clientes_conectados_google() to app_service;
  revoke create on schema app from app_resenas;
  revoke app_resenas from current_user;

  -- -----------------------------------------------------------------------------
  -- Las dos piezas del retry automático (decisión de Juan, hallazgo 4 de Codex): qué reseñas 1-3★
  -- siguen sin alerta confirmada (para CUALQUIER cliente conectado, no solo las nuevas de este
  -- ciclo), y cómo confirmar una. Mismo molde exacto que `guardar_borrador_resena` (0024): las
  -- condiciones van en el WHERE, no en el llamador.
  -- -----------------------------------------------------------------------------
  create function app.resenas_pendientes_alerta_telegram(p_client_id uuid)
  returns table (google_review_id text, tenant_id uuid, puntuacion smallint, autor text, texto text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
  as $$
    select google_review_id, tenant_id, puntuacion, autor, texto
    from resenas_google
    where client_id = p_client_id
      and puntuacion between 1 and 3
      and alerta_telegram_enviada_en is null;
  $$;

  comment on function app.resenas_pendientes_alerta_telegram is
    'Las reseñas 1-3★ de un cliente sin alerta de Telegram confirmada todavía -- incluye tanto las '
    'nuevas de este ciclo de polling como las de ciclos anteriores cuyo envío falló. Es lo que le da '
    'retry automático a la alerta sin cola ni botón: el próximo ciclo (30 min) vuelve a intentar '
    'cualquier fila que siga en NULL. security definer, propiedad de app_resenas.';

  create function app.marcar_alerta_telegram_enviada(
    p_client_id uuid, p_tenant_id uuid, p_google_review_id text
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
      set alerta_telegram_enviada_en = now()
      where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
        and alerta_telegram_enviada_en is null
      returning id into v_id;
    return v_id is not null;
  end;
  $$;

  comment on function app.marcar_alerta_telegram_enviada is
    'Confirma que la alerta de Telegram salió. No marca nada si ya estaba confirmada -- la condición '
    'va en el WHERE. security definer, propiedad de app_resenas.';

  grant app_resenas to current_user;
  grant create on schema app to app_resenas;
  alter function app.resenas_pendientes_alerta_telegram(uuid) owner to app_resenas;
  alter function app.marcar_alerta_telegram_enviada(uuid, uuid, text) owner to app_resenas;
  revoke execute on function app.resenas_pendientes_alerta_telegram(uuid) from public;
  revoke execute on function app.marcar_alerta_telegram_enviada(uuid, uuid, text) from public;
  grant execute on function app.resenas_pendientes_alerta_telegram(uuid) to app_service;
  grant execute on function app.marcar_alerta_telegram_enviada(uuid, uuid, text) to app_service;
  revoke create on schema app from app_resenas;
  revoke app_resenas from current_user;
  ```

  Nota: `resenas_pendientes_alerta_telegram`/`marcar_alerta_telegram_enviada` leen/escriben
  columnas de `resenas_google` que `app_resenas` YA puede leer por completo (SELECT de tabla entera,
  0022) y ya puede escribir la columna nueva (`grant update (alerta_telegram_enviada_en)`, Step 2)
  — no hace falta ningún grant adicional para estas dos funciones, a diferencia de las de
  `app_telegram` del Step 4 (que SÍ partían de cero).

- [ ] **Step 7: Migraciones contra PGlite**

  `npm test -w db` — confirmar que la 0026 aplica sin error contra el arnés de tests (que levanta
  PGlite y corre todas las migraciones en cada test run).

- [ ] **Step 8: `db/src/membresias.ts` — auto-servicio**

  Cerca de `cambiarRol`. **A diferencia del diseño original: el código NO se genera en TypeScript.**
  El trigger `membresias_guardia_telegram` (Step 3) ignora cualquier valor que este método mande y
  escribe el suyo (`gen_random_uuid()::text` + `now() + 10 min`) — así que `generarCodigoTelegram`
  manda un placeholder cualquiera en el `UPDATE` y lee de vuelta, con `RETURNING`, lo que Postgres
  realmente escribió. Sin esto el método devolvería el placeholder, no el código real.

  ```typescript
  export interface CodigoTelegram {
    codigo: string;
    expira: string; // ISO-8601
  }

  /**
   * Pide un código de un solo uso para vincular Telegram, y lo guarda en la PROPIA fila del que
   * pide (RLS: `membership_vincular_telegram`, 0026 -- cualquier rol, siempre y cuando sea su
   * fila). El VALOR real lo elige Postgres (trigger `membresias_guardia_telegram`, 0026) -- lo que
   * este método manda en el `UPDATE` es un placeholder que el trigger reemplaza antes de que la
   * fila se escriba; `RETURNING` es lo único confiable para saber qué quedó guardado. Pisa un
   * código anterior sin usar, si lo había: no hace falta invalidar dos veces, un `update` nuevo ya
   * reemplaza el viejo.
   */
  async generarCodigoTelegram(ctx: TenantContext): Promise<CodigoTelegram> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ telegram_link_code: string; telegram_link_code_expira: string }>(
        `update memberships
         set telegram_link_code = gen_random_uuid()::text, telegram_link_code_expira = now()
         where user_id = $1
         returning telegram_link_code, telegram_link_code_expira`,
        [ctx.userId ?? ""],
      );
      const fila = rows[0];
      if (!fila) throw new Error("No se encontró la membresía para generar el código de Telegram.");
      return { codigo: fila.telegram_link_code, expira: fila.telegram_link_code_expira };
    });
  }

  /** `true` si la propia fila tiene `telegram_chat_id` puesto. */
  async telegramVinculado(ctx: TenantContext): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ telegram_vinculado: boolean }>(
        `select telegram_vinculado from membresias_perfil where user_id = $1`,
        [ctx.userId ?? ""],
      );
      return rows[0]?.telegram_vinculado ?? false;
    });
  }

  /** Vía `app.desvincular_telegram_propio` (0026) -- `false` si no había nada vinculado. */
  async desvincularTelegram(ctx: TenantContext): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ desvincular_telegram_propio: boolean }>(
        `select app.desvincular_telegram_propio() as desvincular_telegram_propio`,
      );
      return rows[0]?.desvincular_telegram_propio ?? false;
    });
  }
  ```

  Nota: el `update ... where user_id = $1` sin coincidencias (usuario sin membresía real) daría
  `rows.length === 0` — no debería pasar nunca en
  la práctica: `ctx.userId` viene de un JWT ya autenticado con una membresía real, pero no cuesta
  nada que el método lo constate en vez de asumirlo).

- [ ] **Step 9: Tests de `membresias.test.ts`**

  Mirar el molde ya existente en el archivo (`cambiarRol`, la fuga cross-tenant verificada por
  mutación). Casos:
  - `generarCodigoTelegram` dos veces seguidas: el segundo código reemplaza al primero (el primero ya
    no sirve — probarlo intentando `app.vincular_telegram` con el código viejo directamente por SQL
    en el test, y confirmando que da `false`).
  - `telegramVinculado` da `false` antes de vincular, `true` después de que un `UPDATE` directo (en
    el test, simulando lo que haría `app.vincular_telegram`) le ponga `telegram_chat_id`.
  - `desvincularTelegram` da `true` la primera vez, `false` la segunda (no había nada que desvincular
    ya).
  - **El caso central de este plan**: sembrar dos miembros del mismo tenant, uno `equipo` (no
    maestro). Con la sesión del `equipo`, armar una sentencia SQL directa (fuera de los métodos de
    `PgMembresias`, para simular "alguien que no pasó por TypeScript") que intente
    `update memberships set rol = 'maestro', telegram_link_code = 'x' where user_id = <su propio
    user_id>` — tiene que LANZAR con el mensaje del trigger (`membresias_guardia_telegram`), no
    completarse en silencio. Este es el guardrail que justifica el trigger — verificarlo por
    mutación: comentar el trigger (o su `create trigger`) y confirmar que esa misma sentencia SÍ se
    completa (el `equipo` se autopromueve a maestro combinando la columna de Telegram). Volver a
    crear el trigger antes de seguir.
  - **El código lo genera Postgres, no el caller** (hallazgo 3): con la sesión de un `app_user`
    cualquiera, armar un `UPDATE` directo (fuera de `generarCodigoTelegram`) que intente
    `set telegram_link_code = 'codigo-elegido-a-mano', telegram_link_code_expira = now() + interval
    '10 years'` sobre la propia fila. Confirmar, leyendo la fila después, que **NINGUNO** de los dos
    valores quedó como se pidió: el trigger los reemplazó por un `gen_random_uuid()` y un
    vencimiento de 10 minutos. Verificar por mutación: comentar el bloque del trigger que fuerza
    estos dos valores (dejando solo el guardia de rol) y confirmar que este test cae —el código
    elegido a mano SÍ queda guardado tal cual.

- [ ] **Step 10: `db/src/store.ts` — el lado del orquestador**

  Cerca de `clientesConectadosGoogle`/`guardarBorradorResena`. Extender `ClienteConectadoGoogle` con
  `nombre: string` — el `select` de `clientesConectadosGoogle()` no cambia (sigue siendo
  `select * from app.clientes_conectados_google()`), porque la migración (Step 6) ya recreó la
  función SQL con la columna nueva.

  ```typescript
  export interface ResenaPendienteAlerta {
    googleReviewId: string;
    tenantId: string;
    puntuacion: number;
    autor: string;
    texto: string | null;
  }

  async telegramDelAsignado(clientId: string): Promise<string | null> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ telegram_del_asignado: string | null }>(
        "select app.telegram_del_asignado($1) as telegram_del_asignado",
        [clientId],
      );
      return rows[0]?.telegram_del_asignado ?? null;
    });
  }

  async vincularTelegramPorCodigo(codigo: string, chatId: string): Promise<boolean> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ vincular_telegram: boolean }>(
        "select app.vincular_telegram($1, $2) as vincular_telegram",
        [codigo, chatId],
      );
      return rows[0]?.vincular_telegram ?? false;
    });
  }

  async offsetTelegramActual(): Promise<number> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ ultimo_update_id: string }>(
        "select ultimo_update_id from app.telegram_polling_estado",
      );
      return Number(rows[0]?.ultimo_update_id ?? 0);
    });
  }

  async avanzarOffsetTelegram(nuevoOffset: number): Promise<void> {
    return this.sinTenant(async (tx) => {
      await tx.query("update app.telegram_polling_estado set ultimo_update_id = $1", [nuevoOffset]);
    });
  }

  /** Reseñas 1-3★ de un cliente sin alerta de Telegram confirmada -- incluye ciclos anteriores. */
  async resenasPendientesAlertaTelegram(clientId: string): Promise<ResenaPendienteAlerta[]> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{
        google_review_id: string; tenant_id: string; puntuacion: number; autor: string; texto: string | null;
      }>("select * from app.resenas_pendientes_alerta_telegram($1)", [clientId]);
      return rows.map((r) => ({
        googleReviewId: r.google_review_id, tenantId: r.tenant_id,
        puntuacion: r.puntuacion, autor: r.autor, texto: r.texto,
      }));
    });
  }

  async marcarAlertaTelegramEnviada(r: { clientId: string; tenantId: string; googleReviewId: string }): Promise<boolean> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ marcar_alerta_telegram_enviada: boolean }>(
        "select app.marcar_alerta_telegram_enviada($1, $2, $3) as marcar_alerta_telegram_enviada",
        [r.clientId, r.tenantId, r.googleReviewId],
      );
      return rows[0]?.marcar_alerta_telegram_enviada ?? false;
    });
  }
  ```

- [ ] **Step 11: Tests de `store.test.ts`**

  Mismo molde que los tests de `guardarBorradorResena`/`clientesConectadosGoogle`. Casos:
  - `telegramDelAsignado` devuelve el chat_id correcto para un cliente con CM asignado y vinculado;
    `null` si el CM no vinculó Telegram; `null` si el cliente no tiene `asignado_a`.
  - `vincularTelegramPorCodigo` con código válido y no vencido: `true`, y una segunda llamada con el
    MISMO código: `false` (ya se consumió — el `update` lo puso en `null`).
  - `vincularTelegramPorCodigo` con código vencido (sembrar `telegram_link_code_expira` en el
    pasado): `false`.
  - `offsetTelegramActual`/`avanzarOffsetTelegram`: el offset persiste entre llamadas.
  - `resenasPendientesAlertaTelegram` devuelve una reseña 1-3★ sembrada SIN
    `alerta_telegram_enviada_en`, y NO devuelve una con esa columna puesta ni una de 4-5★.
  - `marcarAlertaTelegramEnviada` da `true` la primera vez, `false` la segunda (idempotencia — no
    reenvía la confirmación).
  - Un `PgStore` con rol `app_user` NO puede ejecutar ninguna de las cinco funciones nuevas de esta
    migración (42501) — mismo molde que los tests equivalentes de `resena_para_publicar`.
  - `clientesConectadosGoogle()` incluye `nombre` en cada fila.

- [ ] **Step 12: `api/src/app.ts` — los tres endpoints de `/me/telegram`**

  Cerca de los endpoints de conexión OAuth de Google (mismo espíritu: auto-servicio, sobre la propia
  identidad). Necesita `TELEGRAM_BOT_USERNAME` en `deps` (config pública, no secreta — el nombre de
  usuario del bot, ej. `AMGReviewsBot`, para armar el deep link).

  ```typescript
  /** POST /me/telegram/vincular — genera un código de un solo uso y arma el deep link de Telegram. */
  app.post("/me/telegram/vincular", async (c) => {
    const ctx = c.get("ctx");
    const { codigo } = await deps.membresias.generarCodigoTelegram(ctx);
    return c.json({ url: `https://t.me/${deps.telegramBotUsername}?start=${codigo}` });
  });

  /** GET /me/telegram — si la propia cuenta ya vinculó Telegram. */
  app.get("/me/telegram", async (c) => {
    const ctx = c.get("ctx");
    const vinculado = await deps.membresias.telegramVinculado(ctx);
    return c.json({ vinculado });
  });

  /** POST /me/telegram/desvincular — limpia la vinculación de la propia cuenta. */
  app.post("/me/telegram/desvincular", async (c) => {
    const ctx = c.get("ctx");
    const ok = await deps.membresias.desvincularTelegram(ctx);
    return c.json({ ok });
  });
  ```

  Los tres cuelgan de `ctx.userId` (identidad ya autenticada) — ninguno recibe un `:userId` de ruta,
  a propósito: no existe "vincular Telegram de otro", así que no hay nada que autorizar por rol acá
  (ADR-15 sigue intacto: no hay ningún `role` ni identidad ajena que este código decida).

  **Nota de interfaz**: `POST /me/telegram/desvincular` devuelve `{ ok: boolean }`, NO `{ ok: true }`
  fijo — el código de arriba ya lo hace bien (`c.json({ ok })`), pero decilo así en cualquier
  documentación que resuma el contrato: `false` es una respuesta válida (nada que desvincular), no
  un error.

  **`TELEGRAM_BOT_USERNAME` — decisión explícita (Codex review 2026-08-23, hallazgo 6): OBLIGATORIA
  al arrancar la API**, mismo criterio que `DATABASE_URL_RENDER` en el renderizador ("prefiero que
  no arranque a que arranque a medias y nadie lo note"). Sin ella, `/me/telegram/vincular`
  devolvería una URL rota (`t.me/undefined?start=...`) en silencio — el arranque tiene que fallar
  antes, no el endpoint en runtime. Cablear los CUATRO lugares a la vez (el propio arnés de tests
  del repo revienta si alguno queda desalineado — ya pasó una vez en este proyecto con
  `OPENAI_MODEL`):
  1. `api/.env.example`: agregar `TELEGRAM_BOT_USERNAME=` con un comentario (config pública, no
     secreta — el `@username` del bot, sin el `@`).
  2. `api/src/deps.ts` (`leerConfig()` o donde viva la lectura de entorno de la API — mirar el
     patrón exacto de `DATABASE_URL_RENDER` en `renderer/src/deps.ts` para el mensaje de error):
     agregar `TELEGRAM_BOT_USERNAME` a la lista de variables obligatorias, y `telegramBotUsername:
     string` a la interfaz `Deps` de `api/src/app.ts`.
  3. `scripts/env-sync.mts`: agregar `"TELEGRAM_BOT_USERNAME"` a `MAPA.api`.
  4. `scripts/credencial.mts`: agregar `TELEGRAM_BOT_USERNAME: { familia: "config", nota: "..." }`
     al `CATALOGO` (familia `config`, igual que `OPENAI_MODEL` — es público, no es un secreto).

- [ ] **Step 13: Tests de `app.test.ts`**

  Casos:
  - `POST /me/telegram/vincular` devuelve una URL con el formato esperado, y el código que contiene
    matchea lo que quedó en la base para ese usuario.
  - Pedir un código dos veces seguidas: el segundo `POST` invalida el primero (mismo test que
    Step 9, pero contra el endpoint HTTP).
  - `GET /me/telegram` da `{vinculado: false}` antes de vincular.
  - `POST /me/telegram/desvincular` da `{ok: false}` si no había nada que desvincular, `{ok: true}`
    si había.
  - `leerConfig()` (o como se llame) lanza si falta `TELEGRAM_BOT_USERNAME` — mismo molde que los
    tests existentes de variables obligatorias en `renderer`/`orchestrator`.

- [ ] **Step 14: Verificar y cerrar la tarea**

  `npm test -w db && npm test -w api`. Todo en verde. Escribir el resultado en
  `progress/informes/datos-alertas-telegram.md` y responder con una sola línea:
  `done -> progress/informes/datos-alertas-telegram.md`.

---

### Task 2 (agente `pipeline`): el provider de Telegram y las dos funciones de Inngest

**Depende de:** Task 1 completa (usa `PgStore.telegramDelAsignado`, `vincularTelegramPorCodigo`,
`offsetTelegramActual`, `avanzarOffsetTelegram`, `resenasPendientesAlertaTelegram`,
`marcarAlertaTelegramEnviada`, y el campo `nombre` de `ClienteConectadoGoogle`).

**Files:**
- Create: `orchestrator/src/telegram/provider.ts` (interfaz + selector mock/live)
- Create: `orchestrator/src/telegram/mock-provider.ts`
- Create: `orchestrator/src/telegram/live-provider.ts`
- Create: `orchestrator/src/telegram/provider.test.ts`, `live-provider.test.ts`
- Modify: `orchestrator/src/config.ts` (`TELEGRAM_MODO`, `TELEGRAM_BOT_TOKEN`)
- Modify: `orchestrator/src/functions.ts` (función de vinculación + hook de alerta en
  `pollearResenas`)
- Modify: `orchestrator/src/server.ts` (registrar la función nueva)
- Modify: `orchestrator/src/workflow.ts` (`Deps` gana `telegramProvider`)
- Modify: `orchestrator/.env.example`, `scripts/env-sync.mts`, `scripts/credencial.mts`
- Test: `orchestrator/src/functions.test.ts`, `orchestrator/src/config.test.ts`

**Interfaces:**
- Consume: los cuatro métodos de `PgStore` y el campo `nombre` de la Task 1.
- Produce: nada que otra task consuma.

**Paso a paso:**

- [ ] **Step 1: `orchestrator/src/telegram/provider.ts` — la interfaz y el selector**

  Mismo molde que `orchestrator/src/google/provider.ts` (leerlo primero).

  **Codex review 2026-08-23, hallazgo 1, confirmado releyendo la propia interfaz original:** el
  diseño anterior filtraba los updates sin texto ANTES de devolverlos, y calculaba el offset sobre
  la lista YA filtrada. Telegram exige confirmar (avanzar el offset más allá de) TODO update que
  llegó, tenga o no texto útil — si no, un lote con solo reacciones/ediciones/otros updates sin
  `message.text` deja el offset clavado, y Telegram vuelve a mandar el mismo lote (hasta 100
  updates) para siempre, bloqueando cualquier `/start` real que venga detrás. La interfaz separa
  las dos cosas: el `maxUpdateId` de TODO lo que llegó (para avanzar el offset) y los `mensajes`
  parseables (para actuar).

  ```typescript
  export interface MensajeTelegram {
    updateId: number;
    /** El texto completo del mensaje, tal como lo mandó la persona (ej. "/start abc123"). */
    texto: string;
    chatId: string;
  }

  export interface ResultadoActualizaciones {
    /** El mayor `update_id` visto en el lote, CONTANDO los updates sin texto útil. `null` si el
     *  lote vino vacío -- distinto de `0`, que sería un update_id real. */
    maxUpdateId: number | null;
    /** Solo los updates que son un mensaje de texto (potencialmente un "/start <código>"). */
    mensajes: MensajeTelegram[];
  }

  export interface TelegramProvider {
    /** Actualizaciones desde `offset` (mismo contrato que el `offset` real de Telegram). */
    obtenerActualizaciones(offset: number): Promise<ResultadoActualizaciones>;
    enviarMensaje(chatId: string, texto: string): Promise<void>;
  }

  export type ModoTelegram = "mock" | "live";

  export function getTelegramProvider(modo: ModoTelegram, botToken?: string): TelegramProvider {
    if (modo === "mock") return new MockTelegramProvider();
    if (!botToken) {
      throw new Error("TELEGRAM_MODO=live sin TELEGRAM_BOT_TOKEN.");
    }
    return new LiveTelegramProvider(botToken);
  }
  ```

  (Ajustar imports reales de `MockTelegramProvider`/`LiveTelegramProvider` según donde terminen
  viviendo — mismo patrón de import que `google/provider.ts` usa para su mock.)

- [ ] **Step 2: `mock-provider.ts` — determinista, sin red**

  ```typescript
  export class MockTelegramProvider implements TelegramProvider {
    async obtenerActualizaciones(_offset: number): Promise<ResultadoActualizaciones> {
      return { maxUpdateId: null, mensajes: [] };
    }
    async enviarMensaje(_chatId: string, _texto: string): Promise<void> {
      // Determinista: "envía" siempre con éxito, sin salir a internet.
    }
  }
  ```

- [ ] **Step 3: `live-provider.ts` — llamadas reales a la API de Telegram**

  Sin dependencias nuevas: `fetch` nativo. Timeouts explícitos (mismo criterio que
  `renderer/src/deps.ts` con el pool de Postgres: "esta consulta es puntual, si tarda algo está
  roto"). Sin reintento acá tampoco — lo decide la función de Inngest que lo llama (`retries: 0`).

  **Un `update_id` no numérico (o no entero seguro) hace fallar TODO el lote, sin excepción**
  (hallazgo 1 de Codex): no hay forma segura de "saltearlo y seguir" sin arriesgar perder o
  duplicar la confirmación de offset — es la clase de dato malformado que indicaría un cambio de la
  API de Telegram o algo peor, y este proyecto prefiere fallar ruidoso a corromper estado en
  silencio (mismo criterio que `app_render` con un `select *` que revienta en vez de filtrar en
  silencio). Un update SIN `message`/`text` (una reacción, una edición) es distinto: es una forma
  ESPERADA y documentada de la API, se ignora para `mensajes` pero SÍ cuenta para `maxUpdateId`.

  ```typescript
  const BASE = "https://api.telegram.org";
  const TIMEOUT_MS = 10_000;

  export class LiveTelegramProvider implements TelegramProvider {
    constructor(private readonly token: string) {}

    async obtenerActualizaciones(offset: number): Promise<ResultadoActualizaciones> {
      const url = `${BASE}/bot${this.token}/getUpdates?offset=${offset}&timeout=0`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`getUpdates: HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (
        typeof body !== "object" || body === null ||
        !("ok" in body) || (body as { ok: unknown }).ok !== true ||
        !("result" in body) || !Array.isArray((body as { result: unknown }).result)
      ) {
        throw new Error("getUpdates: respuesta con forma inesperada");
      }
      const resultado: unknown[] = (body as { result: unknown[] }).result;
      const mensajes: MensajeTelegram[] = [];
      let maxUpdateId: number | null = null;

      for (const u of resultado) {
        // No confiar en la forma sin chequearla -- mismo criterio que parsearEvento en
        // renderer/src/webhook.ts.
        if (typeof u !== "object" || u === null) {
          throw new Error("getUpdates: un update no es un objeto");
        }
        const updateId = (u as Record<string, unknown>)["update_id"];
        if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) {
          throw new Error("getUpdates: update_id no es un entero seguro");
        }
        // A partir de acá, un update sin forma de mensaje de texto se IGNORA (no lanza) -- es un
        // caso esperado (reacción, edición, update de otro tipo), no un dato corrupto. Pero su
        // update_id YA CUENTA para maxUpdateId, calculado ANTES de decidir si es un mensaje útil.
        maxUpdateId = maxUpdateId === null ? updateId : Math.max(maxUpdateId, updateId);

        const mensaje = (u as Record<string, unknown>)["message"];
        if (typeof mensaje !== "object" || mensaje === null) continue;
        const texto = (mensaje as Record<string, unknown>)["text"];
        const chat = (mensaje as Record<string, unknown>)["chat"];
        if (typeof texto !== "string" || typeof chat !== "object" || chat === null) continue;
        const chatId = (chat as Record<string, unknown>)["id"];
        if (
          (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) &&
          typeof chatId !== "string"
        ) continue;
        mensajes.push({ updateId, texto, chatId: String(chatId) });
      }
      return { maxUpdateId, mensajes };
    }

    async enviarMensaje(chatId: string, texto: string): Promise<void> {
      const url = `${BASE}/bot${this.token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: texto }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`sendMessage: HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (typeof body !== "object" || body === null || (body as { ok: unknown }).ok !== true) {
        // Telegram documenta que TODA respuesta trae `ok` -- un HTTP 200 con `ok: false` es un
        // fallo real (ej. chat_id inválido, bot bloqueado por esa persona), no un éxito.
        throw new Error("sendMessage: la API respondió ok:false");
      }
    }
  }
  ```

- [ ] **Step 4: Tests de `provider.test.ts` / `live-provider.test.ts`**

  `provider.test.ts`: `getTelegramProvider("mock")` devuelve el mock; `getTelegramProvider("live")`
  sin token lanza; con token devuelve un `LiveTelegramProvider` (comprobar con `instanceof`, sin
  llamar a ningún método — no salir a internet en un test).

  `live-provider.test.ts`: mockear `globalThis.fetch` (mismo criterio que ya use el resto del
  repo para tests HTTP — mirar si `kr-service` o `web-builder` ya tienen un patrón de fake-fetch
  antes de inventar uno nuevo). Casos:
  - `obtenerActualizaciones` con una respuesta real de ejemplo (dos updates, uno con `/start abc`,
    otro sin `message` — ej. un `edited_message`) devuelve `mensajes` con solo el que tiene texto,
    pero `maxUpdateId` es el MAYOR de los DOS `update_id`, incluido el del update sin texto.
  - 🔴 **El caso central del hallazgo 1**: un lote formado ÚNICAMENTE por updates sin texto (todas
    reacciones/ediciones) — `mensajes` da `[]`, pero `maxUpdateId` NO es `null`: es el mayor
    `update_id` del lote. Verificar por mutación: volver a calcular `maxUpdateId` solo sobre los
    updates que sí generan un `MensajeTelegram` (el bug original) y confirmar que este test cae.
  - Lote vacío (`result: []`): `maxUpdateId` es `null`, `mensajes` es `[]`.
  - Un `update_id` no numérico, o un número no entero (`1.5`) o inseguro: lanza — no lo ignora en
    silencio.
  - `obtenerActualizaciones` con `ok: false` en el body: lanza.
  - `obtenerActualizaciones` con HTTP no-200: lanza.
  - `enviarMensaje` manda el `chat_id`/`text` correctos en el body, y el header `content-type`.
  - `enviarMensaje` con HTTP no-200: lanza.
  - `enviarMensaje` con HTTP 200 pero `{ok: false}` en el body: lanza (no lo trata como éxito).
  - `chat.id` como string arbitrario no numérico en `obtenerActualizaciones` (ej. `"hola"`): se
    ignora ese mensaje puntual (no rompe el lote — a diferencia de `update_id`, Telegram documenta
    `chat.id` como entero pero este código ya acepta string por si acaso; un string que ni siquiera
    parece un id no debería colarse como si fuera válido — decidir si vale la pena validar el
    formato numérico del string también, o dejarlo pasar; documentar la elección).

- [ ] **Step 5: `orchestrator/src/config.ts` — `TELEGRAM_MODO`**

  Mirar cómo `leerConfig()` ya resuelve `GOOGLE_REVIEWS_MODO`/`BORRADOR_RESENAS_MODO` y seguir EL
  MISMO criterio exacto (default explícito a `"mock"`, `"live"` exige `TELEGRAM_BOT_TOKEN` presente
  o falla igual que la falta de credenciales ya falla para los otros modos — replicar la forma, no
  inventar una nueva). `Deps` (en `workflow.ts`) gana `telegramProvider: TelegramProvider`.

- [ ] **Step 6: `orchestrator/.env.example` + `scripts/env-sync.mts` + `scripts/credencial.mts`**

  `TELEGRAM_BOT_TOKEN` (familia `secreto`, igual que `STORYBLOK_WEBHOOK_SECRET`) y `TELEGRAM_MODO`
  (familia `config`, igual que `OPENAI_MODEL`) en `MAPA.orchestrator`. **No olvidar los tres
  archivos a la vez** — el propio arnés de tests (`scripts/env-sync.test.mts`/`credencial.test.mts`)
  revienta si alguno queda desalineado, ya pasó en una tarea anterior de este mismo proyecto.

- [ ] **Step 7: `orchestrator/src/functions.ts` — vincular pendientes**

  Cerca de `pollearResenas`. Parsea `/start <código>` con una regex simple; ignora cualquier otro
  texto (el bot puede recibir cualquier cosa, no solo el comando esperado). **Actualizado para el
  contrato `ResultadoActualizaciones` del Step 1** (hallazgo 1 de Codex): el offset avanza con
  `maxUpdateId` SIEMPRE que no sea `null`, sin importar si hubo o no un `/start` real en el lote.

  ```typescript
  const PATRON_START = /^\/start\s+([a-f0-9-]+)$/;

  export async function vincularTelegramPendientes(
    deps: Pick<Deps, "store" | "telegramProvider">,
    log: (msg: string) => void = () => {},
  ): Promise<{ vinculados: number }> {
    const offset = await deps.store.offsetTelegramActual();
    const { maxUpdateId, mensajes } = await deps.telegramProvider.obtenerActualizaciones(offset);
    let vinculados = 0;

    for (const m of mensajes) {
      const match = PATRON_START.exec(m.texto.trim());
      if (!match) continue;
      const codigo = match[1] as string;
      const ok = await deps.store.vincularTelegramPorCodigo(codigo, m.chatId);
      if (ok) vinculados++;
      else log(`[telegram] código sin match (vencido, ya usado, o inexistente): ${codigo}`);
    }

    // Avanza con maxUpdateId, NO con el update_id del último mensaje ÚTIL: un lote de solo
    // reacciones/ediciones (sin ningún /start) todavía tiene que confirmar esos update_id, o
    // Telegram los vuelve a mandar para siempre (hallazgo 1 de Codex, 2026-08-23).
    if (maxUpdateId !== null) {
      await deps.store.avanzarOffsetTelegram(maxUpdateId + 1);
    }
    return { vinculados };
  }

  export function crearFuncionVincularTelegram(deps: Deps) {
    return inngest.createFunction(
      { id: "vincular-telegram", concurrency: [{ limit: 1 }], retries: 0 },
      { cron: "* * * * *" }, // cada minuto -- vincular la cuenta es de una sola vez, no hace
                              // falta la misma cadencia que el polling de reseñas (30 min)
      async ({ step }) => step.run("vincular", () => vincularTelegramPendientes(deps, console.log)),
    );
  }
  ```

  **Ojo con el offset si `obtenerActualizaciones` lanza a mitad de lote**: con la forma de arriba,
  si el `fetch` de `getUpdates` falla (o si un `update_id` viene malformado, Step 3), ni siquiera
  hay `{ maxUpdateId, mensajes }` que procesar (el `await` revienta antes) — no hay riesgo de
  avanzar el offset sin haber confirmado nada. Si en cambio `vincularTelegramPorCodigo` lanzara a
  mitad del `for` (no debería: solo hace un `update`), el offset NO se habría avanzado todavía (es
  lo último) — el próximo ciclo reprocesaría ese lote entero, lo cual es CORRECTO
  (`vincularTelegramPorCodigo` es idempotente por diseño: un código ya vinculado da `false` la
  segunda vez, no un error).

- [ ] **Step 8: `pollearResenas` — la alerta con retry automático (decisión de Juan, hallazgo 4 de
  Codex)**

  **Rediseñado respecto del plan original**: el hook NO vive adentro del `for (const r of crudas)`
  (eso solo dispararía para reseñas nuevas de ESTE ciclo, y una alerta que fallara se perdería para
  siempre — el hallazgo que motivó este cambio). Es un paso INDEPENDIENTE, una vez por cliente, DESPUÉS
  de procesar `crudas` para ese cliente — usa `resenasPendientesAlertaTelegram`, que trae CUALQUIER
  reseña 1-3★ del cliente sin alerta confirmada, sea de este ciclo o de uno anterior que falló.

  El límite de 4096 caracteres de `sendMessage` (hallazgo 4 de Codex): el texto de una reseña puede
  ser arbitrariamente largo, así que se trunca de forma determinista con margen de sobra para el
  resto del mensaje (autor, cliente, puntuación).

  ```typescript
  const LARGO_MAXIMO_TEXTO_RESENA = 3500; // deja margen para el resto del mensaje bajo 4096

  function truncar(texto: string, maximo: number): string {
    return texto.length > maximo ? `${texto.slice(0, maximo)}…` : texto;
  }

  /** Dentro del `for (const cliente of clientes)` existente, DESPUÉS de procesar `crudas`: */
  try {
    const pendientes = await deps.store.resenasPendientesAlertaTelegram(cliente.clientId);
    if (pendientes.length > 0) {
      const chatId = await deps.store.telegramDelAsignado(cliente.clientId);
      if (chatId) {
        for (const p of pendientes) {
          try {
            const texto =
              `⭐ ${p.puntuacion} reseña nueva de ${p.autor} en ${cliente.nombre}` +
              (p.texto ? `:\n"${truncar(p.texto, LARGO_MAXIMO_TEXTO_RESENA)}"` : " (sin comentario)");
            await deps.telegramProvider.enviarMensaje(chatId, texto);
            await deps.store.marcarAlertaTelegramEnviada({
              clientId: cliente.clientId, tenantId: cliente.tenantId, googleReviewId: p.googleReviewId,
            });
          } catch (e) {
            // Un fallo en UNA reseña no impide intentar las demás pendientes del mismo cliente en
            // esta corrida -- y, si igual falla, alerta_telegram_enviada_en queda en NULL: el
            // PRÓXIMO ciclo (30 min) la vuelve a intentar sola, sin cola ni botón.
            log(
              `[alerta-telegram] reseña ${p.googleReviewId} (cliente ${cliente.clientId}) falló: ${(e as Error).message}`,
            );
          }
        }
      }
    }
  } catch (e) {
    // Un fallo buscando las pendientes (ej. store caído) no debe frenar el resto del polling de
    // este cliente -- mismo criterio que el resto de la función.
    log(`[alerta-telegram] cliente ${cliente.clientId}: no se pudo resolver pendientes: ${(e as Error).message}`);
  }
  ```

  `Pick<Deps, "store" | "resenasProvider" | "borradorProvider">` de la firma de `pollearResenas`
  gana `"telegramProvider"`.

- [ ] **Step 9: Tests de `functions.test.ts`**

  Para `vincularTelegramPendientes` (mismo molde de dobles estructurales que `pollearResenas`):
  - Una actualización con `/start <código>` válido: llama a `vincularTelegramPorCodigo` con el
    código correcto, avanza el offset al `update_id + 1`.
  - Una actualización con texto que no matchea el patrón (`"hola"`, `/start` sin código): NO llama a
    `vincularTelegramPorCodigo`, pero SÍ avanza el offset (el mensaje se descarta, no se
    reprocesa para siempre).
  - Sin actualizaciones nuevas: no llama a `avanzarOffsetTelegram` (evita una escritura de más en
    cada ciclo sin novedades).
  - Dos actualizaciones en el mismo lote: el offset avanza al MAYOR `update_id + 1`, no al último
    del array (si llegaran desordenados).

  Para el bloque de alerta de `pollearResenas` (rediseñado, Step 8 — decisión de Juan tras el
  hallazgo 4 de Codex: retry automático, no best-effort perdido):
  - `resenasPendientesAlertaTelegram` devuelve una pendiente, CM asignado con Telegram vinculado:
    llama a `enviarMensaje` con el `chatId` correcto y un texto que incluye la puntuación, el autor
    y el nombre del cliente; después llama a `marcarAlertaTelegramEnviada` con los tres campos
    correctos.
  - `resenasPendientesAlertaTelegram` devuelve `[]` (nada pendiente): NO llama a
    `telegramDelAsignado` en absoluto — evita un lookup de más cuando no hay nada que mandar.
  - Hay pendientes, pero `telegramDelAsignado` da `null` (sin asignado o sin vincular): NO llama a
    `enviarMensaje` ni a `marcarAlertaTelegramEnviada`.
  - 🔴 **El caso central del hallazgo 4**: `enviarMensaje` lanza (Telegram caído) — el test confirma
    que `marcarAlertaTelegramEnviada` NUNCA se llama para esa reseña (si se llamara, la próxima
    corrida ya no la reintentaría, que es exactamente el bug que motivó el rediseño). El polling NO
    aborta: si hay una segunda pendiente en el mismo lote, también se intenta.
  - Dos clientes en la misma corrida, uno con `resenasPendientesAlertaTelegram` que lanza (ej. error
    de red del store): el otro cliente se sigue procesando igual (el `catch` externo del bloque
    nuevo, no el de todo el cliente).
  - Un texto de reseña de más de 3500 caracteres: el mensaje que llega a `enviarMensaje` queda
    truncado (verificar el largo exacto y el `…` final).

  Verificar por mutación: comentar el `if (chatId)` (o invertirlo) y confirmar que el test "sin CM
  vinculado, no llama a enviarMensaje" cae. Comentar el `try/catch` interno del `for` de pendientes
  y confirmar que el test "un fallo no impide intentar la siguiente pendiente" cae.

- [ ] **Step 10: `orchestrator/src/server.ts` — registrar la función**

  Importar y agregar `crearFuncionVincularTelegram(deps)` al array `funciones`. Actualizar el test
  de conteo de funciones (`config.test.ts`, el mismo que la Task 2 de "publicar respuesta" ya
  extendió de 3 a 4) de 4 a 5.

- [ ] **Step 11: Verificar y cerrar la tarea**

  `npm test -w orchestrator`. Todo en verde. Escribir el resultado en
  `progress/informes/pipeline-alertas-telegram.md` y responder con una sola línea:
  `done -> progress/informes/pipeline-alertas-telegram.md`.

---

### Task 3 (agente `front`): "Vincular Telegram" en el perfil del usuario

**Depende de:** Task 1 completa (usa `POST /me/telegram/vincular`, `GET /me/telegram`,
`POST /me/telegram/desvincular`). No depende de la Task 2 para la UI en sí, pero SÍ para probar el
ciclo real de punta a punta en el navegador (necesita que el orquestador esté procesando
`/start <código>` de verdad, aunque sea contra el mock).

**Files:**
- Modify: `portal/src/app/core/api-core.ts` (tres métodos nuevos)
- Modify: `portal/src/app/services/api.ts` (reexportar, mismo patrón que la tarea anterior)
- Modify: `portal/src/app/pages/usuarios/usuario-perfil.ts` (tarjeta nueva)
- Test: `portal/src/app/pages/usuarios/usuario-perfil.spec.ts`

**Interfaces:**
- Consume: los tres endpoints de `/me/telegram` (Task 1).
- Produce: nada (hoja de la cadena).

**Paso a paso:**

- [ ] **Step 1: `api-core.ts` — los tres métodos**

  Mismo molde que `conectarGoogle`/`desconectarGoogle`.

  ```typescript
  vincularTelegram(): Promise<{ url: string }>;
  telegramVinculado(): Promise<{ vinculado: boolean }>;
  desvincularTelegram(): Promise<{ ok: boolean }>;
  ```

  Implementación: `pedir('POST', '/me/telegram/vincular')`, `pedir('GET', '/me/telegram')`,
  `pedir('POST', '/me/telegram/desvincular')` — sin `clientId` de por medio, a diferencia de
  `conectarGoogle`, porque esto es sobre LA PROPIA cuenta, no sobre un cliente.

- [ ] **Step 2: reexportar en `services/api.ts`**

  Mismo criterio que la Task 3 de "publicar respuesta" (el reexport de `publicarRespuestaResena`)
  — sin esto el componente no compila.

- [ ] **Step 3: `usuario-perfil.ts` — la tarjeta, SOLO cuando `esPropio()`**

  Nadie puede vincular el Telegram de otra persona — a diferencia de "Cambiar el rol" (que ve un
  `maestro` sobre CUALQUIER fila), esta tarjeta va condicionada a `esPropio()`, el mismo `computed`
  que ya existe en el componente. Tres estados:

  1. Cargando el estado (`GET /me/telegram` en `ngOnInit`, solo si `esPropio()`).
  2. Vinculado (`vinculado: true`): texto "Telegram vinculado." + botón "Desvincular".
  3. No vinculado: botón "Vincular Telegram" → `POST /me/telegram/vincular` → abre el `url` devuelto
     en una pestaña nueva (`window.open(url, '_blank')`, NO `window.location.href` como hace
     `conectar()` de reseñas — acá no hay callback que traiga de vuelta a esta misma pestaña, así
     que navegar afuera del todo dejaría al usuario sin volver al portal) y muestra un mensaje
     ("Abrí el link, apretá Start en Telegram, y volvé a cargar esta página para confirmar" — no hay
     forma de saber en tiempo real cuándo el orquestador procesó el `/start`, mismo límite que ya
     documentó la Task 3 anterior para "Publicada el ...").

  Agregar un signal `telegramVinculado = signal(false)` y `cargandoTelegram = signal(true)`,
  poblados en `ngOnInit` solo si `esPropio()` termina siendo verdadero (evitar el `GET` si se está
  mirando el perfil de otra persona).

- [ ] **Step 4: Tests de `usuario-perfil.spec.ts`**

  Mirar el molde existente de este spec (cómo arma el doble de `ApiService`, cómo simula
  `esPropio`). Casos:
  - Viendo el PROPIO perfil, sin vincular: se ve el botón "Vincular Telegram"; al hacer click, llama
    a `vincularTelegram()` y abre una pestaña con la URL devuelta (espiar `window.open`).
  - Viendo el PROPIO perfil, vinculado: se ve "Telegram vinculado." y el botón "Desvincular"; al
    hacer click, llama a `desvincularTelegram()` y el estado local pasa a "no vinculado" sin
    recargar.
  - Viendo el perfil de OTRA persona (`esPropio() === false`): la tarjeta de Telegram NO aparece en
    absoluto, y NO se llama a `GET /me/telegram` (comprobar que el spy nunca se invocó).

- [ ] **Step 5: Verificar en el navegador**

  Con las Tasks 1 y 2 integradas, en modo `TELEGRAM_MODO=mock`: el botón "Vincular Telegram" no va a
  completar el ciclo real (el mock nunca "recibe" un `/start` de verdad) — documentar en el informe
  que la verificación de punta a punta de ESTE flujo específico necesita `TELEGRAM_MODO=live` con un
  bot y un `chat_id` reales (que Juan tiene que crear primero, fuera del alcance de esta tarea). Sí
  verificar en el navegador: los tres estados de la tarjeta con datos servidos por el mock de la API
  (`GET /me/telegram` mockeado a mano si hace falta, mismo criterio que otras verificaciones de este
  proyecto cuando el circuito completo depende de una credencial que no existe todavía), consola
  limpia, los dos temas, y que la tarjeta NO aparece en el perfil de otra persona.

- [ ] **Step 6: Verificar y cerrar la tarea**

  `npm --prefix portal run test:components`. Todo en verde. Escribir el resultado en
  `progress/informes/front-alertas-telegram.md` y responder con una sola línea:
  `done -> progress/informes/front-alertas-telegram.md`.

---

## Cierre (sesión principal, no un agente)

1. `revisor` sobre el diff completo de las tres tareas juntas — CHECKPOINTS.md contra el diff real,
   con atención particular al trigger `membresias_guardia_telegram` (las dos guardias: rol/client_id
   y el código/TTL forzados) y a que el retry automático de la alerta (Step 8, Task 2) de verdad
   deje `alerta_telegram_enviada_en` en NULL cuando falla.
2. `npm run verificar` desde la raíz, output a la vista.
3. Documentar en `docs/proyecto/15-plan-plataforma.md` § Bloque F (esto cierra RF-018 del PRD —
   decirlo explícitamente), `docs/proyecto/09-estado-y-roadmap.md` (Tests, resumen ejecutivo,
   ADR nuevo si corresponde uno para el patrón de "dos políticas UPDATE permisivas + trigger
   backstop" — evaluar si esto merece un ADR propio, dado que es un patrón que otras tablas
   multi-escritor podrían necesitar repetir), `progress/history.md` y `progress/current.md`.
4. Commit + push a `main`. **La migración `0026` queda pendiente de desplegar a producción** —
   avisar a Juan, mismo procedimiento manual que la `0024`/`0025`.
5. Avisar a Juan que, para que esto funcione de verdad, falta: crear el bot con `@BotFather`, poner
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` en `docs/private/credenciales.env`, correr
   `env:sync`, y poner `TELEGRAM_MODO=live` en producción (Railway, el servicio del orquestador).
