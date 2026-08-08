import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tokensDeMarca } from "./css.js";
import {
  FAMILIAS,
  PESO_TITULARES,
  STACKS_SISTEMA,
  archivoTitulares,
  cssDeFuentes,
  manifiesto,
  rutaPublica,
  stackDe,
} from "./fuentes.js";

const DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

test("🔴 el hash de cada archivo es el del archivo — si no, la cache `immutable` sirve algo viejo para siempre", () => {
  // Los hashes están escritos en `fuentes.ts` para poder emitir el CSS sin tocar el disco. El precio
  // de esa decisión es que se pueden desincronizar del archivo, y la consecuencia no es cosmética:
  // el `cache-control: immutable` le dice al navegador que esa URL NUNCA cambia, así que un archivo
  // editado sin cambiar su hash queda servido desde la cache vieja hasta que el usuario limpie.
  // Este test es lo que hace que editar un `.woff2` obligue a actualizar su hash.
  for (const [rol, familia] of Object.entries(FAMILIAS)) {
    for (const a of familia.archivos) {
      const real = createHash("sha256").update(readFileSync(DIR + a.archivo)).digest("hex").slice(0, 8);
      assert.equal(a.hash, real, `${rol}/${a.archivo}: el hash de fuentes.ts no es el del archivo`);
    }
  }
});

test("🔴 toda familia self-hosted tiene su LICENCIA commiteada en el repo", () => {
  // Regla de la spec, literal: «una fuente sin su licencia en el repo no se sirve». Las cuatro son
  // SIL OFL 1.1, verificado familia por familia contra el repositorio de Google Fonts.
  const licencias = readdirSync(DIR + "licencias/");
  for (const [rol, familia] of Object.entries(FAMILIAS)) {
    // El nombre del archivo de licencia sale del nombre del `.woff2`, que es como se emparejan.
    const base = (familia.archivos[0]?.archivo ?? "").split("-")[0];
    const suya = licencias.find((l) => l.startsWith(`${base}-`));
    assert.ok(suya, `la familia "${rol}" (${familia.nombre}) no tiene licencia en assets/fonts/licencias/`);
    const texto = readFileSync(`${DIR}licencias/${suya}`, "utf8");
    assert.match(texto, /SIL Open Font License, Version 1\.1/i, `la licencia de ${rol} no es SIL OFL 1.1`);
  }
});

test("los archivos de fuente son woff2 de verdad, y no un HTML de error renombrado", () => {
  // Una descarga que falla suele devolver 200 con una página de error. Sin esto, el repo llevaría un
  // «.woff2» que es HTML y el fallo aparecería en el navegador de un cliente, no acá.
  for (const familia of Object.values(FAMILIAS)) {
    for (const a of familia.archivos) {
      const bytes = readFileSync(DIR + a.archivo);
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${a.archivo} no empieza por la firma wOF2`);
    }
  }
});

/**
 * ⚠️ **Los literales de esta tabla están escritos a mano y ESE es el punto.**
 *
 * Son los tres stacks que `css.ts` viene emitiendo en producción. Escribirlos acá —en vez de leerlos
 * de `STACKS_SISTEMA`, que sería comprobar que una constante es igual a sí misma— es lo que hace que
 * cambiarlos **duela**: cualquier ficha sembrada con `brand.font` se ve exactamente con esto.
 *
 * La versión anterior de este test solo comprobaba que los tres roles existieran en `STACKS_SISTEMA`
 * y no estuvieran en `FAMILIAS`. Con eso pasaba en verde mientras `fuentes.ts` decía
 * `moderna: "Inter,Segoe UI,Roboto,Helvetica Neue,sans-serif"` y `css.ts` emitía
 * `'Helvetica Neue',Arial,sans-serif`: dos fuentes de verdad divergentes para el mismo rol, y unificar
 * hacia la equivocada habría cambiado de tipografía todas las webs con `font: "moderna"`.
 */
const STACKS_DE_PRODUCCION: Array<[string, string]> = [
  ["sistema", "system-ui,-apple-system,Segoe UI,Roboto,sans-serif"],
  ["serif", "Georgia,'Times New Roman',serif"],
  ["moderna", "'Helvetica Neue',Arial,sans-serif"],
];

for (const [rol, stack] of STACKS_DE_PRODUCCION) {
  test(`🔴 legacy — «${rol}» emite EXACTAMENTE el stack que corre hoy en producción`, () => {
    // 1. Sigue siendo del sistema y no una familia self-hosted.
    assert.ok(STACKS_SISTEMA[rol], `el rol legacy "${rol}" desapareció de los stacks del sistema`);
    assert.equal(FAMILIAS[rol], undefined, `el rol legacy "${rol}" pasó a self-hosted: eso cambia webs vivas`);
    assert.equal(archivoTitulares(rol), null, `"${rol}" no tiene archivo que precargar: no se sirve nada`);

    // 2. Y el stack es el de siempre, byte a byte, tanto en la tabla como en lo que llega al `<style>`.
    assert.equal(stackDe(rol), stack, `stackDe("${rol}") no es el stack de producción`);
    assert.equal(
      tokensDeMarca({ font: rol as never }),
      `\n:root{--marca-fuente-texto:${stack}}`,
      `el campo legacy \`brand.font: "${rol}"\` cambió de tipografía`,
    );
    assert.equal(
      tokensDeMarca({ fuentes: { titulo: rol as never } }),
      `\n:root{--marca-fuente-titulo:${stack}}`,
      `el rol nuevo \`fuentes.titulo: "${rol}"\` no coincide con el legacy`,
    );
  });
}

/**
 * Los cuatro roles nuevos, con su familia self-hosted **resuelta hasta el token que se emite**.
 *
 * Hasta la mitad C, `css.ts` tenía su propia tabla donde estos cuatro caían a stacks del sistema: las
 * `woff2` se servían y el CSS no las pedía nunca. Que el literal esperado esté escrito acá es lo que
 * hace caer el test si alguien vuelve a desviar `condensada` a Arial Narrow.
 */
const STACKS_SELF_HOSTED: Array<[string, string]> = [
  ["condensada", "'Oswald',Arial Narrow,sans-serif"],
  ["geometrica", "'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif"],
  ["humanista", "'Source Sans 3',system-ui,-apple-system,Segoe UI,Roboto,sans-serif"],
  ["script", "'Dancing Script',Brush Script MT,cursive"],
];

for (const [rol, stack] of STACKS_SELF_HOSTED) {
  test(`🔴 self-hosted — «${rol}» llega al token con SU familia, no con un stack del sistema`, () => {
    assert.ok(FAMILIAS[rol], `"${rol}" dejó de tener familia propia`);
    assert.equal(stackDe(rol), stack, `stackDe("${rol}") no resuelve a su familia self-hosted`);
    assert.equal(
      tokensDeMarca({ fuentes: { titulo: rol as never } }),
      `\n:root{--marca-fuente-titulo:${stack}}`,
      `una ficha con \`fuentes.titulo: "${rol}"\` no ve su familia`,
    );
  });
}

test("🔴 `stackDe` no devuelve nada para un nombre heredado del prototipo", () => {
  // La misma trampa que `css.ts` cierra con `Object.hasOwn` (ver su comentario): `FAMILIAS["toString"]`
  // es `Object.prototype.toString`, o sea un valor TRUTHY, y con indexación directa `stackDe` devolvía
  // `'undefined',undefined` en vez de `null`. En PROD el perfil puede llegar de Storyblok sin pasar por
  // Zod, así que este nombre es alcanzable desde el Visual Editor.
  for (const hostil of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"]) {
    assert.equal(stackDe(hostil), null, `stackDe("${hostil}") devolvió algo: hay un agujero de prototipos`);
    assert.equal(archivoTitulares(hostil), null, `archivoTitulares("${hostil}") devolvió algo`);
    // El tercer punto que indexa `FAMILIAS`, y el que la revisión encontró sin test: con indexación
    // directa, `cssDeFuentes(["toString"])` metía el rol en el conjunto de "usadas" y devolvía un
    // `"\n"` en vez de `""`. Hoy el impacto es un byte —el bucle que emite recorre `Object.entries`,
    // así que no salía ninguna `@font-face` de más— y por eso la revisión no lo bloqueó.
    //
    // Se fija igual, y no por el byte: `cssDeFuentes` es un export público que declara recibir un
    // `Iterable<string>`, o sea texto de fuera. Que no acepte claves heredadas vivía sólo en un
    // comentario, y «una garantía en un comentario es una intención» es literalmente el modo de fallo
    // que más veces se ha repetido en este repo.
    assert.equal(cssDeFuentes([hostil]), "", `cssDeFuentes(["${hostil}"]) emitió algo`);
  }
});

test("🔴 el archivo que se precarga es el del peso que usan los titulares", () => {
  // Los titulares no declaran `font-weight` en ninguna pieza: heredan el `bold` de la hoja del
  // navegador, que es 700. Lo fija su propio test en `ensamblado.test.ts` sobre el CSS emitido.
  assert.equal(PESO_TITULARES, 700);
  assert.equal(archivoTitulares("condensada")?.peso, 700, "Oswald tiene 500 y 700: se precarga el 700");
  assert.equal(archivoTitulares("geometrica")?.peso, 700);
  assert.equal(archivoTitulares("humanista")?.peso, 700);
  // Dancing Script solo trae 600. Con una sola cara declarada el navegador la usa para todos los
  // pesos, así que precargar «la más cercana a 700» es precargar la única que va a pedir.
  assert.equal(archivoTitulares("script")?.peso, 600);

  // Y siempre es un archivo que el manifiesto sabe servir: si no, el preload da 404 en silencio.
  const publicas = new Set([...manifiesto().keys()].map((n) => `/_assets/fonts/${n}`));
  for (const rol of Object.keys(FAMILIAS)) {
    const a = archivoTitulares(rol);
    assert.ok(a, `"${rol}" no tiene archivo de titulares`);
    assert.ok(publicas.has(rutaPublica(a!)), `el preload de "${rol}" apunta fuera del manifiesto`);
  }
});

test("toda familia self-hosted declara un respaldo: una fuente que no carga nunca deja texto sin dibujar", () => {
  for (const [rol, familia] of Object.entries(FAMILIAS)) {
    assert.ok(familia.respaldo.length > 0, `"${rol}" no tiene respaldo`);
    assert.match(stackDe(rol) ?? "", /,/, `el stack de "${rol}" no lleva respaldo detrás de la familia`);
  }
});

test("cssDeFuentes emite SOLO las familias que la página usa", () => {
  // Mismo criterio que el CSS de las piezas: una página que no usa `script` no paga sus 25 KB.
  const soloCondensada = cssDeFuentes(["condensada"]);
  assert.match(soloCondensada, /font-family:'Oswald'/);
  assert.doesNotMatch(soloCondensada, /Dancing Script/);

  assert.equal(cssDeFuentes([]), "", "sin familias self-hosted no se emite ni un byte");
  assert.equal(cssDeFuentes(["sistema", "serif", "moderna"]), "", "los stacks del sistema no llevan @font-face");
});

test("cssDeFuentes es determinista: el orden de uso no cambia los bytes emitidos", () => {
  assert.equal(cssDeFuentes(["script", "condensada"]), cssDeFuentes(["condensada", "script"]));
});

test("cada @font-face lleva `font-display:swap` y su peso", () => {
  const css = cssDeFuentes(["condensada"]);
  assert.equal((css.match(/font-display:swap/g) ?? []).length, 2, "los dos pesos de Oswald");
  assert.match(css, /font-weight:500/);
  assert.match(css, /font-weight:700/);
});

test("🔴 el manifiesto y las URLs emitidas son el MISMO conjunto", () => {
  // Si divergen, el CSS pide una URL que el renderizador no sabe servir: la fuente da 404 y la web
  // cae al respaldo sin que nada falle en ningún test. Es un fallo silencioso entre dos paquetes.
  const enElCss = new Set(
    [...cssDeFuentes(Object.keys(FAMILIAS)).matchAll(/url\(\/_assets\/fonts\/([^)]+)\)/g)].map((m) => m[1]),
  );
  assert.deepEqual([...enElCss].sort(), [...manifiesto().keys()].sort());
});

test("el nombre público lleva el hash, que es lo que hace honesto el `immutable`", () => {
  const a = FAMILIAS["condensada"]?.archivos[0];
  assert.ok(a);
  assert.equal(rutaPublica(a), `/_assets/fonts/oswald-500.${a.hash}.woff2`);
});

test("no sobra ni falta ningún archivo en assets/fonts: lo que está es lo que se sirve", () => {
  // Un `.woff2` en el directorio que no esté en `FAMILIAS` no lo sirve nadie —es peso muerto en un
  // repo público— y uno en `FAMILIAS` que no esté en disco revienta al arrancar el renderizador.
  const enDisco = readdirSync(DIR).filter((f) => f.endsWith(".woff2")).sort();
  const declarados = Object.values(FAMILIAS).flatMap((f) => f.archivos.map((a) => a.archivo)).sort();
  assert.deepEqual(enDisco, declarados);
});
