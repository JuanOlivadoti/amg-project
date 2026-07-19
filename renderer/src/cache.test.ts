import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CacheRender } from "./cache.js";

describe("CacheRender", () => {
  it("guarda y devuelve", () => {
    const c = new CacheRender();
    c.set("111", "menu", "<h1>Menú</h1>");
    assert.equal(c.get("111", "menu"), "<h1>Menú</h1>");
  });

  it("un slug que no está es null", () => {
    assert.equal(new CacheRender().get("111", "menu"), null);
  });

  it("🔴 el MISMO slug en spaces distintos NO colisiona", () => {
    // `/menu` es el slug de todos los restaurantes. Una cache por slug serviría el menú de un
    // cliente bajo el dominio de otro: la fuga que 0006 cerró del lado de la escritura.
    const c = new CacheRender();
    c.set("111", "menu", "<h1>Trattoria</h1>");
    c.set("222", "menu", "<h1>Sushi Zen</h1>");

    assert.equal(c.get("111", "menu"), "<h1>Trattoria</h1>");
    assert.equal(c.get("222", "menu"), "<h1>Sushi Zen</h1>");
  });

  it("expira por TTL", () => {
    let t = 1_000;
    const c = new CacheRender({ ttlMs: 100, ahora: () => t });

    c.set("111", "menu", "viejo");
    t += 99;
    assert.equal(c.get("111", "menu"), "viejo");
    t += 2;
    assert.equal(c.get("111", "menu"), null, "pasado el TTL tiene que caducar");
  });

  it("invalidarSpace borra todo el space y NO toca a los demás", () => {
    const c = new CacheRender();
    c.set("111", "menu", "a");
    c.set("111", "contacto", "b");
    c.set("222", "menu", "c");

    assert.equal(c.invalidarSpace("111"), 2);
    assert.equal(c.get("111", "menu"), null);
    assert.equal(c.get("111", "contacto"), null);
    assert.equal(c.get("222", "menu"), "c", "un webhook de un space no puede vaciar el de otro");
  });

  it("🔴 la clave no se puede falsificar desde el slug (10ª review, #1)", () => {
    // La clave era `${spaceId} ${slug}`, un separador que PUEDE aparecer en el slug. Con eso,
    // ("11", "1 menu") y ("11 1", "menu") producían la misma entrada: un cliente sirviendo la
    // página de otro. El slug lo controla quien pide, así que la mitad de la clave era del atacante.
    const c = new CacheRender();
    c.set("11", "1 menu", "cliente A");
    c.set("11 1", "menu", "cliente B");

    assert.equal(c.get("11", "1 menu"), "cliente A");
    assert.equal(c.get("11 1", "menu"), "cliente B", "dos claves distintas no pueden colapsar");
  });

  it("🔴 el tope POR DEFECTO existe: no es infinito (10ª review, falso-verde)", () => {
    // Codex subió el default de 500 a infinito y los ocho tests siguieron verdes: todos pasaban
    // `maxEntradas` explícito, así que ninguno fijaba el valor de producción. Este sí.
    const c = new CacheRender({ ahora: () => 0 });
    for (let i = 0; i < 600; i++) c.set("111", `slug-${i}`, "x".repeat(10));

    assert.ok(c.tamano <= 500, `el default tiene que acotar; quedaron ${c.tamano} entradas`);
  });

  it("🔴 hay tope de BYTES, no solo de entradas (10ª review, #2)", () => {
    // 500 entradas de 2 MB son 1 GB. Un tope por cantidad no acota la memoria si no se acota el
    // tamaño: lo que agota el proceso son los bytes, no las claves.
    const c = new CacheRender({ maxBytes: 10_000, ahora: () => 0 });
    for (let i = 0; i < 50; i++) c.set("111", `slug-${i}`, "x".repeat(1_000));

    assert.ok(c.bytes <= 10_000, `los bytes tienen que acotarse; hay ${c.bytes}`);
    assert.ok(c.tamano < 50, "y eso implica desalojar aunque sobren entradas");
  });

  it("🔴 una página más grande que el tope NO se guarda (y no vacía la cache)", () => {
    const c = new CacheRender({ maxBytes: 1_000, ahora: () => 0 });
    c.set("111", "chica", "x".repeat(100));
    c.set("111", "enorme", "x".repeat(5_000));

    assert.equal(c.get("111", "enorme"), null, "no entra");
    assert.equal(c.get("111", "chica"), "x".repeat(100), "y no se lleva puesto lo que ya estaba");
  });

  it("🔴 invalidarSpace no borra un space cuyo id EMPIEZA igual", () => {
    // Sin el separador en la clave, invalidar "11" se llevaría "111" por delante.
    const c = new CacheRender();
    c.set("111", "menu", "a");
    assert.equal(c.invalidarSpace("11"), 0);
    assert.equal(c.get("111", "menu"), "a");
  });

  it("🔴 respeta el tope de entradas: una cache sin tope es una fuga de memoria", () => {
    const c = new CacheRender({ maxEntradas: 3 });
    for (const slug of ["a", "b", "c", "d", "e"]) c.set("111", slug, slug);
    assert.equal(c.tamano, 3);
  });

  it("desaloja la MENOS usada, no la más vieja", () => {
    const c = new CacheRender({ maxEntradas: 3 });
    c.set("111", "a", "a");
    c.set("111", "b", "b");
    c.set("111", "c", "c");

    c.get("111", "a"); // `a` vuelve a estar fresca; `b` pasa a ser la candidata
    c.set("111", "d", "d");

    assert.equal(c.get("111", "a"), "a", "la portada se visita siempre: no puede caerse primero");
    assert.equal(c.get("111", "b"), null);
  });
});
