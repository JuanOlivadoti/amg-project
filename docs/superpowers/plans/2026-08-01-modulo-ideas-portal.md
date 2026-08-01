# Pieza 3 — El módulo de ideas en el portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Leé primero el [programa](2026-08-01-portal-agencia-programa.md).** Ahí están el orden, la lista de
> qué no se toca, la reserva de números de migración (esta pieza usa `0013`) y la regla de la
> allowlist. Este plan asume todo eso.

**Goal:** que las ideas que el cliente manda por audio se puedan revisar, editar y aprobar/rechazar
desde el portal, con los datos en Postgres bajo RLS. Origen:
`dashboard-project/src/app/pages/idea` (104 líneas), `shared/components/idea/*` (3 cards),
`shared/components/tables/ideas-table`, y `core/models/idea.model.ts`.

**Rama:** `feature/modulo-ideas`. **Depende de:** pieza 1 (una idea pertenece a un cliente).

## Esto NO es un port: es funcionalidad nueva

Las otras piezas mueven pantallas sobre datos que AMG ya tiene o casi. Ideas **no existe** en AMG OS:
no hay tabla, ni endpoints, ni concepto. Hay que construir el módulo entero. Y hay un hecho que
cambia el alcance:

> **Las ideas no se crean en la aplicación.** `dashboard-project/src/app/core/services/ideas.service.ts`
> solo **lee** (`collectionData`, `collectionGroup`) y **actualiza** (`updateDoc`): no hay un solo
> `addDoc`. Las ideas entran por un flujo de **n8n** (`n8n workflows/Agency Dashboard - DEV (3).json`)
> que recibe un audio, lo transcribe, lo analiza y escribe en Firestore, en
> `clients/{clientId}/ideas`.

**Decidido:** esta pieza construye **el modelo, los endpoints y las pantallas**, con un **seed de
ejemplo** para poder verlas funcionando. **El ingreso real (n8n) se decide después** — pero el diseño
deja el hueco preparado y documentado, para que conectarlo luego no exija rehacer nada.

Lo que "dejar el hueco preparado" significa concretamente:

- La tabla admite todos los campos que n8n produce hoy (transcripción, análisis, checklist, ideas
  complementarias), aunque el portal todavía no los escriba.
- El estado nace en `nueva`, que es lo que n8n produciría.
- **Se anota, sin implementarlo,** que el ingreso será un endpoint de escritura autenticado con un
  secreto propio (HMAC), separado del token de usuario: n8n no es una persona y no debería llevar un
  JWT de nadie. Ese endpoint es de otro plan.
- **No se inventa el pipeline de audio.** Sin storage en AMG OS (ver el programa), `audio_url` y
  `carpeta_url` son **URLs a donde el audio ya vive**. Nada se sube.

## Architecture

```text
(futuro) n8n ─HMAC─►  POST /ideas          ← NO en esta pieza, solo el hueco documentado

portal/  pages/ideas/*  ──►  services/ideas.ts (signals)  ──►  core/api-core.ts
                                                                    ▼
api/     GET /ideas · GET /ideas/:id · PATCH /ideas/:id  ──►  db/ ideas.ts (bajo RLS)
                                                                    ▼
db/      migrations/0013_ideas.sql  ──►  tabla ideas (tenant_id, client_id, estado, análisis jsonb)
```

**Columna vs `jsonb`, igual criterio que en clientes:** columna para lo que se filtra y ordena
(`estado`, `client_id`, `titulo`, `creada_en`, `actualizada_en`); un `jsonb analisis` para el bloque
que produce el LLM y que solo se muestra (`audiencia_objetivo`, `canales_comunicacion`, `intencion`,
`materiales_formatos`, `observaciones`, `checklist_interpretacion`, `ideas_complementarias`,
`tipo_accion`). La tabla de ideas filtra por estado y por cliente; el análisis no se filtra nunca.

**El estado es una máquina, no un texto libre.** `nueva → en_revision → aprobada | rechazada`. Va como
enum de Postgres (`idea_estado`), no como `text`: un `text` acepta `'aprovada'` y nadie se enteraría
hasta que la pantalla filtre y no encuentre nada.

**Aislamiento:** `ideas` lleva `tenant_id` **y** `client_id`, con la **FK compuesta**
`(client_id, tenant_id) references clients (id, tenant_id)` — el mismo mecanismo que usa `kr_runs`
(`0001_init.sql`), que es lo que impide que una fila de un tenant referencie datos de otro. RLS
controla qué filas ves; la FK compuesta controla la integridad entre tablas. Hacen falta las dos.

**El rol `cliente` ve solo sus ideas.** Un `cliente` está atado a un `client_id`
(`cliente_exige_client_id`), así que su política es más estrecha que la de `equipo`/`maestro`. Esto va
con test, porque es exactamente el caso que la política vieja de `clients` resolvía mal (le mostraba
toda la cartera).

## Global Constraints

Las del [programa](2026-08-01-portal-agencia-programa.md#cómo-no-interrumpir-la-demo), más:

- **Las transcripciones son datos del cliente y son internas.** Ni el texto, ni el análisis, ni la URL
  del audio entran en la allowlist pública (regla 5 del programa). Test de fuga con mutación.
- **Una transcripción es una superficie de inyección.** Es texto generado a partir de un audio de
  WhatsApp: llega con lo que sea. En el portal se renderiza como **texto**, nunca como HTML
  (`innerHTML` prohibido); si algún día una idea alimenta al renderizador, pasa por `esc()` como todo
  lo demás.
- **El estado cambia por transiciones válidas, no por asignación libre.** `aprobada → nueva` no es una
  transición: se rechaza en la API y hay un test por cada transición inválida que importe.
- **`nueva` es el default de producción**, y por lo tanto lleva su propio test (un default sin test es
  una decisión sin dueño): insertar sin estado y verificar que queda `nueva`, sin que el test lo pase
  como parámetro.
- **El seed de ejemplo va en un archivo nuevo.** `db/src/seed-ideas-demo.ts`, con su propio CLI si hace
  falta. **No** se toca `db/src/seed-demo.ts` (producción está sembrada con él y dos tests lo atan:
  `seed-demo.test.ts` y `cartera-portal.test.ts`).

## Etapa 1 — El esquema (`db`)

- [ ] **Rojo primero** en `db/src/ideas.test.ts`: guardar y leer una idea con todo el análisis;
      insertar sin estado deja `nueva`; un estado inválido se rechaza; una idea con `client_id` de otro
      tenant se rechaza (FK compuesta); `analisis` que no es objeto se rechaza.
- [ ] Escribir `db/migrations/0013_ideas.sql`:
      - `create type idea_estado as enum ('nueva', 'en_revision', 'aprobada', 'rechazada')`.
      - `create table ideas (id, tenant_id, client_id, titulo, resumen, estado idea_estado not null
        default 'nueva', transcripcion text, audio_url text, carpeta_url text, mensaje_de text,
        analisis jsonb not null default '{}'::jsonb, creada_en, actualizada_en, ...)`.
      - FK compuesta `(client_id, tenant_id) references clients (id, tenant_id)`.
      - `check (jsonb_typeof(analisis) = 'object')` — la forma del valor, no solo el nombre de la clave.
      - `alter table ideas enable row level security` **y `force row level security`** (es lo que hace
        el resto del esquema: sin `force`, el dueño de la tabla se saltea las políticas).
      - Políticas: `equipo`/`maestro` ven las del tenant; `cliente` ve solo las de su `client_id`;
        `servicio` según lo que necesite el ingreso futuro (si no lo necesita hoy, **no** se le da).
      - `grant` a `app_user` sobre `ideas`. **Ningún grant a `app_render`.**
      - Índices: `(tenant_id, estado)`, `(tenant_id, client_id)`.
- [ ] Verificación por mutación de cada constraint, del `force row level security` y del default
      `nueva`.
- [ ] **Test de fuga:** una idea con transcripción y análisis cargados; leer como `app_render` y
      confirmar que no hay forma de llegar a ellos. Mutación: agregar un `grant select on ideas to
      app_render` en una copia local y confirmar que el test cae.
- [ ] **Test del rol `cliente`:** dos clientes en el mismo tenant, una idea cada uno; el `cliente` A
      ve una sola. Mutación: relajar la política a "todas las del tenant" y confirmar que cae.

## Etapa 2 — Datos y transiciones (`db`)

- [ ] **Rojo primero:** `listarIdeas` filtra por estado y por cliente; `cambiarEstado` acepta las
      transiciones válidas y rechaza el resto; `editarIdea` no permite cambiar `tenant_id` ni
      `client_id` (mover una idea de cliente es otra operación, y si no existe, no se ofrece).
- [ ] Implementar `db/src/ideas.ts` con el patrón de `db/src/store.ts` (`withTenant`, `Tx`).
- [ ] La máquina de estados vive en un solo lugar (`db/src/ideas.ts`, exportada) y **la usan la API y
      el portal** — no dos copias que se desincronizan. El portal la importa vía su propia constante si
      no puede importar el paquete; si se duplica, un test ata las dos copias (como hace
      `db/src/cartera-portal.test.ts` con el brief: el portal está fuera del monorepo, lo que impide
      importar el paquete, **no** leer el archivo).

## Etapa 3 — Endpoints (`api`)

- [ ] **Rojo primero**, un test por vector: sin token → 401; otro tenant → no ve; un `cliente` solo ve
      las suyas; `PATCH` con transición inválida → 400 (no 500); `PATCH` con `tenant_id` en el body →
      se ignora; `PATCH` de una idea de otro tenant → 404 sin revelar existencia.
- [ ] `GET /ideas` (con filtros `estado` y `client_id`), `GET /ideas/:id`, `PATCH /ideas/:id`
      (contenido y estado).
- [ ] ¿Aprobar una idea dispara algo? Hoy, no. **No se inventa un evento**: si en el futuro una idea
      aprobada arranca un research, será fila primero y evento después (ADR-18), y lo decide otro plan.
- [ ] `api/src/dev-server.ts` con ideas de ejemplo sobre PGlite.

## Etapa 4 — El seed de ejemplo

- [ ] `db/src/seed-ideas-demo.ts` (**archivo nuevo**): un puñado de ideas para La Birra Bar en los
      cuatro estados, con transcripción y análisis realistas pero **claramente de ejemplo** — que nadie
      las confunda con datos de un cliente. Idempotente por id fijo, como `sembrarDemo`.
- [ ] Su test: sembrar dos veces no duplica; las ideas sembradas se leen bajo RLS con el rol correcto.
- [ ] **No** engancharlo al `reseed:demo` de producción sin pedirlo: producción tiene datos reales de
      la demo y este seed es para desarrollo. Si se quiere en producción, es una decisión aparte.

## Etapa 5 — Las pantallas

- [ ] **`/ideas` (listado).** Portar `ideas-table` + los filtros (búsqueda, cliente, estado). Con
      signals y `computed`, no con un `subscribe` que reasigna.
- [ ] **`/ideas/:id` (detalle).** Portar `idea.component` con `idea-header-card`, `idea-info-card` y
      `idea-edit-form`. El audio se ofrece como **enlace** a `audio_url` (o un `<audio>` si la URL lo
      permite), nunca subiendo nada.
- [ ] La transcripción y el análisis se renderizan como texto. Si el análisis viene con listas
      (`canales_comunicacion`, `materiales_formatos`, `ideas_complementarias`), se listan; **nada de
      `innerHTML`**.
- [ ] Aprobar/rechazar: acciones explícitas, con el estado reflejado en la UI y las transiciones
      inválidas deshabilitadas (y **también** rechazadas en el servidor: deshabilitar un botón no es
      autorización).
- [ ] Tests de componente (Karma) del listado y del cambio de estado.

## Etapa 6 — Rutas, navegación y cierre

- [ ] Rutas `loadComponent` bajo `authGuard`, item aditivo en `ITEMS_NAV` + su `.spec.ts`. **Sin
      tocar** el `redirectTo: 'runs'`.
- [ ] **Navegador** contra `npm run dev:server -w api`: listar, filtrar, abrir una idea, editarla,
      aprobarla, intentar una transición inválida. **En tema claro y oscuro.** Consola sin errores.
- [ ] Confirmar `/runs`, `/runs/:id` y `/cartera` intactas.
- [ ] `npm test` + `npm run typecheck` desde la raíz, `npm test -w portal`,
      `npm run test:components -w portal`, comparado con la línea base.
- [ ] Auto-revisión adversarial, docs actualizadas (`09`, `11`), cifras sincronizadas, pieza marcada en
      el [programa](2026-08-01-portal-agencia-programa.md).
- [ ] **Informe de cierre con el hueco explícito:** el ingreso real no existe todavía. Decirlo en la
      documentación y en la propia pantalla si hace falta ("las ideas entran por el flujo de audio —
      pendiente de conectar"), para que nadie crea que está enchufado.

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| Una transcripción o el audio se filtran al renderizador anónimo | Test de fuga con mutación; ningún `grant` a `app_render` |
| Un `cliente` ve las ideas de otro cliente del mismo tenant | Política estrecha por `client_id` + su test con mutación |
| El estado se corrompe (`'aprovada'`) o retrocede | Enum de Postgres + máquina de transiciones en un solo lugar, validada en la API |
| La pantalla parece enchufada al pipeline de audio y no lo está | Informe de cierre + aviso en la UI. El seed es "de ejemplo" y se nota |
| El módulo se construye asumiendo storage que no existe | `audio_url` es una URL externa. Subir archivos es otro plan |
| Dos copias de la máquina de estados (db y portal) se desincronizan | Un test que ata las dos, como `cartera-portal.test.ts` |
