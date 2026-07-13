# 7. Configuración y entornos

## Principio: todo funciona sin credenciales

Ambos módulos corren **de punta a punta en modo mock**, sin una sola API key. Los mocks son
**deterministas y realistas** (no random), así que sirven para desarrollar, testear y demostrar
el flujo completo.

Las credenciales solo hacen falta para obtener **datos reales**.

---

## `kr-service` (Módulo 2)

Copiá `.env.example` a `.env` y completá lo que necesites. **Todas las variables son opcionales.**

| Variable | Valores | Default | Para qué |
|---|---|---|---|
| `DATAFORSEO_MODE` | `mock` \| `live` | `mock` | `mock` = datos ficticios locales, sin cuenta. `live` = API real. |
| `DATAFORSEO_BASE_URL` | URL | `https://sandbox.dataforseo.com` | Solo para `live`. **Sandbox** (gratis, ficticio) o `https://api.dataforseo.com` (real, con saldo). |
| `DATAFORSEO_LOGIN` | email | — | Login de la API (no el de la web). |
| `DATAFORSEO_PASSWORD` | string | — | **Password de API** del dashboard. |
| `LLM_PROVIDER` | `openai` \| `anthropic` \| `mock` | autodetecta | Explícito gana; si no, OpenAI si hay key, luego Anthropic, luego mock. |
| `OPENAI_API_KEY` | string | — | Generación **y embeddings** (necesarios para el clustering). |
| `OPENAI_MODEL` | string | `gpt-4o` | Modelo de generación. |
| `OPENAI_EMBEDDING_MODEL` | string | `text-embedding-3-small` | Multilingüe (requisito de ADR-08). |
| `ANTHROPIC_API_KEY` | string | — | Alternativa para generación. |
| `LLM_PRICES` | JSON | tarifas por defecto | Sobrescribe las tarifas de los modelos (USD por 1M de tokens) usadas para calcular el costo. Ej: `{"gpt-4o":{"input":2.5,"output":10}}` |

> ⚠️ **Las tarifas por defecto son APROXIMADAS.** Confirmalas contra la página de precios del
> proveedor antes de usar el costo en una propuesta comercial. Si un modelo no tiene tarifa, el
> costo **no se inventa**: el total se marca como incompleto (`modelos_sin_precio`).

### Presupuesto del run

`options.max_cost_micros` (por corrida, no por env) fija un **tope en micros de USD**. Antes de
cada fase se estima su costo y, si no entra en el remanente, **se aborta sin gastar**. Sin tope,
no bloquea nunca.

### Los tres modos de DataForSEO

| Modo | Datos | Costo | Cuándo |
|---|---|---|---|
| **mock** | Ficticios locales, deterministas | $0 | Desarrollo y tests. No necesita cuenta. |
| **live + sandbox** | Ficticios, devueltos por la API real | $0 | Validar que la integración y la autenticación funcionan. |
| **live + producción** | **Reales** | Prepago (mínimo histórico ~50 USD) | Medir volúmenes y costo real por research. |

**El PoC está hoy en `live + sandbox`.** La consecuencia importante: los volúmenes, la dificultad
y el número de clusters son **ficticios** (por eso sale 1 cluster / 1 página y coste $0). Todo lo
que depende de IA (seeds, intención, relevancia, clustering semántico, contenido) **sí es real**.

Pasar a producción es cambiar **una línea**: `DATAFORSEO_BASE_URL=https://api.dataforseo.com`.

> El alta de la cuenta está documentada paso a paso en [`../guia-dataforseo.md`](../guia-dataforseo.md).

### Cambiar de proveedor de LLM

Los **tres** proveedores (OpenAI, Anthropic, mock) implementan la **misma interfaz completa**:
seeds, intención, relevancia de negocio y contenido on-page. Cambiar `LLM_PROVIDER` **no degrada
capacidades**. Si el proveedor está configurado pero falta la key, se avisa fuerte antes de caer a
mock — nunca una degradación silenciosa.

> ⚠️ **Si usás Anthropic, cargá `LLM_PRICES` con las tarifas de Claude.** No vienen por defecto,
> así que el costo del run quedaría marcado como **incompleto** (el sistema no inventa tarifas).
>
> Nota: los **embeddings** (necesarios para el clustering) siempre van por OpenAI — Anthropic no
> tiene API de embeddings propia ([ADR-09](../decisiones-arquitectura.md)).

---

## `web-builder` (Módulo 1)

| Variable | Valores | Default | Para qué |
|---|---|---|---|
| `WEB_PUBLISH_MODE` | `mock` \| `storyblok` | `mock` | `mock` = escribe a `out/`. `storyblok` = publica vía Management API. |
| `STORYBLOK_MANAGEMENT_TOKEN` | string | — | Solo para `storyblok`. |
| `STORYBLOK_SPACE_ID` | string | — | Solo para `storyblok`. |
| `STORYBLOK_REGION` | `eu`\|`us`\|`ap`\|`ca`\|`cn` | `eu` | Determina el host de la Management API. |
| `STORYBLOK_DRY_RUN` | `1` \| `true` | — | Escribe el payload sin llamar a la API. |
| `KR_BRIEF_PATH` | ruta | `../kr-service/out/brief.json` | El brief del M2 a consumir. |
| `BUSINESS_PROFILE_PATH` | ruta | `./business-profile.json` | Datos NAP del negocio (opcional). |
| `PROSE_MODE` | `openai` \| `mock` | autodetecta | `openai` si hay key; si no, `mock`. |
| `OPENAI_API_KEY` | string | — | Prose final (secciones + respuestas de FAQ). |
| `OPENAI_MODEL` | string | `gpt-4o` | |

### Comportamiento del dry-run

Si `WEB_PUBLISH_MODE=storyblok` **y faltan las credenciales**, el módulo **no falla**: cae
automáticamente a **dry-run** con un aviso, y escribe en `out/storyblok/` el payload exacto que
habría enviado. Sirve para inspeccionar el formato Storyblok-nativo sin tener cuenta.

---

## Seguridad de secretos

### Qué está bien hoy
- Los `.env` están **gitignoreados** en ambos módulos y en la raíz (`.env`, `*.env`, `.env.local`).
- **Verificado:** ningún `.env` está en el historial de Git. En el repositorio solo hay `.env.example`
  con placeholders.
- Antes de cada commit se comprueba explícitamente que no se cuele ningún secreto.

### ⚠️ Deuda abierta (acción pendiente)

Una revisión externa señaló que **la misma API key de OpenAI está duplicada** en
`kr-service/.env` y `web-builder/.env`. Aunque están gitignoreados, eso significa que:

- Una sola filtración compromete **ambos** módulos.
- No se puede revocar ni atribuir costos por servicio.

**Acciones recomendadas (pendientes):**
1. **Rotar la key** en el dashboard de OpenAI (invalida la actual).
2. Usar **una key por servicio y entorno**, con límite de gasto por proyecto.
3. En producción, leerlas de un **secret manager**, no de archivos.
4. Añadir *secret scanning* / pre-commit hook.

### Reglas para el futuro
- **Nunca** pegar credenciales en el chat, en commits, ni en la documentación.
- Mantener únicamente `.env.example` versionado, con placeholders.
- Al terminar un spike con credenciales temporales, **rotarlas**.
