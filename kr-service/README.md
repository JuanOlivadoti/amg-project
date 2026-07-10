# kr-service — Módulo 2 (Keyword Research)

Esqueleto del pipeline **prompt de negocio → brief SEO estructurado**, para el spike de Fase 0.
Corre por CLI contra el **sandbox** de DataForSEO (datos ficticios, sin costo) y valida la salida con Zod.

## Requisitos
- Node ≥ 20 (probado con 24). Ya viene con `fetch` nativo.

## Setup
```bash
cd kr-service
npm install
# opcional: cp .env.example .env   (funciona sin .env, en modo mock)
```

Variables (`.env`, todas opcionales para empezar):
- `DATAFORSEO_MODE` — **`mock`** (default: datos ficticios locales, sin cuenta) o `live` (API real).
- `DATAFORSEO_BASE_URL` — solo para `live`: sandbox o `https://api.dataforseo.com`.
- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — solo para `live` (ver `../guia-dataforseo.md`).
- `ANTHROPIC_API_KEY` — opcional; sin ella, los seeds usan un fallback heurístico.

### Modo mock (default) vs live
El pipeline habla con un **`KeywordDataProvider`** (interfaz), no con DataForSEO directo:
- **`mock`** → `MockProvider`: volúmenes/KD/tendencias ficticios pero **deterministas y realistas**, con costo simulado. Permite desarrollar y testear todo el pipeline **sin abrir la cuenta**.
- **`live`** → `LiveProvider`: pega contra la API real (sandbox o producción).

Cambiar de uno a otro es solo `DATAFORSEO_MODE=live` en el `.env`. Cero cambios de código.

## Correr el spike
```bash
npm run spike                       # usa el caso por defecto (restaurante Madrid)
npm run spike "Clínica dental en Valencia. Servicios: implantes, ortodoncia."
```
Salida en `out/`:
- `brief.json` — el brief estructurado (validado contra el esquema v0.2).
- `informe.md` — el informe legible (entregable de la compuerta humana).

Verificar tipos: `npm run typecheck`

## Qué está implementado vs pendiente
| Paso | Estado |
|---|---|
| Provider DataForSEO mock/live intercambiable (sin cuenta) | ✅ |
| Provider LLM mock/openai/anthropic (generación + embeddings) | ✅ |
| Generación de seeds | ✅ |
| Expansión (keyword_suggestions) | ✅ |
| Enriquecimiento (search_volume + bulk KD) | ✅ |
| Scoring (fórmula + confidence + gate de relevancia) | ✅ |
| `business_relevance` por LLM (activa el gate) | ✅ |
| **Clustering híbrido (semántico por embeddings + SERP-overlap)** | ✅ |
| Mapeo cluster → páginas | ✅ |
| Contenido on-page por LLM (meta, secciones, FAQs, claims) | ✅ |
| Ensamblado del brief + informe + validación Zod | ✅ |
| Clasificación de intención + page_type | ⚠️ heurística v0 (TODO: LLM + señales SERP) |
| Compuerta humana / persistencia / Inngest | ⛔ Fase 2-3 |

### Proveedores (todo mock por default, sin keys)
| Capa | mock | real |
|---|---|---|
| Datos SEO | `MockProvider` | `LiveProvider` (DataForSEO) · `DATAFORSEO_MODE=live` |
| Generación LLM | `MockTextGen` | OpenAI / Anthropic · `LLM_PROVIDER` o autodetección por key |
| Embeddings | `MockEmbedder` (BoW) | OpenAI `text-embedding-3-small` · con `OPENAI_API_KEY` |

Los `TODO` en el código marcan dónde entra la lógica real. Este esqueleto valida el **flujo end-to-end** y el **contrato de datos**, no la calidad SEO final (para eso es el spike con datos reales).
