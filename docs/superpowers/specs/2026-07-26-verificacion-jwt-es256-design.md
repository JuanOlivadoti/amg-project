# Verificación de JWT con ES256 (JWKS) — diseño

> **Estado:** aprobado el 2026-07-26. Es la **pieza A** de cuatro (ver §Contexto).
> **Bloquea todo lo demás:** hoy ningún login funciona contra la API en producción.

---

## El problema

Desde el despliegue de Fase 1, cualquier login termina en `401 Token inválido o expirado`
(`api/src/auth.ts:92`).

No es un error de configuración del deploy: **el proyecto de Supabase firma los tokens con `ES256`**
y la API solo acepta `HS256`. Comprobado contra el JWKS público del proyecto, que declara una única
clave `{"alg":"ES256","kty":"EC","crv":"P-256","use":"sig"}`.

Supabase migró a claves asimétricas; el proyecto se creó el 2026-07-25 y nació con el esquema nuevo.
El "Legacy JWT Secret" del panel sigue existiendo, pero **ya no es con lo que se firman los tokens de
usuario**. El código se escribió cuando Supabase firmaba en HS256: es deuda de contexto, no un bug de
lógica.

## Qué se decide acá

Verificar contra el **JWKS público** de Supabase en vez de un secreto compartido.

Se descartaron dos alternativas:

- **Volver el proyecto a HS256.** Cero código, pero rema contra la dirección del producto, conserva
  un secreto compartido en Railway y puede no estar disponible en proyectos nuevos. Deuda a seis
  meses.
- **Aceptar ambos algoritmos.** Dos caminos en el borde de seguridad más crítico del sistema. Este
  proyecto lleva diez reviews **eliminando** opcionalidad ahí: `algorithms: ["HS256"]` existe porque
  la 9ª review encontró que sin esa línea entraba un HS512 firmado con el mismo secreto. Reabrirlo
  sería desandar ese camino.

La razón de fondo para elegir JWKS **no es que sea lo moderno**: es que `SUPABASE_JWT_SECRET`
desaparece del sistema. Hoy ese secreto vive en las variables de Railway, en `docs/private/` y quedó
en el transcript de una sesión de trabajo. Con JWKS no hay secreto compartido que filtrar — la clave
privada nunca sale de Supabase y la pública es pública por definición. Es **menos superficie**, no
solo código más nuevo.

---

## Paso 0 — ✅ HECHO (2026-07-26): el diseño está validado contra el proyecto real

Antes de escribir código se verificó un token de producción **de verdad**, no se asumió. Resultado:

| Qué se comprobó | Resultado |
| --- | --- |
| `header.alg` | **`ES256`** |
| `header.kid` | `2e9e5796-…` — **coincide** con la única clave del JWKS del proyecto |
| `claims.iss` | `https://<ref>.supabase.co/auth/v1` — como se esperaba |
| `claims.aud` | **`authenticated`** — `AUD_SUPABASE` **no cambia** |
| `app_metadata` | trae `tenant_id` y `rol` — el portal sigue teniendo lo que necesita |
| **Verificación contra el JWKS remoto** | **✔ verifica**, con las opciones exactas que usará la API |
| Contraprueba `algorithms: ["HS256"]` | **✔ rechazado** (`"alg" Header Parameter value not allowed`) |

La prueba corrió `createRemoteJWKSet` contra el JWKS real y `jwtVerify` con
`algorithms:["ES256"]`, `requiredClaims:["exp","sub"]`, `audience:"authenticated"` e `issuer` — es
decir, **la configuración final del diseño**, sobre un token real, y funcionó.

Esto elimina el riesgo principal del cambio: no hay que descubrir en la implementación que la
audiencia cambió o que el `iss` no es el que se cree. Lo que queda es escribirlo bien y testearlo.

> **Nota de seguridad del proceso:** el token de prueba llegó dentro de una sesión completa, con su
> `refreshToken`. Un refresh token no caduca y permite acuñar access tokens hasta que se revoque.
> Para inspeccionar un token alcanza con el **payload decodificado**, que no sirve como credencial.
> La sesión usada acá se revocó desde el panel de Supabase.

### Hallazgo colateral: el logout no revoca nada

Al verificar lo anterior salió a la luz que `AuthService.logout()`
(`portal/src/app/services/auth.ts:43`) **solo borra el `localStorage`**: no llama a Supabase, así que
**el refresh token sigue válido del lado del servidor** después de "cerrar sesión".

Un logout que no revoca es una promesa a medias: si a Frank le roban el equipo y cierra sesión desde
otro lado, el token robado sigue acuñando access tokens. Y el refresh token **no caduca solo**.

Entra en el alcance de esta pieza: es el mismo archivo, el mismo tema y el mismo borde de
autenticación. El arreglo es llamar al endpoint de logout de Supabase (`POST /auth/v1/logout` con el
access token) **antes** de limpiar el estado local, y —esto es lo que hay que testear— limpiar el
estado local **igual aunque la llamada falle**: si la red está caída, el usuario tiene que quedar
deslogueado en su navegador de todas formas. Un logout que falla y deja la sesión abierta en pantalla
es peor que uno que no revoca.

---

## Diseño

### Arquitectura

`verificadorSupabase` deja de recibir un secreto y pasa a recibir un **resolvedor de claves**
(`JWTVerifyGetKey` de `jose`). Esa inversión es lo que hace testeable el cambio:

- **Producción** lo arma con `createRemoteJWKSet(new URL(jwksUrl))` — cachea, refresca solo y
  soporta rotación de claves sin redeploy.
- **Tests** inyectan un JWKS **local** (`createLocalJWKSet`) con una clave generada en el propio
  test. La suite sigue **sin red**, como el resto del proyecto.

El resto del verificador **no cambia**: `requiredClaims: ["exp","sub"]`, el chequeo de `aud`, el de
`iss` y el rechazo de `sub` en blanco quedan igual. Es un fix acotado, no una reescritura.

`algorithms` pasa de `["HS256"]` a `["ES256"]`. Sigue siendo una lista cerrada de un solo algoritmo:
la lección de la 9ª review se conserva, solo cambia cuál.

### Configuración

| Variable | Antes | Después |
| --- | --- | --- |
| `SUPABASE_JWT_SECRET` | obligatoria | **eliminada** |
| `SUPABASE_JWT_ISS` | opcional | **obligatoria** |
| `SUPABASE_JWT_AUD` | opcional | opcional (sin cambios) |

El JWKS **se deriva** de `SUPABASE_JWT_ISS` (`<iss>/.well-known/jwks.json`). No se agrega ninguna
variable nueva.

Que `iss` pase a obligatoria tiene un efecto de seguridad deseado: hoy es opcional, así que un token
emitido por **otro** proyecto de Supabase entraría si compartiera el secreto. Al volverse obligatoria,
el proyecto emisor queda amarrado por construcción, no por convención.

Hay que actualizar, en este orden: `api/src/deps.ts` (validación de obligatorias),
`api/.env.example`, el `MAPA` de `scripts/env-sync.mts`, `docs/private/credenciales.env` y las
variables del servicio en Railway.

> El test `api: MAPA coincide EXACTAMENTE con su .env.example` **va a fallar** hasta que el `MAPA` y
> el `.env.example` se actualicen juntos. Eso es el test funcionando: obliga a decidir explícitamente
> qué claves recibe la API.

### Errores: fallar cerrado

Si el JWKS no se puede obtener —Supabase caído, DNS roto, timeout—, la verificación **falla** y la
API responde `401`. Nunca "dejar pasar porque no se pudo comprobar".

`createRemoteJWKSet` cachea la clave y refresca con *cooldown*, así que un corte breve no se nota. Uno
largo cierra la puerta, que es el comportamiento correcto en el borde de autenticación.

### Tests

Los actuales (`api/src/auth.test.ts`) firman con un secreto simétrico, así que se rehace el andamiaje:
generar un par EC en el test (`generateKeyPair('ES256')`), firmar con la privada, verificar contra un
JWKS local con la pública.

**Se conservan los diez casos que ya existen**, traducidos a ES256 — ninguno se descarta:

| Caso actual | Qué protege |
| --- | --- |
| token válido → devuelve el `sub` | el camino feliz |
| sin `exp` | que un token no sea eterno (`requiredClaims`) |
| expirado | la caducidad |
| firmado por otro emisor | la firma (pasa de "otro secreto" a "otra clave") |
| sin `sub` | que haya a quién identificar |
| `sub` vacío | que no se ponga `app.user_id = ''` |
| `sub` de solo espacios | lo mismo, con `trim` |
| otro `iss` | que un token de otro proyecto no entre |
| **`alg: none`** | **el bypass clásico de JWT** — crítico conservarlo |
| basura → `null`, no lanza | que un token malformado no tumbe la API |

**Se agregan dos:**

1. **JWKS inalcanzable → 401.** Que el fallo de red no abra la puerta.
2. **Token HS256 → rechazado**, aunque venga bien formado. Es el caso que motivó todo esto.

El de `alg: none` merece atención especial: con verificación asimétrica el atacante conoce la clave
**pública**, así que un verificador mal configurado que acepte `none` —o que acepte `HS256` usando la
clave pública como secreto— es explotable **sin conocer ningún secreto**. Con `HS256` compartido ese
ataque no existía. La lista cerrada `algorithms: ["ES256"]` es lo que lo cierra, y el test lo fija.

**Verificación por mutación** (no negociable, es la disciplina del proyecto): volver a agregar
`"HS256"` a la lista de algoritmos y confirmar que cae **exactamente** el test 2. Un test de seguridad
que siempre pasa es peor que no tenerlo.

### Documentación a actualizar al cerrar

- `docs/proyecto/12-credenciales.md` — `SUPABASE_JWT_SECRET` ya no existe.
- `docs/proyecto/13-runbook-despliegue.md` — B.1 (ya no hace falta copiar el JWT Secret) y C.5 (la
  tabla de variables de Railway pasa de 6 a 5).
- `docs/decisiones-arquitectura.md` — ADR nuevo o extensión del existente: **la API verifica identidad
  contra el JWKS del emisor, no contra un secreto compartido.**
- Sincronizar las cifras de tests donde aparezcan.

---

## Contexto: la demo con Frank y las otras tres piezas

Este spec sale de una sesión de diseño sobre **la demo de venta a Frank**. Las decisiones tomadas ahí
son la entrada de las piezas C y D, y se registran para no perderlas.

**Qué se vende:** la **plataforma para su agencia** — Frank gestionaría varios restaurantes. El
objetivo de la demo es **cerrar la venta**.

**El recorrido de tres golpes**, aprobado:

1. **Dashboard** → panorama de cartera + economía. El "wow".
2. **Entrar a un cliente** → la compuerta humana. No se cuenta, se ve.
3. **Entrar a una página** → la evidencia (✅ respaldada / ⚠️ sin validar).

La compuerta y el rigor **no compiten** con velocidad y panorama: son lo que las hace creíbles. La
objeción que mata esta venta no es el precio, es *"si esto publica una barbaridad en el sitio de mi
cliente, pierdo al cliente"*. Los pasos 2 y 3 **ya existen**; solo se construye el 1.

### Las cuatro piezas

| # | Pieza | Tamaño | Depende de |
| --- | --- | --- | --- |
| **A** | Verificación JWT ES256 — **este spec** | Chico | — |
| **B** | Modo oscuro (**solo el portal**) | Chico | — |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | Medio | A |
| **D** | Research en vivo (desplegar el orquestador) | Grande | A + la medición |

**B — modo oscuro:** solo el portal. El renderizador queda afuera a propósito: la web pública es la
marca del restaurante y ahí el tema lo decide su diseño.

**C — el dashboard:** cartera **sembrada** con 4-6 restaurantes ficticios en distintos estados. Los
datos para poblarlo **ya existen y están sin explotar**: cada página trae `volumen`, `dificultad`,
`opportunity_score`, `score_confidence`, `intencion`, `local`, `cluster_id` y `evidencia`; cada run
trae `coste_micros_usd` y `calidad_datos`. Se puede construir **sin tocar la API**.

**D — research en vivo:** decidido que debe ser **real**, no guionado. El orquestador **ya está
construido** (Inngest, `workflow.ts`, `functions.ts`, 18 tests): falta desplegarlo y conectarlo, no
escribirlo. Es despliegue e integración.

### La medición que condiciona D

`11-plan-fase-2.md:299` arrastra esta incógnita: **cuánto tarda un research real nunca se midió**. Se
conoce el coste ($0.31), no la duración.

Es lo que decide si D vale la pena:

- **~90 segundos** → mostrarlo en vivo es el mejor momento de la demo.
- **~12 minutos** → Frank mira un spinner y la demo se muere ahí. No hay dashboard que lo salve, y se
  habría construido D en contra del objetivo.

**Acordado: medir primero.** Una corrida real cronometrada (~$0.31), en paralelo a A/B/C, que no
dependen del resultado. **D se decide con el número en la mano.**

### Orden de trabajo

```text
A (login)  ──┬──▶  C (dashboard + seed)  ──▶  Demo
             │
             └──▶  B (modo oscuro, cuando caiga)

Medición (~$0.31, en paralelo)  ──▶  ¿D?
```

Sin fecha de demo comprometida: se ordena por dependencia. **C y D tienen su propio spec**; este
cubre solo A.
