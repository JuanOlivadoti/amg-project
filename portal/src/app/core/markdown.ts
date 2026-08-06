/*
 * El parser del informe de keyword research: Markdown → ESTRUCTURA DE DATOS.
 *
 * Por qué existe, y por qué no es `marked` + `DOMPurify`. El informe está lleno de texto generado por
 * un LLM (`h1`, `meta_title`, `meta_description`, FAQs, secciones sugeridas), así que el paso
 * Markdown → pantalla es **por definición** superficie de inyección. Esa pareja de librerías falla
 * ABIERTO: si el sanitizador queda mal configurado, pasa todo. Y `bypassSecurityTrustHtml` es
 * exactamente lo que Angular tiene para no usar.
 *
 * Acá el Markdown se convierte en datos y la pantalla lo pinta con `@if`/`@for`, donde Angular escapa
 * el texto por defecto. **La garantía vive en el TIPO:** `Inline` solo contiene `string`s, y no existe
 * —ni puede existir— una variante `html`. Así la inyección es imposible por construcción, no evitada
 * por configuración. Si alguien agrega esa variante, la caza `markdown.test.ts`.
 *
 * El subconjunto que se reconoce es CERRADO porque escribimos el generador: `renderReport`
 * (`contrato/src/informe.ts`) emite encabezados `#`/`##`/`###`, tablas con fila de guiones, listas
 * `-`, blockquotes `>`, `**negrita**`, `_cursiva_`, `` `código` `` y los escapes de abajo. **Todo lo
 * que quede fuera se pinta como texto literal**: falla cerrado. Una marca desconocida no se
 * interpreta a medias ni se descarta en silencio — se ve tal cual.
 */

export type Inline =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'negrita'; valor: string }
  | { tipo: 'cursiva'; valor: string }
  | { tipo: 'codigo'; valor: string };

export type Bloque =
  | { tipo: 'encabezado'; nivel: 1 | 2 | 3; texto: Inline[] }
  | { tipo: 'parrafo'; texto: Inline[] }
  | { tipo: 'lista'; items: Inline[][] }
  | { tipo: 'cita'; texto: Inline[] }
  | { tipo: 'tabla'; cabecera: Inline[][]; filas: Inline[][][] };

/*
 * Los caracteres que `renderReport` escapa con `\` antes de interpolar texto del LLM
 * (`contrato/src/informe.ts`, función `texto()`): la barra primero, y después `| ` * _ # [ ] < >`.
 *
 * Deshacer ese escapado es OBLIGATORIO acá, y es la mitad del trabajo de este archivo. Medido sobre
 * la salida real del generador (2026-08-06): un `tipo: 'landing_local'` sale del informe como
 * `landing\_local`, y una keyword con pipe como `burger \| madrid`. Sin desescapar, el portal le
 * muestra al cliente la sintaxis en vez del dato.
 *
 * Y no es solo cosmético: el escapado es lo que impide que un `|` del LLM parta una celda o que un
 * `##` invente una sección, así que el parser tiene que respetarlo al buscar delimitadores —
 * un `\|` NO separa celdas, un `\_` NO abre cursiva.
 */
const ESCAPABLES = '\\|`*_#[]<>';

/**
 * ¿En la posición `i` empieza una secuencia `\X` que el generador escapó? Una barra seguida de
 * cualquier otra cosa NO es un escape: la barra es el carácter que es, y se ve.
 */
function esEscape(s: string, i: number): boolean {
  // El `i + 1 < s.length` no es defensivo, es obligatorio. Medido en node v24.18.1: `charAt` fuera de
  // rango devuelve '' y `'…'.includes('')` es TRUE, así que sin el guard una barra FINAL contaría como
  // escape y desaparecería del texto — un descarte en silencio, justo lo que este archivo promete no
  // hacer. Lo fija el test de la barra final.
  return s.charAt(i) === '\\' && i + 1 < s.length && ESCAPABLES.includes(s.charAt(i + 1));
}

/** Quita los `\` de escape de un texto ya delimitado (el contenido de una marca). */
function desescapar(s: string): string {
  let salida = '';
  for (let i = 0; i < s.length; i++) {
    if (esEscape(s, i)) {
      salida += s.charAt(i + 1);
      i++;
      continue;
    }
    salida += s.charAt(i);
  }
  return salida;
}

/**
 * Busca la marca `delim…delim` que empieza en `i`. Devuelve `null` si no abre ahí, si no cierra, o si
 * el contenido es vacío — y **en los tres casos el delimitador termina saliendo como texto literal**,
 * que es la regla de fallar cerrado.
 */
function marca(linea: string, i: number, delim: string): { valor: string; fin: number } | null {
  if (!linea.startsWith(delim, i)) return null;
  const inicio = i + delim.length;
  let j = inicio;
  while (j < linea.length) {
    if (esEscape(linea, j)) {
      j += 2;
      continue;
    }
    if (linea.startsWith(delim, j)) {
      if (j === inicio) return null; // `**` pegado a `**`: no hay contenido, no hay marca
      return { valor: desescapar(linea.slice(inicio, j)), fin: j + delim.length };
    }
    j++;
  }
  return null; // sin cierre en la línea
}

/**
 * El inline, en una sola pasada. Reconoce `` `código` ``, `**negrita**` y `_cursiva_`; **todo lo
 * demás es `texto`**, incluido cualquier `<`, `>` o `&` que venga en el dato.
 *
 * El orden importa: el código va primero (dentro de un `` ` `` no hay marcas), y `**` antes que `_`.
 * No hay anidamiento porque `Inline` es plano y porque el generador no lo emite: un `*` solo, un `_`
 * sin pareja o un `` ` `` sin cerrar salen como el carácter que son.
 */
export function parsearInline(linea: string): Inline[] {
  const partes: Inline[] = [];
  let acumulado = '';

  const soltarTexto = (): void => {
    if (acumulado !== '') {
      partes.push({ tipo: 'texto', valor: acumulado });
      acumulado = '';
    }
  };

  let i = 0;
  while (i < linea.length) {
    if (esEscape(linea, i)) {
      acumulado += linea.charAt(i + 1);
      i += 2;
      continue;
    }

    const codigo = marca(linea, i, '`');
    if (codigo) {
      soltarTexto();
      partes.push({ tipo: 'codigo', valor: codigo.valor });
      i = codigo.fin;
      continue;
    }

    const negrita = marca(linea, i, '**');
    if (negrita) {
      soltarTexto();
      partes.push({ tipo: 'negrita', valor: negrita.valor });
      i = negrita.fin;
      continue;
    }

    const cursiva = marca(linea, i, '_');
    if (cursiva) {
      soltarTexto();
      partes.push({ tipo: 'cursiva', valor: cursiva.valor });
      i = cursiva.fin;
      continue;
    }

    acumulado += linea.charAt(i);
    i++;
  }

  soltarTexto();
  return partes;
}

/** ¿La línea tiene la forma de una fila de tabla (`| … |`)? */
function esFilaDeTabla(linea: string): boolean {
  const t = linea.trim();
  return t.length >= 2 && t.startsWith('|') && t.endsWith('|');
}

/**
 * Parte una fila en celdas, **respetando los escapes**: un `\|` es un pipe del dato, no un separador.
 * Los escapes se conservan tal cual para que los deshaga `parsearInline`.
 */
function celdasDe(linea: string): string[] {
  const cuerpo = linea.trim().slice(1, -1);
  const celdas: string[] = [];
  let actual = '';
  for (let i = 0; i < cuerpo.length; i++) {
    if (esEscape(cuerpo, i)) {
      actual += cuerpo.slice(i, i + 2);
      i++;
      continue;
    }
    if (cuerpo.charAt(i) === '|') {
      celdas.push(actual);
      actual = '';
      continue;
    }
    actual += cuerpo.charAt(i);
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

/**
 * La fila de guiones que separa cabecera de datos. El generador emite `|---|---|`; se aceptan además
 * los dos puntos de alineación (`|:---:|`) porque son la forma estándar de la misma fila y su única
 * consecuencia es si eso es una tabla o un párrafo.
 */
function esFilaDeGuiones(linea: string): boolean {
  if (!esFilaDeTabla(linea)) return false;
  const celdas = celdasDe(linea);
  return celdas.length >= 1 && celdas.every((c) => /^:?-+:?$/.test(c));
}

const ENCABEZADO = /^(#{1,3}) +(.*)$/;
const ITEM = /^- +(.*)$/;
const CITA = /^> ?(.*)$/;

type Forma = 'blanco' | 'encabezado' | 'tabla' | 'lista' | 'cita' | 'parrafo';

/**
 * Qué forma empieza en la línea `i`. **Es la única autoridad sobre eso**: la usan tanto el bucle
 * principal como el que agrupa párrafos, así que no puede haber dos criterios en desacuerdo (era la
 * grieta por la que una fila de tabla sin su fila de guiones podía cortar un párrafo por la mitad).
 *
 * Todo lo que no encaja es `'parrafo'`. **No existe el caso "descartar"**, y esa ausencia es la
 * segunda garantía del archivo: una marca que no conocemos se ve, no desaparece.
 */
function formaDe(lineas: string[], i: number): Forma {
  const linea = lineas[i] ?? '';
  if (linea.trim() === '') return 'blanco';
  if (ENCABEZADO.test(linea)) return 'encabezado';
  // Una tabla sin fila de guiones NO es tabla: el generador siempre la emite, así que su ausencia
  // significa que eso no era una tabla. Se cae a párrafo y se ve literal.
  if (esFilaDeTabla(linea) && esFilaDeGuiones(lineas[i + 1] ?? '')) return 'tabla';
  if (ITEM.test(linea)) return 'lista';
  if (CITA.test(linea)) return 'cita';
  return 'parrafo';
}

/** El informe del brief, convertido en bloques que la pantalla pinta con `@if`/`@for`. */
export function parsearMarkdown(md: string): Bloque[] {
  const lineas = md.split('\n');
  const bloques: Bloque[] = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i] ?? '';
    const forma = formaDe(lineas, i);

    if (forma === 'blanco') {
      i++;
      continue;
    }

    if (forma === 'encabezado') {
      const m = ENCABEZADO.exec(linea);
      // `m` no puede ser null: `formaDe` acaba de probar la misma expresión. El `if` está para que
      // `tsc` estreche el tipo, no por duda.
      if (m) {
        const nivel = m[1]?.length === 1 ? 1 : m[1]?.length === 2 ? 2 : 3;
        bloques.push({ tipo: 'encabezado', nivel, texto: parsearInline(m[2] ?? '') });
      }
      i++;
      continue;
    }

    if (forma === 'tabla') {
      const cabecera = celdasDe(linea).map(parsearInline);
      i += 2; // la fila de cabecera y la de guiones
      const filas: Inline[][][] = [];
      // Se consumen filas mientras la línea tenga forma de fila y NO empiece otra tabla. Lo segundo
      // solo pasa sin línea en blanco de por medio, que el generador no emite: si algún día lo hace,
      // salen dos tablas y no una con la cabecera de la segunda metida como fila.
      while (
        i < lineas.length &&
        esFilaDeTabla(lineas[i] ?? '') &&
        formaDe(lineas, i) !== 'tabla'
      ) {
        filas.push(celdasDe(lineas[i] ?? '').map(parsearInline));
        i++;
      }
      bloques.push({ tipo: 'tabla', cabecera, filas });
      continue;
    }

    if (forma === 'lista') {
      const items: Inline[][] = [];
      while (i < lineas.length && formaDe(lineas, i) === 'lista') {
        items.push(parsearInline(ITEM.exec(lineas[i] ?? '')?.[1] ?? ''));
        i++;
      }
      bloques.push({ tipo: 'lista', items });
      continue;
    }

    if (forma === 'cita') {
      // Las líneas `>` seguidas son UNA cita: el generador emite avisos de una línea, pero un texto
      // del LLM con un salto interno puede partirse en dos, y son el mismo aviso.
      const trozos: string[] = [];
      while (i < lineas.length && formaDe(lineas, i) === 'cita') {
        trozos.push(CITA.exec(lineas[i] ?? '')?.[1] ?? '');
        i++;
      }
      bloques.push({ tipo: 'cita', texto: parsearInline(trozos.join(' ')) });
      continue;
    }

    // Párrafo: las líneas seguidas que no son ninguna otra forma van juntas, unidas por un espacio,
    // como el salto blando de Markdown. `texto()` del generador convierte un salto del LLM en una
    // línea nueva sin marca, y son la misma frase.
    const trozos: string[] = [];
    while (i < lineas.length && formaDe(lineas, i) === 'parrafo') {
      trozos.push((lineas[i] ?? '').trim());
      i++;
    }
    bloques.push({ tipo: 'parrafo', texto: parsearInline(trozos.join(' ')) });
  }

  return bloques;
}
