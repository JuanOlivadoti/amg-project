# Acción 02 — Confirmar los precios de los modelos

**Tiempo:** ~5 minutos · **Costo:** gratis · **Prioridad:** 🟡 media (bloquea la propuesta comercial)

## Por qué

El sistema **mide el costo real de cada research**: cuenta los tokens que reporta OpenAI y los
multiplica por una tarifa. El problema es que **las tarifas que tiene cargadas el código son
aproximadas** — las puse yo como punto de partida, no las verifiqué contra la página oficial.

Si esas tarifas están mal, **el costo por research está mal**, y la propuesta que le hagas a Frank
también.

Es un trámite de 5 minutos y desbloquea el número más importante del proyecto.

---

## Paso 1 — Buscar los precios oficiales

Entrá a **https://openai.com/api/pricing/**

Buscá los dos modelos que usa el sistema y anotá el precio **por cada 1 millón de tokens**
(la página normalmente lo muestra así, en USD):

| Modelo | Input (USD / 1M tokens) | Output (USD / 1M tokens) |
|---|---|---|
| `gpt-4o` | ______ | ______ |
| `text-embedding-3-small` | ______ | no aplica (los embeddings solo cobran input) |

> **¿Por qué estos dos?** `gpt-4o` hace la generación (seeds, intención, relevancia, contenido) y
> `text-embedding-3-small` hace los embeddings del clustering. Son los únicos dos que se usan hoy.

## Paso 2 — Pasarme los números

**Escribime los valores por chat.** Son **precios públicos, no son secretos** — no hay ningún
problema en compartirlos. Yo los cargo en el código.

Ejemplo de lo que me tendrías que mandar:
> "gpt-4o: input 2.5, output 10. text-embedding-3-small: input 0.02"

## (Alternativa) Si preferís hacerlo vos

Poné esta línea en **`kr-service/.env`**, con los valores reales:

```
LLM_PRICES={"gpt-4o":{"input":2.5,"output":10},"text-embedding-3-small":{"input":0.02,"output":0}}
```

Y lo mismo en `web-builder/.env` si querés medir el costo de la prose (opcional).

> ⚠️ Tiene que ser **JSON válido en una sola línea**. Si está mal escrito, el sistema avisa y usa
> los defaults.

## Paso 3 — Verificar

```bash
cd kr-service
npm run spike
```

Mirá la línea del costo:
```
[cost] total $0.0178 · DFS $0.0000 · LLM $0.0178 · emb $0.0000
```

Y que **NO** aparezca este aviso:
```
[cost] ⚠️ sin tarifa: <modelo> → el total es INCOMPLETO
```

Ese aviso significa que se usó un modelo sin tarifa cargada. El sistema **no inventa el costo**:
prefiere decirte que el total está incompleto antes que darte un número falso.

---

## Nota: si algún día usás Anthropic (Claude)

El código soporta Claude como proveedor alternativo, pero **no trae tarifas de Claude por defecto**
(no quise inventar precios). Si alguna vez ponés `LLM_PROVIDER=anthropic`, tenés que agregar sus
tarifas a `LLM_PRICES` o el costo del run va a salir marcado como incompleto.

Los precios están en https://www.anthropic.com/pricing

---

## Cómo saber que salió bien

- [ ] Tenés los 3 números (input/output de `gpt-4o`, input de `text-embedding-3-small`).
- [ ] O me los pasaste, o los cargaste en `LLM_PRICES`.
- [ ] El spike **no** muestra el aviso de "sin tarifa / INCOMPLETO".
