# Documentación técnica — AMG OS

Documentación completa del proyecto: qué es, cómo está construido, qué hace cada módulo
y en qué estado está. **Refleja el código real** del repositorio, no un diseño aspiracional:
cuando algo está diseñado pero no implementado, se dice explícitamente.

> Última revisión: 2026-07-14 · Estado: **Fase 2 en curso** — persistencia multi-tenant,
> orquestador durable e idempotencia del gasto, hechos. Falta la **API + el portal**.
> **247 tests en verde.**
>
> 👉 Si venís a **retomar el proyecto**, empezá por el
> [**Plan de la Fase 2**](11-plan-fase-2.md): dice de dónde venimos, dónde estamos y qué falta.

## Orden de lectura

| # | Documento | Para qué |
|---|---|---|
| 1 | [Visión general](01-vision-general.md) | Qué problema resuelve, quién es el cliente, qué módulos hay. |
| 2 | [Arquitectura](02-arquitectura.md) | Cómo está construido: flujo end-to-end, patrones, límites entre módulos. |
| 3 | [Stack tecnológico](03-stack.md) | Qué tecnologías se usan hoy, cuáles están decididas pero no implementadas, y por qué. |
| 4 | [Módulo 2 — Keyword Research](04-modulo-2-keyword-research.md) | El pipeline `prompt → brief SEO`, paso a paso. |
| 5 | [Módulo 1 — Creador de Webs](05-modulo-1-creador-webs.md) | El pipeline `brief SEO → web`, paso a paso. |
| 6 | [Contrato de handoff](06-contrato-handoff.md) | El brief JSON: la frontera entre los dos módulos. |
| 7 | [Configuración y entornos](07-configuracion.md) | Variables de entorno, modos mock/live, manejo de secretos. |
| 8 | [Testing y calidad](08-testing-calidad.md) | Suite de tests, typecheck, la review externa y qué se corrigió. |
| 9 | [Estado y roadmap](09-estado-y-roadmap.md) | Qué funciona hoy, qué falta para producción, riesgos abiertos. |
| 10 | ⚠️ [**Acciones pendientes (lado del usuario)**](10-acciones-pendientes.md) | Lo que **solo Juan puede hacer**: rotar la key, los números de precios, el research de prueba en producción, la cuenta de Storyblok y la decisión de alcance. |
| 11 | 🧭 [**Plan de la Fase 2**](11-plan-fase-2.md) | **Empezá por acá si retomás.** De dónde venimos, en qué punto exacto estamos, qué falta y en qué orden. |

## Contexto adicional

- **Decisiones de arquitectura (ADR-01..11):** [`../decisiones-arquitectura.md`](../decisiones-arquitectura.md) — el *porqué* de cada elección técnica, con las alternativas descartadas. Esta documentación las referencia constantemente.
- **Producto:** [`../contexto-proyecto-frank.md`](../contexto-proyecto-frank.md) y [`../A_PRD_AMG_Madrid_v1_Ilustrado.md`](../A_PRD_AMG_Madrid_v1_Ilustrado.md).
- **READMEs de código:** [`../../kr-service/README.md`](../../kr-service/README.md) y [`../../web-builder/README.md`](../../web-builder/README.md) — cómo correr cada módulo.
