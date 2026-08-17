# Editor de carta en el portal — plan de implementación

> **Para agentes:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkboxes
> (`- [ ]`) para el seguimiento.

**Goal:** que la agencia pueda cargar y editar la carta completa (categorías + platos, con todos los
campos del menú enriquecido) desde un tab nuevo en la ficha del cliente del portal, en vez de por
SQL/seed.

**Architecture:** dos endpoints nuevos (`GET`/`PATCH /clients/:id/menu`) sobre el `PgClientes`
existente, reutilizando el Zod de `web-builder` (nuevo subpath `web-builder/contract`) para validar
antes de escribir. El portal agrega dos pantallas — lista (`/clientes/:id/menu`) y detalle por
posición (`/clientes/:id/menu/:index`) — con el mismo patrón que ya usan las Ideas.

**Tech Stack:** Hono (`api`), PGlite/`pg` (`db`), Zod (`web-builder`), Angular standalone + signals
(`portal`). Sin migración nueva: el privilegio de escritura sobre `clients` ya existe desde la 0001,
y la política `client_write` ya cubre este caso.

**Spec:** [2026-08-17-editor-menu-portal-design.md](../specs/2026-08-17-editor-menu-portal-design.md)
(revisado por Codex el 2026-08-17, 8 hallazgos aplicados).

## Global Constraints

- **Sin subida de archivos.** `foto.src`, `video.src`, `video.poster.src` son URLs pegadas a mano, ya
  subidas a Storyblok por fuera de este flujo. Ningún input `type="file"` en ninguna pantalla.
- **Solo `maestro`/`equipo` editan.** El rol `cliente` queda afuera de esta etapa. Esto ya lo impone
  la política `client_write`/`app.puede_escribir()` existente — **no se toca ninguna política ni
  función de RLS en este plan.**
- **El PATCH reemplaza `menu` Y `menu_categorias` COMPLETOS.** Las dos claves son obligatorias en el
  body — nunca opcionales, nunca "se conserva lo que había" por omisión.
- **El merge en SQL toca SOLO esas dos claves del JSONB `business_profile`**, con
  `coalesce(business_profile, '{}'::jsonb)` para el caso `NULL` (cliente recién creado). Nunca se
  pasa el perfil entero por `parseProfile()`.
- **Identidad de un plato = su posición en el array recién cargado**, nunca un id persistente.
  `cliente-menu-detalle.ts` vuelve a pedir `GET /clients/:id/menu` cada vez que se monta.
- **`api` importa el Zod del menú desde `"web-builder/contract"`, nunca desde `"web-builder"` a
  secas** (esa raíz arrastra `openai`/`dotenv` por sus otras exportaciones).
- **El 400 del PATCH devuelve `{ error: string, campos: [{ ruta: string, mensaje: string }] }`.** Los
  mensajes de Zod quedan en inglés donde no hay mensaje custom — no se traducen en esta etapa.
- **El portal define sus propios tipos** (`MenuItem`, `MenuCategoria`, etc.) en `core/models.ts` —
  nunca importa tipos de `web-builder`/`db` (ADR-21, mismo criterio que `ResenaGoogle`/`IdeaDetalle`).
- **Sin invalidación de cache cruzada API→renderer.** Hasta 5 minutos de latencia entre guardar y
  verlo en el sitio público — comportamiento ya existente, no se toca `renderer/`.
- **Sin optimistic locking.** Dos guardados simultáneos: last-write-wins, a propósito.
- **Borrar una categoría con platos asignados queda bloqueado en la UI** (no en el servidor): si
  algún plato tiene `category` igual al nombre de la categoría, el botón de borrar se deshabilita.
- **Nada de esto necesita una migración SQL.** El `grant update` de tabla sobre `clients` para
  `app_user` es de la 0001 y sigue vigente (confirmado: la 0021 solo revocó `select`, no `update`).

---

### Task 1: `web-builder` — exportar el contrato del menú

**Files:**
- Modify: `web-builder/src/contract.ts`
- Modify: `web-builder/src/contract.test.ts`
- Modify: `web-builder/package.json`

**Interfaces:**
- Produces: `menuItemSchema: ZodObject` (exportado), `menuCategoriaSchema: ZodObject` (exportado),
  `MAX_ITEMS_CARTA: number` (exportado), `menuPatchSchema: ZodObject<{ menu: ZodArray<...>,
  menu_categorias: ZodArray<...> }>` (nuevo, exportado) — su `.safeParse(x).data` tiene la forma
  `{ menu: MenuItem[]; menu_categorias: MenuCategoria[] }`. Subpath de import nuevo:
  `"web-builder/contract"` → `src/contract.ts`.
- Consumes: nada nuevo (usa `menuItemSchema`/`menuCategoriaSchema`/`MAX_ITEMS_CARTA`/
  `MAX_CATEGORIAS` que ya existen en el archivo).

- [ ] **Step 1: Exportar `menuItemSchema`, `menuCategoriaSchema` y `MAX_ITEMS_CARTA`, y agregar
  `menuPatchSchema`**

En `web-builder/src/contract.ts`, cambiar la declaración de `MAX_ITEMS_CARTA` (línea 29):

```typescript
const MAX_LOCALES = 20;
/**
 * Exportado para el editor del portal (`api/src/app.ts`, `PATCH /clients/:id/menu`): valida el
 * tamaño del array ANTES de construir el `update`, con el mismo tope que esta frontera. No es una de
 * las tres que ya exportaba el comentario de abajo ("la frontera 4 también aplica") — ésta la
 * necesita una frontera de ESCRITURA, no de render, y es honesto decirlo así.
 */
export const MAX_ITEMS_CARTA = 200;
```

Cambiar `const menuCategoriaSchema` (línea ~191) a `export const menuCategoriaSchema`, sin tocar el
resto de su definición:

```typescript
/** `nombre` es lo que se compara contra `MenuItem.category`: sin él la categoría no agrupa nada. */
export const menuCategoriaSchema = z.object({
  nombre: z.string().min(1),
  foto: fotoSchema.optional(),
  orden: z.number().int().min(0).optional(),
});
```

Cambiar `const menuItemSchema` (línea ~148) a `export const menuItemSchema`, sin tocar el resto de su
definición (el bloque completo de `precios`, `alergenos`, etc. queda igual).

Agregar `menuPatchSchema` inmediatamente después de `businessProfileSchema` (antes de
`parseProfile`), en `web-builder/src/contract.ts`:

```typescript
/**
 * El contrato de `PATCH /clients/:id/menu` (editor del portal): las DOS claves obligatorias, nunca
 * opcionales — el portal manda siempre su copia completa de ambos arrays (`[]` si no hay
 * categorías). Reutiliza `menuItemSchema`/`menuCategoriaSchema` tal cual: es el mismo plato que
 * valida `businessProfileSchema.menu`, no una copia con reglas propias.
 */
export const menuPatchSchema = z.object({
  menu: z.array(menuItemSchema).max(MAX_ITEMS_CARTA),
  menu_categorias: z.array(menuCategoriaSchema).max(MAX_CATEGORIAS),
});
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `web-builder/src/contract.test.ts` (el bloque de tests existente de `menuItemSchema`/
`alergenos`/`etiquetas` ya está en este archivo — agregar estos al final):

```typescript
test("menuItemSchema exportado acepta el mismo plato válido que parseProfile()", () => {
  const plato = { name: "Margherita", precios: [{ etiqueta: "Media", importe: "9,00 €" }] };
  assert.equal(menuItemSchema.safeParse(plato).success, true);
  assert.equal(
    parseProfile({ name: "X", menu: [plato] }).menu?.[0]?.name,
    "Margherita",
  );
});

test("menuCategoriaSchema exportado rechaza una categoría sin nombre, igual que parseProfile()", () => {
  const categoria = { orden: 0 };
  assert.equal(menuCategoriaSchema.safeParse(categoria).success, false);
  assert.throws(() => parseProfile({ name: "X", menu_categorias: [categoria] }));
});

test("MAX_ITEMS_CARTA exportado es el mismo tope que aplica businessProfileSchema (200)", () => {
  assert.equal(MAX_ITEMS_CARTA, 200);
  const menu201 = Array.from({ length: 201 }, (_, i) => ({ name: `Plato ${i}` }));
  assert.throws(() => parseProfile({ name: "X", menu: menu201 }));
});

test("menuPatchSchema exige las DOS claves — menu_categorias ausente es inválido, no 'se conserva'", () => {
  const soloMenu = { menu: [{ name: "Margherita" }] };
  assert.equal(menuPatchSchema.safeParse(soloMenu).success, false);
});

test("menuPatchSchema acepta el caso sin categorías con un array vacío explícito", () => {
  const sinCategorias = { menu: [{ name: "Margherita" }], menu_categorias: [] };
  assert.equal(menuPatchSchema.safeParse(sinCategorias).success, true);
});

test("menuPatchSchema rechaza más de MAX_ITEMS_CARTA platos", () => {
  const menu201 = Array.from({ length: 201 }, (_, i) => ({ name: `Plato ${i}` }));
  assert.equal(menuPatchSchema.safeParse({ menu: menu201, menu_categorias: [] }).success, false);
});
```

Agregar `menuItemSchema`, `menuCategoriaSchema`, `MAX_ITEMS_CARTA`, `menuPatchSchema` al `import` de
`parseProfile` al inicio de `web-builder/src/contract.test.ts` (el import existente de `parseProfile`
desde `"./contract.js"` gana estos cuatro nombres más).

- [ ] **Step 3: Correr los tests, confirmar que pasan**

```bash
npm test -w web-builder
```

Expected: todos los tests de `contract.test.ts` en verde, incluidos los 6 nuevos.

- [ ] **Step 4: Agregar el subpath `"./contract"` a `web-builder/package.json`**

```json
{
  "name": "web-builder",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Módulo 1 — Creador de Webs (PoC). Handoff brief SEO (M2) → story Storyblok + preview HTML.",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./fixtures": "./src/fixtures.ts",
    "./fuentes": "./src/render/fuentes.ts",
    "./contract": "./src/contract.ts"
  },
```

(el resto del archivo no cambia).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w web-builder
```

Expected: limpio.

- [ ] **Step 6: Commit**

```bash
git add web-builder/src/contract.ts web-builder/src/contract.test.ts web-builder/package.json
git commit -m "feat(web-builder): exportar el contrato del menú para el editor del portal"
```

---

### Task 2: `db` — leer y escribir el menú en `PgClientes`

**Files:**
- Modify: `db/src/clientes.ts`
- Modify: `db/src/clientes.test.ts`

**Interfaces:**
- Consumes: nada de Task 1 (esta capa no valida con Zod — la validación ya pasó en la API antes de
  llegar acá; ver Task 3).
- Produces:
  - `PgClientes.obtenerMenu(ctx: TenantContext, id: string): Promise<{ menu: unknown[]; menu_categorias: unknown[] } | null>`
  - `PgClientes.actualizarMenu(ctx: TenantContext, id: string, datos: { menu: unknown[]; menu_categorias: unknown[] }): Promise<boolean>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `db/src/clientes.test.ts` (después de los tests de `actualizarCliente`, línea ~426 en el
archivo actual):

```typescript
// ---------------------------------------------------------------- menú (editor del portal)

test("obtenerMenu de un cliente sin business_profile devuelve arrays vacíos, no null ni excepción", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Sin carta" });

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);

  assert.deepEqual(menu, { menu: [], menu_categorias: [] });
});

test("obtenerMenu de un cliente inexistente (o de otro tenant) devuelve null", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo A" });

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantB, userId: s.equipoB }, id);

  assert.equal(menu, null);
});

test("actualizarMenu sobre un cliente con business_profile NULL lo guarda igual (no se pierde en silencio)", async () => {
  // `crearCliente` nunca escribe `business_profile`: la columna queda en su default, NULL. Éste es
  // exactamente el caso que `coalesce(business_profile, '{}'::jsonb)` tiene que cubrir — sin él, el
  // `||` de jsonb sobre NULL da NULL, el UPDATE devuelve éxito y el menú no queda guardado.
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Perfil vacío" });

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [],
  });
  assert.equal(ok, true);

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.deepEqual(menu, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [],
  });
});

test("actualizarMenu toca SOLO menu/menu_categorias — el resto de business_profile sobrevive", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Con perfil" });
  // Perfil inicial con brand y fotos, escrito directo (no hay otro método de escritura de perfil
  // completo desde este store — mismo camino que usaría el CLI de seed).
  await db.asService(
    "update clients set business_profile = $1::jsonb where id = $2",
    [
      JSON.stringify({
        name: "Con perfil",
        brand: { colores: { primario: "#0a7d34" } },
        fotos: [{ src: "https://a.storyblok.com/f/1/x.jpg" }],
      }),
      id,
    ],
  );

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [{ nombre: "Pizzas" }],
  });
  assert.equal(ok, true);

  const [fila] = await db.asService(
    "select business_profile from clients where id = $1",
    [id],
  );
  assert.deepEqual((fila as { business_profile: Record<string, unknown> }).business_profile.brand, {
    colores: { primario: "#0a7d34" },
  });
  assert.deepEqual((fila as { business_profile: Record<string, unknown> }).business_profile.fotos, [
    { src: "https://a.storyblok.com/f/1/x.jpg" },
  ]);
});

test("actualizarMenu de un cliente de OTRO tenant no afecta ninguna fila", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo de A" });

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantB, userId: s.equipoB }, id, {
    menu: [{ name: "Intento de fuga" }],
    menu_categorias: [],
  });
  assert.equal(ok, false);

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.deepEqual(menu, { menu: [], menu_categorias: [] }, "el menú de A no cambió");
});
```

**Nota para quien implemente:** revisar si `TestDb`/`db` expone `db.asService(sql, params)` con esa
firma exacta (usado en otros archivos de `db/src/*.test.ts` para leer/escribir bajo el rol de
servicio, saltando RLS, cuando el test necesita preparar o verificar estado por fuera del `ctx` bajo
prueba) — si el helper real tiene otro nombre o firma, ajustar las dos llamadas de arriba que lo usan
sin cambiar la intención (preparar `business_profile` directo, y leerlo directo para verificar que
`brand`/`fotos` sobrevivieron).

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
npm test -w db 2>&1 | grep -A3 "obtenerMenu\|actualizarMenu"
```

Expected: FAIL — `obtenerMenu`/`actualizarMenu` no existen todavía en `PgClientes`.

- [ ] **Step 3: Implementar `obtenerMenu` y `actualizarMenu`**

En `db/src/clientes.ts`, agregar los dos métodos a la clase `PgClientes`, **entre**
`actualizarCliente` (termina línea 287 en el archivo actual) **y** `archivarCliente`:

```typescript
  /**
   * La carta del cliente: `menu` + `menu_categorias`, tal como viven dentro de `business_profile`.
   * `[]` para cada uno si el perfil no los tiene (o no tiene perfil en absoluto) — nunca `null`: el
   * portal siempre puede pintar una lista vacía, no un hueco que hay que distinguir de un error.
   *
   * `null` (todo el retorno, no las claves de adentro) es "cliente no encontrado o no visible" —
   * mismo criterio que `obtenerCliente`.
   */
  async obtenerMenu(
    ctx: TenantContext,
    id: string,
  ): Promise<{ menu: unknown[]; menu_categorias: unknown[] } | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ menu: unknown[]; menu_categorias: unknown[] }>(
        `select coalesce(business_profile->'menu', '[]'::jsonb) as menu,
                coalesce(business_profile->'menu_categorias', '[]'::jsonb) as menu_categorias
         from clients where id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Reemplaza `menu` y `menu_categorias` COMPLETOS dentro de `business_profile`, sin tocar ninguna
   * otra clave del perfil (`brand`, `fotos`, etc.) ni pasar el perfil entero por `parseProfile()` —
   * ver la sección "Por qué el PATCH reemplaza el array entero" del spec.
   *
   * `coalesce(business_profile, '{}'::jsonb)` cubre el cliente recién creado, cuya columna es NULL
   * (la 0006 la agrega sin default): sin este `coalesce`, el operador `||` de jsonb sobre un operando
   * NULL da NULL — el UPDATE "funcionaría" (afecta la fila, devuelve éxito) pero el menú no quedaría
   * guardado, sin que nada lo avise. Hay un test que reproduce exactamente este caso.
   *
   * `datos.menu`/`datos.menu_categorias` llegan como `unknown[]`: ya pasaron el Zod de
   * `menuPatchSchema` en la API antes de esta llamada (frontera 2), así que acá no se vuelve a
   * validar — solo se serializa y se escribe. Igual que `contacto` en `actualizarCliente`.
   */
  async actualizarMenu(
    ctx: TenantContext,
    id: string,
    datos: { menu: unknown[]; menu_categorias: unknown[] },
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients
         set business_profile = coalesce(business_profile, '{}'::jsonb)
           || jsonb_build_object('menu', $1::jsonb, 'menu_categorias', $2::jsonb)
         where id = $3
         returning id`,
        [JSON.stringify(datos.menu), JSON.stringify(datos.menu_categorias), id],
      );
      return rows.length > 0;
    });
  }

```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
npm test -w db
```

Expected: los 5 tests nuevos en verde, y el resto de `db` sin regresiones (número de tests previo +5).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w db
```

- [ ] **Step 6: Commit**

```bash
git add db/src/clientes.ts db/src/clientes.test.ts
git commit -m "feat(db): leer y escribir el menú del cliente (PgClientes.obtenerMenu/actualizarMenu)"
```

---

### Task 3: `api` — `GET`/`PATCH /clients/:id/menu`

**Files:**
- Modify: `api/src/app.ts`
- Modify: `api/src/app.test.ts`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: `menuPatchSchema` de Task 1 (`import { menuPatchSchema } from "web-builder/contract"`);
  `deps.clientes.obtenerMenu`/`deps.clientes.actualizarMenu` de Task 2.
- Produces:
  - `GET /clients/:id/menu` → 200 `{ menu: MenuItem[], menu_categorias: MenuCategoria[] }` | 404 `{ error }`
  - `PATCH /clients/:id/menu` → 200 `{ ok: true }` | 400 `{ error, campos: [{ ruta, mensaje }] }` | 404 `{ error }`

- [ ] **Step 1: Agregar `web-builder` como dependencia de `api`**

En `api/package.json`, agregar `"web-builder": "*"` al final del bloque `dependencies` (mismo
patrón que `"db": "*"`):

```json
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "contrato": "*",
    "db": "*",
    "hono": "^4.6.14",
    "inngest": "^3.27.0",
    "jose": "^5.9.6",
    "pg": "^8.22.0",
    "web-builder": "*"
  },
```

Correr `npm install` desde la raíz para que el workspace enlace el paquete (sin esto, el `import`
del Step 2 falla con `Cannot find package 'web-builder'`).

```bash
npm install
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `api/src/app.test.ts`, en la sección de `clients` (después de los tests de
`PATCH /clients/:id`, que terminan alrededor de la línea 762 del archivo actual):

```typescript
// ---------------------------------------------------------------- menú (editor del portal)

test("GET /clients/:id/menu de un cliente sin carta devuelve arrays vacíos", async () => {
  const res = await req("GET", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { menu: [], menu_categorias: [] });
});

test("GET /clients/:id/menu de OTRO tenant → 404", async () => {
  const res = await req("GET", `/clients/${clientA1}/menu`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);
});

test("PATCH /clients/:id/menu guarda un plato válido y GET lo devuelve igual", async () => {
  const carta = {
    menu: [{ name: "Margherita", precios: [{ etiqueta: "Media", importe: "9,00 €" }] }],
    menu_categorias: [{ nombre: "Pizzas" }],
  };
  const resPatch = await req("PATCH", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA, body: carta });
  assert.equal(resPatch.status, 200);
  assert.deepEqual(await resPatch.json(), { ok: true });

  const resGet = await req("GET", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA });
  assert.deepEqual(await resGet.json(), carta);
});

test("PATCH /clients/:id/menu sin menu_categorias → 400 (las dos claves son obligatorias)", async () => {
  const res = await req("PATCH", `/clients/${clientA1}/menu`, {
    user: equipoA,
    tenant: tenantA,
    body: { menu: [{ name: "Margherita" }] },
  });
  assert.equal(res.status, 400);
  const cuerpo = (await res.json()) as { campos: Array<{ ruta: string; mensaje: string }> };
  assert.ok(cuerpo.campos.some((c) => c.ruta === "menu_categorias"));
});

test("PATCH /clients/:id/menu con un plato sin nombre → 400 con la ruta exacta del campo", async () => {
  const res = await req("PATCH", `/clients/${clientA1}/menu`, {
    user: equipoA,
    tenant: tenantA,
    body: { menu: [{ description: "Sin nombre" }], menu_categorias: [] },
  });
  assert.equal(res.status, 400);
  const cuerpo = (await res.json()) as { error: string; campos: Array<{ ruta: string; mensaje: string }> };
  assert.ok(cuerpo.campos.some((c) => c.ruta === "menu.0.name"));
});

test("🔴 PATCH /clients/:id/menu de OTRO tenant → 404 con el MISMO mensaje que un id inexistente (no revela existencia)", async () => {
  const carta = { menu: [{ name: "Fuga" }], menu_categorias: [] };
  const resOtroTenant = await req("PATCH", `/clients/${clientA1}/menu`, { user: equipoB, tenant: tenantB, body: carta });
  assert.equal(resOtroTenant.status, 404);
  const cuerpoOtroTenant = await resOtroTenant.json();

  const resInexistente = await req("PATCH", "/clients/00000000-0000-4000-8000-000000000000/menu", {
    user: equipoA,
    tenant: tenantA,
    body: carta,
  });
  assert.equal(resInexistente.status, 404);
  const cuerpoInexistente = await resInexistente.json();

  assert.deepEqual(cuerpoOtroTenant, cuerpoInexistente, "el 404 no distingue 'de otro tenant' de 'no existe'");

  const filas = await sql<{ business_profile: Record<string, unknown> | null }>(
    "select business_profile from clients where id = $1",
    [clientA1],
  );
  assert.equal(filas[0]?.business_profile, null, "el tenant B no pudo tocar el cliente de A");
});

test("equivalencia: el mismo set de casos límite se acepta/rechaza igual en menuItemSchema, parseProfile() y el endpoint", async () => {
  const casos: Array<{ plato: unknown; valido: boolean }> = [
    { plato: { name: "Margherita" }, valido: true },
    { plato: { name: "" }, valido: false }, // nombre vacío
    { plato: { name: "Sin precio con importe vacío", precios: [{ etiqueta: "Media", importe: "" }] }, valido: false },
    { plato: { name: "17 alérgenos" }, valido: true }, // placeholder: el caso real de tope va abajo
  ];

  for (const { plato, valido } of casos) {
    assert.equal(
      menuItemSchema.safeParse(plato).success,
      valido,
      `menuItemSchema discrepa para ${JSON.stringify(plato)}`,
    );

    const perfilOk = (() => {
      try {
        parseProfile({ name: "X", menu: [plato] });
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(perfilOk, valido, `parseProfile() discrepa para ${JSON.stringify(plato)}`);

    const res = await req("PATCH", `/clients/${clientA1}/menu`, {
      user: equipoA,
      tenant: tenantA,
      body: { menu: [plato], menu_categorias: [] },
    });
    assert.equal(res.status === 200, valido, `el endpoint discrepa para ${JSON.stringify(plato)}`);
  }
});
```

Agregar el import de `menuItemSchema`/`parseProfile` desde `web-builder` (solo para el test de
equivalencia — el `app.ts` real importa `menuPatchSchema` desde `web-builder/contract`, ver Step 3)
al inicio de `api/src/app.test.ts`:

```typescript
import { menuItemSchema, parseProfile } from "web-builder/contract";
```

- [ ] **Step 2b: Correr los tests, confirmar que fallan**

```bash
npm test -w api 2>&1 | grep -B2 -A5 "clients/:id/menu\|equivalencia"
```

Expected: FAIL — las rutas no existen todavía (404 genérico de Hono, no el 404/400 esperado por los
asserts).

- [ ] **Step 3: Implementar los dos endpoints**

En `api/src/app.ts`, agregar el import al bloque de imports (después de la línea 15, junto a los
otros imports de paquetes del monorepo):

```typescript
import { menuPatchSchema } from "web-builder/contract";
```

Agregar los dos endpoints inmediatamente después de `PATCH /clients/:id` (que termina en la línea
416 del archivo actual, antes de `POST /clients/:id/archive`):

```typescript
  /** GET /clients/:id/menu — la carta del cliente (platos + categorías), tal como vive en business_profile. */
  app.get("/clients/:id/menu", async (c) => {
    const ctx = c.get("ctx");
    const resultado = await deps.clientes.obtenerMenu(ctx, c.req.param("id"));
    if (!resultado) return c.json({ error: "Cliente no encontrado." }, 404);
    return c.json(resultado);
  });

  /**
   * PATCH /clients/:id/menu — reemplaza la carta completa (`menu` + `menu_categorias`).
   *
   * Las dos claves del body son OBLIGATORIAS (`menuPatchSchema`, `web-builder/contract`): el portal
   * manda siempre su copia completa de ambos arrays, `[]` si no hay categorías. Un body con una
   * clave ausente es 400, no "se conserva lo que había" — ver el spec.
   */
  app.patch("/clients/:id/menu", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    const parsed = menuPatchSchema.safeParse(body);
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => ({ ruta: i.path.join("."), mensaje: i.message }));
      return c.json({ error: "El menú no es válido.", campos }, 400);
    }
    const ok = await deps.clientes.actualizarMenu(ctx, c.req.param("id"), parsed.data);
    return ok ? c.json({ ok: true }) : c.json({ error: "Cliente no encontrado." }, 404);
  });

```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
npm test -w api
```

Expected: los 7 tests nuevos en verde, resto de `api` sin regresiones.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w api
```

- [ ] **Step 6: Commit**

```bash
git add api/src/app.ts api/src/app.test.ts api/package.json package-lock.json
git commit -m "feat(api): GET/PATCH /clients/:id/menu, validado con el Zod de web-builder/contract"
```

---

### Task 4: `portal` — modelos y servicio (`api-core.ts`)

**Files:**
- Modify: `portal/src/app/core/models.ts`
- Modify: `portal/src/app/core/api-core.ts`
- Modify: `portal/src/app/core/api-core.test.ts`
- Modify: `portal/src/app/services/api.ts`
- Create: `portal/src/app/core/menu-taxonomia.ts`
- Create: `portal/src/app/core/menu-taxonomia.spec.ts`

**Interfaces:**
- Consumes: el contrato de `GET`/`PATCH /clients/:id/menu` de Task 3 (por su FORMA JSON, nunca por
  import — ADR-21).
- Produces (para las Tasks 5 y 6):
  - Tipos: `MenuCarta`, `MenuItem`, `MenuCategoria`, `PrecioMenu`, `FotoMenu`, `VideoMenu`,
    `InfoNutricional`, `Alergeno`, `EtiquetaDietetica` en `core/models.ts`.
  - `ApiService.obtenerMenu(clientId: string): Promise<MenuCarta>`
  - `ApiService.guardarMenu(clientId: string, carta: MenuCarta): Promise<void>`
  - `menu-taxonomia.ts`: `ALERGENOS: readonly Alergeno[]`, `ETIQUETA_ALERGENO: Record<Alergeno, string>`,
    `ETIQUETAS_DIETETICAS: readonly EtiquetaDietetica[]`, `ETIQUETA_DIETETICA_LABEL: Record<EtiquetaDietetica, string>`.

- [ ] **Step 1: Agregar los tipos a `portal/src/app/core/models.ts`**

Agregar, cerca de `ResenaGoogle` (después de su definición, línea ~277 del archivo actual):

```typescript
/**
 * Los 14 alérgenos del Reglamento UE 1169/2011. Espeja `Alergeno` de `web-builder/src/types.ts`
 * campo por campo — el portal NO importa ese tipo (ADR-21), mismo criterio que `ResenaGoogle`.
 * Taxonomía FIJA: ampliarla es un cambio de código en los DOS lados (acá y `web-builder`), nunca un
 * dato de la ficha.
 */
export type Alergeno =
  | 'gluten'
  | 'crustaceos'
  | 'huevos'
  | 'pescado'
  | 'cacahuetes'
  | 'soja'
  | 'lacteos'
  | 'frutos_cascara'
  | 'apio'
  | 'mostaza'
  | 'sesamo'
  | 'sulfitos'
  | 'altramuces'
  | 'moluscos';

/** Las 7 etiquetas dietéticas. Espeja `EtiquetaDietetica` de `web-builder/src/types.ts`. */
export type EtiquetaDietetica =
  | 'vegano'
  | 'vegetariano'
  | 'sin_gluten'
  | 'sin_lactosa'
  | 'picante'
  | 'halal'
  | 'kosher';

/** Una foto o el poster de un video: `src` obligatoria, `alt` opcional. Espeja `Foto`. */
export interface FotoMenu {
  src: string;
  alt?: string;
}

/**
 * Un video autoalojado. Sin `poster` válido, el render público NO dibuja el `<video>` — el
 * formulario del detalle (Task 6) tiene que dejarlo claro, no es un detalle de esta interfaz.
 */
export interface VideoMenu {
  src: string;
  poster?: FotoMenu;
}

/** Un importe con etiqueta ("Media", "Ración") y, opcional, para cuántas personas. */
export interface PrecioMenu {
  etiqueta: string;
  importe: string;
  comensales?: string;
}

/** Nutrición de la ración de referencia. Las cuatro claves son independientes. */
export interface InfoNutricional {
  calorias?: number;
  proteinas_g?: number;
  carbohidratos_g?: number;
  grasas_g?: number;
}

/**
 * Un plato de la carta. Espeja `MenuItem` de `web-builder/src/types.ts` campo por campo. `price` NO
 * está acá a propósito: el editor del portal siempre escribe con `precios` (ver
 * `cliente-menu-detalle.ts`), aunque sea una sola fila — un plato cargado por SQL/seed con `price`
 * suelto (sin `precios`) sigue siendo válido para el servidor, y el formulario lo migra a `precios`
 * al abrirlo (ver `formularioDesde`), nunca lo pierde.
 */
export interface MenuItem {
  category?: string;
  name: string;
  description?: string;
  precios?: PrecioMenu[];
  nota?: string;
  foto?: FotoMenu;
  video?: VideoMenu;
  alergenos?: Alergeno[];
  etiquetas?: EtiquetaDietetica[];
  nutricion?: InfoNutricional;
}

/** Una categoría de la carta. Espeja `MenuCategoria`. */
export interface MenuCategoria {
  nombre: string;
  foto?: FotoMenu;
  orden?: number;
}

/** El cuerpo de `GET`/`PATCH /clients/:id/menu`: la carta completa. */
export interface MenuCarta {
  menu: MenuItem[];
  menu_categorias: MenuCategoria[];
}
```

**Nota para quien implemente:** `MenuItem` de acá NO incluye `price?: string` porque el editor del
portal siempre lee/escribe con `precios`. Pero el body que devuelve `GET /clients/:id/menu` puede
traer un plato con `price` suelto (cargado por SQL antes de que existiera este editor) y SIN
`precios` — como `MenuItem` no declara `price`, TypeScript no se queja al leer ese campo, pero
`response.menu[i]` en runtime SÍ puede traerlo. La Task 6 (`cliente-menu-detalle.ts`) tiene que leerlo
con un cast defensivo (`(item as { price?: string }).price`) al migrarlo a `precios` — ver esa task.

- [ ] **Step 2: Crear `portal/src/app/core/menu-taxonomia.ts`**

```typescript
import type { Alergeno, EtiquetaDietetica } from './models';

/**
 * Vocabulario del menú enriquecido: los 14 alérgenos y las 7 etiquetas dietéticas, con su etiqueta
 * legible en español — mismas listas y mismos textos que `ETIQUETA_ALERGENO`/`ETIQUETA_DIETETICA` de
 * `web-builder/src/render/piezas/carta-categorias.ts` (que el portal no importa, ADR-21, así que se
 * copian a mano). Si el sitio público cambia una etiqueta, este archivo se desincroniza en silencio
 * — mismo riesgo que ya acepta `ideas-estado.ts` para el vocabulario de Ideas.
 */
export const ALERGENOS: readonly Alergeno[] = [
  'gluten',
  'crustaceos',
  'huevos',
  'pescado',
  'cacahuetes',
  'soja',
  'lacteos',
  'frutos_cascara',
  'apio',
  'mostaza',
  'sesamo',
  'sulfitos',
  'altramuces',
  'moluscos',
];

export const ETIQUETA_ALERGENO: Record<Alergeno, string> = {
  gluten: 'Gluten',
  crustaceos: 'Crustáceos',
  huevos: 'Huevos',
  pescado: 'Pescado',
  cacahuetes: 'Cacahuetes',
  soja: 'Soja',
  lacteos: 'Lácteos',
  frutos_cascara: 'Frutos de cáscara',
  apio: 'Apio',
  mostaza: 'Mostaza',
  sesamo: 'Sésamo',
  sulfitos: 'Sulfitos',
  altramuces: 'Altramuces',
  moluscos: 'Moluscos',
};

export const ETIQUETAS_DIETETICAS: readonly EtiquetaDietetica[] = [
  'vegano',
  'vegetariano',
  'sin_gluten',
  'sin_lactosa',
  'picante',
  'halal',
  'kosher',
];

export const ETIQUETA_DIETETICA_LABEL: Record<EtiquetaDietetica, string> = {
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sin_gluten: 'Sin gluten',
  sin_lactosa: 'Sin lactosa',
  picante: 'Picante',
  halal: 'Halal',
  kosher: 'Kosher',
};
```

- [ ] **Step 3: Escribir el test que falla para `menu-taxonomia.ts`**

Crear `portal/src/app/core/menu-taxonomia.spec.ts`:

```typescript
import { ALERGENOS, ETIQUETA_ALERGENO, ETIQUETAS_DIETETICAS, ETIQUETA_DIETETICA_LABEL } from './menu-taxonomia';

describe('menu-taxonomia', () => {
  it('ALERGENOS tiene exactamente 14 entradas, todas con etiqueta en ETIQUETA_ALERGENO', () => {
    expect(ALERGENOS.length).toBe(14);
    for (const a of ALERGENOS) {
      expect(ETIQUETA_ALERGENO[a]).toBeTruthy();
    }
  });

  it('ETIQUETAS_DIETETICAS tiene exactamente 7 entradas, todas con etiqueta en ETIQUETA_DIETETICA_LABEL', () => {
    expect(ETIQUETAS_DIETETICAS.length).toBe(7);
    for (const e of ETIQUETAS_DIETETICAS) {
      expect(ETIQUETA_DIETETICA_LABEL[e]).toBeTruthy();
    }
  });
});
```

Correr:

```bash
npm --prefix portal run test:components -- --include='**/menu-taxonomia.spec.ts'
```

Expected: PASS de inmediato (el archivo del Step 2 ya existe) — este test es una red contra un
typo futuro en las listas, no un ciclo rojo-verde real acá, porque `menu-taxonomia.ts` es data
estática sin lógica que pueda fallar de otra forma. Confirmar igual que corre y pasa.

- [ ] **Step 4: Agregar `obtenerMenu`/`guardarMenu` a `ClienteApi` (interfaz + implementación)**

En `portal/src/app/core/api-core.ts`, agregar `MenuCarta` al import de tipos desde `./models`
(línea 1-16 del archivo actual, orden alfabético):

```typescript
import type {
  Brief,
  CambioRolMiembro,
  CambiosClienteAgencia,
  CambiosPagina,
  ClienteAgencia,
  EstadoIdea,
  IdeaDetalle,
  IdeaResumen,
  Informe,
  MenuCarta,
  Miembro,
  NuevoClienteAgencia,
  NuevoRun,
  ResenaGoogle,
  RunSummary,
} from './models';
```

Agregar a la interfaz `ClienteApi` (después de `desconectarGoogle`, línea 260, antes del `}` que
cierra la interfaz en la línea 261):

```typescript
  /**
   * La carta completa del cliente (platos + categorías), tal como vive en `business_profile`. `[]`
   * en cada array si el cliente no tiene carta todavía — nunca `null`.
   */
  obtenerMenu(clientId: string): Promise<MenuCarta>;
  /**
   * Reemplaza la carta completa. Manda SIEMPRE los dos arrays enteros, nunca un parche parcial —
   * mismo criterio que `editarIdea` pero sin el recorte de campos: acá no hay "subconjunto editado",
   * el servidor exige las dos claves completas (`PATCH /clients/:id/menu`, `menuPatchSchema`).
   */
  guardarMenu(clientId: string, carta: MenuCarta): Promise<void>;
```

Agregar a la implementación de `crearApi` (después de `desconectarGoogle`, cerca de la línea 481 del
archivo actual, dentro del mismo objeto literal que devuelve `crearApi`):

```typescript
    async obtenerMenu(clientId) {
      return pedir<MenuCarta>('GET', `/clients/${encodeURIComponent(clientId)}/menu`);
    },
    async guardarMenu(clientId, carta) {
      await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/menu`, carta);
    },
```

- [ ] **Step 5: Escribir los tests que fallan para `api-core.ts`**

Agregar a `portal/src/app/core/api-core.test.ts`, después del bloque de reseñas (línea ~730 del
archivo actual, antes de `conectarGoogle`):

```typescript
// ---------------------------------------------------------------- menú (editor del portal)

test('obtenerMenu pega a GET /clients/:id/menu y devuelve la carta tal cual', async () => {
  const carta = {
    menu: [{ name: 'Margherita', precios: [{ etiqueta: 'Media', importe: '9,00 €' }] }],
    menu_categorias: [{ nombre: 'Pizzas' }],
  };
  const { fn, capturado } = fakeFetch({ body: carta });
  const res = await crearApi(opts(fn)).obtenerMenu('c1');
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/clients/c1/menu');
  assert.deepEqual(res, carta);
});

test('guardarMenu manda PATCH con la carta completa, con el id escapado', async () => {
  const carta = { menu: [{ name: 'Margherita' }], menu_categorias: [] };
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).guardarMenu('c1/../otro', carta);
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/clients/c1%2F..%2Fotro/menu');
  assert.deepEqual(JSON.parse(capturado.body!), carta);
});

test('🔴 guardarMenu propaga el error del servidor (400 con campos) sin envolverlo', async () => {
  const { fn } = fakeFetch({
    status: 400,
    body: { error: 'El menú no es válido.', campos: [{ ruta: 'menu.0.name', mensaje: 'Required' }] },
  });
  await assert.rejects(
    () => crearApi(opts(fn)).guardarMenu('c1', { menu: [{}], menu_categorias: [] } as never),
    /El menú no es válido/,
  );
});
```

- [ ] **Step 6: Correr los tests, confirmar que fallan y después pasan**

```bash
npm --prefix portal run test:components -- --include='**/api-core.test.ts'
```

Rojo antes del Step 4 (o al escribir el test primero — el orden de esta tarea puso la implementación
antes por legibilidad del diff, pero verificar igual que ANTES de tener `obtenerMenu`/`guardarMenu`
en `crearApi` estos tres tests fallan, y después de agregarlos pasan).

- [ ] **Step 7: Agregar las dos propiedades a `ApiService`**

En `portal/src/app/services/api.ts`, agregar después de `desconectarGoogle` (línea 52, antes del `}`
que cierra la clase):

```typescript
  readonly obtenerMenu = this.cliente.obtenerMenu;
  readonly guardarMenu = this.cliente.guardarMenu;
```

- [ ] **Step 8: Typecheck y tests del portal completos**

```bash
npm --prefix portal run typecheck
npm --prefix portal run test:components
```

Expected: limpio, sin regresiones.

- [ ] **Step 9: Commit**

```bash
git add portal/src/app/core/models.ts portal/src/app/core/api-core.ts portal/src/app/core/api-core.test.ts \
        portal/src/app/services/api.ts portal/src/app/core/menu-taxonomia.ts portal/src/app/core/menu-taxonomia.spec.ts
git commit -m "feat(portal): modelos y servicio para leer/guardar el menú del cliente"
```

---

### Task 5: `portal` — tab, ruta y lista (`cliente-menu.ts`)

**Files:**
- Modify: `portal/src/app/pages/clientes/cliente-ficha.ts`
- Modify: `portal/src/app/app.routes.ts`
- Create: `portal/src/app/pages/clientes/cliente-menu.ts`
- Create: `portal/src/app/pages/clientes/cliente-menu.spec.ts`

**Interfaces:**
- Consumes: `ApiService.obtenerMenu`/`guardarMenu`, `MenuCarta`/`MenuItem`/`MenuCategoria` de Task 4.
- Produces: la ruta `/clientes/:id/menu` montada y con su tab; para Task 6, el link
  `['/clientes', clienteId, 'menu', index]` que ya usa esta pantalla hacia el detalle (no cambia
  nada del lado de Task 6, pero fija la convención de índice = posición en `platos()`, y "agregar" =
  navegar al índice `platos().length`, uno pasado el final).

- [ ] **Step 1: Agregar el tab a `TABS_FICHA`**

En `portal/src/app/pages/clientes/cliente-ficha.ts`, cambiar el array (líneas 18-23 del archivo
actual):

```typescript
/**
 * Los CINCO tabs de la ficha, y el orden acá ES el orden en pantalla. `Perfil` va primero porque es
 * el tab por defecto (el `redirectTo` de `app.routes.ts`); `Reseñas`, `Ideas` y `Menú` van al final
 * por orden histórico de cuándo se agregaron a la ficha, no por ningún criterio activo.
 */
export const TABS_FICHA: readonly TabFicha[] = [
  { etiqueta: 'Perfil', ruta: 'perfil' },
  { etiqueta: 'Research', ruta: 'research' },
  { etiqueta: 'Reseñas', ruta: 'resenas' },
  { etiqueta: 'Ideas', ruta: 'ideas' },
  { etiqueta: 'Menú', ruta: 'menu' },
];
```

(el comentario de arriba de la constante, que decía "Los cuatro tabs", pasa a decir "Los cinco
tabs" — actualizar ese docblock, no solo el array).

- [ ] **Step 2: Registrar la ruta `menu` en `app.routes.ts`**

En `portal/src/app/app.routes.ts`, agregar dentro del array de hijas de `clientes/:id` (junto a
`ideas`/`ideas/:ideaId`, después de esas dos entradas):

```typescript
          {
            path: 'menu',
            loadComponent: () =>
              import('./pages/clientes/cliente-menu').then((m) => m.ClienteMenuPage),
          },
```

(la ruta `menu/:index`, para el detalle, la agrega la Task 6 — esta task NO la registra todavía,
para no referenciar un componente que aún no existe).

- [ ] **Step 3: Escribir el test que falla para `cliente-menu.ts`**

Crear `portal/src/app/pages/clientes/cliente-menu.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteMenuPage } from './cliente-menu';
import { ApiService } from '../../services/api';
import type { MenuCarta } from '../../core/models';

function cartaDePrueba(overrides: Partial<MenuCarta> = {}): MenuCarta {
  return {
    menu: [
      { name: 'Margherita', category: 'Pizzas', precios: [{ etiqueta: 'Media', importe: '9,00 €' }] },
      { name: 'Cacio e pepe', category: 'Pastas', precios: [{ etiqueta: 'Precio', importe: '13,00 €' }] },
    ],
    menu_categorias: [
      { nombre: 'Pizzas', orden: 0 },
      { nombre: 'Pastas', orden: 1 },
    ],
    ...overrides,
  };
}

function crear(
  opciones: {
    obtenerMenu?: jasmine.Spy;
    guardarMenu?: jasmine.Spy;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const obtenerMenuSpy = opciones.obtenerMenu ?? jasmine.createSpy('obtenerMenu').and.resolveTo(cartaDePrueba());
  const guardarMenuSpy = opciones.guardarMenu ?? jasmine.createSpy('guardarMenu').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));

  TestBed.configureTestingModule({
    imports: [ClienteMenuPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { obtenerMenu: obtenerMenuSpy, guardarMenu: guardarMenuSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteMenuPage);
  return { fixture, obtenerMenuSpy, guardarMenuSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteMenuPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function boton(el: HTMLElement, texto: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === texto);
}

describe('ClienteMenuPage', () => {
  it('lista las categorías y, debajo de cada una, sus platos', async () => {
    const { fixture, obtenerMenuSpy } = crear();
    const el = await estabilizar(fixture);

    expect(obtenerMenuSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Pizzas');
    expect(el.textContent).toContain('Margherita');
    expect(el.textContent).toContain('Pastas');
    expect(el.textContent).toContain('Cacio e pepe');
  });

  it('un plato con category que no está en menu_categorias aparece igual, agrupado aparte', async () => {
    const carta = cartaDePrueba({
      menu: [{ name: 'Huérfano', category: 'Postres' }],
      menu_categorias: [{ nombre: 'Pizzas' }],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Huérfano');
  });

  it('sin carta todavía: se ve un estado vacío, no una pantalla en blanco', async () => {
    const carta = cartaDePrueba({ menu: [], menu_categorias: [] });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Todavía no hay platos cargados.');
  });

  it('borrar un plato lo saca de la lista y guarda la carta sin él', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Borrar')!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [clientId, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(clientId).toBe('c1');
    expect(carta.menu.map((p) => p.name)).toEqual(['Cacio e pepe']);
    expect(el.textContent).not.toContain('Margherita');
  });

  it('borrar una categoría CON platos asignados queda bloqueado', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    const botonBorrarPizzas = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Borrar categoría' && b.closest('li')?.textContent?.includes('Pizzas'),
    );
    expect(botonBorrarPizzas?.disabled).withContext('Pizzas tiene un plato: no se puede borrar').toBeTrue();

    botonBorrarPizzas?.click();
    await estabilizar(fixture);
    expect(guardarMenuSpy).not.toHaveBeenCalled();
  });

  it('borrar una categoría SIN platos asignados funciona', async () => {
    const carta = cartaDePrueba({
      menu: [{ name: 'Margherita', category: 'Pizzas' }],
      menu_categorias: [
        { nombre: 'Pizzas', orden: 0 },
        { nombre: 'Bebidas', orden: 1 },
      ],
    });
    const { fixture, guardarMenuSpy } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    const botonBorrarBebidas = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Borrar categoría' && b.closest('li')?.textContent?.includes('Bebidas'),
    );
    expect(botonBorrarBebidas?.disabled).toBeFalse();
    botonBorrarBebidas!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [, cartaGuardada] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(cartaGuardada.menu_categorias.map((c) => c.nombre)).toEqual(['Pizzas']);
  });

  it('agregar categoría la agrega a la lista y la guarda', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="nuevaCategoriaNombre"]')!;
    inputNombre.value = 'Postres';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    boton(el, 'Agregar categoría')!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(carta.menu_categorias.map((c) => c.nombre)).toContain('Postres');
    expect(el.textContent).toContain('Postres');
  });

  it('el link "Agregar plato" apunta al índice UNO PASADO EL FINAL del array actual', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);

    const link = el.querySelector<HTMLAnchorElement>('a[href$="/menu/2"]');
    expect(link).withContext('2 platos cargados (índices 0 y 1): agregar va al índice 2').toBeTruthy();
  });
});
```

- [ ] **Step 4: Correr el test, confirmar que falla**

```bash
npm --prefix portal run test:components -- --include='**/cliente-menu.spec.ts'
```

Expected: FAIL — `./cliente-menu` no existe.

- [ ] **Step 5: Implementar `cliente-menu.ts`**

Crear `portal/src/app/pages/clientes/cliente-menu.ts`:

```typescript
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { MenuCategoria, MenuItem } from '../../core/models';
import { Vigencia } from '../../core/vigencia';

/**
 * El tab Menú de la ficha del cliente: `/clientes/:id/menu`. Lista las categorías y, debajo de cada
 * una, sus platos, con alta/borrado de categorías y borrado de platos. La edición completa de UN
 * plato (todos los campos del menú enriquecido) vive en `cliente-menu-detalle.ts` — esta pantalla
 * solo linkea ahí.
 *
 * **La identidad de un plato es su POSICIÓN en `platos()`**, no un id persistente (`MenuItem` no
 * tiene uno — ver el spec). El link "Agregar plato" apunta al índice `platos().length`: uno pasado
 * el final, que `cliente-menu-detalle.ts` interpreta como "plato nuevo" en vez de "editar el
 * existente en esa posición".
 *
 * Cada mutación (borrar plato, agregar/borrar categoría) guarda de inmediato con
 * `api.guardarMenu()` — no hay un botón "Guardar" aparte para estas acciones de lista, a diferencia
 * del formulario de detalle, donde sí lo hay porque ahí se editan muchos campos a la vez.
 */
@Component({
  selector: 'app-cliente-menu',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="space-y-6">
      <h1 class="sr-only">Menú</h1>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else {
        <section class="space-y-3">
          <h2 class="text-sm font-medium text-texto">Categorías</h2>
          <ul class="space-y-2">
            @for (cat of categoriasOrdenadas(); track cat.nombre) {
              <li class="flex items-center justify-between gap-3 bg-superficie rounded-lg border border-borde p-3">
                <span class="text-sm text-texto">{{ cat.nombre }}</span>
                <button
                  type="button"
                  class="text-xs text-error disabled:text-texto-tenue disabled:cursor-not-allowed"
                  [disabled]="platosDeCategoria(cat.nombre).length > 0"
                  [title]="
                    platosDeCategoria(cat.nombre).length > 0
                      ? 'Reasigná o borrá primero los ' + platosDeCategoria(cat.nombre).length + ' platos de esta categoría'
                      : ''
                  "
                  (click)="borrarCategoria(cat.nombre)"
                >
                  Borrar categoría
                </button>
              </li>
            }
          </ul>

          <form class="flex items-end gap-2" (submit)="agregarCategoria($event)">
            <div>
              <label for="nuevaCategoriaNombre" class="block text-xs text-texto-tenue">Nueva categoría</label>
              <input
                id="nuevaCategoriaNombre"
                name="nuevaCategoriaNombre"
                [ngModel]="nuevaCategoriaNombre()"
                (ngModelChange)="nuevaCategoriaNombre.set($event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <button type="submit" class="cta" [disabled]="!nuevaCategoriaNombre().trim()">Agregar categoría</button>
          </form>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-texto">Platos</h2>
            <a [routerLink]="['/clientes', clienteId(), 'menu', platos().length]" class="cta">Agregar plato</a>
          </div>

          @if (platos().length === 0) {
            <p class="text-sm text-texto-tenue">Todavía no hay platos cargados.</p>
          } @else {
            @for (grupo of gruposDePlatos(); track grupo.nombre) {
              <div class="space-y-2">
                <h3 class="text-xs uppercase text-texto-tenue">{{ grupo.nombre }}</h3>
                <ul class="space-y-2">
                  @for (entrada of grupo.entradas; track entrada.indice) {
                    <li class="flex items-center justify-between gap-3 bg-superficie rounded-lg border border-borde p-3">
                      <a [routerLink]="['/clientes', clienteId(), 'menu', entrada.indice]" class="text-sm text-texto">
                        {{ entrada.plato.name }}
                      </a>
                      <button type="button" class="text-xs text-error" (click)="borrarPlato(entrada.indice)">
                        Borrar
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        </section>
      }
    </div>
  `,
})
export class ClienteMenuPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private readonly vigencia = new Vigencia();

  readonly clienteId = signal('');
  readonly menu = signal<MenuItem[]>([]);
  readonly categorias = signal<MenuCategoria[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly nuevaCategoriaNombre = signal('');

  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.clienteId.set(id);
      this.menu.set([]);
      this.categorias.set([]);
      this.error.set('');
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  private async cargar(pedido: string): Promise<void> {
    this.cargando.set(true);
    try {
      const carta = await this.api.obtenerMenu(pedido);
      if (this.vigencia.obsoleta(pedido)) return;
      this.menu.set(carta.menu);
      this.categorias.set(carta.menu_categorias);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /** Guarda la carta actual (`menu()` + `categorias()`) y refleja el resultado en la UI. */
  private async guardar(): Promise<void> {
    const clienteId = this.clienteId();
    const carta = { menu: this.menu(), menu_categorias: this.categorias() };
    try {
      await this.api.guardarMenu(clienteId, carta);
    } catch (e) {
      if (this.vigencia.obsoleta(clienteId)) return;
      this.error.set((e as Error).message);
      // Recargar desde el servidor: el estado local pudo quedar adelantado a lo que en verdad se
      // guardó, y mostrar un plato "borrado" que en realidad sigue ahí sería peor que recargar.
      void this.cargar(clienteId);
    }
  }

  platos(): MenuItem[] {
    return this.menu();
  }

  platosDeCategoria(nombre: string): MenuItem[] {
    return this.menu().filter((p) => p.category === nombre);
  }

  categoriasOrdenadas(): MenuCategoria[] {
    return [...this.categorias()].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  }

  /** Agrupa los platos por categoría, en el orden de `categoriasOrdenadas()`, y agrega al final un
   *  grupo "Sin categoría" para los que no matchean ninguna — mismo criterio de tolerancia que el
   *  render público (`carta-categorias.ts`): un plato huérfano se sigue viendo, agrupado aparte. */
  gruposDePlatos(): Array<{ nombre: string; entradas: Array<{ indice: number; plato: MenuItem }> }> {
    const nombresConocidos = new Set(this.categoriasOrdenadas().map((c) => c.nombre));
    const conIndice = this.menu().map((plato, indice) => ({ indice, plato }));

    const grupos = this.categoriasOrdenadas().map((cat) => ({
      nombre: cat.nombre,
      entradas: conIndice.filter((e) => e.plato.category === cat.nombre),
    }));

    const huerfanos = conIndice.filter((e) => !e.plato.category || !nombresConocidos.has(e.plato.category));
    if (huerfanos.length > 0) grupos.push({ nombre: 'Sin categoría', entradas: huerfanos });

    return grupos.filter((g) => g.entradas.length > 0 || this.categoriasOrdenadas().some((c) => c.nombre === g.nombre));
  }

  agregarCategoria(evento: Event): void {
    evento.preventDefault();
    const nombre = this.nuevaCategoriaNombre().trim();
    if (!nombre) return;
    this.categorias.set([...this.categorias(), { nombre }]);
    this.nuevaCategoriaNombre.set('');
    void this.guardar();
  }

  borrarCategoria(nombre: string): void {
    if (this.platosDeCategoria(nombre).length > 0) return; // el botón ya está disabled — defensa
    this.categorias.set(this.categorias().filter((c) => c.nombre !== nombre));
    void this.guardar();
  }

  borrarPlato(indice: number): void {
    this.menu.set(this.menu().filter((_, i) => i !== indice));
    void this.guardar();
  }
}
```

- [ ] **Step 6: Correr el test, confirmar que pasa**

```bash
npm --prefix portal run test:components -- --include='**/cliente-menu.spec.ts'
```

- [ ] **Step 7: Typecheck**

```bash
npm --prefix portal run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add portal/src/app/pages/clientes/cliente-ficha.ts portal/src/app/app.routes.ts \
        portal/src/app/pages/clientes/cliente-menu.ts portal/src/app/pages/clientes/cliente-menu.spec.ts
git commit -m "feat(portal): tab Menú — lista de categorías y platos, con alta/borrado"
```

---

### Task 6: `portal` — detalle de un plato (`cliente-menu-detalle.ts`)

**Files:**
- Modify: `portal/src/app/app.routes.ts`
- Create: `portal/src/app/pages/clientes/cliente-menu-detalle.ts`
- Create: `portal/src/app/pages/clientes/cliente-menu-detalle.spec.ts`

**Interfaces:**
- Consumes: `ApiService.obtenerMenu`/`guardarMenu`, todos los tipos de Task 4, `ALERGENOS`/
  `ETIQUETA_ALERGENO`/`ETIQUETAS_DIETETICAS`/`ETIQUETA_DIETETICA_LABEL` de Task 4
  (`menu-taxonomia.ts`), y la convención de índice fijada en Task 5 (`platos().length` = "nuevo").
- Produces: la ruta `/clientes/:id/menu/:index` montada.

- [ ] **Step 1: Registrar la ruta `menu/:index`**

En `portal/src/app/app.routes.ts`, agregar inmediatamente después de la entrada `menu` que agregó la
Task 5:

```typescript
          {
            // El detalle de UN plato, por posición — ver "Por qué la identidad de un plato es su
            // posición" en el spec. Va DESPUÉS de `menu` por el mismo motivo que `ideas/:ideaId` va
            // después de `ideas`: legibilidad, no precedencia (el router no hace prefijo parcial).
            path: 'menu/:index',
            loadComponent: () =>
              import('./pages/clientes/cliente-menu-detalle').then((m) => m.ClienteMenuDetallePage),
          },
```

- [ ] **Step 2: Escribir el test que falla**

Crear `portal/src/app/pages/clientes/cliente-menu-detalle.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteMenuDetallePage } from './cliente-menu-detalle';
import { ApiService } from '../../services/api';
import type { MenuCarta } from '../../core/models';

function cartaDePrueba(overrides: Partial<MenuCarta> = {}): MenuCarta {
  return {
    menu: [
      {
        name: 'Margherita',
        category: 'Pizzas',
        description: 'Tomate San Marzano, mozzarella, albahaca.',
        precios: [{ etiqueta: 'Media', importe: '9,00 €', comensales: '1 persona' }],
        alergenos: ['gluten', 'lacteos'],
        etiquetas: ['vegetariano'],
        nutricion: { calorias: 620, proteinas_g: 26 },
        foto: { src: 'https://a.storyblok.com/f/1/margherita.jpg' },
        video: {
          src: 'https://a.storyblok.com/f/1/margherita.mp4',
          poster: { src: 'https://a.storyblok.com/f/1/poster.jpg', alt: 'Margherita' },
        },
      },
    ],
    menu_categorias: [{ nombre: 'Pizzas' }],
    ...overrides,
  };
}

function crear(
  opciones: {
    obtenerMenu?: jasmine.Spy;
    guardarMenu?: jasmine.Spy;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const obtenerMenuSpy = opciones.obtenerMenu ?? jasmine.createSpy('obtenerMenu').and.resolveTo(cartaDePrueba());
  const guardarMenuSpy = opciones.guardarMenu ?? jasmine.createSpy('guardarMenu').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1', index: '0' }));

  TestBed.configureTestingModule({
    imports: [ClienteMenuDetallePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { obtenerMenu: obtenerMenuSpy, guardarMenu: guardarMenuSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteMenuDetallePage);
  return { fixture, obtenerMenuSpy, guardarMenuSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteMenuDetallePage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteMenuDetallePage', () => {
  it('carga el plato existente en el índice: nombre, descripción, precio, alérgenos, etiquetas, nutrición', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Margherita');
    expect(el.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toContain(
      'San Marzano',
    );
    expect(el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')?.value).toBe('9,00 €');
    expect(el.querySelector<HTMLInputElement>('input[name="alergeno-gluten"]')?.checked).toBeTrue();
    expect(el.querySelector<HTMLInputElement>('input[name="alergeno-pescado"]')?.checked).toBeFalse();
    expect(el.querySelector<HTMLInputElement>('input[name="etiqueta-vegetariano"]')?.checked).toBeTrue();
    expect(el.querySelector<HTMLInputElement>('input[name="nutricionCalorias"]')?.value).toBe('620');
  });

  it('índice igual a la longitud del array: formulario vacío para un plato NUEVO', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' })); // menu tiene 1 plato: índice 1 = nuevo
    const { fixture } = crear({ params });
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('');
    expect(el.textContent).toContain('Plato nuevo');
  });

  it('🔴 índice mayor a la longitud → "Plato no encontrado", sin excepción sin manejar', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '99' }));
    const { fixture } = crear({ params });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Plato no encontrado');
    expect(el.querySelector('input[name="name"]')).toBeFalsy();
  });

  it('un plato legacy con `price` suelto (sin `precios`) se migra a una fila de precios al abrirlo', async () => {
    const carta = cartaDePrueba({
      // `price` no está en el tipo `MenuItem` del portal (ver Task 4) — se simula tal como llega de
      // un cliente sembrado por SQL antes de este editor, con un cast a `unknown` para saltarse el
      // chequeo de tipos del test (el runtime SÍ puede traerlo).
      menu: [{ name: 'Cacio e pepe', price: '13,00 €' } as unknown as MenuCarta['menu'][number]],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')?.value).toBe('13,00 €');
  });

  it('guardar un plato nuevo lo agrega al final del array y llama a guardarMenu con la carta completa', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture, guardarMenuSpy } = crear({ params });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Diavola';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    const inputEtiqueta0 = el.querySelector<HTMLInputElement>('input[name="precio0Etiqueta"]')!;
    inputEtiqueta0.value = 'Precio';
    inputEtiqueta0.dispatchEvent(new Event('input'));
    const inputImporte0 = el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')!;
    inputImporte0.value = '13,00 €';
    inputImporte0.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [clientId, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(clientId).toBe('c1');
    expect(carta.menu.map((p) => p.name)).toEqual(['Margherita', 'Diavola']);
  });

  it('guardar un plato existente lo reemplaza EN SU POSICIÓN, sin tocar los demás', async () => {
    const carta = cartaDePrueba({
      menu: [
        { name: 'Margherita' },
        { name: 'Diavola' },
      ],
    });
    const { fixture, guardarMenuSpy } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Margherita (editada)';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    const [, cartaGuardada] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(cartaGuardada.menu.map((p) => p.name)).toEqual(['Margherita (editada)', 'Diavola']);
  });

  it('el aviso de "sin poster no se muestra el video" aparece si hay video.src pero no video.poster.src', async () => {
    const carta = cartaDePrueba({ menu: [{ name: 'Margherita', video: { src: 'https://a.storyblok.com/f/1/x.mp4' } }] });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('sin imagen de portada, el video no se va a mostrar');
  });

  it('🔴 nombre vacío no se guarda: guardarMenu no se llama y se ve el error de validación', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture, guardarMenuSpy } = crear({ params });
    const el = await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(guardarMenuSpy).not.toHaveBeenCalled();
    expect(el.textContent).toContain('El nombre no puede quedar vacío.');
  });

  it('🔴 el error 400 del servidor (campos) se muestra sin que la pantalla quede en blanco', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const guardarMenuSpy = jasmine
      .createSpy('guardarMenu')
      .and.rejectWith(new Error('El menú no es válido.'));
    const { fixture } = crear({ params, guardarMenu: guardarMenuSpy });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Plato con error';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(el.textContent).toContain('El menú no es válido.');
  });
});
```

- [ ] **Step 3: Correr el test, confirmar que falla**

```bash
npm --prefix portal run test:components -- --include='**/cliente-menu-detalle.spec.ts'
```

Expected: FAIL — `./cliente-menu-detalle` no existe.

- [ ] **Step 4: Implementar `cliente-menu-detalle.ts`**

Crear `portal/src/app/pages/clientes/cliente-menu-detalle.ts`:

```typescript
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { Alergeno, EtiquetaDietetica, MenuCategoria, MenuItem, PrecioMenu } from '../../core/models';
import { ALERGENOS, ETIQUETA_ALERGENO, ETIQUETAS_DIETETICAS, ETIQUETA_DIETETICA_LABEL } from '../../core/menu-taxonomia';
import { Vigencia } from '../../core/vigencia';

const MAX_PRECIOS = 3;

/** Un precio en edición: los tres campos como string (`comensales` puede quedar vacío). */
interface PrecioForm {
  etiqueta: string;
  importe: string;
  comensales: string;
}

/** El formulario completo de un plato. Todo string/boolean: la conversión a `MenuItem` (recorte de
 *  vacíos, parseo de números) pasa por `platoDesdeFormulario()` recién al guardar. */
interface FormularioPlato {
  name: string;
  description: string;
  category: string;
  nota: string;
  precios: PrecioForm[];
  fotoSrc: string;
  videoSrc: string;
  videoPosterSrc: string;
  videoPosterAlt: string;
  alergenos: Set<Alergeno>;
  etiquetas: Set<EtiquetaDietetica>;
  calorias: string;
  proteinasG: string;
  carbohidratosG: string;
  grasasG: string;
}

function formularioVacio(): FormularioPlato {
  return {
    name: '',
    description: '',
    category: '',
    nota: '',
    precios: [{ etiqueta: '', importe: '', comensales: '' }],
    fotoSrc: '',
    videoSrc: '',
    videoPosterSrc: '',
    videoPosterAlt: '',
    alergenos: new Set(),
    etiquetas: new Set(),
    calorias: '',
    proteinasG: '',
    carbohidratosG: '',
    grasasG: '',
  };
}

/**
 * Arma el formulario a partir de un `MenuItem` ya guardado.
 *
 * **Migra `price` suelto a `precios`** si el plato no tiene `precios` pero sí trae `price` (un
 * cast a `unknown` porque `MenuItem` del portal no declara ese campo — ver Task 4): sin esto, abrir
 * un plato cargado por SQL antes de este editor mostraría el precio vacío, y guardar lo borraría de
 * verdad. Nunca al revés (`precios` nunca se aplana a `price`): el editor del portal siempre escribe
 * con `precios`.
 */
function formularioDesde(item: MenuItem): FormularioPlato {
  const legacyPrice = (item as unknown as { price?: string }).price;
  const precios: PrecioForm[] =
    item.precios && item.precios.length > 0
      ? item.precios.map((p) => ({ etiqueta: p.etiqueta, importe: p.importe, comensales: p.comensales ?? '' }))
      : legacyPrice
        ? [{ etiqueta: 'Precio', importe: legacyPrice, comensales: '' }]
        : [{ etiqueta: '', importe: '', comensales: '' }];

  return {
    name: item.name,
    description: item.description ?? '',
    category: item.category ?? '',
    nota: item.nota ?? '',
    precios,
    fotoSrc: item.foto?.src ?? '',
    videoSrc: item.video?.src ?? '',
    videoPosterSrc: item.video?.poster?.src ?? '',
    videoPosterAlt: item.video?.poster?.alt ?? '',
    alergenos: new Set(item.alergenos ?? []),
    etiquetas: new Set(item.etiquetas ?? []),
    calorias: item.nutricion?.calorias?.toString() ?? '',
    proteinasG: item.nutricion?.proteinas_g?.toString() ?? '',
    carbohidratosG: item.nutricion?.carbohidratos_g?.toString() ?? '',
    grasasG: item.nutricion?.grasas_g?.toString() ?? '',
  };
}

/** El inverso de `formularioDesde`: recorta filas de precio vacías y campos opcionales sin valor —
 *  nunca manda `foto`/`video`/`nutricion` con todas sus claves vacías. */
function platoDesdeFormulario(f: FormularioPlato): MenuItem {
  const precios: PrecioMenu[] = f.precios
    .filter((p) => p.etiqueta.trim() !== '' && p.importe.trim() !== '')
    .map((p) => ({
      etiqueta: p.etiqueta.trim(),
      importe: p.importe.trim(),
      ...(p.comensales.trim() ? { comensales: p.comensales.trim() } : {}),
    }));

  const numero = (s: string): number | undefined => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  const nutricion = {
    calorias: numero(f.calorias),
    proteinas_g: numero(f.proteinasG),
    carbohidratos_g: numero(f.carbohidratosG),
    grasas_g: numero(f.grasasG),
  };
  const hayNutricion = Object.values(nutricion).some((v) => v !== undefined);

  const plato: MenuItem = { name: f.name.trim() };
  if (f.description.trim()) plato.description = f.description.trim();
  if (f.category.trim()) plato.category = f.category.trim();
  if (f.nota.trim()) plato.nota = f.nota.trim();
  if (precios.length > 0) plato.precios = precios;
  if (f.fotoSrc.trim()) plato.foto = { src: f.fotoSrc.trim() };
  if (f.videoSrc.trim()) {
    plato.video = {
      src: f.videoSrc.trim(),
      ...(f.videoPosterSrc.trim()
        ? { poster: { src: f.videoPosterSrc.trim(), ...(f.videoPosterAlt.trim() ? { alt: f.videoPosterAlt.trim() } : {}) } }
        : {}),
    };
  }
  if (f.alergenos.size > 0) plato.alergenos = [...f.alergenos];
  if (f.etiquetas.size > 0) plato.etiquetas = [...f.etiquetas];
  if (hayNutricion) plato.nutricion = nutricion;

  return plato;
}

/**
 * El detalle de UN plato: `/clientes/:id/menu/:index`. Igual que Ideas, dos partes separadas por
 * `Vigencia` (acá con clave `${clienteId}:${index}`, porque la identidad depende de las DOS): la
 * carga vuelve a pedir `GET /clients/:id/menu` cada vez (nunca reutiliza el array de la lista, ver
 * el spec), y `index === menu.length` es "plato nuevo" — ver `cliente-menu.ts`.
 */
@Component({
  selector: 'app-cliente-menu-detalle',
  imports: [FormsModule],
  template: `
    <div class="space-y-6">
      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (noEncontrado()) {
        <p class="text-sm text-error">Plato no encontrado.</p>
      } @else {
        <h1 class="text-lg font-medium text-texto">{{ esNuevo() ? 'Plato nuevo' : formulario().name }}</h1>

        @if (errorGuardar()) {
          <p class="text-sm text-error">{{ errorGuardar() }}</p>
        }
        @if (errorValidacion()) {
          <p class="text-sm text-error">{{ errorValidacion() }}</p>
        }

        <form class="space-y-4" (submit)="guardar($event)">
          <div>
            <label for="name" class="block text-xs text-texto-tenue">Nombre</label>
            <input
              id="name"
              name="name"
              [ngModel]="formulario().name"
              (ngModelChange)="actualizar({ name: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label for="description" class="block text-xs text-texto-tenue">Descripción</label>
            <textarea
              id="description"
              name="description"
              [ngModel]="formulario().description"
              (ngModelChange)="actualizar({ description: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            ></textarea>
          </div>

          <div>
            <label for="category" class="block text-xs text-texto-tenue">Categoría</label>
            <select
              id="category"
              name="category"
              [ngModel]="formulario().category"
              (ngModelChange)="actualizar({ category: $event })"
              class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            >
              <option value="">Sin categoría</option>
              @for (cat of categorias(); track cat.nombre) {
                <option [value]="cat.nombre">{{ cat.nombre }}</option>
              }
            </select>
          </div>

          <div>
            <label for="nota" class="block text-xs text-texto-tenue">Nota</label>
            <input
              id="nota"
              name="nota"
              [ngModel]="formulario().nota"
              (ngModelChange)="actualizar({ nota: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            />
          </div>

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Precios (hasta {{ maxPrecios }})</legend>
            @for (precio of formulario().precios; track $index) {
              <div class="flex gap-2">
                <input
                  [name]="'precio' + $index + 'Etiqueta'"
                  placeholder="Etiqueta (ej. Media)"
                  [ngModel]="precio.etiqueta"
                  (ngModelChange)="actualizarPrecio($index, { etiqueta: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'precio' + $index + 'Importe'"
                  placeholder="Importe (ej. 9,00 €)"
                  [ngModel]="precio.importe"
                  (ngModelChange)="actualizarPrecio($index, { importe: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'precio' + $index + 'Comensales'"
                  placeholder="Comensales (opcional)"
                  [ngModel]="precio.comensales"
                  (ngModelChange)="actualizarPrecio($index, { comensales: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
            }
            @if (formulario().precios.length < maxPrecios) {
              <button type="button" class="text-xs text-acento" (click)="agregarFilaPrecio()">
                + agregar precio
              </button>
            }
          </fieldset>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="fotoSrc" class="block text-xs text-texto-tenue">Foto (URL)</label>
              <input
                id="fotoSrc"
                name="fotoSrc"
                [ngModel]="formulario().fotoSrc"
                (ngModelChange)="actualizar({ fotoSrc: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="videoSrc" class="block text-xs text-texto-tenue">Video (URL)</label>
              <input
                id="videoSrc"
                name="videoSrc"
                [ngModel]="formulario().videoSrc"
                (ngModelChange)="actualizar({ videoSrc: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>

          @if (formulario().videoSrc.trim()) {
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="videoPosterSrc" class="block text-xs text-texto-tenue">Poster del video (URL)</label>
                <input
                  id="videoPosterSrc"
                  name="videoPosterSrc"
                  [ngModel]="formulario().videoPosterSrc"
                  (ngModelChange)="actualizar({ videoPosterSrc: $event })"
                  class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label for="videoPosterAlt" class="block text-xs text-texto-tenue">Texto alternativo del poster</label>
                <input
                  id="videoPosterAlt"
                  name="videoPosterAlt"
                  [ngModel]="formulario().videoPosterAlt"
                  (ngModelChange)="actualizar({ videoPosterAlt: $event })"
                  class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
            </div>
            @if (!formulario().videoPosterSrc.trim()) {
              <p class="text-xs text-texto-tenue">
                Sin imagen de portada, el video no se va a mostrar en el sitio público.
              </p>
            }
          }

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Alérgenos</legend>
            <div class="grid grid-cols-3 gap-2">
              @for (a of ALERGENOS; track a) {
                <label class="flex items-center gap-2 text-sm text-texto">
                  <input
                    type="checkbox"
                    [name]="'alergeno-' + a"
                    [ngModel]="formulario().alergenos.has(a)"
                    (ngModelChange)="alternarAlergeno(a, $event)"
                  />
                  {{ ETIQUETA_ALERGENO[a] }}
                </label>
              }
            </div>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Etiquetas dietéticas</legend>
            <div class="grid grid-cols-3 gap-2">
              @for (e of ETIQUETAS_DIETETICAS; track e) {
                <label class="flex items-center gap-2 text-sm text-texto">
                  <input
                    type="checkbox"
                    [name]="'etiqueta-' + e"
                    [ngModel]="formulario().etiquetas.has(e)"
                    (ngModelChange)="alternarEtiqueta(e, $event)"
                  />
                  {{ ETIQUETA_DIETETICA_LABEL[e] }}
                </label>
              }
            </div>
          </fieldset>

          <fieldset class="grid grid-cols-4 gap-2">
            <legend class="text-xs text-texto-tenue col-span-4">Nutrición (ración de referencia)</legend>
            <div>
              <label for="nutricionCalorias" class="block text-xs text-texto-tenue">Calorías</label>
              <input
                id="nutricionCalorias"
                name="nutricionCalorias"
                type="number"
                [ngModel]="formulario().calorias"
                (ngModelChange)="actualizar({ calorias: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionProteinas" class="block text-xs text-texto-tenue">Proteínas (g)</label>
              <input
                id="nutricionProteinas"
                name="nutricionProteinas"
                type="number"
                [ngModel]="formulario().proteinasG"
                (ngModelChange)="actualizar({ proteinasG: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionCarbohidratos" class="block text-xs text-texto-tenue">Carbohidratos (g)</label>
              <input
                id="nutricionCarbohidratos"
                name="nutricionCarbohidratos"
                type="number"
                [ngModel]="formulario().carbohidratosG"
                (ngModelChange)="actualizar({ carbohidratosG: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionGrasas" class="block text-xs text-texto-tenue">Grasas (g)</label>
              <input
                id="nutricionGrasas"
                name="nutricionGrasas"
                type="number"
                [ngModel]="formulario().grasasG"
                (ngModelChange)="actualizar({ grasasG: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </fieldset>

          <button type="submit" class="cta" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class ClienteMenuDetallePage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly vigencia = new Vigencia();

  readonly ALERGENOS = ALERGENOS;
  readonly ETIQUETA_ALERGENO = ETIQUETA_ALERGENO;
  readonly ETIQUETAS_DIETETICAS = ETIQUETAS_DIETETICAS;
  readonly ETIQUETA_DIETETICA_LABEL = ETIQUETA_DIETETICA_LABEL;
  readonly maxPrecios = MAX_PRECIOS;

  private clienteId = '';
  private indice = -1;
  private menuCompleto: MenuItem[] = [];
  readonly categorias = signal<MenuCategoria[]>([]);

  readonly formulario = signal<FormularioPlato>(formularioVacio());
  readonly esNuevo = signal(false);
  readonly noEncontrado = signal(false);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly errorGuardar = signal('');
  readonly errorValidacion = signal('');

  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const clienteId = params.get('id') ?? '';
      const indiceParam = params.get('index') ?? '';
      const clave = `${clienteId}:${indiceParam}`;
      if (clave === this.vigencia.actual) return;
      this.vigencia.cambiarA(clave);
      this.clienteId = clienteId;
      this.indice = Number(indiceParam);
      this.noEncontrado.set(false);
      this.errorGuardar.set('');
      this.errorValidacion.set('');
      void this.cargar(clave, clienteId);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  private async cargar(pedido: string, clienteId: string): Promise<void> {
    this.cargando.set(true);
    try {
      const carta = await this.api.obtenerMenu(clienteId);
      if (this.vigencia.obsoleta(pedido)) return;
      this.menuCompleto = carta.menu;
      this.categorias.set(carta.menu_categorias);

      if (this.indice < 0 || this.indice > carta.menu.length || Number.isNaN(this.indice)) {
        this.noEncontrado.set(true);
      } else if (this.indice === carta.menu.length) {
        this.esNuevo.set(true);
        this.formulario.set(formularioVacio());
      } else {
        this.esNuevo.set(false);
        this.formulario.set(formularioDesde(carta.menu[this.indice]!));
      }
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.errorGuardar.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  actualizar(cambios: Partial<FormularioPlato>): void {
    this.formulario.set({ ...this.formulario(), ...cambios });
  }

  actualizarPrecio(indice: number, cambios: Partial<PrecioForm>): void {
    const precios = this.formulario().precios.map((p, i) => (i === indice ? { ...p, ...cambios } : p));
    this.actualizar({ precios });
  }

  agregarFilaPrecio(): void {
    if (this.formulario().precios.length >= MAX_PRECIOS) return;
    this.actualizar({ precios: [...this.formulario().precios, { etiqueta: '', importe: '', comensales: '' }] });
  }

  alternarAlergeno(a: Alergeno, marcado: boolean): void {
    const alergenos = new Set(this.formulario().alergenos);
    if (marcado) alergenos.add(a);
    else alergenos.delete(a);
    this.actualizar({ alergenos });
  }

  alternarEtiqueta(e: EtiquetaDietetica, marcado: boolean): void {
    const etiquetas = new Set(this.formulario().etiquetas);
    if (marcado) etiquetas.add(e);
    else etiquetas.delete(e);
    this.actualizar({ etiquetas });
  }

  async guardar(evento: Event): Promise<void> {
    evento.preventDefault();
    this.errorValidacion.set('');
    if (!this.formulario().name.trim()) {
      this.errorValidacion.set('El nombre no puede quedar vacío.');
      return;
    }

    const plato = platoDesdeFormulario(this.formulario());
    const nuevoMenu = this.esNuevo()
      ? [...this.menuCompleto, plato]
      : this.menuCompleto.map((p, i) => (i === this.indice ? plato : p));

    const clave = this.vigencia.actual;
    this.guardando.set(true);
    this.errorGuardar.set('');
    try {
      await this.api.guardarMenu(this.clienteId, { menu: nuevoMenu, menu_categorias: this.categorias() });
      if (this.vigencia.obsoleta(clave)) return;
      void this.router.navigate(['/clientes', this.clienteId, 'menu']);
    } catch (e) {
      if (this.vigencia.obsoleta(clave)) return;
      this.errorGuardar.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(clave)) this.guardando.set(false);
    }
  }
}
```

- [ ] **Step 5: Correr el test, confirmar que pasa**

```bash
npm --prefix portal run test:components -- --include='**/cliente-menu-detalle.spec.ts'
```

- [ ] **Step 6: Typecheck y suite completa del portal**

```bash
npm --prefix portal run typecheck
npm --prefix portal run test:components
```

Expected: limpio, sin regresiones.

- [ ] **Step 7: Manejar la app en el navegador (C6 de CHECKPOINTS.md — obligatorio, toca el portal)**

```bash
npm run dev:server -w api      # API real sobre PGlite
npm --prefix portal start      # ng serve
```

En el navegador: entrar a un cliente → tab "Menú" → agregar una categoría → agregar un plato con
video+poster, alérgenos, etiquetas y nutrición → guardar → volver a la lista → confirmar que
aparece → editarlo → confirmar que los checkboxes/valores cargan tal cual se guardaron → borrar el
plato → confirmar que desaparece → intentar borrar una categoría con platos → confirmar que el botón
está deshabilitado. Consola sin errores propios. Los dos temas (claro/oscuro).

- [ ] **Step 8: Commit**

```bash
git add portal/src/app/app.routes.ts portal/src/app/pages/clientes/cliente-menu-detalle.ts \
        portal/src/app/pages/clientes/cliente-menu-detalle.spec.ts
git commit -m "feat(portal): formulario completo de un plato (alta y edición)"
```

---

### Task 7: Documentación de cierre

**Files:**
- Modify: `docs/proyecto/09-estado-y-roadmap.md`
- Modify: `docs/proyecto/15-plan-plataforma.md`
- Modify: `docs/decisiones-arquitectura.md`

**Interfaces:** ninguna — solo prosa. Esta task la ejecuta la sesión principal, no un subagente (ver
AGENTS.md: "Integrar, verificar el conjunto y commitear es siempre de la sesión principal").

- [ ] **Step 1: Actualizar `docs/proyecto/15-plan-plataforma.md`**

En el ítem 3 del Bloque E (que hoy dice "Sin editor en el portal — spec y plan en..."), agregar una
nota fechada confirmando que el editor se implementó, con el link al plan y al spec, y la cifra de
tests final (a completar con el número real tras correr `npm run verificar` al cerrar).

- [ ] **Step 2: Actualizar `docs/proyecto/09-estado-y-roadmap.md`**

Agregar una entrada 🧭 nueva (fecha del cierre) describiendo: el tab Menú, los dos endpoints, que no
hizo falta migración, y sincronizar las cifras de tests del monorepo y del portal.

- [ ] **Step 3: Anotar en `docs/decisiones-arquitectura.md`**

Junto a **OBS-04**/**ADR-20**, una nota fechada: la excepción de `cliente` para editar su propia
carta se evaluó al diseñar esta etapa y se DIFIRIÓ a propósito (no es un olvido) — el mecanismo
(trigger `BEFORE UPDATE` comparando OLD/NEW de `business_profile`, para no tocar `app.puede_escribir()`
que gobierna otras cuatro tablas) queda descrito en
[2026-08-17-editor-menu-portal-design.md](../superpowers/specs/2026-08-17-editor-menu-portal-design.md)
para cuando se retome.

- [ ] **Step 4: Verificación completa**

```bash
npm run verificar
```

Expected: entorno, arnés, secretos, typecheck y tests todos en verde — con el output a la vista, no
de memoria.

- [ ] **Step 5: Commit**

```bash
git add docs/proyecto/09-estado-y-roadmap.md docs/proyecto/15-plan-plataforma.md docs/decisiones-arquitectura.md
git commit -m "docs: cierre del editor de carta en el portal"
```

---

## Self-Review (hecho por quien escribió este plan, antes de entregarlo)

**Cobertura del spec:** las 8 secciones del spec (`GET`, `PATCH`, merge NULL-safe, subpath
`web-builder/contract`, identidad por índice, bloqueo de borrado de categoría, error estructurado,
test de equivalencia) tienen cada una una task o un step que las implementa — repasado línea por
línea contra el spec revisado por Codex.

**Placeholders:** ninguno — cada step tiene código literal, no "agregar validación" ni "similar a
la Task N" sin el código repetido.

**Consistencia de tipos:** `MenuCarta`/`MenuItem`/`MenuCategoria`/`PrecioMenu`/`FotoMenu`/
`VideoMenu`/`InfoNutricional`/`Alergeno`/`EtiquetaDietetica` (Task 4) son los mismos nombres que usan
las Tasks 5 y 6 — verificado que ningún nombre cambia entre tasks (p. ej. `MenuCarta.menu_categorias`,
no `categorias`, en todas partes donde se lee el body de la API).

**Alcance fuera de este plan, explícitamente:** el trigger `BEFORE UPDATE` para que `cliente` edite
(diferido con nota en Task 7), y la subida de archivos desde el portal (fuera de alcance del spec).
