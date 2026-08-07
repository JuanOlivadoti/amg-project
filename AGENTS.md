# AMG OS — instrucciones del proyecto

Plataforma SaaS multi-tenant para una agencia de marketing gastronómico (AMG Madrid). Convierte el
trabajo de la agencia en software con agentes de IA supervisados, RBAC y multi-tenancy. Se le
propone a un cliente ("Frank").

**Antes de trabajar, leé el estado real** (no lo asumas): `docs/proyecto/09-estado-y-roadmap.md` (qué
hay, qué falta) y `docs/proyecto/15-plan-plataforma.md` (el plan de la fase en curso; el de Fase 2, cerrado, es el `11`). Las decisiones viven en
`docs/decisiones-arquitectura.md` (ADR-01..24 + OBS-01..04; las tres primeras OBS están cerradas y
**OBS-04 está abierta**: quién edita la web no lo gobierna nuestro RBAC).

---

## El ritual de cada iteración (NO negociable)

Al terminar cualquier pieza de trabajo, antes de darla por cerrada:

1. **Auto-revisión.** Revisá tu propio diff como lo haría un revisor adversarial: ¿qué afirmé que no
   verifiqué? ¿qué test prueba la implementación en vez del contrato? ¿qué default no tiene test?
   ¿qué garantía escribí en un comentario en vez de imponerla con una constraint o una mutación?
   La lista concreta está en [CHECKPOINTS.md](CHECKPOINTS.md), y el agente `revisor` la recorre.
2. **Verificación real.** Corré **`npm run verificar`** desde la raíz: entorno, archivos del arnés,
   higiene de secretos, typecheck y tests, con exit code. Confirmá el verde con el output, no de
   memoria. Para el renderizador o el portal, **manejá la app en un navegador** (MCP chrome-devtools):
   encuentra lo que los tests no ven — ya pasó varias veces.
3. **Actualizá la documentación del plan.** `docs/proyecto/09-estado-y-roadmap.md` (qué se hizo, **dónde estamos**,
   **qué falta**) y `docs/proyecto/15-plan-plataforma.md`. Si el plan no menciona lo que acabás de hacer, el plan
   miente por omisión. Actualizá también el ADR relevante si la decisión cambió o se cumplió una
   promesa vieja. Sincronizá las cifras de tests y de migraciones donde aparezcan.
4. **Commit + push al cerrar cada etapa** (ver Git).

> ### 📓 Este proyecto NO se documenta en Obsidian
>
> **La documentación de AMG OS vive entera en `docs/` de este repo.** No crear ni actualizar notas del
> vault de Obsidian por este proyecto — ni daily notes, ni notas de proyecto en `07 - Solutions/`, ni
> nada. Esto **anula, solo acá**, las reglas de documentación en Obsidian de las instrucciones
> globales (que siguen valiendo para el trabajo de Codere). El motivo es que el estado del proyecto se
> reconstruye desde el repo: `docs/proyecto/09-estado-y-roadmap.md` es la fuente de verdad, y una
> segunda copia en el vault se desincroniza sin que nada avise.

La lección de diez reviews externas: **una garantía en un comentario es una intención, no una
garantía.** La hace cumplir una constraint, un test que la mute, o nada.

### Revisiones con Codex

Cuando el usuario pida una **revisión de Codex**, usá la skill `codex-review`
([.claude/skills/codex-review/SKILL.md](.claude/skills/codex-review/SKILL.md)): tiene la plantilla del
prompt y el protocolo de vuelta. La regla que la gobierna, por si la skill no está cargada: el prompt
debe pedir explícitamente que Codex **NO toque el código —solo revisa y reporta—**, y ni edita
archivos ni actualiza documentación. Los hallazgos los verifica, decide e implementa el agente
principal (verificar antes de implementar, discrepar con razón técnica).

---

## Quién hace qué

El trabajo se reparte por **cuerpo de conocimiento**, no por carpeta: un área es un agente cuando
tiene su propio modo de verificar y sus propias trampas. Las convenciones viven en skills, que
también puede cargar la sesión principal sin delegar en nadie.

| Agente | Área | Skills | Estado |
| --- | --- | --- | --- |
| `front` | `portal/` — Angular, las pantallas de la agencia | `portal-angular`, `portal-estilos`, `portal-testing` | existe |
| `revisor` | transversal — recorre `CHECKPOINTS.md` contra el diff. No edita nada | `codex-review` (para la ronda externa) | existe |
| `pipeline` | `kr-service/` + `orchestrator/` + `web-builder/` — contenido, idempotencia, gasto | `pipeline-gasto`, `pipeline-research`, `pipeline-publicacion`, `pipeline-orquestacion` | existe |
| `datos` | `db/` + `api/` — RLS, roles, `Tx`, endpoints, PGlite | `datos-postgres`, `datos-api`, `datos-testing` | existe |
| `render` | `renderer/` — la única superficie pública anónima, Storyblok CDA | (por escribir) | planificado |

Mientras un agente esté "planificado", ese trabajo lo hace la sesión principal. No lo invoques: no
existe. Qué skills lleva cada uno, en qué orden se escriben y con qué trabajo real se estrena cada
uno: [.claude/PLAN-AGENTES.md](.claude/PLAN-AGENTES.md) — **una etapa por sesión**. Al cerrar una,
se actualiza la tabla de acá arriba.

**Cuándo delegar.** La sesión principal coordina, pero no es dogmática: delegar cuesta tiempo y
tokens, y en un cambio de un archivo cuesta más que hacerlo.

- **Se delega** cuando el trabajo toca 3+ archivos, o entra de lleno en un área que tiene agente
  propio, o requiere explorar antes de decidir.
- **Lo hace la sesión principal** cuando es un archivo, un typo, un comentario, una pregunta
  conceptual o cualquier cosa de `docs/`.
- **Después de que un agente de área devuelva trabajo, va el `revisor`.** Quien implementa no se
  autoaprueba.

**Lo que un agente NO hace es un contrato, no un sandbox.** Las prohibiciones que llevan los prompts de
`.claude/agents/` —no gastar dinero, no tocar `.env`, no commitear, no editar código (el `revisor`)—
son instrucciones, y las cumple quien las lee. El único límite **técnico** es no tener la herramienta:
por eso el `revisor` declara `tools` sin `Edit`. Pero conserva `Write` y `Bash`, y los agentes de área
heredan `Bash` entero, así que **con Bash se puede leer cualquier archivo y correr cualquier comando**,
sin pasar por `Read`. El `permissions.deny` de `.claude/settings.json` cubre los cuatro comandos que
tocan servicios reales y los patrones de lectura sensible: eso evita el **accidente**, no a un agente
que decida ignorar su prompt. Lo señaló la 13ª review externa, y decirlo acá es la mitad del arreglo —
un límite que se cree técnico y es textual es peor que uno declarado como textual.

**Los subagentes escriben en disco, no en el chat.** Un informe que se recuenta se degrada, y el
chat no queda auditable. Al lanzar un subagente, pedile explícitamente que escriba su resultado en
`progress/informes/<rol>-<tema>.md` y que **su respuesta sea una sola línea con la referencia**:

```text
done -> progress/informes/impl-selector-miembro.md
CAMBIOS_PEDIDOS (2 bloqueantes) -> progress/informes/revision-etapa-8.md
```

## Dónde vive cada cosa que escribimos

| Archivo | Qué es | ¿Se versiona? |
| --- | --- | --- |
| `docs/proyecto/09-estado-y-roadmap.md` | **Dónde estamos y qué falta.** La fuente de verdad del estado | sí |
| `progress/history.md` | **Cómo llegamos.** La bitácora: una entrada por día, no se reescribe hacia atrás | sí |
| `progress/current.md` | Qué se está haciendo **ahora**. Se escribe mientras se trabaja | sí |
| `progress/informes/` | Lo que escriben los subagentes en una sesión. Basura de trabajo | **no** |

La regla que las separa: el `09` responde *qué falta*, la bitácora responde *por qué terminó así*.
Mezclarlas es lo que infló el `09` a 930 líneas.

El `docs/proyecto/15-plan-plataforma.md` también habla de lo que falta, y eso está bien: dice **el orden y el detalle de
la fase en curso**, mientras el `09` dice **el estado global**. Los dos se actualizan (paso 3 del
ritual) y **cuando se contradigan, gana el `09`**. Lo que no puede aparecer es un *tercer* lugar —un
`feature_list.json`, un tablero paralelo— que repita el estado sin que nada avise cuando se
desincronice.

**Cuando el trabajo cruza áreas** —una feature que toca la API y el portal, que va a ser lo normal—:

1. La sesión principal parte el trabajo por área y **fija el contrato primero** (la forma del
   endpoint, el nombre de los campos). Dos agentes escribiendo las dos mitades de un contrato que
   nadie fijó producen dos mitades que no encajan.
2. Se delega **en serie** cuando comparten contrato: primero quien lo define, después quien lo
   consume. En paralelo solo lo genuinamente independiente.
3. **Integrar, verificar el conjunto y commitear es siempre de la sesión principal.** Ningún
   subagente commitea: el ritual de cierre (tests de la raíz, documentación, commit) se hace una vez,
   con todo el cambio a la vista.

## Credenciales y seguridad (reglas duras)

- Las keys van **solo** a archivos `.env` (gitignoreados). **Nunca** al chat, a un commit ni a la
  documentación. No le pidas keys al usuario; si hace falta una, decile qué variable poner y que la
  ponga él ("no me pases las keys" — confirma "listo").
- **Antes de cada commit**, verificá explícitamente que no se cuele `.env`, `node_modules`, `out/`
  ni `.cache/`. Los `.env.example` (plantillas sin valores) sí se commitean.
- Los **precios públicos** se pueden compartir en el chat; los secretos no.
- Tras correr DataForSEO en **producción**, **volvé a sandbox** (`kr-service/.env`).

## Git

- Rama por defecto: `main`. Commit + push a `main` al cerrar cada etapa. _(Hubo un período con `main`
  protegida que exigía PR; hoy está sin protección — si vuelve a estarlo y no hay `gh`, dejá la rama
  pusheada y pasá el link de compare.)_
- Mensajes de commit en español, y terminan con un `Co-Authored-By:` que nombra al **modelo que
  escribió el commit**, no una versión fija — la regla decía `Opus 4.8` hasta el 2026-08-01 y quedó
  vieja sola, así que la firma se toma de la sesión (el harness la indica). Hoy:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Stack y estilo de código

- **npm workspaces**, 7 paquetes: `contrato`, `db`, `kr-service` (M2), `web-builder` (M1),
  `orchestrator`, `api`, `renderer`. Más `portal/` (Angular) **fuera del monorepo a propósito** (su
  toolchain no se mezcla).
- **`contrato/` es el contrato del brief de keyword research, compartido** (KR-2a, 2026-08-05): los tipos,
  los **dos** validadores Zod y `renderReport`. Solo depende de `zod`; no conoce Postgres, ni HTTP, ni UI.
  Los dos validadores son dos **a propósito** y no se fusionan: `emisionM2` valida lo que el M2 **emite**
  (estricto, versión actual) y `consumoM1` lo que el M1 **puede recibir** (laxo, cuatro `schema_version`).
  **Si vas a validar o renderizar un brief, salís de acá** — un `z.object` con `paginas_propuestas`
  adentro escrito en otro paquete lo caza `contrato/src/una-sola-fuente.test.ts`.
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
  confirmá que cae _exactamente_ su test. Un test de seguridad que siempre pasa es peor que no tenerlo.
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
- **Un evento no porta autoridad**: la API crea la fila bajo RLS (ahí se autoriza) y _después_ emite
  el evento (ADR-18). Comando compuesto: fila primero, evento si no lanzó.
- **El acceso a la base es solo por transacción con conexión reservada** (`Tx`), nunca un `query()`
  suelto — el `set local` del contexto de tenant vive en la transacción (ADR-13).
- **El renderizador es la única pieza expuesta a internet anónimo.** El dominio ES la autorización
  (ADR-19); su rol `app_render` es el más pobre del sistema. Lo que le llega de `clients` pasa por
  una **allowlist** (columna generada `business_profile_publico`): al agregar un campo al perfil,
  agregalo a la allowlist o se filtra en silencio. Pregunta de diseño: _"si me lo toman, ¿qué se
  llevan?"_.
- **Storyblok: dos APIs que no se cruzan.** El orquestador **escribe** por la Management API; el
  renderizador **lee** por la Content Delivery API. El proceso anónimo nunca toca una credencial que
  pueda modificar el space.
- Cualquier valor que termine en `<style>`, `<img src>` o el HTML es **superficie de inyección**: se
  valida (hex, allowlist, http(s), escape) y se descarta lo que no pasa. En prod el dato puede venir
  de la base sin pasar por Zod — el renderizador revalida (defensa en profundidad).

## Cómo correr

Seguros: no tocan nada de afuera y corren sin credenciales.

```bash
npm install         # primero, o `npm test` falla con "Cannot find package 'tsx'" — no es un bug
npm run verificar   # TODO lo de abajo de una: entorno, arnés, secretos, typecheck y tests (~50s)
npm run verificar -- --rapido   # sin los tests (~5s), para iterar
npm test            # los 7 paquetes + los tests de scripts/ (~45s). NO incluye portal/
npm run typecheck   # tsc --noEmit en todos, incluido scripts/ (~5s)
npm run dev:server -w api        # la API real sobre PGlite (verificar el portal)
```

`portal/` **no es workspace**: sus tests no entran en `npm test`. `npm run verificar` los corre
aparte cuando detecta cambios en `portal/` (o siempre, con `-- --con-portal`). Los `*.spec.ts` de
componentes van por Karma: `npm --prefix portal run test:components`.

⚠️ **Tocan servicios reales, escriben credenciales o gastan dinero.** No los corras para "ver qué
pasa", y no se los permitas a un subagente ni a una revisión externa:

```bash
npm run env:sync    # reescribe los .env de cada paquete desde docs/private/credenciales.env
npm run reseed:demo -- --dry-run  # sin --dry-run, siembra de verdad en Supabase
npm run demo -w renderer          # pega contra el Storyblok REAL con credencial real
```

Y lo mismo vale para DataForSEO en modo producción: cada corrida se paga (ver la regla de volver a
sandbox en Credenciales).

Los `.env` de los paquetes son **generados**: se editan en `docs/private/credenciales.env` y se
reparten con `env:sync`. Cada paquete recibe solo sus claves — el reparto es la compartimentación
(ver [12-credenciales.md](docs/proyecto/12-credenciales.md)).
