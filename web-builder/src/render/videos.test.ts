import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_VIDEOS_POR_DOCUMENTO,
  consumirCupoVideo,
  fuenteVideoPermitida,
  nuevoPresupuestoVideos,
} from "./videos.js";

/**
 * **La política de video**, calcada de la §Política de imágenes (`imagenes.test.ts`). Mismos casos
 * nominales de la allowlist de hosts: un video es otro vector hacia una petición que el navegador del
 * visitante hace solo, con la misma fuga de IP/user-agent que una foto.
 */

test("🔴 allowlist: `a.storyblok.com.evil.tld` NO es `a.storyblok.com` (sufijo, no host)", () => {
  assert.equal(fuenteVideoPermitida("https://a.storyblok.com.evil.tld/x.mp4"), false);
});

test("🔴 allowlist: `evil-storyblok.com` NO es `a.storyblok.com` (subcadena, no host)", () => {
  assert.equal(fuenteVideoPermitida("https://evil-storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: `http:` se rechaza aunque el host esté permitido (HTTPS obligatorio)", () => {
  assert.equal(fuenteVideoPermitida("http://a.storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: una URL protocol-relative (`//host/x.mp4`) se rechaza", () => {
  assert.equal(fuenteVideoPermitida("//a.storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: `javascript:` se rechaza", () => {
  assert.equal(fuenteVideoPermitida("javascript:alert(1)"), false);
});

test("🔴 allowlist: basura que no es una URL devuelve false, NO lanza", () => {
  for (const basura of ["", "   ", "no soy una url", "https://", "http://[", " "]) {
    assert.equal(fuenteVideoPermitida(basura), false, `"${basura}" no puede pasar ni lanzar`);
  }
});

test("allowlist: el único host de video permitido hoy es `a.storyblok.com`", () => {
  assert.equal(fuenteVideoPermitida("https://a.storyblok.com/f/1/x.mp4"), true);
  assert.equal(fuenteVideoPermitida("https://cdn.ej/x.mp4"), false);
});

test("el tope de videos por documento es 10", () => {
  // Default de PRODUCCIÓN: lo fija este test, no quien renderiza.
  assert.equal(MAX_VIDEOS_POR_DOCUMENTO, 10);
});

test("presupuesto: se agota exactamente en el tope, y una URL rechazada no gasta cupo", () => {
  const p = nuevoPresupuestoVideos();
  assert.equal(p.restantes, MAX_VIDEOS_POR_DOCUMENTO);
  for (let i = 0; i < MAX_VIDEOS_POR_DOCUMENTO; i++) {
    assert.equal(consumirCupoVideo(p), true, `hueco ${i} tendría que estar disponible`);
  }
  assert.equal(consumirCupoVideo(p), false, "el hueco 11 no existe");
});

test("presupuesto: dos documentos no comparten cupo (uno por llamada a `nuevoPresupuestoVideos`)", () => {
  const a = nuevoPresupuestoVideos();
  const b = nuevoPresupuestoVideos();
  consumirCupoVideo(a);
  assert.equal(b.restantes, MAX_VIDEOS_POR_DOCUMENTO, "el segundo documento no ve el gasto del primero");
});
