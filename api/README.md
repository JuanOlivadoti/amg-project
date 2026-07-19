# `api` — la API REST autenticada (etapa 5.1)

La superficie HTTP del sistema. Es por donde el portal (y mañana el cliente) tocan el research. Y
porque es donde un usuario final entra por primera vez, es donde una autorización mal puesta se
vuelve escalada de privilegios — así que **la autorización no vive acá: vive en Postgres** (ADR-22).

## El modelo, en una frase

**La API afirma _quién sos_ (verifica el JWT y pone `app.user_id`); _qué podés hacer_ lo deriva RLS
de `memberships`** (ADR-15). El rol no viaja en ninguna petición. Reclamar un `tenant` ajeno no
sirve: sin membresía allí, RLS no deriva rol y no se ve ni se escribe nada.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/runs` | Crea la fila del run **bajo RLS** y —solo si no lanzó— emite `research/solicitado`. |
| `GET` | `/runs` (`?clientId=`) | Los runs que el usuario puede ver. RLS decide el conjunto. |
| `GET` | `/runs/:id` | El brief: el run + páginas propuestas (con evidencia y estado de aprobación). |
| `POST` | `/pages/:id/approve` | Aprueba una página (media compuerta, ADR-06). |
| `PATCH` | `/pages/:id` | Corrige una página. **Editar revoca la aprobación** (ADR-06). |
| `POST` | `/runs/:id/approve` | Aprueba el run bajo RLS y —solo si de verdad actualizó— emite `research/aprobado`. |

Todas exigen `Authorization: Bearer <jwt>` y `x-amg-tenant: <uuid>`.

## Comandos compuestos: el orden ES la seguridad (ADR-18)

`POST /runs` y `POST /runs/:id/approve` escriben **bajo RLS primero** y emiten el evento **después**.
Si la base rechaza la escritura, no se emite nada: el orquestador nunca arranca (ni publica) a nombre
de algo que la base no autorizó. Está probado por mutación (invertir el orden rompe los tests).

## Cómo está armado (y por qué se testea sin nada)

- `app.ts` — las rutas Hono. **No sabe** de Postgres, Inngest ni Supabase: recibe `{ store, emisor,
  verificar }` inyectados.
- `auth.ts` — verifica el JWT de Supabase (HS256) y arma el `TenantContext`. El verificador se inyecta.
- `solicitar.ts` — el comando compuesto de `POST /runs`.
- `deps.ts` / `server.ts` — el composition root real: pool de `amg_api` → `app_user` (ADR-17), Inngest
  como emisor, y el arranque del server. **El único lugar que toca credenciales.**

Como todo se inyecta, la suite corre la API entera contra **PGlite** (Postgres real en WASM), un
emisor de mentira y un verificador falso — sin red, sin Supabase, sin una sola credencial. Es el
mismo principio que ya hacía testeable a RLS.

## Correr

```bash
# Tests (sin credenciales):
npm test -w api

# Servidor de DESARROLLO: la API real sobre PGlite, sin credenciales ni Supabase.
# Siembra dos runs con páginas e imprime la sesión para pegarle al portal.
npm run dev:server -w api

# Servidor de producción (requiere config real):
DATABASE_URL_API=postgres://amg_api:...@host/db \
SUPABASE_JWT_SECRET=... \
npm run serve -w api
```

> `dev:server` usa un **verificador de token falso** (`valid:<uuid>`) y una base en memoria. Es lo
> que permite levantar el portal contra una API de verdad sin tener Supabase ni Postgres — y es
> posible **solo porque `createApp` recibe todo inyectado**. Aborta si `NODE_ENV=production`.

`DATABASE_URL_API` es el login `amg_api` (rol `app_user`). Si falta algo, la API **no arranca**:
una API a medio configurar es un riesgo, no una comodidad.

### Variables

| Variable | Default | Para qué |
|---|---|---|
| `DATABASE_URL_API` | **obligatoria** | Login `amg_api` → rol `app_user`. No puede asumir `app_service` (ADR-17). |
| `SUPABASE_JWT_SECRET` | **obligatoria** | Verifica la firma del token (HS256). |
| `SUPABASE_JWT_AUD` | `authenticated` | `aud` esperado. Es lo que emite Supabase para un usuario logueado. |
| `SUPABASE_JWT_ISS` | *(no se exige)* | `iss` esperado (`https://<proy>.supabase.co/auth/v1`). **Configuralo en producción**: cierra la puerta a un token válido de OTRO proyecto Supabase. |
| `CORS_ORIGINS` | `*` | Orígenes del portal, coma-separados. Seguro con `*` porque se autentica por header, no por cookies. |
| `PORT` | `3000` | |

> 🔐 **Al token se le exige `exp` y `sub`, no solo la firma.** `jwtVerify` valida la expiración *si el
> claim está*, pero no lo exige: un token firmado con el secreto correcto y **sin `exp` era eterno**.
> Lo encontró la 8ª review, y sobrevivió porque los tests inyectan un verificador falso y **nadie
> probaba el real**. Hoy hay 9 tests con JWT firmados de verdad (`auth.test.ts`).
