# Multi-vertical de clientes (sub-proyecto 1 de 3)

**Fecha:** 2026-08-26 (revisado el mismo día tras ronda de Codex — ver "Historial de revisión")
**Alcance:** `db/` (nueva columna `clients.vertical`, generalización de la allowlist `app.nap_publico`
a dos parámetros, migración nueva), `web-builder/` (generalización del tipo `MenuItem`/`MenuCategoria`
sin tocar sus claves JSON, contrato de página pública por vertical, nueva receta de piezas), `api/`
(endpoint de catálogo generalizado con política de compatibilidad, alta de cliente exige `vertical`),
`portal/` (tabs por vertical, formulario de alta).
**Origen del pedido:** el usuario quiere poder dar de alta clientes de cualquier rubro, no solo
restauración — este es el primero de tres sub-proyectos independientes; los otros dos (desacoplar
keyword research de creación de webs, y publicar posts a un blog externo ya existente) tienen su
propio spec después.

**Estado:** borrador, corregido tras una ronda de revisión externa (Codex, NECESITA REDISEÑO — 1
crítico + 6 major + 2 minor, los nueve verificados contra el código y aplicados). Pendiente de OK del
usuario antes de pasar a `writing-plans`.

---

## Historial de revisión

**Ronda 1 (Codex, 2026-08-26).** Encontró que el diseño original chocaba con esquema real que no se
había chequeado, y dejaba sin resolver un desacople entre dos mecanismos existentes. Los nueve
hallazgos, verificados contra el código y aplicados en esta versión:

| # | Hallazgo | Verificado contra | Corrección aplicada |
| --- | --- | --- | --- |
| 1 Critical | `clients.tipo` ya existe (CRM: `empresa`/`autonomo`/`particular`), enmascarado al rol `cliente` y editable | `db/migrations/0011_clientes_crm.sql:33`, `db/src/clientes.ts:115-169` | Columna nueva **`clients.vertical`**, sin relación con `tipo` |
| 2 Major | Los nombres de campo propuestos (`nombre`/`descripcion`/`categoria`) no coinciden con lo persistido (`name`/`description`/`category`) | `web-builder/src/types.ts:241-268` | El catálogo genérico **conserva las claves JSON actuales**; se generaliza el tipo, no el dato |
| 3 Major | La página `/menu` está hardcodeada a restauración (título, JSON-LD `Menu`) | `web-builder/src/render/html.ts:134-153`, `renderer/src/app.ts:393` | Contrato explícito de página pública por vertical (ver sección nueva) |
| 4 Major | Dos discriminadores separados y sin relación: `clients.tipo` (propuesto) vs. `brand.plantilla` (real, ya usado por la receta) | `db/migrations/0023:66,251`, `web-builder/src/render/plantilla.ts:123` | `clients.vertical` pasa a ser la **única** fuente; `app.nap_publico` gana un segundo parámetro |
| 5 Major | Cambiar la vertical de un cliente ya publicado podría exponer campos dormidos del otro rubro | consecuencia directa del #1 (columna editable) | **`vertical` es inmutable** después del alta |
| 6 Major | "Tipo determina módulos" sin contrato ejecutable, y el dato de origen estaba enmascarado al rol `cliente` | mismo enmascaramiento del #1; `portal/src/app/app.routes.ts:101,109` rutas estáticas | `vertical` **no** se enmascara (no es nota interna de agencia); y con el catálogo genérico, hoy ningún módulo se oculta entre los dos rubros — ver nota abajo |
| 7 Major | El mecanismo de catálogo no tiene vía de escape para una forma distinta de categoría→ítems | inferencia sobre el alcance del spec original | El spec ahora dice explícitamente que cubre "categoría → ítems" y nada más — un rubro futuro con otra forma necesita su propio mecanismo |
| 8 Minor | `GET`/`PATCH /clients/:id/menu` sin política de renombrado | `api/src/app.ts:428-452` | Política fijada (ver "API") |
| 9 Minor | `app.nap_publico` se describió como `security definer`; no lo es | `db/migrations/0023:66-67` (`language sql immutable`, sin `security definer`) | Corregido en "Riesgos" |

**Corrección de premisa (hallazgo 6):** la decisión original de "tipo de cliente" se apoyaba en un
ejemplo — *"el editor de menú no debería existir para una correduría de seguros"*. Ese ejemplo dejó
de ser cierto cuando, más adelante en el mismo diseño, se decidió el catálogo genérico: seguros SÍ
tiene un catálogo (pólizas), solo cambia la etiqueta y los campos. Hoy, con dos rubros, **ningún
módulo se oculta** — el mecanismo de "módulos condicionados por vertical" queda construido pero sin
un caso vivo que lo ejercite hasta que exista un tercer rubro sin catálogo. Se deja así a propósito:
no se retira el mecanismo (la decisión de que exista sigue en pie), pero el spec ya no promete un tab
oculto que hoy no va a pasar en la práctica.

---

## El problema

Hoy toda la plataforma asume que un cliente es un restaurante. Encontramos, al mapear el código
(ver "Estado actual del código" abajo), que ese supuesto está mezclado con lo genérico en casi todas
las capas: el perfil de negocio, la única plantilla de render, la allowlist de Postgres que decide
qué llega al visitante anónimo, y la ficha del portal. No hay ningún discriminador tipado de "tipo de
cliente" en la base — `clients.industria` es texto libre que ningún código lee para ramificar lógica,
y `clients.tipo` (que sí existe) es una clasificación CRM (forma jurídica/comercial) sin relación con
el rubro del negocio.

El caso concreto elegido para validar el mecanismo es una **correduría de seguros**. Se investigaron
dos sitios reales de clientes existentes (jmmoldes.com, gmsegur.com) para no diseñar sobre supuestos:
los dos muestran un catálogo de pólizas organizado por categoría (Personales/Patrimoniales/
Empresariales en un caso, un segmento especializado + "otros seguros" en el otro) — estructuralmente
igual a categoría → ítems, como el menú — más campos de perfil propios (número de autorización/clave
de corredor, años de trayectoria, afiliación a una red de corredores).

## Estado actual del código (mapeado antes de diseñar)

- `contrato/` **no** define `business_profile` — solo valida el brief de keyword research y es
  genérico de por sí. `BusinessProfile` y `MenuItem` viven en `web-builder/src/types.ts:301-347` y
  `241-269`, mezclados en el mismo objeto plano: campos genéricos (`name`, `address`,
  `opening_hours`, `locations`, `testimonios`) junto a `menu?: MenuItem[]` y
  `menu_categorias?: MenuCategoria[]`. `MenuItem` usa las claves `name`, `description`, `category?`,
  `price?`, `precios?`, `nota?`, `foto?`, `video?`, `alergenos?`, `etiquetas?`, `nutricion?`
  (`types.ts:241-269`) — **no** `nombre`/`descripcion`/`categoria` en español, pese al resto del
  dominio.
- `clients` (`db/migrations/0001_init.sql:86-101`) no tiene columna de vertical. **Sí tiene** una
  columna `tipo` (agregada en `0011_clientes_crm.sql:33`) que es clasificación CRM
  (`empresa`/`autonomo`/`particular`), **enmascarada a `null` para el rol `cliente`**
  (`db/src/clientes.ts:115-126`, `CLIENTE_CRM_MASKED_COLS`) y editable vía `PATCH /clients/:id`
  (`COLUMNAS_EDITABLES:160-163`). `business_profile` es un `jsonb` sin schema por rubro; el menú vive
  en el mismo jsonb, allowlisteado igual que cualquier otro campo por `app.nap_publico(perfil jsonb)`
  — una función **SQL `immutable`, no `security definer`** (`0023_menu_enriquecido.sql:66-67`), usada
  como expresión de la columna generada `business_profile_publico` (`:251`).
- `web-builder/src/render/piezas/index.ts:51-69` tiene un catálogo fijo de 17 piezas; 2 son
  específicas de restauración (`platosDestacados`, `cartaCategorias`). Una "receta" ya existente
  decide qué piezas se usan y en qué orden — pero la elige `brand?.plantilla`
  (`web-builder/src/render/plantilla.ts:123`), un campo **dentro del `business_profile` jsonb**, no
  ninguna columna de `clients`. Hoy solo tiene el valor `"base"`.
- `web-builder/src/render/html.ts:134-153` (`renderMenu`) construye la página `/menu` hardcodeada a
  restauración: título `"Menú · {nombre}"`, descripción `"La carta de {nombre}"`, JSON-LD
  `schemaType: "Menu"` vía `menuLd()`. `renderer/src/app.ts:393` solo la sintetiza cuando
  `slug === SLUG_MENU && perfil?.menu?.length`.
- `portal/src/app/pages/clientes/cliente-ficha.ts:17-23` tiene `TABS_FICHA` fijo (Perfil, Research,
  Reseñas, Ideas, Menú), sin condición por cliente. `portal/src/app/app.routes.ts:101,109` registra
  `menu` y `menu/:index` como rutas hijas estáticas.
- `api/src/app.ts:417-452` tiene `PATCH /clients/:id` (allowlist genérica de columnas editables) y,
  aparte, `GET`/`PATCH /clients/:id/menu` (reemplaza `menu` + `menu_categorias` completos).
- `kr-service/` es genérico (recibe `businessPrompt` como texto libre); el vocabulario de restaurante
  aparece solo en ejemplos del provider mock y en prompts ilustrativos, no en ramas de código.

---

## La decisión

Seis decisiones tomadas con el usuario, en orden:

| Decisión | Elegido | Descartado, y por qué |
| --- | --- | --- |
| Forma de abordar las 3 iniciativas | **Sub-proyectos independientes**, spec y plan propios cada uno, en orden | Un plan combinado de las tres: más difícil de revisar y de entregar valor incremental |
| Prioridad | **Multi-vertical primero** | Desacoplar KR de webs, o publicar a blog externo — quedan para después |
| Alcance de "tipo de cliente" | **Perfil Y módulos disponibles** varían por vertical | Solo el perfil, con todos los clientes viendo las mismas pantallas. Ver la nota de la ronda de revisión: con el catálogo genérico, hoy los dos rubros concretos tienen los mismos módulos — el mecanismo queda construido para cuando haga falta, sin un caso vivo todavía |
| Cuántos rubros ahora | **2 concretos: restauración + correduría de seguros** | Framework genérico sin ningún rubro nuevo real: no prueba nada con datos reales |
| Alcance de la vertical de seguros | **Mecanismo completo + seguros funcional de punta a punta** | Un tipo mínimo/placeholder: más rápido, pero no deja un segundo rubro vendible al cerrar el sub-proyecto |
| Modelo del catálogo (menú vs. pólizas) | **Un catálogo genérico por categorías, reutilizable entre verticales** — descubierto tras investigar jmmoldes.com/gmsegur.com y ver que pólizas-por-categoría tiene la misma forma que menú-por-categoría. Alcance explícito: cubre "categoría → ítems"; una vertical futura con otra forma necesita su propio mecanismo, no una extensión de este | Piezas separadas (menú y pólizas cada una la suya): más rápido ahora, pero el próximo rubro con un catálogo similar necesita su propia pieza de nuevo |

**Campos de perfil específicos de seguros**, sacados de los dos sitios reales: número de
licencia/clave de corredor (Dirección General de Seguros), años de experiencia/trayectoria, red de
corredores a la que está afiliado. El resto del perfil (nombre, direcciones, teléfono, horarios,
marca, bienvenida, destacados, testimonios) ya es genérico y ya soporta multi-sede
(`BusinessProfile.locations`) — seguros lo reusa sin cambios.

---

## Arquitectura

```
db/
  migrations/00XX_...sql    clients.vertical (enum nuevo, sin default, inmutable tras el alta);
                             app.nap_publico gana un segundo parámetro (vertical) — sigue siendo
                             una función SQL immutable, no security definer; business_profile_publico
                             se recalcula referenciando las dos columnas de la misma fila
  src/clientes.ts            alta de cliente exige `vertical`; `vertical` NO entra a
                             COLUMNAS_EDITABLES (inmutable) ni a CLIENTE_CRM_MASKED_COLS (visible a
                             todos los roles, no es nota interna de agencia)

web-builder/
  src/types.ts               `MenuItem`/`MenuCategoria` NO se renombran (decisión revisada al escribir
                              el plan — ver "API" más abajo); los campos de restauración (`video`,
                              `alergenos`, `etiquetas`, `nutricion`) quedan como extensión opcional del
                              mismo tipo, simplemente no poblados por seguros; extensión de perfil por
                              vertical (`perfil.seguros`: `numeroLicencia`, `anosExperiencia`,
                              `redAfiliacion`)
  src/contract.ts             Zod ajustado a la misma partición, sin renombrar claves
  src/render/piezas/          `cartaCategorias` se generaliza para dibujar cualquier catálogo
                              (genérica, y filtra las claves de restauración en el propio render —
                              defensa en profundidad, no solo confiar en la allowlist de Postgres);
                              `cabecera.ts` (el nav) y la pieza de datos de contacto también se
                              generalizan por vertical; receta nueva para `correduria_seguros` con
                              piezas genéricas existentes (hero, bienvenida, catálogo, testimonios,
                              faq, contacto, locales) — sin piezas nuevas más allá del catálogo
                              generalizado. La receta se elige por `clients.vertical`, ya no por
                              `brand.plantilla`
  src/render/html.ts          contrato de página de catálogo por vertical (slug, título, descripción,
                              JSON-LD) — ver sección nueva abajo, en vez del `renderMenu` fijo actual

orchestrator/
  src/workflow.ts             `DestinoPublicacion` gana `vertical`, propagado desde `ClientRow` al
                              construirlo — sin esto `renderStory` no puede elegir receta al publicar

api/
  src/app.ts                  `GET`/`PATCH /clients/:id/menu` y los tipos `MenuItem`/`MenuCategoria`
                              **NO se renombran** (decisión revisada al escribir el plan de
                              implementación: cero beneficio funcional, ~15 archivos de churn sin
                              necesidad — es un contrato interno API↔portal, no algo público). `POST
                              /clients` exige `vertical`. Nuevo: `GET`/`PATCH /clients/:id/seguros`
                              para la extensión de perfil de seguros (ver "Editor de perfil de
                              seguros" más abajo)

portal/
  cliente-ficha.ts            TABS_FICHA con etiqueta dinámica según `vertical` ("Menú" vs. "Pólizas
                              y coberturas") — hoy sin ocultar ningún tab, ver nota de la decisión de
                              arriba
  cliente-menu.ts /
  cliente-menu-detalle.ts     título dinámico; el detalle oculta los controles de restauración
                              (video/alérgenos/etiquetas/nutrición) cuando `vertical !== 'restauracion'`
  cliente-perfil.ts           gana un quinto card (mismo patrón que los 4 cards de CRM que ya
                              existen ahí), visible solo si `vertical = 'correduria_seguros'`, que lee/
                              escribe `GET`/`PATCH /clients/:id/seguros`
```

### Editor de perfil de seguros (agregado tras la ronda de Codex sobre el plan)

No existía ningún mecanismo para editar `business_profile` fuera del menú — `cliente-perfil.ts` son 4
cards de datos CRM, nunca tocan el perfil de negocio. Contrato nuevo, angosto a propósito (solo
`business_profile.seguros`, no un editor genérico de todo el perfil — YAGNI, nada más lo necesita hoy):

- `PgClientes.obtenerPerfilSeguros`/`actualizarPerfilSeguros`: mismo patrón que
  `obtenerMenu`/`actualizarMenu` (`jsonb_build_object('seguros', $1::jsonb)` mergeado con `||`, sin
  tocar el resto de `business_profile`).
- `GET`/`PATCH /clients/:id/seguros` en la API, Zod de `perfilSegurosSchema` (ya definido en
  `web-builder/src/contract.ts`).
- Portal: un quinto card en `cliente-perfil.ts`, visible solo para `vertical = 'correduria_seguros'`.

**Lo que NO cambia:** `contrato/` (ya es genérico, no conoce `business_profile`), `kr-service/` (ya
recibe el negocio como texto libre), las claves JSON del catálogo ya persistidas, los datos de menú
ya existentes (el contenedor se generaliza de nombre, el contenido no se migra ni se reescribe).

---

## Modelo de datos

### `clients.vertical` — nuevo enum, sin default, inmutable

```sql
create type app.vertical_cliente as enum ('restauracion', 'correduria_seguros');
alter table clients add column vertical app.vertical_cliente;
-- backfill explícito para los clientes existentes (todos restaurantes hoy), no inferido:
update clients set vertical = 'restauracion';
alter table clients alter column vertical set not null;
```

Nombre **`vertical`**, deliberadamente distinto de la columna `tipo` ya existente (clasificación CRM
de forma jurídica: `empresa`/`autonomo`/`particular`, `0011_clientes_crm.sql:33`) — son dos conceptos
sin relación y confundirlos fue el hallazgo crítico de la ronda de revisión.

Sin default a propósito — la misma razón que `PIPELINE_MODO`: una vertical que se cae en un valor por
omisión es una decisión sin dueño. **Inmutable tras el alta**: no entra a `COLUMNAS_EDITABLES` de
`actualizarCliente`, así que `PATCH /clients/:id` no puede cambiarla. Es la forma más simple de cerrar
el riesgo de que cambiar la vertical de un cliente ya publicado exponga campos dormidos del otro rubro
a través de la allowlist — no hace falta modelar una transición validada si el cambio no existe.
**No se enmascara** en `CLIENTE_CRM_MASKED_COLS`: a diferencia de `tipo`/`score`/`contacto` (notas
internas de la agencia), `vertical` es un atributo de producto que el propio rol `cliente` necesita
para que el portal calcule qué tabs y campos mostrarle.

Agregar un tercer rubro después es una migración nueva (`alter type ... add value`) + su config de
piezas/campos — coherente con el ritmo de migraciones ya establecido en el proyecto (26 en producción
a la fecha).

### Catálogo genérico (generaliza el TIPO, no el dato)

El tipo TypeScript se renombra (o se alias) de `MenuItem`/`MenuCategoria` a algo neutro, pero **las
claves JSON persistidas no cambian**: `name`, `description`, `category?`, `price?`, `precios?`,
`nota?`, `foto?` son la base compartida por cualquier vertical; `video`, `alergenos`, `etiquetas`,
`nutricion` quedan como extensión que solo puebla y valida un cliente `vertical = 'restauracion'`. Es
la vía real de compatibilidad hacia atrás: cero migración de datos, porque el contenedor cambia de
nombre y el contenido no se toca.

### La allowlist deja de ser una lista fija — y gana un segundo parámetro

`app.nap_publico(perfil jsonb)` pasa a `app.nap_publico(perfil jsonb, vertical app.vertical_cliente)`
— sigue siendo `language sql immutable` (no es, y nunca fue, `security definer`; la frontera real de
seguridad es el grant de columna sobre `business_profile_publico` a `app_render`, que se mantiene).
La expresión de la columna generada pasa a referenciar las dos columnas de la fila:

```sql
business_profile_publico jsonb generated always as
  (app.nap_publico(business_profile, vertical)) stored;
```

Esto cierra el hallazgo de los dos discriminadores separados: hoy la receta de render se elige por
`brand.plantilla` (dentro del jsonb, ver `plantilla.ts:123`) sin relación con ninguna columna — con
este cambio, `vertical` pasa a ser la única fuente tanto para la allowlist como para la receta, y
`web-builder` deja de leer `brand.plantilla` para decidir la receta (puede seguir existiendo para
otros fines de marca, pero no gobierna la estructura de piezas).

Es el punto de mayor riesgo del cambio: es la única función que ya cruzó varias migraciones
(`0014` → `0020` → `0023`) reemplazando su propia definición. La migración tiene que restaurar el
grant de columna a `app_render` y usar `lock_timeout`, siguiendo el patrón de las migraciones
anteriores que tocaron esta misma función. Necesita su propio test por vertical que compare el
**conjunto exacto** de claves públicas (no solo unos pocos campos cruzados) para un perfil que
contiene deliberadamente datos de ambas verticales a la vez — la mutación que debe fallar es quitar
la rama por vertical.

`db/src/sitios.ts` (hoy solo selecciona `business_profile_publico`) suma `vertical` a su select — es
un atributo de producto sin sensibilidad CRM, seguro de exponer al renderizador.

### Contrato de página pública por vertical

`renderMenu`/`SLUG_MENU` están hardcodeados a restauración (título "Menú · …", JSON-LD `schemaType:
"Menu"`). Se generaliza a una función que recibe la vertical y arma:

| | restauración | correduría de seguros |
| --- | --- | --- |
| Slug | `/menu` | `/polizas` |
| Título | `Menú · {nombre}` | `Pólizas y coberturas · {nombre}` |
| Descripción | `La carta de {nombre}` | `Los seguros que ofrece {nombre}` |
| JSON-LD | `schemaType: "Menu"` (`MenuSection`/`MenuItem`) | `schemaType: "ItemList"` |

schema.org no tiene un tipo específico de "catálogo de pólizas"; `ItemList` es el genérico correcto
para una lista de ofertas sin usar `Product`, que implicaría venta directa de un bien.

Los campos de perfil de seguros (número de licencia, años de experiencia, red afiliada) se muestran en
una extensión de la pieza de contacto/datos existente (la misma que hoy imprime teléfono, dirección y
horarios), no en una pieza nueva — consistente con la decisión de no crear piezas más allá del
catálogo.

---

## API

**Decisión revisada al escribir el plan de implementación (2026-08-26):** `GET`/`PATCH
/clients/:id/menu` **NO se renombran**. La versión anterior de este spec proponía `/catalogo`; al
mapear el alcance real del rename (tipos `MenuItem`/`MenuCategoria`, ~15 archivos entre `web-builder`,
`api` y `portal`) contra el beneficio (ninguno funcional — es un contrato interno API↔portal, nadie
fuera de AMG lo ve), se decidió no tocarlo. Es la misma lógica que ya aplica a las claves JSON del
catálogo (ver "Catálogo genérico" más abajo): la generalización es de comportamiento, no de nombres.

`POST /clients` exige `vertical` en el body, sin default — mismo criterio que la columna.

---

## Fuera de alcance de este sub-proyecto

- Desacoplar keyword research de creación de webs — sub-proyecto 2, spec propia.
- Publicar posts a un blog ya existente en otra plataforma — sub-proyecto 3, spec propia.
- Un tercer rubro además de restauración y correduría de seguros.
- Tocar los ejemplos hardcodeados de restaurante en `kr-service/src/llm/mock.ts:10` (no bloquea nada,
  es solo vocabulario ilustrativo del provider mock).
- Un mecanismo de catálogo con una forma distinta de "categoría → ítems" (jerarquías más profundas,
  ítems sin categoría como caso obligatorio) — el mecanismo de este sub-proyecto cubre exactamente la
  forma que muestran los dos rubros actuales, ninguna más.

---

## Riesgos y puntos de mayor incertidumbre

1. **La generalización de `app.nap_publico` a dos parámetros.** Es una función SQL `immutable` (no
   `security definer`) que ya reemplazó su propia definición tres veces; agregarle un segundo
   parámetro y una rama por vertical sin romper el comportamiento actual para restauración, y sin
   dejar un hueco donde un campo quede accesible desde las dos ramas, es el cambio de mayor
   superficie de este sub-proyecto.
2. **Que la receta de render deje de leer `brand.plantilla` y pase a leer `clients.vertical`** es un
   cambio de comportamiento, no solo de datos — hay que confirmar que ningún cliente actual depende
   de un valor de `brand.plantilla` distinto de `"base"` (hoy es el único valor que existe, así que el
   riesgo es bajo, pero se verifica antes de aplicar).
3. **El contrato de página pública de seguros (JSON-LD `ItemList`)** es una propuesta razonable pero
   no validada contra el Rich Results Test de Google como sí lo está `Menu` — se valida al implementar,
   igual que se hizo con el JSON-LD de restauración.

---

## Verificación (una vez escrito el plan de implementación)

- Migración con test de forward-only, de que el backfill deja todo `not null`, y de que el grant de
  columna a `app_render` sobrevive (mismo patrón que ya rompió una migración anterior).
- `app.nap_publico`: un test por vertical que compara el **conjunto exacto** de claves públicas para
  un perfil con datos de ambas verticales a la vez — mutación: quitar la rama por vertical debe
  tumbar exactamente esos tests.
- Un test que confirma que `vertical` no está en `COLUMNAS_EDITABLES` (inmutabilidad impuesta, no
  solo documentada).
- Cliente de restauración existente, manejado en el navegador antes y después del cambio: mismo
  menú, mismo render, cero regresión visual — incluida la verificación de que la receta elegida por
  `vertical` coincide con la que antes elegía `brand.plantilla`.
- Un cliente de correduría de seguros nuevo, de punta a punta: alta con `vertical`, carga de catálogo
  de pólizas, publicación, sitio servido en `/polizas` con JSON-LD `ItemList` — igual que el circuito
  completo que ya se ejercitó para restauración.
