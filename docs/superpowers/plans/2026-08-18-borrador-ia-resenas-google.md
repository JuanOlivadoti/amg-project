# Borrador de respuesta con IA (Bloque F, fase 2 — primera pieza) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar automáticamente, durante el polling de reseñas ya existente, un borrador de
respuesta con IA (OpenAI) para reseñas nuevas de 4-5★, editable por el staff desde el portal — sin
publicar nada de vuelta a Google (eso es la pieza siguiente).

**Architecture:** Sin paquete nuevo. `db/` gana dos columnas en `resenas_google` y una tercera función
`security definer` (mismo molde que `app.registrar_resena_google`, 0022) que el orquestador usa para
escribir el borrador cruzando tenants, con un filtro de elegibilidad (4-5★, sin borrador previo)
impuesto en el `WHERE`, no en el código que la llama. `orchestrator/` gana un `BorradorProvider`
mock/OpenAI (mismo molde que `GoogleReviewsProvider`) y lo cablea dentro de `pollearResenas`. `api/`
extiende el PATCH de reseñas ya existente para aceptar una segunda forma fija. `portal/` gana el
textarea editable en el tab `/clientes/:id/resenas`, gateado por rol.

**Tech Stack:** PostgreSQL (PGlite en tests), Hono (`api/`), Inngest (`orchestrator/`), paquete
`openai` (nuevo en `orchestrator/`, ya usado en `web-builder/`), Angular 20 standalone + signals
(`portal/`), `node:test` + `node:assert` en todo el backend, Karma en el portal.

## Global Constraints

- **Spec de referencia**, todo lo de abajo lo desarrolla:
  [`docs/superpowers/specs/2026-08-18-borrador-ia-resenas-google-design.md`](../specs/2026-08-18-borrador-ia-resenas-google-design.md) —
  ya revisada por Codex y ajustada (8 hallazgos aplicados). Léela antes de empezar cualquier task.
- **Solo el borrador, editable.** Ningún task de este plan publica nada de vuelta a Google, agrega un
  botón "Regenerar", agrega WhatsApp/email, ni pide acceso real a la Business Profile API
  (`GOOGLE_REVIEWS_MODO` no cambia).
- **Nunca borrador de IA para 1-3★.** Ni generado, ni siquiera intentado — el PRD exige respuesta
  humana siempre para esas.
- **La función `app.guardar_borrador_resena` filtra en el `WHERE`**: `puntuacion between 4 and 5 and
  borrador_respuesta is null`. No es responsabilidad del código TypeScript que la llama — es una
  constraint que Postgres impone, no una promesa de un comentario.
- **Sin tope de gasto ni preflight.** Solo se loguea el costo estimado por llamada a OpenAI.
- **El mock lleva el prefijo `"[BORRADOR MOCK — no generado por IA]"`**, siempre, para que nunca se
  confunda con un borrador real de OpenAI.
- **`Tx`/transacción con conexión reservada** para todo acceso a la base (ADR-13) — ningún `query()`
  suelto.
- **Nombres de dominio en español** (`borrador_respuesta`, `borrador_generado_en`), como el resto del
  esquema.
- Migración siguiente libre: **`0024`** (confirmado: la última es `0023_menu_enriquecido.sql`).
- **El textarea/botón Guardar del portal son solo para `membresia.esEquipo()`.** El rol `cliente` ve
  el borrador de solo lectura si existe, nunca un control editable.

---

### Task 1: Migración `0024` — columnas + `app.guardar_borrador_resena` + `PgStore.guardarBorradorResena`

**Files:**
- Create: `db/migrations/0024_borrador_resenas_ia.sql`
- Modify: `db/src/store.ts` (nuevo tipo `BorradorParaGuardar` + método `PgStore.guardarBorradorResena`)
- Modify: `db/src/store.test.ts` (tests)
- Modify: `db/src/index.ts` (exportar `BorradorParaGuardar`)

**Interfaces:**
- Consumes: rol `app_resenas` y sus grants/policies de `INSERT`/`SELECT` (migración `0022`), tabla
  `resenas_google` (migración `0021`), `PgStore.sinTenant` (`db/src/store.ts:1031`).
- Produces: columnas `resenas_google.borrador_respuesta` (`text`, nullable) y
  `resenas_google.borrador_generado_en` (`timestamptz`, nullable); función
  `app.guardar_borrador_resena(p_client_id uuid, p_tenant_id uuid, p_google_review_id text, p_borrador
  text) returns boolean`; `PgStore.guardarBorradorResena(r: BorradorParaGuardar): Promise<boolean>`.
  **Task 4 (orchestrator) consume esto.**

- [ ] **Step 1: Escribir la migración `0024`**

```sql
-- =============================================================================
-- AMG OS — 0024: borrador de respuesta con IA para reseñas de Google
-- (Bloque F, fase 2, primera pieza)
--
-- Dos columnas nuevas en `resenas_google` y una tercera función `security definer`, propiedad de
-- `app_resenas` (0022), que es quien las escribe desde el polling. Mismo molde exacto que
-- `app.registrar_resena_google` -- ver el comentario largo de la 0022 para el porqué del baile de
-- dueño.
--
-- El `where` de la función lleva `puntuacion between 4 and 5 and borrador_respuesta is null`, y no
-- es cosmético (hallazgo de la revisión externa de diseño, ver la spec): sin esas dos condiciones,
-- cualquier llamador con `execute` (hoy solo `app_service`, vía el orquestador) podría sobrescribir
-- una edición del staff ya guardada, o escribir un borrador de IA sobre una reseña de 1-3* que el
-- PRD prohíbe tocar con IA. La condición la impone Postgres, no la disciplina del llamador.
--
-- Spec: docs/superpowers/specs/2026-08-18-borrador-ia-resenas-google-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Las dos columnas. `borrador_respuesta` es NULL hasta que se genera (o si la generación falló).
-- `borrador_generado_en` es CUÁNDO se generó -- no cuándo se editó por última vez: la fila no
-- distingue "generado por IA intacto" de "editado por el staff", porque ninguna regla de producto
-- depende hoy de esa distinción.
-- -----------------------------------------------------------------------------
alter table resenas_google
  add column if not exists borrador_respuesta   text,
  add column if not exists borrador_generado_en timestamptz;

comment on column resenas_google.borrador_respuesta is
  'Borrador de respuesta: generado por IA (4-5 estrellas unicamente) o escrito a mano por el staff. '
  'NULL = todavia no hay borrador. Nunca se genera con IA para 1-3 estrellas -- el PRD exige '
  'respuesta humana siempre para esas.';
comment on column resenas_google.borrador_generado_en is
  'Cuando se genero el borrador por ultima vez via IA. NULL si nunca se genero (p. ej. si el staff '
  'lo escribio a mano sobre una reseña cuya generacion habia fallado).';

-- -----------------------------------------------------------------------------
-- Grant de columna para `app_user`, aditivo sobre el `grant update (vista_en)` de la 0021 -- no hace
-- falta revocar ni reotorgar ese (verificado: los privilegios de columna de un mismo rol/tabla se
-- ACUMULAN). La política `resena_marcar_vista` (0021) ya exige `app.puede_escribir()` en su
-- `using`/`with check`; RLS es por fila, no por columna, así que la misma política gobierna también
-- este UPDATE sin necesitar una policy nueva.
-- -----------------------------------------------------------------------------
grant update (borrador_respuesta) on resenas_google to app_user;

-- -----------------------------------------------------------------------------
-- `app_resenas` (0022) gana UPDATE de estas dos columnas + una policy nueva -- hoy solo tenía
-- INSERT y SELECT. El aislamiento NO lo da esta policy (no hay contexto de tenant que mirar, mismo
-- motivo que las de 0022): lo da el `where` de la función de más abajo, que es la superficie real.
-- -----------------------------------------------------------------------------
grant update (borrador_respuesta, borrador_generado_en) on resenas_google to app_resenas;

create policy resena_actualizar_borrador_app_resenas on resenas_google
  for update to app_resenas
  using (true) with check (true);

-- -----------------------------------------------------------------------------
-- La función. Identifica la fila por (client_id, tenant_id, google_review_id) -- la misma clave
-- natural que ya usa `registrar_resena_google` -- para no tener que hacer viajar el `id` interno
-- desde el insert hasta el punto donde se genera el borrador.
-- -----------------------------------------------------------------------------
create or replace function app.guardar_borrador_resena(
  p_client_id        uuid,
  p_tenant_id        uuid,
  p_google_review_id text,
  p_borrador         text
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
    set borrador_respuesta = p_borrador, borrador_generado_en = now()
    where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
      and puntuacion between 4 and 5
      and borrador_respuesta is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

comment on function app.guardar_borrador_resena is
  'Escribe el borrador de IA de una reseña 4-5 estrellas que todavia no tiene uno. No pisa un '
  'borrador existente (de IA o editado por el staff) ni escribe sobre una reseña de 1-3 estrellas: '
  'las dos condiciones van en el WHERE, no en el llamador. security definer, propiedad de app_resenas.';

-- -----------------------------------------------------------------------------
-- El cambio de dueño, idéntico a 0022: dos permisos temporales, revocados al final, en ese orden.
-- -----------------------------------------------------------------------------
grant app_resenas to current_user;
grant create on schema app to app_resenas;

alter function app.guardar_borrador_resena(uuid, uuid, text, text) owner to app_resenas;

revoke execute on function app.guardar_borrador_resena(uuid, uuid, text, text) from public;
grant execute on function app.guardar_borrador_resena(uuid, uuid, text, text) to app_service;

revoke create on schema app from app_resenas;
revoke app_resenas from current_user;
```

- [ ] **Step 2: Confirmar que la migración aplica sin error**

Run: `npm test -w db`
Expected: verde entero (la suite de `db` aplica todas las migraciones al arrancar cada test file vía
`aplicarMigraciones`; un error de sintaxis SQL rompe TODO el archivo, no solo un test nuevo).

- [ ] **Step 3: Agregar `BorradorParaGuardar` y `guardarBorradorResena` a `db/src/store.ts`**

Justo después de la interfaz `ResenaParaGuardar` (`db/src/store.ts:415-424`), agregar:

```ts
/** Lo que hace falta para guardar un borrador de respuesta vía `app.guardar_borrador_resena()` (0024). */
export interface BorradorParaGuardar {
  clientId: string;
  tenantId: string;
  googleReviewId: string;
  borrador: string;
}
```

Justo después del método `registrarResenaGoogle` (`db/src/store.ts:993-1001`), dentro de la clase
`PgStore`, agregar:

```ts
  /**
   * Guarda el borrador de IA de una reseña 4-5★ que todavía no tenía uno, vía
   * `app.guardar_borrador_resena` (0024). Cross-tenant por el mismo motivo que
   * `registrarResenaGoogle`: el polling corre como `app_service`, sin grant directo sobre la tabla.
   *
   * @returns true si escribió el borrador; false si la fila no existe, ya tenía un borrador, o no es
   *          elegible (1-3★) — el WHERE de la función decide, no este método.
   */
  async guardarBorradorResena(r: BorradorParaGuardar): Promise<boolean> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ guardar_borrador_resena: boolean }>(
        "select app.guardar_borrador_resena($1, $2, $3, $4) as guardar_borrador_resena",
        [r.clientId, r.tenantId, r.googleReviewId, r.borrador],
      );
      return rows[0]?.guardar_borrador_resena ?? false;
    });
  }
```

- [ ] **Step 4: Exportar `BorradorParaGuardar` desde `db/src/index.ts`**

En la lista de tipos que ya exporta desde `./store.js` (`db/src/index.ts:6-21`), agregar
`BorradorParaGuardar` a la lista (junto a `ResenaParaGuardar`).

- [ ] **Step 5: Escribir los tests, en `db/src/store.test.ts`** (agregar al final del archivo, después
  de la línea 1911 — el test `"🔴 resenas: las dos funciones son SECURITY DEFINER..."`)

```ts
// =============================================================================
// Borrador de IA (migración 0024) — la tercera función security definer del módulo de reseñas.
// La amenaza acá NO es el silencio (0018): es que la función escriba sobre una fila que no debía
// (1-3★, o una que ya tenía borrador). Ver la spec, sección "Modelo de datos" — hallazgo de la
// revisión externa.
// =============================================================================

test("🔴 app_user NO puede ejecutar guardar_borrador_resena (42501)", async () => {
  await assert.rejects(
    () =>
      store.guardarBorradorResena({
        clientId: clientA1,
        tenantId: tenantA,
        googleReviewId: "gr-intento-api",
        borrador: "Gracias por tu reseña",
      }),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre el guardado del borrador",
  );
});

test("guardarBorradorResena escribe el borrador de una reseña 5★ elegible", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-borrador-1",
    puntuacion: 5,
    autor: "Ana",
    texto: "Buenísimo",
    publicadaEn: new Date().toISOString(),
  });

  const ok = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-borrador-1",
    borrador: "¡Gracias, Ana!",
  });
  assert.equal(ok, true);

  const { rows } = await pg.query<{ borrador_respuesta: string; borrador_generado_en: string }>(
    "select borrador_respuesta, borrador_generado_en from resenas_google where google_review_id = 'gr-borrador-1'",
  );
  assert.equal(rows[0]?.borrador_respuesta, "¡Gracias, Ana!");
  assert.ok(rows[0]?.borrador_generado_en, "borrador_generado_en queda puesto");
});

test("🔴 guardarBorradorResena NO escribe sobre una reseña de 1-3★ (defensa en profundidad)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-negativa",
    puntuacion: 2,
    autor: "Carlos",
    texto: "Mal",
    publicadaEn: new Date().toISOString(),
  });

  const ok = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-negativa",
    borrador: "IA no debería poder escribir esto",
  });
  assert.equal(ok, false, "🔴 el WHERE de la función rechaza puntuacion fuera de 4-5");

  const { rows } = await pg.query<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where google_review_id = 'gr-negativa'",
  );
  assert.equal(rows[0]?.borrador_respuesta, null, "la reseña negativa sigue sin ningún borrador de IA");
});

test("🔴 guardarBorradorResena NO pisa un borrador que ya existe (defensa en profundidad)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    puntuacion: 5,
    autor: "Diana",
    texto: "Excelente",
    publicadaEn: new Date().toISOString(),
  });
  const primera = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    borrador: "Edición del staff, guardada primero",
  });
  assert.equal(primera, true);

  const segunda = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    borrador: "Un segundo llamado no debería pisar esto",
  });
  assert.equal(segunda, false, "🔴 el WHERE rechaza borrador_respuesta is null cuando ya hay uno");

  const { rows } = await pg.query<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where google_review_id = 'gr-ya-tiene'",
  );
  assert.equal(rows[0]?.borrador_respuesta, "Edición del staff, guardada primero", "no se sobrescribió");
});

test("🔴 guardarBorradorResena escribe bajo el tenant que se le pasa, no el que decida el motor", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientB1,
    tenantId: tenantB,
    googleReviewId: "gr-cruzado-borrador",
    puntuacion: 5,
    autor: "B",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientB1,
    tenantId: tenantB,
    googleReviewId: "gr-cruzado-borrador",
    borrador: "Gracias",
  });

  const { rows } = await pg.query<{ tenant_id: string }>(
    "select tenant_id from resenas_google where google_review_id = 'gr-cruzado-borrador'",
  );
  assert.equal(rows[0]?.tenant_id, tenantB);
});

test("🔴 la función nueva es SECURITY DEFINER de app_resenas, con search_path fijado", async () => {
  const { rows } = await pg.query<{
    owner: string; prosecdef: boolean; proconfig: string[] | null;
  }>(
    `select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'guardar_borrador_resena'`,
  );
  assert.equal(rows.length, 1, "la función existe (si no, el resto no comprueba nada)");
  assert.equal(rows[0]?.owner, "app_resenas", "🔴 NO puede pertenecer a quien corre la migración");
  assert.equal(rows[0]?.prosecdef, true, "🔴 sin security definer no hay cruce de tenants");
  assert.ok(
    (rows[0]?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    "🔴 sin search_path fijado es una escalada de privilegios",
  );
});

test("🔴 los grants de update sobre borrador_respuesta son EXACTAMENTE app_user y app_resenas", async () => {
  const { rows } = await pg.query<Record<string, boolean>>(`
    select
      has_column_privilege('app_user',    'resenas_google', 'borrador_respuesta', 'update') as user_update,
      has_column_privilege('app_resenas', 'resenas_google', 'borrador_respuesta', 'update') as resenas_update,
      has_column_privilege('app_service', 'resenas_google', 'borrador_respuesta', 'update') as service_update,
      has_column_privilege('app_render',  'resenas_google', 'borrador_respuesta', 'update') as render_update
  `);
  assert.deepEqual(rows[0], {
    user_update: true,
    resenas_update: true,
    // El orquestador (app_service) sigue sin grant directo: pasa por la función security definer.
    service_update: false,
    // ADR-19: el renderizador anónimo, jamás.
    render_update: false,
  });
});
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npm test -w db`
Expected: PASS, sin regresiones en el resto del archivo.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w db`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/0024_borrador_resenas_ia.sql db/src/store.ts db/src/store.test.ts db/src/index.ts
git commit -m "$(cat <<'EOF'
Feat: migración 0024 — columnas de borrador IA + guardar_borrador_resena

app.guardar_borrador_resena filtra en el WHERE (4-5★, sin borrador
previo): un cliente con `execute` no puede sobrescribir una edición
humana ni escribir IA sobre una reseña negativa aunque el TypeScript
que lo llama tuviera un bug.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `PgResenas.editarBorrador` — el lado `app_user`

**Files:**
- Modify: `db/src/resenas.ts` (nuevo método `editarBorrador`)
- Modify: `db/src/resenas.test.ts` (tests)

**Interfaces:**
- Consumes: `resenas_google.borrador_respuesta` y su grant `update` para `app_user` (Task 1), la
  política `resena_marcar_vista` (`0021`), `PgResenas.withTenant` (`db/src/resenas.ts:61-68`).
- Produces: `PgResenas.editarBorrador(ctx: TenantContext, clientId: string, resenaId: string, texto:
  string): Promise<boolean>`. **Task 6 (api) consume esto.**

- [ ] **Step 1: Escribir el método, en `db/src/resenas.ts`** (después de `marcarVista`,
  `db/src/resenas.ts:89-99`)

```ts
  /**
   * Edita el borrador de respuesta de una reseña. Mismo molde exacto que `marcarVista`: `false` sin
   * lanzar si no matchea ninguna fila (otro tenant, no existe, o `puede_escribir()` da falso para el
   * rol `cliente` — ADR-20). A diferencia de `marcarVista`, no hay `where borrador_respuesta is
   * null`: el staff puede editar un borrador ya generado por IA, o escribir uno desde cero si la
   * generación había fallado — ese es justamente el camino de recuperación manual (ver la spec).
   */
  async editarBorrador(
    ctx: TenantContext,
    clientId: string,
    resenaId: string,
    texto: string,
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update resenas_google set borrador_respuesta = $1
         where id = $2 and client_id = $3
         returning id`,
        [texto, resenaId, clientId],
      );
      return rows.length > 0;
    });
  }
```

- [ ] **Step 2: Escribir los tests, en `db/src/resenas.test.ts`** (agregar al final del archivo,
  después de la línea 467)

```ts
// ============================================================ Etapa 3 — editarBorrador (0024)

test("editarBorrador guarda el texto y se puede repetir (a diferencia de marcarVista)", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "eb-1" });

  const primera = await resenas.editarBorrador(ctx, s.clientA1, id, "Primer borrador");
  assert.equal(primera, true);

  const segunda = await resenas.editarBorrador(ctx, s.clientA1, id, "Borrador corregido");
  assert.equal(segunda, true, "a diferencia de marcarVista, editar de nuevo SÍ tiene efecto");

  const [row] = await db.asService<{ borrador_respuesta: string }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.borrador_respuesta, "Borrador corregido");
});

test("🔴 editarBorrador sobre una reseña de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearResena(s.clientB1, s.tenantB, { googleReviewId: "eb-ajena", puntuacion: 5 });

  const resultado = await resenas.editarBorrador(
    { tenantId: s.tenantA, userId: s.equipoA },
    s.clientA1,
    ajena,
    "Intento cruzado",
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [ajena],
  );
  assert.equal(row?.borrador_respuesta, null, "el intento de A no tocó la reseña de B");
});

test("🔴 editarBorrador con rol 'cliente' devuelve false (ADR-20: el cliente no escribe)", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "eb-cliente" });
  const resultado = await resenas.editarBorrador(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    s.clientA1,
    id,
    "Intento del rol cliente",
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.borrador_respuesta, null, "el rol cliente no pudo escribir nada");
});
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w db`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w db`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add db/src/resenas.ts db/src/resenas.test.ts
git commit -m "$(cat <<'EOF'
Feat: PgResenas.editarBorrador — el staff edita el borrador de reseñas

Mismo molde que marcarVista (RLS decide el 404, no un if de rol), pero
sin el `where borrador_respuesta is null`: editar es idempotente, y es
también el camino de recuperación manual cuando falló la generación.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `BorradorProvider` — mock + OpenAI, config, credenciales

**Files:**
- Create: `orchestrator/src/borrador/provider.ts`
- Create: `orchestrator/src/borrador/mock-provider.ts`
- Create: `orchestrator/src/borrador/openai-provider.ts`
- Create: `orchestrator/src/borrador/provider.test.ts`
- Create: `orchestrator/src/borrador/openai-provider.test.ts`
- Modify: `orchestrator/src/config.ts` (nueva variable `BORRADOR_RESENAS_MODO`)
- Modify: `orchestrator/src/config.test.ts` (tests)
- Modify: `orchestrator/.env.example`
- Modify: `scripts/env-sync.mts` (`MAPA.orchestrator` gana `OPENAI_API_KEY` y `BORRADOR_RESENAS_MODO`)
- Modify: `orchestrator/package.json` (dependencia `openai`)

**Interfaces:**
- Consumes: `orchestrator/src/google/provider.ts` (el molde a replicar), `ReseñaCruda` (mismo archivo).
- Produces: `interface BorradorProvider { generar(reseña: ReseñaCruda): Promise<string> }`;
  `getBorradorProvider(modo?: ModoBorrador): BorradorProvider`; `ConfigOrquestador.borradorResenas:
  ModoBorrador`; función pura `costoEstimadoUsd(usage, modelo): number | null`. **Task 4 y Task 5
  consumen esto.**

- [ ] **Step 1: Instalar la dependencia `openai` en `orchestrator/`**

Run: `npm install openai -w orchestrator`
Expected: agrega `"openai": "^4.104.0"` (o la versión que resuelva) a `orchestrator/package.json` —
mismo paquete que ya usa `web-builder` (`web-builder/package.json:24`), versión distinta permitida si
`npm` resuelve otra dentro del rango.

- [ ] **Step 2: Escribir la interfaz y el selector, en `orchestrator/src/borrador/provider.ts`**

```ts
import { leerConfig, type ModoBorrador } from "../config.js";
import type { ReseñaCruda } from "../google/provider.js";
import { MockBorradorProvider } from "./mock-provider.js";
import { OpenAIBorradorProvider } from "./openai-provider.js";

/**
 * Genera el texto de un borrador de respuesta para una reseña 4-5★. Mismo molde que
 * `GoogleReviewsProvider` (`../google/provider.ts`): una interfaz, dos implementaciones (mock/openai),
 * seleccionadas por config — nunca `live`/`openai` a medio implementar.
 */
export interface BorradorProvider {
  generar(reseña: ReseñaCruda): Promise<string>;
}

/**
 * El selector. Mismo criterio que `getGoogleReviewsProvider`: quien ya tiene la config la pasa
 * explícita, quien no deja que se resuelva sola desde `leerConfig()`.
 */
export function getBorradorProvider(
  modo: ModoBorrador = leerConfig().borradorResenas,
): BorradorProvider {
  return modo === "openai" ? new OpenAIBorradorProvider() : new MockBorradorProvider();
}
```

- [ ] **Step 3: Escribir el mock, en `orchestrator/src/borrador/mock-provider.ts`**

```ts
import type { ReseñaCruda } from "../google/provider.js";
import type { BorradorProvider } from "./provider.js";

/**
 * El prefijo que hace que un borrador mock NUNCA se confunda con uno real de OpenAI cuando alguien
 * lo edita en el portal — hallazgo de la revisión externa de diseño (ver la spec, sección "El
 * provider"). Un borrador sin este prefijo, en cualquier fila de `resenas_google`, es evidencia de
 * que salió de `OpenAIBorradorProvider`.
 */
export const PREFIJO_MOCK_BORRADOR = "[BORRADOR MOCK — no generado por IA]";

/** Texto determinista de fixture — nunca sale a internet. Mismo criterio que `MockGoogleReviewsProvider`. */
export class MockBorradorProvider implements BorradorProvider {
  async generar(reseña: ReseñaCruda): Promise<string> {
    return (
      `${PREFIJO_MOCK_BORRADOR} Gracias por tu reseña de ${reseña.puntuacion}★, ${reseña.autor}. ` +
      "¡Nos alegra mucho que hayas disfrutado la experiencia! Esperamos verte pronto de nuevo."
    );
  }
}
```

- [ ] **Step 4: Escribir el provider de OpenAI, en `orchestrator/src/borrador/openai-provider.ts`**

```ts
import OpenAI from "openai";
import type { ReseñaCruda } from "../google/provider.js";
import type { BorradorProvider } from "./provider.js";

/**
 * USD por 1M tokens. Mismo criterio de "costo conocido, no medido" que
 * `kr-service/src/lib/cost.ts` — acá sin tabla configurable por entorno porque el volumen esperado
 * es bajo (solo se loguea, no se factura una propuesta comercial con esto). Si el modelo configurado
 * no tiene tarifa acá, `costoEstimadoUsd` devuelve `null` en vez de inventar un número.
 *
 * ✅ Verificado contra developers.openai.com/api/docs/pricing el 2026-08-18. Los precios cambian:
 * re-verificar si esto empieza a importar para una propuesta comercial.
 */
const PRECIOS_USD_POR_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

/** Costo estimado en USD a partir del `usage` que devuelve la respuesta de OpenAI. */
export function costoEstimadoUsd(
  usage: { prompt_tokens: number; completion_tokens: number },
  modelo: string,
): number | null {
  const precio = PRECIOS_USD_POR_1M[modelo];
  if (!precio) return null;
  return (usage.prompt_tokens * precio.input + usage.completion_tokens * precio.output) / 1_000_000;
}

const PROMPT_SISTEMA =
  "Sos el community manager de un negocio gastronómico, respondiendo reseñas de clientes en Google. " +
  "Escribís en español, tono cercano y profesional, agradeciendo la reseña. Si el cliente mencionó " +
  "algo concreto (un plato, el servicio), lo nombrás. NUNCA prometas resultados garantizados ni hagas " +
  "afirmaciones que el negocio no pueda sostener. 2-3 frases, nada más. Devolvé SOLO el texto de la " +
  "respuesta, sin comillas ni preámbulo.";

/**
 * Genera el borrador llamando a OpenAI de verdad. La instrucción de "nunca prometas de más" es una
 * instrucción al modelo, **no una garantía dura** (mismo límite que ya tiene la prosa de
 * `web-builder/src/llm/content.ts:64-72`): la garantía real es que ningún borrador sale de esta pieza
 * sin pasar antes por revisión humana — esta pieza no publica nada.
 */
export class OpenAIBorradorProvider implements BorradorProvider {
  private readonly client: OpenAI;
  private readonly modelo: string;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] ?? "" });
    this.modelo = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
  }

  async generar(reseña: ReseñaCruda): Promise<string> {
    const contexto = reseña.texto
      ? `Reseña de ${reseña.puntuacion}★ de ${reseña.autor}: "${reseña.texto}"`
      : `Reseña de ${reseña.puntuacion}★ de ${reseña.autor}, sin comentario escrito.`;

    const res = await this.client.chat.completions.create({
      model: this.modelo,
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: contexto },
      ],
    });

    const texto = res.choices[0]?.message.content?.trim();
    if (!texto) throw new Error("OpenAI no devolvió texto para el borrador");

    if (res.usage) {
      const costo = costoEstimadoUsd(res.usage, this.modelo);
      console.log(
        `[borrador-ia] costo estimado: ${costo != null ? `$${costo.toFixed(6)}` : "modelo sin tarifa conocida"} ` +
          `(${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out, modelo ${this.modelo})`,
      );
    }

    return texto;
  }
}
```

- [ ] **Step 5: Agregar `ModoBorrador` y `leerModoBorrador` a `orchestrator/src/config.ts`**

Después del bloque de `ModoResenasGoogle` (`orchestrator/src/config.ts:74-76`), agregar:

```ts
/**
 * Igual forma que `ModoResenasGoogle`, pero un módulo distinto (Bloque F, fase 2): el borrador de
 * respuesta con IA. `openai` es la única implementación real (a diferencia de `resenasGoogle`, cuyo
 * `live` todavía no existe) — ver `borrador/provider.ts`.
 */
export type ModoBorrador = "mock" | "openai";
const MODOS_BORRADOR: readonly string[] = ["mock", "openai"];
```

En la interfaz `ConfigOrquestador` (`orchestrator/src/config.ts:43-69`), después del campo
`resenasGoogle`, agregar:

```ts
  /**
   * En qué modo se genera el borrador de respuesta con IA. **Opcional, con default derivado**: mismo
   * criterio que `PROSE_MODE` en `web-builder/src/config.ts:40` — `openai` si hay `OPENAI_API_KEY`,
   * `mock` si no. Un despliegue en modo mock nunca produce un research falso (a diferencia de
   * `PIPELINE_MODO`), pero SÍ podía producir un borrador de relleno indistinguible de uno de OpenAI
   * para quien lo edita en el portal — por eso `MockBorradorProvider` lleva un prefijo inconfundible
   * (ver `borrador/mock-provider.ts`) en vez de replicar la máquina de `verificarCoherencia` acá.
   */
  readonly borradorResenas: ModoBorrador;
```

Después de la función `validarModoResenasGoogle`/`leerModoResenasGoogle`
(`orchestrator/src/config.ts:266-285`), agregar:

```ts
function validarModoBorrador(crudo: string): ModoBorrador {
  if (!MODOS_BORRADOR.includes(crudo)) {
    throw new Error(
      `BORRADOR_RESENAS_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`openai\`.`,
    );
  }
  return crudo as ModoBorrador;
}

/**
 * `BORRADOR_RESENAS_MODO`, con default DERIVADO de si hay `OPENAI_API_KEY` — a diferencia de
 * `GOOGLE_REVIEWS_MODO` (default fijo `mock`, porque `live` ni siquiera está implementado). Acá
 * `openai` SÍ está implementado, así que cargar la key sin declarar la variable ya empieza a gastar
 * — mismo comportamiento, a propósito, que `PROSE_MODE` en `web-builder`.
 */
function leerModoBorrador(): ModoBorrador {
  const crudo = process.env["BORRADOR_RESENAS_MODO"]?.trim();
  if (crudo) return validarModoBorrador(crudo);
  return process.env["OPENAI_API_KEY"]?.trim() ? "openai" : "mock";
}
```

Dentro de `leerConfig()` (`orchestrator/src/config.ts:131-249`): justo después de la línea
`const resenasGoogle = leerModoResenasGoogle();` (línea 136), agregar:

```ts
  const borradorResenas = leerModoBorrador();
```

Y agregar `borradorResenas,` al objeto que se devuelve en la rama de producción (junto a
`resenasGoogle,` en el `return` de la línea ~187-198) y al objeto `comun` de la rama sin producción
(junto a `resenasGoogle,` en el `const comun = {...}` de la línea ~222-228).

- [ ] **Step 6: Actualizar `orchestrator/.env.example`**

Después del bloque `GOOGLE_REVIEWS_MODO` (`orchestrator/.env.example:54-59`), agregar:

```
# `mock` | `openai`. Opcional, con default DERIVADO de si `OPENAI_API_KEY` está puesta (a diferencia
# de GOOGLE_REVIEWS_MODO, cuyo default fijo es `mock` porque `live` no existe todavía) -- acá `openai`
# SÍ es una implementación real, así que cargar la key sin declarar esta variable YA empieza a gastar.
# Mismo criterio que PROSE_MODE en web-builder/.env.example.
BORRADOR_RESENAS_MODO=mock

# La key de OpenAI, compartida con kr-service y web-builder (mismo valor, repartido por env:sync).
# Sin ella, BORRADOR_RESENAS_MODO cae a `mock` aunque no lo declares.
OPENAI_API_KEY=sk-...
```

- [ ] **Step 7: Actualizar `scripts/env-sync.mts`**

En `MAPA.orchestrator` (`scripts/env-sync.mts:57-63`), agregar `"OPENAI_API_KEY"` y
`"BORRADOR_RESENAS_MODO"` al array.

- [ ] **Step 8: Escribir `orchestrator/src/borrador/provider.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBorradorProvider, PREFIJO_MOCK_BORRADOR } from "./mock-provider.js";
import { OpenAIBorradorProvider } from "./openai-provider.js";
import { getBorradorProvider } from "./provider.js";

const RESEÑA = { googleReviewId: "r1", puntuacion: 5, autor: "Ana", texto: "Buenísimo", publicadaEn: new Date().toISOString() };

test("MockBorradorProvider.generar lleva el prefijo inconfundible", async () => {
  const texto = await new MockBorradorProvider().generar(RESEÑA);
  assert.ok(texto.startsWith(PREFIJO_MOCK_BORRADOR), "🔴 sin el prefijo, un mock se confunde con un borrador real");
});

// ------------------------------------------------------- el selector

test("getBorradorProvider('mock') devuelve el mock", () => {
  const p = getBorradorProvider("mock");
  assert.ok(p instanceof MockBorradorProvider);
});

test("getBorradorProvider('openai') devuelve el provider de OpenAI (sin llamar a la red)", () => {
  const p = getBorradorProvider("openai");
  assert.ok(p instanceof OpenAIBorradorProvider, "construir el cliente no dispara ninguna llamada");
});

test("getBorradorProvider() sin argumento resuelve el modo desde la config (mock por defecto)", () => {
  const original = process.env["BORRADOR_RESENAS_MODO"];
  const originalKey = process.env["OPENAI_API_KEY"];
  delete process.env["BORRADOR_RESENAS_MODO"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const p = getBorradorProvider();
    assert.ok(p instanceof MockBorradorProvider);
  } finally {
    if (original === undefined) delete process.env["BORRADOR_RESENAS_MODO"];
    else process.env["BORRADOR_RESENAS_MODO"] = original;
    if (originalKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = originalKey;
  }
});
```

- [ ] **Step 9: Escribir `orchestrator/src/borrador/openai-provider.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { costoEstimadoUsd } from "./openai-provider.js";

test("costoEstimadoUsd calcula el costo a partir de tokens de entrada/salida", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, "gpt-4o-mini");
  assert.equal(costo, 0.15 + 0.6, "1M in a $0.15 + 1M out a $0.60");
});

test("🔴 costoEstimadoUsd devuelve null para un modelo sin tarifa conocida, no inventa un número", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 100, completion_tokens: 100 }, "modelo-inexistente");
  assert.equal(costo, null);
});
```

- [ ] **Step 10: Escribir los tests de config, en `orchestrator/src/config.test.ts`**

Agregar `"BORRADOR_RESENAS_MODO"` y `"OPENAI_API_KEY"` al array `VARS`
(`orchestrator/src/config.test.ts:18-40`), para que `conEntorno` las limpie entre casos.

Después del bloque `GOOGLE_REVIEWS_MODO` (`orchestrator/src/config.test.ts:474-508`), agregar:

```ts
// --------------------------------------- BORRADOR_RESENAS_MODO: default derivado de OPENAI_API_KEY

test("BORRADOR_RESENAS_MODO por defecto es 'mock' sin la variable NI la key", () => {
  conEntorno({});
  const c = leerConfig();
  assert.equal(c.borradorResenas, "mock");
});

/**
 * 🔴 El default que factura, igual que `PROSE_MODE`: con la key puesta y la variable sin declarar, el
 * borrador se genera con OpenAI de verdad. Nadie tuvo que declarar el gasto: alcanzó con que la key
 * estuviera.
 */
test("🔴 con OPENAI_API_KEY puesta y sin BORRADOR_RESENAS_MODO declarado, el default es 'openai'", () => {
  conEntorno({ OPENAI_API_KEY: "sk-de-mentira" });
  const c = leerConfig();
  assert.equal(c.borradorResenas, "openai");
});

test("BORRADOR_RESENAS_MODO=mock explícito gana aunque haya key (declarar manda sobre el default)", () => {
  conEntorno({ OPENAI_API_KEY: "sk-de-mentira", BORRADOR_RESENAS_MODO: "mock" });
  const c = leerConfig();
  assert.equal(c.borradorResenas, "mock");
});

test("🔴 BORRADOR_RESENAS_MODO con un valor que no es mock/openai lanza", () => {
  conEntorno({ BORRADOR_RESENAS_MODO: "produccion" });
  assert.throws(() => leerConfig(), /BORRADOR_RESENAS_MODO inválido/);
});

test("en producción, sin BORRADOR_RESENAS_MODO ni key arranca igual (default mock, no se exige)", () => {
  conEntorno(PROD_COMPLETO);
  const c = leerConfig();
  assert.equal(c.borradorResenas, "mock");
});
```

- [ ] **Step 11: Correr los tests y typecheck**

Run: `npm test -w orchestrator && npm run typecheck -w orchestrator`
Expected: PASS, sin errores. Si `env-sync.test.mts` corre como parte de `npm test` en la raíz,
también debería seguir verde (el test compara `MAPA` contra `.env.example` automáticamente).

Run: `npm test`
Expected: verde entero, incluido `scripts/env-sync.test.mts`.

- [ ] **Step 12: Commit**

```bash
git add orchestrator/src/borrador orchestrator/src/config.ts orchestrator/src/config.test.ts \
  orchestrator/.env.example orchestrator/package.json orchestrator/package-lock.json \
  scripts/env-sync.mts package-lock.json
git commit -m "$(cat <<'EOF'
Feat: BorradorProvider (mock/OpenAI) para el borrador de respuesta con IA

Mismo molde que GoogleReviewsProvider. El mock lleva un prefijo
inconfundible para que nunca se confunda con un borrador real. El
default de BORRADOR_RESENAS_MODO se deriva de OPENAI_API_KEY, mismo
criterio que PROSE_MODE en web-builder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Cablear el `BorradorProvider` dentro de `pollearResenas`

**Files:**
- Modify: `orchestrator/src/workflow.ts` (`Deps` gana `borradorProvider`)
- Modify: `orchestrator/src/deps.ts` (wiring)
- Modify: `orchestrator/src/functions.ts` (`pollearResenas`)
- Modify: `orchestrator/src/functions.test.ts` (tests)

**Interfaces:**
- Consumes: `BorradorProvider`/`getBorradorProvider` (Task 3), `PgStore.guardarBorradorResena` (Task
  1, ya en `PgStore` porque `Deps.store` es la clase completa — no hace falta tocar su tipo).
- Produces: `pollearResenas` genera y guarda el borrador para 4-5★ elegibles, dentro del mismo ciclo
  de polling.

- [ ] **Step 1: Agregar `borradorProvider` a `Deps`, en `orchestrator/src/workflow.ts`**

Agregar el import junto al de `GoogleReviewsProvider` (`orchestrator/src/workflow.ts:4`):

```ts
import type { BorradorProvider } from "./borrador/provider.js";
```

En la interfaz `Deps` (`orchestrator/src/workflow.ts:37-64`), después del campo `resenasProvider`,
agregar:

```ts
  /** Genera el borrador de respuesta con IA (Bloque F, fase 2). Igual que `resenasProvider`, no lo
   * usa `workflowResearch` -- lo usa `pollearResenas`. */
  borradorProvider: BorradorProvider;
```

- [ ] **Step 2: Cablear en `orchestrator/src/deps.ts`**

Agregar el import junto al de `getGoogleReviewsProvider` (`orchestrator/src/deps.ts:14`):

```ts
import { getBorradorProvider } from "./borrador/provider.js";
```

En el objeto que devuelve `crearDeps` (`orchestrator/src/deps.ts:114-197`), después de la línea
`resenasProvider: getGoogleReviewsProvider(),`, agregar:

```ts
    // Mismo criterio que resenasProvider: el selector lee su propio default de leerConfig(), acá NO
    // se relee el entorno.
    borradorProvider: getBorradorProvider(),
```

- [ ] **Step 3: Escribir el test ROJO en `orchestrator/src/functions.test.ts`**

Extender el helper `depsDePolling` (`orchestrator/src/functions.test.ts:51-70`) para aceptar un
tercer parámetro opcional:

```ts
function depsDePolling(
  store: {
    clientesConectadosGoogle: () => Promise<ClienteConectadoFalso[]>;
    registrarResenaGoogle: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
      puntuacion: number;
      autor: string;
      texto: string | null;
      publicadaEn: string;
    }) => Promise<boolean>;
    guardarBorradorResena?: (r: {
      clientId: string;
      tenantId: string;
      googleReviewId: string;
      borrador: string;
    }) => Promise<boolean>;
  },
  resenasProvider: {
    refrescarToken: (refreshToken: string) => Promise<string>;
    listarResenas: (accessToken: string, locationId: string) => Promise<ResenaCrudaFalsa[]>;
  },
  borradorProvider?: { generar: (r: ResenaCrudaFalsa) => Promise<string> },
): DepsDePolling {
  return {
    store: { guardarBorradorResena: async () => true, ...store },
    resenasProvider,
    borradorProvider: borradorProvider ?? { generar: async () => "borrador de prueba" },
  } as unknown as DepsDePolling;
}
```

Agregar, al final del archivo:

```ts
// ---------------------------------------------------------------- borrador de IA (Bloque F, fase 2)

test("🔴 genera y guarda el borrador para una reseña 5★ nueva", async () => {
  const guardados: Array<{ googleReviewId: string; borrador: string }> = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      guardarBorradorResena: async (r) => {
        guardados.push({ googleReviewId: r.googleReviewId, borrador: r.borrador });
        return true;
      },
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r5"), puntuacion: 5 }] },
    { generar: async () => "Gracias por tu reseña" },
  );

  await pollearResenas(deps);

  assert.deepEqual(guardados, [{ googleReviewId: "r5", borrador: "Gracias por tu reseña" }]);
});

test("🔴 NO genera borrador para una reseña de 1-3★", async () => {
  let generarLlamado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r2"), puntuacion: 2 }] },
    { generar: async () => { generarLlamado = true; return "no debería pasar"; } },
  );

  await pollearResenas(deps);

  assert.equal(generarLlamado, false, "🔴 el PRD prohíbe IA para 1-3★, ni siquiera se intenta");
});

test("🔴 NO genera borrador para una reseña que el polling ya había visto (insertada = false)", async () => {
  let generarLlamado = false;
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => false, // ya existía
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r5-vieja"), puntuacion: 5 }] },
    { generar: async () => { generarLlamado = true; return "no debería pasar"; } },
  );

  await pollearResenas(deps);

  assert.equal(generarLlamado, false, "reseña ya vista: no se re-genera un borrador");
});

test("🔴 un fallo del BorradorProvider en una reseña no frena el resto del mismo cliente", async () => {
  const guardados: string[] = [];
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c1", "t1", "l1", "tok")],
      registrarResenaGoogle: async () => true,
      guardarBorradorResena: async (r) => {
        guardados.push(r.googleReviewId);
        return true;
      },
    },
    {
      refrescarToken: async () => "access-ok",
      listarResenas: async () => [
        { ...resenaCruda("r-1"), puntuacion: 5 },
        { ...resenaCruda("r-2"), puntuacion: 5 },
        { ...resenaCruda("r-3"), puntuacion: 5 },
      ],
    },
    {
      generar: async (r) => {
        if (r.googleReviewId === "r-2") throw new Error("OpenAI caído");
        return "ok";
      },
    },
  );

  const resultado = await pollearResenas(deps);

  assert.deepEqual(guardados, ["r-1", "r-3"], "r-2 falló, pero r-1 y r-3 igual guardaron su borrador");
  assert.equal(resultado.fallidos, 0, "un fallo de borrador NO cuenta como cliente fallido");
});

test("🔴 un fallo del BorradorProvider se loguea con el id de la reseña y del cliente", async () => {
  const deps = depsDePolling(
    {
      clientesConectadosGoogle: async () => [cliente("c-x", "t-y", "l1", "tok")],
      registrarResenaGoogle: async () => true,
    },
    { refrescarToken: async () => "access-ok", listarResenas: async () => [{ ...resenaCruda("r-falla"), puntuacion: 5 }] },
    { generar: async () => { throw new Error("timeout"); } },
  );

  const dicho: string[] = [];
  await pollearResenas(deps, (m) => dicho.push(m));

  assert.ok(
    dicho.some((m) => m.includes("r-falla") && m.includes("c-x")),
    `el log tiene que nombrar la reseña y el cliente. Logueado: ${JSON.stringify(dicho)}`,
  );
});
```

- [ ] **Step 4: Correr los tests para confirmar que fallan**

Run: `npm test -w orchestrator`
Expected: FAIL — `pollearResenas` todavía no llama a `borradorProvider` ni a `guardarBorradorResena`.

- [ ] **Step 5: Implementar, en `orchestrator/src/functions.ts`**

Modificar la firma de `pollearResenas` (`orchestrator/src/functions.ts:195-198`) para incluir
`borradorProvider`:

```ts
export async function pollearResenas(
  deps: Pick<Deps, "store" | "resenasProvider" | "borradorProvider">,
  log: (msg: string) => void = () => {},
): Promise<{ clientesRecorridos: number; resenasNuevas: number; fallidos: number }> {
```

Dentro del loop `for (const r of crudas)` (`orchestrator/src/functions.ts:209-220`), inmediatamente
después de `if (insertada) resenasNuevas++;`, agregar:

```ts
        // Borrador de IA (Bloque F, fase 2): solo 4-5★, solo si esta corrida insertó la reseña
        // (una que el polling ya había visto no necesita un borrador nuevo). Try/catch PROPIO, no el
        // del cliente entero: un fallo de OpenAI en UNA reseña no debe impedir que se guarden las
        // demás reseñas nuevas de ese mismo cliente en esta misma corrida.
        if (insertada && r.puntuacion >= 4) {
          try {
            const borrador = await deps.borradorProvider.generar(r);
            await deps.store.guardarBorradorResena({
              clientId: cliente.clientId,
              tenantId: cliente.tenantId,
              googleReviewId: r.googleReviewId,
              borrador,
            });
          } catch (e) {
            // No incrementa `fallidos`: ese contador es de CLIENTES con el token roto, no de
            // borradores puntuales. La reseña queda guardada sin borrador; sin reintento automático
            // (decisión del spec) -- el staff completa el campo a mano desde el portal.
            log(
              `[borrador-ia] reseña ${r.googleReviewId} (cliente ${cliente.clientId}) falló: ${(e as Error).message}`,
            );
          }
        }
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npm test -w orchestrator`
Expected: PASS, TODOS los tests de `functions.test.ts` (viejos y nuevos).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w orchestrator`
Expected: sin errores.

- [ ] **Step 8: Correr la suite completa**

Run: `npm test`
Expected: verde entero (nada de `db`/`api`/`portal` debería haberse roto).

- [ ] **Step 9: Commit**

```bash
git add orchestrator/src/workflow.ts orchestrator/src/deps.ts orchestrator/src/functions.ts \
  orchestrator/src/functions.test.ts
git commit -m "$(cat <<'EOF'
Feat: pollearResenas genera el borrador de IA para reseñas 4-5★ nuevas

Try/catch propio por reseña, no el del cliente entero: un fallo de
OpenAI en una reseña no debe impedir que se guarden las demás. Sin
reintento automático -- decisión del spec, el staff completa a mano.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/_health` reporta el modo del borrador

**Files:**
- Modify: `orchestrator/src/app.ts` (`OpcionesServidor` + el cuerpo de `/_health`)
- Modify: `orchestrator/src/server.ts` (wiring + log de arranque)
- Modify: `orchestrator/src/app.test.ts` (agregar `borrador: "mock"` a cada `crearServidor({...})`
  existente + un test nuevo)

**Interfaces:**
- Consumes: `ConfigOrquestador.borradorResenas` (Task 3).
- Produces: `/_health` incluye `"borrador": "mock" | "openai"`.

- [ ] **Step 1: Agregar el campo a `OpcionesServidor`, en `orchestrator/src/app.ts`**

Importar el tipo junto a `ModoPipeline` (`orchestrator/src/app.ts:4`):

```ts
import type { ConfigOrquestador, ModoBorrador, ModoPipeline } from "./config.js";
```

En la interfaz `OpcionesServidor` (`orchestrator/src/app.ts:54-91`), después del campo `prosa`,
agregar:

```ts
  /**
   * Con qué se genera el borrador de respuesta con IA (Bloque F, fase 2). Es el segundo eje que
   * puede gastar sin que `pipeline`/`publicacion` lo digan — mismo motivo que `prosa` existe acá.
   */
  borrador: ModoBorrador;
```

En el cuerpo de `/_health` (`orchestrator/src/app.ts:115-139`), destructurar `borrador` junto al resto
(línea 96: `const { manejadorInngest, funciones, modo, pipeline, publicacion, prosa, sonda } =
opciones;` → agregar `borrador`) y agregarlo al `JSON.stringify` (línea 121-137), justo después de
`prosa,`:

```ts
          borrador,
```

- [ ] **Step 2: Cablear en `orchestrator/src/server.ts`**

Después de la línea `const prosa = modoProsa();` (`orchestrator/src/server.ts:56`), agregar:

```ts
const borrador = config.borradorResenas;
```

En el objeto que arma `crearServidor({...})` (`orchestrator/src/server.ts:58-72`), después de
`prosa,`, agregar:

```ts
  borrador,
```

En el bloque de logs del arranque (`orchestrator/src/server.ts:74-89`), después de la línea `console.log(\`  Prosa: ...\`);`, agregar:

```ts
  console.log(`  Borrador IA: ${borrador}${borrador === "openai" ? " ⚠️  GASTA DINERO al generar borradores" : ""}`);
```

- [ ] **Step 3: Actualizar los call sites existentes de `crearServidor` en `orchestrator/src/app.test.ts`**

Hay exactamente 6 llamados a `crearServidor({...})` en este archivo (confirmado con
`grep -n "crearServidor(" orchestrator/src/app.test.ts`), en las líneas **85, 122, 199, 219, 274 y
316**. En cada uno, agregar `borrador: "mock",` inmediatamente después de `prosa: "mock",` (o
`prosa: "mock"` sin coma final, si el objeto está en una sola línea — agregar `, borrador: "mock"`
antes del `}` de cierre).

Run: `npm run typecheck -w orchestrator`
Expected: FAIL antes del cambio (el campo `borrador` es obligatorio en `OpcionesServidor` y estos 6
objetos no lo traen) — confirmalo antes de tocar nada, para saber que el campo requerido está
haciendo su trabajo. Después de agregar `borrador: "mock",` a los 6, volver a correr:

Run: `npm run typecheck -w orchestrator`
Expected: PASS. Si sigue fallando, el compilador nombra el archivo y la línea exacta que falta —
usalo como lista autoritativa por si algún call site nuevo se coló entremedio.

- [ ] **Step 4: Agregar el test de contenido, en `orchestrator/src/app.test.ts`**

Dentro del test `"🔴 /_health con la base sana: NI RASTRO del campo \`degradado\`"`
(`orchestrator/src/app.test.ts:121-...`), junto a la línea `assert.equal(cuerpo["prosa"], "mock");`,
agregar:

```ts
    assert.equal(cuerpo["borrador"], "mock");
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -w orchestrator`
Expected: PASS.

Run: `npm test`
Expected: verde entero.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/app.ts orchestrator/src/server.ts orchestrator/src/app.test.ts
git commit -m "$(cat <<'EOF'
Feat: /_health reporta el modo del borrador de IA

Mismo criterio que `prosa`: es un eje que puede gastar sin que
`pipeline`/`publicacion` lo digan, así que tiene que poder auditarse
sin entrar al panel de Railway.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `PATCH /clients/:id/resenas/:resenaId` acepta editar el borrador

**Files:**
- Modify: `api/src/app.ts` (el handler PATCH)
- Modify: `api/src/app.test.ts` (tests)

**Interfaces:**
- Consumes: `PgResenas.editarBorrador` (Task 2).
- Produces: `PATCH { borrador_respuesta: string }` guarda el texto; body con las dos llaves, claves
  desconocidas, o ninguna forma reconocida → `400`.

- [ ] **Step 1: Escribir el test ROJO, en `api/src/app.test.ts`** (agregar después del test
  `"🔴 con rol 'cliente', PATCH .../resenas/:id da 404 (ADR-20: solo lee)"`, línea ~1314-1325)

```ts
test("PATCH .../resenas/:id con {borrador_respuesta} guarda el texto y responde 200", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { borrador_respuesta: "Gracias por tu reseña" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const [fila] = await sql<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.borrador_respuesta, "Gracias por tu reseña");
});

test("PATCH .../resenas/:id se puede repetir sobre el borrador (a diferencia de vista)", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador-2x", puntuacion: 5 });
  await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA, tenant: tenantA, body: { borrador_respuesta: "Primero" },
  });
  const segunda = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA, tenant: tenantA, body: { borrador_respuesta: "Corregido" },
  });
  assert.equal(segunda.status, 200, "editar el borrador no es de una sola vez, a diferencia de vista=true");

  const [fila] = await sql<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.borrador_respuesta, "Corregido");
});

test("🔴 PATCH .../resenas/:id con las DOS llaves a la vez → 400, no ignora una en silencio", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-body-doble", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true, borrador_respuesta: "no debería aplicarse" },
  });
  assert.equal(res.status, 400);

  const [fila] = await sql<{ vista_en: string | null; borrador_respuesta: string | null }>(
    "select vista_en, borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.vista_en, null, "el body inválido no tuvo NINGÚN efecto");
  assert.equal(fila!.borrador_respuesta, null);
});

test("🔴 PATCH .../resenas/:id con una clave desconocida sumada a una válida → 400", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-clave-extra", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true, otraCosa: 1 },
  });
  assert.equal(res.status, 400);
});

test("🔴 con rol 'cliente', PATCH .../resenas/:id con borrador_respuesta da 404 (ADR-20: solo lee)", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador-cliente", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { borrador_respuesta: "intento del rol cliente" },
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npm test -w api`
Expected: FAIL — el handler actual solo acepta `{vista: true}`.

- [ ] **Step 3: Implementar, en `api/src/app.ts`**

Reemplazar el handler PATCH actual (`api/src/app.ts:538-552`) por:

```ts
  /**
   * PATCH /clients/:id/resenas/:resenaId — acepta EXACTAMENTE una de dos formas fijas, nunca las dos
   * juntas ni una clave desconocida: `{"vista": true}` (marca vista) o `{"borrador_respuesta":
   * string}` (edita el borrador, Bloque F fase 2). No es una allowlist de columnas: cada forma se
   * compara entera, mismo criterio que ya regía cuando solo existía la primera.
   */
  app.patch("/clients/:id/resenas/:resenaId", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.param("id");
    const resenaId = c.req.param("resenaId");
    const body = await c.req.json().catch(() => null);
    const claves = body && typeof body === "object" ? Object.keys(body) : [];

    if (claves.length === 1 && (body as Record<string, unknown>)["vista"] === true) {
      const ok = await deps.resenas.marcarVista(ctx, clientId, resenaId);
      if (!ok) return c.json({ error: "Reseña no encontrada, ya vista, o sin permiso." }, 404);
      return c.json({ ok: true });
    }

    if (claves.length === 1 && typeof (body as Record<string, unknown>)["borrador_respuesta"] === "string") {
      const texto = (body as Record<string, unknown>)["borrador_respuesta"] as string;
      const ok = await deps.resenas.editarBorrador(ctx, clientId, resenaId, texto);
      if (!ok) return c.json({ error: "Reseña no encontrada, o sin permiso." }, 404);
      return c.json({ ok: true });
    }

    return c.json({ error: 'El body tiene que ser {"vista": true} o {"borrador_respuesta": string}.' }, 400);
  });
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test -w api`
Expected: PASS, TODOS los tests de `app.test.ts` (viejos y nuevos).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w api`
Expected: sin errores.

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: verde entero.

- [ ] **Step 7: Commit**

```bash
git add api/src/app.ts api/src/app.test.ts
git commit -m "$(cat <<'EOF'
Feat: PATCH /clients/:id/resenas/:id acepta editar el borrador de IA

Exactamente una de dos formas fijas, nunca las dos juntas ni una clave
desconocida -- {"vista":true} y {"borrador_respuesta":"..."} nunca se
mezclan ni se ignoran en silencio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: El portal — textarea editable en `/clientes/:id/resenas`

**Files:**
- Modify: `portal/src/app/core/models.ts` (`ResenaGoogle` gana `borradorRespuesta`)
- Modify: `portal/src/app/core/api-core.ts` (`editarBorradorResena`)
- Modify: `portal/src/app/pages/clientes/cliente-resenas.ts` (UI)
- Modify: `portal/src/app/pages/clientes/cliente-resenas.spec.ts` (tests)

**Interfaces:**
- Consumes: `PATCH /clients/:id/resenas/:resenaId` con `{borrador_respuesta}` (Task 6).
- Produces: la pantalla que ve el staff y el rol `cliente`.

- [ ] **Step 1: Agregar el campo a `ResenaGoogle`, en `portal/src/app/core/models.ts`**

En la interfaz `ResenaGoogle` (`portal/src/app/core/models.ts:267-277`), después de `vistaEn`,
agregar:

```ts
  /** `null` = sin borrador todavía (nunca se genera con IA para 1-3★ — ver `db/src/resenas.ts`). */
  borradorRespuesta: string | null;
```

Y actualizar el comentario de la interfaz (línea 262) para mencionar que ahora también espeja
`borrador_respuesta`.

- [ ] **Step 2: Agregar `editarBorradorResena` a `portal/src/app/core/api-core.ts`**

En la interfaz `ClienteApi` (junto a `marcarResenaVista`, `portal/src/app/core/api-core.ts:259-260`),
agregar:

```ts
  /** Edita el borrador de respuesta de una reseña. A diferencia de `marcarResenaVista`, se puede
   * repetir (no es de una sola vez). */
  editarBorradorResena(clientId: string, resenaId: string, texto: string): Promise<void>;
```

En la implementación (junto a `marcarResenaVista`, `portal/src/app/core/api-core.ts:499-508`),
agregar:

```ts
    async editarBorradorResena(clientId, resenaId, texto) {
      await pedir(
        'PATCH',
        `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`,
        { borrador_respuesta: texto },
      );
    },
```

- [ ] **Step 3: Escribir el test ROJO, en `portal/src/app/pages/clientes/cliente-resenas.spec.ts`**

Extender el helper `crear()` (`portal/src/app/pages/clientes/cliente-resenas.spec.ts:63-107`) para
que `ApiService` incluya `editarBorradorResena`, y `resenaDePrueba()` (línea 38-49) para que incluya
`borradorRespuesta: null` por defecto:

```ts
function resenaDePrueba(overrides: Partial<ResenaGoogle> = {}): ResenaGoogle {
  return {
    id: 'r1',
    clientId: 'c1',
    puntuacion: 5,
    autor: 'Ana',
    texto: 'Buenísimo',
    publicadaEn: '2026-08-01T00:00:00.000Z',
    vistaEn: '2026-08-01T00:00:00.000Z',
    borradorRespuesta: null,
    ...overrides,
  };
}
```

En `crear()`, agregar el spy y devolverlo:

```ts
  const editarBorradorResenaSpy =
    opciones.editarBorradorResena ?? jasmine.createSpy('editarBorradorResena').and.resolveTo(undefined);
  // ... dentro del provider de ApiService:
  editarBorradorResena: editarBorradorResenaSpy,
  // ... en el return:
  editarBorradorResenaSpy,
```

Y en la firma de `opciones` de `crear()`, agregar `editarBorradorResena?: jasmine.Spy;`.

Agregar, al final del `describe`:

```ts
  it('staff: una reseña 5★ sin borrador muestra un textarea vacío editable', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    const textarea = el.querySelector('textarea');
    expect(textarea).withContext('sin textarea, el staff no tiene forma de completar el borrador a mano').toBeTruthy();
    expect(textarea!.value).toBe('');
  });

  it('staff: editar y Guardar dispara editarBorradorResena y actualiza la fila local', async () => {
    const resena = resenaDePrueba({ id: 'r1', puntuacion: 5, borradorRespuesta: null });
    const editarBorradorResenaSpy = jasmine.createSpy('editarBorradorResena').and.resolveTo(undefined);
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
      editarBorradorResena: editarBorradorResenaSpy,
    });
    let el = await estabilizar(fixture);

    const textarea = el.querySelector('textarea')!;
    textarea.value = 'Gracias por tu reseña';
    textarea.dispatchEvent(new Event('input'));
    el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'Guardar')!;
    boton.click();
    el = await estabilizar(fixture);

    expect(editarBorradorResenaSpy).toHaveBeenCalledWith('c1', 'r1', 'Gracias por tu reseña');
    expect(el.textContent).toContain('Gracias por tu reseña');
  });

  it('rol cliente: NO ve textarea ni botón Guardar, solo el texto de solo lectura si existe', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: 'Ya generado' });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).withContext('el rol cliente nunca ve un control editable').toBeNull();
    expect(el.textContent).toContain('Ya generado');
  });

  it('rol cliente, sin borrador: muestra "sin borrador todavía", sin textarea', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('Sin borrador todavía');
  });

  it('una reseña de 1-3★ nunca muestra textarea ni texto de borrador', async () => {
    const resena = resenaDePrueba({ puntuacion: 2, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).not.toContain('Sin borrador todavía');
  });
```

- [ ] **Step 4: Correr los tests y confirmar que fallan**

Run: `npm --prefix portal run test:components`
Expected: FAIL — el template todavía no tiene textarea ni el gate de rol.

- [ ] **Step 5: Implementar el template, en `portal/src/app/pages/clientes/cliente-resenas.ts`**

Reemplazar el bloque `@if (r.texto) { ... }` dentro del `<li>` (líneas 91-93 del archivo original) por:

```html
              @if (r.texto) {
                <p class="mt-1 text-sm text-texto-medio">{{ r.texto }}</p>
              }
              @if (r.puntuacion >= 4) {
                @if (membresia.esEquipo()) {
                  <textarea
                    class="mt-2 w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
                    rows="3"
                    placeholder="Sin borrador todavía — escribí la respuesta acá"
                    [value]="borradorEditado(r)"
                    (input)="editarBorradorLocal(r.id, $any($event.target).value)"
                  ></textarea>
                  <button
                    type="button"
                    (click)="guardarBorrador(r)"
                    class="mt-2 rounded-md bg-accion text-texto-invertido px-3 py-1.5 text-xs font-medium hover:opacity-90"
                  >
                    Guardar
                  </button>
                } @else if (r.borradorRespuesta) {
                  <p class="mt-2 text-sm text-texto-medio">{{ r.borradorRespuesta }}</p>
                } @else {
                  <p class="mt-2 text-xs text-texto-tenue">Sin borrador todavía.</p>
                }
              }
```

Agregar, dentro de la clase `ClienteResenasPage`, después del método `verla`:

```ts
  /**
   * Texto editado localmente por reseña, antes de guardar. Sin entrada = todavía no se tocó, y el
   * textarea muestra `r.borradorRespuesta` (o vacío si no hay). Un `Record`, no un `Map`, para que
   * el template lo lea directo sin volver a envolver la lectura en un método aparte por cada uso.
   */
  private readonly ediciones = signal<Record<string, string>>({});

  /** El texto que ve el textarea de esta reseña: lo editado localmente, o lo que ya trae el servidor. */
  borradorEditado(r: ResenaGoogle): string {
    return this.ediciones()[r.id] ?? r.borradorRespuesta ?? '';
  }

  editarBorradorLocal(resenaId: string, texto: string): void {
    this.ediciones.update((m) => ({ ...m, [resenaId]: texto }));
  }

  /** Guarda el borrador editado y actualiza la fila local, sin volver a pedir todo el listado. */
  async guardarBorrador(r: ResenaGoogle): Promise<void> {
    const texto = this.borradorEditado(r);
    await this.api.editarBorradorResena(this.clienteId(), r.id, texto);
    this.resenas.update((rs) => rs.map((x) => (x.id === r.id ? { ...x, borradorRespuesta: texto } : x)));
  }
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npm --prefix portal run test:components`
Expected: PASS, TODOS los tests de `cliente-resenas.spec.ts` (viejos y nuevos).

- [ ] **Step 7: Typecheck del portal**

Run: `npm --prefix portal run typecheck` (o el script equivalente que use el proyecto — verificar en
`portal/package.json`; si no existe uno dedicado, `npm --prefix portal run build` sirve de proxy).
Expected: sin errores.

- [ ] **Step 8: Correr `npm run verificar` completo desde la raíz**

Run: `npm run verificar -- --con-portal`
Expected: verde entero: entorno, arnés, secretos, typecheck y tests de TODOS los paquetes más el
portal.

- [ ] **Step 9: Manejar la app en el navegador (MCP chrome-devtools)**

1. Levantar la API real sobre PGlite: `npm run dev:server -w api`.
2. Levantar el portal.
3. Sembrar (a mano, vía la API o un script de dev) una reseña 5★ sin borrador para un cliente de
   prueba.
4. Correr el polling mock (o esperar el ciclo) y confirmar que el tab `/clientes/:id/resenas` muestra
   el texto **con el prefijo `[BORRADOR MOCK — no generado por IA]`**.
5. Editarlo, apretar Guardar, refrescar la página y confirmar que el cambio persiste.
6. Cambiar a un usuario con rol `cliente` y confirmar que ve el texto de solo lectura, sin textarea ni
   botón.
7. Confirmar que una reseña de 1-3★ no muestra ninguno de los dos estados.
8. Revisar la consola del navegador: limpia, sin errores.

Expected: los ocho pasos se comportan como se describe. Si algo no coincide, es un defecto real del
comportamiento (los tests unitarios no ven layout ni el flujo de extremo a extremo — ver
`AGENTS.md`), corregirlo antes de seguir.

- [ ] **Step 10: Commit**

```bash
git add portal/src/app/core/models.ts portal/src/app/core/api-core.ts \
  portal/src/app/pages/clientes/cliente-resenas.ts portal/src/app/pages/clientes/cliente-resenas.spec.ts
git commit -m "$(cat <<'EOF'
Feat: el tab de reseñas muestra el borrador de IA, editable para staff

Textarea siempre disponible para 4-5★ (vacío si la generación falló),
gateado por membresia.esEquipo(); el rol cliente ve el texto de solo
lectura. Verificado en el navegador con el prefijo del mock visible.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Cierre de la etapa (ritual de `AGENTS.md`, no un task más)

Después del Task 7, **antes de dar la etapa por cerrada**:

1. Correr `npm run verificar` desde la raíz y confirmar el verde con el output a la vista.
2. Actualizar `docs/proyecto/09-estado-y-roadmap.md`: el Bloque F pasa de "sin empezar" a "fase 2,
   primera pieza cerrada" (borrador de IA); anotar qué sigue (publicar, alertas, limpiar conexión
   revocada).
3. Actualizar `docs/proyecto/15-plan-plataforma.md`, sección "Bloque G — módulo 3: respondedor de
   reseñas de Google", con la tabla de tasks de este plan (mismo formato que la de fase 1).
4. Agregar la entrada del día en `progress/history.md`.
5. Considerar si corresponde una revisión con Codex del código ya implementado (skill
  `codex-review`) antes del commit final — el usuario decide si la pide.
6. Commit + push a `main`.
