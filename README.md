# AMG OS — Documentación del proyecto

Plataforma SaaS multi-tenant para agencia de marketing gastronómico (AMG Madrid).
Convierte el conocimiento operativo de la agencia en software con agentes de IA
supervisados, RBAC y multi-tenancy. Este repositorio contiene la documentación de
producto, arquitectura y el diseño del primer módulo en construcción.

## 🚦 Estado actual
**Foco activo:** Módulo 2 — Keyword Research (fase de diseño cerrada, listo para spike de Fase 0).

## 📂 Documentos y orden de lectura

### 1. Contexto y producto
| Documento | Qué es |
|---|---|
| [contexto-proyecto-frank.md](contexto-proyecto-frank.md) | Contexto original: cliente, participantes, módulos, criterios comerciales. |
| [A_PRD_AMG_Madrid_v1_Ilustrado.md](A_PRD_AMG_Madrid_v1_Ilustrado.md) | PRD v1.0 de AMG OS: problema, visión TO-BE, 5 agentes, RBAC, roadmap por fases. |

### 2. Decisiones (leer antes de construir)
| Documento | Qué es |
|---|---|
| [decisiones-arquitectura.md](decisiones-arquitectura.md) | **Registro de decisiones (ADR):** stack, orquestación (n8n→Inngest), CMS (Storyblok), motor (DataForSEO), ES-first, etc. — con alternativas descartadas y justificación. |

### 3. Módulo 2 — Keyword Research (en construcción)
| Documento | Qué es |
|---|---|
| [modulo-2-keyword-research.md](modulo-2-keyword-research.md) | Alcance del módulo (propósito, flujo, argumento comercial). |
| [modulo-2-keyword-research-plan.md](modulo-2-keyword-research-plan.md) | **Plan técnico completo:** arquitectura, modelo de datos, pipeline de 13 pasos, scoring, costos, roadmap con esfuerzo. |
| [modulo-2-esquema/schema.sql](modulo-2-esquema/schema.sql) | Esquema tipo v0 — DDL Postgres/Supabase (ES-first, market-aware). |
| [modulo-2-esquema/types.ts](modulo-2-esquema/types.ts) | Esquema tipo v0 — tipos TypeScript (input, keyword, cluster, página, brief). |
| [modulo-2-esquema/ejemplo-brief.json](modulo-2-esquema/ejemplo-brief.json) | Ejemplo lleno del brief de salida (clínica dental, ES). |
| [guia-dataforseo.md](guia-dataforseo.md) | Instructivo de alta y uso de DataForSEO (sandbox → producción). |
| [kr-service/](kr-service/) | **Código** del pipeline (spike Fase 0): prompt → brief SEO. Corre por CLI contra sandbox. |

## 🧭 Decisiones clave (resumen)
- **Stack:** Next.js + TypeScript + Supabase (Postgres/RLS/Auth/Realtime/Storage/pgvector).
- **Orquestación:** Inngest/Trigger.dev en código; n8n solo como glue de integraciones.
- **Creador de Webs (Módulo 1):** Storyblok (headless + Visual Editor).
- **Keyword Research (Módulo 2):** DataForSEO, con compuerta de aprobación humana y output JSON + informe.
- **Mercado:** ES-first, diseño preparado para multi-idioma sin reescritura.
- **LLM:** Claude Opus 4.8 (generación) + Haiku 4.5 (clasificación).

Detalle y justificación en [decisiones-arquitectura.md](decisiones-arquitectura.md).

## ▶️ Próximos pasos
1. **Cargar credenciales DataForSEO** en `kr-service/.env` y correr `npm run spike` contra sandbox → luego producción para medir costo real por research.
2. **Fase 1-2 del Módulo 2:** reemplazar los stubs (intención heurística, clustering naive) por la lógica real (Haiku + SERP, embeddings/pgvector), y envolver el pipeline en Inngest.
3. **Bloqueante abierto:** contrato de bloks del Módulo 1 (Storyblok) para el adaptador de handoff.
4. **Riesgo de producto** (ver OBS-01): unificar el alcance solapado entre los dos documentos antes de la propuesta comercial.
