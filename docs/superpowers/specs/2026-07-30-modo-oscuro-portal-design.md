# Modo oscuro del portal — diseño

> **Estado:** aprobado el 2026-07-30 e **implementado el mismo día** en `feat/modo-oscuro-portal`
> (87 tests en el portal, verificado en el navegador). Es la **pieza B** de cuatro (ver §Contexto).
> **No bloquea ni la bloquea nada:** se puede construir y verificar sin depender de las otras piezas.

> ### Lo que se implementó distinto de lo escrito acá
>
> Cinco cosas, todas endureciendo el diseño, ninguna cambiándolo:
>
> 1. **El test del script anti-fogonazo no es "tosco a propósito".** Este spec pedía un test que solo
>    atara los *nombres* (la clave y la clase), asumiendo que la lógica no se podía verificar. Sí se
>    puede: el test **ejecuta el script** en un contexto de `node:vm` y lo compara con `temaEfectivo`
>    en los 20 casos. Se hizo porque el script que este spec traía escrito **ya divergía** — fallaba
>    en 5 de esos 20 (un valor basura en `localStorage` con el sistema en oscuro pintaba claro y
>    después Angular pintaba oscuro: el fogonazo, invertido).
> 2. **Los pares de contraste pasaron de 12 a 17** (§El test de contraste), al recorrer las clases una
>    por una. Entre los cinco nuevos, los dos títulos de la evidencia.
> 3. **El `placeholder` no estaba en la superficie de cambio y tenía que estar.** El preflight de
>    Tailwind le clava `#9ca3af` a todo input: **2.54:1** en claro, por debajo de AA. Este spec ya
>    asignaba `texto-tenue` a "metadatos, placeholders", pero no había dónde cablearlo. Se arregla en
>    `styles.css`, no con `placeholderColor` en la config — esa clave genera utilidades y **no toca el
>    preflight**, que lee `colors.gray.400`.
> 4. **El test anti-color-incrustado descubre las plantillas**, no las lista, y también prohíbe la
>    paleta cruda (`bg-gray-100`). Una lista fija cubría las cuatro pantallas de hoy y dejaba entrar
>    la primera de la pieza C.
> 5. **Hay un test que ata `tailwind.config.js`.** Los valores viven en `styles.css` y los nombres en
>    `TOKENS`, pero la config era un tercer lado suelto: borrar `respaldo` de ahí dejaba
>    `text-respaldo` sin emitir —el título ✅ en gris— con toda la suite en verde.
>
> Y una consecuencia de §Un ajuste de estructura: con la barra siempre visible, el login medía
> viewport + barra y aparecía con scroll. La barra declara `h-11` y el login resta esa altura.

---

## Qué se construye

Modo oscuro en `portal/` (Angular 20 + Tailwind 3), con:

- **`auto` por defecto**, resolviendo contra `prefers-color-scheme` del sistema.
- Un **botón de tres estados** en la cabecera: `auto → claro → oscuro → auto`.
- La elección **persiste** en `localStorage` y manda sobre el sistema hasta volver a `auto`.
- La distinción **✅ respaldada / ⚠️ sin validar** legible en los dos temas, **impuesta por un test**
  de contraste, no por buen gusto.

### Fuera de alcance, a propósito

- **El renderizador (`renderer/`).** La web pública es la marca del restaurante: ahí el tema lo decide
  su diseño, no una preferencia del navegador del visitante. No se toca.
- **Tests de componente (karma).** Sigue siendo deuda conocida del portal; esta pieza no la cambia.
- **Contraste de bordes.** Ver §Lo que el test NO exige.

---

## Por qué tokens semánticos y no variantes `dark:`

El portal tiene hoy **84 usos de clases de color** en 4 plantillas (`app.html` y las tres páginas),
de los cuales **67 son la escala de grises y el blanco**. Las dos formas de agregar modo oscuro:

| | Tokens semánticos (elegido) | Variantes `dark:` |
| --- | --- | --- |
| Trabajo inicial | Reemplazar 84 ocurrencias | **Agregar** en las mismas 84 |
| Un componente nuevo | Hereda el tema **por construcción** | Tiene que acordarse de `dark:` |
| Dónde vive el tema | Un bloque CSS, se lee de un vistazo | Repartido en las plantillas |
| Test de contraste | Lee **una tabla de datos** | Tendría que parsear plantillas |

Las dos razones que deciden, y son de este proyecto:

**La pieza C (el dashboard) viene inmediatamente después** y es mucha UI nueva. Con tokens, C hereda
el modo oscuro sin hacer nada. Con `dark:`, C duplica el trabajo y **puede olvidarse en silencio** —
que es el modo de falla que ya costó dos rondas de revisión en la pieza A.

**Una garantía en la disciplina no es una garantía.** Es la regla del proyecto (CLAUDE.md): la impone
una constraint, un test que la mute, o nada. `dark:` la deja en "acordate".

> **Dato que motiva esto:** `respaldo` y `alerta` **ya están definidos** en `tailwind.config.js` y
> **no se usan en ninguna plantilla** — los templates usan la paleta cruda (`green-700`, `amber-500`).
> Un intento previo de tokens semánticos está ahí, muerto. Esta pieza lo pone a trabajar en vez de
> agregar un tercer vocabulario al lado.

---

## El vocabulario de tokens

Derivado de lo que el portal **usa hoy**, no de un sistema de diseño imaginado. Colapsa ruido: 8 tonos
de gris pasan a 3 de texto + 3 de superficie + 2 de borde.

| Token | Rol | Claro | Oscuro |
| --- | --- | --- | --- |
| `fondo` | Fondo de página | `#f9fafb` | `#0f1419` |
| `superficie` | Tarjetas, cabecera | `#ffffff` | `#171d26` |
| `superficie-2` | Badges neutros, zonas hundidas | `#f3f4f6` | `#222b38` |
| `texto` | Texto principal | `#111827` | `#f3f4f6` |
| `texto-medio` | Secundario | `#374151` | `#d1d5db` |
| `texto-tenue` | Metadatos, placeholders | `#6b7280` | `#9ca3af` |
| `texto-invertido` | Texto **sobre un acento** | `#ffffff` | `#0f1419` |
| `borde` | Separadores | `#e5e7eb` | `#2a3441` |
| `borde-fuerte` | Inputs, foco | `#d1d5db` | `#3d4859` |
| `accion` | Botón primario | `#111827` | `#f3f4f6` |
| `respaldo` | ✅ hay datos de mercado | `#15803d` | `#4ade80` |
| `respaldo-suave` | Fondo del badge ✅ | `#dcfce7` | `#10331d` |
| `alerta` | ⚠️ sin validar | `#b45309` | `#fbbf24` |
| `alerta-suave` | Fondo del badge ⚠️ | `#fef3c7` | `#3d2b06` |
| `error` | Fallos | `#b91c1c` | `#fca5a5` |
| `error-suave` | Fondo de error | `#fee2e2` | `#451a1a` |

**No hay escalas numéricas** (`respaldo-300`, `-500`…). No hacen falta, y cada tono extra es un par
más que verificar.

### Las tres reglas que hacen que la paleta oscura funcione

1. **Las superficies van oscuras pero no negras, y en tres niveles.** `fondo` < `superficie` <
   `superficie-2` en claridad, para que la elevación se siga leyendo. Negro puro aplana todo.
2. **Los acentos se ACLARAN.** `respaldo` pasa de `green-700` a `green-400`. Un verde oscuro sobre
   fondo oscuro no se distingue, y ahí se pierde el argumento de venta.
3. **`texto-invertido` se da vuelta.** Blanco en claro, casi negro en oscuro. Suena raro escrito, pero
   es lo que hace legible un botón de acento claro: fondo `#4ade80` con texto `#0f1419`.

Los pares `-suave` **invierten la relación** entre temas: fondo tenue + texto fuerte en claro; fondo
oscuro saturado + texto claro en oscuro. Tenerlos como par explícito es lo que permite que el test
verifique la pareja; si fueran clases sueltas no habría nada que emparejar.

---

## Arquitectura

Sigue el patrón que el portal ya usa para auth: **lógica pura en `core/`** con tests `node:test`, y un
**servicio Angular delgado** encima que toca el DOM y el almacenamiento.

### `portal/src/app/core/tema.ts` — puro, sin Angular ni DOM

```typescript
export type Tema = 'auto' | 'claro' | 'oscuro';

/** Valida lo que venga de localStorage: un valor inventado no elige el tema. */
export function parseTema(raw: string | null): Tema;      // → 'auto' si no lo reconoce

/** El ciclo del botón. */
export function siguienteTema(t: Tema): Tema;             // auto → claro → oscuro → auto

/** Qué se pinta, resolviendo 'auto' contra el sistema. */
export function temaEfectivo(t: Tema, sistemaPrefiereOscuro: boolean): 'claro' | 'oscuro';
```

`parseTema` espeja lo que ya hace `parseSesion` en `auth-core.ts`, por la misma razón: un
`localStorage` viejo o manipulado no debería fabricar estado.

### `portal/src/app/services/tema.ts` — el servicio

Un signal con el `Tema` elegido, otro derivado con el efectivo. Responsabilidades:

- Leer la preferencia guardada al construirse (con `parseTema`).
- Persistir en `localStorage` bajo `amg.tema`, envuelto en `try/catch` (modo privado).
- Aplicar/quitar la clase `oscuro` en **`document.documentElement`**.
- Escuchar `matchMedia('(prefers-color-scheme: dark)')` y repintar **solo si el tema es `auto`**.

> **La condición del listener no es un detalle.** Si el usuario eligió `claro` u `oscuro` explícito y
> el sistema cambia, el portal **no debe moverse**. Es la clase de cosa que un test fija y un
> comentario no.

`AuthService` ya demostró que un servicio así se puede instanciar bajo `node --import tsx --test` sin
Angular TestBed; `TemaService` se testea igual.

### La clase va en `<html>`, no en un div

Dos razones: el fondo tiene que cubrir el viewport entero incluido el overscroll, y desde
`index.html` se puede setear **antes** de que arranque Angular.

### El script anti-fogonazo (`portal/src/index.html`)

Sin esto, alguien en oscuro ve un **flash blanco en cada carga**, porque Angular aplica la clase
después de bootear. Un script inline, antes del bundle:

```html
<script>
  // Antes de que baje el bundle: sin esto, cada carga en oscuro arranca con un flash blanco.
  // Duplica a propósito la lógica de `temaEfectivo` — es el precio de correr antes que Angular.
  try {
    var t = localStorage.getItem('amg.tema');
    var oscuro = t === 'oscuro' || ((t === 'auto' || !t) &&
      matchMedia('(prefers-color-scheme: dark)').matches);
    if (oscuro) document.documentElement.classList.add('oscuro');
  } catch (e) {}
</script>
```

**Es duplicación deliberada** y hay que dejarla dicha: la lógica vive en `temaEfectivo`, y este script
la repite porque corre antes de que exista el bundle. Si el ciclo o la clave cambian, hay que cambiar
los dos — el plan de implementación debe incluir un test que lo detecte (ver §Testing).

### Tailwind y las variables

`tailwind.config.js` deja de mapear colores fijos y mapea variables:

```javascript
colors: {
  fondo: 'var(--fondo)',
  superficie: 'var(--superficie)',
  // …un token por fila de la tabla
}
```

`portal/src/styles.css` define los dos temas:

```css
:root { --fondo: #f9fafb; /* …claro… */ }
.oscuro { --fondo: #0f1419; /* …oscuro… */ }
```

> **Nota para quien implemente:** Tailwind 3 con `var()` **no soporta el modificador de opacidad**
> (`bg-superficie/50`) salvo que las variables se declaren como canales. El portal no usa opacidad en
> colores hoy, así que se declaran como hex plano; si alguna vez hace falta, se migra a
> `--fondo: 249 250 251` + `rgb(var(--fondo) / <alpha-value>)`. Decidido así por YAGNI.

### Un ajuste de estructura en `app.html`

Hoy la cabecera solo existe si estás autenticado (`app.html:2`), así que en el login no habría dónde
poner el botón — y el login es la primera impresión. La barra se renderiza **siempre**; solo el email
y "Salir" quedan dentro del `@if`.

---

## El test de contraste

`portal/src/app/core/contraste.ts` — función pura, cero dependencias: luminancia relativa de WCAG 2.1
y el ratio entre dos colores (~20 líneas). Al lado, la tabla de pares que **existen** en la UI.

**El test es la autoridad, no el gusto de nadie.** Si un color no llega a 4.5:1, se cambia el color.

| Par (frente sobre fondo) | Dónde vive |
| --- | --- |
| `texto` sobre `fondo`, `superficie`, `superficie-2` | Todo el texto |
| `texto-medio` sobre `superficie`, `superficie-2` | Secundarios, y el badge «Pendiente» |
| `texto-tenue` sobre `superficie`, `fondo` | Metadatos, placeholders |
| `texto-invertido` sobre `accion`, `respaldo` | Botones primarios y "Aprobar" |
| `respaldo` sobre `respaldo-suave`, `fondo` | El badge ✅ y **el título ✅** |
| `alerta` sobre `alerta-suave`, `superficie`, `fondo` | El badge ⚠️, el aviso de edición y **el título ⚠️** |
| `error` sobre `error-suave`, `superficie`, `fondo` | Fallos (en tarjeta y sueltos en la página) |

**17 pares × 2 temas = 34 aserciones**, todas ≥ **4.5:1** (WCAG AA, texto normal).

> **De dónde salen 17 y no 12.** La primera versión listaba 12. Al recorrer las 84 clases una por una
> aparecieron **cinco pares más que la UI ya tiene**: `texto-medio`/`superficie-2` (el badge
> «Pendiente»), `error`/`fondo` (el error de `runs`, que no está en una tarjeta), `alerta`/`superficie`
> (el aviso «editar quita la aprobación»), y —los importantes— **`respaldo`/`fondo` y
> `alerta`/`fondo`: los dos títulos de la evidencia**, que van sobre el fondo de página, no sobre una
> tarjeta. Justamente los que hoy son un hex incrustado. Un par que existe en la UI y no está en esta
> lista es un par que nadie verifica.

Los cinco nuevos pasan con holgura (el más ajustado, `respaldo` sobre `fondo`, da 4.80:1 en claro).
El punto pulsante de «corriendo» (`bg-alerta`, 8×8 px sin texto) **no** entra: no lleva texto, así que
4.5:1 no es su criterio.

### El test lee `styles.css`, no una copia

Los valores **se parsean de `styles.css`** —de los bloques `:root` y `.oscuro`— en vez de vivir en una
tabla TypeScript al lado. Una tabla duplicada puede pasar el test mientras la hoja de estilos que se
despacha dice otra cosa; es la misma trampa de las dos fuentes de verdad que ya hay anotada entre M2 y
M1. El test también afirma que **los dos bloques definen exactamente los mismos 16 nombres**: un token
que falte en `.oscuro` no da error, **hereda el valor claro de `:root`** y se ve mal en silencio.

### Ya está validado

Los valores de la tabla de tokens **se verificaron ejecutando el cálculo** antes de escribir este
spec, y se volvieron a verificar con los 17 pares. **Los 34 pasan.** Los más ajustados, que son los
que hay que cuidar si alguien retoca la paleta:

| Par | Claro | Oscuro |
| --- | --- | --- |
| `alerta` sobre `alerta-suave` | **4.51:1** | 8.13:1 |
| `respaldo` sobre `respaldo-suave` | **4.57:1** | 7.96:1 |
| `texto-tenue` sobre `fondo` | **4.63:1** | 7.29:1 |
| `texto-tenue` sobre `superficie` | **4.83:1** | 6.67:1 |

En claro hay tres pares con menos de 0.15 de margen. **No es un problema, es una advertencia:** el
tema claro es el que está al límite, así que un ajuste "estético" del ámbar o del verde va a tumbar el
test. Eso es exactamente lo que se quiere.

### Lo que el test NO exige, y por qué

**El contraste de los bordes.** Medido: `borde` sobre `superficie` da 1.24:1 (claro) y 1.34:1
(oscuro); `borde-fuerte`, 1.47:1 y 1.83:1. WCAG 1.4.11 pide 3:1 para los límites de un **control**, y
el borde de un input cae ahí — así que esto **no cumple** para los inputs.

Se deja así, y a la vista, por dos razones: es **preexistente** (el portal ya usa `border-gray-300` en
los inputs, esta pieza no lo empeora), y subirlo a 3:1 en el tema claro obliga a un borde visiblemente
pesado que cambiaría el aspecto del portal — una decisión de diseño que no es de esta pieza. Queda
como deuda anotada, no como olvido.

---

## Testing

| Qué | Dónde | Por qué |
| --- | --- | --- |
| `parseTema`, `siguienteTema`, `temaEfectivo` | `core/tema.test.ts` | Contrato puro: el ciclo, el default, y que un valor basura caiga en `auto` |
| Los 17 pares × 2 temas | `core/contraste.test.ts` | La legibilidad del argumento de venta, impuesta. Y que los dos temas definan los mismos 16 tokens |
| El servicio | `services/tema.test.ts` | Persistencia, la clase en `documentElement`, y **que el listener del sistema no mueva nada si el tema es explícito** |
| Que el script inline y `temaEfectivo` no se separen | `core/tema.test.ts` | Lee `index.html` y afirma que contiene la clave `amg.tema` y la clase `oscuro`. Es un test tosco a propósito: no puede probar que la lógica coincida, pero sí que nadie renombre una de las dos puntas sin ver la otra |
| **Que ninguna plantilla incruste un color** | `core/contraste.test.ts` | Lee las 4 plantillas y falla si aparece un `#rrggbb` o un `style="…color…"`. Un color incrustado es un color que el tema **no puede** cambiar, y ya había dos (§Tres cosas). El test de contraste verifica la tabla de tokens; este verifica que la UI **use** la tabla |

**Verificación por mutación** (disciplina del proyecto): reintroducir el bug y confirmar que cae
*exactamente* su test. Como mínimo, para cada garantía: quitar la condición `auto` del listener,
bajar un color por debajo de 4.5:1, y **reponer uno de los dos hex incrustados** en `brief.ts`.

### Lo que ningún test ve, y hay que manejar en el navegador

`CLAUDE.md` lo exige y en la pieza A se cobró dos veces. Concretamente:

1. Las **tres posiciones** del botón, y que el icono comunique en cuál está.
2. Los dos temas en **las tres páginas** (login, runs, brief) — la migración de 130 clases es mecánica
   y el typecheck no la atrapa: un token mal puesto solo se ve mirando.
3. Una **recarga dura en oscuro**, para confirmar que no hay flash blanco.
4. Cambiar el tema del **sistema operativo** con el portal en `auto` y ver que sigue; repetirlo con el
   portal en `claro` explícito y ver que **no** se mueve.

---

## Superficie de cambio

| Archivo | Acción |
| --- | --- |
| `portal/tailwind.config.js` | Los 16 tokens mapeados a `var()`, más `borderColor.DEFAULT` |
| `portal/src/styles.css` | `:root` y `.oscuro` con los dos temas |
| `portal/src/index.html` | El script anti-fogonazo |
| `portal/src/app/core/tema.ts` + `.test.ts` | **Nuevos**. Exportan también `CLAVE_TEMA` y `CLASE_OSCURO`, las dos puntas que el script inline repite |
| `portal/src/app/core/contraste.ts` + `.test.ts` | **Nuevos** |
| `portal/src/app/services/tema.ts` + `.test.ts` | **Nuevos** |
| `portal/src/app/app.html` | La barra siempre visible + el botón |
| `portal/src/app/pages/{login,runs,brief}/*.ts` | Migrar las clases de color a tokens |

Las 84 ocurrencias se reparten así (contadas): `app.html` **7**, `login` **15**, `runs` **25**,
`brief` **37**. `brief` es el **44%** del trabajo y es donde vive el argumento de venta — conviene
migrarlo último, con el resto ya verificado en el navegador.

> **Corrección (2026-07-30).** La primera versión de este spec decía «130 ocurrencias, repartidas
> 10/23/36/61». El total real es **84** (7/15/25/37). La cifra de 67 grises sí estaba medida y coincide
> exacto; el total no lo estaba. Se corrige acá con la medición, y queda anotado en vez de borrado:
> este spec pedía «medido, no estimado» y él mismo tenía un número a ojo.

### Tres cosas que la migración por clases NO alcanza

Contar clases de color encuentra 84 ocurrencias y **se le escapan estas tres**, que son justamente las
que un test de contraste sobre la tabla de tokens tampoco ve, porque no pasan por un token:

| # | Qué | Dónde | Qué pasa en oscuro |
| --- | --- | --- | --- |
| 1 | **Dos hex incrustados en un `style` inline** — los títulos ✅ y ⚠️ | `brief.ts:53` (`color:#15803d`), `brief.ts:66` (`color:#b45309`) | Quedan **congelados en el tema claro**: 3.38:1 y 3.37:1 sobre `superficie` oscura. **No llegan a AA**, y es el argumento de venta |
| 2 | **Dos `border` sin color** | `brief.ts:124` y `:138` (botones «Cancelar» y «Editar») | El preflight de Tailwind pone `#e5e7eb` por defecto → un borde **casi blanco** (13.68:1) sobre superficie oscura |
| 3 | **Clases dentro de strings de TypeScript** | `runs.ts:150-153` (`estadoClase`), `brief.ts:94` (`[class]` ternario) | Funcionan (el scanner de Tailwind lee `.ts`), pero **no están en la plantilla**: quien migre «los templates» las saltea |

Las tres se arreglan así:

1. Los hex pasan a `text-respaldo` y `text-alerta`, y el `style` desaparece.
2. `borderColor.DEFAULT` se mapea a `var(--borde)` en `tailwind.config.js`. Arregla el default del
   preflight de una vez, en lugar de parchar dos botones y esperar que nadie escriba un tercero.
3. Se migran explícitamente, y el plan las nombra por línea.

**Y el punto 1 se convierte en test** (§Testing): un color incrustado en una plantilla es, por
definición, un color que el tema no puede cambiar. Es exactamente el caso de «una garantía en un
comentario»: se impone con un test que lea las cuatro plantillas, o no se impone.

---

## Contexto: dónde encaja esta pieza

Sale de la sesión de diseño de **la demo con Frank**. Cuatro piezas:

| # | Pieza | Estado |
| --- | --- | --- |
| **A** | Verificación JWT ES256 + logout que revoca | ✅ Mergeada, desplegada y **verificada: el login funciona en `bigballs.es`** (2026-07-30) |
| **B** | **Modo oscuro (solo el portal)** — este spec | 🟡 Diseño aprobado |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | ⚪ Sin empezar. **Hereda los tokens de esta pieza** |
| **D** | Research en vivo (desplegar el orquestador) | ⚪ Condicionada a medir cuánto tarda un research |

**B no depende de A ni de C**, y esa independencia es la razón por la que se eligió hacerla ahora: se
podía construir y verificar sin que el login estuviera confirmado. (Para cuando arrancó, el login ya
estaba confirmado — pero la pieza sigue sin depender de A.)

**Lo que B le deja a C:** el vocabulario de tokens y el test de contraste. El dashboard es la pieza con
más UI nueva del proyecto; que nazca sobre tokens en vez de sobre `dark:` es la diferencia entre
heredar el tema y volver a resolverlo.
