# Acciones pendientes — guías paso a paso

Las **5 cosas que solo vos podés hacer** (requieren cuentas, dinero o decisiones).
Una guía por acción, con los pasos exactos, cómo verificar que salió bien y qué hacer si falla.

> **El código está al día.** La cadena `prompt → research → persistencia → compuerta humana → web`
> funciona de punta a punta, con **403 tests en verde**. Ver el
> [Plan de la Fase 2](../proyecto/11-plan-fase-2.md).

## Las 5 acciones

| # | Acción | Tiempo | Costo | Estado |
|---|---|---|---|---|
| 🔴 [**01**](01-rotar-key-openai.md) | **Rotar la API key de OpenAI** | ~10 min | gratis | ✅ **Hecha** (2026-07-13) |
| 🟡 [**02**](02-precios-modelos.md) | **Confirmar los precios de los modelos** | ~5 min | gratis | ✅ **Hecha** (2026-07-13) |
| ⭐ [**03**](03-research-produccion-dataforseo.md) | **Research de prueba en producción** | ~20 min | ~$0.87 gastados | ✅ **Hecha** (2026-07-13) |
| 🟢 [**04**](04-storyblok-space.md) | **Space de Storyblok** | ~15 min | gratis | ✅ **Hecha** (2026-07-13) |
| ✅ [**05**](05-unificar-alcance.md) | **Unificar el alcance (OBS-01)** | una charla | gratis | ✅ **Hecha** (2026-07-19) |
| 🎬 [**06**](06-corrida-final-demo.md) | **Corrida final + republicar la demo** | ~15 min | ~$0.31 | ⏳ **Pendiente** (antes de ver a Frank) |

## El número que salió de la 03

> ### Un research completo cuesta **~$0.31**
> 52 keywords → 8 páginas con contenido redactado. **El 81% es DataForSEO**, no la IA.

Estable en tres corridas ($0.28 / $0.28 / $0.31). Es el número para presupuestarle a Frank.
Detalle en la [guía 03](03-research-produccion-dataforseo.md).

## Qué sigue

```
✅ 01  keys rotadas y verificadas (ambos módulos usan OpenAI real)
✅ 02  precios verificados → el costo por research es confiable
✅ 03  research real corrido → costo por research + 3 bugs que el sandbox ocultaba
✅ 04  8 páginas publicadas en vivo en Storyblok, con datos reales

⏳ 05  No depende de código: es una charla con el socio y con Juan para
       unificar el alcance antes de la propuesta comercial.
⏳ 06  Corrida final (~$0.31) + republicar. Lo que está publicado en Storyblok
       es de ANTES de la tanda 5: no muestra la evidencia etiquetada y varias
       páginas declaran LocalBusiness sin serlo. Hacerlo ANTES de ver a Frank.
```

**Todo lo que dependía de cuentas, saldo y credenciales está hecho.** La 06 es opcional pero
recomendada: la demo actual es enseñable, pero no refleja las mejoras de la tanda 5.

## Lo que la corrida real destapó (y ya está corregido)

El sandbox ocultaba tres bugs. Encontrarlos era el punto de la acción 03:

1. **Decíamos "0 búsquedas/mes" donde no teníamos el dato** → ahora dice `n/d` (esquema `kr.v0.4`).
2. **Pagábamos keywords duplicadas** (`Madrid` vs `madrid`) → dedupe canónico.
3. **El clustering colapsaba el sitio en 3 páginas** → umbral recalibrado con datos reales: **8 páginas**.

## Decisiones abiertas

- **`gpt-4o` quedó legacy** y los modelos actuales son 2-3× más baratos ([guía 02](02-precios-modelos.md)).
  Pero ojo: la 03 mostró que **el LLM es solo el 19% del costo**, así que el ahorro real es chico.
  Ya no es urgente.
- **`is_local` se dispara de más** (7 de 8 páginas como `LocalBusiness`) → afecta el JSON-LD.
- **Costo por space de Storyblok** al escalar la cartera ([guía 04](04-storyblok-space.md)).

## Checklist

- [x] **01** — Key de OpenAI rotada (dos keys, una por módulo, con límite de gasto)
- [x] **02** — Precios de `gpt-4o` y `text-embedding-3-small` confirmados
- [x] **03** — Research en producción corrido · costo real: **$0.31** · `.env` revertido a sandbox
- [x] **04** — Space de Storyblok creado · 8 páginas publicadas en vivo
- [ ] **05** — Alcance unificado con el socio y con Juan
- [ ] **06** — Corrida final (kr.v0.5) + republicada la demo · `.env` revertido a sandbox

## Dos reglas

1. 🔒 **Las credenciales van SIEMPRE al `.env`, nunca al chat ni a un commit.**
   Los `.env` están gitignoreados. Los **precios** (acción 02) sí me los podés pasar: son públicos.
2. ⚠️ **Después de la acción 03, volvé a sandbox.** Si no, cada corrida de desarrollo te cobra.

---

**Contexto de por qué importa cada una:** [docs/proyecto/10-acciones-pendientes.md](../proyecto/10-acciones-pendientes.md)
