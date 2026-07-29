# Modo oscuro del portal — diseño

> **Estado:** aprobado el 2026-07-30. Es la **pieza B** de cuatro (ver §Contexto).
> **No bloquea ni la bloquea nada:** se puede construir y verificar sin depender de las otras piezas.

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

El portal tiene hoy **130 usos de clases de color** en 4 plantillas (`app.html` y las tres páginas),
de los cuales **67 son la escala de grises y el blanco** (medido, no estimado). Las dos formas de
agregar modo oscuro:

| | Tokens semánticos (elegido) | Variantes `dark:` |
| --- | --- | --- |
| Trabajo inicial | Reemplazar 130 ocurrencias | **Agregar** en las mismas 130 |
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
| `texto-medio` sobre `superficie` | Secundarios |
| `texto-tenue` sobre `superficie`, `fondo` | Metadatos, placeholders |
| `texto-invertido` sobre `accion`, `respaldo` | Botones primarios y "Aprobar" |
| `respaldo` sobre `respaldo-suave` | El badge ✅ |
| `alerta` sobre `alerta-suave` | El badge ⚠️ |
| `error` sobre `error-suave`, `superficie` | Fallos |

**12 pares × 2 temas = 24 aserciones**, todas ≥ **4.5:1** (WCAG AA, texto normal).

### Ya está validado

Los valores de la tabla de tokens **se verificaron ejecutando el cálculo** antes de escribir este
spec. Los 24 pares pasan. Los más ajustados, que son los que hay que cuidar si alguien retoca la
paleta:

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
| Los 24 pares de contraste | `core/contraste.test.ts` | La legibilidad del argumento de venta, impuesta |
| El servicio | `services/tema.test.ts` | Persistencia, la clase en `documentElement`, y **que el listener del sistema no mueva nada si el tema es explícito** |
| Que el script inline y `temaEfectivo` no se separen | `core/tema.test.ts` | Lee `index.html` y afirma que contiene la clave `amg.tema` y la clase `oscuro`. Es un test tosco a propósito: no puede probar que la lógica coincida, pero sí que nadie renombre una de las dos puntas sin ver la otra |

**Verificación por mutación** (disciplina del proyecto): reintroducir el bug y confirmar que cae
*exactamente* su test. Como mínimo, para cada garantía: quitar la condición `auto` del listener, y
bajar un color por debajo de 4.5:1.

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
| `portal/tailwind.config.js` | Los 16 tokens mapeados a `var()` |
| `portal/src/styles.css` | `:root` y `.oscuro` con los dos temas |
| `portal/src/index.html` | El script anti-fogonazo |
| `portal/src/app/core/tema.ts` + `.test.ts` | **Nuevos** |
| `portal/src/app/core/contraste.ts` + `.test.ts` | **Nuevos** |
| `portal/src/app/services/tema.ts` + `.test.ts` | **Nuevos** |
| `portal/src/app/app.html` | La barra siempre visible + el botón |
| `portal/src/app/pages/{login,runs,brief}/*.ts` | Migrar las clases de color a tokens |

Las 130 ocurrencias se reparten así (contadas, no estimadas): `app.html` **10**, `login` **23**,
`runs` **36**, `brief` **61**. `brief` es casi la mitad del trabajo y es donde vive el argumento de
venta — conviene migrarlo último, con el resto ya verificado en el navegador.

---

## Contexto: dónde encaja esta pieza

Sale de la sesión de diseño de **la demo con Frank**. Cuatro piezas:

| # | Pieza | Estado |
| --- | --- | --- |
| **A** | Verificación JWT ES256 + logout que revoca | ✅ Mergeada y desplegada; **falta verificar el login en el navegador** |
| **B** | **Modo oscuro (solo el portal)** — este spec | 🟡 Diseño aprobado |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | ⚪ Sin empezar. **Hereda los tokens de esta pieza** |
| **D** | Research en vivo (desplegar el orquestador) | ⚪ Condicionada a medir cuánto tarda un research |

**B no depende de A ni de C**, y es la razón por la que se hace ahora: se puede construir y verificar
sin que el login esté confirmado.

**Lo que B le deja a C:** el vocabulario de tokens y el test de contraste. El dashboard es la pieza con
más UI nueva del proyecto; que nazca sobre tokens en vez de sobre `dark:` es la diferencia entre
heredar el tema y volver a resolverlo.
