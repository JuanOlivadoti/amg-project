# Despliegue — Fase 1: el portal de Frank en pre-producción

> **Estado:** ✅ Bloque A (código) COMPLETO — listo para el Bloque B (cuentas de Juan) · **Última
> actualización:** 2026-07-23
>
> **Progreso:** A.1 runner ✅ · A.2 seed ✅ · A.3 config del portal ✅ · A.4 CORS de la api ✅ · A.5
> ocultar "lanzar research" ✅. Falta el Bloque B (cuentas/credenciales) y el C (deploy).
> Detalle al final, en **§13. Registro de ejecución**.
>
> Este documento es **el plan acordado** para poner el portal en un dominio, funcionando como
> pre-producción, para mostrárselo a Frank. Nace de una conversación de alineación: lo que entra, lo
> que **no**, y quién hace cada paso. Si algo acá no coincide con lo que esperás, es un error del plan
> y se corrige antes de tocar una cuenta.

---

## 1. El objetivo, en una frase

Que **Frank entre a un dominio, se loguee, y vea la plataforma real funcionando** —el research, los
briefs por evidencia, la compuerta de aprobación— con el caso de **Bella Napoli** ya cargado. Un
panel de control vivo, no una maqueta.

## 2. Qué entra y qué NO (para que no haya malentendidos)

| | Fase 1 (esto) | Queda para después |
|---|---|---|
| **El portal** (panel de Frank) | ✅ Desplegado en un dominio | |
| **La `api`** (backend del portal) | ✅ Desplegada (lo necesita el portal) | |
| **La base** (Postgres + login) | ✅ Desplegada (Supabase) | |
| **Contenido** | ✅ Bella Napoli pre-cargado | |
| **Lanzar research EN VIVO** | ❌ No | Fase 2 (orquestador + Inngest) |
| **Las webs de cliente** (renderizador) | ❌ No | Fase 2 (cuando la Fase 1 esté desplegada) |

> **Decisión tomada:** esta es una demo **"read-mostly"** (Nivel 1). Frank *ve* todo; *lanzar* una
> corrida nueva en vivo es Fase 2 — porque eso suma el orquestador, Inngest y DataForSEO en
> producción, y no queremos que una corrida en vivo falle delante del cliente en la primera demo.

## 3. Por qué "subir el portal a Hostinger" no alcanza (el punto clave)

El portal es una **app de Angular = archivos estáticos**. Es la *cara*. Todo lo que hace —login,
listar research, ver briefs, aprobar— vive en el **backend**: la `api` (Node), **Postgres** y
**Supabase** (auth).

- Hostinger (shared) **sí** puede servir los archivos estáticos del portal.
- Hostinger (shared) **no** puede correr la `api` (Node) ni Postgres.

Por eso el portal **solo** en Hostinger se vería lindo pero muerto. El backend va a **PaaS
gestionado**. Hostinger, si querés, queda como **registrador del dominio** y/o host del estático.

## 4. La arquitectura de la demo

```
                    app.tudominio.com                 api.tudominio.com
   navegador  ──▶  PORTAL (Angular estático)  ──▶  API (Node, Hono)  ──▶  Postgres (Supabase)
   (Frank)          Cloudflare Pages / Hostinger      Railway              + Supabase Auth (login)
                                                          │
                                            contenido de Bella Napoli
                                            pre-cargado (acción 06 → seed)
```

## 5. Las piezas y dónde viven

| Pieza | Dónde | Costo | Notas |
|---|---|---|---|
| **portal** (estático) | Cloudflare Pages *(o Hostinger)* | gratis | `ng build` → archivos. Auto-deploy desde GitHub en Pages. |
| **api** (Node) | Railway *(o Render)* | gratis / ~$5 mes | Auto-deploy desde GitHub. `npm run serve -w api`. |
| **Postgres + Auth** | Supabase | gratis | Postgres real: soporta los roles y la RLS. El login ya usa su JWT. |
| **dominio** | el registrador que elijas | ~$10–15/año | `app.` → portal, `api.` → api. |

## 6. Supuestos (corregí lo que no cuadre)

- **Usuarios del portal:** Frank y Juan (roles `maestro`/`equipo`).
- **Contenido:** Bella Napoli (el restaurante de demo que ya está en Storyblok y en las pruebas).
- **Presupuesto:** free tier donde se pueda.
- **Storyblok:** el space ya existe (de las acciones previas); en Fase 1 no se toca.

---

## 7. Los pasos, en orden

Divididos por **quién** los hace. Los de código son míos y se hacen **primero** (así desplegar es
pegar credenciales y hacer click).

### A. Prerequisitos de código — **los preparo yo, antes de tocar ninguna cuenta**

1. **Runner de migraciones contra una base remota.** ✅ **Hecho.** `db/src/deploy.ts`
   (`migrarConRegistro`) + CLI `db/src/cli/deploy.ts` (`npm run migrate:deploy -w db`). Aplica las
   migraciones pendientes en orden, cada una en su transacción, y las anota en `app.migraciones_aplicadas`
   → **idempotente**: re-correr no re-aplica ni rompe. Los roles (`amg_api`/`amg_render`/…) y la RLS
   ya los crean las migraciones (0003/0007); el runner solo las aplica de forma segura y repetible.
   Tests contra PGlite (incluida verificación por mutación de la idempotencia).
   > **Credencial:** usa `DATABASE_URL_ADMIN` (superusuario `postgres` de Supabase), **no** `amg_api`:
   > las migraciones crean roles y `amg_api` no puede. Es el único uso de esa credencial de admin.
2. **Script de seed (lo que hace que el portal tenga algo que mostrar).** ✅ **Hecho.**
   `db/src/seed-demo.ts` (`sembrarBellaNapoli`) + CLI `db/src/cli/seed.ts` (`npm run seed:demo -w db`).
   Carga:
   - los **usuarios** Frank (`maestro`) y Juan (`equipo`) con sus membresías — sus UUID entran por
     `SEED_FRANK_USER_ID` / `SEED_JUAN_USER_ID` (los `sub` de Supabase Auth, que se crean antes);
   - un **run completo de Bella Napoli** (acción 06): `pending_approval`, 8 páginas, **3 respaldadas
     por datos + 5 `sin_validar`**, `approved = false` (la compuerta la cruza Frank en vivo).
   **Idempotente** (upsert por slug/usuario; el run de demo se borra y recrea). Los tests leen lo
   sembrado **bajo RLS** (como Frank/Juan/un intruso): prueban lo que el portal mostrará, no el insert.
3. **Config de producción del portal.** ✅ **Hecho.** `portal/src/environments/environment.prod.ts`
   (nuevo) + `fileReplacements` en `angular.json` (config `production`): `ng build` reemplaza el
   `environment.ts` de dev por el de prod. Juan completa 3 valores (no secretos) antes del build:
   `apiBaseUrl` (api de Railway), `supabaseUrl` y `supabaseAnonKey`. Verificado: el build de prod
   inlinea los valores de prod y **no** cuela `localhost`.
4. **CORS de la api.** ✅ **Hecho.** `leerConfig()` ahora **falla cerrado si falta `CORS_ORIGINS`**:
   el arranque de producción no sirve con `*`. (Antes era un default silencioso; ahora es una
   invariante impuesta, con test —incluida verificación por mutación—.) Juan pone
   `CORS_ORIGINS=https://app.tudominio.com` en Railway.
5. **El botón de "lanzar research".** ✅ **Hecho** (decisión: ocultarlo, §10). Flag
   `features.lanzarResearch` en `environment`: `false` en prod (Fase 1), `true` en dev. El formulario
   de `runs.ts` se muestra solo si `mostrarLanzarResearch(esEquipo, flag)` —función pura en
   `portal/src/app/core/features.ts`, testeada—: en Fase 1 ni el equipo lo ve. Se reenciende en Fase 2.

### B. Cuentas y credenciales — **las hacés vos** (no me pases las keys; van al gestor de secretos)

1. **Comprar el dominio** (Hostinger u otro registrador).
2. **Crear un proyecto en Supabase.** De ahí salen: las *connection strings* (para `amg_api`), el
   **JWT secret**, y la **URL + anon key** del proyecto.
3. **Crear cuenta en Railway** (o Render) y conectarla al repo de GitHub.
4. **Crear cuenta en Cloudflare Pages** (o usar el hosting estático de Hostinger).
5. **Las keys de OpenAI/DataForSEO** ya las tenés — se usan una vez para la corrida de seed (§C.2).

### C. El deploy — **juntos, en este orden**

1. **Base:** aplicar las migraciones contra Supabase (`DATABASE_URL_ADMIN=… npm run migrate:deploy -w db`).
   Crean el esquema, los roles **sin contraseña** y la RLS.
2. **Contraseñas de los roles.** Las migraciones dejan `amg_api`/`amg_render`/`amg_cache`/`amg_orquestador`
   **sin contraseña**: sin este paso, `DATABASE_URL_API` no conecta y la API no arranca. Ponerlas con
   los `alter role … with password` de **[`12-credenciales.md`](12-credenciales.md#al-desplegar-en-supabase)**
   y armar las `DATABASE_URL_*`. *(Lo señaló la 10ª review, #1: estaba documentado en el doc hermano
   pero este plan no lo enlazaba.)*
3. **Usuarios de Frank y Juan** en Supabase Auth (antes del seed: sus `sub` son parámetros del seed).
   En el `app_metadata` de cada uno: `{ "tenant_id": "<el del seed>", "rol": "maestro"|"equipo" }`.
4. **Seed:** `DATABASE_URL_ADMIN=… SEED_FRANK_USER_ID=… SEED_JUAN_USER_ID=… npm run seed:demo -w db`.
   Imprime el `tenant_id` para el paso anterior (si aún no lo tenías, corré el seed, tomá el
   `tenant_id`, completá el `app_metadata`, y listo).
5. **API:** desplegar en Railway con sus variables (§8, incluida `CORS_ORIGINS`). Verificar que
   **`GET /health` responda 200** (ruta pública, sin token — existe desde la ronda de review).
6. **Portal:** completar `environment.prod.ts` (el `prebuild` rechaza placeholders) → `npm run build`
   → subir a Pages/Hostinger.
7. **Dominio:** apuntar `app.` → portal y `api.` → api. El TLS lo pone el PaaS solo.
8. **Verificar de punta a punta:** Frank entra, ve el research de Bella Napoli, navega la compuerta,
   y **NO ve** el formulario de "lanzar research" ni el botón "Aprobar el run" (confirmarlo en el
   navegador con su sesión: es la parte de A.5 que los tests no ven).

---

## 8. Variables de entorno (checklist, confirmadas contra el código)

**deploy de base** (una vez, y al agregar migraciones — `db/src/cli`):

| Variable | Qué es |
|---|---|
| `DATABASE_URL_ADMIN` | Conexión de **admin** (superusuario `postgres` de Supabase). Crea roles y esquema. Solo la usan `migrate:deploy` y `seed:demo`; **no** es la de la API. |
| `SEED_FRANK_USER_ID` / `SEED_JUAN_USER_ID` | Los `sub` (UUID) de Frank y Juan en Supabase Auth. Solo para `seed:demo`. |

**api** (`npm run serve -w api`, falla cerrado si falta algo):

| Variable | Qué es |
|---|---|
| `DATABASE_URL_API` | Conexión del login `amg_api` (→ rol `app_user`). |
| `SUPABASE_JWT_SECRET` | Para verificar la firma del token de login. |
| `CORS_ORIGINS` | El origen del portal (ej. `https://app.tudominio.com`). |
| `SUPABASE_JWT_ISS` / `SUPABASE_JWT_AUD` | *(recomendado)* cierran la puerta a tokens de otro proyecto Supabase. |
| `PORT` | Lo inyecta Railway automáticamente. |

**portal** (build de Angular — se completan en `environment.prod.ts`, **no** son env vars; el build
las inlinea. Ninguna es secreta):

| Valor en `environment.prod.ts` | Qué es |
|---|---|
| `apiBaseUrl` | La api desplegada, ej. `https://api.tudominio.com`. |
| `supabaseUrl` + `supabaseAnonKey` | Para el login. La anon key es pública por diseño (RLS autoriza, no la clave). |
| `features.lanzarResearch` | **Ya fijado en `false`** para Fase 1. No tocar; se enciende en Fase 2. |

## 9. Seguridad del despliegue (no negociable)

- **Las migraciones crean los roles y la RLS.** Sin correrlas, la seguridad del proyecto (ADR-15/17)
  no existe: es esas políticas, no un `if`.
- **Los secretos van al gestor del host**, nunca al repo ni al chat (misma regla del `.env`).
- **HTTPS en todo** (el TLS lo dan Railway/Pages solos).
- **CORS restringido** al origen del portal, no `*`.
- **JWT con `iss`/`aud` fijados** al proyecto Supabase.

## 10. Costos y cosas a decidir

**Costo estimado:** dominio ~$10–15/año · Supabase/Pages gratis · Railway gratis o ~$5/mes ·
la corrida de seed (acción 06) ~$0.31, una vez. → **~$0–5/mes** para la demo.

**Decisiones abiertas:**
- **Cold start de Railway.** El free tier duerme el servicio; para una demo en vivo con Frank, el
  plan hobby (~$5/mes) evita que la primera carga tarde. *(Recomiendo hobby para la demo.)*
- ~~**El botón "lanzar research"** (§A.5).~~ **Decidido: ocultarlo en Fase 1** (hecho, `features.lanzarResearch=false`).
- **Hosting del portal:** Cloudflare Pages (gratis, auto-deploy desde GitHub) vs Hostinger (si ya lo
  vas a usar de registrador). Recomiendo Pages; es menos fricción.

## 11. Cómo sabremos que salió bien

- [ ] Frank abre `https://app.tudominio.com` y ve la pantalla de login.
- [ ] Se loguea con su usuario.
- [ ] Ve el research de **Bella Napoli**: clusters, brief por evidencia (✅ respaldadas / ⚠️ sin validar).
- [ ] Navega la **compuerta de aprobación** (aunque en Fase 1 no publique en vivo).
- [ ] Nada tira un error de CORS ni de conexión a la base.

## 12. Qué sigue (Fase 2, cuando esto esté arriba)

- **Research en vivo:** desplegar el **orquestador + Inngest Cloud** → el botón "lanzar" cobra vida.
- **Las webs de cliente:** desplegar el **renderizador + CDN**, con el dominio de cada cliente
  apuntando al servicio (ADR-19). Es el "momento ajá" de la demo, y el paso que convierte esto de
  "les generamos contenido" en "su equipo edita y sirve su web".

---

## 13. Registro de ejecución

### 2026-07-23 — Bloque A: A.1 (runner) y A.2 (seed) ✅

**Qué se hizo.** Los dos prerequisitos de código que hacen que desplegar sea "pegar credenciales y
click":

- **A.1 — Runner de migraciones.** `db/src/deploy.ts` + `db/src/cli/deploy.ts`. Aplica las
  migraciones pendientes en orden, con registro en `app.migraciones_aplicadas` → idempotente.
  Correr: `DATABASE_URL_ADMIN=… npm run migrate:deploy -w db`.
- **A.2 — Seed de Bella Napoli.** `db/src/seed-demo.ts` + `db/src/cli/seed.ts`. Correr:
  `DATABASE_URL_ADMIN=… SEED_FRANK_USER_ID=… SEED_JUAN_USER_ID=… npm run seed:demo -w db`. Imprime el
  `tenant_id` y qué poner en el `app_metadata` de cada usuario en Supabase Auth.

**Verde:** `npm test` (db: 111 tests, incl. runner + seed bajo RLS + verificación por mutación) y
`npm run typecheck` (6 paquetes) en verde el 2026-07-23.

**Dos hallazgos de leer el código (afinan A.3 y A.5):**

1. **El portal NO renderiza `content_brief` / `seo` / `preguntas_frecuentes`.** La tarjeta de brief
   (`portal/.../brief.ts`) muestra `keyword_principal`, `url_slug`, volumen, KD, `opportunity_score`,
   evidencia y estado de aprobación — nada más. **Lo vendible visible es el split ✅3/⚠️5 con números
   realistas**, no el detalle del brief. El seed carga igual el `content_brief` (es la forma real del
   dato y lo devuelve la API), pero la demo no depende de él. Si se quiere mostrar el brief completo,
   es trabajo de portal aparte, no del seed.
2. **El botón "Lanzar research" (§A.5) es el `<form>` de `portal/.../runs.ts`, visible bajo
   `auth.esEquipo()`.** Frank es `maestro` → hoy lo vería. A.5 = ocultar ese formulario en Fase 1
   (recomendado en §10). Ahí también está el botón "Aprobar el run y publicar" del brief: decidir si
   en Nivel 1 la aprobación queda visible (no publica en vivo, pero sí cambia el estado en la base).

**Orden que impone A.2 (matiz sobre §7.C).** Las membresías necesitan los `sub` de Supabase Auth, así
que **los usuarios de Frank y Juan se crean ANTES del seed** (o el seed se re-corre después con los
IDs). El paso §C.6 ("crear el usuario de Frank") sube de orden: va antes de §C.2 (seed), no al final.

**Falta del Bloque A:** A.3 (config de prod del portal → apuntar a la api desplegada + URL/anon key
de Supabase), A.4 (CORS de la api), A.5 (ocultar "lanzar research").

### 2026-07-23 (cont.) — Bloque A completo: A.3, A.4, A.5 ✅

- **A.3 — Config de prod del portal.** `portal/src/environments/environment.prod.ts` + `fileReplacements`
  en `angular.json`. Verificado con `ng build --configuration production`: el bundle inlinea los
  valores de prod y **no** cuela `localhost:3000`.
- **A.4 — CORS de la api.** `leerConfig()` ahora exige `CORS_ORIGINS` (falla cerrado): producción no
  arranca con `*`. Tests nuevos en `api/src/deps.test.ts` (antes `leerConfig` no tenía ninguno).
- **A.5 — Ocultar "lanzar research".** Flag `features.lanzarResearch` (`false` en prod) + función pura
  `mostrarLanzarResearch` (`portal/src/app/core/features.ts`, testeada), cableada en `runs.ts`.

**Verde el 2026-07-23:** monorepo `npm test` (db 111, api 88, resto sin cambios) + `npm run typecheck`
(6 paquetes); portal `npm test` (33) + `ng build` de prod OK. Verificación por mutación en A.4.
**Nota:** el ocultamiento del botón EN PROD no se manejó en navegador porque necesita Supabase
desplegado (Bloque B); queda cubierto por el test unitario + la inspección del bundle de prod. En la
verificación de punta a punta (§C.7) hay que **confirmarlo en el navegador** con la sesión de Frank.

**El Bloque A está cerrado.** El código está listo para que desplegar sea "pegar credenciales y
click": siguen el Bloque B (cuentas de Juan) y el C (deploy).

### 2026-07-23 (cont.) — Ronda de review de Codex: 12 hallazgos ✅

Codex revisó el Bloque A (solo revisa, no toca código — ver `CLAUDE.md`). Se corrigieron todos los
hallazgos válidos; con TDD y verificación por mutación donde aplicaba:

- **#9 (registro auto-bloqueante):** el registro de migraciones ya **no** usa `force RLS` (se
  auto-bloquearía si el rol de deploy de Supabase no tiene `BYPASSRLS`). Protegido por falta de grants.
- **#8 (ADR-13 no impuesto):** el runner y el seed ahora reciben una `ConexionReservada` (una sola
  conexión, sin constructor público) en vez de una interfaz suelta que un `Pool` podía cumplir.
- **#12 (deriva de migraciones):** el registro guarda **checksum SHA-256**; editar una migración
  aplicada aborta en vez de correr en silencio.
- **#3 + #10 (seed destructivo / cliente por nombre):** IDs fijos de demo + `on conflict (id)`; se
  reemplaza **solo** el run de demo. Test nuevo: un run ajeno del cliente **sobrevive** al re-seed.
- **#7 (CORS `*`/vacíos):** `leerConfig` ahora **rechaza** `*`, orígenes vacíos y los que no son URL
  http(s) completa. "No `*` en prod" pasó de comentario a invariante con test.
- **#5 (`/health` inexistente):** `GET /health` público (sin token), con test. El §C.5 ya es real.
- **#2 (aprobar-run en Fase 1):** el botón "Aprobar el run y publicar" se **oculta** con
  `features.aprobarRun=false` (emitía un evento sin orquestador). Frank aprueba **páginas** igual.
- **#4 (falso verde de A.5):** el `npm test` puro no fijaba ni el default de prod ni el `@if`. Se
  agregó un test que importa `environment.prod.ts` (flags en `false`) y **specs de componente (karma
  headless)** que renderizan `RunsPage`/`BriefPage` y comprueban el DOM. Mutación confirmada: ignorar
  el gate tumba el spec.
- **#11 (contrato "a través de la API"):** test de integración nuevo `api/src/seed-integracion.test.ts`
  (seed → `GET /runs`/`GET /runs/:id` como Frank/Juan/intruso, por HTTP). Comentario del test del seed
  corregido (prueba RLS, no HTTP).
- **#6 (build con placeholders):** `prebuild` que **frena** `npm run build` si `environment.prod.ts`
  tiene placeholders o URLs no-HTTPS (`portal/src/environments/config-check.ts`, testeado).
- **#1 (contraseña de `amg_api`):** NO era un bloqueo — está documentado en `12-credenciales.md`. Se
  agregó el cross-reference y el paso explícito en §C.2.

**Verde el 2026-07-23:** monorepo `npm test` (db 114, api 45; 429 en total) + `npm run typecheck`
(6 paquetes); portal `npm test` (45 puros) + `npm run test:components` (5, karma headless) + el
`prebuild` frena el `ng build` con placeholders.
