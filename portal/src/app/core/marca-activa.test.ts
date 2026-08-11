import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS } from './contraste';

/**
 * La marca del elemento activo, defendida — en **toda** plantilla que use `routerLinkActive`.
 *
 * Entre dos utilidades de Tailwind que pisan la misma propiedad con la misma especificidad gana la
 * que va DESPUÉS en la hoja de estilos; el orden dentro del atributo `class` no decide nada. Así que
 * `routerLinkActive` puede poner sus clases y la cascada ignorarlas: las que marcan el estado activo
 * pierden contra las del estado inactivo, y sin el `!` el activo se ve idéntico a los demás.
 *
 * Es una garantía silenciosa de manual: las clases están en el elemento (un test de DOM las encuentra
 * y pasa), no hay error en consola, y el único síntoma es visual. Se descubrió manejando la app, no
 * leyendo el código. Por eso se fija leyendo el FUENTE — mismo patrón que el test de
 * `paramsInheritanceStrategy` en `app.routes.test.ts` y que `core/sin-html-crudo.test.ts`. Karma no
 * puede cubrirlo: los specs de componente no compilan Tailwind, así que ahí `border-accion` no tiene
 * ningún valor computado que comparar.
 *
 * ## Por qué barre el árbol y no un archivo
 *
 * Nació en la tarea 1 mirando **solo** `cliente-ficha.ts`, y la tarea 2 encontró el mismo defecto,
 * preexistente y sin cubrir, en `app-sidebar.ts`: su `text-texto` activo perdía contra el
 * `text-texto-tenue` de la base. No se notaba porque el `bg-superficie-2` (que no compite con nada)
 * marcaba el activo igual — pero quien le quitara el fondo se quedaba sin marca de activo y sin nada
 * rojo. Un test que enumera archivos cubre las pantallas de hoy; recorrer el directorio es lo que
 * hace que la regla se cumpla sola en las de mañana. Mismo criterio que `contraste.test.ts`.
 *
 * ## El criterio, y las tres veces que estuvo mal calibrado
 *
 * 1. La primera versión exigía `!` en **toda** clase del `routerLinkActive`. Con dos clases que
 *    compiten daba el resultado correcto, pero habría obligado a poner `!important` en la primera
 *    clase que no compitiera con nada — enseñando el reflejo contrario al que este test existe para
 *    dejar.
 * 2. La segunda solo miraba **colores**, y con eso dejó de ver que `font-bold` en el activo pierde
 *    contra el `font-medium` de la base: el elemento activo no se pondría en negrita, con el test en
 *    verde. Se generalizó desde el único ejemplo examinado (`font-semibold`, que sí gana solo)
 *    tomando por propiedad de la familia lo que era suerte alfabética de ese valor.
 * 3. La tercera no fue el criterio sino sus **guardas de cobertura**, y la encontró la revisión de la
 *    tarea 2: eran dos cuotas absolutas (`anclas.length >= 2`, `pisadas.length >= 2`) mientras el
 *    numerador crece con cada tab que el plan agrega. Medido: con la barra de tabs escrita como
 *    `[class]="clasesBase"` —que el barrido se saltaba en silencio— y **tres** anclas en el árbol, la
 *    ficha con el defecto REAL puesto pasaba en verde. Las guardas de hoy son relativas a lo que el
 *    recorrido encuentra (cada mención emparejada, cada ancla analizada) y el salto silencioso es un
 *    fallo; lo único absoluto que queda son dos pisos de sanidad que no dependen del tamaño del árbol.
 *
 * Lo que decide de verdad son **dos** cosas, y el criterio de acá abajo mira las dos: que las clases
 * pisen la misma propiedad, y **cuál de las dos va después en la hoja**.
 */

/**
 * Los colores que puede llevar una utilidad: los 17 roles del portal (la fuente de verdad es
 * `core/contraste.ts`, importada y no copiada — agregar un rol no desincroniza este test) más las
 * palabras clave que Tailwind también emite.
 */
const COLORES = new Set([...TOKENS, 'transparent', 'current', 'inherit']);

/** Los valores de `font-*` que fijan `font-weight`, y los que fijan `font-family`. No se pisan. */
const PESOS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
]);
const TIPOGRAFIAS = new Set(['sans', 'serif', 'mono']);

/** Ídem para `text-*`, que en Tailwind es tres utilidades distintas: color, tamaño y alineación. */
const TAMANOS = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']);
const ALINEACIONES = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

/**
 * Qué propiedad CSS pisa una utilidad. Dos clases compiten si —y solo si— devuelven lo mismo.
 *
 * El discriminante es el VALOR, no el prefijo: `text-*` son tres utilidades que no se pisan entre sí
 * (`text-texto` pinta `color`, `text-sm` fija `font-size`, `text-center` alinea), y lo mismo pasa con
 * `font-*` (peso vs familia tipográfica) y `border-*` (color vs ancho). Agrupar por prefijo a secas
 * reintroduciría el falso positivo de la primera versión.
 *
 * Para lo que no reconoce cae en `familia:?`, que agrupa por prefijo: es el lado seguro del error
 * —puede pedir un `!` de más, nunca dejar pasar una colisión— y el rojo se lee y se corrige, mientras
 * que un verde de más no se ve.
 */
function grupoDePropiedad(clase: string): string | null {
  const limpia = clase.replace(/!$/, '');
  // Una variante (`hover:`, `focus:`) no pisa el estado normal: no compite, y contarla haría pedir un
  // `!` para ganarle a un hover que ni siquiera está activo.
  if (limpia.includes(':')) return null;
  const corte = limpia.indexOf('-');
  if (corte < 0) return null; // `italic`, `uppercase`: sin familia con la que comparar
  const familia = limpia.slice(0, corte);
  const valor = limpia.slice(corte + 1);

  if (COLORES.has(valor)) return `${familia}:color`;
  if (familia === 'font' && PESOS.has(valor)) return 'font:peso';
  if (familia === 'font' && TIPOGRAFIAS.has(valor)) return 'font:tipografía';
  if (familia === 'text' && TAMANOS.has(valor)) return 'text:tamaño';
  if (familia === 'text' && ALINEACIONES.has(valor)) return 'text:alineación';
  return `${familia}:?`;
}

/**
 * Qué clase de la base le gana a `activa` — o `null` si no la pisa ninguna.
 *
 * **Tailwind emite las utilidades por orden alfabético de nombre de clase, y eso está medido, no
 * supuesto.** Offsets dentro de `dist/portal-dev/browser/styles.css` (26 257 bytes) el 2026-08-11,
 * cinco pares de cuatro familias independientes — en los cinco gana el mayor alfabético:
 *
 * | Antes | Después (gana) |
 * |---|---|
 * | `.border-accion` 13345 | `.border-transparent` 13592 |
 * | `.text-texto` 17867 | `.text-texto-tenue` 18092 |
 * | `.font-bold` 17129 | `.font-medium` 17237 |
 * | `.font-medium` 17237 | `.font-semibold` 17351 |
 * | `.bg-superficie` 14149 | `.bg-superficie-2` 14213 |
 *
 * Las dos filas de `font-*` son las que descartan la otra hipótesis: si el orden fuera el de
 * definición del tema (thin, extralight, light, normal, medium, semibold, **bold**…), `font-bold`
 * saldría DESPUÉS de `font-semibold`. Sale antes. Es alfabético.
 *
 * Los offsets absolutos se mueven con cada build (el bundle crece); **el orden es lo único de lo que
 * depende esto**. Si algún día Tailwind cambiara ese orden, lo que hay que rehacer es esta función —
 * no aflojar el test.
 */
function pisadaPor(activa: string, base: readonly string[]): string | null {
  const grupo = grupoDePropiedad(activa);
  if (grupo === null) return null;
  const nombre = activa.replace(/!$/, '');
  for (const clase of base) {
    const suya = clase.replace(/!$/, '');
    if (grupoDePropiedad(clase) !== grupo) continue;
    if (nombre < suya) return suya; // va después en la hoja: la pisa
  }
  return null;
}

/**
 * Todo `src/` menos los tests — igual que `core/sin-html-crudo.test.ts`.
 *
 * Los `*.test.ts` y `*.spec.ts` quedan fuera porque un test legítimamente escribe el fragmento que
 * examina: este mismo archivo lleva anclas de ejemplo abajo, y contarlas sería medirse a sí mismo.
 */
function fuentes(): string[] {
  const raiz = fileURLToPath(new URL('../..', import.meta.url));
  const encontradas: string[] = [];
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|html)$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        encontradas.push(ruta);
      }
    }
  };
  recorrer(raiz);
  return encontradas;
}

interface Ancla {
  readonly archivo: string;
  readonly etiqueta: string;
  readonly activas: string[];
  readonly base: string[];
}

/**
 * El fuente **sin comentarios**: los de bloque y línea de TypeScript y los `<!-- … -->` de plantilla.
 *
 * Hace falta para CONTAR menciones de `routerLinkActive` sin contar la prosa que las explica — el
 * docblock de `cliente-ficha.ts` nombra el atributo dos veces, y sin esto el barrido se pondría rojo
 * por escribir documentación. Mismo criterio que `sinComentarios` en `app.routes.test.ts`.
 *
 * El `[^:]` antes de `//` es lo que evita comerse el resto de una línea que trae una URL (`https://`).
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Los elementos de UN archivo que se marcan con `routerLinkActive`, con sus dos listas de clases.
 *
 * Se acepta cualquier etiqueta y no solo `<a>`: el defecto es de la cascada, no del anchor. Un
 * elemento con `routerLinkActive` y **sin ninguna** clase base se salta a propósito — no tiene contra
 * qué perder, así que no hay nada que exigirle.
 *
 * Recibe el texto en vez de leerlo para poder ejercitar sus tres rechazos con fragmentos sintéticos:
 * un test que solo corre sobre el árbol real solo prueba lo que hoy hay escrito en el árbol real.
 */
function anclasDe(archivo: string, texto: string): Ancla[] {
  const anclas: Ancla[] = [];
  let emparejados = 0;
  for (const m of texto.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*\brouterLinkActive\b[^>]*)>/g)) {
    emparejados++;
    const etiqueta = m[1] ?? '?';
    const atributos = m[2] ?? '';
    const activas = /\brouterLinkActive="([^"]+)"/.exec(atributos)?.[1];
    // La forma ligada (`[routerLinkActive]="expr"`) no se puede leer desde el fuente, y dejarla
    // pasar en silencio convertiría el barrido en algo que se esquiva sin desobedecerlo.
    assert.ok(
      activas,
      `${archivo}: <${etiqueta}> usa routerLinkActive sin un valor estático ("…"). El criterio de ` +
        'este test analiza el fuente: escribilo estático, o extendé el test antes de ligarlo.',
    );
    const base = /\bclass="([^"]+)"/.exec(atributos)?.[1];
    if (!base) {
      /*
       * Sin `class=` estático hay dos casos MUY distintos, y confundirlos fue el agujero que midió la
       * revisión de la tarea 2: un elemento sin ninguna clase no tiene base contra la que perder (se
       * salta bien), pero uno con `[class]`/`[ngClass]` **sí la tiene** — solo que no se puede leer
       * desde el fuente. Saltarlo era la salida silenciosa: con `[class]="clasesBase"` la barra de
       * tabs desaparecía del barrido con el defecto puesto, y en cuanto hubiera una tercera ancla la
       * guarda de conteo tampoco lo tapaba. Mismo criterio que el `assert` de arriba.
       */
      assert.ok(
        !/\[(?:class|ngClass)\]/.test(atributos),
        `${archivo}: <${etiqueta}> tiene routerLinkActive y una clase base LIGADA ([class]/[ngClass]), ` +
          'que este barrido no puede leer del fuente. Dejá las clases base estáticas en `class="…"`, o ' +
          'extendé el test antes de ligarlas: saltarlo lo deja sin cubrir justo donde el defecto vive.',
      );
      continue;
    }
    anclas.push({
      archivo,
      etiqueta,
      activas: activas.split(/\s+/).filter(Boolean),
      base: base.split(/\s+/).filter(Boolean),
    });
  }

  /*
   * La guarda de cobertura, **relativa al propio archivo**: cada mención de `routerLinkActive` en el
   * código tiene que corresponder a un elemento que el regex emparejó. Reemplaza a un
   * `anclas.length >= 2` global que dejaba de morder en cuanto hubiera una tercera ancla — las
   * guardas absolutas se aflojan solas mientras el numerador crece, y el plan agrega tabs.
   *
   * El modo de fallo que caza, medido: un `>` dentro de un valor de atributo (`title="a > b"`) corta
   * el `[^>]*` del regex y el elemento deja de emparejar, sin que nada avise.
   */
  const menciones = (sinComentarios(texto).match(/\brouterLinkActive\b/g) ?? []).length;
  assert.ok(
    emparejados >= menciones,
    `${archivo}: el código menciona routerLinkActive ${menciones} vez/veces y el barrido solo emparejó ` +
      `${emparejados} elemento(s). Alguno se le escapa al regex —¿un \`>\` dentro de un atributo, el ` +
      'atributo partido de otra forma?— y quedaría sin comprobar, en verde.',
  );
  return anclas;
}

/** Todas las anclas del árbol, archivo por archivo. */
function anclasActivas(): { anclas: Ancla[]; archivos: number; conMarca: number } {
  const archivos = fuentes();
  const anclas: Ancla[] = [];
  let conMarca = 0;
  for (const archivo of archivos) {
    const texto = readFileSync(archivo, 'utf8');
    if (!/\brouterLinkActive\b/.test(sinComentarios(texto))) continue;
    conMarca++;
    anclas.push(...anclasDe(archivo, texto));
  }
  return { anclas, archivos: archivos.length, conMarca };
}

test('🔴 toda clase activa a la que la base le gana lleva `!`: si no, el activo no se distingue', () => {
  const { anclas, archivos, conMarca } = anclasActivas();

  /*
   * Los dos pisos de sanidad — que el recorrido corrió, no cuánto cubre. **No son cuotas**: no se
   * aflojan cuando el árbol crece, porque no dependen de cuántas anclas haya. La cobertura de verdad
   * la imponen las guardas relativas: la de `anclasDe` (cada mención emparejada) y la de más abajo
   * (cada ancla analizada).
   */
  assert.ok(
    archivos >= 20,
    `el recorrido de fuentes() encontró ${archivos} archivos: son ~70 en src/. ¿Se rompió el filtro ` +
      'de extensiones o la ruta raíz? Con cero archivos, todo lo de abajo pasa sin haber mirado nada.',
  );
  assert.ok(
    conMarca >= 1,
    'ningún archivo del portal usa routerLinkActive: o desapareció la marca de elemento activo, o el ' +
      'barrido dejó de encontrarla. Las dos cosas hay que mirarlas.',
  );

  /*
   * Guarda relativa **por ancla**: cada elemento encontrado tiene que aportar al menos una clase
   * activa que el criterio sepa clasificar. Reemplaza al `pisadas.length >= 2` global, que era una
   * cuota constante mientras el numerador crece — con tres anclas, las dos colisiones de siempre ya
   * lo satisfacían y una tercera podía entrar sin analizarse. Lo que caza: `grupoDePropiedad`
   * dejando de reconocer las utilidades del portal, con lo que `pisadaPor` devolvería `null` para
   * todo y el bucle final no correría.
   */
  for (const ancla of anclas) {
    assert.ok(
      ancla.activas.some((clase) => grupoDePropiedad(clase) !== null),
      `${ancla.archivo}: ninguna de las clases activas de <${ancla.etiqueta}> ` +
        `([${ancla.activas.join(' ')}]) se pudo clasificar, así que no se comparó con la base contra ` +
        'la que compite. El ancla estaría en verde sin haberse analizado.',
    );
  }

  const pisadas = anclas.flatMap((ancla) =>
    ancla.activas
      .map((clase) => ({ ancla, clase, por: pisadaPor(clase, ancla.base) }))
      .filter((x): x is { ancla: Ancla; clase: string; por: string } => x.por !== null),
  );

  for (const { ancla, clase, por } of pisadas) {
    assert.ok(
      clase.endsWith('!'),
      `${ancla.archivo}: \`${clase}\` no lleva \`!\` y \`${por}\` (del estado inactivo) va después en ` +
        'la hoja, así que la pisa: el elemento activo se vería igual que los demás. Tailwind emite por ' +
        'orden alfabético, y el orden del atributo `class` no decide nada.',
    );
  }
});

test('el criterio de colisión mira la propiedad Y el orden de emisión, no solo el prefijo', () => {
  // Sin esto, «compite por propiedad y pierde por orden» sería una afirmación del docblock: el test de
  // arriba podría estar exigiendo `!` a cualquier cosa, o a nada, sin que se note.
  const base = ['border-b-2', 'border-transparent', 'text-texto-tenue', 'font-medium', 'text-sm', 'hover:text-texto'];

  // Las dos colisiones reales de hoy: la base va después en la hoja y las pisa.
  assert.equal(pisadaPor('border-accion', base), 'border-transparent');
  assert.equal(pisadaPor('text-texto', base), 'text-texto-tenue');

  // La familia que el criterio anterior no miraba. `font-bold` < `font-medium`: la base gana.
  assert.equal(pisadaPor('font-bold', base), 'font-medium', 'font-bold pierde contra font-medium');
  // Y su vecino, que gana solo — el caso que hace que «misma familia» a secas sea demasiado grueso.
  assert.equal(pisadaPor('font-semibold', base), null, 'font-semibold va después: no necesita `!`');

  // Propiedades distintas que comparten prefijo: en Tailwind no se pisan. `text-lg` es la prueba
  // fina de que el criterio no mezcla las tres caras de `text-*`: se saltea el `text-texto-tenue` de
  // la base (que es color) y va a chocar con el `text-sm` (que sí es tamaño, y le gana).
  assert.equal(pisadaPor('text-lg', base), 'text-sm', 'text-lg compite por TAMAÑO, no por color');
  assert.equal(pisadaPor('text-xs', base), null, 'text-xs también es tamaño, pero va después: gana');
  assert.equal(pisadaPor('text-center', base), null, 'text-center alinea; no pinta ni dimensiona');
  assert.equal(pisadaPor('font-serif', base), null, 'font-serif es familia tipográfica, no peso');
  // Ídem del lado del borde: `border-2` no choca con `border-transparent` (que es color) sino con el
  // `border-b-2` de la base, que también fija ancho — y que le gana.
  assert.equal(pisadaPor('border-2', base), 'border-b-2', 'border-2 compite por ANCHO, no por color');

  // Y lo que no compite con nada de la base no necesita nada.
  assert.equal(pisadaPor('rounded-t', base), null);
  assert.equal(pisadaPor('bg-superficie', base), null, 'la base no tiene ningún bg-*');
  assert.equal(pisadaPor('hover:text-texto', base), null, 'una variante no pisa el estado normal');

  // El grupo, directamente: las tres caras de `text-*` no se mezclan entre sí.
  assert.equal(grupoDePropiedad('text-texto'), 'text:color');
  assert.equal(grupoDePropiedad('text-sm'), 'text:tamaño');
  assert.equal(grupoDePropiedad('text-center'), 'text:alineación');
  assert.equal(grupoDePropiedad('font-bold'), 'font:peso');
  assert.equal(grupoDePropiedad('font-mono'), 'font:tipografía');
  assert.equal(grupoDePropiedad('border-accion!'), 'border:color', 'el `!` no cambia qué propiedad pisa');
});

test('🔴 la base LIGADA (`[class]`) no es un salto: es la salida silenciosa, y ahora falla', () => {
  /*
   * El agujero que midió la revisión de la tarea 2, con el defecto REAL puesto: la barra de tabs con
   * `[class]="clasesBase"` + `routerLinkActive="border-accion text-texto"` (sin los `!`) se saltaba
   * en silencio, y con dos anclas el barrido lo tapaba porque la guarda absoluta `>= 2` seguía
   * satisfecha por el sidebar… hasta que con tres anclas dejaba de fallar del todo. El elemento tiene
   * base —la ligada— así que sí hay contra qué perder: saltarlo es no mirar.
   */
  assert.throws(
    () => anclasDe('pages/futuro/tab.ts', `<a routerLinkActive="border-accion text-texto" [class]="clasesBase">`),
    /\[class\]/,
    'un ancla con la base ligada se saltó en silencio',
  );
  assert.throws(
    () => anclasDe('pages/futuro/tab.ts', `<a routerLinkActive="text-texto" [ngClass]="clases">`),
    /ngClass|\[class\]/,
  );

  // Y el salto que SÍ es legítimo sigue siéndolo: sin ninguna clase base no hay cascada que perder, y
  // exigirle un `!` enseñaría el reflejo que este archivo entero existe para no enseñar.
  assert.deepEqual(anclasDe('x.ts', `<a routerLinkActive="bg-superficie-2">`), []);
});

test('🔴 cada mención de routerLinkActive queda emparejada: la cobertura es relativa, no un `>= 2`', () => {
  // Un `>` dentro de un valor de atributo corta el `[^>]*` del regex: el elemento deja de emparejar y
  // el barrido lo ignora. Con la guarda vieja alcanzaba con que hubiera otras dos anclas para que
  // nadie se enterara; con la relativa, el archivo que lo esconda cae.
  assert.throws(
    () => anclasDe('x.ts', `<a title="a > b" routerLinkActive="border-accion" class="border-transparent">`),
    /menciona routerLinkActive/,
  );

  // Dos elementos legítimos en el mismo archivo: las dos menciones emparejan, y salen las dos anclas.
  const dos = `<a routerLinkActive="border-accion!" class="border-transparent"></a>
    <button routerLinkActive="text-texto!" class="text-texto-tenue"></button>`;
  assert.deepEqual(anclasDe('x.ts', dos).map((a) => a.etiqueta), ['a', 'button']);

  // Y la mención que vive en PROSA no cuenta: si contara, el docblock de `cliente-ficha.ts` —que
  // explica por qué el `!` está ahí— pondría el barrido rojo por documentar la regla.
  assert.deepEqual(anclasDe('x.ts', `/** el \`routerLinkActive\` de la barra de tabs */`), []);
  assert.deepEqual(anclasDe('x.ts', `<!-- routerLinkActive, explicado arriba -->`), []);
  assert.deepEqual(anclasDe('x.ts', `// ver routerLinkActive en el docblock`), []);
});

test('🔴 el caso del sidebar: `bg-*` gana solo, pero el `text-texto` activo pierde y necesita `!`', () => {
  /*
   * El defecto que este barrido encontró al dejar de mirar un solo archivo. Va aparte del barrido
   * porque el barrido afirma sobre lo que HAY: si mañana alguien reescribe el menú, el barrido lo
   * sigue cubriendo pero deja de documentar por qué el `!` estaba ahí.
   *
   * Las dos mitades importan. `bg-superficie-2` NO lleva `!` porque la base no tiene ningún `bg-*`
   * en estado normal (solo `hover:bg-superficie-2`, que es otra cosa) — pedírselo enseñaría a poner
   * `!important` por reflejo. `text-texto` SÍ, porque `text-texto-tenue` va después en la hoja.
   */
  const base = ['flex', 'items-center', 'gap-3', 'rounded-md', 'px-3', 'py-2', 'text-sm', 'text-texto-tenue', 'hover:text-texto', 'hover:bg-superficie-2'];

  assert.equal(pisadaPor('bg-superficie-2', base), null, 'no hay bg-* en la base: el activo gana solo');
  assert.equal(pisadaPor('text-texto', base), 'text-texto-tenue', 'el activo pierde: necesita `!`');
});
