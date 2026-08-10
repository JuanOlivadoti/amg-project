# La plantilla `base`

El aspecto que tiene hoy el sitio de un cliente, de dónde salió cada valor y qué falta.

> **Estado: rediseño en curso** (arrancado el 2026-08-10). La cabecera y la portada están hechas; el
> resto de las secciones conserva el aspecto anterior y lleva el andamio del ancho de lectura descrito
> en [`03`](03-tema-y-marca.md).

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

## Lo que falta

Las secciones que aún conservan el aspecto anterior:

```text
barraDatos · seccionProsa · platosDestacados · cartaCategorias
galeria · faq · indice · blogIndice · ctaFinal · contacto · locales
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
en el portal para que la agencia lo cargue. Ese es el coste real de cada sección, y por eso la
decisión de cuáles entran es del negocio, no del código.

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
Mientras dure este rediseño, sus casos fallan. Antes de re-capturar hay que medir qué cambia: en la
primera etapa se comprobó **cero palabras, cero `href`, cero `id`, cero JSON-LD y cero trazas
perdidas**, y lo único nuevo era la palabra "Llamar".

⚠️ `npm run capturar:paridad -w web-builder` está en `permissions.deny`: re-capturar exige
autorización explícita del usuario.
