# 07. Guion de la demo con Frank

> **Escrito el 2026-08-01, la mañana de la reunión.** Todo lo que dice este documento se verificó en
> vivo esa misma mañana: el portal en producción con sesión real, el renderizador contra el Storyblok
> real, y la compuerta de aprobación apretando el botón. Lo que no se pudo verificar, está marcado.

## La decisión de hoy: no se despliega nada

La reunión es esta tarde. **No se toca infraestructura ni código.** Desplegar el renderizador —que es
lo que más mejoraría la demo— mete DNS, certificados TLS y un runbook con tropiezos reales
documentados: es trabajo de días tranquilos, no de horas antes de una reunión. Un despliegue a medias
convierte una demo que funciona en una demo rota.

**Y no se corre research en vivo.** Está medido: **16 min 15 s** (acción 06). Frank mirando un spinner
es la demo muerta. Lo que se muestra es la corrida ya hecha, que es real y costó $0.3097.

---

## Qué se le puede mostrar, y desde dónde

| # | Pieza | Dónde | Estado |
|---|---|---|---|
| 1 | **El portal** (panorama + compuerta + evidencia) | `https://bigballs.es` — producción, TLS, login real | ✅ Verificado hoy |
| 2 | **La web del cliente**, viva | `https://amg-renderer-production.up.railway.app` — **en internet** | ✅ Desplegado y verificado hoy |
| 3 | **Aprobar y publicar** (el gesto completo) | `localhost:4200` — en producción ese botón está apagado | ✅ Verificado hoy |

> ### 🚀 Cambio de última hora: la web del cliente ya no está en `localhost`
>
> Se desplegó el renderizador en Railway **la misma mañana de la demo**. El golpe 4 pasa de "cambiar
> de ventana a mi máquina" a **una URL de internet**, que es una diferencia grande en una venta.
>
> Lo que lo hizo posible sin riesgo: es un **servicio nuevo**. No tocó `main`, ni el portal, ni la
> API — el peor caso era "no llegó" y seguir con `localhost`. Y la migración `0010`, aplicada esa
> misma mañana, era justo su bloqueante silencioso: sin ella el footer habría salido sin locales y
> `/menu` en 404, **sin un solo error en los logs**.
>
> El renderizador lee de Supabase con `amg_render` → `app_render`, el rol más pobre del sistema.
> Comprobado contra la base de producción: **no** puede leer `business_profile` crudo, ni `kr_runs`,
> ni `memberships`. Si te toman esa web, se llevan los cinco campos públicos del perfil.

La regla para elegir entre producción y local, en cada momento:

> **Producción para todo lo que se pueda; local solo para el botón de publicar.** En producción hay
> **un solo run** y está limpio. En local hay **tres** (dos de relleno que siembra el `dev-server`:
> "Cervecería artesanal en Chamberí" y "corrida anterior"), y eso ensucia el relato de "este es tu
> cliente".

---

## Preparación — 30 minutos antes

### 1. Comprobar que la web del cliente responde

Ya no hay que levantar nada: está desplegada. Un `curl` antes de empezar:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://amg-renderer-production.up.railway.app/
```

Tiene que decir `200`. Si dijera `404`, es la **caché negativa** del renderizador: pasó durante el
despliegue, se resuelve sola en un minuto y el segundo intento va bien.

> **Plan B, si Railway se cayera justo hoy.** El `demo-server` local sigue funcionando y está
> verificado:
>
> ```bash
> npm run demo -w renderer     # http://localhost:8080/?_host=bellanapoli.es
> ```
>
> Ojo con dos cosas si tenés que recurrir a él: el `?_host=` dice `bellanapoli.es` (el italiano que
> ya no existe; la web que sirve **es** La Birra Bar, el host solo elige el space), y avisa que no
> encuentra `brief.approved.json`, que es **inofensivo** — las páginas las lee de Storyblok.

### 2. Levantar el portal local (solo para el gesto de aprobar)

Dos procesos, en dos terminales:

```bash
npm run dev:server -w api      # API sobre PGlite en memoria, puerto 3000
cd portal && npm start         # puerto 4200 — NO otro
```

> **El puerto 4200 no es opcional.** El `dev-server` de la API acepta CORS **solo** desde
> `http://localhost:4200`. Lo comprobé esta mañana levantando el portal en 4300: la pantalla de
> research queda en **`Failed to fetch`**. Si el 4200 está ocupado por otra cosa, cerrala.

El `dev-server` imprime al arrancar un snippet como este. **Copialo y pegalo en la consola del
navegador** (F12 → Console) estando en `http://localhost:4200`, y recargá:

```js
localStorage.setItem('amg.sesion', "{\"accessToken\":\"valid:2222…\",…}")
```

En local no se entra por la pantalla de login: la sesión se inyecta. El `accessToken` es falso a
propósito (`valid:<uuid>`) — es un harness de desarrollo, no hay Supabase detrás.

### 3. Entrar a producción

Abrí `https://bigballs.es`, logueate con tu usuario y **dejá la sesión abierta**. Entra por
`/clientes`, que es donde abre el portal: el primer golpe está a un clic en «Cartera», en la barra
lateral.

> **Cambió el 2026-08-11**, cuando la navegación se volvió cliente-céntrica: la home era `/runs` y el
> research se alcanzaba desde el menú. Hoy el research es un **tab de la ficha del cliente**, y las URLs
> `/runs/*` de las pestañas de abajo ya no existen — rebotan a `/clientes`. Si venís de un guion
> impreso, usá estas.

### 4. Las pestañas, en este orden

| Pestaña | URL | Para qué |
|---|---|---|
| 1 | `https://bigballs.es/cartera` | Golpe 1 — el panorama |
| 2 | `https://bigballs.es/clientes/d3305eba-11a5-4e0e-9c1f-000000000001/research/d3305eba-11a5-4e0e-9c1f-000000000002` | Golpes 2 y 3 — la compuerta y la evidencia |
| 3 | `https://amg-renderer-production.up.railway.app` | Golpe 4 — la web viva, **en internet** |
| 4 | `http://localhost:4200/clientes/d3305eba-11a5-4e0e-9c1f-000000000001/research/d3305eba-11a5-4e0e-9c1f-000000000002` | El cierre — aprobar y publicar |

Dejalas cargadas antes de que entre Frank. Cambiar de pestaña es instantáneo; cargar una página
delante de alguien se siente lento aunque tarde un segundo.

---

## El recorrido

La objeción que mata esta venta no es el precio. Es: *"si esto publica una barbaridad en el sitio de
mi cliente, pierdo al cliente"*. Todo el guion está construido para responder eso **antes de que lo
pregunte**: el rigor y la compuerta no compiten con la velocidad, son lo que la hace vendible.

### Golpe 1 — El panorama (pestaña 1, ~2 min)

**Qué se ve:** el dashboard de cartera. KPIs arriba, «Top oportunidades» como gráfico de barras,
«Coste por corrida», y la tabla de oportunidades de La Birra Bar con evidencia por fila.

**Qué decir:** *"Así ves toda tu cartera: cuántos sitios están activos, qué oportunidades tiene cada
uno y cuánto costó cada corrida."*

> ### 🔴 Adelantate a esto, no esperes la pregunta
>
> Los KPIs dicen **«Sitios activos: 6»** y **«Coste total: $4.08»**. **Cinco de esos seis clientes son
> de muestra.** Real hay uno: La Birra Bar, con su fila, sus keywords y sus $0.31.
>
> Decilo vos primero, en una frase: *"la cartera está poblada con datos de muestra para que se vea
> como se vería con seis clientes; el que vamos a abrir es real, es un cliente de la agencia."*
>
> Si esperás a que lo pregunte él, la respuesta suena a que te descubrieron. Dicho de entrada, suena
> a que sabés exactamente qué es cada cosa — y le da permiso a imaginarse su propia cartera ahí.

Lo que **sí** es real en esta pantalla y conviene señalar: las **ocho barras** del gráfico son
keywords de La Birra Bar, con sus volúmenes y scores; y la columna **«Confianza»** de la tabla.

### Golpe 2 — La compuerta (pestaña 2, ~4 min · es el corazón)

**Qué se ve:** el brief. Dos bloques, y ahí está todo el argumento:

```
✅ Respaldadas por datos (8)      ⚠️ Sin validar (6)
   Vol: 2400 · KD: 34 · Score 94.5    Vol: n/d · KD: n/d · Score 57
```

**Qué decir:** *"El sistema propone catorce páginas, pero no te las presenta todas iguales. Estas ocho
tienen demanda demostrable: volumen de búsqueda real, dificultad medida. Estas seis las propone
igual, pero te avisa que **no tiene datos de mercado que las respalden**."*

Y el remate, que es el que vende:

> *"Fijate que no dice 'cero búsquedas'. Dice **n/d**: no sabemos. Un sistema que te dice cero cuando
> no sabe, te está mintiendo, y vos tomás decisiones con esa mentira."*

*(Es literal: el proveedor devuelve `null` en muchas keywords y el código lo convertía en 0. Se
arregló al correr contra datos reales por primera vez. Contrato `kr.v0.4`.)*

**Qué NO tocar acá:** los botones **Aprobar** de cada página están vivos en producción y escriben en
la base. No los aprietes en esta pestaña — el gesto de aprobar lo hacés al final, en local, donde
además existe el botón de publicar. *(Si igual apretás alguno, no pasa nada grave: se limpia
re-sembrando, ver el final del documento.)*

### Golpe 3 — La evidencia por página (misma pestaña, ~2 min)

Bajá a una página concreta y mostrá que cada fila trae **keyword, slug, volumen, dificultad y score**.
El slug es el que se va a publicar.

**Qué decir:** *"Esto no es una lista de ideas. Cada página ya tiene su URL, su título, su
descripción y sus preguntas frecuentes escritas."*

### Golpe 4 — La web viva (pestaña 3, ~4 min · el que cierra)

Acá el salto es de "una herramienta de SEO" a "un producto". Pasá a
`https://amg-renderer-production.up.railway.app`.

**Qué decir:** *"Y esto es lo que se publica. No es una maqueta ni corre en mi máquina: está en
internet, servida en vivo desde el CMS, con las catorce páginas que acabás de ver en el panel."*

> **La URL es fea a propósito, y conviene adelantarse.** `amg-renderer-production.up.railway.app` es
> el dominio que da el hosting. *"El dominio del cliente se apunta acá y listo; de hecho el DNS de
> `labirrabar.bigballs.es` ya está puesto, falta solo terminar de enchufarlo."* Es verdad y convierte
> una URL provisional en una demostración de que el sistema sirve **N dominios desde un servicio**.

El recorrido dentro de la web, en este orden (todo verificado hoy):

1. **La portada** — el nombre del negocio y el índice de las páginas publicadas.
2. **La barra de navegación**: Inicio · Menú · Ubicaciones · Contacto. *"Cuatro secciones fijas, no
   una lista de artículos de SEO. Parece el sitio de un restaurante porque es el sitio de un
   restaurante."*
3. **`/menu`** — la carta, agrupada en **Hamburguesas · Cervezas artesanales · Acompañamientos**.
4. **El footer** — los **dos locales reales**, con dirección y horarios:
   - Centro (Puerta del Sol) — Carrera de San Jerónimo 3
   - Salamanca — Calle de José Ortega y Gasset 79
5. **`/blog`** — *"y los dos artículos van acá, separados de las páginas comerciales."*

**El as técnico, si Frank o alguien del equipo entiende de SEO** (F12 → Elements, o «ver código
fuente», y buscá `application/ld+json`):

| Página | Qué declara ante Google |
|---|---|
| `/mejor-hamburguesa-del-mundo-madrid` (landing) | `LocalBusiness` + `FAQPage`, con la dirección real |
| `/mejor-hamburguesa-dubai-burger-championship` (blog) | `Article` + `FAQPage` |

*"El sistema sabe cuándo una página es el negocio y cuándo es un artículo, y se lo dice a Google
distinto. Un artículo no es un local, y declararlo mal te penaliza."* Ese JSON-LD pasó el Rich
Results Test de Google sin errores.

### El cierre — Aprobar y publicar (pestaña 4, ~2 min)

Pasá a `localhost:4200`, al mismo brief. Acá **sí** está el botón **«Aprobar el run y publicar»**.

**Qué hacer:** aprobá **una** página. Verificado esta mañana: la fila pasa de **Pendiente** a
**Aprobada**, el botón «Aprobar» desaparece de esa fila y quedan las otras trece. Sin recargar.

**Qué decir:** *"Nada se publica sin que alguien lo apruebe. Página por página, o el lote entero. Y si
editás una página aprobada, **pierde la aprobación** y hay que volver a mirarla. No hay forma de que
esto publique algo que vos no viste."*

Eso es la respuesta a la objeción que mata la venta, y llega al final, cuando ya vio que funciona.

---

## El número, para cuando pregunte el precio

> **Un research completo cuesta ~$0.31.** 52 keywords analizadas → 14 páginas con contenido escrito.
> Estable en tres corridas.

| Proveedor | Coste | % |
|---|---|---|
| DataForSEO | $0.2522 | 81% |
| LLM (generación) | $0.0586 | 19% |
| Embeddings | ~$0.0000 | ~0% |

**Cómo usarlo:** *"el costo marginal de una web completa son centavos. Lo que se cobra no lo limita la
API: lo limita el valor del entregable."* No es un argumento para bajar el precio — es un argumento de
**margen**, y de que escalar a cincuenta clientes no multiplica los costos.

---

## Las preguntas difíciles, y la respuesta honesta

| Si pregunta… | Respuesta |
|---|---|
| **"¿Por qué esa URL rara?"** | *"Es el dominio del hosting. El del cliente se apunta ahí; el DNS de `labirrabar.bigballs.es` ya está configurado, falta terminar de enchufarlo."* Y el argumento fuerte: **un servicio sirve N dominios**, uno por cliente, resolviendo por el nombre con el que entra la visita. |
| **"¿Puedo lanzar un research ahora?"** | *"Tarda dieciséis minutos: es research real contra datos de mercado de pago, no una simulación. Te lo dejo corriendo y lo vemos, o mirás el resultado ya hecho."* Los dieciséis minutos son un argumento de que es real. |
| **"¿Estos seis clientes son tuyos?"** | Ya lo dijiste en el golpe 1. Si vuelve: *"cinco son de muestra, uno es real."* |
| **"¿Y si publica una barbaridad?"** | Es el golpe 4. Compuerta por página, editar quita la aprobación, y el equipo revisa antes. |
| **"¿Los datos de un cliente los puede ver otro?"** | *"El aislamiento no lo hace el código de la aplicación: lo impone la base de datos, y está probado contra un Postgres real."* No entres en RLS salvo que él sea técnico. |
| **"¿De dónde salen los textos?"** | Los escribe IA a partir del research, y **un humano los aprueba antes de publicar**. No lo escondas: el control es el producto, no la ausencia de IA. |
| **"¿Qué pasa si me quiero ir?"** | Honestidad: el space de Storyblok es del cliente y se entrega; la salida gestionada todavía **no tiene precio cerrado** (ADR-11). Si lo pregunta, es buena señal — anotalo y respondé después. |

---

## Después de la demo

Si apretaste botones de aprobar en **producción**, dejá la base como estaba:

```bash
npm run reseed:demo
```

Es idempotente, conserva los UUID fijos y vuelve a poner las 14 páginas en **0 aprobadas**, con el run
en `pending_approval`. Tarda segundos.

Y anotá, mientras esté fresco: qué preguntó, dónde se le iluminó la cara y dónde se aburrió. Eso vale
más que cualquier cosa que digan estos documentos sobre qué construir después.

---

## Lo que se verificó esta mañana, para que confíes en este guion

- `bigballs.es`: bundle de producción servido (sin placeholders, sin `localhost`), `/health` de la API
  en 200, 401 sin token, login real, y **los 14 slugs del brief coinciden uno a uno y en orden** con
  las keywords del dashboard.
- Contraste de los ejes en oscuro: **11.49:1** (era 1.53:1 esta mañana temprano). Si tu portátil está
  en modo oscuro, el dashboard se lee.
- Renderizador **desplegado en Railway** y verificado en el navegador contra la base de producción:
  portada, nav de 4 secciones, `/menu` con 3 categorías, `/blog` con exactamente los 2 artículos,
  footer con los 2 locales, 14 páginas enlazadas, y JSON-LD correcto por tipo (`LocalBusiness` en las
  landings, `Article` en los blogs). Las 5 rutas en 200.
- Aislamiento del rol del renderizador, comprobado contra producción con savepoints (sin ellos la
  comprobación era vacua: la transacción abortada hacía "fallar" todo lo siguiente). `app_render`
  **no** puede leer `business_profile` crudo, ni `kr_runs`, ni `memberships`.
- **Detalle cosmético conocido:** `/favicon.ico` da 404, así que la pestaña muestra el icono genérico.
  No afecta a nada y arreglarlo obligaba a redesplegar; se hace después de la demo.
- Compuerta: aprobar una página funciona y da feedback inmediato, sin errores en consola.
- Consola del navegador **limpia** en las tres pantallas del portal.

Lo único del guion **no verificado en producción**: apretar «Aprobar» en `bigballs.es` (no lo hice
para no dejar rastro en la base antes de tu demo). El mismo botón, con el mismo código, sí lo probé
en local.
