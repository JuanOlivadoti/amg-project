import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generarIdeasMock,
  generarPostsInstagramMock,
  generarResenasGoogleMock,
  promedioCalificacion,
  type EstadoIdea,
  type EstadoPost,
} from './cliente-vista-mock';

test('generarIdeasMock: es determinístico, dos llamadas dan exactamente lo mismo', () => {
  assert.deepEqual(generarIdeasMock(), generarIdeasMock());
});

test('generarIdeasMock: cubre los cuatro estados posibles, para probar los cuatro badges', () => {
  const ideas = generarIdeasMock();
  const estados = new Set(ideas.map((i) => i.estado));
  const esperados: EstadoIdea[] = ['nueva', 'en_revision', 'aprobada', 'rechazada'];
  for (const e of esperados) {
    assert.ok(estados.has(e), `falta una idea en estado "${e}"`);
  }
});

test('generarIdeasMock: cada idea trae título, resumen, fecha ISO y cantidad de canales positiva', () => {
  const ideas = generarIdeasMock();
  assert.ok(ideas.length >= 3, `esperaba al menos 3 ideas de ejemplo, obtuve ${ideas.length}`);
  for (const idea of ideas) {
    assert.ok(idea.titulo.length > 0, `idea ${idea.id} sin título`);
    assert.ok(idea.resumen.length > 0, `idea ${idea.id} sin resumen`);
    assert.ok(!Number.isNaN(Date.parse(idea.fecha)), `idea ${idea.id} tiene una fecha no-ISO: ${idea.fecha}`);
    assert.ok(idea.canales > 0, `idea ${idea.id} tiene ${idea.canales} canales, esperaba al menos 1`);
  }
});

test('generarIdeasMock: los ids son únicos', () => {
  const ideas = generarIdeasMock();
  const ids = new Set(ideas.map((i) => i.id));
  assert.equal(ids.size, ideas.length, 'hay ids de idea repetidos');
});

test('generarPostsInstagramMock: es determinístico', () => {
  assert.deepEqual(generarPostsInstagramMock(), generarPostsInstagramMock());
});

test('generarPostsInstagramMock: cubre los cuatro estados posibles', () => {
  const posts = generarPostsInstagramMock();
  const estados = new Set(posts.map((p) => p.estado));
  const esperados: EstadoPost[] = ['borrador', 'publicado', 'programado', 'archivado'];
  for (const e of esperados) {
    assert.ok(estados.has(e), `falta un post en estado "${e}"`);
  }
});

test('generarPostsInstagramMock: cada post trae mensaje, hashtags y fecha ISO', () => {
  const posts = generarPostsInstagramMock();
  assert.ok(posts.length >= 3, `esperaba al menos 3 posts de ejemplo, obtuve ${posts.length}`);
  for (const post of posts) {
    assert.ok(post.mensaje.length > 0, `post ${post.id} sin mensaje`);
    assert.ok(Array.isArray(post.hashtags), `post ${post.id} sin array de hashtags`);
    assert.ok(!Number.isNaN(Date.parse(post.creadoEn)), `post ${post.id} tiene una fecha no-ISO: ${post.creadoEn}`);
  }
});

test('generarPostsInstagramMock: los ids son únicos', () => {
  const posts = generarPostsInstagramMock();
  const ids = new Set(posts.map((p) => p.id));
  assert.equal(ids.size, posts.length, 'hay ids de post repetidos');
});

test('generarResenasGoogleMock: es determinístico', () => {
  assert.deepEqual(generarResenasGoogleMock(), generarResenasGoogleMock());
});

test('generarResenasGoogleMock: trae al menos una reseña sin respuesta, para probar el estado "pendiente"', () => {
  const resenas = generarResenasGoogleMock();
  assert.ok(
    resenas.some((r) => r.respuesta === null),
    'ninguna reseña de ejemplo queda sin respuesta',
  );
  assert.ok(
    resenas.some((r) => r.respuesta !== null),
    'ninguna reseña de ejemplo tiene respuesta',
  );
});

test('generarResenasGoogleMock: todas las calificaciones están entre 1 y 5', () => {
  const resenas = generarResenasGoogleMock();
  assert.ok(resenas.length > 0);
  for (const r of resenas) {
    assert.ok(r.calificacion >= 1 && r.calificacion <= 5, `calificación fuera de rango: ${r.calificacion}`);
  }
});

test('generarResenasGoogleMock: los ids son únicos', () => {
  const resenas = generarResenasGoogleMock();
  const ids = new Set(resenas.map((r) => r.id));
  assert.equal(ids.size, resenas.length, 'hay ids de reseña repetidos');
});

test('promedioCalificacion: 0 con la lista vacía (no hay nada que promediar, no es un error)', () => {
  assert.equal(promedioCalificacion([]), 0);
});

test('promedioCalificacion: promedia y redondea a un decimal', () => {
  const resenas = [
    { id: 'a', autor: 'A', calificacion: 5, texto: '', fecha: '2026-01-01T00:00:00.000Z', respuesta: null },
    { id: 'b', autor: 'B', calificacion: 4, texto: '', fecha: '2026-01-01T00:00:00.000Z', respuesta: null },
    { id: 'c', autor: 'C', calificacion: 5, texto: '', fecha: '2026-01-01T00:00:00.000Z', respuesta: null },
  ];
  // (5 + 4 + 5) / 3 = 4.666... -> redondeado a 4.7
  assert.equal(promedioCalificacion(resenas), 4.7);
});

test('promedioCalificacion: sobre el mock real da un número entre 1 y 5', () => {
  const promedio = promedioCalificacion(generarResenasGoogleMock());
  assert.ok(promedio >= 1 && promedio <= 5, `promedio fuera de rango: ${promedio}`);
});
