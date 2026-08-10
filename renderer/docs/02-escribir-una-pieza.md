# Escribir una pieza

Una **pieza** es una sección del sitio: un fragmento de HTML **con su CSS**. Las dos cosas viajan
juntas o no viajan.

## El contrato

[`piezas/tipos.ts`](../../web-builder/src/render/piezas/tipos.ts)

```ts
interface Pieza {
  id: string;          // identidad estable; la receta la nombra por acá
  raiz: string;        // la clase que envuelve TODO su HTML, siempre `p-<id>`
  css: string;         // su CSS, y SOLO el suyo
  cssOscuro?: string;  // su CSS de modo oscuro; solo viaja con `brand.tema: "auto"`
  render(ctx: CtxPieza): string;  // el HTML, o "" si no tiene datos que mostrar
}
```

Y lo que puede leer —**todo** lo que puede leer—:

```ts
interface CtxPieza {
  story: Story | null;        // null en las páginas sintetizadas
  profile: BusinessProfile | null;
  activeSlug: string;         // para marcar aria-current en el nav
  titulo: string;             // el titular de una página sintetizada
  bajada: string;
  paginas: NavItem[];         // páginas publicadas (home) o artículos (/blog)
  presupuestoImagenes: PresupuestoImagenes;
}
```

Una pieza **no** recibe la story de otra página, ni el destino de publicación, ni nada que la deje
decidir por el documento.

## Los cuatro pasos

1. **Escribir el archivo** en `web-builder/src/render/piezas/<nombre-kebab>.ts`.
2. **Registrarla** en el `CATALOGO` de `piezas/index.ts`, en la posición que le toca por orden de
   documento (el orden es un contrato: ver [`01`](01-sistema-de-render.md)).
3. **Nombrarla en una receta** de `plantilla.ts`. Una pieza que no nombra ninguna receta es código
   que nunca llega a un navegador con tests que pasan para siempre — el repo ya retiró dos así
   (`carta` y `heroPortada`).
4. **Verificarla en un navegador**, no solo con tests. Ver el final de este documento.

## Las reglas de aislamiento, que impone una máquina

[`aislamiento.ts`](../../web-builder/src/render/aislamiento.ts) recorre el CSS de cada pieza —
`css` **y** `cssOscuro` — entrando dentro de los `@media`, y falla si:

| Regla | Por qué |
| --- | --- |
| Todo selector empieza por `.p-<id>` | Un selector desnudo (`section`, `details`) estila el HTML de las demás piezas |
| Ningún selector nombra la raíz de otra pieza | Acoplamiento entre secciones que nadie ve venir |
| Ningún `+`/`~` se aplica al wrapper de la pieza | En el documento las piezas son **hermanas**: `.p-hero + *` estila la pieza de al lado |
| Ninguna pieza declara `:root` | Los tokens son del CSS base (§3.6). Una pieza que declarara un token que otra consume rompe la composición |

El caso real que las motiva: el CSS de origen tenía una regla que nombraba `.sitebar`, `.hero`,
`footer`, `section` y `.card` **a la vez**. Por eso `.carta li` y `details` se quedaron fuera del modo
oscuro durante meses: la regla no tenía dueño, así que nadie era responsable de completarla.

## Las trampas que ya mordieron

**Los backticks en los comentarios rompen el archivo.** El CSS vive dentro de un template literal de
TypeScript. Un comentario que diga ``/* dentro de un `@media` */`` cierra el string y el build falla
con un error que no menciona backticks (`Expected "}" but found "@"`). Escribí las referencias entre
comillas normales o escapá el backtick.

**La especificidad de un `@media` no compensa un selector más corto.** Si la regla base es
`.p-cabecera .sitebar .logo` (0,3,0), un `.p-cabecera .logo` (0,2,0) dentro de un `@media` **pierde**,
esté donde esté. El síntoma es un logo de 56 px en un móvil de 390 px, sin ningún error en ninguna
parte.

**`position: sticky` se pega solo mientras su contenedor está a la vista.** Como `envolver()` mete
cada pieza en un div que mide lo que mide la pieza, un sticky "funciona" y se despega a los pocos
píxeles. Medido: con `scrollY 1200`, la barra estaba en `top:-856`. La salida es
`.p-<id>{display:contents}` — el envoltorio deja de generar caja, sus hijos pasan a ser hijos del
`body` y el sticky se mide contra el documento. No afecta al aislamiento, que es por selector y no por
caja.

**Un ancla dentro de un contenedor con scroll mueve la página entera.** El navegador desplaza *todos*
los ancestros para hacer visible el destino, y no hay CSS que lo cancele. Un carrusel con
`href="#slide-3"` desplaza el carrusel **y** baja la página 203 px. El patrón que sí funciona sin JS
es radios ocultos + `:checked ~` con `transform`, que además da navegación por teclado gratis.

**Un titular no declara `font-weight`.** `shell.ts` precarga **un solo archivo** de la fuente de
titulares, el de peso 700, que es el que los `h1`/`h2`/`h3` heredan de la hoja del navegador.
Declarar `font-weight: 500` hace que el navegador pida otro archivo y convierte el preload en una
descarga tirada, justo en el elemento que mide el LCP. Lo fija un test de `ensamblado.test.ts`.

**Un color literal necesita su contrapartida oscura.** Si la pieza fija `color:#fff` o un borde con
hex, tiene que redeclararlo en `cssOscuro`. Lo comprueba `huecosDeModoOscuro`, y encuentra cosas que
un vistazo al CSS claro no muestra: la barra superior usa `var(--titulo)` de fondo, y ese token se
**invierte** en oscuro — texto blanco sobre fondo casi blanco.

**`--decorativo` nunca pinta texto.** Es el segundo color de marca, pensado para superficie
decorativa: filetes, bordes, `background` de un `::after`. Medido con la paleta del cliente de demo,
su oro `#c8963e` sobre su fondo `#fffdf9` da **2.62:1** — falla AA. Hay un test que recorre el
catálogo entero para impedirlo.

## Imágenes: la política, en una línea cada punto

Todo `<img>` pasa por [`imagenes.ts`](../../web-builder/src/render/imagenes.ts):

1. **https y allowlist de hosts exacta** (comparación contra un `Set` sobre `new URL(...).hostname`,
   no `endsWith` — el sufijo, la subcadena y el userinfo son tres formas de saltársela);
2. **`referrerpolicy="no-referrer"`** en cada uno;
3. **tope de 60 por documento**, con el contador del documento;
4. **`width`/`height`** cuando la URL de Storyblok los lleva, para que el navegador reserve el hueco;
5. **una sola imagen prioritaria** por documento: la portada, que es el LCP. Marcar dos es no marcar
   ninguna, porque compiten por el mismo ancho de banda.

Hay **tres** emisores de `<img>`, y conviene saberlo antes de creer que se cubrió uno solo:
`renderImagen`, **el logo de la cabecera** (que aparece en todas las páginas, así que es el peor como
vector de fuga) y **`og:image`** en el `<head>`. A `og:image` se le exige https y nada más: la imagen
social vive normalmente en el dominio del propio cliente, y la pide el crawler al compartir, no el
visitante.

## Verificación

```bash
npm test -w web-builder     # incluye aislamiento, tema, imágenes y ensamblado
npm run typecheck
npm run dev:server -w renderer   # y mirá la página en un navegador
```

**Verificación por mutación, siempre.** Reintroducí el bug y confirmá que cae *exactamente* su test.
Un test que se declara inmutable casi nunca lo es: en la migración de `heroPortada` a `heroSlider`,
seis mutaciones distintas confirmaron seis garantías, y una de ellas (el orden del catálogo) cayó
sola porque un `assert.ok` de no-vacuidad hizo lo que su comentario prometía.

**Y manejá la app.** Los tests no ven layout. De los cuatro defectos que salieron al rediseñar el
header y el hero, **tres los encontró el navegador y ninguno un test**: el sticky que no pegaba, el
salto de 203 px del carrusel y el logo sin achicar en móvil.
