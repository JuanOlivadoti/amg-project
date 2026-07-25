# Runbook de despliegue — Fase 1 (el portal de Frank)

> **Qué es esto:** la versión "hacé esto, pegá aquello, verificá esto otro" del plan
> ([12-despliegue-fase-1.md](12-despliegue-fase-1.md)). El plan dice el _qué_ y el _por qué_; esto es
> el _cómo_, paso a paso, para ejecutar de una sentada. **Todo el código ya está listo** (Bloque A):
> acá no se programa, se despliega.
>
> **Regla de oro:** los secretos (contraseñas, JWT secret, connection strings) van al gestor de
> secretos del host (Railway/Supabase), **nunca al repo ni al chat**. Las plantillas `.env.example`
> dicen _qué_ poner, no los valores.

---

## 0. Preflight — qué tenés que tener a mano

- [ ] Una cuenta de **Supabase** (base + auth).
- [ ] Una cuenta de **Railway** (la API), conectada a tu GitHub.
- [ ] **Hostinger** con el dominio **`bigballs.es`** (hosting del portal estático + DNS).
- [ ] El repo pusheado a GitHub (ya está: `main`).
- [ ] Node instalado en tu máquina (para correr los CLI de deploy y buildear el portal).

**La arquitectura del deploy:**

```text
   navegador  ──▶  PORTAL (Angular estático)  ──▶  API (Node/Hono)  ──▶  Postgres (Supabase)
   (Frank)          bigballs.es  ·  Hostinger        api.bigballs.es       + Supabase Auth (login)
                                                       Railway
```

- **Portal** → `https://bigballs.es` (Hostinger, archivos estáticos).
- **API** → `https://api.bigballs.es` (Railway).
- **Base + login** → Supabase.

---

## Bloque B — crear las cuentas (tus pasos)

### B.1 — Proyecto de Supabase

1. Nuevo proyecto. Región: cualquiera de Europa occidental. **El proyecto real está en West EU
   (London) `eu-west-2`** — Paris (`eu-west-3`) hubiera estado ~10 ms más cerca de Madrid, diferencia
   irrelevante para este caso de uso. No lo recrees por eso.
   **Anotá la contraseña de la base que ponés acá**: Supabase la guarda hasheada y no la muestra
   nunca más. Si la perdés, se resetea en _Project Settings → Database → Database password_.

2. **`DATABASE_URL_ADMIN`** → botón verde **"Connect"** en la barra superior del proyecto (no está en
   Project Settings; Supabase movió esa pantalla). El modal ofrece tres modos: usá **Session pooler**.

   > **Por qué el pooler y no "Direct connection":** la conexión directa hoy es **solo IPv6** (el
   > IPv4 es un add-on de pago). Las migraciones de C.1 las corrés desde tu máquina, y si tu ISP no
   > te da IPv6 la directa falla por _timeout_, sin decir por qué. El session pooler va por IPv4 y
   > soporta DDL y `create role` — que es todo lo que necesitan C.1, C.2 y C.4.

   Dos trampas al copiar el string:
   - el usuario **no** es `postgres` sino **`postgres.<project-ref>`**;
   - el string trae `[YOUR-PASSWORD]` literal — reemplazalo por la del paso 1, y si tiene `@ # / :`
     **URL-encodeala** (`@` → `%40`), o el string se parsea mal.

3. **Project URL + anon key** (para el portal) → **Project Settings → API Keys**. La `anon` está en la
   pestaña **Legacy API keys** — las nuevas (`publishable` / `secret`) son otro esquema; el portal usa
   la legacy. Ninguno de los dos valores es secreto (RLS autoriza, no la clave).

4. **JWT Secret** (para la API) → **Project Settings → JWT Keys**, pestaña **Legacy JWT Secret**
   (hay que darle a _reveal_). Ya no está bajo _API_. **Esto sí es secreto**: va solo al `.env` y a
   las variables de Railway.

### B.2 — Railway y Hostinger

- **Railway:** creá un proyecto vacío, lo configuramos en C.5.
- **Hostinger:** ya tenés el dominio `bigballs.es` y el hosting. El portal se sube a mano en C.6 (no
  hay auto-deploy desde GitHub en el hosting compartido: se buildea local y se suben los archivos).

---

## Bloque C — el deploy (en este orden EXACTO)

El orden importa: la base antes que todo, los usuarios antes que el seed, la API antes que el portal.

### C.1 — Aplicar las migraciones (esquema + roles + RLS)

Las credenciales tienen **una sola fuente**: `docs/private/credenciales.env` (gitignoreado). Pegá ahí
`DATABASE_URL_ADMIN` y repartí a los paquetes:

```bash
npm run env:sync            # escribe api/.env, db/.env, kr-service/.env, renderer/.env, web-builder/.env
npm run migrate:deploy -w db
```

> **No uses `DATABASE_URL_ADMIN=... npm run ...`.** El comando con la password adentro queda en el
> historial de la shell (en Windows, `ConsoleHost_history.txt`, en texto plano) y no caduca.
>
> **No edites los `.env` de los paquetes a mano**: `env:sync` los sobrescribe. Cada uno recibe solo
> sus claves — el mapa está en `scripts/env-sync.mts` y lo verifica su test (el renderizador, por
> ejemplo, no puede recibir el token de escritura de Storyblok ni una credencial de base).

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

**Armá `DATABASE_URL_API`** (la vas a usar en C.5): mismo host y puerto que la de C.1, cambiando el
login y la password:
`postgresql://amg_api.<project-ref>:LA-PASS-DE-AMG_API@aws-1-eu-west-2.pooler.supabase.com:5432/postgres`

> ⚠️ **El sufijo `.<project-ref>` en el usuario no es opcional con el pooler**: es cómo Supavisor
> sabe a qué proyecto rutear. Sin él, el login de `amg_api` falla y el error no dice que falta eso.
> El rol dentro de Postgres sigue siendo `amg_api` — el `NOINHERIT` de ADR-17 se mantiene intacto.
>
> **Pendiente de decidir en C.5:** si la API usa el **session pooler** (5432) o el **transaction
> pooler** (6543). El transaction pooler escala mejor para una API, y ADR-13 ya obliga a que todo
> acceso vaya por transacción con conexión reservada (`Tx`), que es justo el patrón que ese modo
> soporta — pero **no está verificado contra este código**. Empezá con el session pooler (5432), que
> se comporta como Postgres normal, y si hace falta cambiar, probalo con los tests antes.

### C.3 — Crear los usuarios de Frank y Juan (antes del seed)

Van **antes** del seed porque el seed necesita sus UUIDs: las filas de `memberships` se crean
apuntando a ellos, y sin eso Frank no tiene rol y RLS no le deja ver nada.

1. Supabase → **Authentication** → **Users** → botón **Add user** → _Create new user_.
2. Por cada uno (Frank y Juan):
   - **Email**: el que va a usar para entrar al portal. Puede ser real o inventado.
   - **Password**: la que le vas a dar. Anotala — Supabase no la muestra después.
   - ✅ **Marcá "Auto Confirm User"**. Si no lo marcás, Supabase le manda un mail de confirmación y
     **hasta que no lo confirme no puede iniciar sesión**. Es el tropiezo más común de este paso.
3. **Copiá el User UID** de cada uno: en la lista de usuarios, click en el usuario → el campo `UID`
   (un uuid tipo `a1b2c3d4-…`). Son los dos parámetros del seed.
4. Pegalos en `docs/private/credenciales.env` como `SEED_FRANK_USER_ID` y `SEED_JUAN_USER_ID`.

> El `app_metadata` (el `tenant_id` y el `rol`) **todavía no** se puede completar: sale del seed.
> Se carga en C.4, después de correrlo.

### C.4 — Seed del caso de Bella Napoli

Completá los dos UIDs de C.3 en `docs/private/credenciales.env` (`SEED_FRANK_USER_ID`,
`SEED_JUAN_USER_ID`) y:

```bash
npm run env:sync
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

1. **Crear el servicio.** En Railway: **New Project** → **Deploy from GitHub repo**.
   - Si no aparece el repo, Railway te va a pedir instalar su **GitHub App** y darle acceso. Podés
     darle acceso solo a este repositorio; no necesita el resto de tu cuenta.
   - Elegí el repo y la rama **`main`**.
   - Railway arranca un primer deploy solo, **y ese primero va a fallar**: todavía no cargaste las
     variables y la API falla cerrado si le falta alguna obligatoria.

   > ⚠️ **Fijate EN QUÉ ETAPA falla, no alcanza con "falló".** El fallo esperado es en **Deploy**
   > (`Faltan variables de entorno` en los Deploy Logs). Si falla en **Build › Build image**, eso
   > **no** es lo esperado: ni siquiera llegó a arrancar el proceso, así que las variables no tienen
   > nada que ver. Andá a **Build Logs** y leé el error real antes de tocar nada.

2. **Settings del servicio.** Están agrupados por sección:

   **Source**
   - **Root Directory:** vacío (o `/`). Es un monorepo con workspaces y el `package-lock.json` de la
     raíz es el único lockfile: apuntar a `api/` rompería la instalación.
   - **Branch:** `main`.

   **Build**
   - **Builder:** dejá **el que venga por defecto** — hoy es **Railpack** (Nixpacks quedó deprecado).
     Detecta Node por el `package.json` de la raíz. Lo que importa es que **no** quede en _Dockerfile_:
     no hay ninguno en el repo y el build falla en un par de segundos.
   - **Build Command:** **vacío**. No hay paso de build — el server corre con `tsx` directamente
     (ver el stack en CLAUDE.md). Si Railway te propone uno, borralo.
   - **Versión de Node:** sale de `engines` del `package.json` de la raíz (`>=20.12.0`), que respetan
     tanto Railpack como Nixpacks. Si necesitás fijarla exacta, cambiala ahí y commiteá — mejor que
     una variable del builder, que es específica de cuál esté activo.

   **Deploy**
   - **Region:** **Europa** (`europe-west4`, Ámsterdam). ⚠️ El default de Railway es **US West**, y
     eso deja la API a un océano y un continente de la base (Supabase está en `eu-west-2`, Londres).
     No es un detalle de milisegundos: ADR-13 obliga a que todo acceso vaya por transacción con
     conexión reservada, así que cada request son **varios** viajes de ida y vuelta —abrir la
     transacción, el `set local` del tenant, la consulta, el commit—. Con ~150 ms de RTT, una llamada
     de 30 ms se va a 600-800 ms. Es lo primero que se nota al usar el portal.
   - **Start Command:** `npm run serve -w api`
   - **Health Check Path:** `/health` — responde `{"status":"ok"}` **sin token**, a propósito: un
     health-check que exigiera JWT no serviría de health-check.
   - **Restart Policy:** `On Failure` está bien.

   > **No pongas `PORT` a mano.** Railway la inyecta sola y `api/src/server.ts` la lee (con 3000 de
   > default para local). Si la fijás vos, el proceso escucha en un puerto que Railway no rutea y el
   > health-check falla con timeout, que es un síntoma muy confuso.
3. **Variables.** Railway **no lee ningún archivo `.env`** del repo: hay que cargarlas en el servicio.
   Pero no las tipees de nuevo — `api/.env` ya las tiene todas y correctas.

   **Camino corto (recomendado):**

   ```bash
   npm run env:sync     # asegura que api/.env está al día con docs/private/credenciales.env
   ```

   Abrí `api/.env`, copiá **las 5 líneas `CLAVE=valor`** (salteá los comentarios de la cabecera) y
   pegalas en Railway: **Variables → Raw Editor**. Acepta el formato `CLAVE=valor` de a varias líneas.
   Si no encontrás el Raw Editor, cargalas de a una con **+ New Variable**.

   **Después agregá a mano esta, que no está en `api/.env`** (es de Railway, no de la app):

   ```env
   NPM_CONFIG_PRODUCTION=false
   ```

   ⚠️ **No la saltees:** el server corre con `tsx` y no hay paso de build. `tsx` es una
   devDependency; si Railway instala en modo producción, `npm run serve` falla con `tsx: not found`.

   Deberías terminar con estas 6 variables:

   | Variable | De dónde sale | Obligatoria |
   | --- | --- | --- |
   | `DATABASE_URL_API` | C.2 — login `amg_api`, **no** el de admin | sí |
   | `SUPABASE_JWT_SECRET` | B.1 — Project Settings → JWT Keys → Legacy | sí |
   | `CORS_ORIGINS` | `https://bigballs.es,https://www.bigballs.es` | sí |
   | `SUPABASE_JWT_ISS` | `https://<project-ref>.supabase.co/auth/v1` | recomendada |
   | `SUPABASE_JWT_AUD` | vacía salvo que hayas cambiado el default | no |
   | `NPM_CONFIG_PRODUCTION` | `false` — a mano, ver arriba | sí |

   > 🔴 **Nunca pegues `DATABASE_URL_ADMIN` en Railway.** Es el superusuario que crea roles y es dueño
   > del esquema. La API usa `amg_api`, que es `NOINHERIT` y trabaja bajo RLS; darle la de admin
   > convierte el aislamiento de ADR-17 en una convención en vez de una barrera. Por eso `env:sync`
   > no la pone en `api/.env`, y hay un test que lo verifica.
4. **Redesplegá** (**Deployments** → `⋮` → **Redeploy**). El primer deploy había fallado por falta de
   variables; este es el que tiene que quedar en verde. Mirá los **Deploy Logs**: al final tenés que
   ver el server escuchando, sin `Faltan variables de entorno` ni `tsx: not found`.

5. **Generá la URL pública.** Un servicio nuevo **no tiene dominio** hasta que se lo pedís:
   Settings → **Networking** → **Public Networking** → **Generate Domain**. Te da algo como
   `https://amg-api-production.up.railway.app`.

   > Si te pregunta el puerto, poné el que muestran los logs (Railway suele detectarlo solo).

6. **Dominio propio:** en la misma sección, **Custom Domain** → `api.bigballs.es`. Railway te da un
   destino CNAME; lo cargás en el DNS de Hostinger en C.7. (El portal ya espera
   `https://api.bigballs.es`.) El certificado TLS lo emite Railway solo, después de que el DNS
   propague — hasta entonces el dominio propio da error, y es normal.

**Verificá:** abrí `https://amg-api-production.up.railway.app/health` (la URL de Railway, antes de que
el DNS propague) → debe responder `{"status":"ok"}` (sin login).

### C.6 — Desplegar el portal en Hostinger

A diferencia de la API (auto-deploy desde GitHub), el hosting compartido de Hostinger **no buildea**:
se buildea en tu máquina y se **suben los archivos** resultantes.

1. **Completá [`portal/src/environments/environment.prod.ts`](../../portal/src/environments/environment.prod.ts)**
   (solo 2 valores de Supabase; ninguno es secreto) y **commiteá + pusheá**:
   - `supabaseUrl` = el Project URL de B.1.
   - `supabaseAnonKey` = la anon key de B.1.
     > `apiBaseUrl` ya está en `https://api.bigballs.es`. No toques `features.*` (fijados en `false` para
     > Fase 1). Si dejás un placeholder, el `prebuild` **frena el build** y te dice cuál.
2. **Buildeá el portal** — **desde `portal/`, no desde la raíz**:

   ```bash
   cd portal
   npm ci          # las deps del portal se instalan ACÁ
   npm run build
   ```

   > ⚠️ `npm run build -w portal` **no funciona**: falla con `No workspaces found`. El portal está
   > **fuera del monorepo a propósito** (su toolchain de Angular no se mezcla con el de los paquetes),
   > así que no es un workspace y `-w` no lo encuentra. Su `node_modules` es propio.

   Genera los archivos en **`portal/dist/portal/browser/`** (incluye `index.html`, los `.js`/`.css`,
   `favicon.ico` y el **`.htaccess`** del fallback de SPA). Si quedó algún placeholder, el `prebuild`
   corta acá y te dice cuál.

3. **Subí el CONTENIDO de `portal/dist/portal/browser/` a `public_html`** en Hostinger (hPanel →
   **File Manager**, o por FTP). Subí **lo de adentro** de `browser/`, no la carpeta: `index.html`
   tiene que quedar en la raíz de `public_html`. **Incluí el `.htaccess`** (en File Manager, activá
   "mostrar archivos ocultos" o subilo explícitamente — es un dotfile y es el que evita los 404).
4. **SSL:** hPanel → **SSL** → activá el certificado (Let's Encrypt, gratis) para `bigballs.es`.
   Activá también el redirect de HTTP a HTTPS.

**Verificá:**

- `https://bigballs.es` abre la pantalla de login.
- **Entrá directo a una ruta profunda** (`https://bigballs.es/runs`) y **recargá**: debe cargar, no dar 404. Si da 404, falta el `.htaccess` en `public_html` (o no se subió por ser oculto): revisá el paso 3.

### C.7 — Dominios (DNS en Hostinger)

El portal ya vive en `bigballs.es` (es tu hosting de Hostinger, no hace falta DNS extra). Falta apuntar
el subdominio de la API:

**`api.bigballs.es`** → la API de Railway. Al agregar el Custom Domain en Railway (C.5, paso 6), te
muestra un cuadro _Configure DNS Records_ con **DOS registros**. Hay que cargar **los dos** en hPanel
→ **DNS Zone Editor**:

| Type | Name | Value |
| --- | --- | --- |
| `CNAME` | `api` | el destino que te da Railway (ej. `f0j2w3va.up.railway.app`) |
| `TXT` | `_railway-verify.api` | `railway-verify=…` (la cadena que te da Railway) |

> ⚠️ **El TXT no es opcional**: es como Railway prueba que el dominio es tuyo antes de emitirte el
> certificado. Con solo el CNAME, el dominio resuelve pero el custom domain nunca pasa a _verified_
> y `https://api.bigballs.es` falla con error de TLS.
>
> En el campo **Name** va solo `api` y `_railway-verify.api`, **sin** el dominio: Hostinger lo
> agrega solo. Si ponés el completo terminás con `api.bigballs.es.bigballs.es`.

El destino del CNAME es **único por dominio** y lo genera Railway al agregarlo: no es la URL pública
del servicio (`…-production.up.railway.app`) ni se puede deducir. Copiá el que te muestra.

**Verificá** (desde tu máquina, no desde el navegador — el navegador cachea):

```bash
nslookup -type=CNAME api.bigballs.es          # -> el destino de Railway
nslookup -type=TXT _railway-verify.api.bigballs.es
curl -s https://api.bigballs.es/health        # -> {"status":"ok"}, sin avisos de TLS
```

El certificado lo emite Railway **minutos después** de que el DNS propague. Hasta entonces
`https://api.bigballs.es` da error de certificado aunque el DNS ya resuelva: es normal, esperá.

**Coherencia (lo que más falla):** el `CORS_ORIGINS` de la API (`https://bigballs.es`) tiene que ser
**exactamente** el origen del portal, y el `apiBaseUrl` del portal (`https://api.bigballs.es`) la URL
exacta de la API. El TLS lo ponen Railway (API) y Hostinger (portal) — asegurate de que **los dos**
sirvan por HTTPS, o el navegador bloquea la llamada de una página https a un backend http.

### C.8 — Verificación de punta a punta (con Frank)

- [ ] `https://bigballs.es` abre la pantalla de login.
- [ ] Frank se loguea con su usuario de Supabase.
- [ ] Ve el research de **Bella Napoli**: el split **✅ 3 respaldadas / ⚠️ 5 sin validar**.
- [ ] Entra a un run, ve las páginas, y **puede aprobar una página** (la compuerta).
- [ ] **NO ve** el formulario "Lanzar un research" ni el botón "Aprobar el run y publicar"
      (ocultos en Fase 1). ← confirmarlo en el navegador; es lo que los tests no ven en prod.
- [ ] Recargar en una ruta profunda no da 404. La consola no tira errores de CORS ni de conexión.

---

## Troubleshooting (los errores que más probablemente veas)

| Síntoma                                                         | Causa probable                                          | Fix                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| La API no arranca, log dice `Faltan variables de entorno`       | Falta una var obligatoria en Railway                    | Completá `DATABASE_URL_API`, `SUPABASE_JWT_SECRET`, `CORS_ORIGINS`.                                                  |
| La API no arranca, `tsx: not found`                             | Railway instaló sin devDependencies                     | Agregá la variable `NPM_CONFIG_PRODUCTION=false` y redesplegá.                                                       |
| La API no arranca, error sobre `CORS_ORIGINS`                   | Pusiste `*`, vacío, o una URL sin esquema               | Poné el origen completo, ej. `https://bigballs.es`.                                                                  |
| `/health` da 404                                                | La URL o el service están mal                           | Es `GET /health` en la raíz de la API, sin `/api` adelante.                                                          |
| El portal carga pero el login/llamadas fallan con error de CORS | `CORS_ORIGINS` de la API ≠ origen real del portal       | Que sean idénticos (`https://bigballs.es`, sin barra final). Si entrás por `www.`, agregá `https://www.bigballs.es`. |
| Recargar en `/runs/:id` da 404                                  | Falta el `.htaccess` en `public_html`                   | Es un dotfile: subilo explícitamente (o activá "mostrar ocultos" en File Manager). Debe estar junto a `index.html`.  |
| El portal (https) no puede llamar a la API                      | La API responde por http, no https                      | Activá el custom domain con TLS en Railway; `apiBaseUrl` debe ser `https://api.bigballs.es`.                         |
| Login OK pero Frank no ve nada                                  | El `app_metadata.tenant_id` no coincide con el del seed | Copiá el `tenant_id` que imprimió `seed:demo` al `app_metadata` de cada usuario.                                     |
| Frank SÍ ve el botón "lanzar research"                          | El portal se buildeó en modo development                | El build tiene que ser `npm run build -w portal` (producción, `features.lanzarResearch=false`).                      |

---

## Qué NO entra en Fase 1 (recordatorio)

- **Lanzar research en vivo** y **aprobar el run** (orquestador + Inngest): Fase 2.
- **Las webs de cliente** (renderizador + CDN): Fase 2.

Cuando la Fase 1 esté arriba y estable, se encara la Fase 2 (encender los flags `features.*`,
desplegar orquestador y renderizador). Ver [11-plan-fase-2.md](11-plan-fase-2.md).
