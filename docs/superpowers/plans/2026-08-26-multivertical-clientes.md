# Multi-vertical de clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota AMG OS:** este proyecto tiene agentes de área propios (`datos`, `render`, `pipeline`, `front`,
> `revisor` — ver `AGENTS.md`). Al ejecutar, preferí delegar cada tarea al agente de área que corresponda
> en vez del subagente genérico: **Tasks 1-5 → `datos`** (db, incluidos los grants y el inventario de
> `insert into clients`); **Task 6-10 → `render`** (`web-builder`/`renderer`; Task 9 también toca
> `orchestrator/src/workflow.ts` y `deps.ts` → coordinar con `pipeline`, que es dueño de esos archivos,
> antes de tocarlos); **Task 11 → `datos`** (cruza `db/src/clientes.ts` y `api/src/app.ts`, las dos
> áreas de ese agente); **Tasks 12-14 → `front`**; **Task 15 → la sesión principal** (verificación end-
> to-end, documentación, commit final — nunca un subagente, mismo criterio que el resto del proyecto).
> El `revisor` pasa después de CADA tarea, no solo al final. El contrato entre áreas (nombres exactos
> de `Vertical`, la firma de `renderStory`/`renderHome`/`renderCatalogo`/`renderBlogIndex`, el shape de
> `PerfilSeguros`) ya está fijado en este plan — no hace falta re-negociarlo al delegar, solo seguirlo.

**Goal:** Agregar un segundo rubro de cliente (correduría de seguros) junto al existente
(restauración), con perfil, catálogo, plantilla de render y portal propios — sin romper ningún cliente
de restauración existente.

**Architecture:** `clients.vertical` (enum Postgres nuevo, inmutable, sin default) es la única fuente
de verdad. Gobierna: (1) qué claves expone `app.nap_publico` — genérico siempre, extensión de
restauración solo si `vertical = 'restauracion'`, extensión de seguros solo si
`vertical = 'correduria_seguros'`; (2) qué receta de piezas usa el render (`juegoDe(vertical)`,
reemplaza a `juegoDe(brand.plantilla)`); (3) qué slug/JSON-LD tiene la página de catálogo pública
(`/menu` + `Menu` para restauración, `/polizas` + `ItemList` para seguros); (4) qué tab/campos ve el
portal. El catálogo (menú de restauración, pólizas de seguros) usa el mismo contenedor de datos
(`business_profile.menu`/`menu_categorias`, tipos `MenuItem`/`MenuCategoria` **sin renombrar** —
decisión de implementación, ver "Global Constraints").

**Tech Stack:** TypeScript ESM strict + `noUncheckedIndexedAccess`, `tsx` sin build, `node:test` +
`node:assert`, PGlite para tests de seguridad, npm workspaces (`db`, `web-builder`, `orchestrator`,
`api`, `renderer`) + `portal/` (Angular, fuera del monorepo).

## Global Constraints

- Nombres de dominio en español (`vertical`, no `type`; `correduria_seguros`, no `insurance`).
- `clients.vertical`: **sin default**, columna `not null` tras backfill explícito — igual criterio que
  `PIPELINE_MODO`, una decisión sin dueño es un bug.
- `clients.vertical` es **inmutable tras el alta**: nunca entra a `COLUMNAS_EDITABLES` de
  `actualizarCliente`, ni al tipo `CambiosCliente`.
- `clients.vertical` **no se enmascara** al rol `cliente` (no es nota interna de agencia como `tipo`
  CRM — es un atributo de producto que el propio portal del cliente necesita).
- **Decisión de implementación (no estaba en el spec, se fija acá):** los tipos `MenuItem`/
  `MenuCategoria` y las claves JSON persistidas (`name`, `description`, `category`, `price`, `precios`,
  `nota`, `foto`, `video`, `alergenos`, `etiquetas`, `nutricion`, y las claves `menu`/`menu_categorias`
  de `business_profile`) **NO se renombran**. Generalizar el nombre habría tocado ~15 archivos sin
  ningún beneficio funcional (contra YAGNI, `AGENTS.md`). La "genericidad" es de comportamiento: la
  UI/render varían la etiqueta y qué sub-campos importan según `vertical`, el contenedor de datos es el
  mismo para cualquier rubro. Los endpoints `GET`/`PATCH /clients/:id/menu` **tampoco se renombran**
  por el mismo motivo — es contrato interno API↔portal, no algo que vea un visitante.
- Todo campo nuevo del perfil (`seguros.numeroLicencia`, etc.) cruza las mismas **4 fronteras** que ya
  documenta `web-builder/src/types.ts:296-299`: el Zod de `contract.ts`, la allowlist
  `app.nap_publico`, `perfilValido` del renderizador, y el render. Un campo que falte en una desaparece
  sin error — cada task de abajo lo dice explícitamente cuando aplica.
- Cada migración que reemplaza `app.nap_publico` sigue el patrón ya establecido (`0009`/`0010`/`0014`/
  `0020`/`0023`): `set lock_timeout`, `drop column if exists business_profile_publico`, recrear la
  columna generada, `grant select (business_profile_publico) on clients to app_render` — sin este
  último grant, todas las webs de todos los clientes caen a la vez (ya pasó en la `0009`).
- Todo archivo que quede claramente fuera del alcance de este plan (contrato/kr-service, los otros dos
  sub-proyectos) no se toca.

---

## Task 1: Migración `clients.vertical`

> ⚠️ **Número de migración a verificar en ejecución, no asumir `0027`.** Agregado durante la revisión
> conjunta de los tres sub-proyectos de esta iniciativa (2026-08-26): el orden de implementación fijado
> es **sub-proyecto 2 primero** (introduce `0027_kr_run_decisiones.sql`), después este sub-proyecto y el
> 3 (en cualquier orden). Si ese orden se respetó, esta Task es en realidad `0028` y la siguiente
> (`nap_publico`) `0029` — correr `ls db/migrations | tail -3` antes de crear el archivo y ajustar TODAS
> las referencias a `0027`/`0028` de este plan al número real.

**Files:**
- Create: `db/migrations/0027_clientes_vertical.sql` (número tentativo — ver la nota de arriba)
- Test: `db/src/clientes.test.ts` (agregar casos, el archivo ya existe)
- Modify: **todos** los sitios que hacen `insert into clients` o llaman `crearCliente(` sin `vertical` —
  la columna `not null` sin default los rompe a todos, no solo a uno. `rg -n "insert\s+into\s+clients|
  crearCliente\("` (excluyendo `node_modules` y este mismo plan) da, a la fecha de escribir este plan:
  `db/src/seed-demo.ts`, `renderer/src/dev-server.ts`, `renderer/src/demo-server.ts`,
  `renderer/src/tres-fronteras.test.ts`, `orchestrator/src/workflow.test.ts`, `db/src/store.test.ts`,
  `db/src/clientes.test.ts`, `db/src/rls.test.ts`, `db/src/testdb.ts`, `db/src/seed-contrato.test.ts`,
  `db/src/ideas.test.ts`, `api/src/app.test.ts`, `api/src/ideas.test.ts`, `api/src/informe.test.ts`,
  `api/src/entregable.test.ts`, `portal/src/app/core/api-core.test.ts`,
  `portal/src/app/services/clientes.ts` — **volver a correr el `rg` al ejecutar esta task**, la lista
  puede haber cambiado desde que se escribió el plan.

**Interfaces:**
- Produce: la columna `clients.vertical app.vertical_cliente not null`, valores
  `'restauracion' | 'correduria_seguros'`, sin default.
- Produce: `grant select (vertical) on clients to app_service, app_render` — sin este grant, el
  orquestador (`app_service`) y el renderizador público (`app_render`) fallan con "permission denied
  for table clients" en cuanto una query intente leer la columna nueva (Tasks 4 y 5). Los dos roles
  tienen grants de columna CERRADOS desde `0007_render_publico.sql`/`0022_resenas_google_polling.sql` —
  agregar una columna a la tabla no la agrega automáticamente a un grant ya angosto.

- [ ] **Step 1: Escribir la migración**

```sql
-- =============================================================================
-- AMG OS — clients.vertical: el rubro del cliente (restauración, correduría de seguros)
--
-- Deliberadamente NO es la columna `tipo` que ya existe (0011_clientes_crm.sql): esa es clasificación
-- CRM de forma jurídica/comercial (empresa/autonomo/particular), enmascarada al rol `cliente` y
-- editable. `vertical` es un atributo de PRODUCTO — determina qué campos de perfil, qué catálogo y qué
-- plantilla de render tiene el cliente — y el rol `cliente` lo necesita sin enmascarar para que su
-- propio portal sepa qué mostrarle.
--
-- Sin default a propósito, mismo criterio que PIPELINE_MODO: una vertical que cae en un valor por
-- omisión es una decisión sin dueño. Backfill EXPLÍCITO para los clientes existentes (todos
-- restaurantes hoy) antes de exigir NOT NULL.
--
-- INMUTABLE tras el alta: no entra a COLUMNAS_EDITABLES (db/src/clientes.ts) ni al tipo CambiosCliente
-- — ver Task 3. Es la forma más simple de que cambiar la vertical de un cliente ya publicado no pueda
-- exponer campos dormidos del otro rubro a través de la allowlist (app.nap_publico, Task 2): si el
-- cambio no existe, no hace falta modelar una transición validada.
-- =============================================================================

set lock_timeout = '5s';

create type app.vertical_cliente as enum ('restauracion', 'correduria_seguros');

alter table clients add column vertical app.vertical_cliente;

-- Backfill explícito, no inferido: todos los clientes de hoy son restaurantes.
update clients set vertical = 'restauracion' where vertical is null;

alter table clients alter column vertical set not null;

-- app_service (orquestador) y app_render (renderizador público) tienen grants de columna CERRADOS
-- desde 0022/0007 — agregar una columna a la tabla no la suma a un grant ya angosto. Sin esto, Task 4
-- (ClientRow.vertical bajo app_service) y Task 5 (Sitio.vertical bajo app_render) fallan en runtime
-- con "permission denied for table clients", un error que PGlite con rol superusuario NO reproduce —
-- por eso el test del Step 2 corre explícitamente `set local role`.
grant select (vertical) on clients to app_service, app_render;
```

- [ ] **Step 2: Test rojo primero — el backfill de una fila PRE-EXISTENTE, y el grant bajo los roles reales**

Agregar a `db/src/clientes.test.ts` (seguir el patrón de setup ya existente en ese archivo — PGlite +
`aplicarMigraciones` + un tenant creado). El test de backfill tiene que crear la fila **ANTES** de
aplicar la migración `0027` — si el `aplicarMigraciones` del setup ya corre todas las migraciones de
punta a punta, este test necesita su PROPIA instancia de PGlite que se detiene en la `0026` y aplica la
`0027` aparte (revisar cómo el paquete ya modela "aplicar hasta N" — si no existe ese mecanismo,
agregarlo es parte de este step, no un test que se salta la garantía real):

```ts
test("el backfill de la 0027 deja restauracion a un cliente creado ANTES de la migración", async () => {
  // Requiere aplicar las migraciones 0001..0026, insertar el cliente SIN vertical (no existía la
  // columna todavía), aplicar la 0027, y recién ahí leer.
  const dbPrevia = await pglitePararEn(26); // helper nuevo o existente — ver nota arriba
  await dbPrevia.query(
    `insert into clients (tenant_id, nombre) values ($1, 'Cliente pre-existente')`,
    [TENANT_ID],
  );
  await aplicarMigracion(dbPrevia, 27);
  const { rows } = await dbPrevia.query<{ vertical: string }>(
    "select vertical from clients where nombre = 'Cliente pre-existente'",
  );
  assert.equal(rows[0]!.vertical, "restauracion");
});

test("clients.vertical es NOT NULL sin default — un insert que la omite falla", async () => {
  await assert.rejects(
    () =>
      db.query(`insert into clients (tenant_id, nombre) values ($1, 'Sin vertical')`, [TENANT_ID]),
    /null value in column "vertical"/,
  );
});

test("clients.vertical acepta los dos valores del enum y rechaza cualquier otro", async () => {
  await db.query(
    `insert into clients (tenant_id, nombre, vertical) values ($1, 'Cliente seguros', 'correduria_seguros')`,
    [TENANT_ID],
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into clients (tenant_id, nombre, vertical) values ($1, 'Cliente inválido', 'peluqueria')`,
        [TENANT_ID],
      ),
    /invalid input value for enum/,
  );
});

test("app_service puede leer vertical (grant de columna real, no solo la query bajo superusuario)", async () => {
  const id = await /* helper existente de creación de cliente con vertical */;
  await db.exec(`set local role app_service`);
  const { rows } = await db.query<{ vertical: string }>(
    "select vertical from clients where id = $1",
    [id],
  );
  assert.equal(rows[0]!.vertical, "restauracion");
});

test("app_render puede leer vertical bajo su propio rol", async () => {
  const id = await /* mismo helper */;
  await db.exec(`set local role app_render`);
  const { rows } = await db.query<{ vertical: string }>(
    "select vertical from clients where id = $1",
    [id],
  );
  assert.equal(rows[0]!.vertical, "restauracion");
});
```

- [ ] **Step 3: Correr los tests, confirmar rojo antes de aplicar la migración**

Run: `npm test -w db`
Expected: FAIL — la migración todavía no existe.

- [ ] **Step 4: Aplicar la migración del Step 1, confirmar verde**

Run: `npm test -w db`
Expected: PASS, incluidos los dos tests de grant bajo `app_service`/`app_render`.

- [ ] **Step 5: Arreglar TODOS los sitios de creación de cliente listados en "Files" arriba**

Recorrer cada archivo del `rg` (volver a correrlo primero, la lista de "Files" puede haber quedado
vieja) y agregar `vertical: 'restauracion'` (o `'correduria_seguros'` donde el fixture represente
específicamente ese caso) a cada `insert into clients`/llamada a `crearCliente(`. Para
`db/src/seed-demo.ts`, `renderer/src/dev-server.ts` y `renderer/src/demo-server.ts` — los tres caminos
de datos de DEMO/DEV, no de test — usar `'restauracion'` explícito: preserva el comportamiento actual
de la demo (hoy todo es un restaurante), es una decisión tomada acá y no un default que se cuela.

- [ ] **Step 6: Correr la suite completa de cada paquete tocado**

Run: `npm test -w db -w renderer -w orchestrator -w api && npm --prefix portal run test:components`
Expected: PASS en los 4 paquetes del monorepo tocados y en el portal — no alcanza con `npm test -w db`
solo, porque el `NOT NULL` rompe fixtures en `renderer`/`orchestrator`/`api`/`portal` también.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0027_clientes_vertical.sql db/src/clientes.test.ts \
        db/src/seed-demo.ts renderer/src/dev-server.ts renderer/src/demo-server.ts \
        renderer/src/tres-fronteras.test.ts orchestrator/src/workflow.test.ts db/src/store.test.ts \
        db/src/rls.test.ts db/src/testdb.ts db/src/seed-contrato.test.ts db/src/ideas.test.ts \
        api/src/app.test.ts api/src/ideas.test.ts api/src/informe.test.ts api/src/entregable.test.ts \
        portal/src/app/core/api-core.test.ts portal/src/app/services/clientes.ts
git commit -m "feat(db): agrega clients.vertical (restauracion | correduria_seguros), grants incluidos"
```

---

## Task 2: `app.nap_publico` gana un segundo parámetro y una extensión de seguros

**Files:**
- Create: `db/migrations/0028_nap_publico_vertical.sql` (número tentativo — el siguiente libre después
  de la Task 1; ver la nota de esa Task sobre el orden de implementación de los tres sub-proyectos)
- Test: `db/src/nap-publico.test.ts` (nuevo — el test específico por vertical que pidió la revisión de
  Codex; si ya existe un test de la allowlist en otro archivo, agregar ahí en vez de duplicar)

**Interfaces:**
- Consume: `clients.vertical` (Task 1).
- Produce: `app.nap_publico(perfil jsonb, vertical app.vertical_cliente) returns jsonb` — sigue siendo
  `language sql immutable`, **no** `security definer` (corrección del hallazgo 9 de Codex: nunca lo
  fue). `business_profile_publico` pasa a `generated always as (app.nap_publico(business_profile,
  vertical)) stored`, referenciando dos columnas de la misma fila (Postgres lo permite en una expresión
  generada).
- Produce: `BusinessProfile.seguros?: { numeroLicencia?: string; anosExperiencia?: number;
  redAfiliacion?: string }` cruza la allowlist, expuesto solo cuando `vertical = 'correduria_seguros'`.

- [ ] **Step 1: Escribir la migración**

La función se reescribe entera (no es un `alter`, es `create or replace` con nueva firma — Postgres
permite sobrecargar por firma distinta, pero acá se REEMPLAZA la única función existente, así que hay
que dropear la vieja de 1 parámetro primero porque cambia el tipo de retorno de la columna generada):

```sql
-- =============================================================================
-- AMG OS — app.nap_publico gana un segundo parámetro: `vertical`
--
-- Hasta acá la allowlist no sabía nada del rubro del cliente. Con multi-vertical, dos cosas cambian:
--
--   1. Las claves restaurante-only de `menu` (`video`, `alergenos`, `etiquetas`, `nutricion`) SOLO se
--      exponen si `vertical = 'restauracion'` — aunque el jsonb las tuviera cargadas (un dato dormido
--      de una vertical incorrecta no debe filtrarse; hallazgo de la revisión de Codex al spec).
--   2. Nueva clave `seguros` (numeroLicencia, anosExperiencia, redAfiliacion), SOLO expuesta si
--      `vertical = 'correduria_seguros'`.
--
-- El resto de la allowlist (name, telephone, address, locations, brand, menu/menu_categorias con sus
-- claves base, bienvenida, destacados, testimonios, etc.) no cambia: es genérico para cualquier
-- vertical, como ya lo era.
--
-- Se REEMPLAZA `app.nap_publico` y se re-materializa la columna generada, porque una columna STORED no
-- se recalcula porque cambie la función. Mismo mecanismo que la 0009/0010/0014/0020/0023.
--
-- `app.nap_publico` sigue siendo SQL `immutable`, nunca fue `security definer` (corrección de un
-- error de caracterización en el spec de este subproyecto) — la frontera real de seguridad es el grant
-- de columna a `app_render`, que esta migración restaura como las anteriores.
-- =============================================================================

set lock_timeout = '5s';

-- La columna generada depende de app.nap_publico(jsonb): hay que soltarla A ELLA primero, o el DROP
-- FUNCTION de abajo falla con "cannot drop function ... because other objects depend on it". Mismo
-- motivo por el que las migraciones anteriores (0009/0010/0014/0020/0023) usaban CREATE OR REPLACE en
-- vez de DROP+CREATE: mantenían la firma. Acá la firma cambia (1 parámetro → 2), así que CREATE OR
-- REPLACE no alcanza — sería declarar una segunda función sobrecargada, no reemplazar la primera.
alter table clients drop column if exists business_profile_publico;

drop function if exists app.nap_publico(jsonb);

create function app.nap_publico(perfil jsonb, vertical app.vertical_cliente) returns jsonb
language sql immutable as $$
  select case
    when perfil is null or jsonb_typeof(perfil) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'name',          app.texto_publico(perfil -> 'name'),
      'telephone',     app.texto_publico(perfil -> 'telephone'),
      'priceRange',    app.texto_publico(perfil -> 'priceRange'),
      'url',           app.texto_publico(perfil -> 'url'),
      'image',         app.texto_publico(perfil -> 'image'),
      'opening_hours', app.texto_publico(perfil -> 'opening_hours'),
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   app.texto_publico(perfil -> 'address' -> 'streetAddress'),
          'addressLocality', app.texto_publico(perfil -> 'address' -> 'addressLocality'),
          'postalCode',      app.texto_publico(perfil -> 'address' -> 'postalCode'),
          'addressRegion',   app.texto_publico(perfil -> 'address' -> 'addressRegion'),
          'addressCountry',  app.texto_publico(perfil -> 'address' -> 'addressCountry')
        ))
        else null
      end,
      'portada', app.foto_publica(perfil -> 'portada'),
      'fotos', case
        when jsonb_typeof(perfil -> 'fotos') = 'array' then (
          select jsonb_agg(app.foto_publica(f))
          from jsonb_array_elements(perfil -> 'fotos') with ordinality as t(f, i)
          where app.foto_publica(f) is not null and i <= 30
        )
        else null
      end,
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', app.texto_publico(perfil -> 'brand' -> 'color'),
          'font',  app.texto_publico(perfil -> 'brand' -> 'font'),
          'logo',  app.texto_publico(perfil -> 'brand' -> 'logo'),
          'plantilla', app.texto_publico(perfil -> 'brand' -> 'plantilla'),
          'colores', case
            when jsonb_typeof(perfil -> 'brand' -> 'colores') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'primario',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'primario'),
                'secundario', app.texto_publico(perfil -> 'brand' -> 'colores' -> 'secundario'),
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'colores' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'texto'),
                'fondo',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondo'),
                'fondoAlt',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondoAlt')
              )),
              '{}'::jsonb
            )
            else null
          end,
          'fuentes', case
            when jsonb_typeof(perfil -> 'brand' -> 'fuentes') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'texto'),
                'decorativa', app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'decorativa')
              )),
              '{}'::jsonb
            )
            else null
          end
        ))
        else null
      end,
      'locations', case
        when jsonb_typeof(perfil -> 'locations') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', app.texto_publico(loc -> 'name'),
            'address', case
              when jsonb_typeof(loc -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'streetAddress',   app.texto_publico(loc -> 'address' -> 'streetAddress'),
                'addressLocality', app.texto_publico(loc -> 'address' -> 'addressLocality'),
                'postalCode',      app.texto_publico(loc -> 'address' -> 'postalCode'),
                'addressRegion',   app.texto_publico(loc -> 'address' -> 'addressRegion'),
                'addressCountry',  app.texto_publico(loc -> 'address' -> 'addressCountry')
              ))
              else null
            end,
            'telephone',     app.texto_publico(loc -> 'telephone'),
            'opening_hours', app.texto_publico(loc -> 'opening_hours'),
            'foto',          app.foto_publica(loc -> 'foto')
          )))
          from jsonb_array_elements(perfil -> 'locations') with ordinality as t(loc, i)
          where jsonb_typeof(loc) = 'object' and i <= 20
        )
        else null
      end,
      -- La carta/catálogo: tope 200. Las claves base (category/name/description/price/nota/foto/
      -- precios) valen para CUALQUIER vertical. video/alergenos/etiquetas/nutricion SOLO si
      -- `vertical = 'restauracion'` — es lo que cierra el hallazgo de "campos dormidos" de la revisión.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    app.texto_publico(item -> 'category'),
            'name',        app.texto_publico(item -> 'name'),
            'description', app.texto_publico(item -> 'description'),
            'price',       app.texto_publico(item -> 'price'),
            'nota',        app.texto_publico(item -> 'nota'),
            'foto',        app.foto_publica(item -> 'foto'),
            'precios', case
              when jsonb_typeof(item -> 'precios') = 'array' then (
                select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'etiqueta',   app.texto_publico(p -> 'etiqueta'),
                  'importe',    app.texto_publico(p -> 'importe'),
                  'comensales', app.texto_publico(p -> 'comensales')
                )))
                from jsonb_array_elements(item -> 'precios') with ordinality as tp(p, i)
                where jsonb_typeof(p) = 'object'
                  and app.texto_publico(p -> 'etiqueta') is not null
                  and app.texto_publico(p -> 'importe')  is not null
                  and i <= 3
              )
              else null
            end,
            'video',     case when vertical = 'restauracion' then app.video_publico(item -> 'video') else null end,
            'alergenos', case when vertical = 'restauracion' then app.lista_texto_publica(item -> 'alergenos', 14) else null end,
            'etiquetas', case when vertical = 'restauracion' then app.lista_texto_publica(item -> 'etiquetas', 7) else null end,
            'nutricion', case
              when vertical = 'restauracion' and jsonb_typeof(item -> 'nutricion') = 'object' then nullif(
                jsonb_strip_nulls(jsonb_build_object(
                  'calorias',        app.numero_publico(item -> 'nutricion' -> 'calorias'),
                  'proteinas_g',     app.numero_publico(item -> 'nutricion' -> 'proteinas_g'),
                  'carbohidratos_g', app.numero_publico(item -> 'nutricion' -> 'carbohidratos_g'),
                  'grasas_g',        app.numero_publico(item -> 'nutricion' -> 'grasas_g')
                )),
                '{}'::jsonb
              )
              else null
            end
          )))
          from jsonb_array_elements(perfil -> 'menu') with ordinality as t(item, i)
          where jsonb_typeof(item) = 'object' and i <= 200
        )
        else null
      end,
      'menu_categorias', case
        when jsonb_typeof(perfil -> 'menu_categorias') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'nombre', app.texto_publico(cat -> 'nombre'),
            'foto',   app.foto_publica(cat -> 'foto'),
            'orden',  app.numero_publico(cat -> 'orden')
          )))
          from jsonb_array_elements(perfil -> 'menu_categorias') with ordinality as t(cat, i)
          where jsonb_typeof(cat) = 'object' and i <= 20
        )
        else null
      end,
      -- NUEVO: extensión de perfil de correduría de seguros. Mismo criterio que el resto — SOLO si la
      -- vertical corresponde, aunque el jsonb tuviera la clave cargada por error.
      'seguros', case
        when vertical = 'correduria_seguros' and jsonb_typeof(perfil -> 'seguros') = 'object' then nullif(
          jsonb_strip_nulls(jsonb_build_object(
            'numeroLicencia',   app.texto_publico(perfil -> 'seguros' -> 'numeroLicencia'),
            'anosExperiencia',  app.numero_publico(perfil -> 'seguros' -> 'anosExperiencia'),
            'redAfiliacion',    app.texto_publico(perfil -> 'seguros' -> 'redAfiliacion')
          )),
          '{}'::jsonb
        )
        else null
      end,
      'bienvenida', app.texto_publico(perfil -> 'bienvenida'),
      'destacados', case
        when jsonb_typeof(perfil -> 'destacados') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'titulo', app.texto_publico(d -> 'titulo'),
            'texto',  app.texto_publico(d -> 'texto')
          )))
          from jsonb_array_elements(perfil -> 'destacados') with ordinality as t(d, i)
          where jsonb_typeof(d) = 'object'
            and app.texto_publico(d -> 'titulo') is not null
            and i <= 6
        )
        else null
      end,
      'testimonios', case
        when jsonb_typeof(perfil -> 'testimonios') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'texto', app.texto_publico(t2 -> 'texto'),
            'autor', app.texto_publico(t2 -> 'autor')
          )))
          from jsonb_array_elements(perfil -> 'testimonios') with ordinality as t(t2, i)
          where jsonb_typeof(t2) = 'object'
            and app.texto_publico(t2 -> 'texto') is not null
            and i <= 12
        )
        else null
      end
    ))
  end
$$;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile, vertical)) stored;

comment on column clients.business_profile_publico is
  'Perfil publico del negocio (allowlist, por vertical): name, telephone, priceRange, url, image, '
  'opening_hours, address, brand, locations, menu/menu_categorias (video/alergenos/etiquetas/nutricion '
  'SOLO si vertical=restauracion), seguros (SOLO si vertical=correduria_seguros), portada, fotos, '
  'bienvenida, destacados y testimonios. Generada — nunca se escribe directo. Es lo UNICO que ve '
  'app_render. Ver 0008/0009/0010/0014/0020/0023/0028.';

grant select (business_profile_publico) on clients to app_render;
```

- [ ] **Step 2: Test rojo — el conjunto exacto de claves por vertical, con un perfil que trae datos de
  las DOS verticales a la vez (el escenario del hallazgo 5 de Codex)**

Crear `db/src/nap-publico.test.ts`:

```ts
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones } from "./migrate.js"; // ajustar al helper real del paquete

let db: PGlite;
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

before(async () => {
  db = new PGlite();
  await aplicarMigraciones(db);
  await db.query("insert into tenants (id, nombre) values ($1, 'T')", [TENANT_ID]);
});

after(() => db.close());

// El perfil trae, A PROPÓSITO, datos de las dos verticales a la vez: alergenos de restauración Y
// seguros.numeroLicencia. Es el escenario exacto que el hallazgo 5 de la revisión pidió cubrir.
const PERFIL_MIXTO = {
  name: "Cliente de prueba",
  menu: [
    {
      name: "Ítem",
      category: "Cat",
      video: { src: "https://cdn.example.com/v.mp4" },
      alergenos: ["gluten"],
      etiquetas: ["vegano"],
      nutricion: { calorias: 400 },
    },
  ],
  seguros: { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" },
};

async function publicoParaVertical(vertical: "restauracion" | "correduria_seguros"): Promise<any> {
  const dominio = `mixto-${vertical}.test`;
  await db.query(
    `insert into clients (tenant_id, nombre, domain, business_profile, vertical)
     values ($1, $2, $2, $3::jsonb, $4)`,
    [TENANT_ID, dominio, JSON.stringify(PERFIL_MIXTO), vertical],
  );
  const { rows } = await db.query<{ publico: any }>(
    "select business_profile_publico as publico from clients where domain = $1",
    [dominio],
  );
  return rows[0]!.publico;
}

test("restauración: expone video/alergenos/etiquetas/nutricion, NO expone seguros", async () => {
  const publico = await publicoParaVertical("restauracion");
  const item = publico.menu[0];
  assert.deepEqual(item.video, { src: "https://cdn.example.com/v.mp4" });
  assert.deepEqual(item.alergenos, ["gluten"]);
  assert.deepEqual(item.etiquetas, ["vegano"]);
  assert.deepEqual(item.nutricion, { calorias: 400 });
  assert.equal(publico.seguros, undefined);
});

test("correduría de seguros: expone seguros.*, NO expone video/alergenos/etiquetas/nutricion", async () => {
  const publico = await publicoParaVertical("correduria_seguros");
  const item = publico.menu[0];
  assert.equal(item.video, undefined);
  assert.equal(item.alergenos, undefined);
  assert.equal(item.etiquetas, undefined);
  assert.equal(item.nutricion, undefined);
  assert.deepEqual(publico.seguros, {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
  // Las claves base del ítem siguen presentes para cualquier vertical.
  assert.equal(item.name, "Ítem");
  assert.equal(item.category, "Cat");
});

// El spec exige el CONJUNTO EXACTO de claves, no solo que ciertas claves conocidas tengan el valor
// esperado — un campo privado nuevo que se colara sin que nadie lo agregara a esta lista tiene que
// tumbar este test, y los dos de arriba no lo detectarían (solo miran las claves que ya conocen).
test("restauración: el conjunto EXACTO de claves de un ítem del menú, ni una de más", async () => {
  const publico = await publicoParaVertical("restauracion");
  const clavesItem = Object.keys(publico.menu[0]).sort();
  assert.deepEqual(clavesItem, [
    "alergenos", "category", "etiquetas", "name", "nutricion", "video",
  ].sort());
  assert.deepEqual(Object.keys(publico).includes("seguros"), false);
});

test("correduría de seguros: el conjunto EXACTO de claves de un ítem del catálogo, ni una de más", async () => {
  const publico = await publicoParaVertical("correduria_seguros");
  const clavesItem = Object.keys(publico.menu[0]).sort();
  assert.deepEqual(clavesItem, ["category", "name"].sort());
  assert.deepEqual(Object.keys(publico.seguros).sort(), [
    "anosExperiencia", "numeroLicencia", "redAfiliacion",
  ].sort());
});
```

- [ ] **Step 3: Correr el test, verificar que falla ANTES de aplicar la migración**

Run: `npm test -w db -- --test-name-pattern="nap.publico"` (o el runner que use el paquete)
Expected: FAIL — la función todavía tiene 1 parámetro, el `insert` con `vertical` no matchea la firma
esperada, o la columna generada no existe todavía con la forma nueva.

- [ ] **Step 4: Aplicar la migración (ya escrita en el Step 1), correr de nuevo**

Run: `npm test -w db`
Expected: PASS

- [ ] **Step 5: Mutación — confirmar que quitar la rama `when vertical = 'restauracion'` tumba
  exactamente el test de la fuga cruzada**

Editar temporalmente la migración recién creada (o una copia en un `psql` de prueba) para que `video`/
`alergenos`/`etiquetas`/`nutricion` no dependan de `vertical` (volver a la forma de la `0023`), correr
el test de Step 2 de nuevo, confirmar que **"correduría de seguros: expone seguros.\*, NO expone
video/..."** cae con datos donde antes pasaba. Revertir el cambio de prueba.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0028_nap_publico_vertical.sql db/src/nap-publico.test.ts
git commit -m "feat(db): app.nap_publico allowlistea por vertical, agrega extension de seguros"
```

---

## Task 3: `db/src/clientes.ts` — `vertical` en alta, inmutable, visible

**Files:**
- Modify: `db/src/clientes.ts:33-172` (interfaces `ClienteCRM`/`NuevoCliente`, `CLIENTE_CRM_MASKED_COLS`,
  `CLIENTE_CRM_COLS`, `COLUMNAS_EDITABLES`, `crearCliente`)
- Test: `db/src/clientes.test.ts`

**Interfaces:**
- Consume: `clients.vertical` (Task 1).
- Produce: `ClienteCRM.vertical: "restauracion" | "correduria_seguros"` (no `| null`, siempre presente
  y sin enmascarar); `NuevoCliente.vertical: "restauracion" | "correduria_seguros"` (obligatorio, no
  opcional — a diferencia de `tipo`/`industria`).

- [ ] **Step 1: Tipo `Vertical` y los tres cambios de interfaz**

```ts
// db/src/clientes.ts — agregar cerca del inicio del archivo, junto a los otros tipos exportados
export type Vertical = "restauracion" | "correduria_seguros";
```

```ts
// ClienteCRM (línea ~33-57): agregar el campo, SIN `| null` — a diferencia de las columnas de la 0011,
// esta nunca se enmascara.
export interface ClienteCRM {
  id: string;
  nombre: string;
  vertical: Vertical;
  tipo: string | null;
  // ... el resto sin cambios
}
```

```ts
// NuevoCliente (línea ~69-81): OBLIGATORIO, sin `?`, a diferencia de tipo/industria/etc. — mismo
// criterio "sin default" que la columna: si el llamador no lo manda, es un error de tipos, no un
// insert que caiga en algo implícito.
export interface NuevoCliente {
  nombre: string;
  vertical: Vertical;
  tipo?: string | null;
  // ... el resto sin cambios
}

// CambiosCliente (línea ~89-101): NO gana `vertical`. Su ausencia es la garantía de inmutabilidad a
// nivel de tipo — nadie puede ni intentar compilar un `actualizarCliente(ctx, id, { vertical: ... })`.
```

- [ ] **Step 2: `CLIENTE_CRM_COLS` — `vertical` sin enmascarar**

```ts
// Reemplazar la construcción de CLIENTE_CRM_COLS (línea ~146-156): agregar "vertical" a la lista de
// columnas SIN enmascarar (mismo grupo que "id"/"nombre"/"google_conectado_en" — nunca dentro de
// CLIENTE_CRM_MASKED_COLS).
const CLIENTE_CRM_COLS = [
  "id",
  "nombre",
  "vertical",
  ...Object.entries(CLIENTE_CRM_MASKED_COLS).map(
    ([alias, expr]) => `case when app.es_staff() then ${expr} else null end as ${alias}`,
  ),
  "google_conectado_en",
  "archived_at",
  "created_at",
].join(", ");
```

**No tocar `CLIENTE_CRM_MASKED_COLS` ni `COLUMNAS_EDITABLES`**: `vertical` no entra a ninguna de las
dos — la primera lo dejaría enmascarado (mal), la segunda lo dejaría editable (mal, rompe la
inmutabilidad de Task 1).

- [ ] **Step 3: `crearCliente` exige `vertical`**

```ts
// crearCliente (línea ~225-258): agregar "vertical" a las columnas SIEMPRE insertadas (junto a
// tenant_id/nombre, no a la lista de `opcionales` — es obligatorio, no puede faltar).
async crearCliente(ctx: TenantContext, datos: NuevoCliente): Promise<string> {
  return this.withTenant(ctx, async (tx) => {
    const columnas: string[] = ["tenant_id", "nombre", "vertical"];
    const valores: unknown[] = [ctx.tenantId, datos.nombre, datos.vertical];

    const opcionales: Array<[string, unknown]> = [
      ["tipo", datos.tipo],
      // ... el resto sin cambios
    ];
    // ... el resto del método sin cambios
  });
}
```

- [ ] **Step 4: Tests — rojo primero**

```ts
// db/src/clientes.test.ts — agregar

test("crearCliente exige vertical: TypeScript lo rechaza si falta (verificado en runtime vía cast)", async () => {
  const datosSinVertical = { nombre: "Sin vertical" } as unknown as NuevoCliente;
  await assert.rejects(
    () => clientes.crearCliente(ctx, datosSinVertical),
    /null value in column "vertical"/,
  );
});

test("actualizarCliente ignora `vertical` si viene en cambios — inmutable", async () => {
  const id = await clientes.crearCliente(ctx, { nombre: "Original", vertical: "restauracion" });
  // CambiosCliente no tiene `vertical` en su tipo — este test verifica el comportamiento en runtime
  // por si algún día alguien lo cuela con un `as any`, no solo confiar en el compilador.
  const cambios = { nombre: "Editado", vertical: "correduria_seguros" } as any;
  await clientes.actualizarCliente(ctx, id, cambios);
  const releido = await clientes.obtenerCliente(ctx, id);
  assert.equal(releido!.vertical, "restauracion", "vertical no debe cambiar aunque venga en el body");
});

test("obtenerCliente expone vertical SIN enmascarar para el rol cliente", async () => {
  const id = await clientes.crearCliente(ctx, { nombre: "Cliente", vertical: "correduria_seguros" });
  const clientesRolCliente = new PgClientes(pool, "app_user"); // rol de sesión = 'cliente' en el ctx
  const visto = await clientesRolCliente.obtenerCliente(ctxComoCliente, id);
  assert.equal(visto!.vertical, "correduria_seguros");
  assert.equal(visto!.tipo, null, "tipo CRM sigue enmascarado — solo vertical cambia");
});
```

- [ ] **Step 5: Correr, confirmar rojo, implementar, confirmar verde**

Run: `npm test -w db`
Expected: rojo antes del Step 1-3, verde después.

- [ ] **Step 6: Commit**

```bash
git add db/src/clientes.ts db/src/clientes.test.ts
git commit -m "feat(db): clients.vertical en alta, inmutable, visible al rol cliente"
```

---

## Task 4: `db/src/store.ts` — `ClientRow`/`getClient` ganan `vertical`

**Files:**
- Modify: `db/src/store.ts:191-197` (`ClientRow`), `:1426-1433` (`getClient`)
- Test: el test existente de `getClient` en `db/src/store.test.ts` (agregar el caso, no duplicar setup)

**Interfaces:**
- Consume: `clients.vertical` (Task 1).
- Produce: `ClientRow.vertical: "restauracion" | "correduria_seguros"` — lo necesita `renderStory` (Task
  9) para elegir la receta al publicar.

- [ ] **Step 1: Agregar el campo y la columna al select**

```ts
// db/src/store.ts:191-197
export interface ClientRow {
  id: string;
  nombre: string;
  vertical: "restauracion" | "correduria_seguros";
  storyblok_space_id: string | null;
  business_profile: Record<string, unknown> | null;
}
```

```ts
// db/src/store.ts:1426-1433
async getClient(ctx: TenantContext, clientId: string): Promise<ClientRow | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<ClientRow>(
      "select id, nombre, vertical, storyblok_space_id, business_profile from clients where id = $1",
      [clientId],
    );
    return rows[0] ?? null;
  });
}
```

- [ ] **Step 2: Test — rojo primero, y bajo el rol REAL que usa el orquestador (`app_service`)**

El grant de columna de la Task 1 (`grant select (vertical) on clients to app_service`) solo se ejercita
de verdad si este test corre bajo `app_service`, no bajo un `PgStore` construido con el rol por default
del archivo de test. Confirmar con qué rol se instancia `store` en `db/src/store.test.ts` — si el
`describe`/`before` de este archivo ya usa `app_service` para todo, no hace falta nada extra; si no,
este test necesita su propia instancia de `PgStore` con `rol: "app_service"`.

```ts
// db/src/store.test.ts, junto al test existente de getClient
test("getClient incluye vertical, bajo el rol real app_service", async () => {
  const clientId = await /* helper de creación de cliente ya existente en este archivo, con vertical */;
  const row = await store.getClient(ctx, clientId); // store debe estar instanciado con rol "app_service"
  assert.equal(row!.vertical, "restauracion");
});
```

- [ ] **Step 3: Correr, confirmar rojo → verde**

Run: `npm test -w db`

- [ ] **Step 4: Commit**

```bash
git add db/src/store.ts db/src/store.test.ts
git commit -m "feat(db): ClientRow.vertical, necesario para elegir la receta de render al publicar"
```

---

## Task 5: `db/src/sitios.ts` — `Sitio`/`porDominio` ganan `vertical`

**Files:**
- Modify: `db/src/sitios.ts:21-39` (`Sitio`), la query de `porDominio` (buscar el método en el mismo
  archivo — no se leyó su cuerpo completo en la investigación previa, ubicarlo por `porDominio(` y
  aplicar el mismo criterio que Task 4)
- Test: el test existente de `SitioResolver`/`porDominio`

**Interfaces:**
- Consume: `clients.vertical` (Task 1).
- Produce: `Sitio.vertical: "restauracion" | "correduria_seguros"` — lo necesita el resolver del
  renderizador (Task 9) para elegir slug/JSON-LD/receta de la página pública.

- [ ] **Step 1: Agregar el campo a `Sitio`**

```ts
// db/src/sitios.ts:21-39
export interface Sitio {
  clientId: string;
  domain: string;
  vertical: "restauracion" | "correduria_seguros";
  spaceId: string | null;
  publicToken: string | null;
  previewToken: string | null;
  businessProfile: unknown;
  languageCode: string;
}
```

- [ ] **Step 2: Sumar `vertical` a la query de `porDominio`**

Ubicar el `select` dentro del método `porDominio` (mismo archivo) y agregar `vertical` a la lista de
columnas seleccionadas de `clients`, y al objeto que arma el `Sitio` de retorno.

- [ ] **Step 3: Test — rojo primero**

`porDominio` ya corre bajo `app_render` (`db/src/sitios.ts:97-103`, `set local role` antes de la
query) — este test SÍ ejercita el grant de columna de la Task 1 sin nada extra que instanciar, a
diferencia de la Task 4. Si por algún motivo el `SitioResolver` de este test se construye con otro
rol, corregirlo antes de dar la Task 1 por completa.

```ts
// junto al test existente de porDominio
test("porDominio incluye vertical del cliente (bajo app_render, grant de columna real)", async () => {
  // reusar el setup existente del archivo, creando el cliente con vertical: 'correduria_seguros'
  const sitio = await resolver.porDominio(dominioDePrueba);
  assert.equal(sitio!.vertical, "correduria_seguros");
});
```

- [ ] **Step 4: Correr, confirmar rojo → verde**

Run: `npm test -w db`

- [ ] **Step 5: Commit**

```bash
git add db/src/sitios.ts db/src/sitios.test.ts
git commit -m "feat(db): Sitio.vertical, necesario para el resolver publico del renderizador"
```

---

## Task 6: `web-builder/src/types.ts` + `contract.ts` — `Vertical` y extensión de seguros

**Files:**
- Modify: `web-builder/src/types.ts:301-347` (`BusinessProfile`)
- Modify: `web-builder/src/contract.ts:250-267` (`businessProfileSchema`)
- Test: `web-builder/src/contract.test.ts`

**Interfaces:**
- Produce: `web-builder`'s `Vertical = "restauracion" | "correduria_seguros"`.
- Produce: `BusinessProfile.seguros?: { numeroLicencia?: string; anosExperiencia?: number;
  redAfiliacion?: string }`.

- [ ] **Step 1: Tipo `Vertical` y extensión de `BusinessProfile`**

```ts
// web-builder/src/types.ts — agregar junto a los otros tipos exportados de nivel superior
export type Vertical = "restauracion" | "correduria_seguros";

/** Extensión de perfil de correduría de seguros — solo se puebla/valida/renderiza cuando
 *  `vertical = "correduria_seguros"`. Sacados de dos sitios reales de clientes (jmmoldes.com,
 *  gmsegur.com): número de autorización/clave de corredor, años de trayectoria, red de corredores
 *  afiliada. */
export interface PerfilSeguros {
  numeroLicencia?: string;
  anosExperiencia?: number;
  redAfiliacion?: string;
}
```

```ts
// BusinessProfile (types.ts:301-347) — agregar el campo opcional, junto a `menu`/`menu_categorias`
export interface BusinessProfile {
  name: string;
  // ... campos existentes sin cambios ...
  menu?: MenuItem[];
  menu_categorias?: MenuCategoria[];
  /** Extensión de correduría de seguros — ver `PerfilSeguros`. */
  seguros?: PerfilSeguros;
  // ... resto sin cambios
}
```

- [ ] **Step 2: Zod de `PerfilSeguros` en `contract.ts`**

```ts
// web-builder/src/contract.ts — agregar junto a los otros sub-schemas, antes de businessProfileSchema
// EXPORTADO: lo reusa la API en PATCH /clients/:id/seguros (Task 11), mismo criterio que
// menuPatchSchema.
export const perfilSegurosSchema = z.object({
  numeroLicencia: z.string().optional(),
  anosExperiencia: z.number().int().min(0).optional(),
  redAfiliacion: z.string().optional(),
});
```

```ts
// businessProfileSchema (contract.ts:250-267) — agregar la clave
const businessProfileSchema = z.object({
  name: z.string().min(1),
  // ... campos existentes sin cambios ...
  menu: z.array(menuItemSchema).max(MAX_ITEMS_CARTA).optional(),
  menu_categorias: z.array(menuCategoriaSchema).max(MAX_CATEGORIAS).optional(),
  seguros: perfilSegurosSchema.optional(),
  // ... resto sin cambios
});
```

- [ ] **Step 3: Test — rojo primero**

```ts
// web-builder/src/contract.test.ts
test("parseProfile acepta la extensión de seguros completa", () => {
  const perfil = parseProfile({
    name: "Corredores Ejemplo",
    seguros: { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" },
  });
  assert.deepEqual(perfil.seguros, {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
});

test("parseProfile acepta seguros con campos parciales", () => {
  const perfil = parseProfile({ name: "X", seguros: { numeroLicencia: "J-1" } });
  assert.deepEqual(perfil.seguros, { numeroLicencia: "J-1" });
});

test("parseProfile rechaza anosExperiencia negativo", () => {
  assert.throws(() =>
    parseProfile({ name: "X", seguros: { anosExperiencia: -1 } }),
  );
});
```

- [ ] **Step 4: Correr, confirmar rojo → verde**

Run: `npm test -w web-builder`

- [ ] **Step 5: Commit**

```bash
git add web-builder/src/types.ts web-builder/src/contract.ts web-builder/src/contract.test.ts
git commit -m "feat(web-builder): tipo Vertical y extension de perfil de seguros"
```

---

## Task 7: El render lee `vertical`, no `brand.plantilla`, para elegir la receta

**Files:**
- Modify: `web-builder/src/render/piezas/tipos.ts:53-78` (`CtxPieza`)
- Modify: `web-builder/src/render/plantilla.ts` (todo el archivo — `juegoDe`, `JUEGOS`, nuevo juego
  `SEGUROS`)
- Modify: `web-builder/src/render/lib.ts` (agregar `catalogoSlug`)
- Modify: `web-builder/src/render/json-ld.ts` (agregar `catalogoLd`)
- Modify: `web-builder/src/render/html.ts` (las 4 funciones `render*` ganan `vertical`; `renderMenu` se
  renombra a `renderCatalogo`)
- Modify: `web-builder/src/render/piezas/cabecera.ts:44-54` (`navPrincipal` — el link de catálogo del
  nav público, hoy hardcodeado a `/menu`/"Menú" para cualquier vertical)
- Modify: `web-builder/src/render/piezas/barra-datos.ts:74-96` (dibuja `profile.seguros` cuando aplica
  — sin esto, los tres campos de perfil de seguros nunca llegan al HTML)
- Test: `web-builder/src/render/plantilla.test.ts`, `web-builder/src/render/html.test.ts`

**Interfaces:**
- Consume: `Vertical` (Task 6).
- Produce: `CtxPieza.vertical: Vertical` — cualquier pieza puede leerlo para variar copy (lo usa Task 8).
- Produce: `juegoDe(vertical: Vertical): JuegoDePlantillas` (reemplaza `juegoDe(brand?)`).
- Produce: `catalogoSlug(vertical: Vertical): string` — `"menu"` | `"polizas"`.
- Produce: `catalogoLd(profile, url, grupos): unknown` — siempre `ItemList` (no necesita `vertical`
  como parámetro: quien la llama ya decidió, por vertical, si usa `menuLd` o `catalogoLd`).
- Produce, con las firmas EXACTAS que usa Task 9 (fijadas acá para que no haya una segunda versión
  contradictoria en ningún step de abajo): `renderStory(story, profile, vertical, languageCode?,
  hayBlog?)`, `renderHome(profile, nav, vertical, languageCode?, hayBlog?)`,
  `renderCatalogo(profile, vertical, languageCode?, hayBlog?)` (antes `renderMenu`),
  `renderBlogIndex(profile, blog, vertical, languageCode?)`. Para las tres que ya tenían un segundo
  parámetro de datos (`nav` en `renderHome`, `blog` en `renderBlogIndex`), `vertical` va **después**
  de ese parámetro, no entre `profile` y él — `renderCatalogo` no tiene ese segundo parámetro, así que
  ahí `vertical` va inmediatamente después de `profile`.

- [ ] **Step 1: `CtxPieza.vertical`**

```ts
// web-builder/src/render/piezas/tipos.ts — agregar al final de la interfaz, junto a los otros campos
// que "una pieza puede leer"
export interface CtxPieza {
  story: Story | null;
  profile: BusinessProfile | null;
  activeSlug: string;
  titulo: string;
  bajada: string;
  paginas: NavItem[];
  /** El rubro del cliente dueño del documento. Cualquier pieza puede leerlo para variar su copy
   *  (título de sección, unidad de conteo) sin necesitar una pieza nueva por vertical. */
  vertical: Vertical;
  presupuestoImagenes: PresupuestoImagenes;
  presupuestoVideos: PresupuestoVideos;
}
```

Agregar el import de `Vertical` desde `../../types.js` al inicio del archivo.

- [ ] **Step 2: `plantilla.ts` — `juegoDe(vertical)` y el juego `SEGUROS`**

```ts
// web-builder/src/render/plantilla.ts — reemplazar JUEGOS y juegoDe

const SEGUROS: JuegoDePlantillas = {
  id: "seguros",
  // Sin platosDestacados (restaurante-only): la sección equivalente es la genérica `destacados`.
  story: {
    id: "seguros/story",
    contenido: ["heroSlider", "barraDatos", "seccionProsa", "destacados", "testimonios", "faq", "ctaFinal"],
  },
  home: {
    id: "seguros/home",
    contenido: ["heroSlider", "barraDatos", "bienvenida", "destacados", "testimonios", "indice", "ctaFinal"],
  },
  // `cartaCategorias` dibuja el catálogo de pólizas (misma pieza, generalizada — ver Task 8).
  menu: { id: "seguros/menu", contenido: ["hero", "barraDatos", "cartaCategorias", "ctaFinal"] },
  blog: { id: "seguros/blog", contenido: ["hero", "blogIndice"] },
};

/** Un juego por VERTICAL — ya no por `brand.plantilla`. `brand.plantilla` sigue existiendo en el
 *  perfil para uso de marca (no gobierna la estructura de piezas desde este cambio). */
const JUEGOS: Record<Vertical, JuegoDePlantillas> = {
  restauracion: BASE,
  correduria_seguros: SEGUROS,
};

/** Devuelve el juego de la vertical. Nunca lanza — cualquier valor de `Vertical` tiene su juego. */
export function juegoDe(vertical: Vertical): JuegoDePlantillas {
  return JUEGOS[vertical];
}
```

Agregar el import de `Vertical` desde `../types.js`.

- [ ] **Step 3: `lib.ts` — `catalogoSlug`**

```ts
// web-builder/src/render/lib.ts — agregar junto a SLUG_HOME/SLUG_MENU/SLUG_BLOG
/** El slug público de la página de catálogo, por vertical. `SLUG_MENU` ("menu") se conserva como el
 *  valor de restauración — no se renombra, sería un cambio de URL pública sin motivo para los
 *  clientes ya publicados. */
export function catalogoSlug(vertical: Vertical): string {
  return vertical === "correduria_seguros" ? "polizas" : SLUG_MENU;
}
```

- [ ] **Step 4: `json-ld.ts` — `catalogoLd`**

```ts
// web-builder/src/render/json-ld.ts — agregar junto a menuLd
/** JSON-LD del catálogo para verticales sin un tipo schema.org específico (seguros: no hay `Menu` ni
 *  `Product` correcto para una lista de pólizas — `Product` implicaría venta directa de un bien).
 *  `ItemList` es el genérico correcto para una lista de ofertas. */
export function catalogoLd(
  profile: BusinessProfile,
  url: string,
  grupos: Array<{ categoria: string | null; items: MenuItem[] }>,
  // Sin `vertical`: quien la llama (renderCatalogo) ya decidió por vertical si usa esta función o
  // menuLd — no hace falta que catalogoLd vuelva a mirarlo.
): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    url,
    name: `${profile.name} — catálogo`,
    itemListElement: grupos.flatMap((g) =>
      g.items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
      })),
    ),
  };
}
```

- [ ] **Step 5: `html.ts` — las cuatro funciones ganan `vertical`, `renderMenu` → `renderCatalogo`**

```ts
// web-builder/src/render/html.ts:48-77 — renderStory
export function renderStory(
  story: Story,
  profile: BusinessProfile | null | undefined,
  vertical: Vertical,
  languageCode = "es",
  hayBlog = false,
): string {
  // ... cuerpo sin cambios, salvo:
  receta: juegoDe(vertical).story,
  ctx: ctx({ story, profile: profile ?? null, activeSlug: story.slug, vertical }),
  // ...
}
```

```ts
// html.ts:91-124 — renderHome: `vertical: Vertical` va DESPUÉS de `nav` (el parámetro de datos que ya
// tiene la función), ANTES de `languageCode` — mismo orden que usa la Task 9 al llamarla:
// `renderHome(perfil, indice, sitio!.vertical, sitio!.languageCode, hayBlog)`. Leer la función
// completa antes de aplicar (no estaba en el reporte de investigación previo al plan), usar
// `juegoDe(vertical).home` en vez de `juegoDe(profile?.brand).home`, y sumar `vertical` al
// `ctx({...})` que ya arma la función.
```

```ts
// html.ts:134-159 — renderMenu se renombra a renderCatalogo, gana `vertical`, usa catalogoSlug/
// catalogoLd/juegoDe según vertical
export function renderCatalogo(
  profile: BusinessProfile | null | undefined,
  vertical: Vertical,
  languageCode = "es",
  hayBlog = false,
): string {
  const nombre = profile?.name ?? "Catálogo";
  const items = profile?.menu ?? [];
  const slug = catalogoSlug(vertical);
  const url = urlDeSeccion(profile, slug);
  const esRestauracion = vertical === "restauracion";
  const titulo = esRestauracion ? `Menú · ${nombre}` : `Pólizas y coberturas · ${nombre}`;
  const descripcion = esRestauracion ? `La carta de ${nombre}.` : `Los seguros que ofrece ${nombre}.`;

  return renderDocumento({
    cabeza: {
      lang: languageCode,
      title: titulo,
      description: descripcion,
      canonical: url,
      ogTitle: titulo,
      ...(items.length && profile
        ? {
            jsonLd: esRestauracion
              ? menuLd(profile, url, agruparCarta(items))
              : catalogoLd(profile, url, agruparCarta(items)),
          }
        : {}),
    },
    receta: juegoDe(vertical).menu,
    ctx: ctx({ profile: profile ?? null, activeSlug: slug, titulo, vertical }),
    pie: {
      contractVersion: "web.v0.1",
      schemaType: esRestauracion ? "Menu" : "ItemList",
      hayBlog,
    },
  });
}
```

```ts
// html.ts:168-190 — renderBlogIndex, mismo patrón: agregar `vertical: Vertical`, usar
// `juegoDe(vertical).blog`, sumarlo al ctx.
```

Actualizar el import de `SLUG_MENU` a incluir también `catalogoSlug`, y el de `menuLd` a incluir
`catalogoLd`. Agregar el import de `Vertical` desde `../types.js`.

- [ ] **Step 6: `cabecera.ts` — el link del nav usa `catalogoSlug`/etiqueta por vertical (hallazgo de
  la revisión: sin esto, un sitio de seguros linkea a `/menu`, que da 404)**

```ts
// web-builder/src/render/piezas/cabecera.ts:44-54 — navPrincipal gana un segundo parámetro `vertical`
function navPrincipal(profile: BusinessProfile, vertical: Vertical): ItemNav[] {
  const items: ItemNav[] = [{ href: "/", label: "Inicio", slug: SLUG_HOME }];
  if (profile.menu && profile.menu.length > 0) {
    const slug = catalogoSlug(vertical);
    const label = vertical === "correduria_seguros" ? "Pólizas y coberturas" : "Menú";
    items.push({ href: `/${slug}`, label, slug });
  }
  if (hayUbicaciones(profile)) items.push({ href: "#ubicaciones", label: "Ubicaciones" });
  items.push({ href: "#contacto", label: "Contacto" });
  return items;
}
```

Ubicar (en el mismo archivo, o en `html.ts`/`shell.ts` según dónde se invoque) el sitio donde se llama
`navPrincipal(profile)` hoy y sumarle `ctx.vertical` o el `vertical` que ya tenga disponible esa
función — probablemente la pieza `cabecera` recibe `ctx: CtxPieza` en su `render()`, que desde el
Step 1 de esta misma task ya trae `vertical`. Agregar el import de `catalogoSlug` desde `./lib.js` (o
`../lib.js`, según la profundidad relativa del archivo) y de `Vertical` desde `../../types.js`.

Test — rojo primero:

```ts
// junto al test existente de cabecera/nav
test("navPrincipal linkea /polizas con etiqueta 'Pólizas y coberturas' para seguros", () => {
  const items = navPrincipal(perfilConCatalogo, "correduria_seguros");
  const item = items.find((i) => i.slug === "polizas");
  assert.ok(item);
  assert.equal(item!.href, "/polizas");
  assert.equal(item!.label, "Pólizas y coberturas");
});

test("navPrincipal sigue linkeando /menu con etiqueta 'Menú' para restauración — sin regresión", () => {
  const items = navPrincipal(perfilConCatalogo, "restauracion");
  const item = items.find((i) => i.slug === "menu");
  assert.equal(item!.href, "/menu");
  assert.equal(item!.label, "Menú");
});
```

Run: `npm test -w web-builder`

- [ ] **Step 7: `barra-datos.ts` — dibuja `profile.seguros` cuando el cliente es de esa vertical
  (hallazgo de la revisión: sin esto, licencia/experiencia/red nunca llegan al HTML — "seguros
  funcional de punta a punta" quedaría incumplido)**

```ts
// web-builder/src/render/piezas/barra-datos.ts:74-96 — render() gana los datos de seguros, con el
// mismo patrón de "dato opcional" que ya usan telefono/horario/dirección
render(ctx: CtxPieza): string {
  const profile = ctx.profile;
  if (!profile) return "";
  const { telefono, horario, hayDireccion } = datosAccionables(profile);

  const datos: string[] = [];
  if (telefono) {
    datos.push(
      `    <p class="dato principal"><span class="etiqueta">Teléfono</span><a class="numero" href="${hrefTelefono(telefono)}">${esc(telefono)}</a></p>`,
    );
  }
  if (horario) {
    datos.push(
      `    <p class="dato"><span class="etiqueta">Horario</span><span class="valor">${esc(horario)}</span></p>`,
    );
  }
  if (hayDireccion) {
    datos.push(
      `    <p class="dato"><span class="etiqueta">Dónde</span><a href="#ubicaciones">Cómo llegar</a></p>`,
    );
  }
  // NUEVO: los tres campos de seguros, cada uno independiente — mismo criterio que el resto de esta
  // pieza, un dato ausente no bloquea a los demás. Solo se evalúan para esta vertical: un dato
  // dormido de `profile.seguros` en un perfil de restauración (que no debería existir, pero la
  // allowlist de Postgres ya lo filtraría) tampoco se dibuja acá — defensa en profundidad.
  if (ctx.vertical === "correduria_seguros" && profile.seguros) {
    const { numeroLicencia, anosExperiencia, redAfiliacion } = profile.seguros;
    if (numeroLicencia) {
      datos.push(
        `    <p class="dato"><span class="etiqueta">Nº de corredor</span><span class="valor">${esc(numeroLicencia)}</span></p>`,
      );
    }
    if (typeof anosExperiencia === "number") {
      datos.push(
        `    <p class="dato"><span class="etiqueta">Experiencia</span><span class="valor">${anosExperiencia} años</span></p>`,
      );
    }
    if (redAfiliacion) {
      datos.push(
        `    <p class="dato"><span class="etiqueta">Red</span><span class="valor">${esc(redAfiliacion)}</span></p>`,
      );
    }
  }

  if (datos.length === 0) return "";

  return envolver(
    "p-barraDatos",
    `<section class="seccion"><div class="banda">
  <div class="tarjeta">
${datos.join("\n")}
  </div>
</div></section>`,
  );
},
```

Test — rojo primero:

```ts
test("barraDatos dibuja licencia/experiencia/red para un cliente de seguros", () => {
  const ctx = ctxDePrueba({ vertical: "correduria_seguros", profile: perfilConSeguros });
  const html = barraDatos.render(ctx);
  assert.ok(html.includes("Nº de corredor"));
  assert.ok(html.includes("J-1479"));
  assert.ok(html.includes("35 años"));
  assert.ok(html.includes("E2K"));
});

test("barraDatos NO dibuja campos de seguros para un cliente de restauración", () => {
  const ctx = ctxDePrueba({ vertical: "restauracion", profile: perfilConTelefono });
  const html = barraDatos.render(ctx);
  assert.ok(!html.includes("Nº de corredor"));
});
```

Run: `npm test -w web-builder`

- [ ] **Step 8: Tests — rojo primero, para `plantilla.ts` y `html.ts`**

```ts
// web-builder/src/render/plantilla.test.ts
test("juegoDe('correduria_seguros') devuelve el juego SEGUROS, sin platosDestacados/cartaCategorias-only", () => {
  const juego = juegoDe("correduria_seguros");
  assert.equal(juego.id, "seguros");
  assert.ok(!juego.story.contenido.includes("platosDestacados"));
});

test("juegoDe('restauracion') sigue devolviendo BASE, sin regresión", () => {
  const juego = juegoDe("restauracion");
  assert.equal(juego.id, "base");
});
```

```ts
// web-builder/src/render/html.test.ts
test("renderCatalogo para restauración: slug /menu, JSON-LD Menu", () => {
  const html = renderCatalogo(perfilConMenu, "restauracion");
  assert.ok(html.includes('"@type":"Menu"') || html.includes('"@type": "Menu"'));
  assert.ok(html.includes("Menú ·"));
});

test("renderCatalogo para seguros: slug /polizas, JSON-LD ItemList, título distinto", () => {
  const html = renderCatalogo(perfilConPolizas, "correduria_seguros");
  assert.ok(html.includes('"@type":"ItemList"') || html.includes('"@type": "ItemList"'));
  assert.ok(html.includes("Pólizas y coberturas ·"));
  assert.ok(!html.includes("La carta de"));
});
```

- [ ] **Step 9: Correr todos los tests de `web-builder`, arreglar cada call site que rompa la firma**

Run: `npm test -w web-builder`
Expected: los tests existentes que llamaban `renderStory(story, profile, lang)`,
`renderMenu(profile, lang)`, `navPrincipal(profile)`, etc. sin `vertical` van a fallar por firma —
actualizar cada uno agregando `"restauracion"` (o el vertical que corresponda al fixture) como
argumento. Es trabajo mecánico pero real: recorrer cada fallo de tipos/test uno por uno hasta verde.

- [ ] **Step 10: Commit**

```bash
git add web-builder/src/render/piezas/tipos.ts web-builder/src/render/plantilla.ts \
        web-builder/src/render/lib.ts web-builder/src/render/json-ld.ts web-builder/src/render/html.ts \
        web-builder/src/render/piezas/cabecera.ts web-builder/src/render/piezas/barra-datos.ts \
        web-builder/src/render/plantilla.test.ts web-builder/src/render/html.test.ts
git commit -m "feat(web-builder): receta, nav y datos de contacto se eligen por vertical, no por brand.plantilla"
```

---

## Task 8: `cartaCategorias` — copy Y CAMPOS dependientes de `ctx.vertical`

**Files:**
- Modify: `web-builder/src/render/piezas/carta-categorias.ts:135-153` (método `render`), `:274-292`
  (`unaCategoria`), `:294-312` (`unPlato`)
- Test: `web-builder/src/render/piezas/piezas-foto.test.ts` (o el archivo de test específico de esta
  pieza, si existe uno separado — verificar antes de agregar)

**Interfaces:**
- Consume: `CtxPieza.vertical` (Task 7).

**Por qué esta task no es solo copy (corregido tras la revisión):** la versión anterior de este plan
solo cambiaba el título y la unidad de conteo, pero `unPlato()` seguía emitiendo `video`/`alergenos`/
`etiquetas`/`nutricion` sin mirar la vertical. En el camino normal de producción Postgres ya los quita
antes de que lleguen (Task 2), pero `renderCatalogo`/`cartaCategorias` aceptan un `BusinessProfile`
directamente — un test, el CLI de `web-builder/src/cli/build.ts` con un `business-profile.json` a
mano, o un consumidor futuro pueden saltarse la columna generada. Es la misma defensa en profundidad
que ya aplica `renderer/src/perfil.ts` (revalida aunque el Zod ya validó): el render no puede confiar
en que SIEMPRE alguien más ya filtró.

- [ ] **Step 1: Copy por vertical en `render()` y en el conteo de `unaCategoria`**

```ts
// carta-categorias.ts:135-153 — render()
render(ctx: CtxPieza): string {
  const profile = ctx.profile;
  if (!profile || !profile.menu || profile.menu.length === 0) return "";

  const esSeguros = ctx.vertical === "correduria_seguros";
  const antetitulo = esSeguros ? "Lo que ofrecemos" : "Nuestra carta";
  const titulo = esSeguros ? "Pólizas y coberturas" : "Lo que se cocina hoy";

  const bloques = gruposDe(profile)
    .map((g) => unaCategoria(g, ctx.presupuestoImagenes, ctx.presupuestoVideos, esSeguros))
    .join("\n");
  return envolver(
    "p-cartaCategorias",
    `<section class="seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">${esc(antetitulo)}</p><h2>${esc(titulo)}</h2></div>
${bloques}
</div></section>`,
  );
},
```

```ts
// unaCategoria (línea ~274-292) gana un cuarto parámetro `esSeguros: boolean` y lo usa solo para la
// unidad del conteo — el resto de la función no cambia.
function unaCategoria(
  g: GrupoCarta,
  presupuesto: PresupuestoImagenes,
  presupuestoVideos: PresupuestoVideos,
  esSeguros: boolean,
): string {
  const foto = renderImagen(comoImagen(g.foto), "categoria-img", presupuesto);
  // esSeguros viaja también a unPlato — no solo para el conteo. Ver Step 1b.
  const filas = g.items.map((it) => unPlato(it, presupuesto, presupuestoVideos, esSeguros)).join("\n");
  const n = g.items.length;
  const unidad = esSeguros ? (n === 1 ? "póliza" : "pólizas") : n === 1 ? "plato" : "platos";
  const conteo = `<p class="conteo">${n} ${unidad}</p>`;
  const cabecera = g.categoria
    ? `<header class="cab ${foto ? "con-img" : "sin-img"}">${foto}<h3>${esc(g.categoria)}</h3>${conteo}</header>`
    : "";
  return `<section class="categoria">
  ${cabecera}
  <ul class="platos">
${filas}
  </ul>
</section>`;
}
```

Se necesita `esc` importado en el `render()` si no lo está ya (chequear el import existente del
archivo — `esc` ya se usa más abajo en el mismo archivo, así que probablemente ya está importado).

- [ ] **Step 1b: `unPlato()` deja de emitir campos de restauración para seguros — el fix real de esta
  task, no solo el copy**

```ts
// carta-categorias.ts:294-312 — unPlato gana el cuarto parámetro `esSeguros: boolean`
function unPlato(
  it: MenuItem,
  presupuesto: PresupuestoImagenes,
  presupuestoVideos: PresupuestoVideos,
  esSeguros: boolean,
): string {
  // El video reemplaza a la foto en la miniatura si el plato tiene los dos — pero solo para
  // restauración: seguros nunca dibuja video, alérgenos, etiquetas ni nutrición, aunque el objeto
  // `it` los trajera (defensa en profundidad, ver el docblock de la task).
  const video = esSeguros ? "" : renderVideo(comoVideo(it.video), "plato-foto", presupuestoVideos, presupuesto);
  const foto = video ? "" : renderImagen(comoImagen(it.foto), "plato-foto", presupuesto);
  const nota = it.nota ? `<span class="nota">${esc(it.nota)}</span>` : "";
  const alergenos = esSeguros ? "" : alergenosDe(it);
  const etiquetas = esSeguros ? "" : etiquetasDe(it);
  const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
  const nutricion = esSeguros ? "" : nutricionDe(it);
  const precios = preciosDe(it)
    .map(
      (p) =>
        `<span class="precio">${p.etiqueta ? `<span class="etiqueta">${esc(p.etiqueta)}</span>` : ""}${esc(p.importe)}${p.comensales ? ` <span class="comensales">(${esc(p.comensales)})</span>` : ""}</span>`,
    )
    .join("");
  return `    <li><div class="fila">${video || foto}<div class="datos"><p class="nombre">${esc(it.name)}${nota}</p>${alergenos}${etiquetas}${desc}${nutricion}</div>${precios ? `<p class="precios">${precios}</p>` : ""}</div></li>`;
}
```

- [ ] **Step 2: Test — rojo primero, copy Y campos**

```ts
test("cartaCategorias: copy de restauración por default, con video/alergenos/etiquetas/nutricion", () => {
  const ctx = ctxDePrueba({ vertical: "restauracion", profile: perfilConMenuEnriquecido });
  const html = cartaCategorias.render(ctx);
  assert.ok(html.includes("Nuestra carta"));
  assert.ok(html.includes("platos") || html.includes("plato"));
  assert.ok(html.includes("Contiene:")); // alergenosDe()
  assert.ok(html.includes('class="tag"')); // etiquetasDe()
});

test("cartaCategorias: copy de seguros, SIN video/alergenos/etiquetas/nutricion aunque el ítem los traiga", () => {
  // El perfil trae, A PROPÓSITO, un ítem con alergenos/video cargados (dato dormido/mal asignado) —
  // esta pieza tiene que descartarlos igual que Postgres, no confiar en que ya lo hicieron.
  const ctx = ctxDePrueba({ vertical: "correduria_seguros", profile: perfilPolizasConDatosDormidos });
  const html = cartaCategorias.render(ctx);
  assert.ok(html.includes("Pólizas y coberturas"));
  assert.ok(html.includes("pólizas") || html.includes("póliza"));
  assert.ok(!html.includes("Nuestra carta"));
  assert.ok(!html.includes("Contiene:"));
  assert.ok(!html.includes('class="tag"'));
  assert.ok(!html.includes('class="nutricion"'));
  assert.ok(!html.includes("<video"));
});
```

(Usar el helper de construcción de `CtxPieza` que ya exista en el archivo de test de piezas —
`ctxDePrueba` es un nombre de ejemplo, ajustar al real.)

- [ ] **Step 3: Correr, confirmar rojo → verde**

Run: `npm test -w web-builder`

- [ ] **Step 4: Commit**

```bash
git add web-builder/src/render/piezas/carta-categorias.ts web-builder/src/render/piezas/piezas-foto.test.ts
git commit -m "feat(web-builder): cartaCategorias varia su copy por vertical (menu vs polizas)"
```

---

## Task 9: Propagar `vertical` en los call sites de producción

> ⚠️ **Depende del sub-proyecto 2 ya implementado.** Reescrita entera durante la revisión conjunta de
> los tres sub-proyectos (2026-08-26): la versión anterior apuntaba a
> `orchestrator/src/workflow.ts:342-346`, la construcción de `deps.publicar(...)` dentro de
> `workflowResearch` — **código que el plan del sub-proyecto 2 retira por completo** (el mecanismo de
> aprobación-y-publicación-inline se reemplaza por `workflowDecision`, disparada por un evento
> separado). Ese mismo `deps.publicar(briefValidado, { clientId, storyblokSpaceId, perfil })` sigue
> existiendo, pero se mudó — casi textual, SIN `vertical` — a la rama `decision.destino === "crear_web"`
> de `workflowDecision`
> (`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md:1118-1123` en el plan de ese sub-proyecto).
> Esta task ahora edita esa rama, buscándola por CONTENIDO — no por número de línea, porque el archivo
> real después de implementar el sub-proyecto 2 no tiene el mismo aspecto que tiene hoy.
>
> Antes de empezar, confirmá la precondición:
> ```bash
> grep -n "export async function workflowDecision" orchestrator/src/workflow.ts
> grep -n 'decision.destino === "crear_web"' orchestrator/src/workflow.ts
> ```
> Si ninguna de las dos aparece, PARÁ ACÁ — el sub-proyecto 2 todavía no está implementado.

**Files:**
- Modify: `renderer/src/app.ts:305-438` (el resolver — slug dinámico, `renderHome`/`renderCatalogo`/
  `renderBlogIndex` con `vertical`)
- Modify: `orchestrator/src/workflow.ts` — la interfaz `DestinoPublicacion` (buscarla por nombre, no por
  línea: puede haberse corrido unas pocas líneas por los cambios del sub-proyecto 2, pero el sub-proyecto
  2 no la toca, así que sigue existiendo con su forma actual) gana `vertical`; y la rama
  `decision.destino === "crear_web"` de `workflowDecision` (introducida por el sub-proyecto 2 — NO
  existe en el archivo hasta que ese sub-proyecto se implementa), donde ahora vive la construcción del
  objeto que recibe `deps.publicar`.
- Modify: `orchestrator/src/deps.ts:183-191` (`renderStory` con `destino.vertical`, ahora que existe)
- Modify: `web-builder/src/cli/build.ts:90-100` (`renderStory` con `vertical` — el CLI necesita pedirlo
  por flag, validado contra el enum)
- Test: `renderer/src/app.test.ts`, `orchestrator/src/workflow.test.ts` (la rama `crear_web` de
  `workflowDecision`, con el setup que el sub-proyecto 2 ya haya dejado ahí — mismo criterio que usa la
  Task 8 del plan del sub-proyecto 3 para su propia rama `crear_posts`), y los tests existentes de
  `web-builder/cli` que cubran estos call sites

**Interfaces:**
- Consume: `Sitio.vertical` (Task 5), `ClientRow.vertical` (Task 4), `renderStory`/`renderHome`/
  `renderCatalogo`/`renderBlogIndex` con `vertical` (Task 7), `workflowDecision` y su rama `crear_web`
  (sub-proyecto 2, ya implementado — ver la precondición arriba).
- Produce: `DestinoPublicacion.vertical: "restauracion" | "correduria_seguros"`.

- [ ] **Step 1: `renderer/src/app.ts` — el resolver usa `sitio.vertical`**

```ts
// renderer/src/app.ts:384-399 — reemplazar el bloque, calculando el slug de catálogo dinámicamente
const slugCatalogo = catalogoSlug(sitio!.vertical);

if (slug === SLUG_HOME) {
  const slugsBlog = new Set(blog.map((b) => b.slug));
  const indice = nav.filter(
    (n) => n.slug !== SLUG_HOME && n.slug !== SLUG_BLOG && n.slug !== slugCatalogo && !slugsBlog.has(n.slug),
  );
  return conBridge(renderHome(perfil, indice, sitio!.vertical, sitio!.languageCode, hayBlog));
}
if (slug === slugCatalogo && perfil?.menu?.length) {
  return conBridge(renderCatalogo(perfil, sitio!.vertical, sitio!.languageCode, hayBlog));
}
if (slug === SLUG_BLOG && hayBlog) {
  return conBridge(renderBlogIndex(perfil, blog, sitio!.vertical, sitio!.languageCode));
}
return null;
```

Actualizar el import de `renderMenu` → `renderCatalogo`, y sumar `catalogoSlug` al import desde
`web-builder`. Buscar también cualquier otra llamada a `renderStory` en el mismo archivo (para páginas
de tipo story) y sumarle `sitio!.vertical`.

- [ ] **Step 2: `orchestrator/src/workflow.ts` — `DestinoPublicacion` gana `vertical`, y su construcción
  (ahora dentro de `workflowDecision`, sub-proyecto 2) la propaga desde el cliente**

```ts
// orchestrator/src/workflow.ts — buscar `export interface DestinoPublicacion` (el sub-proyecto 2 no
// la toca, sigue teniendo esta forma con las tres propiedades de abajo; agregarle `vertical`):
export interface DestinoPublicacion {
  clientId: string;
  vertical: "restauracion" | "correduria_seguros";
  storyblokSpaceId: string | null;
  perfil: Record<string, unknown> | null;
}
```

```ts
// orchestrator/src/workflow.ts — buscar `if (decision.destino === "crear_web")` dentro de
// `workflowDecision` (la introduce el sub-proyecto 2 — no existe hasta que ese plan se ejecuta). La
// construcción del objeto que recibe `deps.publicar` queda así (ver el plan del sub-proyecto 2,
// Task de workflowDecision, líneas ~1118-1123, para el resto de la rama sin tocar):
const resultados = await deps.publicar(briefValidado, {
  clientId: cliente.id,
  vertical: cliente.vertical,
  storyblokSpaceId: cliente.storyblok_space_id,
  perfil: cliente.business_profile,
});
```

`cliente` en ese punto es el `ClientRow` que devolvió `deps.store.getClient(ctx, decision.client_id)`
— ya tiene `vertical` desde la Task 4 de este mismo plan, así que agregarlo a la llamada es el único
cambio; nada más de la rama `crear_web` se toca.

Test — rojo primero:

```ts
// orchestrator/src/workflow.test.ts — junto a los tests existentes de la rama crear_web de
// workflowDecision (sub-proyecto 2 ya los dejó ahí, con su propio patrón de setup —
// crearRunConPaginaAprobada + store.registrarDecision + workflowDecision(new MotorPasos(), {...},
// deps) — seguilo, no inventes un helper nuevo)
test("workflowDecision: crear_web propaga la vertical del cliente a deps.publicar", async () => {
  // seguir el setup existente del archivo, con un cliente de vertical: 'correduria_seguros'
  // verificar que deps.publicar recibe { ..., vertical: 'correduria_seguros' } — con un spy/mock de
  // deps.publicar, mismo patrón que ya use el resto de este archivo para espiar la llamada.
});
```

Run: `npm test -w orchestrator`

- [ ] **Step 3: `orchestrator/src/deps.ts` — `renderStory` con `destino.vertical`, que ahora sí existe**

`deps.ts` (a diferencia de `workflow.ts`) no lo toca el sub-proyecto 2 — la función `publicar:` que
arma `crearDeps()` sigue en el mismo lugar, solo cambia QUIÉN la llama. Las líneas de referencia
(~183-191) siguen siendo válidas, pero confirmá contra el archivo real antes de editar, no asumas.

```ts
// orchestrator/src/deps.ts — dentro de la función publicar: que arma crearDeps()
const perfil = perfilDelCliente(destino.perfil);

await applyProse(stories, brief, perfil);
const html = new Map(
  stories.map((s) => [s.slug, renderStory(s, perfil, destino.vertical, brief.market.language_code)]),
);
```

- [ ] **Step 4: `web-builder/src/cli/build.ts` — `renderStory` con la vertical del flag, VALIDADA**

El CLI arma `profile` desde un JSON en disco (no desde la base) — no tiene ningún `ClientRow`. Sumar
`vertical` como campo del `business-profile.json` mezclaría un atributo de `clients` con el perfil, así
que se lee de un flag nuevo — **validado contra el enum, no casteado a ciegas** (corrección de la
revisión: un `--vertical=lo-que-sea` no puede llegar a `juegoDe` sin control).

```ts
// web-builder/src/cli/build.ts — leer y validar el flag antes del bloque existente
const VERTICALES_VALIDAS = new Set<Vertical>(["restauracion", "correduria_seguros"]);

function leerVertical(): Vertical {
  const raw = process.argv.find((a) => a.startsWith("--vertical="))?.split("=")[1];
  if (raw === undefined) return "restauracion"; // default explícito, herramienta de dev local
  if (!VERTICALES_VALIDAS.has(raw as Vertical)) {
    throw new Error(`--vertical inválida: "${raw}". Valores válidos: ${[...VERTICALES_VALIDAS].join(", ")}`);
  }
  return raw as Vertical;
}

const vertical = leerVertical();
console.log(`  [vertical] ${vertical}`);

const filled = await applyProse(stories, brief, profile);
console.log(`  [prose] ${filled}/${stories.length} página(s) redactada(s) (${config.prose.mode})`);

const html = new Map(
  stories.map((s) => [s.slug, renderStory(s, profile, vertical, brief.market.language_code)]),
);
```

Test — rojo primero, las tres direcciones (valor válido, inválido, ausente):

```ts
test("leerVertical: default 'restauracion' sin flag", () => {
  assert.equal(leerVertical([]), "restauracion");
});
test("leerVertical: acepta 'correduria_seguros'", () => {
  assert.equal(leerVertical(["--vertical=correduria_seguros"]), "correduria_seguros");
});
test("leerVertical: rechaza un valor fuera del enum", () => {
  assert.throws(() => leerVertical(["--vertical=peluqueria"]), /inválida/);
});
```

(Si `leerVertical` no recibe `process.argv` como parámetro en la implementación real de arriba, ajustar
la función para que sea testeable — recibir el array en vez de leer `process.argv` directamente, mismo
criterio que cualquier función pura del proyecto.)

- [ ] **Step 5: Tests — rojo primero para `renderer/src/app.test.ts`**

```ts
test("resolver sirve /polizas (no /menu) para un cliente de vertical correduria_seguros", async () => {
  // seguir el patrón de setup existente del archivo: crear un cliente con vertical:
  // 'correduria_seguros' y business_profile.menu poblado, pedir GET /polizas, esperar 200 con el
  // título "Pólizas y coberturas".
});

test("resolver sirve /menu (no /polizas) para un cliente de vertical restauracion — sin regresión", async () => {
  // mismo patrón, vertical: 'restauracion', GET /menu debe seguir funcionando como antes.
});
```

- [ ] **Step 6: Correr todos los tests afectados, confirmar verde**

Run: `npm test -w renderer -w orchestrator -w web-builder`

- [ ] **Step 7: Commit**

```bash
git add renderer/src/app.ts orchestrator/src/workflow.ts orchestrator/src/deps.ts \
        web-builder/src/cli/build.ts renderer/src/app.test.ts orchestrator/src/workflow.test.ts
git commit -m "feat: propaga vertical del cliente a los 4 puntos de render de produccion, DestinoPublicacion incluido"
```

---

## Task 10: `renderer/src/perfil.ts` — validar la extensión de seguros (frontera 3)

**Files:**
- Modify: `renderer/src/perfil.ts:415-444` (`perfilValido`)
- Test: `renderer/src/perfil.test.ts`

**Interfaces:**
- Consume: `PerfilSeguros` (Task 6, importado de `web-builder`).
- Produce: `perfilValido` conserva `perfil.seguros` cuando está presente y bien formado.

- [ ] **Step 1: Validador `seguros()` y su uso en `perfilValido`**

```ts
// renderer/src/perfil.ts — agregar junto a los otros validadores de sub-objeto (cerca de `nutricion`)
/** La extensión de seguros. Cada clave sobrevive sola, mismo criterio que `nutricion`/`locales`.
 *  `anosExperiencia` replica la misma regla que ya impone el Zod de `contract.ts` (`.int().min(0)`,
 *  Task 6) — un entero negativo o decimal salido de Postgres sin pasar por Zod tiene que descartarse
 *  acá igual, no solo confiar en que la frontera 1 ya lo filtró (corrección de la revisión). */
function seguros(v: unknown): BusinessProfile["seguros"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: NonNullable<BusinessProfile["seguros"]> = {};
  if (texto(o["numeroLicencia"])) out.numeroLicencia = texto(o["numeroLicencia"]);
  const anos = o["anosExperiencia"];
  if (typeof anos === "number" && Number.isInteger(anos) && anos >= 0) out.anosExperiencia = anos;
  if (texto(o["redAfiliacion"])) out.redAfiliacion = texto(o["redAfiliacion"]);
  return Object.keys(out).length ? out : undefined;
}
```

```ts
// perfilValido (línea ~426-443) — agregar la línea junto a las demás claves opcionales
return {
  name,
  // ... claves existentes sin cambios ...
  ...(testimonios(p["testimonios"]) ? { testimonios: testimonios(p["testimonios"]) } : {}),
  ...(seguros(p["seguros"]) ? { seguros: seguros(p["seguros"]) } : {}),
};
```

- [ ] **Step 2: Test — rojo primero**

```ts
test("perfilValido conserva seguros con los tres campos", () => {
  const perfil = perfilValido({
    name: "X",
    seguros: { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" },
  });
  assert.deepEqual(perfil!.seguros, {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
});

test("perfilValido descarta seguros mal formado sin tirar el resto del perfil", () => {
  const perfil = perfilValido({ name: "X", seguros: "no es un objeto" });
  assert.equal(perfil!.seguros, undefined);
  assert.equal(perfil!.name, "X");
});

test("perfilValido descarta anosExperiencia negativo, conserva los otros dos campos", () => {
  const perfil = perfilValido({
    name: "X",
    seguros: { numeroLicencia: "J-1", anosExperiencia: -5, redAfiliacion: "E2K" },
  });
  assert.deepEqual(perfil!.seguros, { numeroLicencia: "J-1", redAfiliacion: "E2K" });
});

test("perfilValido descarta anosExperiencia decimal", () => {
  const perfil = perfilValido({ name: "X", seguros: { anosExperiencia: 4.5 } });
  assert.equal(perfil!.seguros, undefined);
});
```

- [ ] **Step 3: Correr, confirmar rojo → verde**

Run: `npm test -w renderer`

- [ ] **Step 4: Commit**

```bash
git add renderer/src/perfil.ts renderer/src/perfil.test.ts
git commit -m "feat(renderer): perfilValido conserva la extension de perfil de seguros"
```

---

## Task 11: API — `POST /clients` exige `vertical`, + endpoint de perfil de seguros

**Files:**
- Modify: `api/src/app.ts:396-407` (`POST /clients`), `:916-935` (`filtrarCamposCliente`)
- Modify: `db/src/clientes.ts` (nuevos métodos `obtenerPerfilSeguros`/`actualizarPerfilSeguros` en
  `PgClientes` — agregado tras la revisión: hacía falta un mecanismo de escritura para
  `business_profile.seguros` que hoy no existe en ningún lado, ver hallazgo "Task 14 supone un editor
  que no existe")
- Test: `api/src/app.test.ts`, `db/src/clientes.test.ts`

**Interfaces:**
- Consume: `NuevoCliente.vertical` (Task 3).
- Produce: `POST /clients` responde 400 si falta `vertical` o no es uno de los dos valores válidos.
- Produce: `PgClientes.obtenerPerfilSeguros(ctx, id): Promise<PerfilSeguros | null>`,
  `PgClientes.actualizarPerfilSeguros(ctx, id, datos: PerfilSeguros): Promise<boolean>` — mismo patrón
  que `obtenerMenu`/`actualizarMenu` (Task existente en `db/src/clientes.ts:297-342`): lee/escribe SOLO
  la clave `seguros` de `business_profile`, con `coalesce(business_profile, '{}'::jsonb)` para el
  cliente recién creado.
- Produce: `GET`/`PATCH /clients/:id/seguros` en la API, validados con `perfilSegurosSchema` (Task 6).

- [ ] **Step 1: `filtrarCamposCliente` acepta `vertical` en el body — pero solo lo LEE, no lo hace
  editable (`CambiosCliente` no lo tiene, así que aunque esta función lo devolviera no hay dónde
  ponerlo en un `PATCH`; para `POST` se necesita una función/rama separada)**

Dado que `filtrarCamposCliente` alimenta tanto `POST` (necesita `vertical`) como `PATCH` (no debe
aceptar `vertical`, es inmutable), **no** se agrega `vertical` a esa función compartida — se lee aparte,
solo en el handler de `POST`:

```ts
// api/src/app.ts:396-407 — POST /clients
const VERTICALES_VALIDAS = new Set(["restauracion", "correduria_seguros"]);

app.post("/clients", async (c) => {
  const ctx = c.get("ctx");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);
  const campos = filtrarCamposCliente(body);
  if (typeof campos.nombre !== "string") {
    return c.json({ error: "Se requiere nombre (string)." }, 400);
  }
  const vertical = (body as Record<string, unknown>)["vertical"];
  if (typeof vertical !== "string" || !VERTICALES_VALIDAS.has(vertical)) {
    return c.json({ error: "Se requiere vertical: 'restauracion' o 'correduria_seguros'." }, 400);
  }
  const id = await deps.clientes.crearCliente(ctx, {
    ...campos,
    nombre: campos.nombre,
    vertical: vertical as "restauracion" | "correduria_seguros",
  });
  return c.json({ id }, 201);
});
```

`VERTICALES_VALIDAS` se define una sola vez (junto a `ROLES_ASIGNABLES`, mismo criterio de allowlist
positiva en el borde HTTP) y se comenta explícitamente: **`PATCH /clients/:id` sigue usando
`filtrarCamposCliente` sin tocar, que no conoce `vertical` — así que un body de `PATCH` que la incluya
la ignora en silencio, mismo comportamiento que cualquier otra clave desconocida.**

- [ ] **Step 2: Tests — rojo primero**

```ts
test("POST /clients sin vertical responde 400", async () => {
  const res = await app.request("/clients", {
    method: "POST",
    headers: cabecerasStaff,
    body: JSON.stringify({ nombre: "Sin vertical" }),
  });
  assert.equal(res.status, 400);
});

test("POST /clients con vertical inválida responde 400", async () => {
  const res = await app.request("/clients", {
    method: "POST",
    headers: cabecerasStaff,
    body: JSON.stringify({ nombre: "X", vertical: "peluqueria" }),
  });
  assert.equal(res.status, 400);
});

test("POST /clients con vertical válida crea el cliente", async () => {
  const res = await app.request("/clients", {
    method: "POST",
    headers: cabecerasStaff,
    body: JSON.stringify({ nombre: "Corredores X", vertical: "correduria_seguros" }),
  });
  assert.equal(res.status, 201);
});

test("PATCH /clients/:id ignora vertical en el body — inmutable en el borde HTTP", async () => {
  const id = await crearClientePrueba({ vertical: "restauracion" });
  await app.request(`/clients/${id}`, {
    method: "PATCH",
    headers: cabecerasStaff,
    body: JSON.stringify({ vertical: "correduria_seguros" }),
  });
  const { cliente } = await (
    await app.request(`/clients/${id}`, { headers: cabecerasStaff })
  ).json();
  assert.equal(cliente.vertical, "restauracion");
});
```

- [ ] **Step 3: Correr, confirmar rojo → verde**

Run: `npm test -w api`

- [ ] **Step 4: `PgClientes.obtenerPerfilSeguros`/`actualizarPerfilSeguros` — mismo molde que
  `obtenerMenu`/`actualizarMenu`**

```ts
// db/src/clientes.ts — agregar junto a obtenerMenu/actualizarMenu (línea ~297-342)

/** La extensión de perfil de seguros: `numeroLicencia`/`anosExperiencia`/`redAfiliacion`, tal como
 *  vive dentro de `business_profile.seguros`. `null` si el cliente no la tiene cargada — nunca un
 *  objeto vacío a medias, mismo criterio que el resto de esta clase. */
async obtenerPerfilSeguros(
  ctx: TenantContext,
  id: string,
): Promise<Record<string, unknown> | null> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ seguros: Record<string, unknown> | null }>(
      `select business_profile -> 'seguros' as seguros from clients where id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    return rows[0]!.seguros ?? null;
  });
}

/** Reemplaza SOLO la clave `seguros` dentro de `business_profile`, sin tocar ninguna otra clave del
 *  perfil — mismo mecanismo que `actualizarMenu`, incluido el `coalesce` para el cliente recién
 *  creado cuya columna es NULL. */
async actualizarPerfilSeguros(
  ctx: TenantContext,
  id: string,
  datos: Record<string, unknown>,
): Promise<boolean> {
  return this.withTenant(ctx, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `update clients
       set business_profile = coalesce(business_profile, '{}'::jsonb)
         || jsonb_build_object('seguros', $1::jsonb)
       where id = $2
       returning id`,
      [JSON.stringify(datos), id],
    );
    return rows.length > 0;
  });
}
```

Test — rojo primero:

```ts
// db/src/clientes.test.ts
test("actualizarPerfilSeguros reemplaza SOLO seguros, preserva el resto de business_profile", async () => {
  const id = await clientes.crearCliente(ctx, { nombre: "Corredores X", vertical: "correduria_seguros" });
  // Precondición: el cliente ya tiene otro campo de perfil (name) que no debe perderse.
  await pool.query("update clients set business_profile = '{\"name\":\"Corredores X\"}'::jsonb where id = $1", [id]);

  const ok = await clientes.actualizarPerfilSeguros(ctx, id, {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
  assert.ok(ok);

  const { rows } = await pool.query<{ business_profile: any }>(
    "select business_profile from clients where id = $1",
    [id],
  );
  assert.equal(rows[0]!.business_profile.name, "Corredores X", "el resto del perfil sobrevive");
  assert.deepEqual(rows[0]!.business_profile.seguros, {
    numeroLicencia: "J-1479",
    anosExperiencia: 35,
    redAfiliacion: "E2K",
  });
});

test("obtenerPerfilSeguros devuelve null si el cliente no tiene la clave cargada", async () => {
  const id = await clientes.crearCliente(ctx, { nombre: "Sin seguros", vertical: "correduria_seguros" });
  const seguros = await clientes.obtenerPerfilSeguros(ctx, id);
  assert.equal(seguros, null);
});
```

Run: `npm test -w db`

- [ ] **Step 5: `GET`/`PATCH /clients/:id/seguros` en la API**

```ts
// api/src/app.ts — junto a los endpoints de /menu, mismo patrón
app.get("/clients/:id/seguros", async (c) => {
  const ctx = c.get("ctx");
  const seguros = await deps.clientes.obtenerPerfilSeguros(ctx, c.req.param("id"));
  return c.json({ seguros });
});

app.patch("/clients/:id/seguros", async (c) => {
  const ctx = c.get("ctx");
  const body = await c.req.json().catch(() => null);
  const parsed = perfilSegurosSchema.safeParse(body);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => ({ ruta: i.path.join("."), mensaje: i.message }));
    return c.json({ error: "El perfil de seguros no es válido.", campos }, 400);
  }
  const ok = await deps.clientes.actualizarPerfilSeguros(ctx, c.req.param("id"), parsed.data);
  return ok ? c.json({ ok: true }) : c.json({ error: "Cliente no encontrado." }, 404);
});
```

Importar `perfilSegurosSchema` desde `web-builder/contract` (mismo import que ya usa `menuPatchSchema`
en este archivo — habrá que exportarlo desde `contract.ts` si el Task 6 no lo dejó exportado).

Test — rojo primero:

```ts
test("PATCH /clients/:id/seguros guarda los tres campos", async () => {
  const id = await crearClientePrueba({ vertical: "correduria_seguros" });
  const res = await app.request(`/clients/${id}/seguros`, {
    method: "PATCH",
    headers: cabecerasStaff,
    body: JSON.stringify({ numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" }),
  });
  assert.equal(res.status, 200);
  const { seguros } = await (await app.request(`/clients/${id}/seguros`, { headers: cabecerasStaff })).json();
  assert.deepEqual(seguros, { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" });
});

test("PATCH /clients/:id/seguros con anosExperiencia negativo responde 400", async () => {
  const id = await crearClientePrueba({ vertical: "correduria_seguros" });
  const res = await app.request(`/clients/${id}/seguros`, {
    method: "PATCH",
    headers: cabecerasStaff,
    body: JSON.stringify({ anosExperiencia: -1 }),
  });
  assert.equal(res.status, 400);
});
```

Run: `npm test -w api`

- [ ] **Step 6: Commit**

```bash
git add api/src/app.ts api/src/app.test.ts db/src/clientes.ts db/src/clientes.test.ts
git commit -m "feat(api): POST /clients exige vertical; GET/PATCH /clients/:id/seguros para el perfil de seguros"
```

---

## Task 12: Portal — modelos, API y formulario de alta ganan `vertical`

**Files:**
- Modify: `portal/src/app/core/models.ts` (`ClienteAgencia`, `NuevoClienteAgencia`)
- Modify: `portal/src/app/pages/clientes/cliente-crear.ts` (`FormularioCliente`, el selector, `datos()`)
- Test: `portal/src/app/pages/clientes/cliente-crear.spec.ts` (Karma — verificar el nombre real del
  archivo antes de escribir, sigue el patrón `<componente>.spec.ts`)

**Interfaces:**
- Produce: `ClienteAgencia.vertical: "restauracion" | "correduria_seguros"`,
  `NuevoClienteAgencia.vertical: "restauracion" | "correduria_seguros"` (obligatorio).

- [ ] **Step 1: `models.ts` — tipo y las dos interfaces**

```ts
// portal/src/app/core/models.ts — agregar junto a TipoCliente
export type Vertical = 'restauracion' | 'correduria_seguros';

export const OPCIONES_VERTICAL: ReadonlyArray<{ valor: Vertical; etiqueta: string }> = [
  { valor: 'restauracion', etiqueta: 'Restauración' },
  { valor: 'correduria_seguros', etiqueta: 'Correduría de seguros' },
];
```

```ts
// ClienteAgencia (línea ~166-184) — agregar, sin `| null`: siempre presente y visible.
export interface ClienteAgencia {
  id: string;
  nombre: string;
  vertical: Vertical;
  tipo: TipoCliente | null;
  // ... resto sin cambios
}
```

```ts
// NuevoClienteAgencia (línea ~190-202) — obligatorio, igual criterio que en db/api.
export interface NuevoClienteAgencia {
  nombre: string;
  vertical: Vertical;
  // ... resto sin cambios
}
```

- [ ] **Step 2: `cliente-crear.ts` — campo del formulario + selector + `datos()`**

```ts
// FormularioCliente (línea ~19-50) — agregar
interface FormularioCliente {
  nombre: string;
  vertical: Vertical | '';
  empresa: string;
  // ... resto sin cambios
}
```

Agregar el `<select>` en el template (siguiendo el mismo patrón visual que el `<select>` de `tipo`,
ubicado con `OPCIONES_TIPO` — buscar ese bloque en el archivo y replicarlo con `OPCIONES_VERTICAL`,
marcado como obligatorio a diferencia de `tipo`).

```ts
// datos() (línea ~602-623) — vertical viaja siempre, sin condicional de "si está vacío no se manda"
// como el resto de los campos opcionales: si el formulario no lo valida antes de permitir submit, acá
// se lo exige.
function datos(): NuevoClienteAgencia {
  return {
    nombre: formulario.nombre,
    vertical: formulario.vertical as Vertical, // el formulario no permite submit sin elegir uno — Step 3
    // ... resto sin cambios
  };
}
```

- [ ] **Step 3: Validación de formulario — no se puede enviar sin elegir vertical**

Ubicar la validación existente del formulario (probablemente un método `esValido()` o similar, buscarlo
en el archivo) y agregar `formulario.vertical !== ''` a sus condiciones, con el mensaje de error
correspondiente junto al selector nuevo.

- [ ] **Step 4: Test — rojo primero**

```ts
// cliente-crear.spec.ts
it('no permite enviar el formulario sin elegir vertical', () => {
  component.formulario.nombre = 'Cliente de prueba';
  component.formulario.vertical = '';
  expect(component.puedeEnviar()).toBeFalse(); // ajustar al nombre real del método
});

it('incluye vertical en los datos enviados a crearCliente', () => {
  component.formulario.nombre = 'Cliente de prueba';
  component.formulario.vertical = 'correduria_seguros';
  const spy = spyOn(clientesService, 'crear');
  component.enviar(); // ajustar al nombre real del método de submit
  expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ vertical: 'correduria_seguros' }));
});
```

- [ ] **Step 5: Correr, confirmar rojo → verde**

Run: `npm --prefix portal run test:components -- --include='**/cliente-crear.spec.ts'`

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/core/models.ts portal/src/app/pages/clientes/cliente-crear.ts \
        portal/src/app/pages/clientes/cliente-crear.spec.ts
git commit -m "feat(portal): el alta de cliente exige elegir vertical"
```

---

## Task 13: Portal — tab dinámico, copy del catálogo, y el EDITOR oculta campos de restauración

**Files:**
- Modify: `portal/src/app/pages/clientes/cliente-ficha.ts:17-23` (`TABS_FICHA`)
- Modify: `portal/src/app/pages/clientes/cliente-menu.ts` (título/copy de la pantalla)
- Modify: `portal/src/app/pages/clientes/cliente-menu-detalle.ts:22-38` (`FormularioPlato`) y
  `:288-341` (el template del formulario) — agregado tras la revisión: es donde se EDITA cada ítem, y
  hasta ahora este plan solo tocaba el título de la lista, dejando visibles video/alérgenos/etiquetas/
  nutrición para un cliente de seguros
- Test: `portal/src/app/pages/clientes/cliente-ficha.spec.ts`,
  `portal/src/app/pages/clientes/cliente-menu-detalle.spec.ts`

**Interfaces:**
- Consume: `ClienteAgencia.vertical` (Task 12), disponible en `clientesService.cliente()` dentro de
  `ClienteFichaComponent` y (vía el mismo servicio, ya inyectado en las pantallas hijas) en
  `cliente-menu-detalle.ts`.

- [ ] **Step 1: Etiqueta del tab dinámica según `vertical`**

```ts
// cliente-ficha.ts:17-23 — TABS_FICHA deja de ser una lista estática de 5; la entrada del catálogo se
// calcula. Reemplazar el array fijo por una función que lo arma según el cliente:
export interface TabFicha {
  etiqueta: string;
  ruta: string;
}

const TABS_FIJOS: readonly TabFicha[] = [
  { etiqueta: 'Perfil', ruta: 'perfil' },
  { etiqueta: 'Research', ruta: 'research' },
  { etiqueta: 'Reseñas', ruta: 'resenas' },
  { etiqueta: 'Ideas', ruta: 'ideas' },
];

/** El tab de catálogo, con etiqueta según vertical. La ruta interna sigue siendo `menu` para los dos
 *  rubros a propósito (ver "Global Constraints" del plan: no se renombra el contrato interno). */
export function tabsFicha(vertical: Vertical | undefined): readonly TabFicha[] {
  const etiquetaCatalogo = vertical === 'correduria_seguros' ? 'Pólizas y coberturas' : 'Menú';
  return [...TABS_FIJOS, { etiqueta: etiquetaCatalogo, ruta: 'menu' }];
}
```

Actualizar el template de `ClienteFichaComponent` (donde itera `TABS_FICHA`) para llamar
`tabsFicha(clientesService.cliente()?.vertical)` en vez de referenciar la constante fija — el resultado
puede envolverse en un `computed()` si el componente ya usa signals para derivar valores del cliente
actual (seguir el patrón existente del archivo).

- [ ] **Step 2: `cliente-menu.ts` — título de la pantalla según vertical**

Ubicar el título/encabezado hardcodeado ("Menú" o similar) dentro de `cliente-menu.ts` y su template, y
condicionarlo de la misma forma (`vertical === 'correduria_seguros' ? 'Pólizas y coberturas' :
'Menú'`), leyendo el cliente activo del mismo servicio que ya usa `ClienteFichaComponent`.

- [ ] **Step 2b: `cliente-menu-detalle.ts` — ocultar los controles de restauración para seguros (el fix
  real de esta task: sin esto, el portal sigue dejando cargar alérgenos/nutrición para una póliza)**

`FormularioPlato` (líneas 22-38) sigue teniendo `videoSrc`/`alergenos`/`etiquetas`/`calorias`/etc. — no
hay que sacarlos del tipo (el formulario los sigue necesitando para restauración), sino ocultar sus
controles en el template y no dejar que `platoDesdeFormulario()` los incluya en el objeto guardado
cuando el cliente es de seguros:

```ts
// cliente-menu-detalle.ts — leer el cliente activo (mismo servicio que ya usa ClienteFichaComponent,
// probablemente ya inyectado en este componente para el breadcrumb/título)
protected readonly esSeguros = computed(() => this.clientesService.cliente()?.vertical === 'correduria_seguros');
```

En el template (líneas 288-341), envolver los bloques de video/alérgenos/etiquetas/nutrición en
`@if (!esSeguros()) { ... }` — mismo patrón de control flow nativo que ya use el resto del componente
para secciones condicionales.

```ts
// platoDesdeFormulario() (o el método equivalente que arma el MenuItem final al guardar) — no dejar
// que sobreviva un dato de restauración cargado ANTES de que el cliente cambiara de vertical (aunque
// hoy la vertical es inmutable, un ítem cargado por otra vía no debería depender de esa garantía sola
// — defensa en profundidad, mismo criterio que Task 8).
function platoDesdeFormulario(form: FormularioPlato, esSeguros: boolean): MenuItem {
  const base = {
    name: form.name,
    // ... el resto de los campos base sin cambios ...
  };
  if (esSeguros) return base; // sin video/alergenos/etiquetas/nutricion, cualquiera sea el formulario
  return {
    ...base,
    // ... video/alergenos/etiquetas/nutricion, como ya hace hoy ...
  };
}
```

- [ ] **Step 3: Test — rojo primero**

```ts
// cliente-ficha.spec.ts
it('muestra el tab "Menú" para un cliente de restauración', () => {
  const tabs = tabsFicha('restauracion');
  expect(tabs.find((t) => t.ruta === 'menu')?.etiqueta).toBe('Menú');
});

it('muestra el tab "Pólizas y coberturas" para un cliente de correduría de seguros', () => {
  const tabs = tabsFicha('correduria_seguros');
  expect(tabs.find((t) => t.ruta === 'menu')?.etiqueta).toBe('Pólizas y coberturas');
});
```

```ts
// cliente-menu-detalle.spec.ts
it('oculta los controles de video/alergenos/nutricion para un cliente de seguros', () => {
  clienteActual.set({ ...clienteDePrueba, vertical: 'correduria_seguros' });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[data-testid="campo-alergenos"]')).toBeFalsy();
  expect(fixture.nativeElement.querySelector('[data-testid="campo-video"]')).toBeFalsy();
});

it('muestra los controles de restauración para un cliente de restauración — sin regresión', () => {
  clienteActual.set({ ...clienteDePrueba, vertical: 'restauracion' });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[data-testid="campo-alergenos"]')).toBeTruthy();
});

it('platoDesdeFormulario no incluye campos de restauracion para un cliente de seguros', () => {
  const form = formularioConTodosLosCampos(); // incluye alergenos/video igual, simulando datos viejos
  const plato = platoDesdeFormulario(form, true);
  expect(plato.alergenos).toBeUndefined();
  expect(plato.video).toBeUndefined();
});
```

(Ajustar los selectores `data-testid` y los nombres de helper al patrón real del archivo de test —
agregar los atributos `data-testid` al template si todavía no existen, es parte de este step.)

- [ ] **Step 4: Correr, confirmar rojo → verde**

Run: `npm --prefix portal run test:components -- --include='**/cliente-ficha.spec.ts' --include='**/cliente-menu-detalle.spec.ts'`

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/pages/clientes/cliente-ficha.ts portal/src/app/pages/clientes/cliente-menu.ts \
        portal/src/app/pages/clientes/cliente-menu-detalle.ts \
        portal/src/app/pages/clientes/cliente-ficha.spec.ts \
        portal/src/app/pages/clientes/cliente-menu-detalle.spec.ts
git commit -m "feat(portal): tab/titulo de catalogo por vertical, y el editor oculta campos de restauracion para seguros"
```

---

## Task 14: Portal — quinto card, editor de perfil de seguros (rediseñada tras la revisión)

**Corrección de fondo (hallazgo de la revisión sobre el plan anterior):** la versión previa de esta
task suponía que `cliente-perfil.ts` ya lee/edita `business_profile` y que solo había que "agregar una
sección". Es falso: `cliente-perfil.ts:8-19` dice literalmente en su propio docblock **"No carga
nada"** — es un contenedor de los 4 cards de datos CRM (`ClienteInfoCardComponent`,
`ClienteDireccionCardComponent`, `ClienteMetaCardComponent`, `ClienteRecursosCardComponent`), ninguno
toca `business_profile`. No hay ningún mecanismo de lectura/escritura de perfil de negocio en el
portal fuera de `obtenerMenu`/`guardarMenu` (que solo cubre `menu`/`menu_categorias`). Contrato
confirmado con el usuario: un **quinto card**, mismo patrón que los 4 existentes, sobre el endpoint
dedicado `GET`/`PATCH /clients/:id/seguros` que ya construyó la Task 11 — no un editor genérico de
`business_profile` (alcance angosto a propósito, YAGNI: nada más lo necesita hoy).

**Files:**
- Modify: `portal/src/app/core/models.ts` (agregar `PerfilSeguros`, mismo criterio que
  `MenuItem`/`MenuCategoria` ya duplicados ahí — el portal no importa tipos del workspace)
- Modify: `portal/src/app/core/api-core.ts` (dos métodos nuevos: `obtenerPerfilSeguros`/
  `actualizarPerfilSeguros`, mismo patrón que `obtenerMenu`/`guardarMenu:291-301`)
- Modify: `portal/src/app/services/api.ts:60-61` (reexportar los dos métodos nuevos, mismo patrón que
  `obtenerMenu`/`guardarMenu`)
- Create: `portal/src/app/pages/clientes/cliente-seguros-card.ts` (el quinto card — nombre siguiendo el
  patrón `cliente-<algo>-card.ts` de los 4 existentes)
- Modify: `portal/src/app/pages/clientes/cliente-perfil.ts` (importa y monta el card nuevo,
  condicionado a `vertical`)
- Test: `portal/src/app/pages/clientes/cliente-seguros-card.spec.ts` (nuevo),
  `portal/src/app/core/api-core.test.ts`

**Interfaces:**
- Consume: `ClienteAgencia.vertical` (Task 12), `GET`/`PATCH /clients/:id/seguros` (Task 11).
- Produce: `ClienteApi.obtenerPerfilSeguros(clientId): Promise<PerfilSeguros | null>`,
  `ClienteApi.actualizarPerfilSeguros(clientId, datos: PerfilSeguros): Promise<void>`.

- [ ] **Step 1: Tipo `PerfilSeguros` en el portal**

```ts
// portal/src/app/core/models.ts — junto a MenuItem/MenuCategoria
export interface PerfilSeguros {
  numeroLicencia?: string;
  anosExperiencia?: number;
  redAfiliacion?: string;
}
```

- [ ] **Step 2: `api-core.ts` — los dos métodos nuevos**

```ts
// portal/src/app/core/api-core.ts — interfaz ClienteApi, junto a obtenerMenu/guardarMenu:291-301
/** El perfil de seguros del cliente (licencia/experiencia/red). `null` si no lo cargó todavía —
 *  mismo criterio que el resto de esta interfaz: nunca un objeto a medias inventado acá. */
obtenerPerfilSeguros(clientId: string): Promise<PerfilSeguros | null>;
/** Reemplaza el perfil de seguros completo. Mismo criterio que guardarMenu: manda siempre el objeto
 *  entero, el servidor no hace merge parcial de campo por campo. */
actualizarPerfilSeguros(clientId: string, datos: PerfilSeguros): Promise<void>;
```

```ts
// implementación concreta, junto a obtenerMenu/guardarMenu (líneas ~476-487, ~562-567)
async obtenerPerfilSeguros(clientId) {
  const { seguros } = await pedir<{ seguros: PerfilSeguros | null }>(
    'GET',
    `/clients/${encodeURIComponent(clientId)}/seguros`,
  );
  return seguros;
},
async actualizarPerfilSeguros(clientId, datos) {
  await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/seguros`, datos);
},
```

```ts
// portal/src/app/services/api.ts:60-61 — reexportar, mismo patrón que obtenerMenu/guardarMenu
readonly obtenerPerfilSeguros = this.cliente.obtenerPerfilSeguros;
readonly actualizarPerfilSeguros = this.cliente.actualizarPerfilSeguros;
```

Test — rojo primero:

```ts
// portal/src/app/core/api-core.test.ts
it('obtenerPerfilSeguros pide GET /clients/:id/seguros', async () => {
  // mismo patrón que el test existente de obtenerMenu — mockear pedir()/fetch, confirmar la URL.
});
it('actualizarPerfilSeguros manda PATCH /clients/:id/seguros con el body completo', async () => {
  // mismo patrón que el test existente de guardarMenu.
});
```

- [ ] **Step 3: El card nuevo, `cliente-seguros-card.ts`**

Seguir el patrón exacto de uno de los 4 cards existentes en el mismo directorio (leerlo antes de
escribir este — probablemente `ClienteInfoCardComponent`, el más simple): un componente standalone que
recibe el cliente (o su `id`) por `input()`, un formulario con los tres campos (`numeroLicencia` texto,
`anosExperiencia` numérico, `redAfiliacion` texto), carga inicial con `obtenerPerfilSeguros` en su
`ngOnInit`/`effect` (siguiendo cómo cargan los otros cards, si lo hacen — recordar que `cliente-perfil.ts`
dice que él NO carga nada, así que puede que cada card cargue lo suyo, o que el patrón sea distinto;
confirmarlo leyendo un card existente antes de copiarlo), y un botón Guardar que llama
`actualizarPerfilSeguros`.

- [ ] **Step 4: Montar el card en `cliente-perfil.ts`, condicionado a `vertical`**

```ts
// cliente-perfil.ts — agregar el import y, en el template, condicionar el nuevo card
@if (cliente.vertical === 'correduria_seguros') {
  <app-cliente-seguros-card [cliente]="cliente" />
}
```

(Ajustar la sintaxis exacta al patrón real de cómo el template actual monta los otros 4 cards — mismo
`@if (clientesService.cliente(); as cliente) { ... }` que ya envuelve todo el template, según el
fragmento visto en la investigación previa al plan.)

- [ ] **Step 5: Test — rojo primero, el card completo**

```ts
// cliente-seguros-card.spec.ts
it('carga y muestra los tres campos existentes', async () => {
  apiSpy.obtenerPerfilSeguros.and.resolveTo({ numeroLicencia: 'J-1479', anosExperiencia: 35, redAfiliacion: 'E2K' });
  fixture.detectChanges();
  await fixture.whenStable();
  expect(component.formulario.numeroLicencia).toBe('J-1479');
});

it('guarda los tres campos al enviar', async () => {
  component.formulario.numeroLicencia = 'J-1479';
  component.formulario.anosExperiencia = 35;
  component.formulario.redAfiliacion = 'E2K';
  await component.guardar();
  expect(apiSpy.actualizarPerfilSeguros).toHaveBeenCalledWith(
    clienteId,
    { numeroLicencia: 'J-1479', anosExperiencia: 35, redAfiliacion: 'E2K' },
  );
});
```

```ts
// cliente-perfil.spec.ts (o donde ya esté el test de montaje de los 4 cards existentes)
it('monta el card de seguros solo para vertical=correduria_seguros', () => {
  clienteActual.set({ ...clienteDePrueba, vertical: 'correduria_seguros' });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('app-cliente-seguros-card')).toBeTruthy();
});

it('NO monta el card de seguros para restauración', () => {
  clienteActual.set({ ...clienteDePrueba, vertical: 'restauracion' });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('app-cliente-seguros-card')).toBeFalsy();
});
```

- [ ] **Step 6: Correr, confirmar rojo → verde**

Run: `npm --prefix portal run test:components -- --include='**/cliente-seguros-card.spec.ts' --include='**/cliente-perfil.spec.ts' --include='**/api-core.test.ts'`

- [ ] **Step 7: Commit**

```bash
git add portal/src/app/core/models.ts portal/src/app/core/api-core.ts portal/src/app/core/api-core.test.ts \
        portal/src/app/services/api.ts portal/src/app/pages/clientes/cliente-seguros-card.ts \
        portal/src/app/pages/clientes/cliente-seguros-card.spec.ts portal/src/app/pages/clientes/cliente-perfil.ts \
        portal/src/app/pages/clientes/cliente-perfil.spec.ts
git commit -m "feat(portal): quinto card, editor de licencia/experiencia/red para correduria de seguros"
```

---

## Task 15: Verificación de punta a punta y cierre

**Files:** ninguno nuevo — verificación sobre todo lo anterior.

- [ ] **Step 1: `npm run verificar -- --con-portal` desde la raíz**

Run: `npm run verificar -- --con-portal`
Expected: exit 0, entorno/arnés/secretos/typecheck/tests todos en verde, cifras de tests actualizadas.

- [ ] **Step 2: Manejar la app en el navegador — cliente de restauración existente (sin regresión)**

Con `npm run dev:server -w api` + el portal corriendo: abrir un cliente de restauración ya sembrado,
confirmar que `/clientes/:id/menu` sigue mostrando "Menú" y funcionando igual que antes del cambio; en
el sitio público servido por el renderizador, confirmar que `/menu` sigue respondiendo con el mismo
contenido y JSON-LD `Menu`.

- [ ] **Step 3: Manejar la app en el navegador — cliente de correduría de seguros, de punta a punta**

Dar de alta un cliente nuevo eligiendo "Correduría de seguros" en el formulario; confirmar que el tab
se llama "Pólizas y coberturas"; cargar un catálogo de pólizas (usar el mismo editor que hoy edita
`menu`/`menu_categorias`, confirmando que los controles de video/alérgenos/nutrición NO aparecen);
cargar el card de perfil de seguros (licencia/experiencia/red) en el tab Perfil; publicar (mock/dry-run
según el modo del entorno); en el sitio servido, visitar `/polizas` (no `/menu`) y confirmar: el título
"Pólizas y coberturas · {nombre}", que el JSON-LD es `ItemList` (no `Menu`), que el nav de arriba
linkea a `/polizas` con la etiqueta "Pólizas y coberturas" (no a `/menu`), y que la sección de datos de
contacto muestra la licencia/experiencia/red cargadas.

- [ ] **Step 4: Confirmar los grants de columna en el navegador/logs, no solo en tests**

Esto es lo que el hallazgo Critical de la revisión encontró que PGlite con rol superusuario no
reproduce: con la app corriendo contra una base real (o PGlite pero forzando explícitamente
`set local role app_service`/`app_render` como hacen los tests de las Tasks 1/4/5), confirmar que
publicar un research (que pasa por `orchestrator` bajo `app_service`) y que servir el sitio público
(que pasa por `renderer` bajo `app_render`) no tiran "permission denied for table clients" en los logs.

- [ ] **Step 5: Confirmar en consola del navegador — sin errores propios, claro y oscuro**

Repetir la verificación del Step 3 con el tema oscuro activado.

- [ ] **Step 6: Actualizar la documentación del plan (ritual de `AGENTS.md`, paso 3)**

- `docs/proyecto/09-estado-y-roadmap.md`: nueva entrada — multi-vertical de clientes cerrado, cifras de
  tests y migraciones actualizadas (`0027`/`0028` desplegadas o pendientes de `migrate:deploy`).
- `docs/proyecto/15-plan-plataforma.md`: si corresponde un bloque nuevo o una nota en el existente.
- El ADR de perfil/allowlist si `docs/decisiones-arquitectura.md` documenta `app.nap_publico` en algún
  ADR — confirmar si hace falta una entrada nueva o una nota sobre la generalización por vertical.

- [ ] **Step 7: Commit final + push**

```bash
git add docs/proyecto/09-estado-y-roadmap.md docs/proyecto/15-plan-plataforma.md
git commit -m "Doc: cierra multi-vertical de clientes (restauracion + correduria de seguros)"
git push
```

---

## Nota de la revisión conjunta (2026-08-26)

Al revisar los tres sub-proyectos de la iniciativa juntos (después de que cada uno pasara su propia
ronda de Codex por separado), se encontró que la Task 9 de este plan editaba código
(`orchestrator/src/workflow.ts:342-346`, dentro de `workflowResearch`) que el plan del sub-proyecto 2
(`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`) retira por completo, trasladando el mismo
`deps.publicar(...)` a la rama `crear_web` de una función nueva (`workflowDecision`). Ninguna de las
dos revisiones individuales lo había detectado — cada plan se revisó contra el código de HOY, y ese
conflicto solo existe entre los dos planes, no en el repo real.

**Resuelto:** la Task 9 se reescribió para apuntar a la ubicación nueva (buscada por contenido, no por
línea) y se fijó el orden de implementación de los tres sub-proyectos: **sub-proyecto 2 primero**, este
y el 3 después (no dependen entre sí). También se corrigió la numeración de migración de las Tasks 1 y
2 (`0027`/`0028` eran tentativos, chocaban con los que asumían los otros dos planes) a "verificar antes
de crear el archivo". Ver `progress/current.md`, sección de la iniciativa, para el detalle completo de
la decisión de orden.
