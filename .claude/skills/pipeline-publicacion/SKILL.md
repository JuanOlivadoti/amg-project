---
name: pipeline-publicacion
description: Usar al tocar web-builder/ — el contrato M2→M1 validado con Zod, la generación de HTML y JSON-LD, el shaping a bloks de Storyblok, los `_uid` deterministas, el upsert idempotente y la Management API. Cubre por qué el space viaja como argumento y no por variable de entorno, y por qué "publicado" significa lo que confirma el proveedor.
---

# La publicación (M1) de AMG OS

`web-builder/` toma un **brief aprobado** y produce **páginas publicadas**: valida el contrato,
genera contenido y HTML, lo transforma al formato de Storyblok y lo publica por la **Management
API**.

Dos límites que no son negociables:

- **Storyblok son dos APIs que no se cruzan.** Acá se **escribe** por la Management API. El
  renderizador **lee** por la Content Delivery API. El proceso anónimo nunca toca una credencial que
  pueda modificar el space.
- **`render/html.ts` también lo importa el renderizador.** Lo que escribas ahí termina servido a
  internet anónimo. Es tuyo, pero no es solo tuyo — ver `render-seguridad` cuando exista.

Si el cambio puede costar dinero o tocar un servicio real, cargá también **`pipeline-gasto`**.

## El contrato M2→M1 es una frontera, no una llamada de función

[`contract.ts`](../../../web-builder/src/contract.ts) valida con **Zod** *antes* de generar o
publicar nada. El brief puede venir de otra versión del pipeline, de edición humana o de JSON
corrupto: **el M1 no confía en que el M2 le mande algo bien formado**, y el orquestador tampoco (lo
revalida al reconstruirlo desde la base).

`SUPPORTED_SCHEMA_VERSIONS` es una **allowlist**: una versión no listada se rechaza con un mensaje que
dice qué hacer. Al subir `SCHEMA_VERSION` en `kr-service/src/types.ts` hay que agregarla acá — es la
deuda del **esquema Zod duplicado**, dos fuentes de verdad del mismo contrato.

Y la trampa que ya mordió: **Zod descarta lo que no está en el esquema.** `evidencia` y
`score_confidence` existían en el M2 y **no estaban en el schema del M1**, así que se calculaban y se
tiraban a la basura al parsear. Son la señal de honestidad del research: sin ellas, quien aprueba la
web no puede saber que una página se apoya en cero datos de mercado. Si el M2 empieza a emitir un
campo nuevo, **agregalo al schema del M1 o se pierde en silencio**.

Los campos del **perfil de negocio** se validan como **defensa, no como cosmética**: `color` solo
hex, `font` como allowlist cerrada (`sistema | serif | moderna`), `logo` exigiendo `http(s)` — porque
`.url()` de Zod acepta `javascript:`, que tiene esquema. Terminan dentro de un `<style>` y de un
`<img src>`. Los topes (`MAX_LOCALES = 20`, `MAX_ITEMS_CARTA = 200`) tienen que coincidir en **tres
capas**: Zod acá, la migración `0010` de Postgres y el validador del renderizador. Cambiar uno es
cambiar los tres.

## El destino: el space es un ARGUMENTO

[`publish/publisher.ts`](../../../web-builder/src/publish/publisher.ts)

Antes el destino era `STORYBLOK_SPACE_ID`, **el mismo para todos los clientes**. Como los slugs de un
restaurante son siempre los mismos (`/menu`, `/contacto`…), publicar el research del cliente A
**sobrescribía las páginas del cliente B**:

1. B ya tiene `/menu` en el space global
2. A aprueba su propia `/menu`
3. `findStoryId("/menu")` encuentra la story de B
4. `updateStory()` la pisa con el contenido de A

El aislamiento entre tenants era impecable dentro de Postgres y se perdía **al salir por la puerta**.
Hoy el destino llega por constructor y lo resuelve el orquestador desde `clients.storyblok_space_id`
**bajo RLS** (ADR-04: un space por cliente).

**`null` y `undefined` NO son lo mismo**, y confundirlos era el cruce multi-tenant:

| Valor | Quién lo manda | Qué se hace |
|---|---|---|
| `undefined` | El CLI, que es monocliente: nadie preguntó por un cliente | Usa el space global de la config |
| `null` | El orquestador **sí** preguntó y el cliente **no tiene** space | **Dry-run.** Jamás el global |

Un `spaceId ?? config…` trata `null` como "no me pasaron nada" y cae al global — o sea, publica en el
space de otro cliente. **Sin `spaceId` no hay publisher live: es preferible detenerse.**

## "Publicado" es lo que confirma el proveedor, no lo que pedimos

`PublishResult.published` responde **"¿el proveedor confirma que lo está?"**, no **"¿lo mandamos?"**.

Existe porque la respuesta era que no: el publisher mandaba las stories **como draft** (le faltaba
`publish: 1`) y el orquestador escribía `published_at` igual. **La ejecución terminaba en `publicado`
y no había nada publicado** — la base afirmaba un hecho del mundo exterior que no había ocurrido, que
es la peor clase de mentira porque nadie la va a comprobar.

Dos consecuencias que hay que respetar al tocar esto:

- `leerStory()` lee `story.published === true` **de la respuesta**. Que hayamos mandado `publish: 1`
  no prueba nada.
- El **dry-run devuelve `published: false` a propósito**. Si dijera `true`, la base escribiría
  `published_at` para páginas que nunca salieron del disco.

## Idempotencia: upsert, no "consultar y después crear"

`upsertStory()` — "consultar y después crear" es una carrera: dos corridas concurrentes (o un
reintento del orquestador) pueden ver "no existe" a la vez y crear **dos stories con el mismo slug**.
Acá, si la creación choca (409/422), se re-resuelve el id y se actualiza. **Publicar dos veces
converge al mismo estado.** Si el 422 no era por slug duplicado, se relanza: no se traga un error
real.

**Los `_uid` son deterministas** ([`lib/uid.ts`](../../../web-builder/src/lib/uid.ts)): salen de
`sha1(slug + tipo de blok + su identificador natural)` con los bits de versión/variante de un UUID
v5. Con `randomUUID()`, cada publicación regeneraba **todos** los `_uid` aunque el contenido no
hubiera cambiado: Storyblok veía bloks nuevos, se perdía la identidad estable (historial, comentarios,
estado de plugins del editor) y los diffs eran ruido puro. **Mismo blok → mismo `_uid`.** Si cambia el
heading, es conceptualmente otro blok y le corresponde otro `_uid`.

## El shaping: ida y vuelta, y lo que se pierde en el camino

[`storyblok/content.ts`](../../../web-builder/src/storyblok/content.ts) — `toStoryblokContent()`
transforma el contenido canónico al formato de Storyblok: `_uid` en cada blok, el `seo` **aplanado** a
`seo_title`/`seo_description`, las FAQ como bloks `faq_item` anidados. Toda la "storyblok-idad" vive
ahí para que el contrato de bloks (`types.ts`) quede limpio.

**La vuelta existe y es igual de importante.** `fromStoryblokContent()` / `desShapeBlok()`
reconstruyen el contenido canónico desde lo guardado. Fue OBS-03: **nadie leía de vuelta lo
publicado**, el contenido quedaba aplanado y `renderStory` esperaba la forma anidada → **503**. Lo
cazó la demo, no un test. Si tocás la ida, **tocá la vuelta y su test de ida-y-vuelta**.

**Deuda conocida:** `desShapeBlok()` descarta `_editable`, y es de ahí de donde el Bridge del Visual
Editor saca el resaltado y el clic-para-editar. Hoy se edita desde el panel de campos. Pesa poco si
edita la agencia y bastante si el día de mañana edita el cliente.

## El HTML: todo lo que sale va escapado

[`render/html.ts`](../../../web-builder/src/render/html.ts) — HTML semántico + JSON-LD por tipo de
página, autocontenido (CSS inline, sin dependencias externas).

**Cualquier valor que termine en `<style>`, `<img src>` o el HTML es superficie de inyección.** Todo
interpolado pasa por `esc()`, sin excepciones ni "este viene de nuestra base". En producción el dato
puede venir de Storyblok **sin pasar por Zod**, y por eso el renderizador **revalida** — defensa en
profundidad, no redundancia.

Tres páginas se **sintetizan desde el perfil**, no desde una story ni desde el LLM: `home` (para que
la raíz no dé 404), `/menu` (una carta es una lista de producto con precio: no hay nada que
"redactar", y generarla por IA metería una fuente más de contenido que revisar en la compuerta) y
`/blog` (solo las `Article`). **Si el cliente crea su propia story con ese slug, esa gana.**

Un invariante con test: **ninguna página de tipo `blog` puede marcarse `local`.** `local` decide si la
página se declara `LocalBusiness` ante Google, y un artículo no es un negocio local.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| `spaceId ?? config.storyblok.spaceId` | `null` cae al space global: se pisan las páginas de otro cliente |
| Marcar `published: true` porque se mandó el request | La base afirma un hecho del mundo que no ocurrió |
| Agregar un campo al brief del M2 sin agregarlo al schema Zod del M1 | Zod lo descarta al parsear. Silencioso |
| Volver a `randomUUID()` para los `_uid` | Se pierde la identidad de los bloks en cada publicación |
| Tocar `toStoryblokContent` sin tocar la vuelta | Es OBS-03 otra vez: se publica bien y se sirve 503 |
| Interpolar un valor en el HTML sin `esc()` | Inyección. Y en prod el dato puede no haber pasado por Zod |
| Cambiar `MAX_LOCALES`/`MAX_ITEMS_CARTA` en un solo lado | Las tres capas dejan de coincidir |
| Usar la Management API desde el renderizador | Cruce de APIs: el proceso anónimo con credencial de escritura |

## Verificación

```bash
npm test -w web-builder    # mock publisher + dry-run: cero red, cero credenciales
npm run typecheck
```

Los tests del área: `contract.test.ts`, `publisher.test.ts`, `content.test.ts` (incluye ida-y-vuelta),
`html.test.ts`, `uid.test.ts`, `adapter.test.ts`, `llm/content.test.ts`.

⚠️ **`npm run demo -w renderer` pega contra el Storyblok REAL con credencial real.** No lo corras.
Para ver el payload exacto que se enviaría sin llamar a la API, está el **dry-run**
(`STORYBLOK_DRY_RUN=1`), que lo escribe en `out/storyblok/`.
