import type { BrandTheme, FuenteNombre } from "../types.js";
import { cssDeFuentes, stackDe } from "./fuentes.js";
import type { Pieza } from "./piezas/tipos.js";

/**
 * El CSS del documento: **tokens + base + el CSS de las piezas que renderizaron algo**.
 *
 * Dos garantías que este archivo tiene que sostener:
 *
 * 1. **Determinismo.** Las piezas se emiten en orden de CATÁLOGO, no de receta, para que dos páginas
 *    con las mismas piezas usadas produzcan un `<style>` idéntico byte a byte. Con las reglas de
 *    aislamiento (§3, `aislamiento.ts`) ese orden ya no puede alterar el resultado visual: solo lo
 *    hace reproducible y testeable.
 * 2. **Una landing sin galería no paga los bytes de la galería.** La pieza que devolvió `""` no
 *    aporta su CSS.
 */

/**
 * Los stacks se **derivan de `fuentes.ts`**, que es la única fuente de verdad (entrega 3, mitad C).
 *
 * Hasta la mitad C este archivo tenía su propia tabla de literales, y para `moderna` decía una cosa
 * distinta de la de `fuentes.ts`. Dos tablas del mismo hecho es una que miente sin que nada avise: los
 * cuatro roles nuevos caían acá a stacks del sistema mientras las `woff2` se servían sin que el CSS
 * las pidiera nunca, y `moderna` estaba a un refactor descuidado de cambiarle la tipografía a todas
 * las fichas sembradas.
 *
 * `exigido` lanza en tiempo de importación si un rol no tiene stack: un `Record` con un `undefined`
 * dentro emitiría `--marca-fuente-titulo:undefined`, que es CSS inválido y por tanto un token que se
 * descarta en silencio y cae al default. Un error de programación tiene que doler al arrancar.
 */
function exigido(rol: FuenteNombre): string {
  const stack = stackDe(rol);
  if (!stack) throw new Error(`El rol tipográfico "${rol}" no tiene stack en fuentes.ts`);
  return stack;
}

/**
 * Las tres LEGACY (`brand.font`). Siguen alimentando `--marca-fuente-texto` exactamente como antes:
 * son stacks del sistema y ninguna ficha sembrada cambia de aspecto.
 *
 * Es una allowlist **aparte** de la de siete, y no se fusionan: que el campo viejo aceptara de pronto
 * `condensada` sería ampliar en silencio un contrato cerrado.
 */
const FONT_STACKS: Record<NonNullable<BrandTheme["font"]>, string> = {
  sistema: exigido("sistema"),
  serif: exigido("serif"),
  moderna: exigido("moderna"),
};

/**
 * Los siete roles del manual de marca (enmienda 2026-08-02).
 *
 * Los cuatro nombres nuevos resuelven a **su familia self-hosted** (`/_assets/fonts/…`, subset latino,
 * `woff2`): es lo que enchufa esta mitad. La marca elige un NOMBRE, nunca escribe el stack — un stack
 * en la ficha del cliente sería texto libre entrando a un `<style>`—, así que cambiar qué familia hay
 * detrás de `condensada` sigue siendo un cambio de código revisado y no una edición de fichas.
 */
const FUENTE_STACKS: Record<FuenteNombre, string> = {
  sistema: FONT_STACKS.sistema,
  serif: FONT_STACKS.serif,
  moderna: FONT_STACKS.moderna,
  condensada: exigido("condensada"),
  geometrica: exigido("geometrica"),
  humanista: exigido("humanista"),
  script: exigido("script"),
};

/**
 * Los tokens, en **dos capas**. Los `:root` son del base y solo del base (§3.6): una pieza que
 * declarara un token que otra consume rompería la composición, y por eso `aislamiento.ts` lo prohíbe.
 *
 * **Capa 1, `--marca-*`:** lo que dijo la ficha del cliente (enmienda 2026-08-02), con los valores de
 * hoy como default. Un token ausente no emite nada y gana el default — es lo que hace que una ficha a
 * medio llenar produzca una web coherente en vez de una rota a trozos.
 *
 * **Capa 2, los semánticos:** lo que consumen las piezas. Se derivan de la capa 1 y son los ÚNICOS
 * que el modo oscuro reescribe.
 *
 * Por qué dos capas y no una: si una pieza leyera `--marca-primario` directamente, corregir el
 * contraste del acento en oscuro obligaría a **reescribir el token del cliente**, o sea a mentir
 * sobre lo que dice su ficha. Con la capa semántica en medio, "el acento legible sobre fondo oscuro"
 * es un derivado (`--acento-legible`) y la ficha sigue diciendo lo que dice. Es también lo que
 * permite que el modo oscuro no toque ni un valor de marca.
 *
 * Los nombres: los seis de la izquierda (`--fg`, `--muted`, `--accent`, `--bg`, `--soft`, `--font`)
 * son los que ya existían y se conservan — renombrarlos tocaría todas las piezas por cero beneficio.
 * Los nuevos siguen la convención del proyecto (español), como los `--marca-*`.
 *
 * ⚠️ **`--marca-fuente-titulo` y `--marca-fuente-decorativa` caen a la fuente del CUERPO, no al stack
 * del sistema.** Si cayeran al sistema, una ficha legacy con `font: serif` vería su cuerpo en Georgia
 * y sus titulares en system-ui: un cambio de aspecto en todas las webs sembradas que nadie pidió.
 */
const CSS_TOKENS =
  `\n:root{--marca-primario:#b91c1c;--marca-secundario:#6b7280;--marca-titulo:#1a1a1a;--marca-texto:#1a1a1a;` +
  `--marca-fondo:#fff;--marca-fondo-alt:#f8f7f5;--marca-fuente-texto:${FONT_STACKS.sistema};` +
  `--marca-fuente-titulo:var(--marca-fuente-texto);--marca-fuente-decorativa:var(--marca-fuente-texto)}` +
  // ⚠️ `--muted` NO deriva de `--marca-secundario`, y la primera versión de esta capa sí lo hacía.
  //
  // `--muted` pinta el lede, las descripciones, las direcciones, los horarios, el nav y la línea
  // técnica: es **color de texto largo**, y por tanto tiene que pasar contraste AA sobre el fondo.
  // «Secundario» en un manual de marca es el segundo color **de marca** —decorativo—, y atarlos
  // obliga a que el segundo color de marca sea legible como cuerpo de texto, o sea a que sea otro
  // gris. Medido con la paleta ya decidida para el cliente de demo
  // (`docs/plantillas/template1/marca.json`): su `secundario` de oro `#c8963e` sobre su fondo
  // `#fffdf9` da **2.62:1** — falla AA —, y habría pintado de oro ilegible todo el texto secundario
  // de la web. Lo encontró la implementación midiendo, no la revisión.
  //
  // Así que el gris vuelve a ser un neutro fijo, y `--marca-secundario` entra por **`--decorativo`**
  // (mitad B): la regla bajo el titular de la portada, la de cada categoría de la carta y el filete
  // de la franja de datos. Superficie decorativa, nunca texto largo — que era la condición.
  //
  // Que sea un token semántico y no `var(--marca-secundario)` en cada pieza es la misma decisión de
  // dos capas que el resto: en oscuro hace falta una variante aclarada, y sin la capa de en medio
  // habría que reescribir el token del cliente, o sea mentir sobre lo que dice su ficha.
  `\n:root{--fg:var(--marca-texto);--titulo:var(--marca-titulo);--muted:#6b7280;` +
  `--accent:var(--marca-primario);--acento-legible:var(--marca-primario);--sobre-acento:#fff;` +
  `--decorativo:var(--marca-secundario);` +
  `--bg:var(--marca-fondo);--soft:var(--marca-fondo-alt);--font:var(--marca-fuente-texto);` +
  `--fuente-titulo:var(--marca-fuente-titulo);--fuente-decorativa:var(--marca-fuente-decorativa);` +
  // **Dos anchos, y son dos cosas distintas.** `--ancho-pagina` es la banda: la cabecera, la galería,
  // la carta, cualquier sección que gane con el ancho de la pantalla. `--ancho-lectura` es el texto,
  // y no puede crecer con ella: una línea de prosa de 1600 px es ilegible —lo cómodo son 60-75
  // caracteres— así que el párrafo se queda donde estaba aunque la página se ensanche.
  //
  // Un solo token para las dos cosas es el error que produce webs "modernas" con renglones de
  // periódico, y es también el motivo por el que la cabecera y el contenido no alineaban: la barra
  // iba a 1100 y `main` a 760 porque cada uno resolvía su problema por su cuenta.
  `--ancho-pagina:1320px;--ancho-lectura:760px;` +
  // El aire vertical de una sección. En la referencia son 120 px fijos arriba y abajo; acá crece con
  // la pantalla para que en un móvil no se coma media pantalla en blanco entre sección y sección.
  `--pad-seccion:clamp(56px,8vw,120px)}`;

/**
 * El CSS que viaja SIEMPRE: el reset, el contenedor del documento y las **primitivas compartidas**.
 *
 * Qué hace a una regla "base" y no de una pieza (§3.6): que **dos o más piezas la necesiten**. Las
 * tarjetas (`.cards`/`.card`) las usan el índice de la home y el del blog; `.pending` la usan cuatro
 * piezas; `footer`/`.tecnica`/`.mas` son del shell y no de ninguna pieza. La regla es explícita:
 * *sube al base y se acepta que viaje siempre — no se hereda de una pieza a otra*.
 *
 * ⚠️ `footer .mas` y `footer .tecnica` llevan el `margin-bottom:6px` ya resuelto: venía del
 * `footer p{margin:0 0 6px}` global, que dejó de existir porque estilaba también los `<p>` de las
 * piezas `contacto` y `locales`. El valor computado es idéntico; lo que se fue es el selector global.
 *
 * **`footer .mas a`** es del shell y no de una pieza (lo emite `shell.ts`), así que su estilo vive
 * acá: sin él, el enlace al blog sale con el azul del navegador igual que salían los `tel:` del pie.
 *
 * **El `@media` oscuro del base** reescribe la capa semántica y las primitivas compartidas; cada
 * pieza es dueña del suyo (§3.5) y acá solo está lo que no tiene otro dueño. Dos decisiones dentro:
 *
 *  - los neutros (`--fg`, `--titulo`, `--bg`, `--soft`) **no** salen de la marca en oscuro. El manual
 *    describe la paleta CLARA, y aplicarla sobre negro es exactamente la ilegibilidad que el arreglo
 *    viene a cerrar. Lo cromático sí viaja: el acento, corregido;
 *  - `--acento-legible` y `--decorativo` se derivan con `color-mix` **en CSS** (enmienda 2026-08-02):
 *    los dos son la misma decisión —un color de marca pensado para fondo claro, aclarado para que siga
 *    leyéndose sobre negro— y por eso viven en el mismo `@supports`. En TypeScript
 *    sería una segunda copia de la paleta que se desincroniza. Va bajo `@supports` porque sin él, un
 *    navegador sin `color-mix` deja el token inválido en tiempo de cómputo y el precio **pierde su
 *    color de acento**: `color` es heredada, así que caería al `--fg` del cuerpo. No es "no se vería
 *    de ningún color" —eso decía esta frase y una revisión lo corrigió—, pero sigue siendo una
 *    regresión: se pierde justo lo que el arreglo aporta. Con el `@supports`, ese navegador se queda
 *    con el acento pleno de `:root`, o sea con el comportamiento de hoy. Un test lo fija.
 */
const CSS_BASE = `*{box-sizing:border-box}
body{margin:0;font:16px/1.6 var(--font);color:var(--fg);background:var(--bg)}
img{max-width:100%;height:auto}
main{max-width:var(--ancho-pagina);margin:0 auto;padding:0 20px}
.pending{color:var(--muted);font-style:italic}
/* ── El patrón de SECCIÓN, compartido por todas las piezas de contenido (§3.6: sube al base lo que
   necesitan dos o más). Son tres primitivas y nada más:

     .seccion     el aire vertical, y '.alt' para el fondo alterno que da ritmo a la página
     .banda       el ancho de página con su respiro lateral
     .encabezado  antetítulo en color de marca + título grande, centrado

   ⚠️ El h2 del encabezado NO declara font-weight, y es la misma razón que en los titulares de las
   piezas: se precarga un solo archivo de la fuente de titulares, el de peso 700, que es el que un
   h2 hereda del navegador. El antetítulo sí lo declara porque es un párrafo —heredaría 400— y 500 es
   un peso que la familia sirve de verdad. */
.seccion{padding:var(--pad-seccion) 0}
.seccion.alt{background:var(--soft)}
.banda{max-width:var(--ancho-pagina);margin:0 auto;padding:0 20px}
.encabezado{text-align:center;max-width:var(--ancho-lectura);margin:0 auto clamp(32px,4vw,56px)}
.encabezado .antetitulo{font-family:var(--fuente-titulo);font-size:1.15rem;font-weight:500;color:var(--acento-legible);text-transform:uppercase;letter-spacing:1px;margin:0 0 10px}
.encabezado h2{font-family:var(--fuente-titulo);font-size:clamp(1.9rem,1.1rem + 2.4vw,3.44rem);line-height:1.2;margin:0;color:var(--titulo)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:8px}
.card{display:block;text-decoration:none;color:var(--fg);border:1px solid #e7e5e0;border-radius:12px;padding:20px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--acento-legible);transform:translateY(-2px)}
.card h3{margin:0;font-size:1.1rem;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
footer{max-width:var(--ancho-lectura);margin:40px auto 48px;padding:24px 20px 0;border-top:1px solid #eee;color:var(--fg)}
footer .mas{margin:12px 0 6px}
footer .mas a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted)}
footer .tecnica{color:var(--muted);font-size:.85rem;margin:20px 0 6px}
`;

/**
 * El modo oscuro del base. **Solo viaja con `brand.tema: "auto"`** (ver `ensamblarCss`).
 *
 * Vivía dentro de `CSS_BASE`, y mientras estuvo ahí el tema del sitio de un cliente lo decidía el
 * sistema operativo del visitante — con el efecto de que la paleta de la ficha (el crema `#fffdf9`
 * de un restaurante) se sustituía por `#111` sin que nada pudiera evitarlo. Ver `BrandTheme.tema`.
 */
const CSS_BASE_OSCURO = `@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--titulo:#e8e8e8;--muted:#9aa0aa;--bg:#111;--soft:#1b1b1b}body{background:var(--bg)}footer{border-color:#222}.card{border-color:#2a2a2a}@supports(color:color-mix(in srgb,red,#fff)){:root{--acento-legible:color-mix(in srgb,var(--marca-primario) 60%,#fff);--decorativo:color-mix(in srgb,var(--marca-secundario) 55%,#fff)}}}
`;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexValido(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v) ? v : null;
}

/**
 * Un nombre de fuente contra la allowlist. Devuelve **el nombre del rol**, no el stack: el rol es lo
 * que hace falta para decidir además qué `@font-face` viaja y qué archivo se precarga.
 *
 * `Object.hasOwn` y no `in`: `in` recorre la cadena de prototipos, así que `"toString" in FONT_STACKS`
 * es `true` y un `brand.font` con ese valor habría metido el código de una función dentro del
 * `<style>`. En PROD el perfil puede llegar de Storyblok **sin pasar por Zod**, así que el
 * renderizador no puede apoyarse en que el valor ya venga de la allowlist.
 */
function rolValido<K extends string>(mapa: Record<K, string>, v: unknown): K | null {
  return typeof v === "string" && Object.hasOwn(mapa, v) ? (v as K) : null;
}

/**
 * Los tres roles tipográficos de una ficha, ya validados: `[nombre del token, rol]`.
 *
 * **Una sola resolución para los tres consumidores** —los tokens `--marca-fuente-*`, las `@font-face`
 * que viajan y el archivo que se precarga—. Repetir la resolución en cada uno es cómo se llega a que
 * el token diga Oswald y el `@font-face` no viaje, o a precargar una familia que la página no usa.
 *
 * La resolución legacy→nuevo se hace acá: si la ficha trae las dos formas gana la específica
 * (`fuentes.texto` sobre `font`), porque la nueva es una decisión explícita y la vieja es herencia.
 */
function rolesResueltos(brand: BrandTheme): Array<[string, FuenteNombre]> {
  const f = brand.fuentes;
  const pares: Array<[string, FuenteNombre | null]> = [
    ["titulo", rolValido(FUENTE_STACKS, f?.titulo)],
    // El legacy `font` se valida contra su PROPIA allowlist de tres nombres, no contra la de siete:
    // que el campo viejo acepte de pronto `condensada` sería ampliar en silencio un contrato cerrado.
    ["texto", rolValido(FUENTE_STACKS, f?.texto) ?? rolValido(FONT_STACKS, brand.font)],
    ["decorativa", rolValido(FUENTE_STACKS, f?.decorativa)],
  ];
  return pares.filter((p): p is [string, FuenteNombre] => p[1] !== null);
}

/**
 * El rol con el que se pintan los **titulares**, o `null` si la ficha no dice nada.
 *
 * ⚠️ No es `fuentes.titulo` a secas. El CSS base declara
 * `--marca-fuente-titulo:var(--marca-fuente-texto)`, así que **sin `titulo` los titulares heredan la
 * fuente del cuerpo** — eso existe para que una ficha legacy con `font: serif` no vea su cuerpo en
 * Georgia y sus titulares en system-ui. Quien decide qué precargar tiene que seguir la misma cadena, o
 * dejaría sin preload justo al caso más común: la ficha a medio llenar.
 */
export function rolDeTitulares(brand?: BrandTheme | null): FuenteNombre | null {
  if (!brand) return null;
  const roles = new Map(rolesResueltos(brand));
  return roles.get("titulo") ?? roles.get("texto") ?? null;
}

/**
 * Traduce el tema de marca a CSS, **revalidando cada valor** aunque ya lo haya validado Zod: en PROD
 * el perfil puede venir de Storyblok sin pasar por `parseProfile`, así que el renderizador no confía.
 * Lo que no valida, lo descarta → cae al default. Un color inválido no rompe la página, la deja sobria.
 *
 * **La resolución legacy→nuevo se hace acá, en la emisión** (enmienda 2026-08-02): si una ficha trae
 * las dos formas gana la específica (`colores.primario` sobre `color`), porque la nueva es una
 * decisión explícita y la vieja es herencia. `perfilValido` conserva ambas a propósito.
 *
 * ⚠️ **Solo se emiten los `--marca-*`** (entrega 3). Hasta la entrega 2 esta función emitía además
 * `--accent`/`--font` desde el legacy, y eso era justo lo que impedía que el manual ganara: al ir
 * después de la capa semántica del base, el `--accent` legacy pisaba `var(--marca-primario)` por
 * cascada y `colores.primario` no llegaba nunca a un píxel. Hoy el legacy entra por donde entra todo
 * lo demás —alimentando `--marca-primario`/`--marca-fuente-texto` cuando el manual no dice nada— y
 * una ficha `{color, font}` se sigue viendo idéntica porque los defaults del base son los de hoy.
 */
export function tokensDeMarca(brand?: BrandTheme | null): string {
  if (!brand) return "";
  const reglas: string[] = [];

  const c = brand.colores;
  const colores: Array<[string, unknown]> = [
    ["primario", c?.primario ?? brand.color],
    ["secundario", c?.secundario],
    ["titulo", c?.titulo],
    ["texto", c?.texto],
    ["fondo", c?.fondo],
    ["fondo-alt", c?.fondoAlt],
  ];
  for (const [nombre, valor] of colores) {
    const hex = hexValido(valor);
    if (hex) reglas.push(`--marca-${nombre}:${hex}`);
  }

  for (const [nombre, rol] of rolesResueltos(brand)) {
    reglas.push(`--marca-fuente-${nombre}:${FUENTE_STACKS[rol]}`);
  }

  return reglas.length ? `\n:root{${reglas.join(";")}}` : "";
}

/**
 * El `<style>` del documento.
 *
 * `usadas` llega **ya filtrado y en orden de catálogo** (lo arma el ensamblador del shell). Acá solo
 * se concatena: tokens → overrides de marca → `@font-face` → base → piezas.
 *
 * **Las `@font-face` salen de `brand`, no de un parámetro nuevo**: los roles que la ficha pide son
 * exactamente los que ya se resolvieron para los tokens, y pedirlos por separado abriría la puerta a
 * que el token diga Oswald y la `@font-face` no viaje. Mismo criterio que el CSS de las piezas: una
 * página que no pide `script` no paga sus 25 KB — y una ficha sin familias propias no emite ni un byte
 * de `@font-face` (`cssDeFuentes` devuelve `""`).
 *
 * El determinismo se conserva: `cssDeFuentes` emite en orden de `FAMILIAS`, no en orden de uso, así
 * que dos páginas con la misma ficha producen el mismo `<style>` byte a byte.
 */
export function ensamblarCss(usadas: readonly Pieza[], brand?: BrandTheme | null): string {
  const fuentes = brand ? cssDeFuentes(rolesResueltos(brand).map(([, rol]) => rol)) : "";
  // **El tema es una decisión de la ficha, no del sistema operativo del visitante** (ver
  // `BrandTheme.tema`). Solo `"auto"` —explícito— hace viajar el CSS oscuro; cualquier otra cosa,
  // incluido un valor inventado o la ausencia del campo, sirve el sitio claro. Se compara contra el
  // literal en vez de `!== "claro"` justamente para que un typo caiga del lado seguro.
  const oscuro =
    brand?.tema === "auto" ? CSS_BASE_OSCURO + usadas.map((p) => p.cssOscuro ?? "").join("") : "";
  return (
    CSS_TOKENS +
    tokensDeMarca(brand) +
    fuentes +
    "\n" +
    CSS_BASE +
    usadas.map((p) => p.css).join("") +
    oscuro
  );
}
