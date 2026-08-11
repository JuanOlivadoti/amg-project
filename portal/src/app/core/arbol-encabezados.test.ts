// `@angular/router` exige el compiler JIT al cargar el módulo bajo `node --import tsx` (no hay
// linker). Mismo import, y mismo motivo, que en `app.routes.test.ts`.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from '../app.routes';

/**
 * **Un solo `<h1>` por pantalla, y es el de la HOJA — no el del contenedor.**
 *
 * ## El defecto que fija, medido en Chrome (2026-08-11)
 *
 * Cuando el run se mudó bajo la ficha del cliente, `/clientes/:id/research/:runId` pasó a tener DOS
 * `h1` en el mismo documento: el de la ficha (el nombre del cliente) y el del brief (el prompt del
 * run). Antes no pasaba porque el brief colgaba de `AppShellComponent`, que no aporta ninguno. El
 * árbol medido estaba roto de tres formas a la vez:
 *
 * ```
 * h2   Borcelle Burger      ← el breadcrumb: un encabezado ANTES del primer h1
 * h1   Borcelle Burger      ← el mismo string, otra vez, un nivel más abajo
 * h1   <prompt del run>     ← y el segundo h1
 * ```
 *
 * ## La regla, en una línea
 *
 * **El `<h1>` es de la HOJA de la ruta. Un contenedor —quien declara un `<router-outlet>`— no
 * declara ninguno, y quien se declare contenedor con `[esEncabezado]="false"` tiene que serlo.**
 *
 * Que «contenedor» se defina por el `<router-outlet>` y no por una lista de nombres es lo que hace
 * que la regla cubra lo que todavía no existe. La primera versión de este barrido miraba solo la
 * ficha, y la re-revisión midió los dos agujeros que dejaba: un `<h1>` en `AppShellComponent` pasaba
 * en verde (y le da dos `h1` a **todas** las pantallas de una vez), y `[esEncabezado]="false"` en una
 * pantalla suelta la dejaba con cero `<h1>`, porque el atributo era a la vez la vía de escape y la
 * exención de la única regla que cazaría su mal uso.
 *
 * ## Quién es el dueño del `h1`, y por qué
 *
 * **La hoja de la ruta, no el contenedor.** Tres motivos, y el tercero es el que decide:
 *
 * 1. `cliente-ficha.ts` se declara a sí misma «CONTENEDOR de sus secciones, **no** pantalla». Un
 *    contenedor que se queda el `h1` es un shell haciéndose pasar por página.
 * 2. El `h1` tiene que distinguir la URL. Con el cliente como dueño, las cuatro rutas de la ficha
 *    anuncian el mismo encabezado — que es justo lo que la regla existe para evitar.
 * 3. El documento del informe **ya** se renderiza con dos desplazamientos distintos según dónde vive
 *    (`informe.ts` baja `#`→h2 porque está anidado; `entregable.ts` lo deja en `h1` porque ahí el
 *    documento ES la página). Si el cliente se quedara el `h1`, el informe tendría que bajar otro
 *    escalón y llegar a `h5`, un tamaño que el sistema visual no tiene.
 *
 * ## Por qué se lee el FUENTE y no se monta nada
 *
 * Porque el defecto es de **composición**, y Karma monta los componentes **aislados**. Prueba de
 * ello: `informe.spec.ts` afirma `querySelectorAll('h1').length === 1` y seguiría en verde con dos,
 * tres o cuatro `h1` en la pantalla real — es un assert que reproduce la implementación en vez de
 * fijar el contrato. Mismo patrón, y mismo motivo, que `core/marca-activa.test.ts` y
 * `core/sin-html-crudo.test.ts`: se lee el fuente porque es donde vive la garantía.
 *
 * ## El límite de este barrido, dicho de frente
 *
 * Exige **al menos un** `<h1` por hoja, no exactamente uno: `informe.ts` declara dos en el fuente —uno
 * por rama de un `@if`/`@else` mutuamente excluyente— y distinguir eso pediría entender el control
 * flow de la plantilla. Es el lado seguro del error: caza «la hoja se quedó sin `h1`» y «el shell
 * recuperó el suyo», que son las dos formas en que el árbol se rompe de verdad, y deja pasar una hoja
 * que declarara dos a la vez.
 */

/** El fuente sin comentarios: los de bloque y línea de TS y los `<!-- … -->` de plantilla. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const raiz = fileURLToPath(new URL('..', import.meta.url));
const leer = (relativa: string): string => readFileSync(new URL(relativa, import.meta.url), 'utf8');

/** Cuántas veces declara `<hN` una plantilla, sin contar la prosa que lo explique. */
function cuenta(fuente: string, nivel: number): number {
  return (sinComentarios(fuente).match(new RegExp(`<h${nivel}\\b`, 'g')) ?? []).length;
}

/**
 * El objeto de ruta que empieza en `marcador`, delimitado contando llaves.
 *
 * Se cuentan en vez de escribirlas en un regex por lo mismo que `argumentosDe` en `app.routes.test.ts`
 * cuenta paréntesis: así el formateo —saltos, sangría, la coma final de Prettier— deja de importar.
 */
function objetoDeRuta(codigo: string, marcador: string): string | null {
  const i = codigo.indexOf(marcador);
  if (i < 0) return null;
  const abre = codigo.lastIndexOf('{', i);
  if (abre < 0) return null;
  let nivel = 0;
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === '{') nivel++;
    else if (codigo[j] === '}') {
      nivel--;
      if (nivel === 0) return codigo.slice(abre, j + 1);
    }
  }
  return null;
}

/**
 * Las plantillas que montan DENTRO de la ficha, sacadas de las rutas y no de una lista escrita a mano.
 *
 * Es lo que hace que la regla cubra los tabs que la Tarea 4 todavía no escribió: quien agregue una
 * hija a `clientes/:id` la mete en este barrido sin enterarse. El conteo se ata contra el array
 * `routes` **importado** —no solo contra el texto— para que un parseo que se desincronice falle
 * ruidoso en vez de devolver menos archivos de la cuenta.
 */
function hojasDeLaFicha(): { shell: string; hojas: string[] } {
  const codigo = sinComentarios(leer('../app.routes.ts'));
  const bloque = objetoDeRuta(codigo, "path: 'clientes/:id'");
  assert.ok(bloque, 'no encontré el objeto de ruta de `clientes/:id` en app.routes.ts');

  const imports = [...bloque.matchAll(/import\('\.\/(pages\/[^']+)'\)/g)].map((m) => `../${m[1]}.ts`);
  const shell = imports.find((r) => r.includes('cliente-ficha'));
  assert.ok(shell, 'el `loadComponent` de la ficha no está donde este test lo busca');
  const hojas = imports.filter((r) => r !== shell);

  // La guarda contra el parseo frágil: el fuente y el árbol de rutas real tienen que contar lo mismo.
  const ficha = (routes.find((r) => r.path === '' && r.children)?.children ?? []).find(
    (r) => r.path === 'clientes/:id',
  );
  const conComponente = (ficha?.children ?? []).filter((r) => r.loadComponent);
  assert.equal(
    hojas.length,
    conComponente.length,
    `el barrido del fuente encontró ${hojas.length} hoja(s) y \`routes\` declara ${conComponente.length} ` +
      'hija(s) con `loadComponent`. Se desincronizaron: alguna quedaría sin comprobar, en verde.',
  );
  return { shell, hojas };
}

test('🔴 un CONTENEDOR —quien declara <router-outlet>— no declara ningún <h1>', () => {
  /*
   * La regla general, y la que cubre lo que la primera versión de este barrido dejaba pasar: no es
   * «la ficha no tiene h1», es «nadie que envuelva otra pantalla tiene h1». El `<h1>` es de la HOJA de
   * la ruta, y un contenedor que se quede uno se lo suma al de todas las pantallas que monta.
   */
  const encontrados = contenedores();

  // El piso de sanidad: con cero contenedores el bucle de abajo no mira nada y pasa igual. Hoy son
  // tres —`app.html`, `app-shell.ts` y `cliente-ficha.ts`— y son los únicos del portal.
  assert.ok(
    encontrados.length >= 3,
    `el barrido encontró ${encontrados.length} contenedor(es) y hay al menos 3 (app.html, ` +
      'app-shell.ts, cliente-ficha.ts). ¿Dejó de reconocer el <router-outlet>?',
  );

  for (const archivo of encontrados) {
    assert.equal(
      cuenta(readFileSync(archivo, 'utf8'), 1),
      0,
      `${archivo} declara un <router-outlet> —es un CONTENEDOR— y además un <h1>. Ese <h1> se suma al ` +
        'de cada pantalla que monte adentro y deja DOS en el documento. Usá un <p> con las mismas ' +
        'clases: el tamaño lo manda la clase, no la etiqueta.',
    );
  }
});

test('🔴 quien se declara contenedor con [esEncabezado]="false" tiene que serlo de verdad', () => {
  /*
   * `[esEncabezado]="false"` es la vía de escape de la regla de más abajo («quien usa el breadcrumb
   * como encabezado no declara además su propio h1»), y hasta la re-revisión era **también** la
   * exención de la única comprobación que cazaría su mal uso: ponérselo a una pantalla suelta la
   * dejaba con CERO `<h1>` y el barrido en verde. Medido sobre `pages/clientes/clientes.ts`, cuyo
   * breadcrumb es su único encabezado.
   *
   * Ahora la afirmación se comprueba en vez de creerse: si decís que sos un contenedor, tenés que
   * declarar un `<router-outlet>`.
   */
  const conFlag = fuentes().filter((archivo) =>
    esShell(sinComentarios(readFileSync(archivo, 'utf8'))),
  );
  assert.ok(
    conFlag.length >= 1,
    'ningún archivo usa `[esEncabezado]="false"`. La ficha lo necesita: sin él su breadcrumb pinta un ' +
      '<h1> y vuelve a haber dos en el documento.',
  );

  const esContenedor = new Set(contenedores());
  for (const archivo of conFlag) {
    assert.ok(
      esContenedor.has(archivo),
      `${archivo} pone \`[esEncabezado]="false"\` —que significa «el <h1> lo pone la hoja de mi ` +
        'outlet»— pero no declara ningún <router-outlet>: no monta ninguna hoja. Si es una pantalla ' +
        'suelta, su breadcrumb ES su encabezado y se queda sin ninguno. Quitá el atributo.',
    );
  }
});

test('🔴 el breadcrumb de la ficha va con [esEncabezado]="false": si no, pone un segundo <h1>', () => {
  // El caso concreto, que la regla general no alcanza: la ficha no declara el `<h1>` ella misma, se
  // lo pinta un componente hijo. Sin este atributo su fuente sigue teniendo cero `<h1>` —el test de
  // arriba pasa— y el documento igual termina con dos.
  const { shell } = hojasDeLaFicha();
  assert.ok(
    esShell(sinComentarios(leer(shell))),
    `${shell}: el breadcrumb de un SHELL tiene que ir con \`[esEncabezado]="false"\` (ligado, con ` +
      'corchetes). Por defecto pinta el título como <h1> —correcto en una pantalla suelta— y acá sería ' +
      'el segundo h1 del documento.',
  );
});

test('🔴 cada pantalla que monta dentro de la ficha declara su propio <h1>', () => {
  const { hojas } = hojasDeLaFicha();

  // El piso de sanidad: con cero hojas todo lo de abajo pasa sin haber mirado nada. Hoy son 4
  // (perfil, research, el brief y el informe) y la Tarea 4 suma más.
  assert.ok(
    hojas.length >= 4,
    `el barrido encontró ${hojas.length} hoja(s) bajo la ficha y hay al menos 4. ¿Se rompió el ` +
      'parseo de `app.routes.ts` o cambió la forma del `loadComponent`?',
  );

  for (const hoja of hojas) {
    assert.ok(
      cuenta(leer(hoja), 1) >= 1,
      `${hoja} monta dentro de la ficha y no declara ningún <h1>. Con la ficha convertida en ` +
        'contenedor, nadie más lo pone: la pantalla se queda sin encabezado principal y quien navega ' +
        'por encabezados no tiene dónde aterrizar.',
    );
  }
});

test('🔴 ningún encabezado precede al <h1> de la pantalla: el breadcrumb no es un <h2>', () => {
  /*
   * El primero de los tres defectos del árbol, y el más fácil de pasar por alto porque el conteo de
   * `h1` sale bien igual: el breadcrumb pintaba su título como `<h2>` y aparece ANTES del `<h1>` de la
   * hoja, así que el documento empezaba en el nivel 2 y bajaba al 1.
   *
   * El componente lo comparten seis pantallas y en cuatro de ellas es el ÚNICO encabezado que hay
   * (`clientes`, `usuarios`, `usuario-perfil`, `cliente-crear`): bajarlo a `<p>` las habría dejado sin
   * ninguno. Por eso sube a `<h1>` y el caso del shell se declara con `esEncabezado="false"`.
   */
  const fuente = leer('../shared/components/page-breadcrumb.ts');
  for (const nivel of [2, 3, 4, 5, 6]) {
    assert.equal(
      cuenta(fuente, nivel),
      0,
      `page-breadcrumb.ts emite un <h${nivel}>. Va antes del <h1> de la pantalla en todas las que lo ` +
        'usan, así que el documento arrancaría en un nivel más profundo que su propio título.',
    );
  }
  assert.equal(cuenta(fuente, 1), 1, 'el breadcrumb debe pintar su título como <h1> cuando es el encabezado');
});

/**
 * Los **contenedores** del portal: todo archivo que declara un `<router-outlet>`.
 *
 * La definición es estructural a propósito, y no una lista de nombres: contenedor es quien monta otra
 * pantalla dentro suyo, y eso lo dice el `<router-outlet>` y nada más. Así entran los tres de hoy
 * —`app.html`, `app-shell.ts` y `cliente-ficha.ts`— y entrará solo el que alguien escriba mañana.
 *
 * La primera versión de este barrido solo miraba la ficha, y eso dejaba **dos agujeros latentes** que
 * midió la re-revisión: un `<h1>` en `AppShellComponent` —que envuelve todas las pantallas menos
 * `/login` y el entregable— le habría dado dos `h1` a cada una de una vez, con el barrido en verde.
 * El defecto que este archivo existe para cerrar, un nivel más arriba.
 *
 * `sinComentarios` no es opcional acá: `app.routes.ts` y `page-breadcrumb.ts` nombran el
 * `router-outlet` en su prosa, y sin el barrido de comentarios entrarían como contenedores — el
 * segundo declara un `<h1>` legítimo y la regla lo tumbaría por escribir documentación.
 */
function contenedores(): string[] {
  return fuentes().filter((archivo) =>
    /<router-outlet\b/.test(sinComentarios(readFileSync(archivo, 'utf8'))),
  );
}

/**
 * ¿Este archivo usa el breadcrumb como CONTENEDOR (y no como encabezado de pantalla)?
 *
 * Se exige la forma **ligada** `[esEncabezado]="false"` y no `esEncabezado="false"`, y la diferencia
 * no es de estilo: sin corchetes, Angular pasa la **cadena** `"false"`, que es truthy — el breadcrumb
 * seguiría pintando su `<h1>` y el shell volvería a tener dos, con el atributo puesto y con pinta de
 * estar bien. Es el modo de fallo más caro de los dos, así que la forma sin corchetes se rechaza.
 */
function esShell(fuente: string): boolean {
  return /<app-page-breadcrumb[^>]*\[esEncabezado\]="false"/.test(fuente);
}

/** Todo `src/app` menos los tests — mismo recorrido y mismo motivo que `core/marca-activa.test.ts`. */
function fuentes(): string[] {
  const encontradas: string[] = [];
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|html)$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) encontradas.push(ruta);
    }
  };
  recorrer(raiz);
  return encontradas;
}

test('🔴 quien usa el breadcrumb COMO encabezado no declara además su propio <h1>', () => {
  /*
   * El segundo defecto del árbol: el nombre del cliente aparecía dos veces seguidas —como título del
   * breadcrumb y como título grande de la pantalla— con el mismo string y en dos niveles distintos.
   * Ahora que el breadcrumb pinta un `<h1>`, esa duplicación sería directamente dos `h1` iguales.
   *
   * La regla se barre sobre TODO el árbol y no sobre una lista: el breadcrumb lo comparten seis
   * pantallas hoy y la Tarea 4 toca la ficha otra vez.
   */
  const conBreadcrumb = fuentes().filter((archivo) =>
    /<app-page-breadcrumb\b/.test(sinComentarios(readFileSync(archivo, 'utf8'))),
  );
  assert.ok(
    conBreadcrumb.length >= 5,
    `solo ${conBreadcrumb.length} archivo(s) usan <app-page-breadcrumb> y son al menos 5. ¿El barrido ` +
      'dejó de encontrarlos, o el componente se retiró?',
  );

  for (const archivo of conBreadcrumb) {
    const fuente = sinComentarios(readFileSync(archivo, 'utf8'));
    // El shell declara el suyo con `[esEncabezado]="false"`: ahí el breadcrumb NO es el encabezado, y
    // el `h1` lo pone la hoja del outlet (que es otro archivo, así que éste sigue sin declararlo).
    if (esShell(fuente)) continue;
    assert.equal(
      cuenta(fuente, 1),
      0,
      `${archivo} usa <app-page-breadcrumb> como encabezado —que ya pinta un <h1>— y además declara ` +
        'el suyo: son dos h1 en el mismo documento, y en la ficha del cliente encima con el mismo ' +
        'texto. Dejá uno: el del breadcrumb, y el otro a <p> con las mismas clases.',
    );
  }
});

test('el criterio distingue una declaración de su prosa, y cuenta por nivel', () => {
  // Sin esto, los tres de arriba podrían estar exigiendo cualquier cosa —o nada— sin que se note. Es
  // el mismo complemento que `marca-activa.test.ts` le pone a su barrido.
  assert.equal(cuenta('<h1 class="x">a</h1><h1>b</h1>', 1), 2);
  assert.equal(cuenta('<h1>a</h1>', 2), 0, 'un h1 no cuenta como h2');
  assert.equal(cuenta('<h11 >a</h11>', 1), 0, 'el \\b evita que <h11> cuente como <h1>');
  assert.equal(cuenta('/** el <h1> de la pantalla */', 1), 0, 'la prosa de un docblock no declara nada');
  assert.equal(cuenta('<!-- ojo con el <h1> de acá -->', 1), 0, 'ni un comentario de plantilla');
  assert.equal(cuenta('// ver el <h1>', 1), 0, 'ni un comentario de línea');

  // La detección de contenedor mira una DECLARACIÓN, no una mención: `app.routes.ts` y
  // `page-breadcrumb.ts` nombran el router-outlet en su prosa, y contarlos como contenedores tumbaría
  // al segundo por su <h1> legítimo.
  const declara = (t: string): boolean => /<router-outlet\b/.test(sinComentarios(t));
  assert.equal(declara('<router-outlet />'), true);
  assert.equal(declara('<router-outlet></router-outlet>'), true);
  assert.equal(declara('/** monta en el <router-outlet> del shell */'), false, 'la prosa no declara');
  assert.equal(declara('<!-- ver el <router-outlet> de abajo -->'), false);
  assert.equal(declara('// el <router-outlet> lo pone la ficha'), false);
  assert.equal(declara('<router-outlets />'), false, 'el \\b evita emparejar otro nombre');

  // La marca de shell, y el rechazo que importa: sin corchetes se pasa la CADENA "false", que es
  // truthy, y el breadcrumb seguiría pintando su <h1> con el atributo puesto.
  assert.equal(esShell('<app-page-breadcrumb [titulo]="x" [esEncabezado]="false" />'), true);
  assert.equal(
    esShell('<app-page-breadcrumb [titulo]="x" esEncabezado="false" />'),
    false,
    'sin corchetes se pasa la cadena "false" (truthy): no puede contar como shell',
  );
  assert.equal(esShell('<app-page-breadcrumb [titulo]="x" />'), false, 'por defecto es encabezado');

  // Y el delimitador de objetos, que es de lo que depende encontrar las hojas.
  const codigo = `[{ path: 'a', children: [{ path: 'b' }] }, { path: 'clientes/:id', children: [{ x: 1 }] }]`;
  assert.equal(objetoDeRuta(codigo, "path: 'clientes/:id'"), `{ path: 'clientes/:id', children: [{ x: 1 }] }`);
  assert.equal(objetoDeRuta(codigo, "path: 'no-existe'"), null);
});

test('el barrido mira archivos de verdad: las rutas que resuelve existen', () => {
  // Una ruta mal armada haría que `readFileSync` tirara, pero con un mensaje de fs que no explica
  // nada. Acá se dice qué se esperaba encontrar.
  const { shell, hojas } = hojasDeLaFicha();
  for (const relativa of [shell, ...hojas]) {
    assert.doesNotThrow(
      () => leer(relativa),
      `el barrido resolvió \`${relativa}\` desde app.routes.ts y ese archivo no existe (raíz: ${raiz})`,
    );
  }
});
