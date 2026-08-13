# Pieza 4 — El dashboard (la home del portal)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Leé primero el [programa](2026-08-01-portal-agencia-programa.md).** Esta pieza es la última y la
> más chica, pero es la que más fácil pisa la demo: toca la puerta de entrada del portal. La sección
> [La trampa de esta pieza](#la-trampa-de-esta-pieza-la-puerta-de-entrada) es de lectura obligatoria.
>
> **PIEZA COMPLETA (2026-08-13).** Con una corrección de destino respecto a lo escrito acá: el
> rediseño client-céntrico del 2026-08-11 cambió `redirectTo: 'runs'` por `redirectTo: 'clientes'`
> — el route `/runs` global ya no existe. La regla de fondo (**no tocar el destino por defecto en
> esta pieza**) se sostuvo tal cual, solo que apunta a `clientes`, no a `runs`. Decisión confirmada
> con el usuario el 2026-08-13, ver `.superpowers/sdd/progress.md`.

**Goal:** una pantalla de inicio que responda "cómo va la agencia hoy" de un vistazo. Origen:
`dashboard-project/src/app/pages/dashboard` (181 líneas) + `stat-box` + `ideas-table` +
`box-metrix.helpers.ts`.

**Rama:** `feature/dashboard-home`. **Depende de:** **pieza 3 (ideas)** — el dashboard del origen no
tiene métricas propias: selecciona `selectIdeasStats` y renderiza `<ideas-table>`. Sin ideas, no hay
nada que portar.

## Lo que el origen realmente es

`dashboard.page.html` son **13 líneas**: un grid con seis `<stat-box>` y una `<ideas-table>`. Los seis
stats salen de `BOX_HELPERS`: Total Ideas, Nuevas, En Revisión, Aprobadas, Rechazadas, Clientes. Es
decir: **el dashboard del origen es el módulo de ideas visto desde arriba**, más un contador de
clientes.

Eso importa porque marca qué NO hay que hacer: no hay que "portar un dashboard", hay que **decidir qué
mide la home de AMG OS** ahora que hay más de un módulo. AMG tiene research (runs, páginas,
evidencia, coste) que el origen no tenía, y `/cartera` ya muestra parte de eso.

## Qué mide la home, y por qué no duplica `/cartera`

`/cartera` ya existe, está verificada en navegador y está en el recorrido de la demo. Hoy muestra
**Sitios activos**, **Opportunity score promedio**, **Coste total (USD)**, más un gráfico de barras de
opportunity score y una línea de coste — o sea: **la cartera vista como research**.

La home no repite eso. Se propone como **estado de trabajo de la agencia**:

| Tile | De dónde sale | Nota |
|---|---|---|
| Ideas por estado (4 tiles: nuevas, en revisión, aprobadas, rechazadas) | Pieza 3 | Es lo que el origen medía, y es trabajo pendiente real: "hay 7 ideas nuevas sin revisar" es accionable |
| Clientes activos | Pieza 1 (`clients` sin `archived_at`) | |
| Briefs esperando aprobación | `kr_runs` en `pending_approval` | **Esto es lo que la demo cuenta**: la compuerta humana. Es la métrica más valiosa del sistema y no está en ninguna pantalla |
| Últimas ideas (tabla) | Pieza 3 | Con enlace al detalle |

**Nada de tiles que no se puedan calcular.** Si un número no sale de la base, no se muestra —
específicamente, **no se portan** los widgets de `shared/components/ecommerce/**` (objetivo mensual,
ventas, pedidos, mapa de países): son demos de la plantilla TailAdmin y en AMG OS mostrarían datos
inventados. Ya está listado como fuera de alcance en el programa.

## La trampa de esta pieza: la puerta de entrada

`portal/src/app/app.routes.ts` redirige `''` a `runs`, y **eso es deliberado**: es el primer golpe del
recorrido de la demo. El estado del proyecto lo dice explícitamente ("la puerta de entrada es `/runs`,
no el dashboard").

**Regla de esta pieza:** la home nueva vive en una ruta propia (`/inicio` o `/dashboard`) y **el
`redirectTo: 'runs'` no se toca**. Cambiar la puerta de entrada del portal es una decisión de producto
que se toma **después de mostrarle la demo a Frank**, no un efecto colateral de esta rama. Si al
terminar parece obvio que la home debería ser el destino por defecto, se dice en el informe de cierre y
lo decide Juan — en un commit aparte, de una línea, con su verificación en el navegador.

## Architecture

```text
portal/  pages/inicio/inicio.ts  ──►  services/{ideas,clientes}.ts + api  (todo ya construido
                                       en las piezas 1 y 3; esta pieza AGREGA una vista)
```

> **Enmendado el 2026-08-02.** La duda que este párrafo dejaba abierta ya está resuelta del lado de
> la pieza 3: **`GET /ideas` devuelve un resumen sin `transcripcion`, `analisis` ni `audio_url`**, con
> filtros, orden y límite; el detalle sensible sale solo por `GET /ideas/:id`. Esta pieza consume ese
> resumen (o un endpoint de conteos, si los volúmenes lo justifican) y **nunca el detalle completo**.
> Sin ese contrato, contar estados en el navegador significaba traerse todas las transcripciones de
> audio del tenant para pintar cuatro números. **Si al empezar esta pieza el `GET /ideas` todavía
> devuelve el detalle completo, la pieza 3 no está terminada** — arreglarlo allá, no acá.

**Esta pieza no debería necesitar migración ni endpoints nuevos** — si los necesita, algo se quedó
afuera de las piezas 1 o 3 y conviene arreglarlo allá, no acá. La excepción razonable: un endpoint de
**conteos** (`GET /metrics` o similar) para no traer todas las filas al navegador solo para contarlas.
Decidir con datos: si el tenant tiene decenas de filas, contar en el cliente está bien; si puede tener
miles, se cuenta en Postgres. **Y si se agrega el endpoint, lleva sus tests de aislamiento como
cualquier otro** (un tenant no cuenta las filas de otro).

## Global Constraints

Las del [programa](2026-08-01-portal-agencia-programa.md#cómo-no-interrumpir-la-demo), más:

- **El `redirectTo: 'runs'` no se toca.** Ver arriba.
- **Ningún tile con datos inventados.** Si no se puede calcular, no está.
- **Un cero es información, no un hueco.** "0 ideas nuevas" se muestra como cero; lo que no se hace es
  mostrar cero cuando el dato **no existe** (eso es mentir). Si un módulo no está disponible, el tile
  no aparece.
- **La home respeta el rol.** Un `cliente` no debería ver conteos de toda la agencia. Los números salen
  de consultas **bajo RLS**, así que cada usuario ve lo suyo por construcción — pero eso hay que
  **verificarlo con un test**, no asumirlo: un conteo mal escrito (un `count(*)` en una vista sin RLS)
  es exactamente el tipo de fuga que RLS no puede atrapar sola.

## Etapa 1 — Decidir y fijar las métricas

- [x] Confirmar la lista de tiles de la tabla de arriba contra lo que las piezas 1 y 3 dejaron
      realmente construido. Si "briefs esperando aprobación" no se puede obtener con los endpoints que
      existen, decidir: ¿se agrega el conteo a la API o se calcula de `GET /runs`? — se calcula en el
      cliente, de `GET /runs` sin filtro; no hizo falta ningún endpoint nuevo.
- [x] Escribir el módulo de cálculo en `portal/src/app/pages/inicio/metricas.ts` con **funciones puras**
      (entran las filas, salen los números) y sus tests en `node:test`. Puro para que sea testeable sin
      Angular, como el resto de la lógica del portal.
- [x] **Rojo primero** en `metricas.test.ts`: los conteos por estado con listas vacías, con un solo
      elemento, y con estados repetidos; que un estado desconocido no se cuente en silencio en otro
      grupo (si llega `'aprovada'`, el total no cuadra y hay que verlo, no absorberlo).

## Etapa 2 — La pantalla

- [x] `portal/src/app/pages/inicio/inicio.ts`: los tiles con `app-stat-box` (ya existe) y la tabla de
      últimas ideas reutilizando el componente de la pieza 3 — **sin duplicarlo**. (No hay componente
      de tabla separado en la pieza 3 para reusar — `cliente-ideas.ts` la pinta inline, con filtros y
      paginación que esta tile no necesita — así que la tabla de "últimas ideas" es markup propio y
      chico en `inicio.ts`, documentado en el código.)
- [x] Los datos se cargan con los servicios de las piezas 1 y 3; los derivados son `computed`, no
      `effect`.
- [x] Estados de carga y de error explícitos: una home que se queda en blanco cuando la API falla es
      peor que un mensaje. Y si un módulo falla, **los otros tiles se siguen mostrando** (un
      enhancement no puede tumbar la página que enriquece — el mismo criterio que el renderizador aplica
      con la nav).
- [x] Test de componente (Karma) del render de los tiles y del caso "sin datos".

## Etapa 3 — Rutas, navegación y cierre

- [x] Ruta `loadComponent` bajo `authGuard` dentro del `AppShellComponent`, en `/inicio`.
      **`redirectTo: 'clientes'` intacto** (target actualizado respecto al `runs` original, ver nota
      de cierre arriba).
- [x] Item aditivo en `ITEMS_NAV` de `app-sidebar.ts` + su `.spec.ts`. Va **primero** en el orden del
      menú (es una home), aunque no sea la ruta por defecto.
- [x] **Test de aislamiento de los conteos:** dos tenants con datos distintos; los números de uno no
      incluyen nada del otro. Se calcula en el cliente, así que el test va contra los TRES endpoints
      que lo alimentan — ya cubiertos por piezas anteriores, con la misma forma de consulta (sin
      filtro) que usa el dashboard: `api/src/ideas.test.ts:176`, `api/src/app.test.ts:409`,
      `api/src/app.test.ts:578`. Confirmados en verde puntualmente en el cierre de esta etapa, no
      duplicados.
- [x] **Navegador** contra `npm run dev:server -w api`: ver la home con datos, con datos vacíos, y con
      la API caída (parar el `dev-server` y recargar). **En tema claro y oscuro.** Consola sin errores.
- [x] Confirmar que `/clientes` sigue siendo la puerta de entrada: entrar a `/` y verificar que
      redirige a Clientes, no a la home nueva.
- [x] `npm test` + `npm run typecheck` desde la raíz, `npm test -w portal`,
      `npm run test:components -w portal`, comparado con la línea base.
- [x] Auto-revisión adversarial, docs (`09`, `15`) actualizadas, cifras sincronizadas, pieza marcada en
      el [programa](2026-08-01-portal-agencia-programa.md).
- [x] **En el informe de cierre**, dos preguntas para Juan: (a) ¿la home pasa a ser la ruta por
      defecto, ahora que existe?; (b) ¿algún tile sobra o falta después de verla con datos reales?
      Ver `.superpowers/sdd/task-3-report.md`.

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| Se cambia la puerta de entrada y el recorrido de la demo arranca en otra pantalla | Regla explícita: `redirectTo` intacto + test de que `/` aterriza en Research |
| Se portan los widgets de la plantilla y la home muestra ventas y pedidos inventados | Fuera de alcance en el programa; regla "ningún tile con datos inventados" |
| La home duplica `/cartera` | Las métricas son de trabajo pendiente (ideas, briefs por aprobar), no de research |
| Un conteo se calcula por fuera de RLS y filtra entre tenants | Test de aislamiento de conteos, obligatorio |
| La home se cae entera porque un módulo falla | Cada bloque falla solo; los demás se siguen mostrando |
| Se empieza esta pieza antes de la 3 y no hay nada que medir | La dependencia está en la tabla del programa: 4 va después de 3 |
