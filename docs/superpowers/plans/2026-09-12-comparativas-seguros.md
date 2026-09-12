# Comparativas de seguros — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Goal:** que una correduría suba las cotizaciones que ya tiene y reciba un informe comparativo
imprimible y un borrador de mail, revisados por una persona antes de poder salir.

**Architecture:** síncrono dentro de `api/`, **sin Inngest** — no hay compuerta humana asíncrona ni
pasos de minutos, es una llamada de segundos. El navegador convierte el archivo a filas y la API
**nunca recibe un binario**; el link de Google Sheet sí lo baja el servidor, porque el navegador no
puede por CORS, pero baja **texto**. El LLM interpreta columnas de formato libre. El gate de revisión
es un hecho persistido (`revisado_en`/`revisado_por`), no un estado de pantalla.

**Tech Stack:** TypeScript ESM strict + `tsx` (sin paso de build), Hono, Postgres con RLS, `node:test`
+ PGlite, Angular con signals, `openai` (ya presente en el monorepo vía `orchestrator`).

## Global Constraints

- **El rol se DERIVA de `memberships` dentro de Postgres** (ADR-15). Ningún handler mira rol. Nunca
  `role`, `tenant_id` ni `client_id` propio en un body.
- **Acceso a la base solo por transacción con conexión reservada** (`Tx`, ADR-13). Nunca un `query()`
  suelto. El molde exacto es `PgResenas.withTenant` (`db/src/resenas.ts:78-86`).
- **Rojo primero, después el arreglo, después verificación por mutación**: reintroducí el bug y
  confirmá que cae *exactamente* su test.
- **Un default de producción sin test es una decisión sin dueño.** Toda constante de este plan lleva su
  test de valor. (Lección del 2026-09-12: mutar `PLAZO_DESCARGA_MS` no hacía caer nada porque los tests
  elegían el parámetro en vez de fijar el de producción.)
- **Nombres de dominio en español.** Los comentarios explican **por qué**, no qué.
- **Nada de HTML crudo desde el LLM.** El Markdown se parsea y se dibuja con `@if`/`@for`, vigilado por
  `portal/src/app/core/sin-html-crudo.test.ts`.
- **Migración libre: `0033`.** Ninguna migración ya aplicada se vuelve a tocar, **ni su comentario**
  (lección del 2026-09-03 con la `0018`: un cambio de comentario movió el checksum y bloqueó el deploy).
- **Todo el módulo se gatea con `clients.vertical = 'correduria_seguros'`**, que es inmutable tras el
  alta. Nunca con un flag nuevo.

## Decisiones ya tomadas, que este plan NO vuelve a abrir

| Decisión | Valor | Quién |
| --- | --- | --- |
| `.xlsx` | **Lo convierte el navegador**; la API recibe filas de texto | Juan, 2026-09-12 |
| Link de Google Sheet | Lo baja **el servidor** (CORS impide al navegador), como texto CSV | este plan |
| PDF | Lo produce el navegador (`window.print()`), como `entregable.ts` | 2026-08-07 |
| Mail | Draft para copiar, nunca envío automático | spec |
| Gate de revisión | `revisado_en`/`revisado_por` en base, no flag de pantalla | spec |
| Edición del informe | **Fuera de alcance en v1** — revisar es confirmar, no corregir | spec |

## Los tres números de producción que este plan fija

Técnicos, con test, y ajustables si la realidad los desmiente:

| Constante | Valor | Por qué |
| --- | --- | --- |
| `MAX_FILAS` | `200` | Una comparativa para **un** cliente final con más de 200 cotizaciones no es el caso de uso: es una hoja pegada por error |
| `MAX_BYTES_ENTRADA` | `512 * 1024` | Tope del texto que llega al LLM. 512 KB ya son ~130k tokens |
| `MAX_COSTO_USD` | `0.10` | Techo duro **por comparativa**, comprobado ANTES de llamar. A precio de `gpt-4o-mini` una comparativa real cuesta céntimos: esto frena la fuga, no el uso normal |

---

## Estructura de archivos

```text
db/
  migrations/0033_comparativas_seguros.sql   tabla + RLS + grants (molde: 0021)
  src/comparativas-seguros.ts                PgComparativasSeguros (molde: PgResenas)
  src/comparativas-seguros.test.ts           RLS, aislamiento cross-tenant, el gate

api/
  src/comparativas/filas.ts                  CSV -> filas + los topes (funciones puras)
  src/comparativas/filas.test.ts
  src/comparativas/sheet.ts                  link de Google Sheet -> texto CSV
  src/comparativas/sheet.test.ts
  src/comparativas/provider.ts               interfaz + selector mock/openai
  src/comparativas/mock-provider.ts          determinista, sin red
  src/comparativas/openai-provider.ts        real, con preflight de gasto
  src/comparativas/provider.test.ts
  src/app.ts                                 los cuatro endpoints
  src/deps.ts                                cableado

portal/
  src/app/core/hoja-a-filas.ts               xlsx/csv -> filas, EN EL NAVEGADOR
  src/app/pages/comparativas/form.ts         subir archivo o pegar link
  src/app/pages/comparativas/resultado.ts    informe imprimible + mail + gate
  src/app/pages/comparativas/listado.ts      historial
  src/app/pages/clientes/cliente-ficha.ts    tab nuevo, gateado por vertical
  src/app/app.routes.ts                      rutas
```

---

### Task 1: la migración `0033` y la capa de acceso

**Files:**
- Create: `db/migrations/0033_comparativas_seguros.sql`
- Create: `db/src/comparativas-seguros.ts`
- Create: `db/src/comparativas-seguros.test.ts`
- Modify: `db/src/index.ts` (exportar la clase y el tipo)

**Interfaces:**

⚠️ **Dos tipos con nombre parecido, y no son lo mismo.** `ComparativaSeguros` (acá) es **la fila de la
base**; `Comparativa` (Task 4) es **lo que devuelve el LLM**, sin id ni timestamps ni gate. El endpoint
de Task 6 es quien convierte el segundo en el primero. No los unifiques: uno tiene dueño en Postgres y
el otro es la salida de un provider que puede fallar.

- Produces:

```ts
export interface ComparativaSeguros {
  id: string;
  clientId: string;
  creadoPor: string;
  clienteFinalNombre: string;
  clienteFinalEmail: string | null;
  opciones: OpcionSeguro[];       // el mismo shape que produce el provider (Task 4)
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
  /** `null` = pendiente de revisión. Los dos viajan juntos: lo impone un `check` de la tabla. */
  revisadoEn: string | null;
  revisadoPor: string | null;
  createdAt: string;
}

/** Lo que el endpoint le pasa a `crear`. NO lleva `creadoPor`: sale de `ctx.userId`, nunca del body. */
export interface DatosComparativa {
  clienteFinalNombre: string;
  clienteFinalEmail: string | null;
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
}

export class PgComparativasSeguros {
  constructor(pool: DbPool);
  crear(ctx: TenantContext, clientId: string, datos: DatosComparativa): Promise<string>;
  obtener(ctx: TenantContext, clientId: string, id: string): Promise<ComparativaSeguros | null>;
  listarPorCliente(ctx: TenantContext, clientId: string): Promise<ComparativaSeguros[]>;
  marcarRevisada(ctx: TenantContext, clientId: string, id: string): Promise<boolean>;
}
```

`OpcionSeguro` lo define Task 4. Como `db/` no puede importar de `api/`, **declaralo en
`db/src/comparativas-seguros.ts` y que Task 4 importe desde `db`** — mismo sentido que las demás formas
compartidas del repo, y así hay una sola definición en vez de dos que derivan.

- [ ] **Step 1: escribir la migración**

Molde: `db/migrations/0021_resenas_google.sql`. La FK compuesta `(tenant_id, client_id)` no es
decorativa: impide que una fila apunte a un cliente de otro tenant.

```sql
create table comparativas_seguros (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  client_id             uuid not null,
  creado_por            uuid not null,
  cliente_final_nombre  text not null check (length(cliente_final_nombre) between 1 and 200),
  cliente_final_email   text check (cliente_final_email is null or length(cliente_final_email) <= 320),
  opciones              jsonb not null,
  recomendacion         text not null,
  informe_md            text not null,
  mail_asunto           text not null,
  mail_cuerpo_md        text not null,
  costo_usd             numeric not null default 0 check (costo_usd >= 0),
  revisado_en           timestamptz,
  revisado_por          uuid,
  created_at            timestamptz not null default now(),
  foreign key (tenant_id, client_id) references clients (tenant_id, id) on delete cascade,
  -- Los dos campos del gate viajan juntos o no viajan: media revisión no existe, y sin este check
  -- un update parcial dejaría una fila que la UI leería como revisada sin saber por quién.
  check ((revisado_en is null) = (revisado_por is null))
);

create index comparativas_seguros_cliente on comparativas_seguros (client_id, created_at desc);

alter table comparativas_seguros enable row level security;
alter table comparativas_seguros force row level security;

grant select, insert on comparativas_seguros to app_user;
-- Update SOLO de las dos columnas del gate: revisar es confirmar, no corregir. Es la mitad de lo que
-- hace cumplir el "v1 es de solo lectura" de la spec; la otra mitad es que no hay endpoint de edición.
grant update (revisado_en, revisado_por) on comparativas_seguros to app_user;

create policy comparativa_select on comparativas_seguros
  for select to app_user
  using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

create policy comparativa_insert on comparativas_seguros
  for insert to app_user
  with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir());

create policy comparativa_revisar on comparativas_seguros
  for update to app_user
  using      (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir())
  with check (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id) and app.puede_escribir());
```

- [ ] **Step 2: escribir los tests, en rojo**

En `db/src/comparativas-seguros.test.ts`. El patrón de aislamiento de este repo es **probar que el OTRO
no ve**, no que el propio sí. Molde: el test de RLS citado en
`progress/informes/worker-patrones-seguros.md` § 7.

```ts
test("🔴 el tenant B no ve la comparativa del tenant A", async () => {
  const id = await comparativas.crear(ctxA, clientA, DATOS);
  assert.equal(await comparativas.obtener(ctxB, clientA, id), null);
  assert.deepEqual(await comparativas.listarPorCliente(ctxB, clientA), []);
});

test("🔴 nace SIN revisar — el gate empieza cerrado, no abierto", async () => {
  const id = await comparativas.crear(ctxA, clientA, DATOS);
  const c = await comparativas.obtener(ctxA, clientA, id);
  assert.equal(c!.revisadoEn, null);
  assert.equal(c!.revisadoPor, null);
});

test("🔴 el rol `cliente` NO puede crear", async () => {
  await assert.rejects(() => comparativas.crear(ctxClienteA, clientA, DATOS));
});

test("🔴 revisar NO puede corregir: app_user no tiene grant sobre informe_md", async () => {
  const id = await comparativas.crear(ctxA, clientA, DATOS);
  await assert.rejects(
    () => sqlComoAppUser("update comparativas_seguros set informe_md = 'otro' where id = $1", [id]),
    /permission denied|42501/,
  );
});

test("🔴 el check del gate: no se puede poner revisado_en sin revisado_por", async () => {
  const id = await comparativas.crear(ctxA, clientA, DATOS);
  await assert.rejects(
    () => sqlComoAppUser("update comparativas_seguros set revisado_en = now() where id = $1", [id]),
    /23514/,
  );
});
```

Más el camino feliz: `crear` + `obtener` devuelve la fila; `marcarRevisada` pone los dos campos.

- [ ] **Step 3: correr y confirmar que fallan**

Run: `npm test -w db`
Expected: FAIL — la tabla no existe.

- [ ] **Step 4: escribir `PgComparativasSeguros`**

Copiá `withTenant` **verbatim** de `db/src/resenas.ts:78-86`: los dos `set_config` y el
`set local role app_user` son el contexto de tenant y no se improvisan.

Los cuatro métodos siguen la forma de `PgResenas`: `update … returning id` y `rows.length > 0` para
todo lo que puede afectar 0 filas por RLS. `crear` usa `insert … returning id`, y **`creado_por` sale
de `ctx.userId`, nunca del body**.

- [ ] **Step 5: correr hasta verde y mutar**

Run: `npm test -w db`
Mutaciones obligatorias, una a una, confirmando que cae **exactamente** su test:
- quitar `tenant_id = app.current_tenant_id()` de `comparativa_select` → cae el de aislamiento;
- quitar `app.puede_escribir()` de `comparativa_insert` → cae el del rol `cliente`;
- quitar el `check` del gate → cae el del update a medias;
- ampliar el grant de update a la tabla entera → cae el de `informe_md`.

- [ ] **Step 6: commit**

```bash
git add db/migrations/0033_comparativas_seguros.sql db/src/comparativas-seguros.ts db/src/comparativas-seguros.test.ts db/src/index.ts
git commit -m "db: tabla comparativas_seguros con RLS y el gate de revisión (0033)"
```

---

### Task 2: CSV a filas, con los topes

**Files:**
- Create: `api/src/comparativas/filas.ts`
- Create: `api/src/comparativas/filas.test.ts`

**Interfaces:**
- Produces: `MAX_FILAS`, `MAX_BYTES_ENTRADA`, `type Filas = string[][]`,
  `parsearCsv(texto: string): Filas`,
  `validarFilas(filas: Filas): { ok: true; filas: Filas } | { ok: false; motivo: string }`.

**Por qué un parser propio y no una dependencia:** son unas 40 líneas de RFC 4180, y lo que entra acá
ya es texto — el binario lo convirtió el navegador. El proyecto ya rechazó una vez su primera
dependencia de un formato (el PDF, 2026-08-07) por el mismo razonamiento.

- [ ] **Step 1: escribir los tests, en rojo**

Los casos que separan un parser correcto de un `split(",")`:

```ts
test("campos entre comillas con coma adentro no se parten", () => {
  assert.deepEqual(parsearCsv(`a,"b,c",d`), [["a", "b,c", "d"]]);
});

test("comillas escapadas dobles", () => {
  assert.deepEqual(parsearCsv(`"dice ""hola"""`), [[`dice "hola"`]]);
});

test("🔴 un salto de línea DENTRO de un campo entrecomillado no abre fila nueva", () => {
  assert.deepEqual(parsearCsv(`a,"linea1\nlinea2",c`), [["a", "linea1\nlinea2", "c"]]);
});

test("CRLF y LF valen los dos, y la última línea sin salto también", () => {
  assert.deepEqual(parsearCsv("a,b\r\nc,d\ne,f"), [["a", "b"], ["c", "d"], ["e", "f"]]);
});

test("🔴 MAX_FILAS es 200 — default de PRODUCCIÓN, no un parámetro del test", () => {
  assert.equal(MAX_FILAS, 200);
});

test("🔴 MAX_BYTES_ENTRADA son 512 KB", () => {
  assert.equal(MAX_BYTES_ENTRADA, 512 * 1024);
});

test("🔴 pasar de MAX_FILAS se rechaza, y el motivo dice el número", () => {
  const r = validarFilas(Array.from({ length: MAX_FILAS + 1 }, () => ["x"]));
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /200/);
});
```

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npx tsx --test api/src/comparativas/filas.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: implementar**

Máquina de estados de un carácter (dentro/fuera de comillas). **No usar `split(",")`**: es exactamente
lo que rompe con el primer campo entrecomillado, y es el bug que estos tests existen para impedir.

- [ ] **Step 4: verde y mutación**

Run: `npx tsx --test api/src/comparativas/filas.test.ts`
Mutar `MAX_FILAS = 200 → 5` (cae su test de valor) y reemplazar el parser por `linea.split(",")` (caen
los tres de comillas). Confirmar que cada mutación tumba lo suyo y nada más.

- [ ] **Step 5: commit**

```bash
git add api/src/comparativas/filas.ts api/src/comparativas/filas.test.ts
git commit -m "api: parser de CSV y topes de entrada para comparativas de seguros"
```

---

### Task 3: bajar el Google Sheet

**Files:**
- Create: `api/src/comparativas/sheet.ts`
- Create: `api/src/comparativas/sheet.test.ts`

**Interfaces:**
- Consumes: `MAX_BYTES_ENTRADA` (Task 2).
- Produces: `urlDeExport(link: string): string | null`,
  `bajarSheet(link: string, deps?: { fetch?: typeof fetch }): Promise<{ ok: true; csv: string } | { ok: false; motivo: string }>`.

**Esto es código que sale a la red con un dato que escribe un usuario.** Aplicá lo que ya aprendió
`renderer/src/snapshot.ts` el 2026-09-12: allowlist **exacta** de host (`docs.google.com`, comparación
contra un `Set` sobre `new URL(...).hostname`, nunca `includes`), `https:` obligatorio, tope de bytes
**declarado y real**, plazo con `Promise.race` (no solo la señal), y redirecciones **revalidando el
host en cada salto**.

- [ ] **Step 1: escribir los tests, en rojo**

```ts
test("de un link normal de Sheet saca la URL de export CSV", () => {
  const u = urlDeExport("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0");
  assert.match(u!, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/ABC123\/export\?format=csv/);
});

test("🔴 un host que NO es docs.google.com se rechaza: esto no es un fetch de propósito general", () => {
  assert.equal(urlDeExport("https://evil.example/spreadsheets/d/ABC/edit"), null);
});

test("🔴 http:// se rechaza aunque el host sea el bueno", () => {
  assert.equal(urlDeExport("http://docs.google.com/spreadsheets/d/ABC/edit"), null);
});

test("🔴 un 403 pide compartir el link, y NO distingue de 'no existe'", async () => {
  const r = await bajarSheet(LINK, { fetch: async () => new Response("", { status: 403 }) });
  assert.equal(r.ok, false);
  // Desde afuera no se puede distinguir "no existe" de "no compartido": el mensaje cubre los dos,
  // porque mandar al usuario a buscar el error equivocado es peor que no decir nada.
  assert.match((r as { motivo: string }).motivo, /compartid/i);
  assert.match((r as { motivo: string }).motivo, /no exist/i);
});
```

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npx tsx --test api/src/comparativas/sheet.test.ts`
Expected: FAIL

- [ ] **Step 3: implementar**, con `fetch` inyectable — el test nunca sale a la red.

- [ ] **Step 4: verde y mutación** — quitar el chequeo de host (cae el de `evil.example`) y el de
esquema (cae el de `http://`).

- [ ] **Step 5: commit**

```bash
git add api/src/comparativas/sheet.ts api/src/comparativas/sheet.test.ts
git commit -m "api: descarga del CSV-export de un Google Sheet compartido"
```

---

### Task 4: el provider — interfaz y mock

**Files:**
- Create: `api/src/comparativas/provider.ts`
- Create: `api/src/comparativas/mock-provider.ts`
- Create: `api/src/comparativas/provider.test.ts`

**Interfaces:**
- Produces:

`OpcionSeguro` **se importa de `db`** (lo declara Task 1) — no lo redefinas acá, o pasás a tener dos
definiciones del mismo shape que derivan sin que nada avise:

```ts
import type { OpcionSeguro } from "db";
// Recordatorio de su forma, definida en db/src/comparativas-seguros.ts:
//   { aseguradora, producto, prima, cobertura, condiciones: string|null, notas: string|null }

export interface Comparativa {
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
}

export interface LlmComparativaProvider {
  generar(filas: string[][], clienteFinal: string): Promise<Comparativa>;
}

export function getComparativaProvider(modo: "mock" | "openai"): LlmComparativaProvider;
```

Molde: `orchestrator/src/borrador/provider.ts` y su `mock-provider.ts`.

- [ ] **Step 1: test en rojo**

El mock es determinista y no sale del proceso, y su informe lleva un prefijo visible —
`PREFIJO_MOCK_COMPARATIVA = "[COMPARATIVA MOCK — no generada por IA]"`, mismo criterio que
`PREFIJO_MOCK_BORRADOR` — para que nadie confunda una demo con un entregable que se le manda a un
cliente final.

```ts
test("el mock es determinista: dos llamadas iguales dan lo mismo", async () => {
  const p = getComparativaProvider("mock");
  assert.deepEqual(await p.generar(FILAS, "Ana"), await p.generar(FILAS, "Ana"));
});

test("🔴 el informe del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(c.informeMd.includes(PREFIJO_MOCK_COMPARATIVA));
});

test("el mock no cuesta nada", async () => {
  assert.equal((await getComparativaProvider("mock").generar(FILAS, "Ana")).costoUsd, 0);
});
```

- [ ] **Step 2: correr y confirmar que falla**

Run: `npx tsx --test api/src/comparativas/provider.test.ts`
Expected: FAIL

- [ ] **Step 3: implementar** interfaz, mock y selector.

- [ ] **Step 4: verde.** Run: `npx tsx --test api/src/comparativas/provider.test.ts`

- [ ] **Step 5: commit**

```bash
git add api/src/comparativas/provider.ts api/src/comparativas/mock-provider.ts api/src/comparativas/provider.test.ts
git commit -m "api: contrato del provider de comparativas + mock determinista"
```

---

### Task 5: el provider real, el preflight de gasto y la regla de fallar en vez de inventar

**Files:**
- Create: `api/src/comparativas/openai-provider.ts`
- Modify: `api/src/comparativas/provider.test.ts`
- Modify: `api/package.json` (agregar `openai`, ya presente en el monorepo vía `orchestrator`)

**Interfaces:**
- Consumes: `Comparativa`, `LlmComparativaProvider` (Task 4); `MAX_BYTES_ENTRADA` (Task 2).
- Produces: `MAX_COSTO_USD`, `costoEstimadoUsd(uso, modelo)`, `class OpenAIComparativaProvider`
  (constructor con el cliente inyectable, para que los tests no salgan a la red).

**Las dos reglas que este task existe para imponer:**

1. **Preflight: abortar ANTES de gastar.** Es la doctrina del proyecto (`kr-service/src/lib/budget.ts`,
   donde `max_cost_micros` aborta antes de enviar). Se estima el costo por bytes de entrada contra la
   tabla de precios; si supera `MAX_COSTO_USD`, **no se llama a OpenAI**.
2. **Fallar visiblemente, nunca inventar.** El prompt exige un JSON con `confianza` (`"alta"|"baja"`).
   Se rechaza —error explícito, nada que guardar— si `confianza === "baja"`, **o** `opciones.length === 0`,
   **o** alguna opción viene sin `aseguradora` o sin `prima`. **Nunca un informe parcial**: media
   comparativa que parece completa es peor que un error, porque un corredor la manda.

- [ ] **Step 1: tests en rojo**

```ts
test("🔴 MAX_COSTO_USD es 0.10 — default de PRODUCCIÓN, no parámetro del test", () => {
  assert.equal(MAX_COSTO_USD, 0.1);
});

test("🔴 el preflight aborta ANTES de llamar: con entrada gigante, el cliente NUNCA se invoca", async () => {
  let llamadas = 0;
  const p = new OpenAIComparativaProvider({
    crear: async () => { llamadas++; throw new Error("no debió llamarse"); },
  });
  await assert.rejects(() => p.generar(filasEnormes(), "Ana"), /presupuesto/i);
  assert.equal(llamadas, 0, "el preflight existe para NO gastar, no para informar después de gastar");
});

test("🔴 confianza baja produce ERROR, no un informe a medias", async () => {
  const p = new OpenAIComparativaProvider(clienteQueDevuelve({ confianza: "baja", opciones: [] }));
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /confianza/i);
});

test("🔴 una opción sin aseguradora invalida la comparativa ENTERA", async () => {
  const p = new OpenAIComparativaProvider(clienteQueDevuelve({
    confianza: "alta",
    opciones: [
      { aseguradora: "Mapfre", prima: "300" },
      { aseguradora: "", prima: "250" },
    ],
  }));
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /aseguradora/i);
});

test("🔴 cero opciones también es error: 'no encontré nada' no se guarda como comparativa", async () => {
  const p = new OpenAIComparativaProvider(clienteQueDevuelve({ confianza: "alta", opciones: [] }));
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"));
});
```

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npx tsx --test api/src/comparativas/provider.test.ts`
Expected: FAIL

- [ ] **Step 3: implementar**

`timeout: 30_000`, `maxRetries: 1` — **la doctrina de este repo rechaza reintentos automáticos en
llamadas facturables** (mismo criterio que `orchestrator/src/borrador/openai-provider.ts` y que
`kr-service/src/dataforseo/client.ts`). Modelo desde `OPENAI_MODEL` con `?.trim() || "gpt-4o-mini"`:
`??` dejaría pasar `""`, que es el bug que `env:sync` ya provocó una vez.

El texto de las filas se interpola en el prompt **sin escapar**, igual que `autor`/`texto` en el
borrador de reseñas, y por la misma razón declarada: la garantía real es la revisión humana, y esta
pieza no publica nada. Escribilo en el código, no lo dejes implícito.

- [ ] **Step 4: verde y mutación** — quitar el preflight (cae el de `llamadas === 0`), aceptar
`confianza: "baja"` (cae el suyo), aceptar una opción sin aseguradora (cae el suyo).

- [ ] **Step 5: commit**

```bash
git add api/src/comparativas/openai-provider.ts api/src/comparativas/provider.test.ts api/package.json
git commit -m "api: provider real de comparativas con preflight de gasto y fallo visible"
```

---

### Task 6: los cuatro endpoints

**Files:**
- Modify: `api/src/app.ts` (endpoints + `ApiDeps`)
- Modify: `api/src/deps.ts` (cableado)
- Modify: `api/src/app.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `POST /clients/:id/comparativas-seguros` — body `{ filas, clienteFinalNombre, clienteFinalEmail? }`
    **o** `{ googleSheetUrl, clienteFinalNombre, clienteFinalEmail? }`. **409** si el cliente no es
    `correduria_seguros`. Responde `{ id, ...comparativa }`.
  - `GET /clients/:id/comparativas-seguros` — historial.
  - `GET /clients/:id/comparativas-seguros/:cid` — una.
  - `POST /clients/:id/comparativas-seguros/:cid/revisar` — cierra el gate.

- [ ] **Step 1: tests en rojo** en `api/src/app.test.ts`, con la app entera contra PGlite

```ts
test("🔴 409 si el cliente no es correduria_seguros, y NO se crea ninguna fila", async () => {
  const res = await req("POST", `/clients/${clientRestaurante}/comparativas-seguros`, { body: CUERPO_OK });
  assert.equal(res.status, 409);
  const [{ n }] = await sql<{ n: string }>("select count(*)::text as n from comparativas_seguros");
  assert.equal(n, "0", "el 409 tiene que cortar ANTES de gastar y de escribir");
});

test("🔴 mandar filas Y googleSheetUrl a la vez es 400: la ambigüedad no se resuelve eligiendo una", async () => {
  const res = await req("POST", `/clients/${clientSeguros}/comparativas-seguros`, {
    body: { ...CUERPO_OK, googleSheetUrl: "https://docs.google.com/spreadsheets/d/A/edit" },
  });
  assert.equal(res.status, 400);
});

test("🔴 creado_por sale del TOKEN, no del body", async () => {
  const res = await req("POST", `/clients/${clientSeguros}/comparativas-seguros`, {
    user: equipoA,
    body: { ...CUERPO_OK, creado_por: otroUsuario },
  });
  const [fila] = await sql<{ creado_por: string }>("select creado_por from comparativas_seguros");
  assert.equal(fila!.creado_por, equipoA);
});

test("🔴 una comparativa de OTRO tenant da 404, no 403", async () => {
  const id = await crearComoTenantA();
  const res = await req("GET", `/clients/${clientSeguros}/comparativas-seguros/${id}`, { tenant: tenantB });
  assert.equal(res.status, 404);
});
```

Más: el camino feliz con el provider mock (200, fila creada, `revisado_en` null) y que `revisar` es
idempotente — un segundo `revisar` no pisa quién revisó primero.

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npm test -w api`
Expected: FAIL

- [ ] **Step 3: implementar**

El `onError` ya mapea `23514`→400 y `42501`→403: **no lo toques**. La validación de forma del body va
con una allowlist **positiva**, como `filtrarCamposCliente` — construir el insert desde las claves que
mande el llamador es cómo un endpoint se convierte en escalada de privilegios.

- [ ] **Step 4: verde y mutación** — quitar el gate de vertical (cae el 409), leer `creado_por` del body
(cae el suyo).

- [ ] **Step 5: commit**

```bash
git add api/src/app.ts api/src/deps.ts api/src/app.test.ts
git commit -m "api: los cuatro endpoints de comparativas de seguros"
```

---

### Task 7: el navegador convierte la hoja

**Files:**
- Create: `portal/src/app/core/hoja-a-filas.ts`
- Create: `portal/src/app/core/hoja-a-filas.test.ts`
- Modify: `portal/package.json`

**Interfaces:**
- Produces: `hojaAFilas(archivo: File): Promise<string[][]>` — acepta `.csv` y `.xlsx`.

**Por qué acá y no en la API:** decisión de Juan del 2026-09-12, misma doctrina que el PDF — **la API
nunca recibe un binario**. El parser de `.xlsx` vive en el portal; la API sigue recibiendo texto.

- [ ] **Step 1: tests en rojo** (`node:test`, no Karma: es lógica pura)

Un `.csv` produce las filas esperadas; un `.xlsx` mínimo también; y una extensión desconocida **lanza
un error que nombra los formatos aceptados** — un "no se pudo leer el archivo" manda al usuario a
adivinar.

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npm --prefix portal test`
Expected: FAIL

- [ ] **Step 3: implementar**

Para `.csv`, `File.text()` más el mismo algoritmo de Task 2. **Está duplicado a propósito**: `api/` y
`portal/` no comparten paquete, y el único compartido —`contrato/`— solo depende de `zod`. Escribí el
puntero cruzado en los dos archivos, para que la deriva se vea en vez de descubrirse.

- [ ] **Step 4: verde y mutación.** Run: `npm --prefix portal test`

- [ ] **Step 5: commit**

```bash
git add portal/src/app/core/hoja-a-filas.ts portal/src/app/core/hoja-a-filas.test.ts portal/package.json
git commit -m "portal: convertir xlsx/csv a filas en el navegador"
```

---

### Task 8: la pantalla de carga

**Files:**
- Create: `portal/src/app/pages/comparativas/form.ts` y `form.spec.ts`
- Modify: `portal/src/app/core/api-core.ts` y `api-core.test.ts`

**Interfaces:**
- Consumes: `hojaAFilas` (Task 7) y los endpoints (Task 6).
- Produces: `ApiService.crearComparativa(clientId, cuerpo)`, `listarComparativas(clientId)`,
  `obtenerComparativa(clientId, id)`, `revisarComparativa(clientId, id)`.

- [ ] **Step 1: tests en rojo** (Karma, molde `cliente-resenas.spec.ts`)

```ts
it('subir un archivo manda las FILAS ya convertidas, no el archivo', async () => { /* … */ });

it('pegar un link manda googleSheetUrl', async () => { /* … */ });

it('🔴 un error del servidor se PINTA, no falla en silencio', async () => {
  // La lección del 2026-09-11: sin try/catch la promesa se rechaza sin que nadie la mire y el botón
  // no hace nada visible, que es el peor resultado posible.
});
```

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npm --prefix portal run test:components`
Expected: FAIL

- [ ] **Step 3: implementar.**

- [ ] **Step 4: verde y mutación** — quitar el `try/catch` y confirmar que cae el test del error pintado.

- [ ] **Step 5: commit**

```bash
git add portal/src/app/pages/comparativas/ portal/src/app/core/api-core.ts portal/src/app/core/api-core.test.ts
git commit -m "portal: pantalla de carga de comparativas de seguros"
```

---

### Task 9: el resultado imprimible, el gate y el historial

**Files:**
- Create: `portal/src/app/pages/comparativas/resultado.ts` y `resultado.spec.ts`
- Create: `portal/src/app/pages/comparativas/listado.ts` y `listado.spec.ts`
- Modify: `portal/src/app/pages/clientes/cliente-ficha.ts` y su spec
- Modify: `portal/src/app/app.routes.ts` y `app.routes.test.ts`

- [ ] **Step 1: tests en rojo**

```ts
function botones(el: HTMLElement) {
  const de = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes(t));
  return { imprimir: de('Imprimir'), copiar: de('Copiar mail'), revisar: de('Marcar como revisado') };
}

it('🔴 SIN revisar, "Imprimir" y "Copiar mail" están DESHABILITADOS', async () => {
  // Es el gate entero. Si esto no cae al romperlo, el gate no existe: es un adorno.
  const { fixture } = crear({ comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }) });
  const el = await estabilizar(fixture);
  expect(botones(el).imprimir!.disabled).toBeTrue();
  expect(botones(el).copiar!.disabled).toBeTrue();
  expect(el.textContent).toContain('pendiente de revisión');
});

it('🔴 tras revisar, los dos se habilitan y el aviso dice quién y cuándo', async () => {
  const revisar = jasmine.createSpy('revisarComparativa').and.resolveTo(undefined);
  const { fixture } = crear({
    comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }),
    revisarComparativa: revisar,
  });
  const el = await estabilizar(fixture);
  botones(el).revisar!.click();
  const despues = await estabilizar(fixture);

  expect(revisar).toHaveBeenCalled();
  expect(botones(despues).imprimir!.disabled).toBeFalse();
  expect(botones(despues).copiar!.disabled).toBeFalse();
  expect(despues.textContent).toContain('Revisado por');
});

it('🔴 el estado del gate se relee del SERVIDOR, no se recuerda en pantalla', async () => {
  // Recargar tiene que conservar "revisado": es un hecho persistido, no un flag de sesión. Sin este
  // test, un `revisado = signal(true)` local pasaría los dos de arriba y mentiría tras un F5.
  const { fixture } = crear({ comparativa: comparativaDePrueba({ revisadoEn: '2026-09-12T10:00:00Z', revisadoPor: 'u1' }) });
  const el = await estabilizar(fixture);
  expect(botones(el).imprimir!.disabled).toBeFalse();
});

it('el informe se dibuja con parsearMarkdown y @for — nunca innerHTML', async () => {
  const { fixture } = crear({ comparativa: comparativaDePrueba({ informeMd: '# Título\n\n- uno' }) });
  const el = await estabilizar(fixture);
  expect(el.querySelector('h1')!.textContent).toContain('Título');
  expect(el.innerHTML).not.toContain('# Título'); // si saliera crudo, el Markdown viajaría sin parsear
});

it('el botón Copiar pone HTML enriquecido Y texto plano, y sobrevive a que se deniegue el permiso', async () => {
  // Molde exacto: el "Copiar" de posts.ts. El catch silencioso ya existe allá; acá hay que fijarlo.
});

it('🔴 el tab "Comparativas" solo aparece con vertical === correduria_seguros', async () => {
  // En cliente-ficha.spec.ts, mismo patrón que la etiqueta dinámica de "Pólizas y coberturas".
});
```

Más: el listado muestra pendiente/revisado por fila, para que se note lo que quedó sin revisar.

> Estos specs son **Karma + Jasmine** (`expect(...).toBeTrue()`), no `node:test` con `node:assert`.
> Los `.test.ts` del portal son lo otro: `node:test`, para lógica pura. Ver la skill `portal-testing`.

- [ ] **Step 2: correr y confirmar que fallan**

Run: `npm --prefix portal run test:components`
Expected: FAIL

- [ ] **Step 3: implementar**

La ruta del resultado va **fuera del shell**, como `entregable` (sin sidebar en el papel), y la
impresión usa el servicio `impresion.ts` que ya existe. El tab sigue el patrón de la etiqueta dinámica
de "Pólizas y coberturas" en `cliente-ficha.ts`.

- [ ] **Step 4: verde y mutación** — habilitar los botones sin revisar (cae el 1), sacar la condición de
vertical (cae el del tab). Y confirmar que `portal/src/app/core/sin-html-crudo.test.ts` **cubre también
estas plantillas nuevas** — ese test recorre el árbol, así que tiene que verlas solo.

- [ ] **Step 5: commit**

```bash
git add portal/src/app/pages/comparativas/ portal/src/app/pages/clientes/cliente-ficha.ts portal/src/app/app.routes.ts
git commit -m "portal: informe imprimible, gate de revisión e historial de comparativas"
```

---

## Cierre (lo hace la sesión principal, no un subagente)

- [ ] `bash ./scripts/verificar.sh --con-portal` y `npm --prefix portal run test:components`, con las
      cifras reales pegadas — no de memoria.
- [ ] **Manejar la app en un navegador** con el provider **mock**. No es ceremonia: en este proyecto el
      navegador ya encontró bugs que ningún test vio, cuatro veces.
- [ ] Una corrida con el provider **real** contra una hoja de verdad, para ver qué hace el LLM con
      columnas raras. **Cuesta dinero**: la corre Juan, o se pide autorización explícita.
- [ ] Actualizar `docs/proyecto/09-estado-y-roadmap.md`, `docs/proyecto/15-plan-plataforma.md` y
      `progress/`.
- [ ] Pasar el `revisor`. Después, commit + push.

## Lo que este plan NO hace, y está bien

Fuera de alcance por la spec: OAuth a Drive/Sheets, envío automático de mail, edición del informe
dentro del portal, cualquier vertical que no sea `correduria_seguros`, un rol de "revisor" separado de
la autorización que ya existe, y notificaciones de que una comparativa quedó pendiente.
