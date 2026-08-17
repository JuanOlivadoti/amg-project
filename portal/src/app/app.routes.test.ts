// `@angular/router` (importado transitivamente por `./app.routes` vía `authGuard`) ejecuta, al
// cargar el módulo, un `ɵɵngDeclareFactory` de `PlatformLocation` que exige el compiler JIT. Bajo
// `ng test`/Karma el Angular Linker lo resuelve; bajo `node --import tsx` no hay linker, así que
// sin este import el test entero revienta el proceso de node ANTES de correr un solo assert.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from './app.routes';
import { authGuard } from './guards/auth-guard';

/**
 * El fuente **sin comentarios**, para poder buscar código y no prosa.
 *
 * No es una precaución teórica: la primera versión del test de `paramsInheritanceStrategy` buscaba
 * esa frase en el archivo entero, y la frase también está en el comentario que explica la decisión.
 * Medido — se le quitó `withRouterConfig(...)` al `provideRouter` dejando el comentario intacto y el
 * test siguió en verde: **el comentario que explicaba la garantía era lo que hacía pasar al test que
 * debía imponerla**. Es el mismo fallo, y la misma cura, que `parsearTokens` en `core/contraste.ts`,
 * que también borra los comentarios antes de buscar su selector.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Lo que hay entre los paréntesis de `funcion(...)`, contando los anidados.
 *
 * Contar paréntesis en vez de escribirlos en un regex es lo que hace que la comprobación no dependa
 * del formateo: los saltos de línea, la sangría y —sobre todo— **la coma final que pone Prettier**
 * dejan de importar, porque nunca se empareja la puntuación, solo se delimita el argumento.
 */
function argumentosDe(codigo: string, funcion: string): string | null {
  const i = codigo.indexOf(`${funcion}(`);
  if (i < 0) return null;
  const abre = i + funcion.length;
  let nivel = 0;
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === '(') nivel++;
    else if (codigo[j] === ')') {
      nivel--;
      if (nivel === 0) return codigo.slice(abre + 1, j);
    }
  }
  return null; // paréntesis sin cerrar: no es código válido, no opinamos
}

/**
 * `null` si el fuente conserva la garantía; si no, el motivo exacto por el que se perdió.
 *
 * Son **tres comprobaciones que se sostienen solas** —hay una llamada a `provideRouter`; entre sus
 * argumentos hay un `withRouterConfig(...)`; y dentro de ÉSE está el parámetro— en vez de un único
 * match que ate además la puntuación intermedia. Cada una puede fallar por su cuenta y decir cuál
 * falló, que es lo que hace accionable el rojo.
 *
 * Que el `withRouterConfig` se busque **dentro de los argumentos de `provideRouter`** y no en el
 * archivo entero es lo que impide el caso `const cfg = withRouterConfig({…})` sin pasárselo a nadie.
 */
function porQueNoHeredaParams(fuente: string): string | null {
  const codigo = sinComentarios(fuente);
  const args = argumentosDe(codigo, 'provideRouter');
  if (args === null) return 'app.config.ts no llama a `provideRouter(...)`';
  const config = argumentosDe(args, 'withRouterConfig');
  if (config === null) {
    return "`provideRouter(...)` no recibe un `withRouterConfig(...)`: sin él las rutas hijas de path no vacío no ven el `:id` del padre";
  }
  if (!/paramsInheritanceStrategy:\s*'always'/.test(config)) {
    return "el `withRouterConfig(...)` de `provideRouter` no lleva `paramsInheritanceStrategy: 'always'`";
  }
  return null;
}

/**
 * A dónde manda `LoginPage` después de autenticar, leído del FUENTE.
 *
 * Se lee el fuente por el mismo motivo que `paramsInheritanceStrategy`: el destino es un literal
 * dentro de un método `async`, y comprobarlo montando el componente fija el comportamiento pero no
 * lo ata a la configuración de rutas — que es justo lo que se desincronizó. `null` si no hay un
 * `this.router.navigate(['…'])` con un destino literal, y entonces el test falla en vez de callarse.
 */
function destinoPostLogin(fuente: string): string | null {
  const args = argumentosDe(sinComentarios(fuente), 'this.router.navigate');
  if (args === null) return null;
  return /^\s*\[\s*'([^']*)'\s*\]\s*,?\s*$/.exec(args)?.[1] ?? null;
}

test('🔴 el login aterriza en la HOME declarada, no en una ruta que recoge el comodín', () => {
  /*
   * El defecto que esto fija: el commit que retiró la lista global de runs cambió los DOS
   * `redirectTo` y dejó el tercer sitio que decide dónde abre el portal —`login.ts`— navegando a
   * `/runs`. No se rompía nada porque el comodín `**` lo recogía y lo mandaba a `/clientes`: el
   * destino correcto, por accidente del catch-all y no por decisión. Un rediseño de la navegación
   * (la tarea 3 toca rutas) podía moverlo sin que cayera un solo test.
   *
   * Por eso no se compara contra la cadena `'/clientes'` escrita acá: se compara contra el
   * `redirectTo` de la home REAL. Cambiar la home y olvidarse del login vuelve a poner esto rojo.
   */
  const destino = destinoPostLogin(
    readFileSync(new URL('./pages/login/login.ts', import.meta.url), 'utf8'),
  );
  assert.ok(
    destino,
    'no encontré en `login.ts` un `this.router.navigate([\'…\'])` con un destino literal: si el ' +
      'destino pasó a calcularse, extendé este test antes de dejarlo sin cubrir',
  );

  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = shell?.children ?? [];
  const home = hijos.find((r) => r.path === '')?.redirectTo;
  assert.ok(typeof home === 'string' && home, 'no encontré el redirect de la home del shell');

  assert.equal(
    destino,
    `/${home}`,
    `el login manda a \`${destino}\` y la home del portal es \`/${home}\`: son dos decisiones sobre ` +
      'el mismo aterrizaje y tienen que decir lo mismo',
  );

  // Y que ese destino sea una ruta DECLARADA. Sin esto, login y home podrían coincidir los dos en una
  // ruta retirada y el comodín seguiría tapándolo — que es exactamente como se veía el defecto.
  assert.ok(
    hijos.some((r) => r.path === home),
    `\`${home}\` no está declarada como hija del shell: el login caería en el comodín \`**\``,
  );
});

test('login es una ruta hermana, sin hijas — no vive dentro del shell', () => {
  const login = routes.find((r) => r.path === 'login');
  assert.ok(login, 'no encontré la ruta login');
  assert.equal(login?.children, undefined, '/login no debería tener rutas hijas de un shell');
});

test('las tres pantallas de un run cuelgan del cliente; la lista global de runs ya no existe', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  assert.ok(shell, 'no encontré la ruta padre del shell (path vacío con children)');
  assert.deepEqual(shell?.canActivate, [authGuard], 'el shell debe estar protegido por authGuard');
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(!hijos.includes('runs'), 'la lista global de runs se retiró');
  assert.ok(!hijos.includes('runs/:id'), 'el brief se mudó bajo el cliente');
  assert.ok(!hijos.includes('runs/:id/informe'), 'el informe se mudó bajo el cliente');
  assert.ok(hijos.includes('cartera'), 'cartera debe ser hija del shell');

  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.includes('research/:runId'), 'el brief debe colgar del tab research');
  assert.ok(tabs.includes('research/:runId/informe'), 'el informe debe colgar del brief');
});

test('el informe hereda el authGuard del shell y carga la pantalla del informe', async () => {
  // El informe lleva el desglose de lo que la agencia le paga a DataForSEO. Que la ruta cuelgue del
  // shell no es lo que lo protege —eso lo hace la política `informe_staff` (0016) dentro de
  // Postgres— pero una ruta fuera del shell quedaría sin authGuard.
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const informe = (ficha?.children ?? []).find((r) => r.path === 'research/:runId/informe');
  assert.ok(informe, 'no encontré la ruta del informe');
  assert.equal(informe?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');

  // Y que el `loadComponent` resuelva de verdad: un import mal escrito no rompe el build (es una función
  // perezosa), se rompe al navegar. Acá se paga el import una vez y se sabe.
  const cargado = await informe?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'InformePage');
});

test('el brief cuelga del tab research y carga BriefPage', async () => {
  // Mismo motivo que el del informe: el `loadComponent` es perezoso y un import mal escrito se rompe
  // al navegar, no al compilar. La pantalla del brief es la puerta a las otras dos.
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const brief = (ficha?.children ?? []).find((r) => r.path === 'research/:runId');
  assert.ok(brief, 'no encontré la ruta del brief');
  assert.equal(brief?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');

  const cargado = await brief?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'BriefPage');
});

test('el entregable vive en la RAÍZ con la URL del cliente, y lleva su propio authGuard', () => {
  // Fuera del shell para poder imprimirse (sin sidebar `fixed`, sin `lg:pl-64`), pero con la URL
  // anidada para que el enlace sea coherente con el resto. Las dos cosas a la vez, a propósito.
  const i = routes.findIndex((r) => r.path === 'clientes/:id/research/:runId/entregable');
  const iShell = routes.findIndex((r) => r.path === '' && r.children);
  assert.ok(i >= 0, 'no encontré la ruta del entregable en la raíz');
  assert.ok(i < iShell, 'el entregable debe declararse ANTES de la ruta del shell');
  assert.deepEqual(routes[i]?.canActivate, [authGuard], 'fuera del shell no hereda: necesita el suyo');
});

test('ninguna ruta hija ni nieta repite su propio authGuard — lo hereda del padre', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  for (const hijo of shell?.children ?? []) {
    assert.equal(hijo.canActivate, undefined, `${hijo.path} no debería tener su propio canActivate`);
    for (const nieto of hijo.children ?? []) {
      assert.equal(
        nieto.canActivate,
        undefined,
        `${hijo.path}/${nieto.path} no debería tener su propio canActivate`,
      );
    }
  }
});

test('clientes/nuevo se declara ANTES que clientes/:id — si no, :id se traga la palabra "nuevo"', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  const iNuevo = hijos.indexOf('clientes/nuevo');
  const iFicha = hijos.indexOf('clientes/:id');
  assert.ok(iNuevo >= 0, 'no encontré clientes/nuevo');
  assert.ok(iFicha >= 0, 'no encontré clientes/:id');
  assert.ok(iNuevo < iFicha, 'clientes/nuevo debe declararse antes que clientes/:id');
});

test('clientes/:id es un shell con tabs: carga la ficha y redirige a perfil por defecto', async () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  assert.ok(ficha, 'clientes/:id debe ser hija del shell');
  assert.ok(ficha?.children, 'clientes/:id debe tener rutas hijas (los tabs)');

  const cargado = await ficha?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'ClienteFichaComponent');

  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.includes('perfil'), 'el tab perfil debe existir');
  assert.ok(tabs.includes('research'), 'el tab research debe existir');

  // Y que el `loadComponent` del tab nuevo resuelva de verdad. Un import mal escrito no rompe el
  // build (es una función perezosa) y acá el fallo sería mudo: sin ruta `research`, el link del tab
  // cae en el comodín y el portal manda a `/clientes` como si nada.
  const research = (ficha?.children ?? []).find((r) => r.path === 'research');
  const componenteResearch = await research?.loadComponent?.();
  assert.equal((componenteResearch as { name?: string })?.name, 'ClienteResearchPage');

  const porDefecto = (ficha?.children ?? []).find((r) => r.path === '');
  assert.equal(porDefecto?.redirectTo, 'perfil');
  assert.equal(porDefecto?.pathMatch, 'full');
});

test('«Mi Portal» (clientes/:id/ver) se retiró: sus secciones son tabs de la ficha', () => {
  /*
   * Sus tres tabs eran datos inventados para una audiencia que no existe (no hay login de cliente).
   * Reseñas e Ideas viven ahora como tabs de la ficha, con un placeholder que dice qué falta.
   *
   * El `deepEqual` fija el ORDEN a propósito: en un array de rutas el orden es semántica, no estilo
   * —`clientes/nuevo` antes que `clientes/:id` tiene su propio test por eso mismo— y el `''` con
   * `redirectTo` tiene que quedar al final. Un `includes` por tab dejaría eso sin cubrir.
   */
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(!hijos.includes('clientes/:id/ver'), 'clientes/:id/ver no debe existir');

  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.deepEqual(tabs, [
    'perfil',
    'research',
    'research/:runId',
    'research/:runId/informe',
    'resenas',
    'ideas',
    'ideas/:ideaId',
    'menu',
    'menu/:index',
    '',
  ]);
});

test('los tabs resenas e ideas cargan sus pantallas de verdad', async () => {
  // Mismo motivo que el del brief y el del informe: el `loadComponent` es perezoso, así que un import
  // mal escrito no rompe el build — se rompe al navegar, y el síntoma sería mudo (el link del tab
  // caería en el comodín `**` y el portal mandaría a `/clientes` como si nada).
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');

  const resenas = (ficha?.children ?? []).find((r) => r.path === 'resenas');
  assert.equal(resenas?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');
  assert.equal(((await resenas?.loadComponent?.()) as { name?: string })?.name, 'ClienteResenasPage');

  const ideas = (ficha?.children ?? []).find((r) => r.path === 'ideas');
  assert.equal(ideas?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');
  assert.equal(((await ideas?.loadComponent?.()) as { name?: string })?.name, 'ClienteIdeasPage');
});

test('el detalle de una idea (ideas/:ideaId) cuelga del cliente, hereda el authGuard y carga ClienteIdeaDetallePage', async () => {
  // Mismo motivo que el resto: el `loadComponent` es perezoso, así que un import mal escrito no
  // rompe el build — se rompe al navegar, y el síntoma sería mudo (el enlace del listado de ideas
  // caería en el comodín `**` y el portal mandaría a `/clientes` como si nada).
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const detalle = (ficha?.children ?? []).find((r) => r.path === 'ideas/:ideaId');
  assert.ok(detalle, 'no encontré la ruta del detalle de una idea');
  assert.equal(detalle?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');
  const cargado = await detalle?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'ClienteIdeaDetallePage');

  // Y que vaya DESPUÉS de `ideas`, mismo criterio que `research/:runId/informe` después de
  // `research/:runId` (comentario en `app.routes.ts`).
  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.indexOf('ideas') < tabs.indexOf('ideas/:ideaId'), 'ideas/:ideaId debe ir después de ideas');
});

test('el router hereda los params del padre: sin esto, /clientes/:id/research no ve el :id', () => {
  /*
   * Se lee el FUENTE y no se inspecciona el provider porque `provideRouter(routes, withRouterConfig(...))`
   * devuelve un `EnvironmentProviders` opaco: su configuración no se puede leer sin arrancar el
   * router. Es el mismo patrón que usa `core/sin-html-crudo.test.ts` para barrer plantillas.
   *
   * Lo que se protege es una garantía SILENCIOSA: con el default `'emptyOnly'`, `params.get('id')`
   * en un tab devuelve `null` y la pantalla se queda vacía sin un solo error en consola.
   */
  const fallo = porQueNoHeredaParams(readFileSync(new URL('./app.config.ts', import.meta.url), 'utf8'));
  assert.equal(fallo, null, fallo ?? '');
});

/**
 * Las siete formas de escribir la MISMA garantía. Las siete tienen que pasar.
 *
 * El primer intento de este test era un solo regex que ataba también la puntuación
 * (`…\}\s*\)\s*\)`), y eso exigía que `withRouterConfig(...)` fuera el último argumento y que no
 * hubiera nada entre su `)` y el de `provideRouter`. Medido: **la coma final lo rompía**, y Prettier 3
 * la pone cuando parte una llamada (`portal/package.json` no fija `trailingComma`, cuyo default es
 * `"all"`). De estas siete escrituras, cinco fallaban — todas con la garantía intacta.
 *
 * Importa por lo que pasa después de un rojo falso: el mensaje habría dicho «`app.config.ts` debe
 * pasarle `withRouterConfig(...)` a `provideRouter`» mientras el archivo hace exactamente eso, y la
 * salida más corta para quien lo sufriera es aflojar el regex hasta que vuelva a emparejar la mención
 * suelta — que es el defecto original, de vuelta. Un test que se rompe al reformatear se termina
 * relajando hasta que deja de morder.
 */
const ESCRITURAS_VALIDAS: readonly (readonly [string, string])[] = [
  ['la de hoy, en una línea', `provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),`],
  [
    'Prettier parte los argumentos',
    `provideRouter(
      routes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),`,
  ],
  [
    'Prettier parte también el objeto',
    `provideRouter(
      routes,
      withRouterConfig({
        paramsInheritanceStrategy: 'always',
      }),
    ),`,
  ],
  [
    'otra feature del router después',
    `provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' }), withComponentInputBinding()),`,
  ],
  [
    'otra feature, con Prettier partiendo',
    `provideRouter(
      routes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withComponentInputBinding(),
    ),`,
  ],
  [
    'el objeto lleva otra opción antes',
    `provideRouter(routes, withRouterConfig({ onSameUrlNavigation: 'reload', paramsInheritanceStrategy: 'always' })),`,
  ],
  [
    'un comentario de línea dentro de la llamada partida',
    `provideRouter(
      routes,
      // los tabs necesitan el :id del padre
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),`,
  ],
];

test('🔴 la garantía se reconoce escrita de las 7 formas válidas: reformatear no puede ponerlo rojo', () => {
  for (const [nombre, codigo] of ESCRITURAS_VALIDAS) {
    assert.equal(
      porQueNoHeredaParams(codigo),
      null,
      `«${nombre}» conserva la garantía y el test la rechazó: ${porQueNoHeredaParams(codigo)}`,
    );
  }
});

test('🔴 …y sigue cazando las cuatro formas de perderla', () => {
  // El complemento obligatorio del test de arriba: aflojar hasta que las 7 pasen es fácil si de paso
  // se deja pasar todo. Cada una de éstas borra la garantía de una manera distinta.
  const invalidas: readonly (readonly [string, string])[] = [
    ['sin withRouterConfig (la mutación A)', `provideRouter(routes),`],
    ['withRouterConfig vacío', `provideRouter(routes, withRouterConfig({})),`],
    ["con el default explícito", `provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })),`],
    [
      'withRouterConfig existe pero NO se lo pasa a provideRouter',
      `const cfg = withRouterConfig({ paramsInheritanceStrategy: 'always' });\nprovideRouter(routes),`,
    ],
  ];
  for (const [nombre, codigo] of invalidas) {
    assert.notEqual(porQueNoHeredaParams(codigo), null, `«${nombre}» perdió la garantía y el test la dejó pasar`);
  }
});

test('🔴 el barrido de app.config.ts descarta los comentarios: si no, la prosa hace pasar al test', () => {
  // La trampa de verdad, en miniatura: el comentario que EXPLICA la garantía contiene la frase que el
  // test buscaba, así que alcanzaba para pasar aunque el provider ya no la tuviera.
  const trampa = `/*
     * \`paramsInheritanceStrategy: 'always'\` NO es cosmético: […]
     */
    provideRouter(routes),`;
  assert.doesNotMatch(
    sinComentarios(trampa),
    /paramsInheritanceStrategy/,
    'la mención en el comentario sobrevivió al barrido: el test volvería a emparejar prosa',
  );

  // Y el barrido no se puede llevar por delante el código: si borrara de más, el test fallaría
  // siempre y alguien lo aflojaría hasta dejarlo inútil otra vez.
  const bueno = `// una nota suelta
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),`;
  assert.match(sinComentarios(bueno), /withRouterConfig\(\{ paramsInheritanceStrategy: 'always' \}\)/);
});

test('usuarios y usuarios/:id son hijas del shell, y la home abre en inicio', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(hijos.includes('usuarios'), 'usuarios debe ser hija del shell (y del authGuard)');
  assert.ok(hijos.includes('usuarios/:id'), 'usuarios/:id debe ser hija del shell');
  assert.ok(hijos.includes('inicio'), 'inicio debe ser hija del shell (y del authGuard)');

  // El default de la demo: si esto cambiara, el portal abriría en otra pantalla y la demo empezaría
  // en un lugar que nadie ensayó.
  // El default pasó de `clientes` a `inicio` el 2026-08-13, decisión de Juan al cerrar la Pieza 4
  // (Dashboard) — la pregunta quedó abierta a propósito en el informe de cierre, y esta es la
  // respuesta. `clientes` sigue siendo por donde empieza el recorrido de un cliente puntual, solo
  // que ya no es lo primero que se ve al entrar.
  const raiz = (shell?.children ?? []).find((r) => r.path === '');
  assert.equal(raiz?.redirectTo, 'inicio');
  assert.equal(raiz?.pathMatch, 'full');
});

test('el comodín `**` también cae en clientes: /runs ya no resuelve a ninguna pantalla', () => {
  // Va con el redirect de la home, y no dentro de él, porque son dos defaults distintos: uno decide
  // dónde abre el portal, el otro dónde termina una URL que no existe. Dejar el `**` apuntando a
  // `runs` mandaría a una ruta retirada, y el router encadenaría wildcard → runs → wildcard.
  const comodin = routes.find((r) => r.path === '**');
  assert.ok(comodin, 'no encontré la ruta comodín');
  assert.equal(comodin?.redirectTo, 'clientes');
});
