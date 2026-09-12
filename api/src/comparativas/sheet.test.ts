import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BYTES_ENTRADA } from "./filas.js";
import { bajarSheet, urlDeExport } from "./sheet.js";

const LINK = "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0";

test("de un link normal de Sheet saca la URL de export CSV", () => {
  const u = urlDeExport("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0");
  assert.match(u!, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/ABC123\/export\?format=csv/);
});

test("🔴 un host que NO es docs.google.com se rechaza: esto no es un fetch de propósito general", () => {
  assert.equal(urlDeExport("https://evil.example/spreadsheets/d/ABC/edit"), null);
});

test("🔴 http:// se rechaza aunque el host sea el bueno", () => {
  assert.equal(urlDeExport("http://docs.google.com/spreadsheets/d/ABC/edit"), null);
});

test("un link que no tiene forma de Sheet (sin /spreadsheets/d/<id>) se rechaza", () => {
  assert.equal(urlDeExport("https://docs.google.com/document/d/ABC123/edit"), null);
});

test("un link que ni siquiera es una URL se rechaza sin lanzar", () => {
  assert.equal(urlDeExport("no-es-una-url"), null);
});

test("🔴 un 403 pide compartir el link, y NO distingue de 'no existe'", async () => {
  const r = await bajarSheet(LINK, { fetch: async () => new Response("", { status: 403 }) });
  assert.equal(r.ok, false);
  // Desde afuera no se puede distinguir "no existe" de "no compartido": el mensaje cubre los dos,
  // porque mandar al usuario a buscar el error equivocado es peor que no decir nada.
  assert.match((r as { motivo: string }).motivo, /compartid/i);
  assert.match((r as { motivo: string }).motivo, /no exist/i);
});

test("un link con host o esquema inválido nunca sale a la red: bajarSheet no llama a fetch", async () => {
  let llamado = false;
  const r = await bajarSheet("https://evil.example/spreadsheets/d/ABC/edit", {
    fetch: async () => {
      llamado = true;
      return new Response("", { status: 200 });
    },
  });
  assert.equal(r.ok, false);
  assert.equal(llamado, false);
});

test("una descarga exitosa devuelve el CSV tal cual", async () => {
  const csv = "correduria,precio\nA,100\n";
  const r = await bajarSheet(LINK, {
    fetch: async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } }),
  });
  assert.deepEqual(r, { ok: true, csv });
});

test("un 404 del origen se reporta con el status, no como 403", async () => {
  const r = await bajarSheet(LINK, { fetch: async () => new Response("", { status: 404 }) });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /404/);
});

test("🔴 el tope de bytes corta por lo DECLARADO (content-length) sin leer el cuerpo", async () => {
  const r = await bajarSheet(LINK, {
    fetch: async () =>
      new Response(
        // `pull` explota si alguna vez se intenta leer: si el corte por lo declarado no cortara
        // ANTES de tocar el stream, este test fallaría con el error de `pull`, no con el motivo
        // esperado del tope — la prueba de que no se pagó la lectura.
        new ReadableStream<Uint8Array>({
          pull() {
            throw new Error("no debería haberse leído el cuerpo: el content-length ya lo descartaba");
          },
        }),
        { status: 200, headers: { "content-length": String(MAX_BYTES_ENTRADA + 1) } },
      ),
  });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, new RegExp(`${MAX_BYTES_ENTRADA + 1}`));
});

test("🔴 el tope de bytes corta por lo REAL cuando no se declaró (o se mintió para abajo)", async () => {
  // No declara content-length, y va soltando más bytes de los que dice el tope: lo corta la
  // lectura acotada del stream, no el content-length (que acá ni está).
  const trozo = 8 * 1024; // 8 KiB
  const trozos = Math.ceil((MAX_BYTES_ENTRADA + trozo) / trozo);
  const r = await bajarSheet(LINK, {
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < trozos; i++) c.enqueue(new Uint8Array(trozo));
            c.close();
          },
        }),
        { status: 200 },
      ),
  });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /supera el tope/);
});

test("🔴 una redirección a un host que NO es docs.google.com no se sigue", async () => {
  let destinoFinalPedido = false;
  const r = await bajarSheet(LINK, {
    fetch: async (u) => {
      if (u === LINK || u.toString().startsWith("https://docs.google.com/spreadsheets/d/ABC123/export")) {
        return new Response(null, { status: 302, headers: { location: "https://evil.tld/robado.csv" } });
      }
      destinoFinalPedido = true;
      return new Response("no debería llegar acá", { status: 200 });
    },
  });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /evil\.tld/);
  assert.equal(destinoFinalPedido, false, "no se llegó a pedir el destino de la redirección");
});

test("una redirección que se queda dentro de docs.google.com sí se sigue", async () => {
  const csv = "x,y\n1,2\n";
  let saltos = 0;
  const r = await bajarSheet(LINK, {
    fetch: async () => {
      saltos++;
      if (saltos === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&id=1" },
        });
      }
      return new Response(csv, { status: 200 });
    },
  });
  assert.deepEqual(r, { ok: true, csv });
  assert.equal(saltos, 2);
});

test("🔴 un signal abortado no basta: el plazo corta aunque el origen no responda nunca", async () => {
  const r = await bajarSheet(LINK, {
    plazoMs: 20,
    fetch: () =>
      new Promise<Response>(() => {
        // nunca resuelve: simula un origen que abre la conexión y no manda nada más. Si el plazo
        // dependiera solo de la señal (y no del `Promise.race`), este test colgaría para siempre.
      }),
  });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /no completó/);
});
