import type { CambiosIdea, IdeaDetalle, IdeaResumen } from "db";

/**
 * El BORDE HTTP de las ideas: qué puede venir en un body y qué forma tiene lo que sale por el cable.
 *
 * ## Lo que este archivo NO hace
 *
 * **No autoriza.** Ni una sola línea de acá mira quién pregunta. Quién ve una idea y quién puede
 * tocarla lo deciden `idea_select` e `idea_update` (migración 0013) dentro de Postgres (ADR-15). Lo
 * que hay acá son **allowlists de forma** —qué es un valor aceptable— y la serialización, que son las
 * dos cosas que sí es legítimo decidir en TypeScript.
 *
 * **No duplica los techos de tamaño.** `titulo` 200 B, `resumen` 2 KiB, `transcripcion` 64 KiB,
 * `analisis` 32 KiB y las URL 2 KiB son `check` de la tabla (0013) y llegan como `23514`, que el
 * `onError` de `app.ts` ya mapea a 400. Repetirlos acá sería una segunda copia de un número que se
 * desincroniza sin que nada avise.
 *
 * Lo que sí queda para acá es exactamente lo que la base **no mira**: que las URL sean http(s) y qué
 * claves admite `analisis`.
 */

/**
 * Las ocho claves que produce el flujo de audio. Allowlist **positiva**: `tenant_id`, `contacto` o
 * `precio_interno` no están, así que no hace falta ignorarlos explícitamente.
 *
 * Por qué una clave desconocida es un **error** y no un descarte silencioso (al revés que
 * `filtrarCamposCliente`, que ignora lo que no conoce): ahí se descartan campos que no son del
 * recurso; acá el llamador manda el objeto `analisis` COMPLETO y quedarse con parte de él le haría
 * creer a la pantalla que guardó algo que no guardó. Un `analisis` es un reemplazo total, no un
 * merge: `editarIdea` escribe `analisis = $n::jsonb`.
 */
export const CLAVES_ANALISIS: ReadonlySet<string> = new Set([
  "audiencia_objetivo",
  "canales_comunicacion",
  "intencion",
  "materiales_formatos",
  "observaciones",
  "checklist_interpretacion",
  "ideas_complementarias",
  "tipo_accion",
]);

/** Un resultado con motivo, para que el handler conteste 400 con algo que se pueda leer. */
export type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string };

/**
 * ¿Es una URL **http(s)**? La base solo mira el TAMAÑO de `audio_url`/`carpeta_url` (0013), así que
 * ésta es la única capa que mira el ESQUEMA — y hace falta: el portal pinta esas URL en un `<a href>`
 * y en un `<audio src>`, donde `javascript:` es XSS y `data:text/html` es una página entera bajo el
 * origen de quien la abra. Allowlist de dos esquemas, no lista de prohibidos.
 */
export function esUrlHttp(v: string): boolean {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === "http:" || u.protocol === "https:";
}

/**
 * Allowlist de la edición de contenido, en el borde HTTP. `PgIdeas.editarIdea` ya tiene la suya
 * (`COLUMNAS_EDITABLES`) y el `grant update` de la 0013 es **por columna**, así que ésta es la
 * tercera red — pero es la única que puede explicar POR QUÉ algo se rechaza, y por eso devuelve
 * motivo en vez de recortar en silencio.
 *
 * `estado` NO está acá a propósito: mover una idea por la máquina de estados es `cambiarEstado`, que
 * valida la transición. Ver `PATCH /ideas/:id` en `app.ts`.
 */
export function validarCambiosIdea(body: Record<string, unknown>): Validacion<CambiosIdea> {
  const cambios: CambiosIdea = {};

  /*
   * Una clave CONOCIDA con un tipo inaceptable es un **error**, no un descarte.
   *
   * Antes se ignoraba, y el resultado era `{"ok":true}` con el campo sin guardar (medido con curl:
   * `PATCH {"titulo":12345,"resumen":"esto sí entra"}` → 200, y el título intacto). Es el mismo
   * argumento que la cabecera de este archivo usa para `analisis`, y que las URL ya aplicaban:
   * quedarse con parte de lo que mandaron le hace creer a la pantalla que guardó algo que no guardó.
   *
   * Las claves DESCONOCIDAS sí se siguen ignorando, y no es una contradicción: `tenant_id` o `rol` en
   * el body no son una petición mal escrita, son campos que este endpoint no acepta — la allowlist
   * positiva ni los mira. Lo que se rechaza es pedir algo que el endpoint SÍ hace, con un valor que
   * no puede guardar.
   */
  if (body["titulo"] !== undefined) {
    // Sin `| null`: `titulo` es `not null` en la tabla, así que `null` no significa "borrar" — sería
    // un 23502 desde Postgres, y es más claro decirlo acá.
    if (typeof body["titulo"] !== "string") return { ok: false, error: "titulo debe ser un string." };
    cambios.titulo = body["titulo"];
  }

  for (const campo of ["resumen", "transcripcion", "mensaje_de"] as const) {
    const v = body[campo];
    if (v === undefined) continue;
    if (typeof v !== "string" && v !== null) {
      return { ok: false, error: `${campo} debe ser un string o null.` };
    }
    cambios[campo] = v;
  }

  for (const campo of ["audio_url", "carpeta_url"] as const) {
    const v = body[campo];
    if (v === undefined) continue;
    if (v === null) {
      cambios[campo] = null; // borrar la URL es legítimo
      continue;
    }
    // Esta línea es REDUNDANTE para el código HTTP y está medido (mutación M15): sin ella, un `42`
    // llega a `esUrlHttp`, `new URL(42)` lanza, y el rechazo sale igual como 400. Lo que aporta es el
    // MENSAJE correcto — "debe ser un string" y no "debe ser una URL http(s)", que mandaría a
    // arreglar el esquema de algo que ni siquiera es texto. Defensa en profundidad declarada, no
    // garantía: ningún test cae si se quita.
    if (typeof v !== "string") return { ok: false, error: `${campo} debe ser un string o null.` };
    if (!esUrlHttp(v)) return { ok: false, error: `${campo} debe ser una URL http(s).` };
    cambios[campo] = v;
  }

  if (body["analisis"] !== undefined) {
    const a = body["analisis"];
    if (!esObjetoPlano(a)) return { ok: false, error: "analisis debe ser un objeto." };
    const ajenas = Object.keys(a).filter((k) => !CLAVES_ANALISIS.has(k));
    if (ajenas.length > 0) {
      return { ok: false, error: `analisis tiene claves no admitidas: ${ajenas.join(", ")}.` };
    }
    cambios.analisis = a;
  }

  return { ok: true, valor: cambios };
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- lo que sale por el cable

/**
 * Lo que el portal recibe. Es el tipo de `db` con las marcas de tiempo como **string ISO-8601 UTC**,
 * porque un `Date` no existe en JSON.
 *
 * Que estos dos tipos existan es el contrato con `portal/src/app/core/`, que **no** corre en
 * `npm test`: si alguien cambia un nombre de campo acá, el portal se rompe y ningún test del
 * monorepo lo ve.
 */
export type IdeaResumenHttp = Omit<IdeaResumen, "creada_en"> & { creada_en: string };
export type IdeaDetalleHttp = Omit<IdeaDetalle, "creada_en" | "actualizada_en"> & {
  creada_en: string;
  actualizada_en: string;
};

/**
 * `timestamptz` → string ISO-8601 UTC, siempre.
 *
 * Hoy es redundante y conviene decirlo: tanto PGlite como `pg` entregan `timestamptz` ya parseado
 * como `Date`, y `JSON.stringify(new Date())` ya escribe ISO. Existe porque **la frontera es donde
 * revienta**: `ClienteCRM.created_at` tipa `string` una columna que en runtime es `Date`, y un driver
 * configurado para no parsear fechas devolvería `'2026-08-09 12:34:56.789+00'` —espacio en vez de
 * `T`— que el portal parsearía según el motor de JS que le toque. Normalizar acá cuesta tres líneas y
 * hace que la respuesta no dependa de cómo esté configurado el driver.
 */
function aIsoUtc(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * El resumen, con `spread` a propósito: **no re-enumera los campos**. El recorte (cinco campos, sin
 * transcripción ni análisis) ya lo hace el `select` de `listarIdeas` — lo que no sale de Postgres no
 * se puede olvidar de filtrar después. Enumerar acá crearía un segundo sitio donde el contrato puede
 * quedar desalineado, y en la dirección peligrosa: agregar un campo al select y que aparezca solo.
 *
 * Lo que impide ampliar el resumen sin querer no es una línea de código, es un test: el que compara
 * el conjunto EXACTO de claves de cada ítem en `api/src/ideas.test.ts` («GET /ideas NO devuelve
 * transcripción ni análisis»). Está nombrado acá a propósito — una garantía cuyo enforcement no está
 * nombrado es la que alguien "simplifica" después. Enumerar los campos acá sería una allowlist
 * positiva, que falla en la dirección SILENCIOSA: un campo legítimo olvidado desaparecería sin error.
 */
export function serializarResumen(i: IdeaResumen): IdeaResumenHttp {
  return { ...i, creada_en: aIsoUtc(i.creada_en) };
}

export function serializarDetalle(i: IdeaDetalle): IdeaDetalleHttp {
  return { ...i, creada_en: aIsoUtc(i.creada_en), actualizada_en: aIsoUtc(i.actualizada_en) };
}
