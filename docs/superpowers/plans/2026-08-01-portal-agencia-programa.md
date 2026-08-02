# El portal de la agencia — programa de incorporación desde `dashboard-project`

> **Índice de un trabajo de cuatro piezas.** Cada pieza tiene su plan ejecutable; este documento dice
> **en qué orden**, **de qué depende cada una**, **qué NO se toca** y **qué queda fuera de alcance**.
> Empezá por acá antes de abrir cualquiera de los planes.
>
> 👉 **¿Venís a ejecutar esto en otra máquina?** El prompt de arranque, listo para copiar, está al
> final: [Prompt para arrancar en otra máquina](#prompt-para-arrancar-en-otra-máquina).

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
| 1 | **Clientes** — listado, crear, perfil, vista | [plan](2026-08-01-paginas-clientes-portal.md) | — | 1 407 líneas | ✅ Cerrada, mergeada a `main` y desplegada (migración `0011` aplicada en producción el 2026-08-02) |
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

| Pieza / trabajo | Migración | Propietario | Estado |
|---|---|---|---|
| 1 Clientes | `0011_clientes_crm.sql` | pieza 1 | ✅ **aplicada** (mergeada 2026-08-01) |
| 2 Usuarios | `0012_membresias_perfil.sql` | pieza 2 | 🔵 reservada — **bloqueada por ADR-24** |
| 3 Ideas | `0013_ideas.sql` | pieza 3 | 🔵 reservada |
| 4 Dashboard | ninguna (solo lee) | — | — |
| [Plantillas de landing](../specs/2026-08-01-plantillas-landings-design.md) | `0014_fotos_publicas.sql` | spec de landings | 🔵 reservada |

**La reserva incluye trabajos que no son del portal** (enmienda del 2026-08-02). El spec de landings
tomó la `0012` mirando solo `db/migrations/`, donde estaba libre, y pisó la de usuarios: **un número
libre en el disco no es un número libre.** Antes de escribir una migración, mirar esta tabla, no la
carpeta.

Si una pieza se mergea antes que otra y deja un hueco (p. ej. la 2 no necesita migración), **el hueco
se queda**: renumerar una migración ya mergeada rompe el registro `app.migraciones_aplicadas`.

**El número no es cronología.** `migrarConRegistro` (`db/src/deploy.ts`) lista los `.sql`, los ordena
alfabéticamente y aplica los que no estén registrados — así que si la `0013` se aplica primero y la
`0012` llega después, la `0012` se aplicará **después** de la `0013`, pese a su número menor. Eso es
correcto solo mientras las migraciones reservadas sean **independientes entre sí**, que hoy lo son
(`0012` toca `memberships`/`auth`, `0013` crea una tabla nueva, `0014` toca `app.nap_publico`).
**Antes de mergear, cada pieza declara acá si su migración depende de alguna hermana.** Si alguna
vez una dependiera, el número deja de alcanzar y hay que ordenar el merge.

### 5. La regla de seguridad que atraviesa las cuatro piezas

**Ningún dato interno que traigan estas cuatro piezas entra en la allowlist pública.**
`clients.business_profile_publico` es una columna generada con allowlist y es **lo único** que el rol
`app_render` puede leer — el renderizador es la única pieza expuesta a internet anónimo (ADR-19). Hoy
expone exactamente `brand, locations, menu, name, priceRange` (verificado por consulta el
2026-08-01). **Esa lista no crece con este programa.** Lo que traen estas piezas es interno:
teléfonos, emails, notas de la agencia, contratos, scoring, transcripciones de audio, quién lleva la
cuenta.

> **Delimitación (enmienda del 2026-08-02).** Esta regla **no** es una invariante de todo AMG OS: es
> una restricción de *estas cuatro piezas*. Antes decía "ningún dato nuevo entra en la allowlist
> pública" a secas, y así leída prohíbe también lo que el contrato público sí debe crecer.
> **Las ampliaciones legítimas del contrato público existen y van por otro camino:** un diseño
> específico del renderizador, con su migración y su revisión contra ADR-19. La que está en curso es
> el [spec de plantillas de landing](../specs/2026-08-01-plantillas-landings-design.md), que agrega
> `portada`, `fotos`, `menu[].foto`, `locations[].foto` y `brand.plantilla` — datos que son públicos
> por definición: son la web del cliente. No hay contradicción; había un alcance mal escrito.

Cada pieza que agregue datos lleva un test que lo fija **por mutación**: cargar el dato, leerlo como
`app_render`, y afirmar que no aparece. Pregunta de diseño de siempre: *si me toman el renderizador,
¿qué se llevan?*

**El test tiene que fallar por la razón correcta.** Con `force row level security` y sin policy para
`app_render`, un `select` devuelve cero filas *aunque exista el grant*: un test que mire el conteo
pasa igual y su mutación de control no cae. Donde se pruebe que `app_render` no llega a algo, hay que
**afirmar `permission denied`**, no el conjunto vacío.

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

## Las integraciones de retorno (enmienda del 2026-08-02)

El grafo de dependencias `1→2`, `1→3`, `3→4` es correcto pero **incompleto**: la pieza 1 se cerró con
dos huecos que solo pueden taparse cuando existan las piezas siguientes. No son ciclos —
`1 → 2 → integración` es una cadena— pero si no están escritos acá, nadie los hace.

| # | Qué quedó abierto en la pieza 1 | Quién lo cierra |
|---|---|---|
| A | `asignado_a` es un `<input type="text">` donde la agencia escribe un UUID a mano (`cliente-crear.ts`), porque no había listado de miembros | **Pieza 2, Etapa 6** |
| B | El tab "Ideas" de `/clientes/:id/ver` son datos de ejemplo iguales para todos los clientes (`cliente-vista-mock.ts`) | **Pieza 3, Etapa 7** |
| C | "URL del logo" y "URL de imagen de portada" se guardan en `contacto` (interno, que nunca sale a la web) en vez de en `business_profile` (público) | **Trabajo E, abajo** |

### Trabajo E — El puente al perfil público

**Dueño: este programa** (no el spec de landings, que llega hasta contrato y render por decisión de
alcance, ni la pieza 1, que está cerrada). Sin un dueño explícito, este cambio no es de nadie: la
agencia carga la portada del cliente y la web no la muestra nunca.

**Precondición:** entrega 1 del [spec de landings](../specs/2026-08-01-plantillas-landings-design.md),
que es la que crea `business_profile.portada`. Antes de eso, el formulario escribiría un campo
inexistente.

- [ ] "URL del logo" pasa a escribir `business_profile.brand.logo` (que **ya existe** y ya lo pinta la
      cabecera del sitio); "URL de imagen de portada", `business_profile.portada.src`.
- [ ] **Operación de datos estrecha, no `business_profile` en `COLUMNAS_EDITABLES`.** `actualizarCliente`
      (`db/src/clientes.ts`) escribe la columna entera: `contacto = $n::jsonb`. Con `business_profile`
      en esa lista, un `PATCH` que solo trae la portada **borraría `locations`, `menu`, `brand` y
      `name`** — pérdida silenciosa justo en el dato que alimenta la web pública. Hace falta un
      **merge anidado en el servidor**, que toque solo los paths que el formulario posee.
- [ ] Validar **forma, HTTPS y host** al escribir, contra la misma allowlist que define el spec de
      landings. Las cuatro fronteras protegen la lectura; que la escritura no meta basura es barato y
      evita que el renderizador tenga que descartar en cada request.
- [ ] Inicializar `business_profile.name` coherentemente si el perfil todavía es `null`: un perfil sin
      `name` no pasa `perfilValido` y la web sale sin bloque de contacto.
- [ ] **Test que lo fija:** actualizar la portada de un cliente que tiene `locations`, `menu`, `fotos`
      y `brand` cargados, y afirmar que los cuatro **siguen ahí** después del PATCH.
- [ ] Observación que este trabajo hereda, y conviene cerrar de paso: **`contacto` ya tiene el mismo
      problema hoy.** La única razón por la que un PATCH parcial no borra datos es que el front manda
      siempre el objeto completo (`cliente-direccion-card`). Es una garantía que vive en el cliente,
      no en el servidor — es decir, no es una garantía.

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

---

## Prompt para arrancar en otra máquina

Copiá el bloque de abajo tal cual en una sesión nueva de Claude Code, dentro del repo. Está escrito
para la **pieza 1 (clientes)**; para las siguientes, cambiá las dos líneas marcadas — el plan a leer y
el nombre de la rama — y respetá el orden de la
[tabla de piezas](#las-cuatro-piezas-en-orden).

````markdown
# AMG OS — ejecutar el programa del portal de la agencia (pieza 1: clientes)

Repo: `/Users/juan.olivadoti/jp/amg-project`. Hacé `git pull` de `main` antes de empezar: esta
máquina no es la que trabaja la demo, y `main` avanza en paralelo.

## Leé esto antes de escribir una línea de código

1. `CLAUDE.md` del repo — el ritual de cada iteración, la disciplina de tests y los invariantes de
   arquitectura. No es opcional.
2. `docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` — el programa: las cuatro piezas,
   el orden, qué NO se toca, la reserva de números de migración, qué queda fuera de alcance.
3. `docs/superpowers/plans/2026-08-01-paginas-clientes-portal.md` — **la pieza que ejecutás**.
   ← cambiá esta línea para las piezas 2, 3 o 4.
4. `docs/proyecto/09-estado-y-roadmap.md` y `docs/decisiones-arquitectura.md` (ADR-13, 15, 17, 18, 19).

## Qué hay que hacer

Ejecutá el plan task-by-task con `superpowers:subagent-driven-development` (o
`superpowers:executing-plans`). Rama `feature/paginas-clientes`, desde `main` al día.
← cambiá el nombre de la rama para las piezas 2, 3 o 4.

Las cuatro pantallas de gestión de clientes de `/Users/juan.olivadoti/jp/dashboard-project/`
(listado, crear, perfil, vista) al portal de AMG OS, con los datos en **Postgres bajo RLS** y
endpoints propios en `api/`. El plan tiene siete etapas con checkboxes; seguilas en orden.

## Decisiones ya cerradas — no las re-litigues

- **Postgres es la fuente de datos.** Firestore se abandona; nada de `@angular/fire` en el portal.
- **Estado con signals**, no NgRx. Los 4 archivos de NgRx del origen se reescriben como un servicio.
- **Las 4 pantallas van bajo `/clientes`**; `/cartera` no se toca.
- **No se migran datos** desde Firestore (son de prueba).
- Sin storage en AMG OS: los recursos gráficos son **URLs a donde ya viven**; no se sube nada.

## Las tres reglas que no se rompen

1. **La demo no se interrumpe.** El programa tiene la lista explícita de qué no tocar: `/runs`,
   `/brief`, `/cartera`, el `redirectTo: 'runs'`, `db/src/seed-demo.ts` y sus dos tests
   (`seed-demo.test.ts`, `cartera-portal.test.ts`), las migraciones `0001..0010`, y
   `renderer/` / `web-builder/` / `orchestrator/`. Si una tarea parece necesitar tocar algo de ahí,
   **pará y preguntá**.
2. **Ningún dato nuevo entra en la allowlist pública.** `clients.business_profile_publico` es lo
   único que el rol `app_render` puede leer, y `app_render` es el proceso expuesto a internet
   anónimo (ADR-19). Hoy expone exactamente `brand, locations, menu, name, priceRange`. La migración
   de tu pieza **no** toca `app.nap_publico`, no re-materializa la columna generada y no concede
   grants nuevos. Va con un test que lo fija **por mutación**.
3. **Rojo primero, y verificación por mutación.** Reintroducí el bug y confirmá que cae
   *exactamente* su test. Un test de seguridad que siempre pasa es peor que no tenerlo: al escribir
   estos planes, un test resultó vacuo (comparaba mayúsculas de un UUID que era todo dígitos) y solo
   la mutación lo destapó.

## Cómo verificar (cada plan lo detalla por etapa)

```bash
npm install
npm test                        # los 6 paquetes + scripts/
npm run typecheck
npm test -w portal
npm run test:components -w portal
npm run dev:server -w api       # la API real sobre PGlite, sin credenciales
```

Anotá los números del verde **antes** de empezar: son la línea base contra la que se compara al
cerrar. Y **manejá la app en un navegador** (MCP chrome-devtools) en tema **claro y oscuro** — el
HTML de TailAdmin trae colores fijos y el modo oscuro del portal depende de tokens semánticos, así
que pegarlo sin traducir se ve bien en claro y blanco sobre blanco en oscuro.
`portal/src/app/core/contraste.test.ts:124` atrapa los colores incrustados, pero no atrapa una
pantalla ilegible por otras razones: leer el código y manejar la app encuentran cosas distintas.

## Al cerrar

Rebase sobre `main` (habrá avanzado), todo verde otra vez, auto-revisión adversarial del diff,
actualizar `docs/proyecto/09-estado-y-roadmap.md` y `docs/proyecto/11-plan-fase-2.md` con las cifras
sincronizadas, y marcar la pieza en la tabla del programa. Commits en español, terminando con un
`Co-Authored-By:` que nombre al modelo de la sesión.
````
