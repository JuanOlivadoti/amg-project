# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-11
**En curso:** nada. **La navegación del portal es cliente-céntrica**, sus cuatro tareas cerradas y
revisadas. Antes, el 2026-08-10, se cerró el **bloque K** (el rediseño de la plantilla base).
**Estado:** **1764 tests** (1395 monorepo + 369 portal: 248 `node:test` + 121 Karma), `verificar` en
verde entero, y el portal manejado en un navegador.

```text
3ee24ed + 2 rondas  tarea 1  la ficha pasa a ser un shell con tabs
43164d9 + 1 ronda   tarea 2  el tab Research; Research deja el menú
97ccde6 + 2 rondas  tarea 3  las tres pantallas de un run cuelgan del cliente
7d6fa89 + 1 ronda   tarea 4  tabs Reseñas e Ideas; se retira «Mi Portal»
```

**Lo que cambió para quien use el portal:** `/clientes/:id` ya no es una pantalla, es un **shell** con
cuatro tabs como rutas hijas (Perfil · Research · Reseñas · Ideas). Las tres pantallas de un run viven
en `/clientes/:id/research/:runId/*`. El sidebar tiene tres ítems y la home abre en `/clientes`.
**Rutas retiradas sin redirect, medido con el Router real:** `/runs`, `/runs/:id`, `/runs/:id/informe`,
`/runs/:id/entregable` y `/clientes/:id/ver` rebotan en silencio a `/clientes`.

El relato, con las dos trampas nuevas que destapó, está en [`history.md`](history.md); el diseño en
[`la spec`](../docs/superpowers/specs/2026-08-11-ficha-cliente-navegacion-design.md).

## 🎯 Lo próximo, y por qué no lo hace el agente `render`

**Las pantallas del portal para los tres campos nuevos** (`bienvenida`, `destacados`, `testimonios`).
Hoy solo se pueden escribir a mano en `business_profile`, y eso es lo que hace al contenido por
defecto **aceptable y temporal a la vez**: un default que el cliente no puede cambiar deja de ser una
propuesta y pasa a ser una afirmación que le pusimos en la boca.

Es trabajo del agente **`front`** (`portal/`). Lo demás del bloque K está hecho.

```text
Continuamos con el portal. Leé primero:
  - progress/current.md (este archivo)
  - docs/superpowers/specs/2026-08-11-ficha-cliente-navegacion-design.md
  - docs/proyecto/15-plan-plataforma.md § Bloque K, etapa 3
  - renderer/docs/04-plantilla-base.md § Las tres secciones nuevas

Falta la pantalla para cargar `bienvenida` (texto), `destacados` (lista de
titulo+texto, máx 6) y `testimonios` (lista de texto+autor, máx 12). Los
campos YA cruzan las cuatro fronteras: Zod en contract.ts, la migración
0020, perfilValido y las piezas.

⚠️ La ficha del cliente cambió el 2026-08-11: `/clientes/:id` es un SHELL
con tabs, y `cliente-perfil.ts` es el tab que pinta los cards (ya no carga
nada: eso lo hace el shell). Estos tres campos son del perfil, así que su
sitio es una card más en ese tab — no un tab nuevo.

⚠️ Dos barridos van a opinar sobre lo que escribas, y tienen razón:
`core/marca-activa.test.ts` (una clase de routerLinkActive que compite con
la base necesita `!`) y `core/arbol-encabezados.test.ts` (contenedor sin
`h1`, hoja con `h1`).

⚠️ NO agregar un campo de puntuación a los testimonios. No existe en ninguna
de las cuatro capas, y su ausencia es la decisión — ver la pieza y la 0020.
```

## ⚠️ Las trampas de esta área, que ya mordieron

Están en la skill `render-plantillas` y en [`renderer/docs/02-escribir-una-pieza.md`](../renderer/docs/02-escribir-una-pieza.md).
Estas siete son las que se repitieron:

```text
backtick en un comentario del CSS      rompe el build con "Expected } but found @"; pasó 3 veces
`url(` o `href=` en un comentario      dos tests analizan el <style> sin distinguir comentario de regla
font-weight en un titular              se precarga UN archivo (peso 700): el preload se vuelve basura
color literal sin contrapartida        el detector de modo oscuro lo caza; o pasa a token, o se redeclara
--decorativo en un ::before con content  un pseudo con `content` dibuja TEXTO, y ese token no pasa AA
especificidad dentro de un @media      `.p-x .a` pierde contra `.p-x .b .a` aunque esté después
especificidad entre dos reglas propias  `.portada.sin-img` (0,3,0) pisa a `.portada` (0,2,0) y se come su padding
```

Y dos del método, que valen más que las siete:

- **El navegador cachea.** Recargá ignorando cache o vas a estar mirando la página vieja. Si dudás,
  comprobá con `curl` que el HTML servido es el tuyo. Y matá los `dev-server` viejos: `tsx` no recarga
  en caliente y un servidor zombi sirve código de hace media hora.
- **Los tests no ven layout.** De los defectos de este bloque, la mayoría los encontró el navegador:
  un `sticky` que no pegaba, un ancla que movía la página 203 px, un logo sin achicar en móvil, una
  portada pegada al borde, cinco columnas donde tenían que ser tres.

## ✅ Lo que quedó hecho, en una línea cada cosa

- **El tema lo decide la ficha, no el sistema operativo del visitante.** `brand.tema`, default
  `claro`. Era un bug de producto: el fondo de marca del cliente lo pisaba `prefers-color-scheme`.
- **Cabecera**: barra superior con teléfono y horario, sticky, nav centrado, CTA `tel:`.
- **Portada**: dos columnas, titular grande y carrusel de fotos **sin una línea de JavaScript**.
- **Doce secciones** con el patrón compartido (`.seccion` / `.banda` / `.encabezado`), y el andamio
  del ancho de lectura **eliminado del todo**.
- **`main` dejó de declarar ancho y respiro**, y por eso las secciones con fondo llegan a los bordes.
- **El pie, en columnas**: contacto + una por local. No cuatro fijas como la referencia — las dos que
  faltarían son un menú que duplica el nav y una newsletter sin backend.
- **Tres secciones nuevas** con sus campos cruzando las cuatro fronteras (migración **`0020`**).
- `heroPortada` y `carta` **retiradas** del catálogo: se quedaron sin receta.

## ⚠️ Deuda declarada (no descubierta después)

**`brand.tema: "auto"` es inalcanzable en producción.** No cruza las tres primeras fronteras (Zod,
allowlist, `perfilValido`), así que una ficha que lo pidiera se queda por el camino tres veces sin
error y sin log. **El default se cumple siempre**, que es la conducta que se quería, pero la opción no
existe hasta agregarlo a las tres.

**La rama del blok `hero` de la pieza `hero` sigue muerta en producción.** Las dos recetas que la
nombran (`menu`, `blog`) pasan `story: null`, así que su foto, su CTA y el CSS de los dos viajan en el
`<style>` de esas páginas sin que nada los dibuje. Las salidas siguen siendo dos: podarla —mudando los
tests de `LIMITE_CTA`— o darle un consumidor real.

Tres más, del servicio, en [`renderer/docs/05-el-servicio.md`](../renderer/docs/05-el-servicio.md):
el cupo del semáforo en producción (64) no lo fija ningún test, el `Semaforo` envuelve al
`Coalescedor` y no al revés, y `.env.example` no documenta lo que `leerConfig()` exige.

Y una del propio gate de paridad: **extrae los enlaces con una regex que entra en el `<style>`**, así
que un `href=` citado en un comentario CSS se cuela en su huella como si fuera un enlace de la página.

## 🌐 Demos en `*.bigballs.es` — decidido el 2026-08-10

**Un subdominio por cliente para la demo, y el dominio propio al lanzar.** El paso a paso completo
está en [`14-runbook-despliegue.md`](../docs/proyecto/14-runbook-despliegue.md) § *Dar de alta el
sitio de un cliente*. Lo que decidió Juan:

- **Un dominio por cliente**, no dos. `clients.domain` es único y hay una sola columna, así que salir
  a producción es un `update` del valor y la demo muere ahí. Que convivan exigiría una migración
  (`client_domains`) y tocar `PgSitios` — está descrito por si hace falta, y hoy no está hecho.
- **Las demos no se indexan.** El renderizador emite `X-Robots-Tag: noindex, nofollow` cuando el host
  cae bajo `DOMINIO_PREVIEW`. Sin la variable no emite nada: el daño de no ponerlo es contenido
  duplicado mientras dure la demo, y el de ponerlo mal es sacar de Google un sitio real.

⏳ **Falta hacerlo** (es infraestructura, no código): el wildcard `*.bigballs.es` en Railway, el CNAME
en Hostinger y la variable `DOMINIO_PREVIEW=bigballs.es`. ⚠️ Esa variable **no** va por `env:sync`, así
que `auditar:railway` la va a listar como una diferencia más — intencional.

⚠️ **El wildcard resuelve las demos, no la cartera en producción**: el dominio propio de cada cliente
sigue consumiendo un custom domain de Railway, y el plan está en su límite. Es el bloque G.

## 🍔 El cliente de demo es Borcelle Burger — decidido el 2026-08-10

**Un solo cliente, y ficticio.** El seed, `web-builder/business-profile.json`, el mock del portal y el
dev-server nombran ahora a «Borcelle Burger». El perfil tiene **una sola fuente** (`PERFIL_DEMO` en
`db/src/seed-demo.ts`); `renderer/src/perfil-demo.ts` lo re-exporta y `npm run sql:demo -w renderer`
genera el `update` que lo pone en un dominio.

**Por qué ficticio:** es la única forma de enseñar fotos y reseñas sin ponerle en la boca a un negocio
real cosas que no dijo. `testimonios` no tiene default justamente por eso.

**Por qué un `update` y no un `insert`:** el cliente de demo tiene id fijo, y las cuatro FK que apuntan
a `clients` son `on delete cascade` — deshacer un duplicado borrando uno se lleva sus runs, sus páginas
y sus membresías.

⚠️ **Lo que se perdió, dicho para que nadie lo redescubra:** el seed traía el research **real** de un
cliente real, medido y pagado ($0.3097). Las keywords genéricas se conservaron —le valen igual a
cualquier hamburguesería de Madrid— pero **el informe del portal ya no es un caso medido de verdad**.
Recuperarlo es volver a correr el pipeline.

✅ **Sembrado en producción el 2026-08-10.** `reseed:demo` corrió contra Supabase y el sitio sirve por
fin la plantilla **completa**: 14 imágenes, las 12 secciones y —por primera vez— `testimonios`, que
ninguna ficha había podido enseñar. Verificado en el navegador: **6/6 fotos de galería**, 13/14
imágenes cargadas y **exactamente una prioritaria**, que es la política de imágenes cumpliéndose en
producción y no en un test.

⏳ **Falta:** el `update` del dominio a `borcelle.bigballs.es` (lo genera `npm run sql:demo -w renderer`;
hasta entonces el sitio responde en `birrabar.bigballs.es`) y **despublicar en Storyblok las 12
landings**, que siguen mostrando el nombre anterior en el índice de páginas — viven en la CDA, no en
la base, así que el seed no las tocó.

## ⏸️ Pausado, no abandonado

**Bloque J, pieza 3 (Ideas).** Etapas **1-4 commiteadas** (`afe1725`, `73fcd35`, `c929a98`); faltan
las **5-7**, las pantallas, que son del agente `front`. **Ya tienen dónde caer**: el tab
`/clientes/:id/ideas`, hoy un placeholder que dice qué falta. Y lo de «retirar el mock de ideas» que
esas etapas incluían **ya está hecho**: se fue el 2026-08-11 con `/clientes/:id/ver`.

## ⏳ Lo que espera a Juan

| Qué | Por qué él | Bloquea |
| --- | --- | --- |
| **Cuáles diferencias de Railway son intencionales** (3 de las 4) | Solo él ve los valores | Sí, para dejar `auditar:railway` en verde |
| **Una foto distinta por elemento** en carta (`menu[].foto`) y ubicaciones | Son los assets | No; hoy repiten una imagen por destino |
| **Si `brand.tema: "auto"` se completa** o se queda como deuda | Es de producto | No |

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
