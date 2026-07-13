# Acción 03 — Research de prueba en PRODUCCIÓN (DataForSEO)

**Tiempo:** ~20 minutos · **Costo:** ~50 USD de saldo (no se gasta todo) · **Prioridad:** 🟡 alta valor

> ⭐ **Esta es la acción que más valor te da.** Es la que produce el **costo real por research** —
> el número que necesitás para presupuestarle a Frank— y la que convierte la demo en algo que
> aguanta preguntas del cliente.

## Por qué

Hoy el research corre contra el **sandbox** de DataForSEO, que devuelve **datos ficticios**.
Por eso el spike siempre da lo mismo: ~1 cluster, 1 página, y costo $0 de DataForSEO.

Los volúmenes de búsqueda, la dificultad (KD) y los clusters **no son reales**. Todo lo que
depende de IA (seeds, intención, relevancia, contenido) **sí es real**, pero los números SEO no.

Con una sola corrida en producción conseguimos tres cosas:
1. El **costo verdadero por research** (DataForSEO + LLM, desglosado).
2. **Volúmenes, KD y clusters reales** → una demo creíble.
3. Datos para que yo **calibre las estimaciones** del presupuesto preflight (hoy son a ojo).

---

## Paso 1 — Cargar saldo

DataForSEO es **prepago**: cargás saldo y se descuenta por consulta.

1. Entrá a tu dashboard de **https://dataforseo.com**
2. Buscá la sección de **saldo / billing / add funds**.
3. Cargá el mínimo (históricamente ~**50 USD**; confirmá el actual en el dashboard).

> Un research individual cuesta **centavos**, no decenas de dólares. Los 50 USD son el mínimo de
> carga, no el costo de la prueba. Te va a quedar saldo de sobra.

## Paso 2 — Cambiar UNA línea

Abrí **`kr-service/.env`** y cambiá la URL base:

```diff
- DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
+ DATAFORSEO_BASE_URL=https://api.dataforseo.com
```

Guardá. **Eso es todo** — no hay que tocar nada de código.

> Verificá también que sigas teniendo `DATAFORSEO_MODE=live` (no `mock`).

## Paso 3 — (Recomendado) Poner un tope de gasto

Por si acaso, podés limitar cuánto puede gastar la corrida. No es obligatorio, pero es red de
seguridad. Si querés que lo active, avisame y lo configuro — o simplemente corré el paso 4 y
mirá el costo al final (una corrida normal ronda los centavos).

## Paso 4 — Correr UNA research

Idealmente con un caso **real de la agencia** (un cliente de verdad), que es lo que después le
mostrás a Frank. Si no, usá el ejemplo:

```bash
cd kr-service
npm run spike "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día, cenas para grupos."
```

Vas a ver el pipeline correr. Al final, la línea clave:

```
[cost] total $0.0XXX · DFS $0.0XXX · LLM $0.0XXX · emb $0.0XXX
```

Ahora **DFS ya no es $0.0000** — ese es el costo real de DataForSEO.

## Paso 5 — 🔴 VOLVER A SANDBOX (importante)

Apenas termine la corrida, **revertí el cambio** para no gastar en cada prueba de desarrollo:

```diff
- DATAFORSEO_BASE_URL=https://api.dataforseo.com
+ DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
```

> Si te olvidás de esto, **cada corrida de desarrollo te va a cobrar**. Es el error más fácil de
> cometer acá.

## Paso 6 — Pasarme el resultado

Mandame **el contenido de `kr-service/out/informe.md`** (es un archivo de texto, podés copiar y
pegar todo). Ahí está:
- la tabla de **costo desglosado** por proveedor,
- las **páginas propuestas** con sus volúmenes y KD reales,
- los clusters.

Si preferís algo más corto, alcanza con el bloque `meta_run` de `kr-service/out/brief.json`.

**No contiene secretos** — es el entregable del research.

---

## Qué hago yo con eso

1. Te digo el **costo real por research**, listo para la propuesta comercial.
2. **Calibro las estimaciones** del presupuesto preflight con datos verdaderos (hoy son
   aproximaciones mías).
3. Generamos la **web con datos reales** (`web-builder`) para la demo.

---

## Cómo saber que salió bien

- [ ] Hay saldo cargado en DataForSEO.
- [ ] La corrida terminó con `✅ Brief válido`.
- [ ] En el log, `DFS $...` es **mayor a cero**.
- [ ] Los volúmenes de las páginas propuestas parecen reales (no todos iguales).
- [ ] **Volviste a sandbox** en el `.env`. ← no te olvides
- [ ] Me pasaste el `informe.md`.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `DFS $0.0000` | Seguís apuntando al sandbox. Revisá la URL en el `.env`. |
| Error 401 / 402 | Credenciales mal, o **sin saldo** cargado. |
| Error 429 | Rate limit. El sistema **reintenta solo** con backoff; si persiste, esperá un rato. |
| Muchos avisos `task ... status ...` | Alguna consulta puntual falló; el sistema sigue con las demás y te avisa. Pasame el log igual. |
