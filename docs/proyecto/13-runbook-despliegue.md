# Runbook de despliegue — Fase 1 (el portal de Frank)

> **Qué es esto:** la versión "hacé esto, pegá aquello, verificá esto otro" del plan
> ([12-despliegue-fase-1.md](12-despliegue-fase-1.md)). El plan dice el *qué* y el *por qué*; esto es
> el *cómo*, paso a paso, para ejecutar de una sentada. **Todo el código ya está listo** (Bloque A):
> acá no se programa, se despliega.
>
> **Regla de oro:** los secretos (contraseñas, JWT secret, connection strings) van al gestor de
> secretos del host (Railway/Supabase), **nunca al repo ni al chat**. Las plantillas `.env.example`
> dicen *qué* poner, no los valores.

---

## 0. Preflight — qué tenés que tener a mano

- [ ] Una cuenta de **Supabase** (base + auth).
- [ ] Una cuenta de **Railway** (la API), conectada a tu GitHub.
- [ ] Una cuenta de **Cloudflare Pages** (el portal estático), conectada a tu GitHub.
- [ ] Un **dominio** (Hostinger u otro registrador) — para `app.` y `api.`.
- [ ] El repo pusheado a GitHub (ya está: `main`).

---

## Bloque B — crear las cuentas (tus pasos)

### B.1 — Proyecto de Supabase
1. Nuevo proyecto. Elegí región cercana (Europa, para Madrid).
2. Anotá (de **Project Settings**):
   - **Database → Connection string (URI)** con el rol `postgres`: es tu `DATABASE_URL_ADMIN`.
   - **API → Project URL** (`https://xxxx.supabase.co`) y **anon key**: para el portal.
   - **API → JWT Settings → JWT Secret**: para la API.

### B.2 — Railway y Cloudflare Pages
- Railway: creá un proyecto vacío, lo configuramos en C.5.
- Cloudflare Pages: lo conectás al repo en C.6.

---

## Bloque C — el deploy (en este orden EXACTO)

El orden importa: la base antes que todo, los usuarios antes que el seed, la API antes que el portal.

### C.1 — Aplicar las migraciones (esquema + roles + RLS)

Desde tu máquina, con la conexión de admin de Supabase:

```bash
DATABASE_URL_ADMIN="postgres://postgres:PASS@HOST:5432/postgres" npm run migrate:deploy -w db
```

**Verificá:** imprime `+ 0001_init.sql … + 0009_marca_publica.sql` y `✔ Aplicadas 9 migración(es)`.
Es idempotente: si lo corrés de nuevo, dice "ya estaba al día".

### C.2 — Poner contraseña a los roles

Las migraciones crean los logins **sin contraseña**. Sin esto, `DATABASE_URL_API` no conecta.
En el **SQL Editor** de Supabase (o `psql` con la conexión de admin):

```sql
alter role amg_api         with password 'PONÉ-UNA-FUERTE';
alter role amg_render      with password 'PONÉ-OTRA';
alter role amg_cache       with password 'PONÉ-OTRA';
alter role amg_orquestador with password 'PONÉ-OTRA';
```

> En Fase 1 solo se usa `amg_api`. Las otras tres se ponen igual ahora (son de Fase 2) para no volver.
> Detalle en [12-credenciales.md](12-credenciales.md#al-desplegar-en-supabase).

**Armá `DATABASE_URL_API`** (la vas a usar en C.5):
`postgres://amg_api:LA-PASS-DE-AMG_API@HOST:5432/postgres`

### C.3 — Crear los usuarios de Frank y Juan (antes del seed)

En Supabase → **Authentication → Users → Add user** (email + password). Creá **Frank** y **Juan**.
Anotá el **User UID** (uuid) de cada uno — son parámetros del seed.

### C.4 — Seed del caso de Bella Napoli

```bash
DATABASE_URL_ADMIN="postgres://postgres:PASS@HOST:5432/postgres" \
SEED_FRANK_USER_ID="<uid de Frank>" \
SEED_JUAN_USER_ID="<uid de Juan>" \
npm run seed:demo -w db
```

**Verificá:** imprime `✔ Sembrado el caso de Bella Napoli`, el `tenant_id`, y qué poner en el
`app_metadata`. **Copiá el `tenant_id`.**

Ahora, en Supabase → Authentication → cada usuario → **User Metadata** (el `app_metadata`, el que el
usuario NO puede editar), poné:

```json
// Frank
{ "tenant_id": "<el tenant_id del seed>", "rol": "maestro" }
// Juan
{ "tenant_id": "<el tenant_id del seed>", "rol": "equipo" }
```

> El portal lee el `tenant_id` de ahí y lo manda en el header `x-amg-tenant`. El `rol` es solo para
> mostrar/ocultar botones; la autorización real la deriva RLS de `memberships` (ADR-15/20).

### C.5 — Desplegar la API en Railway

1. **New Service → Deploy from GitHub repo** → elegí este repo.
2. **Settings:**
   - **Root Directory:** la raíz del repo (dejar vacío / `/`).
   - **Start Command:** `npm run serve -w api`
   - **Health Check Path:** `/health`
3. **Variables** (Settings → Variables) — de la plantilla [`api/.env.example`](../../api/.env.example):
   - `DATABASE_URL_API` = la de C.2 (login `amg_api`).
   - `SUPABASE_JWT_SECRET` = el JWT Secret de B.1.
   - `CORS_ORIGINS` = `https://app.tudominio.com` (el dominio del portal; **sin `*`**, lo rechaza).
   - `SUPABASE_JWT_ISS` = `https://xxxx.supabase.co/auth/v1` (recomendado).
   - **`NPM_CONFIG_PRODUCTION=false`** ⚠️ **importante:** el server corre con `tsx` (no hay paso de
     build). `tsx` es una devDependency; si Railway instala en modo producción, `npm run serve`
     fallaría con "tsx: not found". Esta variable fuerza a instalar también las devDependencies.
4. **Deploy.** Cuando termine, Railway te da una URL tipo `https://amg-api-production.up.railway.app`.

**Verificá:** abrí `https://esa-url/health` → debe responder `{"status":"ok"}` (sin login).

### C.6 — Desplegar el portal en Cloudflare Pages

1. **Antes de nada, completá [`portal/src/environments/environment.prod.ts`](../../portal/src/environments/environment.prod.ts)**
   (3 valores, ninguno secreto) y **commiteá + pusheá**:
   - `apiBaseUrl` = la URL de la API de C.5 (o `https://api.tudominio.com` si ya vas a apuntar el DNS).
   - `supabaseUrl` = el Project URL de B.1.
   - `supabaseAnonKey` = la anon key de B.1.
   > No toques `features.*`: están fijados en `false` para Fase 1 a propósito. Si dejás un placeholder,
   > el `prebuild` **frena el build** y te avisa cuál.
2. Cloudflare Pages → **Create a project → Connect to Git** → este repo.
3. **Build settings:**
   - **Framework preset:** None (o Angular).
   - **Build command:** `npm ci && npm run build -w portal` *(o, con el subdirectorio del portal como
     root: `npm ci && npm run build`)*.
   - **Build output directory:** `portal/dist/portal/browser`.
4. **Deploy.**

**Verificá:**
- La home carga.
- **Entrá directo a una ruta profunda** (ej. `.../runs`) y **recargá**: debe cargar, no dar 404
  (lo garantiza `portal/public/_redirects` → `/* /index.html 200`). Si da 404, el `_redirects` no
  llegó al output: revisá el build output directory.

### C.7 — Dominios

En tu registrador / Cloudflare DNS:
- `app.tudominio.com` → el portal de Pages (CNAME al proyecto de Pages).
- `api.tudominio.com` → la API de Railway (CNAME al dominio de Railway; en Railway, Settings →
  Networking → Custom Domain).

Si cambiaste `apiBaseUrl`/`CORS_ORIGINS` para usar `api.tudominio.com`/`app.tudominio.com`, asegurate
de que **coincidan**: el `CORS_ORIGINS` de la API debe ser exactamente el origen del portal, y el
`apiBaseUrl` del portal debe ser exactamente la URL de la API. El TLS lo ponen Railway/Pages solos.

### C.8 — Verificación de punta a punta (con Frank)

- [ ] `https://app.tudominio.com` abre la pantalla de login.
- [ ] Frank se loguea con su usuario de Supabase.
- [ ] Ve el research de **Bella Napoli**: el split **✅ 3 respaldadas / ⚠️ 5 sin validar**.
- [ ] Entra a un run, ve las páginas, y **puede aprobar una página** (la compuerta).
- [ ] **NO ve** el formulario "Lanzar un research" ni el botón "Aprobar el run y publicar"
      (ocultos en Fase 1). ← confirmarlo en el navegador; es lo que los tests no ven en prod.
- [ ] Recargar en una ruta profunda no da 404. La consola no tira errores de CORS ni de conexión.

---

## Troubleshooting (los errores que más probablemente veas)

| Síntoma | Causa probable | Fix |
|---|---|---|
| La API no arranca, log dice `Faltan variables de entorno` | Falta una var obligatoria en Railway | Completá `DATABASE_URL_API`, `SUPABASE_JWT_SECRET`, `CORS_ORIGINS`. |
| La API no arranca, `tsx: not found` | Railway instaló sin devDependencies | Agregá la variable `NPM_CONFIG_PRODUCTION=false` y redesplegá. |
| La API no arranca, error sobre `CORS_ORIGINS` | Pusiste `*`, vacío, o una URL sin esquema | Poné el origen completo, ej. `https://app.tudominio.com`. |
| `/health` da 404 | La URL o el service están mal | Es `GET /health` en la raíz de la API, sin `/api` adelante. |
| El portal carga pero el login/llamadas fallan con error de CORS | `CORS_ORIGINS` de la API ≠ origen real del portal | Que sean idénticos (esquema+host, sin barra final). |
| Recargar en `/runs/:id` da 404 | Falta el fallback de SPA en el output | `portal/public/_redirects` debe estar en `dist/portal/browser/_redirects`; revisá el output dir. |
| Login OK pero Frank no ve nada | El `app_metadata.tenant_id` no coincide con el del seed | Copiá el `tenant_id` que imprimió `seed:demo` al `app_metadata` de cada usuario. |
| Frank SÍ ve el botón "lanzar research" | El portal se buildeó en modo development | Cloudflare debe correr `npm run build` (producción, `features.lanzarResearch=false`). |

---

## Qué NO entra en Fase 1 (recordatorio)

- **Lanzar research en vivo** y **aprobar el run** (orquestador + Inngest): Fase 2.
- **Las webs de cliente** (renderizador + CDN): Fase 2.

Cuando la Fase 1 esté arriba y estable, se encara la Fase 2 (encender los flags `features.*`,
desplegar orquestador y renderizador). Ver [11-plan-fase-2.md](11-plan-fase-2.md).
