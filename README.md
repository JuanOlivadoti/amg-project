# AMG OS — Documentación del proyecto

Plataforma SaaS multi-tenant para agencia de marketing gastronómico (AMG Madrid).
Convierte el conocimiento operativo de la agencia en software con agentes de IA
supervisados, RBAC y multi-tenancy. Este repositorio contiene la documentación de
producto y arquitectura, y el código de los dos primeros módulos.

## 🚦 Estado actual — Fase 2 en curso

**La cadena `prompt → research → persistencia → compuerta humana → web publicada` funciona de punta
a punta**, con orquestación durable y aislamiento multi-tenant real.

| Paquete | Qué es | Estado |
|---|---|---|
| **[kr-service/](kr-service/)** | Módulo 2 — Keyword Research (`prompt → brief SEO`) | ✅ |
| **[web-builder/](web-builder/)** | Módulo 1 — Creador de Webs (`brief → Storyblok`) | ✅ |
| **[db/](db/)** | Esquema, RLS multi-tenant, cache, registro de tareas | ✅ |
| **[orchestrator/](orchestrator/)** | Inngest: steps durables + compuerta humana | ✅ |
| `api/` | REST autenticada para el portal | ⏳ siguiente |
| `portal/` | SPA Angular (donde se aprueba la compuerta) | ⏳ |

- **204 tests en verde** · typecheck limpio en los 4 paquetes · `npm test` desde la raíz.
- Los tests de seguridad corren contra **Postgres real** (PGlite en WASM): sin Docker, sin cuenta.
- Todo corre **sin una sola credencial**: providers mock + base en memoria.

> 🧭 **¿Retomás el proyecto?** Empezá por el
> [**Plan de la Fase 2**](docs/proyecto/11-plan-fase-2.md): de dónde venimos, dónde estamos y qué
> falta.

⚠️ **El research corre contra el *sandbox* de DataForSEO** → volúmenes y costo **ficticios**. La
corrida real cuesta **~$0.31** ([guía](docs/acciones/06-corrida-final-demo.md)). **La compuerta de
aprobación todavía se ejecuta editando un JSON a mano** — eso es lo que resuelve el portal.

## 📂 Documentos y orden de lectura

### 📘 Documentación técnica completa → [docs/proyecto/](docs/proyecto/)
Arquitectura, stack, los dos módulos en detalle, contrato de handoff, configuración, testing y
roadmap. **Es el mejor punto de entrada** para entender el sistema.

### 1. Contexto y producto
| Documento | Qué es |
|---|---|
| [contexto-proyecto-frank.md](docs/contexto-proyecto-frank.md) | Contexto original: cliente, participantes, módulos, criterios comerciales. |
| [A_PRD_AMG_Madrid_v1_Ilustrado.md](docs/A_PRD_AMG_Madrid_v1_Ilustrado.md) | PRD v1.0 de AMG OS: problema, visión TO-BE, 5 agentes, RBAC, roadmap por fases. |

### 2. Decisiones (leer antes de construir)
| Documento | Qué es |
|---|---|
| [decisiones-arquitectura.md](docs/decisiones-arquitectura.md) | **Registro de decisiones (ADR):** stack, orquestación (n8n→Inngest), CMS (Storyblok), motor (DataForSEO), ES-first, etc. — con alternativas descartadas y justificación. |

### 3. Módulos en construcción (diseño + código)
| Documento | Qué es |
|---|---|
| [modulo-2-keyword-research.md](docs/modulo-2-keyword-research.md) | Alcance del módulo (propósito, flujo, argumento comercial). |
| [modulo-2-keyword-research-plan.md](docs/modulo-2-keyword-research-plan.md) | **Plan técnico completo:** arquitectura, modelo de datos, pipeline de 13 pasos, scoring, costos, roadmap con esfuerzo. |
| [modulo-2-esquema/schema.sql](docs/modulo-2-esquema/schema.sql) | Esquema tipo v0 — DDL Postgres/Supabase (ES-first, market-aware). |
| [modulo-2-esquema/types.ts](docs/modulo-2-esquema/types.ts) | Esquema tipo v0 — tipos TypeScript (input, keyword, cluster, página, brief). |
| [modulo-2-esquema/ejemplo-brief.json](docs/modulo-2-esquema/ejemplo-brief.json) | Ejemplo lleno del brief de salida (clínica dental, ES). |
| [guia-dataforseo.md](docs/guia-dataforseo.md) | Instructivo de alta y uso de DataForSEO (sandbox → producción). |
| [kr-service/](kr-service/) | **Código** del Módulo 2 (spike Fase 0): prompt → brief SEO. Corre por CLI contra sandbox. |
| [web-builder/](web-builder/) | **Código** del Módulo 1 (Creador de Webs, PoC): brief SEO → web (stories Storyblok + preview HTML). |

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

Ver el [**Plan de la Fase 2**](docs/proyecto/11-plan-fase-2.md). En corto:

1. **La API REST** (autenticada, Supabase Auth) → siguiente.
2. **El portal Angular**: donde el equipo aprueba la compuerta. Hoy eso se hace **editando un JSON a
   mano**, y es lo que impide que use el sistema alguien que no sea yo.
3. **Desplegar** (orquestador + API como servicio Node de larga duración; el research tarda minutos
   y no entra en una función serverless).

4. **El renderizador** (etapa 6, ADR-19): hoy el M1 genera la web y publica el contenido en
   Storyblok, pero **nada la sirve en un dominio**. Sin esto, el cliente no *tiene* una web — y el
   Visual Editor, que es la razón por la que se eligió Storyblok, no llega a ninguna página
   publicada.

### 🔴 Decisiones abiertas

- **OBS-01 — unificar el alcance.** Dos documentos de producto describen alcances incompatibles.
  Es la última observación abierta.
- **Reescribir ADR-11** (offboarding) en términos del renderizador: sigue redactado sobre "el
  frontend Next.js", que no existe — y de ahí sale una cláusula de contrato.

**Acciones que solo Juan puede hacer** — guías paso a paso en [**docs/acciones/**](docs/acciones/):
la **corrida final en producción** (~$0.31) y **unificar el alcance** (OBS-01) antes de consolidar la
propuesta comercial.
