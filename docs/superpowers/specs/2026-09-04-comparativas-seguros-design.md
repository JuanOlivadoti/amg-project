# Comparativas de seguros — informe + mail desde un Excel/Sheet

**Fecha:** 2026-09-04
**Alcance:** `db/` (tabla nueva `comparativas_seguros`, RLS por tenant), `api/` (endpoint de alta con
parsing + LLM, endpoints de lectura/listado, gate de revisión), `portal/` (pantalla de carga, pantalla
de resultado imprimible, listado/historial, tab nuevo en la ficha de cliente).
**Origen del pedido:** el usuario quiere un módulo que, a partir de un Excel o un Google Sheet con
cotizaciones de varias aseguradoras para un cliente final, genere un informe comparativo y un mail
listos para que el corredor los revise y se los mande a ese cliente.

**Estado:** diseño aprobado por el usuario en conversación (brainstorming), pendiente de
`writing-plans`.

---

## El problema

AMG OS ya tiene una vertical `correduria_seguros` (sub-proyecto de multi-vertical, cerrado el
2026-08-30 — ver
[`2026-08-26-multivertical-clientes-design.md`](2026-08-26-multivertical-clientes-design.md)): los
clientes de AMG que son corredurías de seguros tienen su propio catálogo de pólizas en el portal. Lo
que falta es una herramienta operativa para el día a día de esas corredurías: cuando un cliente final
pide presupuesto, la corredoría junta cotizaciones de varias aseguradoras (hoy, en un Excel armado a
mano, sin formato fijo) y tiene que convertir eso en dos cosas — un informe comparativo prolijo y un
mail para mandárselo. Hoy ese trabajo es manual.

Es importante no confundir esto con el catálogo de pólizas que la corredoría publica en su propio
sitio (multi-vertical, sub-proyecto ya cerrado): allá el catálogo es de la corredoría, para cualquier
visitante de su web. Acá el informe es **ad hoc, por cliente final**, y nunca se publica — se genera,
se revisa y se manda por fuera de AMG OS.

## Precedentes existentes que este diseño reutiliza

Mapeados antes de diseñar, para no reinventar mecanismos que ya existen y ya se probaron:

- **El PDF no se genera server-side.** Decisión ya tomada el 2026-08-07
  (`portal/src/app/shared/services/impresion.ts:10-14`): el PDF lo produce el navegador
  (`window.print()` sobre una hoja maquetada con `@media print`), a propósito, para no meter la
  primera dependencia de PDF del repo. `portal/src/app/pages/entregable/entregable.ts` es el ejemplo
  vivo: una ruta fuera del shell, sin sidebar ni botones en la hoja impresa, con una tabla que
  scrollea en pantalla y se recorta a `overflow-x-visible` en papel. Este módulo reusa exactamente ese
  patrón para el informe comparativo.
- **El draft de mail no se envía desde el servidor.** El botón "Copiar" de
  `portal/src/app/pages/posts/posts.ts` (HTML enriquecido + texto plano, vía Clipboard API) es
  publicación manual sin credenciales de envío — mismo patrón para el mail de este módulo.
- **El contenido generado por LLM nunca se pinta como HTML crudo.** `entregable.ts` pasa el Markdown
  por `parsearMarkdown` y lo dibuja con `@if`/`@for` (vigilado por `core/sin-html-crudo.test.ts`) — la
  inyección queda cerrada por construcción, no por configuración. El informe de este módulo sigue el
  mismo mecanismo.
- **El patrón Provider (mock + real) para llamadas a LLM** ya existe en `orchestrator/src/borrador/`
  y `orchestrator/src/post-blog/` (interfaz + `mock-provider.ts` + `openai-provider.ts`), invocado
  hoy solo desde steps de Inngest. Este módulo reusa la forma del patrón, pero **no** el mecanismo de
  invocación (ver "Por qué sin Inngest" abajo).
- **`clients.vertical` es la única fuente de verdad de rubro** (inmutable tras el alta, no
  enmascarada). Este módulo se gatea con esa columna, no con un flag nuevo.

## Por qué sin Inngest

El resto de las llamadas a LLM del proyecto pasan por Inngest porque tienen compuerta humana
(`waitForEvent`) o pasos asíncronos de minutos (research completo). Acá no hay nada de eso: es una
sola llamada a LLM que el usuario espera en el momento (segundos), sin reintentos automáticos ni
notificación async pedida. Meter Inngest agregaría polling en el portal para un flujo que en la
práctica es una sola request-respuesta. Si en el futuro esto cambia (por ejemplo, si se agregan pasos
asíncronos reales), se puede migrar — hoy no hay nada que lo justifique.

La disciplina de gasto (preflight, no pagar dos veces por ver lo mismo) se mantiene igual aunque el
código no viva en `orchestrator/`: es una práctica, no un lugar.

---

## La decisión

| Decisión | Elegido | Descartado, y por qué |
| --- | --- | --- |
| Quién usa el módulo | Staff de AMG (`equipo`/`maestro`) **y** la propia corredoría (`cliente`) | Solo AMG: la corredoría depende de AMG para cada informe, más lento en el día a día |
| Entrada | Subir `.xlsx`/`.csv`, o pegar un link de Google Sheet compartido | Conectar cuenta de Google/Microsoft (OAuth): alcance grande aparte, queda para una iteración futura |
| Formato de los datos | Libre — un LLM interpreta las columnas que traiga cada corredoría | Plantilla fija: más simple de parsear, pero obliga a las corredorías a ajustarse a un formato que hoy no usan |
| Formato del informe | Markdown, pantalla imprimible → PDF por el navegador | Generar PDF server-side: contradice la decisión ya tomada del 2026-08-07 |
| El mail | Draft para copiar y pegar a mano (HTML + texto plano) | Envío automático desde AMG OS: requiere credenciales de envío y es una acción irreversible hacia un tercero externo |
| Persistencia | Sí, historial por corredoría en una tabla nueva con RLS | Generación al vuelo sin guardar: sin trazabilidad, no se puede reabrir un informe ya mandado |
| Alcance del análisis del LLM | Tabla comparativa **+ recomendación explícita** | Solo tabla neutral: más simple, pero el usuario prefirió la recomendación explícita, con la revisión humana como salvaguarda |
| Revisión antes de enviar | **Gate obligatorio**: el informe nace "pendiente de revisión"; imprimir y copiar el mail quedan deshabilitados hasta que una persona lo marque como revisado (queda en base: `revisado_en`/`revisado_por`, no un flag de pantalla) | Un disclaimer de texto nada más: no fuerza a nadie a mirar el contenido antes de mandarlo, es una intención sin quien la haga cumplir |
| Edición del contenido | No en v1 — revisar es confirmar, no corregir | Editor de texto para informe/mail: más útil a la larga, pero es alcance nuevo (un editor) que no pidió el usuario para esta primera versión |
| Arquitectura de ejecución | Sincrónico dentro de `api/`, sin Inngest | Vía `orchestrator`/Inngest con polling: reusa infraestructura existente, pero agrega complejidad que no se justifica para un flujo de segundos |

---

## Arquitectura

```
db/
  migrations/00XX_comparativas_seguros.sql
    tabla `comparativas_seguros` (ver "Modelo de datos")
    RLS: mismo molde que tablas client-scoped existentes (equipo/maestro ven todo bajo su
    autorización habitual; cliente ve solo las filas de su propio tenant)
  src/comparativas-seguros.ts
    PgComparativasSeguros: crear, obtener, listar por cliente, marcarRevisada — mismo patrón de
    métodos que PgClientes/PgMembresias, siempre a través de Tx (ADR-13)

api/
  src/comparativas-seguros/
    parsing.ts       lee .xlsx/.csv (multipart) o descarga el CSV-export de un link de Google
                      Sheet público; produce filas crudas sin interpretar
    provider.ts       interfaz LlmComparativaProvider (mismo molde que orchestrator/borrador):
                      recibe filas crudas + nombre del cliente final, devuelve
                      { opciones[], recomendacion, informeMd, mailAsunto, mailCuerpoMd }
    mock-provider.ts  determinístico, para tests y demo sin credenciales
    openai-provider.ts  llamada real, con preflight de presupuesto (mismo criterio que el resto
                      del pipeline: abortar antes de gastar si no hay línea de presupuesto)
  src/app.ts
    POST /clients/:id/comparativas-seguros        multipart (archivo) o { googleSheetUrl },
                                                     exige clients.vertical = 'correduria_seguros'
                                                     (409 si no), corre parsing + provider,
                                                     inserta la fila, responde el resultado
    GET  /clients/:id/comparativas-seguros         listado (historial)
    GET  /clients/:id/comparativas-seguros/:cid    una comparativa puntual
    POST /clients/:id/comparativas-seguros/:cid/revisar   setea revisado_en/revisado_por
                                                     (rol autenticado, mismo tenant)

portal/
  pages/comparativas-seguros/
    comparativas-seguros-form.ts     subir archivo o pegar link + nombre/email del cliente final
    comparativas-seguros-resultado.ts  informe en Markdown (mismo renderer que entregable.ts,
                                      imprimible), sección de mail con botón "Copiar"
                                      (deshabilitado hasta revisar), botón "Marcar como revisado"
    comparativas-seguros-listado.ts  historial de la corredoría
  cliente-ficha.ts
    tab nuevo "Comparativas", visible solo si vertical = 'correduria_seguros' — mismo patrón que
    la etiqueta dinámica de "Pólizas y coberturas"
```

---

## Modelo de datos

```sql
create table comparativas_seguros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null references clients(id),
  creado_por uuid not null,              -- membership de quien la generó
  cliente_final_nombre text not null,
  cliente_final_email text,
  opciones jsonb not null,               -- array normalizado: aseguradora, producto, prima,
                                          -- cobertura, condiciones, notas
  recomendacion text not null,
  informe_md text not null,
  mail_asunto text not null,
  mail_cuerpo_md text not null,
  costo_usd numeric not null default 0,
  revisado_en timestamptz,
  revisado_por uuid,
  created_at timestamptz not null default now()
);
```

`client_id` tiene que referenciar un cliente con `vertical = 'correduria_seguros'` — se valida en la
API al crear (no hace falta un constraint de base separado, ya que `vertical` es inmutable y la
comprobación ya ocurre en el mismo request que hace el insert).

`revisado_en`/`revisado_por` son la parte que hace cumplir el gate: nulos ⇒ "pendiente de revisión",
el portal deshabilita Imprimir y Copiar. No nulos ⇒ desbloqueado. Es un hecho persistido, no un
estado de pantalla — recargar la página o volver del historial mantiene el estado real.

RLS sigue el mismo molde que el resto de las tablas client-scoped (ADR-15: el rol se deriva de
`memberships` dentro de Postgres, nunca se declara).

---

## Flujo de revisión humana

1. Se genera la comparativa → queda con `revisado_en = null`.
2. La pantalla de resultado muestra el informe completo (con la recomendación) y el mail, con un
   aviso visible: *"Recomendación generada automáticamente — pendiente de revisión humana"*. Los
   botones "Imprimir / Guardar PDF" y "Copiar mail" están deshabilitados.
3. Cualquier persona con acceso a esa corredoría (mismo tenant) puede hacer clic en "Marcar como
   revisado" — no hay un rol especial de "revisor" separado, es el mismo control de acceso que ya
   rige el resto de la ficha del cliente.
4. Al marcar, el aviso cambia a *"Revisado por {nombre} el {fecha}"* y los dos botones se habilitan.
5. El listado/historial muestra el estado (pendiente/revisado) de cada comparativa para que se note
   si algo quedó sin revisar.

Es una salvaguarda de proceso, no un control de seguridad contra un actor adversarial — a diferencia
del renderizador público (ADR-19), acá el actor es la propia corredoría autenticada, que igual tiene
acceso a los datos crudos. El punto del gate es evitar que una recomendación de IA salga sin que nadie
la haya mirado, no impedir que alguien decidido la esquive.

---

## Fuera de alcance de este módulo

- Conexión OAuth a Google/Microsoft (Drive/Sheets, OneDrive/Excel) — queda como mejora futura, el v1
  usa subida de archivo o link de Sheet compartido.
- Envío automático de mail — el mail es siempre un draft para copiar a mano.
- Edición del informe o del mail generado dentro del portal — v1 es de solo lectura; revisar es
  confirmar, no corregir.
- Cualquier vertical que no sea `correduria_seguros`.
- Un rol de "revisor" separado del control de acceso ya existente por tenant.
- Notificaciones (Telegram, email) de que una comparativa quedó pendiente de revisión.

## Riesgos y puntos de mayor incertidumbre

1. **Google Sheets sin OAuth depende de que el link esté compartido públicamente.** Si no lo está, la
   descarga del CSV-export falla (403) y hay que mostrar un mensaje claro pidiendo compartir el link
   — no hay forma de distinguir "no existe" de "no compartido" desde afuera, así que el mensaje debe
   cubrir los dos casos.
2. **Formato libre interpretado por LLM.** Una fila rara (celdas combinadas, columnas sin header,
   texto libre en vez de tabla) puede hacer que el LLM interprete mal o invente una aseguradora que no
   estaba. El provider tiene que poder fallar visiblemente (informe vacío + error, nunca inventar
   datos) cuando la confianza de extracción es baja — se define el criterio exacto al escribir el
   plan.
3. **Costo real por comparativa generada.** A diferencia de research (con budget por run ya definido),
   este es un flujo interactivo nuevo — hay que fijar el preflight de presupuesto al escribir el plan,
   seguramente reusando el criterio ya establecido en `kr-service`/`orchestrator` (abortar antes de
   gastar, no después).

## Verificación (una vez escrito el plan de implementación)

- Migración: RLS de `comparativas_seguros` probada igual que el resto (un tenant no ve las filas de
  otro), contra PGlite.
- Un test que confirma que `POST .../comparativas-seguros` responde 409 si `clients.vertical !=
  'correduria_seguros'`.
- Un test de que `revisado_en`/`revisado_por` empiezan `null` y que sin ellos el endpoint (o el
  portal) no expone el informe como "revisado" — mutación: si el gate se rompe, un test tiene que
  caer.
- `core/sin-html-crudo.test.ts` (o su equivalente) cubre también el Markdown de este informe, no solo
  el de research.
- Provider mock determinístico para los tests; verificación manual en el navegador con el provider
  real antes de cerrar, igual disciplina que el resto del pipeline (sandbox, no producción).
