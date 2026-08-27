---
name: datos-api
description: Usar al tocar api/ — un endpoint nuevo, el middleware de autenticación, la verificación del JWT, CORS, el mapeo de errores de Postgres a códigos HTTP, o qué puede y qué no puede venir en un body. Cubre el orden de los middlewares como decisión de seguridad, el comando compuesto fila-primero-evento-después, y por qué la API afirma quién sos pero nunca qué podés hacer.
---

# La API de AMG OS

`api/` es una fachada HTTP sobre la capa de datos: **Hono**, un middleware de autenticación y diecisiete
rutas (contá con `grep -cE "app\.(get|post|patch|put|delete)\(" api/src/app.ts` en vez de creerle a
esta cifra). Lo que decide de verdad es poco, y conviene tenerlo nombrado:

1. **Quién es** quien pide (verifica el JWT y deja el `sub` en el contexto).
2. **El orden** entre escribir en la base y emitir un evento (ADR-18).
3. **Qué forma** tiene un body aceptable.

**Lo que NO decide: qué puede hacer.** Eso lo deriva Postgres de `memberships` (ADR-15). Un `if` de
rol en un handler es la señal de que algo se está autorizando en el lugar equivocado — ver
`datos-postgres`.

## Todo inyectado: `ApiDeps`

`createApp(deps)` no construye nada: recibe el store, el CRM, las membresías, el emisor de eventos y el
verificador de token (`api/src/app.ts:12-28`). Por eso los tests corren **la API entera contra PGlite**
con un emisor de mentira y un verificador falso, sin red y sin Supabase.

El composition root es `api/src/deps.ts`: **el único archivo que toca credenciales y red.** Si te
encontrás importando `pg`, `inngest` o leyendo `process.env` desde `app.ts`, eso va en `deps.ts`.

`leerConfig()` **falla cerrado**: sin `DATABASE_URL_API`, `SUPABASE_JWT_ISS` o `CORS_ORIGINS`, la API
no arranca. Es preferible a levantar y rechazar todos los logins, que desde afuera se ve igual.

## El orden de los middlewares ES la seguridad

```ts
app.use("*", cors({ … }));                    // 1. el preflight responde ANTES de exigir token
app.get("/health", (c) => c.json({…}));       // 2. la ÚNICA ruta pública
app.use("*", autenticar(deps.verificar));     // 3. de acá en adelante, todo exige token
```

Los tres tienen su motivo, y ninguno es cosmético:

1. **CORS primero.** El preflight (`OPTIONS`) no lleva `Authorization`. Si el middleware de auth
   corriera antes, el navegador nunca llegaría a mandar el request real.
2. **`/health` sin auth y ANTES del middleware.** El PaaS la sondea para saber si el proceso vive; un
   health-check que necesitara un JWT no serviría para eso. No toca la base y no revela nada.
3. **Todo lo demás exige token.** Seguro por defecto: una ruta nueva queda protegida sin hacer nada.
   Si agregás una ruta pública, va **arriba** del `autenticar` y con su motivo escrito.

## CORS: por qué el default `*` no es un agujero (pero producción no lo usa)

`createApp` defaultea a `origin: "*"`, y es seguro **porque la API autentica por header
`Authorization`, no por cookies**: no hay credencial que un origen ajeno pueda hacer viajar sola. El
token igual hay que tenerlo.

Pero `leerConfig` —el arranque de **producción**— exige `CORS_ORIGINS` y **prohíbe `*`
explícitamente**, además de rechazar orígenes vacíos (una coma colgando) y cualquier cosa que no sea
una URL http(s) completa sin path. El razonamiento: *una restricción declarada y no impuesta no es una
restricción* (`api/src/deps.ts:39-68`).

Ese razonamiento va escrito donde está. Sin él, alguien "arregla" el default.

## Lo que nunca puede venir en un body

`role`, `tenant_id`, `client_id` propio. El tenant sale del **header ya validado**, el usuario del
**token verificado**, y el rol **de la base**.

Lo que sí se hace en el borde HTTP —y no es autorización— son **allowlists de forma**:

| Función | Qué filtra |
|---|---|
| `filtrarCambios` | los 5 campos editables de una página |
| `filtrarCamposCliente` | las columnas del CRM, compartida entre POST y PATCH |
| `ROLES_ASIGNABLES` | allowlist **positiva**: `maestro`, `equipo`, `cliente` — nunca `servicio` |

Son **defensa en profundidad**: `PgStore.editPage` y `PgClientes` ya tienen la suya. La de acá evita
además cargar la base con basura.

Y el criterio que las hace útiles: son **positivas**. `tenant_id`, `rol` e `id` no están en la lista,
así que un body que los traiga nunca los toca — no hace falta ignorarlos explícitamente. Construir un
`update` a partir de las claves que mande el llamador es cómo un endpoint de edición se convierte en
una escalada de privilegios.

`ROLES_ASIGNABLES` excluye `servicio` aunque sea un `user_role` válido: la identidad del orquestador
está atada a una **credencial de Postgres**, no a una fila de `memberships`. La constraint
`membresia_no_es_servicio` ya lo rechazaría (23514 → 400); la allowlist además lo hace explícito sin
gastar un viaje a la base.

## Comando compuesto: la fila primero, el evento después (ADR-18)

**Un evento no porta autoridad.** El patrón, en los dos endpoints que lo usan (`POST /runs` y
`POST /runs/:id/approve`):

```ts
const decisionId = await deps.store.registrarDecision(ctx, runId, destino);  // 1. la base autoriza (RLS)
if (!decisionId) return c.json({ error: "No autorizado…" }, 403);
await deps.emisor.send({ name: "research/aprobado", data: { tenantId, decisionId } });  // 2. solo si no lanzó
```

> `PgStore.approveRun` (el método que usaba este ejemplo) se retiró en el sub-proyecto de
> 2026-08-26 — `registrarDecision` es su reemplazo, con la misma forma defensiva (fila primero,
> evento después) pero devolviendo el id de la decisión en vez de un booleano.

Si RLS rechaza, no se emite nada: el orquestador nunca arranca a nombre de un run que la base no
autorizó. Y del otro lado, el orquestador **vuelve a preguntarle a la base** qué publicar
(`getPublishablePages`) en vez de creerle al evento.

**El caso que justifica el booleano**, y que es fácil de romper: el rol `cliente` puede **leer** el run
—así que pasa el conteo de páginas aprobadas— pero **no actualizarlo**, con lo que el `update` afecta
**0 filas en silencio**. Sin ese `ok`, la API creería que aprobó, devolvería 200 y **despertaría al
workflow** por algo que la base no cambió. Cada vez que un método del store pueda afectar 0 filas por
RLS, tiene que devolver si las afectó.

## El JWT: ES256 contra el JWKS del emisor (ADR-23)

No hay secreto compartido. Supabase firma con clave asimétrica y **la privada nunca sale de
Supabase**, así que no hay nada que filtrar. `api/src/auth.ts` verifica contra el JWKS del proyecto.

Cinco cosas que se exigen, y las cuatro primeras nacieron de un bug:

- **`algorithms: ["ES256"]`** — lista cerrada de uno. Con clave pública conocida, aceptar un segundo
  algoritmo abre la puerta a validar el token contra una clave que no debería firmarlo.
- **`requiredClaims: ["exp", "sub"]`** — `jwtVerify` valida la expiración *si el claim está*, pero **no
  lo exige**: un token bien firmado y **sin `exp` no caducaba nunca**. (Lo encontró la 8ª review; el
  verificador no tenía ni un test.)
- **`sub` no vacío** — un `sub` en blanco dejaría `app.user_id` vacío y no identifica a nadie.
- **`audience` con `||`, no `??`** — con `??`, una variable de entorno vacía o un trim de más apagaba
  la comprobación **en silencio**.
- **El `issuer` sale del mismo valor que la URL del JWKS.** `emisorSupabase()` valida y canoniza en un
  único lugar y **lanza al arrancar** si no cierra. Si se le quitara la barra final solo para armar la
  URL del JWKS, el `iss` exigido no coincidiría con el que emite Supabase y **ningún token
  verificaría**. Y exigir solo `https` no alcanza: `https://atacante.example/auth/v1` es https, y
  sustituiría el emisor de confianza entero.

## 401 vs 503: la distinción que le salva la sesión al usuario

- **401** — la credencial está mal (firma inválida, expirado, claim que no cierra).
- **503** — **no se pudo comprobar**: JWKS inalcanzable, DNS caído, timeout.

Los dos deniegan. Lo que cambia es qué se informa, y por qué importa: **el portal trata cualquier 401
como "token vencido", quema el refresh token y reintenta.** Con 401 en una caída de Supabase, una
interrupción de infraestructura le destruye la sesión a todo el mundo.

La lista `CODIGOS_DE_TOKEN` enumera los códigos de `jose` que hablan **del token**; todo lo demás es
infraestructura. El criterio es *enumerar lo enumerable* — un fallo de red no siempre trae código
(está medido: un resolvedor que rechaza llega **sin `code`**), y tratar el resto como infra es lo
único que no deja un caso sin clasificar.

`ERR_JWKS_MULTIPLE_MATCHING_KEYS` **no** está en la lista, con su trade-off escrito: durante una
rotación que publica dos claves ES256, cualquiera puede forzar un 503 con un JWT sin `kid`. No es
escalada (no otorga acceso), pero ensucia métricas. Se eligió así porque la alternativa —401— le
cuesta la sesión a un usuario con una credencial perfectamente buena.

## El `onError`: de código de Postgres a código HTTP

```
42501  insufficient_privilege  → 403 SIEMPRE, sin detalle, y el error completo al log
22P02 / 23502 / 23503 / 23514  → 400 (uuid inválido, NOT NULL, FK, CHECK: culpa del cliente)
reglas de negocio del store    → 409 ("ninguna página aprobada", "ya existe y no pertenece")
lo demás                       → 500
```

**No parsear el texto de los errores.** La versión anterior separaba RLS de un GRANT roto mirando si el
mensaje decía `row-level security`; la 9ª review lo cazó: **Postgres traduce los mensajes según
`lc_messages`**, así que en un servidor no-inglés un rechazo legítimo de RLS salía como **500 en vez de
403**. Parsear texto de errores es una dependencia del idioma disfrazada de lógica.

El 403 sin detalle es correcto para los dos casos (no se le filtra al cliente si fue RLS o una
credencial mal configurada), y el log es donde un operador ve la diferencia.

## 404 o 403: qué se revela

- **De otro tenant, o no existe → el mismo 404.** No se distingue: revelar que la fila existe en un
  tenant ajeno ya es información.
- **Existe en mi tenant y no tengo permiso → 403.** Se consigue poniendo la condición de rol en el
  `with check` de la política, no en el `using` (ver `datos-postgres`).

Un `PATCH` que devuelve 404 puede significar tres cosas —no existe, está retirada, o no había cambios
válidos— y el mensaje lo dice sin comprometerse con cuál.

## Al terminar

```bash
npm test -w api            # la API entera sobre PGlite, sin red
npm run dev:server -w api  # la API real sobre PGlite, para manejar el portal contra ella
```

Si cambiaste la **forma del JSON** de una respuesta, es un contrato con `portal/src/app/core/`: los
tests del portal **no** corren en `npm test`. Decilo en el informe con el archivo que hay que tocar; no
lo toques vos.
