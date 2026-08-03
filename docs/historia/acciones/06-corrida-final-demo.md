# Acción 06 — Corrida final + republicar la demo ✅ HECHA (2026-07-30)

**Tiempo real:** 16 min 15 s (research) + publish · **Costo real:** $0.3097 · **Corrida:** La Birra
Bar (hamburguesería gourmet, Madrid), no el restaurante italiano de ejemplo — es un cliente real de
la agencia, así que **el caso de demo en el space de Storyblok ya no es "Bella Napoli"**: son las 14
páginas de La Birra Bar, publicadas y verificadas en el navegador (contenido, marca y JSON-LD
`LocalBusiness`/`Article`/`FAQPage` correctos, sin restos del perfil viejo). Detalle completo,
incluida la duración medida y lo que implica para la pieza D, en
[09-estado-y-roadmap.md](../../proyecto/09-estado-y-roadmap.md#-2-la-demo-con-frank--cuatro-piezas-la-a-ya-no-bloquea-a-las-demás)
y [11-plan-fase-2.md](../../proyecto/11-plan-fase-2.md).

## ✅ El seed del portal ya refleja esta corrida (2026-08-01)

Storyblok pasó a La Birra Bar acá, pero `db/src/seed-demo.ts` se quedó sembrando el italiano: el
portal contaba un caso y la web servía otro. **Corregido**: el seed (`sembrarDemo`) siembra las 14
páginas de La Birra Bar con **el split real de esta corrida (8 respaldadas / 6 sin validar)** y su
coste (`309700` micros = $0.3097). Un test ata el perfil del seed a
`web-builder/business-profile.json` para que no vuelva a divergir.

**Los slugs del seed son los de esta corrida, leídos de Storyblok** (CDA, 2026-08-01): slug, keyword
(`source_keyword`), título y descripción SEO, tipo de página, intención y FAQs salen de las 14 stories
publicadas acá. El brief del portal y la web dicen lo mismo, palabra por palabra. Lo único
reconstruido son las **métricas** (volumen, dificultad, score), que vivían en `out/brief.json` y se
perdieron con el directorio `out/` — respetan el split real 8/6 y se reemplazan cuando se regenere el
dataset. Ver [09-estado-y-roadmap.md § la demo](../../proyecto/09-estado-y-roadmap.md#-2-la-demo-con-frank--cuatro-piezas-la-a-ya-no-bloquea-a-las-demás).

**Paso operativo:** re-sembrar producción (`npm run seed:demo -w db`) cada vez que cambie este brief.

> ## ⚠️ Esta guía tenía un paso desactualizado: falta `DATABASE_URL_CACHE`
>
> Desde la tanda 13 (ADR-14), `npm run spike` contra producción **exige** un registro durable de
> idempotencia (rol `amg_cache`) o aborta antes de gastar. Esta guía no lo mencionaba. Además, si es
> la **primera vez** que ese rol se conecta, el **session pooler (puerto 5432)** de Supabase puede
> devolver `password authentication failed` con una password recién puesta y correcta — es un
> problema del pooler (Supavisor), no de la credencial. La solución que funcionó: usar el
> **transaction pooler (puerto 6543)** para `DATABASE_URL_CACHE`. `PgTaskLog` solo hace transacciones
> autocontenidas (`pool.transaction()`, sin `SET LOCAL` de sesión ni `LISTEN`), así que el modo
> transacción le sirve sin problema. Ver el paso 2 más abajo, ya corregido.

---

## Por qué hace falta

**Lo que hay publicado en Storyblok hoy es de ANTES de la tanda 5.** Es correcto y se puede
enseñar, pero no refleja las mejoras. La diferencia:

| | Publicado hoy (kr.v0.4) | Lo que saldría ahora (kr.v0.5) |
|---|---|---|
| **Evidencia** | Las 8 páginas se presentan iguales. 5 no tienen datos de mercado y **no se distingue**. | Separadas: **3 respaldadas por datos**, 5 marcadas `sin_validar`. |
| **JSON-LD** | **7 de 8** páginas declaran `LocalBusiness` ante Google. Varias son falsas. | Solo las que apuntan a un lugar. El resto: `WebPage` / `Article`. |
| **Tipo de página** | Casi todo `landing_local`. | Mix real: landing local, servicio, blog. |
| **Confianza** | El aprobador no la ve. | Visible antes de publicar. |

El punto vendible de la demo es que el sistema es **honesto**: te dice qué sabe y qué no. Eso hoy
no se ve porque el brief publicado es anterior al cambio.

---

> ### ⚠️ Si intentaste esta guía ANTES del 2026-07-13 (tanda 6), volvé a correrla
>
> Había un bug grave que **yo mismo introduje en esta guía**: la cache de DataForSEO no distinguía
> sandbox de producción. Una corrida de sandbox dejaba entradas con `volume: null`, y al cambiar la
> URL base a producción **se servían como aciertos**: la corrida "real" salía barata, sin volúmenes,
> y con un brief basura **que parecía legítimo**.
>
> **Corregido:** el sandbox ya no se cachea (es gratis: cachearlo solo podía envenenar producción) y
> las claves llevan el entorno. Si tenías un `kr-service/.cache/`, borralo: `rm -rf kr-service/.cache`.

## Pasos

### 1. Producción
En **`kr-service/.env`**:
```diff
- DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
+ DATAFORSEO_BASE_URL=https://api.dataforseo.com
```

### 1.5. Registro durable (`DATABASE_URL_CACHE`) — OBLIGATORIO, esta guía no lo tenía

ADR-14 exige un registro de idempotencia durable para cualquier corrida `live`+producción: sin él,
`npm run spike` aborta antes de gastar (ver `registroDurable()` en `kr-service/src/cli/spike.ts`).

1. En Supabase → SQL Editor: `alter role amg_cache with password '...';` (password propia, distinta
   de `amg_api`).
2. Agregá a `docs/private/credenciales.env`, usando el **transaction pooler (puerto 6543)** — el
   session pooler (5432) puede rechazar la primera conexión de un rol recién usado con
   `password authentication failed` aunque la password sea correcta (Supavisor, no la credencial):
   ```text
   DATABASE_URL_CACHE=postgresql://amg_cache.<project-ref>:<password>@aws-1-eu-west-2.pooler.supabase.com:6543/postgres
   ```
3. `npm run env:sync`.

### 2. Correr con tope de gasto
```bash
cd kr-service
MAX_COST_USD=1.00 npm run spike "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día, cenas para grupos y brunch de fin de semana."
```

> Idealmente usá **un cliente real de la agencia**: es lo que después le mostrás a Frank. También
> actualizá `web-builder/business-profile.json` con el NAP real de ese cliente ANTES de publicar —
> si no, el sitio queda con el contenido del cliente nuevo pero la marca/NAP del cliente anterior.

Comprobá en el log:
- `[calidad] cobertura volumen XX%` → **mayor a 0**.
- `[cost] total $0.3X · DFS $0.2X` → DFS **no es $0.0000**.
- `✅ Brief válido contra el esquema kr.v0.5`.

### 3. 🔴 VOLVER A SANDBOX
```diff
- DATAFORSEO_BASE_URL=https://api.dataforseo.com
+ DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
```
> Si te olvidás, **cada corrida de desarrollo te cobra**. Es el error más fácil de cometer.

### 4. Aprobar (compuerta humana, ADR-06)
El brief nace en `pending_approval` con todas las páginas en `approved: false`. **Revisá el
informe** (`kr-service/out/informe.md`) y creá la copia aprobada:

```bash
cd kr-service
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync('out/brief.json','utf8'));b.status='approved';b.paginas_propuestas.forEach(p=>p.approved=true);fs.writeFileSync('out/brief.approved.json',JSON.stringify(b,null,2));console.log(b.paginas_propuestas.length,'páginas aprobadas')"
```

> Aprobá **a conciencia**: mirá la sección "⚠️ Sin validar" del informe. Esas páginas no tienen
> demanda demostrable. Si no querés publicarlas, dejalas en `approved: false`.

### 5. Republicar
```bash
cd web-builder

# Dry-run primero (no escribe nada en el space):
WEB_PUBLISH_MODE=storyblok STORYBLOK_DRY_RUN=1 npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json

# Real:
WEB_PUBLISH_MODE=storyblok npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json
```

Vas a ver el aviso de evidencia antes de publicar:
```
⚠️  [evidencia] 5 de 8 página(s) NO tienen datos de mercado que las respalden:
      · /menu-del-dia-italiano-madrid  (menú del día italiano Madrid) · confianza 0.3
```

**La publicación es idempotente**: reescribe las stories existentes, no duplica.

---

## Cómo saber que salió bien

- [ ] `[calidad] cobertura volumen` > 0%.
- [ ] `DFS $` mayor a cero.
- [ ] El informe tiene las dos secciones: **✅ Respaldadas por datos** y **⚠️ Sin validar**.
- [ ] Las páginas ya **no son todas** `landing_local` / `LocalBusiness`.
- [ ] **Volviste a sandbox.** ← no te olvides
- [ ] Storyblok muestra los mismos slugs, sin duplicados.

## Si no querés gastar

La demo actual **funciona y es enseñable**. Solo tené presente que el JSON-LD de varias páginas
declara `LocalBusiness` sin serlo — si Frank o alguien técnico lo audita, es una observación
válida. Por $0.31, yo lo corregiría antes de la presentación.

---

## 6. Servir la web EN VIVO (el paso que faltaba: el renderizador)

Cuando se escribió esta guía, publicar en Storyblok era el final. **Ahora existe el renderizador**
(ADR-19): podés enseñarle a Frank *la web funcionando en un dominio*, no "contenido en un CMS". Es la
diferencia entre una demo técnica y un producto — y no necesita desplegar nada.

### 6.1 — El token de LECTURA de Storyblok (una sola vez)

El renderizador lee por la **Content Delivery API**, que tiene tokens **distintos** del de escritura
(Management) que ya usás para publicar. Es una separación de seguridad a propósito (ADR-19): el
proceso expuesto a internet nunca toca una credencial que pueda *modificar* el space.

1. Storyblok → tu space → **Settings → Access Tokens**.
2. Copiá el token **"Public"** (sirve lo publicado) y, para el Visual Editor, el **"Preview"**.
3. `cp renderer/.env.example renderer/.env` y completá los valores. **`renderer/.env` está
   gitignoreado; las keys no van al chat** — las ponés vos y me decís "listo".

> `STORYBLOK_SPACE_ID` es el mismo de `web-builder/.env`. `DEMO_DOMAIN` puede ser cualquier dominio
> (no hace falta comprarlo): en local se sirve por la cabecera `Host`.

### 6.2 — Levantar la web

```bash
npm run demo -w renderer
```

Lee **tu Storyblok real** (no un mock) y siembra el mapa dominio→space en una base en memoria — cero
credenciales de base de datos. Imprime las URLs de cada página publicada, ya listas para el navegador:

```
  http://localhost:8080/pizzeria-carta?_host=tudominio.es
  ...
```

> **La raíz `/` sirve una home sintetizada.** El research genera landing pages temáticas, no una
> portada; antes la raíz daba 404. Ahora el renderizador, si no hay una story `home` publicada,
> sintetiza un índice (el nombre del negocio + una tarjeta por página). También podés entrar por
> cualquiera de los slugs que imprime — todos llevan la barra de navegación del sitio.

### 6.3 — El Visual Editor (si pusiste el preview token)

El comando imprime una **URL de preview firmada**. Configurala en Storyblok como *Location* del space
(Settings → Visual Editor) y vas a editar en vivo: cada cambio se ve en la página, con el Bridge. **Es
la razón por la que se eligió Storyblok** — y es lo que en la demo separa "les generamos contenido"
de "su equipo edita su web sin depender de nadie".

### Cómo saber que salió bien

- [ ] La página abre en el navegador, con su contenido y su JSON-LD.
- [ ] `?_host=noexiste.es` da **404** (sin fallback a otro cliente).
- [ ] Con el preview token: editás en Storyblok y **se ve en la URL de preview**.

> ⚠️ **Esto es una DEMO local, no un despliegue.** Corre en `localhost` mientras el comando está
> abierto. Ponerlo en un dominio real de cara a Frank es la **etapa 5.3** (hosting sin decidir), y ahí
> entran la CDN y el rate limit del borde que la 10ª review dejó anotados.
