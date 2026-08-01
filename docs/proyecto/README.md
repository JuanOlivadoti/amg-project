# Documentación técnica — AMG OS

Documentación completa del proyecto: qué es, cómo está construido, qué hace cada módulo
y en qué estado está. **Refleja el código real** del repositorio, no un diseño aspiracional:
cuando algo está diseñado pero no implementado, se dice explícitamente.

> Última revisión: 2026-08-01 · Estado: **Fase 1 desplegada; Fase 2 construida, sin desplegar.** La
> cadena completa —research → compuerta humana → publicación → **la web servida en vivo**— funciona de
> punta a punta. API, portal y renderizador existen y se manejaron en un navegador real.
> **516 tests en verde** en el monorepo (+**120** en el portal: 103 `node:test` + 17 Karma).
>
> ✅ **Fase 1 está en producción** desde el 2026-07-25: el portal en [`bigballs.es`](https://bigballs.es)
> (Hostinger), la API en `api.bigballs.es` (Railway) y la base con RLS forzada en Supabase. El login
> se verificó en el navegador el 2026-07-30.
>
> ⚠️ **El orquestador y el renderizador siguen sin desplegar** (son Fase 2): hoy corren solo en
> `localhost`. Eso es lo que separa a *la web del cliente* de que un cliente la pueda ver — y hay una
> **migración (`0010`) aplicada en el repo pero no en la base de producción**, que va junto con ese
> despliegue (ver [runbook § migraciones sobre una base ya desplegada](13-runbook-despliegue.md#aplicar-migraciones-nuevas-a-una-base-ya-desplegada)).
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
| 10 | ✅ [Acciones del lado del usuario](10-acciones-pendientes.md) | Lo que **solo Juan podía hacer** (keys, saldo, cuentas, alcance). **Las cinco están cerradas**; queda como registro de qué desbloqueó cada una. |
| 11 | 🧭 [**Plan de la Fase 2**](11-plan-fase-2.md) | **Empezá por acá si retomás.** De dónde venimos, en qué punto exacto estamos, qué falta y en qué orden. |
| 12 | [Credenciales y roles](12-credenciales.md) | Los cuatro logins de Postgres, qué puede cada uno y **qué NO puede**. Cómo se reparten los secretos. |
| 12 | [Despliegue de la Fase 1](12-despliegue-fase-1.md) | La decisión de dónde se hostea cada pieza y por qué. |
| 13 | [**Runbook de despliegue**](13-runbook-despliegue.md) | El paso a paso real, con los tropiezos que hubo. Incluye cómo actualizar una instalación ya viva. |

> ⚠️ Dos documentos comparten el prefijo `12` (credenciales y despliegue de Fase 1). Es deuda de
> nombres, no de contenido: renombrar rompería los links entrantes, que son muchos.

## Contexto adicional

- **Decisiones de arquitectura (ADR-01..23 + OBS-01/02/03):** [`../decisiones-arquitectura.md`](../decisiones-arquitectura.md) — el *porqué* de cada elección técnica, con las alternativas descartadas **y las decisiones que hubo que corregir**. Esta documentación las referencia constantemente.
- **Producto:** [`../contexto-proyecto-frank.md`](../contexto-proyecto-frank.md) y [`../A_PRD_AMG_Madrid_v1_Ilustrado.md`](../A_PRD_AMG_Madrid_v1_Ilustrado.md).
- **READMEs de código:** [`kr-service`](../../kr-service/README.md) · [`web-builder`](../../web-builder/README.md) · [`api`](../../api/README.md) · [`renderer`](../../renderer/README.md) · [`portal`](../../portal/README.md) — cómo correr cada pieza.
