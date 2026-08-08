import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemSitios } from "db";
import { FAMILIAS, manifiesto, rutaPublica } from "web-builder/fuentes";
import { createApp } from "./app.js";
import { MockCda } from "./cda.js";
import { CACHE_FUENTES, cargarFuentes } from "./fuentes-servidas.js";

/**
 * La **primera ruta pública del renderizador que sirve algo que no es HTML generado**, en el único
 * proceso expuesto a internet anónimo (ADR-19).
 *
 * La pregunta del proyecto —*si me lo toman, ¿qué se llevan?*— tiene que responderse "unos archivos
 * de fuente que ya son públicos". Estos tests son lo que hace que esa respuesta siga siendo cierta
 * cuando alguien reescriba el handler dentro de seis meses.
 */
const app = createApp({ sitios: new MemSitios([]), cda: new MockCda() });
const UNA = rutaPublica(FAMILIAS["condensada"]!.archivos[0]!);

describe("las fuentes self-hosted, servidas", () => {
  it("sirve un woff2 del manifiesto, con su firma de formato", async () => {
    const res = await app.request(`http://x.es${UNA}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", "no devolvió un woff2");
    assert.ok(bytes.byteLength > 5_000, "devolvió algo demasiado corto para ser una fuente");
  });

  it("🔴 `..` en la ruta da 404 — lo para el router, y el `Map` detrás", async () => {
    // El test que la spec pide por su nombre. Pero **medido, no supuesto**: reintroduje el
    // `readFileSync` en el handler (la mutación de «alguien simplifica y quita el Map») y este test
    // **siguió pasando**, porque quien para estas URLs primero es el ROUTER: `:nombre` no captura
    // `/`, así que la petición ni llega al handler. La afirmación anterior de este comentario —«lo
    // fuerte es que hay un Map»— era cierta como diseño y falsa como descripción de lo que este test
    // demuestra.
    //
    // Las dos capas existen y las dos hacen falta: el router filtra la forma de la URL, y el `Map`
    // filtra el contenido (test de abajo, que sí cae con esa mutación). Vale la pena tenerlo escrito
    // porque si algún día se cambia el patrón de ruta a `/_assets/fonts/*` —que sí captura `/`— la
    // primera capa desaparece sin ruido y solo queda la segunda.
    for (const ruta of [
      "/_assets/fonts/../../etc/passwd",
      "/_assets/fonts/..%2f..%2fetc%2fpasswd",
      "/_assets/fonts/....//....//etc/passwd",
      "/_assets/fonts/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/_assets/fonts/../../../web-builder/src/config.ts",
      "/_assets/fonts/.env",
    ]) {
      const res = await app.request(`http://x.es${ruta}`);
      assert.notEqual(res.status, 200, `${ruta} devolvió 200`);
      const cuerpo = await res.text();
      assert.doesNotMatch(cuerpo, /root:|PASSWORD|SECRET|BEGIN [A-Z ]*PRIVATE KEY/i, `${ruta} filtró contenido`);
    }
  });


  it("🔴 el `Map` es la segunda capa, y filtra por CONTENIDO: solo sirve lo que el manifiesto declara", async () => {
    // Ésta es la garantía que el test de arriba NO demuestra, y que sí cae con la mutación de volver
    // al filesystem: un nombre que el router SÍ entrega al handler (sin `/`, así que llega entero al
    // parámetro) pero que no está en el manifiesto. Con un `readFileSync` detrás, cualquier archivo
    // del directorio de fuentes saldría servido; con el `Map`, solo salen los siete declarados.
    for (const nombre of [
      "oswald-500.woff2", // existe en disco, NO en el manifiesto (le falta el hash)
      "licencias",
      "oswald-500.00000000.woff2", // el hash mal
      "..",
    ]) {
      const res = await app.request(`http://x.es/_assets/fonts/${nombre}`);
      assert.equal(res.status, 404, `sirvió "${nombre}", que no está en el manifiesto`);
    }
  });
  it("un nombre del manifiesto con el hash cambiado da 404: el hash es parte de la clave", async () => {
    // Si el hash no formara parte de la clave, el `immutable` sería una promesa vacía: dos versiones
    // del mismo archivo compartirían URL y la cache serviría la vieja para siempre.
    const res = await app.request(`http://x.es${UNA.replace(/\.[0-9a-f]{8}\.woff2$/, ".00000000.woff2")}`);
    assert.equal(res.status, 404);
  });

  it("🔴 la cabecera de cache es `immutable`, que solo es honesto porque el hash va en el nombre", async () => {
    const res = await app.request(`http://x.es${UNA}`);
    assert.equal(res.headers.get("cache-control"), CACHE_FUENTES);
    assert.match(CACHE_FUENTES, /immutable/);
    assert.match(CACHE_FUENTES, /max-age=31536000/);
  });

  it("lleva CORS abierto: el CSS que las pide viene de CUALQUIER dominio de cliente", async () => {
    // Sin esto el navegador descarta la fuente por origen cruzado y la web cae al respaldo — un fallo
    // que no da error en ningún log nuestro y que solo se ve mirando la tipografía.
    const res = await app.request(`http://x.es${UNA}`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });

  it("la ruta de fuentes gana al catch-all: un dominio desconocido no se la come", async () => {
    // El catch-all `/*` responde la web del cliente (o 404 de dominio). Si estuviera antes, la fuente
    // devolvería HTML con `content-type: font/woff2` y la web se vería sin tipografía.
    const res = await app.request(`http://dominio-que-no-existe.es${UNA}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
  });

  it("🔴 el cargador falla CERRADO: todo lo que el manifiesto declara está en disco", () => {
    // `cargarFuentes` lanza si falta un archivo. Que hoy no lance es la prueba de que el manifiesto y
    // el disco coinciden — y si alguien borra un `.woff2`, el renderizador no arranca en vez de
    // servir 404 en la web de un cliente.
    const cargadas = cargarFuentes();
    assert.deepEqual([...cargadas.keys()].sort(), [...manifiesto().keys()].sort());
    for (const [nombre, bytes] of cargadas) {
      assert.ok(bytes.byteLength > 5_000, `${nombre} se cargó vacío o truncado`);
    }
  });
});
