---
name: render-plantillas
description: Usar al tocar el aspecto del sitio de un cliente — una pieza de web-builder/src/render/piezas/, una receta de plantilla.ts, el CSS, un token de marca, el tema claro/auto o las tipografías. Cubre el contrato de Pieza, las reglas de aislamiento que impone una máquina, los dos anchos, y las trampas de CSS que solo aparecen en un navegador (sticky que no pega, anclas que mueven la página, especificidad en @media).
---

# Las plantillas del sitio de cliente

El HTML que ve un desconocido lo produce `web-builder/src/render/` y lo sirve `renderer/`. Las dos
mitades son un solo ámbito porque se rompen juntas: una regla CSS escrita en una pieza termina
servida a internet anónimo sin pasar por ningún otro filtro.

La documentación larga vive en [`renderer/docs/`](../../../renderer/docs/README.md). Esta skill es lo
que hay que tener en la cabeza **antes** de escribir.

## Las cuatro capas, y qué decide cada una

```text
html.ts        elige la receta y arma el <head>            ← no se toca por estética
shell.ts       ensambla: <head> + cabecera + <main> + <footer>
plantilla.ts   la RECETA: qué piezas y en qué orden        ← acá se cambia la estructura
piezas/*.ts    cada sección: id + raiz + css + cssOscuro + render(ctx)
css.ts         tokens + base + el CSS de las piezas que dibujaron
```

**La cabecera y el pie NO están en la receta**, y eso lo impone el tipo: `Plantilla` solo tiene
`contenido: string[]`. Si estuvieran, una receta podría omitir el nav — y el ancla `#ubicaciones`
dejaría de existir en alguna página.

**El orden del `CATALOGO` es un contrato**: el `<style>` se emite en ese orden, no en el de la receta,
para que dos páginas con las mismas piezas den un `<style>` idéntico byte a byte.

**Una pieza que devuelve `""` no aporta su CSS.** Recetas optimistas sin huecos y sin pagar bytes.

## El aislamiento lo comprueba una máquina, no una revisión

`aislamiento.ts` recorre `css` **y** `cssOscuro`, entrando dentro de los `@media`:

- todo selector empieza por `.p-<id>`;
- ninguno nombra la raíz de otra pieza;
- ningún `+`/`~` se aplica al wrapper (en el documento las piezas son **hermanas**);
- ninguna pieza declara `:root` — los tokens son del base.

Nació de una regla real que nombraba `.sitebar`, `.hero`, `footer`, `section` y `.card` a la vez: por
eso `.carta li` y `details` se quedaron fuera del modo oscuro durante meses. La regla no tenía dueño.

## Los tokens: dos capas, y no se saltan

`--marca-*` es **lo que dice la ficha**; los semánticos (`--fg`, `--accent`, `--titulo`, `--muted`,
`--decorativo`, `--bg`, `--soft`…) son **lo que consumen las piezas**. Una pieza nunca lee un
`--marca-*` directamente: si lo hiciera, corregir el contraste en oscuro obligaría a reescribir el
token del cliente, o sea a mentir sobre su ficha.

**`--muted` NO deriva de `--marca-secundario`.** Es color de texto largo y tiene que pasar AA. Medido:
el oro `#c8963e` del cliente de demo sobre su fondo `#fffdf9` da **2.62:1**. El segundo color de marca
entra por `--decorativo`, y **nunca pinta texto** — hay un test que recorre el catálogo para
impedirlo.

## El tema: claro por defecto

`brand.tema` acepta `"claro"` (default) y `"auto"`. El CSS oscuro vive aparte (`CSS_BASE_OSCURO` y el
campo `cssOscuro` de cada pieza) y `ensamblarCss` lo concatena **solo** con `"auto"`.

Se compara contra el literal `"auto"`, **no** `!== "claro"`: un typo en la ficha tiene que caer del
lado que respeta la marca. Hay un test con cinco valores inventados.

Antes del 2026-08-10 el sitio obedecía a `prefers-color-scheme`, así que **el fondo de marca lo
decidía el sistema operativo del visitante**. Un tema oscuro *fijo* no necesita este campo: se hace
con la paleta.

## Los dos anchos

`--ancho-pagina` (1320) es la banda; `--ancho-lectura` (760) es el texto. Un solo token para las dos
cosas produce renglones de periódico, y era además el motivo de que la cabecera (1100) y `main` (760)
no alinearan.

Las piezas sin rediseñar llevan un andamio declarado
(`.p-<id>{max-width:var(--ancho-lectura);margin:0 auto}`) que se quita cuando les toca.

## Las trampas que solo aparecen en un navegador

| Trampa | Síntoma | Salida |
| --- | --- | --- |
| `position:sticky` dentro del wrapper de la pieza | Se despega a los ~130 px de scroll. Medido: `top:-856` con `scrollY 1200` | `.p-<id>{display:contents}` — el envoltorio deja de generar caja |
| Un ancla dentro de un contenedor con scroll | El carrusel se mueve **y la página baja 203 px**. No hay CSS que lo cancele | Radios ocultos + `:checked ~` con `transform`. Da navegación por teclado gratis |
| Un selector más corto dentro de un `@media` | `.p-x .logo` (0,2,0) pierde contra `.p-x .barra .logo` (0,3,0). Logo de 56 px en un móvil de 390 | Repetir el compuesto completo dentro del `@media` |
| Backtick en un comentario del CSS | El build falla con `Expected "}" but found "@"` y no menciona backticks | El CSS vive en un template literal: comillas normales o escapar |

## Las trampas que sí cazan los tests

| Trampa | Quién la caza |
| --- | --- |
| Un titular con `font-weight` | `ensamblado.test.ts`. Se precarga **un** archivo (peso 700); declarar otro peso convierte el preload en una descarga tirada, en el elemento del LCP |
| Un color literal sin contrapartida oscura | `huecosDeModoOscuro`. La barra superior usa `var(--titulo)` de fondo, y ese token **se invierte** en oscuro: blanco sobre casi blanco |
| `--decorativo` pintando texto | `tema.test.ts`, recorriendo el catálogo |
| Una receta que nombra una pieza inexistente | `ensamblado.test.ts` |
| Un `preload` de fuente sin `crossorigin` | `fuentes.test.ts`. Sin él el navegador **descarga el archivo dos veces** sin avisar en ningún log |

## Imágenes: los tres emisores

No es uno solo, y creer que sí es el error: `renderImagen`, **el logo de la cabecera** (aparece en
todas las páginas: el peor como vector de fuga) y **`og:image`** en el `<head>`.

Los tres exigen https; los dos primeros pasan además por la **allowlist de hosts exacta** (`Set` sobre
`new URL(...).hostname`, nunca `endsWith`), `referrerpolicy="no-referrer"` y el presupuesto de 60 por
documento. A `og:image` solo se le exige https: lo pide el crawler al compartir, no el visitante, y la
imagen social vive en el dominio del propio cliente.

**Una sola imagen prioritaria por documento**: la portada, que es el LCP. Marcar dos es no marcar
ninguna.

## Un campo nuevo del perfil cruza cuatro fronteras

Zod del contrato → allowlist SQL (`business_profile_publico`) → `perfilValido` del renderizador → la
pieza que lo dibuja. **Si falta en una, se pierde en silencio.** Los topes tienen que coincidir; hay
un test que encadena las capas.

## Retirar una pieza es parte del trabajo

Una pieza que no nombra ninguna receta es código que nunca llega a un navegador con tests que pasan
para siempre. El repo ya retiró dos así (`carta` y `heroPortada`): se saca del catálogo, se borra el
archivo y **sus garantías se mudan con sus tests** a quien la sustituye.

## Verificación

```bash
npm test -w web-builder          # piezas, recetas, tema, aislamiento, imágenes, ensamblado
npm test -w renderer             # el servicio
npm run typecheck
npm run dev:server -w renderer   # y MIRÁ la página en un navegador
```

⚠️ `npm run demo -w renderer` pega contra el Storyblok **real**. No es verificación.

⚠️ El **gate de paridad** (`render/paridad/`) congela el HTML de diez casos. Un rediseño deliberado lo
rompe por definición; re-capturarlo exige autorización explícita del usuario
(`capturar:paridad` está en `permissions.deny`). Antes de re-capturar, **medí qué se pierde**: palabras
visibles, `href`, `id`, JSON-LD y traza.

**Verificación por mutación, siempre**, y **manejá la app**: de los defectos del rediseño de la
cabecera y la portada, tres los encontró el navegador y ninguno un test.
