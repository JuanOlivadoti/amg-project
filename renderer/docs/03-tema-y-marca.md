# El tema y la marca

Lo que hace que la web de un cliente se vea **suya** y no idéntica a la del vecino.

Todo vive en [`css.ts`](../../web-builder/src/render/css.ts) y
[`fuentes.ts`](../../web-builder/src/render/fuentes.ts), y lo alimenta `business_profile.brand` de la
ficha del cliente.

## Los tokens, en dos capas

**Capa 1 — `--marca-*`: lo que dice la ficha.** Seis colores y tres roles tipográficos, con los
valores de hoy como default. Un token ausente no emite nada y gana el default, que es lo que hace que
una ficha a medio llenar produzca una web sobria en vez de una rota a trozos.

**Capa 2 — los semánticos: lo que consumen las piezas.** Se derivan de la capa 1 y son los únicos que
el modo oscuro reescribe.

```text
--marca-primario   →  --accent, --acento-legible
--marca-secundario →  --decorativo          (NUNCA --muted: ver abajo)
--marca-titulo     →  --titulo
--marca-texto      →  --fg
--marca-fondo      →  --bg
--marca-fondo-alt  →  --soft
--marca-fuente-*   →  --font, --fuente-titulo, --fuente-decorativa
                      --ancho-pagina, --ancho-lectura
```

**Por qué dos capas y no una.** Si una pieza leyera `--marca-primario` directamente, corregir el
contraste del acento en oscuro obligaría a **reescribir el token del cliente** — o sea, a mentir sobre
lo que dice su ficha. Con la capa semántica en medio, "el acento legible sobre fondo oscuro" es un
derivado (`--acento-legible`) y la ficha sigue diciendo lo que dice.

**`--muted` no deriva de `--marca-secundario`, y la primera versión sí lo hacía.** `--muted` pinta el
lede, las descripciones, las direcciones, los horarios y el nav: es **color de texto largo**, y tiene
que pasar AA. "Secundario" en un manual de marca es el segundo color *de marca*, decorativo. Atarlos
obliga a que el segundo color de marca sea legible como cuerpo de texto. Medido con la paleta del
cliente de demo: su oro `#c8963e` sobre su fondo `#fffdf9` da **2.62:1**, y habría pintado de oro
ilegible todo el texto secundario del sitio.

## El tema: claro por defecto, `auto` a petición

`brand.tema` acepta `"claro"` (default) y `"auto"`.

Hasta el **2026-08-10** este campo no existía y el sitio obedecía a `prefers-color-scheme`, así que
**el fondo de marca del cliente lo decidía el sistema operativo de quien mirase**: un restaurante con
paleta crema (`#fffdf9`) se servía sobre `#111` en cualquier móvil en modo oscuro, y ninguna ficha
podía evitarlo. La web de un restaurante es una pieza de marca, no una aplicación.

Cómo está implementado:

- el CSS oscuro del base vive en `CSS_BASE_OSCURO`, aparte de `CSS_BASE`;
- el de cada pieza vive en su campo `cssOscuro`, aparte de su `css`;
- `ensamblarCss` concatena los dos **solo** si `brand?.tema === "auto"`.

**Se compara contra el literal `"auto"`, no `!== "claro"`.** Un typo en la ficha (`"atuo"`, `"dark"`,
`"oscuro"`) tiene que caer del lado seguro, que acá es el que respeta la marca. Hay un test que lo
recorre con cinco valores inventados.

Un tema oscuro **fijo** no necesita este campo y nunca lo necesitó: se consigue con la paleta
(`colores.fondo` oscuro y `colores.texto` claro), que es donde vive esa decisión.

> ⚠️ **Deuda declarada (2026-08-10): `"auto"` es hoy inalcanzable en producción.** El campo lo lee
> `ensamblarCss`, pero **no cruza las tres primeras fronteras** de la tabla de más abajo: no está en
> `brandSchema` de `contract.ts`, ni en la allowlist `app.nap_publico` de la `0014`, ni en `marca()`
> de `renderer/src/perfil.ts`. Una ficha que lo pidiera se queda por el camino tres veces, sin error
> y sin log, y el sitio sale claro.
>
> Es la trampa que documenta este mismo archivo, cometida el día que se escribió el campo. **No es
> urgente** —hace que el default se cumpla siempre, que es la conducta que se quería— pero no puede
> quedar tácita. Los tests pasan porque construyen el perfil en memoria y no cruzan ninguna frontera:
> **cruzarlas es lo único que prueba que un campo del perfil llega**.

> Mientras el `@media(prefers-color-scheme:dark)` estuvo incrustado dentro del string de `css` de cada
> pieza, "no emitir el oscuro" solo se podía hacer recortando CSS con una expresión regular: frágil, y
> silencioso cuando fallara. Separarlo lo convirtió en no concatenar una cadena.

## Las tipografías, self-hosted

Cuatro familias SIL OFL 1.1 con su licencia commiteada, en subsets latinos `woff2` (148 KB), servidas
desde `/_assets/fonts/` por el propio renderizador. **Cero hojas de terceros, cero peticiones fuera
del dominio.**

Tres reglas que valen la pena:

1. **La ficha elige un NOMBRE DE ROL de una allowlist cerrada, nunca un stack CSS.** Un stack en la
   ficha sería texto libre entrando a un `<style>`. Cambiar qué familia hay detrás de `condensada`
   sigue siendo un cambio de código revisado, no una edición de fichas.
2. **El `<style>` emite las `@font-face` solo de las familias que la página usa.**
3. **El `<head>` precarga una sola familia**, la de titulares, y **con `crossorigin`**. Las fuentes se
   piden siempre en modo CORS anónimo —lo manda la especificación, también para el mismo origen—, así
   que un `preload` sin `crossorigin` no casa con la petición que después hace la `@font-face` y el
   navegador **descarga el archivo dos veces sin avisar en ningún log**. Es el fallo más común de esa
   etiqueta y por eso lo fija un test.

Se precarga el archivo de **peso 700**, que es el que los titulares heredan del navegador. De ahí sale
la regla de que **ninguna pieza declara `font-weight` en un titular** (ver
[`02`](02-escribir-una-pieza.md)).

## Los dos anchos

```text
--ancho-pagina    1320px   la banda: cabecera, galería, carta, secciones con foto
--ancho-lectura    760px   el texto: prosa, FAQ, índices
```

**Son dos cosas distintas y un solo token para ambas es un error caro.** Una línea de prosa de 1320 px
es ilegible —lo cómodo son 60-75 caracteres—, así que el párrafo se queda donde está aunque la página
se ensanche.

Y era, además, el motivo de que la cabecera y el contenido no alinearan: la barra iba a 1100 y `main`
a 760 porque cada uno resolvía su problema por su cuenta, con el efecto visible de que el borde
inferior de la cabecera se cortaba en mitad de la pantalla.

**El andamio ya no existe** (2026-08-10). Mientras duró el rediseño, las piezas sin rehacer llevaban
una regla `.p-<id>{max-width:var(--ancho-lectura);margin:0 auto}` con un comentario que lo decía; se
quitaba al rediseñar la sección. Hoy **todas** usan `.seccion` + `.banda`, así que el andamio se fue
con la última. Fue visible a propósito: un andamio que no se ve se queda.

Y con él se fue el `max-width` de **`main`**, que es lo que hace **full-bleed** a las secciones con
fondo. Mientras `main` medía 1320 con 20 px de respiro, el fondo de una `.seccion.alt` se cortaba a
1320 —una franja de color con dos márgenes blancos— y el respiro lateral se aplicaba dos veces. Hoy el
ancho lo pone cada sección con su `.banda`. ⚠️ **El precio: una pieza de contenido nueva que no use
`.banda` sale pegada al borde en un móvil.** La única que no la usa es `heroSlider`, que tiene su
propia rejilla de dos columnas y lleva el padding escrito.

## Las cuatro fronteras de un campo del perfil

Un campo nuevo en `business_profile` cruza cuatro sitios, y si falta en uno **se pierde en silencio**:

| Frontera | Dónde | Qué pasa si falta |
| --- | --- | --- |
| Zod del contrato | `web-builder/src/contract.ts` | El campo se descarta al parsear el brief |
| Allowlist SQL | la columna generada `business_profile_publico` (migraciones `0014` y `0020`) | El renderizador no lo ve nunca |
| `perfilValido` | `renderer/src/perfil.ts` | Se descarta al revalidar |
| El CSS o la pieza | `css.ts` / `piezas/` | Llega y no lo dibuja nadie |

Los topes tienen que **coincidir**: `MAX_LOCALES`, `MAX_ITEMS_CARTA`, las 30 fotos, las 20 categorías,
los 6 destacados y los 12 testimonios. Entre las dos fronteras que viven en `web-builder` eso ya no es
prosa: lo exige un test (`piezas/piezas-foto.test.ts`).

**Y hay una quinta cosa que la allowlist decide y las otras tres no pueden:** qué claves **no
existen**. `testimonios` enumera `texto` y `autor`, así que un `estrellas` escrito a mano en
`business_profile` —una columna `jsonb` que nadie valida al escribir— no llega al renderizador. Esa es
la capa que sostiene la regla cuando el dato no pasó por Zod ni por `perfilValido`.
Cambiar uno solo deja las capas discrepando, y hay un test que las encadena para impedirlo.

## Validación: es defensa, no cosmética

- **color**: solo hex (`#rgb` o `#rrggbb`). Lo que no valida se descarta y cae al default.
- **fuente**: allowlist cerrada de nombres de rol.
- **logo / imágenes**: `http(s)` exigido a mano, porque `.url()` de Zod **acepta `javascript:`** —
  tiene esquema.

Todo esto termina dentro de un `<style>` o de un `<img src>`. En producción el dato llega de Storyblok
**sin pasar por Zod**, y por eso el renderizador revalida: defensa en profundidad, no redundancia.
