# Gastos — AMG OS

**Qué es esto.** El registro de lo que este proyecto ha costado en dinero real, y de lo que va a
seguir costando. Es la única fuente de verdad de los desembolsos: **lo que no está acá, no se pagó**.
Hasta el 2026-08-10 esta información no existía en el repo y había que reconstruirla a mano cada vez
que alguien preguntaba.

**Qué NO es.** No es el costo unitario del producto ni la propuesta comercial a Frank. El costo por
research (el número que se le presenta al cliente) vive medido en
[09-estado-y-roadmap.md](proyecto/09-estado-y-roadmap.md) y se resume abajo en
[§4](#4-el-costo-unitario-lo-que-cuesta-usar-la-plataforma).

**Última actualización:** 2026-08-10 · **Fuente de las cifras:** las facturas de Juan (§1 y §2) y las
corridas medidas del repo (§4).

> ### La marca ⁽ᵈ⁾ = gasto de otro proyecto que incide acá
>
> Hay herramientas que se pagan para otros trabajos pero que este desarrollo también usa (o cuyo
> desembolso salió del mismo bolsillo en el mismo período). Van marcadas con **⁽ᵈ⁾** y **suman
> aparte**: mezclarlas con las directas infla el costo del proyecto, y esconderlas lo miente por
> defecto. Las dos cifras se dan por separado y la decisión de cuál usar es de quien lee.

---

## 1. Desembolsado hasta el 2026-08-10 — directo del proyecto

| Concepto | Proveedor | Para qué sirve acá | Importe |
| --- | --- | --- | --- |
| Hosting anual | **Hostinger** | El dominio y el portal estático (`public_html`), el frontend que ve la agencia | **203,88 €** |
| Dominio `bigballs.es` | Hostinger | El dominio donde está desplegada la plataforma: portal en la raíz, API en `api.` | **9,90 €** |
| Saldo de API | **DataForSEO** | Volumen, dificultad, intención y SERP del keyword research. Prepago, no suscripción | **50,00 €** |
| Suscripción | **Claude** | El desarrollo: es quien escribió el repo entero | **90,00 €** |
| Hosting de servicios | **Railway** | La API (`api.bigballs.es`) y el renderizador. Plan Hobby | **5,00 €** |
| Crédito de API | **OpenAI** | Generación de contenido, clasificación de intención y embeddings del clustering | **10,00 €** |
| | | **Total directo** | **368,78 €** |

## 2. Desembolsado hasta el 2026-08-10 — compartido con otros proyectos ⁽ᵈ⁾

| Concepto | Proveedor | Por qué incide | Importe |
| --- | --- | --- | --- |
| Dominio `dinamicSeo.es` ⁽ᵈ⁾ | Hostinger | Otro proyecto, mismo plan de hosting y mismo período | 9,90 € |
| Suscripción ⁽ᵈ⁾ | **Canva** | Material gráfico y mockups, también de la propuesta | 12,00 € |
| Licencia ⁽ᵈ⁾ | **Elementor** | Otro proyecto (web en WordPress). **Facturado en dólares** | 240,79 USD |
| | | **Subtotal** | **21,90 € + 240,79 USD** |
| | | **Equivalente** (a 1 USD = 0,92 €) | **≈ 243,43 €** |

> ⚠️ **El tipo de cambio es un supuesto, no un dato.** El único importe en dólares es Elementor y no
> tengo su cambio real; a 0,92 salen 221,53 €. Si la factura trae otro, se corrige acá y el total de
> abajo se mueve con él. Es el único número de este documento que no viene de una factura o de una
> medición.

## 3. El total, y el matiz que lo cambia

| | Importe |
| --- | --- |
| **Directo del proyecto** (§1) | **368,78 €** |
| Compartido con otros proyectos ⁽ᵈ⁾ (§2) | ≈ 243,43 € |
| **Todo lo desembolsado en el período** | **≈ 612,21 €** |

### Pagado no es consumido: 60 € de los 368,78 € siguen siendo saldo

De las dos APIs de pago por uso —DataForSEO (50 €) y OpenAI (10 €)— el proyecto **consumió alrededor
de un euro**. Son depósitos prepagos: el dinero está gastado en la cuenta corriente y **disponible en
el proveedor**, así que no es un costo hundido sino un activo que ya se puede usar.

| | Cargado | Consumido (medido) | Remanente aprox. |
| --- | --- | --- | --- |
| DataForSEO | 50,00 € | ~0,95 USD | ~98 % |
| OpenAI | 10,00 € | ~0,22 USD | ~98 % |

El consumo son **cuatro corridas contra producción**, las únicas que se pagaron desde julio: tres de
calibración el 2026-07-13 —$0,2765, $0,2783 y $0,3108, en
[acción 03](historia/acciones/03-research-produccion-dataforseo.md)— y la corrida final de la demo el
2026-07-30 —$0,3097, La Birra Bar, en
[acción 06](historia/acciones/06-corrida-final-demo.md)—. **Total: $1,1753.** El reparto por proveedor
sale de aplicar el split medido 81/19 al total, no de la factura del proveedor.

Todo el resto del desarrollo corrió contra **sandbox y providers mock, a cero**. Los `$0.00` que
aparecen por el `09` y el `15` son eso: el arnés está diseñado para que nada gaste sin que alguien lo
decida (ver [guia-dataforseo.md](guia-dataforseo.md) y el preflight de presupuesto).

## 4. El costo unitario: lo que cuesta *usar* la plataforma

Un research completo cuesta **$0,31** y es estable entre corridas:

| Proveedor | Coste | % |
| --- | --- | --- |
| **DataForSEO** | $0,2522 | **81 %** |
| OpenAI (generación) | $0,0586 | 19 % |
| OpenAI (embeddings) | $0,0000 | ~0 % |
| **Total** | **$0,3108** | |

Dos consecuencias que importan para la propuesta:

- **El costo marginal por cliente son centavos.** Lo que se le cobra al cliente no está limitado por
  la API, está limitado por el valor del entregable.
- **El 81 % es DataForSEO, no la IA.** Cambiar `gpt-4o` por un modelo más nuevo y barato
  (`gpt-5.4-mini` es ~3× más barato en input) baja el 19 %, no el total. La optimización de costo
  vive en los endpoints de DataForSEO —variante *task* en vez de `live`, cache de 30 días, SERP solo
  para cabezas de cluster—, no en el modelo.

## 5. Los siguientes gastos — el run-rate

Lo que se paga de nuevo sin que nadie haga nada. Separado a propósito en **desarrollo** y
**operación**, porque son dos decisiones distintas: la operación es lo que cuesta que la plataforma
siga en pie, y se puede sostener sin desarrollo activo.

| Concepto | Cadencia | Importe | Bloque |
| --- | --- | --- | --- |
| **Claude** | mensual | 90,00 € | desarrollo |
| **Railway** (Hobby) | mensual | 5,00 € | operación |
| **Hostinger** (plan anual) | anual | 203,88 € | operación |
| Dominio `bigballs.es` | anual | 9,90 € | operación |
| DataForSEO | por uso | ~$0,25 por research, desde el saldo | operación |
| OpenAI | por uso | ~$0,06 por research, desde el crédito | operación |
| Canva ⁽ᵈ⁾ | mensual | 12,00 € | fuera del proyecto |
| Elementor ⁽ᵈ⁾ | anual | 240,79 USD | fuera del proyecto |

**El número que conviene tener en la cabeza:**

| | Al mes | Al año |
| --- | --- | --- |
| **Operar la plataforma** (Railway + hosting + dominio prorrateados) | **≈ 22,82 €** | **273,78 €** |
| **Desarrollarla** (Claude) | 90,00 € | 1.080,00 € |
| **Total con desarrollo activo** | ≈ 112,82 € | **1.353,78 €** |

> **El costo dominante de este proyecto no es la infraestructura: es el desarrollo.** Mantener la
> plataforma viva cuesta ~23 € al mes; construirla cuesta 90 € al mes, cuatro veces más. Cualquier
> conversación de rentabilidad empieza ahí y no en Railway — y también significa que **el día que se
> deje de desarrollar, el costo cae a la quinta parte** sin apagar nada.

## 6. Lo que se dispara al escalar (previsto, no pagado)

Ninguno de estos está contratado. Están acá porque el repo ya identificó *dónde* se rompe cada plan
gratuito o barato, y una sorpresa de facturación documentada de antemano no es una sorpresa.

| Qué | Cuándo se dispara | Costo esperado |
| --- | --- | --- |
| **Railway, subir de plan** | **Ya está en el límite**: el plan actual admite dos custom domains y los dos están usados. El dominio propio del primer cliente no entra | Pro ~$20 al mes, o mover el TLS a una CDN |
| **Supabase Pro** | Cuando la base pase de la demo a clientes reales (hoy Free alcanza) | ~$25 al mes |
| **Storyblok** | Un space por cliente cambia el plan. El [ADR-08](decisiones-arquitectura.md) ya prevé que en la *salida gestionada* **el cliente asuma su suscripción** | plan actual del space: **sin confirmar** |
| **DataForSEO / OpenAI** | Lineal: cada research son $0,31. Cien clientes con un research al mes son ~$31 al mes | despreciable frente al fee de la agencia |

El límite de Railway es el único de los cuatro que **bloquea hoy**: es lo que falta para cerrar Fase 2
(ver [09-estado-y-roadmap.md](proyecto/09-estado-y-roadmap.md) y
[15-plan-plataforma.md](proyecto/15-plan-plataforma.md)).

## 7. Lo que falta confirmar

Cinco datos que solo Juan tiene y que cambian las cifras de arriba. Están numerados para poder
cerrarlos de a uno:

1. **¿Los 90 € de Claude son un mes o el acumulado del proyecto?** Es el rubro más grande y el que
   más mueve el total: como cuota mensual son 1.080 € al año; como pago único, 90 €. Todo §5 asume
   **mensual**, que es el caso peor.
2. **¿Qué aloja el plan de Hostinger de 203,88 €?** Si en ese mismo plan vive también `dinamicSeo.es`,
   el importe debería **prorratearse** y parte pasaría a ⁽ᵈ⁾. Hoy se cuenta entero al proyecto, que es
   el caso peor.
3. **¿Cuándo renueva Hostinger?** Con la fecha, el run-rate anual deja de ser un prorrateo y pasa a
   ser un vencimiento en el calendario.
4. **¿Los 5 € de Railway son un mes o varios?** §5 lo trata como cuota mensual.
5. **El cambio real de la factura de Elementor**, para reemplazar el 0,92 supuesto de §2.

---

## Cómo se mantiene este documento

- **Un desembolso nuevo se anota acá el día que se paga**, en §1 o §2 según lleve ⁽ᵈ⁾, y se ajustan
  los totales de §3 y el run-rate de §5. Sin esto el documento se vuelve una foto vieja, que es peor
  que no tenerlo porque parece actual.
- **El consumo de las APIs se mide, no se estima.** Cada run guarda su `coste_micros_usd` en la base;
  ese es el dato. Si alguna vez aparece `[cost] ⚠️ sin tarifa`, el total está incompleto y el número
  no sirve para §4.
- **Los importes de §6 no se mueven a §1 hasta que exista la factura.** Un plan previsto no es un
  gasto, y confundirlos es cómo un presupuesto empieza a mentir.
