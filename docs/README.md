# Documentación — AMG OS

Toda la documentación de producto, arquitectura y diseño de los módulos.
El código vive en [`../kr-service/`](../kr-service/) (Módulo 2) y [`../web-builder/`](../web-builder/) (Módulo 1);
cada uno tiene su propio `README.md`. La portada del repo es [`../README.md`](../README.md).

## ✅ ¿Qué tenés que hacer vos? → [**docs/acciones/**](acciones/)

Guías **paso a paso** de las 5 cosas que solo vos podés hacer (rotar la key de OpenAI, confirmar
precios, correr el research en producción, crear el space de Storyblok, unificar el alcance).
**El código está al día: el proyecto está bloqueado en estas acciones.**

## 📘 Empezá acá: [Documentación técnica del proyecto](proyecto/)

[`proyecto/`](proyecto/) es la **documentación completa y actualizada** del sistema: visión,
arquitectura, stack, los dos módulos en detalle, el contrato de handoff, configuración, testing
y roadmap. Refleja el código real, no un diseño aspiracional.

## Contexto y producto
| Documento | Qué es |
|---|---|
| [contexto-proyecto-frank.md](contexto-proyecto-frank.md) | Contexto original: cliente, participantes, módulos, criterios comerciales. |
| [A_PRD_AMG_Madrid_v1_Ilustrado.md](A_PRD_AMG_Madrid_v1_Ilustrado.md) | PRD v1.0 de AMG OS: problema, visión TO-BE, agentes, RBAC, roadmap por fases. |
| [A_PRD_AMG_Madrid_v1_Ilustrado (1).pdf](A_PRD_AMG_Madrid_v1_Ilustrado%20(1).pdf) | El PRD en PDF ilustrado. |

## Decisiones (leer antes de construir)
| Documento | Qué es |
|---|---|
| [decisiones-arquitectura.md](decisiones-arquitectura.md) | **Registro de decisiones (ADR-01..11):** stack, orquestación (Inngest), CMS (Storyblok), motor (DataForSEO), ES-first, LLM abstracto, offboarding, etc. |

## Módulo 2 — Keyword Research
| Documento | Qué es |
|---|---|
| [modulo-2-keyword-research.md](modulo-2-keyword-research.md) | Alcance del módulo (propósito, flujo, argumento comercial). |
| [modulo-2-keyword-research-plan.md](modulo-2-keyword-research-plan.md) | Plan técnico: arquitectura, modelo de datos, pipeline, scoring, costos, roadmap. |
| [modulo-2-esquema/schema.sql](modulo-2-esquema/schema.sql) | Esquema tipo v0.2 — DDL Postgres/Supabase (ES-first, market-aware). |
| [modulo-2-esquema/types.ts](modulo-2-esquema/types.ts) | Esquema tipo v0.2 — tipos TypeScript (fuente de diseño de `kr-service/src/types.ts`). |
| [modulo-2-esquema/ejemplo-brief.json](modulo-2-esquema/ejemplo-brief.json) | Ejemplo lleno del brief de salida. |
| [guia-dataforseo.md](guia-dataforseo.md) | Instructivo de alta y uso de DataForSEO (sandbox → producción). |

## Módulo 1 — Creador de Webs
El diseño está en la [ADR-04](decisiones-arquitectura.md) (Storyblok headless + Next.js AI-search-first)
y la [ADR-11](decisiones-arquitectura.md) (offboarding). El detalle de implementación de la PoC
(handoff, prose, Storyblok) vive en el README del módulo: [`../web-builder/README.md`](../web-builder/README.md).
