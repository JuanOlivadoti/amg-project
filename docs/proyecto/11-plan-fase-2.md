# 11. Plan de la Fase 2 — plataforma

> **Este documento responde tres preguntas: de dónde venimos, dónde estamos exactamente ahora, y
> qué falta.** Si retomás el proyecto, empezá por acá.
>
> Última actualización: **2026-07-14** · **194 tests en verde**

---

## El plan, en una frase

Convertir la PoC (`prompt → research → web`, que corría como un script y aprobaba editando un JSON
a mano) en una **plataforma multi-tenant** con persistencia, orquestación durable, compuerta humana
real y un portal donde el equipo de la agencia trabaje.

## Las cinco etapas

| # | Etapa | Estado |
|---|---|---|
| 1 | **Persistencia + multi-tenancy** — esquema, RLS, cache y registro de tareas en Postgres | ✅ Hecha |
| 2 | **Orquestador durable** — Inngest: steps, reintentos, compuerta humana con `waitForEvent` | ✅ Hecha |
| 3 | **Idempotencia del gasto** — que un reintento no vuelva a pagarle a DataForSEO | ✅ Hecha |
| 4 | **Monorepo + Auth** — workspaces npm; el rol se deriva de `memberships`, no se declara | ✅ Hecha |
| 5 | **API + Portal** — REST autenticada + SPA Angular donde se aprueba la compuerta | ⏳ **ACÁ ESTAMOS** |

Después de la 5 el sistema es usable por una persona que no sea yo. Hoy todavía no lo es: **la
compuerta de aprobación (ADR-06) se ejecuta editando un JSON a mano.**

---

## Dónde estamos exactamente

### Lo que ya funciona

```
┌───────────────┐   evento   ┌──────────────────┐
│  (falta: API) │ ─────────▶ │  orchestrator/   │  Inngest: steps durables,
└───────────────┘            │                  │  reintentos, compuerta humana
                             └────────┬─────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
       ┌─────────────┐         ┌────────────┐          ┌──────────────┐
       │ kr-service  │         │    db/     │          │ web-builder  │
       │  (M2)       │         │  Postgres  │          │    (M1)      │
       │             │         │  + RLS     │          │              │
       │ prompt →    │         │            │          │ brief JSON → │
       │ brief SEO   │         │            │          │ Storyblok    │
       └─────────────┘         └────────────┘          └──────────────┘
```

- **4 paquetes** en workspaces npm: `kr-service` (M2), `web-builder` (M1), `db`, `orchestrator`.
- **194 tests**. Los de seguridad corren contra Postgres real (PGlite en WASM), sin Docker ni cuenta.
- **Corre entero sin una sola credencial**: providers mock + PGlite en memoria.
- El flujo `research → persistir → esperar aprobación humana → publicar` **funciona de punta a
  punta** y está probado.

### Lo que NO existe todavía

- **Una API HTTP.** El único caller es el CLI. El portal no tiene con qué hablar.
- **El portal.** Nadie que no sea yo puede aprobar un brief.
- **Un despliegue.** Nada corre en ningún servidor.

---

## Etapa 5: qué se construye ahora, y en qué orden

El orden **no es negociable**, y el motivo es de seguridad:

### 5.1 — La API (`api/`) ⏳ SIGUIENTE

REST autenticada. Verifica el JWT de Supabase, pone `app.user_id` y deja que **Postgres decida el
resto** (ADR-15).

| Endpoint | Qué hace |
|---|---|
| `POST /runs` | **Crea la fila del run bajo RLS** (aquí se autoriza) y *después* emite `research/solicitado`. Ver `orchestrator/src/solicitar.ts`. |
| `GET /runs` | Los runs del cliente. |
| `GET /runs/:id` | El brief: páginas, evidencia, coste, calidad de los datos. |
| `POST /pages/:id/approve` | Aprueba **una** página (mitad de la compuerta). |
| `POST /runs/:id/approve` | Aprueba el run (la otra mitad) → despierta al workflow → publica. |

**Las tres reglas que no se rompen** (las tres nacieron de un agujero real, no de la teoría):

1. **La API no decide quién puede qué.** Solo afirma **quién eres** —legítimo, porque acaba de
   validar el token contra la clave pública del emisor— y RLS hace el resto (**ADR-15**). Un endpoint
   que acepte `role` del body es una escalada de privilegios.
2. **La API se conecta con `amg_api`**, que **no puede** asumir el rol del servicio: lo impide
   Postgres, no el código (**ADR-17**).
3. **`POST /runs` crea la fila ANTES de emitir el evento.** Ahí es donde se autoriza. El evento
   lleva solo el `runId`; si llevara el `clientId`, quien lo emita elegiría **a nombre de quién se
   gasta** (**ADR-18**).

### 5.2 — El portal (`portal/`)

Angular + Tailwind, mobile-first (**ADR-16**, reemplaza ADR-02).

1. Login (Supabase Auth).
2. Lanzar un research desde un prompt de negocio.
3. Ver el brief: páginas propuestas, **separadas por evidencia** — ✅ respaldadas por datos de
   mercado vs. ⚠️ sin validar. Es el punto vendible del sistema: **dice lo que no sabe.**
4. **Aprobar página por página**, y después el run. Publicar.

### 5.3 — Desplegar

Orquestador + API como **servicio Node de larga duración** (Fly/Render/Railway), portal como
estático. **No serverless**: el research encadena llamadas live a DataForSEO y generación por LLM,
y probablemente no entra en el timeout de una función de Vercel (60-300 s).

> ⚠️ **Dato que no tengo: cuánto tarda un research real.** Tengo el coste ($0.31), nunca medí la
> duración. Ya no bloquea el diseño (el orquestador es un proceso largo), pero **define la UX del
> portal**: ¿el usuario espera mirando una barra, o se va y vuelve? Se mide en la primera corrida
> real.

---

## Decisiones tomadas en esta fase (y por qué)

Todas con su ADR. Las que más condicionan lo que viene:

- **ADR-12 — El evento dispara, la base decide.** `research/aprobado` no aprueba nada: despierta al
  workflow, que relee de la base bajo RLS. Si el evento fuera la autoridad, cualquiera que pudiera
  emitirlo publicaría contenido que ningún humano miró.
- **ADR-13 — Solo se toca la base por transacción con conexión reservada.** El `set local` del
  contexto de tenant vive en *una* conexión; con un pool, las queries se repartían entre conexiones
  distintas y el `insert` caía **fuera de RLS**.
- **ADR-14 — Idempotencia por `payload_hash`, no método Standard.** La API Labs de DataForSEO es
  *live-only* y es donde está el 54% del gasto: migrar a `task_post` habría blindado el endpoint más
  barato.
- **ADR-15 — El rol se deriva de `memberships`, no se declara.** Cierra OBS-02. Es lo que hace
  seguro construir la API.
- **ADR-16 — Portal en Angular.** Reemplaza ADR-02 (Next), cuya premisa —un frontend que renderice
  también las webs públicas— se cayó al acotar el alcance al portal interno.
- **ADR-17 — Un proceso, un login, un rol.** Corrige una afirmación **falsa** de ADR-15: la autoridad
  del servicio *no* era una credencial, era el código eligiendo con qué rol vestirse. Ahora la
  separación la impone Postgres (`NOINHERIT`, un rol por login).
- **ADR-18 — Un evento no porta autoridad.** El evento traía `tenantId`/`clientId` elegidos por quien
  lo emitía: conocer dos UUID ajenos bastaba para que la agencia pagara el research de otra. Ahora la
  API crea el run bajo RLS y el evento solo lo pone en marcha.

> Las cuatro últimas nacieron de reviews externas, y **tres de ellas corrigen algo que yo había dado
> por bueno**. Es el motivo por el que las reviews están en el proceso: lo que se documenta como
> seguro, y no lo es, es peor que no documentarlo.

---

## Lo que sigue abierto

### 🔴 Decisiones, no tareas (bloquean lo que se le puede prometer al cliente)

| Qué | Dónde | Por qué bloquea |
|---|---|---|
| **OBS-03 — nadie publica la web del cliente** | [decisiones](../decisiones-arquitectura.md) | ADR-16 quitó Next del stack **y no puso nada en su lugar**. Hoy `web-builder` genera el HTML y publica en Storyblok, pero **nada sirve la web en un dominio** y **no hay rebuild**: una edición en el Visual Editor **no llega a ninguna página publicada**. Eso rompe la premisa de ADR-04 (se eligió Storyblok *por* el Visual Editor) y deja **ADR-11 sin poder firmarse** (el "handoff editable" de pago promete un frontend que no existe). |
| **OBS-01 — unificar el alcance** | [acciones/05](../acciones/05-unificar-alcance.md) | Dos documentos de producto describen alcances incompatibles. Conversación de negocio, no código. **Solo Juan puede.** |

### ⏳ Tareas

| Qué | Dónde | Nota |
|---|---|---|
| **Acción 06 — corrida final** | [acciones/06](../acciones/06-corrida-final-demo.md) | ~$0.31. La demo publicada es anterior a kr.v0.5. |
| **Migrar SERP + Search Volume a DataForSEO Standard** | `kr-service/src/dataforseo/` | ADR-14 cubre el 100% del gasto con `payload_hash`, pero **el 46%** (SERP + volumen) *sí* soporta el método Standard, cuyos resultados se recuperan **gratis** durante 30 días. Tanda propia. |
| **Cuánto tarda un research real** | — | **Nunca se midió.** Tengo el coste ($0.31), no la duración. Define la UX del portal. |
| Esquema Zod duplicado M2/M1 | `kr-service/src/validation/`, `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. |
| `is_local` se dispara de más | `pipeline/enrich-content.ts` | 53 de 60 keywords → casi todo `LocalBusiness`. Ensucia el JSON-LD. |
| `endpoints_degradados` incompleto | `meta_run` | Omite los fallos de suggestion/SERP. |
| Sin tests de integración automatizados | — | El camino live se ejecutó **a mano** contra DataForSEO, OpenAI y Storyblok. |
