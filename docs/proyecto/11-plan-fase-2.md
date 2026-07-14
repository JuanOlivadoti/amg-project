# 11. Plan de la Fase 2 — plataforma

> **Este documento responde tres preguntas: de dónde venimos, dónde estamos exactamente ahora, y
> qué falta.** Si retomás el proyecto, empezá por acá.
>
> Última actualización: **2026-07-14** · Commit: `a0d6b95` · **184 tests en verde**

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
- **184 tests**, todos contra Postgres real (PGlite en WASM, sin Docker ni cuenta).
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
| `POST /runs` | Lanza un research (emite `research/solicitado` a Inngest). |
| `GET /runs` | Los runs del cliente. |
| `GET /runs/:id` | El brief: páginas, evidencia, coste, calidad de los datos. |
| `POST /pages/:id/approve` | Aprueba **una** página (mitad de la compuerta). |
| `POST /runs/:id/approve` | Aprueba el run (la otra mitad) → despierta al workflow → publica. |

**La regla que no se rompe:** la API **no** decide quién puede qué. Solo afirma **quién eres**
—legítimo, porque acaba de validar el token contra la clave pública del emisor— y RLS hace el resto.
Un endpoint que acepte `role` del body es una escalada de privilegios.

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

---

## Lo que sigue abierto

| Qué | Dónde | Nota |
|---|---|---|
| **Acción 05 — unificar alcance** | [acciones/05](../acciones/05-unificar-alcance.md) | OBS-01. Conversación de negocio, no código. **Solo Juan puede.** |
| **Acción 06 — corrida final** | [acciones/06](../acciones/06-corrida-final-demo.md) | ~$0.31. La demo publicada es anterior a kr.v0.5. |
| Esquema Zod duplicado M2/M1 | `kr-service/src/validation/`, `web-builder/src/contract.ts` | Dos fuentes de verdad del contrato. |
| `is_local` se dispara de más | `pipeline/enrich-content.ts` | 53 de 60 keywords → casi todo `LocalBusiness`. Ensucia el JSON-LD. |
| Sin tests de integración automatizados | — | El camino live se ejecutó **a mano** contra DataForSEO, OpenAI y Storyblok. |
