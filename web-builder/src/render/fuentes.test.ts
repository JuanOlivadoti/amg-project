import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FAMILIAS, STACKS_SISTEMA, cssDeFuentes, manifiesto, rutaPublica, stackDe } from "./fuentes.js";

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

test("los tres roles LEGACY siguen siendo stacks del sistema: ninguna web sembrada cambia de fuente", () => {
  // `sistema`, `serif` y `moderna` son los tres valores del campo viejo `brand.font`, y TODAS las
  // fichas sembradas usan uno. Darles una familia self-hosted les cambiaría el aspecto de golpe —
  // la única regresión que el manual de marca puede causar, y la que la spec prohíbe.
  for (const rol of ["sistema", "serif", "moderna"]) {
    assert.ok(STACKS_SISTEMA[rol], `el rol legacy "${rol}" desapareció de los stacks del sistema`);
    assert.equal(FAMILIAS[rol], undefined, `el rol legacy "${rol}" pasó a self-hosted: eso cambia webs vivas`);
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
