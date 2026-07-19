# 5. Módulo 1 — Creador de Webs (`web-builder`)

## Qué hace

Toma el **brief SEO** que produjo el Módulo 2 y genera la **web**: cada página propuesta se
convierte en contenido estructurado publicable en Storyblok, con el texto ya redactado y los
datos estructurados (JSON-LD) listos para Google y para los buscadores con IA.

**Entrada:** `../kr-service/out/brief.json` (+ opcionalmente `business-profile.json`)
**Salida:** stories de Storyblok + preview HTML navegable.

## Cómo correrlo

```bash
cd web-builder
npm install
npm run build:web                                # usa el brief del M2 por defecto
npm run build:web ../kr-service/out/brief.json   # o una ruta explícita
npm run typecheck
npm test
```

Salida en `out/`:
- `preview/index.html` — índice navegable (esto es lo que se le muestra al cliente).
- `preview/<slug>.html` — la página renderizada.
- `stories/<slug>.json` — el modelo **canónico** de la story (para debug).
- `storyblok/<slug>.json` — solo en modo `storyblok`: el payload **exacto** que se enviaría a la API.

---

## El pipeline, paso a paso

Orquestado en `src/cli/build.ts`:

### 1. Carga y validación del contrato
`contract.ts` → `parseBrief()`

El brief es una **frontera externa**: puede venir editado por un humano, de otra versión del
pipeline, o corrupto. Antes de usarlo se valida **con Zod** y se rechaza si:
- no cumple la forma esperada (mensaje con los campos concretos que fallan), o
- su `schema_version` no está en `SUPPORTED_SCHEMA_VERSIONS` (hoy: `kr.v0.2`).

### 2. Compuerta de aprobación humana (ADR-06)

**Para publicar EN VIVO se exigen DOS condiciones simultáneas:**

| Condición | Motivo |
|---|---|
| `brief.status === "approved"` | El brief completo fue revisado. |
| `page.approved === true` (por página) | **Cada página** fue aprobada individualmente. |

Las páginas **no aprobadas se omiten** (con aviso). Si el brief está aprobado pero ninguna página
lo está, aborta.

> Sin la aprobación por página, cambiar solo el `status` global publicaría páginas que el revisor
> nunca miró o rechazó explícitamente. La doble condición cierra ese agujero.

Un brief `rejected` aborta siempre. El **preview (mock) y el dry-run se permiten siempre** — no
publican nada real, y su función es justamente permitir la revisión.

> En producción esto será un `waitForEvent` de Inngest ([ADR-03](../decisiones-arquitectura.md));
> hoy es un check del `status` del brief.

### 3. Handoff adapter: brief → story
`handoff/adapter.ts` → `briefToStories()`

**Es el "contrato de bloks"** que conecta ambos módulos. Cada `ProposedPage` se convierte en una
`Story` con esta estructura:

```
page                          ← blok raíz
├── seo { title, description, canonical, og_title, og_description }
├── schema_type, page_type, intent, is_local
├── body
│   ├── hero      { headline, subhead, cta_label }
│   ├── section   { heading, body }     ← una por sección sugerida
│   ├── section   { ... }
│   └── faq       { items: [{ question, answer }] }
└── meta          ← trazabilidad al research (no se renderiza)
    { source_keyword, secondary_keywords, internal_links, word_count_objetivo,
      tono, claims_permitidos, claims_prohibidos, opportunity_score, volumen, dificultad }
```

El adaptador es **puro y determinista** (sin efectos secundarios) → fácil de testear.
En esta etapa, los `section.body` y las respuestas de FAQ están **vacíos**: solo hay estructura.

### 4. Perfil de negocio (opcional)
`enrich.ts` → `loadProfile()` · fichero `business-profile.json`

Los datos reales del negocio (**NAP**: nombre, dirección, teléfono, rango de precio, imagen,
horario) **no vienen del research** — el research no los conoce. Los aporta el cliente:

```json
{
  "name": "Trattoria Bella Napoli",
  "telephone": "+34 911 23 45 67",
  "priceRange": "€€",
  "url": "https://trattoriabellanapoli.es",
  "address": { "streetAddress": "Calle Mayor 12", "addressLocality": "Madrid", "postalCode": "28013" },
  "opening_hours": "Lun-Dom 13:00-16:00 y 20:00-23:30"
}
```

Sirven para dos cosas: completar el JSON-LD de `LocalBusiness` (sin ellos Google marca warnings
de campos faltantes) y renderizar la sección de contacto.

**Es opcional**, pero si el archivo existe y está corrupto, **se lanza un error** — un fallo
operativo no debe disfrazarse de "sin perfil" y terminar publicando un `LocalBusiness` incompleto.

> En producción esto será un *datasource* global del space de Storyblok, no un JSON local.

### 5. Prose final (LLM)
`enrich.ts` → `applyProse()` → `ProseGen.fillPage()`

**Una llamada por página** rellena todos los `section.body` y las respuestas de las FAQs.
Al LLM se le pasa el contexto del negocio, el perfil (nombre, dirección, horario) y —clave— el
**contrato editorial del brief**: el tono, los `claims_permitidos` y los `claims_prohibidos`.

Resiliencia (`reconcile`): si el LLM devuelve JSON estructuralmente parcial (por ejemplo
`sections` como string, o un item sin `heading`), **se descartan los elementos inválidos uno a
uno** y esos quedan con texto de fallback. Nunca crashea ni deja la página vacía.

### 6. Render: HTML semántico + JSON-LD
`render/html.ts` → `renderStory()`

Genera una página **autocontenida** (CSS inline, sin dependencias). Es **el único renderizador que
existe**: ADR-16 quitó Next.js del stack, así que este `renderStory()` dejó de ser "un preview de lo
que hará Next" y pasó a ser el render de verdad. Quién lo **sirve en un dominio** ya existe: **un servicio propio en runtime**
([ADR-19](../decisiones-arquitectura.md), cierra OBS-03), construido en `renderer/` (etapa 6). O sea
que esta misma función corre **dos veces**: acá para generar el preview, y en el renderizador para
servir cada visita. Es la razón por la que la etapa 6 fue más chica de lo que parecía.

**AI-search-first** ([ADR-04](../decisiones-arquitectura.md)):
- HTML semántico (`<main>`, `<header>`, `<section>`, `<h1>/<h2>`, `<details>` para FAQs).
- **JSON-LD con `@graph`**: la entidad primaria según `schema_type`
  (`LocalBusiness` / `Article` / `WebPage`) **más un `FAQPage`** cuando hay FAQs.
- Con perfil, el `LocalBusiness` incluye `telephone`, `priceRange`, `image` y `address`
  (`PostalAddress`) → cierra los warnings del validador de Google.
- `<html lang>` sale del `market.language_code` del brief.
- Trazabilidad al research en un `<script type="application/json" id="research-trace">`.

**Canonical — una sola fuente de verdad:** se usa **el canonical del brief** (una ruta), resuelto
contra el dominio del perfil si existe. No se re-deriva del slug. Si el canonical ya es absoluto,
se respeta tal cual.

**Seguridad:** todo el JSON incrustado en `<script>` pasa por `safeJson()`, que escapa `<`, `>` y
`&`. `JSON.stringify` **no** escapa `</script>`, así que un título malicioso podría cerrar la
etiqueta e inyectar código. El escapado lo neutraliza (hay un test que lo verifica).

### 7. Publicación
`publish/publisher.ts` → `getPublisher()`

Tres implementaciones, elegidas por configuración:

| Modo | Qué hace | Requiere |
|---|---|---|
| **`mock`** (default) | Escribe stories + preview HTML en `out/`. | nada |
| **`storyblok`** | Crea/actualiza las stories vía Management API. | token + Space ID |
| **`storyblok` + dry-run** | Escribe el payload **exacto** que se enviaría, sin llamar a la API. | nada |

El dry-run se activa con `STORYBLOK_DRY_RUN=1` **o automáticamente si faltan las credenciales**.
Permite inspeccionar el formato Storyblok-nativo sin tener cuenta.

---

## La capa Storyblok

### Shaping nativo
`storyblok/content.ts` → `toStoryblokContent()`

Traduce el contenido canónico al formato que Storyblok exige. **Toda la "storyblok-idad" vive
solo acá**:
- añade `_uid` (UUID) a cada blok — el Visual Editor lo requiere;
- **aplana** el objeto `seo` a campos `seo_title` / `seo_description` / `seo_canonical` / `og_*`;
- convierte los items de FAQ en **bloks anidados `faq_item`**;
- preserva el contrato editorial (`claims_*`, `internal_links`) y la traza (`source_keyword`).

### Provisioning de componentes
`storyblok/components.ts` + `cli/setup-storyblok.ts`

Para que el Visual Editor sepa renderizar y editar las páginas, el space necesita los componentes
definidos. Es un **setup one-time por space**:

```bash
npm run setup:storyblok             # crea/actualiza page, hero, section, faq, faq_item
npm run setup:storyblok -- --dry-run  # inspecciona los esquemas sin tocar el space
```

Es **idempotente**: si el componente existe, lo actualiza; si no, lo crea.

### Para probar contra Storyblok real
1. Cuenta gratis en storyblok.com → crear un **Space**.
2. Copiar el **Management API token** y el **Space ID** al `.env`.
3. `npm run setup:storyblok` (provisiona los componentes).
4. `WEB_PUBLISH_MODE=storyblok npm run build:web` → las páginas aparecen editables en el Visual Editor.

> ⚠️ El camino live está **implementado y con typecheck, pero nunca probado contra un space real**.

---

## Estado

| Pieza | Estado |
|---|---|
| Validación del contrato de entrada (Zod) | ✅ |
| Compuerta de aprobación global + por página | ✅ |
| Handoff adapter (contrato de bloks) | ✅ |
| Prose por LLM (con fallback y resiliencia a respuestas parciales) | ✅ |
| Perfil de negocio → JSON-LD `LocalBusiness` completo | ✅ |
| Render HTML semántico + JSON-LD `@graph` | ✅ |
| Publisher mock + dry-run | ✅ |
| **`_uid` deterministas** (republicar produce los mismos uids) | ✅ |
| **Publicación idempotente** (la carrera de creación actualiza en vez de duplicar) | ✅ |
| **Resiliencia HTTP** (timeout, retries con backoff, `Retry-After`) | ✅ |
| Publisher Storyblok live + provisioning de componentes | ✅ código · ⛔ **sin probar contra space real** ([acción C](10-acciones-pendientes.md)) |
| Enlazado interno entre páginas | ⛔ el M2 aún no lo genera |
| **Servir la web del cliente en un dominio** | ✅ **Construido** — `renderer/` (ADR-19), que reutiliza este mismo `renderStory()`. **Falta desplegarlo**: hoy corre en `localhost`. |
