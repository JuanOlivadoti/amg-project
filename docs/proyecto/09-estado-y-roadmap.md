# 9. Estado y roadmap

## Resumen ejecutivo

> **Dónde estamos, al 2026-08-07.** **Fase 2 está cerrada**: las cuatro piezas desplegadas y el
> circuito entero ejercitado en producción. Lo que sigue es **trabajo de producto**, y su orden vive
> en [**15-plan-plataforma.md**](15-plan-plataforma.md) — nueve bloques, con qué archivos toca cada
> uno y cómo se verifica.
>
> 🧭 **Nuevo (2026-08-18): el portal de Frank migró de `bigballs.es` a `app.dinamicseo.es`.** Mismo
> backend (Railway + Supabase) — cambió solo el dominio, y a un **subdominio** porque la raíz de
> `dinamicseo.es` la ocupa un WordPress del cliente que no se toca. `api.bigballs.es` →
> `api.dinamicseo.es`, mismo servicio de Railway con un Custom Domain nuevo. Único cambio de código:
> `apiBaseUrl` en `portal/src/environments/environment.prod.ts`. El corte se hizo con `CORS_ORIGINS`
> solapado (`bigballs.es` + `app.dinamicseo.es`) mientras se verificaba el dominio nuevo, y recién al
> final se sacó `bigballs.es` — dejar de servir el portal ahí fue intencional, no un accidente.
> Tropiezo real: `app.dinamicseo.es` se creó como hosting **PHP** en vez de **Node.js Web App**
> (`bigballs.es` sí lo es, con 152 builds automáticos por git), así que el primer build falló con
> `Missing script: "build:portal"` hasta corregir el campo de build command. Paso a paso completo,
> con el orden exacto del corte, en
> [`14-runbook-despliegue.md` § Migración de dominio](14-runbook-despliegue.md#migración-de-dominio-bigballses--appdinamicseoes-2026-08-18).
> Verificado en el navegador: login, research de Bella Napoli, consola sin errores.
>
> **`bigballs.es` (el hosting Node.js viejo) queda libre — decisión de Juan: se usa para un cliente
> final real**, no para el portal ni para una demo. No se tocó su configuración en Hostinger.
>
> 🧭 **Nuevo (2026-08-17): editor de carta en el portal, cerrado — el menú ya no se carga por
> SQL/seed.** Spec ([diseño](../superpowers/specs/2026-08-17-editor-menu-portal-design.md), revisado
> por Codex) y plan ([7 tasks](../superpowers/plans/2026-08-17-editor-menu-portal.md)) ejecutados con
> `superpowers:subagent-driven-development`. Dos endpoints nuevos, `GET`/`PATCH /clients/:id/menu`,
> sobre el `PgClientes` existente — **sin migración nueva**: el `grant update` sobre `clients` para
> `app_user` es de la `0001` y la política `client_write` ya cubría este caso, confirmado leyendo la
> `0021` (solo revocó `select`, nunca `update`). El PATCH reemplaza `menu` y `menu_categorias`
> COMPLETOS (las dos claves obligatorias, nunca "se conserva lo que había" por omisión), con
> `coalesce(business_profile, '{}'::jsonb)` para el cliente recién creado —sin él, el `||` de jsonb
> sobre `NULL` da `NULL` y el guardado se pierde en silencio, caso que tiene su propio test. El portal
> agrega el quinto tab de la ficha (`Menú`) con dos pantallas nuevas: lista (`/clientes/:id/menu`,
> categorías + platos agrupados, alta/borrado, borrado de categoría bloqueado en la UI si tiene
> platos) y detalle (`/clientes/:id/menu/:index`, el formulario completo — nombre, categoría, hasta 3
> precios, foto, video+poster, los 14 alérgenos, las 7 etiquetas dietéticas, nutrición). La identidad
> de un plato es su POSICIÓN en el array, no un id persistente: el índice `platos().length` significa
> "nuevo", y la pantalla de detalle vuelve a pedir el `GET` cada vez que se monta. **Solo
> `equipo`/`maestro` editan** — el rol `cliente` queda afuera a propósito, diferido, anotado junto a
> ADR-20/OBS-04 para cuando se retome (el mecanismo real es un trigger nuevo, porque
> `app.puede_escribir()` gobierna otras cuatro tablas y no se toca solo por esto).
>
> Un hallazgo real por tarea, encontrado por el ciclo de revisión de cada subagente, no por el plan:
> un commit de la Task 1 se coló con dos archivos ya staged de una sesión anterior (separado en dos
> commits limpios); el estado de error de la pantalla de lista quedaba pegado para siempre si un
> `guardarMenu` fallaba y la recarga de recuperación tenía éxito después (el catch seteaba el error
> pero nada lo limpiaba en el camino exitoso); una categoría nueva sin `orden` explícito se ordenaba
> primero en el editor pero al final en el sitio publicado (el editor trataba la ausencia como `0`, el
> renderer la trata como `Number.POSITIVE_INFINITY` — ahora coinciden); y un índice no entero en la
> URL de detalle (`/menu/1.5`, solo alcanzable a mano) reventaba en vez de mostrar "Plato no
> encontrado". Los cuatro, cerrados con test rojo→verde antes de aprobar la tarea. La Task 6 (el
> formulario, la pieza más grande) encontró además tres bugs de Angular en el propio código de
> referencia del brief — `[attr.name]` faltante en un `ngModel` dinámico, un `NumberValueAccessor` que
> emite `number|null` y no `string`, y un token de Tailwind inexistente— verificados uno por uno
> contra el diff antes de aprobarla.
>
> `npm run verificar`: **1538 tests del monorepo** + **291 `node:test`** y **176 Karma** en el portal,
> todos en verde.
>
> 🧭 **Nuevo (2026-08-12): pieza 3 (Ideas) del programa del portal, COMPLETA — quedan las cuatro
> piezas del programa hechas, salvo el Dashboard.** Las etapas 5-6 (las que faltaban: pantallas +
> rutas + cierre) sobre la rama `feature/modulo-ideas`, con `superpowers:subagent-driven-development`.
> El listado vive en `clientes/:id/ideas` (reemplaza el placeholder) filtrado por estado, y el detalle
> en `clientes/:id/ideas/:ideaId` — lectura completa (transcripción, análisis, adjuntos), edición
> inline de título/resumen/remitente, y aprobar/rechazar contra la máquina de estados real. Dos tasks,
> una con un hallazgo bloqueante real en la primera ronda de revisión: el test que decía atar la copia
> del portal de la máquina de transiciones a `db/src/ideas.ts` en realidad comparaba contra un objeto
> hardcodeado dentro del mismo archivo — nunca leía la base. Corregido con el mismo mecanismo de
> `codigos.test.ts` (import en runtime del archivo real) y verificado por mutación de verdad (se mutó
> `db/src/ideas.ts` a mano, se confirmó que el test cae, se revirtió). Portal: **265 tests** `node:test`
> (entonces, 262 pasaban y 3 caían por el bug de Windows en `import()` de ruta absoluta — **corregido
> del todo el 2026-08-13**, ver el bloque de abajo) + **136 Karma**. Verificado también en el
> navegador (API real sobre PGlite, MCP chrome-devtools):
> listar, filtrar, abrir, editar, aprobar, rechazar, transición inválida deshabilitada, claro y
> oscuro, consola sin errores propios. **El hueco explícito, documentado y no oculto:** el ingreso
> real de ideas (flujo de audio por n8n) sigue sin existir — las 5 ideas que se ven son el seed de
> ejemplo. Detalle en [Bloque J](15-plan-plataforma.md#bloque-j--el-programa-del-portal-piezas-3-ideas-y-4-dashboard).
>
> 🧭 **Nuevo (2026-08-13): la deuda no bloqueante que quedó abierta al cerrar la pieza 3, resuelta.**
> Eran tres cosas, las tres reales:
>
> 1. **`npm test` de la raíz estaba en rojo** (12 fallos: 4 en `db/src/cartera-portal.test.ts`, 8 en
>    `web-builder`'s paridad). Los 4 de `db` eran el MISMO bug que ya se había corregido en
>    `codigos.test.ts` e `ideas-transiciones.test.ts` — un `import()` con un path crudo de Windows en
>    vez de `pathToFileURL(...).href` — y no se había propagado a este tercer archivo. Corregido igual.
>    Los 8 de `web-builder` no eran del render: las fixtures de paridad (`.html`, comparadas byte a
>    byte contra el JSON-LD que emite Node, que siempre usa `\n`) se traían con `\r\n` al clonar en
>    Windows por `core.autocrlf=true` sin que ningún `.gitattributes` las excluyera. Arreglado con un
>    `.gitattributes` scoped a `web-builder/src/render/paridad/fixtures/*.html` (`text eol=lf`) — la
>    fixture que arreglé por accidente. **Con eso, `npm test --workspaces` dejó de cortar en rojo, y
>    por primera vez en esta máquina corrió la segunda mitad del comando (`&&
>    node --test scripts/*.test.mts`) — que reveló 2 fallos MÁS, enmascarados hasta ahora**: el mismo
>    bug de Windows, pero con `.pathname` en vez de `import()` crudo, en `scripts/contar-tests.test.mts`
>    (un `cwd` de `spawnSync`) y `scripts/paquetes.test.mts` (un `readFileSync`, daba
>    `C:\C:\Users\...`). Corregidos con `fileURLToPath`. **`npm test` de la raíz: 1395/1395, exit 0.**
> 2. **`scripts/verificar.sh` no corría en este Git Bash.** `mktemp -t nombre` sin una plantilla
>    `XXXXXX` es válido en Linux/macOS pero no acá — fallaba con "too few X's" y tiraba abajo las
>    secciones 3 y 4 (secretos, typecheck) con un `cannot open ''`. Arreglado agregando `.XXXXXX` a las
>    cuatro plantillas. `npm run verificar -- --con-portal` corre limpio de punta a punta: entorno,
>    arnés, secretos, typecheck, **1395 tests del monorepo, 265 del portal**.
> 3. **M3 de la revisión final de la pieza 3** (el vocabulario de estados de Ideas duplicado entre
>    `cliente-ideas.ts` y `cliente-idea-detalle.ts`). Extraído a `portal/src/app/core/ideas-estado.ts`
>    — `ESTADOS_IDEA`, `ETIQUETA_ESTADO_IDEA`, `claseEstadoIdea()` — que ambas pantallas importan.
>    `ESTADOS_IDEA` ya no es una tercera copia a mano: se deriva de `TRANSICIONES_IDEA`
>    (`ideas-transiciones.ts`), que ya está atada a `db/src/ideas.ts` por test.
>
> Con las tres cerradas, **el arnés (`npm run verificar`) da verde de punta a punta en esta máquina**
> por primera vez: **1395 tests del monorepo + 265 `node:test` del portal + 138 Karma**, typecheck y
> secretos limpios. Ningún fallo pendiente conocido.
>
> 🧭 **Nuevo (2026-08-13): pieza 4 (Dashboard) del programa del portal, COMPLETA — el programa entero
> queda cerrado.** Tres tasks sobre `feature/dashboard-home`. Task 1: `metricas.ts` (funciones puras:
> conteo de ideas por estado, clientes activos, briefs esperando aprobación, últimas ideas) +
> `listarTodasLasIdeas` (`GET /ideas` sin `clientId`) en `api-core.ts`. Task 2: la pantalla
> `InicioPage` (`portal/src/app/pages/inicio/inicio.ts`) — seis tiles (`app-stat-box`) + tabla de
> últimas ideas, alimentados por TRES fuentes independientes (ideas/clientes/runs) con fallas
> totalmente independientes entre sí. Task 3: ruta `/inicio` (`app.routes.ts`), ítem **primero** en
> `ITEMS_NAV` del sidebar, y cierre. **No hizo falta ningún endpoint ni migración nueva** — las tres
> fuentes ya existían de las piezas 1 y 3; se calcula todo en el cliente. **El test de aislamiento de
> los conteos ya estaba cubierto**, con la MISMA forma de consulta que usa el dashboard (sin filtro,
> la lista completa del tenant): `api/src/ideas.test.ts:176`, `api/src/app.test.ts:409` y
> `api/src/app.test.ts:578`, confirmados en verde puntualmente en vez de duplicados. Un drift resuelto
> con el usuario antes de tocar código: el plan escrito fijaba "`redirectTo: 'runs'` no se toca", pero
> ese route ya no existe desde el rediseño client-céntrico del 2026-08-11 — la regla real pasó a ser
> **"`redirectTo: 'clientes'` no se toca"**, y sigue así: `/` redirige a Clientes, no a la home nueva
> (confirmado en el navegador). Verificado en navegador (API real sobre PGlite, MCP chrome-devtools):
> datos reales con enlaces funcionando, el caso sin datos (los seis tiles muestran `0`, no un hueco en
> blanco — verificado interceptando la respuesta de red con la forma exacta que espera el cliente,
> `{ideas:[]}`/`{clientes:[]}`/`{runs:[]}`, ya que el seed de demo no trae un tenant vacío), la API
> caída (los tres bloques muestran su error, sin pantalla en blanco, solo los `ERR_CONNECTION_REFUSED`
> esperados en consola), y los dos temas. Portal (al integrar los tres tasks): 284 `node:test` + 142
> Karma. Root: sin regresiones. Tras el cierre: revisión final de rama con 2 bloqueantes reales
> (cifras de doc desincronizadas, un límite de producción de "5 filas" sin test) + 4 Minor, todos
> cerrados y reverificados por mutación — **APROBADA, mergeada a `main` el 2026-08-13**. Portal final:
> 282 `node:test` + 143 Karma.
>
> **La primera de las dos preguntas para Juan, respondida (2026-08-13): sí, `/inicio` pasa a ser la
> ruta por defecto.** `redirectTo: 'clientes'` → `'inicio'` en `app.routes.ts` (el `''` de la raíz del
> shell), y el post-login de `login.ts` actualizado igual — son dos decisiones sobre el mismo
> aterrizaje y `app.routes.test.ts` las ata para que no se desincronicen. El comodín `**` sigue en
> `clientes`, a propósito: es una decisión distinta (dónde cae una URL que no existe, no dónde abre el
> portal). Verificado en el navegador: `/` aterriza en `/inicio` con datos reales. **La segunda queda
> abierta:** ¿algún tile sobra o falta después de verla con datos reales? Detalle completo en
> `.superpowers/sdd/task-3-report.md`.
>
> El [programa del portal de la agencia](../superpowers/plans/2026-08-01-portal-agencia-programa.md)
> queda con sus **cuatro piezas completas**: **1 (CRM de clientes)**, **2 (usuarios)**, **3 (Ideas)** y
> **4 (Dashboard)**. Es el bloque **J** del plan, cerrado.
>
> 🧭 **Nuevo (2026-08-13): la revisión final de integración de la Pieza 4, cerrada.** La rama completa
> (tres tasks) volvió `CAMBIOS_PEDIDOS` con **2 bloqueantes**: las cifras de tests del portal
> desincronizadas en `08-testing-calidad.md`, y el límite real de 5 filas de "últimas ideas"
> (`inicio.ts:147`) sin ningún test que lo distinguiera de otro número — el único test con datos
> entraba con exactamente 5 ideas. Agrupados en el mismo commit, 4 hallazgos Minor: se borró
> `calcularMetricas` (código muerto con un docblock que mentía sobre ser "lo único que la pantalla
> necesita llamar") y sus dos tests, se borraron los tres signals `cargandoIdeas`/`cargandoClientes`/
> `cargandoRuns` (write-only, nadie los leía), se agregó el caso simétrico "clientes falla" a
> `inicio.spec.ts`, y se agregó el guardarraíl de que `inicio` es hija del shell en
> `app.routes.test.ts`. El Minor del `throw` de `contarIdeasPorEstado` dentro de un `computed` sin
> `try/catch` queda **documentado y aceptado**, no arreglado: `idea_estado` es un enum de Postgres de
> 4 valores, así que hoy es inalcanzable. Portal, tras el fix: **282 `node:test`** (284 − 2 de
> `calcularMetricas`) **+ 143 Karma** (142 + 1, el caso "clientes falla"). Root: 1395/1395, sin
> regresiones.
>
> 🧭 **Nuevo (2026-08-15): Bloque F — módulo de reseñas de Google, fase 1 (monitoreo + alerta),
> COMPLETO.** Spec ([diseño](../superpowers/specs/2026-08-13-modulo-resenas-google-design.md)) y plan
> ([8 tasks](../superpowers/plans/2026-08-13-modulo-resenas-google.md)) ejecutados con
> `superpowers:subagent-driven-development` sobre `feature/resenas-google`. Conexión OAuth por
> cliente (el `refresh_token` vive en `clients`, escribible pero **no legible** por `app_user` —
> grant por columna, migración `0021`), polling periódico cross-tenant vía un rol sin login
> (`app_resenas`, dos funciones `security definer`, mismo molde que `app_barrido`, migración `0022`),
> y el tab `/clientes/:id/resenas` real (los cuatro estados: sin conectar, conectado sin reseñas, con
> reseñas —1-3★ sin ver primero—, error). **Mock-first de punta a punta**: ni el polling
> (`GoogleReviewsProvider`) ni el intercambio OAuth (`GoogleOAuthProvider`) hablan con Google de
> verdad todavía — `GOOGLE_REVIEWS_MODO=live` lanza un error explícito, a propósito (AMG no pidió
> acceso a la Business Profile API). Sin borrador de IA ni publicación de respuestas: eso es la fase 2
> del bloque, y el PRD ya exige que las reseñas negativas las redacte siempre un humano.
>
> Tres tasks (1, 2 y 5) encontraron y corrigieron bugs de seguridad reales en el SQL que el propio
> plan proponía, los tres verificados por mutación real y confirmados de forma independiente por el
> `revisor`: un `revoke select` por columna que no angosta un `grant` de tabla ya concedido (`app_user`
> y, señalado para la `0022`, también `app_service`, tenían SELECT de tabla sobre `clients` desde
> antes de este bloque); políticas RLS de `resenas_google` sin `tenant_id = app.current_tenant_id()`
> (cualquier staff de cualquier tenant habría visto las reseñas de todos los demás); y el hallazgo más
> serio, encontrado manejando la app en un navegador real y no solo con tests: el callback OAuth
> (`GET /clients/:id/google/callback`) vivía detrás del middleware de autenticación global, pero lo
> pega una navegación anónima del navegador que nunca lleva el header `Authorization` — el flujo
> estaba roto de punta a punta, incluso en mock. Cerrado moviendo el callback fuera de `autenticar()`
> (mismo lugar que `/health`) y firmando el `state` con HMAC-SHA256 (`OAUTH_STATE_SECRET`, obligatorio
> en producción, catálogo de credenciales sincronizado) para que la identidad de quien conecta viaje
> sin depender de un header que una navegación anónima no puede llevar; RLS queda como segunda capa
> de defensa independiente.
>
> Verificado en el navegador (API real sobre PGlite, MCP chrome-devtools): el flujo completo de
> conexión —botón → mock → callback → escritura bajo RLS → redirect de vuelta al tab— funcionando de
> punta a punta y **persistiendo tras un refresh** (no una actualización optimista en memoria); rol
> `cliente` con acceso de solo lectura (ve la conexión, no el botón); claro y oscuro; consola limpia.
> `db` 352/352, `api` 211/211, `orchestrator` 92/92, `scripts` 95/95, portal 288 `node:test` + 152
> Karma. Root completo (`npm run verificar`): 1473 tests, typecheck limpio, sin secretos.
>
> **Deuda anotada, no bloqueante**: el `nonce` del `state` no se invalida tras el primer uso (sin
> tabla de nonces, la única defensa contra un `state` filtrado es la ventana de 10 minutos) — cerrarlo
> del todo exige una migración, y queda para si hace falta. Migraciones `0021`/`0022` **todavía no
> desplegadas a producción** (✅ desplegadas el 2026-08-18, junto con la `0023` — ver la fila
> "Migraciones" más abajo; el bloqueo fue un bug de `migrate:deploy` en Windows, no algo de esta
> pieza).
>
> 🧭 **La navegación del portal es cliente-céntrica desde el 2026-08-11**
> ([spec](../superpowers/specs/2026-08-11-ficha-cliente-navegacion-design.md) ·
> [plan](../superpowers/plans/2026-08-11-ficha-cliente-navegacion.md)). `/clientes/:id` dejó de ser una
> pantalla y es un **shell** con cuatro tabs como rutas hijas —Perfil · Research · Reseñas · Ideas—;
> las tres pantallas de un run cuelgan de `/clientes/:id/research/:runId/*`; Research salió del
> sidebar (quedan tres ítems) y la home pasó de `/runs` a `/clientes`; y se retiró `/clientes/:id/ver`
> con sus tres tabs de datos inventados. Lo que lo motivó: **el formulario de lanzar research pedía
> el uuid del cliente pegado a mano**. Reseñas era, a esa fecha, un placeholder que decía qué falta
> (el bloque **F**) — dejó de serlo el 2026-08-15 (ver el bloque de arriba); Ideas dejó de serlo el
> 2026-08-12.
>
> 🧭 **Nuevo (2026-08-16): el menú digital se enriquece con video, alérgenos, etiquetas dietéticas,
> nutrición y comensales.** Spec
> ([diseño](../superpowers/specs/2026-08-14-menu-digital-enriquecido-design.md)) y plan
> ([7 tasks](../superpowers/plans/2026-08-14-menu-digital-enriquecido.md)) ejecutados con
> `superpowers:subagent-driven-development` sobre `feature/menu-digital-enriquecido`. `MenuItem` gana
> `video` (autoalojado, allowlist de hosts propia — mismo criterio que las fotos), `alergenos` (los 14
> del Reglamento UE 1169/2011, taxonomía fija), `etiquetas` (7 dietéticas), `nutricion` (calorías +
> macros de la ración de referencia) y `precios[].comensales` — cruzando las **cuatro fronteras** del
> sistema (Zod, allowlist de Postgres, `perfilValido`, render) para que ningún campo se filtre en
> silencio. Migración **`0023`**. **Sin editor en el portal en esta etapa**: el menú se sigue cargando
> por SQL/seed, decisión tomada a propósito para no agrandar el alcance.
>
> Dos hallazgos reales que el propio proceso de revisión encontró y corrigió, no del plan sino del
> brief o de la primera pasada de implementación: un `nullif` en `app.video_publico` que no anulaba un
> video sin `src` cuando traía `poster` (el objeto no quedaba `{}`), corregido condicionando
> explícitamente sobre la presencia de `src` y verificado por mutación; y el presupuesto de video
> (`PresupuestoVideos`, tope 10 por documento) que quedó cableado sin ningún test que lo sujetara en la
> primera pasada de la pieza de render — dos tests nuevos lo cierran (el tope se aplica en el HTML, dos
> renders del mismo documento no comparten cupo), encontrados por el mismo mecanismo que ya protege a
> las fotos (`imagenes.test.ts`). El `<video>` de cada plato reemplaza a la foto cuando el plato tiene
> los dos, nunca autoplay (`controls preload="none"`), y su `poster` consume también el presupuesto de
> imágenes del documento — es una petición real del navegador del visitante, igual que un `<img>`, y
> antes no lo hacía.
>
> ✅ **Verificación en navegador (C6 de `CHECKPOINTS.md`), cerrada.** El primer intento quedó bloqueado
> por el entorno (`chrome-devtools-mcp` con el perfil de Chrome trabado por una instancia huérfana de
> automatización de una sesión anterior); se identificó el proceso exacto por línea de comandos, y una
> vez liberado se manejó el sitio real (`renderMenu()` con un perfil de prueba: video, alérgenos,
> etiquetas, nutrición, comensales). **Y encontró lo que los tests no podían ver, otra vez**: a 390px
> había desborde horizontal real (`scrollWidth` 534px contra 390px de viewport). La causa no era la
> sospechada al diseñar el fix (`.precios` sin achicarse) sino una más profunda: `.p-cartaCategorias
> .platos li` es un ítem de una grilla (`display:grid`) con `min-width:auto` por defecto — su propio
> min-content —, así que la COLUMNA entera se estiraba al ancho del plato más ancho y arrastraba consigo
> a los platos sin `comensales`. Dos rondas de fix por subagentes redujeron el desborde (144px → 61px)
> sin cerrarlo; la causa raíz se diagnosticó con medición en vivo (`getComputedStyle`,
> `gridTemplateColumns` pasando de 431px a 350px) y el fix final lo hizo la sesión principal
> directamente, porque exigía interacción real con el navegador. Confirmado: cero elementos exceden el
> viewport a 390px, controles nativos del `<video>` usables a 160×120px (subido desde 72×72, que no
> alcanzaba), `aria-label` del poster presente, `<details>` de nutrición operable por teclado, contraste
> en oscuro medido entre 6.05:1 y 7.18:1 (todos sobre AA), consola limpia. `web-builder`: 419/419. `db`:
> 358/358 (incluye el ajuste de independencia de orden de `fotos-publicas.test.ts`, que ahora generaliza
> a una lista las migraciones que redefinen `app.nap_publico` — antes solo conocía la `0020`, ahora
> también la `0023`). `renderer/src/perfil.test.ts`: 41/41; `tres-fronteras.test.ts` (el checkpoint que
> dependía de esta pieza) cerró en verde. Root (`npm run verificar`, esta corrida): **1520 tests,
> typecheck limpio, sin secretos**.
>
> La revisión final de la rama completa (agente `revisor`) devolvió un solo bloqueante —justamente esta
> verificación en navegador, sin cumplir todavía en ese momento— y un hallazgo Important real: un video
> que no llega a emitirse por falta de cupo (`PresupuestoVideos` agotado) igual gastaba un hueco del
> presupuesto de imágenes para su `poster`, una fuga silenciosa medida con un script (12 platos con
> video, 10 emitidos, 12 huecos de imagen consumidos). Corregido comprobando los dos presupuestos ANTES
> de gastar cualquiera de los dos, con test que mutación-verifica el escenario exacto. Los dos quedan
> cerrados y re-revisados en verde.
>
> 📓 **La historia está en [`progress/history.md`](../../progress/history.md)**: qué se hizo cada día,
> con sus tropiezos y sus lecciones. Acá vive solo el estado de hoy y lo que falta — si buscás *por
> qué* algo terminó como terminó, es allá.

**La cadena completa está construida, de punta a punta y sin huecos:**

```
  prompt  →  research (M2)  →  persistencia bajo RLS  →  COMPUERTA HUMANA  →
          →  contenido (M1)  →  publicación en Storyblok  →  web servida en vivo
```

Todo lo que depende de IA es real (seeds, intención, relevancia, clustering semántico, contenido
on-page, prose final). Todo lo que depende de aislamiento entre clientes lo impone **Postgres**, no
el código de la aplicación. Y las tres interfaces por las que pasa un humano —la API, el portal y la
web pública del cliente— **existen y se manejaron en un navegador real**.

**Qué está desplegado.** Fase 1, desde el 2026-07-25: el portal en [`bigballs.es`](https://bigballs.es)
(Hostinger, autodeploy desde `main`), la API en `api.bigballs.es` (Railway, `europe-west4`) y la base
con RLS forzada en Supabase (`eu-west-2`). De Fase 2, el **renderizador** desde el 2026-08-01
([`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app), Railway,
servicio aparte): la web del cliente se sirve desde internet.

> ✅✅ **El circuito entero corrió en producción el 2026-08-07, y es lo último que no se había probado
> nunca.** Un research lanzado desde el portal recorrió `POST /runs` → Inngest → orquestador →
> `kr-service` → Postgres → informe → `pending_approval`: **124 keywords, 25 páginas, 1 informe,
> $0.00**, en menos de diez segundos, con los providers en mock. Verificado en la base **y en la
> pantalla**. Hasta ese día todo lo que había en Supabase estaba sembrado a mano.
>
> 🚀 **El orquestador está DESPLEGADO desde el 2026-08-07**, y con él **las cuatro piezas de Fase 2
> están en producción**. `amg-orchestrator-production.up.railway.app` responde
> `{"ok":true,"funciones":1,"modo":"cloud","pipeline":"mock"}` y su app quedó **sincronizada con
> Inngest** (`{"message":"Successfully registered","modified":true}`) — que es, de paso, la prueba de
> que `INNGEST_SIGNING_KEY` funciona: para registrarse, el SDK tuvo que autenticarse contra Inngest.
> Los dos flags del portal (`lanzarResearch`, `aprobarRun`), apagados toda la Fase 1 porque "no había
> orquestador detrás", se encendieron ese día.

**Qué falta para cerrar Fase 2:** el **dominio propio del cliente** —el plan de Railway está en su
límite de custom domains— y una **CDN** delante del renderizador. El detalle, ordenado por lo que
realmente bloquea, en [Lo que queda por delante](#lo-que-queda-por-delante).

**Las cuatro variables que el despliegue del orquestador volvió obligatorias**, y sin las cuales los
procesos ya no arrancan: `INNGEST_EVENT_KEY` (api), y `INNGEST_SIGNING_KEY`,
`DATABASE_URL_ORQUESTADOR`/`DATABASE_URL_CACHE` y **`PIPELINE_MODO`** (orquestador). La última cierra
el fallo silencioso de los providers: `mock` o `live`, **sin default**, y el arranque aborta si
contradice a `DATAFORSEO_MODE` en cualquiera de las dos direcciones —research inventado presentado
como real, o gasto en un despliegue anotado como gratuito—.

> 📓 **Cómo se llegó ahí** (histórico, ya cerrado): el trabajo se partió en dos tramos, y preparar el
> despliegue en vez de darlo por trivial destapó que **`POST /runs` estaba roto en producción** desde
> que la API vive en Railway —el SDK de Inngest lanza sin `INNGEST_EVENT_KEY` en modo cloud— y que
> cada intento dejaba un **run huérfano** en `running`, porque la fila se crea antes de emitir
> (ADR-18). El relato completo, en [`progress/history.md`](../../progress/history.md); el
> procedimiento, en el
> [runbook](14-runbook-despliegue.md#desplegar-el-orquestador-fase-2--la-última-pieza).

| | |
|---|---|
| **Paquetes** | 7 workspaces (`contrato`, `db`, `kr-service`, `web-builder`, `orchestrator`, `api`, `renderer`) + `portal/` (Angular, fuera del monorepo a propósito) |
| **Tests** | **2005** — 1538 en el monorepo (7 paquetes + `scripts/`, corrida propia de `npm run verificar`) + **467 en el portal** (291 `node:test` + 176 Karma). Subió con el editor de carta en el portal (2026-08-17): +6 en `web-builder/src/contract.test.ts` (el Zod exportado + `menuPatchSchema`), +5 en `db/src/clientes.test.ts` (`obtenerMenu`/`actualizarMenu`), +7 en `api/src/app.test.ts` (los dos endpoints + el test de equivalencia) — 18 en el monorepo —, y en el portal +3 en `api-core.test.ts`, +2 en `menu-taxonomia.spec.ts`, +10 en `cliente-menu.spec.ts` y +10 en `cliente-menu-detalle.spec.ts` (Karma) — 25 ahí. Antes, subió con el menú digital enriquecido (video, alérgenos, etiquetas, nutrición, comensales — 2026-08-16): +5 en `web-builder/src/contract.test.ts` (Zod), +10 en `web-builder/src/render/videos.test.ts` (seguridad del video), +6 en `db/src/menu-enriquecido-publico.test.ts` (allowlist de Postgres, migración `0023`), +6 en `renderer/src/perfil.test.ts`, +17 en `web-builder/src/render/piezas/piezas-foto.test.ts` (render de la carta, incluidos los del presupuesto de video y del tope de alérgenos/etiquetas que agregó la revisión final de rama). Antes, subió con el Bloque F (reseñas de Google, fase 1: monitoreo + alerta, ocho tasks + el fix del callback OAuth firmado, 2026-08-15) — tests nuevos de RLS/credenciales en `db`, del `state` firmado y la conexión OAuth en `api`, del polling en `orchestrator`, y de `api-core.ts`/`cliente-resenas.spec.ts` en el portal. Subió 25 el **2026-08-11** con la navegación cliente-céntrica, y el saldo esconde un movimiento mayor: se **borraron** los specs de `/clientes/:id/ver` y de su mock al retirar la pantalla, y entraron los de los cuatro tabs, la conciliación cliente↔run, el destino post-login y **dos barridos nuevos** (`marca-activa`, que caza la clase de `routerLinkActive` que pierde la cascada; y `arbol-encabezados`, que impone contenedor-sin-`h1` / hoja-con-`h1`). Los dos barridos **descubren** las plantillas en vez de enumerarlas, así que cubren las pantallas que se agreguen. Los de seguridad, contra Postgres real. Cubre los bloques A (**A4 incluido**), B y **C entero**, el **bloque E completo** (entregas 1, 2 y 3), las **etapas 1-4 del bloque J** (Ideas) y el **bloque K entero** — el rediseño de la plantilla base, sus tres etapas (venía de 1199 → … → 1712 → 1716 → 1731 → 1739). El portal, con `-- --con-portal` y Karma aparte. ✅ **La cifra del 2026-08-10 (noche) es una corrida de `npm run verificar` en verde entero**, con el gate de paridad **re-capturado** tras medir que no se perdía nada (cero palabras, `href`, `id`, JSON-LD ni trazas en los diez casos) y con el sitio **manejado en un navegador** a 1440 y a 390. |
| **Migraciones** | **23 en `main`, las 23 aplicadas en producción** (al día desde el **2026-08-18**). Las `0021`/`0022` (Bloque F: tabla `resenas_google` + columnas de conexión en `clients`, y el rol cross-tenant `app_resenas` del polling, 2026-08-15) y la `0023` (menú digital enriquecido: `video`/`alergenos`/`etiquetas`/`nutricion`/`comensales` en `app.nap_publico`, 2026-08-16) quedaron represadas por un bug real de `migrate:deploy` en Windows: `checksumDe()` (`db/src/deploy.ts`) hasheaba el contenido crudo del archivo, y `core.autocrlf=true` (el default de git ahí) escribe `db/migrations/` en disco con CRLF mientras el checksum registrado en Supabase se calculó en LF — incluso sin que nadie hubiera editado una línea, el runner veía "la `0001` cambió después de aplicada" y abortaba **antes** de mirar ninguna migración pendiente. Confirmado leyendo el registro real: el checksum de producción coincidía EXACTO con el commit `bf3d1f7` de `0001_init.sql` normalizado a LF. Arreglado normalizando `\r\n` a `\n` antes de hashear; verificado por mutación. Corrido `migrate:deploy` de nuevo, las tres se aplicaron en el mismo lote. La `0013` (Ideas) y la `0020` (las tres secciones de plantilla) se aplicaron el **2026-08-10 por la noche** con `npm run migrate:deploy -w db`, y con eso **producción fue al día por primera vez desde el 2026-08-08** (hasta la `0020`). Las dos corrieron contra una base que ya tenía la `0014`-`0019`, que es exactamente el escenario "al final" que modela el test de orden de la `0013`; la `0020` corrió después de la `0014`, que era su única dependencia real. La próxima libre es la **`0024`**. ⚠️ **La `0020` (y ahora también la `0023`) reemplazan `app.nap_publico`, así que la `0014` ya no puede aplicarse después de ninguna de las dos**: sería reponer la allowlist vieja y perder `bienvenida`, `destacados` y `testimonios` en silencio. Nadie produce ese orden —`migrarConRegistro` aplica las pendientes **ordenadas**— y el test de independencia de orden se reescribió para modelar el real. La lección, que vale para la próxima que reemplace una función: **una migración solo se puede reordenar contra las que no tocan lo mismo que ella.** **Historial de tropiezos que siguen valiendo:** la `0014` aplicó en la posición que su test predecía —entre la `0012` y la `0015`, no al final— y **el `grant` sobrevivió al `drop column`**, verificado donde importa: el renderizador sirve «La Birra Bar» con las dos direcciones del footer, y ese dato solo puede venir de `business_profile_publico`. **Desde el 2026-08-10 ese sitio ya no responde en `amg-renderer-production.up.railway.app`**, sino en `birrabar.bigballs.es`: la URL del servicio se estaba usando como dominio de cliente, y ahí el sitio era **indexable** (el `noindex` cubre `*.bigballs.es`, no el dominio de Railway). **El primer intento de la `0018` falló** (`must be able to SET ROLE "app_barrido"`) y se revirtió sola: en PGlite el rol que migra es superusuario y en Supabase alojado no, así que `alter … owner to` exigía dos permisos que nadie había concedido. Arreglado y con un test que aplica esa migración **como rol no-superusuario** — sin él, la clase entera volvería a escaparse |
| **ADRs** | 24 (la `ADR-24`, membresías escribibles bajo RLS, aceptada el 2026-08-02), más 4 observaciones — 3 cerradas y **`OBS-04` abierta** (quién edita la web no lo gobierna nuestro RBAC; bloquea reescribir ADR-11) |
| **Reviews externas** | **15 rondas** (Codex), **21 tandas** de correcciones — la 13ª fue la primera sobre el arnés `.claude/`, la 14ª la primera sobre un **documento de diseño** (la spec de KR-2) y la 15ª la primera **híbrida** (código + el plan de la plataforma). El detalle, tanda por tanda, en [08-testing-calidad.md](08-testing-calidad.md#revisiones-externas-codex--qué-encontraron-y-qué-se-corrigió) |
| **Corre sin credenciales** | Sí — providers mock + PGlite en memoria |

## Qué funciona hoy

| | |
|---|---|
| ✅ | Pipeline M2 completo: prompt → brief SEO validado + informe legible. |
| ✅ | Pipeline M1 completo: brief → stories Storyblok + preview HTML con JSON-LD válido. |
| ✅ | Providers abstractos: todo corre **sin credenciales** en modo mock. |
| ✅ | Compuerta de aprobación humana (global + por página), **operable desde el portal** — ya no se edita un JSON a mano. |
| ✅ | **API REST autenticada** (Hono): JWT verificado, RLS decide, comandos compuestos (fila primero, evento después). |
| ✅ | **Portal Angular**: login, lista de research, brief **separado por evidencia**, compuerta doble, refresh de token. |
| ✅ | **La web del cliente se sirve en vivo** (`renderer/`): 1 servicio, N dominios, con preview firmado para el Visual Editor. |
| ✅ | **Research real contra DataForSEO producción**: 52 keywords → 8 páginas, **$0.31 por research**. |
| ✅ | **8 páginas publicadas en vivo en Storyblok**, con contenido redactado por IA. |
| ✅ | JSON-LD validado en el Rich Results Test de Google (`LocalBusiness` + `FAQPage`, sin errores). |
| ✅ | **Costo completo del research** (DataForSEO + LLM) con desglose, y **presupuesto preflight** que aborta antes de gastar. |
| ✅ | **Resiliencia**: timeouts, reintentos con backoff y `Retry-After` — **probados contra un 429 real de Storyblok**. |
| ✅ | **Idempotencia**: republicar produce los mismos `story:` IDs, cero duplicados. Verificado en vivo. |
| ✅ | **1538 tests en verde** (+467 en el portal: 291 `node:test` + 176 Karma) + typecheck limpio en los 7 paquetes. Los de seguridad, contra Postgres real. |
| ✅ | **El orquestador, desplegado** (2026-08-07): Railway + Inngest Cloud, app sincronizada, `/_health` en 200 con `modo:cloud` y `pipeline:mock`. Con él, **las cuatro piezas de Fase 2 están en producción**. |
| ✅ | **`/_health` del orquestador ya no miente sobre Postgres** (2026-08-07): comprueba la base **por el mismo `Tx` y el mismo `set local role app_service`** que hace el trabajo real —un `select 1` pelado habría probado el TCP y no ADR-17—, sigue en **200** para que Railway no reinicie en bucle, y nombra lo caído en `degradado` **escribiéndolo también en el log, una vez por transición**. Reproducido el incidente que lo motivó: con el host `base`, `degradado:["postgres"]` y una sola línea `getaddrinfo ENOTFOUND base`. |
| ✅ | **Un run ya no se queda en `running` para siempre** (2026-08-07, migración `0018` **sin desplegar**): `finishRun` pasó a compare-and-set —no resucita lo que el barrido mate— y hay una función programada cada hora que expira los runs de **todos los tenants** vía una `security definer` con rol propio (`app_barrido`), cuyo permiso cross-tenant es una política auditable y no un privilegio implícito del dueño. |
| ✅ | **El vocabulario de `kr_pages` lo impone la base** (`0017`): `tipo`, `intencion`, `page_strategy` y `evidencia` con `check` contra el contrato, atado por test a `emisionM2` para que las dos copias no puedan divergir en silencio. |
| ✅ | **El dashboard y el brief no pueden divergir en silencio**: un test ata las 14 páginas de `cartera-mock.ts` (portal) a `PAGINAS_DEMO` (seed), campo por campo y en orden. Estar fuera del monorepo impedía importar el paquete, no leer el archivo. |
| ✅ | **Un solo cliente en toda la demo**: el dashboard, el brief y la web hablan de **La Birra Bar**, y el perfil del seed está **atado por test** al que se publica (`web-builder/business-profile.json`). |
| ✅ | **Navegación fija del sitio del cliente**: barra de 4 secciones (Inicio/Menú/Ubicaciones/Contacto, condicionales), footer compartido con NAP multi-local, `/menu` y `/blog` sintetizados. Datos reales de **La Birra Bar** cargados (dos locales, carta). Verificado en el navegador. |
| ✅ | **Quince reviews externas (Codex): todos los hallazgos, procesados** — corregidos, o refutados con argumento. Varias de las brechas eran suposiciones MÍAS que Postgres no cumplía, o afirmaciones de seguridad **falsas** que documenté y el código desmentía. Las últimas cazaron cosas que yo había declarado hechas: el CLI de producción sin registro de idempotencia, un verificador de JWT que **ningún test tocaba**, carreras asincrónicas en el portal, una allowlist de Postgres que restringía el **nombre** de la clave pero no la **forma** del valor, y **siete afirmaciones de la propia documentación que el despliegue había dejado falsas**. Ver [ADR-13..23 y el registro de correcciones](../decisiones-arquitectura.md). |
| ✅ | **Gestión de clientes (CRM) en el portal — pieza 1 de 4, mergeada a `main` el 2026-08-01.** Listado, alta, perfil editable y vista con datos de ejemplo, sobre Postgres/RLS. La revisión final de la rama encontró y cerró una fuga real (el rol `cliente` podía leer notas internas de la agencia sobre sí mismo) antes de cerrar la pieza. Detalle arriba y en [11-plan-fase-2.md](11-plan-fase-2.md). |

## Próximos pasos

*Actualizado 2026-08-01, tras re-sembrar producción. El paso operativo que quedaba (0) **está hecho**;
lo que sigue no es código de la demo, y apareció un pendiente nuevo que sí es de despliegue (0.b).*

0. **✅ Producción re-sembrada** (2026-08-01, con `npm run reseed:demo`). Verificado por consulta
   contra Supabase, no por el "✔" del comando:

   | | |
   |---|---|
   | Clientes | **1**: La Birra Bar. El italiano **ya no está** — el id fijo lo reemplazó en su lugar, no dejó los dos |
   | Páginas | **14**: 8 `datos_mercado` (todas con volumen) + 6 `sin_validar` (ninguna con volumen), **0 aprobadas** — la compuerta la cruza Frank en vivo |
   | Run | `pending_approval`, `kr.v0.5`, coste 309 700 micros (\$0.3097) |
   | Perfil | 2 locales y 4 items de carta en `business_profile` |
   | Membresías | Frank `maestro`, Juan `equipo`, las dos con `client_id` NULL |
   | `app_metadata` | **Ya estaba bien**: el `tenant_id` de los dos usuarios coincide con el tenant sembrado y el `rol` con `memberships`. No hubo que tocar Supabase Auth (el tenant se upsertó por slug, así que el UUID no cambió) |

0.b **✅ La migración `0010`, aplicada a producción** (2026-08-01, `npm run migrate:deploy -w db`).
   El re-seed **no la necesitaba** —sembró los 14 registros sin problema— pero sí cambiaba lo que el
   renderizador podrá leer: `business_profile_publico` exponía solo `brand, name, priceRange`, así que
   **`locations` y `menu` se filtraban en silencio** aunque el perfil sembrado los tuviera. No rompía
   nada *en ese momento* (el renderizador todavía no estaba desplegado y el portal no lee esa
   columna), y **esa misma tarde se desplegó el renderizador**: sin la `0010`, la web habría salido
   con el footer sin locales y `/menu` en 404 — el fallo que la migración existe para arreglar, y que
   **no da error**. Se adelantó por si acaso, y el "por si acaso" llegó a las pocas horas.

   Se aplicó con `db/.env` recién sincronizado desde la fuente única (`npm run env:sync`), porque el
   CLI lo lee y es un archivo generado. **Verificado por consulta, no por el "✔"**:

   | | |
   |---|---|
   | Registro | las **10** migraciones (`0001`..`0010`) |
   | Allowlist efectiva | `brand, locations, menu, name, priceRange` (antes: `brand, name, priceRange`) |
   | Datos que ahora sobreviven | **2 locales** y **4 items de carta** |

0.c **✅ El re-seed, verificado también EN EL PORTAL** (2026-08-01, después de la consulta a la base).
   Consultar Supabase prueba que las filas están bien, no que el recorrido de la demo cierre — y esa
   distinción ya costó tres días una vez. Manejando `bigballs.es` con sesión real: los **14 slugs del
   brief coinciden uno a uno, y en el mismo orden**, con las keywords que grafica el dashboard; el
   split 8/6 y los `n/d` se ven donde deben; consola limpia en las tres pantallas.

   > **Lo que esta verificación destapó, y la consulta a la base no podía ver.** Entre la primera
   > siembra (11:55) y `f0c1387` (12:07) pasaron doce minutos, así que la primera corrida sembró los
   > **slugs inventados**: en producción, Cartera y Research mostraban **las mismas métricas con
   > nombres distintos** —"cerveza Ale Ogham Madrid — 74" contra "hamburgueseria barrio salamanca —
   > 74"—, a dos clics de distancia. El re-seed desde `HEAD` lo cerró, y ahora un test impide que
   > vuelva a pasar (ver `db/src/cartera-portal.test.ts` en «Qué funciona hoy»).

0.d ✅ **HECHO el 2026-08-07 — la `0017` y el re-seed, en ese orden.** Eran **dos pasos, no uno**, y el
   segundo no era opcional. **Verificado por consulta contra la base**, no por el "✔" de los comandos:
   15 migraciones (última `0017_vocabulario_kr_pages.sql`), los **cuatro `check`** presentes, el
   vocabulario de las filas ya en el del contrato (`hub_spoke`, `commercial`…), y las **14/14 páginas**
   con `seo.meta_title`, `seo.canonical` y `content_brief.h1` — con **cero** rastros del `seo.title`
   viejo. 0 aprobadas, que es lo correcto (ADR-06). Lo que se hizo:

   1. `npm run migrate:deploy -w db` — aplica la `0017`. Repara las 14 filas de la demo, que hoy tienen
      `page_strategy = 'hub'/'spoke'` e `intencion` en español, y recién entonces les pone los cuatro
      `check`. Si alguna fila tuviera un valor que el mapeo no cubre, la migración **se revierte entera
      y el despliegue se detiene** con el nombre de la constraint violada: es lo que queremos: falla
      ruidosa, no traducción inventada.
   2. `npm run reseed:demo` — **la migración NO arregla los dos `jsonb`.** `seo` sigue siendo
      `{title, description}` y `content_brief` sigue siendo `{schema_type}` en las filas ya escritas, y
      reconstruirlos exigiría inventar `schema_type`, `h1` y `word_count_objetivo` — un dato inventado
      en una migración es peor que uno incompleto. **Sin este segundo paso el brief de producción sigue
      sin pasar `parseBrief`**, aunque el vocabulario ya esté bien.

   El orden importa: primero migrar, después sembrar. El CLI de seed **no corre migraciones**, y
   `sembrarDemo` escribe contra los `check` que la `0017` acaba de crear.

1. **Mostrarle la demo a Frank.** Depende de Juan, no de código. Tres cosas que conviene tener
   decididas antes, porque son del guion y no del software (ninguna bloquea, todas se notan):
   - **La puerta de entrada es `/clientes`, no el dashboard** (`app.routes.ts` redirige `''` a
     `clientes`): el recorrido empieza en la cartera, se entra a la ficha de un cliente y de ahí a su
     research. _(Decía `/runs` hasta el 2026-08-11, cuando la navegación se volvió cliente-céntrica:
     Research dejó el sidebar y el research pasó a ser un tab de la ficha.)_
   - **`aprobarRun` está apagado en producción** (decisión de Fase 1: no hay orquestador detrás), así
     que el cierre del ciclo —"aprobar y publicar"— **no se puede mostrar en `bigballs.es`**. O se
     enseña en local, o se narra.
   - **La web del cliente ya está en internet** (2026-08-01):
     `amg-renderer-production.up.railway.app`. El salto "esto es lo que se publica" dejó de ser un
     `localhost`. **Sigue sin haber un link desde el portal** —eso es código y no se tocó antes de la
     demo—, así que el salto es cambiar de pestaña, pero a una URL real.
   - **El dashboard sigue siendo una maqueta**: los KPIs y la serie de coste incluyen cinco clientes
     de muestra. La fila y las keywords de La Birra Bar sí son reales.
2. **Módulo 3 — respondedor de reseñas de Google (GBP).** Lo único del alcance base (OBS-01) sin
   ni una línea escrita. Es la pieza de producto más grande que falta.
3. **🟠 La demo del módulo de Keyword Research** — decidida el 2026-08-01. Las **tres mejoras de
   calidad** están **implementadas** (2026-08-02): `is_local` por map pack del SERP,
   `score_confidence` ordenando, y el volumen normalizado por percentil con winsorización. Queda
   **regenerar el dataset crudo** (~$0.31, decide Juan — el destino ya es durable), llevar el
   **informe legible al portal**, y que el orden nuevo **llegue al portal**, que hoy lo deshace.
   Guion de dos niveles: entregable primero, pipeline después. Detalle en
   [§2.b](#-2b-la-demo-del-módulo-de-keyword-research-decidido-2026-08-01).
   *(Hub & spoke y el enlazado interno vacío siguen fuera de la demo: ver la tabla de mejoras.)*
4. **Desplegar la Fase 2** — **el renderizador ya está** (2026-08-01); queda el **orquestador**.

   ✅ **Renderizador desplegado en Railway**, servicio aparte del de la API, sirviendo
   [`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app).
   Verificado en el navegador contra la base de producción: las 5 rutas en 200, las 14 páginas
   enlazadas, `/menu` con sus 3 categorías, `/blog` con los 2 artículos, footer con los 2 locales y
   JSON-LD correcto por tipo. El aislamiento del rol, comprobado con savepoints: `app_render` **no**
   puede leer `business_profile` crudo, ni `kr_runs`, ni `memberships`. Procedimiento y tropiezos
   reales en el [runbook](14-runbook-despliegue.md#desplegar-el-renderizador-fase-2).

   Lo que sigue faltando de este paso:
   - **El orquestador** (Inngest). Sin él, `lanzarResearch` y `aprobarRun` no tienen consumidor.
   - **Encender `lanzarResearch` y `aprobarRun`** en `portal/src/environments/environment.prod.ts`,
     **cuando el orquestador esté**. Se apagaron *porque no había nada detrás* (decisión de Fase 1,
     con test que lo fija). Si se despliega el orquestador y nadie los toca, **el portal sigue
     capado**. Los dos tests de `environment.prod.test.ts` que hoy exigen `false` hay que
     **invertirlos** en el mismo cambio, no borrarlos.
   - **Un link del portal a la web del cliente.** Ahora sí hay adónde apuntar, pero el link no existe:
     el salto sigue siendo cambiar de pestaña a mano.
   - **El dominio propio del cliente.** Hoy sirve por el dominio de Railway.
     `labirrabar.bigballs.es` ya tiene el CNAME puesto en Hostinger, pero apunta al servicio **de la
     API** (se agregó ahí por error y se quitó). Moverlo exige agregarlo como custom domain del
     servicio nuevo, actualizar el CNAME con el target que dé Railway y esperar propagación — y
     **el plan actual está en su límite de custom domains**, así que hay que liberar uno o subir de
     plan.
   - ~~Aplicar la migración `0010`~~ — ✅ hecha el 2026-08-01 (ver 0.b). Era el bloqueante silencioso
     de este despliegue: sin ella la web habría salido **sin locales y con `/menu` en 404**, sin un
     solo error en los logs.
5. **Cerrar lo que ADR-19 dejó a medias antes de un SLA**: CDN en el borde, invalidación con más de
   una instancia, punto único de disponibilidad (ver §3 más abajo).
6. **Deuda técnica menor, sin apuro**: ~~esquema Zod duplicado M2/M1~~ (✅ **cerrada el 2026-08-05**, KR-2a), ADR-11 (offboarding) reescrito
   sobre un frontend que ya no existe, y — de la revisión de Codex a la navegación del sitio — dos
   huecos de test documentados (falta un test positivo de que `/blog` muestra su link en una story
   normal, y la validación de forma de la allowlist de Postgres solo tiene test en un campo de ~20).
7. ✅ **Contraste de los ejes en modo oscuro** — **arreglado y desplegado (2026-08-01, `521daaf`).**
   Las etiquetas las pintaba **ApexCharts** con su gris por defecto, que no sale de `styles.css`, así
   que `contraste.test.ts` no podía verlo por construcción. Medido en producción antes de tocar nada:
   **1.53:1** sobre `--superficie` en oscuro, contra el 4.5:1 de AA, en **31 etiquetas**. Ahora salen
   de `--texto-medio` vía `estiloEjes()`, que recibe el lector del token en vez de tocar `document`
   —así el contrato se prueba en `node:test`, sin navegador—. **Los dos ejes**, no uno: en la barra
   horizontal las categorías van en el Y, y fijar solo el X dejaba las keywords con el gris viejo.
   El test **descubre** los componentes con `<apx-chart>` en vez de listarlos, así que el próximo
   gráfico que alguien agregue sin el token también falla. Verificado en el navegador y en producción:
   **oscuro 11.49:1, claro 10.31:1**, y repinta en vivo al cambiar de tema.
8. ✅ **`npm run typecheck` ya no escribe donde escribe el build de producción** (2026-08-01,
   `9b7b7f4`). `typecheck` es `ng build --configuration development` y, sin `outputPath` propio,
   dejaba en `dist/portal` un bundle con los valores-plantilla y `lanzarResearch: true`, **sin pasar
   por el `prebuild`** que verifica la config. Comprobado: tras un typecheck, `dist/portal/browser/`
   contenía `TU-PROYECTO`. No llegaba a producción porque Hostinger autodespliega desde `main` y no
   sube `dist/`, pero el runbook ya listaba el síntoma ("Frank SÍ ve el botón lanzar research") sin
   nombrar esta causa. Ahora va a `dist/portal-dev`, con un test que lee `angular.json` y cae si
   alguien le quita la salida propia.

## El número para la propuesta comercial

> ### Un research completo cuesta **~$0.31**
> 52 keywords analizadas → 8 páginas con contenido on-page. Estable en tres corridas.

| Proveedor | Coste | % |
|---|---|---|
| **DataForSEO** | $0.2522 | **81%** |
| LLM (generación) | $0.0586 | 19% |
| LLM (embeddings) | $0.0000 | ~0% |

El costo marginal de un research es de **centavos**: lo que se le cobre al cliente no está limitado
por el costo de la API, sino por el valor del entregable.

## Lo que la corrida real destapó

El sandbox devuelve datos ficticios, y eso **ocultaba tres bugs** que solo aparecieron con datos de
verdad. Encontrarlos era exactamente el punto de correr en producción. **Los tres están corregidos**
([detalle](../historia/acciones/03-research-produccion-dataforseo.md)):

1. **Se le decía al cliente "0 búsquedas/mes" donde no teníamos el dato.** DataForSEO devuelve
   `null` (le pasó en 41 de 60 keywords en KD) y el código lo coaccionaba a `0`. Ahora se propaga
   como `null` y el informe muestra **`n/d`** → esquema **`kr.v0.4`**.
2. **Se pagaban keywords duplicadas.** `"pasta fresca Madrid"` y `"pasta fresca madrid"` iban como
   dos, y a DataForSEO se le paga por keyword. Ahora hay dedupe canónico.
3. **El clustering colapsaba el sitio entero en 3 páginas.** Con coseno ≥ 0.55, 41 de 45 keywords
   caían en un cluster. Recalibrado a **0.75** con el dataset real: **8 páginas**, cada una sobre un
   servicio real del negocio.

> El dataset crudo se persiste en `datasets/keywords.json`. Antes se tiraba: se pagaba por datos
> que no sobrevivían al proceso, y cualquier ajuste de scoring obligaba a pagar otra corrida.
> Ahora el tuning es **offline y gratis** — con la salvedad de que el dataset de la corrida real se
> perdió igual, porque hasta el 2026-08-02 se escribía en `out/`, que git ignora (ver KR-1 en §2.b).

---

## Lo que queda por delante

*Ordenado por lo que realmente bloquea. Lo de arriba impide vender; lo de abajo, no.*

### ✅ 1. El despliegue (etapa 5.3) — **COMPLETO (2026-07-25)**

**Fase 1 está en producción.** Ya no bloquea nada.

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Portal | `https://bigballs.es` — Hostinger, autodeploy desde `main` | ✅ |
| API | `https://api.bigballs.es` — Railway, `europe-west4` | ✅ |
| Base + login | Supabase `eu-west-2` (Londres) | ✅ |

Runbook paso a paso, con los tropiezos reales, en
[13-runbook-despliegue.md](14-runbook-despliegue.md).

**Lo verificado en producción** (no "el deploy dio verde", sino comprobado desde afuera):

- **C.1 — las 9 migraciones** *(las que existían el 2026-07-25)*, verificadas por **introspección de
  la base**: 9 tablas con RLS **forzada** (`relforcerowsecurity`),
  `clients.business_profile_publico` como columna generada (la allowlist de ADR-19 vive en la base),
  runner idempotente confirmado con una segunda corrida.
  > ✅ **La `0010` también está aplicada** (2026-08-01, posterior a esta verificación). Producción va
  > con las **10**, y la allowlist de `business_profile_publico` ya deja pasar `locations` y `menu`.
  > Ver 0.b en [próximos pasos](#próximos-pasos) y el
  > [runbook § migraciones sobre una base ya desplegada](14-runbook-despliegue.md#aplicar-migraciones-nuevas-a-una-base-ya-desplegada).
- **C.2 — los 4 logins con contraseña** y los 4 **conectando de verdad** por el pooler, con
  `INHERIT=false` intacto tras el `alter role` (ADR-17 sigue en pie).
- **C.4 — seed verificado**: 2 `memberships` con `user_id` distintos, Frank `maestro` / Juan
  `equipo`, 1 run y 8 páginas, `business_profile_publico` poblado.
- **C.5 — la API**: `/health` 200, **TLS válido**, CORS que **acepta** `bigballs.es` y `www.` y
  **rechaza** cualquier otro origen, y `401` sin token en `/runs` y `/clients`.
- **C.6 — el portal**: 200 con TLS, redirect 301 de http a https, y las rutas profundas (`/runs`,
  `/login`, `/runs/abc123`) devolviendo el `index.html` — el fallback de SPA funciona. El bundle
  servido contiene `api.bigballs.es` y el ref de Supabase, y **cero `localhost`**: es el build de
  producción, no uno de desarrollo disfrazado.
- **C.7 — DNS**: CNAME y TXT de verificación propagados, custom domain *verified* en Railway.

**Credenciales centralizadas**: una fuente privada única + `npm run env:sync` reparte a cada paquete
solo sus claves, con la separación impuesta por tests (ver `scripts/env-sync.mts`).

**C.8 —la verificación de punta a punta en el navegador— se hizo, y encontró lo que todo lo anterior
no podía ver: ningún login funcionaba.** Los siete puntos de arriba seguían siendo ciertos:
comprueban que la infraestructura está bien, no que el producto sirva. Es exactamente el hueco que
C.8 existe para cubrir. **Arreglado por la pieza A y verificado el 2026-07-30** (ver el recuadro del
resumen): el login funciona.

Son **tres procesos** de larga duración más una SPA estática. **Dos están desplegados** (API y
renderizador, los dos en Railway y en servicios separados); falta el orquestador:

| Qué | Puerto dev | Necesita | Desplegado |
|---|---|---|---|
| `api/` | 3000 | `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS` | ✅ `api.bigballs.es` |
| `orchestrator/` | — | `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, `INNGEST_SIGNING_KEY`, `PIPELINE_MODO` | ✅ `amg-orchestrator-production.up.railway.app` |
| `renderer/` | 8080 | `DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`, `PREVIEW_SECRET`, `TRUST_PROXY` | ✅ `amg-renderer-production.up.railway.app` |
| `portal/` | 4200 | estático, se compila con AOT | ✅ `bigballs.es` |

La restricción del **renderizador** sigue viva y ahora está a medio resolver: necesita **DNS por
cliente apuntando al mismo servicio** (es un `Host` → dominio → space), más certificados TLS por
dominio. Railway lo admite —el despliegue lo confirmó—, pero **el plan actual tiene un límite de
custom domains que ya se alcanzó con dos**. Con una cartera de clientes eso deja de ser un detalle:
o se sube de plan, o la CDN de §3 pasa a ser también quien termina el TLS. La elección de Fase 1 no
cierra la puerta, pero el costo por dominio ahora tiene un número.

### 🟡 2. La demo con Frank — cuatro piezas, la A **ya no bloquea** a las demás

De la sesión de diseño sobre la demo salió un recorrido de tres golpes: **dashboard** (panorama de
cartera + economía), **entrar a un cliente** (la compuerta humana, que no se cuenta: se ve) y
**entrar a una página** (la evidencia ✅/⚠️). Los pasos 2 y 3 **ya existen**; solo se construye el 1.

La objeción que mata esta venta no es el precio: es *"si esto publica una barbaridad en el sitio de
mi cliente, pierdo al cliente"*. Por eso el rigor y la compuerta **no compiten** con velocidad y
panorama — son lo que las hace creíbles.

| # | Pieza | Estado | Depende de |
| --- | --- | --- | --- |
| **A** | **Verificación JWT ES256 + logout que revoca** | ✅ **Cerrada** — mergeada, desplegada y el login **verificado en el navegador** (2026-07-30) | — |
| **B** | Modo oscuro (**solo el portal**) | ✅ **Cerrada** — mergeada a `main` y migrada además a Tailwind v4 | — |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | ✅ **Cerrada** — esqueleto UI + shell + `/cartera` sobre datos de muestra, mergeada a `main` (2026-07-31) | B (hereda los tokens) ✅ |
| **D** | Research en vivo (desplegar el orquestador) | ⚪ Sin empezar, **y condicionado** | la medición |

**Pieza A** ([spec](../superpowers/ejecutados/2026-07-26-verificacion-jwt-es256-design.md) ·
[plan](../superpowers/ejecutados/2026-07-26-verificacion-jwt-es256.md)): 4 tareas, **las 4 hechas** en la
rama.

| Tarea | Estado |
| --- | --- |
| 1 — El verificador exige ES256 contra el JWKS y distingue "no pude comprobar" (503) | ✅ Hecha (`9706bec`) |
| 2 — El contrato de variables pierde el secreto | ✅ Hecha (`2630878`) |
| 3 — El logout revoca en Supabase, sin bloquear la UI ni pisar sesiones nuevas | ✅ Hecha (`c0ead5b`, `9f57376`) |
| 4 — Documentación, credenciales y despliegue | ✅ Hecha (revisión final, esta misma pieza) |

**Nada queda pendiente de la pieza A.** El despliegue se ejecutó (`SUPABASE_JWT_ISS` en Railway,
merge a `main`) y el login se verificó en el navegador. `SUPABASE_JWT_SECRET` **se deja** en Railway a
propósito, como red de rollback: `leerConfig` ya no la lee, y el código viejo la exige para arrancar.
Ver [13-runbook-despliegue.md § Actualizar una instalación ya desplegada](14-runbook-despliegue.md#actualizar-una-instalación-ya-desplegada).

**B — modo oscuro:** solo el portal; el renderizador queda afuera a propósito (la web pública es la
marca del restaurante). Va por **tokens semánticos**, no por variantes `dark:`, para que la pieza C
herede el tema por construcción en vez de tener que acordarse
([spec](../superpowers/ejecutados/2026-07-30-modo-oscuro-portal-design.md) ·
[plan](../superpowers/ejecutados/2026-07-30-modo-oscuro-portal.md)).

> **Lo que la hace exigible, y no un acuerdo de buena voluntad.** 21 tests nuevos (66 → 87). El
> contraste WCAG AA de los **17 pares × 2 temas** se lee de `styles.css`, no de una copia. Tras la
> migración a Tailwind v4 (que borró `tailwind.config.js`), el triángulo quedó en dos archivos:
> `TOKENS` (en `contraste.ts`) y `styles.css`, y este último es internamente consistente entre
> `:root`/`.oscuro` y el bloque `@theme inline` que Tailwind usa para emitir las utilidades — un test
> ata los nombres de los tres lados y otro verifica que cada `--color-X` de `@theme inline` apunte a
> `--X`, no solo que exista: borrar o desapuntar un token ahí dejaba `text-respaldo` sin emitir (el
> título ✅ en gris) con toda la suite en verde. Y un test recorre `src/app` y **falla si una
> plantilla incrusta un color o usa la paleta cruda** — descubre los archivos en vez de listarlos, así
> que también cubre las pantallas que la pieza C todavía no escribió.
>
> **Lo que solo apareció manejando la app** (cuatro cosas que ningún test veía): el `☀` se pintaba
> como emoji naranja y no seguía al tema; el `placeholder` de todo input estaba clavado por el
> preflight de Tailwind (`color-mix(in oklab, currentcolor 50%, transparent)` en v4) por debajo del
> 4.5:1 de AA en claro; poner la barra siempre visible dejó el login con 44 px de scroll; y el botón
> del tema tenía la mitad del área táctil que pide WCAG. Las cuatro, corregidas.

**C — el dashboard:** los datos para poblarlo **ya existen y están sin explotar** — cada página trae
`volumen`, `dificultad`, `opportunity_score`, `score_confidence`, `intencion`, `local`, `cluster_id`
y `evidencia`; cada run trae `coste_micros_usd` y `calidad_datos`. Se puede construir **sin tocar la
API**: la pantalla arranca con datos de muestra (misma forma que los DTOs reales), no contra un
endpoint agregado nuevo — eso queda para más adelante, como trabajo de backend separado.

**Cerrada (2026-07-31).** Se trajo el esqueleto de layout (sidebar + header + backdrop) y una
librería chica de componentes del `dashboard-project` (TailAdmin) de referencia, adaptados a los
tokens semánticos de la pieza B — no una librería genérica sin uso, solo lo que `/cartera` necesita
([spec](../superpowers/ejecutados/2026-07-30-dashboard-ui-portal-design.md) ·
[plan de Tailwind v4](../superpowers/ejecutados/2026-07-30-tailwind-v4-migracion-portal.md), cerrado y
mergeado ·
[plan del shell + dashboard](../superpowers/ejecutados/2026-07-30-dashboard-ui-portal.md), 13/13 tasks,
review final de rama aplicado). Las dos ramas (`feat/modo-oscuro-portal` y `feat/dashboard-ui-portal`)
están mergeadas a `main` (`d670c23`). 103 tests `node:test` + 17 Karma + build de producción, todo en
verde tras el merge. El detalle task-by-task, con SHAs y resultado de cada review, vive en
`.superpowers/sdd/progress.md`.

**Verificado en el navegador el 2026-08-01** (era el pendiente que quedó abierto porque el MCP de
chrome-devtools no conectó durante la implementación): `/cartera` en oscuro y en claro, el drawer
mobile a 390 px —abre, el backdrop lo cierra, `aria-expanded` acompaña y el `aside` vuelve a
`-translate-x-full`—, y cero mensajes de consola. Y encontró lo que los tests no veían: ver el bloque
de abajo.

> ### 🔗 El cliente de la demo, unificado (2026-08-01)
>
> **El problema no era una funcionalidad que faltara: era que las tres pantallas hablaban de tres
> negocios distintos.** El dashboard listaba seis restaurantes inventados, el brief mostraba el
> italiano de ejemplo (el seed seguía sembrando "Trattoria Bella Napoli") y la web servía La Birra Bar
> desde la acción 06. El recorrido de tres golpes contaba tres historias sin relación.
>
> Qué se hizo, con test primero y verificación por mutación en cada paso:
>
> - **`db/src/seed-demo.ts`** siembra **La Birra Bar**: 14 páginas (8 respaldadas / 6 sin validar,
>   el split real de la acción 06), coste `309700` micros (**$0.3097**, el real), perfil con los **dos
>   locales** y la **carta**. `sembrarBellaNapoli` pasó a llamarse **`sembrarDemo`** para que el nombre
>   no vuelva a envejecer con el cliente. Los UUID fijos del cliente y del run **no cambian**: re-sembrar
>   la instalación desplegada reemplaza esas dos filas en su lugar, no deja las dos.
> - **Un test ata el perfil del seed a `web-builder/business-profile.json`** (nombre, `locations`,
>   `menu`). Es el ancla contra la deriva que causó todo esto: el perfil vivía dos veces sin nada que
>   atara las copias.
> - **Otro test comprueba que lo sembrado sobrevive la allowlist** (`business_profile_publico`). Ahí
>   apareció un bug real que nadie había visto: el perfil viejo no tenía **ni `locations` ni `menu`**,
>   así que la web del cliente sembrado se habría servido **sin Ubicaciones y con `/menu` en 404** —la
>   navegación que se acababa de construir— y además ponía `font: "Fraunces"`, que **no está en la
>   allowlist de fuentes** (`sistema | serif | moderna`) y se descartaba **en silencio**.
> - **El `dev-server` de la API usa `sembrarDemo`** en vez de inventar su propio dataset (era la cuarta
>   copia): verificar el portal en local ahora es ver lo que verá Frank.
> - **El dashboard abre con el cliente real**, con sus IDs, su coste y sus keywords.
>
> **Lo que solo apareció manejando la app** (y que ningún test veía): al mezclar un cliente real con
> cinco de muestra, el generador de muestra sacaba scores de hasta 98 y **el gráfico "Top
> oportunidades" quedaba dominado por relleno** (`keyword run-5-1 0`), con solo 2 de 8 barras reales —
> el primer golpe de la demo mostraba basura. Y la tabla listaba las 44 páginas: 14 reales seguidas de
> 30 de relleno. Corregido: la muestra tiene un techo de score por debajo del más bajo real, y la tabla
> lista solo las páginas del cliente principal. Los dos, con su test.
>
> **✅ Cerrado el mismo día: los slugs ahora salen de Storyblok.** Con las credenciales disponibles se
> leyeron las 14 stories publicadas por la **Content Delivery API**, y el seed usa sus **slugs,
> keywords (`source_keyword`), títulos y descripciones SEO, tipo de página, intención y FAQs reales**.
> El brief que Frank aprueba en el portal lista **exactamente** las páginas vivas en la web, con sus
> mismos textos. Solo dos de los 14 slugs inventados coincidían con los reales, así que sin esto el
> hilo seguía roto en el último salto.
>
> **Lo único que queda reconstruido son las métricas** (volumen, dificultad, score, confianza): vivían
> en `out/brief.json`, perdido con el directorio `out/` (KR-1). Están asignadas por demanda plausible
> y **respetan el split real 8/6**; se reemplazan por las medidas cuando se regenere el dataset.
>
> Y un invariante nuevo, con test: **ninguna página de tipo `blog` puede marcarse `local`** — `local`
> decide si la página se declara `LocalBusiness` ante Google, y un artículo no es un negocio local.

**D — research en vivo:** el orquestador **ya está construido** (Inngest, `workflow.ts`,
`functions.ts`, 18 tests). Falta desplegarlo y conectarlo, no escribirlo.

> ### ✅ Medido (2026-07-30): **16 min 15 s**, contra el corte de ~12 minutos que mataba la demo
>
> Corrida real contra producción (La Birra Bar, 55 keywords → 14 páginas, $0.3097): **16m15s** de
> punta a punta (`spike.ts`, sin el publish). Eso está **por encima** del umbral de ~12 minutos que
> este mismo documento fijaba como el punto en que "Frank mira un spinner y la demo se muere ahí".
> Parte del tiempo se fue en 3 tareas SERP que agotaron 60 sondeos de `task_get` cada una antes de
> registrarse como recuperables (ver ADR-14) — el research **no abortó ni cobró de más** por eso,
> pero sí sumó minutos.
>
> **Decisión que esto implica para la pieza D:** con este dato, mostrar el research **en vivo**
> durante la demo con Frank es un riesgo alto de que la demo se estanque mirando un spinner. La
> alternativa más segura es **correrlo antes** (como se hizo acá) y mostrar el resultado ya
> publicado — que es exactamente lo que dejó lista la Acción 06. Pieza D, tal como se imaginó
> originalmente (lanzar el research delante de Frank), queda **desaconsejada** hasta que haya una
> optimización real de la duración (paralelizar más las tareas SERP, o mostrar progreso incremental
> en vez de esperar el brief completo).

Aparte de las cuatro piezas:

- ✅ **Navegación del sitio del cliente** — **hecha y mergeada a `main` (2026-08-01)**
  ([spec](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente-design.md) ·
  [plan](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente.md)). El sitio público mostraba
  una barra con los títulos SEO de las 14 páginas de research — parecía un blog. Reemplazada por
  **Inicio · Menú · Ubicaciones · Contacto** fijos (condicionales a que haya datos), un **footer
  compartido** con NAP multi-local, y dos páginas sintetizadas nuevas: `/menu` (la carta, agrupada
  por categoría, JSON-LD `Menu`) y `/blog` (solo los artículos, separados de las landings
  comerciales). 10 tareas — 9 planeadas más una migración de Postgres (`0010`) que apareció como gap
  real durante la ejecución: la allowlist de `business_profile_publico` no incluía `locations`/
  `menu`, así que se hubieran filtrado en silencio en producción, el mismo bug que ya le había
  pasado a `brand`. Una revisión final de rama y una revisión externa (Codex) encontraron y
  corrigieron 4 hallazgos reales, verificados por mutación: la allowlist de Postgres no validaba la
  **forma** de los valores (un objeto podía colarse donde se esperaba un string), la precedencia de
  `locations` estaba invertida contra su propio comentario, los topes de tamaño se aplicaban después
  de que Postgres ya había materializado el array completo, y `/blog` se autoenlazaba con una story
  real. **516 tests** (subió de 466), typecheck limpio, verificado en el navegador dos veces (una
  vez por el implementador de la última tarea, otra por el controlador, con capturas).
- ✅ **[Corrida final + republicar](../historia/acciones/06-corrida-final-demo.md)** — **hecha (2026-07-30)**,
  $0.3097. Publicado en Storyblok con `kr.v0.5`: 14 páginas de **La Birra Bar** (cliente real de la
  agencia, reemplazó al caso de ejemplo "Bella Napoli" en el mismo space), verificado en el
  navegador — evidencia separada (8 respaldadas / 6 sin validar), JSON-LD correcto por tipo de
  página (`LocalBusiness` solo donde corresponde, `Article` en los blogs), marca consistente. De
  paso se encontró y cerró un hueco real: `npm run spike` en producción exige `DATABASE_URL_CACHE`
  desde ADR-14 y la guía no lo pedía — corregido en la guía y en `scripts/env-sync.mts` /
  `kr-service/.env.example`. Detalle completo en la guía. Lo publicado en Storyblok **ya no es
  anterior a `kr.v0.5`**: ahora sí muestra la evidencia etiquetada, que es *el argumento de venta*.
- ✅ ~~Unificar el alcance (OBS-01)~~ — **hecho** (2026-07-19): manda `docs/historia/contexto-proyecto-frank.md`,
  alcance base = 3 módulos, ADR-04 se mantiene. Era la última observación abierta del proyecto.

### 🟠 2.b La demo del **módulo de Keyword Research** (decidido 2026-08-01)

Hasta acá, "la demo" quería decir *la demo de la plataforma*: el recorrido de tres golpes de §2, que
vende multi-tenancy, compuerta humana y web viva. **La demo del módulo KR es otra cosa** y no estaba
escrita en ninguna parte — este bloque la fija.

#### Las cuatro decisiones

| Decisión | Elegido | Qué implica |
|---|---|---|
| **Objetivo** | **Entregable primero, pipeline después** | Abre con lo que el restaurante recibe (informe + evidencia + precio) y, si hay interés técnico, se baja al recorrido `prompt → keywords → clustering → páginas`. Hay que preparar **dos guiones** y decidir dónde se corta. |
| **¿En vivo?** | **No: se muestra el ya corrido** | Confirma lo que midió la acción 06 (16m15s). La **pieza D queda cerrada, no pendiente**: paralelizar SERP y el progreso incremental **salen del alcance de la demo** y quedan como mejora de producto (§4). |
| **El informe** | **Se ve en el portal** | `out/informe.md` es el mejor entregable del módulo y hoy **solo existe como archivo local** tras correr el CLI. Pieza de trabajo nueva (ver abajo). |
| **Calidad del research** | **Las tres, antes de la demo** | `is_local` por señales del SERP, `score_confidence` que ordene, y volumen normalizado por percentiles. Dejan de ser "mejoras algún día": son **pre-demo**. ✅ **Las tres implementadas el 2026-08-02** — con un matiz que hay que leer: la normalización es por percentil **del run**, no del mercado. El otro matiz —que el orden nuevo no llegaba al portal— se cerró el 2026-08-04 con la migración `0015`. Ver KR-3 abajo. |

#### 🔴 La precondición: **falta el dataset crudo** — el destino ya está arreglado, el dato no

La tanda 4 dejó escrito que el dataset se persiste y que por eso *"el tuning es offline y gratis"*,
pero lo escribía en `out/keywords.json` y **`out/` está gitignoreado**: el archivo no viajó con el
clon y **no está en ninguna máquina** (buscado el 2026-08-02, incluido fuera del repo). Tres salidas,
en orden de preferencia:

1. ~~Aparece el `out/` de la corrida del 2026-07-30~~ — **descartada**: no existe.
2. **Regenerar el dataset** con una corrida real contra producción → **~$0.31** y ~16 min. Barato, y
   de paso vuelve a ejercitar el camino live. **Es la única salida, y la decide Juan.**
3. ~~Calibrar contra sandbox~~ — **no sirve**: los datos son ficticios, y `is_local` depende
   justamente de señales reales del SERP (presencia de *map pack*).

> ✅ **La otra mitad —guardar el dataset donde sobreviva— está hecha (2026-08-02).** El destino por
> defecto es `datasets/keywords.json`, un directorio **versionado** (`KR_DATASET_PATH` lo cambia). La
> decisión de commitearlo: son datos de mercado públicos más el prompt del negocio, nada secreto —
> el motivo real de que estuvieran en un directorio ignorado era que el CLI escribía todas sus
> salidas en el mismo sitio. Y **no lo garantiza un comentario**: lo impone `dataset-path.test.ts`,
> que le pregunta a `git check-ignore` y falla si el destino cae en un directorio ignorado. Es el
> test que habría cazado el bug original.

#### Las piezas de trabajo

| # | Pieza | Estado | Nota |
|---|---|---|---|
| **KR-1** | **El dataset crudo, recuperado o regenerado** | 🟠 **A medias** | El **destino durable** ✅ hecho. El **dato** falta: cuesta ~$0.31 y **decide Juan**. Ver arriba. |
| **KR-2** | **El informe legible, en el portal** | ✅ **completo** (KR-2a el 2026-08-05, KR-2b el 2026-08-06) | **KR-2a**: el paquete `contrato/` (7º workspace) con los tipos, los dos validadores Zod y `renderReport`; 11 commits + una fix wave, 734 tests entonces. Cierra la deuda del Zod duplicado. **KR-2b**: la tabla `kr_informes` (`0016`, solo staff), `guardarInforme`/`getInforme`, el step del orquestador **antes** de `cerrar-run`, los dos endpoints, el seed de la demo y la pantalla con parser propio de Markdown; **22 commits**, 7 tareas con su review cada una. Decisiones: **(b) paquete compartido**, **pantalla + descarga `.md`**, **el `.md` guardado**, **el informe es interno**, el **PDF trasladado** al entregable del restaurante (nota fechada en ADR-07), y **las dos fechas del informe se muestran las dos** con el aviso explicando cuál es cuál. Detalle abajo. |
| **KR-3** | **Las tres mejoras de calidad** | 🟠 **Implementadas, sin calibrar** | ✅ Las tres en `kr-service` (2026-08-02), y ✅ **el orden ya llega al portal** (2026-08-04, migración `0015`). Queda **una** cosa abierta: los parámetros no están barridos contra datos reales (necesita KR-1). |
| **KR-4** | **El guion de dos niveles, escrito** | ⚪ Sin empezar | Qué se muestra, en qué orden, y dónde se corta si no hay interés técnico. |

**KR-3 — lo que quedaba abierto: ✅ CERRADO el 2026-08-04** (etapa B del
[plan de agentes](../../.claude/PLAN-AGENTES.md), que estrena con esto al agente `datos`).

El orden en dos niveles (evidencia primero, después `score_confidence`) gobierna **qué páginas
existen** —el corte al backlog es irreversible y ocurre dentro de `kr-service`—, pero **no llegaba al
cliente**: en cuanto el brief pasaba por Postgres, `getRunPages` y `getPublishablePages` reordenaban
por `opportunity_score` crudo, así que la columna "Confianza" del portal no ordenaba nada. Se cerró con
la **(a) persistir el orden**, que era la recomendada: el orden lo decide quien tiene el contexto, y es
la única que sobrevive a que alguien cambie la fórmula. La (b) —duplicar la fórmula en SQL y en el
portal— se descartó: eran tres fuentes de verdad del mismo criterio.

Qué quedó, con el contrato **el orden ES la posición en `brief.paginas_propuestas`**:

- **`kr_pages.orden_brief`** (migración `0015`, `0` = primera), escrita por `PgStore.savePages` desde el
  índice del array. `kr-service` y `orchestrator` **no cambiaron**: el array ya viajaba ordenado.
- Las **dos** lecturas ordenan por una única definición (`ORDEN_DEL_BRIEF`), para que el revisor no
  pueda aprobar una lista y publicarse otra.
- **El portal no necesitó cambios**, y esto corrige lo que este documento afirmaba: el que deshacía el
  orden era solo `store.ts`. `separarPorEvidencia` **preserva** el orden de entrada
  (`portal/src/app/core/evidence.ts:35`) y las plantillas no re-ordenan. Y
  `portal/src/app/core/cartera.ts:37` **no era una violación**: es `topOportunidades`, el widget de "las
  N de mayor score" del dashboard, con un propósito distinto del orden del brief. Sí se agregó un test
  🔴 en el portal que **muerde** —su fixture entra con el orden contradiciendo al score—, porque el que
  había usaba dos páginas con el mismo score y pasaba igual con un `sort` metido en medio.
- Dos garantías nuevas que antes no las imponía nada: un brief con **`url_slug` repetido se rechaza
  entero** (producía un orden invertido y **no reproducible**), y una página **retirada no puede tener
  posición** (`check retirada_sin_posicion`).

**Con el seed actual la demo se ve igual**, y está medido: los 14 scores de `PAGINAS_DEMO` son
estrictamente descendentes y sin empates, con las 8 respaldadas antes de las 6 sin validar, así que el
orden del array coincide índice por índice con el de dos niveles. Lo que cambia es que **deja de
depender de esa coincidencia**.

**KR-2 — la decisión técnica, ✅ TOMADA el 2026-08-04: la (b), paquete compartido.** Se decidió sin
implementar, para que no siguiera bloqueando. `renderReport()` vive en `kr-service`, y
`api/package.json` **hoy solo depende de `db`**. Los tres caminos que se compararon:

- **(a) La API importa `kr-service`** y `GET /runs/:id` devuelve el informe ya renderizado. Lo más
  rápido, pero mete el pipeline de research entero como dependencia de la API — que es la superficie
  autenticada, y hasta ahora solo depende de la base.
- **(b) Extraer el contrato + `renderReport` a un paquete compartido.** ✅ **ELEGIDA.** Más trabajo,
  pero **cierra de paso la deuda del esquema Zod duplicado M2/M1**, que ya está anotada como deuda
  técnica. Y mantiene la API dependiendo solo de datos, no del pipeline de research.
- **(c) El portal renderiza el informe desde el `brief` JSON que ya recibe.** Cero cambios en el
  backend, pero **duplica la lógica del informe** en un tercer lugar y en otro lenguaje de plantilla:
  la misma clase de deriva que acaba de costar la unificación del cliente.

**Las dos preguntas de producto se cerraron el 2026-08-04**, y con eso la spec quedó escrita
([`2026-08-04-informe-kr-portal-design.md`](../superpowers/specs/2026-08-04-informe-kr-portal-design.md)):
**pantalla + botón de descarga `.md`**, y el **`.md` guardado ya renderizado**.

Lo que el diseño destapó, y que no se sabía al tomar esas decisiones:

- **El `backlog` no se persiste en ninguna parte** — `savePages` solo guarda páginas. Un informe
  reconstruido desde la base saldría sin esa sección **sin avisar**. Guardar el `.md` renderizado desde
  el brief en memoria lo evita.
- **El run de la demo no lo produjo el pipeline: lo siembra `sembrarDemo`.** Escribir el informe solo "al
  terminar el research" lo habría dejado sin informe, y el `out/informe.md` de la corrida real no existe
  en ninguna máquina (KR-1). De ahí que haya **dos productores** que escriben el informe.
- **`renderReport` emite `NaN` con datos incompletos**, y el contrato **no admite "no sé"** en las
  coberturas de `calidad_datos` (son `number` no-nullable). Las dos cosas se arreglan en KR-2a.
- **El informe va en tabla propia (`kr_informes`), no en una columna de `kr_runs`.** RLS es por fila: una
  columna habría dejado el **coste interno de la agencia** visible para el rol `cliente`, que ve los runs
  de su negocio. La política exige `app.es_staff()`.
- **El informe de la demo va a tener tres huecos** (desglose de coste y las dos coberturas) hasta que se
  regenere el dataset. Es el momento en que el ~$0.31 de KR-1 deja de ser mejora interna y se vuelve
  visible en la demo.

Se partió en dos etapas, y las dos están cerradas: **KR-2a** (el paquete `contrato/`, cero cambios
visibles) y **KR-2b** (migración `0016`, endpoints, pantalla, seed).

#### ✅ KR-2a — cerrado el 2026-08-05: el paquete `contrato/`

El 7º workspace. Contiene los tipos del contrato del brief, **los dos** validadores Zod y `renderReport`;
solo depende de `zod`. 11 commits por las 9 tareas del
[plan](../superpowers/plans/2026-08-05-kr2a-paquete-contrato.md) —cada una con su review— más una fix wave
de la review final de rama. **734 tests** (venía de 698), typecheck limpio en los 7 paquetes.

**Cierra la deuda del Zod duplicado**, pero no como el plan imaginaba, y el matiz importa: al medir los dos
esquemas campo por campo resultó que **no eran dos copias del mismo contrato**. `consumoM1` acepta cuatro
`schema_version` y hace `evidencia`/`score_confidence` opcionales **a propósito**, para no rechazar briefs
viejos que siguen siendo publicables; `emisionM2` exige el brief completo. Fusionarlos obligaba a que uno
perdiera su garantía. Se unificaron los **tipos**, el **render** y las piezas comunes, y quedaron **tres
lazos** que impiden que las piezas se separen en silencio: el test de inclusión `emisionM2 ⊆ consumoM1`,
dos aserciones de tipos cruzadas del lado de emisión, y un test que recorre los paquetes buscando un
`z.object` con `paginas_propuestas` adentro (más un segundo que impide que ese barrido quede vacío y pase
para siempre).

**Los tres arreglos de comportamiento** que la etapa traía, todos del informe: un dato ausente sale `n/d`
y no `NaN`; sin desglose de coste **no se pinta la tabla** de desglose (se pinta el total, que sí es un
dato, con la nota); y el informe **escapa los delimitadores de Markdown**, así que una keyword con `|` ya
no desalinea la tabla ni un `\n##` inventa una sección. Ese último era un bug que **ya existía** en el
`out/informe.md` del CLI.

**Lo que destapó, y no estaba en el plan:**

- **Un riesgo de gasto real.** El gate que **aborta antes de pagar** leía `cobertura_volumen`, que pasó a
  ser nullable. Con `null`, `null === 0` y `null < 0.3` son los dos `false`: el corte **se desactivaba en
  silencio** y el run seguía pagando intención, relevancia y contenido sin un dato de mercado. La red que
  lo atrapa es `tsc`, no la suite — los 146 tests de `kr-service` pasan en las tres variantes medidas. Y
  **sigue sin haber test del corte por cobertura 0** (deuda anotada en el propio comentario).
- **Que un tipo puede prometer más de lo que su validador garantiza.** `parseBrief` devolvía, vía `as`, un
  tipo que exigía `run_id`, `generated_at`, `backlog` y `meta_run` — campos que `consumoM1` no valida. El
  síntoma fue tener que engordar los fixtures del M1 para que compilaran. Ahora devuelve
  `z.infer<typeof consumoM1>`. El mismo defecto apareció una segunda vez en `coste_breakdown` (tres campos
  `number` obligatorios contra un guard de runtime que se protege de que falten, porque `{}` es el default
  de la columna) y se arregló igual.
- **Tres comentarios que afirmaban algo falso**, incluido uno que describía su propia medición **al revés**
  y otro que nombraba como red un diferencial que ya no se podía correr. Es la lección de la 13ª review, un
  nivel más abajo: en el código, no en las skills.

**Y lo que agregó la 14ª review** (la primera del proyecto sobre un documento de diseño; 13 hallazgos, los
13 verificados — [`08` § tanda 20](08-testing-calidad.md)):

- **La migración no concedía ni un `grant`**, y habría sido inoperable (`42501` al guardar y al leer). Los
  grants del proyecto son listas explícitas por tabla y no hay `on all tables` en ninguna migración:
  `kr_informes` es la **primera tabla nueva desde que existen los cuatro logins**, así que el paso no
  estaba en ninguna rutina. Ningún test lo habría atajado, porque no había código.
- **Los dos esquemas Zod NO se fusionan.** El de M1 acepta cuatro versiones y hace dos campos opcionales
  **a propósito**; el de M2 exige el brief completo. Se comparten los **tipos** y `renderReport`, con una
  `esquemaBase` y dos derivados (`emisionM2` / `consumoM1`). **Esto redefine qué significa "cerrar la deuda
  del Zod duplicado"** de la §4 de este documento: la deuda era *dos fuentes de verdad del mismo
  contrato*, y eso se cierra; que haya dos **validadores** no era la deuda.
- **`renderReport` interpola texto de LLM sin escapar delimitadores de Markdown**, así que una keyword con
  `|` rompe la tabla del informe. **Es un bug que ya existe hoy** en el `out/informe.md` del CLI; KR-2 solo
  lo hace visible. Se arregla en KR-2a.
- **El margen ya está expuesto al rol `cliente`** (ver la deuda conocida en §4): no lo causa KR-2, pero la
  spec no podía presentar `kr_informes` como si cerrara una exposición que ya existía por otra vía.
- **Queda una decisión abierta: el PDF de ADR-07.** Con el informe convertido en documento interno el PDF
  pierde su motivo —era formato de entrega hacia afuera— y pasa a pertenecer al **entregable del
  restaurante**, que no existe. La recomendación es registrarlo en ADR-07 **antes** de implementar.

#### ✅ KR-2b — cerrado el 2026-08-06: el informe, en la pantalla

**22 commits**, siete tareas con su review cada una y seis re-reviews, ejecutadas con un implementador
fresco por tarea. Lo construido:

| Pieza | Qué quedó |
|---|---|
| **`0016`** | `kr_informes`: PK `run_id`, FK **compuesta** contra `kr_runs`, `check` de 256 KiB, RLS + `force`, política `app.es_staff()` y **sus dos `grant`**. `app_render` no recibe nada |
| **store** | `guardarInforme` (idempotente, el `client_id` leído **del run**, y **lanza** si el run no es visible) y `getInforme` |
| **orquestador** | el step `guardar-informe` **entre `guardar-paginas` y `cerrar-run`** |
| **API** | `GET /runs/:id/informe` (200 con `null` si no hay, 404 solo si no hay run) y `/informe.md` con el `filename` por **allowlist** |
| **seed** | el run de la demo con informe **sin gastar $0.31**, y sus tres huecos en `n/d` |
| **portal** | `parsearMarkdown` → estructura de datos, la pantalla con `@if`/`@for`, y un barrido del árbol que prohíbe `innerHTML` |

**El invariante que la etapa vuelve enunciable:** *un run en `pending_approval` o posterior **siempre**
tiene informe.* Lo fija el **orden** del step —los tres steps tienen transacciones separadas, así que con
el informe después de `cerrar-run` habría una ventana real sin informe—, y es lo que permite que la
pantalla afirme que un run sin informe es uno viejo **y no un fallo silencioso de persistencia**.

**Por qué el informe tiene tabla propia y no una columna:** **RLS es por fila, no por columna.** El
informe lleva el coste que la agencia le paga a DataForSEO —su margen— y el rol `cliente` ve los runs de
su cliente. Con la fila propia, la política puede exigir staff, y **un `cliente` no recibe un 403: no
recibe la fila**. La API no lleva ni un `if` de rol.

**Lo que la etapa destapó, y no estaba en el plan:**

- **El guardián de KR-2a tenía un punto ciego.** `una-sola-fuente.test.ts` solo barre esquemas **Zod**, así
  que no podía ver `BriefDelPipeline`, un mirror **de tipos** en el orquestador que recortaba cinco campos
  del brief — justo los que el informe necesita. Se eliminó (hoy es un alias del tipo del contrato), pero
  **la ampliación del guardián a los mirrors de tipos sigue pendiente**.
- **El parser podía reabrir un agujero que KR-2a había cerrado.** `renderReport` escapa diez delimitadores
  de Markdown del texto del LLM; un parser que partiera celdas **sin respetar el escape** le devolvía a un
  `\|` hostil su columna extra. Lo encontró el implementador corriendo el generador en vez de leerlo.
- **El saneado del `filename` no llegaba al navegador.** `hono/cors` no declaraba `exposeHeaders`, así que
  el browser **le escondía `Content-Disposition` a JavaScript** y el archivo bajaba con el `runId` en vez
  del nombre del cliente. Ningún test podía verlo: apareció manejando la app.
- **Las dos fechas del informe divergen por diseño**, y no era cosmética del seed: `generated_at` del brief
  es cuándo **empezó** el research y `kr_informes.generado_at` cuándo se **guardó** el render — 16 min 15 s
  en la corrida real. Decisión del dueño: **se muestran las dos**, con el aviso explicando cuál es cuál.

**Deuda que la etapa deja con nombre:** los `*.test.ts` del portal **no los typechequea ningún tsconfig**
(los `*.spec.ts` sí); `reseed:demo` **falla contra Supabase hasta desplegar la `0016`**, porque el CLI de
seed no corre migraciones; y `force row level security` de `kr_informes` no tiene test propio.

#### ✅ Después de KR-2a — el contador de tests del arnés reportaba 0, y en verde (2026-08-05)

No es de KR-2a, pero se arregló al terminarla porque **dejaba ciega la verificación de todo lo que viene
después**. `verificar.sh` contaba los tests con `grep '^# pass'`, y Node 24 cambió el reporter por defecto de
`tap` a `spec`: el resumen pasó a ser `ℹ pass 34`. El patrón no matcheaba nada, `awk` sumaba 0 y el arnés
imprimía **`[OK] 0 tests en verde`** — la única cifra que dice cuánto se verificó, en cero, presentada como
un éxito. La deuda estaba anotada la tarde anterior, pero con la conclusión equivocada de que el riesgo
todavía no estaba activo; **ya lo estaba** (el detalle de por qué, en la
[bitácora del 2026-08-05 (noche)](../../progress/history.md)).

La lógica salió del bash a **`scripts/contar-tests.mts`** con **9 tests**: acepta cualquier prefijo de
reporter —medidos los de v22.21.1 y v24.18.1— y, lo que importa, **falla si no puede contar** en vez de
devolver 0. Los dos sitios que contaban (monorepo y portal) usan el mismo contador. **743 tests** *(la cifra de ese día — histórica, no sincronizar)*, exit 0, y
las 4 mutaciones caen. La lección quedó en [`08` §
el molde que ya apareció tres veces](08-testing-calidad.md) y un checkpoint nuevo en `C1`.

### 🟡 3. Lo que ADR-19 dejó a medias y hay que cerrar antes de un SLA

- **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
  **en proceso**. El borde es una decisión de despliegue.
- **Más de una instancia rompe la invalidación.** El webhook llega a UNA sola; las demás sirven
  contenido viejo hasta que venza el TTL. Con una instancia no pasa. Antes de escalar: cache
  compartida, o bajar el TTL a sabiendas.
- **Es un punto único de disponibilidad.** Si el renderizador se cae, **se caen todas las webs de
  cliente a la vez**. Ya está mitigado (health check que no toca dependencias, timeout de 5 s, 503
  que no se cachea), pero el modo de fallo existe y un sitio estático no lo tenía.

### 🟢 4. Deuda conocida, ninguna bloqueante

- **Tests de componente del portal** (Karma). El núcleo está cubierto (**207** tests `node:test`) y
  hay **78** de componente en Karma *(medido el 2026-08-07)*. Ya no es deuda: cubren el tema y el shell, las pantallas de
  clientes y usuarios, **y las de research** (`runs.spec.ts`, `brief.spec.ts`). Lo que sigue sin red
  de componente son las pantallas que se agreguen de acá en adelante — la regla está en la skill
  `portal-testing`.
- **El polling del brief (4 s) es a ojo**, y la lista de runs no pollea. Se calibra con la duración
  real de una corrida.
- **ADR-11 (offboarding) sigue sin poder firmarse.** Ahora *hay* qué entregar (el space + el
  renderizador), pero falta **verificar el snapshot estático como entregable**, ponerle precio a la
  "salida gestionada" y **cerrar OBS-04** (quién edita durante el servicio, del que depende qué
  significa "editable" en la baja). Es redacción comercial, no código.
- **El enlace de preview del Visual Editor se emite a mano.** `firmarPreview()` existe y está
  probado, pero solo lo usan `dev-server` y `demo-server`: en producción el enlace se genera con un
  script fuera del repo y se pega en la configuración del space. Funciona, y **la firma vence** — así
  que hoy se compensa con un vencimiento largo. Parte de OBS-04.
- **El clic-para-editar del Visual Editor no funciona.** `desShapeBlok()`
  (`web-builder/src/storyblok/content.ts`) descarta el atributo `_editable` al normalizar el blok, y
  es de ahí de donde el Bridge saca el resaltado y el salto al campo. Se edita desde el panel de
  campos. Pesa poco si edita la agencia, y bastante si el día de mañana edita el cliente.
- **Esquema Zod duplicado** entre M2 y M1: dos fuentes de verdad del contrato. **KR-2a lo cierra**, pero
  no fusionándolos: el de M1 acepta cuatro `schema_version` y hace `evidencia`/`score_confidence`
  opcionales **a propósito**, así que son dos contratos con propósitos opuestos. Lo que se comparte son los
  **tipos** y `renderReport`, con dos derivados de una base común (ver la spec de KR-2 § 4.1).
- ~~**🔴 El coste del research (el margen de la agencia) es legible por el rol `cliente`.**~~ ✅ **Cerrado
  el 2026-08-07.** Lo recorta **Postgres**, no la API: `RUN_SUMMARY_COLS` trae
  `case when app.es_staff() then coste_micros_usd::int end`
  ([`store.ts:330`](../../db/src/store.ts#L330)), sin `else`, así que los tres casos medidos caen del
  mismo lado — `true` para staff, `false` para `cliente` y **`NULL`** para quien no tiene membresía (un
  usuario sin membresía **no** da `false`: `app.current_role()` es NULL y `NULL in (…)` es NULL; medido en
  los dos majors, 16.4 y 18.3). Como vive en la única definición que usan `getRun`, `listRuns` y
  `listAllRuns`, el próximo endpoint que lea runs lo hereda. `RunSummary.coste_micros_usd` es ahora
  `number | null`, y el portal **no pinta la línea** cuando falta: `$0.00` afirmaría que el research fue
  gratis.
- ~~**El entregable que la agencia le pasa al restaurante no existe.**~~ ✅ **Existe desde el 2026-08-07**:
  `GET /runs/:id/entregable.md` (solo staff, con el 404 decidido por Postgres) más una vista imprimible en
  el portal. Es el informe **sin el bloque de coste**, y ese bloque **no se genera** —
  `renderReport(brief, { incluirCoste })` con el parámetro obligatorio y sin default—, no se oculta: taparlo
  en la vista habría mandado el margen al navegador igual. Cierra el **PDF** de ADR-07, por la vía del
  navegador (`@media print` + Ctrl+P) y sin dependencias nuevas. Ver
  [la spec](../superpowers/specs/2026-08-07-entregable-restaurante-design.md) y la nota fechada en ADR-07.
- **Sin tests de integración**: el camino live se ejecutó a mano contra DataForSEO, OpenAI y
  Storyblok, pero no está automatizado.
- **Calidad del research**: las tres mejoras están implementadas (2026-08-02) pero **sin calibrar
  contra datos reales** — `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` son
  defendibles por construcción, no barridos como sí lo está `CLUSTER_SIM_THRESHOLD_DEFAULT = 0.75`.
  Barrerlos es **gratis en cuanto exista el dataset** (KR-1). Y `TIPOS_MAP_PACK` (`local_pack`,
  `map`) **no está verificado contra la API real**: si estuviera mal, `is_local` saldría `false` para
  todo — falla hacia el lado conservador, pero KR-3 no estaría arreglando nada.

### ⚪ 5. Lo que ni siquiera empezó

El PRD describe cuatro módulos. **Están hechos el 1 y el 2** (Creador de Webs y Keyword Research).
Los otros —tablero tipo Trello, mensajería, dashboards, los agentes de contenido social— no tienen
ni una línea. Con OBS-01 cerrada, eso ya no es una incógnita sino una decisión: el **módulo 3** (respondedor de reseñas de Google) es lo único del alcance base sin construir; el calendario de redes y el gestor de tareas quedaron en **línea futura**, fuera del presupuesto inicial.

---

## Roadmap

### 🔴 Lo que depende de Juan

**Lo que hay ABIERTO hoy (2026-08-08):**

| Tarea | Por qué depende de él | Costo |
|---|---|---|
| **Regenerar el dataset crudo** (KR-1) | Gasta dinero real contra DataForSEO. Llena los tres `n/d` del informe, calibra dos parámetros hoy sin dato y las estimaciones de `lib/budget.ts` | **~$0.31**, ~16 min. **Volver a sandbox después** (`kr-service/.env`) |
| **Verificar si Railway ofrece un token de SOLO LECTURA** | El token ya está en `credenciales.env` (2026-08-08) y con eso **A3 está desbloqueado**. Lo que queda es una decisión suya: hasta donde sabemos Railway no tiene scope read-only, así que lo guardado podría ser un token **con escritura** sobre la infraestructura — y eso cambia el riesgo, más con la exposición de credenciales abierta. La alternativa sin credencial nueva es que el comparador use la sesión del CLI | — |
| **Rotar las credenciales expuestas** | Solo él puede. Pospuesto por decisión propia el 2026-08-04; sigue abierto, no cerrado | — |

~~**Desplegar el orquestador** (tramo B)~~ — ✅ **hecho el 2026-08-07.** Era la última pieza de Fase 2
sin desplegar; con ella, el pipeline real corrió en producción por primera vez.

~~**Desplegar la `0018` y la `0019`**~~ — ✅ **hecho el 2026-08-08.** Al primer intento falló
(`must be able to SET ROLE "app_barrido"`) y se revirtió sola; con el arreglo, las dos aplicaron. El
barrido ya corre y `approveRun` exige la marca.

~~**Poner `WEB_PUBLISH_MODE=storyblok` y `STORYBLOK_DRY_RUN=1`**~~ — ✅ **hecho el 2026-08-08**, en el
orquestador. **Sin token de Storyblok, y a propósito**: en dry-run el token no se usa
(`publisher.ts` corta antes), así que su ausencia es una segunda red independiente de la variable.

Y el detalle de lo que queda, por bloques y con el orden razonado, en
[**15-plan-plataforma.md**](15-plan-plataforma.md) — que es el plan de la fase en curso.

**Lo que se cerró antes** — todo lo que dependía de cuentas, saldo y credenciales **para la demo con
Frank**. Las cuatro:

| Tarea | Por qué | Costo |
|---|---|---|
| ~~Unificar el alcance (OBS-01)~~ | ✅ **Hecha (2026-07-19).** Manda [`docs/historia/contexto-proyecto-frank.md`](../historia/contexto-proyecto-frank.md); alcance base = 3 módulos; ADR-04 se mantiene. | — |
| ~~`SUPABASE_JWT_ISS` en Railway~~ | ✅ **Hecha (2026-07-27).** Cargada antes del merge; la API arrancó con ella. `SUPABASE_JWT_SECRET` se **deja** en Railway a propósito: es la red de rollback (el código viejo la exige para arrancar) y no molesta, porque `leerConfig` ya no la lee. | — |
| ~~Verificar el login en el navegador~~ | ✅ **Hecha (2026-07-30).** Era lo único que podía cerrar la pieza A. Queda **sin verificar** el detalle del logout: que revoca en Supabase (Auth → Users → Sessions) y que es **local** (cerrar sesión en un dispositivo no cierra la del otro). Lo cubren 7 tests, pero no se miró en producción. | — |
| ~~**[Corrida final + republicar](../historia/acciones/06-corrida-final-demo.md)**~~ | ✅ **Hecha (2026-07-30).** Publicado `kr.v0.5` para La Birra Bar (cliente real), verificado en el navegador. De paso: se midió la duración real del research (16m15s) y se cerró el gap de `DATABASE_URL_CACHE` que la guía no pedía. | $0.3097 |

### Tanda 3 — PROD-readiness ✅ COMPLETA

| # | Hecho | Qué cambió |
|---|---|---|
| ✅ **#5** | Costo completo + presupuesto preflight | El costo suma DataForSEO + LLM (con desglose) y `max_cost_micros` **aborta antes de gastar**. Contrato `kr.v0.3`. |
| ✅ **#11** | Timeouts, retries y backoff | `lib/http.ts`: timeout por intento, backoff exponencial + jitter, `Retry-After`, 429/5xx reintentables y 4xx no. El clustering **ya no aborta** por un fallo de SERP. |
| ✅ **#12** | Idempotencia | `_uid` **deterministas** (misma página → mismos uids entre corridas) y **upsert** que resuelve la carrera de creación sin duplicar stories. |
| ✅ **#6** | `AnthropicContentGen` | Los tres proveedores implementan la misma interfaz: cambiar de proveedor ya **no degrada capacidades**. |

**Lo que queda del código está listo para envolverse en Inngest**
([ADR-03](../decisiones-arquitectura.md)): retries, idempotencia y presupuesto ya existen, que era
justo lo que un orquestador durable necesita como base. Y los tres se ejercitaron contra servicios
reales, no solo contra tests.

### Tanda 4 — Corridas reales ✅ COMPLETA

| Hecho | Qué cambió |
|---|---|
| **Métricas ausentes ya no mienten** | `volumen`/`dificultad` son nullable; el informe muestra `n/d`. Contrato `kr.v0.4`. |
| **Dedupe canónico antes de pagar** | Los duplicados de casing ya no se le facturan a DataForSEO. |
| **Clustering recalibrado (0.55 → 0.75)** | Con datos reales: 3 páginas → **8 páginas**. |
| **Dataset crudo persistido** | Ajustar scoring/clustering es gratis, sin pagar otra corrida. *(El destino era `out/`, gitignoreado, y el dataset se perdió; desde el 2026-08-02 va a `datasets/`.)* |
| **Tope de gasto en el CLI** | `MAX_COST_USD=1.00 npm run spike` aborta antes de gastar. |

### Fase 2-3 — Plataforma

| Pieza | ADR | Estado |
|---|---|---|
| **Persistencia + multi-tenancy** (Postgres, RLS por `tenant_id`) | ADR-01, ADR-10, ADR-13 | ✅ **Hecho.** Esquema, RLS con `FORCE`, cache de métricas/SERP con `expires_at`, y **204 tests** contra Postgres real (PGlite). Acceso solo por transacción con conexión reservada. |
| **Orquestación con Inngest** | ADR-03, ADR-12 | ✅ **Hecho.** `waitForEvent` para la compuerta humana, concurrencia global (el rate limit de DataForSEO es por cuenta), idempotencia por `runId`, `onFailure` que no deja runs colgados. |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Hecho.** Hono. Crea el run bajo RLS (ahí se autoriza) y emite el evento; comandos compuestos, CORS, login `amg_api`, JWT con `exp`/`aud`/`alg` impuestos. **113 tests** contra PGlite. Desde la pieza A la firma se verifica contra el **JWKS público** del emisor (ES256), sin secreto compartido, y un fallo de infraestructura responde **503** en vez de confundirse con un token inválido. |
| **Portal Angular** | ADR-16, ADR-21 | ✅ **Hecho** (funcional). Login + lista + brief por evidencia + compuerta doble + refresh del token + polling, y las carreras asincrónicas cerradas (`Vigencia`). **344 tests** (237 de núcleo `node:test` + 107 de componente Karma, las pantallas de research incluidas); el flujo, verificado en un navegador real. **Falta:** calibrar el polling contra los 16m15s medidos. |
| **Renderizador público** (la web del cliente) | ADR-19, ADR-04 | ✅ **Hecho.** `renderer/`: 1 servicio, N dominios. Hono, lee la Content Delivery API y sirve `renderStory()`. Cache con invalidación por webhook firmado, preview firmado + Bridge para el Visual Editor, y el rol de BD más pobre del sistema (`app_render`, sin escritura). Endurecido tras la 10ª review (límites del camino anónimo, timeouts de BD, replay). **114 tests**; **verificado contra el Storyblok REAL** con `npm run demo -w renderer`. ✅ **Desplegado el 2026-08-01** en Railway (servicio aparte del de la API): sirve `amg-renderer-production.up.railway.app` leyendo de Supabase con `amg_render` → `app_render`, verificado en el navegador. **Falta:** el dominio propio del cliente (el plan de Railway está en su límite de custom domains) y una CDN delante. |
| **Diseño de las webs** (marca + imágenes + navegación) | ADR-04, ADR-11 | ✅ **Hecho.** Tema por tenant (color/fuente/logo desde `business_profile.brand`, allowlist en `0009`) → cada web se ve **propia**. Imágenes editables en los bloks `hero`/`section` (campos `asset`). **Nav fijo de 4 secciones** (Inicio/Menú/Ubicaciones/Contacto, cada una condicionada a que el perfil tenga el dato — reemplaza a la barra vieja derivada de las páginas SEO publicadas) + **footer compartido** con NAP multi-local (`locations`) y link a Blog + `/menu`/`/blog` sintetizados desde el perfil (allowlist en `0010`, ver [spec](../superpowers/ejecutados/2026-07-31-navegacion-sitio-cliente-design.md)) + **home sintetizada** en la raíz (la raíz ya no da 404; si el cliente crea su `home`, esa gana). Validación anti-inyección en tres capas, también en el `name`/`slug` de la nav y en NAP/carta. **Falta (deuda):** republicar desde un brief pisa las imágenes que suba el cliente — **el nav/footer/menú/blog YA NO dependen del brief**: se calculan en vivo desde `business_profile` en cada request, así que republicar no los toca. **Lo "hecho" es la infraestructura de marca, no el aspecto:** las landings publicadas se ven sin terminar (ni una foto, CTA que es un párrafo, siete secciones idénticas) y eso tiene su propio diseño — [spec de plantillas de landing](../superpowers/specs/2026-08-01-plantillas-landings-design.md), tres entregas. **Enmendado el 2026-08-02** con el **manual de marca** (tokens de color y roles tipográficos self-hosted, en vez de los tres campos actuales) y el **rediseño de la carta** (categorías con foto, precios por ración), tomando como referencia visual un template real de restaurante sin adoptar ni una línea suya. **Entrega 1 ✅ (2026-08-08)**: las **tres primeras fronteras** que cruza un campo del perfil —Zod en la puerta, la allowlist `app.nap_publico` de la migración `0014`, y `perfilValido`— ya dejan pasar `portada`/`fotos`, el manual de marca (6 tokens de color, 3 roles tipográficos, `plantilla`) y la carta con `precios`/`nota`/`foto`/`menu_categorias`, con sus topes (30/3/20) y los cinco productores de perfil al día. **Entrega 2 ✅ (2026-08-08)**: `html.ts` pasa de **751 líneas a 177** — las cuatro funciones que repetían cada una su propio `<head>`, `<style>` y pie son ahora cuatro **recetas** del mismo ensamblador, sobre un **shell fijo** y un catálogo de **9 piezas** (una por archivo, con su CSS aislado bajo una clase raíz que un test impone mecánicamente). El CSS de una pieza que no dibujó nada **no viaja**. El gate fue **paridad de contenido** contra 10 fixtures capturadas *antes* del refactor —texto visible, `href`, `id` de ancla, JSON-LD y la traza de research— y el sitio no cambió. **Entrega 3, mitad A ✅ (2026-08-08)**: los **cinco arreglos visuales** (modo oscuro completo, el doble borde de la carta, los enlaces del pie, el contraste del acento derivado en CSS con `color-mix`, y el CTA largo que baja a bajada) y **los 9 tokens de marca consumidos de verdad** — la web de un cliente ya no se distingue solo por un color de acento. Con **dos capas de tokens**: los `--marca-*` dicen lo que dice la ficha, y una capa semántica en medio es la que consumen las piezas, para que corregir el contraste en oscuro sea un derivado y no una reescritura del valor del cliente. **Mitad C ✅ (2026-08-08)**: las **tipografías self-hosted**, servidas *y* pedidas por el CSS. Cuatro familias SIL OFL 1.1 con su licencia commiteada, subsets latinos en `woff2` (148 KB), desde una ruta `/_assets/fonts/` que lee de un `Map` en memoria y falla cerrado al arrancar; el `<style>` emite las `@font-face` **solo de las familias que la página usa** y el `<head>` un `preload` de **una sola** —la de titulares, con `crossorigin`, sin el cual el navegador descargaría el archivo dos veces sin avisar en ningún log—. Verificado en el navegador: 4 peticiones de fuente, **ninguna repetida**, cero hojas externas, y la ficha legacy `{color, font}` sale con **cero** `@font-face` y **cero** preloads (la web sembrada no cambia de aspecto). Cuatro garantías que estaban escritas y que no sostenía nada aparecieron **mutando**: dos tablas de stacks que discrepaban en `moderna` (unificar hacia la equivocada habría cambiado la tipografía de toda ficha sembrada con ese valor), el agujero de prototipos reabierto en `fuentes.ts` (`stackDe("toString")` devolvía `Object.prototype.toString`), las dos allowlists separadas solo por un comentario, y el test de «cero terceros» que pasa feliz recorriendo cero `url()` — este último va ahora con un test de no-vacuidad que lo acompaña. **Mitad B, parte 1 ✅ (2026-08-09)**: la **§Política de imágenes**, puesta *antes* de dibujar una sola foto. Allowlist de hosts **en el código** (`a.storyblok.com`), comparación **exacta** contra un `Set` sobre `new URL(...).hostname` —con los siete casos nominales escritos uno a uno: sufijo, subcadena, userinfo, `http:`, protocol-relative, `javascript:` y el positivo—, `referrerpolicy="no-referrer"` en cada `<img>` y un tope global de **60 imágenes por documento** cuyo contador nace y muere con el documento (si viviera en el módulo, el renderizador serviría la primera web con fotos y todas las siguientes sin ellas, y ningún test lo vería). **Tres premisas resultaron falsas por el camino**: no había un emisor de `<img>` sino tres —`renderImagen`, el **logo** (que aparece en TODAS las páginas, así que es el peor) y `og:image` con el `image` del JSON-LD—, y el gate de paridad resultó **ciego** a `referrerpolicy`, así que no cayó ninguna fixture. A `og:image` se le exige **https y nada más**: aplicarle la allowlist tumbó cinco fixturas porque la imagen social vive normalmente en el dominio del propio cliente, y ahí la allowlist no defiende de nada (la pide el crawler al compartir, no el visitante). **Mitad B, parte 2 ✅ (2026-08-09)**: las **seis piezas que dibujan las fotos**. `heroPortada` sustituye a `hero` en la receta de landing (sin foto **degrada a hero tipográfico, no a un hueco** — y ése es el estado de todas las fichas de producción, que no tienen una sola foto); `barraDatos` y `ctaFinal` entran en las **tres** páginas de negocio y no solo en la landing, porque el problema que la spec describe —teléfono y horarios enterrados en el pie— no se arregla si el arreglo llega solo a la landing; `cartaCategorias` **reemplaza y retira** a `carta`, que se quedaba sin ninguna receta que la nombrara. `--marca-secundario`, que la mitad A dejó emitido y sin consumidor por fallar AA como texto (2.62:1), entra ahora por `--decorativo` en **tres filetes decorativos** y nunca en texto. Se arregló además una regresión de rendimiento que la propia entrega introducía: la foto de portada es el **LCP** de toda landing y salía con `loading="lazy"` — ahora va con `fetchpriority="high"` y es la única imagen prioritaria del documento. **Verificado en un navegador** (el gate que sustituye a la paridad en esta entrega): con fotos en claro/oscuro y escritorio/móvil, **sin fotos**, y con foto rota; contraste medido sobre el HTML servido en oscuro — precio **5.36:1**, etiqueta 7.18:1, título 15.41:1. **El gate de paridad se cierra acá y queda re-capturado** (con autorización explícita, porque el comando está en `permissions.deny`): 7 de sus 10 casos cambian a propósito. Antes de re-capturar —única ventana en que la prueba es posible, porque después el gate se compara consigo mismo— se midieron los cinco rostros de `git show HEAD:<fixtura>` contra el disco en los diez casos: **cero palabras, cero `href` y cero `id` perdidos, JSON-LD y traza idénticos**, con tres casos a **+0/+0** como señal de control (`landing-sin-perfil` y los dos de `/blog`; su HTML sí cambia por CSS y clases, sus rostros no). **Una salvedad que el contador no ve y los ojos sí**: en `/menu` el precio se **reordenó** —de ir tras el nombre a ir tras la descripción, porque el layout nuevo lo lleva a su columna—, sin perder ninguna palabra; queda declarada en vez de congelada sin nombre. **Las fotos ya están en Storyblok** (space `293831091573700`, host `a.storyblok.com`; las URLs, en el README de `docs/plantillas/template1/`) — y este documento afirmaba que la mitad B las necesitaba para empezar, lo cual **era falso**: los tests del render no descargan nada, así que una URL inventada del host de la allowlist ejercita las piezas igual. Lo que las fotos desbloquean es **verlo en un navegador**, el último paso de la mitad B. **Ampliadas el 2026-08-09** (`0da56cd`): la portada se reemplazó por una **sin la marca incrustada** (salía dos veces, una en la cabecera y otra quemada en el JPG) y se subieron **seis** fotos de galería y **una por categoría** donde había una sola repetida — con eso deja de ser "sirve para ver la rejilla". De ahí salieron tres cosas que la foto repetida escondía: **(a)** ⚠️ **reemplazar un asset en Storyblok CAMBIA la URL** —la portada vieja devuelve `403 AccessDenied`, verificado con `curl`—, así que sustituir una foto no es editar un archivo y toda ficha que guarde la URL anterior se queda con un `<img>` roto **sin que nada avise** (síntoma: la portada colapsa a 26 px y no hay error en ningún log); **(b)** la rejilla de galería es de 4 columnas, así que 6 fotos quedan 4+2 en escritorio (en móvil son 2 columnas y no se nota); y **(c)** la cabecera de categoría es más alta que el contenido cuando la categoría tiene un solo plato. **Deuda descubierta al medirlo, preexistente:** el logo se dibuja a **250×250, su tamaño natural, con `max-height: none`** — sin tope, ni en escritorio ni en móvil, donde ocupa el 64 % del ancho de una pantalla de 390 px. El README de `template1` afirmaba "unos 40 px de alto" y era falso. No se manifiesta en producción porque **ninguna ficha real tiene logo** (comprobado en `db/src/seed-demo.ts`); el arreglo es un tope en el CSS de `cabecera` con su test. |
| **La costura publish→serve** (`fromStoryblokContent`) | ADR-19 | ✅ **Hecho.** El contenido que Storyblok guarda está **aplanado** y `renderStory` esperaba la forma anidada → daba 503. Lo cazó la demo, no un test (era OBS-03: nadie leía de vuelta lo publicado). Adaptador inverso + tests de ida-y-vuelta. |
| **Export estático / offboarding** | ADR-11 | ⏳ Pendiente. Snapshot estático incluido; handoff editable como servicio pago. El preview HTML actual es la base. |
| **Autorización derivada** (OBS-02) | ADR-15, ADR-17 | ✅ **Hecho.** El rol se deriva de `memberships` dentro de Postgres; el GUC `app.role` ya no lo lee nadie. Un login por proceso, `NOINHERIT`, un rol cada uno — ahora **cuatro**: `amg_api`, `amg_orquestador`, `amg_cache` y `amg_render`. El JWT de Supabase **ya está enchufado y probado** (**27 tests** en `auth.test.ts`, con tokens firmados de verdad, ES256 contra un JWKS local). |
| **Idempotencia de peticiones facturables** | ADR-10, ADR-14 | ✅ **Hecho.** `kr_provider_tasks` + `payload_hash`, escrito ANTES de enviar: cubre el **100%** del gasto. **Además**, SERP y Search Volume (46%) usan el **método Standard** (`task_post`/`task_get`): la tarea pagada se **recupera gratis**, así que una respuesta perdida no es dinero perdido. Labs (54%) es live-only → ahí una petición ambigua detiene el run. |

### Mejoras de calidad del research (priorizadas con los datos reales)

**Las tres primeras eran pre-demo** desde el 2026-08-01 y están **implementadas el 2026-08-02**; las
dos últimas quedan fuera. Lo que **sigue dependiendo de KR-1** no es implementarlas sino
**calibrarlas**: sin el dataset crudo, los parámetros nuevos son juicio y no medición.

| Mejora | Estado | Qué la motivó, y qué quedó |
|---|---|---|
| **`is_local` por señales del SERP** (presencia de *map pack*) en vez de inferirlo por LLM | ✅ **Hecho** — `pipeline/local-signal.ts` | **53 de 60** keywords salieron `is_local` → 7 de 8 páginas como `LocalBusiness`. Ahora el map pack pisa la conjetura del LLM, pero **solo cuando se observó** (`mapPack: null` respeta al LLM: tratar "no observado" como "no local" sería el mismo error que `volumen ?? 0`), y solo en las ~15 cabezas cuyo SERP se paga. **Falta:** verificar `TIPOS_MAP_PACK` contra la API real (~$0.003). |
| **Usar `score_confidence` al ordenar páginas** | ✅ **Hecho, y desde el 2026-08-04 llega al portal** | 5 de 8 páginas no tienen volumen, y el 40% del score no depende de datos de mercado. El orden es en dos niveles: evidencia, y dentro de cada grupo `score × (1 − P + P·confianza)` con `PESO_CONFIANZA_ORDEN = 0.5`. Esta fila decía *"no llega al portal: lo pisan `db` y el portal"* — **era cierto y dejó de serlo** con la migración `0015`, que convierte el orden en un dato (`kr_pages.orden_brief`) en vez de recalcularlo al leer. Lo que **sigue** pendiente es **calibrar** `PESO_CONFIANZA_ORDEN`, que necesita el dataset (KR-1). |
| **Normalizar el volumen por percentiles del mercado** en vez del máximo del run; winsorizar outliers | 🟠 **Hecho a medias, a propósito** | Con un solo pico (1300) el resto se aplasta. Ahora el tope es el **percentil 90 del run** (`VOLUMEN_PERCENTIL_TOPE`) y todo lo que lo supera satura: eso arregla el aplastamiento. Lo que **no** se hizo es "del mercado": la escala sigue siendo relativa a cada corrida, así que los scores no son comparables entre runs. Una distribución cruzada necesita el dataset (KR-1). |
| **Estrategia hub & spoke** en el mapeo cluster→página | ⚪ No | Hoy todo es `single`. |
| **Enlazado interno** entre las páginas propuestas | ⚪ No | Hoy `enlazado_interno` sale vacío. |

---

## Deudas técnicas conocidas

| Deuda | Dónde | Impacto |
|---|---|---|
| **El secreto legacy de Supabase sigue vivo, y no se puede revocar sin migrar antes el portal** | Supabase (Project Settings → API) · `portal/src/environments/environment.prod.ts` | Con ese secreto se puede acuñar un token `service_role` que **bypassea RLS por completo** — el radio de daño no depende de que nuestra API ya no lo acepte. Pero **no se puede revocar sin más**: el `anon key` del portal es un JWT legacy firmado con él (`alg: HS256`, verificado), así que revocarlo rompe el login. Hay que migrar el portal a las claves nuevas (*publishable*), desplegar, verificar, y recién ahí revocar. Ver [12-credenciales.md](12-credenciales.md). |
| ~~**La compuerta de secretos dejaba pasar la carpeta de secretos empaquetada**~~ ✅ **cerrada (2026-08-03)** | `scripts/secretos.mts` | Dio **verde durante tres días** con `docs/private.zip` trackeado en un repo público (ver Riesgos abiertos). La causa no era que no mirara *dentro* del zip —decide por ruta, a propósito—: la regla de `docs/private/` comparaba el **segundo segmento de directorio**, y ahí `private.zip` era el **nombre del archivo**, así que ninguna regla lo miraba. Mismo error conceptual que tenía el `.gitignore`. Cerrado con dos reglas y dos tests: `docs/private*` como nombre, y **cualquier comprimido versionado** —opaco para un detector que decide por ruta—. Las dos caen por mutación. |
| ~~**Esquema Zod duplicado** entre M2 y M1~~ | ✅ **cerrada el 2026-08-05 (KR-2a)** | El contrato vive en `contrato/` (7º workspace). `kr-service/src/validation/brief.schema.ts` **se borró**. |
| **Estimaciones del presupuesto sin calibrar** | `lib/budget.ts` | Las **tarifas de los modelos están verificadas** ✅, pero las estimaciones por fase **siguen a ojo**. Se calibran con `datasets/keywords.json` — **que hoy no está** (ver KR-1 en §2.b): la promesa de "calibrar es gratis" depende de regenerar ese dataset. |
| **🟠 El dataset crudo del research no existe** | `datasets/keywords.json` | ✅ **El destino ya es durable** (versionado, con un test que se lo pregunta a `git check-ignore`). Lo que falta es **el dato**: el de la corrida del 2026-07-30 se perdió en `out/` y regenerarlo cuesta ~$0.31 en producción. Bloquea la **calibración** de las tres mejoras de calidad (§2.b) y la del presupuesto — ya no su implementación. |
| **El orden del pipeline no sobrevive a la persistencia** | `db/src/store.ts:715,743` · `portal/src/app/core/cartera.ts:37` | `kr-service` ordena por evidencia y confianza; la base y el portal reordenan por `opportunity_score` crudo. La columna "Confianza" del dashboard sigue sin ordenar nada. Detalle y las dos salidas, en §2.b. |
| **`gpt-4o` quedó legacy** | `config.ts` (`OPENAI_MODEL`) | Los modelos actuales son 2-3× más baratos. **Pero la corrida real bajó la urgencia**: el LLM es solo el **19%** del costo, así que el ahorro total sería de ~10%. Ver [guía 02](../historia/acciones/02-precios-modelos.md). |
| **`is_local` sigue siendo conjetura fuera de las cabezas observadas** | `pipeline/enrich-content.ts` (LLM) · `pipeline/intent.ts` (heurística) · `pipeline/local-signal.ts` | ✅ Desde el 2026-08-02 el **map pack** del SERP corrige `is_local`, pero **solo en las ~15 cabezas** cuyo SERP se paga (`serpValidateTop`). Para las otras ~45 keywords sigue decidiendo el LLM o la heurística, que sobre-detecta (53 de 60 en la corrida real). Pesa menos de lo que pesaba —es la **cabeza** la que fija el `schema_type`—, pero el dataset crudo conserva `is_local` sin validar en la mayoría de sus filas. ⚠️ **Y las páginas no están cubiertas del todo:** `max_pages` vale 25 por defecto y `serpValidateTop` 15, y como el mapeo reordena por evidencia, un cluster de la posición ≥16 con datos de mercado puede subir a página **con la cabeza sin observar**. Con 8 páginas no muerde; con más clusters compitiendo, sí. |
| **Sin tests de integración** | — | El camino live ya **se ejecutó a mano** contra DataForSEO, OpenAI y Storyblok, pero no está **automatizado**. |
| **Una rotación de Supabase a otro algoritmo daría 401, no 503** | `api/src/auth.ts` (`CODIGOS_DE_TOKEN`) | `ERR_JOSE_ALG_NOT_ALLOWED` es un código de token, así que si el proyecto pasara a RS256 todos los logins fallarían **y quemarían refresh tokens**. Hoy el JWKS sirve una sola clave ES256 (verificado). Si Supabase anuncia un cambio de algoritmo, hay que tocar `algorithms` antes, no después. |
| **Durante una caída del JWKS, cada request paga el timeout de 5 s antes de su 503** | `api/src/auth.ts` (`jwksDeSupabase`, vía `crearDeps`) | El caché vence a los 10 minutos y `_local` solo se reemplaza cuando el fetch tiene éxito, así que cada petición secuencial reintenta. Falla cerrado y es correcto, pero se lee como un cuelgue. Si molesta, el lugar para afinar `timeoutDuration`/`cacheMaxAge` es `crearDeps` — con una medición, no a ojo. |
| **El session pooler de Supabase (5432) puede rechazar la primera conexión de un rol recién usado** | `docs/private/credenciales.env` (`DATABASE_URL_*`) | Descubierto con `amg_cache`: password recién puesta y confirmada por `pg_roles`, y aun así `password authentication failed` por el session pooler — es Supavisor, no la credencial (`amg_api` seguía andando en paralelo por el mismo host). El **transaction pooler (6543)** conectó al toque. Si `amg_orquestador` o `amg_render` hacen su primera conexión real y da el mismo error, probar 6543 antes de sospechar de la password — siempre que el código solo use transacciones autocontenidas (`pool.transaction()`, sin `SET LOCAL` de sesión ni `LISTEN`, que es el caso de `PgTaskLog`). |

## Riesgos abiertos

### 🔴 Credenciales expuestas en el repositorio público · **ABIERTA (detectada 2026-08-03)**

`docs/private.zip` estuvo **commiteado en `origin/main`** desde el commit `15ae91a` (2026-08-01), y el
repositorio es público. Adentro viajaban `credenciales.env` —el maestro— y los cinco `.env` de backup
de los paquetes: `SUPABASE_JWT_SECRET`, los tres `DATABASE_URL_*`, `DATAFORSEO_PASSWORD`, las keys de
Anthropic y OpenAI, y el `STORYBLOK_MANAGEMENT_TOKEN`.

**Por qué pasó:** el `.gitignore` tenía `docs/private/` (con barra), que **no cubre** un archivo
`docs/private.zip`. Ya se corrigió, con los cuatro patrones de comprimido.

**Por qué el arnés no lo vio, y ya está tapado (2026-08-03).** `npm run verificar` daba **verde en la
compuerta de secretos** con ese archivo trackeado. La causa exacta: `scripts/secretos.mts` decide por
ruta —a propósito— y su regla de `docs/private/` comparaba el **segundo segmento de directorio**;
para `docs/private.zip` ese segmento no existe, porque `private.zip` es el nombre del archivo. Ninguna
otra regla lo miraba. **Es el mismo error conceptual que tenía el `.gitignore`**: prohibir la carpeta y
olvidar el archivo que se llama igual, en los dos lugares que tenían que atajarlo. Cerrado con dos
reglas nuevas y sus tests, verificadas por mutación (ver la deuda tachada arriba).

**Qué se hizo y qué falta.** Hecho: `git rm --cached` del zip y el `.gitignore` blindado. **Falta la
rotación**, que es la única cosa que devuelve la seguridad: el objeto sigue en el historial de GitHub
por decisión tomada —purgarlo no des-expone, porque hay forks, clones y cachés—, así que **todo lo que
estuvo en ese zip hay que tratarlo como comprometido**. La lista priorizada, con el orden por daño y
dónde se rota cada una, está en [`../../progress/current.md`](../../progress/current.md).

### 🔴 OBS-04 — Quién edita la web no lo gobierna nuestro RBAC · **ABIERTA (2026-08-01)**

Con el Visual Editor ya funcionando en producción, quedó a la vista una frontera que ningún ADR
había nombrado: **el portal y Storyblok son dos sistemas de identidad que no se cruzan.** Nuestro
RBAC se deriva de `memberships` dentro de Postgres (ADR-15); el de Storyblok son seats y permisos
por space. Nada los sincroniza, así que **quién puede reescribir la carta de un restaurante lo
decide la lista de colaboradores del space**, no `memberships`.

ADR-04 ya respondió esto entre líneas —eligió Storyblok *"para que community managers/creadoras
editen sin devs"*— pero quedó implícito, y de ahí cuelgan dos cosas que no pueden colgar de un
implícito: **el número de seats** (fijos si edita solo la agencia; uno por cliente si no) y la
cláusula de *handoff editable* de **ADR-11**, que no se puede redactar sin saber qué acceso tenía el
cliente **durante** el servicio.

Las tres salidas y la decisión adyacente —un botón *"Editar la web"* en el portal que firme el
enlace de preview al vuelo— están en
[OBS-04](../decisiones-arquitectura.md). **No urge decidirlo hoy**, pero bloquea llevar ADR-11 a un
contrato.

### ✅ OBS-01 — Solapamiento de alcance · **CERRADA (2026-07-19)**

Era el último riesgo de producto abierto. Los dos documentos describían alcances distintos
(`docs/historia/contexto-proyecto-frank.md`: 4 módulos con "Frank"; el PRD: 5 agentes con "Franco · CEO", y el
Creador de Webs "diferido a I+D"). **Decidido:**

- **Manda `docs/historia/contexto-proyecto-frank.md`.** El PRD queda como visión de largo plazo.
- **Alcance base: 3 módulos.** El 4 (calendario de redes / Trello) pasa a línea futura.
- **El Creador de Webs va en la propuesta base**, y **ADR-04 se mantiene** (Storyblok, no WordPress).

**Dos de los tres módulos base ya están construidos.** Eso cambia la conversación comercial: el
presupuesto deja de ser *"cuánto cuesta construir esto"* y pasa a ser *"cuánto vale esto, que ya
funciona, más un módulo por hacer"*.

| Módulo | Estado |
|---|---|
| 1 — Creador de Webs | ✅ Construido, de punta a punta |
| 2 — Keyword Research | ✅ Construido, corrido en producción (**$0.31**/research) |
| 3 — Respondedor de reseñas (GBP) | ⛔ Sin empezar — lo único del alcance base por construir |

Registrado en [decisiones de arquitectura](../decisiones-arquitectura.md).

### Costo de Storyblok

El precio por space/seat crece con la cartera de clientes (ADR-04 exige **un space por cliente**
para un offboarding limpio). Hay que contemplarlo en la propuesta: lo absorbe la agencia o se
traslada al cliente.

**El número de seats no se puede estimar hasta cerrar OBS-04** (arriba): si edita solo la agencia
son unos pocos y fijos; si edita cada cliente, crece con la cartera igual que los spaces.
