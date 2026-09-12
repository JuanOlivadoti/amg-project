import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SitioResolver } from "db";
import type { NavItem } from "web-builder";
import { HOSTS_DE_ASSETS, fuentePermitida, imagenPublicable } from "web-builder/imagenes";
import type { Cda, FetchLike } from "./cda.js";
import { normalizarHost } from "./dominio.js";
import { cargarFuentes } from "./fuentes-servidas.js";
import { SLUG_HOME, renderPagina, slugsDelSitio } from "./pagina.js";

/**
 * **El snapshot estático de salida** (ADR-11): lo que se lleva un cliente que se da de baja.
 *
 * ## Qué promete el contrato, y por qué esto existe
 *
 * ADR-11 (versión vigente, 2026-09-11) vende como salida por defecto incluida un snapshot
 * «hosteable en cualquier lado, **sin dependencia de AMG OS ni de Storyblok**», con la web «online
 * pero congelada». Hasta este archivo esa línea describía una **intención**: el HTML se podía sacar
 * de `renderStory()`, pero nadie lo había hecho nunca ni había comprobado que el resultado abriera
 * en un navegador desconectado. Un entregable que nadie generó no es un entregable.
 *
 * ## Las tres decisiones que lo gobiernan
 *
 * **1. Renderiza con el MISMO código que sirve el sitio vivo.** La decisión de qué HTML le toca a
 * cada slug vive en `pagina.ts` y la comparten el handler de `app.ts` y esto. Una segunda
 * implementación de "cuándo hay `/menu`" se desincroniza en la primera regla nueva, y el síntoma
 * sería que el snapshot se ve distinto de la web que el cliente estuvo pagando. La cláusula dice
 * «tu web», no «una versión de tu web».
 *
 * **2. La estructura de salida se eligió para NO reescribir enlaces.** `<dir>/<slug>/index.html`
 * preserva las URLs tal cual, así que la nav que hornea el render sigue funcionando sin tocarla.
 * Reescribir `href`s sería inventar un segundo formato de URL que solo existe en el snapshot — y
 * cada enlace reescrito es una oportunidad de romper uno.
 *
 * **3. Las imágenes se DESCARGAN** (decisión del usuario, 2026-09-11). Un snapshot que siguiera
 * apuntando a `a.storyblok.com` seguiría dependiendo de nuestro space: el día que la agencia borre
 * el asset, la web del ex-cliente se rompe sola — y hasta entonces, cada visita suya nos pinga.
 * Eso es exactamente la dependencia que ADR-11 promete que no existe.
 *
 * ## Seguridad: esto hace peticiones de red con datos que vienen de la base
 *
 * Es código nuevo que sale a internet con URLs de `clients.business_profile_publico` y de las
 * stories. Las defensas son las que ya existen para el render, **reusadas, no reescritas**
 * (`web-builder/src/render/imagenes.ts`): allowlist de hosts exacta sobre `new URL(...).hostname`
 * contra un `Set` —nunca `includes`/`endsWith`—, `https:` obligatorio, y además, porque acá sí se
 * *hace* la petición (el render solo emitía el string): tope de bytes por archivo, plazo por
 * descarga, y revalidación del host **en cada salto de redirección**.
 *
 * ⚠️ **La asimetría de `imagenPublicable` se hereda, y acá cambia de significado.** Esa función
 * exige https pero NO la allowlist de hosts, a propósito: `og:image` y el `image` del JSON-LD los
 * pide el crawler de una red social, no el navegador del visitante, así que la fuga que la allowlist
 * evita no ocurre — y exigirla le quitaba la tarjeta social a todo cliente con su foto en su propio
 * dominio. Pero el snapshot **sí descarga** esa URL, y descargar de un host arbitrario es una
 * capacidad que el render nunca tuvo. Por eso acá la clase `social` conserva la asimetría (cualquier
 * host https, que es el caso normal: el dominio del propio cliente) pero suma `hostAlcanzable`, que
 * corta loopback, IPs literales y dominios internos. Ver esa función.
 */

/** Tope por archivo descargado. Una foto de restaurante pesa cientos de KB; 10 MB es holgado. */
export const MAX_BYTES_ACTIVO = 10 * 1024 * 1024;

/** Plazo por descarga. Cubre la respuesta COMPLETA, cuerpo incluido (ver `conPlazo` en `cda.ts`). */
export const PLAZO_DESCARGA_MS = 15_000;

/** Saltos de redirección que se siguen, **revalidando el host en cada uno**. */
export const MAX_REDIRECCIONES = 3;

/** Dónde van las copias locales. `_assets/fonts` lo fija `rutaPublica()`, no esta constante. */
export const DIR_IMG = "_assets/img";
export const DIR_FUENTES = "_assets/fonts";

/** El informe de lo que NO entró. Solo existe cuando hubo fallos — ver `generarSnapshot`. */
export const ARCHIVO_INFORME = "_snapshot-informe.txt";

/** Un `<img src>`/`<video src|poster>` (allowlist estricta) vs. `og:image`/JSON-LD `image`. */
export type ClaseActivo = "contenido" | "social";

export interface ActivoReferenciado {
  url: string;
  clase: ClaseActivo;
}

/** Algo que el snapshot no pudo incluir. Va al informe, a stderr y al código de salida. */
export interface FalloSnapshot {
  /** Qué no entró: una URL de imagen, o `página /slug`. */
  que: string;
  motivo: string;
}

export interface ResultadoSnapshot {
  dominio: string;
  destino: string;
  /** Rutas relativas de los HTML escritos, en el orden en que se recorrieron. */
  paginas: string[];
  /** Archivos descargados y escritos en `_assets/img`. */
  activos: number;
  /** Archivos de tipografía copiados. */
  fuentes: number;
  fallos: FalloSnapshot[];
}

export interface DepsSnapshot {
  sitios: SitioResolver;
  cda: Cda;
  /** `fetch` inyectable: es lo que permite probar la descarga entera sin red ni credenciales. */
  fetch?: FetchLike;
  maxBytes?: number;
  plazoMs?: number;
}

/**
 * Genera el snapshot completo de un dominio en `destino`.
 *
 * **Aborta (lanza)** por lo que hace que no haya snapshot posible: el dominio no normaliza, no hay
 * sitio, no hay space o no hay token, o la lista de páginas del space no se pudo traer.
 *
 * ⚠️ **Que un fallo de la Links API aborte es una diferencia DELIBERADA con el sitio vivo.** Ahí la
 * nav es una mejora y nunca puede dar 503 (`navDe` en `app.ts`): la página se sirve sin barra. Acá
 * la nav no decora — **decide qué páginas existen**. Degradar a `[]` produciría un snapshot con la
 * home y nada más, entregado como si fuera el sitio entero. Es justo el modo de fallo que el punto
 * 5 del contrato prohíbe: incompleto y con aspecto de completo.
 *
 * **NO aborta** por una descarga fallida: se escribe el snapshot igual, el fallo va al informe y
 * quien llama lo convierte en código de salida (`codigoDeSalida`). Una foto rota no puede bloquear
 * una entrega.
 */
export async function generarSnapshot(
  dominio: string,
  destino: string,
  deps: DepsSnapshot,
): Promise<ResultadoSnapshot> {
  const canonico = normalizarHost(dominio);
  if (!canonico) {
    throw new Error(`"${dominio}" no es un dominio canónico (ver dominio.ts: sin IPs, sin localhost, sin IDN crudo).`);
  }

  const sitio = await deps.sitios.porDominio(canonico);
  if (!sitio) throw new Error(`No hay ningún sitio publicado para ${canonico}.`);
  if (!sitio.spaceId) throw new Error(`${canonico} no tiene space de Storyblok: no hay nada que congelar.`);
  if (!sitio.publicToken) throw new Error(`${canonico} no tiene token de lectura publicado.`);

  // **Siempre `published`.** Un snapshot de borradores entregaría al cliente lo que no publicó, y
  // el `previewToken` es la única credencial de esta tabla que sí es un secreto.
  const peticion = { token: sitio.publicToken, version: "published" as const };
  const nav: NavItem[] = deps.cda.traerNav ? await deps.cda.traerNav(peticion) : [];
  const blog: NavItem[] = deps.cda.traerBlog ? await deps.cda.traerBlog(peticion) : [];

  const fallos: FalloSnapshot[] = [];
  const paginas = new Map<string, string>(); // slug → html sin reescribir

  for (const slug of slugsDelSitio(sitio, nav, blog)) {
    const story = await deps.cda.traerStory({ slug, ...peticion });
    const html = renderPagina({ slug, story, nav, blog, sitio });
    if (html === null) {
      // La Links API la listaba y la story no está: se despublicó entre las dos llamadas, o la nav
      // trae un slug que no resuelve. No se inventa una página — se dice cuál falta.
      fallos.push({ que: `página /${slug}`, motivo: "el space no devolvió contenido para ese slug" });
      continue;
    }
    paginas.set(slug, html);
  }

  // ── Fase 2: los activos. Se juntan de TODAS las páginas antes de bajar nada, para que una foto
  // que aparece en diez páginas se descargue una vez.
  const referencias = referenciasDe(paginas.values());

  await mkdir(path.join(destino, DIR_IMG), { recursive: true });
  await mkdir(path.join(destino, DIR_FUENTES), { recursive: true });

  const locales = new Map<string, string>();
  let activos = 0;
  for (const [url, clase] of referencias) {
    const bajado = await bajarActivo(url, clase, deps);
    const nombre = nombreLocal(url, "tipo" in bajado ? bajado.tipo : null);
    // **La URL se reescribe a la copia local AUNQUE la descarga haya fallado.** Dejar la original
    // haría que la página se viera bien mientras hubiera internet hacia Storyblok, escondiendo
    // justo la dependencia que ADR-11 promete que no existe — y rompiéndose sola el día que la
    // agencia borre el asset. Con la ruta local, el hueco se ve, sale en el informe y en el código
    // de salida. Prohibido que un snapshot incompleto parezca completo.
    locales.set(url, `/${DIR_IMG}/${nombre}`);
    if ("motivo" in bajado) {
      fallos.push({ que: url, motivo: bajado.motivo });
      continue;
    }
    await writeFile(path.join(destino, DIR_IMG, nombre), bajado.bytes);
    activos++;
  }

  // ── Fase 3: escribir las páginas con las URLs ya reescritas.
  const escritas: string[] = [];
  for (const [slug, html] of paginas) {
    const relativa = rutaDePagina(slug);
    if (!relativa) {
      fallos.push({ que: `página /${slug}`, motivo: "el slug no produce una ruta de archivo segura" });
      continue;
    }
    const absoluta = path.join(destino, relativa);
    // Contención, por si el filtro de `rutaDePagina` se quedara corto: el archivo tiene que caer
    // DENTRO del destino. Mismo criterio que `fuentes-servidas.ts` — no hay path que atravesar.
    if (!dentroDe(destino, absoluta)) {
      fallos.push({ que: `página /${slug}`, motivo: "la ruta se sale del directorio de destino" });
      continue;
    }
    await mkdir(path.dirname(absoluta), { recursive: true });
    await writeFile(absoluta, reescribirActivos(html, locales), "utf8");
    escritas.push(relativa.split(path.sep).join("/"));
  }

  // ── Fase 4: las tipografías. Los nombres salen del manifiesto (`rutaPublica()`), que es lo que el
  // CSS emitido ya pide — por eso el `<style>` no se toca.
  //
  // ⚠️ **Se copia el manifiesto ENTERO, no solo las familias que esta web usa, y es deliberado.**
  // Son 148 KB (siete archivos; una sola foto pesa más) y a cambio la lista de lo que se copia sale
  // del CÓDIGO y no del HTML. Copiar "lo que el CSS pide" sería derivar las dos mitades de la misma
  // fuente, y entonces el test que comprueba que la fuente pedida está en disco compararía el código
  // consigo mismo: pasaría siempre, incluido el día que `cssDeFuentes` emita una familia que nadie
  // copió y la web del ex-cliente salga con la tipografía del sistema sin que nada avise.
  const fuentes = cargarFuentes();
  for (const [nombre, bytes] of fuentes) {
    await writeFile(path.join(destino, DIR_FUENTES, nombre), Buffer.from(bytes));
  }

  const resultado: ResultadoSnapshot = {
    dominio: canonico,
    destino,
    paginas: escritas,
    activos,
    fuentes: fuentes.size,
    fallos,
  };

  // El informe **solo existe si hubo fallos**, y uno viejo se borra antes: un snapshot correcto que
  // heredara el informe de una corrida anterior mentiría en la dirección peligrosa.
  const informe = path.join(destino, ARCHIVO_INFORME);
  await rm(informe, { force: true });
  if (fallos.length > 0) await writeFile(informe, textoDelInforme(resultado), "utf8");

  return resultado;
}

/**
 * El código de salida del comando. Vive acá y no dentro de un `if` del CLI para que lo fije un test:
 * un `process.exit` enterrado en un condicional no lo prueba nadie.
 *
 * `2` y no `1` para distinguir "el snapshot salió, pero incompleto" de "no hubo snapshot".
 */
export function codigoDeSalida(r: ResultadoSnapshot): number {
  return r.fallos.length > 0 ? 2 : 0;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Los activos referenciados por el HTML.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** `src` y `poster` de cualquier etiqueta. `esc()` escapa las comillas, así que el corte es exacto. */
const RE_ATRIBUTO = /\s(?:src|poster)="([^"]*)"/g;
const RE_OG_IMAGE = /(<meta property="og:image" content=")([^"]*)(">)/g;
const RE_LD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;
/** `safeJson` serializa con `JSON.stringify(obj, null, 2)`: `"image": "…"`. */
const RE_LD_IMAGE = /("image":\s*")([^"]*)(")/g;

/**
 * Junta los activos de TODAS las páginas en un solo mapa, resolviendo la colisión de clase.
 *
 * ⚠️ **La decisión de seguridad más sutil de este archivo, y por eso vive en su propia función en vez
 * de dentro del bucle de `generarSnapshot`.** Si la misma URL aparece como `<img>` (clase
 * `contenido`, allowlist ESTRICTA de hosts) y como `og:image` (clase `social`, cualquier host https),
 * **manda la estricta**: la allowlist se aplica al caso más peligroso, nunca al más permisivo. Al
 * revés, un `og:image` apuntando a un host cualquiera "ascendería" a esa URL y la dejaría entrar
 * también como `<img>` del documento.
 *
 * Estaba embebida en el bucle y **ninguna mutación la tumbaba** —en las fixturas las dos URLs son
 * siempre distintas, así que el caso jamás se ejercitaba— hasta que lo señaló el `revisor` el
 * 2026-09-12. Sacarla acá es lo que la vuelve comprobable con HTML escrito a mano.
 */
export function referenciasDe(htmls: Iterable<string>): Map<string, ClaseActivo> {
  const referencias = new Map<string, ClaseActivo>();
  for (const html of htmls) {
    for (const { url, clase } of activosDe(html)) {
      if (clase === "contenido" || !referencias.has(url)) referencias.set(url, clase);
    }
  }
  return referencias;
}

/**
 * Las URLs que el HTML manda **buscar afuera**, con su clase.
 *
 * ⚠️ **No es "toda URL que aparezca en el HTML", y esa distinción es el test entero.** `canonical`
 * y `og:url` son externos y legítimos: nadie los descarga, son identidad de la página. Lo que se
 * persigue es lo **fetchable** — los tres emisores de `<img>` (`renderImagen`, el logo de la
 * cabecera y el `og:image`/`image` del JSON-LD) más el `<video src|poster>`, que es el cuarto y no
 * está en ninguna lista de tres.
 *
 * Las `url()` del `<style>` NO entran acá a propósito: ya apuntan a `/_assets/fonts/…` (las emite
 * `cssDeFuentes` desde `rutaPublica()`), así que no hay nada que reescribir. Que sigan siendo
 * locales lo comprueba el test de cero terceros, que las mira aparte.
 */
export function activosDe(html: string): ActivoReferenciado[] {
  const out: ActivoReferenciado[] = [];
  const agregar = (crudo: string, clase: ClaseActivo, decodificar: (s: string) => string) => {
    const url = decodificar(crudo);
    if (/^https?:\/\//i.test(url)) out.push({ url, clase });
  };

  for (const m of html.matchAll(RE_ATRIBUTO)) agregar(m[1] ?? "", "contenido", desEsc);
  for (const m of html.matchAll(RE_OG_IMAGE)) agregar(m[2] ?? "", "social", desEsc);
  for (const bloque of html.matchAll(RE_LD)) {
    for (const m of (bloque[2] ?? "").matchAll(RE_LD_IMAGE)) agregar(m[2] ?? "", "social", desJson);
  }
  return out;
}

/** Cambia cada URL por su copia local. Las que no estén en el mapa se dejan como están. */
export function reescribirActivos(html: string, locales: ReadonlyMap<string, string>): string {
  const conAtributos = html.replace(RE_ATRIBUTO, (todo, valor: string) => {
    const local = locales.get(desEsc(valor));
    return local ? todo.replace(`"${valor}"`, `"${esc(local)}"`) : todo;
  });

  const conOg = conAtributos.replace(RE_OG_IMAGE, (todo, abre: string, valor: string, cierra: string) => {
    const local = locales.get(desEsc(valor));
    return local ? `${abre}${esc(local)}${cierra}` : todo;
  });

  return conOg.replace(RE_LD, (todo, abre: string, cuerpo: string, cierra: string) => {
    const nuevo = cuerpo.replace(RE_LD_IMAGE, (t, a: string, valor: string, c: string) => {
      const local = locales.get(desJson(valor));
      return local ? `${a}${local}${c}` : t;
    });
    return nuevo === cuerpo ? todo : `${abre}${nuevo}${cierra}`;
  });
}

/** El inverso de `esc()` de `web-builder/src/render/lib.ts`. `&amp;` al final: es el inverso exacto. */
function desEsc(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** El inverso de `safeJson()`: `JSON.parse` deshace `&` y compañía sin una tabla paralela. */
function desJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

/** Mismo escape que el render, para no reintroducir por la puerta de atrás lo que `esc()` cierra. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * La descarga.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Hosts que no se piden **nunca**, para ninguna clase.
 *
 * El render solo emitía el string de un `og:image`; el snapshot hace la petición, y ahí aparece un
 * vector que antes no existía: una ficha que apunte a un host de la red interna de quien corre el
 * comando. Es la mitad barata de la defensa (no hay resolución de DNS acá, así que un nombre que
 * resuelva a 127.0.0.1 pasa igual) y se dice que es parcial en vez de venderla como completa.
 *
 * **Medido por el `revisor` el 2026-09-12, para no re-litigarlo en cada revisión.** La sospecha
 * razonable es que la regex de IPv4 se esquive con una forma alternativa; no se esquiva, porque
 * `new URL` **normaliza antes**: decimal (`https://2130706433/`), hexadecimal (`0x7f000001`), octal
 * (`017700000001`) y corta (`127.1`) llegan acá las cuatro como `"127.0.0.1"`. El IPv6 mapeado sale
 * entre corchetes y lo caza el `startsWith("[")`, y `metadata.google.internal` cae por `.internal`.
 * **El único hueco real es el que este docstring ya declara**: un nombre público que resuelva a una
 * IP privada.
 */
function hostAlcanzable(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  // IPv4 literal, e IPv6 (que `new URL` devuelve entre corchetes). Un asset legítimo tiene nombre.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return false;
  return true;
}

/**
 * ¿Se puede pedir esta URL? Devuelve el motivo del rechazo, o `null` si pasa.
 *
 * Reusa las dos funciones del render (`fuentePermitida`, `imagenPublicable`) en vez de reimplementar
 * la allowlist: dos copias de una comparación de hosts divergen, y la que divergiría es la de acá.
 */
export function motivoDeRechazo(url: string, clase: ClaseActivo): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "no es una URL válida";
  }
  if (!hostAlcanzable(u.hostname)) return `host no alcanzable (${u.hostname}): loopback, IP literal o dominio interno`;

  if (clase === "contenido") {
    return fuentePermitida(url)
      ? null
      : `no pasa la política de imágenes del render: se exige https y un host de ${[...HOSTS_DE_ASSETS].join(", ")}`;
  }
  return imagenPublicable(url) ? null : "la imagen social tiene que ser https";
}

type Bajado = { bytes: Buffer; tipo: string | null } | { motivo: string };

async function bajarActivo(url: string, clase: ClaseActivo, deps: DepsSnapshot): Promise<Bajado> {
  const rechazo = motivoDeRechazo(url, clase);
  if (rechazo) return { motivo: rechazo };

  const hacer = deps.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
  const maxBytes = deps.maxBytes ?? MAX_BYTES_ACTIVO;
  const plazoMs = deps.plazoMs ?? PLAZO_DESCARGA_MS;

  const ac = new AbortController();
  let t: NodeJS.Timeout | undefined;
  const vencimiento = new Promise<never>((_, rej) => {
    t = setTimeout(() => {
      ac.abort();
      rej(new Error(`no completó la descarga en ${plazoMs} ms`));
    }, plazoMs);
  });

  try {
    // El plazo se corre contra un `Promise.race` y no solo con la señal: un `signal` abortado no
    // interrumpe una lectura de cuerpo que ya está en curso. Misma lección que `conPlazo` en
    // `cda.ts` — lo que garantiza el plazo es la carrera; la señal además libera el socket.
    return await Promise.race([seguir(), vencimiento]);
  } catch (e) {
    return { motivo: (e as Error).message };
  } finally {
    clearTimeout(t);
  }

  async function seguir(): Promise<Bajado> {
    let actual = url;
    for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
      // `redirect: "manual"` y el salto a mano: con `follow`, el destino final no pasaría por la
      // allowlist y un host permitido que redirige se convierte en un permiso para cualquiera.
      const res = await hacer(actual, { signal: ac.signal, redirect: "manual" });

      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get("location");
        if (!destino) return { motivo: `redirección ${res.status} sin Location` };
        actual = new URL(destino, actual).toString();
        const rechazo = motivoDeRechazo(actual, clase);
        if (rechazo) return { motivo: `la redirección lleva a ${actual}: ${rechazo}` };
        continue;
      }

      if (!res.ok) return { motivo: `el origen respondió ${res.status}` };

      // El `content-length` lo declara quien sirve: se mira primero para cortar barato, y después
      // se cuenta lo que llega de verdad. Mismo doble control que el tope del webhook.
      const declarado = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declarado) && declarado > maxBytes) {
        return { motivo: `declara ${declarado} bytes y el tope es ${maxBytes}` };
      }

      const bytes = await leerAcotado(res, maxBytes);
      if ("motivo" in bytes) return bytes;
      return { bytes: bytes.bytes, tipo: res.headers.get("content-type") };
    }
    return { motivo: `más de ${MAX_REDIRECCIONES} redirecciones` };
  }
}

/**
 * Lee el cuerpo cortando por bytes **mientras llega**.
 *
 * Un tope aplicado después de `arrayBuffer()` no es un tope: ya te comiste el archivo entero. Con el
 * stream se cancela la descarga en el chunk que se pasa. Si el runtime (o un mock) no expone `body`,
 * se cae a `arrayBuffer()` y el tope se comprueba igual — ahí lo que acota de verdad es el plazo.
 */
async function leerAcotado(res: Response, maxBytes: number): Promise<{ bytes: Buffer } | { motivo: string }> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;

  if (!body || typeof body.getReader !== "function") {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? { motivo: `pesa ${buf.byteLength} bytes y el tope es ${maxBytes}` } : { bytes: buf };
  }

  const reader = body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel(); // se corta: no se sigue pagando ancho de banda ni memoria
      return { motivo: `supera el tope de ${maxBytes} bytes` };
    }
    trozos.push(value);
  }
  return { bytes: Buffer.concat(trozos) };
}

/** Extensiones que se conservan tal cual. Lo que no esté acá sale por `content-type` o como `bin`. */
const EXT_CONOCIDAS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "svg", "ico", "mp4", "webm", "ogv"]);

const EXT_POR_TIPO: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * El nombre del archivo local: **hash de la URL** + extensión.
 *
 * No se deriva del path de la URL, y no es por estética: el nombre saldría de un dato que no
 * controlamos y habría que defenderse de `..`, de `/` y —en Windows— de `:` y de los nombres
 * reservados. Con un hash **no hay path que atravesar**, que es la misma decisión que toma
 * `fuentes-servidas.ts` con el `Map`. Y es determinista: la misma URL da el mismo archivo en cada
 * corrida, así que un snapshot regenerado no cambia de nombres.
 */
export function nombreLocal(url: string, tipo: string | null): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  let ext = "";
  try {
    ext = (new URL(url).pathname.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "").toLowerCase();
  } catch {
    ext = "";
  }
  if (!EXT_CONOCIDAS.has(ext)) {
    const t = (tipo ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    ext = Object.hasOwn(EXT_POR_TIPO, t) ? (EXT_POR_TIPO[t] as string) : "bin";
  }
  return `${hash}.${ext}`;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Rutas.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `home` → `index.html`; cualquier otro slug → `<slug>/index.html`.
 *
 * **Preserva la URL**, que es el punto 3 del contrato: un servidor estático sirve `/menu` desde
 * `menu/index.html` y la nav horneada sigue funcionando sin reescribir un solo `href`.
 *
 * Los segmentos se filtran igual que en `hrefDeSlug` (`.`/`..`/vacíos fuera) y además se descarta
 * todo lo que en un filesystem no es un nombre: separadores, dos puntos de unidad de Windows,
 * caracteres de control. `null` = este slug no produce una ruta segura y la página no se escribe.
 */
export function rutaDePagina(slug: string): string | null {
  if (slug === SLUG_HOME) return "index.html";

  const segmentos = slug
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    // Separadores, lo que Windows prohibe en un nombre de archivo, y los de control. Un guion SI
    // entra: `hamburguesas-madrid-centro` es la forma de todos los slugs reales.
    .filter((s) => !/[\\/:*?"<>|]/.test(s) && !/[\u0000-\u001f]/.test(s));

  const limpios = slug.split("/").filter((s) => s.length > 0);
  // Si el filtro descartó algo, el slug traía un segmento que no se puede representar: no se
  // "arregla" silenciosamente escribiendo la página en otra ruta — se reporta y no se escribe.
  if (segmentos.length === 0 || segmentos.length !== limpios.length) return null;

  return path.join(...segmentos, "index.html");
}

/** ¿`hijo` cae dentro de `padre`? La comprobación que sobrevive a un filtro con un agujero. */
function dentroDe(padre: string, hijo: string): boolean {
  const rel = path.relative(path.resolve(padre), path.resolve(hijo));
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * El informe y el comando.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export function textoDelInforme(r: ResultadoSnapshot): string {
  const lineas = [
    `Snapshot estático de ${r.dominio} — ${new Date().toISOString()}`,
    `Destino: ${r.destino}`,
    "",
    `Páginas escritas:       ${r.paginas.length}`,
    `Imágenes descargadas:   ${r.activos}`,
    `Tipografías copiadas:   ${r.fuentes}`,
    "",
    `NO ENTRARON EN EL SNAPSHOT (${r.fallos.length}):`,
    "",
  ];
  for (const f of r.fallos) lineas.push(`  ${f.que}`, `      ${f.motivo}`, "");
  lineas.push(
    "Este snapshot está INCOMPLETO. Las URLs de arriba se reescribieron igual a su ruta local, así",
    "que en la web se ven como imágenes rotas y NO quedó ninguna petición a un host externo: el",
    "snapshot no depende de AMG OS ni de Storyblok, pero le faltan estos archivos.",
    "",
    "Antes de entregarlo: repará el origen (¿el asset sigue en el space?) y volvé a generarlo.",
  );
  return lineas.join("\n") + "\n";
}

export interface Salida {
  log(mensaje: string): void;
  error(mensaje: string): void;
}

export const USO =
  "Uso: npm run snapshot -w renderer -- <dominio> <directorio-destino>\n" +
  "  ej: npm run snapshot -w renderer -- micliente.com ./salida/micliente";

/**
 * El comando entero salvo las credenciales: parsea los argumentos, genera, informa y **devuelve el
 * código de salida**. Lo que queda en `cli/snapshot.ts` es el composition root (el pool de Postgres
 * y el `StoryblokCda`), que es lo único que no se puede probar sin credenciales.
 */
export async function correrSnapshot(
  argv: readonly string[],
  deps: DepsSnapshot,
  salida: Salida = console,
): Promise<number> {
  const [dominio, destino] = argv;
  if (!dominio || !destino) {
    salida.error(USO);
    return 1;
  }

  let r: ResultadoSnapshot;
  try {
    r = await generarSnapshot(dominio, destino, deps);
  } catch (e) {
    salida.error(`No se pudo generar el snapshot de ${dominio}: ${(e as Error).message}`);
    return 1;
  }

  salida.log(`\n▶ Snapshot de ${r.dominio} en ${r.destino}`);
  salida.log(`  ${r.paginas.length} páginas · ${r.activos} imágenes · ${r.fuentes} tipografías`);
  for (const p of r.paginas) salida.log(`    ${p}`);

  if (r.fallos.length > 0) {
    salida.error(`\n⚠ ${r.fallos.length} cosa(s) NO entraron en el snapshot:`);
    for (const f of r.fallos) salida.error(`    ${f.que}\n        ${f.motivo}`);
    salida.error(`\n  Detalle en ${path.join(r.destino, ARCHIVO_INFORME)}`);
    salida.error("  El snapshot está escrito y es autocontenido, pero INCOMPLETO: no lo entregues así.");
  } else {
    salida.log("\n  Sin fallos: el snapshot no referencia ni un host externo.");
    salida.log(`  Servilo con cualquier servidor estático desde ${r.destino} y abrilo sin red.`);
  }

  return codigoDeSalida(r);
}
