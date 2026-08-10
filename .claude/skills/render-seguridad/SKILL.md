---
name: render-seguridad
description: Usar al tocar renderer/ o web-builder/src/render/ — el orden de comprobaciones de app.ts, el rol app_render, la allowlist business_profile_publico, perfilValido, y todo lo que termina en `<style>`, `<img src>` o el HTML. Cubre por qué el dominio ES la autorización, por qué filtrar por tenant acá sería teatro, y la trampa de agregar un campo al perfil que se filtra en silencio.
---

# El renderizador: la única superficie anónima

`renderer/` es la **única pieza del sistema expuesta a internet anónimo** (ADR-19: 1 servicio, N
dominios). La API exige un JWT; el orquestador no atiende a nadie de afuera. Éste atiende a
cualquiera, así que la pregunta de diseño no es *"¿qué necesita?"* sino **"si me lo toman, ¿qué se
llevan?"** — está en la cabecera de
[`0007_render_publico.sql`](../../../db/migrations/0007_render_publico.sql) y gobierna todo lo de abajo.

El otro medio ámbito es **`web-builder/src/render/`** (shell, piezas, CSS, JSON-LD): vive en otro
workspace pero **lo que escribas ahí se sirve a internet anónimo**. Publicar
(`web-builder/src/publish/`, la Management API) sí es de `pipeline`: ver `pipeline-publicacion`. Acá va
**quién puede ver qué, y qué se valida antes de emitirlo**; al lado están `render-cda-cache` (leer
Storyblok, las caches, los límites) y `render-plantillas` (el aspecto: piezas, tokens, tema, CSS).

## El orden de `app.ts` ES la autorización

[`renderer/src/app.ts`](../../../renderer/src/app.ts) lo documenta en su cabecera, y no es una lista de
pasos: es la decisión.

1. **`Host` → dominio canónico** (`hostDeLaPeticion` / `normalizarHost`, `dominio.ts`). Si no
   normaliza, **404 y se acabó** — sin fallback a ningún cliente.
2. **dominio → sitio, bajo RLS como `app_render`** (`PgSitios.porDominio`, `db/src/sitios.ts`). Sin
   sitio, sin `spaceId` o sin token: 404.
3. **¿preview autorizado?** (`previewAutorizado`). Solo entonces se leen borradores.
4. **cache → CDA → `renderStory()`**.

**Nada de esto consulta un tenant, y filtrar por tenant acá sería teatro.** No hay a quién
preguntárselo: del otro lado hay un navegante sin usuario, sin tenant y sin membresía. El renderizador
tendría que derivar el `tenant_id` **del propio dominio**, y un control que el controlado se autoexpide
no controla nada. Por eso la política `client_render_select` (0007) no menciona
`app.current_tenant_id()`. Lo real es el recorte de privilegios, no el filtro.

Tres cosas que se rompen fácil en ese orden:

- **`Host` lo escribe el cliente.** Lo único que lo hace usable como clave es que una respuesta
  equivocada solo puede mostrar contenido **que ya es público**. `X-Forwarded-Host` solo se mira con
  `TRUST_PROXY=1`; el default es **no confiar**: equivocarse tiene que romper, no servir el sitio que
  pida quien llama.
- **`normalizarHost` es deliberadamente estrecho**: sin IDN crudo (punycode `xn--` sí, es ASCII), sin
  IPs (de ahí el chequeo de TLD no numérico — `127.0.0.1` encaja perfecto en "etiquetas separadas por
  puntos"), sin `localhost`. La base además tiene un `check` de forma canónica, así que una fila
  insertada a mano en mayúsculas queda **inalcanzable, no ambigua**.
- **Las tres razones del 404 dan la MISMA respuesta.** "No existe", "archivado" y "sin space" no se
  distinguen: un 404 que explica *por qué* falló es un oráculo para enumerar la cartera.

## `app_render`, el rol más pobre del sistema

Un login por proceso con `NOINHERIT` (ADR-17): `amg_render` solo puede asumir `app_render`, y lo impide
Postgres, no un `if`.

| Tiene | No tiene |
|---|---|
| `select` sobre **5 columnas de UNA tabla** (`clients`) | insert / update / delete en ninguna tabla |
| `usage` en `public` y `app` | **`execute` sobre las funciones de `app`** |
| la política `client_render_select` (`domain is not null and archived_at is null`) | `kr_*`, `memberships`, `tenants`, las caches del proveedor |

**Ese `execute` ausente ya evitó un fallo silencioso.** Las funciones de `app` derivan autoridad desde
una membresía y el renderizador no tiene ninguna. Como las políticas de un comando se combinan con OR
pero **cualquiera que lance mata la query entera**, las viejas `client_select`/`client_write` —creadas
sin cláusula `to`, o sea aplicables a PUBLIC— reventaban con `42501 permission denied for table
memberships`. Con el `execute` concedido habría *funcionado en silencio*, evaluando políticas de
usuarios autenticados en cada visita a la web de un restaurante. **Una política sin `to` es una
política que aplica a roles que todavía no existen.**

`PgSitios` vive fuera de `PgStore` por lo mismo (`PgStore` setea `app.tenant_id`/`app.user_id` y asume
`app_user` o `app_service`, y acá ninguno sería verdad), y su `select` enumera columnas **literales**:
un `select *` desde este rol falla, y crecería solo si alguien agrega una columna.

**El token de preview está dentro del radio de explosión, y se paga a sabiendas**: es el costo de que
ADR-19 comprara el Visual Editor. Lo tolerable es que servir draft exige además una firma válida, y que
lo peor que se filtra son borradores de restaurante. **La Management API nunca entra acá.**

## La allowlist: cuatro fronteras, y el campo que desaparece sin ruido

Un campo del perfil cruza **cuatro** fronteras para llegar al HTML
(`docs/superpowers/specs/2026-08-01-plantillas-landings-design.md`, §Las cuatro fronteras):

| # | Dónde | Qué hace |
|---|---|---|
| 1 | `web-builder/src/contract.ts` (Zod) | valida en la puerta; **descarta lo que no enumera** |
| 2 | `app.nap_publico` → `clients.business_profile_publico` (`0014`) | allowlist de **nombres de clave** y **forma de valor** |
| 3 | `perfilValido` (`renderer/src/perfil.ts`) | recorta antes de renderizar |
| 4 | el render (`web-builder/src/render/`) | revalida y emite |

**La trampa: agregás un campo al perfil y, si no lo agregás a las cuatro, no da error — no aparece.**
Sin log, sin excepción, semanas después, como una foto que no se ve. Al revés es peor: meter en la
allowlist SQL algo del CRM (contacto, contrato, `score`) lo publica a internet anónimo.

**Un ejemplo vivo, medido el 2026-08-10:** `brand.tema` existe en `web-builder/src/types.ts` y lo lee
`ensamblarCss` (`render/css.ts`), pero **no lo enumera ninguna de las fronteras 1, 2 ni 3**. En
producción una ficha con `tema: "auto"` no llega al render: se cae tres veces en silencio. Antes de
tocar el tema, comprobalo — no lo deduzcas del tipo.

Dos consecuencias mecánicas más:

- **Una columna STORED no se recalcula porque cambie la función.** Ampliar la allowlist obliga a
  `drop column` + `add column … generated` — y **el `drop column` se lleva el grant de columna**. Sin
  reponer `grant select (business_profile_publico) on clients to app_render`, caen las webs de todos
  los clientes a la vez. Ya pasó en la 0009; hoy lo verifica un test conectando *como* `app_render`.
- **La allowlist SQL restringe nombres y forma (`app.texto_publico`, `app.foto_publica`,
  `app.numero_publico`), no contenido.** No valida hex, ni https, ni hosts, y no debe: daría una falsa
  sensación de defensa y dejaría que alguien quitara la de las fronteras 1, 3 y 4.

Quién lo caza: `renderer/src/tres-fronteras.test.ts` recorre el camino real (JSON → Zod →
`business_profile` → columna generada → `perfilValido`) y exige que **el perfil salga entero**;
`db/src/fotos-publicas.test.ts` cubre la frontera 2 en las dos direcciones, con cada campo aseverado en
exactamente un test para que la mutación sea legible.

## `perfilValido`: defensa en profundidad, no redundancia

**En producción el perfil llega de una fila `jsonb` que nadie validó al escribir.** Postgres garantiza
JSON válido y nada más, y el Zod del `web-builder` no está en ese camino. `renderStory()` confía en el
tipo `BusinessProfile` —con razón dentro del pipeline, donde lo construye código tipado—; acá la cadena
se rompe. El caso real: `address` como texto plano en vez de un `PostalAddress` → `esc(undefined)` →
`.replace` sobre `undefined` → excepción → **503**. Un NAP mal cargado tiraba la web entera de ese
cliente, y el fallo aparecía al publicar, no al guardar la ficha. El comentario que decía que un perfil
malo "degrada en vez de romper" era falso: `typeof p === "object"` deja pasar `{address: "Calle Mayor 1"}`.

La regla: **perfil incompleto → se usa lo que sirva; perfil irreconocible → `null`** y la página sale
sin contacto ni NAP. *Una página sin dirección es mucho mejor que ninguna página.* Se degrada
explícito, nunca se rompe ni se inventa — una foto sin `alt` sale `alt=""`, no con el nombre del
negocio. `name` es el único campo obligatorio.

## Todo lo que va a `<style>`, `<img src>` o el HTML

- **Escapar siempre.** `esc()` para atributos y texto; `safeJson()` para el JSON-LD, porque
  `JSON.stringify` **no** escapa `<`, `>`, `&` y con eso se cierra un `</script>`.
- **Color: hex o nada** (`hexValido` en `render/css.ts`, `hex()` en `perfil.ts`, misma regex); lo que
  no valida cae al default del CSS base, así que **la web sale sobria, nunca rota**. **Fuente:
  allowlist de siete NOMBRES DE ROL**, nunca una familia ni un stack CSS — un stack en la ficha es
  texto libre entrando a un `<style>`. **Logo: `https` explícito**, porque `.url()` de Zod acepta
  `javascript:`, que tiene esquema.

**La política de imágenes** (`web-builder/src/render/imagenes.ts`) existe porque escapar evita la
**inyección** pero no la **fuga**: un `<img>` es una petición que hace solo el navegador del visitante,
y el host que la recibe se lleva su IP, su user-agent y la URL que estaba mirando — por cada visita de
cada cliente. Cuatro reglas (los emisores concretos, en `render-plantillas`):

1. **`HOSTS_DE_ASSETS` vive en el código, no en la ficha**: una ficha comprometida se ampliaría sola.
2. **Comparación exacta contra un `Set`.** Nada de `endsWith` (`a.storyblok.com.evil.tld`) ni
   `includes` (`evil-storyblok.com`). Y se compara `new URL(src).hostname`, no el string:
   `https://a.storyblok.com@evil.com/x.jpg` **va a evil.com**.
3. **https obligatorio** (`fuentePermitida`), con `new URL()` envuelto en try: un throw desde el render
   tumba la web entera por una foto mal puesta. Y **`referrerpolicy="no-referrer"` en cada `<img>`**
   (`renderImagen`, `render/lib.ts`).
4. **`MAX_IMAGENES_POR_DOCUMENTO = 60`**, con el `PresupuestoImagenes` creado **por documento** y nunca
   como contador de módulo: esto es un proceso largo que atiende a todos los clientes, no un CLI — con
   un contador de módulo se sirve la primera web con fotos y **todas las siguientes sin ellas**. Y el
   orden es allowlist primero, cupo después: una URL rechazada que gastara presupuesto convertiría la
   defensa en el ataque.

`imagenPublicable` **exige https pero NO la allowlist de hosts, a propósito**: `og:image` y el `image`
del JSON-LD no los carga el navegador del visitante sino el crawler de la red social, así que la fuga
no ocurre — y exigirla le quitaba la tarjeta social a todo cliente con su foto en su propio dominio.

**Las fuentes servidas** (`fuentes-servidas.ts`) son la otra ruta pública que no es HTML generado, y no
tocan el filesystem con lo que pida quien llama: se cargan a memoria al arrancar y cada petición busca
en un `Map`. **No hay path que atravesar** — `..` no es un caso especial, es una clave que no está.

## Preview y webhook: los dos con secreto, los dos fallan cerrado

**Preview** (`preview.ts`). Servir `draft` sin firma dejaría a cualquiera leer lo que un cliente
escribió y no publicó. Exige HMAC sobre `dominio\nvencimiento` —el `\n` separa: sin él,
`("bella.es", 12)` y `("bella.e", "s12")` firman igual— comparado con `timingSafeEqual`.
`previewAutorizado` **nunca lanza** y falla cerrado en todo: sin secreto, sin firma, vencida o de otro
dominio → `false` → se sirve lo publicado. **El alcance es todo el dominio a propósito** (el Visual
Editor navega entre páginas; re-firmar por clic rompería lo que ADR-19 fue a comprar); lo que acota el
riesgo es que está atado al dominio, vence, y solo lo emite la agencia. Y el preview **no entra en
ninguna cache**, ni la nuestra ni la de una CDN: `X-Robots-Tag` evita que se indexe, **no** que se
cachee, así que van también `cache-control: private, no-store…` y `vary: *`.

**Webhook** (`webhook.ts`). Sin firma sería un botón público para tirar la cache de cualquier cliente,
y apretarlo en bucle convierte un servicio que sirve de memoria en uno que paga la CDA en cada visita.
Cuatro cosas, **en este orden**: sin `webhookSecret` el endpoint responde **503** (cerrado, no abierto);
el tope de cuerpo (`MAX_BODY_WEBHOOK`, 256 KB) se comprueba **antes de leer** —verificar la firma exige
el cuerpo entero, así que sin el corte un anónimo sin el secreto nos hace bufferear lo que quiera— y
**otra vez después**, porque `content-length` lo declara quien pide; la firma se valida sobre el
**cuerpo crudo** (parsear y re-serializar la rompe) con `timingSafeEqual`; y recién entonces se parsea.
El **dedupe por hash** existe porque la firma autentica los bytes y nada más: sin timestamp ni id de
entrega, una petición legítima capturada se repite para siempre. No es perfecto —quien capture dos
entregas puede alternarlas— pero convierte "infinitas invalidaciones" en "una por ventana". Qué
invalida el evento una vez aceptado, en `render-cda-cache`.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Agregar un campo al perfil y no a las cuatro fronteras | No da error: no aparece. Sin log, semanas después |
| Meter en `app.nap_publico` un campo del CRM | Se publica a internet anónimo, en silencio |
| `drop column` de la generada sin reponer el `grant` | `app_render` pierde el select: caen **todas** las webs |
| Un 404 que dice por qué falló | Oráculo para enumerar la cartera de la agencia |
| Filtrar por tenant en el renderizador | Teatro: el valor lo derivaría él mismo del dominio |
| Conceder `execute on all functions in schema app` a `app_render` | Evalúa políticas de usuarios autenticados en silencio |
| Crear una política sin cláusula `to` | Aplica a PUBLIC, incluidos roles que aún no existen |
| Importar la Management API desde `renderer/` | El proceso anónimo pasa de leer lo público a reescribir todo |
| `endsWith`/`includes` para el host de una foto | `a.storyblok.com.evil.tld` pasa |
| `PresupuestoImagenes` a nivel de módulo, o gastar cupo antes de la allowlist | La primera web con fotos y las demás sin ellas; o la defensa apagando las fotos legítimas |
| Interpolar sin `esc()` "porque viene de nuestra base" | En prod no pasó por Zod. Ese es el punto |
| Servir preview con `X-Robots-Tag` como única defensa | Una CDN lo guarda y se lo sirve a un anónimo |
| Dejar que el render lance (un `new URL()` sin try) | 503 en la web de un cliente por una foto mal puesta |

## Verificación

```bash
npm test -w renderer    # 143 tests, sin red ni credenciales (Hono con interfaces + PGlite)
npm run typecheck
```

Los tests del área: `app.test.ts` (el 404 sin fallback, el webhook sin firma, el preview de otro
dominio), `perfil.test.ts`, `dominio.test.ts`, `tres-fronteras.test.ts`, `fuentes-servidas.test.ts`,
`cache.test.ts`, `cda.test.ts`. Del otro medio ámbito: `web-builder/src/render/imagenes.test.ts`,
`piezas/piezas-foto.test.ts`, `tema.test.ts`.

Y **manejá la app en un navegador** (`npm run dev:server -w renderer`, mock sin credenciales): acá
`perfilValido` nació de lo que encontró el navegador, no los tests. ⚠️ **`npm run demo -w renderer`
pega contra el Storyblok REAL con credencial real** — no lo corras.

La pregunta de cierre, que en este ámbito nunca es retórica: **lo que acabás de agregar, si me lo
toman, ¿qué se llevan?**
