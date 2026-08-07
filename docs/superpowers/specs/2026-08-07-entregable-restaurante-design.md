# El entregable del restaurante, y el margen que no debe salir de la agencia

**Fecha:** 2026-08-07 · **Estado:** contrato fijado, sin implementar

Dos deudas con nombre del [`09`](../../proyecto/09-estado-y-roadmap.md) que son **la misma pregunta
desde dos lados**: *qué ve alguien que no es la agencia*.

- **El entregable del restaurante no existe.** Sería el informe de KR-2 **sin el bloque de coste**, y es
  la pieza dueña del **PDF** que ADR-07 pedía (nota fechada del 2026-08-05 en el ADR).
- **🔴 El coste del research es legible por el rol `cliente`.** `run_select` sobre `kr_runs` usa
  `app.ve_cliente(client_id)` ([`0001_init.sql:441`](../../../db/migrations/0001_init.sql#L441)), así que
  un `cliente` ve `coste_micros_usd` de su propio run. Hoy **no es fuga activa** —no hay usuarios con ese
  rol— pero el rol existe, RLS lo contempla y la demo ya está en producción.

Hacerlas por separado corre un riesgo concreto: que la pantalla deje de pintar el coste mientras la API
lo sigue devolviendo. Eso no es una frontera, es un adorno.

---

## 1. Las decisiones, y quién las tomó

| Decisión | Qué se eligió | Por qué |
| --- | --- | --- |
| **El PDF** *(Juan, 2026-08-07)* | **Vista imprimible + PDF del navegador** | Cero dependencias y cero build — el invariante de `tsx` sin paso de build se mantiene. El PDF que sale es real (texto seleccionable, enlaces vivos). La spec de KR-2 §2.1 ya había anotado que una librería de PDF o headless Chrome sería la primera dependencia de su clase en el repo, para la única superficie que la necesitaría |
| **Quién lo ve** *(Juan, 2026-08-07)* | **Solo la agencia** (`maestro`, `equipo`) | La agencia mantiene el control editorial: decide cuándo el research está listo para mostrarse. Y no abre superficie nueva para un rol que hoy no tiene usuarios |
| **Dónde se filtra el coste** | **En SQL, con `app.es_staff()`** | ADR-15: el rol se **deriva** de `memberships` dentro de Postgres. Un `if (rol === 'cliente')` en la API sería la misma decisión tomada en el lugar donde nadie la audita |
| **De dónde sale el documento** | **Se genera al vuelo desde la base** | El informe interno se guarda congelado al terminar el run, y eso es correcto para él. El entregable tiene que reflejar **lo que pasó la compuerta**: si se congelara, el restaurante recibiría el brief original y no lo aprobado |
| **Cómo se excluye el coste** | **No se genera**, no se oculta | Si la vista lo tapara con CSS o con un `@if`, el dato **ya viajó al navegador**. La diferencia entre ocultar y no enviar es la pieza entera |

## 2. El contrato

### 2.1 `contrato/` — `renderReport` aprende a omitir el coste

```ts
export interface OpcionesInforme {
  /** ¿Incluir el bloque «Coste del research»? Es el margen de la agencia. */
  readonly incluirCoste: boolean;
}

export function renderReport(brief: KeywordResearchBrief, opciones: OpcionesInforme): string
```

**El parámetro es obligatorio y no tiene default.** Un default `true` haría que quien lo olvide filtre
el margen; un default `false` haría que el informe interno pierda en silencio su argumento comercial.
Sin default, cada llamada declara qué documento está produciendo y `tsc` no deja pasar la duda. Es la
misma forma que `PIPELINE_MODO` (tramo A): cuando la opción segura y la opción útil son distintas, no
hay default correcto — hay una decisión que alguien tiene que escribir.

Con `incluirCoste: false` desaparece la sección entera (`informe.ts:95-115`), incluido el aviso de
`modelos_sin_precio`, que también habla de tarifas.

### 2.2 `db/` — el coste lo decide Postgres

`RUN_SUMMARY_COLS` ([`store.ts:253`](../../../db/src/store.ts#L253)) es **una sola definición** que usan
`getRun`, `listRuns` y `listAllRuns`, así que el cambio es de un solo lugar:

```sql
case when app.es_staff() then coste_micros_usd::int end as coste_micros_usd
```

Y el tipo lo acompaña: `RunSummary.coste_micros_usd: number | null`. Ese `| null` es la mitad del valor
del cambio — el compilador va a señalar cada consumidor, incluida la suma de la cartera
([`portal/src/app/core/cartera.ts:21`](../../../portal/src/app/core/cartera.ts#L21)), que hoy asume que
siempre hay número.

> **Lo que hay que medir antes de escribir el test:** que `app.es_staff()` es evaluable en esa posición
> del `select` con el rol `app_user`, y que devuelve **false** —no error— para un `cliente`. El test va
> con el **login real** (o `set role`), nunca con el superuser: un `select` sin restricción pasa siempre
> como superuser (es el checkpoint C3 que `kr_informes` estrenó).

### 2.3 `api/` — el endpoint del entregable

```
GET /runs/:id/entregable.md   → 200 text/markdown  (sólo staff)
                              → 404               (no staff, o run inexistente)
```

**El 404 para no-staff no es un `if`:** la consulta que reconstruye el brief lleva `app.es_staff()` en su
predicado, así que para un `cliente` devuelve cero filas y el endpoint no distingue ese caso de un run
que no existe. Postgres decide, y de paso no se filtra la existencia del run.

El `Content-Disposition` reusa la allowlist de `nombreArchivo()`
([`api/src/informe-nombre.ts`](../../../api/src/informe-nombre.ts)) que KR-2b ya escribió y probó, con
`entregable-<cliente>.md`. **Y el CORS tiene que declarar `exposeHeaders`** — ya está puesto desde
KR-2b, pero es la trampa que costó una sesión de navegador: sin él, el navegador le esconde el header a
JavaScript y el archivo baja con el `runId`.

### 2.4 `portal/` — la vista imprimible

Ruta nueva bajo el detalle del run, visible **solo para staff**. Renderiza el markdown del entregable con
el parser que KR-2b ya tiene (`core/markdown.ts`, sin `innerHTML`), maquetado con `@media print`:

- sin la barra de navegación, sin botones, sin el shell del portal;
- con el nombre del cliente y la fecha como encabezado del documento;
- saltos de página que no partan una tabla ni un `<h3>` de su contenido.

**El coste no aparece porque el servidor no lo mandó**, no porque el CSS lo tape.

Y en la pantalla del brief, `coste_micros_usd` pasa a ser `number | null`: cuando es `null` la línea de
coste **no se pinta** — no se pinta `$0.00`, que sería afirmar que el research fue gratis.

## 3. Lo que ADR-07 exige al cerrar

ADR-07 dice que el PDF "no desaparece: cambia de pieza", y **ésta es la pieza**. Al cerrar hay que
volver al ADR y dejar escrito qué se cumplió y **cómo** — que el PDF se entrega por la vía del navegador
y no por una dependencia de servidor, que es una forma que el ADR no contemplaba.

## 4. El reparto, y en qué orden

El trabajo cruza cuatro paquetes y **comparte contrato**, así que va en serie donde el contrato manda:

1. **`contrato/`** — el parámetro de `renderReport`. Lo consume todo lo demás.
2. **`db/` + `api/`** (agente `datos`) — el `case when` de `RUN_SUMMARY_COLS`, el `| null` en el tipo, y
   el endpoint. Se puede empezar en paralelo con (1) salvo el uso de `renderReport`.
3. **`portal/`** (agente `front`) — la vista imprimible y los consumidores del coste nullable. **Va
   último**: consume las dos mitades anteriores.

Integrar, verificar el conjunto y commitear es de la sesión principal, con todo el cambio a la vista.

## 5. Lo que este trabajo NO hace

- **No toca el informe interno.** Sigue con su coste, su `kr_informes` y su política `app.es_staff()`.
- **No le da al rol `cliente` ninguna pantalla nueva** (decisión de §1).
- **No genera el PDF en el servidor.** Si algún día hace falta un PDF automatizable (mandarlo por mail
  desde el sistema), esa es otra pieza y otra decisión.
- **No cambia `cartera-mock.ts`** más de lo que el `| null` obligue: el test que lo ata a `PAGINAS_DEMO`
  del seed tiene que seguir en pie.
