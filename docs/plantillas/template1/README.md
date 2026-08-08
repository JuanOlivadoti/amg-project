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
sobre el modo oscuro se ve como un parche. Hoy se dibuja a unos 40 px de alto, así que lo que importa
es que sea legible pequeño.

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

## Antes de publicar: fotos reales o de stock

Si estas fotos son de **stock** y no del negocio, hay que decirlo donde se siembran
(`db/src/seed-demo.ts`), igual que se hizo con los precios. Publicar la foto de otro restaurante en la
web de uno real es el mismo problema que un precio inventado: **antes ausente que inventado**.
