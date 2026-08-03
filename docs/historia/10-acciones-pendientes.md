# 10. Acciones del lado del usuario — ✅ las seis, cerradas

Cosas que **solo Juan podía hacer** — requerían cuentas, dinero o decisiones de producto.

> ✅ **Ya no queda ninguna abierta.** Este documento se conserva como registro de **qué desbloqueó
> cada una**, porque varias explican por qué el proyecto tomó el camino que tomó. Para el paso a paso
> de cada una, ver [`docs/acciones/`](acciones/).
>
> 👉 Si venís buscando *qué hacer ahora*, el lugar es
> [09-estado-y-roadmap § Próximos pasos](../proyecto/09-estado-y-roadmap.md#próximos-pasos).

| # | Acción | Cerrada | Costo real | Qué desbloqueó |
|---|---|---|---|---|
| **A** | [Rotar la API key de OpenAI](acciones/01-rotar-key-openai.md) | 2026-07-13 | gratis | Dos keys separadas por servicio, con límite de gasto. Cierra el hallazgo #2 de la 1ª review. |
| **B.1** | [Confirmar los precios de los modelos](acciones/02-precios-modelos.md) | 2026-07-13 | gratis | Las tarifas dejan de ser aproximadas → **el costo por research es presentable**. |
| **B.2** | [Research de prueba en producción](acciones/03-research-produccion-dataforseo.md) | 2026-07-13 | ~$0.87 | El número real (**$0.31**/research) y **tres bugs que el sandbox ocultaba**. |
| **C** | [Space de Storyblok](acciones/04-storyblok-space.md) | 2026-07-13 | gratis | El camino live deja de ser dry-run: páginas **editables en el Visual Editor**. |
| **D** | [Unificar el alcance (OBS-01)](acciones/05-unificar-alcance.md) | 2026-07-19 | gratis | Alcance base = **3 módulos**; manda `contexto-proyecto-frank.md`; ADR-04 se mantiene. |
| **E** | [Corrida final + republicar](acciones/06-corrida-final-demo.md) | 2026-07-30 | $0.3097 | `kr.v0.5` en vivo para **La Birra Bar**, y la **duración real medida** por primera vez (16m15s). |

---

## Lo que dejó cada una, y por qué se anotó

### A — La key de OpenAI estaba duplicada entre dos servicios

La **misma** key vivía en `kr-service/.env` y en `web-builder/.env`. Nunca se commitearon (verificado
en el historial), pero una sola filtración habría comprometido ambos módulos, y no se podía revocar
ni atribuir costos por servicio. Ahora son **dos keys**, una por módulo, cada una en su propio
project con límite de gasto.

### B — Los números que convirtieron el mecanismo en una cifra vendible

`lib/cost.ts` medía y desglosaba bien, pero con **tarifas aproximadas** y contra el **sandbox** de
DataForSEO, donde los volúmenes son ficticios y el costo es $0. Por eso el spike siempre daba
~1 cluster / 1 página.

> ### Un research completo cuesta **~$0.31**
> 52 keywords → 8 páginas con contenido on-page. **El 81% es DataForSEO**, no la IA.
> Estable en tres corridas ($0.28 / $0.28 / $0.31).

Y **encontrar los bugs era el punto de correr en producción**. El sandbox ocultaba tres:

1. **Se decía "0 búsquedas/mes" donde no había dato.** DataForSEO devuelve `null` (41 de 60 keywords
   en KD) y el código lo coaccionaba a `0` → ahora se propaga como `null` y el informe muestra
   **`n/d`** (esquema `kr.v0.4`).
2. **Se pagaban keywords duplicadas.** `"pasta fresca Madrid"` y `"pasta fresca madrid"` iban como
   dos, y a DataForSEO se le paga por keyword → dedupe canónico.
3. **El clustering colapsaba el sitio entero en 3 páginas.** Con coseno ≥ 0.55, 41 de 45 keywords
   caían en un cluster → recalibrado a **0.75** con el dataset real: **8 páginas**.

### C — Storyblok: el argumento de venta del CMS, por fin probado

El código para provisionar y publicar estaba escrito y typechequeado, pero **nunca se había probado
contra un space real** — y el argumento de [ADR-04](../decisiones-arquitectura.md) es justamente que
las creadoras editan la web sin depender de devs. Con el space real apareció además
[OBS-03](../decisiones-arquitectura.md): nadie leía de vuelta lo publicado, y el contenido que
Storyblok guarda está **aplanado**.

### D — Dos documentos de producto con alcances incompatibles

`contexto-proyecto-frank.md` describía 4 módulos con "Frank"; el PRD, 5 agentes con "Franco · CEO" y
el Creador de Webs "diferido a I+D". El riesgo era presentarle al mismo cliente dos alcances que no
cerraban.

| | |
|---|---|
| Documento rector | **`contexto-proyecto-frank.md`**. El PRD queda como visión de largo plazo. |
| Alcance base | **3 módulos** (Creador de Webs · Keyword Research · Respondedor de reseñas). |
| Módulo 4 | Ni calendario de redes ni Trello: **a línea futura**, fuera del presupuesto inicial. |
| WordPress/Elementor | **Descartado, se mantiene [ADR-04](../decisiones-arquitectura.md)** (Storyblok). Sin ADR nueva. |

Con **dos de los tres módulos base ya construidos**, la conversación comercial cambia: el presupuesto
deja de ser *"cuánto cuesta construir esto"* y pasa a ser *"cuánto vale esto, que ya funciona, más un
módulo por hacer"*.

### E — La corrida final, y el dato que mató a la pieza D

Research real contra producción para **La Birra Bar** (cliente real de la agencia, reemplazó al caso
de ejemplo "Bella Napoli"): 55 keywords → **14 páginas**, $0.3097, republicado con `kr.v0.5` y
verificado en el navegador. Lo publicado en Storyblok ya **no** es anterior a `kr.v0.5`: ahora
muestra la evidencia etiquetada, que es *el argumento de venta*.

De paso midió por primera vez **cuánto tarda un research real: 16m15s** — por encima del umbral de
~12 minutos que la pieza D (lanzar el research en vivo delante de Frank) necesitaba, así que esa
pieza quedó **desaconsejada**. Y cerró un hueco: `npm run spike` en producción exige
`DATABASE_URL_CACHE` desde [ADR-14](../decisiones-arquitectura.md) y la guía no lo pedía.

---

## Las dos reglas (siguen valiendo)

1. 🔒 **Las credenciales van SIEMPRE al `.env`, nunca al chat ni a un commit.** Los `.env` están
   gitignoreados y son **generados**: se editan en `docs/private/credenciales.env` y se reparten con
   `npm run env:sync`. Los **precios** sí se pueden pasar por chat: son públicos.
2. ⚠️ **Después de correr contra producción, volvé a sandbox**
   (`DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com` en `kr-service/.env`). Si no, cada corrida
   de desarrollo cobra.
