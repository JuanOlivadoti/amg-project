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
- [ ] **Hostinger** con el dominio **`bigball.es`** (hosting del portal estático + DNS).
- [ ] El repo pusheado a GitHub (ya está: `main`).
- [ ] Node instalado en tu máquina (para correr los CLI de deploy y buildear el portal).

**La arquitectura del deploy:**

```text
   navegador  ──▶  PORTAL (Angular estático)  ──▶  API (Node/Hono)  ──▶  Postgres (Supabase)
   (Frank)          bigball.es  ·  Hostinger        api.bigball.es       + Supabase Auth (login)
                                                       Railway
```

- **Portal** → `https://bigball.es` (Hostinger, archivos estáticos).
- **API** → `https://api.bigball.es` (Railway).
- **Base + login** → Supabase.

---

## Bloque B — crear las cuentas (tus pasos)

### B.1 — Proyecto de Supabase
1. Nuevo proyecto. Elegí región cercana (Europa, para Madrid).
2. Anotá (de **Project Settings**):
   - **Database → Connection string (URI)** con el rol `postgres`: es tu `DATABASE_URL_ADMIN`.
   - **API → Project URL** (`https://xxxx.supabase.co`) y **anon key**: para el portal.
   - **API → JWT Settings → JWT Secret**: para la API.

### B.2 — Railway y Hostinger

- **Railway:** creá un proyecto vacío, lo configuramos en C.5.
- **Hostinger:** ya tenés el dominio `bigball.es` y el hosting. El portal se sube a mano en C.6 (no
  hay auto-deploy desde GitHub en el hosting compartido: se buildea local y se suben los archivos).

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
   - `CORS_ORIGINS` = `https://bigball.es` (el dominio del portal; **sin `*`**, lo rechaza). Si vas a
     servir también `www.bigball.es`, poné `https://bigball.es,https://www.bigball.es`.
   - `SUPABASE_JWT_ISS` = `https://xxxx.supabase.co/auth/v1` (recomendado).
   - **`NPM_CONFIG_PRODUCTION=false`** ⚠️ **importante:** el server corre con `tsx` (no hay paso de
     build). `tsx` es una devDependency; si Railway instala en modo producción, `npm run serve`
     fallaría con "tsx: not found". Esta variable fuerza a instalar también las devDependencies.
4. **Deploy.** Cuando termine, Railway te da una URL tipo `https://amg-api-production.up.railway.app`.
5. **Dominio propio:** Settings → Networking → **Custom Domain** → `api.bigball.es`. Railway te da un
   destino CNAME; lo cargás en el DNS de Hostinger en C.7. (El portal ya espera `https://api.bigball.es`.)

**Verificá:** abrí `https://amg-api-production.up.railway.app/health` (la URL de Railway, antes de que
el DNS propague) → debe responder `{"status":"ok"}` (sin login).

### C.6 — Desplegar el portal en Hostinger

A diferencia de la API (auto-deploy desde GitHub), el hosting compartido de Hostinger **no buildea**:
se buildea en tu máquina y se **suben los archivos** resultantes.

1. **Completá [`portal/src/environments/environment.prod.ts`](../../portal/src/environments/environment.prod.ts)**
   (solo 2 valores de Supabase; ninguno es secreto) y **commiteá + pusheá**:
   - `supabaseUrl` = el Project URL de B.1.
   - `supabaseAnonKey` = la anon key de B.1.
   > `apiBaseUrl` ya está en `https://api.bigball.es`. No toques `features.*` (fijados en `false` para
   > Fase 1). Si dejás un placeholder, el `prebuild` **frena el build** y te dice cuál.
2. **Buildeá el portal** (desde la raíz del repo):

   ```bash
   npm ci
   npm run build -w portal
   ```

   Genera los archivos en **`portal/dist/portal/browser/`** (incluye `index.html`, los `.js`/`.css`,
   `favicon.ico` y el **`.htaccess`** del fallback de SPA). Si quedó algún placeholder, el `prebuild`
   corta acá y te dice cuál.
3. **Subí el CONTENIDO de `portal/dist/portal/browser/` a `public_html`** en Hostinger (hPanel →
   **File Manager**, o por FTP). Subí **lo de adentro** de `browser/`, no la carpeta: `index.html`
   tiene que quedar en la raíz de `public_html`. **Incluí el `.htaccess`** (en File Manager, activá
   "mostrar archivos ocultos" o subilo explícitamente — es un dotfile y es el que evita los 404).
4. **SSL:** hPanel → **SSL** → activá el certificado (Let's Encrypt, gratis) para `bigball.es`.
   Activá también el redirect de HTTP a HTTPS.

**Verificá:**
- `https://bigball.es` abre la pantalla de login.
- **Entrá directo a una ruta profunda** (`https://bigball.es/runs`) y **recargá**: debe cargar, no dar
  404. Si da 404, falta el `.htaccess` en `public_html` (o no se subió por ser oculto): revisá el paso 3.

### C.7 — Dominios (DNS en Hostinger)

El portal ya vive en `bigball.es` (es tu hosting de Hostinger, no hace falta DNS extra). Falta apuntar
el subdominio de la API:

- **`api.bigball.es`** → la API de Railway. En hPanel → **DNS Zone Editor**, agregá un **CNAME**:
  `api` → el destino que te dio Railway en C.5 (Custom Domain). En Railway, confirmá que el custom
  domain `api.bigball.es` quede "verified".

**Coherencia (lo que más falla):** el `CORS_ORIGINS` de la API (`https://bigball.es`) tiene que ser
**exactamente** el origen del portal, y el `apiBaseUrl` del portal (`https://api.bigball.es`) la URL
exacta de la API. El TLS lo ponen Railway (API) y Hostinger (portal) — asegurate de que **los dos**
sirvan por HTTPS, o el navegador bloquea la llamada de una página https a un backend http.

### C.8 — Verificación de punta a punta (con Frank)

- [ ] `https://bigball.es` abre la pantalla de login.
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
| La API no arranca, error sobre `CORS_ORIGINS` | Pusiste `*`, vacío, o una URL sin esquema | Poné el origen completo, ej. `https://bigball.es`. |
| `/health` da 404 | La URL o el service están mal | Es `GET /health` en la raíz de la API, sin `/api` adelante. |
| El portal carga pero el login/llamadas fallan con error de CORS | `CORS_ORIGINS` de la API ≠ origen real del portal | Que sean idénticos (`https://bigball.es`, sin barra final). Si entrás por `www.`, agregá `https://www.bigball.es`. |
| Recargar en `/runs/:id` da 404 | Falta el `.htaccess` en `public_html` | Es un dotfile: subilo explícitamente (o activá "mostrar ocultos" en File Manager). Debe estar junto a `index.html`. |
| El portal (https) no puede llamar a la API | La API responde por http, no https | Activá el custom domain con TLS en Railway; `apiBaseUrl` debe ser `https://api.bigball.es`. |
| Login OK pero Frank no ve nada | El `app_metadata.tenant_id` no coincide con el del seed | Copiá el `tenant_id` que imprimió `seed:demo` al `app_metadata` de cada usuario. |
| Frank SÍ ve el botón "lanzar research" | El portal se buildeó en modo development | El build tiene que ser `npm run build -w portal` (producción, `features.lanzarResearch=false`). |

---

## Qué NO entra en Fase 1 (recordatorio)

- **Lanzar research en vivo** y **aprobar el run** (orquestador + Inngest): Fase 2.
- **Las webs de cliente** (renderizador + CDN): Fase 2.

Cuando la Fase 1 esté arriba y estable, se encara la Fase 2 (encender los flags `features.*`,
desplegar orquestador y renderizador). Ver [11-plan-fase-2.md](11-plan-fase-2.md).
