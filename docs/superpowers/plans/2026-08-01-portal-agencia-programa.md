# El portal de la agencia — programa de incorporación desde `dashboard-project`

> **Índice de un trabajo de cuatro piezas.** Cada pieza tiene su plan ejecutable; este documento dice
> **en qué orden**, **de qué depende cada una**, **qué NO se toca** y **qué queda fuera de alcance**.
> Empezá por acá antes de abrir cualquiera de los planes.

**Objetivo:** llevar al portal de AMG OS la gestión de agencia que hoy vive en
`/Users/juan.olivadoti/jp/dashboard-project/` (Angular 19 + NgRx + Firestore): **clientes**,
**usuarios**, **ideas** y el **dashboard**, más el **aspecto de la UI** que las acompaña — con los
datos en Postgres bajo RLS y API propia, no en Firestore.

**Restricción que gobierna todo el programa: la demo no se interrumpe.** El trabajo va en ramas
aparte, en otra máquina/sesión, y `main` sigue recibiendo el roadmap de la demo. Ver
[Cómo no interrumpir la demo](#cómo-no-interrumpir-la-demo) — es la sección más importante de este
documento.

## Decisiones ya tomadas (2026-08-01)

Estas cuatro las decidió Juan al planificar; los planes las dan por cerradas y **no hay que
re-litigarlas**:

| Decisión | Qué significa |
|---|---|
| **Postgres es la fuente de datos, con API propia** | Firestore se abandona. Nada de `@angular/fire` en el portal |
| **La pantalla de usuarios gestiona MEMBRESÍAS, no altas** | El alta sigue haciéndose en Supabase Auth. La API **no** recibe ninguna credencial de Supabase (recibe 4 claves y ninguna es una service key: `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS`, `SUPABASE_JWT_AUD` — verificado en `scripts/env-sync.mts:26`) |
| **Los permisos son derivados del rol y de solo lectura** | Preserva ADR-15: el rol se deriva de `memberships` y la autorización la hace RLS dentro de Postgres, no 20 booleanos en un documento |
| **Ideas: modelo + pantallas + seed de ejemplo; el ingreso se decide después** | No se construye la integración con n8n en esta tanda. La pantalla se ve funcionando con datos sembrados |
| **Estado con signals, no NgRx** | El portal no usa NgRx; meterlo dejaría dos arquitecturas de estado en la misma SPA |

## Las cuatro piezas, en orden

| # | Pieza | Plan | Depende de | Tamaño del origen | Estado |
|---|---|---|---|---|---|
| 1 | **Clientes** — listado, crear, perfil, vista | [plan](2026-08-01-paginas-clientes-portal.md) | — | 1 407 líneas | 🔵 Planificada |
| 2 | **Usuarios** — listado, perfil, membresías | [plan](2026-08-01-paginas-usuarios-portal.md) | Pieza 1 (asignar cliente a un rol `cliente`) | 570 líneas | 🔵 Planificada |
| 3 | **Ideas** — módulo nuevo completo | [plan](2026-08-01-modulo-ideas-portal.md) | Pieza 1 (una idea pertenece a un cliente) | 104 líneas + modelo | 🔵 Planificada |
| 4 | **Dashboard** — la home con métricas | [plan](2026-08-01-dashboard-home-portal.md) | **Pieza 3** (el dashboard del origen ES stats de ideas + tabla de ideas) | 181 líneas | 🔵 Planificada |

**Por qué ese orden y no otro:** el dashboard del origen (`dashboard.page.ts`) no tiene métricas
propias — selecciona `selectIdeasStats` y renderiza `<ideas-table>`. Sin la pieza 3 no hay dashboard
que portar, solo un grid vacío. Y usuarios necesita clientes porque un rol `cliente` **exige** un
`client_id` (constraint `cliente_exige_client_id`, `0001_init.sql:78`): sin clientes que asignar, la
mitad del formulario no se puede probar.

**El aspecto de la UI no es una pieza aparte:** se extiende dentro de cada una. Ver
[El aspecto de la UI](#el-aspecto-de-la-ui-lo-que-falta-de-verdad).

## Cómo no interrumpir la demo

Esto no es una recomendación: es la condición para que el programa exista. **`main` sigue siendo del
roadmap de la demo.**

### 1. Una rama por pieza, ramificada de `main`

`feature/paginas-clientes`, `feature/paginas-usuarios`, `feature/modulo-ideas`,
`feature/dashboard-home`. Cada una se rebasa sobre `main` antes de mergear — `main` va a haber
avanzado, porque la demo se sigue trabajando en paralelo.

### 2. La lista de qué NO se toca (idéntica en las cuatro piezas)

| Archivo / zona | Por qué |
|---|---|
| `portal/src/app/pages/{runs,brief}/**` | Son los dos golpes centrales del recorrido de la demo |
| `portal/src/app/pages/cartera/**` | Verificada en navegador y en el recorrido. Lo nuevo vive en rutas nuevas |
| `portal/src/app/app.routes.ts` → el `redirectTo: 'runs'` | La puerta de entrada de la demo no se mueve. **Agregar** rutas sí; cambiar el redirect, no |
| `db/src/seed-demo.ts` + `db/src/seed-demo.test.ts` | Producción está sembrada con esto y el perfil está atado por test a `web-builder/business-profile.json`. Los datos de ejemplo nuevos van en **archivos nuevos** (`sembrarIdeasDemo`, etc.), nunca dentro de este |
| `db/src/cartera-portal.test.ts` | Ata el brief del seed con lo que muestra el portal. Si cae, la demo se contradice a sí misma otra vez |
| `db/migrations/0001..0010` | Ya aplicadas en producción (las 10, verificado el 2026-08-01). Lo nuevo **agrega**, nunca edita una migración existente |
| `app.nap_publico`, `app.texto_publico`, `business_profile_publico` | La allowlist del renderizador. Ver la regla de seguridad de abajo |
| `renderer/**`, `web-builder/**`, `orchestrator/**`, `kr-service/**` | Fuera del alcance del programa entero |

### 3. El shell se extiende, no se reemplaza

`portal/src/app/shared/layout/` (`app-shell`, `app-header`, `app-sidebar`, `backdrop`) está en el
recorrido de la demo. Se puede **agregar** un item al array `ITEMS_NAV` de `app-sidebar.ts` y
actualizar su `.spec.ts`; **no** se puede reescribir el sidebar para traer el de 627 líneas del
origen. Si una pieza cree que necesita rehacer el shell, **paren y pregunten**.

### 4. Numeración de migraciones: coordinar antes de escribir

Cuatro piezas en cuatro ramas pueden reclamar el mismo número (`0011`) y chocar al mergear. Reserva
fijada acá, de una vez:

| Pieza | Migración |
|---|---|
| 1 Clientes | `0011_clientes_crm.sql` |
| 2 Usuarios | `0012_membresias_perfil.sql` (solo si hace falta; ver su plan) |
| 3 Ideas | `0013_ideas.sql` |
| 4 Dashboard | ninguna (solo lee) |

Si una pieza se mergea antes que otra y deja un hueco (p. ej. la 2 no necesita migración), **el hueco
se queda**: renumerar una migración ya mergeada rompe el registro `app.migraciones_aplicadas`.

### 5. La regla de seguridad que atraviesa las cuatro piezas

**Ningún dato nuevo entra en la allowlist pública.** `clients.business_profile_publico` es una columna
generada con allowlist y es **lo único** que el rol `app_render` puede leer — el renderizador es la
única pieza expuesta a internet anónimo (ADR-19). Hoy expone exactamente
`brand, locations, menu, name, priceRange` (verificado por consulta el 2026-08-01). **Esa lista no
crece con este programa.** Lo que traen estas piezas es interno: teléfonos, emails, notas de la
agencia, contratos, scoring, transcripciones de audio, quién lleva la cuenta.

Cada pieza que agregue datos lleva un test que lo fija **por mutación**: cargar el dato, leerlo como
`app_render`, y afirmar que no aparece. Pregunta de diseño de siempre: *si me toman el renderizador,
¿qué se llevan?*

### 6. Verificación antes de cerrar cada pieza

- `npm test` y `npm run typecheck` desde la raíz, `npm test -w portal`,
  `npm run test:components -w portal` — con el output a la vista, comparado contra la línea base que
  se anotó al empezar la rama. **Los tests que ya existían siguen todos verdes.**
- **Manejar la app en un navegador** (MCP chrome-devtools) contra `npm run dev:server -w api`, **en
  tema claro y en oscuro**, y confirmar que `/runs`, `/runs/:id` y `/cartera` siguen intactas.
- Leer el código y manejar la app encuentran cosas **distintas**. Hacé las dos.

## El aspecto de la UI: lo que falta de verdad

**El portal ya es TailAdmin destilado.** Tiene el mismo layout (aside fijo `w-64`, header, backdrop),
`stat-box`, `bar-chart`, `line-chart`, y **tokens semánticos** en `portal/src/styles.css`
(`@theme inline`) con nombres de dominio en español: `fondo`, `superficie`, `superficie-2`, `texto`,
`texto-medio`, `texto-tenue`, `texto-invertido`, `borde`, `borde-fuerte`, `accion`,
`respaldo`/`respaldo-suave`, `alerta`/`alerta-suave`, `error`/`error-suave`, `velo`. El toggle de tema
ya existe (`portal/src/app/services/tema.ts`, con tests) — **no** hay que portar `theme-toggle`.

Lo que el origen tiene y el portal no:

| Del origen | ¿Se trae? | Nota |
|---|---|---|
| Submenús en el sidebar + `H_ICONS` (30 iconos) | Sí, cuando una pieza lo necesite | Aditivo sobre `ITEMS_NAV`; los iconos, inline como los dos que ya hay |
| `common/page-breadcrumb` | Sí (pieza 1) | Las pantallas de detalle lo necesitan para volver |
| `common/component-card` | Sí (pieza 1) | Es el contenedor de card que usan casi todas las pantallas |
| `common/table-dropdown` | Sí (pieza 1) | El menú de acciones por fila |
| `filters/*` genéricos | Sí, por pieza | Cada listado trae el suyo |
| `search-form` del header | Opcional (pieza 4) | Sin backend de búsqueda, sería decorativo |
| `header/notification-dropdown` | **No** | No hay sistema de notificaciones en AMG OS. Portarlo sería una campanita que no suena |
| `header/user-dropdown` | Sí (pieza 2) | Encaja con la pieza de usuarios (perfil + logout, que ya existe) |
| `common/theme-toggle` / `theme-toggle-two` | **No** | El portal ya tiene el suyo, con tests |
| `common/countdown-timer`, `grid-shape`, `chart-tab` | **No** | Sin uso en las cuatro pantallas |

**La trampa del aspecto:** el HTML del origen trae colores fijos (`bg-white`, `text-gray-800`,
`dark:bg-gray-900`). El modo oscuro del portal depende de los tokens, no de `dark:`. Portar el HTML
tal cual rompe el modo oscuro **en silencio** — se ve bien en claro y blanco sobre blanco en oscuro.

Hay una red puesta: `portal/src/app/core/contraste.test.ts:124` recorre `src/app` y afirma que
*"ninguna plantilla incrusta un color: todo pasa por un token"* — si alguien pega HTML de TailAdmin
sin traducir, ese test cae. El mismo archivo verifica que **los 17 pares de la UI llegan a AA en los
dos temas** (`:60`), así que un token nuevo con mal contraste tampoco pasa. Es una red, no una excusa
para no abrir las dos vistas en el navegador: el test ve colores, no ve una pantalla ilegible por
otras razones.

## Qué queda explícitamente fuera de alcance

El origen es una plantilla TailAdmin con mucho de ejemplo. **No se porta nada de esto**, y si alguien
lo echa de menos, es un plan nuevo y no una tarea suelta:

- `pages/dashboard/ecommerce copy/` y todo `shared/components/ecommerce/**` (facturas, productos,
  pedidos, mapas de países, objetivos mensuales): son demos de la plantilla.
- `pages/{invoices,calender,charts,forms,tables,ui-elements,blank,other-page,profile}`: catálogo de
  la plantilla.
- `pages/generate-instagram-content` + `post.model.ts` + `social-media.model.ts`: es otro producto
  (generación de contenido para redes). Merece su propio programa, no un renglón acá.
- La integración con **n8n** (`n8n workflows/*.json`): decidida como posterior. La pieza 3 deja el
  hueco preparado (un endpoint de escritura autenticado) pero no la construye.
- **Almacenamiento de archivos.** AMG OS no tiene storage. El audio de una idea y los recursos
  gráficos de un cliente se guardan como **URL a donde ya viven**, no se suben. Si hace falta subir
  archivos, es un plan aparte (con su decisión de dónde y su ADR).
- **Migración de datos desde Firestore**: los datos de allá son de prueba y se descartan (decidido).

## Cómo trabajar en paralelo sin pisarse

- **Esta máquina sigue con la demo.** El programa se ejecuta en otra sesión/máquina, con su propio
  clon o worktree.
- **Una pieza a la vez por rama**, y la rama se mergea antes de empezar la siguiente cuando hay
  dependencia (1→2, 1→3, 3→4). Las piezas 2 y 3 sí pueden ir en paralelo entre sí: ambas dependen
  solo de la 1.
- **Rebase, no merge, para traer `main`**: el historial del proyecto es lineal.
- Al cerrar cada pieza: actualizar `docs/proyecto/09-estado-y-roadmap.md` y
  `docs/proyecto/11-plan-fase-2.md`, sincronizar las cifras de tests **en todos los lugares donde
  aparecen**, y marcar la pieza en la tabla de este documento.
- Commits en español, terminando con un `Co-Authored-By:` que nombre al modelo de la sesión.
