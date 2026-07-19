# 10. Acciones pendientes (lado del usuario)

Cosas que **solo Juan puede hacer** — requieren cuentas, dinero o decisiones de producto.
Todo lo demás (código, tests, docs) avanza sin bloquearse en esto.

> 👉 **Para EJECUTARLAS, usá las guías paso a paso: [`docs/acciones/`](../acciones/)**
> Este documento explica **por qué** importa cada una; las guías explican **cómo** hacerlas,
> con los pasos exactos, cómo verificar y qué hacer si falla.

Orden sugerido: **A → B → C → D**. A y C son gratis; B cuesta ~50 USD; D es una decisión.

---

## 🔴 A. Rotar la API key de OpenAI (seguridad — urgente)

**Por qué:** la **misma** key está duplicada en `kr-service/.env` y `web-builder/.env`. Aunque
están gitignoreadas y **nunca se commitearon** (verificado en el historial), una sola filtración
comprometería ambos módulos, y no se puede revocar ni atribuir costos por servicio.
Además, la key estuvo en un archivo de trabajo durante todo el spike.

**Qué hacer:**
1. Entrar a https://platform.openai.com/api-keys
2. **Revocar** la key actual (la que empieza con `sk-proj-jLAY...`).
3. Crear **dos keys nuevas**, una por servicio, cada una en su propio *project* con **límite de gasto**:
   - una para `kr-service`
   - otra para `web-builder`
4. Pegarlas en el `.env` **de cada módulo** (nunca en el chat, nunca en un commit):
   ```
   kr-service/.env    → OPENAI_API_KEY=<key del research>
   web-builder/.env   → OPENAI_API_KEY=<key del web-builder>
   ```

**Qué desbloquea:** cerrar el hallazgo #2 de la review. **No me pases las keys** — solo avisame
cuando estén puestas.

---

## 🟡 B. Los NÚMEROS: precios de los modelos + research de prueba real

Esto es lo que convierte el costo del research de "mecanismo listo" a **cifra que podés
presentarle a Frank**. Hoy el mecanismo mide y desglosa correctamente, pero **las tarifas son
aproximadas** y **DataForSEO corre en sandbox** (costo real $0).

### B.1 — Confirmar los precios de los modelos

**Por qué:** `lib/cost.ts` trae tarifas por defecto que son **aproximadas**. Si están mal, el costo
por research está mal, y la propuesta comercial también.

**Qué hacer:**
1. Abrir https://openai.com/api/pricing/
2. Anotar el precio **por 1 millón de tokens** de los modelos que usamos:

   | Modelo | Input (USD/1M) | Output (USD/1M) |
   |---|---|---|
   | `gpt-4o` | ____ | ____ |
   | `text-embedding-3-small` | ____ | (no aplica) |

3. **Pasame esos 4 números** (son públicos, no son secretos) — yo los cargo en el código.

   *O si preferís hacerlo vos:* poné la variable en `kr-service/.env`:
   ```
   LLM_PRICES={"gpt-4o":{"input":2.5,"output":10},"text-embedding-3-small":{"input":0.02,"output":0}}
   ```
   (reemplazando por los valores reales).

### B.2 — Research de prueba en PRODUCCIÓN (DataForSEO)

**Por qué:** en sandbox los volúmenes, la dificultad y el costo son **ficticios**. Por eso el spike
siempre da ~1 cluster / 1 página y $0 de DataForSEO. Necesitamos **una corrida real** para:
- tener el **costo verdadero por research** (DataForSEO + LLM),
- **calibrar las estimaciones** del presupuesto preflight (hoy son a ojo),
- ver **clusters y páginas reales** (una demo con datos verdaderos).

**Qué hacer:**
1. Entrar al dashboard de DataForSEO → **cargar saldo** (mínimo histórico ~50 USD; confirmá el actual).
2. En `kr-service/.env`, cambiar **una sola línea**:
   ```
   DATAFORSEO_BASE_URL=https://api.dataforseo.com
   ```
   (antes: `https://sandbox.dataforseo.com`)
3. Correr **una** research de prueba, idealmente con un caso real de la agencia:
   ```bash
   cd kr-service
   npm run spike "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día."
   ```
4. **Pasame el resultado**: el contenido de `kr-service/out/informe.md` (o el `meta_run` de
   `out/brief.json`). Ahí está el costo real desglosado.

> ⚠️ **Volvé a sandbox después de la prueba** (`DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com`)
> para no gastar en cada corrida de desarrollo.

**Qué desbloquea:**
- El **número de costo por research** para la propuesta a Frank.
- Yo calibro `DEFAULT_ESTIMATES` (presupuesto preflight) con datos verdaderos.
- Una **demo con volúmenes reales**, que aguanta preguntas del cliente.

---

## 🟢 C. Cuenta de Storyblok (gratis) — cierra la demo

**Por qué:** el argumento de venta del CMS headless ([ADR-04](../decisiones-arquitectura.md)) es que
**las creadoras/community managers editan la web sin depender de devs**, en el Visual Editor.
El código para publicar y provisionar está escrito y typechequeado, **pero nunca se probó contra un
space real**. Sin esto, la demo no muestra la parte más vendible.

**Qué hacer:**
1. Crear cuenta gratis en https://storyblok.com → crear un **Space**.
2. Sacar dos datos: **Settings → Access Tokens → Management API token**, y el **Space ID**.
3. Ponerlos en `web-builder/.env`:
   ```
   STORYBLOK_MANAGEMENT_TOKEN=<token>
   STORYBLOK_SPACE_ID=<id>
   STORYBLOK_REGION=eu
   ```
4. Avisame → yo corro el provisioning de componentes y la publicación:
   ```bash
   npm run setup:storyblok
   WEB_PUBLISH_MODE=storyblok npm run build:web
   ```

**Qué desbloquea:** las páginas aparecen en Storyblok **editables visualmente**. Es el momento
"ajá" de la demo.

> Recordá: para publicar en vivo, el brief debe estar `approved` **y** las páginas con
> `approved: true` (la compuerta doble, ADR-06). Te ayudo a aprobarlo cuando llegue el momento.

---

## ✅ D. Decisión de producto: unificar el alcance (OBS-01) — **CERRADA (2026-07-19)**

Había dos documentos de producto con alcances que no cerraban (`contexto-proyecto-frank.md`: 4
módulos con "Frank"; el PRD: 5 agentes con "Franco · CEO", y el Creador de Webs "diferido a I+D").
El riesgo era presentarle al mismo cliente **dos alcances incompatibles**.

**Decidido:**

| | |
|---|---|
| Documento rector | **`contexto-proyecto-frank.md`**. El PRD queda como visión de largo plazo. |
| Alcance base | **3 módulos** (Creador de Webs · Keyword Research · Respondedor de reseñas). |
| Módulo 4 | Ni calendario de redes ni Trello: **a línea futura**, fuera del presupuesto inicial. |
| WordPress/Elementor | **Descartado, se mantiene [ADR-04](../decisiones-arquitectura.md)** (Storyblok). Sin ADR nueva. |

**Lo que desbloqueó:** la propuesta comercial se puede consolidar sin contradicción — y con un
argumento mucho mejor del que había cuando se escribió esta acción: **dos de los tres módulos base
ya están construidos y funcionando**. El presupuesto deja de ser "cuánto cuesta construir esto" y
pasa a ser "cuánto vale esto, que ya funciona, más un módulo por hacer".

Detalle en [OBS-01](../decisiones-arquitectura.md) y en la [acción 05](../acciones/05-unificar-alcance.md).

---

## Resumen: qué necesito de vos

| | Acción | Costo | Qué me pasás |
|---|---|---|---|
| 🔴 A | Rotar la key de OpenAI (2 keys, una por módulo) | gratis | Solo un "listo" (**no me pases las keys**) |
| 🟡 B.1 | Precios de `gpt-4o` y `text-embedding-3-small` | gratis | Los 4 números (input/output) |
| 🟡 B.2 | Un research de prueba en producción | ~50 USD | El `informe.md` o el `meta_run` del brief |
| 🟢 C | Space de Storyblok | gratis | Un "listo" con el token y Space ID **en el `.env`** |
| 🔵 D | Unificar el alcance con el socio | gratis | La decisión |

**Regla de oro:** las credenciales van **siempre al `.env`**, nunca al chat ni a un commit.
Los precios públicos sí me los podés pasar por chat.
