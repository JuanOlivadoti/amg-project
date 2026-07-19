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
| **npm workspaces** | — | **6 paquetes, un solo `npm install`.** Se importan **por nombre** (`import { PgStore } from "db"`), no por ruta relativa. |

### Los seis paquetes

| Paquete | Qué es | Dependencias de runtime |
|---|---|---|
| **`db`** | Esquema, RLS, cache, registro de tareas | `@electric-sql/pglite` |
| **`kr-service`** (M2) | `prompt → brief SEO` | `openai`, `@anthropic-ai/sdk`, `zod`, `dotenv` |
| **`web-builder`** (M1) | `brief → Storyblok` | `openai`, `zod`, `dotenv` |
| **`orchestrator`** | Inngest: steps durables + compuerta humana | `inngest`, `pg`, y `db` + los dos módulos |
| **`api`** | REST autenticada: JWT → RLS decide (ADR-22) | `hono`, `jose`, `pg`, `inngest`, `db` |
| **`renderer`** | Sirve las webs de cliente: 1 servicio, N dominios (ADR-19) | `hono`, `pg`, `db`, `web-builder` |

> **`portal/` (Angular) NO es un workspace, a propósito.** Tiene su propio `package.json` y su propio
> `node_modules`: el toolchain de Angular (AOT, `ng build`) y el del backend no se llevan bien en el
> mismo árbol de dependencias, y mezclarlos haría que un `npm install` del backend pudiera romper la
> compilación de la SPA. Ver [ADR-21](../decisiones-arquitectura.md).

> **`renderer` importa `web-builder`, y solo eso.** No conoce `kr-service` ni `api`. La frontera es
> estrecha porque es el proceso más expuesto del sistema: **todo lo que pueda importar es todo lo que
> puede filtrar.**

Para qué sirve cada una:

| Paquete | Para qué |
|---|---|
| `openai` | Generación (seeds, intención, relevancia, contenido on-page, prose) + **embeddings** (clustering). |
| `@anthropic-ai/sdk` | Generación con Claude (alternativa a OpenAI). |
| `zod` | Validación del brief contra el esquema **`kr.v0.5`**, en ambos lados de la frontera. |
| `inngest` | Orquestación durable: steps, reintentos, `waitForEvent` para la compuerta humana. |
| `pg` | Cliente Postgres **con pool** — cada transacción reserva su conexión (ADR-13). |
| `@electric-sql/pglite` | **Postgres 18 compilado a WASM, en proceso.** Ver abajo. |

**Storyblok se llama con `fetch` nativo** — no se usó su SDK, para no sumar una dependencia
por unas pocas llamadas HTTP a la Management API.

### Testing
| Tecnología | Notas |
|---|---|
| **`node:test` + `node:assert`** | Test runner **nativo de Node**. Cero dependencias nuevas. |
| **PGlite** | **Postgres de verdad** (en WASM, en memoria) para los tests de RLS. |
| **tsx** | Se corre con `node --import tsx --test "src/**/*.test.ts"`. |

Se descartaron Jest y Vitest: para funciones puras el runner nativo alcanza y evita decenas de
paquetes transitivos.

**PGlite es la decisión de testing que más rindió.** Las políticas RLS son la frontera de
seguridad del producto, y un *mock* de Postgres no puede probarlas: lo que hay que verificar es
que **Postgres las hace cumplir**. Con PGlite, los 93 tests de `db/` corren las migraciones
reales contra un Postgres real —**sin Docker, sin cuenta, sin red**— y se ejecutan en CI como
cualquier test unitario. Sin esto, los agujeros multi-tenant que encontraron las reviews externas
no se habrían podido cerrar con una prueba, solo con un argumento.

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

## B. Lo decidido para producción

Razonado en las [decisiones de arquitectura](../decisiones-arquitectura.md), con las alternativas
descartadas y por qué. **La columna de estado es la que importa:** varias de estas ya no son
promesas.

| Pieza | Elección | ADR | Estado | Motivo resumido |
|---|---|---|---|---|
| **Base de datos / Auth** | **Supabase** (Postgres + RLS + Auth + pgvector) | ADR-01 | ✅ **En el código** (Postgres/RLS **y el JWT, verificado y probado**) | Un solo Postgres resuelve multi-tenancy (RLS por `tenant_id`), RBAC y vectores a la vez. Se descartó ensamblar Auth0 + RDS + Pinecone + S3. |
| **Orquestación** | **Inngest** (flujos como código, durables) | ADR-03, ADR-12 | ✅ **En el código** | Reintentos, idempotencia y `waitForEvent` para la compuerta humana. **Se descartó n8n como backbone** (flujos en JSON no se versionan ni testean bien); queda solo como *glue*. |
| **Portal** | **Angular + Tailwind**, mobile-first · standalone + signals · **Tailwind puro** (sin librería de componentes) · **polling**, no Realtime | **ADR-16** (*reemplaza ADR-02*), **ADR-20**, **ADR-21** | ✅ **Construido** (`portal/`, 29 tests) | El portal es un **SPA privado y autenticado**: SSR/RSC/SEO —todo lo que justificaba Next— no aporta nada acá. Sirve al **equipo** (aprueba) y al **cliente** (solo lectura). |
| **API** | REST sobre Node (**Hono**), login `amg_api` | ADR-15, ADR-17, ADR-18, **ADR-22** | ✅ **Construida** (`api/`, 33 tests) | Verifica el JWT, afirma **quién eres**, y deja que **Postgres decida qué podés**. **El portal habla solo con ella** — nunca con PostgREST. |
| **CMS del Módulo 1** | **Storyblok** (headless + Visual Editor) | ADR-04 | ✅ Publica el contenido | Creación programática vía Management API + edición visual para no-técnicos. Se descartó WordPress/Elementor (JSON opaco) y Payload (sin edición visual sobre el lienzo). |
| **Render de las webs de cliente** | **Renderizador propio en runtime**, multi-tenant (1 servicio, N dominios) | **ADR-19** (*cierra OBS-03*) | ✅ **Construido** (`renderer/`, 60 tests) — falta desplegar | Lee la Content Delivery API de Storyblok y sirve la web en vivo. Elegido sobre "estático + rebuild" porque el **Visual Editor necesita una URL de preview en vivo** — y el Visual Editor es *la razón por la que se eligió Storyblok*. |
| **Motor de keyword research** | **DataForSEO** | ADR-05 | ✅ En el código | Pay-as-you-go barato. Se descartó SEMrush (~450€/mes) y Google Ads API (developer token, volúmenes en rangos). |
| **LLM** | **Proveedor abstracto** (OpenAI / Anthropic); embeddings con OpenAI | ADR-09 | ✅ En el código | No quedar casados con un proveedor. Embeddings van con OpenAI porque **Anthropic no tiene API de embeddings propia**. |

> ⚠️ **Next.js ya no está en el stack.** ADR-02 lo eligió asumiendo que *un mismo frontend*
> renderizaría el portal **y las webs públicas de cliente**. Al acotar el alcance al portal interno,
> esa premisa se cayó (**ADR-16**) — y las dos mitades se separaron: el portal es **Angular**
> (ADR-21) y las webs de cliente las sirve un **renderizador propio** (ADR-19). Durante un tiempo
> esa segunda mitad quedó **sin dueño**, que es lo que registró OBS-03.

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
├── package.json           # workspaces: db, kr-service, web-builder,
│                          #             orchestrator, api, renderer
├── README.md              # portada del repo
├── docs/                  # toda la documentación
│   ├── proyecto/          # ← esta documentación técnica
│   ├── acciones/          # lo que solo Juan puede hacer (cuentas, saldo, decisiones)
│   ├── decisiones-arquitectura.md    # ADR-01..22 + OBS-01/02/03
│   └── modulo-2-esquema/  # esquema de diseño v0 (SQL + tipos + ejemplo)
│
├── db/                    # LA PLATAFORMA — esquema, RLS, cache, tareas
│   ├── migrations/        # 0001_init · 0002_auth · 0003_credenciales
│   │                      # 0004_paginas · 0005_lease_tareas
│   │                      # 0006_cliente_publicacion · 0007_render_publico
│   └── src/
│       ├── pool.ts        # DbPool/Tx: acceso SOLO por transacción reservada (ADR-13)
│       ├── store.ts       # PgStore: runs, keywords, páginas — todo bajo RLS
│       ├── task-log.ts    # idempotencia del gasto por payload_hash (ADR-14)
│       ├── cache.ts       # cache de métricas y SERP con expiración
│       ├── migrate.ts     # aplica las migraciones en orden
│       └── testing.ts     # SQL crudo: solo para tests, NO se exporta
│
├── orchestrator/          # EL COMPOSITION ROOT — conoce a los tres a la vez
│   └── src/
│       ├── solicitar.ts   # la costura de la API: crea el run BAJO RLS, luego emite (ADR-18)
│       ├── workflow.ts    # los steps durables + la compuerta humana
│       ├── functions.ts   # Inngest: concurrencia, retries, idempotencia, onFailure
│       ├── deps.ts        # conexiones y providers (PGlite en memoria si no hay credenciales)
│       └── events.ts      # el evento lleva coordenadas, NO autoridad
│
├── kr-service/            # MÓDULO 2 — Keyword Research
│   └── src/
│       ├── cli/           # spike.ts (entrada CLI)
│       ├── dataforseo/    # provider abstracto + cliente HTTP + endpoints + task-log
│       ├── llm/           # TextGen, Embedder, ContentGen (openai / anthropic / mock)
│       ├── pipeline/      # run, intent, scoring, cluster, cluster-map, brief
│       ├── lib/           # vector (coseno) · text (canonicalKey) · cost · budget · http
│       └── validation/    # esquema Zod del brief (kr.v0.5)
│
├── web-builder/           # MÓDULO 1 — Creador de Webs
│   └── src/
│       ├── cli/           # build.ts, setup-storyblok.ts
│       ├── handoff/       # adapter: brief → story
│       ├── llm/           # ProseGen
│       ├── lib/           # uid (_uid deterministas) · http (retries)
│       ├── publish/       # Publisher abstracto (mock / storyblok / dry-run)
│       ├── render/        # HTML semántico + JSON-LD  ← lo reutiliza el renderer
│       ├── storyblok/     # esquemas de componentes + shaping nativo
│       └── contract.ts    # validación Zod del brief de entrada
│
├── api/                   # LA API REST (Hono) — etapa 5.1, ADR-22
│   └── src/
│       ├── app.ts         # rutas; recibe TODO inyectado (por eso se testea sin red)
│       ├── auth.ts        # verifica el JWT: exp/sub/aud/iss y alg fijado a HS256
│       ├── solicitar.ts   # comando compuesto: la fila bajo RLS, y RECIÉN ahí el evento
│       ├── deps.ts        # composition root: el único que toca credenciales
│       └── dev-server.ts  # la API real sobre PGlite, sin credenciales (nunca en prod)
│
├── renderer/              # LAS WEBS DE CLIENTE — etapa 6, ADR-19
│   └── src/
│       ├── app.ts         # Host → dominio → sitio → cache → CDA → renderStory()
│       ├── dominio.ts     # el `Host` como dato HOSTIL: normaliza, valida, sin fallback
│       ├── cda.ts         # Content DELIVERY API (jamás la Management)
│       ├── cache.ts       # TTL + LRU + invalidación por space
│       ├── webhook.ts     # HMAC en tiempo constante: sin firma no se vacía nada
│       ├── preview.ts     # enlace firmado atado al dominio + Storyblok Bridge
│       └── perfil.ts      # un NAP mal cargado degrada la página, no tira la web
│
└── portal/                # LA SPA ANGULAR — NO es un workspace (toolchain aparte)
    └── src/app/
        ├── core/          # la lógica pura, sin Angular ni DOM: se testea con node:test
        └── pages/         # componentes: cáscaras finas sobre core/
```

**El grafo de dependencias es deliberado:** `orchestrator` importa a `db` y a los dos módulos;
`web-builder` **no importa nada de** `kr-service` (habla con él solo por el brief JSON); `renderer`
importa **solo** `db` y `web-builder`; y `db` no importa a nadie.

### Módulos de infraestructura compartidos (por módulo)

| Archivo | Qué resuelve |
|---|---|
| `lib/http.ts` | Timeout, reintentos con backoff + jitter, `Retry-After`, clasificación de errores. *(Está duplicado en ambos módulos — deuda conocida.)* |
| `kr-service/lib/cost.ts` | Medición del costo del run (todos los proveedores) en micros de USD. |
| `kr-service/lib/budget.ts` | Presupuesto preflight: aborta una fase antes de gastar si no entra en el tope. |
| `kr-service/lib/text.ts` | `canonicalKey`: clave canónica para matchear keywords entre proveedores. |
| `web-builder/lib/uid.ts` | `_uid` deterministas para los bloks de Storyblok. |
