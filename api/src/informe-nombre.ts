/**
 * El `filename` del `Content-Disposition` de la descarga del informe.
 *
 * ALLOWLIST, no denylist: el valor sale del nombre del cliente, que lo escribe un humano en el CRM, y
 * termina dentro de un header HTTP. Una denylist protege de lo que se le ocurrió a quien la escribió;
 * una allowlist deja pasar exactamente lo que se decidió.
 *
 * **Qué para de verdad esta allowlist en este stack, medido el 2026-08-06 con node v24.18.1:**
 *
 *  · La **comilla doble PASA** las dos capas que hay debajo: el `Headers.set()` de undici (por donde van
 *    los tests) y el `res.setHeader()` de node:http (por donde sale producción, vía `@hono/node-server`)
 *    la aceptan tal cual. Y un `"` dentro del `filename` cierra el valor antes de tiempo —
 *    `filename="Bar "El Bueno".md"`. Eso lo para SOLO esta función: nadie más lo mira.
 *  · El **`\r\n` lo RECHAZA el runtime antes que nosotros**: undici lanza `TypeError` (que el `onError`
 *    de la app traduce a 500) y node:http lanza `ERR_INVALID_CHAR`. O sea que la defensa contra el
 *    partido de respuesta la da el runtime, **no** esta allowlist; que acá también caiga es defensa en
 *    profundidad, no la única red.
 *
 * Va medido y con fecha porque la versión anterior de este comentario decía que un `\r\n` "parte la
 * respuesta": cierto de HTTP en general, y engañoso sobre lo que este stack hace con él.
 *
 * Los números son explícitos a propósito: un default sin número no es un default.
 */
const PERMITIDOS = /[^A-Za-z0-9._-]/g;
const LARGO_MAXIMO = 60;

export function nombreArchivo(nombreCliente: string | null | undefined): string {
  const base = (nombreCliente ?? "")
    .replace(PERMITIDOS, "-") // todo lo que no está en la allowlist, incluidos control y multibyte
    .replace(/-{2,}/g, "-") // "Bar   El Bueno" no se convierte en un tren de guiones
    .replace(/^[-.]+|[-.]+$/g, "") // ni empieza ni termina en separador; `..` queda vacío y cae al fallback
    .slice(0, LARGO_MAXIMO)
    .replace(/[-.]+$/g, ""); // el corte de arriba pudo dejar un separador colgando

  // Si tras sanear no queda ningún carácter de la allowlist, NO se devuelve "informe-.md": el nombre del
  // cliente puede ser entero no-ASCII, y ese es el caso que se olvida.
  return base ? `informe-${base}.md` : "informe.md";
}
