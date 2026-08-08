import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { CASOS } from "./casos.js";
import { DIR_FIXTURES, huellaDe } from "./comparar.js";

/**
 * **El gate de la entrega 2**: reorganizar el render no puede cambiar el sitio.
 *
 * Las fixtures se capturaron del render de ANTES y están commiteadas (ver `capturar.ts`, que explica
 * por qué no se regeneran). Este test las lee de disco y las compara contra lo que el render emite
 * hoy, cara por cara.
 *
 * Cuando este test falle durante el refactor, la pregunta correcta no es "cómo lo pongo en verde"
 * sino "¿por qué cambió el texto/el enlace/el ancla/el JSON-LD?". Regenerar las fixtures es la
 * respuesta equivocada salvo que el cambio visual sea deliberado y esté explicado en el commit.
 */

for (const caso of CASOS) {
  test(`paridad — ${caso.nombre}`, async (t) => {
    let esperadoHtml: string;
    try {
      esperadoHtml = await readFile(new URL(`${caso.nombre}.html`, DIR_FIXTURES), "utf8");
    } catch {
      // Falla cerrado: una fixture que falta NO puede saltarse el caso en silencio, que es como un
      // gate de paridad se vuelve decorativo — bastaría borrar el archivo para "arreglar" un fallo.
      assert.fail(
        `Falta la fixture de "${caso.nombre}". Si el caso es nuevo, capturala ANTES de tocar el ` +
          `render (npm run capturar:paridad -w web-builder) y commiteala. Si la borraste para que ` +
          `este test pasara, eso es justo lo que el gate existe para impedir.`,
      );
    }

    const esperado = huellaDe(esperadoHtml);
    const actual = huellaDe(caso.render());
    t.diagnostic(caso.porQue);

    // El JSON-LD primero y byte a byte: no tiene ningún motivo para cambiar en un refactor de
    // presentación, y es el contrato con Google. Si cambia, es lo más caro de este diff.
    assert.deepEqual(actual.jsonLd, esperado.jsonLd, `el JSON-LD de "${caso.nombre}" cambió`);
    // La traza de research, también byte a byte y por el mismo motivo que el JSON-LD: es un bloque
    // machine-readable que un refactor de presentación no tiene por qué tocar.
    //
    // ⚠️ `huellaDe` ya la calculaba y **esta comparación faltaba**, así que la quinta cara del gate
    // se computaba y se tiraba. Lo encontró una mutación: quitar `evidencia` de `researchTrace()`
    // dejaba los 207 tests en verde. Una cara de la huella que nadie compara es peor que no tenerla,
    // porque el nombre promete una garantía que no existe.
    assert.deepEqual(
      actual.researchTrace,
      esperado.researchTrace,
      `la traza de research de "${caso.nombre}" cambió`,
    );
    assert.deepEqual(actual.hrefs, esperado.hrefs, `los enlaces de "${caso.nombre}" cambiaron (o su orden)`);
    assert.deepEqual(actual.ids, esperado.ids, `los id de ancla de "${caso.nombre}" cambiaron (o su orden)`);
    assert.equal(actual.texto, esperado.texto, `el texto visible de "${caso.nombre}" cambió`);
  });
}

test("el gate cubre los cuatro puntos de entrada del render y las tres formas de ficha", () => {
  // Sin esto, alguien podría dejar el gate en verde borrando casos en vez de arreglando el render.
  const nombres = CASOS.map((c) => c.nombre);
  assert.ok(nombres.some((n) => n.startsWith("landing-")), "falta el caso de landing (renderStory)");
  assert.ok(nombres.some((n) => n.startsWith("home-")), "falta el caso de home (renderHome)");
  assert.ok(nombres.some((n) => n.startsWith("menu-")), "falta el caso de menú (renderMenu)");
  assert.ok(nombres.some((n) => n.startsWith("blog-")), "falta el caso de blog (renderBlogIndex)");
  assert.ok(nombres.includes("landing-sin-perfil"), "falta el dominio sin ficha");
  assert.ok(nombres.includes("landing-perfil-legacy"), "falta la ficha legacy {color, font}");
  assert.ok(nombres.includes("landing-perfil-con-manual"), "falta la ficha con manual de marca");
  assert.ok(CASOS.length >= 10, `el gate se quedó en ${CASOS.length} casos: ¿se borró alguno?`);
});
