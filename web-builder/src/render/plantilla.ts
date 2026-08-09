import type { BrandTheme } from "../types.js";

/**
 * La plantilla como **receta de contenido**.
 *
 * Una receta solo puede **ordenar contenido**. No puede tocar el shell, omitir la cabecera ni mover
 * el pie: esas zonas no están en el tipo. Eso lo impone el tipo, no un comentario — que es
 * exactamente la diferencia entre una garantía y una intención.
 */
export interface Plantilla {
  id: string;
  /** Ids de piezas de CONTENIDO, en orden, dentro de `<main>`. */
  contenido: string[];
}

/**
 * **`brand.plantilla` elige un JUEGO de cuatro recetas, una por tipo de documento.**
 *
 * Esto cierra una ambigüedad de la spec: §4 define `Plantilla` como *una* receta mientras
 * §Arquitectura de render dice que `renderStory`/`renderHome`/`renderMenu`/`renderBlogIndex` son
 * cuatro llamadas al mismo ensamblador. Las dos cosas son ciertas si lo que la ficha elige es el
 * juego: un restaurante no tiene "una plantilla" para su landing y otra distinta para su carta, tiene
 * **un aspecto** que se aplica a los cuatro documentos que su sitio sabe emitir.
 */
export interface JuegoDePlantillas {
  id: string;
  /** Una landing de research (viene de una story de Storyblok). */
  story: Plantilla;
  /** La portada sintetizada que sirve la raíz del dominio. */
  home: Plantilla;
  /** `/menu`, sintetizada del perfil. */
  menu: Plantilla;
  /** `/blog`, el índice de artículos. */
  blog: Plantilla;
}

/**
 * El único juego que existe. Ampliar a varios es escribir una receta, no CSS.
 *
 * `hero` está en TRES de las cuatro y no solo en `story`: las páginas sintetizadas (`/`, `/menu`,
 * `/blog`) no salen de una story, y su `<h1>` lo pone el titular del contexto. Ver el comentario de la
 * pieza. En `story` lo **sustituye `heroPortada`**, que es el mismo titular más la foto de portada.
 *
 * ## Por qué cada receta es la que es (entrega 3, mitad B)
 *
 * `story` es **literal de la spec (§4)** y no se discute acá.
 *
 * Las otras tres las escribe esta entrega, porque la spec dice qué pieza usa cada página («la home
 * sigue usando `platosDestacados`», «`/menu` usa `cartaCategorias`») pero no escribe las listas. El
 * criterio con el que se completaron, en orden de peso:
 *
 * 1. **`barraDatos` va en las tres páginas de negocio** (`story`, `home`, `menu`). Es el arreglo del
 *    punto 4 de la spec —«lo que la gente busca está enterrado en el pie: teléfono, horarios y
 *    direcciones viven solo en `renderFooter`, y en un restaurante eso es el grueso de las visitas»—.
 *    Un arreglo que solo llegara a la landing dejaría el problema intacto justo en la portada, que es
 *    donde más gente entra. No se pisa con `locales`: ésta es el resumen accionable del primer local
 *    arriba, aquélla el detalle de todos en el pie (spec, §2).
 * 2. **`ctaFinal` cierra las mismas tres.** Una página que termina en una lista y no en una acción es
 *    la queja 2 de la spec («el CTA no es un botón, es un párrafo rojo… no es una acción»). En `/menu`
 *    es donde más se nota: alguien que acaba de leer la carta es exactamente quien va a llamar.
 * 3. **`galeria` va en `story` y `home`, no en `/menu`.** En la carta ya hay fotos —de categoría y de
 *    plato— y una segunda rejilla competiría con ellas por la misma atención sin añadir información.
 * 4. **`platosDestacados` no va en `/menu`**: es un extracto cuyo único gancho es el enlace a `/menu`,
 *    y dentro de `/menu` ese enlace no lleva a ninguna parte.
 * 5. **`/blog` no se toca.** Un índice de artículos no es una superficie de conversión, y ampliarlo
 *    habría sido diseño sin pedido que además ensancha el diff sin que nada lo pida.
 *
 * El orden de contenido de `home` es deliberadamente el mismo que el de `story` (identidad → datos
 * accionables → qué se come → fotos → …→ acción), con `indice` en el hueco de `faq`: dos páginas del
 * mismo sitio que se leyeran en distinto orden se sentirían de dos sitios distintos.
 */
const BASE: JuegoDePlantillas = {
  id: "base",
  story: {
    id: "base/story",
    // Literal de la spec, §4.
    contenido: ["heroPortada", "barraDatos", "seccionProsa", "platosDestacados", "galeria", "faq", "ctaFinal"],
  },
  home: { id: "base/home", contenido: ["hero", "barraDatos", "platosDestacados", "galeria", "indice", "ctaFinal"] },
  menu: { id: "base/menu", contenido: ["hero", "barraDatos", "cartaCategorias", "ctaFinal"] },
  blog: { id: "base/blog", contenido: ["hero", "blogIndice"] },
};

const JUEGOS: Record<string, JuegoDePlantillas> = { base: BASE };

/**
 * El juego que pide la ficha, o `base`.
 *
 * **Una plantilla inexistente NO es un error**: cae al default, igual que un color inválido cae al
 * default. Una web servida es mejor que un 503 por un typo en una ficha — y la ficha la edita una
 * persona, no un compilador.
 */
export function juegoDe(brand?: BrandTheme | null): JuegoDePlantillas {
  const id = brand?.plantilla;
  if (typeof id === "string" && Object.hasOwn(JUEGOS, id)) return JUEGOS[id]!;
  return BASE;
}
