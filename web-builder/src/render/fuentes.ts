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

/** Los tres roles legacy, en stacks del sistema. Ver la cabecera: no se self-hostean a propósito. */
export const STACKS_SISTEMA: Readonly<Record<string, string>> = {
  sistema: STACK_SISTEMA,
  serif: STACK_SERIF,
  moderna: "Inter,Segoe UI,Roboto,Helvetica Neue,sans-serif",
};

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

/** El `font-family` de un rol, con su respaldo. Lo que va dentro de un token `--marca-fuente-*`. */
export function stackDe(rol: string): string | null {
  const propia = FAMILIAS[rol];
  if (propia) return `'${propia.nombre}',${propia.respaldo}`;
  return STACKS_SISTEMA[rol] ?? null;
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
  for (const rol of roles) if (FAMILIAS[rol]) usadas.add(rol);
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
