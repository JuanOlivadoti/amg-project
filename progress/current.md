# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-08
**En curso:** **bloque E** — el aspecto de las webs. Entregas **1** y **2** cerradas; de la **3** está
hecha la **mitad A** (los cinco arreglos visuales y los 9 tokens de marca) y la **C a medias** (las
tipografías se sirven, falta que el CSS las pida). Queda la **mitad B**, que espera las fotos.
**Estado:** listo para seguir. **1177 tests**, typecheck limpio, y las webs manejadas en un navegador.

## 🟡 Entrega 3, mitad C — las tipografías: servidas, sin enchufar

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

**▶️ Lo que falta acá, y es el siguiente paso:** el CSS emitido **todavía no pide las fuentes**.

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

1. **Enchufar las tipografías** (cierra la mitad C). Que `--marca-fuente-*` resuelva a `stackDe(rol)`
   y que el `<style>` incluya `cssDeFuentes(rolesUsados)`, que emite las `@font-face` **solo de las
   familias que la página usa**. Toca la firma de `ensamblarCss`. Con eso llega el test que la
   enmienda pide y que **todavía no existe**: *cero terceros en el CSS emitido*.
2. **La mitad B** — las piezas con imagen, la allowlist de hosts y el presupuesto de 60 `<img>`.
   **Bloqueada**: necesita las fotos en Storyblok.

**Se parte en dos mitades**, y no por diseño sino por disponibilidad del dato: los **seis arreglos
visuales, las tipografías y el uso real de los tokens** no necesitan ninguna foto y se pueden
verificar hoy; las **piezas con imagen** sí, y su gate pide ver el sitio *con fotos y sin fotos*.

**Esperando assets:** las fotos van a [`docs/plantillas/template1/originales/`](../docs/plantillas/template1/README.md),
una carpeta por destino, con las medidas de cada campo en su README. Los binarios **no se versionan**
—el repo es público y el destino real es Storyblok, porque la allowlist solo acepta `a.storyblok.com`—
así que la carpeta es el buzón de trabajo. La paleta y los roles tipográficos ya están decididos en
`marca.json`. Las URLs de foto del seed apuntan hoy a assets que **no existen**: hasta subirlos, la
web de demo saldría con imágenes rotas en cuanto el render las dibuje.

## ⏳ Lo que espera a Juan

| Qué | Por qué él | Bloquea |
| --- | --- | --- |
| **Subir las fotos a Storyblok** (asset manager del space) | Es la credencial | **La mitad B de la entrega 3.** Están cargadas en `docs/plantillas/template1/originales/` con las medidas exactas, pero la allowlist solo acepta `a.storyblok.com`: mientras vivan solo en disco, el render las descarta |
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
