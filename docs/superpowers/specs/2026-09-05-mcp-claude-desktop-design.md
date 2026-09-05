# MCP para Claude Desktop — operar AMG OS desde el chat de escritorio

**Fecha:** 2026-09-05 · **Estado:** diseño aprobado, sin implementar

Un servidor MCP local que le da a Claude Desktop un puñado de herramientas para operar AMG OS en
lenguaje natural, actuando **con el usuario y el rol reales de quien lo corre**.

---

## 1. Qué es y qué no es

**Es** un proceso local que Claude Desktop arranca como subproceso (transporte `stdio`) y que habla
HTTP con `api/` — exactamente como el portal, solo que sin pantallas. Vive en la máquina del usuario;
no se despliega en ningún lado.

**No es** un canal para claude.ai. Se descartó explícitamente: un connector de claude.ai exige un
servidor MCP remoto con OAuth accesible desde internet, y eso significaría un endpoint público nuevo
en un sistema donde hoy **la única superficie anónima es el renderizador** (ADR-19). Esa asimetría es
deliberada y no se toca por comodidad.

**No es una segunda API.** No abre conexiones a Postgres, no importa `db/`, no conoce SQL. Todo lo
que hace pasa por endpoints que ya existen y ya están probados.

---

## 2. Por qué construirlo, y qué se acepta a cambio

**Lo que da y ninguna pantalla da:** composición en lenguaje natural. *"¿Qué clientes tienen runs
esperando aprobación hace más de una semana?"* no es una pantalla que exista ni que convenga
construir, pero es trivial si Claude puede listar y cruzar. Y quita fricción de las acciones que hoy
requieren navegar varias pantallas para confirmar una sola decisión.

**Contras que se aceptan a sabiendas:**

- **Mantenimiento permanente.** Cada endpoint nuevo que se quiera manejar desde el chat necesita su
  tool. El portal se rompe visiblemente cuando la API cambia; una tool MCP desactualizada devuelve un
  error raro adentro de una conversación. Es un costo continuo, no de una vez.
- **No da movilidad.** Al descartar claude.ai, esto funciona solo en el escritorio donde esté
  instalado. Si algún día el requisito real es "operar desde el móvil", este diseño no lo cubre y
  habría que rediseñar, no extender.
- **Alternativa más barata, puesta sobre la mesa y descartada:** Claude Code, ya instalado en esta
  máquina, con acceso al repo y a la API local, cubre buena parte de esto hoy sin construir nada. Se
  eligió construir igual porque Claude Code es una herramienta de desarrollo —arranca frío, vive en
  una terminal— y lo que se busca es operación cómoda en la ventana donde ya se trabaja.

---

## 3. Decisiones de diseño

### 3.1 Cliente de la API, nunca de la base

El servidor MCP manda el JWT del usuario y el header de tenant, y deja que **Postgres derive el rol
desde `memberships`** (ADR-15). No hay una capa de permisos nueva en TypeScript, porque una capa de
permisos nueva es una capa de permisos que puede discrepar de la que manda.

Se evaluó y se descartó darle acceso SQL directo: contradice ADR-13 (solo por transacción con
contexto de tenant) y ADR-15, y convertiría el chat en un canal con más poder que cualquier rol
humano del sistema.

### 3.2 Dos binarios, no uno: el login no puede vivir adentro del servidor

Un servidor MCP `stdio` tiene **stdin y stdout tomados por el protocolo JSON-RPC** y no tiene TTY:
Claude Desktop lo arranca como subproceso. Pedir una contraseña ahí corrompe el transporte. Por eso:

- **`npm run mcp:login -w mcp-server`** — se corre a mano en una terminal normal. Pide email y
  contraseña, hace el login contra Supabase, escribe el archivo de sesión y termina.
- **el servidor MCP** — solo **lee** ese archivo. Si no existe, está vencido o el refresh falla,
  **no intenta autenticar**: devuelve un error accionable ("corré `npm run mcp:login`") en la
  respuesta de la tool, que es lo único que Claude puede mostrarle al usuario.

### 3.3 El tenant no se elige: viene firmado

`tenantId` sale de `app_metadata.tenant_id` del propio JWT
([`portal/src/app/core/auth-core.ts:12`](../../../portal/src/app/core/auth-core.ts)), no de una
elección del usuario ni de una tool. El comando de login lo extrae de la respuesta de GoTrue y lo
guarda junto a los tokens; el servidor lo manda en `x-amg-tenant` en cada request, siempre el mismo.

**Si el usuario no tiene `app_metadata.tenant_id`, el login falla ruidosamente** y no escribe
sesión. El portal contempla ese caso (usuario que existe en Auth pero sin acceso al tenant) y lo dice
en pantalla; acá el equivalente es no dejar una sesión inservible en disco que produzca `400` en cada
tool más adelante.

### 3.4 Las tools de escritura reciben UUID, jamás un nombre

Elegir cliente por nombre desde un chat es una clase de error, no un detalle: con "Bella Napoli" y
"Bella Napoli Centro" conviviendo, una aproximación equivocada aprueba el run del cliente que no era,
sobre datos reales, sin que nadie lo note.

Por eso el flujo es de dos pasos y no se puede saltear: **`amg_listar_clientes` devuelve id + nombre,
y las tools de escritura piden el UUID.** La resolución nombre→id la hace Claude mostrando lo que la
lista devolvió, no adivinando. Cuando haya ambigüedad, va a tener que preguntar, que es exactamente
lo que se busca.

### 3.5 El diagnóstico de lectura queda AFUERA de este diseño

Se evaluó agregar el servidor MCP oficial de Supabase para diagnóstico. **Contradice el modelo de
permisos elegido:** usa credenciales de proyecto, no la sesión del usuario, y lee todo sin pasar por
RLS. Es la puerta que se descartó a propósito en §3.1.

No está prohibido —es la máquina del usuario y la decisión es suya— pero **no es parte de este
diseño ni de este paquete**. Si algún día se agrega, se agrega como lo que es: un canal aparte, en
modo lectura, con más poder que el MCP propio y elegido conscientemente.

**Consecuencia que hay que decir en voz alta:** el pedido original incluía diagnóstico técnico de
lectura (migraciones aplicadas, conteos, logs). La v1 **no lo cubre**. Cubre lectura de *estado de
negocio* —clientes, runs, informes—, que es otra cosa. El diagnóstico técnico queda sin resolver a
propósito, porque las dos formas de resolverlo (el MCP de Supabase, o tools propias con una
credencial más poderosa) rompen el modelo de permisos que se eligió como base de todo el diseño.

### 3.6 La lógica de GoTrue se duplica, y se declara

El portal no usa `@supabase/supabase-js`: habla el endpoint REST de GoTrue con `fetch` directo
(`POST {supabaseUrl}/auth/v1/token?grant_type=password` y `grant_type=refresh_token`). Esa lógica
vive en [`portal/src/app/core/auth-core.ts`](../../../portal/src/app/core/auth-core.ts), que es
TypeScript puro con tests de `node:test` — portable, pero **fuera del monorepo a propósito** (el
toolchain de Angular no se mezcla).

**Se duplica en `mcp-server/`, y es una decisión, no un descuido.** Extraerlo a un paquete compartido
obligaría al portal a consumir un workspace del monorepo y a cambiar su build por un beneficio chico.
La copia del MCP es además **más pequeña** que la del portal: solo login y refresh, sin `rol`, sin
capacidades, sin `localStorage`. Queda un test que fija la forma del request a GoTrue, para que un
cambio del proveedor rompa acá y no en producción, en silencio.

---

## 4. Arquitectura

**Paquete nuevo: `mcp-server/`**, workspace #8 del monorepo. TypeScript ESM strict, `tsx` sin paso de
build, tests con `node:test` — las mismas reglas que los otros siete. Dependencia nueva:
`@modelcontextprotocol/sdk`. No importa `db/` ni `api/`: habla HTTP.

**Configuración**, toda por variables de entorno, nada hardcodeado:

| Variable | Qué es | Ejemplo |
| --- | --- | --- |
| `AMG_API_URL` | Base de la API | `http://localhost:3000` (dev-server) |
| `AMG_SUPABASE_URL` | Proyecto de Supabase | `https://<ref>.supabase.co` |
| `AMG_SUPABASE_ANON_KEY` | Anon key (**pública por diseño**, la autoridad la impone RLS) | `eyJ...` |

**Registro en Claude Desktop** (`claude_desktop_config.json`): un comando que arranca el servidor con
esas variables. El archivo de configuración de Claude Desktop **no** se versiona en este repo — vive
en la máquina — pero el spec deja el ejemplo exacto en el README del paquete.

**Flujo de una llamada:** Claude Desktop invoca la tool → el servidor lee la sesión del archivo →
refresca si está por vencer → arma el request con `Authorization: Bearer <token>` y
`x-amg-tenant: <tenantId>` → llama a `api/` → traduce la respuesta (o el error) a texto que Claude
pueda usar.

**Entorno: local primero.** `AMG_API_URL` apunta al `dev-server` de `api/` (puerto `3000`) hasta que
el circuito completo esté probado. Recién después se apunta a producción, que es un cambio de una
variable.

---

## 5. Superficie de la v1: seis tools

Cinco lecturas y **una sola escritura**, elegida a propósito: es la compuerta humana del pipeline, la
acción de más valor y la que ejercita el circuito entero (sesión, tenant, autorización real,
manejo de conflictos).

| Tool | Endpoint | Qué hace | Escribe |
| --- | --- | --- | --- |
| `amg_listar_clientes` | `GET /clients` | Clientes visibles con id y nombre. **Es el paso previo obligatorio de cualquier escritura** | no |
| `amg_ver_cliente` | `GET /clients/:id` | Ficha completa de un cliente | no |
| `amg_listar_runs` | `GET /runs?clientId=` | Runs de keyword research, de un cliente o de todo el tenant | no |
| `amg_ver_run` | `GET /runs/:id` | Brief, páginas propuestas y última decisión | no |
| `amg_ver_informe` | `GET /runs/:id/informe` | El informe legible, para que Claude lo resuma o lo cruce | no |
| `amg_aprobar_run` | `POST /runs/:id/approve` | Aprueba con destino `crear_web`, `solo_informe` o `crear_posts` | **sí** |

`amg_aprobar_run` recibe el destino como enum cerrado de esos tres valores; cualquier otro se rechaza
**antes** de llamar a la API. La API igual lo valida ([`api/src/app.ts:463`](../../../api/src/app.ts)) —
esto es defensa en profundidad, no un reemplazo.

Ninguna tool se declara "read-only" si no lo es, y la descripción de `amg_aprobar_run` dice
explícitamente que dispara trabajo real del pipeline (y gasto, cuando el destino es `crear_web`).

### Lo que NO entra en la v1, y por qué

- **Reseñas, posts, edición de menú/perfil, members, ideas, archivar/desarchivar.** Existen como
  endpoints y son candidatos naturales de la v2. Construir doce tools antes de saber si el flujo se
  siente bien en un chat es sobre-construir: si el circuito de seis funciona, agregar una tool es una
  tarde; si no funciona, doce tools son doce cosas para tirar.
- **Estado de publicación de un sitio.** **No existe el endpoint** — lo confirmó la lectura de
  `api/src/app.ts`. Lo más cercano son las páginas que ya devuelve `GET /runs/:id`. Inventar una tool
  que finja tenerlo sería una promesa que la API no puede cumplir; si hace falta de verdad, primero
  se agrega el endpoint (trabajo del agente `datos`) y después su tool.

---

## 6. Sesión y credenciales

**Dónde:** `~/.amg-mcp/session.json` (vía `os.homedir()`), **fuera del repo** — no hay riesgo de que
lo agarre un `git add` distraído, que es justamente la clase de accidente que este proyecto ya
sufrió. Guarda `accessToken`, `refreshToken`, `expiraEn`, `userId` y `tenantId`.

**Permisos:** se intenta `chmod 600`, pero **en Windows eso es casi un no-op** y hay que decirlo en
vez de fingir que protege: la protección real ahí es que el archivo vive en el perfil del usuario.
No se documenta como "archivo protegido"; se documenta como "credencial en disco, tratala como tal".

**Rotación del refresh token — el riesgo operativo real.** Supabase rota el refresh token en cada uso
y tiene una ventana corta de reutilización. Claude Desktop arranca y mata el subproceso MCP
libremente, así que dos instancias solapadas, o un reinicio en medio de un refresh, pueden invalidar
la familia de tokens entera y dejar la sesión muerta. Mitigaciones, todas obligatorias:

1. **Escritura atómica**: archivo temporal + `rename`, nunca escritura parcial sobre el bueno.
2. **Refrescar solo cuando hace falta**: si falta poco para `expiraEn`, o reactivamente ante un `401`.
   Nunca "por las dudas" en cada arranque.
3. **Ante un refresh fallido, rendirse.** Un mensaje accionable y listo. Un loop de reintentos es lo
   que convierte un fallo recuperable en una sesión revocada.

---

## 7. Manejo de errores

Ningún error se traga. Cada uno se traduce a un mensaje que Claude pueda mostrar y sobre el que el
usuario pueda actuar:

| Situación | Qué devuelve la tool |
| --- | --- |
| No hay sesión / refresh falló | "Sesión no disponible. Corré `npm run mcp:login -w mcp-server`." |
| `401` de la API | Se intenta un refresh; si vuelve a fallar, lo de arriba |
| `503` de la API | "No se puede verificar el token ahora (Supabase). Reintentá en un momento." — **no** se trata como sesión muerta, que es justo la distinción que la API se tomó el trabajo de hacer |
| `403` / `404` | "No existe o no tenés acceso" — sin inventar cuál de las dos, igual que la API |
| `409` | El conflicto real (p. ej. `TRANSICION_INVALIDA`), tal como lo manda la API |
| La API no responde | "No hay API en `AMG_API_URL`. ¿Está corriendo `npm run dev:server -w api`?" |

---

## 8. Testing

- **`node:test`**, como todo el monorepo. Se mockea la capa HTTP: los tests no tocan Supabase ni
  levantan la API.
- **Una prueba por tool** que verifique las dos mitades: el request que arma (path, método, headers,
  body) y cómo interpreta respuesta y error.
- **La sesión tiene sus propios tests**: refresh cuando corresponde y no antes, escritura atómica,
  y el camino de "el refresh falló" terminando en mensaje accionable y no en un loop.
- **Verificación por mutación** en los dos puntos que son de seguridad, no de comodidad: que el
  destino fuera del enum se rechaza, y que **ninguna tool de escritura acepta un nombre de cliente en
  vez de un UUID**. Si al romper eso a mano no cae exactamente su test, el test no sirve.
- **Prueba manual antes de mirar producción**: Claude Desktop de verdad, contra el `dev-server`
  local, ejecutando las seis tools, incluida una aprobación real que llegue a la base.

---

## 9. Riesgos abiertos

1. **Aprobar es irreversible en los hechos.** Claude Desktop pide confirmación por tool call, pero el
   usuario puede darle "permitir siempre" y a partir de ahí no pregunta más. **La confianza en un
   checkbox de la UI de otro producto no es un guardarraíl nuestro.** Se acepta para la v1 por
   consistencia (el portal tampoco tiene doble confirmación) y porque la API ya rechaza los casos
   inválidos con `409`/`404`. Si en el uso real aparece una aprobación equivocada, la respuesta no es
   pedir disculpas: es que la tool exija un campo de confirmación explícito.
2. **Dueño en la tabla de agentes.** `mcp-server/` no encaja en `front`, `datos`, `pipeline` ni
   `render`. Hasta que se decida, **lo lleva la sesión principal**, y eso queda escrito en
   `AGENTS.md` al implementarlo. Un paquete sin dueño es un paquete que se pudre.
3. **La copia de GoTrue puede divergir** del portal si Supabase cambia el contrato. El test de forma
   del request acota el daño, pero no lo elimina.

---

## 10. Cuándo está terminada la v1

Las seis tools implementadas y probadas; `npm run verificar` en verde con los tests nuevos incluidos;
el circuito completo ejercitado **desde Claude Desktop real contra la API local**, incluida una
aprobación que llegue a la base; y el README del paquete con el bloque exacto de
`claude_desktop_config.json` y el paso de login.

Apuntar a producción es un cambio de `AMG_API_URL`, y es un paso aparte que se hace después, a
conciencia.
