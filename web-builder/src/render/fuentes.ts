/**
 * Las tipografías **self-hosted**: qué familia hay detrás de cada nombre de rol, y el CSS que las
 * declara.
 *
 * ## Por qué no se cargan de Google
 *
 * El template de referencia trae Jost, Oswald y Dancing Script desde `fonts.googleapis.com`. **Eso no
 * entra**: mete un tercero en el camino de render del **único proceso expuesto a internet anónimo**,
 * añade una conexión bloqueante antes del LCP, y manda la IP de cada visitante de la web de un
 * cliente a Google. Es exactamente lo que la §Política de imágenes prohíbe para las fotos, y sería
 * incoherente permitirlo para las fuentes.
 *
 * ## Los tres roles legacy NO se self-hostean, y es deliberado
 *
 * `sistema`, `serif` y `moderna` son los tres valores que acepta el campo viejo `brand.font`, y todas
 * las fichas sembradas hasta hoy usan uno de ellos. Cambiarles la familia por una self-hosted les
 * cambiaría el aspecto a todas de golpe — la única regresión que el manual de marca puede causar, y
 * la que la spec prohíbe con esas palabras. Se quedan en stacks del sistema, que además no cuestan
 * ni un byte de descarga.
 *
 * Los cuatro nombres nuevos (`condensada`, `geometrica`, `humanista`, `script`) son los que traen
 * familia propia: nadie los usa todavía, así que estrenarlos no rompe nada.
 *
 * ## Licencias
 *
 * Las cuatro son **SIL OFL 1.1**, verificado familia por familia contra el repositorio de Google
 * Fonts, y el texto de cada licencia está commiteado en `web-builder/assets/fonts/licencias/`. La
 * regla es de la spec y no se negocia: **una fuente sin su licencia en el repo no se sirve.**
 */

/** Los stacks del sistema. Cuestan cero bytes y son la red de seguridad de toda familia self-hosted. */
export const STACK_SISTEMA = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
const STACK_SERIF = "Georgia,'Times New Roman',serif";

/**
 * Un archivo servido. El **hash va en el nombre público**, que es lo que permite el
 * `cache-control: immutable`: si el archivo cambia, cambia la URL, y ninguna cache sirve lo viejo.
 *
 * Los hashes están **escritos acá y no calculados en tiempo de ejecución** para que el CSS se pueda
 * emitir sin tocar el disco. Que no se desincronicen del archivo lo impone `fuentes.test.ts`, que
 * recalcula el SHA-256 de cada uno: editar un `.woff2` sin actualizar su hash rompe el test, no la
 * cache de un cliente.
 */
export interface ArchivoFuente {
  /** El archivo en `web-builder/assets/fonts/`. */
  archivo: string;
  /** Los 8 primeros hex del SHA-256 de ese archivo. */
  hash: string;
  peso: number;
}

/** Una familia self-hosted, con sus pesos. */
export interface FamiliaFuente {
  /** El `font-family` que se emite. Va entre comillas en el CSS si lleva espacios. */
  nombre: string;
  /** A qué cae si el `woff2` no carga. Nunca se deja una familia sin red de seguridad. */
  respaldo: string;
  archivos: readonly ArchivoFuente[];
}

/**
 * Nombre de rol → qué hay detrás.
 *
 * **La ficha del cliente elige el ROL, nunca la familia.** Cambiar qué familia hay detrás de
 * `condensada` es entonces un cambio de código revisado, y no una edición masiva de fichas de
 * clientes — que es el punto entero de que la allowlist sea de nombres neutros.
 */
export const FAMILIAS: Readonly<Record<string, FamiliaFuente>> = {
  condensada: {
    nombre: "Oswald",
    respaldo: "Arial Narrow,sans-serif",
    archivos: [
      { archivo: "oswald-500.woff2", hash: "5e619e5c", peso: 500 },
      { archivo: "oswald-700.woff2", hash: "2e861666", peso: 700 },
    ],
  },
  geometrica: {
    nombre: "Jost",
    respaldo: STACK_SISTEMA,
    archivos: [
      { archivo: "jost-400.woff2", hash: "b249869f", peso: 400 },
      { archivo: "jost-700.woff2", hash: "1bd04683", peso: 700 },
    ],
  },
  humanista: {
    nombre: "Source Sans 3",
    respaldo: STACK_SISTEMA,
    archivos: [
      { archivo: "sourcesans3-400.woff2", hash: "70577c6e", peso: 400 },
      { archivo: "sourcesans3-700.woff2", hash: "78ee3bc6", peso: 700 },
    ],
  },
  script: {
    nombre: "Dancing Script",
    // Un rótulo en cursiva de sistema es feo, pero es legible: lo contrario de caer a sans-serif, que
    // haría que el nombre del negocio se viera como el resto del texto.
    respaldo: "Brush Script MT,cursive",
    archivos: [{ archivo: "dancingscript-600.woff2", hash: "dc6bb192", peso: 600 }],
  },
};

/**
 * Los tres roles legacy, en stacks del sistema. Ver la cabecera: no se self-hostean a propósito.
 *
 * ⚠️ **Estos tres valores son los que se ven HOY en producción, y por eso están donde están.**
 *
 * Hasta la mitad C de la entrega 3 había dos tablas de stacks —esta y una privada en `css.ts`— y para
 * `moderna` **decían cosas distintas**: acá `Inter,Segoe UI,Roboto,Helvetica Neue,sans-serif`, allá
 * `'Helvetica Neue',Arial,sans-serif`. La que llegaba al `<style>` era la de `css.ts`, así que al
 * unificar ganó esa: toda ficha sembrada con `brand.font: "moderna"` habría cambiado de tipografía de
 * golpe, que es la única regresión que la spec prohíbe con esas palabras.
 *
 * Los literales están repetidos en `fuentes.test.ts` **escritos a mano** contra lo que emite
 * `tokensDeMarca`. Es deliberado: leerlos de acá sería comprobar que una constante es igual a sí
 * misma, y es exactamente por eso que el test viejo no cazó la divergencia.
 */
export const STACKS_SISTEMA: Readonly<Record<string, string>> = {
  sistema: STACK_SISTEMA,
  serif: STACK_SERIF,
  moderna: "'Helvetica Neue',Arial,sans-serif",
};

/**
 * Lectura por clave PROPIA, nunca heredada.
 *
 * `FAMILIAS["toString"]` es `Object.prototype.toString` —un valor truthy— así que con indexación
 * directa `stackDe("toString")` devolvía `"'undefined',undefined"` en vez de `null`. Es el mismo
 * agujero que `css.ts` cierra en su allowlist (ver `rolValido`), y hay que cerrarlo **también acá**
 * porque estas dos funciones son ahora la fuente de verdad de la que aquella deriva. En PROD el perfil
 * puede llegar de Storyblok sin pasar por Zod, así que el nombre es alcanzable.
 */
function propio<T>(mapa: Readonly<Record<string, T>>, clave: string): T | undefined {
  return Object.hasOwn(mapa, clave) ? mapa[clave] : undefined;
}

/** La ruta pública de un archivo. El hash en el nombre es lo que hace válido el `immutable`. */
export function rutaPublica(a: ArchivoFuente): string {
  const base = a.archivo.replace(/\.woff2$/, "");
  return `/_assets/fonts/${base}.${a.hash}.woff2`;
}

/** El nombre público (sin el prefijo de ruta) → el archivo en disco. Es el mapa que sirve el renderizador. */
export function manifiesto(): Map<string, string> {
  const out = new Map<string, string>();
  for (const familia of Object.values(FAMILIAS)) {
    for (const a of familia.archivos) {
      out.set(rutaPublica(a).replace("/_assets/fonts/", ""), a.archivo);
    }
  }
  return out;
}

/**
 * El `font-family` de un rol, con su respaldo. Lo que va dentro de un token `--marca-fuente-*`.
 *
 * **Es la ÚNICA fuente de verdad de los stacks del proyecto**: `css.ts` deriva su allowlist de acá en
 * vez de mantener una tabla paralela. Un rol desconocido —o heredado del prototipo— devuelve `null`, y
 * quien llama lo descarta y cae al default del CSS base.
 */
export function stackDe(rol: string): string | null {
  const propia = propio(FAMILIAS, rol);
  if (propia) return `'${propia.nombre}',${propia.respaldo}`;
  return propio(STACKS_SISTEMA, rol) ?? null;
}

/**
 * El peso con el que se pintan los titulares, y por tanto el único que vale la pena precargar.
 *
 * **700 no es una preferencia: es lo que el navegador va a pedir.** `h1`, `h2` y `h3` traen
 * `font-weight: bold` de la hoja de estilo del navegador y **ninguna pieza se lo sobrescribe** — lo
 * fija su propio test en `ensamblado.test.ts`, recorriendo los selectores que consumen
 * `--fuente-titulo` sobre el CSS emitido. Precargar el 500 de Oswald sería precargar un archivo que
 * nadie pide: dos descargas en vez de una, que es justo lo contrario de lo que el preload busca.
 */
export const PESO_TITULARES = 700;

/**
 * El archivo que el navegador va a pedir para dibujar los **titulares** de una familia, o `null` si el
 * rol no tiene familia propia (los tres legacy no descargan nada).
 *
 * Cuando la familia no trae el peso exacto se elige el **más cercano**, y a igual distancia el más
 * grueso. Es el caso de Dancing Script, que solo tiene 600: con una sola cara declarada el navegador
 * la usa para todos los pesos, así que «la más cercana» es literalmente la única que va a pedir.
 */
export function archivoTitulares(rol: string): ArchivoFuente | null {
  const familia = propio(FAMILIAS, rol);
  if (!familia) return null;

  let mejor: ArchivoFuente | null = null;
  for (const a of familia.archivos) {
    if (!mejor) {
      mejor = a;
      continue;
    }
    const d = Math.abs(a.peso - PESO_TITULARES);
    const dMejor = Math.abs(mejor.peso - PESO_TITULARES);
    if (d < dMejor || (d === dMejor && a.peso > mejor.peso)) mejor = a;
  }
  return mejor;
}

/**
 * Las `@font-face` de **las familias que la página usa de verdad**, y nada más.
 *
 * Una página que no usa `script` no paga sus 25 KB ni su petición: es el mismo criterio que el CSS de
 * las piezas, que solo viaja si la pieza dibujó algo.
 *
 * `font-display: swap` porque el texto tiene que ser legible desde el primer pintado; un rótulo
 * invisible durante 3 s es peor que un rótulo con la fuente equivocada durante 300 ms.
 */
export function cssDeFuentes(roles: Iterable<string>): string {
  const usadas = new Set<string>();
  // `propio` y no indexación directa, por lo mismo que en `stackDe`. Acá el prototipo no llegaba a
  // emitir nada (el bucle de abajo recorre `Object.entries`), pero dejar el patrón inconsistente es
  // cómo el agujero vuelve la próxima vez que alguien copie esta línea.
  for (const rol of roles) if (propio(FAMILIAS, rol)) usadas.add(rol);
  if (usadas.size === 0) return "";

  const bloques: string[] = [];
  // En orden de `FAMILIAS` y no de uso: dos páginas con las mismas familias emiten el mismo CSS byte
  // a byte, igual que el catálogo de piezas.
  for (const [rol, familia] of Object.entries(FAMILIAS)) {
    if (!usadas.has(rol)) continue;
    for (const a of familia.archivos) {
      bloques.push(
        `@font-face{font-family:'${familia.nombre}';font-style:normal;font-weight:${a.peso};` +
          `font-display:swap;src:url(${rutaPublica(a)}) format('woff2')}`,
      );
    }
  }
  return `\n${bloques.join("\n")}`;
}
