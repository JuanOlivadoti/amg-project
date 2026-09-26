# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión (2026-09-22/26): encender el módulo de reseñas de Google.** Arrancó con "qué le falta a la
plataforma para responder reseñas" y terminó con **los tres providers `live` escritos** y el
diagnóstico del proyecto corregido. **Cuatro commits pusheados**, y encima de eso el paso 1 de lo
accionable: **las dos trampas del arnés, arregladas** y pusheadas en `b77364a`. No
queda código a medio hacer — lo que falta del módulo espera decisiones de AMG, no trabajo.

Los cuatro commits, de `git log`: `7a1fc44` (docs, corrige el diagnóstico), `3acae87` (ruta fija del
callback + credenciales al catálogo), `3040843` (`LiveGoogleReviewsProvider`), `9f406ee`
(`LiveGoogleOAuthProvider`).

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

> ✅ **Dos trampas del arnés, descubiertas acá y ARREGLADAS el 2026-09-26.** (1) `npm run verificar`
> **no corría en Windows**: el `package.json` invocaba `./scripts/verificar.sh` y npm lo lanza por
> `cmd.exe` → *"`.` no se reconoce como un comando"*. Ahora declara `bash ./scripts/verificar.sh`.
> (2) Pipeando el script a `tail`, el exit code que llega es el del `tail`: la primera corrida
> devolvió **0 con el resumen en FALLA**, y confiar en él hace commitear sobre rojo. El script no
> puede arreglar el pipeline de quien lo llama, así que **el veredicto viaja por la salida**:
> `RESULTADO=VERDE (exit 0)` / `RESULTADO=FALLA (exit N)` como última línea, que ningún `exit` se
> saltea. Más `set -o pipefail`, que le faltaba a la casilla de secretos.
>
> El rojo de esa primera corrida era **preexistente y ajeno a esta sesión**:
> `@modelcontextprotocol/sdk` estaba declarada en `mcp-server/package.json` pero **nunca instalada**,
> así que `src/server.test.ts` fallaba entero. Resuelto con `npm install` (77 paquetes,
> `package-lock.json` sin cambios: ya los tenía).

De iteraciones anteriores, ya mergeado a `main`: **comparativas de seguros** (`17b8f87`), **MCP local
para Claude Desktop** (`1371a25`) y su **instalador** (`d6ae22f`).

## En vuelo (sin commitear)

Nada — `git status --short` vacío y `git log origin/main..HEAD` vacío: todo commiteado y pusheado,
`origin/main` en `b77364a`.

### Lo último que entró (`b77364a`, el arreglo del arnés)

- `package.json:18` — `"verificar": "bash ./scripts/verificar.sh"`. Sin el `bash`, npm lo lanza por
  `cmd.exe` y el comando obligatorio del ritual no corría en Windows.
- `scripts/verificar.sh:35` — `veredicto()`, que imprime `RESULTADO=VERDE (exit 0)` /
  `RESULTADO=FALLA (exit N)`. Se la llama antes de **cada** `exit`, los cinco cortes tempranos
  incluidos. Y `set -o pipefail` en la línea 22.
- `scripts/arnes.test.mts` (nuevo, 3 tests) — el intérprete del script (:28), el veredicto corrido
  de verdad sacándolo con `sed` (:38), y el barrido que exige que ningún `exit` salga sin él (:51).
- `AGENTS.md`, `CHECKPOINTS.md` § C1, `docs/proyecto/09-estado-y-roadmap.md`,
  `docs/proyecto/15-plan-plataforma.md` § Bloque I, `progress/history.md` — el veredicto se lee en
  la última línea, no en el exit code.

De antes, `9f406ee` y los tres commits anteriores: el módulo de reseñas.

## Próximo paso

**Ninguna de las tres piezas de código que faltan del módulo de reseñas se puede escribir todavía**
(esperan decisiones de AMG, ver § Bloqueado). Lo accionable sin depender de nadie, en orden:

1. ~~Arreglar las dos trampas del arnés~~ — **hecho el 2026-09-26**, ver § En vuelo.
2. **Deuda del nonce del `state`**, abierta desde el Bloque F fase 1: `EstadoOAuth.nonce`
   (`api/src/oauth-state.ts:23`) se genera pero **nunca se invalida tras el primer uso**, así que la
   única defensa contra un `state` filtrado es la ventana de 10 min (`VENTANA_ESTADO_MS`,
   `api/src/oauth-state.ts:30`). Exige migración (la próxima libre es la **0034**; la última es
   `db/migrations/0033_comparativas_seguros.sql`). **Conviene juntarla con la migración de la
   detección de revocación** para no hacer dos.
3. **Comprobación que no es de código y sigue abierta:** si hay algún cliente con conexión de Google
   en producción, el polling en mock le siembra reseñas falsas y dispara alertas de Telegram reales
   en cada ciclo. Necesita el MCP de Supabase autorizado (`/mcp` en sesión interactiva) o que Juan lo
   mire en el panel. Ver `docs/proyecto/16-pendientes-juan.md` § 2.

### Bloqueado, esperando a AMG

El documento de solicitud (artifact, v2 del 2026-09-26) hace las preguntas. Lo que cada respuesta
destraba:

- **¿Workspace con `@amgmadrid.com`?** → habilitaría una app *Internal*: sin textos legales, sin
  verificación, sin tope de 100 y **sin la caducidad de 7 días** de los refresh tokens.
- **¿Cómo acceden a las fichas de sus clientes?** → **define el modelo de datos**: hoy
  `clients.google_refresh_token` es por cliente (asume que cada restaurante conecta lo suyo); si AMG
  gestiona todo desde una cuenta, esa columna sobra.
- **¿Descubrimiento automático o `locationId` a mano?** → si es a mano, hay que agregar el campo en
  el portal y la API (pieza chica y clara). Si es automático, hay que pedirle a Google cuota para
  `mybusinessaccountmanagement` y `mybusinessbusinessinformation`.
- **¿Hay un respondedor montado en n8n?** → si lo hay, la decisión deja de ser técnica.

La **detección de revocación** está bloqueada por algo distinto y más duro: hace falta ver la forma
real del error de Google. El mensaje de `refrescarToken` ya conserva el `invalid_grant`
(`orchestrator/src/google/live-provider.ts`, con test) para que quien la escriba no adivine.

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
- **(2026-09-26) El callback OAuth pasa a la ruta FIJA `/google/callback`** y el cliente sale de
  `estado.clientId`. Motivo: Google exige `redirect_uri` exacto y **no admite comodines de path**, así
  que una ruta por cliente haría imposible el modo `live`. Descartado seguir con `/clients/:id/...`
  registrando un URI por cliente: no escala y Google lo limita.
- **(2026-09-26) Se BORRÓ el parámetro `clientId` de `urlDeConsentimiento`.** Quedaba muerto en los
  dos modos y la interfaz mentía sobre lo que el provider real necesita. Descartado renombrarlo a
  `_clientId`: es justo el hack de compatibilidad que el estilo del proyecto prohíbe.
- **(2026-09-26) `STAR_RATING_UNSPECIFIED` LANZA en vez de descartar la reseña.** `puntuacion` tiene
  `check between 1 and 5` (migración 0021), así que no hay número que inventar, y saltearla en
  silencio dejaría una reseña real que nadie responde nunca. **Trade-off asumido:** una reseña así
  traba el ciclo de ese cliente hasta que alguien mire. Alternativa descartada: descartarla en
  silencio.
- **(2026-09-26) Un reseñador sin `displayName` cae a `"Anónimo"`**, no lanza: `autor` es NOT NULL
  (0021) y una reseña anónima es un caso real y documentado de Google, no un dato corrupto.
- **(2026-09-26) `GOOGLE_REDIRECT_URI` es configuración fija, NO se deriva del origen de la
  request.** Google exige coincidencia exacta con el URI registrado y detrás de un proxy el origen
  que ve el proceso puede no ser el público. Entró al catálogo sólo para `api/` — el orquestador no
  hace el flujo de consentimiento. (Antes se había dejado fuera a propósito, mientras nada la leía.)
- **(2026-09-26) El descubrimiento de la ficha se escribió igual, aunque hoy no pueda correr.** Es el
  camino documentado y funcionará cuando concedan la cuota; su 429 se traduce a un mensaje que nombra
  el trámite en vez de propagar un error de red. Descartado dejarlo sin implementar: el fallo
  aparecería sin explicación en el primer intento de conexión real.

- **(2026-09-26) El veredicto del arnés viaja por la SALIDA, no sólo por el exit code.** Última
  línea fija `RESULTADO=VERDE (exit 0)` / `RESULTADO=FALLA (exit N)`. Motivo: el exit code de un
  pipeline lo decide el shell de quien llama, y `verificar.sh` no puede tocarlo — pipear a `tail`
  seguirá devolviendo `exit=0` sobre rojo para siempre. Descartado `set -o pipefail` **como arreglo
  de esto**: no aplica al pipeline del llamador (entró igual, pero por otro motivo: los pipes
  internos del propio script). Descartado también dejarlo como regla de documentación: ya estaba
  escrita en `current.md` y aun así se tropezó.
- **(2026-09-26) Un test estructural barre el script y falla si aparece un `exit` sin su
  `veredicto`.** Es lo que impide que el próximo corte temprano nazca mudo. Se asume que lee el
  script como texto: es la forma del código, no su comportamiento, y no hay manera de ejercitar
  `node` ausente o `node_modules` ausente sin romper la máquina. El test del veredicto **sí** corre
  el código real (lo saca con `sed` y lo ejecuta), que es donde está el comportamiento.

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
- **(2026-09-26) `npm run verificar` NO corría en Windows** — *arreglado el mismo día*.
  `package.json` declaraba `"verificar": "./scripts/verificar.sh"` y npm lo lanza por `cmd.exe`:
  *"`.` no se reconoce como un comando interno o externo"*. El shebang solo lo lee un shell POSIX,
  así que el script tiene que **nombrar su intérprete**: `bash ./scripts/verificar.sh`.
- **(2026-09-26) Pipear `verificar.sh` a `tail` devuelve el exit code del `tail`, no el del script**
  — *mitigado el mismo día*. La primera corrida de la sesión devolvió **`exit=0` con el resumen
  diciendo FALLA**; confiar en ese código habría hecho commitear sobre rojo. **Esto NO tiene arreglo
  desde adentro del script** —el exit code del pipeline lo decide el shell de quien llama—, así que
  lo que se hizo fue mover el veredicto al texto: la última línea es `RESULTADO=VERDE (exit 0)` o
  `RESULTADO=FALLA (exit N)`. **Leé esa línea, no el exit code.**
- **(2026-09-26) Un comando en segundo plano pipeado a `grep`/`tail` no emite NADA hasta terminar**
  (el pipe buffea), así que el archivo de salida queda en 0 bytes y no se puede seguir el avance.
  Para background: redirigir a un archivo **sin pipe** y leerlo aparte.
- **(2026-09-26) Correr varias suites de tests a la vez en esta máquina las degrada brutalmente**:
  con dos corridas simultáneas, tests de PGlite que tardan ~1,5 s pasaron a reportar duraciones de
  minutos y horas. Correr una por vez; `deps.test.ts` solo tarda 1,4 s.
- **(2026-09-26) El `grep` de bash sobre la raíz del repo excede el timeout** porque escanea
  `node_modules` antes de filtrar. Usar la herramienta Grep (ripgrep), que respeta los ignores.
- **(2026-09-26) El navegador que levanta el MCP chrome-devtools arranca con perfil limpio**, sin la
  sesión de Google del usuario: no sirve para revisar la consola de Google Cloud. Para eso se usó la
  extensión de Chrome del usuario, con un prompt de solo lectura.
- **(2026-09-26) Un resumen de `WebFetch` NO es evidencia.** Al mirar `amgmadrid.com`, el modelo que
  resume la página reportó enlaces de "Aviso Legal" y "Política de Cookies" en el pie que **no
  existen** ni en los 292 KB de HTML ni en el sitemap. Verificar con `grep` sobre el HTML crudo.

## Archivos calientes

Del arreglo del arnés, sin commitear:

- `package.json:18` y `scripts/verificar.sh:35` — el intérprete y `veredicto()`. Los dos los fija
  `scripts/arnes.test.mts`.

Y esto es lo que hay que leer para retomar el módulo de reseñas:

- `api/src/app.ts:219` — `app.get("/google/callback")`, la ruta FIJA. El cliente sale del `state`
  firmado, no del path. Registrada **antes** de `app.use("*", autenticar(...))`: si se mueve
  después, vuelve el 401 del bug de la Task 7.
- `api/src/google-oauth-live.ts:121` — `descubrirUbicacion()`, la mitad que **hoy no puede correr**
  (cuota 0). Sus dos `429` (líneas 127 y 160) son los que traducen el bloqueo a un mensaje legible.
- `api/src/google-oauth.ts:56` — el selector; exige las tres credenciales y falla al construirse.
- `orchestrator/src/google/live-provider.ts:29` — el mapa `ESTRELLAS`, la trampa del enum.
  Línea 21: `MAX_PAGINAS = 20`, el tope que evita colgar el step de Inngest.
- `api/src/oauth-state.ts:23` — el `nonce` que nunca se invalida (deuda, paso 2 del próximo paso).
- `scripts/env-sync.mts:38` — `GOOGLE_REDIRECT_URI` sólo en el `MAPA` de `api`, no del orquestador.

## Verificaciones

- **`bash ./scripts/verificar.sh` (2026-09-26, con el arreglo del arnés): VERDE entero.** **2138
  tests** en el monorepo (sube de 2135: los tres nuevos), typecheck limpio en 8 paquetes, sin
  secretos entre los 745 archivos versionados. Portal sin cambios.
- **Del arnés, tres mutaciones confirmadas:** devolver `package.json` al script sin intérprete tumba
  sólo el test del intérprete; quitarle el `veredicto` al `exit` final tumba sólo el barrido; sacarle
  el exit code al texto del veredicto tumba sólo su test.
- **Del arnés, la prueba que ningún test puede dar:** `npm run verificar -- --rapido` corrió de
  verdad bajo Windows (exit 0, `RESULTADO=VERDE`), y una corrida en rojo forzada —moviendo
  `CHECKPOINTS.md` un momento, restaurado después— pipeada a `tail` **siguió devolviendo `exit=0`**
  (la trampa es real y no se puede tapar) pero imprimió `RESULTADO=FALLA (exit 1)` donde se lee.
- ⚠️ **Deuda a la vista, NO tocada:** la tabla de cobertura de `docs/proyecto/08-testing-calidad.md`
  es un snapshot coherente del 2026-08-13 (1395 tests, que es lo que suman sus filas). Actualizar la
  celda de `scripts` sola la rompería; remedirla entera es trabajo aparte.
- **Del módulo de reseñas, tres verificaciones por mutación, todas confirmadas:** restaurar la ruta vieja del callback hace
  caer exactamente el test de la ruta fija (`401 !== 302`); cambiar el mapeo del enum por
  `Number(estrella)` hace caer exactamente los dos tests del enum; quitar el `!res.ok` de
  `publicarRespuesta` hace caer exactamente el test de «publicado significa lo que confirma el
  proveedor». Una cuarta en `api/`: quitar el guard del `refresh_token` ausente hace caer sólo su test.
- **Navegador (MCP chrome-devtools) contra `dev:server` (:3000) + portal (:4200):** ciclo
  *Desconectar → Conectar Google → navegación real al callback → escritura bajo RLS → redirect a
  `/clientes/:id/resenas`*, consola sin errores ni warnings, y `google_conectado_en` confirmado
  server-side tras el redirect. **Los dos providers `live` NO se verificaron en navegador, a
  propósito:** en modo mock son inalcanzables desde la UI.
- ⚠️ **Rojo preexistente encontrado y resuelto:** `@modelcontextprotocol/sdk` estaba declarada en
  `mcp-server/package.json` pero nunca instalada, así que `src/server.test.ts` fallaba entero desde
  el 2026-09-15. Resuelto con `npm install` (77 paquetes, `package-lock.json` sin cambios).
