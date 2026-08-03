# Diseño: esqueleto UI del portal (traído de `dashboard-project`)

> Revisión 2 (2026-07-30): corrige 8 hallazgos de una auditoría externa (Codex) verificados contra el
> código real — ver "Historial de revisión" al final.

## Contexto

El portal de AMG OS (`portal/`) hoy tiene 3 páginas reales (`login`, `runs`, `brief`), sin componentes
reutilizables extraídos: todo vive inline con clases Tailwind repetidas. El shell actual (rama
`feat/modo-oscuro-portal`, `portal/src/app/app.html`) es un único header global (`h-11`) que envuelve
**todas** las rutas, incluido `/login`, vía `<router-outlet>` — no hay sidebar.

Existe, en un proyecto externo (`C:\Users\oliva\Documents\projects\dashboard-project\`), una app Angular
19.2 construida sobre el template comercial **TailAdmin** (licencia verificada con el usuario — permite
reutilizar el código en AMG OS): shell completo (sidebar + header), una librería amplia de componentes
UI y varias páginas reales de dominio.

El roadmap del portal (`docs/proyecto/09-estado-y-roadmap.md`, sección "La demo con Frank") tiene
pendiente la **pieza C — Dashboard de cartera + seed de 4-6 restaurantes**: una pantalla que muestra
`volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `cluster_id` y
`evidencia` por página, y `coste_micros_usd`/`calidad_datos` por corrida.

**Corrección sobre el acceso a datos** (la versión 1 de este documento decía lo contrario): la API
**ya sirve** estos datos — `GET /runs` (`api/src/app.ts:74`) y `GET /runs/:id` (`api/src/app.ts:84`) — y
el portal ya los consume (`listarRuns`/`verBrief` en `portal/src/app/services/api.ts:24-26`), tipados en
`portal/src/app/core/models.ts` (`RunSummary`, `PaginaPropuesta`). Lo que **no existe** es (a) un
endpoint agregado de "cartera" que junte varios runs/clientes en un solo listado, y (b) cualquier
noción de nombre de cliente — la API no expone `nombre`, solo `client_id`. Decisión del usuario: para
esta pieza se sigue con **datos 100% de muestra** (no se compone desde `/runs` real todavía, para no
sumar N+1 ni mezclar datos reales parciales con un nombre inventado en la misma pantalla) — el
endpoint agregado real queda para más adelante, como trabajo de backend separado.

Este documento cubre **solo el frontend**: traer el esqueleto de layout y una librería de componentes
UI del `dashboard-project`, adaptados a la arquitectura del portal, y construir con ellos el Dashboard
de cartera con datos de muestra.

## Objetivo

1. El portal gana un shell de layout (sidebar + header) que envuelve **todas las rutas autenticadas**
   (`/runs`, `/runs/:id`, `/cartera`) de forma consistente — no solo la pantalla nueva — y una
   librería de componentes UI reutilizables, con la misma apariencia visual que `dashboard-project`,
   pero consumiendo el sistema de tokens semánticos de tema que el portal ya tiene.
2. Se construye la pantalla "Dashboard de cartera" (`/cartera`) usando esos componentes, con datos de
   muestra que tienen la misma forma que los DTOs reales (`RunSummary`, `PaginaPropuesta`).
3. `login`, `runs` y `brief` **no se restylean** con la nueva librería de componentes — pero `runs` y
   `brief` sí pasan a renderizar dentro del nuevo shell (sidebar + header), porque dejarlos afuera
   produce la contradicción de ruteo descrita en la sección 4. `login` queda fuera del shell.

## Fuera de alcance (explícito)

- Endpoint real de la API para servir datos de cartera agregados. Sigue con datos mock en el frontend
  (ver "Fuente de datos" arriba).
- Restylear el contenido interno de `login`/`runs`/`brief` con los componentes nuevos (solo cambia el
  wrapper de layout de `runs`/`brief`, no su HTML interno).
- NgRx (el portal usa signals + services directos; los componentes portados que dependían del store se
  reescriben para recibir datos por `@Input`/`input()`).
- Firebase (el portal usa Supabase + Postgres con RLS; ningún componente portado debe traer una
  dependencia a `firebase`/`@angular/fire`).
- Páginas de showcase del template (`buttons`, `badges`, `tabs`, `alerts`, `avatars`, etc.).
- `amCharts`, `swiper`, `flatpickr`, `@fullcalendar/*`, `prismjs`, `marked`, `ng-otp-input`.
- Tests de componente con Karma para **todo**: se usan donde ya es la convención del portal (lógica
  interactiva/condicional de template — ver sección "Verificación"), no como red exhaustiva de UI.

## Orden de trabajo

1. **Mergear `feat/modo-oscuro-portal` → `main`.** Trabajo ya cerrado (87 tests). Se corren
   `npm --prefix portal test` y `npm --prefix portal run typecheck` antes de confirmar el merge y el
   push.
2. **Etapa propia: migración de Tailwind v3.4 → v4** (ver sección siguiente) — sobre `main`, antes de
   portar ningún componente. Es un cambio transversal que afecta a `login`/`runs`/`brief` aunque no se
   les toque el HTML.
3. **Nueva rama `feat/dashboard-ui-portal`** desde el commit de la migración de Tailwind, para el shell
   + componentes + dashboard de cartera.

## Migración de Tailwind: v3.4 → v4 (etapa separada)

Estado actual verificado: `portal/.postcssrc.json` usa el plugin `tailwindcss` (formato v3);
`portal/src/styles.css` tiene las 3 directivas `@tailwind base/components/utilities`;
`portal/tailwind.config.js` (rama modo oscuro) mapea los 16 tokens semánticos a `theme.extend.colors`
usando `var(--token)`.

Pasos:

1. `npm --prefix portal install tailwindcss@4 @tailwindcss/postcss` (reemplaza la dependencia v3).
2. `portal/.postcssrc.json`: el plugin pasa a `"@tailwindcss/postcss": {}`.
3. `portal/src/styles.css`: las 3 directivas `@tailwind` se reemplazan por `@import "tailwindcss";`.
4. Los 16 tokens (`--fondo`, `--superficie`, ... ya declarados en `:root`/`.oscuro`) se exponen como
   utilidades vía un bloque `@theme inline` en el mismo `styles.css` (`inline` porque referencian
   variables ya definidas en `:root`/`.oscuro`, no valores literales — ver
   [`@theme inline`](https://tailwindcss.com/docs/theme#referencing-other-variables)):
   ```css
   @theme inline {
     --color-fondo: var(--fondo);
     --color-superficie: var(--superficie);
     /* ...los 16, mismo nombre que hoy en tailwind.config.js */
   }
   ```
   Esto **elimina `tailwind.config.js`** — el mapeo de color vive ahora en `styles.css`, junto con los
   valores hex. El `borderColor.DEFAULT` actual (parche del preflight) se resuelve con la utilidad
   equivalente de v4 (`@layer base { * { border-color: var(--borde); } }` o el mecanismo que v4 use
   para el default de `border-color` — se confirma al implementar).
5. **`contraste.test.ts` (pieza B) se actualiza, no se rompe en silencio.** Hoy tiene un test que
   parsea `tailwind.config.js` para confirmar que expone los mismos 16 tokens que `TOKENS`. Con
   `tailwind.config.js` eliminado, ese test pasa a parsear el bloque `@theme inline` de `styles.css` en
   su lugar — sigue siendo el mismo triángulo de garantía (`TOKENS` ↔ `:root`/`.oscuro` ↔ utilidades
   Tailwind), solo que las últimas dos fuentes ahora están en el mismo archivo. Este cambio de test es
   una tarea explícita del plan, no un efecto secundario.
6. Revisar la compatibilidad mínima de navegadores que exige Tailwind v4 (usa `@property` y otras
   features CSS modernas) contra el target de build del portal.
7. Verificar visualmente `login`/`runs`/`brief` sin cambios de HTML — deben verse idénticos antes y
   después de la migración (regresión, no feature).

## Colores: mandan los tokens del portal

Ningún componente portado trae la paleta `brand-*`/`gray-*` de TailAdmin. Todo color se traduce al
token semántico equivalente del portal.

## Topología de rutas y shell

Estado post-merge de modo oscuro: `app.html` envuelve *todo* (incluido `/login`) en un único header.
Meter un `AppShell` nuevo solo en `/cartera` duplicaría ese header ahí y haría que el sidebar
aparezca/desaparezca al navegar a `/runs` — contradicción que la v1 de este documento no resolvía.

Resolución: el `AppShell` (sidebar + header nuevos) envuelve **todas las rutas autenticadas**, no solo
la nueva. `login` queda afuera, con su propio layout simple (el que ya tiene hoy, sin sidebar).

```
/login                          → sin AppShell (layout propio, como hoy)
/  (AppShell, canActivate: [authGuard])
  /runs                         → RunsPage — HTML interno SIN cambios
  /runs/:id                     → BriefPage — HTML interno SIN cambios
  /cartera                      → página nueva, construida con la librería de componentes
'' / '**'                       → redirect a /runs
```

`app.ts`/`app.html` deja de tener el header propio: pasa a ser solo el `<router-outlet>` raíz. El
header actual (email, salir, toggle de tema) se reimplementa dentro del nuevo `AppHeaderComponent`
(ver siguiente sección), no se duplica.

## Estructura de carpetas nueva

```
portal/src/app/shared/
  layout/
    app-shell/           # sidebar + header + <router-outlet>, matched por la ruta padre autenticada
    app-sidebar/
    app-header/
    backdrop/             # overlay mobile
  services/
    sidebar.ts            # nuevo — estado UI expandido/hover/mobile, no existe hoy en el portal
  components/
    ui/
      button/
      badge/
      avatar/
      dropdown/
      pagination/
    cards/
      stat-box/            # KPI tile (input-driven)
    charts/
      bar-chart-one/
      line-chart-one/
```

`tabs/`, `modal/`, `button/`, `badge/`, `avatar/`, `dropdown/`, `pagination/` **salen del alcance
inicial**: `/cartera` tal como está diseñada no los necesita. El estado de evidencia (✅/⚠️) se
resuelve igual que ya lo hace `brief.ts` — un `<span>` con clases de token, no un componente
`Badge` genérico —, y el volumen de filas del seed (4-6 clientes) no justifica paginación. Se agregan
cuando haya un consumidor concreto, no antes — portar una librería amplia sin uso real es superficie
que hay que mantener y verificar sin necesidad. Lo único que se construye es: `app-shell`,
`app-sidebar`, `app-header`, `backdrop` (shell), `stat-box`, `bar-chart-one`, `line-chart-one`
(componentes con consumidor real en `/cartera`), más una tabla de portafolio específica de la página
(no genérica, vive junto a `cartera.ts`).

## Componentes a portar (con su adaptación puntual)

| Componente | Origen | Adaptación |
| --- | --- | --- |
| `app-sidebar` | `shared/layout/app-sidebar/` (256 líneas, sin NgRx) | `navItems` pasa a `/runs` y `/cartera`. Se elimina el código muerto comentado del template. |
| `app-header` | — (se reimplementa, no se porta) | Nuevo componente sobre `AuthService` (`email()`, `autenticado()`, `salir()`) y `TemaService` (`tema()`, `alternar()`, ya construidos en la pieza B) + el nuevo `SidebarService` para el toggle. **No existe** un modelo `Usuario` en el portal (la v1 de este documento lo inventó) — el dato de sesión es `Sesion` (`portal/src/app/core/models.ts:71`), y el header consume `AuthService` directo, no un `@Input` de usuario. |
| `stat-box` | `shared/components/stat-box/` (input-driven: `stat = input.required<{key,title,stats}>()`) | Se porta tal cual como tile de KPI. |
| `button`, `badge`, `avatar`, `dropdown`, `pagination` | `shared/components/ui/` | **Sin `SafeHtmlPipe`/`bypassSecurityTrustHtml`** (confirmado en `button.component.ts:3` y `pipe/safe-html.pipe.ts:8` — choca con el invariante de superficie de inyección del proyecto). Los `@Input() startIcon/endIcon: string` se reemplazan por proyección de contenido (`<ng-content select="[icon]">` o un `TemplateRef`), nunca un string de HTML. El `@Input() className` libre se reemplaza por variantes tipadas (`variant`/`size` ya existen; se cubren los casos reales en vez de aceptar clases arbitrarias). Textos en español. Mapeo de color a tokens del portal. |
| `bar-chart-one` / `line-chart-one` | `shared/components/charts/` (hoy `series`/`categories`/`colors` hardcodeados en hex) | Se convierten a `@Input`. **No se grafica por `cluster_id`**: es un UUID generado por `randomUUID()` (`kr-service/src/pipeline/cluster-map.ts:73`), ilegible como categoría de eje. En su lugar: barras horizontales de top oportunidades por `keyword_principal` (top N páginas por `opportunity_score`), y línea de `opportunity_score` promedio o `coste_micros_usd` por fecha de corrida (`created_at` de `RunSummary`). `ng-apexcharts`/`apexcharts` no están instalados en el portal hoy — se agregan, verificando compatibilidad con Angular 20.3 (el `dashboard-project` es Angular 19.2) antes de comprometerse a la librería. Los colores del chart deben reaccionar al cambio de tema (`effect()` sobre `tema.efectivo()` que actualiza las `options` de Apex), no quedar fijos en el hex inicial. |
| Tabla de portafolio | Nueva — `clients-table` del template como **referencia de patrón** (input-driven, `computed()` para filtrado local), no se copia literal (columnas de otro dominio). | Columnas: `volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `cluster_id`, `evidencia`. |

## Contrato de datos de muestra

Función pura en `portal/src/app/core/cartera-mock.ts`, con la misma forma que los DTOs reales
(`RunSummary`, `PaginaPropuesta` de `core/models.ts`) más lo único que la API no expone (`nombre` del
cliente):

```ts
interface ClienteCartera {
  client_id: string;
  /** La API no expone nombre de cliente hoy (solo `client_id`) — 100% mock, documentado acá. */
  nombre: string;
  runs: RunSummary[];
}

interface CarteraDashboard {
  clientes: ClienteCartera[]; // 4-6, según el roadmap (seed de 4-6 restaurantes)
  pages: PaginaPropuesta[]; // de todos los runs, para agregación
}

function generarCarteraMock(): CarteraDashboard { /* ... */ }
```

Funciones de agregación puras y testeadas por separado (`node:test`), no calculadas inline en el
componente: `kpisDeCartera(dashboard)` → `{ sitiosActivos, opportunityScorePromedio, costeDelMes }`,
`topOportunidades(pages, n)`, `serieTemporalCoste(runs)`. El componente de página queda presentacional,
consumiendo estas funciones.

### Licencia de ApexCharts

`apexcharts@^5` (y `ng-apexcharts`) es dual-licencia: Apache 2.0 salvo que la organización facture
más de $2M USD anuales, caso en el que aplica la licencia comercial (OEM/redistribución). AMG es una
agencia chica, muy por debajo de ese umbral, así que usar la v5 tal cual es válido — no hace falta
bajar a la v3/v4 (MIT). Punto a revisar si cambia la facturación de AMG, o si AMG OS se vende/licencia
a un cliente mucho más grande cuyo uso pueda entrar en la cláusula OEM.

## Página nueva: Dashboard de cartera

- Ruta `/cartera`, dentro del `AppShell` (`authGuard`), agregada al `app-sidebar`.
- Composición: fila de `stat-box` (KPIs de `kpisDeCartera`) → `bar-chart-one` (top oportunidades por
  `keyword_principal`) + `line-chart-one` (serie temporal de coste u `opportunity_score`) → tabla de
  páginas (`volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `cluster_id`,
  `evidencia`).

## Verificación

Comandos explícitos — **`portal` no está en los `workspaces` del `package.json` raíz** (confirmado:
`["db","kr-service","web-builder","orchestrator","api","renderer"]`), así que `npm test`/
`npm run typecheck` de la raíz **no cubren el portal**:

```bash
npm --prefix portal test              # node:test — lógica pura (cartera-mock, agregaciones, colores)
npm --prefix portal run typecheck
npm --prefix portal run test:components   # Karma — DOM, ver abajo
```

El portal **ya usa Karma** para lógica condicional de template que un mock a nivel función no cubre
(`portal/src/app/pages/runs/runs.spec.ts` — renderiza `RunsPage` y verifica el DOM, con el comentario
explícito de por qué: un test de función pura pasó en verde con el `@if` del template roto). Se sigue
esa misma convención, no "todo a mano", para lo que el shell agrega de lógica interactiva/condicional:

- Toggle del sidebar mobile + backdrop (abre/cierra, clase aplicada).
- Navegación del sidebar (item activo resaltado).
- Estado vacío, filtro y paginación de la tabla de cartera.
- Topología de rutas: `/login` sin shell, `/runs`/`/cartera` con shell.

Verificación manual en el navegador (chrome-devtools MCP) queda para lo que un test de componente no
captura bien: contraste real en los tres estados de tema (claro/oscuro/auto), responsive, que
`login`/`runs`/`brief` se vean idénticos tras la migración de Tailwind.

## Historial de revisión

**Revisión 1 → 2** (auditoría de Codex, verificada punto por punto contra el código antes de aplicar):
corrige la afirmación falsa sobre acceso a datos de la API, define el contrato de datos mock
explícito, resuelve la contradicción de topología de rutas/shell duplicado, completa los pasos de
migración de Tailwind v4 y protege el test de contraste de la pieza B, elimina `SafeHtmlPipe` de los
componentes portados, corrige el modelo de header (no existe `Usuario`, es `Sesion`+`AuthService`),
cambia la elección de gráficos (`cluster_id` es un UUID, no una categoría legible), y hace explícitos
los comandos de verificación (`--prefix portal`) y el uso ya existente de Karma. La pregunta de
licencia de TailAdmin quedó confirmada por el usuario (permite el uso en AMG OS).
