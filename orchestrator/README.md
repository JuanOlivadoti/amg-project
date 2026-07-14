# orchestrator — el workflow durable (ADR-03, ADR-12, ADR-18)

Une el pipeline del M2, la persistencia y la compuerta humana. Es el **composition root**: el único
punto del sistema que conoce a los tres módulos a la vez.

```
      LA API  ──crea la fila del run BAJO RLS, como el humano──▶  kr_runs
        │       (aquí ocurre la autorización: sin membresía, Postgres rechaza el insert)
        │
        └──emite research/solicitado { runId, tenantId }──▶ ORQUESTADOR
                                                              │
  → cargar-run       ← lee prompt/cliente/mercado DE LA FILA, jamás del evento
  → research         ← el único paso que cuesta dinero (y solo si el run sigue en 'running')
  → guardar-paginas
  → cerrar-run       → status = pending_approval
  ⏸  esperar research/aprobado (hasta 7 días, sin proceso vivo)
  → publicar         ← relee de la BASE (compuerta doble), no del evento
```

## Correr

```bash
npm run serve                                                    # /api/inngest en :3100
npx inngest-cli@latest dev -u http://localhost:3100/api/inngest  # runtime + panel
npm test
```

Sin credenciales levanta **PGlite en memoria** y los proveedores mock: el sistema entero corre sin
una sola clave. Con `DATABASE_URL_ORQUESTADOR` / `DATABASE_URL_CACHE` va a Postgres
(ver [12-credenciales.md](../docs/proyecto/12-credenciales.md)).

## Lo que hay que entender antes de tocarlo

**Un evento no porta autoridad. Nunca.** Ni el de entrada ni el de aprobación.

`research/solicitado` **no crea el run**: lo crea la API, bajo RLS, con la identidad del humano —
y si esa persona no tiene membresía en el tenant, **Postgres rechaza el insert** y no se emite nada.
El evento solo lleva `runId` y `tenantId`, y el `tenantId` **no es una autoridad, es una
coordenada**: si no cuadra con el run, RLS no lo deja ver y el workflow **aborta sin gastar un
centavo**.

> Antes el evento traía `tenantId` y `clientId` **elegidos por quien lo emitía**, y el workflow los
> convertía en contexto de servicio. La FK garantizaba que el cliente pertenecía al tenant; **nadie
> garantizaba que el humano perteneciera al tenant**. Conocer dos UUID ajenos bastaba para que la
> agencia pagara el research de otra.

`research/aprobado` tampoco aprueba nada: **despierta** al workflow, que le pregunta a la base qué
está realmente aprobado (`getPublishablePages`, compuerta doble de ADR-06, bajo RLS). Si alguien
"simplifica" esto publicando `brief.paginas_propuestas` directamente, **caen cuatro tests**. Están
puestos para eso.

**El orquestador NO es `maestro`.** Asume el rol de Postgres `app_service`, con su **propio login**
(`amg_orquestador`, `NOINHERIT`), que **no puede** asumir `app_user` — ni al revés. Esa frontera la
impone Postgres, no el código (ADR-17).

**La fase durable vive en la BASE, no en la memoria de Inngest.** Su clave de idempotencia dura 24 h
y la compuerta humana espera **7 días**: pasado ese plazo, un evento duplicado arranca una ejecución
nueva con los steps en blanco. Por eso el workflow comprueba el estado del run: si ya no está
`running`, **el research no se vuelve a pagar**.

**Las fronteras de los steps son las fronteras del gasto.** Un step que falla se reintenta *entero*.
Dentro del research, las keywords se persisten apenas existen, así que lo que ya se le pagó a
DataForSEO no se pierde — y el reintento lo encuentra en la cache.

Los porqués completos —concurrencia global vs. por tenant, `retries: 1`, el plazo de aprobación—
están en [ADR-12, ADR-17 y ADR-18](../docs/decisiones-arquitectura.md).
