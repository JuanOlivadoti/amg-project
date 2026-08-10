# La plantilla `base`

El aspecto que tiene hoy el sitio de un cliente, de dónde salió cada valor y qué falta.

> **Estado: rediseño COMPLETO** (2026-08-10). Las tres etapas están hechas: el tema y la cabecera y la
> portada (etapa 1), las doce secciones de contenido y el pie (etapa 2) y las tres secciones nuevas con
> contenido por defecto (etapa 3). **El andamio del ancho de lectura ya no existe** en ninguna pieza.

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

## Las siete últimas secciones (etapa 2), y las tres decisiones que llevaron

| Pieza | Decisión | Por qué |
| --- | --- | --- |
| `hero` | **Cabezal** corto con fondo, no una portada, y con el `padding` recortado | Es el titular de `/menu` y `/blog`, que son páginas interiores. Con los 120 px de `--pad-seccion`, la primera categoría de la carta se iba de la pantalla — y `/menu` existe para leer la carta |
| `seccionProsa` | Los apartados comparten **UNA** `.seccion`, con la mitad de aire entre ellos | Son partes de un mismo texto. Con una sección cada uno, una landing de cuatro apartados eran cuatro pantallas de scroll con tres párrafos dentro |
| `faq` | Acordeón de tarjetas, **sin** `.alt`, con `+`/`−` propio | En la receta va justo antes de `ctaFinal`, que sí lleva `.alt`: dos franjas `--soft` seguidas se leen como una sola de 400 px. Quitar el triángulo nativo necesita **dos** reglas (`list-style` para Firefox, `::-webkit-details-marker` para Safari): con una sola, el otro navegador dibuja los dos marcadores |
| `indice` / `blogIndice` | Casi sin CSS propio, y `.cards` pasa a **3 columnas fijas** | El reparto salió bien: el titular lo pinta el encabezado compartido. Y el `auto-fill` de 220 px daba **cinco** columnas en la banda de 1320, así que una home recién publicada dejaba una tarjeta sola a la izquierda bajo un encabezado centrado — la misma lección que la galería |
| `contacto` + `locales` | El pie, en **columnas**: contacto + una por local | En la referencia son cuatro fijas. Acá el número lo decide lo que la ficha sostiene, porque las dos que faltarían para llegar a cuatro son un menú de enlaces que duplica el nav y un formulario de newsletter que no tiene backend. **Nunca una columna vacía** |
| `barraDatos` | Menos aire vertical que una sección normal | Medido a 1440: con `--pad-seccion` sumaba 230 px de blanco alrededor de una tarjeta de 100 px de alto. No es una sección de contenido: es la ficha del negocio colgando del titular |

**El cambio de base que las habilita:** `main` dejó de declarar ancho y respiro, y por eso las
secciones con fondo llegan ahora a los bordes de la pantalla. El detalle y su precio, en
[`03`](03-tema-y-marca.md#los-dos-anchos).

## Las tres secciones nuevas (etapa 3), y dónde se corta la excepción

| Pieza | Campo | Sin dato en la ficha |
| --- | --- | --- |
| `bienvenida` | `bienvenida` (texto) | **Dibuja el default.** `BIENVENIDA_DEFAULT`, en su archivo, con su test |
| `destacados` | `destacados[]` (`titulo`, `texto`) | **Dibuja los tres del default.** `DESTACADOS_DEFAULT` |
| `testimonios` | `testimonios[]` (`texto`, `autor`) | **Devuelve `""`.** No hay default y no lo va a haber |

Los defaults están escritos con una restricción, no con la de sonar bien: **hablan de la página, no
del negocio.** «Los platos y sus precios, para mirarlos con calma antes de venir» es cierto por
construcción para cualquier cliente, porque lo cumple el propio renderizador; «producto de mercado» es
un hecho sobre el negocio que un cliente podría no cumplir. Lo sostiene un test con una lista de
palabras prohibidas (`temporada`, `mercado`, `artesan`, `desde 19`, `mejor`, `premi`…), para que la
regla no dependa de que quien edite el texto se acuerde de ella.

**En `testimonios` la excepción se corta**, y eso no es una pieza a medio hacer: una reseña ES una
afirmación sobre el negocio, atribuida además a una persona. Un texto de muestra en una bienvenida es
una propuesta editable; una reseña de muestra publicada en el dominio de un restaurante es una reseña
falsa, y lo que la convierte en engaño no es lo específica que sea sino **el hueco donde está**, que
dice «esto lo dijo un cliente». La sección aparece sola en cuanto la agencia carga la primera.

**Tampoco hay campo de puntuación**, en ninguna de las cuatro fronteras. Una valoración numérica
publicada por el propio negocio, sin plataforma que la respalde, es un dato que nadie puede comprobar.
Lo impone sobre todo la **allowlist SQL** (`0020`), que enumera `texto` y `autor` y nada más: un
`estrellas` escrito a mano en `business_profile` no llega al renderizador.

## Lo que sigue sin equivalente

| Sección del original | Por qué no está |
| --- | --- |
| Contadores (años, platos, clientes) | **Descartado**: es relleno de template, y cada cifra sería un hecho sobre el negocio |
| Carrusel de sponsors | **Descartado** por el mismo motivo |
| Newsletter en el pie | Backend de suscripción. No existe |
| Menú de enlaces en el pie | Duplica el nav de la cabecera |

Y falta lo que ninguna de estas etapas construye: **las pantallas del portal** para que la agencia
cargue `bienvenida`, `destacados` y `testimonios`. Hasta que existan, los campos solo se pueden
escribir en `business_profile` a mano — que es justo lo que hace que el default sea aceptable **y**
temporal: un default que el cliente no puede cambiar deja de ser una propuesta.

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
| Las siete últimas + las tres nuevas | 6 de 10 | cero palabras, `href`, `id`, JSON-LD y trazas | "FAQ", "Lo que hay en el sitio" (rótulos), y el contenido por defecto de `bienvenida` y `destacados` |

Las tres veces se **midió antes de re-capturar**, y las tres dieron lo mismo: **cero** palabras, `href`,
`id`, JSON-LD ni trazas perdidos en los diez casos. Es la comprobación que convierte "el cambio es
deliberado" en un hecho: lo que entra es texto nuevo, no texto que desapareció.

⚠️ `npm run capturar:paridad -w web-builder` está en `permissions.deny`: re-capturar exige
autorización explícita del usuario.
