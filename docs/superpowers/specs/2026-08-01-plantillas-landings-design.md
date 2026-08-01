# Plantillas de landing — diseño

> **Estado:** 🟡 **diseñado, sin empezar.** La implementación **espera a que aterricen las piezas del
> portal de la agencia** (planificadas, sin empezar, en otra máquina y una rama por pieza — ver
> [11-plan-fase-2.md](../../proyecto/11-plan-fase-2.md)), por si la pieza *clientes* obliga a mover
> algo del contrato del perfil. Ver §Punto de unión con el portal.
>
> Enfoque elegido: **catálogo de piezas + la plantilla como receta** (opción B de tres evaluadas).
> Una sola plantilla implementada (`base`); la extensión a varias es escribir una receta, no CSS.

---

## Por qué

Las landings publicadas se ven sin terminar. No es una impresión: se manejó el sitio real de La
Birra Bar en un navegador (renderizador sobre el space de Storyblok de la demo) y lo que sale es
esto:

1. **Ni una sola foto en todo el sitio.** El CSS ya soporta `hero-img` y `section-img`
   (`web-builder/src/render/html.ts`), pero **el pipeline nunca las llena**: `handoff/adapter.ts` no
   toca `image` en ningún blok y `llm/content.ts` devuelve solo `{heading, body}`. El campo `Imagen`
   existe como slot opcional que únicamente puede rellenar un humano en el Visual Editor, y en la
   práctica queda vacío. Un negocio gastronómico se presenta como un muro de texto gris.
2. **El CTA no es un botón, es un párrafo rojo.** `cta_label` sale de `content_brief.cta` del brief
   SEO, que es una frase de marketing completa ("Visítanos en nuestros locales en Madrid y prueba la
   mejor hamburguesa gourmet de la ciudad."). Con `display:inline-block` + padding, eso se convierte
   en un bloque rojo de dos líneas. Y apunta a `#contacto`, un ancla al pie: no es una acción.
3. **Siete secciones visualmente idénticas.** `SectionBlok` es `{heading, body}` y el prompt pide
   "2-4 frases". El resultado es h2 + párrafo + línea divisoria, siete veces. Nada distingue "Nuestra
   Historia" de "Premios y Reconocimientos".
4. **Lo que la gente busca está enterrado en el pie.** Teléfono, horarios y direcciones viven solo en
   `renderFooter`. En un restaurante eso es el grueso de las visitas, y hay que scrollear siete
   secciones de prosa para llegar.
5. **`page_type` se ignora.** El contrato distingue `servicio` / `landing_local` / `blog` /
   `institucional`, y el renderizador los pinta a todos igual: `page_type` e `intent` solo aparecen
   dentro de `researchTrace`.
6. **Bugs visuales concretos.** El media query oscuro invierte `.sitebar`, `.hero`, `footer`,
   `section` y `.card`, pero **no** `.carta li` (`#f5f4f2`) ni `details` (`#e7e5e0`): esas líneas
   quedan casi blancas sobre negro. `.carta` y su último `<li>` dibujan **dos bordes pegados** al
   final de cada categoría. Los enlaces del pie ("Blog", los `tel:`) salen con el azul por defecto
   del navegador, el peor contraste de la página. Y `--accent: #b91c1c` sobre `--bg: #111` no llega
   a 4.5:1.

La causa de fondo de (1)–(4) es la misma: **el renderizador tiene un layout único hardcodeado**.
`renderStory` busca un hero, mapea las secciones y cierra con la FAQ. No hay forma de decir "esta
página lleva galería y platos destacados, aquella no" sin editar esa función.

## Qué se construye

Tres capas, de abajo hacia arriba.

### 1. Catálogo de piezas

`web-builder/src/render/piezas/` — una pieza por archivo. Cada pieza es un objeto con tres cosas:

```ts
interface Pieza {
  id: string;                              // "heroPortada", "platosDestacados", …
  css: string;                             // el CSS que necesita, y solo ese
  render(ctx: CtxPieza): string;           // "" si no tiene datos que mostrar
}

interface CtxPieza {
  story: Story | null;                     // null en las páginas sintetizadas (/menu, /blog, home)
  profile: BusinessProfile | null;
  activeSlug: string;
}
```

**Una pieza sin datos devuelve `""` y no aporta su CSS.** Es la regla que hace que la receta pueda
listar piezas optimistas sin producir huecos: un perfil sin `locations` simplemente no dibuja la
pieza `locales`.

Piezas de la plantilla `base`:

| Pieza | De dónde salen sus datos | Qué hace |
| --- | --- | --- |
| `cabecera` | perfil (`name`, `brand.logo`) | La `renderSiteHeader` actual, movida sin cambios de comportamiento. |
| `heroPortada` | blok `hero` + `profile.portada` | Titular, bajada y **foto de portada**. Sin foto, degrada a hero tipográfico (fondo de marca, titular grande) — no a un hueco. |
| `barraDatos` | `telephone`, `opening_hours`, `address`/`locations[0]` | Franja bajo el hero: teléfono clicable, horario, "Cómo llegar". Los datos comerciales dejan de estar solo en el pie. |
| `seccionProsa` | bloks `section` | La sección actual, con **ritmo alterno**: las secciones pares cambian de fondo y de ancho de medida. Mismo contenido, deja de leerse como una lista. |
| `platosDestacados` | `profile.menu` | Hasta 6 ítems con foto, nombre, descripción y precio. Enlaza a `/menu`. |
| `galeria` | `profile.fotos` | Rejilla de fotos del negocio. |
| `locales` | `profile.locations` | Un bloque por local con foto, dirección, horario, teléfono y enlace a mapa. **Dueña de `id="ubicaciones"`** — ver la nota de abajo. |
| `faq` | blok `faq` | La `renderFaq` actual, movida. |
| `ctaFinal` | perfil | Cierre con la acción real (llamar / cómo llegar). Una landing larga necesita un CTA al final, no solo en el hero. |
| `pie` | perfil | La `renderFooter` actual **menos el bloque de ubicaciones**: contacto, enlace a blog y línea técnica. |

`barraDatos` y `locales` no se pisan: la primera es el resumen accionable de un solo local (el
primero) arriba del todo; la segunda es el detalle de todos, más abajo.

**`locales` sale del pie y sube al cuerpo, y eso obliga a una regla.** Hoy las ubicaciones viven en
`renderFooter`, que está en todas las páginas justamente para que el ancla `#ubicaciones` del nav
funcione desde cualquiera. Si la pieza `locales` se mueve al cuerpo y no está en todas las recetas,
ese ancla se rompe en `/menu` y `/blog` — una regresión de lo que el diseño de navegación cerró el
2026-08-01. Por eso: **`locales` es obligatoria en toda receta**, incluidas las de las páginas
sintetizadas, y el `id="ubicaciones"` es suyo y de nadie más. Un test lo fija (§Testing).

`cabecera`, `seccionProsa`, `faq` y `pie` son **traslados** del HTML que ya existe, no reescrituras:
su salida debe seguir pasando los tests de render actuales salvo por los arreglos declarados en
§Arreglos incluidos.

### 2. La plantilla, que es una receta

```ts
interface Plantilla {
  id: string;
  piezas: string[];      // ids del catálogo, en orden de aparición
}

const BASE: Plantilla = {
  id: "base",
  piezas: ["cabecera", "heroPortada", "barraDatos", "seccionProsa", "platosDestacados",
           "galeria", "faq", "locales", "ctaFinal", "pie"],
};
```

Añadir una plantilla es añadir una receta. **No lleva CSS propio.** Una plantilla futura que
necesite un look distinto reordena piezas, omite piezas o aporta piezas nuevas al catálogo — pero no
puede traer una copia del CSS de otra plantilla, que es justamente lo que este diseño evita.

### 3. Selección y ensamblado

**Selección.** Campo nuevo `brand.plantilla?: string`. Desconocido o ausente → `base`. Una plantilla
inexistente **no es un error**: cae al default, igual que un color inválido cae al default hoy. Una
web servida es mejor que un 503 por un typo en una ficha.

**Ensamblado del CSS.** El `<style>` de la página lleva: tokens (`:root`) + CSS base compartido + el
CSS de las piezas **que efectivamente renderizaron algo**, deduplicado y **en orden de catálogo**
(no de aparición). El orden de catálogo es lo que hace la salida determinista: dos páginas con las
mismas piezas producen byte a byte el mismo `<style>`, sin importar cómo las ordene la receta. Es
testeable, y sin eso el CSS cambiaría según la página.

Que el CSS viaje solo si su pieza se usó también significa que una landing sin galería no paga los
bytes de la galería.

### Arreglos incluidos

Van dentro de este trabajo porque tocan el mismo CSS que se está reorganizando, y dejarlos fuera
significa reorganizar CSS con bugs adentro:

- Modo oscuro completo: `.carta li`, `details` y cualquier borde nuevo entran al media query.
- El doble borde al final de cada categoría de la carta.
- Enlaces del pie estilados (hoy salen con el azul del navegador).
- Contraste del acento en oscuro: el token `--accent` gana una variante para fondo oscuro, derivada
  en CSS, no un segundo campo en la ficha del cliente.
- El CTA del hero: si `cta_label` supera 28 caracteres, se muestra como bajada y el botón toma una
  etiqueta derivada del dato disponible ("Llamar", "Cómo llegar"). **Esto se resuelve en el render,
  no en el contrato del brief** — no se toca `kr-service`.

### Fuera de alcance, a propósito

- **Que el LLM emita secciones tipadas** (bullets, cifras). Decidido: las piezas nuevas se alimentan
  **solo de datos reales del perfil**. El prompt de `llm/content.ts` no se toca, y con él no aparece
  ninguna superficie nueva de invención de datos que revisar en la compuerta humana (ADR-06).
- **API y pantalla del portal para cargar fotos.** Este trabajo llega hasta el contrato y el render.
  Las URLs se cargan por seed/JSON, como todo el perfil hoy.
- **Una segunda plantilla.** Se construye el mecanismo y **una** plantilla. Una segunda sin cliente
  que la pida es diseño especulativo.
- **Storage de imágenes propio.** Las fotos son URLs de assets de Storyblok (el renderizador ya sabe
  extraer sus dimensiones de la URL con `dimsDeStoryblok`, lo que fija `width`/`height` y evita CLS).
  No se sube nada desde este código.
- **Reseñas de Google, reservas, pedidos.** No hay integración ni sistema; inventarlos sería inventar
  datos.
- **Usar `page_type` para elegir plantilla.** El mecanismo queda listo (la selección es un punto de
  extensión), pero con una sola plantilla no hay nada que elegir. Cuando exista la segunda, es una
  línea — y merece su propia decisión.

---

## Modelo de datos

`web-builder/src/types.ts`. Todos los campos son **opcionales**: un `business-profile.json` existente
sigue siendo válido sin tocarlo.

```ts
/** Una foto del negocio. Mismo criterio que `Imagen`: `alt` vacío = decorativa. */
interface Foto {
  src: string;      // URL http(s) — se valida en las tres fronteras (ver abajo)
  alt: string;
}

interface BusinessProfile {
  // …los campos actuales, sin cambios
  portada?: Foto;   // la foto del hero
  fotos?: Foto[];   // la galería
}

interface MenuItem {
  // …los campos actuales, sin cambios
  foto?: Foto;
}

interface Location {
  // …los campos actuales, sin cambios
  foto?: Foto;
}

interface BrandTheme {
  // …color, font, logo, sin cambios
  plantilla?: string;   // id de plantilla; desconocido → "base"
}
```

**Tope de la galería: 30 fotos**, aplicado en las tres fronteras — mismo criterio y misma razón que
`MAX_LOCALES` (20) y `MAX_ITEMS_CARTA` (200) de `renderer/src/perfil.ts`: sin tope, una ficha con
50.000 entradas se renderiza entera en cada visita fría, y no hace falta mala intención — alcanza un
import mal hecho.

### Las tres fronteras que tiene que cruzar un campo nuevo

Esta es la lección que la migración `0010` aprendió a golpes y que este diseño no puede repetir. Un
campo nuevo del perfil **no llega al HTML** si no cruza las tres:

1. **La allowlist de Postgres** (`app.nap_publico`, migración nueva **`0011`**). Reconstruye el
   perfil **campo por campo**, incluso dentro de `locations` y `menu` — una `foto` dentro de un
   `MenuItem` se filtraría en silencio. Y `app.texto_publico` **solo deja pasar strings**: `Foto` es
   un objeto, así que necesita su propia sub-allowlist (`src`, `alt`), igual que `address` y `brand`.
   La columna generada es `stored`: hay que **re-materializarla** (drop + add), porque no se recalcula
   sola al cambiar la función.
2. **`perfilValido`** (`renderer/src/perfil.ts`). Reconstruye el perfil campo por campo otra vez. Lo
   que no enumere, lo tira — aunque haya pasado la allowlist.
3. **El render** (`html.ts` y las piezas). Revalida `src` como http(s) antes de ponerlo en un
   `<img src>`, aunque Zod y las dos fronteras anteriores ya lo hayan visto. En producción el perfil
   puede llegar desde la base sin pasar por Zod: el renderizador no confía.

Un campo que cruce solo dos de las tres pasa todos los tests de `web-builder` y no funciona en la web
real. Ya pasó.

---

## Arquitectura de render

`renderStory` deja de tener el layout adentro y pasa a orquestar:

```text
renderStory(story, profile, lang, hayBlog)
  → plantillaDe(profile)                  // brand.plantilla → Plantilla, default base
  → para cada id de plantilla.piezas:
       pieza = catalogo[id]
       html  = pieza.render(ctx)
       si html !== "": acumular html y marcar la pieza como usada
  → cssDe(piezasUsadas)                   // tokens + base + CSS de las usadas, orden de catálogo
  → documento(head, css, htmlAcumulado)
```

`renderHome`, `renderMenu` y `renderBlogIndex` **comparten el mismo ensamblado**: hoy cada una repite
su propio `<!doctype>`, `<head>`, `<style>` y llamadas a `renderSiteHeader`/`renderFooter` — cuatro
copias de la misma estructura. Pasan a usar el ensamblador con su propia receta corta (`cabecera` +
lo suyo + `locales` + `pie`; `locales` es obligatoria, ver §1). Eso elimina la duplicación que hoy
hace que un arreglo de `<head>` haya que aplicarlo cuatro veces, y es la razón por la que el bug de
modo oscuro sobrevivió.

El JSON-LD **no se mueve a las piezas**: sigue calculándose por página, porque es una propiedad del
documento y no de un fragmento visual. Las piezas producen HTML, nada más.

`web-builder/src/render/html.ts` (751 líneas hoy) queda como el ensamblador y el `<head>`; el HTML
de cada bloque se va a su pieza. Ese archivo hace hoy demasiadas cosas para su tamaño, y partirlo por
pieza es lo que permite testear cada una sola.

## Casos borde

| Caso | Comportamiento |
| --- | --- |
| `brand.plantilla` desconocida o ausente | Cae a `base`. Nunca un error. |
| Perfil sin `portada` | `heroPortada` dibuja el hero tipográfico. No queda hueco ni imagen rota. |
| Perfil sin `fotos` | La pieza `galeria` devuelve `""` y **su CSS no viaja**. |
| Foto con `src` que no es http(s) | Se descarta esa foto; las demás se dibujan. Una galería de 5 con una URL hostil dibuja 4. |
| `fotos` con 500 entradas | Se cortan en 30, en las tres fronteras. |
| `foto` como string en vez de objeto | La sub-allowlist devuelve `null`; `perfilValido` la descarta; el ítem se dibuja sin foto. |
| Perfil `null` | La receta produce solo las piezas que no dependen del perfil. Es lo que hoy hace `renderStory(story)` a secas en los tests. |
| `alt` ausente | `alt=""` (decorativa), como ya hace `renderImagen`. |
| Perfil sin `locations` ni `address` | `locales` devuelve `""`. El nav ya no muestra "Ubicaciones" en ese caso (`hayUbicaciones`), así que no queda un ancla apuntando a la nada. |
| Todas las piezas devuelven `""` | Documento válido con `<head>` y `<main>` vacío, nunca una excepción. |

## Testing

Contra los **539 tests del monorepo** que hoy están en verde. Lo nuevo:

- **Por pieza** (`web-builder/src/render/piezas/*.test.ts`): con datos → renderiza; sin datos → `""`;
  con datos hostiles (`<script>`, `javascript:`, `src` no http) → escapado o descartado.
- **Ensamblado**: el CSS de una pieza que devolvió `""` **no aparece** en el `<style>`; el `<style>`
  es idéntico byte a byte para dos páginas con las mismas piezas usadas, sin importar el orden de la
  receta (el test que fija el determinismo).
- **Selección**: `plantilla` ausente / desconocida / válida → siempre un documento; nunca excepción.
- **El ancla `#ubicaciones` no se rompe**: toda receta incluye `locales`, y con un perfil con
  `locations` el `id="ubicaciones"` aparece **exactamente una vez** en la landing, en la home, en
  `/menu` y en `/blog`. Es la regresión que este movimiento puede causar (§1); el test la cierra.
- **Las tres fronteras, con un test cada una** (es el punto que se rompió la última vez):
  1. `db`, contra PGlite: una foto en `portada`, en `fotos[]`, en `menu[].foto` y en `locations[].foto`
     **sobrevive** `app.nap_publico`; un `src` que es un objeto no sobrevive; el tope de 30 se aplica
     en SQL.
  2. `renderer`: `perfilValido` conserva los cuatro campos nuevos y aplica el tope.
  3. `web-builder`: el render revalida `src` aunque le entre un perfil ya "validado".
- **Verificación por mutación** (disciplina del proyecto): quitar `portada` de la allowlist de la
  `0011` debe hacer caer *exactamente* el test de la frontera 1, no un test de render. Quitar la
  revalidación de `src` en la pieza debe caer *exactamente* el test de inyección de esa pieza.
- **Regresión de los arreglos**: un test que falle si `.carta li` o `details` quedan fuera del media
  query oscuro. Sin esto, el bug vuelve en el próximo que toque el CSS.
- **Navegador** (no negociable en este proyecto): el sitio de La Birra Bar manejado en claro y en
  oscuro, escritorio y móvil, con fotos y sin fotos. La lista de arriba encontró cosas que los 539
  tests no vieron; este spec existe por eso.

---

## Punto de unión con el portal

La implementación **espera** a que aterricen las cuatro piezas del portal (clientes → usuarios →
ideas → dashboard), que se ejecutan en otra máquina y una rama por pieza. El motivo no es de
calendario sino de contrato:

- La pieza **clientes** es la que muestra la ficha del cliente. Si define su propia forma de
  `business_profile` (tipos en el portal, un DTO en la API), los campos de foto tienen que entrar ahí
  también, y conviene hacerlo de una vez y no dos.
- La carga de fotos y la elección de plantilla son, a futuro, **pantallas de esa pieza**. Este spec
  deja el contrato definido para que el portal solo tenga que escribirlo — pero si al construir
  clientes aparece una forma distinta de modelar la ficha, este diseño se ajusta antes de
  implementarse, no después.

Lo que **no** cambia con el portal: la migración `0011`, `perfilValido` y el catálogo de piezas. Esa
parte es del renderizador y no depende de nadie.

## Decisiones que quedan dichas

- **Por qué piezas y no un template de terceros.** Un tema de ThemeForest o de Storyblok trae JS,
  fuentes de Google e iconos de CDN, y rompe lo que hace seguro al renderizador: página autocontenida,
  CSS inline, cero dependencias externas, todo escapado (ADR-19 — es la única pieza expuesta a
  internet anónimo). Además no resolvería nada: el template más bonito del mundo sigue sin fotos y
  con siete párrafos de prosa plana.
- **Por qué la plantilla no trae CSS.** Es lo que separa este diseño de "un archivo por plantilla":
  con CSS por plantilla, la segunda duplica la primera y el tercer cliente hereda los bugs de las
  dos. Con CSS por pieza, arreglar el hero lo arregla en todas las plantillas.
- **Por qué las piezas nuevas solo leen el perfil.** Cualquier dato que no esté en la ficha habría que
  inventarlo o pedírselo al LLM, y un dato inventado en una web de cliente es peor que una sección
  ausente — la misma decisión que el `null` de las métricas en `kr.v0.4` y que el `postalCode`
  opcional.
- **Por qué el CTA se arregla en el render y no en el brief.** El `cta_label` largo es contenido
  legítimo (una frase de marketing aprobada en la compuerta); lo que está mal es meterlo en un
  `<a class="cta">`. Cambiar `kr-service` para acortarlo obligaría a re-generar briefs ya aprobados.
- **Por qué una sola plantilla.** El pedido fue "mismo esqueleto, distinta marca, ampliable después".
  El mecanismo de ampliación se construye ahora porque después sale caro; las plantillas concretas,
  cuando haya un cliente que las necesite.
