# Plantillas de landing — diseño

> **Estado:** 🟡 **diseñado, sin empezar.** La implementación **espera a las cuatro piezas del portal
> de la agencia**; la **pieza 1 (clientes) aterrizó el 2026-08-01** y quedan tres — ver
> [11-plan-fase-2.md](../../proyecto/11-plan-fase-2.md) y §Punto de unión con el portal, donde está
> la **colisión de contrato que trajo esa pieza y que hay que cerrar antes de implementar**.
>
> Enfoque: **shell fijo + catálogo de piezas + la plantilla como receta de contenido**. Una sola
> plantilla implementada (`base`); ampliar a varias es escribir una receta, no CSS.
>
> **Revisado por Codex el 2026-08-01** (revisión de diseño, commit `253ef47`). Siete de ocho findings
> se aplicaron a este documento; el detalle de qué se verificó, qué se aceptó por juicio y qué se
> refutó está en §Qué cambió tras la revisión externa.
>
> **La migración de este spec es la `0014`.** El programa del portal reserva `0011` (clientes,
> aplicada), `0012` (usuarios) y `0013` (ideas); el dashboard no lleva. Este spec toma el primer
> número libre después de esa reserva. Si al implementar alguna de esas piezas dejó su número sin
> usar, **el hueco se queda** — renumerar rompe `app.migraciones_aplicadas`.
>
> **Enmendado el 2026-08-02** — ver §Enmienda 2026-08-02. La enmienda añade el **manual de marca**
> (tokens de color y roles tipográficos, en vez de los tres campos actuales) y **rediseña la carta**
> tomando como referencia visual un template real. **No crea una migración nueva: amplía la `0014`**,
> que todavía no se escribió. Las secciones afectadas de este documento están editadas en línea y
> marcadas *(enmienda 2026-08-02)*; el razonamiento completo vive en la sección de la enmienda.

---

## Por qué

Las landings publicadas se ven sin terminar. No es una impresión: se manejó el sitio real de La
Birra Bar en un navegador (renderizador sobre el space de Storyblok de la demo) y lo que sale es
esto:

1. **Ni una sola foto en todo el sitio.** El CSS ya soporta `hero-img` y `section-img`, pero **el
   pipeline nunca las llena**: `handoff/adapter.ts` no toca `image` en ningún blok y
   `llm/content.ts` devuelve solo `{heading, body}`. El campo `Imagen` existe como slot opcional que
   únicamente puede rellenar un humano en el Visual Editor, y en la práctica queda vacío. Un negocio
   gastronómico se presenta como un muro de texto gris.
2. **El CTA no es un botón, es un párrafo rojo.** `cta_label` sale de `content_brief.cta` del brief
   SEO, que es una frase de marketing completa. Con `display:inline-block` + padding se convierte en
   un bloque rojo de dos líneas. Y apunta a `#contacto`, un ancla al pie: no es una acción.
3. **Siete secciones visualmente idénticas.** `SectionBlok` es `{heading, body}` y el prompt pide
   "2-4 frases". El resultado es h2 + párrafo + línea divisoria, siete veces.
4. **Lo que la gente busca está enterrado en el pie.** Teléfono, horarios y direcciones viven solo en
   `renderFooter`. En un restaurante eso es el grueso de las visitas.
5. **`page_type` se ignora.** El contrato distingue `servicio` / `landing_local` / `blog` /
   `institucional`, y el renderizador los pinta a todos igual: `page_type` e `intent` solo aparecen
   dentro de `researchTrace`.
6. **Bugs visuales concretos.** El media query oscuro invierte `.sitebar`, `.hero`, `footer`,
   `section` y `.card`, pero **no** `.carta li` (`#f5f4f2`) ni `details` (`#e7e5e0`): esas líneas
   quedan casi blancas sobre negro. `.carta` y su último `<li>` dibujan **dos bordes pegados**. Los
   enlaces del pie salen con el azul por defecto del navegador. `--accent: #b91c1c` sobre
   `--bg: #111` no llega a 4.5:1.

La causa de fondo de (1)–(4) es la misma: **el renderizador tiene un layout único hardcodeado**.
`renderStory` busca un hero, mapea las secciones y cierra con la FAQ. No hay forma de decir "esta
página lleva galería y platos destacados, aquella no" sin editar esa función.

---

## Qué se construye

Cuatro capas. Las dos primeras son la corrección estructural; las dos últimas, lo visible.

### 1. El shell del documento — fijo, fuera de la receta

El shell no se configura. Emite siempre, y en este orden:

```text
<head>  (title, meta, canonical, OG, JSON-LD, research trace, <style>)
<body>
  cabecera        ← zona fija
  <main> … </main>  ← AQUÍ va la receta de contenido, y solo aquí
  <footer>
    contacto      ← zona fija
    locales       ← zona fija, dueña de id="ubicaciones"
    blog + línea técnica
  </footer>
```

**Por qué fijo.** `cabecera`, `locales` y `pie` no son contenido: son obligaciones del documento y de
la navegación. Si vivieran en la receta, el tipo permitiría poner el pie primero, omitir la cabecera
o duplicar las ubicaciones — y la única defensa sería la prosa de este documento. Además el nav
ancla a `#ubicaciones` desde todas las páginas, así que esa región tiene que existir en todas por
construcción, no por disciplina.

Esto reemplaza un parche de la primera versión de este diseño ("`locales` es obligatoria en toda
receta"), que era la señal de que el corte estaba mal: una pieza que toda receta debe incluir no es
una pieza de receta.

`locales` gana foto y enlace a mapa **dentro del pie**. No hace falta subirla al cuerpo para eso.

### 2. El catálogo de piezas

`web-builder/src/render/piezas/` — una pieza por archivo:

```ts
interface Pieza {
  id: string;                    // "heroPortada", "platosDestacados", …
  raiz: string;                  // clase raíz única: "p-heroPortada" — ver §3
  css: string;                   // su CSS, y solo el suyo
  render(ctx: CtxPieza): string; // "" si no tiene datos que mostrar
}

interface CtxPieza {
  story: Story | null;           // null en las páginas sintetizadas (/menu, /blog, home)
  profile: BusinessProfile | null;
  activeSlug: string;
}
```

**Una pieza sin datos devuelve `""` y no aporta su CSS.** Es lo que permite recetas optimistas sin
huecos: un perfil sin `locations` no dibuja `locales`.

| Pieza | Zona | Datos | Qué hace |
| --- | --- | --- | --- |
| `cabecera` | shell | `name`, `brand.logo` | La `renderSiteHeader` actual, trasladada. |
| `heroPortada` | contenido | blok `hero` + `profile.portada` | Titular, bajada y foto de portada. Sin foto degrada a hero tipográfico, no a un hueco. |
| `barraDatos` | contenido | `telephone`, `opening_hours`, `address`/`locations[0]` | Franja bajo el hero: teléfono clicable, horario, "Cómo llegar". |
| `seccionProsa` | contenido | bloks `section` | La sección actual, con ritmo alterno (las pares cambian fondo y ancho de medida). |
| `platosDestacados` | contenido | `profile.menu` | Hasta 6 ítems con foto, nombre, descripción y precio. Enlaza a `/menu`. |
| `cartaCategorias` | contenido | `profile.menu` + `profile.menu_categorias` | *(enmienda 2026-08-02)* La carta completa: un bloque por categoría, con su foto y sus platos. La usa la receta de `/menu`. |
| `galeria` | contenido | `profile.fotos` | Rejilla de fotos. |
| `faq` | contenido | blok `faq` | La `renderFaq` actual, trasladada. |
| `ctaFinal` | contenido | perfil | Cierre con la acción real (llamar / cómo llegar). |
| `contacto` | shell | perfil | Bloque de contacto del pie, trasladado. |
| `locales` | shell | `profile.locations` | Un bloque por local con foto, dirección, horario, teléfono y mapa. Dueña de `id="ubicaciones"`. |

`barraDatos` y `locales` no se pisan: la primera es el resumen accionable del primer local, arriba;
la segunda el detalle de todos, en el pie.

`cabecera`, `seccionProsa`, `faq`, `contacto` y `locales` son **traslados** del HTML existente, no
reescrituras (ver §Entrega 2).

### 3. Aislamiento del CSS — el contrato que hace componible al catálogo

Emitir el CSS en orden de catálogo hace la salida **determinista en bytes**, pero eso no basta:
reordenar la receta puede cambiar el resultado visual si las piezas se pisan por cascada,
especificidad o posición en el DOM. El CSS actual está lleno de selectores globales
(`section`, `section h2`, `details`, `summary`, `*`, `body`, `img`), y repartirlos por pieza sin
reglas convierte cada pieza en una amenaza para las demás.

**Reglas, verificadas por un test, no por revisión humana:**

1. Cada pieza tiene una **clase raíz única y estable** (`p-<id>`), que envuelve todo su HTML.
2. **Todo selector de su CSS empieza por esa raíz.** Sin excepciones.
3. Prohibido seleccionar la raíz de otra pieza, y prohibido depender de adyacencia entre piezas
   (`+`, `~` cruzando raíces).
4. `:first-child` / `:nth-child` solo dentro de la propia raíz.
5. **Cada pieza es dueña de TODAS sus reglas visuales: responsive y modo oscuro incluidos.** No
   existe un media query oscuro central. Es lo que evita el bug que este spec viene a arreglar: hoy
   una sola regla nombra `.sitebar`, `.hero`, `footer`, `section` y `.card` a la vez, y por eso
   `.carta li` y `details` quedaron fuera y nadie lo notó.
6. **Una pieza no define tokens que otra consume.** Los tokens (`:root`) y el reset pertenecen al CSS
   base y viajan siempre. Si dos piezas necesitan una primitiva común, esa primitiva sube al base y
   se acepta que viaje siempre — no se hereda de una pieza a otra.

El test lo comprueba mecánicamente: se parsean los selectores del `css` de cada pieza y se exige el
prefijo de su raíz. Un selector desnudo rompe el build de tests, no la web de un cliente.

### 4. La plantilla — una receta de contenido

```ts
interface Plantilla {
  id: string;
  contenido: string[];   // ids de piezas de CONTENIDO, en orden, dentro de <main>
}

const BASE: Plantilla = {
  id: "base",
  contenido: ["heroPortada", "barraDatos", "seccionProsa", "platosDestacados",
              "galeria", "faq", "ctaFinal"],
};
```

La receta **solo puede ordenar contenido**. No puede tocar el shell, omitir la cabecera ni mover el
pie: esas zonas no están en el tipo.

**Selección.** Campo nuevo `brand.plantilla?: string`. Desconocido o ausente → `base`. Una plantilla
inexistente **no es un error**: cae al default, igual que hoy un color inválido cae al default. Una
web servida es mejor que un 503 por un typo en una ficha.

**Ensamblado del CSS.** El `<style>` lleva tokens + base + el CSS de las piezas **que renderizaron
algo**, deduplicado y en **orden de catálogo** (no de receta), para que dos páginas con las mismas
piezas produzcan un `<style>` idéntico byte a byte. Con las reglas de §3, ese orden ya no puede
alterar el resultado visual — solo lo hace reproducible y testeable.

Una landing sin galería no paga los bytes de la galería.

### Arreglos incluidos

Van con este trabajo porque tocan el mismo CSS que se reorganiza:

- Modo oscuro completo (cada pieza dueña del suyo, §3.5).
- El doble borde al final de cada categoría de la carta.
- Enlaces del pie estilados (hoy salen con el azul del navegador).
- Contraste del acento en oscuro: variante derivada en CSS, no un segundo campo en la ficha.
- El CTA del hero: si `cta_label` supera 28 caracteres, se muestra como bajada y el botón toma una
  etiqueta derivada del dato ("Llamar", "Cómo llegar"). **Se resuelve en el render, no en el
  contrato del brief** — no se toca `kr-service`.

### Fuera de alcance, a propósito

- **Que el LLM emita secciones tipadas.** Las piezas nuevas se alimentan **solo de datos reales del
  perfil**. El prompt de `llm/content.ts` no se toca, y con él no aparece superficie nueva de
  invención de datos que revisar en la compuerta humana (ADR-06).
- **API y pantalla del portal para cargar fotos.** Este trabajo llega hasta el contrato y el render.
- **Una segunda plantilla.** Se construye el mecanismo y **una** plantilla.
- **Storage de imágenes propio.** Las fotos son URLs de assets de Storyblok.
- **Reseñas, reservas, pedidos.** No hay integración; inventarlos sería inventar datos.
- **Usar `page_type` para elegir plantilla.** El mecanismo queda listo, pero con una sola plantilla
  no hay nada que elegir.
- *(enmienda 2026-08-02)* **Las secciones restantes del template de referencia** — barra superior,
  contadores, "por qué elegirnos", franja de vídeo, testimonios, newsletter. Inventariadas en
  §Enmienda 2026-08-02 › El resto del catálogo. Los testimonios están **descartados**, no aplazados.

---

## Modelo de datos

`web-builder/src/types.ts`. Todos los campos **opcionales**: un `business-profile.json` existente
sigue siendo válido sin tocarlo.

```ts
/**
 * Una foto del negocio. `alt` vacío = decorativa, igual que `Imagen`.
 *
 * `alt` es OPCIONAL a propósito: el formulario del portal captura una URL y nada más
 * (§Punto de unión con el portal), así que exigirlo dejaría el campo inválido siempre. Sin `alt`
 * se emite `alt=""` — decorativa, que es lo correcto para una portada cuyo contenido ya está en
 * el `<h1>`, y nunca un `alt` inventado a partir del nombre del negocio.
 */
interface Foto {
  src: string;      // URL https de un host de la allowlist — ver §Política de imágenes
  alt?: string;
}

interface BusinessProfile {
  portada?: Foto;   // la foto del hero
  fotos?: Foto[];   // la galería
}

interface MenuItem  { foto?: Foto; }
interface Location  { foto?: Foto; }
interface BrandTheme { plantilla?: string; }   // desconocido → "base"
```

*(enmienda 2026-08-02)* — el manual de marca y la carta con categorías. Todo opcional, igual que
arriba; el detalle y el porqué están en §Enmienda 2026-08-02.

```ts
/** Nombres de ROL, no familias. El código mapea cada uno a una familia self-hosted o a un stack
 *  del sistema — cambiar qué hay detrás es un cambio de código, no una edición de fichas. */
type FuenteNombre =
  | "sistema" | "serif" | "moderna"          // las tres actuales, se mantienen
  | "condensada" | "geometrica" | "humanista" | "script";

interface BrandTheme {
  logo?: string;
  plantilla?: string;
  colores?: {                     // cada uno hex (#rgb o #rrggbb); lo que no valida, se descarta
    primario?: string;  secundario?: string;
    titulo?: string;    texto?: string;
    fondo?: string;     fondoAlt?: string;
  };
  fuentes?: {                     // nombres de una allowlist del código, NUNCA un stack CSS
    titulo?: FuenteNombre;  texto?: FuenteNombre;  decorativa?: FuenteNombre;
  };
  color?: string;                          // legacy → colores.primario
  font?: "sistema" | "serif" | "moderna";  // legacy → fuentes.texto
}

interface MenuItem {
  precios?: Array<{ etiqueta: string; importe: string }>;  // máx 3 — "Media" / "Ración"
  nota?: string;                                           // "Sin gluten", "Picante"
}

/** Opcional: sin esto la carta se agrupa como hoy, sin foto de categoría. */
interface MenuCategoria { nombre: string; foto?: Foto; orden?: number; }  // máx 20

interface BusinessProfile { menu_categorias?: MenuCategoria[]; }
```

**Tope de la galería: 30 fotos**, aplicado en las cuatro fronteras — mismo criterio que
`MAX_LOCALES` (20) y `MAX_ITEMS_CARTA` (200): sin tope, una ficha con 50.000 entradas se renderiza
entera en cada visita fría, y no hace falta mala intención — alcanza un import mal hecho.

### Política de imágenes

Las fotos son un vector nuevo hacia `<img src>` en el **único proceso expuesto a internet anónimo**
(ADR-19). Validar http(s) y escapar evita inyección, pero deja que cada visita dispare una petición a
un host arbitrario, que así obtiene IP, user-agent y patrón de tráfico de los visitantes del cliente.

1. **HTTPS obligatorio.** No `http:`. Además de la fuga, HTTP se bloquea como contenido mixto.
2. **Allowlist de hosts**, en el código del renderizador — **nunca en la ficha del cliente**, o una
   ficha comprometida se ampliaría sola. Contiene los hosts de assets de Storyblok; ampliarla es un
   cambio de código revisado.
3. **Comparación de host exacta**, sobre `new URL(src).hostname` en minúsculas, contra un `Set`.
   Nada de `endsWith` ni `includes`: `a.storyblok.com.evil.tld` y `evil-storyblok.com` deben fallar,
   y un test los prueba nominalmente.
4. **`referrerpolicy="no-referrer"`** en cada `<img>`, para que el host del asset no reciba la URL de
   la página del cliente.
5. **Presupuesto por página**, no solo por campo: el tope de 30 cubre `fotos`, pero `menu` (200),
   `locations` (20) y `menu_categorias` (20, *enmienda 2026-08-02*) pueden aportar 240 imágenes más.
   Tope global de **60 imágenes por documento**, aplicado en el ensamblado.
6. **El renderizador NUNCA descarga, inspecciona ni proxifica estas URLs.** Hoy no hay SSRF porque
   `dimsDeStoryblok` solo parsea el string de la URL. Queda escrito acá para que un futuro "optimizá
   las imágenes" o "leé las dimensiones reales" tenga que romper una regla explícita, no descubrirla.

### Las cuatro fronteras que tiene que cruzar un campo nuevo

Un campo nuevo del perfil **no llega al HTML** si no cruza las cuatro. La primera versión de este
spec enumeraba tres y se olvidaba de Zod — el mismo tipo de omisión que causó la migración `0010`.

1. **Zod, en la puerta de `web-builder`** (`contract.ts`). `businessProfileSchema` es un `z.object`,
   que **descarta claves desconocidas**, y `parseProfile` devuelve `parsed.data`. Sin ampliarlo, las
   fotos desaparecen en el preview del CLI aunque estén en el JSON. El propio código ya lo dice:
   *"tienen que coincidir en las tres capas (Zod en la puerta, Postgres, el validador del renderer)"*.
2. **La allowlist de Postgres** (`app.nap_publico`, migración **`0014`**). Reconstruye el perfil campo
   por campo, incluso dentro de `locations` y `menu`. Y `app.texto_publico` **solo deja pasar
   strings**: `Foto` es un objeto, así que necesita su propia sub-allowlist (`src`, `alt`), como
   `address` y `brand`.
3. **`perfilValido`** (`renderer/src/perfil.ts`). Reconstruye el perfil campo por campo otra vez. Lo
   que no enumere, lo tira — aunque haya pasado la allowlist.
4. **El render.** Revalida contra la §Política de imágenes antes de emitir un `<img src>`, aunque las
   tres capas anteriores ya lo hayan visto. En producción el perfil puede llegar desde la base sin
   pasar por Zod: el renderizador no confía.

**El preview del Visual Editor no es una quinta frontera**: usa el mismo perfil público y el mismo
`perfilValido`; lo único que cambia es la versión de la story (`draft`).

### Matriz de productores de perfil

Todo lo que construye un `BusinessProfile` tiene que aprender los campos nuevos, o el campo existe
en el tipo y no aparece en ningún lado:

| Productor | Qué actualizar |
| --- | --- |
| `web-builder/business-profile.json` | Las fotos reales del cliente de demo. |
| `web-builder/src/fixtures.ts` | Fixtures con y sin fotos, para los tests de piezas. |
| `db/src/seed-demo.ts` | El perfil sembrado en Supabase (hoy sin fotos). |
| `renderer/src/dev-server.ts` | Los perfiles mock, para poder verlo en un navegador sin credenciales. |
| `renderer/src/demo-server.ts` | Ídem contra el Storyblok real. |

*(enmienda 2026-08-02)* Los mismos cinco productores tienen que aprender también el manual de marca y
los campos de carta. Y hacen falta **dos perfiles de fixture, no uno**: uno con el manual completo y
otro con el legacy `{color, font}` — sin el segundo, nada prueba que las webs ya sembradas sigan
funcionando, que es la única regresión que esta enmienda puede causar.

---

## La migración `0014`

Reemplaza `app.nap_publico` y **re-materializa** la columna generada (`drop column` + `add column …
generated always as … stored`), porque una columna `stored` no se recalcula porque cambie la función.
Mismo mecanismo que la `0009` y la `0010`.

**El `grant` es obligatorio y es el riesgo real de esta migración.** `drop column` **borra el grant
de columna**. Está documentado en el repo con esas palabras
([`0009_marca_publica.sql`](../../../db/migrations/0009_marca_publica.sql): *"El grant se perdió al
hacer drop column: se vuelve a conceder sobre la columna recreada"*). Si la `0014` lo olvida,
`app_render` pierde el `select` sobre `business_profile_publico` y **caen las webs de todos los
clientes a la vez**. No es un riesgo operativo: es una línea de SQL que falta.

```sql
grant select (business_profile_publico) on clients to app_render;
```

Un test lo verifica **después** de aplicar la `0014`, conectando como `app_render`: no basta con que
la línea esté escrita.

`lock_timeout` explícito al inicio de la migración, que es barato y evita que un lock inesperado
quede colgado.

**Lo que este spec NO exige, a propósito:** ventana de despliegue, medición previa de filas ni
presupuesto de WAL. `clients` tiene **una fila por cliente de la agencia** — decenas como techo, por
la naturaleza del negocio. Re-materializar esa tabla es instantáneo. Esas precauciones son correctas
para una tabla grande y desproporcionadas acá; escribirlas igual sería teatro de proceso.

---

## Arquitectura de render

```text
renderPagina(shell, plantilla, ctx)
  → piezas del shell (cabecera)            → html + marcar usadas
  → para cada id de plantilla.contenido:   → html dentro de <main>, marcar usadas
  → piezas del shell (contacto, locales)   → html dentro de <footer>
  → cssDe(usadas)                          → tokens + base + CSS en orden de catálogo
  → documento(head, css, zonas)
```

`renderStory`, `renderHome`, `renderMenu` y `renderBlogIndex` pasan a ser **cuatro llamadas al mismo
ensamblador** con distinta receta de contenido. Hoy cada una repite su propio `<!doctype>`, `<head>`,
`<style>` y llamadas a `renderSiteHeader`/`renderFooter` — cuatro copias de la misma estructura, que
es la razón por la que el bug de modo oscuro sobrevivió: había que arreglarlo cuatro veces.

El JSON-LD **no se mueve a las piezas**: es una propiedad del documento, no de un fragmento visual.
Las piezas producen HTML y nada más.

## Casos borde

| Caso | Comportamiento |
| --- | --- |
| `brand.plantilla` desconocida o ausente | Cae a `base`. Nunca un error. |
| Perfil sin `portada` | Hero tipográfico. No queda hueco ni imagen rota. |
| Perfil sin `fotos` | `galeria` devuelve `""` y **su CSS no viaja**. |
| Foto con host fuera de la allowlist | Se descarta esa foto; las demás se dibujan. |
| Foto con `http:` | Se descarta. |
| `fotos` con 500 entradas | Se cortan en 30, en las cuatro fronteras. |
| Documento que pediría 200 imágenes | Se corta en 60 (presupuesto global). |
| `foto` como string en vez de objeto | La sub-allowlist devuelve `null`, `perfilValido` la descarta, el ítem se dibuja sin foto. |
| `foto` sin `alt` (el caso normal, viniendo del portal) | Se emite `alt=""` — decorativa. Nunca un `alt` derivado del nombre del negocio: un texto alternativo inventado es peor que ninguno, igual que un `postalCode` inventado. |
| Perfil `null` | Las piezas de shell que dependen del perfil devuelven `""` — la cabecera se omite entera, como ya hace hoy `renderSiteHeader`. El pie queda con la línea técnica. El documento sigue siendo válido. |
| Perfil sin `locations` ni `address` | `locales` devuelve `""`. El nav ya no muestra "Ubicaciones" (`hayUbicaciones`), así que no queda un ancla apuntando a la nada. |
| Todas las piezas devuelven `""` | Documento válido con `<head>` y `<main>` vacío, nunca una excepción. |

---

## Las tres entregas

Un solo plan rector, tres entregas verificables por separado. Mezclarlas hace imposible distinguir
una pérdida de datos de una regresión de refactor y de un defecto visual.

### Entrega 1 — Contrato y recorrido de datos

Tipos, Zod, migración `0014`, `perfilValido`, fixtures, seed y servidores de dev/demo.
**Sin tocar el render.**

*(enmienda 2026-08-02)* Incluye también `brand.colores`, `brand.fuentes`, `MenuItem.precios`,
`MenuItem.nota` y `menu_categorias`, **en la misma `0014`**: son campos del mismo perfil que cruzan
las mismas cuatro fronteras, y partirlos en dos migraciones significaría re-materializar la columna
generada dos veces —con su `drop column` y su `grant`— por nada.

*Gate:* un test por cada una de las cuatro fronteras, más el del `grant` conectando como
`app_render`. Verificación por mutación: quitar `portada` de la allowlist de la `0014` debe hacer
caer *exactamente* el test de la frontera 2, no un test de render. La mutación se repite con un
token de marca (`colores.primario`) y con `precios`: son sub-objetos anidados dentro de `brand` y de
`menu`, que es donde la allowlist es más fácil de escribir mal sin que nada se queje.

### Entrega 2 — Ensamblado y piezas existentes, con paridad

Shell, catálogo, receta, ensamblador de CSS y traslado de las piezas que ya existen
(`cabecera`, `seccionProsa`, `faq`, `contacto`, `locales`). **Sin diseño nuevo y sin los arreglos
visuales**: esta entrega no debe cambiar cómo se ve el sitio.

*(enmienda 2026-08-02)* El CSS base pasa a emitir los tokens del manual de marca, **con los valores
actuales como default**. Es deliberado que esta entrega los emita sin usarlos para nada nuevo: así
la paridad visual del gate sigue siendo exigible. Las fuentes y el rediseño van en la entrega 3.

*Gate:* **paridad de contenido** contra fixtures del HTML actual capturadas antes de empezar. Paridad
de contenido significa: el texto visible, los `href`, los `id` de ancla y el JSON-LD son idénticos.
El markup de presentación (clases raíz nuevas, envoltorios) sí cambia — la paridad byte a byte es
imposible cuando el objetivo del refactor es reorganizar clases. El JSON-LD sí se compara byte a
byte, porque no tiene motivo para cambiar.

*Gate adicional:* el test de aislamiento de §3 en verde para todas las piezas trasladadas. Es acá
donde se descubre qué selectores globales del CSS actual no tienen dueño claro.

### Entrega 3 — Piezas nuevas y arreglos visuales

`heroPortada`, `barraDatos`, `platosDestacados`, `galeria`, `ctaFinal`, más los arreglos de
§Arreglos incluidos.

*(enmienda 2026-08-02)* Suma `cartaCategorias`, las tipografías self-hosted y el uso real de los
tokens de marca en el CSS de las piezas. **Es la entrega donde el sitio cambia de aspecto**, y por
eso se hace después de que la 2 haya demostrado paridad: si el rediseño y el refactor entran juntos,
un cambio inesperado no se puede atribuir a ninguno de los dos.

*Gate:* tests por pieza, y **el sitio manejado en un navegador** en claro y oscuro, escritorio y
móvil, con fotos y sin fotos. Los seis problemas que abren este spec los encontró un navegador, no
los 584 tests del monorepo. *(enmienda)* Añadir al recorrido: un cliente con manual de marca completo
y otro con el perfil legacy `{color, font}`, para ver con los ojos que la web vieja no se rompió.

*Orden de despliegue:* entrega 1 primero (la capa de datos tolera campos que nadie lee todavía);
render después.

## Testing

Contra los **584 tests del monorepo** que hoy están en verde. Lo nuevo, además de los gates:

- **Por pieza**: con datos → renderiza; sin datos → `""`; con datos hostiles (`<script>`,
  `javascript:`, host fuera de allowlist, `http:`) → escapado o descartado.
- **Aislamiento** (§3): todo selector del CSS de una pieza empieza por su raíz; ninguna pieza declara
  tokens; ninguna pieza contiene un media query oscuro que nombre clases ajenas.
- **Ensamblado**: el CSS de una pieza que devolvió `""` no aparece en el `<style>`; el `<style>` es
  idéntico byte a byte para dos páginas con las mismas piezas usadas, sin importar el orden de la
  receta.
- **Shell**: `id="ubicaciones"` aparece **exactamente una vez** en la landing, la home, `/menu` y
  `/blog`. Ninguna receta puede omitir cabecera ni pie (no están en el tipo — el test lo confirma
  sobre el HTML emitido).
- **Hosts de imagen**, nominalmente: `a.storyblok.com` pasa; `a.storyblok.com.evil.tld`,
  `evil-storyblok.com`, `A.STORYBLOK.COM.evil.tld` y `http://a.storyblok.com` no.
- **Presupuesto**: un perfil con 200 fotos repartidas entre galería, carta y locales emite como mucho
  60 `<img>`.
- **Regresión de los arreglos**: un test que falle si el modo oscuro de una pieza queda incompleto.
- *(enmienda 2026-08-02)* Tokens de marca, tipografías, `cartaCategorias` y la ruta de fuentes: ver
  §Enmienda 2026-08-02 › Testing que añade esta enmienda.

---

## Punto de unión con el portal

La implementación **espera a las cuatro piezas del portal** (clientes → usuarios → ideas →
dashboard). **La pieza 1 (clientes) aterrizó en `main` el 2026-08-01**; quedan tres.

Codex observó —con razón en los hechos— que solo la pieza **clientes** podría mover el contrato del
perfil, y que la entrega 1 y el refactor de la entrega 2 no dependen de ninguna de las cuatro. Se
mantuvo la espera completa por decisión del usuario. **La espera se justificó sola**: la pieza 1
trajo una colisión de contrato que no era visible desde el renderizador (ver abajo).

### Lo que la pieza 1 no cambió (verificado)

- La `0011_clientes_crm.sql` **no toca** `app.nap_publico`, no re-materializa
  `business_profile_publico` y no concede ningún grant nuevo a `app_render`. Está declarado en la
  cabecera del archivo y cumplido en el cuerpo.
- El enmascarado de las columnas de CRM para el rol `cliente` usa **allowlist positiva**
  (`app.es_staff()`), evaluada dentro de Postgres. No afecta a `app_render`, que sigue con
  `select (business_profile_publico)` a secas.
- El CRM no lee `business_profile`: sus columnas no están en `CLIENTE_CRM_COLS`.

### La colisión: dos portadas, dos destinos

El portal ya tiene un formulario donde **la agencia carga `logo_url` y `portada_url`**
(`cliente-crear.ts`, `cliente-meta-card.ts`). Esas URLs se guardan en `clients.contacto`, el jsonb
que la `0011` declara **interno y que "NUNCA entra en `business_profile_publico`"**.

Este spec, en cambio, propone `business_profile.portada` y `business_profile.fotos` como campos
**públicos**, que el renderizador lee por la allowlist.

Son el mismo dato de negocio con dos destinos incompatibles. Sin resolverlo: la agencia carga la
portada en la pantalla del portal, la web nunca la muestra, y no hay nada que explique por qué.

Lo notable es que el portal **dejó el hueco a propósito**: `cliente-meta-card.ts` documenta que no
renderiza esas URLs como `<img>` porque *"este portal reserva la validación de imágenes públicas para
`business_profile_publico` (ADR-19, allowlist del renderizador)"*. Está esperando esta pieza. Lo que
falta es el puente, y el propio plan del portal ya fijó hacia dónde va: *"el formulario de sucursales
escribe en `business_profile.locations`"* — los datos públicos se escriben en el perfil público, los
internos en `contacto`. `logo_url`/`portada_url` quedaron del lado interno por herencia del CRM viejo
de Firestore, donde `contacto` era el saco de todo, no por una decisión de frontera.

**Lo que NO se debe hacer, y queda escrito acá antes de que a alguien le parezca lo obvio:** ampliar
`app.nap_publico` para que `contacto.logo_url` / `contacto.portada_url` salgan a
`business_profile_publico`. Ese jsonb guarda además notas de la agencia, teléfonos de contacto
interno y datos de Google Places. Abrirlo campo por campo es hacer un agujero en la pared que la
`0011` acaba de levantar, y del otro lado está el rol anónimo. El plan del portal ya lo prohíbe con
un test de mutación propio.

### Cómo se cierra: el dato público se guarda en el campo público

**Decisión (2026-08-02):** el formulario del portal deja de escribir esas dos URLs en `contacto` y
escribe en `business_profile`. Es el criterio que el propio plan del portal ya fijó para las
sucursales; `logo_url`/`portada_url` son la excepción heredada, no la regla.

| Campo del formulario | Destino hoy (mal) | Destino correcto |
| --- | --- | --- |
| "URL del logo" | `contacto.logo_url` | `business_profile.brand.logo` — **ya existe**, ya es público, ya lo pinta la cabecera del sitio |
| "URL de imagen de portada" | `contacto.portada_url` | `business_profile.portada.src` — nuevo, lo agrega este spec |

**Este cambio es de la pieza del portal, no de este spec** (que llega hasta contrato y render). Ya
tiene dueño explícito: **[Trabajo E del programa del
portal](../plans/2026-08-01-portal-agencia-programa.md)**, con la entrega 1 de este spec como
precondición. Antes de asignarlo, el cambio no era de nadie — el spec lo excluía por alcance y la
pieza 1 ya estaba cerrada. Queda especificado acá para que quien lo implemente no tenga que
re-deducirlo:

1. `business_profile` **no está en `COLUMNAS_EDITABLES`** (`db/src/clientes.ts`): hoy la API del CRM
   no puede escribir el perfil público. Pero **no basta con agregarlo a esa lista**:
   `actualizarCliente` escribe la columna **entera** (`contacto = $n::jsonb`), así que un `PATCH` que
   solo trajera la portada **borraría `locations`, `menu`, `brand` y `name`** — pérdida silenciosa en
   el dato que alimenta la web pública. Hace falta una operación estrecha con **merge anidado en el
   servidor**, que toque solo los paths del formulario, y un test que verifique que el resto del
   perfil sobrevive. Con eso aparece además una vía de escritura hacia el dato que consume el rol
   anónimo: las cuatro fronteras siguen protegiendo la **lectura**, pero la escritura debe validar
   forma, HTTPS y host en vez de apoyarse solo en que el renderizador descarte después.
2. **No hay migración de datos.** `logo_url`/`portada_url` no están cargados en ningún seed, fixture
   ni JSON del repo: el campo está vacío en todas partes. Mover el destino ahora cuesta cero; después
   de dar de alta el primer cliente real con la pantalla actual, cada uno es un dato que hay que
   mover a mano.
3. **Orden:** la entrega 1 de este spec va primero (es la que crea `business_profile.portada`); el
   cambio del portal, después. Al revés, el formulario escribiría un campo que no existe.
4. **`alt`:** el formulario captura una URL y nada más. Por eso `Foto.alt` es **opcional** con default
   `""` (decorativa) — ver §Modelo de datos. Exigir un `alt` que la pantalla no pide dejaría el campo
   inválido siempre.

---

## Enmienda 2026-08-02 — manual de marca y carta con categorías

Sesión de diseño con el usuario partiendo de un template real de restaurante
(`foodu-react.vercel.app/home-6`). Dos cosas que este spec no cubría: **el manual de marca** y **la
carta**. El resto del catálogo de ese template queda inventariado al final, para las piezas
siguientes.

### Por qué esto no contradice "piezas y no un template de terceros"

§Decisiones que quedan dichas rechaza adoptar un tema de terceros, y sigue vigente: el template **no
se instala, no se importa y no aporta un byte** al repositorio. No entran su HTML, su CSS, su JS, sus
iconos ni sus fotos.

Lo que sí se toma es lo que no tiene dueño: **saber qué secciones tiene la home de un restaurante que
funciona, y en qué orden**. Eso se catalogó mirando el DOM renderizado, y de ahí salen dos
conclusiones que ninguna revisión del código propio habría dado: que nuestro modelo de carta es más
pobre de lo que un restaurante necesita, y que un manual de marca son ocho decisiones, no tres.

El template usa Bootstrap, Swiper, Font Awesome y tres fuentes de Google en 930 KB de CSS. Nada de
eso entra: sigue valiendo la página autocontenida de ADR-19.

### El manual de marca

Hoy la marca son tres campos (`color`, `font` de tres opciones, `logo`) y el CSS los usa como
`--accent` y `--font` ([`html.ts`](../../../web-builder/src/render/html.ts), `themeCss`). Con eso, dos
restaurantes distintos se distinguen por un color de acento. El modelo nuevo está en §Modelo de
datos; lo que importa es cómo se hace cumplir:

**Emisión.** Los tokens se emiten como custom properties en el `<style>` del documento, dentro del
CSS base — nunca desde una pieza (§3, regla 6). Un token ausente no emite nada y el default del base
gana. Es lo que permite que una ficha a medio llenar produzca una web coherente en vez de una web
rota a trozos.

**Validación: las mismas cuatro fronteras.** Un token es un valor de cliente que termina literalmente
dentro de un `<style>`; es la superficie de inyección más directa del sistema. Cada color se valida
como hex (`#rgb` o `#rrggbb`) en las cuatro capas, y cada fuente contra la allowlist de nombres. **Lo
que no valida se descarta y cae al default** — nunca rompe la página, la deja sobria. Es la regla que
ya aplica `themeCss` hoy, extendida token a token.

**Compatibilidad con lo sembrado.** Las fichas existentes tienen `{color, font}`. El legacy se sigue
leyendo y mapea a `colores.primario` y `fuentes.texto`. Si una ficha trae las dos formas, **gana la
específica** (`colores.primario` sobre `color`): la nueva es una decisión explícita, la vieja es
herencia. Un test lo fija en los dos sentidos.

**Lo que no se hace: derivar colores.** Nada de calcular un hover un 12% más oscuro ni un contraste
automático en TypeScript. Las variantes que hagan falta se derivan en CSS (`color-mix`), donde el
navegador se encarga y no hay una segunda copia de la paleta que se desincronice. El único derivado
que este spec ya contemplaba —la variante de acento para modo oscuro (§Arreglos incluidos)— sigue
resolviéndose así.

### Las tipografías, self-hosted

El template carga Jost, Oswald y Dancing Script desde `fonts.googleapis.com`. **Eso no entra**: mete
un tercero en el path de render del proceso anónimo, añade una conexión bloqueante antes del LCP y
manda la IP de cada visitante a Google. Es exactamente lo que §Política de imágenes prohíbe para las
fotos; sería incoherente permitirlo para las fuentes.

Se sirven desde nuestro propio dominio. Consecuencias, dichas antes de implementarlas:

1. **El renderizador gana una ruta pública nueva** (`/_assets/fonts/…`). Hasta hoy solo emite HTML.
   La pregunta del proyecto es *"si me lo toman, ¿qué se llevan?"*: la respuesta tiene que ser "unos
   archivos de fuente que ya son públicos". Para que sea cierto, **la ruta sirve desde un mapa fijo
   compilado en el código** (nombre lógico → bytes), no desde el filesystem por la ruta que pida
   quien llama. Así no hay path traversal que buscar: no hay path. Un test pide
   `/_assets/fonts/../../etc/passwd` y espera 404.
2. **Cache inmutable** (`cache-control: public, max-age=31536000, immutable`) con el hash en el
   nombre. Con la CDN que ADR-19 ya exige delante, el origen las sirve una vez.
3. **Subset latino, `woff2`, `font-display: swap`**, y `preload` **solo** de la fuente de titulares.
   Precargar tres familias es competir contra el propio LCP.
4. **Solo entran familias con licencia que permita self-host** (las tres del template son SIL OFL,
   pero eso **se verifica al implementar**, familia por familia, y la licencia se commitea junto al
   archivo). Una fuente sin su licencia en el repo no se sirve.

**La ficha elige un nombre de rol, nunca una familia ni un stack.** La allowlist crece con nombres
neutros —`condensada`, `geometrica`, `humanista`, `script`, más los tres actuales— y el código mapea
nombre → familia self-hosted o stack del sistema. Cambiar qué familia concreta hay detrás de
`condensada` es entonces un cambio de código revisado, no una edición de fichas de clientes.

### La carta

La sección de menú del template pinta, por cada categoría, una foto grande y una lista de platos con
miniatura, **dos precios** (media ración / ración) y una nota corta. Nuestro `MenuItem` tiene
`{category, name, description, price}`: un solo precio y ningún sitio donde poner lo demás.

**`cartaCategorias`** es la pieza nueva (§2). La receta de `/menu` la usa; la home sigue usando
`platosDestacados`, que ya estaba especificada. Son dos piezas y no una con dos modos porque el
contrato `Pieza` no recibe parámetros de receta — y forzarlo sería abrir la puerta a piezas
configurables, que es justo lo que §4 evita. **La fila de plato es común a las dos**, así que su
markup se genera con una función compartida y su CSS vive en el base, como manda §3 regla 6.

**Reglas de omisión** (el `""` de §2, aplicado al detalle):

- Sin `menu` no hay pieza, y `/menu` sigue dando 404 como hoy.
- Sin `menu_categorias`, la carta se agrupa por el `category` de cada plato y no muestra fotos de
  categoría. Un cliente que solo tiene la lista de platos conserva su carta entera.
- Categoría sin foto → el bloque ocupa el ancho completo. No queda un hueco esperando una imagen.
- Plato sin foto → fila sin miniatura. Nunca una foto genérica de otro restaurante.

**Precios.** `precios` manda sobre `price`; `price` es el atajo para el caso de un solo importe. El
`importe` sigue siendo **texto libre** por la misma razón que hoy (`"12,50 €"`, `"s/ mercado"`):
tipificarlo obligaría a decidir moneda y formato en el modelo, y lo único que hace falta es imprimir
lo que escribió el cliente. En el JSON-LD, `offers` toma **el primero** de `precios` — decidido acá y
con su test, para que no lo decida por accidente el orden de un `Object.keys`.

`platosDestacados` (el extracto de la home) muestra **solo el primer precio**, sin etiqueta. Es un
gancho hacia `/menu`, no la carta: repetir ahí "Media 9 € / Ración 15 €" convierte un extracto en una
tabla y le quita la razón de existir al enlace.

**Topes**, en las cuatro fronteras como el resto: `precios` máx 3, `menu_categorias` máx 20. En la
`0014` se aplican cortando la fuente (`where i <= N`), igual que la `0010` con los 200 platos.

> **Ambigüedad del documento base que hay que cerrar al implementar** (no la introduce esta enmienda,
> pero esta enmienda tropieza con ella): §4 define `Plantilla` como **una** receta y `brand.plantilla`
> como el campo que la elige, mientras que §Arquitectura de render dice que `renderStory`,
> `renderHome`, `renderMenu` y `renderBlogIndex` son **cuatro** recetas distintas. Las dos frases no
> pueden ser ciertas a la vez con un solo campo. La lectura que asume esta enmienda —y que hay que
> confirmar o corregir en el plan— es que **`brand.plantilla` elige un juego de cuatro recetas**, una
> por tipo de documento, y que `base` es el único juego que existe hoy. Con la otra lectura,
> `cartaCategorias` no tendría dónde vivir.

### Casos borde que añade esta enmienda

| Caso | Comportamiento |
| --- | --- |
| Color con `</style>`, `;}` o `url(…)` | No es hex: se descarta, cae al default. La página sale sobria, nunca rota. |
| Fuente fuera de la allowlist | Cae al default del rol. |
| Ficha con `color` legacy **y** `colores.primario` | Gana `colores.primario`. |
| Ficha solo con `{color, font}` legacy | Se mapea y renderiza como hoy. **Ninguna web sembrada cambia de aspecto por esta enmienda.** |
| `precios` con 5 entradas | Se cortan en 3. |
| Una entrada de `precios` sin `etiqueta` o sin `importe` | Se descarta esa entrada, no el plato. Si no queda ninguna, cae a `price`. |
| Categoría en `menu_categorias` sin platos en `menu` | No se dibuja: un bloque con foto y sin carta es un hueco. |
| Plato con `category` que no está en `menu_categorias` | Se dibuja en su grupo, sin foto de categoría. |
| `menu_categorias` sin `orden` | Orden de aparición en `menu`. |
| Perfil con manual de marca y sin ninguna foto | Web con la marca del cliente y sin secciones de imagen. Es el caso normal al dar de alta. |

### Testing que añade esta enmienda

- **Por token**: hex válido emite; hex inválido, `</style>`, `url(javascript:…)` y un objeto en vez de
  un string no emiten nada. Uno por token, no uno de muestra.
- **Mutación de la allowlist SQL**, repetida en `brand.colores` y en `menu[].precios`: quitar un campo
  debe hacer caer *exactamente* su test de frontera 2.
- **Legacy**: una ficha `{color, font}` produce el mismo CSS que antes de la enmienda; y con las dos
  formas presentes, gana la específica.
- **Cero terceros en el CSS emitido**: un test que recorra el `<style>` del documento y falle ante
  cualquier host externo (`fonts.googleapis.com`, `cdn.`, `//`). Es la garantía de ADR-19 convertida
  en test en vez de en costumbre.
- **La ruta de fuentes**: sirve lo que está en el mapa; 404 para todo lo demás, incluido
  `../../etc/passwd`; y `cache-control` inmutable.
- **`cartaCategorias`**: con categorías y fotos, con categorías sin fotos, sin `menu_categorias`, y
  sin `menu` → `""`.
- **JSON-LD**: un plato con tres precios emite `offers` con el primero.

### El resto del catálogo, para las piezas siguientes

Inventario de la home-6 del template, con de dónde saldría el dato en nuestro modelo. **Nada de esto
entra en este spec**; se anota para no volver a levantarlo desde cero.

| Sección | Dato | Estado |
| --- | --- | --- |
| Barra superior (teléfono, email) | Perfil — **falta `email`** | Pendiente |
| Hero con oferta y precio | Blok `hero` + campo de oferta | Pendiente. `heroPortada` ya cubre lo básico |
| Categorías con contador ("Fast food · 80+") | Derivable de `menu` | Pendiente |
| "Por qué elegirnos" (3 bullets + contador) | LLM con `claims_permitidos` | Pendiente. Roza el límite de §Fuera de alcance: el LLM no debe inventar cifras |
| Franja con vídeo de fondo y CTA | Solo copy | Pendiente |
| Testimonios | **Nadie** | **Descartado mientras no haya reseñas reales.** Generarlas sería inventar clientes, y en el JSON-LD son *fake reviews* penalizadas |
| Últimas entradas del blog | Ya existe (`/blog`) | Solo rediseño |
| Newsletter en el pie | No hay integración | Pendiente, y exige decidir dónde acaban esos correos (RGPD) |

**Lo que falta antes de que un cliente pueda tocar nada de esto:** hoy `business_profile` **no se
escribe desde ninguna parte** — ni la API ni el portal lo tocan (`db/src/store.ts` solo lo lee, y
`COLUMNAS_EDITABLES` no lo incluye). Se siembra desde `seed-demo.ts`. Esta enmienda **no cambia eso a
propósito**: llega hasta contrato y render, igual que el spec que enmienda, y la vía de escritura
está especificada en §Punto de unión con el portal como trabajo de la pieza del portal.

### Doc drift corregido

[`types.ts`](../../../web-builder/src/types.ts) dice, sobre `BusinessProfile`, que *"en PROD esto es
un datasource global del space de Storyblok; en la PoC, un JSON"*. No es cierto desde la `0008`: en
producción el renderizador lo lee de `clients.business_profile_publico`, la columna generada con
allowlist. Ese comentario se corrige al implementar la entrega 1.

---

## Qué cambió tras la revisión externa

Codex revisó el commit `253ef47` y devolvió ocho findings. Cómo se procesó cada uno:

| # | Finding | Resultado |
| --- | --- | --- |
| 1 | El orden de catálogo garantiza bytes, no aislamiento | **Verificado** contra los selectores globales del CSS actual. Aplicado: §3. |
| 2 | La receta mezcla contenido con chrome | **Verificado**. Aplicado: shell fijo (§1), que elimina el parche de "`locales` obligatoria". |
| 3 | Son cuatro validaciones, no tres | **Verificado**: `z.object` descarta claves desconocidas y `parseProfile` devuelve `parsed.data`. Aplicado: §Las cuatro fronteras + matriz de productores. |
| 4 | "Sin HTML no viaja CSS" necesita propiedad del CSS | **Verificado** contra el media query oscuro único. Aplicado: §3, reglas 5 y 6. |
| 5 | Hosts arbitrarios y fuga de tráfico | **Verificado**: el validador acepta cualquier host y el renderizador no emite `Referrer-Policy` ni CSP. Aplicado: §Política de imágenes. |
| 6 | La `0014` no tiene estrategia operativa | **Parcialmente refutado.** Ventana de despliegue, medición y presupuesto de WAL son desproporcionados para una tabla de decenas de filas. Se aceptó `lock_timeout`, y se **elevó a crítico** un punto que el finding mencionaba de pasada: el `grant` que borra `drop column`. |
| 7 | Hacen falta fases con gates | **Aceptado por juicio** (recomendación de proceso, no verificable). Aplicado: §Las tres entregas. |
| 8 | La espera del portal es más amplia que la dependencia real | **Verificado en los hechos, no aplicado**: contradecía una decisión del usuario, que la confirmó. Anotado en §Punto de unión. |

## Decisiones que quedan dichas

- **Por qué piezas y no un template de terceros.** Un tema de ThemeForest o de Storyblok trae JS,
  fuentes de Google e iconos de CDN, y rompe lo que hace seguro al renderizador: página
  autocontenida, CSS inline, cero dependencias externas (ADR-19). Además no resolvería nada: el
  template más bonito del mundo sigue sin fotos y con siete párrafos de prosa plana.
- **Por qué el shell no se configura.** Una plantilla que puede mover el pie o quitar la cabecera no
  es una plantilla, es una forma de romper el documento. Lo configurable es el contenido.
- **Por qué la plantilla no trae CSS.** Con CSS por plantilla, la segunda duplica la primera y el
  tercer cliente hereda los bugs de las dos. Con CSS por pieza, arreglar el hero lo arregla en todas.
- **Por qué las piezas nuevas solo leen el perfil.** Cualquier dato que no esté en la ficha habría que
  inventarlo o pedírselo al LLM, y un dato inventado en una web de cliente es peor que una sección
  ausente — la misma decisión que el `null` de las métricas en `kr.v0.4` y que el `postalCode`
  opcional.
- **Por qué la allowlist de hosts vive en el código y no en la ficha.** Si viviera en la ficha, quien
  comprometa una ficha se autoriza a sí mismo. La pregunta del proyecto es "si me lo toman, ¿qué se
  llevan?": con la allowlist en código, se llevan la capacidad de mostrar fotos de Storyblok.
- **Por qué el CTA se arregla en el render y no en el brief.** El `cta_label` largo es contenido
  legítimo aprobado en la compuerta; lo que está mal es meterlo en un `<a class="cta">`. Cambiar
  `kr-service` obligaría a re-generar briefs ya aprobados.
- **Por qué una sola plantilla.** El pedido fue "mismo esqueleto, distinta marca, ampliable después".
  El mecanismo de ampliación se construye ahora porque después sale caro; las plantillas concretas,
  cuando haya un cliente que las necesite.
- *(enmienda 2026-08-02)* **Por qué mirar un template de terceros si no se usa ninguno.** Porque
  responde una pregunta que el código propio no responde: qué secciones espera encontrar alguien que
  entra a la web de un restaurante. De ahí salieron los dos huecos de esta enmienda. Mirar es gratis
  y no crea dependencia; instalar sí.
- *(enmienda 2026-08-02)* **Por qué el manual de marca son tokens y no presets con nombre.** Un preset
  hace que dos clientes de la misma agencia tengan la misma web con distinto logo, que es justo el
  reproche que abre este spec. Los tokens cuestan una allowlist más larga y un test por token; los
  presets cuestan clientes que se reconocen entre sí.
- *(enmienda 2026-08-02)* **Por qué las fuentes se sirven desde casa y no desde Google.** La misma
  razón que la allowlist de hosts de §Política de imágenes: cada request a un tercero desde la web de
  un cliente le regala a ese tercero el tráfico del cliente. Que sea gratis y cómodo no lo cambia.
- *(enmienda 2026-08-02)* **Por qué no hay testimonios.** No hay de dónde sacarlos. Pedírselos al LLM
  es inventar clientes que no existen y firmarlo con `Review` en el JSON-LD. Es la misma línea que el
  `postalCode` opcional y el `null` de las métricas: **antes ausente que inventado**.
