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
 * ⚠️ Cada receta contiene **exactamente lo que su función emitía antes del refactor**, ni una pieza
 * más. La receta `BASE` que la spec escribe en §4 (`heroPortada`, `barraDatos`, `platosDestacados`,
 * `galeria`, `ctaFinal`) es la de la **entrega 3**: esas piezas todavía no existen, y ponerlas acá
 * borraría el hero del HTML y tiraría el gate de paridad.
 *
 * `hero` está en las cuatro y no solo en `story`: las tres páginas sintetizadas emiten hoy su propio
 * `<header class="hero">` con el `<h1>` de la página. Ver el comentario de la pieza.
 */
const BASE: JuegoDePlantillas = {
  id: "base",
  story: { id: "base/story", contenido: ["hero", "seccionProsa", "faq"] },
  home: { id: "base/home", contenido: ["hero", "indice"] },
  menu: { id: "base/menu", contenido: ["hero", "carta"] },
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
