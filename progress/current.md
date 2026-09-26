# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión (2026-09-22/25): auditoría del acceso real a Google para el módulo de reseñas.** Arrancó con
"qué le falta a la plataforma para responder reseñas de Google" y terminó **corrigiendo el
diagnóstico que tenía el proyecto escrito desde el 2026-09-04**. Sin cambios de código todavía: lo
hecho es verificación y documentación.

**El hallazgo:** el acceso a la Business Profile API **ya estaba concedido** (la v4
`mybusiness.googleapis.com` tiene 250.000 req/día y 10.000 updates/día en `amg-automation`). El
diagnóstico viejo midió `mybusinessaccountmanagement` **v1**, otra API, que sí está en cuota 0. **El
bloqueo real es la app OAuth**: en estado "Prueba" (⚠️ refresh tokens que caducan a los **7 días**),
sin scopes declarados, con el único `redirect_uri` apuntando al OAuth Playground y sin páginas
legales en `amgmadrid.com`. Nada de eso se configura por CLI — Google apagó esas APIs en marzo 2026.

**Bug de diseño encontrado:** el callback es `/clients/:id/google/callback`, con el client ID en la
ruta; Google exige `redirect_uri` exacto y no admite comodines de path, así que **no puede funcionar
en live**. `EstadoOAuth` ya lleva `clientId`, así que el arreglo es una ruta fija `/google/callback`.

**Pendiente de AMG** (documento de solicitud entregado el 2026-09-25): si tienen Google Workspace
—habilitaría una app *Internal* y borraría casi todo el trámite— y cómo acceden a las fichas de sus
clientes, que **define el modelo de datos** (una credencial o N). Más la pregunta de si hay un
respondedor paralelo montado en **n8n**.

> ⚠️ **Dos trampas del arnés, descubiertas acá.** (1) `npm run verificar` **no corre en Windows**: el
> `package.json` invoca `./scripts/verificar.sh` y npm lo lanza por `cmd.exe` → *"`.` no se reconoce
> como un comando"*. Hay que usar `bash ./scripts/verificar.sh`. (2) Pipeando el script a `tail`, el
> exit code que llega es el del `tail`: la primera corrida devolvió **0 con el resumen en FALLA**.
> Confiar en ese exit code hace commitear sobre rojo.
>
> El rojo de esa primera corrida era **preexistente y ajeno a esta sesión**:
> `@modelcontextprotocol/sdk` estaba declarada en `mcp-server/package.json` pero **nunca instalada**,
> así que `src/server.test.ts` fallaba entero. Resuelto con `npm install` (77 paquetes,
> `package-lock.json` sin cambios: ya los tenía).

Las tres etapas de `mcp-server`/comparativas-seguros están mergeadas a `main`: **comparativas de
seguros** (`17b8f87`), **MCP local para Claude Desktop** (`1371a25`) y el **instalador**
(`d6ae22f`).

Verificación completa con el instalador adentro: `bash ./scripts/verificar.sh` → **2105 tests en
verde en el monorepo** (8 paquetes + `scripts/`; portal sin cambios, 663 aparte — 357 `node:test` +
306 Karma; total 2768), typecheck limpio, sin secretos. `npm test -w mcp-server`: 67/67 (54
preexistentes + 13 del instalador). Verificación por mutación en `mergearConfig` confirmada (el catch
de JSON inválido devolviendo `{}` en vez de `throw` hizo caer exactamente 1 test).

## En vuelo (sin commitear)

Nada de código. La documentación de los hallazgos (`09`, `15`, `16`, `history.md`, este archivo) se
commitea al cerrar esta entrada.

## Próximo paso

✅ **Los cambios 1 y 2 están HECHOS y verificados en el navegador** (2026-09-26). Eran los únicos que
no dependían de las respuestas de AMG. El detalle y las consecuencias de diseño, en
[`15-plan-plataforma.md § Bloque F`](../docs/proyecto/15-plan-plataforma.md).

Ciclo completo ejercitado con MCP chrome-devtools contra `dev:server` (:3000) y el portal (:4200):
*Desconectar → Conectar Google → navegación real al callback → escritura bajo RLS → redirect*, con
consola limpia y persistencia confirmada server-side. En este cambio el navegador no era un trámite:
el bug de la Task 7 se encontró así y no con tests.

✅ **Y el `LiveGoogleReviewsProvider` también está HECHO** (mismo día): `GOOGLE_REVIEWS_MODO=live`
deja de lanzar. 24 tests, dos mutaciones confirmadas, sin gastar un euro (se testea contra un
`globalThis.fetch` sustituido). Sin verificación en navegador **a propósito**: el provider es
inalcanzable desde la UI en modo mock.

⚠️ **Lo que hay que saber antes de conectar un cliente real:** en modo `live`,
`clients.google_location_id` tiene que guardar el **nombre de recurso completo**
(`accounts/<id>/locations/<id>`), no un id suelto. Hoy el mock guarda un valor opaco, así que esto
sólo se nota con credenciales reales — y está validado con una regex que falla antes de armar la URL.

✅ **Y el `LiveGoogleOAuthProvider` también** (mismo día): era la última pieza de código del
encendido — con sólo el provider de reseñas, `getGoogleOAuthProvider("live")` seguía lanzando.
16 tests, mutación confirmada. `GOOGLE_REDIRECT_URI` entró al catálogo (sólo `api/`).

> ⚠️ **El hallazgo que más cambia las decisiones: NO es un trámite con Google, son DOS.** Conectar un
> cliente exige descubrir su ficha, y eso necesita `mybusinessaccountmanagement` +
> `mybusinessbusinessinformation`, **las dos en cuota 0**. La v4 tenía `accounts.list` pero Google la
> deprecó en favor de la primera: no hay camino alternativo por API. **El acceso a reseñas, que sí
> está concedido, no alcanza para conectar a nadie.**
>
> 💡 **Alternativa que destraba sin depender de Google:** cargar el `locationId` a mano (se saca de la
> consola de Business Profile y se pega en el portal). Cuesta un campo y fricción por alta. Decisión
> abierta: con pocos clientes gana el campo manual, con muchos el descubrimiento automático.
>
> 📄 **El documento de solicitud a AMG (2026-09-25) quedó corto**: pide un solo trámite. Hay que
> regenerarlo o avisar aparte.

**Lo que SÍ depende de AMG:** dónde vive el refresh token (una credencial o N), el `locationId`
cuando el negocio tiene varias ubicaciones (hoy falla nombrando la decisión, no elige), y la
detección de revocación. Esta última necesita ver la forma real del error de Google; el mensaje de
`refrescarToken` ya conserva el `invalid_grant` para quien la escriba.

### Dos decisiones que se tomaron al implementarlos

- **El parámetro `clientId` de `urlDeConsentimiento` se BORRÓ.** Estaba planteado como duda; al
  implementarlo, las dos reglas apuntaban al mismo lado (borrar lo muerto; no dejar `_vars` de
  compatibilidad) y además la interfaz mentía: sugería que el modo `live` necesita el cliente, cuando
  la identidad viaja firmada en el `state`.
- **`GOOGLE_REDIRECT_URI` quedó FUERA del catálogo**, aunque estaba en el plan. Nada la lee todavía, y
  si se deriva del origen de la request o viene fija en configuración lo decide el provider `live`.
  Config que nadie consume invita a un default equivocado.

## Lo anterior, ya cerrado

No hay desarrollo pendiente de ninguna de las tres piezas (comparativas-seguros, mcp-server, el
instalador). Lo que sigue es manual, fuera del alcance de una sesión de Claude Code:

1. **mcp-server**: la prueba real contra Claude Desktop instalado (login real, las seis tools
   ejercitadas, una aprobación real que llegue a la base) — spec §10, detalle en
   `mcp-server/README.md`. El instalador (`npm run mcp:instalar -w mcp-server`) saca de encima la
   edición manual del JSON, pero no reemplaza esta prueba.
2. **Comparativas de seguros**: avisarle a Juan el riesgo de bus-factor de `read-excel-file`.
3. Calibrar la proporción caracteres/token del preflight de gasto de OpenAI contra una corrida
   real — cuesta dinero, la corre o autoriza Juan.
4. El checklist general de Juan (`docs/proyecto/16-pendientes-juan.md`), sin relación con lo de
   arriba.

Si alguien retoma una sesión de desarrollo, es trabajo nuevo — no hay nada a medio hacer que
continuar.

## Decisiones tomadas

*(Se añaden, no se borran. Las de las etapas anteriores siguen más abajo en este archivo.)*

- **Este archivo se reseteó al estado "nada en vuelo" el 2026-09-16**, en vez de arrastrar la
  narrativa detallada de las dos etapas ya cerradas y mergeadas. El detalle de decisiones y
  callejones de `comparativas-seguros` (lo que había acá abajo hasta esta edición) sigue existiendo
  en el historial de git de este mismo archivo y en `.superpowers/sdd/2026-09-12-comparativas-seguros/progress.md`
  (el ledger, gitignoreado); el de `mcp-server`, en `progress/history.md § 2026-09-15`. Arrastrar acá
  las ~250 líneas de decisiones de trabajo ya cerrado no ayuda a retomar nada —no hay nada que
  retomar— y viola la regla de cabecera de este archivo ("si acá dice algo de hace tres semanas,
  está mintiendo").
- Las decisiones y callejones específicos de cada etapa (modelos usados, bugs de merge de rama,
  trampas de testing) quedan documentados en el commit final de cada una y en `progress/history.md`
  para lo que ya se cerró ahí — no se duplican acá.

## Callejones sin salida

*(Se añaden, no se borran.)*

- **Dos sesiones trabajando en paralelo sobre el mismo repo, en checkouts distintos, tienen que
  coordinar el merge de `progress/current.md` a mano** (2026-09-15/16): las dos prependían su propia
  entrada a la misma celda de `docs/proyecto/09-estado-y-roadmap.md` § Tests, y eso sí generó un
  conflicto real de merge (resuelto combinando ambas narrativas en orden cronológico). `current.md`
  en cambio NO tuvo conflicto porque una sola sesión lo tocaba por vez — la lección: en trabajo
  paralelo real (no solo subagentes de una misma sesión), avisarle a la otra sesión por
  `SendMessage` antes de tocar un archivo de estado compartido evita el conflicto en vez de
  resolverlo después.

## Archivos calientes

- Ninguno — nada en vuelo.

## Verificaciones

- **`bash ./scripts/verificar.sh`, con el instalador de `mcp-server` adentro (2026-09-16): verde
  entero.** 2105 tests en el monorepo (8 paquetes + `scripts/`; portal sin cambios, 663 aparte — 357
  `node:test` + 306 Karma; total 2768), typecheck limpio, sin secretos entre los 739 archivos
  versionados. `npm test -w mcp-server`: 67/67. Verificación por mutación en `mergearConfig`
  confirmada por dos sesiones distintas (yo y el `revisor`, cada uno por su cuenta).
