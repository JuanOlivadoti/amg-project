# 3. Stack tecnológico

## Regla de lectura

Este proyecto tiene **dos stacks**: el que está **en el código hoy** y el que está **decidido
para producción** pero aún no construido. Mezclarlos es la principal fuente de confusión, así
que van separados.

---

## A. Lo que está en el código HOY

### Runtime y lenguaje
| Tecnología | Versión | Notas |
|---|---|---|
| **Node.js** | ≥ 20 (probado con 24) | Se usa `fetch` nativo — no hay axios ni node-fetch. |
| **TypeScript** | ^5.6 | ESM puro (`"type": "module"`), `strict: true`, `noUncheckedIndexedAccess: true`. |
| **tsx** | ^4.19 | Ejecuta TypeScript directo, sin paso de build. Los CLIs corren con `tsx`. |

### Dependencias de runtime (deliberadamente pocas)

**`kr-service`** (Módulo 2):
| Paquete | Para qué |
|---|---|
| `openai` | Generación (seeds, intención, relevancia, contenido on-page) + **embeddings** (clustering). |
| `@anthropic-ai/sdk` | Generación de seeds con Claude (alternativa a OpenAI). |
| `zod` | Validación del brief de salida contra el esquema `kr.v0.2`. |
| `dotenv` | Carga de `.env`. |

**`web-builder`** (Módulo 1):
| Paquete | Para qué |
|---|---|
| `openai` | Prose final (secciones + respuestas de FAQ). |
| `zod` | Validación en runtime del brief de entrada y del perfil de negocio. |
| `dotenv` | Carga de `.env`. |

**Storyblok se llama con `fetch` nativo** — no se usó su SDK, para no sumar una dependencia
por unas pocas llamadas HTTP a la Management API.

### Testing
| Tecnología | Notas |
|---|---|
| **`node:test` + `node:assert`** | Test runner **nativo de Node**. Cero dependencias nuevas. |
| **tsx** | Se corre con `node --import tsx --test "src/**/*.test.ts"`. |

Decisión: se descartaron Jest y Vitest. Para tests unitarios de funciones puras (que es todo lo
que hay), el runner nativo alcanza y evita arrastrar decenas de paquetes transitivos.

### Servicios externos
| Servicio | Para qué | Autenticación |
|---|---|---|
| **DataForSEO** | Volumen de búsqueda, dificultad (KD), sugerencias de keywords, SERP. | HTTP Basic Auth (login + password de API). |
| **OpenAI** | Generación de texto (`gpt-4o` por defecto) y embeddings (`text-embedding-3-small`). | API key. |
| **Anthropic** | Alternativa para generación (Claude Opus 4.8). | API key. |
| **Storyblok** | CMS headless donde se publican las páginas generadas. | Management API token + Space ID. |

> Todos son **opcionales para desarrollar**: sin ninguna credencial, ambos módulos corren en
> modo mock de punta a punta. Ver [Configuración](07-configuracion.md).

---

## B. Lo decidido para producción (aún NO construido)

Estas elecciones están razonadas en las [decisiones de arquitectura](../decisiones-arquitectura.md),
con las alternativas que se descartaron y por qué.

| Pieza | Elección | ADR | Motivo resumido |
|---|---|---|---|
| **Base de datos / Auth / Storage / RAG** | **Supabase** (Postgres + RLS + Auth + Realtime + pgvector + Storage) | ADR-01 | Un solo Postgres resuelve multi-tenancy (RLS por `tenant_id`), RBAC, alertas y vectores a la vez. Se descartó ensamblar Auth0 + RDS + Pinecone + S3. |
| **Frontend** | **Next.js** (App Router) + TypeScript + Tailwind + shadcn/ui | ADR-02 | SSR donde importa el SEO; un solo lenguaje de punta a punta. |
| **Orquestación** | **Inngest** (flujos como código, durables) | ADR-03 | Reintentos, idempotencia y `waitForEvent` para la compuerta humana. **Se descartó n8n como backbone** (flujos en JSON no se versionan ni testean bien); n8n queda solo como *glue* de integraciones. |
| **CMS del Módulo 1** | **Storyblok** (headless + Visual Editor) | ADR-04 | Creación programática vía Management API + edición visual para no-técnicos. **Se descartó WordPress/Elementor** (JSON opaco, mantenimiento por sitio) y **Payload CMS** (self-host, pero sin edición visual sobre el lienzo). |
| **Motor de keyword research** | **DataForSEO** | ADR-05 | Pay-as-you-go barato por consulta. Se descartó SEMrush (~450€/mes) y Google Ads API (fricción de developer token, volúmenes en rangos). |
| **LLM** | **Proveedor abstracto** (OpenAI / Anthropic); embeddings con OpenAI | ADR-09 | No quedar casados con un proveedor. Embeddings van con OpenAI porque **Anthropic no tiene API de embeddings propia**. |

### Nota sobre el LLM

El PRD original fijaba Claude Opus (generación) + Haiku (clasificación). Se reabrió a pedido del
usuario y se resolvió **con abstracción** en vez de con una elección: hoy el proveedor se
configura por variable de entorno y autodetección por key.

En la práctica, **el PoC corre con OpenAI** (`gpt-4o` + `text-embedding-3-small`), porque los
embeddings del clustering lo requieren y tener un solo proveedor simplifica.

---

## Estructura del repositorio

```
AMG/
├── README.md              # portada del repo
├── docs/                  # toda la documentación
│   ├── proyecto/          # ← esta documentación técnica
│   ├── decisiones-arquitectura.md
│   ├── guia-dataforseo.md
│   └── modulo-2-esquema/  # esquema de diseño v0.2 (SQL + tipos + ejemplo)
├── kr-service/            # Módulo 2 — Keyword Research
│   └── src/
│       ├── cli/           # spike.ts (entrada CLI)
│       ├── dataforseo/    # provider abstracto + cliente HTTP + endpoints
│       ├── llm/           # TextGen, Embedder, ContentGen (+ mocks)
│       ├── pipeline/      # run, intent, scoring, cluster, cluster-map, brief
│       ├── lib/           # vector (coseno), text (canonicalKey)
│       └── validation/    # esquema Zod del brief
└── web-builder/           # Módulo 1 — Creador de Webs
    └── src/
        ├── cli/           # build.ts, setup-storyblok.ts
        ├── handoff/       # adapter: brief → story
        ├── llm/           # ProseGen
        ├── publish/       # Publisher abstracto (mock / storyblok / dry-run)
        ├── render/        # HTML semántico + JSON-LD
        ├── storyblok/     # esquemas de componentes + shaping nativo
        └── contract.ts    # validación Zod del brief de entrada
```
