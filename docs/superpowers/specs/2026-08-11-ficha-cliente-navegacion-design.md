# Navegación cliente-céntrica: todo cuelga de la ficha del cliente

**Fecha:** 2026-08-11
**Alcance:** `portal/` exclusivamente. Cero cambios en `api/`, `db/`, `contrato/`.
**Origen del pedido:** replicar la navegación de `dashboard-project` (el proyecto Angular 19 +
Firestore del que ya se portaron el CRM de clientes y la vista del cliente), donde el trabajo de un
cliente se alcanza **desde su ficha** y no desde el menú de la plataforma.

---

## El problema

El portal está organizado por **módulo**, no por **cliente**. El sidebar ofrece cuatro entradas
transversales (Research, Cartera, Clientes, Usuarios) y el trabajo de un cliente concreto queda
repartido entre ellas. Dos síntomas lo delatan:

1. **El formulario de lanzar research pide el UUID del cliente pegado a mano en un `<input>`**
   ([`portal/src/app/pages/runs/runs.ts:31`](../../../portal/src/app/pages/runs/runs.ts)). No es un
   descuido de UI: es lo que pasa cuando la pantalla no sabe de qué cliente está hablando, porque
   nada en la URL se lo dijo.
2. **Las reseñas viven en `/clientes/:id/ver` como datos inventados**
   ([`cliente-vista.ts:132`](../../../portal/src/app/pages/clientes/cliente-vista.ts)), junto a Ideas e
   Instagram, en una pantalla cuyo propósito declarado es *«lo que verá el cliente»* — una audiencia
   que hoy no existe, porque no hay login de cliente.

La ficha `/clientes/:id` existe y muestra cuatro cards editables, pero es una hoja: no lleva a
ninguna parte. El listado ofrece dos acciones por fila (ficha y "ver") que compiten entre sí.

## La decisión

**El cliente pasa a ser el eje de la navegación.** La ficha deja de ser una hoja y se convierte en un
contenedor con cuatro tabs, cada uno una ruta hija propia. Lo que es *de un cliente* se alcanza desde
ahí y solo desde ahí; lo que es *de la agencia* (Cartera, Usuarios) se queda en el menú.

Cuatro decisiones tomadas con el usuario, en orden:

| Decisión | Elegido | Descartado, y por qué |
| --- | --- | --- |
| Qué pasa con las entradas globales del menú | **Research sale, Cartera se queda** | Sacar las dos: Cartera compara *todos* los clientes, no es de ninguno. Dejar las dos: dos caminos a lo mismo se desincronizan |
| Forma de las secciones dentro de la ficha | **Tabs como rutas hijas** | Tabs con `signal` (sin deep-link, el back sale de la ficha, se carga todo el código siempre). Todo apilado (scroll interminable con 4 módulos) |
| Qué pasa con `/clientes/:id/ver` ("Mi Portal") | **Se retira; sus tabs se absorben** | Conservarlo como previsualización duplica Reseñas e Ideas en dos sitios con dos verdades |
| Las tres pantallas de un run | **Se mueven bajo el cliente** | Dejarlas en `/runs/:id` era el camino de cero riesgo; se prefirió la coherencia de URL de punta a punta |

Y una asumida sin preguntar, porque el usuario cortó ahí: **las URLs `/runs/*` viejas se borran sin
redirect.** El portal es interno y sus enlaces no son públicos; un `/runs/...` guardado cae en el
catch-all y vuelve a `/clientes`. Si aparece uno pegado en un chat, el coste es un rebote silencioso,
no una pérdida de datos.

---

## El mapa de rutas

```
/clientes                                        listado          (sin cambios)
/clientes/nuevo                                  alta             (sin cambios)
/clientes/:id                          ┐ SHELL DE FICHA (nuevo) → redirect a perfil
    ├── perfil                         │ los 4 cards de hoy
    ├── research                       │ runs de ESE cliente + lanzar
    │     └── :runId                   │ brief
    │           └── informe            │ informe
    ├── resenas                        │ placeholder (Bloque F del plan)
    └── ideas                          ┘ placeholder (pieza 3, etapas 5-7)

/clientes/:id/research/:runId/entregable   FUERA del shell, declarada en la raíz

/cartera   /usuarios   /usuarios/:id   /login        sin cambios
```

Desaparecen: `/runs`, `/runs/:id`, `/runs/:id/informe`, `/runs/:id/entregable`, `/clientes/:id/ver`.

### Tres cosas del orden que son load-bearing

1. **`clientes/nuevo` va antes que `clientes/:id`.** Si no, `:id` empareja la palabra literal
   "nuevo" y el alta se vuelve inalcanzable. Hoy ya está en ese orden por casualidad de escritura;
   con la anidación pasa a ser una garantía que necesita test propio, no un comentario.
2. **El entregable se declara en la raíz con el path completo**
   (`clientes/:id/research/:runId/entregable`), con su propio `authGuard`, **antes** de la ruta `''`.
   Es el mismo truco que hoy usa `runs/:id/entregable` y que está documentado en
   [`app.routes.ts:10-23`](../../../portal/src/app/app.routes.ts): la hoja del restaurante no es una
   pantalla, es un documento para imprimir, y al salir del shell se queda sin sidebar `fixed` y sin
   el `lg:pl-64` del contenedor. Anidarla bajo la ficha la devolvería al shell y reintroduciría los
   bugs de impresión que salir de ahí resolvió. **Al salir del shell pierde el `authGuard` heredado,
   por eso lleva el suyo**: sin esa línea sería alcanzable sin sesión.
3. **La home cambia de destino.** `{ path: '', redirectTo: 'runs' }` y `{ path: '**', redirectTo:
   'runs' }` apuntan a una ruta que deja de existir → pasan a `clientes`.

### El nombre de los parámetros, que es donde se esconde el bug

La ruta anidada tiene **dos** parámetros: `:id` (el cliente) y `:runId` (el run). Se conserva `:id`
para el cliente por consistencia con `/clientes/:id` y `/usuarios/:id`, que ya existen.

Eso obliga a un cambio silencioso pero real: **hoy `brief.ts`, `informe.ts` y `entregable.ts` leen
`params.get('id')` esperando el RUN.** Con la ruta nueva, ese `id` es el cliente. Los tres pasan a
leer `params.get('runId')`. El modo de fallo si se olvida uno es pedirle a la API el brief del UUID
de un cliente: responde 404 y la pantalla queda vacía — falla ruidosamente, que es lo único bueno del
asunto. Va con test en los tres.

---

## Los componentes

### `pages/clientes/cliente-ficha.ts` (nuevo) — el shell

Breadcrumb, cabecera del cliente (logo/inicial, nombre, industria, chips de etiquetas), barra de tabs
con `routerLink` + `routerLinkActive`, y un `<router-outlet>`.

**La carga del cliente se muda del perfil al shell.** Hoy
[`cliente-perfil.ts:74-101`](../../../portal/src/app/pages/clientes/cliente-perfil.ts) se suscribe a
`paramMap`, pide el cliente por id y redirige a `/clientes` si no existe — con su guardia contra la
carrera de dos `:id` distintos (comparar contra `idActual` después del `await`). Todo eso sube al
shell tal cual, incluida la guardia: el motivo por el que existe (Angular reutiliza la instancia
cuando cambia solo el parámetro) sigue siendo cierto para el shell.

Ganancia concreta: el cliente se pide **una vez** y saltar entre los cuatro tabs no vuelve a pedirlo.

### `pages/clientes/cliente-perfil.ts` — adelgaza

Queda como componente de presentación: pinta los cuatro cards leyendo `clientesService.cliente()`.
Pierde `OnInit`/`OnDestroy`, la suscripción y el redirect.

### `pages/clientes/cliente-research.ts` (nuevo) — reemplaza a `runs.ts`

Es `RunsPage` con dos cambios:

- `listarRuns()` pasa a `listarRuns(clienteId)`. **El filtro ya existe de punta a punta**:
  `GET /runs?clientId=` en [`api/src/app.ts:114`](../../../api/src/app.ts) y el cliente HTTP del portal
  en [`api-core.ts:256`](../../../portal/src/app/core/api-core.ts) ya acepta el parámetro opcional. Lo
  único que falta es que alguien se lo pase.
- El formulario de lanzar pierde el `<input>` del UUID: toma el cliente del `:id` de la ruta. La
  lógica de si se muestra (`mostrarLanzarResearch(esEquipo, flag)`) no se toca.

Los enlaces de cada run apuntan a `['/clientes', clienteId, 'research', run.id]`.

### `pages/clientes/cliente-resenas.ts` y `cliente-ideas.ts` (nuevos) — placeholders honestos

Un estado vacío que dice **qué falta y por qué**, no un "próximamente" decorativo:

- **Reseñas** — Bloque F del plan: no hay ni código ni spec. Falta decidir autorización de Google,
  compuerta humana (¿publica sola una respuesta generada por IA?) y multi-tenancy de las credenciales.
- **Ideas** — pieza 3 del programa del portal: la migración `0013`, `PgIdeas` y los tres endpoints
  **ya existen** (etapas 1-4, cerradas el 2026-08-09/10); faltan las pantallas (etapas 5-7). Este tab
  es el hueco donde caen.

**No se recicla el mock.** Los datos inventados de `cliente-vista-mock.ts` se borran con la pantalla
que los mostraba. Un tab con tres reseñas ficticias de un restaurante que no las tiene es peor que
uno vacío: miente con más detalle. El Bloque J del plan ya condena esos mocks.

### Qué se borra

`cliente-vista.ts` (303 líneas), `cliente-vista.spec.ts`, `core/cliente-vista-mock.ts` y
`cliente-vista-mock.test.ts`, `pages/runs/` entero, y los dos `routerLink` a `/ver`
([`clientes-tabla.ts:88`](../../../portal/src/app/pages/clientes/clientes-tabla.ts),
[`cliente-meta-card.ts:112`](../../../portal/src/app/pages/clientes/cliente-meta-card.ts)). El listado
pasa a tener **una** acción por fila.

El tab **Instagram** desaparece con ellos: no fue elegido entre los cuatro, y era mock puro.

---

## El riesgo que la anidación introduce

Con `/clientes/:id/research/:runId`, el cliente de la URL y el dueño real del run **son dos
afirmaciones independientes que nada obliga a coincidir**.

RLS impide ver runs de otro tenant, así que no hay fuga entre clientes de distintas agencias. Pero
*dentro* del mismo tenant nada impide abrir `/clientes/<A>/research/<run-de-B>`: la API devolvería el
brief correcto —el run es visible para ese usuario— y la cabecera de la ficha diría el cliente
equivocado. No es una escalada de privilegios; es una pantalla que miente sobre de quién es el
trabajo que muestra, que en una agencia con cartera es un error de facturación esperando.

**Mitigación:** el brief compara `brief.run.client_id` contra el `:id` de la ruta y redirige a la
ficha correcta si no coinciden. Con **test de mutación**: se reintroduce el mismatch y se confirma
que cae *ese* test y no otro. Sin esto, el `:id` redundante en la URL es un pasivo —una segunda
fuente de verdad sin nadie que la concilie— en vez de un activo.

`RunSummary` ya expone `client_id` ([`core/models.ts:11`](../../../portal/src/app/core/models.ts)), así
que el dato para comparar está disponible sin tocar el contrato.

---

## Verificación

```bash
npm run verificar -- --con-portal      # typecheck + tests de los 7 paquetes + portal
npm run dev:server -w api              # y manejarlo en un navegador
```

**El navegador no es opcional acá.** Los tests no ven un `routerLinkActive` que no pinta el tab
activo, ni un tab que cambia de contenido sin cambiar la URL, ni una hoja de entregable que volvió a
heredar el `lg:pl-64` del shell. Recorrido mínimo: listado → ficha → los cuatro tabs → lanzar un
research → abrir su brief → informe → entregable (y comprobar que sigue sin sidebar) → back del
navegador en cada salto.

### Tests que se tocan porque fijan la decisión vieja

No están rotos: dicen lo que hoy es verdad y va a dejar de serlo.

| Archivo | Qué fija hoy | Qué pasa a fijar |
| --- | --- | --- |
| `app.routes.test.ts` | 5 tests: `runs`/`runs/:id`/`cartera` como hijas del shell, el entregable fuera, ninguna hija repite `authGuard`, el `redirectTo: runs` | La jerarquía nueva, el orden `nuevo` antes de `:id`, el entregable en la raíz con guard propio, el `redirectTo: clientes` |
| `app-sidebar.spec.ts` | Enumera los 4 ítems, incluido Research | 3 ítems: Cartera, Clientes, Usuarios |
| `cliente-perfil.spec.ts` (269 líneas) | Carga por `paramMap`, redirect si no existe, la carrera de dos `:id`, y los cards | **Se reparte**: carga/redirect/carrera → spec del shell; cards → spec del perfil |

### Tests nuevos

- El orden `clientes/nuevo` antes de `clientes/:id` (mutación: invertirlos y ver caer el test).
- Los tres componentes de run leen `runId`, no `id`.
- El brief redirige cuando el `client_id` del run no coincide con el `:id` de la ruta.
- `cliente-research` pasa el id del cliente a `listarRuns` (mutación: quitarlo y ver caer el test).
- El shell pide el cliente **una vez** al saltar entre tabs.

---

## Lo que este trabajo NO hace

- **No implementa Reseñas** (Bloque F: necesita una sesión de diseño antes que código).
- **No implementa las pantallas de Ideas** (etapas 5-7 de la pieza 3, con
  [plan propio ya escrito](../plans/2026-08-01-modulo-ideas-portal.md)).
- **No toca Cartera**, que sigue con datos mock y su propia deuda anotada en el Bloque I.
- **No toca la API, la base ni el contrato.** Si algo de esto exige un cambio de endpoint, el diseño
  está mal y hay que volver acá.

## Documentación a actualizar al cerrar

Por el ritual del [`AGENTS.md`](../../../AGENTS.md), paso 3:

- [`docs/proyecto/09-estado-y-roadmap.md`](../../proyecto/09-estado-y-roadmap.md) — el estado del
  programa del portal.
- [`docs/proyecto/15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md) — Bloque J (dónde
  caen ahora las etapas 5-7 de Ideas) y Bloque F (dónde cae Reseñas).
- [`progress/history.md`](../../../progress/history.md) — la entrada del día.
