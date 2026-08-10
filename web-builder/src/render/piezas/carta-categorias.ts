import type { BusinessProfile, Foto, MenuItem } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import {
  MAX_CATEGORIAS_RENDER,
  agruparCarta,
  comoImagen,
  envolver,
  esc,
  preciosDe,
  renderImagen,
} from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La carta completa**: un bloque por categoría, con su foto y sus platos. La página `/menu`.
 *
 * Se **sintetiza del perfil**, no de una story ni del LLM: una carta es una lista de producto con
 * precio, no hay nada que "redactar", y generarla por IA metería una fuente más de contenido que
 * revisar en la compuerta humana (ADR-06).
 *
 * ## Reemplaza a `carta`, que se retiró del catálogo
 *
 * Esta pieza cubre **también** el caso sin `menu_categorias` —la spec lo pide como test— así que
 * `carta` se quedaba sin ninguna receta que la nombrara. El porqué del retiro está en `index.ts`. Lo
 * que viaja de allí y no puede perderse: el arreglo del **doble borde** al final de cada categoría
 * (la última fila no dibuja su separador porque el del contenedor ya está ahí) y el modo oscuro
 * completo, que era el bug que abre la spec.
 *
 * ## Las reglas de omisión (el `""` de §2, aplicado al detalle)
 *
 *  - Sin `menu` no hay pieza, y `/menu` sigue dando 404 como hoy.
 *  - Sin `menu_categorias`, se agrupa por el `category` de cada plato y no hay fotos de categoría. Un
 *    cliente que solo tiene la lista de platos conserva su carta entera.
 *  - Categoría declarada **sin platos** → no se dibuja: un bloque con foto y sin carta es un hueco.
 *  - Plato con `category` que nadie declaró → se dibuja en su grupo, sin foto de categoría. La carta
 *    del cliente no se pierde por no haber rellenado `menu_categorias`.
 *  - Categoría o plato sin foto → sin miniatura. **Nunca una foto genérica de otro restaurante.**
 */
export const cartaCategorias: Pieza = {
  id: "cartaCategorias",
  raiz: "p-cartaCategorias",
  css: `.p-cartaCategorias .categoria{margin:0 0 clamp(40px,5vw,72px)}
.p-cartaCategorias .categoria:last-child{margin-bottom:0}
/* ⚠️ **La foto de categoría es un \`<img>\` detrás del texto, NO un \`background-image\` inline.**
   La referencia lo hace con un background-image inline, y esa forma se salta la política de imágenes
   entera: no pasaría por la allowlist de hosts, no llevaría referrerpolicy, no gastaría presupuesto y
   sería una URL de la ficha entrando cruda en un atributo style. Con una etiqueta de imagen
   posicionada se conserva todo eso y el resultado visual es el mismo.
   (El ejemplo va sin escribir la función CSS literal a propósito: el test de "cero terceros" busca
   esa función en el texto del <style> y no distingue un comentario de una regla.) */
.p-cartaCategorias .cab{position:relative;overflow:hidden;border-radius:14px;min-height:180px;display:flex;flex-direction:column;justify-content:flex-end;padding:24px;background:var(--soft)}
.p-cartaCategorias .categoria-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
/* El velo es lo que hace legible el rótulo sobre CUALQUIER foto: sin él, un nombre claro sobre una
   foto clara desaparece, y la foto la elige el cliente. */
.p-cartaCategorias .cab::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,.15));z-index:1}
.p-cartaCategorias .cab h3,.p-cartaCategorias .cab .conteo{position:relative;z-index:2}
.p-cartaCategorias .cab h3{font-size:clamp(1.4rem,1rem + 1.1vw,1.9rem);margin:0;letter-spacing:.02em;text-transform:uppercase;color:var(--sobre-acento);font-family:var(--fuente-titulo)}
.p-cartaCategorias .cab .conteo{margin:6px 0 0;font-size:.95rem;color:var(--sobre-acento);opacity:.85}
/* Sin foto la cabecera no finge una: se queda en una banda sobria con el filete de marca, y el rótulo
   vuelve al color del título. Es el estado de toda ficha que aún no ha subido fotos. */
.p-cartaCategorias .cab.sin-img{min-height:0;padding:0 0 14px;background:none;border-bottom:2px solid var(--decorativo);border-radius:0}
.p-cartaCategorias .cab.sin-img::after{display:none}
.p-cartaCategorias .cab.sin-img h3{color:var(--titulo)}
.p-cartaCategorias .cab.sin-img .conteo{color:var(--muted)}
/* Dos columnas de platos en escritorio, como la carta de la referencia. \`grid\` y no \`columns\`: con
   columnas CSS una fila se puede partir por la mitad entre dos columnas. */
.p-cartaCategorias .platos{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:0 48px}
@media(min-width:992px){.p-cartaCategorias .platos{grid-template-columns:1fr 1fr}}
.p-cartaCategorias .platos li{padding:16px 0;border-bottom:1px solid #f5f4f2}
/* El DOBLE BORDE del final de cada categoría: la última fila dibujaba su separador y el contenedor
   dibujaba el suyo justo debajo, dos líneas pegadas. Gana el del contenedor, que es el que separa una
   categoría de la siguiente; el de la fila solo separa platos ENTRE sí y después de la última no
   separa nada.
   ⚠️ Con la rejilla de dos columnas esto solo limpia el último del DOM, que es el de abajo a la
   derecha cuando el total es par y el de abajo a la izquierda cuando es impar. El otro de la última
   fila conserva su borde. Se probó ':nth-last-child(-n+2)' y **es peor**: con un número impar de
   platos le quita el borde al penúltimo, que está a mitad de la carta. Sin ':has()' sobre el número
   de hijos no hay una regla que acierte en los dos casos, y la asimetría de una línea es menos mala
   que un hueco en medio. */
.p-cartaCategorias .platos li:last-child{border-bottom:0}
.p-cartaCategorias .fila{display:flex;gap:14px;align-items:flex-start}
/* La miniatura no crece ni se encoge (\`flex:0 0 auto\`): sin eso, una descripción larga la aplasta y
   la carta queda con miniaturas de anchos distintos fila a fila. */
.p-cartaCategorias .plato-foto{flex:0 0 auto;width:72px;height:72px;object-fit:cover;border-radius:8px}
.p-cartaCategorias .datos{flex:1 1 auto;min-width:0}
.p-cartaCategorias .nombre{margin:0;font-weight:600}
.p-cartaCategorias .nota{margin-left:8px;font-weight:400;font-size:.8rem;color:var(--muted)}
.p-cartaCategorias .desc{margin:4px 0 0;color:var(--muted);font-size:.95rem}
/* Los precios se alinean a la derecha en columna y no se parten (\`white-space:nowrap\`): "14,50 €"
   cortado en dos líneas deja de ser un precio. */
.p-cartaCategorias .precios{flex:0 0 auto;margin:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
/* \`--acento-legible\` y no \`--accent\`: es texto de acento sobre el fondo de la página, y en oscuro el
   acento pleno de un cliente puede quedar ilegible. */
.p-cartaCategorias .precio{color:var(--acento-legible);font-weight:600;white-space:nowrap}
.p-cartaCategorias .precio .etiqueta{color:var(--muted);font-weight:400;font-size:.8rem;margin-right:6px}
`,

  /* El velo se redeclara en oscuro **con el mismo valor**, y no es ruido: el detector exige que todo
     color literal tenga contrapartida, y la respuesta acá es que NO cambia. Va sobre una foto, no
     sobre el fondo de la página, así que el tema del documento no lo afecta — pero eso hay que
     decirlo en el sitio donde se comprueba, no suponerlo. */
  cssOscuro: `@media(prefers-color-scheme:dark){.p-cartaCategorias .categoria{border-color:#1e1e1e}.p-cartaCategorias .platos li{border-color:#191919}
.p-cartaCategorias .cab::after{background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,.15))}}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    // Sin `menu` no hay pieza. La página `/menu` ni siquiera se sirve en ese caso.
    if (!profile || !profile.menu || profile.menu.length === 0) return "";

    const bloques = gruposDe(profile)
      .map((g) => unaCategoria(g, ctx.presupuestoImagenes))
      .join("\n");
    // El antetítulo y el título son ETIQUETAS DE PLANTILLA, no contenido del negocio — igual que
    // "Inicio" o "Contacto" en el nav. Lo que no se inventa es el dato del cliente; cómo se rotula
    // una sección es del diseño.
    return envolver(
      "p-cartaCategorias",
      `<section class="seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Nuestra carta</p><h2>Lo que se cocina hoy</h2></div>
${bloques}
</div></section>`,
    );
  },
};

interface GrupoCarta {
  categoria: string | null;
  foto?: Foto;
  items: MenuItem[];
}

/**
 * Los grupos de la carta, ordenados.
 *
 * Parte de `agruparCarta` —que ya agrupa por `category` conservando el orden de aparición y deja los
 * sueltos al final— y le añade **solo** lo que trae `menu_categorias`: la foto y la posición.
 *
 * **El orden:** las categorías con `orden` explícito van primero, por ese número; el resto conserva el
 * orden de aparición en `menu`, detrás. Es la lectura literal de la spec ("`menu_categorias` sin
 * `orden` → orden de aparición en `menu`") aplicada al caso mixto, que la spec no cubre: mezclar las
 * dos escalas en un solo número —`orden ?? índice`— haría que añadir un plato al principio de la carta
 * reordenara categorías que nadie tocó. El `sort` de JS es estable desde ES2019, y de ahí sale que los
 * que empatan en `Infinity` mantengan su orden.
 *
 * Una categoría declarada **sin platos** desaparece acá: `agruparCarta` solo produce grupos que tienen
 * ítems, así que `menu_categorias` únicamente puede **enriquecer** un grupo existente, nunca crearlo.
 * Eso es lo que hace imposible el hueco "bloque con foto y sin carta" — no un `if` que haya que
 * recordar.
 */
function gruposDe(profile: BusinessProfile): GrupoCarta[] {
  const grupos = agruparCarta(profile.menu ?? []);
  const declaradas = Array.isArray(profile.menu_categorias) ? profile.menu_categorias : [];
  // Frontera 4: el tope también se aplica en el render, porque en PROD el perfil llega de la base sin
  // pasar por el Zod de este paquete.
  const porNombre = new Map(
    declaradas
      .slice(0, MAX_CATEGORIAS_RENDER)
      .filter((c) => typeof c?.nombre === "string" && c.nombre.length > 0)
      .map((c) => [c.nombre, c] as const),
  );

  const conMeta = grupos.map((g, i) => {
    const meta = g.categoria !== null ? porNombre.get(g.categoria) : undefined;
    return {
      grupo: { categoria: g.categoria, items: g.items, ...(meta?.foto ? { foto: meta.foto } : {}) },
      // La posición explícita, o el sitio que ya ocupa en la carta.
      clave: typeof meta?.orden === "number" ? meta.orden : Number.POSITIVE_INFINITY,
      aparicion: i,
    };
  });
  conMeta.sort((a, b) => a.clave - b.clave || a.aparicion - b.aparicion);
  return conMeta.map((x) => x.grupo);
}

function unaCategoria(g: GrupoCarta, presupuesto: PresupuestoImagenes): string {
  const foto = renderImagen(comoImagen(g.foto), "categoria-img", presupuesto);
  const filas = g.items.map((it) => unPlato(it, presupuesto)).join("\n");
  // El conteo es un dato REAL: sale de los platos que tiene el grupo, no de un campo que alguien
  // rellene a mano y se desincronice. La referencia rotula "18 Items" con un número escrito en su
  // fixture; acá no puede mentir.
  const n = g.items.length;
  const conteo = `<p class="conteo">${n} ${n === 1 ? "plato" : "platos"}</p>`;
  // Sin nombre de categoría no hay cabecera que rotular: los platos sueltos van directos a la lista.
  const cabecera = g.categoria
    ? `<header class="cab ${foto ? "con-img" : "sin-img"}">${foto}<h3>${esc(g.categoria)}</h3>${conteo}</header>`
    : "";
  return `<section class="categoria">
  ${cabecera}
  <ul class="platos">
${filas}
  </ul>
</section>`;
}

function unPlato(it: MenuItem, presupuesto: PresupuestoImagenes): string {
  const foto = renderImagen(comoImagen(it.foto), "plato-foto", presupuesto);
  const nota = it.nota ? `<span class="nota">${esc(it.nota)}</span>` : "";
  const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
  // TODOS los importes, cada uno con su etiqueta. La etiqueta vacía es el caso de `price` (un solo
  // importe), y entonces no se dibuja el rótulo: "12,50 €" no necesita que le expliquen qué es.
  const precios = preciosDe(it)
    .map(
      (p) =>
        `<span class="precio">${p.etiqueta ? `<span class="etiqueta">${esc(p.etiqueta)}</span>` : ""}${esc(p.importe)}</span>`,
    )
    .join("");
  return `    <li><div class="fila">${foto}<div class="datos"><p class="nombre">${esc(it.name)}${nota}</p>${desc}</div>${precios ? `<p class="precios">${precios}</p>` : ""}</div></li>`;
}
