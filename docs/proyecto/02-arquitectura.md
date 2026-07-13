# 2. Arquitectura

## Vista general

Dos módulos independientes, conectados por **un contrato de datos** (el brief JSON), no por
código compartido. Cada uno es un paquete Node/TypeScript autónomo con su propio `package.json`.

```
                    ┌──────────────────────── kr-service (Módulo 2) ────────────────────────┐
  prompt de   →     │  seeds → expansión → enriquecimiento → intención → relevancia →       │
  negocio           │  scoring → clustering → mapeo a páginas → contenido on-page           │
                    └───────────────────────────────┬──────────────────────────────────────┘
                                                    │
                                          out/brief.json  (contrato kr.v0.2)
                                          out/informe.md  (entregable humano)
                                                    │
                                    ⛔ COMPUERTA DE APROBACIÓN HUMANA (ADR-06)
                                       status: pending_approval → approved
                                       + aprobación por página (page.approved)
                                                    │
                    ┌──────────────────────── web-builder (Módulo 1) ───────────────────────┐
                    │  validación del contrato (Zod) → handoff adapter → prose (LLM) →      │
                    │  perfil de negocio → render HTML+JSON-LD → publicación                │
                    └───────────────────────────────┬──────────────────────────────────────┘
                                                    │
                            ┌───────────────────────┴────────────────────────┐
                            ▼                                                ▼
                   out/preview/*.html                          Storyblok (Management API)
                   (preview + base del                         → editable en Visual Editor
                    snapshot estático)                         → renderizado por Next.js (PROD)
```

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

Estas tres piezas son, justamente, la base que necesita un orquestador durable (Inngest, ADR-03)
para poder reintentar pasos sin duplicar trabajo ni gasto.

## Trazabilidad

Cada página generada arrastra su origen en el research: `source_keyword`, `intent`, `page_type`,
`opportunity_score`, `volumen`, `dificultad`. Viaja en `Story.content.meta`, se persiste en
Storyblok y se emite en el preview HTML como un bloque
`<script type="application/json" id="research-trace">`.

Esto permite responder, ante cualquier página publicada: *¿por qué existe esta página?*

## Lo que está decidido pero NO construido

La arquitectura objetivo ([ADRs](../decisiones-arquitectura.md)) incluye piezas que **todavía no
existen en el código**:

| Pieza | Decisión | Estado |
|---|---|---|
| Persistencia + multi-tenancy (RLS) | Supabase (ADR-01) | ⛔ No implementado |
| Orquestación durable (**reintentos por paso**, checkpoints, `waitForEvent` para la compuerta) | Inngest (ADR-03) | ⛔ No implementado — hoy el pipeline corre **secuencial en línea** por CLI. *(Los reintentos a nivel HTTP y la idempotencia sí existen: son la base que Inngest necesita.)* |
| Frontend / portal | Next.js (ADR-02) | ⛔ No implementado |
| Render de las webs de cliente | Next.js leyendo Storyblok (ADR-04) | ⛔ No implementado — hoy hay un preview HTML autocontenido |

El preview HTML del `web-builder` **refleja el mismo contrato de bloks** que renderizará Next.js,
así que lo que se ve en la demo coincide con lo que se verá en producción.
