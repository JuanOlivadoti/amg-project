# 11. Plan de la Fase 2 — plataforma

> **Este documento responde tres preguntas: de dónde venimos, dónde estamos exactamente ahora, y
> qué falta.** Si retomás el proyecto, empezá por acá.
>
> Última actualización: **2026-08-01** · **539 tests en verde** (monorepo) + **130** en el portal
> (113 `node:test` + 17 Karma)
>
> **Dónde estamos hoy:** Fase 1 desplegada y la **pieza A cerrada** — la verificación ES256 contra el
> JWKS y el logout que revoca están en `main`, desplegados, y **el login se verificó en el navegador**
> (2026-07-30). Eso último es lo que la cerró: desde afuera no había señal que distinguiera el código
> viejo del nuevo (`/health` responde igual y un token basura da 401 en ambos), así que "desplegado"
> no era "arreglado". La **pieza B** (modo oscuro del portal por tokens semánticos) está **cerrada:
> mergeada a `main`**, y de paso el portal migró a Tailwind v4
> ([spec](../superpowers/specs/2026-07-30-modo-oscuro-portal-design.md) ·
> [plan](../superpowers/plans/2026-07-30-modo-oscuro-portal.md)). La **pieza C** (dashboard de
> cartera) también está **cerrada: mergeada a `main`** (2026-07-31) — esqueleto de shell + `/cartera`
> sobre datos de muestra, 13/13 tasks del plan más el review final de rama aplicado
> ([spec](../superpowers/specs/2026-07-30-dashboard-ui-portal-design.md) ·
> [plan](../superpowers/plans/2026-07-30-dashboard-ui-portal.md)); el detalle task-by-task vive en
> `.superpowers/sdd/progress.md`. Pendiente sin bloquear el cierre: verificación manual en navegador
> de `/cartera` y del drawer mobile (el MCP de chrome-devtools no conectó durante la implementación).
> La **Acción 06** (corrida final + republicar) también se cerró el mismo día: research real contra
> producción, `kr.v0.5` publicado para La Birra Bar y **la duración real medida por primera vez
> (16m15s)** — dato que desaconseja la pieza D tal como se había imaginado (research en vivo durante
> la demo). **Con A/B/C cerradas, D desaconsejada y la Acción 06 hecha, la demo está lista para
> mostrarle a Frank.**
>
> **Nuevo (2026-08-01): la navegación del sitio del cliente, mergeada a `main`.** 10 tareas (ver
> §6.1 más abajo), una revisión de rama y una revisión externa (Codex) con 4 hallazgos reales
> corregidos. 516 tests (subió de 466). Ver §5.3 y el [estado y roadmap](09-estado-y-roadmap.md).
>
> **Nuevo (2026-08-01, más tarde): el cliente de la demo, unificado.** Las tres pantallas del
> recorrido hablaban de tres negocios distintos —dashboard con seis restaurantes inventados, brief con
> el italiano de ejemplo, web con La Birra Bar—, así que la demo se contradecía a sí misma en tres
> clics. Ahora el seed (`sembrarDemo`, antes `sembrarBellaNapoli`), el dashboard y el `dev-server` de
> la API son **el mismo cliente**, con el perfil del seed **atado por test** a
> `web-builder/business-profile.json`. De paso destapó que el perfil sembrado no tenía `locations` ni
> `menu` (la web habría salido sin Ubicaciones y con `/menu` en 404) y que su `font` no estaba en la
> allowlist. **518 tests**, 124 en el portal, y `/cartera` + el drawer mobile **verificados en el
> navegador** —el pendiente que había quedado abierto—. Ver
> [estado y roadmap § la demo](09-estado-y-roadmap.md).
>
> ✅ **El paso operativo que faltaba está hecho: producción re-sembrada el 2026-08-01.** Se hizo con
> `npm run reseed:demo`, el comando nuevo que lee las tres variables de
> `docs/private/credenciales.env`, valida antes de conectar y muestra a qué base va con la password
> tapada (así no pasa por la línea de comandos ni por el historial de la shell). **536 tests** (+17 del
> script). El resultado está **verificado por consulta contra Supabase**: 1 cliente (La Birra Bar; el
> italiano ya no está), 14 páginas con el split 8/6, 0 aprobadas, y el `app_metadata` de los usuarios
> ya apuntaba al tenant correcto.
>
> ✅ **Lo que destapó esa verificación, ya cerrado:** la migración `0010` no estaba aplicada en
> producción —la allowlist pública exponía solo `brand, name, priceRange` y los locales y la carta se
> filtraban en silencio—. **Aplicada el 2026-08-01** y verificada por consulta: las 10 migraciones en
> el registro y `locations`/`menu` sobreviviendo la allowlist (2 locales, 4 items de carta). Era el
> ítem del despliegue del renderizador con más chances de olvidarse, porque **no da error**: la web
> simplemente habría salido sin Ubicaciones y con `/menu` en 404.
>
> ✅ **Y verificado también en el portal, que es donde apareció lo que la consulta no veía.** La
> primera siembra corrió doce minutos antes de `f0c1387`, así que producción quedó con los slugs
> inventados: **Cartera y Research mostraban las mismas métricas con nombres distintos**, a dos clics.
> Re-sembrado desde `HEAD`, los 14 slugs coinciden uno a uno y en orden. Un test nuevo
> (`db/src/cartera-portal.test.ts`) ata las dos copias para que no vuelva: el comentario que decía que
> era imposible porque el portal está fuera del monorepo era falso —eso impide importar el paquete, no
> leer el archivo—. En la misma pasada, **el contraste de los ejes en oscuro** (1.53:1 → **11.49:1**,
> 31 etiquetas) y **el typecheck que pisaba `dist/portal`** con el bundle de desarrollo. **539 tests**,
> 130 en el portal.
>
> **Nuevo (2026-08-01): la demo del módulo de Keyword Research, decidida.** Hasta acá "la demo" quería
> decir la de la *plataforma* (el recorrido de tres golpes). La del **módulo KR** es otra y ahora está
> escrita: entregable primero y pipeline después, **sin correr research en vivo** (confirma los
> 16m15s), con el **informe legible llevado al portal** y las **tres mejoras de calidad como
> pre-demo**. La bloquea una precondición que nadie había visto: **el dataset crudo
> (`out/keywords.json`) no está** —vive en un directorio ignorado por git—, así que la promesa de
> "calibrar es offline y gratis" no se puede cobrar hasta recuperarlo o regenerarlo (~$0.31). Piezas
> KR-1..KR-4 en [§2.b del estado](09-estado-y-roadmap.md#-2b-la-demo-del-módulo-de-keyword-research-decidido-2026-08-01).

---

## El plan, en una frase

Convertir la PoC (`prompt → research → web`, que corría como un script y aprobaba editando un JSON
a mano) en una **plataforma multi-tenant** con persistencia, orquestación durable, compuerta humana
real y un portal donde el equipo de la agencia trabaje.

## Las seis etapas

| # | Etapa | Estado |
|---|---|---|
| 1 | **Persistencia + multi-tenancy** — esquema, RLS, cache y registro de tareas en Postgres | ✅ Hecha |
| 2 | **Orquestador durable** — Inngest: steps, reintentos, compuerta humana con `waitForEvent` | ✅ Hecha |
| 3 | **Idempotencia del gasto** — que un reintento no vuelva a pagarle a DataForSEO | ✅ Hecha |
| 4 | **Monorepo + Auth** — workspaces npm; el rol se deriva de `memberships`, no se declara | ✅ Hecha |
| 5 | **API + Portal** — REST autenticada + SPA Angular donde se aprueba la compuerta | ✅ **Hecha** (5.1 API · 5.2 portal · **5.3 desplegada** el 2026-07-25, login verificado el 2026-07-30) |
| 6 | **El renderizador** — servir la web del cliente en un dominio (ADR-19) | ✅ **Hecha** — `renderer/`, 114 tests (nav fija + footer NAP + `/menu` + `/blog` + home incluidas) |

Después de la **5** el sistema es **usable por una persona que no sea yo**: la compuerta de
aprobación (ADR-06) ya no se ejecuta editando un JSON a mano — se aprueba desde el portal, página por
página, y el evento despierta al workflow. *(Falta desplegarlo en algún lado: etapa 5.3.)*

Después de la **6** el cliente **tiene una web**, no "una web generada": `renderer/` la sirve en vivo
desde Storyblok, con la URL de preview y el Bridge que el Visual Editor necesita —o sea que *la razón
por la que se eligió Storyblok* por fin se cobra ([ADR-19](../decisiones-arquitectura.md), cierra
OBS-03). **Lo que sigue faltando es el despliegue del renderizador y del orquestador**: esas dos
piezas corren solo en `localhost`. *(La API y el portal sí están desplegados — etapa 5.3, Fase 1.)*

---

## Dónde estamos exactamente

### Lo que ya funciona

```
┌───────────────┐   evento   ┌──────────────────┐
│  api/  (5.1)✅ │ ─────────▶ │  orchestrator/   │  Inngest: steps durables,
│  Hono + RLS   │            │                  │  reintentos, compuerta humana
└───────────────┘            └────────┬─────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
       ┌─────────────┐         ┌────────────┐          ┌──────────────┐
       │ kr-service  │         │    db/     │          │ web-builder  │
       │  (M2)       │         │  Postgres  │          │    (M1)      │
       │             │         │  + RLS     │          │              │
       │ prompt →    │         │            │          │ brief JSON → │
       │ brief SEO   │         │            │          │ Storyblok    │
       └─────────────┘         └────────────┘          └──────┬───────┘
                                     ▲                        │
                                     │ dominio → space        ▼
                               ┌─────┴──────────┐      ┌──────────────┐
   navegante ────────────────▶ │ renderer/ (6)✅ │◀─────│  Storyblok   │
   (anónimo, sin identidad)    │ 1 servicio,    │ CDA  │  (contenido) │
                               │ N dominios     │      └──────────────┘
                               └────────────────┘
```

- **6 paquetes** en workspaces npm: `kr-service` (M2), `web-builder` (M1), `db`, `orchestrator`, `api`, `renderer` — más `portal/` (Angular), fuera del monorepo a propósito.
- **516 tests** (monorepo). Los de seguridad corren contra Postgres real (PGlite en WASM), sin Docker ni cuenta.
- **Corre entero sin una sola credencial**: providers mock + PGlite en memoria.
- El flujo `research → persistir → esperar aprobación humana → publicar` **funciona de punta a
  punta** y está probado.

### Lo que NO existe todavía

- ~~**Un despliegue.**~~ ✅ **Fase 1 está en producción** desde el 2026-07-25: portal en
  [`bigballs.es`](https://bigballs.es) (Hostinger), API en `api.bigballs.es` (Railway), base en
  Supabase (`eu-west-2`) con RLS forzada. Ver [13-runbook-despliegue.md](13-runbook-despliegue.md).
  **Lo que falta es desplegar la Fase 2**: el orquestador y el renderizador siguen en `localhost`.
- **La migración `0010` en la base de producción.** Está en el repo y mergeada a `main`, pero
  producción se verificó con **9** migraciones (2026-07-25) y la `0010` es del 2026-08-01. Hoy no
  rompe nada —el renderizador, único lector de `business_profile_publico`, no está desplegado— pero
  sin ella el footer saldría **sin locales** y `/menu` daría **404**. Va junto con el despliegue de
  Fase 2: ver [runbook § migraciones sobre una base ya desplegada](13-runbook-despliegue.md#aplicar-migraciones-nuevas-a-una-base-ya-desplegada).
- ~~**La web del cliente.**~~ ✅ Existe: `renderer/` (etapa 6, ADR-19) la sirve en vivo desde
  Storyblok, con preview firmado para el Visual Editor e invalidación por webhook. **Pero solo corre
  en `localhost`**: lo que falta para que el cliente *tenga* una web es desplegarlo.
- **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
  **en proceso**. El borde es decisión de despliegue. Con más de una instancia, el webhook invalida
  solo una: antes de escalar hay que resolverlo (ver `renderer/README.md`).
- **Tests de componente del portal.** El núcleo está cubierto; los componentes se verifican
  compilando (AOT) y a mano en el navegador.

> ✅ **API y portal ya existen.** `api/` (Hono, ADR-22) con la compuerta y los comandos compuestos, y
> `portal/` (Angular 20, ADR-21) donde se aprueba. El flujo completo se manejó en un navegador real
> contra la API sobre PGlite: login → lista → brief por evidencia → aprobar página → aprobar run →
> evento.

---

## Etapa 5: qué se construye ahora, y en qué orden

El orden **no es negociable**, y el motivo es de seguridad:

### 5.1 — La API (`api/`) ✅ HECHA

REST autenticada en **Hono** (ADR-22). Verifica el JWT de Supabase, pone `app.user_id` y deja que
**Postgres decida el resto** (ADR-15). 66 tests contra PGlite, sin red ni Supabase.

| Endpoint | Qué hace |
|---|---|
| `POST /runs` | **Crea la fila del run bajo RLS** (aquí se autoriza) y *después* emite `research/solicitado`. Ver `api/src/solicitar.ts`. |
| `GET /runs` | Los runs del cliente. |
| `GET /runs/:id` | El brief: páginas, evidencia, coste, calidad de los datos. |
| `POST /pages/:id/approve` | Aprueba **una** página (mitad de la compuerta). |
| `PATCH /pages/:id` | Corrige una página; **editar revoca la aprobación** (ADR-06). |
| `POST /runs/:id/approve` | Aprueba el run (la otra mitad) → despierta al workflow → publica. |

**Las tres reglas que no se rompen** (las tres nacieron de un agujero real, no de la teoría):

1. **La API no decide quién puede qué.** Solo afirma **quién eres** —pone `app.user_id` tras validar
   el JWT— y **RLS deriva el rol de `memberships`** y hace el resto (**ADR-15**). Un endpoint que
   acepte `role` del body es una escalada de privilegios.
2. **La API se conecta con `amg_api`**, que **no puede** asumir el rol del servicio: lo impide
   Postgres, no el código (**ADR-17**).
3. **`POST /runs` crea la fila ANTES de emitir el evento.** Ahí es donde se autoriza. El evento
   lleva solo el `runId`; si llevara el `clientId`, quien lo emita elegiría **a nombre de quién se
   gasta** (**ADR-18**).

### 5.2 — El portal (`portal/`) ✅ HECHA

> **Construido:** login (Supabase), lista de research (RLS decide qué ve cada quien) con lanzar
> *(solo equipo)*, el brief **separado por evidencia** (✅/⚠️), la **compuerta doble** (aprobar
> página, editar —revoca—, aprobar run), **refresh del token** (401 → refresca y reintenta una vez;
> si falla, al login), **polling** del research en curso (ADR-21) y las **carreras asincrónicas
> cerradas** (`core/vigencia.ts`: una respuesta tardía no pisa la pantalla y no queda polling
> huérfano). Angular 20 standalone + signals + Tailwind; la lógica en TS puro con **107 tests
> `node:test`**, sin navegador, más **17 tests de componente (Karma)** para el DOM. La API ganó
> **CORS** para que el navegador pueda llamarla.
>
> **Verificado en un navegador real** (`npm run dev:server -w api` levanta la API sobre PGlite):
> el flujo entero, más la medición de que el polling **se detiene** al salir de la pantalla.
>
> **Falta:** calibrar el intervalo de polling (4 s, a ojo) con la duración real de una corrida.

**Stack cerrado en [ADR-21](../decisiones-arquitectura.md)** — las cuatro decisiones, para no
reabrirlas a mitad de camino:

| Decisión | Elección | Por qué |
|---|---|---|
| **Cómo lee los datos** | **Solo por nuestra API.** Nunca PostgREST. | `POST /runs` es un **comando compuesto**: crea la fila bajo RLS **y después** emite el evento de Inngest (ADR-18) — un `insert` directo desde el navegador no dispararía nada. Y una sola superficie = un solo juego de *grants*, contratos y cosas que auditar. *(La primera versión de ADR-21 justificaba esto con un argumento de seguridad **falso**; ver el recuadro en ADR-21.)* |
| **Progreso del research** | **Polling** a `GET /runs/:id` | Realtime abriría un segundo canal de datos (contra la decisión de arriba). Se revisa cuando midamos cuánto tarda. |
| **Componentes** | **Tailwind puro** | Son 4 pantallas. Añadir una librería después es fácil; sacarla, no. |
| **Angular** | **standalone + signals**, sin NgRx | Para este tamaño, signals + servicios alcanzan. |

**Dos audiencias** ([ADR-20](../decisiones-arquitectura.md)):

| Quién | Qué puede |
|---|---|
| **Equipo AMG** (`maestro`, `equipo`) | Lanzar research, ver el brief, **aprobar la compuerta**, publicar. |
| **Cliente** (`cliente`) | **Solo lectura, solo su negocio.** No aprueba ni lanza research. |

> Esto **cuesta cero en la base**: `app.puede_escribir()` ya hace al rol `cliente` solo-lectura y
> `app.ve_cliente()` ya lo encierra en su propio negocio, ambos **probados**. La parte peligrosa la
> impide **Postgres, no la UI**.

Las pantallas:

1. Login (Supabase Auth).
2. Lanzar un research desde un prompt de negocio *(solo equipo)*.
3. Ver el brief: páginas propuestas, **separadas por evidencia** — ✅ respaldadas por datos de
   mercado vs. ⚠️ sin validar. Es el punto vendible del sistema: **dice lo que no sabe**, y es
   justamente lo que el cliente entra a ver.
4. **Aprobar página por página**, y después el run. Publicar *(solo equipo)*.

### 5.3 — Desplegar ✅ HECHA para Fase 1 (y el login, arreglado y verificado)

**Desplegado el 2026-07-25:** portal en [`bigballs.es`](https://bigballs.es) (Hostinger, autodeploy
desde `main`), API en `api.bigballs.es` (Railway, `europe-west4`), base en Supabase (`eu-west-2`).
Paso a paso, con los tropiezos reales, en [13-runbook-despliegue.md](13-runbook-despliegue.md).

> ### ✅ Al desplegar, ningún login funcionaba — arreglado el 2026-07-30
>
> **Lo que pasó:** el proyecto de Supabase se creó el 2026-07-25, ya con **claves asimétricas**: firma
> `ES256`. La API solo aceptaba `HS256` con un secreto compartido, así que **todo login terminaba en
> `401`**.
>
> Lo destapó **manejar la app**, no la verificación desde afuera — que daba verde en las siete
> comprobaciones. Es la misma lección de siempre: leer el código y manejar la app encuentran cosas
> distintas.
>
> Se deja escrito porque el modo de fallo importa más que el arreglo: **no había ninguna señal externa
> que distinguiera "arreglado" de "roto"** (`/health` responde igual con los dos códigos, y un token
> basura da 401 en ambos). Entre el merge y la verificación pasaron tres días en que el código
> correcto ya estaba desplegado y el estado seguía siendo 🟡, a propósito.
>
> **Pieza A** (rama `fix/jwt-es256`): la API verifica contra el **JWKS público** del emisor,
> `SUPABASE_JWT_SECRET` desaparece y `SUPABASE_JWT_ISS` pasa a obligatoria. De paso se arregla el
> logout, que solo borraba el `localStorage` sin revocar nada del lado del servidor.
> [Spec](../superpowers/specs/2026-07-26-verificacion-jwt-es256-design.md) ·
> [plan](../superpowers/plans/2026-07-26-verificacion-jwt-es256.md) · **las 4 tareas hechas**,
> mergeadas y desplegadas, y **el login verificado en el navegador el 2026-07-30**. La pieza está
> cerrada. Dos cosas que quedaron dichas y conviene no perder: `SUPABASE_JWT_SECRET` **se deja** en
> Railway como red de rollback (`leerConfig` ya no la lee), y **no se puede revocar en Supabase** sin
> migrar antes el portal, porque el `anon key` es un JWT legacy firmado con ella. Ver
> [12-credenciales.md](12-credenciales.md).

El orquestador y el renderizador siguen **sin desplegar** (son Fase 2). Van como **servicio Node de
larga duración**, no serverless: el research encadena llamadas live a DataForSEO y generación por
LLM, y probablemente no entra en el timeout de una función (60-300 s).

> ✅ **Medido en la Acción 06 (2026-07-30): un research real tarda 16m15s.** (55 keywords → 14
> páginas, $0.3097, `spike.ts` sin el publish.) Confirma el diseño —el orquestador tiene que ser un
> proceso largo, no una función serverless— y **define la UX del portal**: a 16 minutos el usuario no
> espera mirando una barra, se va y vuelve.
>
> Dos consecuencias que siguen abiertas: la **pieza D** (lanzar el research en vivo delante de Frank)
> queda **desaconsejada**, porque está por encima del umbral de ~12 min que este mismo documento fijó
> como el punto en que la demo se muere mirando un spinner; y el **polling del portal (4 s) sigue sin
> calibrar** contra este número.

---

## Etapa 6: el renderizador (`renderer/`) ✅ HECHA

**Un único servicio Node, multi-tenant** (1 servicio, N dominios) que lee la Content Delivery API de
Storyblok y sirve la web **en vivo**, reutilizando `renderStory()`, que ya existía y estaba probado.
**114 tests**, verificado en un navegador real.

```
Editor toca Storyblok ──▶ (contenido)
                              │
navegante ──▶ RENDERIZADOR ───┘ ──▶ HTML + JSON-LD
                 │ Host → dominio → space del cliente
                 └─ reutiliza renderStory() de web-builder
```

| Pieza | Qué resuelve |
|---|---|
| `dominio.ts` | El `Host` como **dato hostil**: normaliza, valida, y **sin fallback** — host desconocido → 404 sin explicación (un 404 que dice *por qué* es un oráculo para enumerar la cartera). |
| `cda.ts` | Content **Delivery** API, jamás la Management. Timeout de 5 s; 404 ≠ 503. |
| `cache.ts` | TTL + LRU + invalidación por space. La clave lleva el space: `/menu` es el slug de **todos** los restaurantes. |
| `webhook.ts` | HMAC en tiempo constante. Sin firma sería **un botón público para tirar la cache** de cualquier cliente y hacernos pagar la CDA en cada visita. |
| `preview.ts` | Enlace firmado **atado al dominio** y con vencimiento + el Storyblok Bridge. |
| `perfil.ts` | Un NAP mal cargado **degrada la página**, no tira la web. |

**La decisión de fondo no fue de render, fue de autorización.** ADR-15 deriva el rol de
`memberships`; un navegante anónimo no tiene ninguna, así que el modelo de seguridad del proyecto no
cubría este caso. La respuesta: **el dominio es la autorización**, con el rol de base de datos más
pobre del sistema (`app_render`). La pregunta de diseño fue **"si me lo toman, ¿qué se llevan?"** —
es la única pieza expuesta a internet anónimo.

> ⚠️ **Riesgo que un sitio estático no tenía, y que sigue vivo:** el renderizador es una pieza de
> **disponibilidad**. Si se cae, **se caen todas las webs de cliente a la vez**. Mitigado (health
> check que no toca dependencias, timeout, 503 que no se cachea), **no eliminado**. Dimensionarlo
> antes de vender un SLA.
>
> Y **"cache en el borde" quedó a medias**: lo construido es una cache *en proceso*. El borde es una
> CDN al desplegar. Con más de una instancia, el webhook llega a **una sola**.

### 6.1 — Lo que se hizo DESPUÉS de cerrar la etapa 6

La etapa se cerró, pero al manejarla contra el Storyblok real aparecieron cosas que los tests no
veían. Se documentan acá para que el plan no mienta por omisión:

- **La demo local (`npm run demo -w renderer`).** El renderizador sirviendo el space **real** por la
  CDA, con el mapa dominio→space sembrado en PGlite (cero credenciales de base). Es lo que permite
  enseñar la web viva sin desplegar. Necesita `renderer/.env` con el token de **lectura** de la CDA.
- **El bug que cazó la demo (`fromStoryblokContent`).** El contenido que Storyblok guarda está
  **aplanado** y `renderStory` esperaba la forma anidada → 503. Nadie lo había visto porque nadie
  leía de vuelta lo publicado (era OBS-03). Adaptador inverso + tests de ida-y-vuelta.
- **Diseño: marca por tenant + imágenes.** El tema (color/fuente/logo) sale de `business_profile.brand`
  y llega al renderizador por la allowlist de `0009`; las imágenes son campos `asset` editables en el
  Visual Editor. Cada web se ve **propia**, con validación anti-inyección en tres capas. Verificado
  contra el space real.
- **Navegación + home (cierra la deuda de "landing pages sueltas").** El renderizador pide la lista de
  páginas publicadas a la **Links API** de Storyblok (`cdn/links`, con las mismas defensas que la CDA:
  timeout completo, tope de bytes, un fallo LANZA) y `renderStory` pinta una **barra de navegación**.
  Es un **enhancement no-fatal**: si la Links API falla, la página se sirve *sin* barra, nunca 503 —
  un menú no puede tumbar la web. La nav se cachea por space y se invalida con el mismo webhook. Y la
  **raíz de un dominio ya no es 404**: si no hay una story `home` publicada, el renderizador
  **sintetiza** una portada (nombre del negocio + índice de las páginas); si el cliente crea su propia
  `home` en Storyblok, esa gana. El `name`/`slug` de cada página son superficie de inyección: el
  nombre se escapa, el `href` se arma con segmentos escapados (igual que la CDA con el slug hostil).
  Verificado contra el space real (la barra lista las 8 páginas borrador, ordenadas y escapadas).

> **Deuda de diseño, dicha:** republicar desde un brief **pisa** las imágenes que el cliente haya
> subido en el Visual Editor. No bloquea; se resuelve cuando se vuelva real. **Ya no aplica al
> nav/footer/menú/blog**: se calculan en vivo desde `business_profile` en cada request, no desde el
> brief — republicar los deja intactos.

**✅ Navegación fija del sitio del cliente (cierra el plan
[`2026-07-31-navegacion-sitio-cliente`](../superpowers/plans/2026-07-31-navegacion-sitio-cliente.md),
[spec](../superpowers/specs/2026-07-31-navegacion-sitio-cliente-design.md)).** La barra de arriba
("Navegación + home" del bullet anterior) mostraba los 14 títulos SEO de La Birra Bar — se leía como
un blog, no como el sitio de un restaurante. Reemplazada por:

- **Nav fijo de 4 ítems** (Inicio/Menú/Ubicaciones/Contacto), cada uno condicionado a que el perfil
  tenga el dato — ya no deriva de la lista de páginas publicadas.
- **Footer compartido** en toda página (landings, home, `/menu`, `/blog`): NAP general + un bloque
  por cada `Location` (nombre, dirección, horario — La Birra Bar tiene dos: Centro y Salamanca) +
  link a Blog si hay artículos. Reemplaza a la sección de contacto que antes se repetía dentro de
  `<main>` en cada landing.
- **`/menu` y `/blog` sintetizados** desde el perfil (mismo patrón que la home cuando no hay story
  real): `/menu` agrupa la carta por categoría con JSON-LD `Menu`; `/blog` lista solo las páginas
  `schema_type: Article` — la home ya no las repite en su índice general.
- **Tarea no prevista en el plan original (Task 6.5): migración `0010_ubicaciones_y_carta_publicas.sql`.**
  El renderizador lee `business_profile_publico` (la columna generada con allowlist, `0008`/`0009`),
  no `business_profile` crudo — y ni `locations` ni `menu` estaban en esa allowlist. Sin esta
  migración, el footer saldría sin locales y `/menu` daría 404 en producción aunque el perfil
  estuviera cargado (el mismo bug de silencio que ya le había pasado a `brand` antes de la `0009`).
  Se detectó al planificar, no en producción — de ahí que se agregara como tarea intermedia del plan.
- **Datos reales de La Birra Bar cargados** en `web-builder/business-profile.json` (dos locales, la
  carta de 4 productos). Sin código postal ni teléfono: no confirmados por el cliente, no se
  inventan (`postalCode` es opcional en `PostalAddress` por esta misma razón).

**10 tasks** (1-9 más la 6.5), **516 tests** en el monorepo tras el cierre (subió de 466), verificado
en un navegador real: nav/footer en home y en una landing, `/menu` agrupado por categoría, `/blog`
con solo los dos artículos (sin duplicarlos en la home), `?_host=noexiste.es` sigue en 404, footer
legible en modo oscuro. El dry-run de republicación en Storyblok no mostró diferencias de contenido
(el perfil no se hornea en las stories: lo inyecta el renderizador en cada request), así que **no
se republicó** — no había nada que cambiar en el space.

Dos rondas de fix wave sobre la rama ya cerrada, antes de mergear:

- **Revisión final de rama** (interna): JSON-LD con `locations` sin `address`/`telephone` de nivel
  superior, coma faltante en la dirección del footer, y que `/blog` no se autoenlace en su propio
  índice sintetizado.
- **Revisión externa (Codex)**, pedida aparte sobre toda la rama ya cerrada: 4 hallazgos reales,
  los 4 corregidos y verificados por mutación —
  1. la allowlist de Postgres (`app.nap_publico`) restringía **nombres** de clave pero no la
     **forma** de los valores (un objeto podía colarse donde se esperaba un string, ej.
     `menu[].price = {"secreto":"x"}`, y sobrevivir intacto hasta el rol `app_render`); se agregó
     `app.texto_publico()`, un helper que solo deja pasar `jsonb_typeof(v) = 'string'`, aplicado a
     **los ~20 campos de texto** de la función, no solo a los nuevos;
  2. `locations` tenía la precedencia **invertida** contra su propio comentario (`profile.telephone
     ?? principal?.telephone` le daba prioridad al campo clásico en vez de a `locations`) en
     `homeLd`, `primaryEntity` y el footer — corregido en los tres lugares;
  3. los topes de tamaño (20 locales / 200 ítems de carta) se aplicaban solo en
     `renderer/perfilValido`, **después** de que Postgres ya materializó el array completo vía
     `jsonb_agg` — se agregó el mismo tope en la fuente de la migración (`with ordinality ... where
     i <= N`) y en la puerta de escritura (`.max()` en el Zod de `web-builder/contract.ts`);
  4. `/blog` se autoenlazaba en su propio pie cuando la página servida era una **story real** con
     slug `blog` (el fix anterior solo cubría la síntesis).

**Mergeada a `main` el 2026-08-01** (fast-forward, `9e8c896..297e3f8`, 21 commits). 516/516 tests,
typecheck limpio. Deuda documentada, no bloqueante: falta un test positivo de que `/blog` muestra su
link en una story normal (solo hay test de que NO se autoenlaza), y la validación de forma de la
allowlist solo tiene test en un campo de los ~20 que ahora protege.

---

## Decisiones tomadas en esta fase (y por qué)

Todas con su ADR. Las que más condicionan lo que viene:

- **ADR-12 — El evento dispara, la base decide.** `research/aprobado` no aprueba nada: despierta al
  workflow, que relee de la base bajo RLS. Si el evento fuera la autoridad, cualquiera que pudiera
  emitirlo publicaría contenido que ningún humano miró.
- **ADR-13 — Solo se toca la base por transacción con conexión reservada.** El `set local` del
  contexto de tenant vive en *una* conexión; con un pool, las queries se repartían entre conexiones
  distintas y el `insert` caía **fuera de RLS**.
- **ADR-14 — Idempotencia por `payload_hash` (con registro durable OBLIGATORIO en prod) + método
  Standard donde se puede.** El registro cubre los cuatro endpoints — y `getProvider` **falla
  cerrado** si en producción no se le inyecta un registro durable (tanda 13: el CLI corría con
  `NoopTaskLog` y pagaba dos veces). Además, SERP y Search Volume (46%) usan `task_post`/`task_get`: la tarea
  pagada se **recupera gratis**, así que una respuesta perdida no es dinero perdido. La API Labs (54%)
  es *live-only*: ahí una petición ambigua **detiene el run**.
- **ADR-15 — El rol se deriva de `memberships`, no se declara.** Cierra OBS-02. Es lo que hace
  seguro construir la API.
- **ADR-16 — Portal en Angular.** Reemplaza ADR-02 (Next), cuya premisa —un frontend que renderice
  también las webs públicas— se cayó al acotar el alcance al portal interno.
- **ADR-17 — Un proceso, un login, un rol.** Corrige una afirmación **falsa** de ADR-15: la autoridad
  del servicio *no* era una credencial, era el código eligiendo con qué rol vestirse. Ahora la
  separación la impone Postgres (`NOINHERIT`, un rol por login).
- **ADR-18 — Un evento no porta autoridad.** El evento traía `tenantId`/`clientId` elegidos por quien
  lo emitía: conocer dos UUID ajenos bastaba para que la agencia pagara el research de otra. Ahora la
  API crea el run bajo RLS y el evento solo lo pone en marcha.

> Las cuatro últimas nacieron de reviews externas, y **tres de ellas corrigen algo que yo había dado
> por bueno**. Es el motivo por el que las reviews están en el proceso: lo que se documenta como
> seguro, y no lo es, es peor que no documentarlo.

---

## Lo que sigue abierto

### 🔴 Decisiones abiertas

| Qué | Dónde | Por qué importa |
|---|---|---|
| ✅ ~~OBS-01 — unificar el alcance~~ | [acciones/05](../acciones/05-unificar-alcance.md) | **Cerrada (2026-07-19).** Manda `contexto-proyecto-frank.md`; alcance base = 3 módulos (2 ya construidos); el 4 a línea futura; ADR-04 se mantiene. Era la última observación abierta. |
| **Reescribir ADR-11 (offboarding)** | [decisiones](../decisiones-arquitectura.md) | Está redactado sobre "el frontend Next.js", que no existe. Con ADR-19 ya hay **qué entregar** (space + renderizador), pero **el texto todavía promete otra cosa** y de ahí sale una cláusula de contrato. |

> ✅ **OBS-03 cerrada** por [ADR-19](../decisiones-arquitectura.md) (renderizador propio en runtime).
> ✅ El stack del portal, cerrado por [ADR-21](../decisiones-arquitectura.md).

### ⏳ Tareas

| Qué | Dónde | Nota |
|---|---|---|
| Páginas de clientes en el portal | [plan](../superpowers/plans/2026-08-01-paginas-clientes-portal.md) | 🔵 **Planificada, sin empezar.** Se trabaja en `feature/paginas-clientes`, **en paralelo** al roadmap de la demo: las 4 pantallas de gestión de clientes de `dashboard-project` (listado, crear, perfil, vista) con los datos en Postgres bajo RLS y endpoints propios en `api/` — no en Firestore. `/cartera`, `/runs` y `/brief` no se tocan (el plan tiene una lista explícita de qué no tocar). Migración `0011` que **no** toca la allowlist del renderizador: los datos de CRM son internos. |
| ~~Acción 06 — corrida final~~ | [acciones/06](../acciones/06-corrida-final-demo.md) | ✅ **Hecha (2026-07-30)**, $0.3097. `kr.v0.5` publicado para La Birra Bar, verificado en el navegador. De paso midió la duración real del research (16m15s, ver fila siguiente) y cerró el gap de `DATABASE_URL_CACHE` (ADR-14) que la guía no pedía. |
| ~~Migrar SERP + Search Volume a Standard~~ | `kr-service/src/dataforseo/` | ✅ **Hecho** (tandas 11-12): `task_post`/`task_get` con doble capa de recuperación. La 6ª review encontró 4 bugs en la primera versión; corregidos y mutation-tested. |
| ~~Pieza A — verificación JWT ES256~~ | [plan](../superpowers/plans/2026-07-26-verificacion-jwt-es256.md) | ✅ **Cerrada (2026-07-30).** Las 4 tareas, mergeadas y desplegadas, y el login verificado en el navegador. Ya no bloquea nada. |
| ~~Pieza B — modo oscuro del portal~~ | [spec](../superpowers/specs/2026-07-30-modo-oscuro-portal-design.md) · [plan](../superpowers/plans/2026-07-30-modo-oscuro-portal.md) | ✅ **Mergeada a `main`** (Tarea 1 de la migración a Tailwind v4, esta misma sesión). Tokens semánticos (no `dark:`) para que la pieza C herede el tema por construcción. 21 tests nuevos: el contraste AA de 17 pares × 2 temas leído de `styles.css`, `TOKENS`/`styles.css` atados (incluido el bloque `@theme inline`, que reemplazó a `tailwind.config.js` cuando el portal migró a Tailwind v4), y un test que recorre `src/app` y prohíbe incrustar colores o usar la paleta cruda. |
| ~~Cuánto tarda un research real~~ | — | ✅ **Medido (2026-07-30): 16m15s** (55 keywords → 14 páginas, $0.3097), por encima del umbral de ~12 min. **Decisión:** la pieza D (research en vivo en la demo) queda desaconsejada tal como se imaginó — mostrarlo en vivo arriesga que Frank mire un spinner. Mejor correrlo antes (como acá) y mostrar el resultado publicado. El polling del portal (4s) sigue sin calibrar contra este número. |
| ~~Navegación fija del sitio del cliente~~ | [spec](../superpowers/specs/2026-07-31-navegacion-sitio-cliente-design.md) · [plan](../superpowers/plans/2026-07-31-navegacion-sitio-cliente.md) | ✅ **Mergeada a `main` (2026-08-01).** 10 tasks (1-9 más la 6.5, migración `0010` no prevista en el plan original). Nav fijo de 4 secciones, footer NAP multi-local, `/menu` y `/blog` sintetizados, datos reales de La Birra Bar cargados. Revisión final de rama + revisión externa (Codex, 4 hallazgos reales corregidos). 516 tests. Ver §6.1 más arriba. |
| Esquema Zod duplicado M2/M1 | `kr-service/src/validation/`, `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. |
| `is_local` se dispara de más | `pipeline/enrich-content.ts` | 53 de 60 keywords → casi todo `LocalBusiness`. Ensucia el JSON-LD. |
| `endpoints_degradados` incompleto | `meta_run` | Omite los fallos de suggestion/SERP. |
| Sin tests de integración automatizados | — | El camino live se ejecutó **a mano** contra DataForSEO, OpenAI y Storyblok. |
