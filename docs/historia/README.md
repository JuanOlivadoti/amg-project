# Historia y material de origen

**Nada de acá describe el sistema de hoy.** Es lo que explica **por qué** el sistema es así: lo que se
le propuso al cliente, el diseño previo a construir, y las acciones que en su momento bloquearon el
proyecto y ya están cerradas.

Se conserva porque el código no cuenta el *por qué*: la alternativa que se descartó, el número que se
prometió, la restricción que venía del cliente. Se archiva porque un documento terminado no puede
seguir compitiendo por atención con lo que falta hacer.

> **Si algo de acá contradice a [`../proyecto/`](../proyecto/), gana `../proyecto/`.** Sin excepción:
> esa carpeta refleja el código, esta refleja el pasado.

## Material de origen — lo que se propuso

| Documento | Qué es | Cuidado |
| --- | --- | --- |
| [A_PRD_AMG_Madrid_v1_Ilustrado.md](A_PRD_AMG_Madrid_v1_Ilustrado.md) · [PDF](A_PRD_AMG_Madrid_v1_Ilustrado.pdf) | El PRD v1.0: problema, visión TO-BE, los agentes, RBAC, roadmap por fases | Roadmap y fases quedaron viejos |
| [contexto-proyecto-frank.md](contexto-proyecto-frank.md) | El contexto original: cliente, participantes, módulos, criterios comerciales | Es la referencia del **alcance base de 3 módulos** (OBS-01, cerrada) |

## El Módulo 2 antes de construirlo

| Documento | Qué es | Cuidado |
| --- | --- | --- |
| [modulo-2-keyword-research.md](modulo-2-keyword-research.md) | El alcance comercial del módulo | ⚠️ **Dice que el motor es SEMrush. No lo es: es DataForSEO** (ADR-04) |
| [modulo-2-keyword-research-plan.md](modulo-2-keyword-research-plan.md) | El plan técnico v1.0: modelo de datos, esquemas de output, mercados, RGPD, riesgos, decisiones que estaban abiertas | El pipeline real tiene 11 pasos, no los 13 de acá |
| [modulo-2-esquema/](modulo-2-esquema/) | El esquema tipo v0.2 que se usó de referencia: [DDL](modulo-2-esquema/schema.sql), [tipos](modulo-2-esquema/types.ts), [brief de ejemplo](modulo-2-esquema/ejemplo-brief.json) | El esquema real vive en `db/migrations/`; los tipos reales, en `contrato/src/tipos.ts` (desde KR-2a; `kr-service/src/types.ts` los reenvía) |

**El estado real del módulo 2:**
[`../proyecto/04-modulo-2-keyword-research.md`](../proyecto/04-modulo-2-keyword-research.md).

## Acciones del usuario — las que bloquearon, ya cerradas

Lo que solo Juan podía hacer: keys, saldo, cuentas, decisiones de alcance. **Están todas cerradas**;
quedan como registro de qué desbloqueó cada una y a qué precio.

| Documento | Qué desbloqueó |
| --- | --- |
| [10-acciones-pendientes.md](10-acciones-pendientes.md) | El índice con el que se seguían. Era el `10` de la serie de `../proyecto/` |
| [acciones/](acciones/) | Las guías paso a paso: [rotar la key de OpenAI](acciones/01-rotar-key-openai.md), [precios de los modelos](acciones/02-precios-modelos.md), [research en producción](acciones/03-research-produccion-dataforseo.md), [space de Storyblok](acciones/04-storyblok-space.md), [unificar el alcance](acciones/05-unificar-alcance.md), [la corrida final](acciones/06-corrida-final-demo.md) y el [guion de la demo](acciones/07-guion-demo-frank.md) |

> La corrida final está hecha, pero **regenerar el dataset crudo sigue costando ~$0.31** contra
> DataForSEO en producción. Esa decisión está en
> [`../../progress/current.md`](../../progress/current.md), no acá.
