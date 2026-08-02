---
name: portal-estilos
description: Usar al escribir clases de Tailwind, elegir un color, tocar styles.css o el tema claro/oscuro en el portal de AMG OS (portal/), y al maquetar cualquier pantalla nueva. Cubre los tokens de color por rol, las cuatro cosas que un test prohíbe en las plantillas, el contraste AA y las trampas de Tailwind v4 sin archivo de configuración.
---

# Estilos del portal de AMG OS

**Tailwind v4** (sintaxis CSS-first, **no existe `tailwind.config.js`**), un único `src/styles.css`
global, cero CSS por componente. El tema claro/oscuro se pinta con variables CSS.

**La regla de la que salen todas las demás: un color que no es un token es un color que el tema no
puede cambiar.** Y no es una recomendación: hay un test que recorre `src/app` entero y falla.

## Los tokens: por rol, nunca por color

`bg-superficie`, no `bg-white`. `text-texto-tenue`, no `text-gray-500`. El nombre dice **qué papel
cumple** el color, para que el mismo nombre pueda valer #ffffff en claro y #171d26 en oscuro.

La lista canónica es `TOKENS` en [core/contraste.ts](../../../portal/src/app/core/contraste.ts), y los
valores viven **solo** en `styles.css`, en dos bloques: `:root` (claro) y `.oscuro`. Familias:

| Familia | Para qué |
|---|---|
| `fondo`, `superficie`, `superficie-2` | El fondo de página y los dos niveles de elevación |
| `texto`, `texto-medio`, `texto-tenue`, `texto-invertido` | Jerarquía de lectura; el invertido va sobre un acento |
| `borde`, `borde-fuerte` | Bordes y separadores |
| `accion` | El color de la acción primaria |
| `respaldo`/`respaldo-suave`, `alerta`/`alerta-suave`, `error`/`error-suave` | Estado: el par es texto + su fondo tenue |
| `velo` | El backdrop de los overlays |

Agregar un token es tocar **tres** lugares o el test cae: `TOKENS`, el bloque `:root` **y** el bloque
`.oscuro`, más su línea en `@theme inline` (que es lo que hace que Tailwind emita la utilidad).

## Las cuatro cosas prohibidas en una plantilla

`contraste.test.ts` recorre todos los `.ts` y `.html` de `src/app` —**las plantillas se descubren, no
se listan**, así que una pantalla nueva queda cubierta sola— y falla si encuentra:

1. **Un hex**: `#fff`, `#15803d`, `#0f1419ff`.
2. **Un color en un `style` inline**: `style="color: …"`.
3. **Una función de color**: `rgb()`, `rgba()`, `hsl()`, `hsla()`.
4. **La paleta cruda de Tailwind**: `bg-gray-100`, `text-white`, `border-slate-200`, `from-blue-500`…
   Existe (v4 la trae por defecto y no hay config que la apague) y **queda congelada en claro igual
   que un hex**.

La cuarta es la que más sorprende: `bg-white` es una clase válida de Tailwind, se ve bien mientras
mirás en claro, y rompe el tema. Si necesitás un color que no existe como token, la respuesta no es
escapar del sistema: es agregar el token (en los tres lugares) o reusar el rol que corresponde.

## Contraste: lo impone un test, no el ojo

Cada par `[texto, fondo]` que la UI usa de verdad está en `PARES`, y el test exige **AA 4.5:1 en los
dos temas**. Retocar un color por gusto falla ruidosamente, que es exactamente lo que se quiere: la
distinción ✅ respaldado / ⚠️ sin validar es el argumento de venta del producto, y "se lee bien" no es
una garantía si la única prueba es que a alguien le pareció.

Si agregás una combinación nueva (texto X sobre fondo Y), **agregá el par a `PARES`**. Un par que no
está listado no se verifica.

`borde` y `borde-fuerte` no están en `PARES` a propósito: no llevan texto. Su contraste contra la
superficie está por debajo del 3:1 de WCAG 1.4.11 — es deuda anotada, no un olvido.

## El tema claro/oscuro

- La clase `.oscuro` va en `<html>`. Como `<html>` también es `:root`, las dos reglas tienen la misma
  especificidad: **el bloque `.oscuro` DEBE quedar debajo de `:root`** en `styles.css`.
- `color-scheme` (`light` / `dark`) no es decorativo: sin él el navegador pinta en claro los inputs,
  el caret y las barras de scroll sobre un portal oscuro. En el login son dos inputs y se nota.
- Las tres reglas de la paleta oscura: las superficies son oscuras pero **no negras** y en tres
  niveles (para que se lea la elevación); los acentos **se aclaran** (un verde 700 sobre fondo oscuro
  desaparece); `texto-invertido` se da vuelta a casi negro, porque va sobre un acento claro.
- El estado del tema es de `TemaService`, con el ciclo `auto → claro → oscuro → auto` persistido en
  `localStorage` (envuelto en `try/catch`: en modo privado se vive en memoria). La decisión de qué
  tema se pinta es la función pura `temaEfectivo(elegido, sistemaPrefiereOscuro)`.

## Trampas de Tailwind v4 (las que ya nos mordieron)

**No hay `tailwind.config.js`.** Todo lo que en v3 se configuraba ahí, en v4 se repone en CSS:

- **`border-color` por defecto.** En v3, `class="border"` tomaba el color de `borderColor.DEFAULT`.
  En v4 cae en `currentColor`. Por eso `styles.css` tiene un `@layer base` que le pone
  `border-color: var(--borde)` a todo. No lo borres, y no lo "arregles" poniéndole un color explícito
  a los cuatro bordes de hoy: eso deja roto al quinto.
- **`::placeholder`.** El preflight de v4 le aplica `color-mix(in oklab, currentcolor 50%, transparent)`,
  que sobre `--texto` queda por debajo de AA. Se pisa globalmente con `color: var(--texto-tenue)`.
- **`@theme inline`** es lo que convierte una variable en utilidad: sin `--color-respaldo: var(--respaldo)`
  ahí, la clase `text-respaldo` simplemente **no se emite** y el typecheck no dice nada. Un test
  compara nombre por nombre y además exige que cada `--color-X` apunte a `--X` (un typo que apunte a
  otra variable pinta el ✅ con el color del ⚠️ y todo lo demás pasa en verde).

## Maquetado

Utilidades de Tailwind en el template, sin CSS propio. Los patrones que ya usa el portal: contenedor
`max-w-6xl mx-auto px-4 py-8 space-y-6`, tarjetas `bg-superficie rounded-xl border border-borde`,
badges `text-xs rounded-full px-2 py-0.5` con el par estado/estado-suave, tablas con
`overflow-x-auto` y filas `border-b border-borde last:border-0`.

Presupuestos del build: 500 kB de warning y 1 MB de error para el bundle inicial, y **4 kB por estilo
de componente** — otro motivo para no empezar a meter CSS por componente.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| `bg-white`, `text-gray-500`, `border-slate-200` | El test cae. Y si no cayera, quedaría congelado en claro |
| Un hex "provisorio" en el template | Es el bug exacto que se corrigió: dos títulos a 3.38:1 en oscuro, por debajo de AA |
| Agregar un token solo en `:root` | En oscuro hereda el valor claro **en silencio**. Hay test, pero entendé por qué existe |
| Poner `.oscuro` encima de `:root` | Misma especificidad: gana el último. El tema oscuro deja de aplicarse |
| Usar una combinación nueva sin agregarla a `PARES` | No se verifica su contraste; el test verde no dice nada de ella |
| Un `styleUrls` o un `<style>` en un componente | El portal no tiene CSS por componente. Y el presupuesto son 4 kB |

## Verificación

`npm test` desde `portal/` corre el test de contraste y el que recorre las plantillas. Y **mirá las
dos pantallas en el navegador con los dos temas**: el test verifica ratios y clases prohibidas, no
que el resultado se vea bien.
