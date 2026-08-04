---
name: datos-testing
description: Usar al escribir, arreglar o revisar cualquier test de db/ o api/ de AMG OS, y al decidir cómo probar algo que se acaba de implementar ahí. Cubre las dos formas de levantar PGlite, los cuatro roles con los que se puede consultar, el patrón del test de aislamiento (probar que el OTRO no ve), la verificación por mutación aplicada a seguridad, y los tests que pasan por el motivo equivocado.
---

# Tests de la base y la API

Todo corre contra **Postgres real**: PGlite es Postgres compilado a WASM, dentro de Node. Sin Docker,
sin cuenta, sin red. Runner nativo (`node:test` + `node:assert/strict`), cero dependencias nuevas.

> ⚠️ **`db/` y `api/` corren majors DISTINTOS de Postgres.** Medido con `select version()`:
> `db/` → **PostgreSQL 16.4** (`@electric-sql/pglite@0.2.17`), `api/` → **PostgreSQL 18.3**
> (`@electric-sql/pglite@0.5.4`).
>
> La consecuencia práctica, y es la trampa: **un comportamiento del motor medido en un paquete no se
> puede afirmar del otro sin volver a medirlo.** Si vas a escribir una garantía sobre cómo se comporta
> Postgres, medila en el paquete donde va a correr el código — y si vale para los dos, medila en los
> dos. (El `nulls last` de más abajo se comprobó así: idéntico en 16.4 y en 18.3.)
>
> Las versiones salen de `db/package.json` y `api/package.json`; no las copies de acá sin comprobarlas,
> que es exactamente el error que esta advertencia describe.

**Por qué no mocks:** el aislamiento depende de la semántica exacta de Postgres —FORCE vs. ENABLE,
`using` vs. `with check`, el cast de un GUC vacío, si un `is distinct from` es TRUE con NULL—. Un mock
reproduce **mis suposiciones**, y el bug siempre está justo ahí. Y aquí lo que se prueba es la garantía
que se le vende al cliente: si se rompe, no es un bug, es una brecha.

## La regla de este ámbito

**Un test de seguridad que siempre pasa es peor que no tenerlo**, porque además da tranquilidad. De
ahí las dos disciplinas de abajo (el rojo correcto, y la mutación), que acá no son opcionales.

## Las dos formas de levantar PGlite

**a) `TestDb` + `seed()`** (`db/src/testdb.ts`) — cuando el test necesita **dos tenants** y roles ya
sembrados. Es lo que usan `rls.test.ts`, `clientes.test.ts`, `membresias.test.ts`, `sitios.test.ts`.

```ts
db = await TestDb.create();   // aplica TODAS las migraciones (en orden) sobre una base nueva
s  = await seed(db);          // 2 tenants, 3 clientes, 4 identidades, 2 runs
```

**b) PGlite directo** — cuando el test prueba las clases de acceso o la API entera:

```ts
pg = new PGlite();
await aplicarMigraciones(pg);
const pool = new PglitePool(pg);
const store = new PgStore(pool);         // amg_api → app_user
app = createApp({ store, clientes, membresias, emisor, verificar });
```

Es lo que hacen `store.test.ts`, `cache.test.ts`, `task-log.test.ts` y `api/src/app.test.ts`. Para
combinar las dos —probar `PgStore` contra la MISMA base ya sembrada— está `db.pglite`: sin eso habría
que sembrar dos veces y el test probaría un escenario distinto del que dice probar.

## Los cuatro roles con los que se puede consultar

| Método de `TestDb` | Rol | Para qué |
|---|---|---|
| `asUser(ctx, sql)` | `app_user`, con identidad | el camino normal: **con RLS en vigor** |
| `asRender(sql)` | `app_render` | el renderizador. **No acepta contexto: no hay ninguno** |
| `asService(sql)` | superusuario, **salta RLS** | sembrar. Es lo que hace la infraestructura, no la app |
| `queryEnTx(sql)` | el estado que haya | montar a mano el contexto exacto de un ataque |

Tres cosas que se confunden y cuestan un test inútil:

- **`set local role app_user` es la clave de `asUser`.** Como superusuario, PGlite **saltaría las
  políticas** y el test pasaría siempre.
- **`asService` NO es `app_service`.** `asService` es el superusuario de infraestructura (corre
  migraciones, siembra). `app_service` es el orquestador, **sí sujeto a RLS**.
- **`asRender` no tiene parámetro de contexto, a propósito.** Es la misma garantía en el tipo que da
  `RequestContext` al no tener un campo `rol`: no se puede probar accidentalmente con una identidad que
  en producción no existe.

## `sqlCrudo`: probar la BASE, no el Store

`db/src/testing.ts` **no se exporta desde `index.ts`** — no viaja al artefacto de producción. Pero
hace falta, y por una razón de fondo:

> Probar el aislamiento **solo** a través de los métodos del Store probaría que **el Store** es
> correcto, no que **la base** lo es. El modelo de amenaza realista es alguien que consigue ejecutar
> SQL con el rol `app_user` y un contexto de tenant válido. Si RLS lo frena ahí, lo frena de verdad.

`leerKeywordsCrudo` / `leerPaginasCrudo` son eso: lo que vería un atacante con un `select` pelado.

## El patrón del test de aislamiento: probar que el OTRO no ve

Un test que comprueba que el tenant A ve sus dos clientes **no prueba nada**: pasa igual con RLS
borrada. Lo que prueba es la ausencia:

```ts
test("RLS: un tenant NO ve los clientes de otro", async () => {
  const rows = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from clients");
  assert.ok(!rows.map((r) => r.id).includes(s.clientB1), "NO puede ver el cliente del tenant B");
});
```

Por eso el seed tiene **dos tenants** y un `intruso` **sin ninguna membresía**: sin el tenant B no hay
nada cuya ausencia comprobar, y sin el intruso no se puede probar que *sin rol no hay acceso*.

Los cuatro ataques que hay que cubrir cuando toques una política, todos en `db/src/rls.test.ts`:

1. **Pedir el id ajeno explícitamente** → cero filas, no el dato.
2. **Declararse `maestro` a mano** (`set_config('app.role', 'maestro', true)`) → ningún efecto.
3. **Reclamar el tenant de otro** → no hay membresía allí, así que no hay rol.
4. **Sin identidad** → cero filas, **y no una excepción**. Un control de acceso falla cerrado *y en
   silencio*; sin el `nullif`, `''::uuid` revienta la query.

Y las cuatro operaciones, no solo el `select`: **insertar** marcando el tenant de otro, **actualizar**
filas ajenas, **borrarlas**, y **reasignar una fila propia a otro tenant** (la fuga por UPDATE, que
`with check` es quien cierra).

Cuando lo que se espera es un rechazo del motor y no cero filas, se exige el error:

```ts
await assert.rejects(() => …, /permission denied|row-level security/i);
```

Es lo correcto para las caches (deny-all + sin grant) y para `auth.users` (donde el test exige
**`permission denied`, no cero filas** — así cae si alguien repone el grant que se quitó).

## Rojo primero, y el rojo correcto

En un test de seguridad el rojo tiene que ser **"el otro tenant SÍ ve el dato"**, no "la query falla".
Un test que arranca en rojo porque revienta la conexión, y se pone verde porque ahora devuelve un
error distinto, no probó el aislamiento en ningún momento.

## Verificación por mutación (obligatoria acá)

Quitá la garantía —la política, la constraint, el `where`, el grant, el cast— y confirmá que cae
**exactamente** su test. Tres casos del repo que enseñan qué distingue una mutación útil:

**1. La mutación tiene que ser alcanzable.** El test que fija `algorithms: ["ES256"]` firma con ES384
**y pone esa clave pública en el JWKS local**: si la clave no fuera resoluble, abrir la lista de
algoritmos no cambiaría el resultado y **la mutación no probaría nada**
(`api/src/auth.test.ts:39-41`).

**2. Comprobá el grafo, no tu modelo del grafo.** El test de que `amg_api` no puede asumir
`app_service` leía `pg_auth_members` y contaba roles directos. La mutación que lo tumba es de una
línea —`grant app_service to app_user;`— y `pg_auth_members` **seguiría diciendo lo mismo**, con
`amg_api` teniendo un camino **transitivo**. Ahora se le pregunta a Postgres:
`pg_has_role('amg_api', 'app_service', 'SET')` (`db/src/store.test.ts:388-404`).

**3. Una mutación que NO tumba nada es un resultado, no un fallo del método.** Dice una de dos cosas, y
hay que averiguar cuál antes de tocar el test:

- *falta el test* — la garantía no está cubierta; escribilo; **o**
- *la línea que mutaste es redundante* — no hace lo que el comentario dice que hace.

Pasó con `nulls last` en `ORDEN_DEL_BRIEF` (`db/src/store.ts`): quitarlo dejó los 178 tests en verde
porque **ya es el default de Postgres para `asc`**. El test era válido —cambiarlo por `nulls first` sí
lo tumba— y lo que estaba mal era el comentario, que afirmaba lo contrario del comportamiento real. La
salida no fue "arreglar el test": fue **medir el default** y corregir la afirmación en los tres
archivos que la repetían.

**4. Un test con los datos equivocados no muerde, aunque su nombre prometa que sí.** El test del portal
que fijaba "conserva el orden de entrada" usaba dos páginas con el **mismo** `opportunity_score`: un
`.sort()` por score metido en medio lo dejaba pasar. Un test de orden necesita que la entrada
**contradiga** el criterio que no quiere que se aplique — con el orden y el score de acuerdo, no se
puede distinguir cuál de los dos se respetó.

**5. Un componente que ningún test ejercita no está probado, aunque la suite esté verde.**
`verificadorSupabase` no lo tocaba nadie: los tests de rutas inyectan un verificador falso, que es lo
correcto para probar RLS sin criptografía. **Mutarlo para aceptar cualquier token dejaba los 21 tests
en verde** (`api/src/auth.test.ts:19-30`). Si escribís una pieza nueva, preguntate qué test cae si la
rompés entera.

## Marcar los tests de seguridad

Los que prueban una garantía de seguridad llevan **🔴** en el nombre:

```
🔴 un usuario SIN membresía no ve NADA, aunque reclame un tenant válido
🔴 declararse 'maestro' a mano NO da acceso: el GUC app.role ya no se lee
🔴 credenciales: el login de la API NO puede asumir el rol del servicio
🔴 el CRM (contacto, contrato, score) NO aparece en business_profile_publico
```

No es decoración: marca los que **no se pueden relajar** para hacer pasar un cambio. Si uno de esos se
pone rojo, el cambio está mal, no el test.

## Tests de migración

`db/src/deploy.test.ts` cubre cinco cosas de `migrarConRegistro`, y las cinco son contrato:

1. aplica todas en orden y **registra cada una**;
2. **re-ejecutar no re-aplica y no lanza** (idempotente);
3. **crea los roles y deja RLS forzada** (el requisito de que el despliegue no dependa de correr algo
   a mano después);
4. **aborta si una migración ya aplicada cambió** (deriva de checksum);
5. **el registro no tiene RLS** — si la tuviera con `force` y sin políticas, el runner se
   auto-bloquearía cuando el rol no es superusuario, que es el caso de Supabase alojado.

Si agregás una migración, el (1) y el (3) la cubren solos. Si toca **roles, grants o políticas**,
escribí además su test de aislamiento.

## Trampas que dejan un test verde sin probar nada

- **Un test estructural que puede recorrer cero archivos.** Si itera un glob y el glob no matchea, pasa
  en verde sin haber comprobado nada. Aseverá primero que la lista no está vacía.
- **Un default de producción que el test elige.** Si el test pasa el parámetro, no está fijando el que
  corre en prod. El caso canónico de este repo: había un test que probaba `PgStore` con `app_service`
  **eligiéndolo él mismo**, y ninguno que probara que `orchestrator/src/deps.ts` lo elige — mutar ese
  literal a `app_user` dejaba 199 tests y el typecheck en verde, y el fallo aparecía solo en producción
  (13ª review). Lo que hay que fijar es **el composition root**, no la clase.
- **Confundir el default de una función con el de producción.** El `origin: "*"` de `createApp` **no**
  es un default de producción: es el fallback del montaje inyectado. En producción `leerConfig` exige
  `CORS_ORIGINS` y **prohíbe** `*`. Son dos cosas con dos tests distintos, y mezclarlas hace que alguien
  "arregle" el fallback creyendo que cierra un agujero que no existe.
- **Sembrar con `asService` y creer que se probó el camino de la app.** Sembrar salta RLS a propósito;
  la comprobación va con `asUser`.
- **Un solo tenant.** Ya está arriba, y es el error más frecuente.

## Cómo se corre

```bash
npm test -w db           # ~6s — la parte rápida: iterá acá
npm test -w db -w api    # ~52s, y ~46 de esos son api (ver abajo)
npm run verificar        # todo: entorno, arnés, secretos, typecheck y tests
```

**Dónde está el tiempo, porque cambia cómo se itera.** Medido el 2026-08-04: `db` ~6s y `api` ~46s. La
asimetría no es misteriosa: `api/src/app.test.ts` hace `new PGlite()` + `aplicarMigraciones` en cada
`beforeEach`, así que reconstruye el esquema entero unas 95 veces. `db` reusa su instancia entre tests
del mismo archivo.

Y una advertencia sobre estas cifras, que es la lección de la 13ª review: **acá decía "~15s" y estaba
mal por un factor de tres.** Lo escribí de memoria. Si vas a citar un tiempo, medilo con `time` en el
momento; si no lo vas a medir, no des el número.

Ningún test de este ámbito toca una credencial ni la red — ni siquiera a localhost (el JWKS de los
tests de JWT es **local**). Si un test tuyo necesita una key o un puerto, está mal planteado.

Reportá el verde **con el output a la vista**: "los tests pasan" sin la salida es una afirmación sin
respaldo.
