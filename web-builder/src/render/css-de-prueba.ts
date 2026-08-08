/**
 * Un lector de CSS **para los tests**: reglas, declaraciones y resolución de `var()`.
 *
 * Existe porque los tres gates que la entrega 3 añade no se pueden escribir con `includes()` sobre el
 * `<style>`:
 *
 *  - **el consumo de un token** es una *cadena* (`colores.primario` → `--marca-primario` → `--accent`
 *    → `background` de `.p-hero .cta`). Un test que solo mire si el token se emite prueba la mitad de
 *    arriba y deja la de abajo sin dueño, que es exactamente lo que pasó en la entrega 2: los nueve
 *    tokens salían al `<style>` y **nadie los consumía**, con los tests en verde;
 *  - **el modo oscuro completo** es una relación entre dos partes del mismo CSS (lo que se declara
 *    claro y lo que se redeclara oscuro), no una cadena de texto;
 *  - **que una pieza no consuma una variable que nadie declara** exige separar consumo de declaración.
 *
 * Vive fuera de un `*.test.ts` por lo mismo que `ctx-de-prueba.ts`: lo comparten varios archivos de
 * test. **No lo importa nada de `src` que llegue a producción.**
 */

export interface Regla {
  selector: string;
  /** `propiedad → valor`, con la última declaración ganando (como el navegador). */
  declaraciones: Record<string, string>;
  /** ¿Está dentro de un `@media (prefers-color-scheme: dark)`? */
  oscuro: boolean;
}

const ES_OSCURO = /prefers-color-scheme\s*:\s*dark/i;

/**
 * Las reglas de una hoja, **entrando dentro de las at-rules condicionales** y marcando cuáles caen
 * bajo un media query oscuro.
 *
 * Es el mismo recorrido que `aislamiento.ts` hace sobre los selectores; acá además se guardan las
 * declaraciones y el contexto oscuro. Los dos parsers se parecen a propósito y no se fusionan: el de
 * `aislamiento.ts` es código de producción con un contrato propio (§3) y este es de test.
 */
export function reglasDe(css: string): Regla[] {
  const salida: Regla[] = [];
  recorrer(css.replace(/\/\*[\s\S]*?\*\//g, " "), false);
  return salida;

  function recorrer(texto: string, oscuro: boolean): void {
    let i = 0;
    let prelude = "";
    while (i < texto.length) {
      const ch = texto[i]!;
      if (ch === "{") {
        const bloque = leerBloque(texto, i);
        const p = prelude.trim();
        if (p.startsWith("@")) {
          if (/^@(media|supports|container|layer|scope)\b/i.test(p)) {
            recorrer(bloque.contenido, oscuro || ES_OSCURO.test(p));
          }
        } else if (p) {
          const declaraciones = declaracionesDe(bloque.contenido);
          for (const s of p.split(",")) {
            const limpio = s.trim();
            if (limpio) salida.push({ selector: limpio, declaraciones, oscuro });
          }
        }
        i = bloque.fin;
        prelude = "";
        continue;
      }
      if (ch === ";" && prelude.trim().startsWith("@")) {
        prelude = "";
        i++;
        continue;
      }
      prelude += ch;
      i++;
    }
  }
}

function leerBloque(texto: string, abre: number): { contenido: string; fin: number } {
  let profundidad = 0;
  for (let i = abre; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === "{") profundidad++;
    else if (ch === "}") {
      profundidad--;
      if (profundidad === 0) return { contenido: texto.slice(abre + 1, i), fin: i + 1 };
    }
  }
  return { contenido: texto.slice(abre + 1), fin: texto.length };
}

/**
 * `prop:valor` separados por `;`, contando paréntesis.
 *
 * Los paréntesis importan desde que existe `color-mix(in srgb, var(--x) 60%, #fff)`: partir por comas
 * o por dos puntos sin contar paréntesis rompe justo el valor que la entrega 3 introduce.
 */
function declaracionesDe(cuerpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  let profundidad = 0;
  let actual = "";
  const trozos: string[] = [];
  for (const ch of cuerpo) {
    if (ch === "(") profundidad++;
    else if (ch === ")") profundidad--;
    if (ch === ";" && profundidad === 0) {
      trozos.push(actual);
      actual = "";
      continue;
    }
    actual += ch;
  }
  trozos.push(actual);

  for (const trozo of trozos) {
    const t = trozo.trim();
    if (!t) continue;
    const corte = indiceDelPrimerDosPuntos(t);
    if (corte < 0) continue;
    out[t.slice(0, corte).trim()] = t.slice(corte + 1).trim();
  }
  return out;
}

function indiceDelPrimerDosPuntos(t: string): number {
  let profundidad = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") profundidad++;
    else if (ch === ")") profundidad--;
    else if (ch === ":" && profundidad === 0) return i;
  }
  return -1;
}

export type Modo = "claro" | "oscuro";

/**
 * El mapa de tokens del `:root` tal como lo vería el navegador en ese modo: en orden de aparición,
 * la última declaración gana, y en modo `claro` se ignora todo lo que esté bajo un media query oscuro.
 */
export function tokensDe(css: string, modo: Modo = "claro"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of reglasDe(css)) {
    if (r.selector !== ":root") continue;
    if (r.oscuro && modo === "claro") continue;
    for (const [prop, valor] of Object.entries(r.declaraciones)) {
      if (prop.startsWith("--")) out[prop] = valor;
    }
  }
  return out;
}

/**
 * Sustituye las `var(--x)` de un valor hasta el fondo. Es LO QUE PRUEBA que el valor del cliente
 * llega: si alguien corta un eslabón de la cadena, acá queda un `var(--…)` sin resolver o el default.
 */
export function resolverVars(valor: string, tokens: Record<string, string>, vueltas = 10): string {
  let v = valor;
  for (let i = 0; i < vueltas && v.includes("var("); i++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g, (todo, nombre: string, fallback?: string) => {
      const t = tokens[nombre];
      if (t !== undefined) return t;
      return fallback !== undefined ? fallback.trim() : todo;
    });
  }
  return v;
}

/** El valor FINAL de un token, con la cadena de `var()` ya resuelta. */
export function tokenResuelto(css: string, token: string, modo: Modo = "claro"): string {
  const tokens = tokensDe(css, modo);
  const bruto = tokens[token];
  return bruto === undefined ? "" : resolverVars(bruto, tokens);
}

/**
 * El valor final de una propiedad de un selector concreto, resolviendo sus `var()` contra el `:root`.
 *
 * Es la mitad de abajo de la cadena: `.p-hero .cta` + `background` → el hex que puso el cliente.
 */
export function propiedadResuelta(
  css: string,
  selector: string,
  propiedad: string,
  modo: Modo = "claro",
): string | undefined {
  const tokens = tokensDe(css, modo);
  let bruto: string | undefined;
  for (const r of reglasDe(css)) {
    if (r.selector !== selector) continue;
    if (r.oscuro && modo === "claro") continue;
    const v = r.declaraciones[propiedad];
    if (v !== undefined) bruto = v; // la última gana, como en la cascada
  }
  return bruto === undefined ? undefined : resolverVars(bruto, tokens);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo oscuro: el detector de huecos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Palabras clave de color que **no dependen del modo**: no exigen contrapartida oscura porque no
 * fijan ningún tono. Sin esta lista, `border-bottom:2px solid transparent` del nav sería un falso
 * positivo y el detector acabaría desactivado — un detector desactivado no protege a nadie.
 */
const COLORES_NEUTROS = new Set(["transparent", "currentcolor", "inherit", "initial", "unset", "none"]);

const NOMBRADOS = /\b(white|black|red|blue|green|gray|grey|silver|orange|yellow|purple|brown)\b/i;

/** ¿El valor fija un color LITERAL (no un token)? */
export function tieneColorLiteral(valor: string): boolean {
  const v = valor.toLowerCase();
  if (COLORES_NEUTROS.has(v.trim())) return false;
  if (/#[0-9a-f]{3,8}\b/.test(v)) return true;
  if (/\b(rgba?|hsla?|lab|lch|oklab|oklch)\s*\(/.test(v)) return true;
  return NOMBRADOS.test(v.replace(/\bvar\([^)]*\)/g, " "));
}

/**
 * La **familia** de la propiedad, para poder emparejar el claro con el oscuro.
 *
 * Emparejar por nombre exacto no sirve: el claro escribe `border-bottom:1px solid #f0f0f0` y el
 * oscuro escribe `border-color:#1e1e1e`. Son la misma decisión visual con dos nombres, y un detector
 * que pidiera el mismo nombre denunciaría todas las piezas que HOY están bien.
 */
function familiaDe(propiedad: string): string | null {
  if (/^border/.test(propiedad) || /^outline/.test(propiedad)) return "borde";
  if (/^background/.test(propiedad)) return "fondo";
  if (propiedad === "color") return "color";
  if (/shadow$/.test(propiedad)) return "sombra";
  return null;
}

/**
 * Los colores literales del modo claro que **nadie redeclara en oscuro**, en prosa.
 *
 * Es el bug que abre la spec, convertido en detector: `.p-carta li` (`#f5f4f2`) y `.p-faq details`
 * (`#e7e5e0`) salían casi blancos sobre negro porque el `@media` oscuro central nunca los nombró, y
 * nadie lo notó durante meses. Un detector que recorra el catálogo lo hace imposible **para las
 * piezas que todavía no existen**, que es lo que una lista escrita a mano no puede hacer.
 */
export function huecosDeModoOscuro(css: string): string[] {
  const claro = new Map<string, Set<string>>();
  const oscuro = new Set<string>();

  for (const r of reglasDe(css)) {
    for (const [prop, valor] of Object.entries(r.declaraciones)) {
      if (prop.startsWith("--")) continue; // los tokens son del base y su oscuro está a su lado
      const familia = familiaDe(prop);
      if (!familia) continue;
      if (!tieneColorLiteral(valor)) continue;
      const clave = `${r.selector}|${familia}`;
      if (r.oscuro) oscuro.add(clave);
      else claro.set(clave, (claro.get(clave) ?? new Set()).add(prop));
    }
  }

  const problemas: string[] = [];
  for (const [clave, props] of claro) {
    if (oscuro.has(clave)) continue;
    const [selector = "", familia = ""] = clave.split("|");
    problemas.push(
      `«${selector}» fija un color literal en ${[...props].join(", ")} y no lo redeclara en ` +
        `@media(prefers-color-scheme:dark). En oscuro ese ${familia} se ve como en claro — que es ` +
        `el bug de \`.carta li\` y \`details\`, exactamente.`,
    );
  }
  return problemas;
}

/** Las variables que un CSS **consume** (`var(--x)`), sin las que declara. */
export function varsConsumidas(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]!);
  return out;
}
