# orchestrator — el workflow durable (ADR-03, ADR-12)

Une el pipeline del M2, la persistencia y la compuerta humana. Es el **composition root**: el único
punto del sistema que conoce a los tres módulos a la vez.

```
research/solicitado
  → crear-run          (idempotente: el runId viene en el evento)
  → research           ← el único paso que cuesta dinero
  → guardar-paginas
  → cerrar-run         → status = pending_approval
  ⏸  esperar research/aprobado (hasta 7 días, sin proceso vivo)
  → publicar           ← relee de la BASE, no del evento
```

## Correr

```bash
npm run serve                                    # expone /api/inngest en :3100
npx inngest-cli@latest dev -u http://localhost:3100/api/inngest   # runtime + panel
npm test
```

Sin `DATABASE_URL` levanta **PGlite en memoria**, y sin credenciales de proveedor el pipeline usa
los mocks: el sistema entero corre sin una sola clave. Con `DATABASE_URL` va a Postgres por pool.

## Lo que hay que entender antes de tocarlo

**El evento es un disparador, nunca una autoridad.** `research/aprobado` no aprueba nada: solo
despierta al workflow, que le pregunta a la base qué está realmente aprobado. La consulta pasa por
`getPublishablePages`, que exige las **dos** condiciones de la compuerta (ADR-06) bajo RLS, con el
contexto del tenant que *pidió* el research — nunca con el del evento de aprobación. Un evento
forjado con el `runId` de otro tenant no publica nada, porque RLS no le devuelve nada.

Si alguna vez alguien "simplifica" esto publicando `brief.paginas_propuestas` directamente, caen
cuatro tests. Están puestos para eso.

**El `runId` lo genera quien emite el evento.** Inngest re-ejecuta todo lo que está fuera de un
step en cada replay: un `randomUUID()` dentro del workflow daría un id distinto cada vez. Y hacerlo
así lo vuelve idempotente — reprocesar el mismo evento no abre un segundo run ni vuelve a pagar.

**Las fronteras de los steps son las fronteras del gasto.** Un step que falla se reintenta *entero*.
`crear-run` está separado de `research` para que un fallo no abra otro run; y dentro del research,
las keywords se persisten apenas existen, así que lo que ya se le pagó a DataForSEO no se pierde
(y el reintento lo encuentra en la cache).

Los porqués completos —concurrencia global vs. por tenant, `retries: 1`, el plazo de aprobación—
están en [ADR-12](../docs/decisiones-arquitectura.md).
