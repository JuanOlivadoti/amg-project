# Diseño: esqueleto UI del portal (traído de `dashboard-project`)

## Contexto

El portal de AMG OS (`portal/`) hoy tiene 3 páginas reales (`login`, `runs`, `brief`), sin componentes
reutilizables extraídos: todo vive inline con clases Tailwind repetidas. No hay shell de layout
(sidebar/header), solo un header mínimo en `app.html`.

Existe, en un proyecto externo (`C:\Users\oliva\Documents\projects\dashboard-project\`), una app Angular
19 construida sobre el template comercial **TailAdmin**: shell completo (sidebar + header), una
librería amplia de componentes UI (botones, badges, cards, tablas, charts, modales, tabs, dropdowns) y
varias páginas reales de dominio (clientes, usuarios, dashboard con KPIs).

El roadmap del portal (`docs/proyecto/09-estado-y-roadmap.md`, sección "La demo con Frank") tiene
pendiente la **pieza C — Dashboard de cartera**: una pantalla nueva que muestra `volumen`, `dificultad`,
`opportunity_score`, `score_confidence`, `intencion`, `cluster_id` y `evidencia` por página, y
`coste_micros_usd`/`calidad_datos` por corrida. Los datos existen en Postgres pero **no hay ningún
endpoint de la API que los sirva en formato listado** — solo aparecen en `api/src/app.test.ts` y
`api/src/dev-server.ts` (mock).

Este documento cubre **solo el frontend**: traer el esqueleto de layout y la librería de componentes
del `dashboard-project`, adaptados a la arquitectura del portal, y construir con ellos el Dashboard de
cartera usando datos de muestra. El endpoint real de la API queda fuera de alcance — es trabajo de
backend separado, para más adelante.

## Objetivo

1. El portal gana un shell de layout (sidebar + header) y una librería de componentes UI reutilizables,
   con la misma apariencia visual que `dashboard-project`, pero consumiendo el sistema de tokens
   semánticos de tema que el portal ya tiene (`--fondo`, `--superficie`, `--texto`, `--accion`, etc.).
2. Se construye la pantalla "Dashboard de cartera" (`/cartera`) usando esos componentes, con datos de
   muestra que tienen la misma forma que los datos reales documentados en el roadmap.
3. Las páginas existentes (`login`, `runs`, `brief`) **no se migran** al nuevo shell en este trabajo —
   queda como tarea futura, fuera de este alcance.

## Fuera de alcance (explícito)

- Endpoint real de la API para servir datos de cartera (Postgres → API). Sigue con datos mock en el
  frontend.
- Migrar `login`/`runs`/`brief` al nuevo shell de layout.
- NgRx (el portal usa signals + services directos; los componentes portados que dependían del store se
  reescriben para recibir datos por `@Input`/`input()`).
- Firebase (el portal usa Supabase + Postgres con RLS; ningún componente portado debe traer una
  dependencia a `firebase`/`@angular/fire`).
- Páginas de showcase del template (`buttons`, `badges`, `tabs`, `alerts`, `avatars`, etc. — demos del
  template comercial, sin uso en el portal).
- Librerías del `dashboard-project` no usadas por lo que se porta: `amCharts`, `swiper`, `flatpickr`,
  `@fullcalendar/*`, `prismjs`, `marked`, `ng-otp-input`.
- Tests de componente con Karma. El portal ya tiene la convención de separar lógica pura (`core/*.ts`,
  testeada con `node:test`) de componentes presentacionales verificados a mano en el navegador — se
  sigue esa misma convención acá, no se introduce Karma como red de pruebas nueva.

## Orden de trabajo

1. **Mergear `feat/modo-oscuro-portal` → `main`.** Es trabajo ya cerrado (87 tests, documentado en
   `09-estado-y-roadmap.md`). Se corren `npm test` y `npm run typecheck` antes de confirmar el merge y
   el push — es una acción que toca la rama compartida, así que se hace con cuidado y visibilidad.
2. **Nueva rama `feat/dashboard-ui-portal`** desde `main`, ya con los tokens de tema en la base.

## Migración de Tailwind: v3.4 → v4

El portal usa hoy Tailwind 3.4 con `tailwind.config.js`. `dashboard-project` usa Tailwind v4
(CSS-first, `@theme` dentro de `src/styles.css`, sin archivo de config). Se actualiza el portal a v4:

- Se elimina `portal/tailwind.config.js`.
- Los tokens semánticos existentes (`--fondo`, `--superficie`, `--superficie-2`, `--texto`,
  `--texto-medio`, `--texto-tenue`, `--borde`, `--accion`, `--respaldo`, `--alerta`, `--error`, más
  variantes "suave") se re-declaran dentro de un bloque `@theme` en `portal/src/styles.css`, generando
  las mismas clases utilitarias que ya se usan (`bg-superficie`, `text-texto`, etc.) — cambia la
  sintaxis de definición, no los nombres de clase ni el comportamiento.
- El script anti-fogonazo en `portal/src/index.html` no cambia (no depende de la versión de Tailwind).
- Se revisan usos de `@apply` y utilidades que hayan cambiado de nombre entre v3 y v4 al momento de
  portar cada componente.

## Colores: mandan los tokens del portal

Ningún componente portado trae la paleta `brand-*`/`gray-*` de TailAdmin. Todo color se traduce al
token semántico equivalente del portal. Si un componente necesita un tono que no tiene token hoy
(por ejemplo, un color de estado nuevo para un badge), se decide en el momento de portarlo y se agrega
como token nuevo — no como color suelto.

## Estructura de carpetas nueva

El portal no tiene hoy `shared/`. Se crea:

```
portal/src/app/shared/
  layout/
    app-shell/          # compone sidebar + header + <router-outlet>
    app-sidebar/
    app-header/
    backdrop/            # overlay mobile
  components/
    ui/
      button/
      badge/
      avatar/
      dropdown/
      pagination/
      tabs/
      modal/
    cards/
      stat-box/          # KPI tile (input-driven)
    charts/
      bar-chart-one/
      line-chart-one/
```

## Componentes a portar (con su adaptación puntual)

| Componente | Origen | Adaptación |
| --- | --- | --- |
| `app-sidebar` | `shared/layout/app-sidebar/` (256 líneas, sin NgRx) | Se reemplaza `navItems` por solo `/runs` y `/cartera`. Se elimina el código muerto comentado (items de ejemplo del template). |
| `app-header` | `shared/layout/app-header/` (41 líneas) | El input `user` cambia de `I_User` (dominio del template) al modelo `Usuario` del portal. Incluye el `theme-toggle` que el portal ya construyó en la pieza B. |
| `stat-box` | `shared/components/stat-box/` (input-driven: `stat = input.required<{key,title,stats}>()`) | Se porta tal cual como tile de KPI — no `card-with-icon`, que es estático (título/lorem hardcodeados). |
| `bar-chart-one` / `line-chart-one` | `shared/components/charts/` (hoy `series`/`categories`/`colors` hardcodeados en hex) | Se convierten a `@Input` (`series`, `categories`, `colors`) para poder graficar `opportunity_score`/`volumen` por cluster. |
| `ui/` (button, badge, avatar, dropdown, pagination, tabs, modal) | `shared/components/ui/` | Sin cambios estructurales; solo mapeo de color a tokens del portal. |
| Tabla de portafolio | Nueva, con `clients-table` como **referencia de patrón** (input-driven, `computed()` para filtrado local) — no se copia literal porque las columnas son de otro dominio. | Columnas: `volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `cluster_id`, `evidencia`. |

`pages/dashboard/dashboard.page.ts` del `dashboard-project` (acoplado a NgRx: dispatch de
`IdeasActions`, selectors) se usa **solo como referencia de composición** (KPIs arriba + tabla abajo)
— no se copia código de ahí.

## Página nueva: Dashboard de cartera

- Ruta `/cartera`, protegida por `authGuard`, agregada a `app.routes.ts` y al nuevo `app-sidebar`.
- Composición: fila de `stat-box` (KPIs: sitios activos, `opportunity_score` promedio, coste del mes)
  → `bar-chart-one`/`line-chart-one` (distribución de `opportunity_score`/`volumen` por cluster) →
  tabla de páginas.
- **Datos de muestra**: función pura en `portal/src/app/core/cartera-mock.ts` que genera datos con la
  misma forma que documenta el roadmap (`volumen`, `dificultad`, `opportunity_score`,
  `score_confidence`, `intencion`, `local`, `cluster_id`, `evidencia`, y por corrida
  `coste_micros_usd`/`calidad_datos`). Testeada con `node:test`. El componente de página queda
  presentacional, consumiendo esa función.

## Verificación

Sigue la convención ya establecida en el portal:

- Lógica pura (mock de cartera, cualquier filtro/mapeo de color) → `core/*.ts`, testeada con
  `node:test` (`npm test`).
- `npm run typecheck` en el portal.
- Componentes y la página nueva se verifican manejando el portal en el navegador (chrome-devtools MCP):
  layout responsive, tema claro/oscuro/auto sobre los componentes nuevos, navegación del sidebar,
  estados vacíos de la tabla.

## Riesgos / decisiones abiertas para el plan

- El upgrade de Tailwind v3→v4 puede requerir ajustes no previstos en clases usadas hoy en
  `login`/`runs`/`brief` (aunque esas páginas no se migran al shell, siguen compilando con Tailwind y
  deben seguir viéndose igual).
- El merge de `feat/modo-oscuro-portal` a `main` es una acción sobre rama compartida — se confirma el
  estado verde (tests + typecheck) antes de hacerlo, y se hace como paso explícito y visible, no
  implícito dentro de otro commit.
