# Editor de carta en el portal — diseño

**Estado:** ✅ aprobado por Juan (2026-08-17), listo para plan de implementación.

## Motivación

El menú digital enriquecido ([2026-08-14-menu-digital-enriquecido-design.md](2026-08-14-menu-digital-enriquecido-design.md))
cruzó las cuatro fronteras (Zod, allowlist de Postgres, `perfilValido`, render) pero se dejó
deliberadamente **sin editor en el portal**: la carta se sigue cargando por SQL/seed. Esa decisión
fue correcta para no agrandar el alcance de esa etapa, pero deja a la agencia dependiendo de un
`reseed:demo` a mano para cambiar un precio. Esta etapa cierra ese hueco: la agencia carga y edita
la carta completa (categorías + platos, con todos los campos del menú enriquecido) desde la ficha
del cliente en el portal.

## Alcance

**Adentro:**
- Un tab nuevo "Menú" en la ficha del cliente (`/clientes/:id/menu`), junto a Perfil/Research/Reseñas/Ideas.
- Alta, edición y borrado de categorías (`menu_categorias`) y platos (`menu`) — todos los campos de
  `MenuItem`: nombre, descripción, categoría, precios (con `comensales`), nota, alérgenos (14),
  etiquetas dietéticas (7), nutrición (calorías + macros), y las URLs de `foto` y de `video`
  (`src`, `poster.src` y `poster.alt` — las tres, ver el detalle en Componentes).
- Endpoints `GET /clients/:id/menu` y `PATCH /clients/:id/menu`, store methods, y la reutilización
  del Zod de `web-builder`.

**Afuera de esta etapa, anotado para después:**
- **Subida de archivos (foto/video) desde el portal.** El formulario pide pegar una URL ya subida a
  Storyblok, igual que hoy hace el seed. Subir el archivo directo desde el navegador —con el portal
  empujándolo a la Management API de Storyblok— es una pieza bastante más grande, cruza al agente
  `pipeline`, y no se decidió acá.
- **El rol `cliente` editando su propia carta.** Es un cambio de producto real (amplía **ADR-20**,
  "el portal también sirve al cliente, en modo lectura") y necesita una pieza de Postgres nueva: un
  trigger `BEFORE UPDATE` que compare la fila vieja contra la nueva y deje pasar la escritura de
  `cliente` solo si lo único que cambió son las claves `menu`/`menu_categorias` de `business_profile`
  — RLS hoy es "toda la fila o nada", nunca "esta clave del JSON sí, el resto no", y el resto de las
  políticas de escritura (`clients`, `kr_runs`, `kr_keywords`, `ideas`, `resenas_google`) comparten
  la misma función `app.puede_escribir()` (solo `maestro`/`equipo`/`servicio`), así que no se puede
  tocar esa función sin abrir las cinco tablas a la vez. Esta etapa deja `maestro`/`equipo` como los
  únicos que escriben el menú, sin tocar `app.puede_escribir()` ni `client_write`.

## Arquitectura

```
Portal (Angular)                    API (Hono)                      Postgres
─────────────────                   ──────────                      ────────
cliente-menu.ts (lista)      →      GET /clients/:id/menu     →     SELECT business_profile
  carga menu+menu_categorias         (mismo par que ya existe        ->'menu',
  al montar                          para GET/PATCH                 business_profile
                                      /clients/:id/resenas)          ->'menu_categorias'

cliente-menu-detalle.ts      →      PATCH /clients/:id/menu   →     UPDATE clients
(recarga fresco al entrar;          valida con Zod                  SET business_profile =
identidad = posición en el          (menuItemSchema,                  coalesce(business_profile,
array recién cargado, no             menuCategoriaSchema,               '{}'::jsonb) ||
persistente — índice fuera           de "web-builder/contract")        jsonb_build_object(
de rango: "plato no encontrado")                                        'menu', $1,
                                                                          'menu_categorias', $2)
                                                                    bajo RLS (client_write,
                                                                     igual que PATCH /clients/:id)
```

El sitio público (`renderer`) no cambia: ya lee `business_profile_publico` (la columna generada por
`app.nap_publico()`, migración `0023`) y ya sabe dibujar todos los campos del menú enriquecido. Esta
etapa es puramente el **camino de lectura+escritura** que faltaba para el portal.

### Por qué hace falta un `GET /clients/:id/menu` nuevo, y por qué no alcanza con `GET /clients/:id`

El `GET /clients/:id` que ya existe devuelve `ClienteCRM` (`db/src/clientes.ts:146-156`,
`CLIENTE_CRM_COLS`), la misma proyección de columnas que usa `listarClientes` para la tabla del CRM
— termina en `created_at` y no incluye `business_profile`. Ensancharla para meter la carta ahí
significaría que CADA fila de la lista de clientes cargue su JSONB de perfil entero, algo que esa
pantalla no necesita y que puede ser pesado con carteras grandes. Por eso el menú tiene su propio
GET, igual que ya tienen su propio par `GET/PATCH /clients/:id/resenas` — no una ampliación del
endpoint genérico de cliente.

### Por qué la identidad de un plato es su posición, no un id persistente

`MenuItem` (`web-builder/src/contract.ts:148-177`) no tiene campo `id`, y agregarle uno ampliaría
las cuatro fronteras (Zod, allowlist de Postgres, `perfilValido`, render) solo para una necesidad de
edición del portal, sin que el render lo use para nada. Se decide acá, no en el plan: la identidad
de un plato dentro de `cliente-menu-detalle.ts` es su **posición en la copia del array que la
pantalla acaba de cargar** — nunca un índice guardado de una visita anterior. `cliente-menu-detalle.ts`
vuelve a pedir `GET /clients/:id/menu` al entrar (no reutiliza un array en memoria de la pantalla de
lista), así que el índice siempre refleja el estado del servidor al momento de abrir el plato. Un
índice fuera de rango (alguien entra por URL directa a `/clientes/:id/menu/99` sin que exista ese
plato) muestra "Plato no encontrado" con un link de vuelta a la lista — mismo criterio de degradar
sin romper que ya usa el resto del portal.

### Por qué el PATCH reemplaza el array entero, y toca solo dos claves del JSONB

`business_profile` es un blob JSONB único (no una tabla propia, a diferencia de `ideas` o
`resenas_google`). El store arma la actualización con `jsonb_build_object('menu', ..., 'menu_categorias', ...)`
y la mergea con `||` — **nunca** pasa el perfil entero por `parseProfile()` y lo reescribe completo,
porque `parseProfile()` puede normalizar o exigir campos (`name` obligatorio, por ejemplo) que no
tienen nada que ver con esta escritura, y un bug ahí podría pisar `brand`, `fotos` o cualquier otro
campo del perfil sin que el formulario del menú tuviera forma de saberlo. Reemplazar el array entero
(no parchear por ítem) evita la ambigüedad de "qué pasa si mando un ítem con índice fuera de rango":
el cliente (Angular) manda su copia completa del array tras cada alta/edición/borrado, y el servidor
la valida y la persiste tal cual.

**`business_profile` puede ser SQL `NULL`.** `db/migrations/0006_cliente_publicacion.sql` agrega la
columna sin `NOT NULL` ni default, y un cliente recién creado (`POST /clients`, sin perfil todavía)
la tiene así. El operador `||` de jsonb, como cualquier operador de Postgres, devuelve `NULL` cuando
un operando es `NULL` — así que `business_profile || jsonb_build_object(...)` sobre un perfil vacío
escribiría `NULL`, el `UPDATE` afectaría la fila y devolvería éxito, y el menú **no quedaría
guardado**, sin que nada lo avise. El store normaliza esto explícitamente:
`coalesce(business_profile, '{}'::jsonb) || jsonb_build_object(...)`. Un test de esta etapa crea un
cliente nuevo (perfil `NULL` por default) y confirma que guardar un menú sobre él funciona.

### Reutilización de Zod: nuevos exports de `web-builder`

`web-builder/src/contract.ts` hoy exporta solo `parseProfile()` (valida el perfil entero) y un
puñado de constantes (`MAX_FOTOS`, `MAX_PRECIOS`, `MAX_CATEGORIAS`, ...) que ya necesita una frontera
de afuera (el render). Esta etapa exporta, con el mismo criterio, dos piezas más que hoy son `const`
internos:

- `menuItemSchema` — el schema Zod de un plato, con `alergenoSchema`/`etiquetaDieteticaSchema` ya
  encadenados adentro.
- `menuCategoriaSchema` — el schema Zod de una categoría.
- `MAX_ITEMS_CARTA` — el tope de platos por carta (hoy interno, usado por `businessProfileSchema`).

`api` agrega `web-builder` como dependencia (mismo patrón que ya usa `renderer` para `renderMenu`/
`renderStory`; no hay ciclo, porque `web-builder` no depende ni de `api` ni de `db`). La API valida
`z.array(menuItemSchema).max(MAX_ITEMS_CARTA)` y `z.array(menuCategoriaSchema).max(MAX_CATEGORIAS)`
contra el body del PATCH, antes de tocar la base — así la taxonomía de 14 alérgenos y 7 etiquetas
tiene una sola fuente entre el render y la escritura, en vez de una copia que se puede desincronizar
(la razón por la que `types.ts` ya advierte contra taxonomías sueltas en más de un lugar).

**Pero no importa desde la raíz del paquete.** `web-builder/src/index.ts` reexporta bastante más que
el contrato: `publish/publisher.js`, `llm/content.js` y `config.js`, y el `package.json` del paquete
depende de `dotenv` y `openai`. Como el monorepo corre sin paso de build (`tsx`, ESM sin bundler), un
`import ... from "web-builder"` evalúa TODO ese grafo al arrancar — `api` terminaría cargando el SDK
de OpenAI y la configuración de publicación de Storyblok solo para validar un array. El paquete ya
tiene el patrón para evitarlo: `web-builder/package.json` declara los subpaths `"./fixtures"` y
`"./fuentes"` además de `"."`. Esta etapa agrega un tercero, `"./contract"`, apuntando directo a
`src/contract.ts` — que solo importa `zod` y `contrato` (liviano; lo pesado lo arrastran las OTRAS
exportaciones de `index.ts`, no `contract.ts`). `api` importa
`from "web-builder/contract"`, nunca desde `"web-builder"` a secas.

## Componentes

### API (`api/src/app.ts`)

`GET /clients/:id/menu`

- 200 `{ menu: MenuItem[], menu_categorias: MenuCategoria[] }` — arrays vacíos si el perfil no tiene
  carta todavía (nunca `null`).
- 404 si el cliente no existe o no es visible para quien pregunta.

`PATCH /clients/:id/menu`

- Body: `{ menu: MenuItem[], menu_categorias: MenuCategoria[] }` — **las dos claves obligatorias**,
  nunca opcionales: el portal manda siempre su copia completa de ambos arrays (`[]` si no hay
  categorías), mismo criterio de "reemplaza el array entero" para las dos, no solo para `menu`. Una
  clave ausente es 400, no "se conserva lo que había".
- 400 si el body no es un objeto, o si `menu`/`menu_categorias` no pasan el Zod. La respuesta es
  `{ error: string, campos: [{ ruta: string, mensaje: string }] }`, con `campos` derivado de
  `error.issues` de Zod (`ruta` tipo `"menu.0.name"`, `"menu_categorias.1.nombre"`) — así el
  formulario señala el plato/campo exacto sin tener que parsear un mensaje suelto. Los mensajes de
  `mensaje` son los que devuelve Zod por default (**en inglés** para los campos que no tienen un
  `.refine`/segundo argumento con texto propio, como `menuItemSchema.name` — no se traduce en esta
  etapa: son mensajes de un schema compartido con el render, y traducirlos es un cambio aparte que
  toca más que este flujo). Lo que importa para la UI es `ruta`, no el texto.
- 404 si el cliente no existe o no es visible para quien pregunta (mismo criterio que
  `PATCH /clients/:id`: no distingue "no existe" de "no autorizado").
- 200 `{ ok: true }` si se guardó.

### Store (`db/src/store.ts` o un módulo nuevo `db/src/menu.ts`, a decidir en el plan)

Dos métodos:

- `obtenerMenu(ctx, clientId)` → `{ menu, menu_categorias }`, leyendo `business_profile->'menu'` y
  `business_profile->'menu_categorias'` con default `[]` si son `null`/ausentes.
- `actualizarMenu(ctx, clientId, { menu, menu_categorias })` — corre
  `UPDATE clients SET business_profile = coalesce(business_profile, '{}'::jsonb) ||
  jsonb_build_object('menu', $1::jsonb, 'menu_categorias', $2::jsonb) WHERE id = $3` dentro de una
  `Tx` con el contexto de tenant/rol ya fijado (ADR-13). Bajo la política `client_write` existente —
  no hace falta ninguna política nueva, porque el alcance de esta etapa dejó `cliente` fuera.

### Portal (`portal/src/app/pages/clientes/`)

- `TABS_FICHA` (`cliente-ficha.ts`) gana un quinto tab: `{ etiqueta: 'Menú', ruta: 'menu' }`.
- `cliente-menu.ts` — `/clientes/:id/menu`: pide `GET /clients/:id/menu` al montar. Lista de
  categorías (con su nombre/foto/orden, editables inline o en un mini-form) y, debajo de cada una,
  sus platos. "Agregar categoría", "Agregar plato", "Editar"/"Borrar" por fila.
  - **Borrar una categoría con platos asignados queda bloqueado.** Si `menu` tiene algún ítem con
    `category` igual al nombre de la categoría a borrar, el botón de borrar se deshabilita con un
    mensaje ("Reasigná o borrá primero los N platos de esta categoría") en vez de dejar platos con
    una `category` que ya no aparece en `menu_categorias`. Una categoría sin platos se borra libre.
    Es una decisión de UX de esta etapa, no algo que el render exija: el render ya tolera un plato
    con `category` sin declarar (lo agrupa igual, sin foto de categoría) — el bloqueo es para que la
    agencia no pierda de vista un plato sin querer, no porque el sitio público se rompa.
- `cliente-menu-detalle.ts` — `/clientes/:id/menu/:index`, donde `:index` es la posición en el array
  que esta pantalla vuelve a cargar (`GET /clients/:id/menu` de nuevo, no reutiliza el array de la
  lista — ver "Por qué la identidad de un plato es su posición" arriba). El formulario completo de
  UN plato:
  - nombre, descripción, categoría (select de las categorías existentes);
  - precios (`FormArray`-like manual, hasta 3, cada uno con etiqueta/importe/comensales);
  - nota;
  - `foto.src` (URL);
  - `video.src`, `video.poster.src` y `video.poster.alt` (URLs) — **las tres**, no un campo "video"
    genérico: sin `poster` el render descarta el `<video>` entero en silencio
    (`web-builder/src/render/lib.ts:375`), así que el formulario lo pide de entrada, con una nota
    visible ("sin imagen de portada, el video no se va a mostrar") en vez de dejar que alguien
    guarde un plato con video que nunca aparece;
  - checkboxes de alérgenos (14) y etiquetas dietéticas (7);
  - los cuatro campos numéricos de nutrición.

  Mismo patrón de `Vigencia` que `cliente-idea-detalle.ts` para que cambiar de plato o de cliente en
  pleno vuelo no pise la pantalla con datos de otro. Índice fuera de rango → "Plato no encontrado" +
  link a la lista, sin excepción sin manejar.
- Guardar en el detalle actualiza el array completo en memoria (recargado al entrar, ver arriba) y
  manda el PATCH con los dos arrays completos — coherente con "reemplaza el array entero" de arriba.

## Manejo de errores

- **Validación del servidor rechaza el body:** el formulario usa `campos` de la respuesta 400 (ver
  la forma exacta en `PATCH /clients/:id/menu`, arriba) para resaltar el plato/campo que falló por
  `ruta`, sin depender del texto de `mensaje` (que hoy es el default de Zod, en inglés para varios
  campos). No se duplica la validación del lado del cliente más allá de lo que HTML5 ofrece gratis
  (`required`, `type="number"`); la fuente de verdad es siempre el Zod del servidor.
- **Dos ediciones simultáneas (dos personas de la agencia guardando a la vez):** como el PATCH
  reemplaza el array entero, la segunda escritura pisa a la primera sin aviso (last-write-wins). Es
  una decisión explícita para esta etapa, no un descuido: el volumen de uso (una agencia chica,
  edición ocasional) no justifica optimistic locking (`updated_at`/ETag) todavía. Si se vuelve un
  problema real, es una mejora acotada sobre la misma API.
- **Cache del sitio público:** ver la nota de arriba — hasta 5 minutos de latencia entre guardar y
  verlo en `/menu`, mismo comportamiento que ya tiene cualquier escritura de `business_profile` hoy.

## Testing

- `web-builder`: los exports nuevos (`menuItemSchema`, `menuCategoriaSchema`, `MAX_ITEMS_CARTA`, y el
  subpath `"./contract"`) no cambian comportamiento. En vez de un test de identidad de objeto
  (`menuItemSchema`/`businessProfileSchema` son `const` internos — no hay forma pública de probar que
  son "el mismo objeto" sin exponer internals de Zod), un test de **equivalencia de casos límite**:
  el mismo set de platos válidos/inválidos (0 y 15 alérgenos, precio sin `importe`, `nombre` vacío,
  video sin `poster`) tiene que dar el mismo resultado de aceptar/rechazar en `menuItemSchema`
  exportado, en `parseProfile()` sobre un perfil que lo contiene, y en el 400/200 del endpoint. Si
  alguien cambia `menuItemSchema` sin tocar los otros dos, ese test es el que cae.
- `api`: validación (ítem válido/inválido, tope de alérgenos/etiquetas, `menu`/`menu_categorias`
  ausentes → 400, forma exacta del 400 con `campos`), `GET` con carta vacía → `{ menu: [], menu_categorias: [] }`
  (nunca `null`), 404 de cliente inexistente/no visible en el GET y en el PATCH, y aislamiento RLS —
  un `equipo`/`maestro` de otro tenant no puede leer ni escribir el menú de este cliente (mismo
  mecanismo de test que ya cubre `client_write`).
- `db`: el método de store, contra PGlite — (1) confirma que el `UPDATE` toca solo `menu`/
  `menu_categorias` y no pisa el resto de `business_profile` (guardar un perfil con `brand` y `fotos`,
  actualizar el menú, confirmar que `brand`/`fotos` siguen intactos); (2) un cliente recién creado
  (`business_profile IS NULL`) guarda un menú correctamente — el test que fija el `coalesce`.
- `portal`: `cliente-menu.spec.ts` (listar desde el `GET`, agregar categoría/plato, borrar una
  categoría sin platos, intentar borrar una con platos y confirmar que queda bloqueado) y
  `cliente-menu-detalle.spec.ts` (cargar un plato existente, editar cada tipo de campo incluidos
  `video.poster.src`/`alt`, guardar, manejo del error 400 con `campos`, índice fuera de rango →
  "Plato no encontrado") — mismo patrón que `cliente-idea-detalle.spec.ts`.
- Navegador: crear una categoría y un plato con todos los campos —incluido el poster del video—
  desde el portal, confirmar que el PATCH se guardó (recargar la ficha), y —esperando el TTL o
  reiniciando el `dev-server`— que aparece en `/menu` del sitio público con badges/nutrición/video
  como cualquier plato sembrado, con el `<video>` efectivamente presente en el HTML (no solo la
  `<img>` de respaldo).

## Documentación a actualizar al cerrar

- `docs/proyecto/09-estado-y-roadmap.md` y `15-plan-plataforma.md` (bloque E, ítem 3 — ya no dice
  "sin editor en el portal").
- Una entrada nueva en `docs/decisiones-arquitectura.md` anotando, junto a OBS-04/ADR-20, que la
  excepción de `cliente` quedó evaluada y diferida a propósito (no es un olvido): el mecanismo
  (trigger `BEFORE UPDATE` comparando OLD/NEW) está descrito arriba, para cuando se retome.
