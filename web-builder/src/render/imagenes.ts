/**
 * **La §Política de imágenes** de la spec de plantillas de landing, en un solo archivo.
 *
 * Las fotos son un vector hacia `<img src>` en el **único proceso expuesto a internet anónimo**
 * (ADR-19). Escapar el valor y exigir http(s) evita la **inyección**, pero no la **fuga**: un `<img>`
 * es una petición que el navegador del visitante hace sola, y el host que la recibe se lleva su IP, su
 * user-agent y —salvo que se lo impidamos— la URL de la página que estaba mirando. Multiplicado por
 * cada visita a la web de cada cliente, eso es un registro de tráfico completo en manos de quien
 * controle el host de una foto.
 *
 * La pregunta que gobierna el diseño es la del proyecto: *si me lo toman, ¿qué se llevan?*. Si a
 * alguien le toman la ficha de un cliente, lo que NO puede llevarse es la capacidad de apuntar los
 * navegadores de los visitantes a un host suyo. De ahí las tres decisiones de este archivo:
 *
 *  1. La allowlist vive **en el código**, nunca en la ficha: una ficha comprometida se ampliaría sola.
 *  2. La comparación de host es **exacta** contra un `Set`, nunca `endsWith`/`includes`.
 *  3. El presupuesto se crea **por documento**, nunca a nivel de módulo. Ver `PresupuestoImagenes`.
 */

/**
 * Los hosts de assets permitidos. **Comparación exacta**, contra el `hostname` que devuelve `new URL`
 * (que ya viene normalizado a minúsculas por el parser — ver la nota en `fuentePermitida`).
 *
 * Hoy solo `a.storyblok.com`: es el que sirve el space real. Ampliar esta lista es un cambio de
 * código revisado, que es exactamente el punto — es lo que la distingue de un campo de la ficha.
 *
 * ⚠️ **Nada de `endsWith` ni `includes`.** `a.storyblok.com.evil.tld` termina en un dominio que un
 * `endsWith("storyblok.com")` aceptaría, y `evil-storyblok.com` contiene la cadena que un `includes`
 * aceptaría. Los dos son hosts de otra persona. La comparación es de igualdad contra el `Set` y sus
 * tests son nominales, caso por caso, en `imagenes.test.ts`.
 */
export const HOSTS_DE_ASSETS: ReadonlySet<string> = new Set(["a.storyblok.com"]);

/**
 * **Tope global de imágenes por documento** (spec, §Política de imágenes, punto 5).
 *
 * No alcanza con topar cada campo por separado: `fotos` (30), `menu` (200), `locations` (20) y
 * `menu_categorias` (20) pueden aportar cientos de `<img>` a la misma página. El tope que protege al
 * visitante es el del **documento**, porque lo que se paga son peticiones del navegador, no campos.
 *
 * Es un default de PRODUCCIÓN: lo fija un test, no lo elige quien renderiza.
 */
export const MAX_IMAGENES_POR_DOCUMENTO = 60;

/**
 * El presupuesto de imágenes de **UN** documento.
 *
 * ⚠️ **Es mutable y se crea uno por documento, en `renderDocumento`.** Si fuera una constante de
 * módulo —o un contador de módulo— el renderizador serviría la primera web con fotos y **todas las
 * siguientes sin ellas**: es un proceso largo que atiende a todos los clientes, no un CLI que
 * renderiza una vez y muere. Y no se notaría en los tests, porque casi todo test renderiza una sola
 * vez; por eso hay dos que renderizan dos veces.
 *
 * Viaja en `CtxPieza` y `Documento.ctx` lo excluye del tipo a propósito: quien arma un documento **no
 * puede** pasar un presupuesto compartido aunque quiera. La garantía es del tipo, no de la disciplina.
 */
export interface PresupuestoImagenes {
  restantes: number;
}

export function nuevoPresupuestoImagenes(): PresupuestoImagenes {
  return { restantes: MAX_IMAGENES_POR_DOCUMENTO };
}

/**
 * Reserva un hueco del presupuesto. `false` = no queda, y entonces no se emite la imagen.
 *
 * **Se llama solo cuando la imagen se va a emitir de verdad.** Una URL rechazada por la allowlist no
 * gasta cupo: si gastara, una ficha comprometida con 60 URLs prohibidas apagaría las fotos legítimas
 * de la página sin que ninguna suya llegara a servirse — convertiría la defensa en el ataque.
 */
export function consumirCupo(p: PresupuestoImagenes): boolean {
  if (p.restantes <= 0) return false;
  p.restantes--;
  return true;
}

/**
 * ¿Puede esta `src` llegar a un `<img src>` que se sirve a internet anónimo?
 *
 * Exige **https** (punto 1: además de la fuga, `http:` se bloquea como contenido mixto) y que el
 * **hostname** esté en la allowlist (puntos 2 y 3).
 *
 * ⚠️ **`new URL()` lanza con basura, y un `throw` desde el render tumba la web entera de un cliente
 * por una foto mal puesta.** Se envuelve y el caso raro se descarta, que es la conducta que ya tiene
 * el resto del render: una imagen rota es peor que ninguna.
 *
 * Se usa `hostname` y no el string crudo porque `https://a.storyblok.com@evil.com/x.jpg` **va a
 * evil.com**: lo que parece el host es el userinfo. Solo el parser lo resuelve bien.
 */
export function fuentePermitida(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  // `//host/x.jpg` (protocol-relative) no es una URL absoluta, así que `new URL` ya lanzó y lo cazó el
  // `catch` de arriba. Es el único motivo por el que ese caso no necesita una rama propia.
  if (url.protocol !== "https:") return false;
  // `new URL` **ya** devuelve el `hostname` en minúsculas (lo manda el parser de WHATWG), así que este
  // `.toLowerCase()` no es la defensa: es un cinturón sobre un tirante que ya aguanta. Se deja porque
  // la comparación contra un `Set` tiene que ser evidentemente insensible a mayúsculas al leerla, pero
  // se dice acá que quitarlo NO abriría un agujero — lo midió una revisión mutándolo, y no cayó ni un
  // test, que es exactamente lo que tiene que pasar con código inerte.
  return HOSTS_DE_ASSETS.has(url.hostname.toLowerCase());
}

/**
 * La imagen que se **publica** en el `<head>`: `og:image` y el `image` del JSON-LD.
 *
 * **Exige https, y NO aplica la allowlist de hosts. La asimetría es deliberada** y es la parte
 * interesante de esta función, así que va explicada entera.
 *
 * Un `og:image` no es un `<img>`: **no lo carga el navegador del visitante**, lo pide el crawler de la
 * red social cuando alguien comparte el enlace. El motivo #1 de la §Política de imágenes —la fuga de
 * IP, user-agent y patrón de tráfico *de cada visita*— sencillamente no ocurre acá. Lo que sí aplica es
 * el punto 1 de la spec, "HTTPS obligatorio", que no está acotado a `<img>`: sin esto, un `og:image`
 * con `http:` o con `javascript:` viaja en el HTML de la única superficie anónima.
 *
 * Y la allowlist se queda fuera porque **rompía el caso normal**: la imagen social de un negocio suele
 * vivir en su propio sitio (la fixture del proyecto trae
 * `https://trattoriabellanapoli.es/img/fachada.jpg`, que es el dominio del cliente). Exigir
 * `a.storyblok.com` ahí no cierra ningún vector real —el visitante no la descarga— y a cambio le quita
 * la tarjeta social a todo cliente que no haya subido su foto a nuestro space. Lo cazó el **gate de
 * paridad**: la primera versión de esta función sí aplicaba la allowlist, y cinco fixturas cayeron
 * porque el `image` desaparecía del JSON-LD.
 *
 * Que el `image` del JSON-LD sea una de las cinco caras del gate y `og:image` no, es también la razón
 * por la que este cambio se vio: un atributo `<meta>` solo no lo habría delatado.
 *
 * Lo encontró una revisión buscando un tercer camino de la ficha al HTML, después de que la premisa
 * "solo hay un emisor" y luego "solo hay dos" resultaran falsas las dos veces.
 *
 * Falla suave, como el resto: sin imagen válida no se emite la etiqueta — exactamente lo que ya pasaba
 * cuando el perfil no traía `image`.
 */
export function imagenPublicable(src: unknown): string | null {
  if (typeof src !== "string") return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  return url.protocol === "https:" ? src : null;
}
