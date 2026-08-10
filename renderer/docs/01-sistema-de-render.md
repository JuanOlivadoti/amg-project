# Cómo se arma una página

Una página del sitio de un cliente son **cuatro llamadas posibles al mismo ensamblador**, con distinta
receta de contenido. Nada más.

```text
renderStory      una landing de research (viene de una story de Storyblok)
renderHome       la portada sintetizada de la raíz del dominio
renderMenu       /menu, sintetizada del perfil
renderBlogIndex  /blog, el índice de artículos
```

Los cuatro viven en [`web-builder/src/render/html.ts`](../../web-builder/src/render/html.ts), y su
firma **no cambia**: el renderizador los importa por nombre de paquete.

## Las cuatro capas

```text
html.ts        elige la receta y arma el <head> (title, canonical, OG, JSON-LD, traza)
   ↓
shell.ts       el ENSAMBLADOR: <head> + cabecera + <main>{receta}</main> + <footer>
   ↓
plantilla.ts   la RECETA: qué piezas de contenido, en qué orden
   ↓
piezas/*.ts    cada sección: id + raiz + css + cssOscuro + render(ctx)
   ↓
css.ts         tokens de marca + CSS base + el CSS de las piezas que dibujaron algo
```

### El shell es fijo, y eso lo impone el tipo

[`shell.ts`](../../web-builder/src/render/shell.ts) emite la cabecera y el pie **fuera de la receta**:

```text
<head>   title, meta, canonical, OG, JSON-LD, traza de research, <style>
<body>
  cabecera            ← zona fija
  <main> … </main>    ← AQUÍ va la receta, y SOLO acá
  <footer> contacto, locales (dueña de id="ubicaciones"), blog + línea técnica </footer>
```

No es una convención: `Plantilla` solo tiene un campo `contenido: string[]`, así que **una receta no
puede** omitir la cabecera, mover el pie ni duplicar las ubicaciones. Importa porque el nav ancla a
`#ubicaciones` desde todas las páginas: esa región tiene que existir en todas *por construcción*.

Este archivo es también la razón por la que un bug de modo oscuro sobrevivió meses: antes, cada una de
las cuatro funciones repetía su propio `<!doctype>`, `<head>`, `<style>` y pie. Arreglar el shell había
que arreglarlo cuatro veces.

### La receta elige piezas, no CSS

[`plantilla.ts`](../../web-builder/src/render/plantilla.ts). `brand.plantilla` elige un **juego de
cuatro recetas**, una por tipo de documento — porque un restaurante no tiene "una plantilla" para su
landing y otra para su carta: tiene **un aspecto** que se aplica a los cuatro documentos que su sitio
sabe emitir.

Hoy existe un solo juego, `base`:

| Receta | Piezas, en orden |
| --- | --- |
| `story` | `heroSlider · barraDatos · seccionProsa · platosDestacados · galeria · faq · ctaFinal` |
| `home` | `heroSlider · barraDatos · platosDestacados · galeria · indice · ctaFinal` |
| `menu` | `hero · barraDatos · cartaCategorias · ctaFinal` |
| `blog` | `hero · blogIndice` |

**Un `plantilla` desconocido no es un error: cae a `base`.** Una web servida es mejor que un 503 por
un typo, y la ficha la edita una persona, no un compilador. Añadir un juego nuevo es escribir una
receta, no CSS.

### El catálogo, y su orden es un contrato

[`piezas/index.ts`](../../web-builder/src/render/piezas/index.ts). El `<style>` emite el CSS de las
piezas usadas **en orden de catálogo, no de receta**, para que dos páginas con las mismas piezas
produzcan un `<style>` idéntico byte a byte. Reordenar el array cambia los bytes de todas las páginas
publicadas.

`piezaPorId()` **no lanza** cuando no encuentra: una receta que nombrara una pieza inexistente
serviría una página a la que le falta un bloque, no un 503. Que las recetas solo nombren piezas del
catálogo lo fija un test — que es donde un error de programación tiene que doler.

### El CSS viaja por necesidad

`ensamblarCss(usadas, brand)` concatena, en este orden:

1. los **tokens** (dos capas: `--marca-*` y los semánticos — ver [`03-tema-y-marca.md`](03-tema-y-marca.md));
2. los tokens que emite la **ficha** del cliente;
3. las `@font-face` de las familias que **esta página** usa;
4. el **CSS base** (reset, `main`, `footer`, primitivas compartidas);
5. el `css` de cada pieza **que dibujó algo**;
6. el `cssOscuro` de esas piezas — **solo si `brand.tema === "auto"`**.

Una pieza que devolvió `""` no aporta su CSS: una landing sin galería no paga los bytes de la galería.

## El presupuesto de imágenes nace y muere con el documento

`renderDocumento` crea un `nuevoPresupuestoImagenes()` por documento, y el **orden del spread** es la
garantía:

```ts
const ctx: CtxPieza = { ...doc.ctx, presupuestoImagenes: nuevoPresupuestoImagenes() };
```

Si ese contador viviera en el módulo, el renderizador —que es un proceso **largo** que atiende a
todos los clientes— serviría la primera web con fotos y **todas las siguientes sin ellas**. Y no se
vería: casi todo test renderiza una sola vez. Lo fijan dos tests que renderizan dos veces.

Mover `presupuestoImagenes` **antes** del `...doc.ctx` reabre el agujero. Esa línea no se toca.

## Tres páginas se sintetizan del perfil, no del LLM

`home`, `/menu` y `/blog` no salen de una story:

- **`home`** para que la raíz del dominio no dé 404 antes de que el cliente redacte la suya;
- **`/menu`** porque una carta es una lista de producto con precio: no hay nada que "redactar", y
  generarla por IA metería una fuente más de contenido que revisar en la compuerta humana;
- **`/blog`** porque solo agrupa las páginas `Article`.

**Si el cliente crea su propia story con ese slug, esa gana.** Son fallbacks, no imposiciones.

## Dónde falla esto en la práctica

| Síntoma | Causa |
| --- | --- |
| Se publica bien y se sirve un 503 | Se tocó `toStoryblokContent` sin tocar la vuelta (`fromStoryblokContent`). Es OBS-03 |
| Una página pierde un bloque sin error | La receta nombra una pieza que no está en el catálogo |
| El `<style>` cambia entre dos páginas iguales | Se reordenó el `CATALOGO` |
| Solo la primera web servida tiene fotos | El presupuesto de imágenes se volvió de módulo |
| Un campo nuevo del perfil no llega al HTML | Falta en alguna de las capas: Zod, la allowlist SQL o `perfilValido` |
