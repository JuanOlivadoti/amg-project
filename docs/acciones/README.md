# Acciones pendientes — guías paso a paso

Las **5 cosas que solo vos podés hacer** (requieren cuentas, dinero o decisiones).
Una guía por acción, con los pasos exactos, cómo verificar que salió bien y qué hacer si falla.

> **El código está al día.** Todo lo que se podía construir sin cuentas ni saldo está hecho:
> los dos módulos funcionan de punta a punta, con 71 tests en verde. Ver
> [Estado y roadmap](../proyecto/09-estado-y-roadmap.md).

## Las 5 acciones

| # | Acción | Tiempo | Costo | Estado |
|---|---|---|---|---|
| 🔴 [**01**](01-rotar-key-openai.md) | **Rotar la API key de OpenAI** | ~10 min | gratis | ✅ **Hecha** (2026-07-13) |
| 🟡 [**02**](02-precios-modelos.md) | **Confirmar los precios de los modelos** | ~5 min | gratis | ✅ **Hecha** (2026-07-13) |
| ⭐ [**03**](03-research-produccion-dataforseo.md) | **Research de prueba en producción** | ~20 min | ~50 USD | ⏳ Pendiente |
| 🟢 [**04**](04-storyblok-space.md) | **Crear un space de Storyblok** | ~15 min | gratis | ⏳ Pendiente |
| 🔵 [**05**](05-unificar-alcance.md) | **Unificar el alcance (OBS-01)** | una charla | gratis | ⏳ Pendiente |

## Qué sigue

```
✅ 01 (keys rotadas, verificadas: ambos módulos usan OpenAI real)
✅ 02 (precios verificados — el costo por research YA es confiable)

⏳ 03 ⭐  ← EL SIGUIENTE. Es el de mayor valor: te da el costo real por
          research (para presupuestarle a Frank) y datos reales para la demo.
⏳ 04     Cierra la demo (editor visual de Storyblok).
⏳ 05     Va en paralelo: depende de conversaciones, no de código.
```

**Si solo vas a hacer una:** hacé la **03**.

## Decisión abierta (surgió de la 02)

`gpt-4o` —el modelo que usa el sistema hoy— quedó **legacy**, y los modelos actuales son
**2-3× más baratos**. Como el costo por research es el argumento comercial del producto, vale la
pena evaluar el cambio. Detalle y números en la [guía 02](02-precios-modelos.md).

## Checklist

- [x] **01** — Key de OpenAI rotada (dos keys, una por módulo, con límite de gasto)
- [x] **02** — Precios de `gpt-4o` y `text-embedding-3-small` confirmados
- [ ] **03** — Research de prueba en producción corrido, informe pasado
- [ ] **04** — Space de Storyblok creado, token y Space ID en el `.env`
- [ ] **05** — Alcance unificado con el socio y con Juan

## Dos reglas

1. 🔒 **Las credenciales van SIEMPRE al `.env`, nunca al chat ni a un commit.**
   Los `.env` están gitignoreados. Los **precios** (acción 02) sí me los podés pasar: son públicos.
2. ⚠️ **Después de la acción 03, volvé a sandbox.** Si no, cada corrida de desarrollo te cobra.

---

**Contexto de por qué importa cada una:** [docs/proyecto/10-acciones-pendientes.md](../proyecto/10-acciones-pendientes.md)
