# web-builder — Módulo 1 (Creador de Webs)

PoC del **handoff Módulo 2 → Módulo 1**: toma el `brief.json` del keyword research y genera
la web como **stories de Storyblok** + un **preview HTML** (AI-search-first: HTML semántico + JSON-LD).

Mismo patrón que `kr-service`: publisher **abstracto**, `mock` por default, `storyblok` (live)
gateado por credenciales. Pasar a PROD es una variable de entorno, cero cambios de código.

## Requisitos
- Node ≥ 20. Sin dependencias runtime más allá de `dotenv` (Storyblok se llama por `fetch` nativo).

## Setup
```bash
cd web-builder
npm install
# opcional: cp .env.example .env
```

## Correr la PoC
```bash
# 1) Generá primero el brief en el M2:
#    (desde ../kr-service)  npm run spike
# 2) Generá la web desde ese brief:
npm run build:web
# o con una ruta explícita:
npm run build:web ../kr-service/out/brief.json
```

Salida en `out/`:
- `stories/<slug>.json` — la story en el formato de la Management API de Storyblok.
- `preview/<slug>.html` — la página renderizada (semántica + JSON-LD).
- `preview/index.html` — índice navegable de todas las páginas (para mostrar al cliente).

Verificar tipos: `npm run typecheck`

## Modos de publicación
| Modo | Qué hace | Requiere |
|---|---|---|
| `mock` (default) | Escribe stories + preview HTML en `out/` | nada |
| `storyblok` | Crea/actualiza las stories vía Management API | `STORYBLOK_MANAGEMENT_TOKEN` + `STORYBLOK_SPACE_ID` |
| `storyblok` + dry-run | Escribe en `out/storyblok/` el payload EXACTO que se enviaría, sin llamar a la API | nada |

Cambiar es solo `WEB_PUBLISH_MODE=storyblok` en el `.env`. Si faltan las credenciales (o con
`STORYBLOK_DRY_RUN=1`), el modo `storyblok` cae a **dry-run**: podés inspeccionar el formato
Storyblok-nativo (con `_uid` y FAQ como bloks `faq_item`) sin tener cuenta.

## Probar contra Storyblok real (Nivel 2)
1. Crear cuenta gratis en storyblok.com → crear un **Space**.
2. Copiar el **Management API token** (Settings → Access Tokens → *Management API*) y el **Space ID**.
3. Cargarlos en `.env` (`STORYBLOK_MANAGEMENT_TOKEN`, `STORYBLOK_SPACE_ID`, `STORYBLOK_REGION`).
4. **Provisionar los componentes** (one-time):
   ```bash
   npm run setup:storyblok          # crea page/hero/section/faq/faq_item en el space
   npm run setup:storyblok -- --dry-run   # o inspeccioná los esquemas sin tocar el space
   ```
5. Publicar: `WEB_PUBLISH_MODE=storyblok npm run build:web` → las páginas aparecen en el space,
   editables en el **Visual Editor** (el argumento de venta: editar sin devs, ADR-04).

## Arquitectura
```
brief.json (M2)
   │  handoff/adapter.ts   (ProposedPage → Story · el "contrato de bloks")
   ▼
Story[] (contrato Storyblok: page > hero/section/faq + SEO + schema_type)
   ├─ render/html.ts   → preview HTML semántico + JSON-LD (@graph con FAQPage)
   └─ publish/*        → MockPublisher (out/) | StoryblokPublisher (Management API)
```

- **Compuerta de aprobación (ADR-06):** el CLI no publica en Storyblok un brief `pending_approval`
  o `rejected`. En PROD esto es un `waitForEvent` de Inngest; acá, un check del `status` del brief.
- **ADR-04 (AI-search-first):** cada página emite JSON-LD por `schema_type` (LocalBusiness/Article/
  WebPage) + `FAQPage` cuando hay FAQs. El preview refleja el mismo contrato que renderizará Next.js.
- **ADR-11 (offboarding):** un space por cliente; el preview HTML es la base del snapshot estático.

## Qué está implementado vs pendiente
| Pieza | Estado |
|---|---|
| Contrato de bloks Storyblok (page/hero/section/faq + SEO) | ✅ |
| Adaptador de handoff brief → stories | ✅ |
| Render HTML semántico + JSON-LD | ✅ |
| Perfil de negocio (NAP) → JSON-LD LocalBusiness completo + sección contacto | ✅ |
| **Prose final por LLM** (`section.body` + respuestas de FAQ) | ✅ openai/mock |
| Publisher mock (out/) | ✅ |
| Publisher Storyblok live (Management API, env-gated) + dry-run | ✅ código · ⛔ sin probar contra space real |
| Shaping a formato Storyblok-nativo (`_uid`, `faq_item` bloks) | ✅ |
| `_uid` **deterministas** + publicación **idempotente** (sin duplicados ante carreras) | ✅ |
| Resiliencia HTTP (timeout, retries con backoff, `Retry-After`) | ✅ |
| Provisioning de componentes del space (`setup:storyblok`) | ✅ código · ⛔ sin probar contra space real |
| Compuerta de aprobación: `status` del brief **+ `page.approved` por página** | ✅ |
| Validación del contrato de entrada con Zod (rechaza `schema_version` no soportada) | ✅ |
| Orquestación Inngest + persistencia | ⛔ Fase 2-3 |

## Perfil de negocio (NAP)
Los datos reales del negocio (teléfono, dirección, precio, imagen) NO vienen del research: los
aporta el cliente en `business-profile.json` (ver ejemplo en la raíz del módulo). Enriquecen el
JSON-LD `LocalBusiness` (cierra los warnings opcionales de Google) y agregan la sección de contacto.
En PROD es un datasource global del space de Storyblok. Si el archivo no existe, el pipeline sigue
sin él (JSON-LD básico).
