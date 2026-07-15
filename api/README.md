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

# Servidor (requiere config real):
DATABASE_URL_API=postgres://amg_api:...@host/db \
SUPABASE_JWT_SECRET=... \
npm run serve -w api
```

`DATABASE_URL_API` es el login `amg_api` (rol `app_user`). Si falta algo, la API **no arranca**:
una API a medio configurar es un riesgo, no una comodidad.
