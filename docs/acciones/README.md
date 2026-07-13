# Acciones pendientes — guías paso a paso

Las **5 cosas que solo vos podés hacer** (requieren cuentas, dinero o decisiones).
Una guía por acción, con los pasos exactos, cómo verificar que salió bien y qué hacer si falla.

> **El código está al día.** Todo lo que se podía construir sin cuentas ni saldo está hecho:
> los dos módulos funcionan de punta a punta, con 71 tests en verde. Ver
> [Estado y roadmap](../proyecto/09-estado-y-roadmap.md).

## Las 5 acciones

| # | Acción | Tiempo | Costo | Qué desbloquea |
|---|---|---|---|---|
| 🔴 [**01**](01-rotar-key-openai.md) | **Rotar la API key de OpenAI** | ~10 min | gratis | Cierra el único hallazgo de seguridad abierto. |
| 🟡 [**02**](02-precios-modelos.md) | **Confirmar los precios de los modelos** | ~5 min | gratis | Que el costo por research sea **confiable**. |
| ⭐ [**03**](03-research-produccion-dataforseo.md) | **Research de prueba en producción** | ~20 min | ~50 USD | El **costo real por research** (para presupuestarle a Frank) + datos reales para la demo. |
| 🟢 [**04**](04-storyblok-space.md) | **Crear un space de Storyblok** | ~15 min | gratis | La demo del **editor visual** — el argumento de venta del CMS. |
| 🔵 [**05**](05-unificar-alcance.md) | **Unificar el alcance (OBS-01)** | una charla | gratis | Poder presupuestar sin contradicciones. |

## Orden recomendado

```
01 (seguridad, urgente)
 └→ 02 (5 minutos, y desbloquea el 03)
     └→ 03 ⭐ (el de mayor valor: te da el número para la propuesta)
         └→ 04 (cierra la demo)

05 va en paralelo — depende de conversaciones, no de código.
```

**Si solo vas a hacer una:** hacé la **03**. Es la que convierte el proyecto en algo que le podés
mostrar y presupuestar a Frank.

## Checklist

- [ ] **01** — Key de OpenAI rotada (dos keys, una por módulo, con límite de gasto)
- [ ] **02** — Precios de `gpt-4o` y `text-embedding-3-small` confirmados
- [ ] **03** — Research de prueba en producción corrido, informe pasado
- [ ] **04** — Space de Storyblok creado, token y Space ID en el `.env`
- [ ] **05** — Alcance unificado con el socio y con Juan

## Dos reglas

1. 🔒 **Las credenciales van SIEMPRE al `.env`, nunca al chat ni a un commit.**
   Los `.env` están gitignoreados. Los **precios** (acción 02) sí me los podés pasar: son públicos.
2. ⚠️ **Después de la acción 03, volvé a sandbox.** Si no, cada corrida de desarrollo te cobra.

---

**Contexto de por qué importa cada una:** [docs/proyecto/10-acciones-pendientes.md](../proyecto/10-acciones-pendientes.md)
