# Pieza 1 — Las páginas de clientes en el portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [x]`) syntax for tracking.
>
> **Es la pieza 1 de cuatro.** Leé primero el
> [programa](2026-08-01-portal-agencia-programa.md): orden de las piezas, reserva de números de
> migración, qué queda fuera de alcance y las reglas para no interrumpir la demo. Las otras tres son
> [usuarios](2026-08-01-paginas-usuarios-portal.md), [ideas](2026-08-01-modulo-ideas-portal.md) y
> [dashboard](2026-08-01-dashboard-home-portal.md).

**Goal:** Llevar las cuatro pantallas de gestión de clientes de
`/Users/juan.olivadoti/jp/dashboard-project/` (listado, crear, perfil, vista) al portal de AMG OS,
con los datos en **Postgres bajo RLS** y una **API propia** — no en Firestore. Al terminar, la
agencia da de alta y administra sus clientes desde el mismo portal donde aprueba los briefs, sin un
segundo backend y sin salir del modelo multi-tenant.

**Se trabaja en una rama aparte (`feature/paginas-clientes`) y no se toca nada del recorrido de la
demo.** Ver [Qué no se toca](#qué-no-se-toca) — es la restricción que hace que este trabajo pueda
correr en paralelo al roadmap.

> **Nota de ejecución (2026-08-01):** esta corrida vive en un worktree local
> (`.claude/worktrees/feature+paginas-clientes`) sobre la rama `feature/paginas-clientes`, ramificada
> de `main`. **No se pushea a `main` ni se mergea nada sin aprobación explícita del usuario** — al
> cerrar el plan, la rama queda lista (rebaseada, verde) y se avisa para que el usuario decida cuándo
> y cómo integrarla.

## Punto de partida: qué hay a cada lado

| | `dashboard-project` (origen) | `portal/` de AMG OS (destino) |
|---|---|---|
| Angular | 19.2 | **20.3** |
| Estado | NgRx (`store/` con actions, effects, reducers, selectors) | **signals** + servicios, sin NgRx |
| Datos | Firebase/Firestore (`@angular/fire`) | API REST propia sobre Postgres + RLS |
| Gráficos | amCharts 5 + FullCalendar | ApexCharts (`ng-apexcharts`) |
| Estilos | Tailwind (plantilla TailAdmin), colores fijos | **Tailwind v4 con tokens semánticos** (modo oscuro) |
| Auth | Firebase Auth | Supabase, JWT **ES256** verificado contra JWKS |
| Lint | Biome + Prettier | — |

Lo que se porta son **1 407 líneas** de páginas (`clients` 149+13, `client-create` 236+442,
`client-profile` 129+11, `client-view` 178+249) más los componentes compartidos que usan:
`shared/components/tables/clients-table`, `filters/clients-filter`, `form/client-branches` y las
cuatro cards de `client-profile/` (`client-info-card`, `client-address-card`,
`client-resources-card`, `client-meta-card`).

**Lo que NO se porta:** los 4 archivos de NgRx (se reescriben como un servicio con signals), el
`clients.service.ts` de Firestore (se reescribe contra la API), y todo lo que cuelga del módulo de
**ideas** del dashboard (`ideasByStatus`, `totalIdeas`, `lastIdeaDate`, `averageIdeaPerMonth`): AMG OS
no tiene ese módulo, así que esos campos no tienen de dónde salir. Portarlos como ceros sería una
pantalla que miente.

## Architecture

Tres capas nuevas, cada una con el patrón que el proyecto ya usa:

```text
portal/  pages/clientes/*  ──►  services/clientes.ts (signals)  ──►  core/api-core.ts (fetch)
                                                                          │  Bearer + x-amg-tenant
                                                                          ▼
api/     app.ts: GET|POST /clients · GET|PATCH /clients/:id  ──►  db/ store bajo RLS
                                                                          │  set local (Tx)
                                                                          ▼
db/      migrations/0011_clientes_crm.sql  ──►  clients + columnas nuevas + jsonb `contacto`
```

**El esquema no duplica lo que ya existe.** Tres unificaciones deliberadas, cada una porque la
alternativa crea dos fuentes de verdad para el mismo dato:

1. **`branches` del dashboard ES `business_profile.locations`.** El perfil de La Birra Bar ya tiene
   dos locales ahí, el renderizador ya los sirve en el footer NAP y en `/menu`. Una tabla `branches`
   aparte dejaría los locales en dos lugares y el sitio del cliente mostraría uno de los dos. El
   formulario de sucursales escribe en `business_profile.locations`.
2. **`status: 'activo' | 'inactivo'` ES `archived_at`.** `clients.archived_at` ya existe (0001);
   `archived_at is null` = activo. No se agrega una columna `status`.
3. **`assignedTo` referencia `memberships.user_id`**, no un string libre. El responsable de una
   cuenta tiene que ser alguien que exista en el tenant, y eso lo impone una FK compuesta
   `(tenant_id, user_id)`, no la UI.

**Qué va en columna y qué en `jsonb`:** columna para lo que se filtra, ordena o indexa (`tipo`,
`industria`, `estado_contrato`, `contrato_vence_en`, `nivel_actividad`, `score`, `asignado_a`,
`etiquetas`); un `jsonb contacto` para lo de forma libre que solo se muestra (emails, teléfonos,
persona de contacto, redes sociales, Google Maps/Places, notas, logo, portada). Un filtro sobre
`jsonb` no se indexa bien y la tabla de clientes filtra por casi todos los primeros.

### ⛔ La restricción de seguridad que domina el diseño del esquema

**Ningún campo de CRM entra en la allowlist pública.** `clients.business_profile_publico` es una
columna generada con allowlist (0008/0009/0010) y es **lo único** que el rol `app_render` puede leer
— el renderizador es la única pieza expuesta a internet anónimo (ADR-19). Los datos que trae este
plan son internos: teléfono de contacto, email, notas de la agencia, estado del contrato, scoring,
quién lleva la cuenta.

Concretamente, la migración `0011`:

- **NO** toca `app.nap_publico` ni `app.texto_publico`.
- **NO** re-materializa `business_profile_publico`.
- **NO** concede ningún `grant` nuevo a `app_render`.

Y un test de seguridad lo fija por mutación: con un cliente cargado con todos los campos de CRM,
`app_render` lee `business_profile_publico` y el resultado **no contiene** ninguno de ellos. Si
alguien agrega `contacto` a la allowlist "para que el footer tenga el teléfono", ese test cae.
Pregunta de diseño de siempre: *si me toman el renderizador, ¿qué se llevan?*

## Tech Stack

TypeScript ESM strict + `noUncheckedIndexedAccess`, `tsx` sin paso de build. Tests con `node:test` +
`node:assert`; los de seguridad contra **PGlite** (Postgres real en WASM, sin Docker ni red). El
portal es Angular 20 standalone + signals + Tailwind v4, con tests de lógica en `node:test` y de
componente en Karma. Paquetes tocados: **`db`**, **`api`** y **`portal/`**. Nada más.

## Global Constraints

- **El rol no se declara: se DERIVA de `memberships` dentro de Postgres** (ADR-15). Un endpoint que
  acepte `role`, `tenant_id` o `assignedTo` del body sin validarlo contra la base es una escalada de
  privilegios. El `tenant_id` de un cliente nuevo sale del contexto, nunca del payload.
- **El acceso a la base es solo por transacción con conexión reservada** (`Tx`), nunca un `query()`
  suelto: el `set local` del contexto de tenant vive en la transacción (ADR-13).
- **Nombres de dominio en español** (`clientes`, `contacto`, `estadoContrato`, `asignadoA`). Los
  comentarios explican **por qué**, no qué.
- **Rojo primero**, después el arreglo, después **verificación por mutación**: reintroducí el bug y
  confirmá que cae *exactamente* su test. Un test de seguridad que siempre pasa es peor que no
  tenerlo.
- **Un default de producción sin test es una decisión sin dueño.** Si el test elige el parámetro, no
  está fijando el que corre en prod.
- **Los tokens semánticos del portal son obligatorios.** TailAdmin trae colores fijos
  (`bg-white`, `text-gray-800`, `dark:bg-gray-900`…). El portal define los suyos en
  `portal/src/styles.css` (`@theme inline`), con nombres de dominio en español: `fondo`,
  `superficie`, `superficie-2`, `texto`, `texto-medio`, `texto-tenue`, `texto-invertido`, `borde`,
  `borde-fuerte`, `accion`, `respaldo`/`respaldo-suave`, `alerta`/`alerta-suave`,
  `error`/`error-suave`, `velo` — o sea `bg-superficie`, `text-texto-medio`, `border-borde`. El modo
  oscuro depende de ellos (y de `color-scheme`, que no es decorativo: sin él el navegador pinta los
  inputs y el caret en claro). Portar el HTML tal cual rompe el modo oscuro **en silencio**: se ve
  bien en claro y blanco sobre blanco en oscuro. Cada pantalla portada se revisa **en los dos temas**
  en el navegador.
- **No inventar datos del cliente.** Si un campo no está, se omite; no se rellena con algo plausible.
- **Verificación real antes de cerrar**: `npm test` y `npm run typecheck` desde la raíz con el output
  a la vista, `npm test -w portal` y `npm run test:components -w portal`, y **manejar la app en un
  navegador** (MCP chrome-devtools) contra `npm run dev:server -w api`.
- Commits en español, terminando con un `Co-Authored-By:` que nombre al modelo de la sesión.

## Qué no se toca

Esta lista es la que permite trabajar en paralelo al roadmap de la demo. Si una tarea parece
necesitar tocar algo de acá, **paren y pregunten** — probablemente hay otra forma.

| Archivo / zona | Por qué |
|---|---|
| `portal/src/app/pages/{runs,brief}/**` | Son los dos golpes centrales del recorrido de la demo |
| `portal/src/app/pages/cartera/**` | Verificada en navegador y en el recorrido. Las páginas nuevas viven en `/clientes`, aparte |
| `db/src/seed-demo.ts` y su test | Producción está sembrada con esto y el perfil está atado por test a `web-builder/business-profile.json` |
| `db/migrations/0001..0010` | Ya aplicadas (o pendientes) en producción. Lo nuevo es `0011` y solo agrega |
| `app.nap_publico`, `app.texto_publico`, `business_profile_publico` | La allowlist del renderizador. Ver la restricción de seguridad de arriba |
| `renderer/**`, `web-builder/**`, `orchestrator/**` | Fuera del alcance |
| `db/src/cartera-portal.test.ts` | Ata el brief del seed con lo que muestra el portal; no debe cambiar |

**Estado de las migraciones en producción (verificado el 2026-08-01):** las **10** están aplicadas,
`0001`..`0010`, así que la `0011` de este plan **viaja sola** y no arrastra nada pendiente. Confirmado
por consulta a `app.migraciones_aplicadas`, no por el doc. Antes de escribir la `0011`, volvé a
comprobarlo —el registro es la fuente de verdad, no este párrafo.

Hoy la allowlist expone exactamente `brand, locations, menu, name, priceRange` (comprobable con
`jsonb_object_keys(business_profile_publico)`). **Esa lista no debe crecer con este plan.**

---

## Etapa 0 — Preparar la rama

- [x] Desde `main` al día (`git pull`), crear `feature/paginas-clientes`.
- [x] `npm install` y confirmar el verde de partida: `npm test` y `npm run typecheck` desde la raíz,
      `npm test -w portal`. Anotar los números — son la línea base contra la que se compara al cerrar.
- [x] Leer `docs/proyecto/09-estado-y-roadmap.md` y `docs/decisiones-arquitectura.md`
      (ADR-13, ADR-15, ADR-17, ADR-18, ADR-19), y este plan entero antes de escribir código.

## Etapa 1 — El esquema (`db`)

- [x] **Rojo primero.** En `db/src/clientes.test.ts` (nuevo), escribir los tests que fallan porque
      las columnas no existen todavía: un cliente con todos los campos de CRM se guarda y se lee
      igual; `etiquetas` acepta un array vacío; `score` fuera de 0–100 se rechaza; `asignado_a`
      apuntando a un usuario de OTRO tenant se rechaza.
- [x] Escribir `db/migrations/0011_clientes_crm.sql`:
      - `alter table clients add column` para `tipo` (`empresa|autonomo|particular`, enum o check),
        `industria text`, `etiquetas text[] not null default '{}'`, `nivel_actividad`
        (`bajo|medio|alto`), `estado_contrato` (`sin_contrato|vigente|vencido`, default
        `sin_contrato`), `contrato_vence_en date`, `score int check (score between 0 and 100)`,
        `asignado_a uuid`, `contacto jsonb not null default '{}'::jsonb`, `origen text`.
      - FK compuesta `(tenant_id, asignado_a) references memberships (tenant_id, user_id)` — el
        mismo mecanismo que ya impide que `kr_runs` referencie datos de otro tenant. `memberships` ya
        tiene el `unique (tenant_id, user_id)` que la FK necesita (0001, línea 74): no hay que
        agregar índice.
      - `check` de que `contacto` sea un objeto (`jsonb_typeof(contacto) = 'object'`): la allowlist
        restringe *nombres* de clave, un check restringe *forma* — las dos hacen falta (lección de la
        10ª review externa).
      - Índices para lo que la tabla filtra: `(tenant_id, estado_contrato)`, `(tenant_id, asignado_a)`.
      - **Ningún `grant` a `app_render`, ningún cambio en `app.nap_publico`.**
- [x] Correr los tests: deben pasar. Verificar por mutación cada `check` y la FK (quitarlos de la
      migración y confirmar que cae su test).
- [x] **El test de seguridad de la allowlist:** cargar un cliente con teléfono, email, notas,
      contrato y score; leer `business_profile_publico` **como `app_render`** y afirmar que no
      aparece ninguno. Mutación: agregar `'contacto', perfil -> 'contacto'` a `app.nap_publico` en
      una copia local y confirmar que el test cae.
- [x] Confirmar que los tests de RLS existentes (`db/src/rls.test.ts`) siguen verdes: las columnas
      nuevas no deben cambiar quién ve qué.

## Etapa 2 — La capa de datos (`db`)

- [x] **Rojo primero** en `db/src/clientes.test.ts`: `listarClientes` devuelve solo los del tenant
      del contexto; `crearCliente` ignora un `tenant_id` que venga en el payload y usa el del
      contexto; `actualizarCliente` de un cliente de otro tenant no encuentra la fila (0 filas
      afectadas, no un error genérico); archivar/desarchivar cambia `archived_at`.
- [x] Implementar `db/src/clientes.ts` siguiendo el patrón de **`db/src/store.ts`** (`PgStore`): el
      acceso va por `withTenant(ctx, (tx) => …)`, que reserva la conexión y pone el `set local` — no
      hay ningún `query()` suelto y el `tenant_id` no es un parámetro de las funciones, sale del
      contexto. *(Ojo: `db/src/sitios.ts` NO es el patrón a copiar — es el resolver por dominio del
      renderizador, que trabaja con un pool y sin contexto de tenant, porque ahí el dominio ES la
      autorización.)*
- [x] Exportar desde `db/src/index.ts`.
- [x] Verificación por mutación del aislamiento: quitar el `set local` del helper de test y confirmar
      que los tests de tenant caen.

## Etapa 3 — Los endpoints (`api`)

- [x] **Rojo primero** en `api/src/app.test.ts` (o el archivo de tests de la API que corresponda):
      - `GET /clients` sin token → 401; con token de otro tenant → no ve los clientes del primero.
      - `POST /clients` con `tenant_id` en el body → el cliente se crea en el tenant del token, no
        en el del body.
      - `POST /clients` con `rol` en el body → el rol se ignora por completo (se deriva de
        `memberships`).
      - Un usuario con rol `cliente` no puede crear ni modificar clientes (403, no 500).
      - `PATCH /clients/:id` con un id de otro tenant → 404, y **no** revela que existe.
      - `POST /clients` con un `asignado_a` que no es miembro del tenant → 400.
- [x] Implementar en `api/src/app.ts` siguiendo el patrón de las rutas existentes (`/runs`,
      `/pages/:id`): validación del payload, contexto de tenant desde el token, todo dentro de una
      transacción.
- [x] Si algún endpoint tiene que emitir un evento, **fila primero, evento después** (ADR-18): un
      evento no porta autoridad. Si no hace falta evento, no se inventa uno.
- [x] Actualizar `api/src/dev-server.ts` para que los endpoints nuevos funcionen sobre PGlite sin
      credenciales — es lo que permite manejar el portal en un navegador en la etapa 6.

## Etapa 4 — La capa de datos del portal

- [x] **Rojo primero** en `portal/src/app/core/*.test.ts`: el cliente de API nuevo manda
      `Authorization` y `x-amg-tenant`, reintenta UNA vez ante 401 tras refrescar, y propaga el error
      con mensaje legible (mismo contrato que `crearApi` ya cumple).
- [x] Extender `portal/src/app/core/api-core.ts`: agregar al interfaz `ClienteApi` los métodos
      `listarClientes`, `verCliente`, `crearCliente`, `actualizarCliente`. **Ojo con el nombre:**
      `ClienteApi` en el portal significa "el cliente HTTP de la API", no "el cliente de la agencia".
      Los tipos nuevos van como `ClienteAgencia` (o `Cuenta`) para que la ambigüedad no se propague.
- [x] Definir los tipos en `portal/src/app/core/models.ts`, con los nombres del dominio en español y
      **sin** los campos del módulo de ideas.
- [x] Escribir `portal/src/app/services/clientes.ts`: servicio con signals
      (`#clientes = signal<...>([])`, `filtrados = computed(...)`), sin NgRx. El filtrado y el
      ordenamiento son `computed`, no `effect` — el valor es derivado.
- [x] Tests de la lógica de filtros y orden en `node:test` (sin Angular, como el resto del portal).

## Etapa 5 — Las cuatro pantallas

Una tarea por pantalla; cada una se cierra con su test de componente y su revisión en los dos temas.

- [x] **`/clientes` (listado).** Portar `clients.page.ts` + `clients-table` + `clients-filter`.
      Reescribir el HTML con los tokens semánticos del portal. Los KPIs que dependan de "ideas" se
      omiten (no se rellenan con ceros).
- [x] **`/clientes/nuevo` (crear).** Portar `client-create.component` (236 + 442 líneas — es la más
      grande). El formulario de sucursales (`client-branches`) escribe en
      `business_profile.locations`, no en una tabla nueva. Validación del lado del cliente **y** del
      servidor: la del cliente es UX, la del servidor es la que vale.
- [x] **`/clientes/:id` (perfil).** Portar `client-profile.component` y sus cuatro cards. La
      `client-resources-card` guarda recursos gráficos: decidir si el campo `resources` viaja como
      texto en `contacto` o queda fuera de esta tanda (no hay almacenamiento de archivos en AMG OS
      todavía — si hace falta subir imágenes, es otro plan).
- [x] **`/clientes/:id/ver` (vista).** Portar `client-view.component`. Si se solapa con el perfil más
      de lo que aporta, decirlo en el informe de cierre en vez de portar dos pantallas que hacen lo
      mismo.
- [x] Tests de componente en Karma para el listado y el formulario de creación (los dos que tienen
      lógica de interacción real).

## Etapa 6 — Rutas, navegación y verificación en navegador

- [x] Agregar las rutas en `portal/src/app/app.routes.ts` como `loadComponent` (lazy, igual que las
      existentes), bajo el `authGuard` y dentro del `AppShellComponent`. **No** cambiar el
      `redirectTo: 'runs'`: la puerta de entrada de la demo no se mueve.
- [x] Agregar la entrada en `portal/src/app/shared/layout/app-sidebar.ts` y actualizar su
      `app-sidebar.spec.ts`.
- [x] **Manejar la app en un navegador** (MCP chrome-devtools) contra `npm run dev:server -w api`:
      crear un cliente, verlo en el listado, editarlo, archivarlo. **En tema claro y en oscuro.**
      Revisar la consola: cero errores. Esto encuentra lo que los tests no ven — ya pasó varias veces
      en este proyecto.
- [x] Confirmar que `/runs`, `/runs/:id` y `/cartera` siguen funcionando igual (son la demo).

## Etapa 7 — Cierre

- [x] `npm test` y `npm run typecheck` desde la raíz, `npm test -w portal`,
      `npm run test:components -w portal`. Comparar con la línea base de la etapa 0: **los tests que
      ya existían siguen todos verdes**.
- [x] Auto-revisión adversarial del diff completo: ¿qué afirmé que no verifiqué? ¿qué test prueba la
      implementación en vez del contrato? ¿qué default no tiene test? ¿qué garantía quedó en un
      comentario en vez de en una constraint?
- [x] Actualizar `docs/proyecto/09-estado-y-roadmap.md` y `docs/proyecto/11-plan-fase-2.md`: qué se
      hizo, dónde estamos, qué falta. Sincronizar las cifras de tests y de migraciones **en todos los
      lugares donde aparecen**. Si hace falta un ADR nuevo (p. ej. "los datos de CRM no son
      públicos"), escribirlo.
- [x] Rebase sobre `main` (que va a haber avanzado con el roadmap de la demo), resolver conflictos, y
      volver a correr todo.
- [x] Informe de cierre: qué quedó fuera del alcance y por qué (el módulo de ideas, los recursos
      gráficos si se dejaron, `client-view` si resultó redundante).

---

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| Un campo de CRM se filtra al renderizador anónimo | El test de allowlist de la etapa 1, verificado por mutación. Es el riesgo más caro del plan |
| El modo oscuro se rompe en silencio al portar el HTML de TailAdmin | Cada pantalla se revisa en los dos temas en el navegador, no solo en claro |
| Los locales terminan en dos lugares (`branches` y `business_profile.locations`) y el sitio del cliente muestra uno | Decisión de arquitectura: no hay `branches`. El formulario escribe en `locations` |
| El `PATCH` deja escalar privilegios aceptando `tenant_id` o `asignado_a` del body | Tests de la etapa 3, uno por vector |
| Conflictos con el roadmap de la demo | La lista [Qué no se toca](#qué-no-se-toca) + rebase al cerrar |
| `migrate:deploy` en producción arrastra una migración pendiente que nadie esperaba | Ya no aplica: las 10 están aplicadas (verificado). Igual, **comprobá el registro antes**, no este plan |
| Angular 19 → 20: APIs cambiadas en el código portado | Las páginas se reescriben con el estilo del portal (standalone + signals + control flow `@if`/`@for`), no se copian |
