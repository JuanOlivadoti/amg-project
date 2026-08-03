# Acción 02 — Confirmar los precios de los modelos ✅ HECHA

**Estado:** ✅ Completada el 2026-07-13 — verificada contra las páginas oficiales de OpenAI.

---

## Resultado

Las tarifas que tenía el código **eran correctas**. Verificadas contra
`developers.openai.com/api/docs/pricing` y las model cards:

| Modelo | Input (USD / 1M) | Output (USD / 1M) | Uso |
|---|---|---|---|
| `gpt-4o` | **$2.50** | **$10.00** | Generación (seeds, intención, relevancia, contenido) |
| `text-embedding-3-small` | **$0.02** | — (los embeddings solo cobran input) | Embeddings del clustering |

Están cargadas en `kr-service/src/lib/cost.ts`, marcadas como verificadas con su fecha.
**El costo por research que reporta el sistema ya es confiable.**

---

## 🔎 Hallazgo: `gpt-4o` quedó viejo — y los modelos nuevos son MÁS BARATOS

Al verificar los precios descubrí que **`gpt-4o` ya no aparece en la página de precios principal**
de OpenAI (es *legacy*). Los modelos actuales son la familia `gpt-5.x`, y varios cuestan **menos**:

| Modelo | Input | Output | vs. `gpt-4o` |
|---|---|---|---|
| `gpt-4o` (**el que usamos hoy**) | $2.50 | $10.00 | — |
| `gpt-5.4-mini` | **$0.75** | **$4.50** | **~3× más barato en input, ~2× en output** |
| `gpt-5.6-luna` | $1.00 | $6.00 | ~2.5× más barato en input |
| `gpt-5.4` | $2.50 | $15.00 | igual input, más caro output |

Esto importa porque **el costo por research es el argumento comercial del producto**. Bajarlo 2-3×
cambia el número que le presentás a Frank.

**No cambié el modelo por mi cuenta**: afecta calidad *y* costo, y es una decisión tuya.
Las tarifas de los modelos nuevos **ya están cargadas**, así que cambiar es una variable:

```
# en kr-service/.env
OPENAI_MODEL=gpt-5.4-mini
```

### Cómo decidirlo bien

No lo decidas por precio solo. Lo correcto es una **corrida comparativa**: mismo prompt con
`gpt-4o` y con el candidato, y comparar calidad de las keywords/contenido **y** costo.
Decime si querés que la haga.

> ⚠️ Ojo: los modelos nuevos podrían necesitar ajustes en cómo se les pide el JSON estructurado.
> Por eso conviene probarlo, no cambiarlo a ciegas.

---

## ⚠️ Nota para la próxima vez: rate limits ≠ precios

Es el error más fácil de cometer.

| Página | Qué muestra | ¿Sirve? |
|---|---|---|
| **Limits** (`platform.openai.com` → Settings → Limits) | `200.000 TPM`, `500 RPM`, `2.000.000 TPD` | ❌ **No.** Dice *cuántos* tokens podés usar por minuto, no *cuánto cuestan*. |
| **Pricing** (`developers.openai.com/api/docs/pricing`) | `$2.50 / 1M input tokens` | ✅ **Sí.** |

**Si lo que estás mirando no tiene signos de dólar, es la página equivocada.**

---

## Verificar (por si cambiás el modelo)

```bash
cd kr-service
npm run spike
```

La línea del costo:
```
[cost] total $0.0149 · DFS $0.0000 · LLM $0.0149 · emb $0.0000
```

Y que **NO** aparezca:
```
[cost] ⚠️ sin tarifa: <modelo> → el total es INCOMPLETO
```

Ese aviso significa que se usó un modelo sin tarifa cargada. El sistema **no inventa el costo**:
prefiere avisarte que el total está incompleto antes que darte un número falso.

---

## Si algún día usás Anthropic (Claude)

El código soporta Claude, pero **no trae tarifas de Claude cargadas** (no invento precios).
Si ponés `LLM_PROVIDER=anthropic`, agregá sus tarifas a `LLM_PRICES` o el costo saldrá incompleto.

---

## Fuentes

- [OpenAI API — Pricing](https://developers.openai.com/api/docs/pricing)
- [Model card — gpt-4o](https://developers.openai.com/api/docs/models/gpt-4o)
- [Model card — text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small)
