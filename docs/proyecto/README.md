# Documentación técnica — AMG OS

Documentación completa del proyecto: qué es, cómo está construido, qué hace cada módulo
y en qué estado está. **Refleja el código real** del repositorio, no un diseño aspiracional:
cuando algo está diseñado pero no implementado, se dice explícitamente.

> Última revisión: 2026-08-02 · Estado: **Fase 1 desplegada; de Fase 2, el renderizador también.** La
> cadena completa —research → compuerta humana → publicación → **la web servida en vivo**— funciona de
> punta a punta. API, portal y renderizador existen y se manejaron en un navegador real.
> **1069 tests en verde**: 786 en el monorepo + 283 en el portal (205 `node:test` + 78 Karma).
>
> ✅ **Fase 1 está en producción** desde el 2026-07-25: el portal en [`bigballs.es`](https://bigballs.es)
> (Hostinger), la API en `api.bigballs.es` (Railway) y la base con RLS forzada en Supabase. El login
> se verificó en el navegador el 2026-07-30.
>
> ✅ **Y el renderizador, desde el 2026-08-01**: la web del cliente se sirve en
> [`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app), leyendo
> de Supabase con el rol más pobre del sistema. Las **10** migraciones están aplicadas en producción.
> Procedimiento y tropiezos en el
> [runbook § desplegar el renderizador](14-runbook-despliegue.md#desplegar-el-renderizador-fase-2).
>
> ⚠️ **Falta el orquestador** (la última pieza de Fase 2 sin desplegar), el **dominio propio del
> cliente** —el plan de Railway está en su límite de custom domains— y una **CDN delante** del
> renderizador.
>
> 👉 Si venís a **retomar el proyecto**, empezá por
> [**Estado y roadmap**](09-estado-y-roadmap.md): qué hay construido, dónde estamos y qué queda por
> delante, ordenado por lo que realmente bloquea.

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
| 9 | 🧭 [**Estado y roadmap**](09-estado-y-roadmap.md) | **Empezá por acá si retomás.** Qué funciona hoy, qué queda por delante (ordenado por lo que bloquea), deudas y riesgos abiertos. |
| ~~10~~ | ✅ [Acciones del lado del usuario](../historia/10-acciones-pendientes.md) | Lo que **solo Juan podía hacer** (keys, saldo, cuentas, alcance). **Las seis están cerradas**, así que el documento se archivó en [`../historia/`](../historia/); queda como registro de qué desbloqueó cada una. El número 10 queda libre a propósito: renumerar el 11 rompería demasiados enlaces entrantes. |
| 11 | 🧭 [**Plan de la Fase 2**](11-plan-fase-2.md) | **Empezá por acá si retomás.** De dónde venimos, en qué punto exacto estamos, qué falta y en qué orden. |
| 12 | [Credenciales y roles](12-credenciales.md) | Los cuatro logins de Postgres, qué puede cada uno y **qué NO puede**. Cómo se reparten los secretos. |
| 13 | [Despliegue de la Fase 1](13-despliegue-fase-1.md) | La decisión de dónde se hostea cada pieza y por qué. |
| 14 | [**Runbook de despliegue**](14-runbook-despliegue.md) | El paso a paso real, con los tropiezos que hubo. Incluye cómo actualizar una instalación ya viva. |

## Contexto adicional

- **Bitácora del proyecto:** [`../../progress/history.md`](../../progress/history.md) — qué se hizo
  cada día, con sus tropiezos y sus lecciones, de lo más reciente a lo más viejo. Vive fuera de
  `docs/` a propósito: el `09` dice **dónde estamos**, la bitácora dice **cómo llegamos**, y
  mezclarlas fue lo que infló el `09` a 930 líneas. Lo que se está haciendo ahora mismo, en
  [`../../progress/current.md`](../../progress/current.md).

- **Decisiones de arquitectura (ADR-01..24 + OBS-01..04):** [`../decisiones-arquitectura.md`](../decisiones-arquitectura.md) — el *porqué* de cada elección técnica, con las alternativas descartadas **y las decisiones que hubo que corregir**. Esta documentación las referencia constantemente. 🔴 **OBS-04 está abierta** (2026-08-01): quién edita la web no lo gobierna nuestro RBAC.
- **Diseños y planes:** [`../superpowers/`](../superpowers/) — lo que todavía no está construido está
  en `plans/` y `specs/`; lo que ya aterrizó, en `ejecutados/`. El índice distingue una cosa de la otra.

- **Material de origen e historia cerrada:** [`../historia/`](../historia/) — el PRD y el contexto con
  los que se propuso el proyecto, las seis acciones ya cerradas, y los documentos del Módulo 2 previos
  a construirlo. Se conserva porque explica **por qué** el sistema es así; **no describe cómo es hoy**.
- **READMEs de código:** [`kr-service`](../../kr-service/README.md) · [`web-builder`](../../web-builder/README.md) · [`api`](../../api/README.md) · [`renderer`](../../renderer/README.md) · [`portal`](../../portal/README.md) — cómo correr cada pieza.
