# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-09
**En curso:** **bloque E — completo**. El aspecto de las webs. Entregas **1** y **2** cerradas; la **3**
entera: **mitad A** (arreglos visuales y tokens de marca), **C** (tipografías self-hosted) y **B**
(la §Política de imágenes y **las seis piezas con foto**), con el **gate de paridad re-capturado**.
**Estado:** ✅ verde. **1268 tests** en el monorepo, typecheck limpio, sin secretos, y el sitio manejado
en un navegador con fotos, sin fotos y con foto rota.

## 🟡 Entrega 3, mitad B (2 de 2) — las seis piezas con foto

Lo último del bloque E. `heroPortada`, `barraDatos`, `platosDestacados`, `cartaCategorias`, `galeria`
y `ctaFinal`. **371 tests en `web-builder`**, todos en verde tras re-capturar el gate: ver más abajo.

**La web ya parece una web de restaurante.** Manejada en el navegador con `borcelle.es`, que tiene las
siete fotos reales del space:

```text
con fotos    → claro y oscuro, escritorio y móvil     ✅
sin fotos    → hero tipográfico, sin huecos            ✅   ← el estado de TODOS los clientes reales hoy
foto rota    → degradación del navegador, ver abajo    ⚠️
contraste en oscuro, MEDIDO sobre el HTML servido: precio 5.36:1 · etiqueta 7.18:1 · título 15.41:1
```

Que el caso **sin fotos** se vea bien importa más que el bonito: ninguna ficha de producción tiene una
sola foto, así que el hero tipográfico —titular a 2.9rem con su regla decorativa debajo— es la versión
del sitio que hoy se está sirviendo de verdad.

### Las recetas, y por qué no solo la landing

`story` es literal de la spec. Las otras dos las decidió esta entrega:

```text
story: heroPortada · barraDatos · seccionProsa · platosDestacados · galeria · faq · ctaFinal
home:  hero · barraDatos · platosDestacados · galeria · indice · ctaFinal
menu:  hero · barraDatos · cartaCategorias · ctaFinal
blog:  sin tocar
```

`barraDatos` y `ctaFinal` van en las **tres** páginas de negocio, no solo en la landing: el problema
que la spec describe —teléfono y horarios enterrados en el pie— no se arregla si el arreglo llega solo
a la landing, porque la portada es donde entra más gente. `galeria` no va en `/menu` (ahí ya hay fotos
de categoría y de plato) y `platosDestacados` tampoco (su único gancho es el enlace a `/menu`).

### `carta` se retiró del catálogo

`cartaCategorias` cubre también el caso **sin `menu_categorias`**, así que `carta` se quedaba sin
ninguna receta que la nombrara — código que no llega a ningún navegador con tests que pasan para
siempre. Migraron con sus tests: el arreglo del doble borde, el modo oscuro completo, el
`--acento-legible` del precio y el escapado.

### El LCP, arreglado en vez de anotado

El implementador dejó como deuda que la foto de portada salía con `loading="lazy"`. **Desde que
`heroPortada` la dibuja, esa foto es el LCP de todas las landings**, y diferir el elemento que define
la métrica retrasa exactamente lo que la métrica mide: el navegador tiene que terminar el layout para
saber que está en el viewport y solo entonces la pide. Ahora `renderImagen` acepta
`prioridad: "alta"` —sin `loading`, con `fetchpriority="high"`— y **solo `heroPortada` la usa**:
marcar dos imágenes como prioritarias es no marcar ninguna, porque compiten por el mismo ancho de
banda. Un test lo fija sobre el documento entero, no sobre la pieza, porque es una propiedad del
documento.

Cambió la expectativa de un test viejo que exigía `lazy` en esa foto. Está escrito ahí por qué es un
cambio de conducta deliberado y no una expectativa aflojada: cuando se escribió, ninguna landing tenía
foto arriba.

### `--marca-secundario` por fin pinta algo

La mitad A lo dejó *"emitido y sin consumidor a la espera de la mitad B"*, porque atarlo al gris del
texto secundario fallaba AA (2.62:1). Ahora entra por `--decorativo` y lo consumen **tres filetes
decorativos** —bajo el titular tipográfico, bajo cada categoría de la carta y en el borde izquierdo de
cada dato de la barra—. **Nunca texto**, que era la condición exacta.

### ✅ El gate de paridad, jubilado y vuelto a capturar

Cayeron **7 de los 10 casos**, y no era un accidente: la entrega 3 cambia el aspecto **a propósito**, y
el gate de la entrega 2 existía para demostrar que el *refactor* no cambiaba el sitio — contrato que ya
se cumplió y se cerró. Re-capturar es jubilarlo, no aflojarlo, y se hizo **con autorización explícita**
porque el comando está en `permissions.deny` y borra la única foto pre-refactor que existe.

**Lo que se midió antes de commitear.** Re-capturar deja el gate comparándose consigo mismo, así que a
partir de ese momento ya no prueba nada sobre el cambio: la prueba hay que sacarla **antes**, con las
fixturas viejas todavía en `HEAD`. Se comparó rostro a rostro `git show HEAD:<fixtura>` contra el disco,
con las mismas cinco caras de `huellaDe`:

```text
                                 palabras        hrefs      ids   jsonLd  traza
blog-con-posts                    71→ 71 (+0)   10→10 (+0)  2→2     =      =
blog-vacio                        67→ 67 (+0)    8→ 8 (+0)  2→2     =      =
landing-sin-perfil                81→ 81 (+0)    2→ 2 (+0)  2→2     =      =
home-sin-paginas                  75→124 (+49)   8→13 (+5)  2→2     =      =
home-sintetizada                  73→122 (+49)  11→16 (+5)  2→2     =      =
landing-perfil-base              123→172 (+49)  10→15 (+5)  4→4     =      =
landing-perfil-con-manual        113→161 (+48)  11→16 (+5)  4→4     =      =
landing-perfil-legacy            112→136 (+24)   9→13 (+4)  4→4     =      =
menu-agrupado                     85→107 (+22)   9→13 (+4)  2→2     =      =
menu-sin-categorias               64→ 88 (+24)   8→12 (+4)  2→2     =      =

cero palabras perdidas · cero hrefs perdidos · cero ids perdidos · JSON-LD y traza idénticos en los 10
```

Los tres de **+0/+0** son la señal de control: `landing-sin-perfil` (sin datos, las piezas nuevas
devuelven `""` y `heroPortada` emite exactamente lo mismo que `hero`) y los dos de `/blog`, cuya receta
no se tocó. **Su HTML sí cambia** —CSS y clases nuevas—, y por eso las diez fixturas aparecen
modificadas en el diff; lo que no cambia son sus cinco rostros, que es lo único que el gate miraba.
Decir "los tres no cambian" a secas era impreciso.

**La salvedad, verificada con los ojos y no por el contador.** El comparador cuenta multiconjuntos, así
que un reorden le resulta invisible. En `/menu` el precio pasó de ir tras el nombre a ir tras la
descripción, porque el layout nuevo lo lleva a su columna derecha:

```text
antes:  Margherita 12,50 € Tomate, mozzarella y albahaca.
ahora:  Margherita Tomate, mozzarella y albahaca. 12,50 €
```

No se pierde ninguna palabra y el orden nuevo se lee igual de bien, pero **es una decisión**, y va
declarada en el mensaje del commit en vez de congelada sin nombre.

### Un hallazgo que solo dio el navegador

Con la foto **declarada pero rota** (el asset borrado del space), la galería y los platos aguantan su
tamaño por CSS, pero **la portada colapsa a 26 px**: el navegador trata una imagen sin píxeles como
texto alternativo en línea e ignora `width:100%` y `aspect-ratio`. Queda ni foto ni hero tipográfico,
porque `sin-img` mira si hay `src`, no si carga. **No se arregla**: detectarlo exige JS (`onerror`), y
meter JavaScript en el proceso anónimo por una ficha mal cargada es peor que el síntoma. Lo mitiga que
`renderImagen` emita `width`/`height` cuando la URL de Storyblok los lleva.

## ✅ Entrega 3, mitad B (1 de 2) — la §Política de imágenes

Antes de dibujar una sola foto, la puerta por la que van a pasar. Las fotos son un vector **nuevo**
hacia `<img src>` en el único proceso expuesto a internet anónimo, y escapar el valor evita la
inyección pero no la **fuga**: un `<img>` es una petición que hace el navegador del visitante, y quien
controle el host se lleva su IP, su user-agent y su patrón de tráfico, multiplicado por cada visita a
la web de cada cliente.

- **Allowlist de hosts en el código** (`a.storyblok.com`), nunca en la ficha — una ficha comprometida
  se ampliaría sola. Comparación **exacta** contra un `Set`, sobre `new URL(...).hostname`.
- **https obligatorio**, `referrerpolicy="no-referrer"` en cada `<img>`, y **60 imágenes por
  documento** como tope global: los topes por campo (30 fotos, 200 de carta, 20 locales, 20
  categorías) suman cientos, y lo que paga el visitante son peticiones, no campos.

**Los siete casos nominales están escritos uno a uno**, no en una tabla: `a.storyblok.com.evil.tld`,
`evil-storyblok.com`, `https://a.storyblok.com@evil.com` (el host real es `evil.com` — lo que parece
el host es el userinfo), `http:` con host bueno, protocol-relative, `javascript:` y el positivo.

### Tres premisas mías que resultaron falsas, en orden

1. **«Todo pasa por `renderImagen`».** No: el **logo** se dibujaba aparte, en `cabecera.ts`, con su
   propio chequeo débil. Y es el peor de los dos — una foto de hero se ve en una página, el logo en
   **todas**. Lo encontró el implementador leyendo, no yo escribiendo el brief.
2. **«Ahora son dos».** Tampoco: `og:image` y el `image` del JSON-LD son un **tercero**. Un perfil con
   `image: "http://tracker.evil.tld/pixel.png"` lo publicaba tal cual en todas las landings.
3. **«Van a caer dos fixtures del gate por el `referrerpolicy`».** No cayó ninguna: las cinco caras de
   `huellaDe` son texto visible, `href`, `id`, JSON-LD y traza — **el gate es ciego a ese atributo**.
   Verificado por mutación, no supuesto. Retocar las fixturas habría sido editar la única foto
   pre-refactor que existe para nada.

### Y una decisión mía que el gate corrigió

Apliqué la allowlist a `og:image` por simetría. **Cinco fixturas cayeron**, porque el `image` del
JSON-LD **sí** es una de las cinco caras del gate. El motivo: la fixture trae
`https://trattoriabellanapoli.es/img/fachada.jpg` — **el dominio del propio cliente**, que es donde
vive normalmente una imagen social. La allowlist ahí no defiende de nada (el visitante no la
descarga, la pide el crawler al compartir el enlace) y a cambio le quita la tarjeta social a todo
cliente que no haya subido su foto a nuestro space. Quedó en **https obligatorio y nada más**, con la
asimetría explicada y con test propio para que nadie la "arregle" por simetría.

### El logo, endurecido — decisión de la sesión principal

El implementador lo dejó fuera y me devolvió la decisión, porque cambiaba una conducta con test
propio. La tomé tras comprobar dos cosas: **ninguna ficha sembrada tiene logo fuera de Storyblok**
(el seed de producción no siembra `brand.logo`; los `cdn.ej` del repo son de test) y **el fallo es
benigno** — un logo rechazado cae al nombre del negocio en texto, igual que si no hubiera logo. Se
alineó también Zod, que aceptaba `http:` para el logo cuando `fotoSchema` ya exigía https: aceptarlo
en la puerta y descartarlo en el render es la peor combinación, porque el CLI diría que el perfil
está bien y la web saldría sin logo sin explicar por qué.

### ⚠️ Un revisor murió a mitad de una mutación y dejó el árbol roto

El primer `revisor` cayó por un error de conexión. Comprobé `git status` y los mismos 16 archivos
seguían ahí, así que di el árbol por intacto. **No lo estaba**: se había llevado el `try/catch` de
`fuentePermitida`, y sin él `new URL()` lanzaba con cualquier `src` que no fuera absoluta — un
`throw` desde el render tumba la página entera de un cliente, y en el logo, **todas** las páginas.

`git status` dice **qué archivos** cambiaron, no si su contenido es el que dejaste. La comprobación
correcta tras la muerte de un subagente es comparar el **contenido** del diff, no la lista. El
segundo revisor lo midió y lo reportó como bloqueante; lo que no podía saber —y dijo honestamente que
no podía— era de dónde salía. Se sabe porque mi `npm run verificar` anterior había dado 1218 en verde
con el `try/catch` puesto.

## ✅ Entrega 3, mitad C — las tipografías, servidas Y enchufadas

Cuatro familias **SIL OFL 1.1** —Oswald, Jost, Source Sans 3, Dancing Script—, verificadas **una por
una** contra el repositorio de Google Fonts y con su licencia commiteada al lado. Subsets latinos en
`woff2`: 148 KB. Se sirven desde `/_assets/fonts/`, con un `Map` en memoria cargado al arrancar que
**falla cerrado**: si falta un archivo, el renderizador no arranca.

No se cargan de Google porque eso mete un tercero en el camino de render del **único proceso expuesto
a internet anónimo** y manda la IP de cada visitante a Google — lo mismo que la spec prohíbe para las
fotos.

**Una afirmación mía que el test no probaba.** Escribí que el test de path traversal era fuerte
«porque hay un `Map` y no un path». Mutando el handler para que volviera a leer del filesystem, **el
test siguió pasando**: quien para esas URLs primero es el **router**, porque `:nombre` no captura `/`.
Cierto como diseño, falso como descripción de lo que el test demostraba. Ahora cada capa tiene su
test — y queda escrito que si alguien cambia el patrón a `/_assets/fonts/*`, la primera desaparece
sin ruido.

**El cable, puesto.** `--marca-fuente-*` resuelve a la familia self-hosted, el `<style>` lleva las
`@font-face` **solo de las familias que la página usa**, y el `<head>` un `preload` de **una sola**
familia: la de titulares. Verificado en el navegador, que es donde se ve lo que ningún test ve:

```text
h1 → Oswald 700 · cuerpo → Source Sans 3 · rótulo → Dancing Script
4 peticiones de fuente, NINGUNA repetida · 0 hojas externas · 0 scripts externos
```

**`crossorigin` en el preload no es cosmético.** Las fuentes se piden siempre en modo CORS anónimo,
también desde el mismo origen; sin `crossorigin` el preload no casa con la petición que hace la
`@font-face` y el navegador **descarga el archivo dos veces**. No da error en ningún log: el preload
pasa de ahorrar tiempo a costar bytes, en silencio. Tiene test propio, y en el navegador se confirmó
que `oswald-700` se pide **una sola vez**.

**El peso se midió, no se eligió.** Ninguna pieza declara `font-weight` en los titulares, así que
heredan el `bold` (=700) de la hoja del navegador — y el navegador lo corroboró: `Oswald 500
unloaded, Oswald 700 loaded`. Precargar la 500 habría sido una descarga tirada *y* la 700 se habría
pedido igual. Un test sobre el CSS emitido lo fija: si algún día una pieza le pone `font-weight` a un
titular, cae y obliga a revisar la decisión.

**La ficha legacy no se movió, comprobado en el navegador**, no deducido: `{color, font: serif}` sale
con Georgia, **cero** `@font-face`, **cero** preloads, **cero** descargas.

### Dos tablas que decían cosas distintas, y el test que no lo veía

Había **dos** fuentes de verdad de los stacks —`fuentes.ts` y una tabla privada en `css.ts`— y para
`moderna` **no coincidían**: `Inter,Segoe UI,Roboto,Helvetica Neue,sans-serif` contra
`'Helvetica Neue',Arial,sans-serif`. La que llegaba al `<style>` era la de `css.ts`, así que unificar
hacia la otra habría cambiado la tipografía de **toda ficha sembrada con `font: moderna`** — la única
regresión que la spec prohíbe con esas palabras.

El test que decía cubrirlo comprobaba que los tres roles legacy *existieran* en `STACKS_SISTEMA` y
*no estuvieran* en `FAMILIAS`. Nunca comparó valores. Ahora compara **el literal exacto de producción,
escrito a mano en el test** contra lo que emite `tokensDeMarca`: escribirlo a mano es deliberado —
leerlo de la constante sería comprobar que es igual a sí misma, que es exactamente por lo que la
divergencia sobrevivió.

### Tres agujeros que solo aparecieron mutando

1. **El de prototipos, reabierto donde nadie miraba.** `css.ts` lo tenía cerrado y documentado con
   `Object.hasOwn`; `fuentes.ts` se escribió después, con indexación directa, y `stackDe("toString")`
   devolvía `Object.prototype.toString` → emitía `'undefined',undefined` como familia. En producción
   el perfil llega de Storyblok **sin pasar por Zod**, así que el nombre es alcanzable desde el Visual
   Editor. Cerrado en los **cuatro** puntos que indexan las tablas.
2. **Las dos allowlists, separadas solo por un comentario.** Fusionarlas —que el campo legacy
   `brand.font` aceptara los cuatro nombres nuevos— dejaba los **299 tests en verde**. La decisión
   estaba tomada, escrita y sin nada que la sostuviera.
3. **El test de «cero terceros» no cae si desaparecen las fuentes**: pasa feliz recorriendo cero
   `url()`. Lo acompaña un test de **no-vacuidad** que exige que la ficha con manual traiga al menos
   3 `url()` en el `<style>`. Sin él, la garantía se cumple sola no haciendo nada.

**La revisión encontró un cuarto**, y es el mismo modo de fallo: el `Object.hasOwn` de `cssDeFuentes`
no lo sostenía ningún test — revertirlo dejaba los 300 en verde. El impacto era un `"\n"` sobrante,
pero `cssDeFuentes` es un export público que declara recibir texto de fuera. Fijado, con la mutación
confirmada (`'\n' !== ''`).

**Una fixture del gate de paridad, retocada a mano: +1 línea.** El `preload` es un `<link href=…>` y
`hrefsDe()` captura todo `href`, así que esa cara de la huella cambió en el único caso del gate cuya
ficha pide una familia propia. Se añadió **esa línea** y nada más — **no se re-capturó**: re-capturar
habría sobrescrito las diez con la foto de "después" y el gate pasaría a compararse contra sí mismo.
La alternativa (excluir `rel="preload"` de `hrefsDe`) se descartó: habría debilitado el comparador
para los diez casos y para siempre, exonerando en silencio una categoría entera de `<link>`. Retocar
una línea es auditable en el diff; cambiar el comparador se olvida. Dos mutaciones confirman que la
fixture sigue cayendo, tanto si el preload **cambia** como si **desaparece**.

## ✅ Entrega 3, mitad A — el sitio por fin cambia de aspecto

Los **cinco arreglos visuales** y los **9 tokens de marca consumidos de verdad**. Es la primera
entrega del bloque que se ve, y se ve: la web de Bella Napoli pasó del rojo por defecto a su verde,
con el rótulo en script y los titulares condensados.

**La decisión que ordena el resto: dos capas de tokens.** Los `--marca-*` dicen lo que dice la ficha;
una capa semántica en medio es la que consumen las piezas. Sin ella, corregir el contraste del acento
en modo oscuro habría exigido **reescribir el token del cliente** — mentir sobre su ficha. Con ella,
el acento legible es un derivado (`color-mix`) y la ficha sigue diciendo `#a3122b`.

**Lo que se ve en oscuro** es lo más notable: las líneas de la carta eran casi blancas sobre negro (el
hueco que la entrega 2 trasladó a propósito) y los precios salían en rojo oscuro a **2.41:1**. Ahora
las líneas son grises y los precios rosa claro, **5.50:1**.

**Un error mío que encontró el implementador midiendo.** Propuse `#c8963e` como `secundario` de la
paleta sin comprobar contraste, y el mapeo `secundario → --muted` lo convertía en el color del lede,
las direcciones, los horarios y el nav: **2.62:1**, falla AA. La web del cliente de demo habría salido
con todo el texto secundario en oro ilegible. El arreglo de fondo es conceptual: «secundario» es el
segundo color **de marca**, decorativo, no el gris del texto secundario. Ahora `--muted` es neutro
fijo y `--marca-secundario` queda emitido sin consumidor hasta la mitad B.

**Y lo que encontró la revisión, todo del mismo tipo:** tres decisiones deliberadas que solo vivían en
un comentario. El umbral de 28 caracteres del CTA no lo fijaba ningún test —cualquier valor entre 15 y
39 pasaba, y el JSDoc afirmaba que «tiene que doler en un test»—; mi decisión sobre `--muted` tampoco,
porque el test usaba una ficha sin marca y el default coincidía con el neutro; y el `@supports` del
`color-mix` se podía quitar sin que cayera nada. Los tres, ahora con test de borde y mutación.

## ✅ Entrega 2 — ensamblado y piezas, con paridad

`html.ts` pasa de **751 líneas a 177**: las cuatro funciones que repetían cada una su `<head>`,
`<style>` y pie son **cuatro recetas del mismo ensamblador**, sobre un shell fijo y un catálogo de
**9 piezas** con su CSS aislado. El CSS de una pieza que no dibujó nada no viaja.

**El orden del trabajo fue el punto entero.** Las 10 fixtures del gate se capturaron y commitearon
**antes** de tocar el render (`4c75e47`), en un commit propio: una foto sacada después habría medido
el resultado contra sí mismo. Comparan texto visible, `href`, `id` de ancla, JSON-LD y la traza de
research.

**Lo que encontró la revisión y ningún test veía.** El gate **no mira el `<style>`**, así que el
reparto del CSS era el punto ciego. Un comparador de cascada sobre las 10 fixtures encontró que los
dos `<h2>` del pie perdían `letter-spacing:-.01em`: venía de `section h2`, que empataba en
especificidad con `footer h2` y ganaba esa propiedad por ser el único que la declaraba. El método del
implementador —buscar dueño por declaración— **no podía verlo**, porque la declaración sí tenía dueño
y aun así dejaba de llegar a dos elementos.

**Un bug de seguridad que nadie pidió arreglar.** `themeCss` hacía `brand.font in FONT_STACKS`, e `in`
recorre la cadena de prototipos: `brand.font = "toString"` metía `function toString() { [native code] }`
dentro del `<style>`. Reproducido y cerrado con `Object.hasOwn`. En producción el perfil llega de
Storyblok **sin pasar por Zod**, así que era alcanzable.

**Y tres garantías que estaban en un comentario**, cerradas tras la revisión: el orden del catálogo
(el test lo derivaba del propio array, así que reordenarlo movía los dos lados), la adyacencia entre
piezas (`.p-hero + *` cruzaba a la vecina sin nombrarla y pasaba el detector) y seis de los nueve
tokens de marca sin test de sobreescritura. Las tres, con mutación comprobada.

**Dos cosas se decidieron y quedaron escritas donde se buscan**, no solo en el código: `brand.plantilla`
elige un **juego de cuatro recetas**, y `hero` va en las cuatro. Las dos cierran la ambigüedad que la
enmienda de la spec pedía cerrar al implementar.

**El modo oscuro se repartió CON SUS HUECOS.** Completarlo es un arreglo visual de la entrega 3:
hacerlo aquí habría cambiado cómo se ve el sitio. Verificado con los ojos — en la carta de Bar Pepe en
oscuro se siguen viendo el doble borde y las líneas casi blancas.

## ✅ Entrega 1 — contrato y recorrido de datos

Un campo del perfil **no llega al HTML si no cruza cuatro fronteras**. Esta entrega amplió las tres
primeras —Zod en la puerta, la allowlist `app.nap_publico` de la migración `0014`, y `perfilValido`—
y dejó **el render sin tocar a propósito**: si el rediseño y el refactor entran juntos, un cambio
inesperado no se puede atribuir a ninguno de los dos.

Lo que ahora cruza: `portada` y `fotos`, el manual de marca (6 tokens de color, 3 roles tipográficos,
`plantilla`), y la carta con `precios`, `nota`, `foto` y `menu_categorias`. Topes 30/3/20 en las tres
capas. El detalle está en el [plan](../docs/proyecto/15-plan-plataforma.md#bloque-e--el-aspecto-de-las-webs).

**El riesgo de orden de la `0014` no era un descuido.** El plan avisaba de que corre **antes** de la
`0015`-`0019` en base nueva y **después** en producción. Al verificarlo apareció que la reserva era
explícita y que **las cinco posteriores ya declaraban su independencia** — pero en un comentario.
Ahora un test aplica las migraciones sobre **dos PGlite en los dos órdenes** y compara funciones,
grant, columnas generadas y la proyección de la allowlist.

**Seis mutaciones**, todas con `grep` confirmando que aterrizaron. Las dos que no estaban pedidas
fueron las más elocuentes: quitar el `grant select (business_profile_publico)` tumba **23 tests**
—"caen las webs de todos los clientes a la vez", como dice la spec— y cambiar `set` por `set local`
deja el `lock_timeout` en cero con todo lo demás en verde.

**Y un test que no estaba pedido y resultó el que más ata:** las tres fronteras **encadenadas**
(`renderer/src/tres-fronteras.test.ts`). Cada capa tenía sus tests, pero lo que rompe el recorrido no
es que una falle: es que **las tres listas no digan lo mismo**, y un campo enumerado en dos de tres
desaparece sin error y sin log. Recorre el camino real —JSON → Zod → `business_profile` → la columna
generada → `perfilValido`— y exige que el perfil salga entero. Mutación comprobada: quitar
`menu_categorias` **solo** de `perfilValido`, dejándolo en las otras dos, lo tumba con nombre.

### Lo que encontró manejar la app, y no los tests

- **El `dev-server` imprimía etiquetas crudas.** Su mock tenía `body: "<p>Producto de temporada.</p>"`
  y el render hace `esc(s.body)`, porque la prosa del LLM se pide en frases y no en HTML. Lo grave no
  es el defecto: es que **invita a "arreglar" el escape**, que es la puerta que ese `esc` cierra.
  Arreglado el mock, no el render.
- **Bar Pepe**, el cliente legacy sembrado a propósito, sale con **su serif y su acento `#a3122b`**
  mientras Bella Napoli sale con el default: cada uno con su marca, cero regresión, consola limpia.

### Dos tests que atraparon lo que una lectura no

- **El seed de demo necesita el legacy `{color, font}` junto al manual nuevo.** Se lo saqué al pasarlo
  al manual, y hasta la entrega 2 el CSS **solo sabe leer la forma vieja**: la web de La Birra Bar se
  habría quedado con el rojo por defecto sin que nada avisara.
- **El ancla anti-deriva comparaba tres claves a mano**, así que quedó verde con el seed sin ninguno
  de los cuatro campos nuevos. Ahora recorre las claves del JSON publicado y crece sola.

**▶️ Lo próximo, en este orden:**

**Las seis piezas con imagen**, que es lo único que queda del bloque E: `heroPortada`, `barraDatos`,
`platosDestacados`, `galeria`, `ctaFinal` y `cartaCategorias`. La puerta por la que van a pasar sus
fotos ya está puesta y probada (mitad B, parte 1), así que lo que falta es dibujarlas.

Su gate **no es la paridad** —la entrega 3 cambia el aspecto a propósito— sino el navegador: claro y
oscuro, escritorio y móvil, **con fotos y sin fotos**. Para eso está `borcelle.es` en el `dev-server`,
con las siete fotos reales y dos stories propias en el `MockCda`.

**Las fotos NO bloqueaban la mitad B, y esta documentación decía que sí.** Los tests del render no
descargan nada: una URL de `a.storyblok.com` inventada ejercita las piezas igual de bien que una
real. Lo que las fotos desbloquean es **verlo en un navegador**, que es el último paso de la mitad B
y no el primero. La corrección importa porque la afirmación equivocada dejó la mitad B parada
esperando un asset que no hacía falta para escribirla.

**Assets: subidos** (2026-08-08). Space `293831091573700`, host `a.storyblok.com` —el de la
allowlist—, sin `?token=`. Las siete URLs están en
[el README de `template1`](../docs/plantillas/template1/README.md#subidos-a-storyblok-2026-08-08),
junto con la paleta y los roles tipográficos ya decididos en `marca.json`. Caveat para cuando se
mire: es **una foto por destino, no una por elemento**, así que la galería y la carta repiten la
misma imagen tantas veces como elementos tengan.

## ⏳ Lo que espera a Juan

| Qué | Por qué él | Bloquea |
| --- | --- | --- |
| ~~Subir las fotos a Storyblok~~ | — | ✅ **hecho** el 2026-08-08, siete URLs en el README de `template1` |
| **Una foto distinta por elemento** en galería, carta y ubicaciones | Son los assets | Nada técnico. Hoy hay **una por destino**, así que la galería sale con seis copias de la misma imagen: sirve para desarrollo, no para enseñárselo a un cliente |
| **La portada, sin el logo incrustado** | Es el asset | Nada bloqueante. Hoy el logo saldría dos veces (cabecera + foto) y quemado en el JPG no lo lee un buscador |
| **Decidir si las fotos son reales o de stock** | Es del negocio | Nada técnico, pero si son de stock hay que decirlo en el seed — misma regla que los precios: antes ausente que inventado |
| ⚠️ **`PIPELINE_MODO` y `TRUST_PROXY` en `amg-project`** | Es el panel de Railway | Nada, pero **la herramienta y el panel discrepan**: Juan borró `TRUST_PROXY` y dice que `PIPELINE_MODO` no estaba, y `auditar:railway` sigue viendo las dos. O el borrado necesita redespliegue para reflejarse en la API, o se miró otro servicio. Conviene saber cuál miente **antes** de fiarse de esa herramienta para algo que sí importe |
| Decidir qué es `NPM_CONFIG_PRODUCTION` | Nadie lo declaró | Nada |
| `STORYBLOK_SPACE_ID` y `TRUST_PROXY` del renderizador **difieren de la fuente** | Es el panel | Nada hoy; conviene saber cuál gana antes de tocar el Visual Editor |

Y lo que ya hizo: **desplegó la `0014`** (ver abajo), puso **los cuatro tokens de Storyblok en el
renderizador** (`auditar:railway` los ve; el servicio pasó de 3 a 6 coincidencias) y limpió las seis
credenciales ajenas de la API.

## ✅ La `0014`, aplicada en producción — y lo que solo se supo corriéndola

Dos cosas que ningún test en PGlite podía contestar:

- **Aplicó en la posición que el test de orden predecía.** El runner la insertó **entre la `0012` y la
  `0015`**, no al final: `migrarConRegistro` recorre el directorio ordenado y saltea las registradas.
  O sea que el escenario "la `0014` corre después de la `0019`" —el que motivó el test de los dos
  órdenes— **no se dio**, y el que se dio es el mismo de una base nueva. El test sigue valiendo: lo
  que garantiza es que **daba igual cuál de los dos ocurriera**.
- **El `grant` sobrevivió al `drop column`**, que es el riesgo que la spec eleva a crítico. La prueba
  no es el 200 del renderizador: es que el HTML trae «La Birra Bar» y las dos direcciones del footer,
  y ese dato **solo** puede venir de `business_profile_publico`.

**Lo que la `0014` no trae por sí sola:** las fichas de producción siguen sin los campos nuevos. La
columna se recalculó, pero `business_profile` no tiene fotos ni manual de marca hasta que la agencia
los cargue o se re-siembre la demo. Para la **entrega 3** eso es un paso previo, no un detalle.

**Abiertos y sin bloquear a nadie:** **C-1** (en dry-run el ensayo no se puede observar) y **C-2** (la
marca de C0 y el workflow real pueden discrepar; el barrido no cancela el workflow).

---

## 🔴 Riesgo abierto — las credenciales expuestas, **postergado por decisión del usuario (2026-08-04)**

> **No lo levantes como bloqueante en cada sesión.** Juan decidió posponer la rotación; sigue siendo un
> riesgo real y abierto, no un asunto cerrado. Lo que corresponde es dejarlo anotado y seguir con el
> trabajo, no volver a proponerlo cada vez.

`docs/private.zip` estuvo **commiteado en este repositorio, que es público**, desde el 2026-08-01
(commit `15ae91a`). Ya se sacó del índice y el `.gitignore` quedó blindado —y desde la 13ª review cubre
también los directorios hermanos tipo `docs/private-backup/`—, pero **el objeto sigue en el historial de
GitHub** por decisión tomada: purgar no des-expone, lo que devuelve la seguridad es rotar.

**La lista priorizada vive fuera del repo:** `docs/private/rotacion-credenciales.md` (gitignoreado).

Cuando la rotación se complete, dejar acá una línea con la fecha. Eso sí es el hecho.

---

## Plantilla (dejar así al cerrar)

```markdown
**Sesión:** YYYY-MM-DD
**En curso:** <qué se está haciendo>
**Estado:** <en progreso | bloqueado | listo para revisión>

**Decisiones de esta sesión:**
- <qué se decidió y por qué>

**Pendiente inmediato:** <lo próximo>
```
