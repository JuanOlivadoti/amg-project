# AMG OS — Documentación del proyecto

Plataforma SaaS multi-tenant para agencia de marketing gastronómico (AMG Madrid).
Convierte el conocimiento operativo de la agencia en software con agentes de IA
supervisados, RBAC y multi-tenancy. Este repositorio contiene la documentación de
producto y arquitectura, y el código de los dos primeros módulos.

## 🚦 Estado actual — en producción, salvo el orquestador

**La cadena completa funciona de punta a punta**, con orquestación durable y aislamiento
multi-tenant impuesto por Postgres:

```
prompt → research → persistencia (RLS) → COMPUERTA HUMANA → contenido →
       → publicación en Storyblok → la web del cliente, servida en vivo
```

| Paquete | Qué es | Construido | En producción |
|---|---|---|---|
| **[kr-service/](kr-service/)** | Módulo 2 — Keyword Research (`prompt → brief SEO`) | ✅ | — *(CLI)* |
| **[web-builder/](web-builder/)** | Módulo 1 — Creador de Webs (`brief → Storyblok`) | ✅ | — *(CLI)* |
| **[db/](db/)** | Esquema, RLS multi-tenant, cache, registro de tareas | ✅ | ✅ Supabase, 10 migraciones |
| **[orchestrator/](orchestrator/)** | Inngest: steps durables + compuerta humana | ✅ | ⚪ **lo único sin desplegar** |
| **[api/](api/)** | REST autenticada (Hono): JWT verificado, RLS decide | ✅ | ✅ `api.bigballs.es` |
| **[renderer/](renderer/)** | Sirve las webs de cliente: 1 servicio, N dominios (ADR-19) | ✅ | ✅ Railway *(2026-08-01)* |
| **[portal/](portal/)** | SPA Angular — donde se aprueba la compuerta *(fuera del monorepo)* | ✅ | ✅ `bigballs.es` |

- **786 tests en verde** (+285 en el portal: 207 `node:test` + 78 Karma) · typecheck limpio en los 7
  paquetes · `npm test` desde la raíz.
- Los tests de seguridad corren contra **Postgres real** (PGlite en WASM): sin Docker, sin cuenta.
- Todo corre **sin una sola credencial**: providers mock + base en memoria.

> 🧭 **¿Retomás el proyecto?** Empezá por
> [**Estado y roadmap**](docs/proyecto/09-estado-y-roadmap.md): qué hay construido, dónde estamos y
> qué queda por delante, ordenado por lo que realmente bloquea.

⚠️ **Falta desplegar el orquestador**, la última pieza en `localhost`. Hasta que esté, el portal en
producción tiene apagados los botones de *lanzar research* y *aprobar* (`environment.prod.ts`).

⚠️ **El research corre contra el *sandbox* de DataForSEO** → volúmenes y costo **ficticios**. La
corrida real cuesta **~$0.31** ([guía](docs/historia/acciones/06-corrida-final-demo.md)).

## 📂 Documentos y orden de lectura

### 📘 Documentación técnica completa → [docs/proyecto/](docs/proyecto/)
Arquitectura, stack, los dos módulos en detalle, contrato de handoff, configuración, testing y
roadmap. **Es el mejor punto de entrada** para entender el sistema.

Las otras tres carpetas de [docs/](docs/), y por qué están separadas: 🧭
[**superpowers/**](docs/superpowers/) son los diseños y planes —lo que falta construir en `plans/` y
`specs/`, lo que ya aterrizó en `ejecutados/`—; 📦 [**historia/**](docs/historia/) es el material de
origen y lo ya cerrado, que explica **por qué** el sistema es así pero **no describe cómo es hoy**; y
`docs/private/` son credenciales que no se versionan.

### 1. Contexto y producto
| Documento | Qué es |
|---|---|
| [contexto-proyecto-frank.md](docs/historia/contexto-proyecto-frank.md) | Contexto original: cliente, participantes, módulos, criterios comerciales. |
| [A_PRD_AMG_Madrid_v1_Ilustrado.md](docs/historia/A_PRD_AMG_Madrid_v1_Ilustrado.md) | PRD v1.0 de AMG OS: problema, visión TO-BE, 5 agentes, RBAC, roadmap por fases. |

### 2. Decisiones (leer antes de construir)
| Documento | Qué es |
|---|---|
| [decisiones-arquitectura.md](docs/decisiones-arquitectura.md) | **Registro de decisiones (ADR):** stack, orquestación (n8n→Inngest), CMS (Storyblok), motor (DataForSEO), ES-first, etc. — con alternativas descartadas y justificación. |

### 3. Los dos módulos
| Documento | Qué es |
|---|---|
| [04 — Módulo 2: Keyword Research](docs/proyecto/04-modulo-2-keyword-research.md) | **El estado real** del pipeline `prompt → brief SEO`: sus 11 pasos, los costos medidos y el presupuesto. |
| [05 — Módulo 1: Creador de Webs](docs/proyecto/05-modulo-1-creador-webs.md) | **El estado real** del pipeline `brief SEO → web`. |
| [kr-service/](kr-service/) | **Código** del Módulo 2: prompt → brief SEO. Corre por CLI contra sandbox. |
| [web-builder/](web-builder/) | **Código** del Módulo 1: brief SEO → web (stories Storyblok + preview HTML). |
| [guia-dataforseo.md](docs/guia-dataforseo.md) | Instructivo de alta y uso de DataForSEO (sandbox → producción). |

El diseño **previo a construirlos** —plan técnico, modelo de datos propuesto, esquema tipo— quedó en
[docs/historia/](docs/historia/). No describe el sistema de hoy: uno de esos documentos todavía dice
que el motor es SEMrush, y es DataForSEO desde antes de la primera línea de código.

## 🧭 Decisiones clave (resumen)
- **Datos:** Postgres/Supabase con **RLS forzado**. El rol **no se declara**: se deriva de
  `memberships` dentro de la base (ADR-15). Un proceso, un login, un rol (ADR-17).
- **Orquestación:** **Inngest** en código (ADR-03/12); n8n solo como glue. **Un evento no porta
  autoridad**: la API crea el run bajo RLS, el evento solo lo dispara (ADR-18).
- **Portal:** **Angular + Tailwind**, mobile-first (ADR-16, reemplaza ADR-02/Next).
- **Creador de Webs (M1):** Storyblok (headless + Visual Editor).
- **Keyword Research (M2):** DataForSEO, con **compuerta de aprobación humana** y output JSON + informe.
- **LLM:** proveedor abstracto (OpenAI / Anthropic). Todo corre en mock sin credenciales.

Detalle y justificación —**incluidas las decisiones que tuve que corregir**— en
[decisiones-arquitectura.md](docs/decisiones-arquitectura.md).

## ▶️ Próximos pasos

Detalle en [**Estado y roadmap**](docs/proyecto/09-estado-y-roadmap.md). En corto:

1. **Desplegar** (etapa 5.3) — **es lo único que bloquea de verdad.** Tres procesos de larga
   duración (API, orquestador, renderizador) más la SPA estática. El research tarda minutos y no
   entra en una función serverless; y el renderizador necesita **DNS por cliente + TLS por dominio**,
   lo que condiciona qué hosting sirve.
2. **La corrida final** (~$0.31) y **republicar**: lo que está hoy en Storyblok es anterior a
   `kr.v0.5` y no muestra la evidencia etiquetada, que es el argumento de venta.
3. **Una CDN delante del renderizador.** ADR-19 dice "cache en el borde"; lo construido es una cache
   **en proceso**. Además, con más de una instancia el webhook de invalidación llega a una sola.

### 🔴 Decisiones abiertas

- **OBS-04 — ¿quién edita la web?** El portal y Storyblok son **dos identidades que no se cruzan**:
  nuestro RBAC sale de `memberships` dentro de Postgres, pero quién puede editar un sitio lo deciden
  los seats del space. De esto dependen el **costo por cartera** y la cláusula de *handoff editable*.
- **Reescribir ADR-11** (offboarding). Ya **hay qué entregar** —el space de Storyblok **más** el
  renderizador—, pero el ADR sigue redactado sobre "el frontend Next.js", que no existe. De ahí sale
  una cláusula de contrato, así que no puede firmarse como está — y ahora **espera a OBS-04**.
- **Dimensionar el riesgo de disponibilidad antes de vender un SLA.** El renderizador es un punto
  único: si se cae, **se caen todas las webs de cliente a la vez**. Está mitigado, no eliminado.

**Acciones del lado del usuario:** las seis están cerradas y quedaron archivadas en
[docs/historia/acciones/](docs/historia/acciones/) como registro de qué desbloqueó cada una.
(**OBS-01 cerrada**: alcance base = 3 módulos, manda
[`docs/historia/contexto-proyecto-frank.md`](docs/historia/contexto-proyecto-frank.md).) Lo único que
sigue costando dinero y espera decisión —**regenerar el dataset crudo, ~$0.31** contra DataForSEO en
producción— está en [`progress/current.md`](progress/current.md).
