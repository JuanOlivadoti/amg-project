# La plantilla `base`

El aspecto que tiene hoy el sitio de un cliente, de dónde salió cada valor y qué falta.

> **Estado: rediseño en curso** (arrancado el 2026-08-10). Hechas: la cabecera, la portada y las cinco
> secciones de contenido de la home y `/menu` (`barraDatos`, `platosDestacados`, `cartaCategorias`,
> `galeria`, `ctaFinal`). El resto conserva el aspecto anterior y lleva el andamio del ancho de lectura
> descrito en [`03`](03-tema-y-marca.md).

## De dónde salen los valores

La referencia visual es un template comercial de restaurante (`Foodu`, versión `home-6`). La regla del
proyecto —la misma que se aplicó en el rediseño anterior— es **replicar estructura y aire sin adoptar
ni una línea de su código**: sus archivos, su CSS y sus imágenes no entran en el repo. Lo que se copió
son medidas, que se obtuvieron **midiendo la página renderizada en un navegador**, no leyendo su
hoja de estilos: la primera lectura del CSS dio dos datos falsos (ver el final de este documento).

Valores de referencia, medidos a 1440 px y a 390 px:

```text                       ESCRITORIO            MÓVIL (<992)
barra superior       fondo primario · 10px 0 · 17px      display:none
navbar               contenedor 1320 · alto 90           alto 85
nav link             Oswald 18px/500 · capitalize · 28px 15px · CENTRADO
logo                 alto 61                             alto ~44
titular del hero     Oswald 80/88 · uppercase · w500     39/43
párrafo del hero     20/36 · gris                        igual
botón del hero       16px uppercase · radio 5 · 15px 40px
foto del hero        480×480 a la derecha                debajo, ~330
flechas del carrusel 60×60 circulares                    ocultas
```

## Lo que hicimos igual, y lo que no

| Elemento | Decisión | Por qué |
| --- | --- | --- |
| Barra superior | **Igual**, pero con `var(--accent)` | El original usa un rojo fijo; nosotros el primario **del cliente**. Con un color fijo, dos clientes con la misma plantilla tendrían la misma web |
| Contenido de la barra | Teléfono + **horario** | El original lleva teléfono + email + idioma + redes. El perfil no tiene email ni redes: antes ausente que inventado |
| Nav | **Igual**: centrado, en la fuente de titulares | Coincidencia útil: el original usa Oswald y el manual del cliente de demo ya la tenía como fuente de titulares |
| Botón de la cabecera | `tel:` con la etiqueta "Llamar" | El original dice "Book a Table". No hay sistema de reservas: un botón que abriera un formulario inexistente es una promesa que el sitio no sostiene |
| Carrito y buscador | **Fuera** | Es un template de e-commerce. No hay carrito |
| Barra transparente sobre el hero | **Fuera** | Exige detectar el scroll, o sea JavaScript |
| Hero: 2 columnas + foto circular | **Igual** | La foto del cliente es rectangular, así que el círculo lo hace el CSS con `object-fit:cover` |
| Hero: slides con texto propio | **No** | El original da a cada slide su titular, su oferta y su precio. No tenemos ese dato. El texto es fijo y **lo que rota es la foto** |
| Cajita "Purchase today. just $65" | **Fuera** | No hay dato de oferta ni de precio de portada en el perfil |
| Avance automático del carrusel | **Fuera** | Necesita JS. Y es discutible: mueve la foto justo cuando alguien lee el titular |

> Dato que salió al medir y que conviene saber: en `home-6` **los dos slides del original llevan
> contenido idéntico**. Es el mismo, duplicado por el loop de la librería. Ni el template usa su
> slider para decir dos cosas distintas.

## El carrusel, sin una línea de JavaScript

Radios ocultos + `:checked ~` moviendo la pista con `transform`.

**La primera versión usaba anclas y hubo que descartarla.** Medido en el navegador: pulsar un
`href="#hs-3"` movía el carrusel (`scrollLeft 0 → 925`) **y la página entera 203 px hacia abajo**,
porque el navegador desplaza todos los ancestros para hacer visible el destino de un ancla. No hay CSS
que lo cancele, y en una portada ese salto saca al visitante del titular justo al mirar la segunda
foto.

Con radios no hay navegación: la URL no cambia y `scrollY` se queda en 0 (verificado). De regalo sale
lo que las anclas no daban: **recorrer las fotos con las flechas del teclado**, que es como se maneja
un radiogroup.

Las fotos salen, en orden de importancia, de: la imagen del blok `hero` (la subió alguien mirando esa
página), `profile.portada` y `profile.fotos`. Máximo cinco. Sin ninguna foto válida, la portada cae a
**hero tipográfico** en una columna — que es el estado de todas las fichas de producción, porque
ninguna tiene todavía una sola foto.

## El patrón de sección, y las cuatro decisiones que llevó aplicarlo

Las secciones rediseñadas comparten tres primitivas del CSS base —`.seccion` (con `.alt` para el fondo
alterno), `.banda` y `.encabezado`— y ninguna las redefine. Lo que cada pieza decidió por su cuenta:

| Pieza | Decisión | Por qué |
| --- | --- | --- |
| `barraDatos` | Tarjeta con el **teléfono grande**, sobre sección **sin** `.alt` | Una tarjeta `--soft` dentro de una sección `--soft` desaparece. Y en un restaurante la acción más frecuente del móvil es marcar: tres datos del mismo tamaño obligan a leer los tres |
| `platosDestacados` | Dos columnas, precio junto al **nombre** (no como tercera columna) | Medido a 390: con el precio de hermano del bloque de texto, la descripción se quedaba en 134 px y se partía en cinco renglones. En escritorio se ve igual |
| `platosDestacados` | El separador lo llevan **todos** los renglones | La regla `:last-child` de la carta existe porque allí el contenedor dibuja otra línea. Acá, con dos columnas, deja la última fila con línea a la izquierda y sin línea a la derecha |
| `galeria` | **2 y 3 columnas fijas**, no `auto-fill` | Con la banda ancha, un `auto-fill` de 150 px da ocho miniaturas; y con cualquier mínimo, seis fotos —las de la plantilla de demo— caen en 4+2 |
| `ctaFinal` | Franja `.alt` + el nombre del negocio en el encabezado compartido | Cierra la página al mismo tamaño con el que la abrió. El borde transparente del botón sólido es lo que lo deja a la misma altura que el de contorno |

El botón (15px 40px, radio 5, versalita) está **duplicado** en `heroSlider`, `platosDestacados` y
`ctaFinal`. Es deliberado: el CSS base solo acepta lo que necesitan dos o más piezas *y* no tiene otro
dueño, y un `.boton` compartido es un cambio del patrón base, no de una pieza.

## Lo que falta

Las secciones que aún conservan el aspecto anterior:

```text
hero · seccionProsa · faq · indice · blogIndice · contacto · locales
```

Y del template de referencia quedan sin equivalente, **por falta de datos, no de tiempo**:

| Sección del original | Qué falta para poder hacerla |
| --- | --- |
| Carrusel de categorías con conteo | Nada: sale de `menu_categorias`. Es la siguiente |
| "Welcome at X" + horarios lunch/dinner | Un texto de bienvenida en el perfil |
| Bullets de "por qué nosotros" | Campo nuevo en el perfil |
| Testimonios con estrellas | Campo nuevo + pantalla en el portal para cargarlos |
| Contadores (años, platos, clientes) | Campo nuevo. **Descartado**: es relleno de template |
| Carrusel de sponsors | **Descartado** por el mismo motivo |
| Newsletter en el pie | Backend de suscripción. No existe |

Cada campo nuevo cruza las cuatro fronteras de [`03`](03-tema-y-marca.md) **y** necesita una pantalla
en el portal para que la agencia lo cargue. Ese es el coste real de cada sección.

## La decisión sobre el contenido por defecto (2026-08-10)

**Se decidió replicar esas secciones con contenido por defecto**, en vez de esperar a que existan los
campos y las pantallas. Es una excepción consciente a la regla de *antes ausente que inventado*, y
conviene entender qué la hace aceptable y dónde deja de serlo.

**Lo que la hace aceptable:** un texto de plantilla es una **propuesta editable**, no una afirmación
sobre el negocio. "Cocina de temporada, producto de mercado" no dice nada que pueda ser falso; el
cliente lo ve, lo reescribe y sigue. Es la misma naturaleza que "Inicio" o "Contacto" en el nav.

**Dónde deja de serlo, y por eso va con dos salvaguardas:**

| Sección | Riesgo del default | Cómo se acota |
| --- | --- | --- |
| Bienvenida, bullets | Ninguno: es prosa genérica y editable | Texto deliberadamente neutro, sin cifras ni promesas |
| **Testimonios** | **Alto.** Una reseña inventada con nombre y estrellas es una reseña falsa atribuida a una persona; publicada, es publicidad engañosa | El texto de muestra es evidentemente de plantilla, **sin nombres de persona reales ni valoraciones numéricas presentadas como reales**, y el seed lo marca como contenido de ejemplo |

**La regla que queda, y que hay que respetar al implementar:** un default puede **rellenar una
sección**, nunca **afirmar un hecho sobre el negocio** — ni años de antigüedad, ni número de
clientes, ni premios, ni una reseña firmada. Las secciones de contadores y sponsors siguen
descartadas por eso, además de por ser relleno.

**Lo que esto NO cambia:** los campos siguen teniendo que existir en el perfil y cruzar las cuatro
fronteras. El default es el valor que se usa cuando el campo está vacío, no una excusa para no crear
el campo — si no, el cliente no puede cambiarlo, que es lo único que hace aceptable al default.

## Dos lecciones del rediseño

**Leer el CSS de una referencia no sustituye a medirla en un navegador.** La primera pasada sobre la
hoja de estilos del template dio dos datos falsos: que la barra superior era oscura (la regla con
`!important` que encontré pertenecía a otra variante; en `home-6` es roja) y que el nav iba a la
derecha (va centrado). Los dos se corrigieron al abrir la página y medirla.

**Los tests no ven layout, y en esta etapa fue literal.** De los defectos que aparecieron, **tres los
encontró el navegador y ninguno un test**: el sticky que no pegaba, el salto de 203 px del carrusel y
el logo sin achicar en móvil. Los que sí cazó la suite fueron de otra naturaleza: el `font-weight` que
rompía el preload y el color literal sin contrapartida oscura.

## El gate de paridad

`web-builder/src/render/paridad/` congela el HTML de diez casos y compara texto visible, `href`, `id`
de ancla, JSON-LD y traza de research. Nació para un refactor que **no debía** cambiar el sitio.

**Un rediseño deliberado lo rompe por definición**, y el propio archivo lo dice: regenerar las
fixturas es la respuesta equivocada *salvo que el cambio visual sea deliberado y esté explicado*.
Mientras dure este rediseño, sus casos fallan. Antes de re-capturar hay que medir qué cambia:

| Etapa | Casos rojos | Qué se perdió | Qué se añadió |
| --- | --- | --- | --- |
| Cabecera y portada | — | cero palabras, `href`, `id`, JSON-LD y trazas | "Llamar" |
| Las cuatro secciones de la home | 7 de 10 | cero palabras, `href`, `id`, JSON-LD y trazas | "Nuestros platos", "El sitio, por dentro", "Te esperamos" — los tres, rótulos de plantilla |

⚠️ `npm run capturar:paridad -w web-builder` está en `permissions.deny`: re-capturar exige
autorización explícita del usuario.
