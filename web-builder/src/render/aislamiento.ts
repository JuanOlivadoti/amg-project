import type { Pieza } from "./piezas/tipos.js";

/**
 * El contrato de §3 de la spec de plantillas de landing, escrito como código.
 *
 * Emitir el CSS en orden de catálogo hace la salida determinista en bytes, pero eso **no basta**:
 * reordenar la receta puede cambiar el resultado visual si las piezas se pisan por cascada,
 * especificidad o posición en el DOM. Estas comprobaciones son lo que hace que no puedan pisarse, y
 * la spec pide explícitamente que las haga una máquina y no una revisión humana.
 *
 * El caso real que las motiva: el CSS de origen tenía `section`, `section h2`, `details`, `summary`
 * y un `@media` oscuro que nombraba `.sitebar`, `.hero`, `footer`, `section` y `.card` **en la misma
 * regla**. Por eso `.carta li` y `details` se quedaron fuera del modo oscuro y nadie lo notó durante
 * meses: la regla no tenía dueño, así que nadie era responsable de completarla.
 */

/**
 * Los selectores de todas las reglas de estilo de una hoja, **entrando dentro de los `@media`**.
 *
 * Entrar en los `@media` no es un detalle: es justo donde vivía la regla que rompió el modo oscuro,
 * y un parser que se quedara en el nivel de arriba dejaría pasar un selector desnudo escondido ahí.
 * Las at-rules sin selectores de página (`@font-face`, `@keyframes`) se ignoran a propósito.
 */
export function selectoresDe(css: string): string[] {
  const salida: string[] = [];
  // Los comentarios se quitan ANTES de parsear. Sin esto, un `/* … */` entre reglas se acumula en el
  // prelude y el detector lo denuncia como "selector desnudo": un comentario explicando POR QUÉ una
  // declaración existe —justo lo que este repo pide— hacía fallar el test de aislamiento. Lo
  // descubrí al documentar el `letter-spacing` del pie, y el mensaje de error no daba ninguna pista.
  recorrer(css.replace(/\/\*[\s\S]*?\*\//g, " "));
  return salida;

  function recorrer(texto: string): void {
    let i = 0;
    let prelude = "";
    while (i < texto.length) {
      const ch = texto[i]!;
      if (ch === "{") {
        const bloque = leerBloque(texto, i);
        const p = prelude.trim();
        if (p.startsWith("@")) {
          // Solo las at-rules CONDICIONALES contienen reglas normales; el resto (`@font-face`,
          // `@keyframes`) tiene descriptores o keyframes, no selectores de página.
          if (/^@(media|supports|container|layer|scope)\b/i.test(p)) recorrer(bloque.contenido);
        } else if (p) {
          for (const s of p.split(",")) {
            const limpio = s.trim();
            if (limpio) salida.push(limpio);
          }
        }
        i = bloque.fin;
        prelude = "";
        continue;
      }
      // Una at-rule sin bloque (`@import …;`) termina en punto y coma y no aporta selectores.
      if (ch === ";" && prelude.trim().startsWith("@")) {
        prelude = "";
        i++;
        continue;
      }
      prelude += ch;
      i++;
    }
  }
}

/** Lee el bloque `{…}` que empieza en `abre`, contando llaves. Devuelve el contenido y el índice tras el cierre. */
function leerBloque(texto: string, abre: number): { contenido: string; fin: number } {
  let profundidad = 0;
  for (let i = abre; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === "{") profundidad++;
    else if (ch === "}") {
      profundidad--;
      if (profundidad === 0) return { contenido: texto.slice(abre + 1, i), fin: i + 1 };
    }
  }
  // Hoja sin cerrar: se devuelve lo que hay. No se lanza — este módulo audita, no rompe el render.
  return { contenido: texto.slice(abre + 1), fin: texto.length };
}

/**
 * Los problemas de aislamiento de una pieza, en prosa. Lista vacía = pieza aislada.
 *
 * Se devuelve una lista en vez de lanzar para que el test pueda exigir **cuántos** problemas hay: un
 * detector que dijera "hay algo mal" sin distinguir cuántos no podría probarse con un control
 * positivo, que es la única forma de saber que sabe fallar.
 *
 * `raicesAjenas` son las raíces de las **demás** piezas del catálogo.
 */
export function problemasDeAislamiento(pieza: Pieza, raicesAjenas: readonly string[]): string[] {
  const problemas: string[] = [];
  // El límite `(?![\w-])` importa: sin él, `.p-falsalarga` pasaría por ser `.p-falsa` y una pieza
  // podría estilar cualquier clase que empezara con su prefijo.
  const empiezaPorLaRaiz = new RegExp(`^\\.${escaparRegex(pieza.raiz)}(?![\\w-])`);

  // `cssOscuro` se audita con las MISMAS reglas que `css`, y esto no es simetría por gusto: el
  // selector desnudo que rompió el modo oscuro vivía justamente dentro de un `@media`. Separar el
  // tema en dos campos sin auditar el segundo habría reabierto ese agujero por la puerta de atrás.
  for (const sel of selectoresDe(`${pieza.css}\n${pieza.cssOscuro ?? ""}`)) {
    if (/(^|[\s,(])::?root\b/.test(sel) || sel.startsWith(":root")) {
      problemas.push(
        `«${sel}»: una pieza no declara tokens. Los \`:root\` y el reset son del CSS base y viajan siempre (§3.6).`,
      );
      continue;
    }
    if (!empiezaPorLaRaiz.test(sel)) {
      problemas.push(
        `«${sel}»: todo selector de la pieza "${pieza.id}" tiene que empezar por su raíz .${pieza.raiz} (§3.2). ` +
          `Un selector desnudo estila el HTML de las demás piezas.`,
      );
      continue;
    }
    const ajena = raicesAjenas.find((r) => new RegExp(`\\.${escaparRegex(r)}(?![\\w-])`).test(sel));
    if (ajena) {
      problemas.push(
        `«${sel}»: nombra la raíz .${ajena} de otra pieza (§3.3). Ni selección cruzada ni adyacencia (\`+\`, \`~\`) entre raíces.`,
      );
      continue;
    }

    // §3.3, la otra mitad: un `+` o un `~` **cruza la raíz vecina sin nombrarla**. En el documento
    // emitido las piezas de la receta son hermanas (`shell.ts` las une con `\n` dentro de `<main>`),
    // así que `.p-hero + *` o `.p-hero ~ section` estilan el interior de la pieza de al lado — el
    // acoplamiento que §3 existe para prohibir, y que el detector anterior solo veía si el selector
    // mencionaba la raíz ajena por su nombre. Lo señaló una revisión con tres casos que pasaban.
    //
    // La regla mira **qué hay ANTES** del combinador, no después, y esa es toda la sutileza: el `+`
    // se aplica al compuesto que lo precede. Si ese compuesto es el wrapper de la pieza, los hermanos
    // que selecciona son las OTRAS piezas; si es cualquier cosa de dentro, los hermanos también están
    // dentro. Así `.p-carta li + li` (adyacencia interna, legítima y en uso) pasa, y `.p-carta + *`,
    // `.p-carta + section` y `.p-carta ~ footer` no.
    //
    // La primera versión de esto miraba el compuesto de después y dejaba pasar dos de los tres casos
    // malos — lo descubrió el control positivo, no la lectura.
    const antesDelCombinador = /([^\s+~>]+)\s*[+~]/g;
    for (const m of sel.matchAll(antesDelCombinador)) {
      const previo = m[1] ?? "";
      if (new RegExp(`^\\.${escaparRegex(pieza.raiz)}$`).test(previo)) {
        problemas.push(
          `«${sel}»: el combinador hermano (\`+\`/\`~\`) se aplica al wrapper .${pieza.raiz}, así que ` +
            `selecciona las piezas VECINAS (§3.3). En el documento las piezas son hermanas: usá la ` +
            `adyacencia solo dentro de .${pieza.raiz}.`,
        );
        break;
      }
    }
  }
  return problemas;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
