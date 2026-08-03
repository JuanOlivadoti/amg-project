# Navegación del sitio del cliente — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la barra de navegación derivada de "todas las páginas publicadas" (que hace que
el sitio de un restaurante parezca el índice de un blog) por secciones fijas del sitio —
Inicio · Menú · Ubicaciones · Contacto— con un footer NAP compartido, una página `/menu` y un índice
`/blog`.

**Architecture:** El nav de arriba pasa a derivarse del `BusinessProfile` en vez de la Links API de
Storyblok. El contacto sale de `<main>` y se convierte en un footer compartido presente en todas las
páginas, ahora multi-local. `/menu` y `/blog` son **páginas sintetizadas** (HTML directo del perfil,
sin LLM y sin story en Storyblok), siguiendo el patrón que ya existe para la home cuando no hay story
`home` publicada. Las landings de research siguen publicadas y enlazadas desde el índice de la home;
las páginas `Article` se agrupan en `/blog`.

**Tech Stack:** TypeScript ESM strict + `noUncheckedIndexedAccess`, `tsx` sin paso de build, tests
con `node:test` + `node:assert`. Paquetes tocados: `web-builder` (render y contrato) y `renderer`
(validación del perfil, CDA y ruteo).

## Global Constraints

- **Nombres de dominio en español** (`localesDe`, `carta`, `navPrincipal`). Los comentarios explican
  **por qué**, no qué — sobre todo la decisión de seguridad o la trampa que se evita.
- **Rojo primero**: se escribe el test que falla, se corre para verlo fallar, recién después la
  implementación. Los tests prueban el **contrato**, no la implementación.
- **Todo valor que termine en el HTML es superficie de inyección**: pasa por `esc()`. En producción
  el perfil llega de una columna `jsonb` sin pasar por Zod — el renderizador **revalida** (defensa en
  profundidad, ADR-19).
- **Un enhancement no puede tumbar la página que enriquece**: si la llamada de blog falla, la página
  se sirve sin el link, nunca un 503. Mismo criterio que la nav hoy.
- **Verificación real antes de cerrar**: `npm test` y `npm run typecheck` desde la raíz, con el output
  a la vista. Para el renderizador, además, **manejar la app en un navegador** (MCP chrome-devtools).
- Commits en español, terminando con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No inventar datos del negocio.** Si falta un código postal o un teléfono, el campo se omite — no
  se rellena con algo plausible.

## Enmiendas al spec detectadas al planificar

Tres cosas que el spec
([2026-07-31-navegacion-sitio-cliente-design.md](../specs/2026-07-31-navegacion-sitio-cliente-design.md))
no contemplaba y que este plan resuelve:

1. **`perfilValido` (renderer) descarta lo que no conoce.** Reconstruye el perfil campo por campo, así
   que `locations` y `menu` **se perderían en producción** aunque estuvieran en la base — es
   exactamente el bug que su propio comentario documenta sobre `brand`. Task 6 lo cubre. Sin esa
   tarea, todo lo demás funciona en los tests de `web-builder` y no funciona en la web real.
2. **`postalCode` pasa a ser opcional en `PostalAddress`.** Hoy es obligatorio y `perfilValido`
   descarta la dirección entera si falta. La Birra Bar no tiene códigos postales confirmados (el
   usuario pidió publicar sin ellos), así que exigirlo obligaría a inventarlos. Se relaja el tipo, el
   Zod, el validador del renderizador y el render — que ya no puede leerlo sin comprobar.
3. **El índice de la home excluye las páginas de blog.** Si no, un post aparecería en las tarjetas de
   la home *y* en `/blog` — la duplicación que este trabajo viene a evitar.

---

## Estructura de archivos

| Archivo | Responsabilidad | Cambio |
| --- | --- | --- |
| `web-builder/src/types.ts` | Tipos del contrato de render | Agrega `Location`, `MenuItem`; extiende `BusinessProfile`; `postalCode` opcional |
| `web-builder/src/contract.ts` | Validación Zod en la puerta del paquete | Esquemas de los tipos nuevos |
| `web-builder/src/render/html.ts` | Todo el HTML del sitio público | `navPrincipal`, `renderFooter`, `renderMenu`, `renderBlogIndex`; `renderNav` reescrito; `renderContact` sale de `<main>` |
| `web-builder/src/index.ts` | Superficie pública del paquete | Exporta lo nuevo |
| `web-builder/src/fixtures.ts` | Datos de prueba compartidos | `validProfile` acepta los campos nuevos (ya lo hace vía `over`) |
| `renderer/src/perfil.ts` | Revalida el perfil que sale de la base | Deja pasar `locations` y `menu`, acotados |
| `renderer/src/cda.ts` | Cliente de la Content Delivery API | `traerBlog` + `normalizarStories` + soporte en `MockCda` |
| `renderer/src/app.ts` | Ruteo y caches del renderizador | Rutas `/menu` y `/blog`, cache de blog, invalidación por webhook |
| `web-builder/business-profile.json` | Perfil del cliente de la demo | Datos reales de La Birra Bar |

---

### Task 1: Modelo de datos — `Location`, `MenuItem`, `postalCode` opcional

**Files:**
- Modify: `web-builder/src/types.ts:168-195`
- Modify: `web-builder/src/contract.ts:97-137`
- Test: `web-builder/src/contract.test.ts`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: `interface Location { name?: string; address?: PostalAddress; telephone?: string;
  opening_hours?: string }`, `interface MenuItem { category?: string; name: string;
  description?: string; price?: string }`, `BusinessProfile.locations?: Location[]`,
  `BusinessProfile.menu?: MenuItem[]`, y `PostalAddress.postalCode?: string` (antes obligatorio).

- [ ] **Step 1: Escribir el test que falla**

En `web-builder/src/contract.test.ts`, al final:

```ts
test("perfil: acepta varios locales y una carta", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
        opening_hours: "Lun-Dom 11:00-01:00",
      },
    ],
    menu: [{ category: "Hamburguesas", name: "Golden Burger", price: "12,50 €" }],
  });
  assert.equal(p.locations?.length, 1);
  assert.equal(p.locations?.[0]?.name, "Centro");
  assert.equal(p.menu?.[0]?.name, "Golden Burger");
});

test("perfil: una dirección sin código postal es válida (no se inventa el dato)", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
  });
  assert.equal(p.address?.postalCode, undefined);
  assert.equal(p.address?.streetAddress, "Carrera de San Jerónimo 3");
});

test("🔴 perfil: un ítem de la carta sin nombre no pasa la puerta", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ price: "10 €" }] }),
    /business-profile\.json inválido/,
  );
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npm test -w web-builder 2>&1 | grep -A 5 "carta"`
Expected: FAIL — `parseProfile` rechaza `locations`/`menu` (claves desconocidas o `postalCode`
faltante).

- [ ] **Step 3: Extender los tipos**

En `web-builder/src/types.ts`, reemplazar el bloque `PostalAddress` (líneas 169-176) y agregar los
tipos nuevos justo después:

```ts
/** Dirección postal (schema.org PostalAddress). */
export interface PostalAddress {
  streetAddress: string;
  addressLocality: string;
  /**
   * Opcional a propósito: muchos negocios publican calle y ciudad, y nada más. Exigirlo obligaba a
   * inventarse un código postal para poder cargar el local — y un dato inventado en el JSON-LD es
   * peor que un dato ausente (misma decisión que el `null` de las métricas en kr.v0.4).
   */
  postalCode?: string;
  addressRegion?: string;
  addressCountry?: string; // ISO-3166-1 alpha-2
}

/**
 * Un local del negocio. Un restaurante puede tener varios y cada uno tiene su dirección y su horario.
 *
 * El perfil "clásico" (`address`/`telephone`/`opening_hours` sueltos en el `BusinessProfile`)
 * describe UN local y se sigue soportando: si no hay `locations`, el footer sintetiza uno con esos
 * campos. Por eso todo acá es opcional — un local que solo aporta horario sigue siendo útil.
 */
export interface Location {
  /** Nombre del local ("Centro", "Salamanca"). Es lo que distingue uno de otro cuando hay varios. */
  name?: string;
  address?: PostalAddress;
  telephone?: string;
  opening_hours?: string;
}

/**
 * Un ítem de la carta.
 *
 * `price` es **texto libre** a propósito ("12,50 €", "s/ mercado"): tipificarlo como número obligaría
 * a decidir moneda y formato acá, y lo único que hace falta es imprimir lo que escribió el cliente.
 */
export interface MenuItem {
  /** Agrupador ("Hamburguesas", "Cervezas"). Los ítems sin categoría se muestran juntos, al final. */
  category?: string;
  name: string;
  description?: string;
  price?: string;
}
```

Y dentro de `BusinessProfile`, antes de `brand`:

```ts
  /**
   * Los locales del negocio. Si está presente, MANDA sobre `address`/`telephone`/`opening_hours`
   * para el footer: un negocio multi-local no puede describirse con una sola dirección suelta.
   */
  locations?: Location[];
  /** La carta. Si tiene ítems, el nav muestra "Menú" y `/menu` se sirve. */
  menu?: MenuItem[];
```

- [ ] **Step 4: Extender el contrato Zod**

En `web-builder/src/contract.ts`, cambiar `postalAddressSchema` (línea 97) y agregar los dos
esquemas nuevos antes de `businessProfileSchema`:

```ts
const postalAddressSchema = z.object({
  streetAddress: z.string(),
  addressLocality: z.string(),
  // Opcional: ver el comentario en `PostalAddress`. Un código postal inventado es peor que ninguno.
  postalCode: z.string().optional(),
  addressRegion: z.string().optional(),
  addressCountry: z.string().optional(),
});

const locationSchema = z.object({
  name: z.string().optional(),
  address: postalAddressSchema.optional(),
  telephone: z.string().optional(),
  opening_hours: z.string().optional(),
});

/** `name` es lo único obligatorio: un ítem de carta sin nombre no se puede mostrar. */
const menuItemSchema = z.object({
  category: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
});
```

Y dentro de `businessProfileSchema`, antes de `brand`:

```ts
  locations: z.array(locationSchema).optional(),
  menu: z.array(menuItemSchema).optional(),
```

- [ ] **Step 5: Exportar los tipos nuevos**

En `web-builder/src/index.ts`, línea 15, agregar `Location` y `MenuItem` al `export type`:

```ts
export type { KrBrief, KrProposedPage, BusinessProfile, BrandTheme, Imagen, Location, MenuItem, NavItem, Story, Blok } from "./types.js";
```

- [ ] **Step 6: Correr los tests y el typecheck**

Run: `npm test -w web-builder && npm run typecheck`
Expected: PASS. **Ojo:** hacer `postalCode` opcional puede romper código que lo leía sin comprobar
(`postalAddressLd` y `renderContact` en `html.ts`, `direccion()` en `renderer/src/perfil.ts`). Si el
typecheck se queja, **no** lo silencies con `!`: los arreglos correctos llegan en las tasks 3 y 6. Si
falla algo en esta task, hacé condicional la lectura:

```ts
// en postalAddressLd (html.ts):
...(address.postalCode ? { postalCode: address.postalCode } : {}),
```

- [ ] **Step 7: Commit**

```bash
git add web-builder/src/types.ts web-builder/src/contract.ts web-builder/src/contract.test.ts web-builder/src/index.ts web-builder/src/render/html.ts
git commit -m "$(cat <<'EOF'
Web-builder: el perfil admite varios locales y una carta

`locations` y `menu` en BusinessProfile, con su Zod. `postalCode` pasa a opcional:
muchos negocios publican calle y ciudad nada más, y exigirlo obligaba a inventarse
el dato para poder cargar el local.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: El nav de arriba sale del perfil, no de las páginas publicadas

**Files:**
- Modify: `web-builder/src/render/html.ts:164-208` (`renderNav`, `MAX_NAV`), `:243-258`
  (`renderSiteHeader`), `:26-31` (firma de `renderStory`)
- Test: `web-builder/src/render/html.test.ts:139-189` (los tests de nav actuales se reemplazan)

**Interfaces:**
- Consumes: `BusinessProfile` con `menu`/`locations` (Task 1).
- Produces: `renderStory(story: Story, profile?: BusinessProfile | null, languageCode = "es",
  hayBlog = false): string` — **el 4º parámetro deja de ser `nav: NavItem[]` y pasa a ser
  `hayBlog: boolean`**. Constantes `SLUG_MENU = "menu"` y `SLUG_BLOG = "blog"` (module-scope, junto a
  `SLUG_HOME`).

- [ ] **Step 1: Escribir los tests que fallan**

En `web-builder/src/render/html.test.ts`, **borrar** los tests de nav de las líneas 139-189 (prueban
el comportamiento que se está reemplazando: la barra construida con las páginas publicadas) y poner
en su lugar:

```ts
test("nav: la barra son las secciones del sitio, no las páginas de research", () => {
  const perfil = validProfile({ menu: [{ name: "Golden Burger" }] });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.match(html, /<a href="\/"[^>]*>Inicio<\/a>/);
  assert.match(html, /<a href="\/menu"[^>]*>Menú<\/a>/);
  assert.match(html, /<a href="#ubicaciones"[^>]*>Ubicaciones<\/a>/);
  assert.match(html, /<a href="#contacto"[^>]*>Contacto<\/a>/);
  // Y NO el título SEO de la página, que es lo que la hacía parecer un blog.
  assert.ok(!/<nav[^>]*>[\s\S]*?Menú del día[\s\S]*?<\/nav>/.test(html));
});

test("nav: sin carta cargada no hay enlace a Menú (un enlace a una sección vacía es peor que ninguno)", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  assert.ok(!html.includes(">Menú<"));
  assert.match(html, /<a href="\/"[^>]*>Inicio<\/a>/);
});

test("nav: sin locales ni dirección no hay enlace a Ubicaciones", () => {
  const perfil = validProfile({ address: undefined, opening_hours: undefined, telephone: undefined });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.ok(!html.includes(">Ubicaciones<"));
});

test("nav: la sección actual se marca con aria-current", () => {
  const perfil = validProfile({ menu: [{ name: "Golden Burger" }] });
  const html = renderMenu(perfil, "es");
  assert.match(html, /<a href="\/menu"[^>]*aria-current="page"[^>]*>Menú<\/a>|<a href="\/menu" class="activo" aria-current="page">Menú<\/a>/);
});
```

> El último test usa `renderMenu`, que llega en la Task 4. **Dejalo escrito y comentado** con
> `// TODO(Task 4)` hasta entonces, o movelo a la Task 4 — lo que prefieras; no dejes un test roto
> commiteado.

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w web-builder 2>&1 | grep -B 2 -A 8 "secciones del sitio"`
Expected: FAIL — hoy la barra lleva los títulos de las páginas publicadas, no "Inicio/Menú/...".

- [ ] **Step 3: Reemplazar `renderNav` y `MAX_NAV`**

En `web-builder/src/render/html.ts`, borrar `MAX_NAV` (línea 189) y reemplazar `renderNav`
(líneas 164-186) por:

```ts
/** Los slugs de las páginas que sintetiza el renderizador (no viven en Storyblok salvo que el cliente las cree). */
const SLUG_MENU = "menu";
const SLUG_BLOG = "blog";

/** Un ítem del nav de arriba. `slug` solo lo tienen las secciones que SON una página (para `aria-current`). */
interface ItemNav {
  href: string;
  label: string;
  slug?: string;
}

/**
 * El nav de arriba: las **secciones del sitio**, derivadas del perfil.
 *
 * Antes se armaba con la lista de páginas publicadas (Links API), así que un sitio con 14 landings de
 * research mostraba 14 títulos SEO larguísimos: parecía el índice de un blog y no el sitio de un
 * restaurante. Las landings siguen publicadas y enlazadas —desde el índice de la home—, pero ya no
 * ocupan la barra.
 *
 * Cada ítem es **condicional al dato que lo hace útil**: sin carta no hay "Menú", sin locales ni
 * dirección no hay "Ubicaciones". Un enlace a una sección vacía es peor que no tener el enlace.
 */
function navPrincipal(profile: BusinessProfile): ItemNav[] {
  const items: ItemNav[] = [{ href: "/", label: "Inicio", slug: SLUG_HOME }];
  if (profile.menu && profile.menu.length > 0) {
    items.push({ href: `/${SLUG_MENU}`, label: "Menú", slug: SLUG_MENU });
  }
  // Ubicaciones y Contacto son ANCLAS al footer, no páginas: el footer está en todas las páginas, así
  // que el enlace funciona desde cualquiera sin cargar nada.
  if (hayUbicaciones(profile)) items.push({ href: "#ubicaciones", label: "Ubicaciones" });
  items.push({ href: "#contacto", label: "Contacto" });
  return items;
}

/** ¿Hay algo que mostrar en "Ubicaciones"? Locales explícitos, o los campos sueltos del perfil clásico. */
function hayUbicaciones(p: BusinessProfile): boolean {
  if (p.locations && p.locations.length > 0) return true;
  return Boolean(p.address || p.telephone || p.opening_hours);
}

function renderNav(items: ItemNav[], activeSlug: string): string {
  const html = items
    .map((it) => {
      const activo = it.slug !== undefined && it.slug === activeSlug;
      const attrs = activo ? ` class="activo" aria-current="page"` : "";
      return `<a href="${esc(it.href)}"${attrs}>${esc(it.label)}</a>`;
    })
    .join("");
  return `<nav class="nav" aria-label="Secciones del sitio">${html}</nav>`;
}
```

- [ ] **Step 4: Adaptar `renderSiteHeader`**

Reemplazar la firma y el cuerpo (líneas 243-258) por:

```ts
function renderSiteHeader(profile: BusinessProfile | null | undefined, activeSlug: string): string {
  // Sin perfil no hay sitio del que ser cabecera: una story renderizada suelta (un test, un preview
  // sin ficha cargada) sale sin barra, como hasta ahora.
  if (!profile) return "";
  const navHtml = renderNav(navPrincipal(profile), activeSlug);
  // El logo va a un `<img src>`: se exige http(s) acá también, no solo en Zod (en PROD el perfil
  // puede venir de Storyblok sin validar). Un logo dudoso cae al nombre, no rompe la cabecera.
  const logo = profile.brand?.logo;
  const logoOk = typeof logo === "string" && /^https?:\/\//i.test(logo);
  const marca = logoOk
    ? `<img class="logo" src="${esc(logo)}" alt="${esc(profile.name)}" height="40">`
    : `<span class="marca">${esc(profile.name)}</span>`;
  return `<header class="sitebar"><a href="/" class="brand">${marca}</a>${navHtml}</header>`;
}
```

- [ ] **Step 5: Cambiar la firma de `renderStory`**

En `renderStory` (líneas 26-31 y su llamada a `renderSiteHeader` en la 61): el 4º parámetro deja de
ser `nav` y pasa a ser `hayBlog`.

```ts
export function renderStory(
  story: Story,
  profile?: BusinessProfile | null,
  languageCode = "es",
  hayBlog = false,
): string {
```

Y la línea 61 pasa a `${renderSiteHeader(profile, story.slug)}`. `hayBlog` se usa recién en la
Task 3 (el footer); dejarlo declarado y sin usar rompe el build con `noUnusedParameters` si está
activo — si el typecheck se queja, seguí directo a la Task 3 en el mismo commit.

- [ ] **Step 6: Correr los tests**

Run: `npm test -w web-builder && npm run typecheck`
Expected: PASS. Los tests de `renderHome` no se tocan (sigue recibiendo `nav` para su índice).

- [ ] **Step 7: Commit**

```bash
git add web-builder/src/render/html.ts web-builder/src/render/html.test.ts
git commit -m "$(cat <<'EOF'
Web-builder: el nav de arriba son las secciones del sitio, no las landings

Se armaba con la Links API, así que un sitio con 14 landings de research mostraba
14 títulos SEO: parecía el índice de un blog. Ahora sale del perfil (Inicio, Menú,
Ubicaciones, Contacto) y cada ítem es condicional al dato que lo hace útil.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: El footer compartido (contacto + ubicaciones + blog)

**Files:**
- Modify: `web-builder/src/render/html.ts:205-208` (`footer`), `:299-310` (`renderContact`), `:66-68`
  y `:134-136` (las llamadas en `renderStory`/`renderHome`), `:447-481` (CSS)
- Test: `web-builder/src/render/html.test.ts`

**Interfaces:**
- Consumes: `Location` (Task 1), `SLUG_BLOG` (Task 2).
- Produces: `renderFooter(profile, contractVersion: string, schemaType: string, hayBlog: boolean):
  string` y `localesDe(profile: BusinessProfile): Location[]` (privadas al módulo).
  `renderHome(profile?, nav = [], languageCode = "es", hayBlog = false)` — 4º parámetro nuevo.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("footer: el contacto vive en el pie y está en todas las páginas", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  const pie = html.slice(html.indexOf("<footer"));
  assert.match(pie, /id="contacto"/);
  assert.match(pie, /Trattoria Bella Napoli/);
  // Y ya NO está dentro de <main>: era una sección repetida en cada landing.
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  assert.ok(!main.includes('id="contacto"'));
});

test("footer: lista todos los locales, cada uno con su dirección y horario", () => {
  const perfil = validProfile({
    locations: [
      { name: "Centro", address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" }, opening_hours: "11:00-01:00" },
      { name: "Salamanca", address: { streetAddress: "Ortega y Gasset 79", addressLocality: "Madrid" }, opening_hours: "hasta la 01:00" },
    ],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.match(html, /id="ubicaciones"/);
  assert.match(html, /Centro/);
  assert.match(html, /San Jerónimo 3/);
  assert.match(html, /Salamanca/);
  assert.match(html, /Ortega y Gasset 79/);
});

test("footer: un perfil clásico (sin locations) sigue mostrando su dirección", () => {
  // Compatibilidad hacia atrás: el negocio de un solo local no tiene que tocar su JSON.
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  assert.match(html, /id="ubicaciones"/);
  assert.match(html, /Calle Mayor 12/);
});

test("footer: sin páginas de blog no hay enlace al blog", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es", false);
  assert.ok(!/href="\/blog"/.test(html));
});

test("footer: con páginas de blog aparece el enlace, solo en el pie", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es", true);
  assert.match(html.slice(html.indexOf("<footer")), /href="\/blog"/);
  const cabecera = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.ok(!cabecera.includes('href="/blog"'));
});

test("🔴 footer: el nombre de un local se escapa (viene de la base, sin Zod)", () => {
  const perfil = validProfile({
    locations: [{ name: '</p><script>alert(1)</script>', opening_hours: "11:00" }],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("footer: sin perfil queda solo la línea técnica (falla suave)", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), null, "es");
  assert.match(html, /contrato web\.v0\.1/);
  assert.ok(!html.includes('id="contacto"'));
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w web-builder 2>&1 | grep -B 2 -A 8 "footer:"`
Expected: FAIL — hoy el contacto está en `<main>` y el footer solo tiene la línea técnica.

- [ ] **Step 3: Implementar el footer**

Reemplazar `footer()` (líneas 205-208) y `renderContact()` (líneas 299-310) por:

```ts
/**
 * El pie, común a TODAS las páginas: contacto + locales + blog + la línea técnica.
 *
 * Antes el contacto era una `<section id="contacto">` dentro de `<main>`, repetida en cada landing y
 * ausente de la home sintetizada. En el pie está en todas por construcción —incluidas `/menu` y
 * `/blog`— y deja de competir con el contenido. Los `id` no cambian, así que el nav de arriba ancla acá.
 */
function renderFooter(
  profile: BusinessProfile | null | undefined,
  contractVersion: string,
  schemaType: string,
  hayBlog: boolean,
): string {
  const tecnica = `<p class="tecnica">Página generada por AMG OS · contrato ${esc(contractVersion)} · schema ${esc(schemaType)}</p>`;
  if (!profile) return `<footer>${tecnica}</footer>`;

  const locales = localesDe(profile);
  const tel = profile.telephone
    ? `<p>Tel: <a href="tel:${esc(profile.telephone.replace(/\s/g, ""))}">${esc(profile.telephone)}</a></p>`
    : "";

  return `<footer>
<section class="contacto" id="contacto">
  <h2>Contacto</h2>
  <p><strong>${esc(profile.name)}</strong></p>
  ${tel}
</section>
${locales.length ? renderUbicaciones(locales) : ""}
${hayBlog ? `<p class="mas"><a href="/${SLUG_BLOG}">Blog</a></p>` : ""}
${tecnica}
</footer>`;
}

/**
 * Los locales del negocio, normalizados.
 *
 * Con `locations` explícito manda esa lista. Sin ella se sintetiza UNO con los campos clásicos
 * (`address`/`telephone`/`opening_hours`), que es como se describía un negocio de un solo local antes
 * de que existiera `locations` — así un perfil viejo no pierde su dirección cuando el footer pasa a
 * ser multi-local.
 */
function localesDe(p: BusinessProfile): Location[] {
  if (p.locations && p.locations.length > 0) return p.locations;
  if (!p.address && !p.telephone && !p.opening_hours) return [];
  return [
    {
      ...(p.address ? { address: p.address } : {}),
      ...(p.telephone ? { telephone: p.telephone } : {}),
      ...(p.opening_hours ? { opening_hours: p.opening_hours } : {}),
    },
  ];
}

function renderUbicaciones(locales: Location[]): string {
  const bloques = locales
    .map((l) => {
      const titulo = l.name ? `<h3>${esc(l.name)}</h3>` : "";
      // `postalCode` es opcional: se imprime solo si está, nunca un hueco ni un "undefined".
      const dir = l.address
        ? `<p>${esc(l.address.streetAddress)}${l.address.postalCode ? `, ${esc(l.address.postalCode)}` : ""} ${esc(l.address.addressLocality)}</p>`
        : "";
      const tel = l.telephone
        ? `<p>Tel: <a href="tel:${esc(l.telephone.replace(/\s/g, ""))}">${esc(l.telephone)}</a></p>`
        : "";
      const horas = l.opening_hours ? `<p>${esc(l.opening_hours)}</p>` : "";
      return `  <div class="local">${titulo}${dir}${tel}${horas}</div>`;
    })
    .join("\n");
  return `<section class="ubicaciones" id="ubicaciones">
  <h2>${locales.length > 1 ? "Nuestros locales" : "Dónde estamos"}</h2>
${bloques}
</section>`;
}
```

- [ ] **Step 4: Cablear el footer en `renderStory` y `renderHome`**

En `renderStory`, borrar `${profile ? renderContact(profile) : ""}` de dentro de `<main>` (línea 66)
y cambiar la línea 68 por:

```ts
${renderFooter(profile, c.meta.contract_version, c.schema_type, hayBlog)}
```

En `renderHome`, agregar el 4º parámetro a la firma, borrar `renderContact` de `<main>` (línea 134) y
cambiar la línea 136:

```ts
export function renderHome(
  profile?: BusinessProfile | null,
  nav: NavItem[] = [],
  languageCode = "es",
  hayBlog = false,
): string {
```
```ts
${renderFooter(profile, "web.v0.1", "WebPage", hayBlog)}
```

Y la llamada a `renderSiteHeader` de `renderHome` (línea 124) pierde el `nav`:
`${renderSiteHeader(profile, SLUG_HOME)}`.

- [ ] **Step 5: CSS del footer**

En la constante `CSS` (línea 479), reemplazar la regla de `footer` por:

```css
footer{max-width:760px;margin:40px auto 48px;padding:24px 20px 0;border-top:1px solid #eee;color:var(--fg)}
footer h2{font-size:1.15rem;margin:0 0 10px}
footer h3{font-size:.95rem;margin:0 0 4px;color:var(--fg)}
footer p{margin:0 0 6px}
footer .local{margin:0 0 16px;color:var(--muted)}
footer .ubicaciones{border:0;padding:16px 0 0}
footer .contacto{border:0;padding:0}
footer .tecnica{color:var(--muted);font-size:.85rem;margin-top:20px}
footer .mas{margin-top:12px}
```

Y en la línea del modo oscuro (480), sumar `footer` a los selectores que ajustan `border-color`:
`.sitebar,.hero,footer{border-color:#222}`.

- [ ] **Step 6: Correr los tests**

Run: `npm test -w web-builder && npm run typecheck`
Expected: PASS. El test viejo `"#17 render: id 'contacto' y 'faq' no se duplican"` sigue valiendo (el
`id` es único, ahora en el pie).

- [ ] **Step 7: Commit**

```bash
git add web-builder/src/render/html.ts web-builder/src/render/html.test.ts
git commit -m "$(cat <<'EOF'
Web-builder: el contacto pasa a un footer compartido y multi-local

Era una <section> dentro de <main>, repetida en cada landing y ausente de la home.
En el pie está en todas las páginas por construcción, lista todos los locales
(con el perfil clásico sintetizando uno) y ancla el nav de arriba.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: La página `/menu`

**Files:**
- Modify: `web-builder/src/render/html.ts` (nueva `renderMenu`), `web-builder/src/index.ts`
- Test: `web-builder/src/render/html.test.ts`

**Interfaces:**
- Consumes: `MenuItem` (Task 1), `renderSiteHeader`/`renderFooter` (Tasks 2-3).
- Produces: `renderMenu(profile?: BusinessProfile | null, languageCode = "es", hayBlog = false):
  string`, exportada desde `web-builder`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("menu: agrupa la carta por categoría, en orden de aparición", () => {
  const perfil = validProfile({
    menu: [
      { category: "Hamburguesas", name: "Golden Burger", description: "La insignia", price: "12,50 €" },
      { category: "Cervezas", name: "Ale" },
      { category: "Hamburguesas", name: "Clásica" },
    ],
  });
  const html = renderMenu(perfil, "es");
  assert.match(html, /Hamburguesas/);
  assert.match(html, /Golden Burger/);
  assert.match(html, /12,50 €/);
  assert.match(html, /Cervezas/);
  assert.match(html, /Ale/);
  // Las dos hamburguesas van juntas, antes de Cervezas.
  assert.ok(html.indexOf("Clásica") < html.indexOf("Cervezas"));
});

test("menu: los ítems sin categoría van juntos al final", () => {
  const perfil = validProfile({
    menu: [{ name: "Suelto" }, { category: "Cervezas", name: "Ale" }],
  });
  const html = renderMenu(perfil, "es");
  assert.ok(html.indexOf("Ale") < html.indexOf("Suelto"));
});

test("menu: JSON-LD Menu con sus secciones", () => {
  const perfil = validProfile({ menu: [{ category: "Cervezas", name: "Ale", price: "5 €" }] });
  const ld = JSON.parse(renderMenu(perfil, "es").split('<script type="application/ld+json">')[1]!.split("</script>")[0]!);
  assert.equal(ld["@type"], "Menu");
  assert.equal(ld.hasMenuSection[0]["@type"], "MenuSection");
  assert.equal(ld.hasMenuSection[0].hasMenuItem[0].name, "Ale");
});

test("🔴 menu: el nombre y el precio de un ítem se escapan", () => {
  const perfil = validProfile({ menu: [{ name: "<script>alert(1)</script>", price: '"><b>' }] });
  const html = renderMenu(perfil, "es");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes('"><b>'));
});

test("menu: sin carta, la página no promete nada (no rompe)", () => {
  const html = renderMenu(validProfile(), "es");
  assert.match(html, /<h1>/);
  assert.ok(!html.includes("<script type=\"application/ld+json\">\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Menu\",\n  \"hasMenuSection\": []"));
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w web-builder 2>&1 | grep -A 5 "menu:"`
Expected: FAIL — `renderMenu is not defined`.

- [ ] **Step 3: Implementar `renderMenu`**

Agregar en `web-builder/src/render/html.ts`, después de `renderHome`:

```ts
/**
 * La página `/menu`: la carta del negocio.
 *
 * **Sintetizada, igual que la home**: sale del perfil, no de una story ni del LLM. Un menú es una
 * lista de producto con precio — no hay nada que "redactar", y generarlo por IA metería una fuente
 * más de contenido que revisar en la compuerta humana (ADR-06). Si el cliente crea su propia story
 * `menu` en Storyblok, esa gana: el renderizador la sirve y esta función no se invoca.
 */
export function renderMenu(
  profile?: BusinessProfile | null,
  languageCode = "es",
  hayBlog = false,
): string {
  const lang = esc(languageCode);
  const nombre = profile?.name ?? "Menú";
  const items = profile?.menu ?? [];
  const url = profile?.url ? `${profile.url.replace(/\/+$/, "")}/${SLUG_MENU}` : `/${SLUG_MENU}`;
  const titulo = `Menú · ${nombre}`;

  const grupos = agruparCarta(items);
  const cuerpo = grupos.length
    ? grupos.map(renderGrupoCarta).join("\n")
    : `<p class="pending">La carta todavía no está cargada.</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(`La carta de ${nombre}.`)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
${items.length && profile ? `<script type="application/ld+json">\n${safeJson(menuLd(profile, url))}\n</script>` : ""}
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, SLUG_MENU)}
<main>
<header class="hero">
  <h1>${esc(titulo)}</h1>
</header>
${cuerpo}
</main>
${renderFooter(profile, "web.v0.1", "Menu", hayBlog)}
</body>
</html>`;
}

/** Agrupa la carta por categoría conservando el orden de aparición. Los sin categoría, al final. */
function agruparCarta(items: MenuItem[]): Array<{ categoria: string | null; items: MenuItem[] }> {
  const grupos = new Map<string, MenuItem[]>();
  const sueltos: MenuItem[] = [];
  for (const it of items) {
    const cat = it.category?.trim();
    if (!cat) {
      sueltos.push(it);
      continue;
    }
    const g = grupos.get(cat);
    if (g) g.push(it);
    else grupos.set(cat, [it]);
  }
  const salida = [...grupos.entries()].map(([categoria, items]) => ({ categoria, items }));
  if (sueltos.length) salida.push({ categoria: null, items: sueltos });
  return salida;
}

function renderGrupoCarta(g: { categoria: string | null; items: MenuItem[] }): string {
  const filas = g.items
    .map((it) => {
      const precio = it.price ? `<span class="precio">${esc(it.price)}</span>` : "";
      const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
      return `  <li><div class="fila"><span class="nombre">${esc(it.name)}</span>${precio}</div>${desc}</li>`;
    })
    .join("\n");
  return `<section class="carta">
  ${g.categoria ? `<h2>${esc(g.categoria)}</h2>` : ""}
  <ul class="items">
${filas}
  </ul>
</section>`;
}

/** JSON-LD de la carta: `Menu` con una `MenuSection` por categoría. */
function menuLd(profile: BusinessProfile, url: string): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    url,
    name: `Menú · ${profile.name}`,
    hasMenuSection: agruparCarta(profile.menu ?? []).map((g) => ({
      "@type": "MenuSection",
      ...(g.categoria ? { name: g.categoria } : {}),
      hasMenuItem: g.items.map((it) => ({
        "@type": "MenuItem",
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
        // `price` es texto libre: va como `Offer.price` sin inventar moneda ni parsear el número.
        ...(it.price ? { offers: { "@type": "Offer", price: it.price } } : {}),
      })),
    })),
  };
}
```

Agregar el import de `MenuItem` al bloque de tipos del principio del archivo (línea 1-13).

- [ ] **Step 4: CSS de la carta**

En `CSS`, después de la regla `.cards`:

```css
.carta{padding:24px 0;border-bottom:1px solid #f0f0f0}
.carta .items{list-style:none;margin:0;padding:0}
.carta li{padding:10px 0;border-bottom:1px solid #f5f4f2}
.carta .fila{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.carta .nombre{font-weight:600}
.carta .precio{color:var(--accent);font-weight:600;white-space:nowrap}
.carta .desc{margin:4px 0 0;color:var(--muted);font-size:.95rem}
```

- [ ] **Step 5: Exportar `renderMenu`**

En `web-builder/src/index.ts`, línea 9: `export { renderStory, renderHome, renderMenu } from "./render/html.js";`

- [ ] **Step 6: Correr los tests**

Run: `npm test -w web-builder && npm run typecheck`
Expected: PASS (incluido el test de `aria-current` que quedó pendiente en la Task 2 — reactivalo).

- [ ] **Step 7: Commit**

```bash
git add web-builder/src/render/html.ts web-builder/src/render/html.test.ts web-builder/src/index.ts
git commit -m "$(cat <<'EOF'
Web-builder: página /menu sintetizada desde el perfil

La carta agrupada por categoría, con JSON-LD Menu. Sintetizada como la home: un
menú es una lista de producto, no hay nada que redactar y generarlo por IA metería
otra fuente de contenido que revisar en la compuerta.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: El índice `/blog`

**Files:**
- Modify: `web-builder/src/render/html.ts` (nueva `renderBlogIndex`), `web-builder/src/index.ts`
- Test: `web-builder/src/render/html.test.ts`

**Interfaces:**
- Consumes: `NavItem`, `tarjetaIndice`/`hrefDeSlug` (ya existen), `renderFooter` (Task 3).
- Produces: `renderBlogIndex(profile: BusinessProfile | null | undefined, posts: NavItem[],
  languageCode = "es"): string`, exportada desde `web-builder`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("blog: lista los posts como tarjetas enlazadas", () => {
  const posts: NavItem[] = [
    { slug: "mejor-hamburguesa-dubai", name: "La mejor hamburguesa del mundo" },
    { slug: "burger-bash-miami", name: "Premiados en Miami" },
  ];
  const html = renderBlogIndex(validProfile(), posts, "es");
  assert.match(html, /href="\/mejor-hamburguesa-dubai"/);
  assert.match(html, /La mejor hamburguesa del mundo/);
  assert.match(html, /href="\/burger-bash-miami"/);
});

test("🔴 blog: el nombre y el slug de un post se escapan/sanean", () => {
  const posts: NavItem[] = [{ slug: "javascript:alert(1)", name: "<img src=x onerror=alert(1)>" }];
  const html = renderBlogIndex(validProfile(), posts, "es");
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(!html.includes('href="javascript:alert(1)"'));
});

test("blog: en el índice del blog el pie no vuelve a ofrecer el blog vacío", () => {
  const html = renderBlogIndex(validProfile(), [], "es");
  assert.match(html, /<h1>/);
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w web-builder 2>&1 | grep -A 5 "blog:"`
Expected: FAIL — `renderBlogIndex is not defined`.

- [ ] **Step 3: Implementar `renderBlogIndex`**

Después de `renderMenu`:

```ts
/**
 * El índice `/blog`: las páginas de research que son artículos (`schema_type: Article`).
 *
 * Existe para que los posts no queden como enlaces sueltos en el pie ni compitiendo con las landings
 * comerciales en el índice de la home. Solo entran las `Article` — las `landing_local`/`servicio` son
 * páginas de producto, no editoriales, y siguen viviendo en el índice de la home.
 */
export function renderBlogIndex(
  profile: BusinessProfile | null | undefined,
  posts: NavItem[],
  languageCode = "es",
): string {
  const lang = esc(languageCode);
  const nombre = profile?.name ?? "Blog";
  const titulo = `Blog · ${nombre}`;
  const url = profile?.url ? `${profile.url.replace(/\/+$/, "")}/${SLUG_BLOG}` : `/${SLUG_BLOG}`;

  const tarjetas = posts.length
    ? `<div class="cards">\n${posts.map(tarjetaIndice).join("\n")}\n</div>`
    : `<p class="pending">Todavía no hay artículos publicados.</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(`Artículos de ${nombre}.`)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, SLUG_BLOG)}
<main>
<header class="hero">
  <h1>${esc(titulo)}</h1>
</header>
<section class="indice">
  ${tarjetas}
</section>
</main>
${renderFooter(profile, "web.v0.1", "WebPage", posts.length > 0)}
</body>
</html>`;
}
```

- [ ] **Step 4: Exportar**

`web-builder/src/index.ts`, línea 9:
`export { renderStory, renderHome, renderMenu, renderBlogIndex } from "./render/html.js";`

- [ ] **Step 5: Correr los tests**

Run: `npm test -w web-builder && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-builder/src/render/html.ts web-builder/src/render/html.test.ts web-builder/src/index.ts
git commit -m "$(cat <<'EOF'
Web-builder: índice /blog para las páginas Article

Los posts dejan de competir con las landings comerciales en el índice de la home
y de quedar como enlaces sueltos en el pie.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `locations` y `menu` sobreviven al validador del renderizador

> **Esta es la tarea que hace que lo anterior funcione en la web real.** `perfilValido` reconstruye el
> perfil campo por campo: lo que no nombra, lo tira. Sin esto, `locations` y `menu` llegan de la base
> y **se pierden en silencio** — el mismo bug que su propio comentario documenta sobre `brand`.

**Files:**
- Modify: `renderer/src/perfil.ts:55-98`
- Test: `renderer/src/perfil.test.ts`

**Interfaces:**
- Consumes: `Location`, `MenuItem` (Task 1).
- Produces: `perfilValido(bruto: unknown): BusinessProfile | null` — ahora conserva `locations` y
  `menu` validados y acotados.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("🔴 los locales sobreviven al validador y llegan al render", () => {
  const p = perfilValido({
    name: "La Birra Bar",
    locations: [
      { name: "Centro", address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" } },
      { name: "Salamanca", opening_hours: "hasta la 01:00" },
    ],
  });
  assert.equal(p?.locations?.length, 2);
  assert.equal(p?.locations?.[0]?.name, "Centro");
});

test("🔴 la carta sobrevive al validador", () => {
  const p = perfilValido({ name: "X", menu: [{ category: "Cervezas", name: "Ale", price: "5 €" }] });
  assert.equal(p?.menu?.[0]?.name, "Ale");
  assert.equal(p?.menu?.[0]?.price, "5 €");
});

test("🔴 un ítem de carta sin nombre se descarta (no se puede mostrar)", () => {
  const p = perfilValido({ name: "X", menu: [{ price: "5 €" }, { name: "Ale" }] });
  assert.equal(p?.menu?.length, 1);
  assert.equal(p?.menu?.[0]?.name, "Ale");
});

test("🔴 un local sin ningún dato usable se descarta", () => {
  const p = perfilValido({ name: "X", locations: [{ name: "Vacío" }, { opening_hours: "11:00" }] });
  assert.equal(p?.locations?.length, 1);
});

test("🔴 una lista hostilmente larga se acota (la columna jsonb no la valida nadie)", () => {
  const menu = Array.from({ length: 500 }, (_, i) => ({ name: `Item ${i}` }));
  const p = perfilValido({ name: "X", menu });
  assert.ok((p?.menu?.length ?? 0) <= 200);
});

test("una dirección sin código postal ya es válida (calle + ciudad alcanzan)", () => {
  const p = perfilValido({
    name: "X",
    address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" },
  });
  assert.equal(p?.address?.streetAddress, "San Jerónimo 3");
  assert.equal(p?.address?.postalCode, undefined);
});

test("🔴 una dirección sin calle sigue descartándose entera", () => {
  const p = perfilValido({ name: "X", address: { addressLocality: "Madrid" } });
  assert.equal(p?.address, undefined);
});
```

> El test existente `"🔴 una dirección a la que le falta una parte se descarta entera"` prueba la
> regla vieja (los tres campos obligatorios). Actualizalo: la parte que ahora puede faltar es
> `postalCode`; calle y ciudad siguen siendo obligatorias.

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w renderer 2>&1 | grep -B 2 -A 6 "sobreviven"`
Expected: FAIL — `p.locations` y `p.menu` son `undefined`: el validador los descarta.

- [ ] **Step 3: Relajar `direccion` y agregar los validadores nuevos**

En `renderer/src/perfil.ts`, cambiar `direccion` (líneas 55-74) y agregar después:

```ts
/**
 * `undefined` salvo que sea un objeto con lo que el render da por hecho.
 *
 * Calle y ciudad siguen siendo obligatorias: media dirección renderizada es peor que ninguna. El
 * **código postal ya no**, porque el render lo imprime condicionalmente y muchos negocios publican
 * calle y ciudad nada más — exigirlo tiraba la dirección entera de un local legítimo.
 */
function direccion(v: unknown): BusinessProfile["address"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;

  const streetAddress = texto(a["streetAddress"]);
  const addressLocality = texto(a["addressLocality"]);
  if (!streetAddress || !addressLocality) return undefined;

  return {
    streetAddress,
    addressLocality,
    ...(texto(a["postalCode"]) ? { postalCode: texto(a["postalCode"])! } : {}),
    ...(texto(a["addressRegion"]) ? { addressRegion: texto(a["addressRegion"])! } : {}),
    ...(texto(a["addressCountry"]) ? { addressCountry: texto(a["addressCountry"])! } : {}),
  };
}

/**
 * Topes de las listas del perfil.
 *
 * `business_profile` es una columna `jsonb`: Postgres garantiza JSON válido y **nada más**. Sin tope,
 * una ficha con 50.000 ítems se renderiza entera en cada visita fría — no hace falta mala intención,
 * alcanza un import mal hecho. Es el mismo criterio que `MAX_NAV_ITEMS` en la CDA.
 */
const MAX_LOCALES = 20;
const MAX_ITEMS_CARTA = 200;

/** Los locales, validados uno por uno. Un local sin NINGÚN dato usable no es un local: se descarta. */
function locales(v: unknown): Location[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Location[] = [];
  for (const item of v.slice(0, MAX_LOCALES)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const l = item as Record<string, unknown>;
    const addr = direccion(l["address"]);
    const nombre = texto(l["name"]);
    const tel = texto(l["telephone"]);
    const horas = texto(l["opening_hours"]);
    // Un objeto que solo trae `name` no aporta nada al footer: sería un título vacío.
    if (!addr && !tel && !horas) continue;
    out.push({
      ...(nombre ? { name: nombre } : {}),
      ...(addr ? { address: addr } : {}),
      ...(tel ? { telephone: tel } : {}),
      ...(horas ? { opening_hours: horas } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** La carta, validada. Sin `name` no hay ítem que mostrar. */
function carta(v: unknown): MenuItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MenuItem[] = [];
  for (const item of v.slice(0, MAX_ITEMS_CARTA)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    const nombre = texto(m["name"]);
    if (!nombre) continue;
    out.push({
      name: nombre,
      ...(texto(m["category"]) ? { category: texto(m["category"])! } : {}),
      ...(texto(m["description"]) ? { description: texto(m["description"])! } : {}),
      ...(texto(m["price"]) ? { price: texto(m["price"])! } : {}),
    });
  }
  return out.length ? out : undefined;
}
```

Y en `perfilValido`, antes de `brand`:

```ts
    ...(locales(p["locations"]) ? { locations: locales(p["locations"]) } : {}),
    ...(carta(p["menu"]) ? { menu: carta(p["menu"]) } : {}),
```

Actualizar el import de la línea 1: `import type { BrandTheme, BusinessProfile, Location, MenuItem } from "web-builder";`

- [ ] **Step 4: Correr los tests**

Run: `npm test -w renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verificación por mutación**

Comentá la línea `...(carta(p["menu"]) ? ...)` y corré `npm test -w renderer`. Tiene que caer
**exactamente** `"🔴 la carta sobrevive al validador"`. Descomentala.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/perfil.ts renderer/src/perfil.test.ts
git commit -m "$(cat <<'EOF'
Renderizador: locations y menu sobreviven a perfilValido

El validador reconstruye el perfil campo por campo: lo que no nombra, lo tira. Sin
esto, la carta y los locales llegaban de la base y se perdían en silencio — el
mismo bug que su comentario documenta sobre `brand`. Con topes, porque jsonb no
valida nada. `postalCode` deja de ser obligatorio: el render ya lo imprime condicional.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.5: `locations` y `menu` entran a la allowlist de Postgres

> **Agregada durante la ejecución (no estaba en el plan original).** El revisor de la Task 6 encontró
> que `renderer` nunca lee `clients.business_profile` crudo: lee `business_profile_publico`, una
> columna **generada** por `app.nap_publico()` (migración `0009_marca_publica.sql`) que es una
> allowlist explícita de claves. Esa función no incluye `locations` ni `menu` — así que aunque la
> Task 6 ahora los preserva *si le llegan*, Postgres los descarta **antes** de que lleguen. Es
> exactamente el modo de fallo que la propia 0009 documenta sobre `brand`, sin su equivalente acá.
> Y no es solo un problema de producción: `renderer/src/demo-server.ts` corre `aplicarMigraciones()`
> contra PGlite real, así que la verificación en el navegador de la Task 9 falla sin esto (footer sin
> locales, `/menu` en 404).

**Files:**
- Create: `db/migrations/0010_ubicaciones_y_carta_publicas.sql`
- Test: `db/src/sitios.test.ts` (o el archivo donde ya se prueba `business_profile_publico` — buscar
  el test que cubre `brand` en la 0009 y replicar el patrón)

**Interfaces:**
- Consumes: nada nuevo (es una migración SQL).
- Produces: `app.nap_publico()` devuelve `locations` y `menu` cuando el perfil los trae, con la misma
  forma que valida `renderer/src/perfil.ts` (Task 6): `locations[].{name,address,telephone,opening_hours}`,
  `menu[].{category,name,description,price}`.

- [ ] **Step 1: Escribir el test que falla**

Buscar en `db/src/sitios.test.ts` el test que verifica que `brand` sobrevive a
`business_profile_publico` (de la migración 0009) y agregar el análogo:

```ts
test("🔴 business_profile_publico incluye locations y menu cuando el perfil los trae", async () => {
  const perfil = {
    name: "La Birra Bar",
    locations: [
      { name: "Centro", address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" } },
    ],
    menu: [{ category: "Hamburguesas", name: "Golden Burger", price: "12,50 €" }],
  };
  // Insertar un client de prueba con este business_profile (seguir el patrón que ya usa el test de
  // `brand`: mismo tenant/cliente de fixture, mismo cliente `pg` de PGlite con migraciones aplicadas).
  const fila = await leerBusinessProfilePublico(pg, clientId); // adaptar al helper que ya exista
  assert.deepEqual(fila.locations, perfil.locations);
  assert.deepEqual(fila.menu, perfil.menu);
});

test("🔴 business_profile_publico descarta una clave NO listada en la allowlist (defensa en profundidad)", async () => {
  const perfil = { name: "X", secreto_interno: "no debería salir" };
  const fila = await leerBusinessProfilePublico(pg, clientId);
  assert.equal((fila as Record<string, unknown>)["secreto_interno"], undefined);
});
```

> Si `db/src/sitios.test.ts` no tiene un helper para leer `business_profile_publico` directo de la
> fila, usar el mismo mecanismo que el test existente de `brand` — no inventar uno nuevo.

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npm test -w db 2>&1 | grep -A 8 "locations y menu"`
Expected: FAIL — `fila.locations`/`fila.menu` son `undefined` (la allowlist actual no los conoce).

- [ ] **Step 3: Escribir la migración**

`db/migrations/0010_ubicaciones_y_carta_publicas.sql`, mismo patrón que la 0009 (reemplaza la
función con `create or replace`, agrega las dos claves nuevas con su propia sub-allowlist, recrea la
columna generada):

```sql
-- =============================================================================
-- AMG OS — Los locales y la carta, dentro de la allowlist del renderizador
--
-- La navegación del sitio del cliente (footer NAP multi-local + página /menu) necesita `locations` y
-- `menu` del business_profile. Pero el renderizador NO lee `business_profile` crudo: lee
-- `business_profile_publico`, la columna generada con allowlist que introdujo la 0008. Esa allowlist
-- enumera claves explícitas — y ni `locations` ni `menu` estaban, así que se filtrarían en silencio:
-- el footer saldría sin locales y `/menu` daría 404, exactamente como le pasó a `brand` antes de la 0009.
--
-- Se REEMPLAZA `app.nap_publico` (mismo mecanismo que la 0009) y se re-materializa la columna.
-- =============================================================================

create or replace function app.nap_publico(perfil jsonb) returns jsonb
language sql immutable as $$
  select case
    when perfil is null or jsonb_typeof(perfil) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'name',          perfil -> 'name',
      'telephone',     perfil -> 'telephone',
      'priceRange',    perfil -> 'priceRange',
      'url',           perfil -> 'url',
      'image',         perfil -> 'image',
      'opening_hours', perfil -> 'opening_hours',
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   perfil -> 'address' -> 'streetAddress',
          'addressLocality', perfil -> 'address' -> 'addressLocality',
          'postalCode',      perfil -> 'address' -> 'postalCode',
          'addressRegion',   perfil -> 'address' -> 'addressRegion',
          'addressCountry',  perfil -> 'address' -> 'addressCountry'
        ))
        else null
      end,
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', perfil -> 'brand' -> 'color',
          'font',  perfil -> 'brand' -> 'font',
          'logo',  perfil -> 'brand' -> 'logo'
        ))
        else null
      end,
      -- NUEVO: los locales. Un array de objetos, cada uno con su propia sub-allowlist — la misma
      -- forma que ya exige `renderer/src/perfil.ts` (Task 6), para que lo que sobrevive acá sea
      -- exactamente lo que ese validador espera recibir.
      'locations', case
        when jsonb_typeof(perfil -> 'locations') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', loc -> 'name',
            'address', case
              when jsonb_typeof(loc -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'streetAddress',   loc -> 'address' -> 'streetAddress',
                'addressLocality', loc -> 'address' -> 'addressLocality',
                'postalCode',      loc -> 'address' -> 'postalCode',
                'addressRegion',   loc -> 'address' -> 'addressRegion',
                'addressCountry',  loc -> 'address' -> 'addressCountry'
              ))
              else null
            end,
            'telephone',     loc -> 'telephone',
            'opening_hours', loc -> 'opening_hours'
          )))
          from jsonb_array_elements(perfil -> 'locations') as loc
        )
        else null
      end,
      -- NUEVO: la carta. `price` es texto libre a propósito (ver web-builder/src/types.ts) — no se
      -- fuerza a número acá tampoco.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    item -> 'category',
            'name',        item -> 'name',
            'description', item -> 'description',
            'price',       item -> 'price'
          )))
          from jsonb_array_elements(perfil -> 'menu') as item
        )
        else null
      end
    ))
  end
$$;

-- Re-materializar la columna generada: una columna STORED no se recalcula porque cambie la función.
alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'NAP público del negocio (allowlist): name, telephone, priceRange, url, image, opening_hours, '
  'address, brand, locations, menu. Generada — nunca se escribe directo. Ver 0008/0009/0010.';

grant select (business_profile_publico) on clients to app_render;
```

> **Ojo con el orden de los `grant`**: la 0009 ya le dio a `app_render` el `select` sobre la columna
> completa (`business_profile_publico`), así que un `grant select (business_profile_publico)` repetido
> acá es redundante pero inofensivo (Postgres no se queja de un grant repetido). No hace falta un
> `revoke` — la columna es la misma, solo cambia lo que la función genera dentro de ella.

- [ ] **Step 4: Correr las migraciones y el test**

Run: `npm run migrate:deploy -w db` (o el comando que use el proyecto para aplicar migraciones sobre
el PGlite de test — revisar `db/package.json`) `&& npm test -w db`
Expected: `+ 0010_ubicaciones_y_carta_publicas.sql` aplicada; los dos tests del Step 1 en verde.

- [ ] **Step 5: Correr toda la suite del paquete `db` y el typecheck**

Run: `npm test -w db && npm run typecheck -w db`
Expected: PASS. Ningún test viejo de `brand`/`address` debería romperse — la función solo agrega
claves, no quita ni cambia el comportamiento de las que ya validaba la 0009.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0010_ubicaciones_y_carta_publicas.sql db/src/sitios.test.ts
git commit -m "$(cat <<'EOF'
Db: locations y menu entran a la allowlist de business_profile_publico

Sin esto, Postgres descartaba los locales y la carta ANTES de que
renderer/perfil.ts (Task 6) pudiera preservarlos — el mismo modo de fallo que
ya tuvo `brand` (0009). Mismo patrón: sub-allowlist propia, columna
regenerada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: La CDA sabe pedir las páginas de blog

**Files:**
- Modify: `renderer/src/cda.ts:42-53` (interfaz `Cda`), `:183-209` (junto a `traerNav`), `:288-322`
  (`MockCda`)
- Test: `renderer/src/cda.test.ts`

**Interfaces:**
- Consumes: `PeticionNav`, `NavItem`, `conPlazo`, `leerAcotado` (ya existen).
- Produces: `Cda.traerBlog?(p: PeticionNav): Promise<NavItem[]>`,
  `normalizarStories(stories: unknown): NavItem[]` (exportada), `MockCda.ponerBlog(token, version,
  items)`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("traerBlog pide solo las Article y devuelve slug + nombre", async () => {
  let urlPedida = "";
  const cda = new StoryblokCda({
    fetch: async (url) => {
      urlPedida = url;
      return new Response(
        JSON.stringify({ stories: [{ slug: "miami", name: "Premiados en Miami" }] }),
        { status: 200 },
      );
    },
  });
  const items = await cda.traerBlog({ token: "t", version: "published" });
  assert.deepEqual(items, [{ slug: "miami", name: "Premiados en Miami" }]);
  assert.match(urlPedida, /filter_query/);
  assert.match(urlPedida, /Article/);
});

test("traerBlog: un space sin artículos es una lista vacía, no un error", async () => {
  const cda = new StoryblokCda({ fetch: async () => new Response("", { status: 404 }) });
  assert.deepEqual(await cda.traerBlog({ token: "t", version: "published" }), []);
});

test("🔴 traerBlog: un fallo del origen LANZA (quien llama decide si degrada)", async () => {
  const cda = new StoryblokCda({ fetch: async () => new Response("", { status: 500 }) });
  await assert.rejects(() => cda.traerBlog({ token: "t", version: "published" }), ErrorCda);
});

test("🔴 normalizarStories: descarta lo que no tiene slug string y acota la lista", () => {
  const items = normalizarStories([
    { slug: "ok", name: "Ok" },
    { slug: 42, name: "número" },
    null,
    { name: "sin slug" },
  ]);
  assert.deepEqual(items, [{ slug: "ok", name: "Ok" }]);
});

test("normalizarStories: sin nombre, el slug es el texto del enlace", () => {
  assert.deepEqual(normalizarStories([{ slug: "miami" }]), [{ slug: "miami", name: "miami" }]);
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w renderer 2>&1 | grep -A 5 "traerBlog"`
Expected: FAIL — `traerBlog is not a function`, `normalizarStories is not defined`.

- [ ] **Step 3: Declarar el método en la interfaz**

En `renderer/src/cda.ts`, dentro de `interface Cda` (después de `traerNav`):

```ts
  /**
   * Las páginas de blog del space (las `Article`), para el índice de `/blog`. Un fallo LANZA, igual
   * que `traerNav`: quien llama decide si degrada.
   *
   * **Opcional a propósito**, por la misma razón que `traerNav`: sin blog el sitio funciona entero.
   */
  traerBlog?(p: PeticionNav): Promise<NavItem[]>;
```

- [ ] **Step 4: Implementar `traerBlog` y `normalizarStories`**

Después de `traerNav` en `StoryblokCda`:

```ts
  /**
   * Las páginas `Article` del space, vía `cdn/stories` con un filtro por `schema_type`.
   *
   * **Por qué un filtro y no una carpeta `blog/` en Storyblok**: mover las stories a una carpeta les
   * cambia el slug, y eso rompe las URLs ya publicadas e indexadas. El filtro no toca ninguna.
   *
   * `excluding_fields` deja fuera el cuerpo de cada story: para un índice hacen falta el slug y el
   * nombre, no el contenido — es menos ancho de banda y menos superficie que validar.
   */
  async traerBlog({ token, version, cacheVersion }: PeticionNav): Promise<NavItem[]> {
    const url = new URL(`${this.base}/stories`);
    url.searchParams.set("token", token);
    url.searchParams.set("version", version);
    url.searchParams.set("filter_query[schema_type][in]", "Article");
    url.searchParams.set("per_page", String(MAX_BLOG_ITEMS));
    url.searchParams.set("excluding_fields", "body");
    if (cacheVersion) url.searchParams.set("cv", cacheVersion);

    return this.conPlazo(async (signal) => {
      const res = await this.fetch(url.toString(), { signal });

      if (res.status === 404) return [];
      if (!res.ok) {
        // El cuerpo NO se propaga: puede traer el token en un mensaje de error de Storyblok.
        throw new ErrorCda(`Storyblok respondió ${res.status} para /stories (blog)`, res.status);
      }

      const cuerpo = (await this.leerAcotado(res)) as { stories?: unknown };
      return normalizarStories(cuerpo.stories);
    });
  }
```

Y a nivel de módulo, junto a `normalizarLinks`:

```ts
/** Tope de artículos del índice del blog. Acota memoria y ancho de banda del camino anónimo. */
const MAX_BLOG_ITEMS = 50;

/**
 * De la respuesta de `cdn/stories` a `NavItem[]`. Solo slug y nombre, validados como strings: en PROD
 * esto llega de la red sin pasar por Zod, y los dos terminan en el HTML.
 */
export function normalizarStories(stories: unknown): NavItem[] {
  if (!Array.isArray(stories)) return [];
  return stories
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .filter((s) => typeof s["slug"] === "string" && (s["slug"] as string).length > 0)
    .slice(0, MAX_BLOG_ITEMS)
    .map((s) => ({
      slug: s["slug"] as string,
      name:
        typeof s["name"] === "string" && (s["name"] as string).length > 0
          ? (s["name"] as string)
          : (s["slug"] as string),
    }));
}
```

- [ ] **Step 5: Soporte en `MockCda`**

En `MockCda`, junto a `navs`/`ponerNav`:

```ts
  /** Blog por `${token}:${version}`. Sin uno explícito, el space no tiene artículos. */
  private readonly blogs = new Map<string, NavItem[]>();
  readonly pedidosBlog: PeticionNav[] = [];

  ponerBlog(token: string, version: Version, items: NavItem[]): void {
    this.blogs.set(`${token}:${version}`, items);
  }

  async traerBlog(p: PeticionNav): Promise<NavItem[]> {
    this.pedidosBlog.push(p);
    return this.blogs.get(`${p.token}:${p.version}`) ?? [];
  }
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -w renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add renderer/src/cda.ts renderer/src/cda.test.ts
git commit -m "$(cat <<'EOF'
Renderizador: la CDA sabe pedir las páginas Article

Filtro por schema_type en cdn/stories, no una carpeta blog/ en Storyblok: mover
las stories les cambiaría el slug y rompería las URLs ya indexadas. Mismas defensas
que traerNav (plazo completo, tope de bytes, un fallo LANZA).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rutear `/menu` y `/blog` en el renderizador

**Files:**
- Modify: `renderer/src/app.ts:5-6` (imports), `:51-52` (slugs), `:93-131` (caches y `blogDe`),
  `:220-226` (invalidación del webhook), `:279-306` (`traer`)
- Test: `renderer/src/app.test.ts` (bloque "navegación y home", ~línea 411)

**Interfaces:**
- Consumes: `renderMenu`, `renderBlogIndex` (Tasks 4-5), `Cda.traerBlog` (Task 7), `perfilValido` con
  `menu`/`locations` (Task 6).
- Produces: rutas `/menu` y `/blog` servidas por síntesis cuando no hay story real con ese slug.

- [ ] **Step 1: Escribir los tests que fallan**

En `renderer/src/app.test.ts`. **Antes**, revisá el bloque "navegación y home" (~línea 411): los
tests que afirman que la barra lleva las páginas publicadas prueban el comportamiento que se
reemplazó — actualizalos para que afirmen las secciones (Inicio/Menú/…).

```ts
describe("renderizador — /menu y /blog", () => {
  it("🔴 sirve /menu sintetizado desde el perfil cuando no hay story `menu`", async () => {
    const { app, cda } = montar();
    cda.poner("pub-111", "published", "carta-x", story("Otra"));
    const res = await pedir(app, "/menu", "bellanapoli.es");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Golden Burger/);
  });

  it("una story `menu` publicada GANA sobre la síntesis", async () => {
    const { app, cda } = montar();
    cda.poner("pub-111", "published", "menu", story("La carta del chef", { slug: "menu" }));
    const res = await pedir(app, "/menu", "bellanapoli.es");
    assert.match(await res.text(), /La carta del chef/);
  });

  it("🔴 sin carta en el perfil, /menu es 404 (no una página vacía)", async () => {
    const { app } = montar({ perfil: { name: "Sin carta" } });
    assert.equal((await pedir(app, "/menu", "bellanapoli.es")).status, 404);
  });

  it("🔴 sirve /blog con los artículos del space", async () => {
    const { app, cda } = montar();
    cda.ponerBlog("pub-111", "published", [{ slug: "miami", name: "Premiados en Miami" }]);
    const res = await pedir(app, "/blog", "bellanapoli.es");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Premiados en Miami/);
  });

  it("🔴 sin artículos, /blog es 404", async () => {
    const { app } = montar();
    assert.equal((await pedir(app, "/blog", "bellanapoli.es")).status, 404);
  });

  it("🔴 si traerBlog falla, la página se sirve igual (sin enlace al blog), nunca 503", async () => {
    const { app, cda } = montar();
    cda.traerBlog = async () => {
      throw new Error("Storyblok caído");
    };
    const res = await pedir(app, "/", "bellanapoli.es");
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes('href="/blog"'));
  });

  it("el índice de la home NO repite los artículos que ya están en /blog", async () => {
    const { app, cda } = montar();
    cda.poner("pub-111", "published", "miami", story("Premiados en Miami", { slug: "miami" }));
    cda.ponerBlog("pub-111", "published", [{ slug: "miami", name: "Premiados en Miami" }]);
    const html = await (await pedir(app, "/", "bellanapoli.es")).text();
    const indice = html.slice(html.indexOf('class="indice"'), html.indexOf("</main>"));
    assert.ok(!indice.includes('href="/miami"'));
  });
});
```

> `montar()` es el helper que ya usan los tests del archivo (o su equivalente): reusalo, con un
> perfil que traiga `menu` para los casos de `/menu`. Si el helper actual no permite fijar el perfil,
> extendelo — no dupliques el andamiaje.

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npm test -w renderer 2>&1 | grep -B 2 -A 6 "/menu"`
Expected: FAIL — `/menu` y `/blog` dan 404 (no hay story con esos slugs y no hay síntesis).

- [ ] **Step 3: Imports, slugs y cache del blog**

En `renderer/src/app.ts`:

```ts
import { renderBlogIndex, renderHome, renderMenu, renderStory } from "web-builder";
```

Junto a `SLUG_HOME` (línea 52):

```ts
/** Los otros dos slugs que el renderizador sabe sintetizar. Una story real con ese slug siempre gana. */
const SLUG_MENU = "menu";
const SLUG_BLOG = "blog";
```

Junto a `navCache` (línea 93):

```ts
/** Los artículos del space, cacheados como la nav: se hornean en el HTML, esto cubre el render. */
const blogCache = new Map<string, { items: NavItem[]; hasta: number }>();
const coalescerBlog = new Coalescedor<NavItem[]>();
```

Y después de `navDe` (línea 131):

```ts
/**
 * Los artículos del sitio, con degradación a "sin blog" ante cualquier fallo.
 *
 * **Nunca 503 por el blog**, por la misma razón que la nav: es un enhancement. Si la CDA falla, se
 * rompe o el `Cda` ni implementa `traerBlog`, la página se sirve sin el enlace del pie.
 */
async function blogDe(sitio: Sitio, esPreview: boolean): Promise<NavItem[]> {
  if (!deps.cda.traerBlog || !sitio.spaceId) return [];
  const token = esPreview ? sitio.previewToken : sitio.publicToken;
  if (!token) return [];

  if (!esPreview) {
    const guardado = blogCache.get(sitio.spaceId);
    if (guardado && guardado.hasta > Date.now()) return guardado.items;
  }

  try {
    const traer = () =>
      deps.cda.traerBlog!({
        token,
        version: esPreview ? "draft" : "published",
        ...(esPreview ? { cacheVersion: `${Date.now()}` } : {}),
      });
    const items = esPreview ? await traer() : await coalescerBlog.hacer(`blog:${sitio.spaceId}`, traer);
    if (!esPreview) blogCache.set(sitio.spaceId, { items, hasta: Date.now() + TTL_NAV_MS });
    return items;
  } catch (e) {
    console.warn(`[renderer] blog de ${sitio.domain}: ${(e as Error).message} — se sirve sin enlace`);
    return [];
  }
}
```

- [ ] **Step 4: Invalidar la cache del blog en el webhook**

En el handler del webhook, junto a `navCache.delete` (línea 224):

```ts
    // Un artículo nuevo tiene que aparecer en /blog y en el enlace del pie.
    blogCache.delete(`${spaceId}`);
```

- [ ] **Step 5: Rutear en `traer()`**

Reemplazar el cuerpo de `traer()` (líneas 279-306) por:

```ts
      async function traer(): Promise<string | null> {
        // Story, nav y blog en paralelo: los dos últimos son no-fatales (degradan a []), así que no
        // suman modos de fallo, solo trabajo simultáneo dentro del mismo cupo del semáforo.
        const [story, nav, blog] = await Promise.all([
          deps.cda.traerStory({
            slug,
            token: token as string,
            version: esPreview ? "draft" : "published",
            ...(esPreview ? { cacheVersion: `${Date.now()}` } : {}),
          }),
          navDe(sitio!, esPreview),
          blogDe(sitio!, esPreview),
        ]);

        const perfil = perfilValido(sitio!.businessProfile);
        const hayBlog = blog.length > 0;
        const conBridge = (html: string) =>
          esPreview ? html.replace("</body>", `${scriptBridge()}</body>`) : html;

        if (story) return conBridge(renderStory(story, perfil, sitio!.languageCode, hayBlog));

        // Sin story: las tres páginas que el renderizador sabe sintetizar. Cualquier otro slug
        // ausente es un 404 legítimo.
        if (slug === SLUG_HOME) {
          // El índice de la home son las landings de research: la home no se lista a sí misma, y los
          // artículos viven en /blog (si estuvieran también acá, cada post aparecería dos veces).
          const slugsBlog = new Set(blog.map((b) => b.slug));
          const indice = nav.filter(
            (n) => n.slug !== SLUG_HOME && n.slug !== SLUG_BLOG && n.slug !== SLUG_MENU && !slugsBlog.has(n.slug),
          );
          return conBridge(renderHome(perfil, indice, sitio!.languageCode, hayBlog));
        }
        if (slug === SLUG_MENU && perfil?.menu?.length) {
          return conBridge(renderMenu(perfil, sitio!.languageCode, hayBlog));
        }
        if (slug === SLUG_BLOG && hayBlog) {
          return conBridge(renderBlogIndex(perfil, blog, sitio!.languageCode));
        }
        return null;
      }
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -w renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Verificación por mutación**

Cambiá `if (slug === SLUG_MENU && perfil?.menu?.length)` por `if (slug === SLUG_MENU)` y corré los
tests: tiene que caer **exactamente** `"🔴 sin carta en el perfil, /menu es 404"`. Revertí.

- [ ] **Step 8: Commit**

```bash
git add renderer/src/app.ts renderer/src/app.test.ts
git commit -m "$(cat <<'EOF'
Renderizador: rutea /menu y /blog sintetizados

Mismo patrón que la home: si no hay story con ese slug, se sintetiza desde el
perfil. Una story real siempre gana. El blog degrada a "sin enlace" ante cualquier
fallo — un enhancement no puede tumbar la página que enriquece.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Datos reales de La Birra Bar, verificación en el navegador y republicación

**Files:**
- Modify: `web-builder/business-profile.json`
- Verify: el sitio entero en un navegador real (MCP chrome-devtools)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la demo de La Birra Bar con el sitio navegable como el de un restaurante.

- [ ] **Step 1: Cargar el perfil real**

`web-builder/business-profile.json` — **solo datos que el cliente confirmó**. Sin código postal ni
teléfono: no están confirmados y no se inventan.

```json
{
  "name": "La Birra Bar",
  "locations": [
    {
      "name": "Centro (Puerta del Sol)",
      "address": { "streetAddress": "Carrera de San Jerónimo 3", "addressLocality": "Madrid" },
      "opening_hours": "Lun-Dom 11:00-01:00 · Vie-Sáb hasta las 02:00"
    },
    {
      "name": "Salamanca",
      "address": { "streetAddress": "Calle de José Ortega y Gasset 79", "addressLocality": "Madrid" },
      "opening_hours": "Dom-Mié hasta 00:30 · Vie-Sáb hasta la 01:00"
    }
  ],
  "menu": [
    {
      "category": "Hamburguesas",
      "name": "Golden Burger",
      "description": "La hamburguesa insignia de la casa, la que los lanzó a la fama mundial."
    },
    { "category": "Cervezas artesanales", "name": "Ale de Ogham", "description": "De barril, bien fría." },
    { "category": "Cervezas artesanales", "name": "Honey de Ogham", "description": "De barril, bien fría." },
    {
      "category": "Acompañamientos",
      "name": "Patatas fritas especiales",
      "description": "Con un toque crocante único y salsas de la casa."
    }
  ]
}
```

- [ ] **Step 2: Correr la suite completa**

Run: `npm test && npm run typecheck`
Expected: PASS en los 6 paquetes. **Copiá el conteo de tests**: hay que sincronizarlo en la
documentación (Step 6).

- [ ] **Step 3: Manejar la app en el navegador**

```bash
npm run demo -w renderer
```

Y con MCP chrome-devtools, comprobar **una por una**:

- [ ] `http://localhost:8080/?_host=bellanapoli.es` — la barra dice **Inicio · Menú · Ubicaciones ·
      Contacto**, no títulos SEO.
- [ ] El pie lista **los dos locales** con su dirección y horario, y el enlace **Blog**.
- [ ] `http://localhost:8080/menu?_host=bellanapoli.es` — la carta, agrupada por categoría.
- [ ] `http://localhost:8080/blog?_host=bellanapoli.es` — **solo** los dos artículos (Dubai y Miami),
      ninguna landing comercial.
- [ ] Una landing (`/cervezas-artesanales-madrid`) — misma barra, mismo pie, sin la sección de
      contacto vieja dentro de `<main>`.
- [ ] El índice de la home **no repite** los dos artículos.
- [ ] `?_host=noexiste.es` sigue dando **404**.
- [ ] Modo oscuro del navegador: el pie se lee (el `border-color` del `@media` lo cubre).
- [ ] Sacar una captura de la home y de `/menu` para el registro.

- [ ] **Step 4: Republicar en Storyblok**

El HTML lo genera el renderizador en vivo desde el perfil, así que **el contenido de Storyblok no
cambia** — pero el perfil sí, y el `business-profile.json` es lo que consume el publish. Republicar
solo hace falta si algo del brief cambió. Verificar primero con un dry-run:

```bash
cd web-builder
WEB_PUBLISH_MODE=storyblok STORYBLOK_DRY_RUN=1 npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json
```

Si el dry-run no muestra diferencias de contenido, **no republiques**: no hay nada que cambiar en el
space y republicar solo gasta llamadas a la Management API.

- [ ] **Step 5: Actualizar la documentación**

- `docs/proyecto/09-estado-y-roadmap.md`: en la deuda "republicar desde un brief pisa las imágenes",
  agregar que el nav/footer ya no dependen del brief. Sincronizar el conteo de tests del Step 2.
- `docs/proyecto/11-plan-fase-2.md`: sincronizar el conteo de tests y anotar la navegación del sitio
  como hecha.
- El spec ([2026-07-31-navegacion-sitio-cliente-design.md](../specs/2026-07-31-navegacion-sitio-cliente-design.md)):
  agregar el recuadro "lo que se implementó distinto de lo escrito acá" con las tres enmiendas de
  este plan (`perfilValido`, `postalCode` opcional, la home sin artículos duplicados).

- [ ] **Step 6: Commit y push**

```bash
git add web-builder/business-profile.json docs/
git commit -m "$(cat <<'EOF'
Demo: perfil real de La Birra Bar (dos locales y carta)

Sin código postal ni teléfono: no están confirmados y no se inventan. Verificado
en el navegador: barra de secciones, pie con los dos locales, /menu y /blog.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-review

**Cobertura del spec:**

| Requisito del spec | Task |
| --- | --- |
| Nav fijo de 4 ítems, condicionales | 2 |
| Footer compartido con contacto + ubicaciones + blog | 3 |
| `/menu` sintetizada con JSON-LD `Menu` | 4 |
| `/blog` con solo las `Article` | 5 |
| Precedencia: una story real gana sobre la síntesis | 8 (tests) |
| `Location`/`MenuItem` opcionales, compatibles hacia atrás | 1, 3 (`localesDe`) |
| Blog vía filtro `schema_type`, sin tocar slugs | 7 |
| Degradación no-fatal del blog | 7 (LANZA), 8 (degrada) |
| Escapado de todo lo que llega del perfil | 3, 4, 5 (tests 🔴) |
| Datos reales de La Birra Bar | 9 |
| Casos borde de la tabla del spec | 2, 3, 8 |

**Riesgo mayor:** la Task 6. Es la única que no se nota en los tests de `web-builder` (que pasan
igual) y sin ella nada de esto aparece en la web real. Si se ejecuta el plan en paralelo, esa tarea
no se puede saltear.

**Consistencia de tipos:** `renderStory(story, profile, languageCode, hayBlog: boolean)` —
4º parámetro cambiado de tipo en la Task 2, consumido en la 3 y llamado en la 8.
`renderHome(profile, nav, languageCode, hayBlog)` — 4º agregado en la 3, llamado en la 8.
`renderMenu(profile, languageCode, hayBlog)` y `renderBlogIndex(profile, posts, languageCode)` —
definidos en 4 y 5, llamados en la 8. `SLUG_MENU`/`SLUG_BLOG` existen dos veces a propósito
(`html.ts` y `app.ts`), igual que `SLUG_HOME` hoy: son paquetes distintos y el valor es parte del
contrato de URL, no un detalle compartido.
