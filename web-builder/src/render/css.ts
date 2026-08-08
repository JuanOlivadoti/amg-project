import type { BrandTheme, FuenteNombre } from "../types.js";
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
 * Familias tipográficas seguras, por nombre. La marca elige un nombre, NUNCA escribe el stack:
 * un stack en la ficha del cliente sería texto libre entrando a un `<style>`.
 *
 * Estas tres son las LEGACY (`brand.font`), y siguen alimentando `--font` exactamente como antes.
 */
const FONT_STACKS: Record<NonNullable<BrandTheme["font"]>, string> = {
  sistema: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  moderna: "'Helvetica Neue',Arial,sans-serif",
};

/**
 * Los siete roles del manual de marca (enmienda 2026-08-02).
 *
 * Los cuatro nombres nuevos caen a stacks del **sistema** a propósito: las familias self-hosted
 * (`/_assets/fonts/…`, subset latino, `woff2`) son la entrega 3, y meterlas acá arrastraría una ruta
 * pública nueva en el proceso anónimo dentro de una entrega cuyo criterio es "no cambiar cómo se ve
 * el sitio". Cambiar qué familia hay detrás de `condensada` sigue siendo un cambio de código
 * revisado, nunca una edición de fichas de clientes.
 */
const FUENTE_STACKS: Record<FuenteNombre, string> = {
  sistema: FONT_STACKS.sistema,
  serif: FONT_STACKS.serif,
  moderna: FONT_STACKS.moderna,
  condensada: "'Arial Narrow','Roboto Condensed',system-ui,sans-serif",
  geometrica: "'Century Gothic','Futura',system-ui,sans-serif",
  humanista: "'Segoe UI','Optima',system-ui,sans-serif",
  script: "'Brush Script MT',cursive",
};

/**
 * Los tokens. **Los `:root` son del base y solo del base** (§3.6): una pieza que declarara un token
 * que otra consume rompería la composición, y es el motivo por el que `aislamiento.ts` lo prohíbe.
 *
 * Los `--marca-*` son el manual de marca de la enmienda 2026-08-02, **emitidos con los valores
 * actuales como default y sin que nada los consuma todavía**. Es deliberado: si `colores.primario`
 * pisara `--accent`, una ficha con manual cambiaría de aspecto en esta entrega y el criterio de
 * paridad dejaría de ser exigible. El uso real de los tokens es la entrega 3.
 *
 * El mapeo de los defaults a lo que hoy existe: primario ← `--accent`, secundario ← `--muted`,
 * titulo/texto ← `--fg`, fondo ← `--bg`, fondoAlt ← `--soft`.
 */
const CSS_TOKENS =
  `\n:root{--fg:#1a1a1a;--muted:#6b7280;--accent:#b91c1c;--bg:#fff;--soft:#f8f7f5;--font:${FONT_STACKS.sistema}}` +
  `\n:root{--marca-primario:#b91c1c;--marca-secundario:#6b7280;--marca-titulo:#1a1a1a;--marca-texto:#1a1a1a;` +
  `--marca-fondo:#fff;--marca-fondo-alt:#f8f7f5;--marca-fuente-titulo:${FONT_STACKS.sistema};` +
  `--marca-fuente-texto:${FONT_STACKS.sistema};--marca-fuente-decorativa:${FONT_STACKS.sistema}}`;

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
 */
const CSS_BASE = `*{box-sizing:border-box}
body{margin:0;font:16px/1.6 var(--font);color:var(--fg);background:var(--bg)}
img{max-width:100%;height:auto}
main{max-width:760px;margin:0 auto;padding:0 20px}
.pending{color:var(--muted);font-style:italic}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:8px}
.card{display:block;text-decoration:none;color:var(--fg);border:1px solid #e7e5e0;border-radius:12px;padding:20px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card h3{margin:0;font-size:1.1rem;letter-spacing:-.01em}
footer{max-width:760px;margin:40px auto 48px;padding:24px 20px 0;border-top:1px solid #eee;color:var(--fg)}
footer .mas{margin:12px 0 6px}
footer .tecnica{color:var(--muted);font-size:.85rem;margin:20px 0 6px}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--muted:#9aa0aa;--bg:#111;--soft:#1b1b1b}body{background:var(--bg)}footer{border-color:#222}.card{border-color:#2a2a2a}}
`;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexValido(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v) ? v : null;
}

/**
 * Un nombre de fuente contra la allowlist.
 *
 * `Object.hasOwn` y no `in`: `in` recorre la cadena de prototipos, así que `"toString" in FONT_STACKS`
 * es `true` y un `brand.font` con ese valor habría metido el código de una función dentro del
 * `<style>`. En PROD el perfil puede llegar de Storyblok **sin pasar por Zod**, así que el
 * renderizador no puede apoyarse en que el valor ya venga de la allowlist.
 */
function fuenteValida<K extends string>(mapa: Record<K, string>, v: unknown): string | null {
  return typeof v === "string" && Object.hasOwn(mapa, v) ? mapa[v as K] : null;
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
 * Lo que NO se hace, y es lo que mantiene exigible la paridad de esta entrega: `colores.primario`
 * **no** pisa `--accent`, ni `fuentes.texto` pisa `--font`. Esos dos siguen siendo legacy puro. El
 * manual se emite en su propio juego de tokens (`--marca-*`) que todavía nadie consume.
 */
export function tokensDeMarca(brand?: BrandTheme | null): string {
  if (!brand) return "";
  const reglas: string[] = [];

  // --- lo legacy, intacto: es lo que pinta el sitio HOY y lo que el gate de paridad mide.
  const accent = hexValido(brand.color);
  if (accent) reglas.push(`--accent:${accent}`);
  const font = fuenteValida(FONT_STACKS, brand.font);
  if (font) reglas.push(`--font:${font}`);

  // --- el manual de marca: emitido, aún sin consumir.
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

  const f = brand.fuentes;
  const fuentes: Array<[string, unknown]> = [
    ["titulo", f?.titulo],
    ["texto", f?.texto ?? brand.font],
    ["decorativa", f?.decorativa],
  ];
  for (const [nombre, valor] of fuentes) {
    const stack = fuenteValida(FUENTE_STACKS, valor);
    if (stack) reglas.push(`--marca-fuente-${nombre}:${stack}`);
  }

  return reglas.length ? `\n:root{${reglas.join(";")}}` : "";
}

/**
 * El `<style>` del documento.
 *
 * `usadas` llega **ya filtrado y en orden de catálogo** (lo arma el ensamblador del shell). Acá solo
 * se concatena: tokens → overrides de marca → base → piezas.
 */
export function ensamblarCss(usadas: readonly Pieza[], brand?: BrandTheme | null): string {
  return CSS_TOKENS + tokensDeMarca(brand) + "\n" + CSS_BASE + usadas.map((p) => p.css).join("");
}
