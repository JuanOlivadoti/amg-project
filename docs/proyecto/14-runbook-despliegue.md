# Runbook de despliegue — Fase 1 (el portal de Frank)

> **Qué es esto:** la versión "hacé esto, pegá aquello, verificá esto otro" del plan
> ([12-despliegue-fase-1.md](13-despliegue-fase-1.md)). El plan dice el _qué_ y el _por qué_; esto es
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

4. **No hace falta ningún JWT Secret.** La API verifica los tokens contra el JWKS público del
   proyecto, que deriva del `iss`. El único valor que necesita es
   `https://<project-ref>.supabase.co/auth/v1`, que ya conocés del paso 3.

### B.2 — Railway y Hostinger

- **Railway:** creá un proyecto vacío, lo configuramos en C.5.
- **Hostinger:** ya tenés el dominio `bigballs.es` y el hosting. El portal se conecta a GitHub en C.6
  y se despliega solo en cada push a `main`: hPanel buildea en el servidor (planes con Node.js).

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

**Verificá:** imprime `+ 0001_init.sql … + 0010_ubicaciones_y_carta_publicas.sql` y `✔ Aplicadas 10 migración(es)`.
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
     (ver el stack en AGENTS.md). Si Railway te propone uno, borralo.
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

   Abrí `api/.env`, copiá **las 4 líneas `CLAVE=valor`** (salteá los comentarios de la cabecera) y
   pegalas en Railway: **Variables → Raw Editor**. Acepta el formato `CLAVE=valor` de a varias líneas.
   Si no encontrás el Raw Editor, cargalas de a una con **+ New Variable**.

   **Después agregá a mano esta, que no está en `api/.env`** (es de Railway, no de la app):

   ```env
   NPM_CONFIG_PRODUCTION=false
   ```

   ⚠️ **No la saltees:** el server corre con `tsx` y no hay paso de build. `tsx` es una
   devDependency; si Railway instala en modo producción, `npm run serve` falla con `tsx: not found`.

   Deberías terminar con estas 5 variables:

   | Variable | De dónde sale | Obligatoria |
   | --- | --- | --- |
   | `DATABASE_URL_API` | C.2 — login `amg_api`, **no** el de admin | sí |
   | `SUPABASE_JWT_ISS` | `https://<project-ref>.supabase.co/auth/v1` | **sí** |
   | `CORS_ORIGINS` | `https://bigballs.es,https://www.bigballs.es` | sí |
   | `SUPABASE_JWT_AUD` | vacía salvo que hayas cambiado el default | no |
   | `NPM_CONFIG_PRODUCTION` | `false` — a mano | sí |

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

**Hostinger sí buildea** (en los planes con Node.js): hPanel conecta GitHub por OAuth y despliega
desde `main` con un webhook, corriendo el build en el servidor. No hacen falta GitHub Actions ni FTP.

1. **Completá [`portal/src/environments/environment.prod.ts`](../../portal/src/environments/environment.prod.ts)**
   (solo 2 valores de Supabase; ninguno es secreto) y **commiteá + pusheá**:
   - `supabaseUrl` = el Project URL de B.1.
   - `supabaseAnonKey` = la anon key de B.1.
     > `apiBaseUrl` ya está en `https://api.bigballs.es`. No toques `features.*` (fijados en `false` para
     > Fase 1). Si dejás un placeholder, el `prebuild` **frena el build** y te dice cuál — en el
     > servidor de Hostinger también, así que un placeholder olvidado corta el deploy en vez de
     > publicar un portal roto.

2. **Conectá el repo en hPanel** y configurá el proyecto como **Angular**. Esta es la configuración
   que quedó funcionando en producción:

   | Campo | Valor |
   | --- | --- |
   | Repositorio | tu repo de GitHub |
   | Rama | `main` |
   | Framework / tipo | **Angular** |
   | **Directorio raíz** | **`portal`** |
   | **Build command** | **`npm run build`** |
   | **Output / publish directory** | **`dist/portal/browser`** |
   | Versión de Node | **20 o superior** (Angular 20 lo exige) |

   > ⚠️ **Los tres campos van juntos: raíz, comando y output.** El portal está **fuera del monorepo a
   > propósito** (su toolchain de Angular no se mezcla con el de los paquetes), así que hay dos
   > combinaciones válidas y **mezclarlas falla**:
   >
   > | Directorio raíz | Build command | Output |
   > | --- | --- | --- |
   > | `portal` ✅ | `npm run build` | `dist/portal/browser` |
   > | `./` | `npm run build:portal` | `portal/dist/portal/browser` |
   >
   > `build:portal` vive en el `package.json` de la **raíz del repo**; `build` vive en el de
   > **`portal/`**. Con la raíz en `portal`, pedir `build:portal` da `Missing script`.
   >
   > **Preferí la raíz en `portal`**: con `./`, Hostinger instala los 6 workspaces (~300 paquetes)
   > para buildear un frontend que no usa ninguno.

3. **SSL:** hPanel → **SSL** → certificado de Let's Encrypt (gratis) para `bigballs.es`, y activá el
   redirect de HTTP a HTTPS.

**El `.htaccess` viaja solo.** `angular.json` copia `public/**` al output, así que sale dentro de
`dist/portal/browser/` en cada build. Es el fallback de SPA: sin él, recargar en `/runs` da 404. Ya
no hay que acordarse de subirlo a mano — que era el error más común de este paso.

> 🔴 **`portal/package-lock.json` TIENE que estar commiteado.** El build de Hostinger corre `npm ci`
> sobre un clon limpio, y sin lockfile falla con `EUSAGE`. El `.gitignore` tiene
> `*/package-lock.json` —correcto para los 6 workspaces, donde no deben existir lockfiles propios—
> con una excepción explícita `!portal/package-lock.json`, porque el portal **no** es workspace.
>
> Esto no se ve en la máquina de desarrollo: ahí el archivo existe en disco aunque no esté en el
> repo, así que el build local pasa y el del servidor falla. **Para verificar un cambio que afecte
> al build de CI, probalo contra un clon limpio**, no contra tu copia de trabajo:
>
> ```bash
> git clone --depth 1 <url-del-repo> /tmp/clon && cd /tmp/clon/portal && npm ci && npm run build
> ```

#### Camino manual (solo si el plan no buildea en el servidor)

```bash
npm run build:portal
```

Y subí el **CONTENIDO** de `portal/dist/portal/browser/` a `public_html` (hPanel → File Manager o
FTP): lo de **adentro** de `browser/`, no la carpeta — `index.html` va en la raíz de `public_html`.
**Incluí el `.htaccess`**: es un dotfile, activá "mostrar archivos ocultos" o subilo explícitamente.

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

## Actualizar una instalación ya desplegada

Este runbook, hasta acá, es _green-field_: asume que estás desplegando desde cero y podés cargar
todas las variables antes del primer deploy. Pero un push a `main` **autodespliega los dos lados a la
vez** —la API en Railway y el portal en Hostinger— así que no se pueden escalonar: no hay forma de
subir el código nuevo y esperar a cargar la variable después.

**Regla general:** cuando una release hace que una variable nueva sea **obligatoria**, esa variable
va a Railway **antes** que el código, no después. `leerConfig` (`api/src/deps.ts`) falla cerrado si
falta algo obligatorio, así que el orden importa dos veces:

- variable primero, código después → el deploy nuevo arranca con la variable ya puesta;
- código primero, variable después → la API **no arranca**: `/health` deja de responder y el
  servicio entero da 502, no un 401 como hasta entonces. **El apagón empeora, no mejora.**

### Esta release (`fix/jwt-es256`): qué cargar antes de mergear

1. En Railway → **Variables**, agregá:

   | Variable | Valor exacto |
   | --- | --- |
   | `SUPABASE_JWT_ISS` | `https://<project-ref>.supabase.co/auth/v1` |

   Sin barra final, y **con** el sufijo `/auth/v1`: una URL "pelada" como
   `https://<project-ref>.supabase.co` **no sirve** — `emisorSupabase` la rechaza al arrancar (es de
   ahí que sale el JWKS, y sin `/auth/v1` la ruta no existe). El `<project-ref>` es el mismo que ya
   usa el portal en `environment.prod.ts`; no es secreto, viaja en el bundle.

   **No borres `SUPABASE_JWT_SECRET` todavía.** Ver el paso 4 y el recuadro de abajo.

2. Mergeá `fix/jwt-es256` a `main`. El push dispara el autodeploy de la API (Railway) y del portal
   (Hostinger) al mismo tiempo — con `SUPABASE_JWT_ISS` ya puesta, el proceso nuevo arranca igual que
   el viejo, solo que ahora los logins funcionan.

3. **Esperá a que la revisión nueva esté sirviendo tráfico** y confirmá `/health` en verde. No sigas
   hasta ver eso.

4. `SUPABASE_JWT_SECRET` en Railway: **dejala por ahora, a propósito.** No molesta —`leerConfig` no la
   lee, es una variable muerta— y **es tu red de rollback**: el código viejo la exige para arrancar,
   así que si la borrás y después necesitás revertir el merge, el rollback no levanta. Borrala cuando
   tengas la certeza de que no volvés atrás; es cosmético, y tenerla es opcionalidad real.

   ⛔ Y **no** intentes cerrar el tema revocando el secreto en Supabase: el `anon key` del portal es
   un JWT legacy firmado con ese mismo secreto, así que revocarlo **rompe el login otra vez**. Hay
   que migrar antes el portal a las claves nuevas — ver
   [12-credenciales.md](12-credenciales.md).

5. Verificá con el navegador (no alcanza con `/health` en verde): entrá a `https://bigballs.es`,
   logueate con un usuario real y confirmá que **no** da `401 Token inválido o expirado`. Recién ahí
   el login está arreglado — arreglado es "desplegado y verificado", no "el código está en la rama".

> ### ⚠️ El orden de arriba no es preferencia: es evitar una caída
>
> La versión que **hoy** corre en producción todavía exige `SUPABASE_JWT_SECRET` para arrancar
> (`leerConfig` la tiene entre las obligatorias). Railway **reinicia el servicio cuando cambiás una
> variable**, así que borrarla antes de desplegar el código nuevo tumba el proceso que está sirviendo:
> `/health` desaparece y todo pasa a **502** hasta que termine el merge.
>
> Sería empeorar el problema en vez de arreglarlo — hoy el login falla, pero la API está viva.
>
> La regla, más allá de esta release: **agregar** una variable es seguro en cualquier momento (el
> código viejo la ignora); **quitar** una solo lo es después de que el código que ya no la necesita
> esté sirviendo.

### Aplicar migraciones nuevas a una base ya desplegada

Todo lo de arriba es sobre **variables de entorno**. Cuando lo que cambia es el **esquema**, el
procedimiento es otro — y hoy hace falta: **la `0010` está en `main` pero no en producción.**

> ### ✅ Estado actual: producción va al día (las 10 migraciones)
>
> La base se había verificado con **9** el 2026-07-25; la `0010`
> (`0010_ubicaciones_y_carta_publicas.sql`, allowlist de `locations`/`menu`) es del 2026-08-01 y se
> **aplicó el mismo día**. Comprobado por consulta: las 10 en `app.migraciones_aplicadas`, y
> `business_profile_publico` exponiendo `brand, locations, menu, name, priceRange`.
>
> Se adelantó al despliegue de Fase 2 a propósito, porque su fallo es **silencioso**: sin ella el
> footer sale sin locales y `/menu` da 404, con el perfil correctamente cargado y **sin ningún error
> en los logs** — el mismo bug que ya le había pasado a `brand` antes de la `0009`.
>
> El procedimiento de abajo sigue valiendo para la próxima migración.

**El procedimiento:**

```bash
npm run env:sync              # DATABASE_URL_ADMIN sale de docs/private/credenciales.env
npm run migrate:deploy -w db
```

**Verificá:** imprime `+ 0010_ubicaciones_y_carta_publicas.sql` y `✔ Aplicadas 1 migración(es)`. Si
ya estaba, dice `✔ La base ya estaba al día`.

Cuatro cosas que conviene saber antes de correrlo contra producción:

- **Usa `DATABASE_URL_ADMIN`, no `amg_api`.** Las migraciones crean roles y son dueñas del esquema:
  eso exige el superusuario del proyecto (`postgres` en Supabase). Es la **única** pieza que toca esa
  credencial. Si falta la variable, el runner **falla cerrado** en vez de tocar otra base por las
  dudas (`db/src/cli/deploy.ts`).
- **Aplica solo las pendientes, en orden, y lleva registro.** Es idempotente: correrlo dos veces no
  duplica nada. No hay que elegir a mano qué archivo correr.
- **No hace falta parar la API.** Al revés que con las variables, acá el orden seguro es **esquema
  primero, código después**: una migración aditiva (una columna nueva, un campo más en una allowlist)
  la ignora el código viejo. La regla espejo de la de arriba: **agregar** es seguro en cualquier
  momento; **quitar** una columna solo lo es después de que el código que ya no la usa esté sirviendo.
- **La `0010` en concreto** redefine la columna generada `business_profile_publico`, así que Postgres
  la recalcula para cada fila de `clients`. Con la cartera actual es instantáneo; con miles de
  clientes habría que mirarlo con más cuidado.

Después de aplicarla, verificá por introspección (no "el comando dio verde"): que
`business_profile_publico` de un cliente con `locations` cargadas **traiga** el array, y que un valor
que no sea string en un campo de texto **no** sobreviva (`app.texto_publico`, tanda 18).

---

## Desplegar el renderizador (Fase 2)

> **Hecho el 2026-08-01.** El renderizador sirve
> [`amg-renderer-production.up.railway.app`](https://amg-renderer-production.up.railway.app). Lo que
> sigue es el procedimiento tal como salió, con los cuatro tropiezos reales — que es la parte que
> ahorra tiempo la próxima vez (y la próxima es el **orquestador**, que va igual).

**Es aditivo, y por eso se pudo hacer con una demo el mismo día:** es un **servicio nuevo**, no toca
`main`, ni el portal, ni la API. El peor caso es que no arranque y todo lo demás siga igual.

### Los pasos

1. **Aplicá la `0010` primero** si no está (ver la sección anterior). Es el bloqueante **silencioso**
   de este despliegue: sin ella la web sale sin locales y con `/menu` en 404, con el perfil bien
   cargado y **sin un error en los logs**.

2. **Poné password a `amg_render`** si nunca se usó (las migraciones crean los logins sin ella):

   ```sql
   alter role amg_render with password 'UNA-ALFANUMÉRICA-LARGA';
   ```

   **Alfanumérica a propósito:** un `@`, `:` o `/` obliga a percent-encodear el DSN, y el caso típico
   de "DSN ilegible" es justamente ese.

3. **Armá `DATABASE_URL_RENDER`** copiando `DATABASE_URL_API` y cambiando **usuario y password**:

   ```
   postgresql://amg_render.<project-ref>:LA-PASS@aws-1-eu-west-2.pooler.supabase.com:6543/postgres
   ```

4. **Servicio nuevo en Railway**, en el mismo proyecto:

   | Campo | Valor |
   | --- | --- |
   | Root Directory | **vacío** (la raíz del repo) |
   | Start command | `npm run serve -w renderer` |
   | Healthcheck path | `/_health` |
   | Variables | `DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`, `PREVIEW_SECRET`, `TRUST_PROXY=1`, `NPM_CONFIG_PRODUCTION=false` |

   **No pongas `PORT`**: lo inyecta Railway y `server.ts` ya lo lee.

5. **Poné el dominio en la fila del cliente.** El mapa dominio→space **no es una tabla aparte**: es
   `clients.domain`, y el renderizador resuelve por cabecera `Host` (`db/src/sitios.ts`). El seed
   **no** puebla `domain` ni los tokens, así que hay que hacerlo a mano:

   ```sql
   update clients
      set domain = 'el-dominio-del-servicio',
          storyblok_space_id = '…', storyblok_public_token = '…', storyblok_preview_token = '…'
    where id = '…';
   ```

   Los tokens son los de **lectura** (CDA). El de Management **nunca** va acá: el renderizador es el
   proceso expuesto a internet anónimo.

6. **Verificá en el navegador**, no por el `/_health`: `/`, `/menu`, `/blog`, una landing, y un
   dominio desconocido (tiene que dar **404**: el dominio es la autorización, ADR-19).

### Los cuatro tropiezos, y qué enseñan

> #### 1. El DSN quedó con el usuario `amg_api`
>
> Al copiar `DATABASE_URL_API` se cambió la password pero **no el usuario**. No es un typo: le habría
> dado al proceso expuesto a internet la credencial de la API, que es exactamente lo que ADR-17 evita
> con un login por proceso y `NOINHERIT`. Encima **no habría arrancado** (password de otro rol), así
> que se habría leído como "problema de credencial" y no como "estás usando el rol equivocado".
>
> **Comprobalo antes de desplegar:** conectá con ese DSN y corré `select current_user`.

> #### 2. El session pooler (5432) aceptó una conexión y rechazó la siguiente
>
> Con la **misma password**, en dos corridas seguidas. Es el fenómeno que ya le había pasado a
> `amg_cache`. La forma de distinguirlo de una credencial mala: **probar los dos puertos**. Si 5432
> falla y 6543 anda, es Supavisor; si fallan los dos, es la password.
>
> **Usá 6543 (transaction pooler)** para el renderizador: es lo estable y además lo correcto, porque
> solo hace transacciones autocontenidas (`pool.transaction()` con `set local role`).

> #### 3. El dominio se agregó al servicio de la API
>
> Los custom domains se agregan **dentro de un servicio**. Puesto en el de la API, al validarse habría
> servido la API REST en el dominio del cliente. Y ocupa cupo: **el plan tiene un límite de custom
> domains** (se alcanzó con dos), así que hay que liberarlo antes de moverlo.
>
> Los dominios `*.up.railway.app` **no cuentan** contra ese límite: sirven para desplegar y verificar
> sin tocar DNS.

> #### 4. Los primeros 404 eran caché negativa del propio renderizador
>
> Si el servicio consulta el dominio **antes** de que exista la fila, cachea el "no existe". Los
> siguientes pedidos dan 404 aunque la fila ya esté. Vence solo; el modo de verlo es
> `x-amg-cache: miss` en la respuesta buena. No es un error del despliegue y no hay que tocar nada.

### Lo que quedó pendiente

- **El dominio propio del cliente.** `labirrabar.bigballs.es` tiene el CNAME puesto en Hostinger, pero
  apuntando al servicio de la API. Moverlo exige agregarlo como custom domain del servicio del
  renderizador, actualizar el CNAME con el target **nuevo** que dé Railway, y esperar propagación.
- **`/favicon.ico` da 404** — cosmético, deja el icono genérico en la pestaña.
- **Una CDN delante** y la invalidación con más de una instancia (ADR-19, ver el roadmap §3).

---

## Desplegar el orquestador (Fase 2) — la última pieza

> **A medias al 2026-08-07.** El código quedó preparado ese día (tramo A), y esa misma tarde se
> ejecutaron **§1 y §2**: la cuenta de Inngest existe, sus dos claves están emitidas y la API ya corre
> en Railway con `INNGEST_EVENT_KEY` (verificado desde afuera: `/health` 200, `/runs` 401). Falta
> **§3–§6**, que es el servicio del orquestador.
>
> Este runbook se escribió **antes** del despliegue, así que lo que decía estaba medido contra el código
> y **no** contra Railway. Los tropiezos reales se van agregando el día que se ejecuta cada paso, como
> se hizo con el renderizador: el primero ya está, en §2, y costó un rato de sitio caído.

### ⚠️ Este despliegue NO es aditivo: toca la API

El del renderizador se pudo hacer con una demo el mismo día porque era un servicio nuevo que no tocaba
nada. **Éste no.** La API tiene que aprender a hablar con Inngest Cloud, y eso es una variable nueva
(`INNGEST_EVENT_KEY`) más un redeploy del servicio que hoy sostiene el portal entero.

**El orden importa y no es el intuitivo:**

1. Cuenta de Inngest y claves (§1) — no toca nada.
2. **La API primero** (§2), con `INNGEST_EVENT_KEY`. Sin esto el orquestador no recibe ni un evento,
   porque nadie los emite.
3. El orquestador (§3–§5).

> #### Lo que pasa hoy, antes de nada de esto
>
> Medido el 2026-08-07 leyendo el SDK: `Inngest.js:563` lanza en `send()` cuando el modo es **cloud** y
> no hay event key, y el modo se infiere como cloud por `RAILWAY_GIT_BRANCH` o `NODE_ENV=production`
> (`helpers/env.js`, `getMode`). La API corre en Railway y **no tiene ninguna de las dos claves**.
>
> O sea: **`POST /runs` en producción está roto hoy**, y el arreglo del tramo A hace que la API deje de
> arrancar hasta que la variable esté. Es a propósito —el precedente es el issuer del JWT, mismo
> archivo— pero implica que **si redesplegás la API sin poner la key primero, no levanta**. Por eso la
> API va en el paso 2 y no al final.

### 1. Inngest Cloud: la app y las dos claves

Cuenta gratis en [inngest.com](https://www.inngest.com). Del proyecto salen **dos** claves distintas, y
no son intercambiables:

| Clave | Quién la usa | Para qué |
| --- | --- | --- |
| `INNGEST_EVENT_KEY` | **La API** (y el orquestador, si alguna vez emite) | Autentica el **envío** de eventos |
| `INNGEST_SIGNING_KEY` | **El orquestador** | Verifica que quien le pega a `/api/inngest` es Inngest de verdad |

En Railway las dos van al **entorno del servicio**. (La event key además se puede pasar por parámetro, y
la API lo hace a propósito para validar y usar la misma lectura — ver
[12-credenciales.md](12-credenciales.md#las-dos-claves-de-inngest). Para el despliegue no cambia nada:
poné la variable.)

**`docs/private/credenciales.env` no despliega nada.** Es la fuente privada de verdad y ahí conviene que
estén las dos, pero la API lee del **panel de Railway**. Y `env:sync` tampoco las reparte: las tres
variables nuevas de Inngest no están en el `MAPA` (deuda declarada en
[12-credenciales.md](12-credenciales.md)). En producción no molesta —las variables van al panel—; en
local sí, y por eso la deuda tiene nombre.

**El entorno importa, y hoy todavía no.** Inngest separa las claves **por entorno** (Production y los de
rama). Una cuenta recién creada tiene **solo Production**, así que al principio no hay dónde
equivocarse. Cuando aparezcan entornos de rama sí lo hay, y el fallo es **silencioso**: la API emite el
evento sin error contra el entorno equivocado y el orquestador —que vive en Production— no lo ve nunca.
La pista está en el prefijo de la signing key, que nombra el entorno (`signkey-prod-…`).

#### El filtro de eventos de la Event Key: allowlist de nombres, sí; de IPs, no

Inngest deja acotar una Event Key por **nombre de evento** y por **IP de origen**. Sobre nombres, la
lista es exactamente ésta y sale de medir `grep '\.send(' api/src` (2026-08-07):

| Evento permitido | Quién lo emite |
| --- | --- |
| `research/solicitado` | `api/src/solicitar.ts` |
| `research/aprobado` | `api/src/app.ts` |

**`research/rechazado` NO va en la lista.** Está declarado en el tipo (`orchestrator/src/events.ts`) pero
**nadie lo emite y ninguna función lo escucha**: ponerlo sería pre-autorizar algo que no existe.

Por qué acotarla, si ADR-18 ya dice que un evento no porta autoridad: precisamente porque eso es lo que
hace _pequeño_ el daño de una fuga, no nulo. Con la clave robada no se publica nada que un humano no
haya aprobado (`getPublishablePages` exige la compuerta doble) ni se re-paga un research ya hecho (el
workflow lo salta por `status`), pero **sí** se puede inyectar cualquier nombre de evento en el entorno.
Hoy nadie escucha otros; el día que se agregue una función, la clave filtrada ya la puede disparar.

**El allowlist de IPs no se pone.** Railway no garantiza IP de salida estable en el plan actual, así que
sería una guarda que se rompe sola cuando el contenedor se mueva, en el camino que emite eventos y con
un error de red que no dice "cambió tu IP". El beneficio es marginal cuando la clave ya está acotada por
nombre; el modo de fallo, no.

> ⚠️ **Esta garantía es TEXTUAL, no impuesta, y conviene saberlo.** El allowlist vive en el dashboard de
> Inngest, fuera del repo: **ningún test lo puede ver**. Si algún día se agrega un evento nuevo, son
> **dos** sitios —el código y el allowlist— y el olvido se manifiesta como un fallo de permisos en
> `send()` que no se parece en nada a "te falta una entrada en el allowlist". Es la misma clase de
> guarda declarada-como-textual que `AGENTS.md` admite para el `permissions.deny`: decirlo es la mitad
> del arreglo.

### 2. La API: la variable y el redeploy

En el servicio de la API en Railway, agregá `INNGEST_EVENT_KEY` y redesplegá. Verificá que **arrancó**
antes de seguir:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.bigballs.es/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://api.bigballs.es/runs     # 401 (el auth vive)
```

Si falta la variable, el log lo dice al arrancar y con el nombre exacto.

> #### ⚠️ Lo que pasó de verdad el 2026-08-07, y no estaba previsto acá
>
> **La API autodespliega con CADA push a `main`** (ver el paso 2 de la pieza A, más arriba). O sea que
> la guarda del tramo A no espera a que alguien redespliegue a propósito: **se dispara con cualquier
> commit**. Ese día un commit que solo tocaba `db/` —la migración `0017`, nada que ver con la API— llenó
> Railway de reinicios y dejó `api.bigballs.es` en crash loop.
>
> Y el radio fue mucho mayor que el problema: `INNGEST_EVENT_KEY` la necesita **un endpoint**
> (`POST /runs`), pero se validaba como si la necesitara **el proceso**, así que se cayeron también el
> login, `/runs`, `/clients` — todo lo que el portal lee para pintar una pantalla, nada de lo cual toca
> Inngest. Un endpoint que además **no puede funcionar hasta que el orquestador esté desplegado** tumbó
> la demo que sí funcionaba.
>
> **La lección, que vale más allá de Inngest:** una capacidad que falta debe deshabilitar **esa
> capacidad**, no el proceso. Fallar ruidoso está bien; fallar _ancho_ no es lo mismo que fallar
> ruidoso. Se arregló poniendo la clave (medido: `/health` 200, `/runs` 401), y la guarda pasa a
> devolver **503 en `POST /runs`** en vez de impedir el arranque.
>
> Si te vuelve a pasar antes de tener la cuenta de Inngest: la salida NO es `INNGEST_DEV=1` — fuerza
> modo dev y desactiva todas las validaciones de producción (está en la lista de variables prohibidas
> de §4). La salida es poner la Event Key, que son cinco minutos y la vas a necesitar igual.

### 3. El servicio del orquestador en Railway

`amg_orquestador` ya tiene password si se siguió C.2. Si no, ponésela ahora y armá los **dos** DSN que
el proceso necesita — son dos credenciales distintas a propósito (ADR-17), y esa separación es la mitad
del modelo de seguridad:

```
DATABASE_URL_ORQUESTADOR = postgresql://amg_orquestador.<project-ref>:PASS@aws-1-eu-west-2.pooler.supabase.com:6543/postgres
DATABASE_URL_CACHE       = postgresql://amg_cache.<project-ref>:PASS@aws-1-eu-west-2.pooler.supabase.com:6543/postgres
```

**Puerto 6543 (transaction pooler)**, por lo mismo que el renderizador: todo acceso va por transacción
con conexión reservada (ADR-13), que es justo lo que ese modo soporta.

**Y comprobá cada DSN antes de desplegar:**

```bash
npm run credencial -- DATABASE_URL_ORQUESTADOR --ref=<ref> --host=<host>   # la crea y la guarda
npm run probar-dsn -- DATABASE_URL_ORQUESTADOR                             # y la comprueba
```

`probar-dsn` lee el DSN de la fuente (así no queda en el historial de la shell), conecta con el mismo
driver que usa la app y **comprueba que el rol sea el que se espera**. Esa última parte es el punto:
el tropiezo #1 del renderizador fue copiar el DSN y cambiar la password pero no el usuario — eso
**conecta perfectamente** y se lee como éxito, así que un `select current_user` que solo imprime el
nombre depende de que el humano note que está mal.

> Antes acá decía `psql`. **No está instalado en la máquina de desarrollo** (medido el 2026-08-07), o
> sea que este paso —el que el propio runbook llama el tropiezo #1— no se podía ejecutar. `probar-dsn`
> usa `pg`, que ya es dependencia de `db`: no instala nada.

| Campo | Valor |
| --- | --- |
| Root Directory | **vacío** (la raíz del repo) |
| Start command | `npm run serve -w orchestrator` |
| Healthcheck path | `/_health` |

**No pongas `PORT`**: lo inyecta Railway y `server.ts` ya lo lee.

**Sí hace falta un dominio PÚBLICO, y Railway no lo crea solo.** Andá a **Settings → Networking →
Public Networking → Generate Domain**: sale un `*.up.railway.app` gratis, que no cuenta contra el
límite de custom domains del plan (ya alcanzado con dos).

Lo que **no** hace falta es un dominio **propio** (tipo `orquestador.bigballs.es`): al orquestador no
lo visita ninguna persona. Pero público tiene que ser igual, porque **Inngest Cloud le pega a
`/api/inngest` desde internet**. Sin URL pública el proceso queda vivo y sordo: no se puede sincronizar
la app y no le llega ni una invocación.

> Esta distinción confundió de verdad el 2026-08-07. Acá decía "no hace falta custom domain", que se
> lee como "no hace falta dominio", y el servicio quedó sin URL — con el `curl` de §B5 apuntando a un
> host que no existía.

### 4. Las credenciales: el orquestador es el proceso con MÁS del sistema

Es el reverso exacto del renderizador. El renderizador es el rol más pobre porque está expuesto a
internet anónimo; el orquestador es el **composition root** y importa `kr-service` y `web-builder`, así
que necesita lo de los tres módulos a la vez.

**Obligatorias — sin ellas el proceso no arranca** (lo impone `leerConfig()`, y el mensaje las nombra
una por una):

| Variable | Valor |
| --- | --- |
| `DATABASE_URL_ORQUESTADOR` | login `amg_orquestador` → rol `app_service` |
| `DATABASE_URL_CACHE` | login `amg_cache`: solo caches, sin tablas de tenant |
| `INNGEST_SIGNING_KEY` | del proyecto de Inngest Cloud |
| `PIPELINE_MODO` | `mock` o `live`, **sin default**: declará qué está corriendo este despliegue (§5) |

**Del pipeline — el proceso arranca sin ellas y corre en modo mock:** `DATAFORSEO_MODE`,
`DATAFORSEO_BASE_URL`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `LLM_PROVIDER`, `OPENAI_API_KEY` (o
`ANTHROPIC_API_KEY`), `WEB_PUBLISH_MODE`, `STORYBLOK_MANAGEMENT_TOKEN` (el de **escritura** — el que el
renderizador nunca ve), `STORYBLOK_REGION`.

> Los **embeddings son solo de OpenAI**: sin `OPENAI_API_KEY`, el clustering usa embeddings mock aunque
> el LLM sea Anthropic (`kr-service/src/config.ts:66`). Y los modelos de Anthropic están
> **hardcodeados**, no son variables de entorno.

**🔴 Las que NO hay que poner:**

| Variable | Por qué |
| --- | --- |
| `INNGEST_EVENT_KEY` | El orquestador **no emite eventos** (medido: `grep '\.send('` en `orchestrator/src` da cero). Es de la API |
| `DATABASE_URL` | En Railway es el nombre que el plugin de Postgres inyecta solo, y apunta al **dueño** de la base: aceptarlo le daría al orquestador un login capaz de asumir cualquier rol, y ADR-17 pasaría a ser una coincidencia de nombres. En producción el código la **rechaza** |
| `STORYBLOK_SPACE_ID` | El space sale de `clients.storyblok_space_id` bajo RLS, por cliente (ADR-04) |
| `INNGEST_DEV` | Fuerza modo dev y **desactiva todas las validaciones de producción**. Es la escotilla local, no una variable de despliegue |
| `DFS_PERMITIR_REPAGO` | Autoriza pagar dos veces. Lo decide un humano mirando el panel |

> **Cómo llegan esas variables en local:** `kr-service/src/config.ts:1` hace `import "dotenv/config"`,
> que carga el `.env` del **cwd del proceso**. Medido: `npm run serve -w orchestrator` corre con cwd
> `orchestrator/`, así que lee `orchestrator/.env` — aunque su `package.json` no declare `--env-file`.
> En Railway no aplica: ahí las variables se inyectan al entorno.

### 5. ⚠️ Antes de conectar DataForSEO en vivo, decidilo a propósito

El valor es **exactamente `DATAFORSEO_MODE=live`**, y conviene saber por qué se dice así: cualquier
otro valor —`production`, `prod`, un typo— devuelve el **mock** sin avisar
(`kr-service/src/dataforseo/index.ts:26`: `if (config.dataforseo.mode !== "live") return new
MockProvider()`). _(Este runbook decía `production` cuando se escribió. Lo cazó midiendo el código
quien implementó el tramo A, no quien lo escribió.)_ Sandbox o producción es una **segunda** variable:
`DATAFORSEO_BASE_URL`, cuyo default es sandbox y donde `isSandbox` se decide por si la URL contiene la
palabra.

Con las dos puestas de verdad, **cada research lanzado desde el portal cuesta ~$0.31 y tarda ~16
minutos** (medido en la Acción 06). Con el orquestador desplegado, ese botón deja de ser una demo: lo
aprieta cualquiera con rol `equipo` y se paga solo.

> #### `PIPELINE_MODO`: por qué tenés que declarar qué estás desplegando
>
> Al revés también duele, y peor. Un despliegue **sin** `DATAFORSEO_MODE=live` corría entero y sin un
> solo error, generaba keywords **inventadas** por el `MockProvider`, las escribía en la base **real**
> del cliente y dejaba el run en `pending_approval` con su informe. **Nadie podía distinguir eso de un
> research legítimo mirando el portal** — un volumen de búsqueda falso es un número plausible en una
> columna que nadie audita a ojo. (La prosa mock sí se nota leyéndola, y el publisher en dry-run
> reporta `published: false`; DataForSEO era el único invisible, y es el 81% del costo.)
>
> Por eso `PIPELINE_MODO` es **obligatoria en producción y no tiene default**. No enciende ni apaga
> nada: `DATAFORSEO_MODE` sigue siendo quien manda. Es una **declaración del operador** que el arranque
> contrasta contra la configuración real, y aborta si se contradicen **en cualquiera de las dos
> direcciones**:
>
> | Contradicción | Por qué aborta |
> | --- | --- |
> | `PIPELINE_MODO=live` + DataForSEO en mock | Research falso presentado como real en la base del cliente |
> | `PIPELINE_MODO=mock` + DataForSEO en vivo | **Se gasta en un despliegue anotado como gratuito** |
>
> Así, desplegar primero en mock —el paso de acá arriba— sigue siendo legítimo, pero pasa a ser una
> decisión escrita en vez de un olvido. El modo activo se ve en `/_health`
> (`{"modo":"cloud","pipeline":"mock","publicacion":"dry-run"}`): una declaración que solo viviera en
> el panel de variables de Railway no se podría auditar mirando el servicio.
>
> **`publicacion` es el otro modo, y no es el mismo.** `pipeline` dice si el research gasta;
> `publicacion` dice a dónde va lo que se publica, y sale de **tres** entradas
> (`WEB_PUBLISH_MODE`, `STORYBLOK_DRY_RUN` y el token), así que el panel no alcanza ni leyéndolo
> entero:
>
> | `publicacion` | Qué hace | Ojo |
> | --- | --- | --- |
> | `mock` | Escribe story + preview en `out/` | ⚠️ Reporta `published: true` — la base anota como publicadas páginas que nunca salieron del contenedor, en un `out/` que se evapora en el próximo deploy. **Es el default** |
> | `dry-run` | Escribe en `out/storyblok/` el payload exacto que enviaría | Lo que hay que usar para ejercitar el circuito sin consecuencias |
> | `live` | Publica de verdad en el space del cliente | Es el techo del proceso: un cliente sin `storyblok_space_id` cae igual a dry-run en su propia corrida |

**Desplegá primero en modo sandbox/mock y verificá el circuito entero.** El pipeline corre sin una sola
credencial de proveedor, así que se puede comprobar que el evento llega, que los steps corren, que el
run queda en `pending_approval` con su informe y que la compuerta despierta al workflow — **sin gastar
un céntimo**. Recién con eso verde, decidí si se conecta la cuenta real.

### 5.b Sincronizar la app en Inngest — el paso que faltaba acá

Registrar las funciones es un `PUT` **a tu propio servicio**: el SDK se introspecciona y **envía** el
manifiesto a la API de Inngest, autenticándose con `INNGEST_SIGNING_KEY`.

```bash
curl -X PUT https://<tu-orquestador>.up.railway.app/api/inngest
# {"message":"Successfully registered","modified":true}
```

> **Lo que ese OK prueba, y lo que no.** Prueba la dirección **saliente** (orquestador → Inngest), o
> sea que la signing key es válida. **No** prueba la entrante, que es la que usa Inngest para
> invocar funciones — y es justo la que el tramo A tenía rota. Un `GET /api/inngest` sin firmar
> devuelve **401**, y ese 401 no distingue "te rechaza a vos" de "va a rechazar a Inngest". Lo único
> que separa los dos casos es el §6.3.
>
> En el panel, la app aparece con **2 funciones**: nuestro código registra una, e Inngest cuenta el
> manejador `onFailure` como otra. No es una discrepancia con el `funciones: 1` del health check.

### 6. Verificación

1. `/_health` responde 200 (no prueba que funcione: prueba que el proceso vive — ver el aviso de
   abajo).
2. En el panel de Inngest, la app aparece **sincronizada** y lista sus funciones.
3. Lanzá un research desde el portal con los providers en mock: el run tiene que pasar de `running` a
   `pending_approval` **con su informe**, y el brief verse en el portal.
4. Aprobá el run y comprobá que el workflow **despierta** y publica.
5. Mirá los logs del servicio: no tiene que haber ni un `Cannot find package` ni una caída a PGlite.

> **Hecho el 2026-08-07, del 1 al 3:** 124 keywords, 25 páginas, 1 informe, $0.00, en menos de diez
> segundos. El paso 4 (aprobar → publicar) quedó **sin probar**: escribe en el espacio real de
> Storyblok del cliente y hay que decidir antes en qué modo está `WEB_PUBLISH_MODE`.

> ### 🔴 Lo que costó hora y media, y no fue el código
>
> Los tres servicios se rompieron **editando variables a mano en el panel de Railway**: el orquestador
> arrancó con `@base:` de host (`getaddrinfo ENOTFOUND base`), al corregirlo se borraron las dos
> variables enteras, y al renderizador le desaparecieron las suyas porque se editó el servicio
> equivocado.
>
> **Tres cosas que hacen esto difícil de ver, y conviene tenerlas presentes:**
>
> 1. **`/_health` responde `{"ok":true}` con la base inalcanzable.** No la toca a propósito. Para el
>    orquestador eso significa que se declara sano sin poder hacer nada.
> 2. **Un servicio que responde 200 puede tener el deploy en rojo.** Railway mantiene el contenedor
>    anterior mientras el nuevo falla: "responde" y "está desplegado" no son lo mismo. La verdad está
>    en la pestaña **Deployments**, no en un `curl`.
> 3. **`npm run probar-dsn` verifica la FUENTE, no el despliegue.** Da verde con
>    `docs/private/credenciales.env` correcto aunque Railway tenga basura. Son dos afirmaciones
>    distintas y hoy la que importaba era la segunda.
>
> Y una cuarta, del diseño: cuando el workflow falla porque no alcanza la base, el `onFailure`
> —cuya única acción es `failRun()`, o sea **escribir en la base**— falla por lo mismo, y el run se
> queda en `running` para siempre. La red de seguridad comparte su punto de fallo con lo que protege.

---

## Dar de alta el sitio de un cliente: primero la demo, después su dominio

**El renderizador es un proceso y N dominios** (ADR-19), y resuelve por la cabecera `Host` contra
`clients.domain`. Así que el DNS y el certificado deciden **cómo llega** la petición, no qué se
renderiza — y eso permite verificar el render antes de tocar ningún DNS.

### 0. ⚠️ Verificar con un `Host` falso NO funciona, y el fallo es silencioso

La idea evidente es ejercitar el render sin tocar DNS:

```bash
curl -sI -H "Host: elcliente.es" https://amg-renderer-production.up.railway.app/   # ❌ no prueba nada
```

**No llega al renderizador.** El edge de Railway enruta por `Host`: si ese host no es un custom
domain **suyo**, cae en su propio fallback y el proceso nunca ve la petición. Medido el 2026-08-10.

Y el fallo es de los peores, porque devuelve **404 igual** que un dominio no dado de alta: alguien
concluiría "el cliente no está en `clients`" cuando la petición ni salió del borde. Se distinguen por
las cabeceras:

| | 404 del **edge de Railway** | 404 del **renderizador** |
| --- | --- | --- |
| `content-type` | `application/json` | `text/plain; charset=UTF-8` |
| `cache-control` | `max-age=5` | `public, max-age=30` |
| Seña | `x-railway-fallback: true` | cuerpo `Not Found` |

**Lo que sí funciona** es cualquier host que Railway ya conozca — y con el wildcard de abajo, eso
incluye todo `*.bigballs.es`. O sea: la forma de probar un sitio sin tocar el DNS del cliente es
**darlo de alta bajo el subdominio de demo**, que es justamente el flujo de esta sección.

### 1. El wildcard de demo, UNA sola vez

Los sitios de demo viven en subdominios nuestros (`birrabar.bigballs.es`). Con un wildcard, dar de
alta uno nuevo deja de tocar Railway: es una fila en `clients` y nada más.

1. **Railway → el servicio del RENDERIZADOR** (⚠️ no el de la API: los custom domains se agregan
   dentro de un servicio, y puesto en el equivocado el certificado se emite para el proceso que no
   es. Ya pasó una vez) → *Networking* → *Custom Domain* → `*.bigballs.es`. Copiá el destino CNAME.
2. **Hostinger → DNS de `bigballs.es`** → CNAME, nombre `*`, destino el de Railway, TTL 300 mientras
   probás.

   ⚠️ **Un certificado WILDCARD no se valida por HTTP: Let's Encrypt exige el reto DNS-01.** Por eso
   Railway pide además un `_acme-challenge.bigballs.es` (en nuestro caso, un CNAME delegando a
   `…authorize.railwaydns.net`). **Sin ese registro el dominio no se verifica nunca**, por mucho que
   esperes — y el panel no lo explica. Es la diferencia con un dominio normal, que sí valida por HTTP.
3. Esperá a que Railway lo marque **verified**: hasta entonces no hay certificado y el navegador da
   error de TLS. Es normal, no es un fallo.
4. **La comprobación es un 404**, y eso es el éxito:

   ```bash
   curl -sI https://loquesea.bigballs.es/     # → HTTP/2 404
   ```

   Significa que el DNS resolvió, el TLS cerró y el renderizador dijo «no conozco ese host». **No hay
   dominio por defecto y no puede haberlo**: un fallback convertiría cualquier host apuntado a
   nuestra IP en una copia de la web de un cliente ajeno.

   ⚠️ **Comprobá de quién es ese 404** (ver el paso 0): tiene que traer `content-type: text/plain` y
   `cache-control: public, max-age=30`. Si trae `x-railway-fallback: true`, el wildcard **no** está
   enrutando al servicio y el 404 es del borde — que se parece mucho a que todo funcione.

   **Medido el 2026-08-10: el certificado wildcard tardó 7 minutos** desde que el CNAME propagó.

`api.bigballs.es` no se rompe con el wildcard: en DNS el registro específico gana.

5. **La variable que evita que Google indexe las demos.** En Railway, servicio del renderizador:

   ```text
   DOMINIO_PREVIEW=bigballs.es
   ```

   Con ella, todo host bajo ese dominio se sirve con `X-Robots-Tag: noindex, nofollow`. Sin ella no se
   emite nada, y una demo indexada compite en Google con la web real del cliente el día que lance.
   **Al arrancar, el log dice cuál quedó activo** (`noindex de demo: *.bigballs.es`) — una variable
   mal escrita no da error en ninguna parte, así que esa línea es la única señal.

   ⚠️ **No pongas un `/robots.txt` con `Disallow`.** Es el error clásico: bloquear el rastreo impide
   que Google **lea** el `noindex`, y entonces puede listar la URL igual, sin contenido. Para
   desindexar hay que dejar entrar.

   ⚠️ Esta variable **no** va por `env:sync` (es configuración, no credencial), así que
   `npm run auditar:railway` la va a listar como una diferencia más entre Railway y el reparto. Es
   intencional, y ésta es la constancia.

### 2. Cada cliente de demo: una fila

```sql
insert into clients (tenant_id, nombre, domain, storyblok_space_id,
                     storyblok_public_token, storyblok_preview_token, business_profile)
values ('<tenant>', 'La Birra Bar', 'birrabar.bigballs.es', '<space>',
        '<token public>', '<token preview>', '<perfil jsonb>');
```

`domain` tiene un `check` de forma canónica (minúsculas, sin puerto, 4-253 caracteres) y un índice
**único**: dos clientes no pueden compartir dominio. Verificá con `curl -sI https://birrabar.bigballs.es/`
→ 200.

### 3. El día que sale a producción

**Un cliente tiene UN dominio.** `clients.domain` es único y hay una sola columna, así que la demo y
el dominio propio **no conviven**: el lanzamiento es cambiar el valor.

```sql
update clients set domain = 'labirrabar.es' where domain = 'birrabar.bigballs.es';
```

Desde ese instante la demo devuelve 404 y el sitio responde por el dominio del cliente. Además:

1. El cliente apunta su DNS a Railway (CNAME en un subdominio; en el apex, ALIAS/ANAME — un CNAME en
   el apex no es válido).
2. Su dominio se agrega como **custom domain** del servicio del renderizador. ⚠️ **Acá el límite de
   custom domains vuelve, uno por cliente**: el wildcard resuelve las demos, no la cartera en
   producción. Eso sigue siendo el bloque G del plan (una CDN delante del renderizador).
3. La cache no hay que tocarla: su clave es `space:slug`, no el dominio.

**Si algún día hace falta que convivan** —seguir enseñando la demo con el sitio ya lanzado— hay que
darle a un cliente más de un dominio: una migración (columna o tabla `client_domains`) y un cambio en
`PgSitios`. Es trabajo del agente `datos`, y hoy no está hecho.

## Troubleshooting (los errores que más probablemente veas)

| Síntoma                                                                                                    | Causa probable                                          | Fix                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| La API no arranca, log dice `Faltan variables de entorno`                                                  | Falta una var obligatoria en Railway                    | Completá `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS`.                                                                                   |
| El login falla con `Token inválido o expirado` y las credenciales son correctas                            | El proyecto firma con un algoritmo que la API no acepta | Mirá `curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`: el `alg` que declare es el que `api/src/auth.ts` tiene que exigir.         |
| La API responde `503` con `No se puede verificar el token`                                                 | No puede bajar el JWKS de Supabase                      | No es un problema de credenciales. Comprobá que `SUPABASE_JWT_ISS` sea exactamente `https://<ref>.supabase.co/auth/v1` y que Supabase esté arriba. |
| Rotaste la clave de firma **por sospecha de compromiso** y la vieja sigue funcionando                      | La API cachea el JWKS 10 minutos                        | Rotar en Supabase no alcanza: **reiniciá el servicio de la API en Railway** para vaciar el caché. En una rotación planificada no hace falta.       |
| El renderizador da `Application not found` (JSON de Railway)                                               | Railway no tiene app sirviendo ese host                 | El deploy no está "Active", o el dominio está en otro servicio. Mirá Deployments y en qué servicio agregaste el dominio.                            |
| El renderizador da 404 en `/` pero `/_health` responde                                                     | El `Host` no está en `clients.domain`, o es caché negativa | Comprobá la fila (`select domain from clients`). Si acabás de ponerla, esperá un minuto: el renderizador cachea el "no existe" y vence solo.      |
| El renderizador arranca y muere: `Faltan variables de entorno del renderizador`                            | `leerConfig` falla cerrado a propósito                  | Cargá la que nombre el error. No hay defaults: sin `DATABASE_URL_RENDER` y `STORYBLOK_WEBHOOK_SECRET` no levanta.                                    |
| El renderizador no conecta: `password authentication failed` con la password recién puesta                 | El session pooler, o el usuario del DSN                 | Probá 6543. Si fallan los dos puertos, es la password. Y verificá `select current_user`: el DSN tiene que decir `amg_render`, no `amg_api`.          |
| La API no arranca, `tsx: not found`                                                                        | Railway instaló sin devDependencies                     | Agregá la variable `NPM_CONFIG_PRODUCTION=false` y redesplegá.                                                                                     |
| La API no arranca, error sobre `CORS_ORIGINS`                                                              | Pusiste `*`, vacío, o una URL sin esquema               | Poné el origen completo, ej. `https://bigballs.es`.                                                                                                |
| `/health` da 404                                                                                           | La URL o el service están mal                           | Es `GET /health` en la raíz de la API, sin `/api` adelante.                                                                                        |
| El portal carga pero el login/llamadas fallan con error de CORS                                            | `CORS_ORIGINS` de la API ≠ origen real del portal       | Que sean idénticos (`https://bigballs.es`, sin barra final). Si entrás por `www.`, agregá `https://www.bigballs.es`.                               |
| Recargar en `/runs/:id` da 404                                                                             | Falta el `.htaccess` en `public_html`                   | Es un dotfile: subilo explícitamente (o activá "mostrar ocultos" en File Manager). Debe estar junto a `index.html`.                                |
| El portal (https) no puede llamar a la API                                                                 | La API responde por http, no https                      | Activá el custom domain con TLS en Railway; `apiBaseUrl` debe ser `https://api.bigballs.es`.                                                       |
| Login OK pero Frank no ve nada                                                                             | El `app_metadata.tenant_id` no coincide con el del seed | Copiá el `tenant_id` que imprimió `seed:demo` al `app_metadata` de cada usuario.                                                                   |
| **Deploy del portal:** `npm ci` falla con `EUSAGE ... can only install with an existing package-lock.json` | `portal/package-lock.json` no está en el repo           | Es la excepción `!portal/package-lock.json` del `.gitignore`. Commitealo. No se reproduce en local: ahí el archivo existe en disco.                |
| **Deploy del portal:** `Missing script: "build:portal"`                                                    | Directorio raíz y build command no se corresponden      | Con raíz `portal` el comando es `npm run build`. Con raíz `./`, `npm run build:portal`. Ver la tabla en C.6.                                       |
| **Deploy del portal:** instala ~300 paquetes que no usa                                                    | Directorio raíz en `./` en vez de `portal`              | Poné la raíz en `portal`: Hostinger instala solo sus deps, no los 6 workspaces.                                                                    |
| El `app_metadata` no se puede editar desde el dashboard                                                    | Supabase no expone `raw_app_meta_data` en la UI         | Va por SQL Editor, y **fusionando** con el operador de concatenación de `jsonb`: asignar el objeto entero borra `provider` y rompe el login.       |
| Frank NO ve el botón "lanzar research" ni "aprobar y publicar"                                             | Portal desplegado desde antes del 2026-08-07            | Los dos flags se encendieron ese día al desplegar el orquestador. Re-desplegá el portal desde `main`.                                              |

### Dos que no caben en una fila, porque el fix es entender qué pasó

**La API entra en crash loop tras un push que ni siquiera tocaba la API**, con `Falta INNGEST_EVENT_KEY`
en el log. La causa no es el commit: **la API autodespliega con cada push a `main`**, así que un cambio
en `db/` la redespliega igual, y hasta el 2026-08-07 esa clave ausente impedía **arrancar**. El fix es
poner `INNGEST_EVENT_KEY` en el servicio de la API (§1–§2). **No uses `INNGEST_DEV=1`** como atajo:
fuerza modo dev y desactiva todas las validaciones de producción (§4 la lista como prohibida). Desde ese
día la guarda devuelve **503 en `POST /runs`** en vez de tumbar el proceso, así que el síntoma no
debería repetirse — pero el mecanismo (cualquier push redespliega la API) sigue vigente para el resto de
las variables obligatorias.

**Un evento sale sin error y el workflow nunca despierta.** Los dos sospechosos fallan **en silencio**,
que es lo que los hace caros: o la Event Key es de otro **entorno** de Inngest (comprobá el prefijo de
la signing key: `signkey-prod-…`), o el nombre del evento no está en el **allowlist** de la clave (§1).
En los dos casos `send()` devuelve OK y no hay nada en los logs de la API: hay que mirarlo del lado de
Inngest, en el stream de eventos del entorno.

---

## Qué NO entra en Fase 1 (recordatorio)

- **Lanzar research en vivo** y **aprobar el run** (orquestador + Inngest): Fase 2.
- **Las webs de cliente** (renderizador + CDN): Fase 2.

Cuando la Fase 1 esté arriba y estable, se encara la Fase 2 (encender los flags `features.*`,
desplegar orquestador y renderizador). Ver [11-plan-fase-2.md](11-plan-fase-2.md).
