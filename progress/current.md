# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión (2026-09-10 → 11):** tres piezas. Primero se recorrió con Juan, decisión por decisión, el
checklist de [`16-pendientes-juan.md`](../docs/proyecto/16-pendientes-juan.md) — commiteado en
`428571b`. Después, el **primer ítem del lote corto** que salió de ahí: el **guardarraíl de «Conectar
Google» en modo mock + producción** (commiteado en `c82399f`). Y tercero, el **segundo ítem del lote
corto: la reescritura de ADR-11**, que es lo que está en vuelo ahora.

## En vuelo (sin commitear)

**La reescritura de ADR-11.** Solo documentación (`docs/decisiones-arquitectura.md` + la
sincronización del `09`, el `15` y el `16`). El ADR tiene ahora una sección **«versión vigente»**, que
es la que se lleva a un contrato; el cuerpo viejo queda marcado como historia en vez de reescrito.

Lo que dice: **snapshot estático incluido**; **salida gestionada de pago** (pago único + cuota
mensual, importes pendientes de Juan); y **«editable» = una capacidad que el cliente GANA en la
baja**, nunca una que ya tenía — que es lo que OBS-04, al cerrarse en (a), desambiguó.

**(b1) «el cliente lo hostea» se RETIRA de la oferta**, y conviene leer con cuidado cómo: se retira
diciendo *«hoy no se ofrece»*, **no** *«no se puede»*. La primera lectura de la sesión principal fue
que era imposible; al verificarlo resultó impreciso. `demo-server.ts` corre el renderizador **entero**
contra PGlite en memoria sembrado desde un JSON de perfil (`renderer/src/demo-server.ts:22-87`), así
que la forma que funcionaría —renderizador + PGlite sembrado + el space propio del cliente + su token
de CDA— **ya tiene todas las piezas**; lo que no existe es el empaquetado, la documentación y el
soporte. **Es una decisión de Juan si quiere que se ofrezca**, y quedó anotada como pregunta en el
`16` § 7.

**Para firmar ADR-11 faltan exactamente dos cosas:** los dos importes (Juan) y **verificar el snapshot
estático como entregable** — el tercer y último ítem del lote corto.

### Lo anterior de esta sesión, ya commiteado

- `428571b` — el checklist de decisiones de Juan (OBS-04 incluida).
- `c82399f` — el guardarraíl de «Conectar Google», con las correcciones de la revisión dentro.

## Qué hace el guardarraíl

`GOOGLE_REVIEWS_MODO=mock` + entorno de producción ⇒ **409** en `POST /clients/:id/google/conectar` y
en `GET /clients/:id/google/callback`. **No aborta el arranque**, a diferencia de
`verificarPublicacion()` con `PIPELINE_MODO`: quedarse en mock es una decisión tomada, así que un
`throw` en `leerConfig` dejaría la API sin levantar. Se bloquea el camino que arma la trampa, no el
proceso.

- La regla se calcula en `api/src/deps.ts` (el único archivo que toca `process.env`), con
  `esModoProduccion()` **extraída** de `exigirEventKeySiEsCloud` para no tener dos lecturas que
  diverjan.
- `ApiDeps.conectarGoogleBloqueado` es **obligatorio sin default**: fuera de producción el valor
  correcto es `false`, así que cualquier default sería `false` y un cableado olvidado dejaría la
  trampa armada. Siendo obligatorio, **es el typecheck** el que obliga a decidir a cada arranque.
- **Dos cortes.** `conectar` corta antes de `firmarEstado` (no se acuña un `state`, que es una
  credencial de 10 minutos). El `callback` corta antes de toda escritura, porque **un `state` firmado
  antes del despliegue sigue vivo 10 minutos** — hay un test que lo firma con la app *sin* guardarraíl
  y lo presenta a la app *con* guardarraíl.
- **`desconectar` NO se bloquea**, con un test que lo impone (mutación *en el otro sentido*):
  bloquear el remedio dejaría a un cliente conectado por error sin salida.

## Lo que corrigió la revisión

1. **[Bloqueante] El mensaje del 409 prescribía un remedio que tira la API.** Terminaba con *"Poné
   `GOOGLE_REVIEWS_MODO=live`"*, pero `leerConfig` acepta ese valor y `getGoogleOAuthProvider("live")`
   **lanza** (el provider real no existe), y `crearDeps` lo construye al arrancar: un operador
   siguiendo el mensaje tiraba la API entera. Era el mismo modo de fallo que la etapa venía a cerrar,
   del otro lado. Reescrito, y **atado con un test que se cura solo**: si el mensaje prescribe `live`
   y `getGoogleOAuthProvider("live")` lanza, el test cae; el día que se implemente el provider, el
   test deja de objetar sin tocarlo.
2. **[Bloqueante] Tres documentos seguían diciendo que el guardarraíl estaba pendiente**, y este
   archivo afirmaba *"todo commiteado"* con 15 archivos modificados. Corregido acá, en
   `16-pendientes-juan.md` y con la entrada de `history.md`.
3. **[Menor] La nota de `codigos.ts` que yo había "corregido" afirmaba otras dos cosas falsas**: que
   el 501 de `crear_posts` existe (se retiró en el sub-proyecto 3 — `NO_IMPLEMENTADO` es hoy una
   constante que no emite nadie) y que "todos los 409 de hoy llevan código" (el `onError` ya devolvía
   un 409 pelado desde antes). Reescrita entera.
4. **[Menor] `INNGEST_DEV=1` apaga el guardarraíl** y no lo fijaba ningún test — era el comportamiento
   de producción más sensible del cambio sostenido solo por un comentario. Test agregado.
5. **[Menores]** `GOOGLE_REVIEWS_MODO` en `api/README.md`; indentación en dos archivos de test; y el
   docblock de `conectar()` ahora dice que poner `error` **se lleva puesto el CTA** (las ramas de la
   plantilla son excluyentes) — correcto para este 409, pero no es lo que uno espera de un "mostrá el
   error" genérico.

## Deuda que queda anotada, no cerrada

- **El guardarraíl no deshace una fila YA conectada.** Corta *conectar*, no el polling. Si existe un
  cliente con `google_refresh_token` en producción sigue sembrando reseñas falsas — **sin verificar**:
  es una comprobación de Juan (ninguna sesión de Claude Code tiene acceso autenticado a esa base).
- **`crearDeps` no tiene test propio** del cableado `config.conectarGoogleBloqueado →
  deps.conectarGoogleBloqueado` (construye un `Pool` de `pg`, no se ejercita en la suite). Lo
  sostienen el campo obligatorio y que el valor no se transforma.
- **No se manejó la app en un navegador** para este cambio: reproducir el 409 exige editar a mano el
  literal de `dev-server.ts`, que está en `false` a propósito para que el flujo mock funcione.
- **`NO_IMPLEMENTADO`** quedó como constante exportada que nadie emite. Retirarla exige tocar la copia
  del portal en el mismo cambio (`deepEqual` entre las dos); es otra etapa.

## Próximo paso

1. **Commit + push** de la reescritura de ADR-11.
2. **Lo que queda del lote corto: verificar el snapshot estático como entregable.** Sale de
   `renderStory()`, que ya existe; nadie lo usó nunca como entregable de salida, así que hoy esa línea
   del contrato describe una intención. Es lo único de código que separa a ADR-11 de ser firmable.
3. **Después: comparativas de seguros.** Falta el `writing-plans` sobre la spec aprobada.
4. **Lo que espera de Juan:** los dos importes de la salida gestionada; poner `CACHE_TTL_MS=60000` en
   Railway; y comprobar si hay algún cliente con conexión de Google en producción.

## Verificaciones

- `bash ./scripts/verificar.sh --con-portal`: **1900 tests del monorepo** en verde, typecheck limpio
  (7 paquetes + `scripts/`), sin secretos, 332 `node:test` del portal. **Re-corrido DESPUÉS de las
  correcciones de la revisión**, que agregaron dos tests (1898 → 1900): el que ata el texto del 409 a
  `getGoogleOAuthProvider` y el de la escotilla `INNGEST_DEV=1`.
- `npm --prefix portal run test:components`: **278 SUCCESS** (Karma).
- **Mutación del `try/catch` del portal**, hecha por la sesión principal: `1 FAILED / 277 SUCCESS`,
  y el caído es exactamente `🔴 si conectar falla (409 del guardarraíl de mock)…`. El mensaje del
  fallo enseña el bug real: la pantalla sigue mostrando el botón "Conectar Google" como si nada.
- **Mutaciones re-hechas por el `revisor`** (no tomadas del informe de `datos`): quitar la guarda del
  callback ⇒ cae solo su test; quitarle `esProduccion` a la regla ⇒ cae solo `mock + dev`; poner la
  regla en `false` ⇒ caen exactamente los dos que afirman `true`.
