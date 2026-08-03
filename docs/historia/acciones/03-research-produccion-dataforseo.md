# Acción 03 — Research de prueba en PRODUCCIÓN (DataForSEO) ✅ HECHA

**Estado:** ✅ Completada el 2026-07-13. Tres corridas reales contra `api.dataforseo.com`.
**Gasto total:** ~**$0.87** del saldo cargado. **El `.env` quedó revertido a sandbox.**

---

## El número que buscábamos

> ### Un research completo cuesta **~$0.31**
> *(52 keywords analizadas → 8 páginas propuestas, con contenido on-page redactado)*

| Proveedor | Coste | % |
|---|---|---|
| **DataForSEO** | $0.2522 | **81%** |
| LLM (generación) | $0.0586 | 19% |
| LLM (embeddings) | $0.0000 | ~0% |
| **TOTAL** | **$0.3108** | |

Es **estable**: las tres corridas dieron $0.2765, $0.2783 y $0.3108. La variación viene de cuántas
keywords sobreviven al gate de relevancia.

**Para la propuesta a Frank:** el costo marginal de un research es de **centavos**. Lo que se le
cobra al cliente no está limitado por el costo de la API — está limitado por el valor del
entregable. Y el **81% del costo es DataForSEO**, no la IA: bajar el modelo de OpenAI casi no
mueve la aguja (ver [guía 02](02-precios-modelos.md)).

---

## Lo que la corrida real destapó

Los datos de verdad rompieron cosas que el sandbox ocultaba. **Ese era el punto de esta acción.**
Los tres se corrigieron:

### 1. 🔴 Le decíamos al cliente "0 búsquedas/mes" cuando no teníamos el dato

DataForSEO devuelve `null` cuando no tiene la métrica (le pasó con **41 de 60** keywords en KD).
El código lo convertía a `0` (`head.volume ?? 0`). En el informe, una keyword sin dato aparecía
como **"0 búsquedas/mes"** — una afirmación falsa, y de las que un cliente detecta.

**Arreglado:** `null` se propaga como `null` y el informe muestra **`n/d`**. Cambio de contrato →
esquema **`kr.v0.4`**.

### 2. 💸 Pagábamos por keywords duplicadas

`"pasta fresca Madrid"` y `"pasta fresca madrid"` se enviaban como **dos** keywords. A DataForSEO
se le paga **por keyword**. Eran 4 de 60 (~7% de sobrecosto), y además ensuciaban los clusters.

**Arreglado:** dedupe por clave canónica antes de llamar a la API.

### 3. 🎯 El clustering colapsaba el sitio entero en 3 páginas

Con el umbral original (coseno ≥ 0.55), **41 de 45** keywords caían en UN cluster: *pasta fresca*,
*pizza napolitana* y *restaurante italiano centro* —tres páginas comercialmente distintas— se
fusionaban en una. El sandbox no lo mostraba porque sus datos ficticios no se parecen entre sí.

**Arreglado:** umbral recalibrado a **0.75**, barriendo 0.55→0.85 sobre el dataset real.
**Resultado: 3 páginas → 8 páginas**, y cada cabeza cae sobre un servicio real del negocio.

### 4. 🔧 Y algo que ahora hace gratis el tuning futuro

Las keywords enriquecidas se **tiraban** al terminar el proceso: pagábamos $0.25 por datos que
no sobrevivían. Ahora se persisten, así que ajustar scoring o clustering es **offline y gratis** —
no hay que volver a pagar una corrida. Con eso se calibró el punto 3.

> ⚠️ **Se escribían en `out/keywords.json`, que git ignora, y el dataset de esta corrida se perdió
> con el clon.** Desde el 2026-08-02 el destino es `datasets/keywords.json`, versionado. Para volver
> a tener el dato hay que **regenerarlo** (~$0.31): ver KR-1 en el
> [estado](../../proyecto/09-estado-y-roadmap.md).

---

## El plan de sitio que salió (datos reales)

| # | Tipo | Keyword principal | Vol/mes | KD |
|---|---|---|---|---|
| 1 | landing_local | restaurante italiano Madrid centro | **480** | 0 |
| 2 | landing_local | pizza napolitana Madrid | **390** | 15 |
| 3 | blog | restaurante italiano pasta fresca | **260** | 0 |
| 4 | landing_local | cenas para grupos en restaurante italiano | n/d | n/d |
| 5 | landing_local | menú del día italiano Madrid | n/d | n/d |
| 6 | landing_local | brunch fin de semana restaurante italiano | n/d | n/d |
| 7 | landing_local | restaurante italiano especializado en pizzas | n/d | n/d |
| 8 | landing_local | cenas para grupos en Madrid centro | n/d | n/d |

Las 8 se publicaron en Storyblok con contenido redactado por IA ([acción 04](04-storyblok-space.md)).

---

## Lo que queda abierto (calidad, no bugs)

| Qué | Por qué importa |
|---|---|
| ~~**`is_local` se dispara de más**~~ (53 de 60 keywords) | ✅ **Arreglado el 2026-08-02** con la presencia de *map pack* en el SERP (`pipeline/local-signal.ts`), que es evidencia de mercado en vez de una conjetura sobre el texto. Falta verificar los `item.type` contra la API real. |
| ~~**5 de 8 páginas no tienen volumen**~~ | ✅ **`score_confidence` ya ordena** dentro de cada grupo de evidencia, y decide el corte al backlog. ⚠️ Pero la base y el portal reordenan por score crudo: en el dashboard la columna "Confianza" sigue sin ordenar nada. |
| **Estimaciones del presupuesto** | Se calibran con estos números; hoy siguen a ojo, y **el dataset con el que se haría se perdió**. |

---

## Si hay que repetirlo

```bash
# 1. En kr-service/.env:
#    DATAFORSEO_BASE_URL=https://api.dataforseo.com
#    DATABASE_URL_CACHE=postgres://amg_cache:...@host/db   ← OBLIGATORIA en producción (ver abajo)
# 2. Correr con tope de gasto (red de seguridad):
cd kr-service
MAX_COST_USD=1.00 npm run spike "El prompt del cliente"
# 3. 🔴 VOLVER A SANDBOX en el .env, o cada corrida de desarrollo cobra.
```

`MAX_COST_USD` aborta **antes** de gastar si una fase no entra en el remanente.

> **🔴 `DATABASE_URL_CACHE` es obligatoria contra producción (ADR-14, tanda 13).** Sin ella, el CLI
> no tendría registro de idempotencia durable y un **crash + re-run pagaría dos veces** — así que el
> spike **aborta antes de tocar la red**. Es el mismo login `amg_cache` y el mismo namespace que usa
> el orquestador, para que ambos compartan el ledger. Las tres corridas originales (2026-07-13) se
> hicieron **antes** de ese blindaje, con `NoopTaskLog`: si alguna se hubiera reintentado, habría
> repagado en silencio.
