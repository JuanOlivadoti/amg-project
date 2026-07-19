# 2. Arquitectura

## Vista general

**Seis paquetes** en un monorepo de workspaces npm, más el portal Angular fuera de él.

Dos son los **módulos de negocio** (`kr-service` = M2, `web-builder` = M1), conectados por **un
contrato de datos** (el brief JSON) y no por código compartido. Uno es la **plataforma de datos**
(`db`: Postgres + RLS). Y tres son **procesos que atienden a alguien**:

| Proceso | A quién atiende | Cómo se autoriza |
|---|---|---|
| `orchestrator` | a nadie de afuera (eventos Inngest) | credencial de BD (`amg_orquestador` → `app_service`) |
| `api` | al equipo y al cliente, autenticados | JWT verificado → RLS deriva el rol de `memberships` |
| `renderer` | a **cualquiera**, sin autenticar | **el dominio** (`amg_render` → `app_render`, ADR-19) |

Esa última fila es la que rompió el molde: es el primer proceso que atiende a alguien **sin
identidad**, y por eso necesitó su propia respuesta (ver [ADR-19](../decisiones-arquitectura.md) y
la migración `0007`).

`orchestrator` es además el **composition root** del pipeline: el único punto que conoce a M1, M2 y
`db` a la vez.

```
   LA API ──crea la fila del run BAJO RLS, con la identidad del humano──▶ kr_runs
        │   aquí ocurre la autorización: sin membresía, Postgres rechaza el insert
        │
        └──emite research/solicitado { runId, tenantId } ──▶  ORCHESTRATOR (Inngest, ADR-12)
                                                                   │  steps durables
   ┌───────────────────────────────────────────────────────────────┘
   │
   ├─▶ kr-service (M2) ──── seeds → expansión → enriquecimiento → intención → relevancia →
   │                        scoring → clustering → mapeo a páginas → contenido on-page
   │                              │
   │                              └──▶  brief JSON  (contrato kr.v0.5)  +  informe.md
   │
   ├─▶ db ─────────────── persiste runs, keywords y páginas bajo RLS multi-tenant
   │                      + cache de métricas/SERP + registro de tareas facturables
   │
   ⏸  COMPUERTA DE APROBACIÓN HUMANA (ADR-06) — waitForEvent, hasta 7 días, sin proceso vivo
   │      status: pending_approval → approved, + aprobación por página
   │      al despertar, RELEE DE LA BASE: el evento no aprueba nada (ADR-12)
   │
   └─▶ web-builder (M1) ── validación Zod del contrato → handoff adapter → prose (LLM) →
                           perfil de negocio → render HTML+JSON-LD → publicación
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
           out/preview/*.html            Storyblok (Management API)
           (HTML autocontenido,          → editable en Visual Editor
            base del snapshot)                      │
                                                    ▼
                                    RENDERER (ADR-19) — 1 servicio, N dominios
                                      Host → dominio → space del cliente
                                      lee la Content DELIVERY API (nunca la Management)
                                      reutiliza renderStory() de web-builder
                                      cache invalidada por webhook firmado
                                             │
                                             ▼
                                    la web pública del cliente
```

> **Las dos APIs de Storyblok no se cruzan, y es deliberado.** El orquestador **escribe** por la
> Management API; el renderizador **lee** por la Content Delivery API. El proceso expuesto a
> internet anónimo nunca toca una credencial que pueda *modificar* el space de un cliente.

## El patrón que sostiene todo: proveedores abstractos

**Es la decisión de diseño más importante del código.** Ninguna lógica del pipeline habla
directamente con un servicio externo. Todo pasa por una **interfaz** con al menos dos
implementaciones: una `mock` (sin cuenta, sin costo, determinista) y una `live` (real).

| Interfaz | Dónde | Implementaciones |
|---|---|---|
| `KeywordDataProvider` | `kr-service/src/dataforseo/provider.ts` | `MockProvider` · `LiveProvider` (DataForSEO) |
| `TextGen` | `kr-service/src/llm/types.ts` | `MockTextGen` · `OpenAITextGen` · `AnthropicTextGen` |
| `Embedder` | `kr-service/src/llm/types.ts` | `MockEmbedder` (bag-of-words) · `OpenAIEmbedder` |
| `ContentGen` | `kr-service/src/llm/content.ts` | `MockContentGen` · `OpenAIContentGen` · `AnthropicContentGen` |
| `ProseGen` | `web-builder/src/llm/content.ts` | `MockProseGen` · `OpenAIProseGen` |
| `Publisher` | `web-builder/src/publish/publisher.ts` | `MockPublisher` · `StoryblokPublisher` · `StoryblokDryRunPublisher` |

**Consecuencias prácticas:**
- Se puede **desarrollar y testear todo el pipeline sin una sola credencial**.
- Pasar a producción es **cambiar una variable de entorno**, no tocar código.
- Los tests son deterministas y no tocan la red.
- No quedamos casados con ningún proveedor ([ADR-05](../decisiones-arquitectura.md), [ADR-09](../decisiones-arquitectura.md)).

La abstracción es **completa**: los tres proveedores de LLM (OpenAI, Anthropic, mock) implementan
todas las capacidades, así que cambiar de proveedor no degrada nada. Si falta la key del proveedor
configurado, se avisa fuerte antes de caer a mock.

> Única asimetría, por limitación del proveedor: los **embeddings** siempre van por OpenAI —
> Anthropic no tiene API de embeddings propia ([ADR-09](../decisiones-arquitectura.md)).

## La plataforma: quién decide qué

Esta parte no existía cuando el proyecto era un script. Es la que hace que el sistema aguante
tener **más de un cliente** — y es donde están las decisiones que más caro salió corregir.

### La regla que ordena todo: la autoridad vive en Postgres, no en el código

Ningún proceso *declara* quién es ni qué puede. Lo **demuestra**, y Postgres decide.

| Pieza | Cómo funciona | ADR |
|---|---|---|
| **RLS forzado** | `FORCE ROW LEVEL SECURITY`, no solo `ENABLE`: ni el dueño de la tabla se la salta. Políticas de allowlist positiva. | ADR-10 |
| **El rol no se declara** | Se **deriva de `memberships`** dentro de la base (`app.current_role()`). Antes lo ponía el caller — es decir, se lo creíamos. | ADR-15 |
| **Un proceso, un login, un rol** | `amg_api` → `app_user`. `amg_orquestador` → `app_service`. Son `NOINHERIT` y **ninguno puede asumir el del otro**: lo impide Postgres. | ADR-17 |
| **Un evento no porta autoridad** | El evento lleva solo `{runId, tenantId}` — *coordenadas*, no permisos. Quien autoriza es el `insert` que hizo la API bajo RLS **antes** de emitirlo. | ADR-18 |
| **Solo se toca la base por transacción** | El contexto de tenant (`set local`) vive en **una** conexión reservada. Con un pool, las queries se repartían y el `insert` caía **fuera de RLS**. | ADR-13 |

> Las cuatro últimas nacieron de **agujeros reales encontrados en reviews externas**, no de la
> teoría. Tres corrigen algo que yo había dado por bueno. El detalle —incluida una afirmación de
> seguridad que documenté y era **falsa**— está en [decisiones](../decisiones-arquitectura.md) y en
> [Credenciales](12-credenciales.md).

### Orquestación durable (`orchestrator`)

Inngest, con los pasos como fronteras del gasto ([ADR-12](../decisiones-arquitectura.md)):

- **`waitForEvent`** resuelve la compuerta humana: el workflow se suspende **hasta 7 días sin
  proceso vivo**. Es lo que un script secuencial no podía hacer.
- **El evento despierta; la base decide.** Al reanudarse, el workflow relee qué está realmente
  aprobado (`getPublishablePages`, bajo RLS). Si alguien "simplifica" esto publicando el brief
  directamente, **caen cuatro tests**. Están puestos para eso.
- **Concurrencia global de 3** — el rate limit de DataForSEO es por **cuenta**, no por tenant — y
  **1 por tenant**.
- **El research no se vuelve a pagar**: la clave de idempotencia de Inngest dura 24 h y la compuerta
  espera 7 días, así que el workflow comprueba el estado del run antes de gastar.

### Idempotencia del gasto (`db` + `kr-service`)

Una petición facturable se registra en `kr_provider_tasks` con un **`payload_hash`**, **antes** de
enviarse ([ADR-14](../decisiones-arquitectura.md)). Un reintento encuentra el resultado en vez de
volver a pagarlo. Cubre **el 100% de la superficie facturable** — incluida la API Labs de
DataForSEO, que es *live-only* y donde está el **54% del gasto**.

Hay *lease* con expiración y contador de intentos: un proceso muerto a mitad de camino libera la
reserva en vez de bloquearla para siempre.

## Límites entre módulos

`web-builder` **no importa nada de** `kr-service`. Consume el brief como si viniera de un
sistema externo:

- Redefine el subconjunto del contrato que necesita en `web-builder/src/types.ts` (`KrBrief`, `KrProposedPage`).
- Lo **valida en runtime con Zod** antes de usarlo (`web-builder/src/contract.ts`), y rechaza
  versiones de esquema no soportadas.

Esto es deliberado: el brief es una **frontera**, y puede llegar editado por un humano, de otra
versión del pipeline, o corrupto. Ver [Contrato de handoff](06-contrato-handoff.md).

## Aislamiento de la "storyblok-idad"

El contenido canónico de una página (`Story` en `web-builder/src/types.ts`) es **agnóstico del CMS**:
bloks limpios, SEO como objeto anidado, sin identificadores del proveedor.

La transformación al formato que Storyblok exige (añadir `_uid` a cada blok, aplanar el SEO,
convertir los items de FAQ en bloks `faq_item`) vive **aislada** en
`web-builder/src/storyblok/content.ts` (`toStoryblokContent`). Si mañana se cambia de CMS, se
reescribe ese archivo y nada más.

## Manejo de fallos: degradación explícita, nunca silenciosa

Principio adoptado tras una revisión externa (ver [Testing y calidad](08-testing-calidad.md)):
**es peor un fallo silencioso que un fallo ruidoso.**

- Si el LLM no evalúa la relevancia de negocio de una keyword, esa keyword **no se promueve**
  automáticamente: se le capea el score y se le baja la confianza (`scoring.ts`).
- Si el LLM devuelve JSON estructuralmente parcial, se **descartan los elementos inválidos**
  uno por uno en vez de crashear o de publicar basura (`reconcile`).
- Si DataForSEO devuelve una *task* fallida dentro de una respuesta global exitosa, **se avisa**
  y se omite, en vez de contarla como éxito con datos vacíos (`client.ts`).
- Si falta el perfil de negocio, se sigue sin él; pero si el perfil **existe y está corrupto**,
  se lanza un error (no se disfraza de "sin perfil").
- Si falla el SERP de una cabeza de cluster, esa cabeza **no se valida** (queda sin fusionar, que
  es lo conservador) en vez de abortar toda la corrida.

## Resiliencia e idempotencia

- **HTTP** (`lib/http.ts`): timeout por intento, reintentos con **backoff exponencial + jitter**, y
  respeto de `Retry-After`. Los 429 y 5xx se reintentan; el resto de los 4xx **no** (reintentar un
  401 no lo arregla, solo gasta tiempo y dinero).
- **Publicación idempotente**: los `_uid` de los bloks son **deterministas** (derivados de la
  identidad natural del blok, no aleatorios), así republicar el mismo contenido converge al mismo
  estado en vez de recrear todo. Y si dos corridas concurrentes intentan crear la misma página, la
  segunda **actualiza en vez de duplicar**.
- **Presupuesto preflight** (`lib/budget.ts`): cada fase se estima **antes** de ejecutarse y se
  aborta si no entra en el tope, en vez de descubrir el exceso cuando ya se gastó.

Estas tres piezas fueron la base sobre la que se construyó el orquestador durable
([ADR-03](../decisiones-arquitectura.md), ya implementado): reintentar un paso sin duplicar trabajo
ni gasto exige exactamente esto.

## Trazabilidad

Cada página generada arrastra su origen en el research: `source_keyword`, `intent`, `page_type`,
`opportunity_score`, `volumen`, `dificultad`. Viaja en `Story.content.meta`, se persiste en
Storyblok y se emite en el preview HTML como un bloque
`<script type="application/json" id="research-trace">`.

Esto permite responder, ante cualquier página publicada: *¿por qué existe esta página?*

## Lo que está construido, y lo que no

| Pieza | Decisión | Estado |
|---|---|---|
| Persistencia + multi-tenancy (RLS) | Supabase / Postgres (ADR-01, ADR-10, ADR-13, ADR-15) | ✅ **Construido** — `db/`, **8 migraciones**, **99 tests** contra Postgres real |
| Orquestación durable (`waitForEvent`, reintentos por paso) | Inngest (ADR-03, ADR-12) | ✅ **Construido** — `orchestrator/` |
| Idempotencia del gasto | `payload_hash` (ADR-14) | ✅ **Construido** |
| **API REST autenticada** | ADR-15, ADR-17, ADR-18, ADR-22 | ✅ **Construida** — `api/` (Hono), 33 tests |
| **Portal** | **Angular + Tailwind** (ADR-16, ADR-21, *reemplaza* ADR-02/Next) | ✅ **Construido** — `portal/`, 29 tests de núcleo |
| **Despliegue** | Tres servicios Node de larga duración + una SPA estática | ⛔ **Nada corre en ningún servidor.** Es lo único que bloquea |
| **El renderizador** — servir la web del cliente en un dominio | **Servicio propio en runtime**, multi-tenant (ADR-19, *cierra OBS-03*) | ✅ **Construido** — `renderer/`, 75 tests |

### El renderizador (ADR-19) — construido ✅

ADR-02 asumía que **un frontend Next.js** renderizaría las webs públicas leyendo Storyblok. ADR-16
quitó Next del stack… **y no puso nada en su lugar**. Eso dejó un agujero que ningún test podía
detectar, porque no era un bug: era una **ausencia** (OBS-03) — y hacía que *una edición en el Visual
Editor no llegara a ninguna página publicada*, que era **la justificación entera de ADR-04**.

Hoy `renderer/` lo cierra: **un único servicio Node, multi-tenant** (1 servicio, N dominios) que lee
la Content Delivery API y sirve la web **en vivo**, reutilizando `renderStory()`, con cache
invalidada por webhook firmado y la URL de preview + Bridge que el Visual Editor necesita.

**La decisión de fondo fue de autorización, no de render.** ADR-15 deriva el rol de `memberships`; un
navegante anónimo no tiene ninguna, así que el modelo no cubría este caso. La respuesta: **el dominio
es la autorización**, con el rol de base de datos más pobre del sistema (`app_render`: siete columnas
de una tabla, sin escritura, sin acceso a `kr_*`, `memberships`, `tenants` ni a las funciones de
`app`). La pregunta de diseño no fue *"¿qué necesita?"* sino **"si me lo toman, ¿qué se llevan?"** —
porque es la única pieza expuesta a internet anónimo.

> ⚠️ **Riesgo que un estático no tenía, y que sigue vivo:** el renderizador es una pieza de
> **disponibilidad**. Si se cae, **se caen todas las webs de cliente a la vez**. Mitigado (health
> check que no toca dependencias, timeout de 5 s contra la CDA, 503 que no se cachea), **no
> eliminado**. Dimensionarlo antes de vender un SLA.
>
> Y **"cache en el borde" sigue siendo media frase**: lo construido es una cache *en proceso*. El
> borde es una CDN al desplegar. Con más de una instancia, el webhook de invalidación llega a **una
> sola**; las demás sirven contenido viejo hasta que venza el TTL.
