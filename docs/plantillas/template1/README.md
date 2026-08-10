# `template1` — los assets de marca del cliente de demo (La Birra Bar)

**Dónde dejar las fotos:** `docs/plantillas/template1/originales/<carpeta>/`, una carpeta por destino.
El nombre del archivo no importa salvo donde se diga; lo que importa es en qué carpeta cae.

> **Los binarios de `originales/` NO se versionan** (`.gitignore`). Este repositorio es público, las
> imágenes engordan el historial para siempre y su destino real es **Storyblok**: la allowlist del
> renderizador solo acepta `a.storyblok.com`, así que una foto que viviera acá no se podría servir.
> Esta carpeta es el **buzón de trabajo**; de acá se suben a Storyblok y lo que queda en el perfil del
> cliente es la URL.
>
> Lo que sí se versiona es este README y `marca.json`.

---

## Las medidas, y de dónde salen

`main` mide **760 px** con 20 px de padding, o sea **720 px** de contenido; a 2× son 1440. Se pide más
que eso a propósito: Storyblok redimensiona por URL, así que **siempre se puede bajar y nunca subir**.

| Carpeta | Original | Proporción | Cuántas | Campo del perfil | Dónde se ve |
| --- | --- | --- | --- | --- | --- |
| `portada/` | **2560×1440** | 16:9 | 1 | `portada` | El hero de la landing |
| `galeria/` | **1600×1200** | 4:3 | 6–8 | `fotos[]` | La rejilla de galería |
| `categorias/` | **1200×800** | 3:2 | 1 por categoría (3–5) | `menu_categorias[].foto` | Cabecera de cada bloque de la carta |
| `platos/` | **800×800** | 1:1 | 6 | `menu[].foto` | Miniatura de plato y destacados de la home |
| `locales/` | **1600×1200** | 4:3 | 1 por local (2) | `locations[].foto` | El bloque de ubicaciones del pie |
| `logo/` | ver abajo | — | 1–2 | `brand.logo` | La cabecera del sitio |

**Formato:** JPG de calidad alta para las fotos (Storyblok genera el WebP). **Sin texto incrustado en
la imagen**: no se puede traducir, no lo lee un buscador y se pixela al reescalar.

**En `categorias/` y `platos/`, el nombre del archivo sí importa**: tiene que poder emparejarse con el
`category` / `name` del plato en la ficha. Con un slug alcanza — `hamburguesas.jpg`,
`golden-burger.jpg`.

### Por qué NO hay versiones para móvil

Con `object-fit: cover` una sola imagen sirve para los dos tamaños, y mantener dos juegos por cliente
multiplica el trabajo de la agencia en cada alta. La única donde se nota el recorte es la **portada**:
un 16:9 llevado a pantalla de móvil pierde media escena. Por eso la portada se **encuadra con el
sujeto centrado y aire arriba y abajo**, para que aguante. Si una portada concreta no aguanta, ahí se
añade una segunda — como excepción, no como regla.

### El logo

| Archivo | Qué |
| --- | --- |
| `logo.svg` | **SVG con fondo transparente**, el trazo en un color plano |
| `logo-claro.svg` | La versión para fondo oscuro, si el logo principal es oscuro |

SVG y no PNG porque la cabecera lo escala y un PNG se ve borroso en retina. Si solo hay PNG: **600 px
de alto con transparencia**. **Sin fondo propio** — el CSS pone el suyo, y un logo con fondo blanco
sobre el modo oscuro se ve como un parche.

> ⚠️ **Este README decía «hoy se dibuja a unos 40 px de alto» y es falso.** Medido en el navegador el
> 2026-08-09: el logo sale a **250×250, su tamaño natural**, con `max-height: none` — o sea que **no
> hay tope**, ni en escritorio ni en móvil, donde ocupa el **64 % del ancho** de una pantalla de
> 390 px. Un cliente que suba un PNG de 600 px (lo que este mismo documento pide dos líneas más
> arriba) se lleva una cabecera de 600 px de alto. Es **deuda preexistente**, no la introdujo ninguna
> entrega reciente, y no se manifiesta en producción porque **ninguna ficha real tiene logo todavía**.
> Cuando se arregle: un tope en el CSS de `cabecera` y un test que lo fije; hasta entonces, este
> párrafo dice lo que pasa de verdad en vez de lo que se creía.

---

## `marca.json`

La paleta y los roles tipográficos, en el formato exacto de `business_profile.brand`. Se puede pegar
tal cual en la ficha del cliente.

**Las fuentes son nombres de ROL, nunca familias ni stacks CSS** (`condensada`, `humanista`…): el
código mapea cada nombre a una familia self-hosted, así que cambiar qué hay detrás de `condensada` es
un cambio de código revisado y no una edición masiva de fichas.

Las familias se sirven **desde nuestro dominio**, no desde Google: cargar `fonts.googleapis.com`
metería un tercero en el camino de render del proceso anónimo y mandaría la IP de cada visitante a
Google — exactamente lo que la spec prohíbe para las fotos. Solo entran familias con licencia que
permita self-host, y la licencia se commitea junto al archivo.

---

## Subidos a Storyblok (2026-08-08)

Space `293831091573700`, host `a.storyblok.com` — el de la allowlist. Sin `?token=`, así que el space
no tiene *asset protection*: las sirve el CDN a cualquiera, que es lo que necesita un sitio anónimo.

Actualizado el **2026-08-09**: la portada se reemplazó por una **sin la marca incrustada**, y se
subieron **seis** fotos de galería y **una por categoría** donde antes había una sola repetida.

| Destino | URL |
| --- | --- |
| `portada` | `https://a.storyblok.com/f/293831091573700/2560x1440/3866018887/axe-os-portada.jpg` |
| `fotos[]` (galería, 1 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/d82ece3683/axe-os-fotos-galeria.jpg` |
| `fotos[]` (2 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/b6239d5695/axe-os-fotos-galeria-2.jpg` |
| `fotos[]` (3 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/415661678d/axe-os-fotos-galeria-3.jpg` |
| `fotos[]` (4 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/056a2a7774/axe-os-fotos-galeria-4.jpg` |
| `fotos[]` (5 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/1a75e62a1f/axe-os-fotos-galeria-5.jpg` |
| `fotos[]` (6 de 6) | `https://a.storyblok.com/f/293831091573700/1600x1200/8eb4949666/axe-os-fotos-galeria-6.jpg` |
| `menu_categorias[].foto` — Hamburguesas | `https://a.storyblok.com/f/293831091573700/1200x800/8fbaedf133/axe-og-categories.jpg` |
| `menu_categorias[].foto` — Entrantes | `https://a.storyblok.com/f/293831091573700/1200x800/194ffe59a5/axe-og-categories-starters.jpg` |
| `menu[].foto` | `https://a.storyblok.com/f/293831091573700/800x800/e0f8442ce6/axe-og-menu-item.jpg` |
| `locations[].foto` | `https://a.storyblok.com/f/293831091573700/1600x1200/46847c4d05/axe-os-locations.jpg` |
| `brand.logo` | `https://a.storyblok.com/f/293831091573700/250x250/ec3d723b80/axe-os-logo-color.png` |
| `brand.logo` (fondo oscuro) | `https://a.storyblok.com/f/293831091573700/250x250/0499bde0b6/axe-os-logo-light.png` |

> ### ⚠️ Reemplazar un asset en Storyblok CAMBIA la URL
>
> La portada vieja (`…/30ad3813d6/…`) devuelve **`403 AccessDenied`** desde que se subió la limpia.
> Verificado con `curl`, no supuesto. **Sustituir una foto no es editar un archivo: es un asset
> nuevo**, y toda ficha que guarde la URL anterior se queda con un `<img>` roto sin que nada avise.
>
> Importa porque el síntoma es **silencioso y feo**: la portada colapsa a 26 px (el navegador trata
> una imagen sin píxeles como texto alternativo en línea), no hay error en ningún log, y el
> renderizador no puede detectarlo sin meter JavaScript en el proceso anónimo. Cuando se cambie una
> foto de un cliente real, **hay que actualizar su ficha en la misma operación**.

`menu[].foto` y `locations[].foto` **siguen repitiendo** una imagen por destino: sirven para ver el
render, no para enseñárselos a nadie. Los nombres tampoco son slugs, así que el emparejamiento por
nombre de archivo (`hamburguesas.jpg` ↔ `category`) todavía no se puede probar de verdad.

## Estado de los assets (2026-08-08)

Cargados y **con las medidas exactas** de la tabla de arriba. Tres cosas anotadas al revisarlos, para
que no muerdan más adelante:

| Qué | Por qué importa | Estado |
| --- | --- | --- |
| **La portada trae el logo incrustado** («Borcelle Burger», arriba a la izquierda) | La cabecera ya dibuja el logo, así que saldría **dos veces**. Y un logo quemado en el JPG no lo lee un buscador, no se cambia sin reeditar la foto y se pixela al reescalar | ⏳ pendiente: la misma foto sin el logo |
| **La marca es «Borcelle Burger», no La Birra Bar** | Sembrarlas en la ficha del cliente de la demo pondría el logo de otro negocio en su web — el mismo problema que un precio inventado, y más visible | ✅ resuelto por diseño: las usa un cliente **ficticio** del `dev-server`, y La Birra Bar espera las suyas |
| **Una foto por carpeta** donde se esperaban varias | La galería sale con seis copias de la misma imagen. Sirve para desarrollo; no para enseñárselo a un cliente | ⏳ mejorable: 3-4 distintas en `galeria/` |

El logo en PNG 250×250 cubre los 40 px de alto de la cabecera con margen para retina. Con SVG no
habría techo, pero no bloquea nada.

**Ya subidas** (tabla de arriba). Lo que la subida desbloquea es **verlo en el navegador**, no
implementarlo: los tests del render no descargan nada, así que una URL de `a.storyblok.com` inventada
ejercita las piezas igual de bien. La documentación decía que las fotos bloqueaban la mitad B; no era
cierto, y la corrección es esta línea.

## Antes de publicar: fotos reales o de stock

Si estas fotos son de **stock** y no del negocio, hay que decirlo donde se siembran
(`db/src/seed-demo.ts`), igual que se hizo con los precios. Publicar la foto de otro restaurante en la
web de uno real es el mismo problema que un precio inventado: **antes ausente que inventado**.
