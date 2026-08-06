/**
 * El `filename` del `Content-Disposition` de la descarga del informe.
 *
 * ALLOWLIST, no denylist: el valor sale del nombre del cliente, que lo escribe un humano en el CRM, y
 * termina dentro de un header HTTP. Un `\r\n` ahí parte la respuesta; un `"` cierra el header antes de
 * tiempo. Una denylist protege de lo que se le ocurrió a quien la escribió; una allowlist deja pasar
 * exactamente lo que se decidió.
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
