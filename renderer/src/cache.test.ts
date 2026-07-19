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
