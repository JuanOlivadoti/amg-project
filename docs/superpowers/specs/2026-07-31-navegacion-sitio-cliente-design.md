# Navegación del sitio del cliente — diseño

> **Estado:** aprobado el 2026-07-31, pendiente de implementación.

---

## Por qué

Al republicar el caso de demo con datos reales (La Birra Bar, ver
[Acción 06](../../acciones/06-corrida-final-demo.md)), la barra de navegación del sitio quedó
mostrando los títulos SEO completos de las 14 páginas de investigación de keywords ("La Birra Bar:
Reconocida en el Burger Bash de Miami por sus Hamburguesas Gourmet", etc.) — se ve como el índice
de un blog, no como el sitio de presentación de un restaurante.

La causa de fondo: `renderNav` (`web-builder/src/render/html.ts`) construye la barra de arriba a
partir de **todas las páginas publicadas** (la lista que trae la Links API de Storyblok). El
pipeline de investigación de keywords genera páginas por *intención de búsqueda* (una landing por
cluster de keywords), no páginas "clásicas" de sitio (Inicio, Menú, Ubicaciones, Contacto) — esas
nunca existieron como concepto en el sistema.

## Qué se construye

1. **Nav de arriba fijo, no derivado de las páginas publicadas.** Cuatro ítems posibles, cada uno
   condicionado a que haya datos (no se muestra un link roto):
   - **Inicio** (`/`) — siempre.
   - **Menú** (`/menu`) — solo si `profile.menu` tiene items.
   - **Ubicaciones** (`#ubicaciones`, ancla) — solo si hay `profile.locations` o `profile.address`.
   - **Contacto** (`#contacto`, ancla) — solo si hay `profile`.
2. **Footer compartido**, en TODAS las páginas (landings SEO, home, `/menu`, `/blog`) — reemplaza a
   la `<section id="contacto">` que hoy se repite en cada landing (`renderContact`, llamada desde
   `renderStory` y `renderHome`):
   - Bloque de contacto general (`id="contacto"`): nombre del negocio + el primer teléfono/horario
     que haya.
   - "Nuestros locales" (`id="ubicaciones"`): un bloque por cada `Location` — nombre del local,
     dirección, teléfono, horario. Con un solo local (el caso de hoy en el `BusinessProfile`
     "clásico"), es un bloque; con varios (La Birra Bar: Centro y Salamanca), una lista.
   - Link a **Blog** — solo si existen páginas con `schema_type: "Article"` en el space.
   - La línea técnica de atribución que ya existe ("Página generada por AMG OS · contrato..."), sin
     cambios.
3. **`/menu`** — página sintetizada (mismo patrón que la home cuando no hay story `home`: HTML
   directo del perfil, **sin LLM, sin Storyblok**). Lista `profile.menu`, agrupado por `category`
   cuando la tiene. JSON-LD `Menu`/`MenuItem` — el sitio entero lleva schema.org en cada página, esta
   no es la excepción.
4. **`/blog`** — página sintetizada. Índice de las páginas cuyo `schema_type` sea `Article`, con el
   mismo estilo de tarjetas que ya usa la home para su índice general. Las páginas `landing_local`/
   `servicio` (la mayoría) **no** aparecen acá — siguen viviendo solo en el índice de la home.
5. **Precedencia**: si el cliente publica en Storyblok una story con slug `menu` o `blog`, esa gana
   — mismo criterio que ya existe para `home` hoy (`renderer/src/app.ts`: primero se intenta traer
   la story real; la síntesis es el fallback).

### Fuera de alcance, a propósito

- **Generar el contenido de Menú/Ubicaciones/Contacto/Blog con IA.** Son datos estructurados (NAP,
  precios) o, en el caso del blog, contenido que YA redactó el pipeline de M2 — no hace falta un
  paso nuevo de generación. Si algún día se quiere una landing de "menú" con prosa SEO propia, es
  un tipo de página nuevo en el contrato de `kr-service`, no esto.
- **Reservas / pedidos online.** No hay sistema de reservas; "Contacto" es informativo (teléfono,
  dirección, horario), no un formulario.
- **Multi-idioma en las páginas sintetizadas.** Siguen el `languageCode` del sitio, igual que hoy la
  home — no se traduce nada nuevo.
- **Un índice de blog paginado.** Con 2 páginas de blog hoy, una lista simple alcanza. Paginar es
  trabajo futuro si un cliente publica muchas.

---

## Modelo de datos

`web-builder/src/types.ts` — dos campos nuevos en `BusinessProfile`, ambos **opcionales**: no rompen
perfiles existentes de un solo local sin menú cargado (el `business-profile.json` de un cliente
nuevo sigue siendo válido con solo `name`).

```ts
interface Location {
  name?: string;              // "Centro", "Salamanca" — para distinguir locales
  address?: PostalAddress;
  telephone?: string;
  opening_hours?: string;
}

interface MenuItem {
  category?: string;          // "Hamburguesas", "Cervezas", "Acompañamientos"
  name: string;
  description?: string;
  price?: string;             // texto libre ("12,50 €") — no se fuerza un tipo numérico/moneda
}

interface BusinessProfile {
  // ...los campos que ya existen (name, telephone, address, opening_hours, priceRange, image, url,
  // brand) se mantienen sin cambios, para negocios de un solo local sin locations[] explícito.
  locations?: Location[];     // si está presente, manda sobre address/telephone/opening_hours
                               // para el footer y para el JSON-LD de ubicaciones.
  menu?: MenuItem[];
}
```

**Compatibilidad hacia atrás:** si `locations` está ausente pero `address` sí, el footer sintetiza
una `Location` implícita a partir de los campos clásicos (`{ address, telephone, opening_hours }`)
— un negocio de un solo local no necesita tocar su `business-profile.json` existente.

---

## Arquitectura de render

### Nav (`renderSiteHeader` / `renderNav`, `web-builder/src/render/html.ts`)

Deja de recibir `NavItem[]` (la lista completa de páginas publicadas) como fuente del nav de arriba.
Pasa a construirse desde `profile` con una función nueva, `navPrincipal(profile)`, que devuelve como
mucho 4 ítems fijos (Inicio, Menú, Ubicaciones, Contacto), cada uno condicional según §Qué se
construye. El estado `activo`/`aria-current` se conserva (compara `activeSlug` contra `SLUG_HOME`
—la constante `"home"` que ya usa el código— para Inicio, o `"menu"` para Menú; Ubicaciones/Contacto
son anclas, no tienen estado activo propio porque viven en el footer de la página en la que ya
estás).

`NavItem[]` (la lista de la Links API) **no desaparece**: la sigue necesitando `renderHome` para su
índice de tarjetas de páginas SEO. Ese uso no cambia.

### Footer (nuevo, reemplaza `renderContact`)

Una función `renderFooter(profile, hayBlog)` reemplaza las llamadas a `renderContact` en
`renderStory` y `renderHome`. Recibe si el space tiene páginas de blog (para mostrar u ocultar el
link) — ver más abajo de dónde sale ese dato.

### `/menu` y `/blog`: cómo entran al ruteo

`renderer/src/app.ts`, dentro de `traer()`, donde hoy solo existe la rama de `home`:

```ts
if (!story) {
  if (slug === SLUG_HOME) return renderHome(...);
  if (slug === "menu") return renderMenu(perfil, navVisible, sitio.languageCode);
  if (slug === "blog") return renderBlogIndex(perfil, blogItems, navVisible, sitio.languageCode);
  return null;  // 404, como hoy
}
```

`renderMenu`/`renderBlogIndex` son funciones nuevas en `web-builder/src/render/html.ts`, mismo
patrón que `renderHome` (HTML autocontenido, mismo `<head>`, mismo `renderSiteHeader`/`renderFooter`
compartidos).

### De dónde sale la lista de páginas de blog

La Links API de Storyblok (la que ya usa `navDe`) **no trae `schema_type`** — solo slug y nombre, no
alcanza para saber cuáles son `Article`. Se agrega una llamada nueva, cacheada con el mismo patrón
que `navDe`/`navCache` (TTL, coalescing, no-fatal — si falla, el link a Blog simplemente no
aparece): `GET /cdn/stories?filter_query[schema_type][in]=Article&token=...`. Cada story ya guarda
`content.schema_type` (`web-builder/src/storyblok/content.ts`), así que el filtro es del lado de
Storyblok, sin traer contenido de más.

---

## Casos borde

| Caso | Comportamiento |
| --- | --- |
| Perfil sin `menu` | No aparece "Menú" en el nav. `/menu` da 404 (a menos que exista una story real con ese slug — gana igual que hoy con `home`). |
| Perfil sin `locations` ni `address` | No aparece "Ubicaciones". El footer no muestra el bloque de locales. |
| Perfil ausente (`null`) | Nav solo con "Inicio". Footer solo con la línea técnica. |
| Sin páginas `Article` en el space | No aparece "Blog" en el footer. `/blog` da 404 salvo story real con ese slug. |
| Falla la llamada de blog (red, Storyblok caído) | No-fatal, igual que la nav hoy: se sirve la página sin el link a Blog, nunca un 503 por esto. |
| Un `price` con `<`, `>`, `&` u otro carácter hostil | Pasa por `esc()`, igual que cualquier otro texto del perfil — no es una superficie nueva, ya está cubierta por el mismo mecanismo que valida NAP hoy. |

---

## Contenido real para La Birra Bar

Una vez implementado, se actualiza `web-builder/business-profile.json` con datos reales (no
inventados — de lo que el usuario ya pasó en esta conversación):

```json
{
  "name": "La Birra Bar",
  "locations": [
    {
      "name": "Centro",
      "address": { "streetAddress": "Carrera de San Jerónimo 3", "addressLocality": "Madrid" },
      "opening_hours": "Lun-Dom 11:00-01:00 (vie-sáb hasta las 02:00)"
    },
    {
      "name": "Salamanca",
      "address": { "streetAddress": "Calle de José Ortega y Gasset 79", "addressLocality": "Madrid" },
      "opening_hours": "Dom-Mié hasta 00:30/24:00 · Vie-Sáb hasta la 01:00"
    }
  ],
  "menu": [
    { "category": "Hamburguesas", "name": "Golden Burger", "description": "La hamburguesa insignia de la casa, la que los lanzó a la fama mundial." },
    { "category": "Cervezas artesanales", "name": "Ale" },
    { "category": "Cervezas artesanales", "name": "Honey (Ogham)" },
    { "category": "Acompañamientos", "name": "Patatas fritas especiales", "description": "Con un toque crocante único y salsas de la casa." }
  ]
}
```

Sin código postal ni teléfono (misma razón que la vez pasada: no los tengo confirmados, y no se
inventan). Sin precios en el menú — no los pasó el usuario; el campo `price` queda vacío y el
render simplemente no lo muestra (es opcional).

---

## Testing

- `web-builder/src/render/html.test.ts`: casos nuevos para `renderFooter` (con/sin locations,
  con/sin blog), `navPrincipal` (los 4 combos de presencia/ausencia), `renderMenu` (con/sin
  categorías), `renderBlogIndex`.
- `renderer/src/app.test.ts` (o donde vivan hoy los tests de ruteo): `/menu` y `/blog` sintetizados
  cuando no hay story real; una story real con esos slugs gana (mismo test que ya existe para
  `home`, replicado); `/blog` sin páginas Article da 404.
- Mutación: un `price`/`name` con `<script>` no debe aparecer sin escapar en el HTML — mismo
  criterio que ya prueban los tests de inyección existentes (`perfilValido`, `hrefDeSlug`).

---

## Decisiones que quedan dichas

- **Por qué estructural y no generado por IA**: Ubicaciones/Contacto son datos NAP puros (no hay
  nada que "redactar"); el Menú tampoco necesita prosa — es una lista de producto. Generarlos por
  LLM sería gastar tokens en algo que no lo necesita, y agregaría una fuente más de contenido que
  revisar en la compuerta humana.
- **Por qué el Blog es una llamada CDA nueva y no una carpeta de Storyblok**: mover las páginas
  `Article` a una carpeta `blog/` cambiaría sus slugs (y rompería las URLs de La Birra Bar que ya
  están publicadas y verificadas). Filtrar por `schema_type` en la CDA no toca ninguna URL existente.
