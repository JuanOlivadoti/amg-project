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
  css: `.p-cartaCategorias .categoria{padding:24px 0;border-bottom:1px solid #f0f0f0}
/* La foto de categoría es la que da aire a la carta: ancho completo y proporción apaisada fija, para
   que dos categorías con fotos de distinto tamaño no dejen la página a saltos. */
.p-cartaCategorias .categoria-img{width:100%;aspect-ratio:3/1;object-fit:cover;border-radius:12px;margin:0 0 14px}
.p-cartaCategorias .categoria h2{font-size:1.45rem;margin:0 0 4px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
/* Misma regla decorativa que el titular tipográfico de la portada, y el mismo motivo: es el segundo
   color de marca en una superficie que NO es texto largo. */
.p-cartaCategorias .categoria h2::after{content:"";display:block;width:48px;height:3px;margin:8px 0 14px;background:var(--decorativo)}
.p-cartaCategorias .platos{list-style:none;margin:0;padding:0}
.p-cartaCategorias .platos li{padding:12px 0;border-bottom:1px solid #f5f4f2}
/* El DOBLE BORDE del final de cada categoría: la última fila dibujaba su separador y el contenedor
   dibujaba el suyo justo debajo, dos líneas pegadas. Gana el del contenedor, que es el que separa una
   categoría de la siguiente; el de la fila solo separa platos ENTRE sí y después de la última no
   separa nada. */
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
@media(prefers-color-scheme:dark){.p-cartaCategorias .categoria{border-color:#1e1e1e}.p-cartaCategorias .platos li{border-color:#191919}}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    // Sin `menu` no hay pieza. La página `/menu` ni siquiera se sirve en ese caso.
    if (!profile || !profile.menu || profile.menu.length === 0) return "";

    const bloques = gruposDe(profile)
      .map((g) => unaCategoria(g, ctx.presupuestoImagenes))
      .join("\n");
    return envolver("p-cartaCategorias", bloques);
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
  return `<section class="categoria">
  ${foto}
  ${g.categoria ? `<h2>${esc(g.categoria)}</h2>` : ""}
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
