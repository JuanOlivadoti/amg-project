# AMG OS — instrucciones del proyecto

Plataforma SaaS multi-tenant para una agencia de marketing gastronómico (AMG Madrid). Convierte el
trabajo de la agencia en software con agentes de IA supervisados, RBAC y multi-tenancy. Se le
propone a un cliente ("Frank").

**Antes de trabajar, leé el estado real** (no lo asumas): `docs/proyecto/09-estado-y-roadmap.md` (qué
hay, qué falta) y `docs/proyecto/11-plan-fase-2.md` (el plan). Las decisiones viven en
`docs/decisiones-arquitectura.md` (ADR-01..22 + OBS-01/02/03, las tres cerradas).

---

## El ritual de cada iteración (NO negociable)

Al terminar cualquier pieza de trabajo, antes de darla por cerrada:

1. **Auto-revisión.** Revisá tu propio diff como lo haría un revisor adversarial: ¿qué afirmé que no
   verifiqué? ¿qué test prueba la implementación en vez del contrato? ¿qué default no tiene test?
   ¿qué garantía escribí en un comentario en vez de imponerla con una constraint o una mutación?
2. **Verificación real.** Corré `npm test` y `npm run typecheck` desde la raíz y confirmá el verde
   con el output, no de memoria. Para el renderizador o el portal, **manejá la app en un navegador**
   (MCP chrome-devtools): encuentra lo que los tests no ven — ya pasó varias veces.
3. **Actualizá la documentación del plan.** `09-estado-y-roadmap.md` (qué se hizo, **dónde estamos**,
   **qué falta**) y `11-plan-fase-2.md`. Si el plan no menciona lo que acabás de hacer, el plan
   miente por omisión. Actualizá también el ADR relevante si la decisión cambió o se cumplió una
   promesa vieja. Sincronizá las cifras de tests y de migraciones donde aparezcan.
4. **Commit + push al cerrar cada etapa** (ver Git).

La lección de diez reviews externas: **una garantía en un comentario es una intención, no una
garantía.** La hace cumplir una constraint, un test que la mute, o nada.

---

## Credenciales y seguridad (reglas duras)

- Las keys van **solo** a archivos `.env` (gitignoreados). **Nunca** al chat, a un commit ni a la
  documentación. No le pidas keys al usuario; si hace falta una, decile qué variable poner y que la
  ponga él ("no me pases las keys" — confirma "listo").
- **Antes de cada commit**, verificá explícitamente que no se cuele `.env`, `node_modules`, `out/`
  ni `.cache/`. Los `.env.example` (plantillas sin valores) sí se commitean.
- Los **precios públicos** se pueden compartir en el chat; los secretos no.
- Tras correr DataForSEO en **producción**, **volvé a sandbox** (`kr-service/.env`).

## Git

- Rama por defecto: `main`. Commit + push a `main` al cerrar cada etapa. *(Hubo un período con `main`
  protegida que exigía PR; hoy está sin protección — si vuelve a estarlo y no hay `gh`, dejá la rama
  pusheada y pasá el link de compare.)*
- Mensajes de commit en español, y terminan con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Stack y estilo de código

- **npm workspaces**, 6 paquetes: `db`, `kr-service` (M2), `web-builder` (M1), `orchestrator`, `api`,
  `renderer`. Más `portal/` (Angular) **fuera del monorepo a propósito** (su toolchain no se mezcla).
- **TypeScript ESM strict** + `noUncheckedIndexedAccess`. **`tsx`, sin paso de build.** Se importa
  **por nombre de paquete** (`import { PgStore } from "db"`), no por ruta relativa.
- Tests con **`node:test` + `node:assert`** (runner nativo, cero dependencias nuevas). Los de
  seguridad, contra **PGlite** (Postgres real en WASM) — sin Docker, sin cuenta, sin red.
- **Todo corre sin credenciales** (providers mock + PGlite en memoria). Si algo necesita una
  credencial real, tiene que tener modo mock y un `dev-server`/`demo-server`.
- Nombres de dominio en **español** (`vigencia`, `sitios`, `perfilValido`). Los comentarios explican
  **por qué**, no qué — sobre todo la decisión de seguridad o la trampa que se está evitando.

## Disciplina de tests (lo que las reviews enseñaron)

- **Rojo primero**, después el arreglo, después **verificación por mutación**: reintroducí el bug y
  confirmá que cae *exactamente* su test. Un test de seguridad que siempre pasa es peor que no tenerlo.
- Los tests prueban el **contrato**, no la implementación.
- **Un default de producción sin test es una decisión sin dueño** (si el test elige el parámetro, no
  está fijando el que corre en prod).
- Leer el código y manejar la app encuentran cosas **distintas**. Hacé las dos.

## Invariantes de arquitectura (no romper sin un ADR nuevo)

- **El rol no se declara: se DERIVA de `memberships` dentro de Postgres** (ADR-15). Un endpoint que
  acepte `role` del body es una escalada de privilegios.
- **Un proceso, un login, un rol**, con `NOINHERIT` (ADR-17). La API no puede asumir el rol del
  servicio: lo impide Postgres, no un `if`. Logins: `amg_api`, `amg_orquestador`, `amg_cache`,
  `amg_render`.
- **Un evento no porta autoridad**: la API crea la fila bajo RLS (ahí se autoriza) y *después* emite
  el evento (ADR-18). Comando compuesto: fila primero, evento si no lanzó.
- **El acceso a la base es solo por transacción con conexión reservada** (`Tx`), nunca un `query()`
  suelto — el `set local` del contexto de tenant vive en la transacción (ADR-13).
- **El renderizador es la única pieza expuesta a internet anónimo.** El dominio ES la autorización
  (ADR-19); su rol `app_render` es el más pobre del sistema. Lo que le llega de `clients` pasa por
  una **allowlist** (columna generada `business_profile_publico`): al agregar un campo al perfil,
  agregalo a la allowlist o se filtra en silencio. Pregunta de diseño: *"si me lo toman, ¿qué se
  llevan?"*.
- **Storyblok: dos APIs que no se cruzan.** El orquestador **escribe** por la Management API; el
  renderizador **lee** por la Content Delivery API. El proceso anónimo nunca toca una credencial que
  pueda modificar el space.
- Cualquier valor que termine en `<style>`, `<img src>` o el HTML es **superficie de inyección**: se
  valida (hex, allowlist, http(s), escape) y se descarta lo que no pasa. En prod el dato puede venir
  de la base sin pasar por Zod — el renderizador revalida (defensa en profundidad).

## Cómo correr

```bash
npm test            # los 6 paquetes
npm run typecheck   # tsc --noEmit en todos
npm run dev:server -w api        # la API real sobre PGlite (verificar el portal)
npm run demo -w renderer         # el renderizador sobre el Storyblok REAL (demo)
```
