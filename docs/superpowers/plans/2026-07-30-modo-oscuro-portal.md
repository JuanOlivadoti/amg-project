# Modo oscuro del portal — plan de implementación

> **Para quien lo ejecute:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos van con casilla (`- [ ]`).

**Objetivo:** que el portal tenga modo oscuro con un botón de tres estados (`auto → claro → oscuro`),
que la elección persista, y que la distinción ✅ respaldada / ⚠️ sin validar siga siendo legible en los
dos temas **porque un test lo impone**, no porque quedó lindo.

**Arquitectura:** tokens semánticos, no variantes `dark:`. Tailwind mapea 16 nombres de rol a
variables CSS; `styles.css` define los dos temas en `:root` y `.oscuro`; la clase `oscuro` vive en
`<html>`. La lógica pura va en `core/tema.ts` (testeada sin DOM) y un servicio delgado encima toca
`localStorage`, `matchMedia` y `documentElement`. Un script inline en `index.html` aplica la clase
antes de que baje el bundle, para que una carga en oscuro no arranque en blanco.

**Stack:** Angular 20 + Tailwind 3 (ya presentes). **Cero dependencias nuevas.** Tests con
`node:test` + `node:assert`.

**Spec:** [`2026-07-30-modo-oscuro-portal-design.md`](../specs/2026-07-30-modo-oscuro-portal-design.md).
Está **aprobado**: no se reabren las decisiones de diseño.

---

---

## Estado de ejecución — CERRADO (2026-07-30)

**Las 6 tareas hechas, cada una con su review limpia** (spec ✅ / calidad aprobada), en la rama
`feat/modo-oscuro-portal`. **Sin mergear a `main`**, a pedido del usuario.

| Tarea | Commit | Tests |
| --- | --- | --- |
| 1 — lógica pura + script anti-fogonazo | `b828bb1` + `beed837` | 66 → 73 |
| 2 — paleta, contraste, Tailwind sobre variables | `712ffe5` + `df7c467` | 73 → 78 |
| 3 — el servicio del tema | `e56c7b6` | 78 → 85 |
| 4 — la barra siempre visible + el botón | `af33219` | 85 |
| 5 — migrar `login` y `runs` | `7d6f498` | 85 |
| 6 — migrar `brief` + test anti-color-incrustado | `cb7da76` | 85 → 86 |
| cierre — hallazgos del review final de rama | `78efb8e` | 86 → **87** |

**Tres veces el plan se equivocó y la ejecución lo corrigió** (está anotado en cada lugar):

- El script anti-fogonazo que este plan traía escrito **divergía** de `temaEfectivo` en 5 de 20 casos.
- La mutación 3 de la Tarea 3 tumba **4** tests, no los 3 predichos.
- El rojo del Paso 2 de la Tarea 6 muestra **un** mensaje de assert, no dos.

**Cuatro defectos que ningún test veía, encontrados manejando la app**: el `☀` como emoji de color,
el `placeholder` a 2.54:1, los 44 px de scroll que introdujo la barra siempre visible, y el área
táctil del botón. Los cuatro, corregidos.

---

## Restricciones globales

Todas las tareas las heredan.

- **El portal está fuera de los workspaces npm, a propósito.** `-w portal` **falla**. Todos los
  comandos se corren **desde `portal/`**.
- `npm test` = `node --import tsx --test "src/**/*.test.ts"`. **Punto de partida: 66 tests, 0 fallos.**
- `npm run typecheck` = `ng build --configuration development`.
- ⚠️ **`npm run typecheck` NO typechequea los tests.** `tsconfig.app.json` excluye `src/**/*.test.ts`,
  y `tsconfig.spec.json` solo incluye `*.spec.ts`. Los `.test.ts` los ejecuta `tsx`, que **borra** los
  tipos sin comprobarlos. O sea: **un error de tipos en un test nuevo no lo caza nada**. No se puede
  decir "typecheck limpio" como si cubriera los tests.
- **Cero dependencias nuevas.** Nada de `npm install`.
- **Ningún test toca la red ni un navegador.** Los globals del navegador (`localStorage`,
  `matchMedia`, `document`) se falsean en el test.
- TypeScript ESM strict + `noUncheckedIndexedAccess`: indexar un array o un `Record` da
  `T | undefined` y **hay que manejarlo** (desestructurar con default, no `!` a ciegas).
- Nombres de dominio **en español** (`tema`, `siguienteTema`, `temaEfectivo`, `parseTema`). Los
  comentarios explican **por qué**, no qué.
- Prettier: `printWidth: 100`, `singleQuote: true`. Los `.html` con el parser `angular`.
- Commits **en español**, y terminan con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Antes de cada commit**, verificar que no se cuele `.env`, `node_modules`, `out/` ni `.cache/`.
- Rama de trabajo: **`feat/modo-oscuro-portal`** (ya creada). **No mergear a `main`**: un push a `main`
  despliega el portal a producción, y el merge va al final, ya verificado en el navegador.

### Los 16 tokens (valores exactos — copiar tal cual)

| Token | Claro | Oscuro |
| --- | --- | --- |
| `fondo` | `#f9fafb` | `#0f1419` |
| `superficie` | `#ffffff` | `#171d26` |
| `superficie-2` | `#f3f4f6` | `#222b38` |
| `texto` | `#111827` | `#f3f4f6` |
| `texto-medio` | `#374151` | `#d1d5db` |
| `texto-tenue` | `#6b7280` | `#9ca3af` |
| `texto-invertido` | `#ffffff` | `#0f1419` |
| `borde` | `#e5e7eb` | `#2a3441` |
| `borde-fuerte` | `#d1d5db` | `#3d4859` |
| `accion` | `#111827` | `#f3f4f6` |
| `respaldo` | `#15803d` | `#4ade80` |
| `respaldo-suave` | `#dcfce7` | `#10331d` |
| `alerta` | `#b45309` | `#fbbf24` |
| `alerta-suave` | `#fef3c7` | `#3d2b06` |
| `error` | `#b91c1c` | `#fca5a5` |
| `error-suave` | `#fee2e2` | `#451a1a` |

**Estos valores están validados por ejecución: los 17 pares × 2 temas pasan WCAG AA (4.5:1).** Cuatro
pares del tema **claro** tienen menos de 0.35 de margen (`alerta`/`alerta-suave` 4.51:1 es el peor).
**No se "ajusta estéticamente" ningún hex**: cualquier retoque del ámbar o del verde tumba el test, que
es exactamente para lo que está.

### El mapeo de clases (la tabla única para las tareas 4, 5 y 6)

Cada tarea de migración usa **esta** tabla. Nada de inventar tokens sobre la marcha.

| Clase de hoy | Pasa a | Nota |
| --- | --- | --- |
| `bg-gray-50` | `bg-fondo` | fondo de página |
| `bg-white` | `bg-superficie` | tarjetas y cabecera |
| `bg-gray-100` | `bg-superficie-2` | badge neutro |
| `text-gray-900` | `text-texto` | |
| `hover:text-gray-900` | `hover:text-texto` | |
| `text-gray-700` | `text-texto-medio` | labels, badge «Pendiente» |
| `text-gray-600` | `text-texto-medio` | |
| `text-gray-500` | `text-texto-tenue` | |
| `text-gray-400` | `text-texto-tenue` | colapsa con el 500 a propósito |
| `text-white` | `text-texto-invertido` | siempre va sobre `accion` o `respaldo` |
| `border-gray-200` | `border-borde` | |
| `border-gray-100` | `border-borde` | |
| `border-gray-300` | `border-borde-fuerte` | inputs |
| `hover:border-gray-400` | `hover:border-borde-fuerte` | |
| `focus:border-gray-900` | `focus:border-accion` | |
| `bg-gray-900` | `bg-accion` | botón primario |
| `hover:bg-gray-800` | `hover:opacity-90` | **no hay token de hover**, y no se inventa uno |
| `bg-green-700` | `bg-respaldo` | botón «Aprobar» |
| `hover:bg-green-800` | `hover:opacity-90` | |
| `bg-green-100` | `bg-respaldo-suave` | |
| `text-green-800` | `text-respaldo` | |
| `bg-amber-100` | `bg-alerta-suave` | |
| `text-amber-800` | `text-alerta` | |
| `text-amber-700` | `text-alerta` | |
| `bg-amber-500` | `bg-alerta` | el punto pulsante de «corriendo» |
| `bg-red-100` | `bg-error-suave` | |
| `text-red-600` | `text-error` | |
| `text-red-800` | `text-error` | |

**`hover:opacity-90` en vez de un token de hover:** el vocabulario del spec tiene 16 tokens y ninguno
es «accion un poco más clara». Agregar `accion-hover` y `respaldo-hover` serían dos tokens más y dos
pares más que verificar, para un efecto de hover. `opacity` funciona igual en los dos temas.

**Dos `class="border"` sin color (en `brief.ts`) NO se tocan.** Es la Tarea 2 la que los arregla, en
`borderColor.DEFAULT`. Si se les pone una clase explícita, el default sigue roto para el próximo
botón que alguien escriba.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
| --- | --- | --- |
| `portal/src/app/core/tema.ts` | **Nuevo.** El tipo `Tema`, el ciclo, el parseo y `temaEfectivo`. Puro: sin Angular ni DOM | 1 |
| `portal/src/app/core/tema.test.ts` | **Nuevo.** El contrato puro + el acoplamiento con `index.html` | 1 |
| `portal/src/index.html` | El script anti-fogonazo | 1 |
| `portal/src/app/core/contraste.ts` | **Nuevo.** Luminancia y ratio de WCAG 2.1, el parseo de `styles.css`, y la lista de pares | 2 |
| `portal/src/app/core/contraste.test.ts` | **Nuevo.** Las 34 aserciones de contraste + los 16 nombres en los dos temas (y, en la T6, que ninguna plantilla incruste un color) | 2, 6 |
| `portal/tailwind.config.js` | Los 16 tokens a `var()` + `borderColor.DEFAULT` | 2 |
| `portal/src/styles.css` | `:root` y `.oscuro`: **la única fuente de verdad de los valores** | 2 |
| `portal/src/app/services/tema.ts` | **Nuevo.** Persistencia, `matchMedia`, la clase en `<html>` | 3 |
| `portal/src/app/services/tema.test.ts` | **Nuevo.** Persistencia, la clase, y que un tema explícito no se mueva | 3 |
| `portal/src/app/app.html` + `app.ts` | La barra siempre visible + el botón de tres estados | 4 |
| `portal/src/app/pages/login/login.ts` | Migrar 15 clases | 5 |
| `portal/src/app/pages/runs/runs.ts` | Migrar 25 clases (**4 viven en un string de TS**) | 5 |
| `portal/src/app/pages/brief/brief.ts` | Migrar 37 clases + los 2 hex incrustados | 6 |

### Un estado intermedio feo, y es esperado

Entre la Tarea 3 y la Tarea 6, alguien con el sistema operativo en oscuro va a ver el portal **a
medias**: la clase `oscuro` ya se aplica, pero las plantillas sin migrar siguen pidiendo grises claros.
**No es un bug**: los tests pasan en cada tarea, y la verificación en el navegador es al final, cuando
las 84 clases ya son tokens. Que no cunda el pánico ni se "arregle" fuera de orden.

---

### Tarea 1: La lógica pura del tema y el script anti-fogonazo

**Archivos:**
- Crear: `portal/src/app/core/tema.ts`
- Crear: `portal/src/app/core/tema.test.ts`
- Modificar: `portal/src/index.html`

**Interfaces:**
- Consume: nada.
- Produce (lo usan las tareas 3 y 4):
  - `type Tema = 'auto' | 'claro' | 'oscuro'`
  - `type TemaEfectivo = 'claro' | 'oscuro'`
  - `const CLAVE_TEMA = 'amg.tema'`
  - `const CLASE_OSCURO = 'oscuro'`
  - `parseTema(raw: string | null): Tema`
  - `siguienteTema(t: Tema): Tema`
  - `temaEfectivo(t: Tema, sistemaPrefiereOscuro: boolean): TemaEfectivo`

- [x] **Paso 1: escribir el test que falla**

Crear `portal/src/app/core/tema.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASE_OSCURO, CLAVE_TEMA, parseTema, siguienteTema, temaEfectivo } from './tema';
import type { Tema } from './tema';

test('parseTema acepta los tres temas', () => {
  for (const t of ['auto', 'claro', 'oscuro'] as Tema[]) {
    assert.equal(parseTema(t), t);
  }
});

test('parseTema cae en auto ante cualquier cosa que no reconozca', () => {
  // Un localStorage viejo o manipulado no debería fabricar estado: espeja a `parseSesion`.
  for (const basura of [null, '', 'azul', 'Oscuro', 'AUTO', '{"tema":"oscuro"}', ' claro']) {
    assert.equal(parseTema(basura), 'auto', `${JSON.stringify(basura)} no debería elegir el tema`);
  }
});

test('siguienteTema cicla auto → claro → oscuro → auto', () => {
  assert.equal(siguienteTema('auto'), 'claro');
  assert.equal(siguienteTema('claro'), 'oscuro');
  assert.equal(siguienteTema('oscuro'), 'auto');
  // Tres toques vuelven al principio: el botón no puede quedar en un estado sin salida.
  let t: Tema = 'auto';
  for (let i = 0; i < 3; i++) t = siguienteTema(t);
  assert.equal(t, 'auto');
});

test('temaEfectivo: en auto sigue al sistema', () => {
  assert.equal(temaEfectivo('auto', true), 'oscuro');
  assert.equal(temaEfectivo('auto', false), 'claro');
});

test('🔴 temaEfectivo: una preferencia explícita MANDA sobre el sistema', () => {
  // La garantía de la pieza: si el usuario eligió, el sistema no lo mueve. Vive acá, en una función
  // pura, y no en el listener del servicio: así se puede probar sin DOM.
  assert.equal(temaEfectivo('claro', true), 'claro', 'el sistema en oscuro no puede pisar "claro"');
  assert.equal(temaEfectivo('claro', false), 'claro');
  assert.equal(temaEfectivo('oscuro', false), 'oscuro', 'el sistema en claro no puede pisar "oscuro"');
  assert.equal(temaEfectivo('oscuro', true), 'oscuro');
});

test('🔴 el script inline de index.html no se separa de tema.ts', () => {
  // Ata los NOMBRES; el test de abajo ata el COMPORTAMIENTO. Los dos hacen falta: este falla si
  // alguien renombra la clave o la clase, aunque la lógica siga siendo equivalente.
  //
  // Se afirma sobre la LLAMADA, no sobre la presencia del string: `'oscuro'` aparece cuatro veces en
  // el script (la variable, la comparación, la clase), así que un `includes(CLASE_OSCURO)` seguía en
  // verde aunque `classList.add` pasara a poner otra clase — el único lugar que importa.
  const html = HTML;
  assert.match(
    html,
    new RegExp(`getItem\\(['"]${CLAVE_TEMA}['"]\\)`),
    `index.html tiene que leer la clave ${CLAVE_TEMA}`,
  );
  assert.match(
    html,
    new RegExp(`classList\\.add\\(['"]${CLASE_OSCURO}['"]\\)`),
    `index.html tiene que aplicar la clase ${CLASE_OSCURO}`,
  );
  assert.ok(
    html.includes('prefers-color-scheme: dark'),
    'index.html tiene que resolver `auto` contra el sistema, como temaEfectivo',
  );
  assert.ok(
    html.indexOf(CLAVE_TEMA) < html.indexOf('<app-root>'),
    'el script tiene que correr ANTES del bundle, o el fogonazo blanco sigue ahí',
  );
});

test('🔴 el script inline decide EXACTAMENTE lo mismo que temaEfectivo, caso por caso', () => {
  // La duplicación es deliberada, pero "deliberada" no es "correcta": se ejecuta el script de verdad
  // y se compara con la función pura en los 20 casos. Es la diferencia entre un comentario que dice
  // que coinciden y una garantía de que coinciden.
  const GUARDADOS = [
    null,
    '',
    'auto',
    'claro',
    'oscuro',
    'azul',
    'Oscuro',
    'AUTO',
    ' claro',
    '{"tema":"oscuro"}',
  ];
  for (const guardado of GUARDADOS) {
    for (const sistemaOscuro of [false, true]) {
      assert.equal(
        correrScriptInline(guardado, sistemaOscuro),
        temaEfectivo(parseTema(guardado), sistemaOscuro) === 'oscuro',
        `divergen para ${JSON.stringify(guardado)} con el sistema en ${
          sistemaOscuro ? 'oscuro' : 'claro'
        }`,
      );
    }
  }
});
```

Y arriba de los tests, el helper que ejecuta el script (más los imports `vm` y `HTML`):

```typescript
import vm from 'node:vm';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/**
 * Corre el script inline de `index.html` de verdad, en un contexto con `localStorage`, `matchMedia` y
 * `document` falsos, y devuelve si le puso la clase a `<html>`.
 *
 * Existe porque el script **duplica** `temaEfectivo` (tiene que correr antes de que exista el bundle)
 * y una duplicación que nadie verifica diverge en silencio.
 */
function correrScriptInline(guardado: string | null, sistemaOscuro: boolean): boolean {
  const m = /<script>([\s\S]*?)<\/script>/.exec(HTML);
  assert.ok(m?.[1], 'no encontré el script inline en index.html');
  const clases = new Set<string>();
  const contexto: Record<string, unknown> = {
    localStorage: { getItem: (k: string) => (k === CLAVE_TEMA ? guardado : null) },
    matchMedia: (consulta: string) => ({ matches: consulta.includes('dark') && sistemaOscuro }),
    document: { documentElement: { classList: { add: (c: string) => clases.add(c) } } },
  };
  vm.runInNewContext(m[1], contexto);
  return clases.has(CLASE_OSCURO);
}
```

- [x] **Paso 2: correr el test y confirmar que falla**

Desde `portal/`:

```bash
npm test
```

Esperado: **FALLA** con `Cannot find module './tema'` (o `ERR_MODULE_NOT_FOUND`).

- [x] **Paso 3: escribir `core/tema.ts`**

```typescript
export type Tema = 'auto' | 'claro' | 'oscuro';
export type TemaEfectivo = 'claro' | 'oscuro';

/**
 * La clave de `localStorage` y la clase que lleva `<html>`.
 *
 * Se exportan porque el script inline de `index.html` **las repite** (tiene que correr antes de que
 * exista el bundle). `tema.test.ts` afirma que las dos puntas siguen nombrando lo mismo.
 */
export const CLAVE_TEMA = 'amg.tema';
export const CLASE_OSCURO = 'oscuro';

const TEMAS: readonly string[] = ['auto', 'claro', 'oscuro'];

/**
 * Valida lo que venga de `localStorage`. Espeja a `parseSesion` de `auth-core.ts`, por la misma razón:
 * un valor viejo o manipulado no debería fabricar estado. Ante la duda, `auto`, que es el default.
 */
export function parseTema(raw: string | null): Tema {
  return raw !== null && TEMAS.includes(raw) ? (raw as Tema) : 'auto';
}

/** El ciclo del botón: auto → claro → oscuro → auto. */
export function siguienteTema(t: Tema): Tema {
  if (t === 'auto') return 'claro';
  if (t === 'claro') return 'oscuro';
  return 'auto';
}

/**
 * Qué se pinta.
 *
 * Acá vive la garantía de que **una preferencia explícita manda sobre el sistema**:
 * `sistemaPrefiereOscuro` solo se mira cuando el tema es `auto`. Que la condición esté en esta función
 * pura —y no en el listener de `matchMedia`— es lo que permite probarla sin DOM, y lo que hace que
 * mutarla tumbe un test en vez de pasar desapercibida.
 */
export function temaEfectivo(t: Tema, sistemaPrefiereOscuro: boolean): TemaEfectivo {
  if (t === 'claro') return 'claro';
  if (t === 'oscuro') return 'oscuro';
  return sistemaPrefiereOscuro ? 'oscuro' : 'claro';
}
```

- [x] **Paso 4: agregar el script anti-fogonazo a `portal/src/index.html`**

Reemplazar el `<head>` completo por:

```html
<head>
  <meta charset="utf-8">
  <title>Portal</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <script>
    // Antes de que baje el bundle: sin esto, cada carga en oscuro arranca con un flash blanco,
    // porque Angular aplica la clase después de bootear.
    //
    // DUPLICA a propósito la lógica de `temaEfectivo` (core/tema.ts) — es el precio de correr antes
    // que Angular. `tema.test.ts` ejecuta este script y lo compara con la función pura caso por caso,
    // así que la duplicación está verificada, no prometida.
    //
    // La condición es "cualquier cosa que no sea 'claro' sigue al sistema", y no "'auto' o vacío":
    // es lo que hace `parseTema`, que manda a `auto` TODO lo que no reconoce. Con la versión ingenua,
    // un valor basura en localStorage + el sistema en oscuro pintaba claro acá y oscuro al bootear
    // Angular — el fogonazo que este script viene a evitar, al revés.
    try {
      var t = localStorage.getItem('amg.tema');
      var oscuro =
        t === 'oscuro' || (t !== 'claro' && matchMedia('(prefers-color-scheme: dark)').matches);
      if (oscuro) document.documentElement.classList.add('oscuro');
    } catch (e) {}
  </script>
</head>
```

- [x] **Paso 5: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: `npm test` en verde, con **7 tests nuevos** (66 → 73), `fail 0`. El typecheck, limpio.
**Anotar el número real que imprime el runner**, no el esperado.

- [x] **Paso 6: verificación por mutación**

Una por una: aplicar la mutación, correr `npm test`, confirmar que cae **exactamente** el test
predicho, revertir.

| # | Mutación | Debe caer |
| --- | --- | --- |
| 1 | En `temaEfectivo`, borrar las dos primeras líneas y dejar solo `return sistemaPrefiereOscuro ? 'oscuro' : 'claro';` | **solo** `🔴 temaEfectivo: una preferencia explícita MANDA sobre el sistema` |
| 2 | En `parseTema`, `return (raw as Tema) ?? 'auto';` (o sea: aceptar cualquier string) | **solo** `parseTema cae en auto ante cualquier cosa que no reconozca` |
| 3 | En `index.html`, cambiar `'amg.tema'` por `'amg.theme'` | **solo** `🔴 el script inline de index.html no se separa de tema.ts` |
| 4 | En `siguienteTema`, `if (t === 'oscuro') return 'oscuro';` | **solo** `siguienteTema cicla auto → claro → oscuro → auto` |
| 5 | En `index.html`, `classList.add('dark')` (dejando la variable y la comparación en `'oscuro'`) | **dos**: `🔴 el script inline de index.html no se separa de tema.ts` **y** `🔴 el script inline decide EXACTAMENTE lo mismo que temaEfectivo` |
| 6 | En `index.html`, volver a la condición ingenua `((t === 'auto' \|\| !t) && matchMedia(…).matches)` | **solo** `🔴 el script inline decide EXACTAMENTE lo mismo que temaEfectivo`, con el mensaje `divergen para "azul" con el sistema en oscuro` |

**Si cae un número distinto de tests, o caen otros, eso ES el hallazgo: reportarlo.** No ajustar la
predicción para que cierre — fue exactamente el defecto que más costó en la pieza A.

- [x] **Paso 7: commit**

```bash
git add src/app/core/tema.ts src/app/core/tema.test.ts src/index.html
git commit -m "El tema como logica pura, y el script que evita el fogonazo blanco

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Tarea 2: La paleta, el test de contraste y Tailwind sobre variables

**Archivos:**
- Crear: `portal/src/app/core/contraste.ts`
- Crear: `portal/src/app/core/contraste.test.ts`
- Modificar: `portal/tailwind.config.js` (los 15 renglones actuales, completos)
- Modificar: `portal/src/styles.css` (hoy son 3 líneas)

**Interfaces:**
- Consume: nada de la Tarea 1.
- Produce: `luminancia(hex)`, `ratio(a, b)`, `parsearTokens(css, selector)`, `TOKENS`, `PARES`,
  `AA_TEXTO_NORMAL`. Y —lo que consumen las tareas 4, 5 y 6— las **clases de Tailwind** `bg-fondo`,
  `text-texto`, `border-borde`, etc.

- [x] **Paso 1: escribir el test que falla**

Crear `portal/src/app/core/contraste.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AA_TEXTO_NORMAL, PARES, TOKENS, luminancia, parsearTokens, ratio } from './contraste';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const TEMAS = [
  ['claro', parsearTokens(css, ':root')],
  ['oscuro', parsearTokens(css, '.oscuro')],
] as const;

test('luminancia y ratio: los extremos conocidos de WCAG', () => {
  assert.equal(luminancia('#ffffff'), 1);
  assert.equal(luminancia('#000000'), 0);
  assert.equal(ratio('#ffffff', '#000000').toFixed(0), '21');
  assert.equal(ratio('#ffffff', '#ffffff'), 1);
  // Simétrico: el orden de los argumentos no cambia el contraste.
  assert.equal(ratio('#15803d', '#ffffff'), ratio('#ffffff', '#15803d'));
});

test('🔴 los dos temas definen exactamente los mismos 16 tokens', () => {
  // Un token que falte en `.oscuro` NO da error: hereda el valor claro de `:root` y se ve mal en
  // silencio. Por eso se afirma la igualdad de los dos juegos de nombres, no solo su presencia.
  for (const [nombre, tokens] of TEMAS) {
    assert.deepEqual(
      Object.keys(tokens).sort(),
      [...TOKENS].sort(),
      `el tema ${nombre} no define los 16 tokens exactos`,
    );
  }
});

test('🔴 los 17 pares de la UI llegan a AA en los dos temas', () => {
  for (const [nombre, tokens] of TEMAS) {
    for (const [frente, fondo] of PARES) {
      const a = tokens[frente];
      const b = tokens[fondo];
      assert.ok(a && b, `faltan valores para ${frente}/${fondo} en el tema ${nombre}`);
      const r = ratio(a, b);
      assert.ok(
        r >= AA_TEXTO_NORMAL,
        `${nombre}: ${frente} sobre ${fondo} da ${r.toFixed(2)}:1, y AA pide ${AA_TEXTO_NORMAL}:1`,
      );
    }
  }
});

test('parsearTokens grita si el selector no está', () => {
  assert.throws(() => parsearTokens(css, '.no-existe'), /no encontré el selector/);
});

test('🔴 parsearTokens no se come una MENCIÓN del selector en un comentario', () => {
  // El fallo silencioso más grave posible de esta suite: si `.oscuro` resuelve al bloque de `:root`,
  // las 34 aserciones comparan el tema claro contra sí mismo y pasan SIEMPRE. Y pasa de verdad —
  // los comentarios de `styles.css` nombran los dos selectores para explicar la especificidad.
  const trampa = `/* .oscuro va en <html>, que también es :root */
:root { --fondo: #ffffff; }
.oscuro { --fondo: #000000; }`;
  assert.equal(parsearTokens(trampa, ':root')['fondo'], '#ffffff');
  assert.equal(
    parsearTokens(trampa, '.oscuro')['fondo'],
    '#000000',
    'se llevó el bloque de :root: el test de contraste quedaría comparando claro contra claro',
  );
});
```

- [x] **Paso 2: correr el test y confirmar que falla**

```bash
npm test
```

Esperado: **FALLA** con `Cannot find module './contraste'`.

- [x] **Paso 3: escribir `core/contraste.ts`**

```typescript
/**
 * Contraste de WCAG 2.1, en veinte líneas y sin dependencias.
 *
 * Por qué existe: la distinción ✅ respaldada / ⚠️ sin validar **es el argumento de venta** del
 * producto, y "se lee bien" no es una garantía si la única prueba es que a alguien le pareció. Con
 * esto, la legibilidad la impone un test, y retocar un color por gusto falla ruidosamente.
 */

/** Los 16 nombres de rol. Si se agrega uno, va acá y a los dos bloques de `styles.css`. */
export const TOKENS: readonly string[] = [
  'fondo',
  'superficie',
  'superficie-2',
  'texto',
  'texto-medio',
  'texto-tenue',
  'texto-invertido',
  'borde',
  'borde-fuerte',
  'accion',
  'respaldo',
  'respaldo-suave',
  'alerta',
  'alerta-suave',
  'error',
  'error-suave',
];

/**
 * `[frente, fondo]` — los pares que **existen en la UI**, uno por uno.
 *
 * `borde` y `borde-fuerte` no están: no llevan texto. Su contraste contra la superficie es de 1.24:1
 * a 1.83:1, por debajo del 3:1 que WCAG 1.4.11 pide para el límite de un control — es **deuda
 * preexistente**, anotada en el spec, no un olvido.
 */
export const PARES: readonly (readonly [string, string])[] = [
  ['texto', 'fondo'],
  ['texto', 'superficie'],
  ['texto', 'superficie-2'],
  ['texto-medio', 'superficie'],
  ['texto-medio', 'superficie-2'], // el badge «Pendiente»
  ['texto-tenue', 'superficie'],
  ['texto-tenue', 'fondo'],
  ['texto-invertido', 'accion'],
  ['texto-invertido', 'respaldo'],
  ['respaldo', 'respaldo-suave'], // el badge ✅
  ['respaldo', 'fondo'], // el TÍTULO ✅, que va sobre el fondo de página
  ['alerta', 'alerta-suave'], // el badge ⚠️
  ['alerta', 'superficie'], // «editar quita la aprobación»
  ['alerta', 'fondo'], // el TÍTULO ⚠️
  ['error', 'error-suave'],
  ['error', 'superficie'],
  ['error', 'fondo'], // el error de `runs`, que no está en una tarjeta
];

/** WCAG AA para texto normal. */
export const AA_TEXTO_NORMAL = 4.5;

/** Luminancia relativa (WCAG 2.1, §relative luminance). */
export function luminancia(hex: string): number {
  const c = normalizar(hex);
  const canales = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = canales.map((x) =>
    x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste entre dos colores. Simétrico: el orden no importa. */
export function ratio(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Extrae los tokens de un bloque de `styles.css`.
 *
 * El test lee los valores **del CSS que se despacha**, no de una copia en TypeScript: una tabla
 * duplicada puede pasar el test mientras la hoja de estilos dice otra cosa. Una sola fuente de verdad.
 */
export function parsearTokens(css: string, selector: string): Record<string, string> {
  const bloque = extraerBloque(css, selector);
  const tokens: Record<string, string> = {};
  for (const m of bloque.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, nombre, valor] = m;
    if (nombre !== undefined && valor !== undefined) tokens[nombre] = valor.trim();
  }
  return tokens;
}

/**
 * Saca los comentarios ANTES de buscar, y exige que el selector esté seguido de `{`.
 *
 * No es paranoia: los comentarios de `styles.css` **mencionan** `:root` y `.oscuro` para explicar la
 * especificidad. Un `indexOf(selector)` encuentra primero la mención, y como el comentario no tiene
 * llaves, se lleva el bloque de la regla SIGUIENTE. Medido: pedirle `.oscuro` devolvía los tokens
 * del tema **claro** — y entonces las 34 aserciones comparaban claro contra claro y pasaban siempre.
 * Un test de contraste que siempre pasa es peor que no tenerlo.
 */
function extraerBloque(css: string, selector: string): string {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escapado}\\s*\\{([^}]*)\\}`).exec(sinComentarios);
  if (!m || m[1] === undefined) throw new Error(`no encontré el selector ${selector} en styles.css`);
  return m[1];
}

function normalizar(hex: string): string {
  const c = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(c)) {
    return c
      .split('')
      .map((d) => d + d)
      .join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c;
  throw new Error(`hex inválido: ${hex}`);
}
```

- [x] **Paso 4: escribir `portal/src/styles.css` completo**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Los tokens del tema: un nombre por ROL, no por color (`superficie`, no `white`). Es la ÚNICA
 * fuente de verdad de los valores — `core/contraste.test.ts` los parsea de acá, no de una copia.
 *
 * `color-scheme` no es decorativo: sin él, el navegador sigue pintando en claro los inputs, el caret
 * y las barras de scroll, sobre un portal oscuro. El login son dos inputs, así que se nota.
 *
 * `.oscuro` va en <html>, que también es :root — las dos reglas tienen la misma especificidad y gana
 * la última, así que `.oscuro` DEBE quedar debajo.
 */
:root {
  color-scheme: light;

  --fondo: #f9fafb;
  --superficie: #ffffff;
  --superficie-2: #f3f4f6;
  --texto: #111827;
  --texto-medio: #374151;
  --texto-tenue: #6b7280;
  --texto-invertido: #ffffff;
  --borde: #e5e7eb;
  --borde-fuerte: #d1d5db;
  --accion: #111827;
  --respaldo: #15803d;
  --respaldo-suave: #dcfce7;
  --alerta: #b45309;
  --alerta-suave: #fef3c7;
  --error: #b91c1c;
  --error-suave: #fee2e2;
}

/*
 * Las tres reglas que hacen que el tema oscuro funcione (ver el spec):
 *  1. Las superficies son oscuras pero NO negras, y en tres niveles, para que la elevación se lea.
 *  2. Los acentos se ACLARAN: un verde 700 sobre fondo oscuro no se distingue, y ahí se pierde el
 *     argumento de venta.
 *  3. `texto-invertido` se da vuelta —casi negro— porque va sobre un acento CLARO.
 */
.oscuro {
  color-scheme: dark;

  --fondo: #0f1419;
  --superficie: #171d26;
  --superficie-2: #222b38;
  --texto: #f3f4f6;
  --texto-medio: #d1d5db;
  --texto-tenue: #9ca3af;
  --texto-invertido: #0f1419;
  --borde: #2a3441;
  --borde-fuerte: #3d4859;
  --accion: #f3f4f6;
  --respaldo: #4ade80;
  --respaldo-suave: #10331d;
  --alerta: #fbbf24;
  --alerta-suave: #3d2b06;
  --error: #fca5a5;
  --error-suave: #451a1a;
}
```

- [x] **Paso 5: escribir `portal/tailwind.config.js` completo**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      // Un token por ROL, resuelto por variable CSS. El tema se cambia en `styles.css` (`:root` y
      // `.oscuro`) y las plantillas no se enteran: por eso la pieza C hereda el modo oscuro por
      // construcción, en vez de tener que acordarse de un `dark:` en cada clase.
      //
      // Hex plano y no canales: Tailwind 3 con `var()` NO soporta el modificador de opacidad
      // (`bg-superficie/50`). El portal no usa opacidad en colores; si alguna vez hace falta, se
      // migra a `--fondo: 249 250 251` + `rgb(var(--fondo) / <alpha-value>)`. YAGNI.
      colors: {
        fondo: 'var(--fondo)',
        superficie: 'var(--superficie)',
        'superficie-2': 'var(--superficie-2)',
        texto: 'var(--texto)',
        'texto-medio': 'var(--texto-medio)',
        'texto-tenue': 'var(--texto-tenue)',
        'texto-invertido': 'var(--texto-invertido)',
        borde: 'var(--borde)',
        'borde-fuerte': 'var(--borde-fuerte)',
        accion: 'var(--accion)',
        respaldo: 'var(--respaldo)',
        'respaldo-suave': 'var(--respaldo-suave)',
        alerta: 'var(--alerta)',
        'alerta-suave': 'var(--alerta-suave)',
        error: 'var(--error)',
        'error-suave': 'var(--error-suave)',
      },
      // El preflight de Tailwind le pone `#e5e7eb` al borde de TODO elemento. Un `class="border"` sin
      // color —hay dos botones así en `brief`— quedaba con un borde casi blanco (13.68:1) sobre la
      // superficie oscura. Se arregla en el default: parchar los dos botones deja roto al próximo.
      borderColor: {
        DEFAULT: 'var(--borde)',
      },
    },
  },
  plugins: [],
};
```

> Ojo: es `extend`, así que `border-gray-300` y compañía **siguen existiendo**. Es a propósito: las
> plantillas todavía no están migradas y tienen que compilar.

- [x] **Paso 6: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: verde, con **5 tests nuevos** (73 → 78), `fail 0`. El typecheck limpio prueba, además, que
Tailwind compila con las variables. **Anotar los números reales.**

- [x] **Paso 7: verificación por mutación**

| # | Mutación | Debe caer |
| --- | --- | --- |
| 1 | En `styles.css`, `:root { --alerta: #a16207 }` (da 4.42:1 sobre `alerta-suave`) | **solo** `🔴 los 17 pares de la UI llegan a AA en los dos temas`, y el mensaje tiene que decir `claro: alerta sobre alerta-suave da 4.42:1` |
| 2 | En `styles.css`, borrar el renglón `--texto-tenue` de `.oscuro` | **dos** tests: `🔴 los dos temas definen exactamente los mismos 16 tokens` **y** `🔴 los 17 pares de la UI llegan a AA en los dos temas` (con `faltan valores para texto-tenue/superficie en el tema oscuro`) |
| 3 | En `extraerBloque`, volver al `indexOf` ingenuo (sin sacar comentarios) | **solo** `🔴 parsearTokens no se come una MENCIÓN del selector en un comentario`. Y ojo con lo que eso significa: los otros tres tests seguirían **verdes** comparando el tema claro contra sí mismo |
| 4 | En `contraste.ts`, `AA_TEXTO_NORMAL = 3` | **ningún** test cae — y eso es correcto: el umbral no tiene test propio. Anotarlo como el límite conocido de esta suite, no "arreglarlo" |

La mutación 1 está elegida para que dé **4.42:1**, apenas por debajo de 4.5: prueba que el umbral es
el que dice ser y no algo flojo. La 2 tumba **dos** tests, no uno: un token ausente rompe el juego de
nombres *y* deja al par sin valor. La 3 es la que justifica que el parser sea más largo de lo que
parece necesario.

- [x] **Paso 8: commit**

```bash
git add src/app/core/contraste.ts src/app/core/contraste.test.ts src/styles.css tailwind.config.js
git commit -m "La paleta de los dos temas, con el contraste impuesto por un test

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Tarea 3: El servicio del tema

**Archivos:**
- Crear: `portal/src/app/services/tema.ts`
- Crear: `portal/src/app/services/tema.test.ts`

**Interfaces:**
- Consume de la Tarea 1: `CLASE_OSCURO`, `CLAVE_TEMA`, `parseTema`, `siguienteTema`, `temaEfectivo`,
  `Tema`, `TemaEfectivo`.
- Produce (lo usa la Tarea 4): `TemaService` con `tema: Signal<Tema>`,
  `efectivo: Signal<TemaEfectivo>` y `alternar(): void`.

**Patrón a copiar:** `portal/src/app/services/auth.ts` y su test. El test **instancia el servicio con
`new TemaService()`**, sin Angular TestBed — ya está probado que funciona bajo
`node --import tsx --test`. Los globals del navegador se falsean **antes** de construirlo.

- [x] **Paso 1: escribir el test que falla**

Crear `portal/src/app/services/tema.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemaService } from './tema';
import { CLASE_OSCURO, CLAVE_TEMA } from '../core/tema';

const CONSULTA = '(prefers-color-scheme: dark)';

/**
 * Lo que se prueba acá NO lo prueba `core/tema.test.ts`: que la preferencia **persista**, que la
 * clase termine en `<html>`, y que un cambio de tema del sistema **no mueva nada** si el usuario
 * eligió claro u oscuro explícito.
 *
 * Sin esto, borrar el `setItem`, quitar el listener o aplicar la clase en el lugar equivocado deja
 * todo en verde.
 */
function crear(opts: { guardado?: string; sistemaOscuro?: boolean; sinAlmacen?: boolean } = {}) {
  const almacen = new Map<string, string>();
  if (opts.guardado !== undefined) almacen.set(CLAVE_TEMA, opts.guardado);
  (globalThis as { localStorage?: unknown }).localStorage = opts.sinAlmacen
    ? {
        // Modo privado: cada acceso tira. El tema tiene que seguir funcionando en memoria.
        getItem: () => {
          throw new Error('sin localStorage');
        },
        setItem: () => {
          throw new Error('sin localStorage');
        },
      }
    : {
        getItem: (k: string) => almacen.get(k) ?? null,
        setItem: (k: string, v: string) => {
          almacen.set(k, v);
        },
      };

  const clases = new Set<string>();
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      classList: {
        toggle: (c: string, encender: boolean) => {
          if (encender) clases.add(c);
          else clases.delete(c);
        },
      },
    },
  };

  const oyentes: ((e: { matches: boolean }) => void)[] = [];
  let prefiereOscuro = opts.sistemaOscuro ?? false;
  (globalThis as { matchMedia?: unknown }).matchMedia = (consulta: string) => {
    assert.equal(consulta, CONSULTA, 'el servicio está consultando otra media query');
    return {
      get matches() {
        return prefiereOscuro;
      },
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        oyentes.push(cb);
      },
    };
  };

  const servicio = new TemaService();
  return {
    servicio,
    almacen,
    oscuroPuesto: () => clases.has(CLASE_OSCURO),
    cambiarSistema: (oscuro: boolean) => {
      prefiereOscuro = oscuro;
      for (const cb of oyentes) cb({ matches: oscuro });
    },
  };
}

test('arranca en auto y sigue al sistema', () => {
  const a = crear({ sistemaOscuro: true });
  assert.equal(a.servicio.tema(), 'auto');
  assert.equal(a.servicio.efectivo(), 'oscuro');
  assert.equal(a.oscuroPuesto(), true, 'la clase tiene que estar puesta desde el arranque');

  const b = crear({ sistemaOscuro: false });
  assert.equal(b.servicio.efectivo(), 'claro');
  assert.equal(b.oscuroPuesto(), false);
});

test('lee la preferencia guardada, y esa manda sobre el sistema', () => {
  const { servicio, oscuroPuesto } = crear({ guardado: 'claro', sistemaOscuro: true });
  assert.equal(servicio.tema(), 'claro');
  assert.equal(servicio.efectivo(), 'claro');
  assert.equal(oscuroPuesto(), false, 'el sistema en oscuro no puede pisar un "claro" explícito');
});

test('un valor basura en localStorage no elige el tema', () => {
  const { servicio } = crear({ guardado: 'azul' });
  assert.equal(servicio.tema(), 'auto');
});

test('🔴 alternar cicla, persiste y repinta', () => {
  const { servicio, almacen, oscuroPuesto } = crear({ sistemaOscuro: false });

  servicio.alternar(); // auto → claro
  assert.equal(servicio.tema(), 'claro');
  assert.equal(almacen.get(CLAVE_TEMA), 'claro', 'sin esto, el tema se pierde al recargar');
  assert.equal(oscuroPuesto(), false);

  servicio.alternar(); // claro → oscuro
  assert.equal(servicio.tema(), 'oscuro');
  assert.equal(almacen.get(CLAVE_TEMA), 'oscuro');
  assert.equal(oscuroPuesto(), true, 'elegir oscuro tiene que poner la clase');

  servicio.alternar(); // oscuro → auto
  assert.equal(servicio.tema(), 'auto');
  assert.equal(almacen.get(CLAVE_TEMA), 'auto');
  assert.equal(oscuroPuesto(), false, 'auto con el sistema en claro vuelve a claro');
});

test('🔴 un cambio de tema del SISTEMA no mueve nada si el tema es explícito', () => {
  const { servicio, cambiarSistema, oscuroPuesto } = crear({ guardado: 'claro' });
  cambiarSistema(true);
  assert.equal(servicio.efectivo(), 'claro', 'el usuario eligió claro: el sistema no decide');
  assert.equal(oscuroPuesto(), false);
});

test('🔴 con el tema en auto, un cambio del sistema SÍ repinta', () => {
  const { servicio, cambiarSistema, oscuroPuesto } = crear({ sistemaOscuro: false });
  assert.equal(oscuroPuesto(), false);
  cambiarSistema(true);
  assert.equal(servicio.efectivo(), 'oscuro');
  assert.equal(oscuroPuesto(), true, 'en auto hay que seguir al sistema, y repintar');
  cambiarSistema(false);
  assert.equal(oscuroPuesto(), false, 'y volver');
});

test('sin localStorage el tema igual funciona, en memoria', () => {
  const { servicio, oscuroPuesto } = crear({ sinAlmacen: true, sistemaOscuro: false });
  assert.equal(servicio.tema(), 'auto', 'un getItem que tira no puede romper el arranque');
  servicio.alternar();
  servicio.alternar();
  assert.equal(servicio.tema(), 'oscuro', 'un setItem que tira no puede romper el ciclo');
  assert.equal(oscuroPuesto(), true);
});
```

- [x] **Paso 2: correr el test y confirmar que falla**

```bash
npm test
```

Esperado: **FALLA** con `Cannot find module './tema'` (el de `services/`).

- [x] **Paso 3: escribir `services/tema.ts`**

```typescript
import { Injectable, computed, signal } from '@angular/core';
import { CLASE_OSCURO, CLAVE_TEMA, parseTema, siguienteTema, temaEfectivo } from '../core/tema';
import type { Tema, TemaEfectivo } from '../core/tema';

const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

/**
 * El tema del portal: qué eligió el usuario, qué se pinta, y la clase en `<html>`.
 *
 * No usa `effect()` a propósito: `effect` exige un contexto de inyección de Angular, y estos tests
 * instancian el servicio con `new TemaService()` bajo `node:test` —el mismo patrón que `AuthService`,
 * que es lo que permite tener tests sin navegador—. La clase se aplica desde los tres únicos lugares
 * donde el tema efectivo puede cambiar: el arranque, el botón, y el cambio del sistema.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly _tema = signal<Tema>('auto');
  private readonly _sistemaPrefiereOscuro = signal(false);

  readonly tema = this._tema.asReadonly();
  readonly efectivo = computed<TemaEfectivo>(() =>
    temaEfectivo(this._tema(), this._sistemaPrefiereOscuro()),
  );

  constructor() {
    this._tema.set(parseTema(this.leerGuardado()));

    const consulta = matchMedia(CONSULTA_OSCURO);
    this._sistemaPrefiereOscuro.set(consulta.matches);
    // El listener actualiza la preferencia del SISTEMA, no el tema elegido. Si el usuario eligió
    // claro u oscuro, `temaEfectivo` ignora este valor y la pantalla no se mueve: la garantía vive
    // en esa función pura, no en un `if` acá.
    consulta.addEventListener('change', (e) => {
      this._sistemaPrefiereOscuro.set(e.matches);
      this.aplicar();
    });

    this.aplicar();
  }

  /** El ciclo del botón: auto → claro → oscuro → auto. Persiste y repinta. */
  alternar(): void {
    this._tema.set(siguienteTema(this._tema()));
    try {
      localStorage.setItem(CLAVE_TEMA, this._tema());
    } catch {
      /* sin localStorage (modo privado): el tema vive en memoria y ya */
    }
    this.aplicar();
  }

  private leerGuardado(): string | null {
    try {
      return localStorage.getItem(CLAVE_TEMA);
    } catch {
      return null;
    }
  }

  private aplicar(): void {
    document.documentElement.classList.toggle(CLASE_OSCURO, this.efectivo() === 'oscuro');
  }
}
```

- [x] **Paso 4: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: verde, con **7 tests nuevos** (78 → 85), `fail 0`. **Anotar los números reales.**

- [x] **Paso 5: verificación por mutación**

| # | Mutación | Debe caer |
| --- | --- | --- |
| 1 | Borrar el `localStorage.setItem` de `alternar` (dejando el `try/catch` vacío) | **solo** `🔴 alternar cicla, persiste y repinta` |
| 2 | Borrar el bloque `consulta.addEventListener(...)` completo | **solo** `🔴 con el tema en auto, un cambio del sistema SÍ repinta` |
| 3 | En `aplicar`, `toggle(CLASE_OSCURO, this._sistemaPrefiereOscuro())` (o sea: mirar el sistema en vez del tema efectivo) | **cuatro** tests: `lee la preferencia guardada, y esa manda sobre el sistema`, `🔴 alternar cicla, persiste y repinta`, `🔴 un cambio de tema del SISTEMA no mueve nada si el tema es explícito` y `sin localStorage el tema igual funciona, en memoria` |
| 4 | Quitar el `try/catch` de `leerGuardado` | **solo** `sin localStorage el tema igual funciona, en memoria` (el `throw` sale del constructor) |

La mutación 3 es la que importa: es el bug realista —"aplico la clase según lo que dice el sistema"—.

> **Corregido durante la ejecución.** Este plan predecía **tres** tests y son **cuatro**: me olvidé de
> que `sin localStorage el tema igual funciona, en memoria` también llega a un tema explícito
> (`alternar()` dos veces, hasta `oscuro`) con el sistema en claro, así que también afirma la clase. Lo
> reportó el subagente en vez de acomodar la predicción, y lo verifiqué corriendo la mutación: 81 pass,
> 4 fail. Vale como recordatorio de que una predicción de mutación se escribe leyendo **todos** los
> tests, no solo los que hablan del tema.

- [x] **Paso 6: commit**

```bash
git add src/app/services/tema.ts src/app/services/tema.test.ts
git commit -m "El servicio del tema: persiste, escucha al sistema, y no pisa una eleccion explicita

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Tarea 4: La barra siempre visible y el botón de tres estados

**Archivos:**
- Modificar: `portal/src/app/app.html` (14 líneas, completo)
- Modificar: `portal/src/app/app.ts` (agregar el servicio y las etiquetas)

**Interfaces:**
- Consume de la Tarea 3: `TemaService` (`tema()`, `alternar()`).
- Consume de la Tarea 2: las clases `bg-fondo`, `bg-superficie`, `border-borde`, `text-texto`,
  `text-texto-tenue`.

**Por qué la barra cambia de lugar:** hoy la cabecera solo existe si estás autenticado
(`app.html:2`), así que en el login no habría dónde poner el botón — y el login es la primera
impresión. La barra se renderiza **siempre**; el email y "Salir" quedan dentro del `@if`.

- [x] **Paso 1: reescribir `portal/src/app/app.html` completo**

```html
<div class="min-h-screen bg-fondo text-texto">
  <header class="bg-superficie border-b border-borde">
    <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
      <a routerLink="/runs" class="text-sm font-semibold text-texto">AMG OS</a>
      <div class="flex items-center gap-3 text-sm text-texto-tenue">
        @if (auth.autenticado()) {
          <span>{{ auth.email() }}</span>
          <button (click)="salir()" class="text-texto-tenue hover:text-texto">Salir</button>
        }
        <button
          type="button"
          (click)="tema.alternar()"
          [attr.aria-label]="ETIQUETA[tema.tema()]"
          [title]="ETIQUETA[tema.tema()]"
          class="text-base leading-none px-1 text-texto-tenue hover:text-texto"
        >
          {{ ICONO[tema.tema()] }}
        </button>
      </div>
    </div>
  </header>
  <router-outlet />
</div>
```

> `text-texto` en el `<div>` raíz es deliberado: cualquier texto que nadie coloreó hereda el color del
> tema en vez del negro del navegador.

- [x] **Paso 2: modificar `portal/src/app/app.ts`**

Cambiar el `import` de la primera línea y agregar los dos records y el servicio:

```typescript
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './services/auth';
import { TemaService } from './services/tema';
import type { Tema } from './core/tema';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  readonly tema = inject(TemaService);
  private readonly router = inject(Router);

  /**
   * El icono tiene que decir en qué posición está el botón, no qué va a hacer si lo toco: son tres
   * estados, y "auto" no se adivina. El `aria-label` lo dice con palabras, que es lo que lee un
   * lector de pantalla y lo que aparece en el tooltip.
   */
  readonly ICONO: Record<Tema, string> = { auto: '◐', claro: '☀', oscuro: '☾' };
  readonly ETIQUETA: Record<Tema, string> = {
    auto: 'Tema: automático (sigue al sistema). Tocar para pasar a claro',
    claro: 'Tema: claro. Tocar para pasar a oscuro',
    oscuro: 'Tema: oscuro. Tocar para volver a automático',
  };

  constructor() {
    // Si la sesión cae ESTANDO en una pantalla (el refresh falló, el token se revocó), el guard no
    // se entera —no hay navegación—. El effect sí: al quedar sin sesión, al login. En `/login` ya
    // estando deslogueado, navegar es un no-op.
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/login']);
    });
  }

  async salir(): Promise<void> {
    void this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
```

- [x] **Paso 3: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: los dos verdes, **sin tests nuevos** (85, `fail 0`). El typecheck es lo que prueba esta
tarea: compila la plantilla con AOT, así que un token mal escrito en una clase **no** lo caza —
`bg-fnodo` compilaría igual. Por eso la verificación de esta tarea es en el navegador, al final.

> **No hay test de componente**: es deuda conocida del portal (karma), y esta pieza no la cambia.
> Decirlo en el reporte, no taparlo.

- [x] **Paso 4: commit**

```bash
git add src/app/app.html src/app/app.ts
git commit -m "La barra pasa a estar siempre visible, con el boton de tres estados

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Tarea 5: Migrar `login` y `runs` a tokens

**Archivos:**
- Modificar: `portal/src/app/pages/login/login.ts` (15 ocurrencias)
- Modificar: `portal/src/app/pages/runs/runs.ts` (25 ocurrencias, **8 de ellas dentro de un string de
  TypeScript**, no en la plantilla)

**Interfaces:** consume las clases de la Tarea 2. No produce nada nuevo.

Usar **la tabla de mapeo de §Restricciones globales**, sin excepciones ni criterio propio.

- [x] **Paso 1: migrar `login.ts`**

Los reemplazos exactos, en la plantilla (líneas 10-56):

| Línea | Antes | Después |
| --- | --- | --- |
| 10 | `bg-gray-50` | `bg-fondo` |
| 13 | `bg-white` … `border-gray-200` | `bg-superficie` … `border-borde` |
| 16 | `text-gray-900` | `text-texto` |
| 17 | `text-gray-500` | `text-texto-tenue` |
| 21 | `text-gray-700` | `text-texto-medio` |
| 29 | `border-gray-300` … `focus:border-gray-900` | `border-borde-fuerte` … `focus:border-accion` |
| 34 | `text-gray-700` | `text-texto-medio` |
| 42 | `border-gray-300` … `focus:border-gray-900` | `border-borde-fuerte` … `focus:border-accion` |
| 47 | `text-red-600` | `text-error` |
| 53 | `bg-gray-900 text-white` … `hover:bg-gray-800` | `bg-accion text-texto-invertido` … `hover:opacity-90` |

Los dos inputs necesitan además `bg-superficie text-texto`: un `<input>` sin fondo explícito lo pinta
el navegador, y en oscuro queda blanco. Las líneas 29 y 42 quedan así:

```html
            class="mt-1 w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm focus:border-accion focus:outline-none"
```

- [x] **Paso 2: migrar `runs.ts`, la plantilla (líneas 23-86)**

| Línea | Antes | Después |
| --- | --- | --- |
| 25 | `bg-white` … `border-gray-200` | `bg-superficie` … `border-borde` |
| 26 | `text-gray-900` | `text-texto` |
| 33 | `border-gray-300` | `border-borde-fuerte bg-superficie text-texto` |
| 41 | `border-gray-300` | `border-borde-fuerte bg-superficie text-texto` |
| 46 | `bg-gray-900 text-white` … `hover:bg-gray-800` | `bg-accion text-texto-invertido` … `hover:opacity-90` |
| 55 | `text-gray-900` | `text-texto` |
| 58 | `text-gray-500` | `text-texto-tenue` |
| 60 | `text-red-600` | `text-error` |
| 62 | `text-gray-500` | `text-texto-tenue` |
| 69 | `bg-white` … `border-gray-200` … `hover:border-gray-400` | `bg-superficie` … `border-borde` … `hover:border-borde-fuerte` |
| 72 | `text-gray-900` | `text-texto` |
| 77 | `text-gray-500` | `text-texto-tenue` |

- [x] **Paso 3: migrar `estadoClase`, que NO está en la plantilla**

`runs.ts:149-154`. **Es el punto que se saltea quien migra "los templates":** son clases dentro de un
string de TypeScript, que llegan al DOM por `[class]`. El scanner de Tailwind las ve porque `content`
incluye `./src/**/*.ts`.

```typescript
  estadoClase(s: RunStatus): string {
    if (s === 'approved') return 'bg-respaldo-suave text-respaldo';
    if (s === 'failed' || s === 'rejected') return 'bg-error-suave text-error';
    if (s === 'pending_approval') return 'bg-alerta-suave text-alerta';
    return 'bg-superficie-2 text-texto-medio';
  }
```

- [x] **Paso 4: confirmar que no quedó ninguna clase de la paleta cruda**

Desde `portal/`:

```bash
grep -nE '(bg|text|border|ring|divide|placeholder)-(gray|slate|red|orange|amber|yellow|green|emerald|teal|blue|indigo|white|black)(-[0-9]{2,3})?\b' src/app/pages/login/login.ts src/app/pages/runs/runs.ts
```

Esperado: **cero líneas** (grep sale con código 1). Si imprime algo, esa clase se olvidó.

- [x] **Paso 5: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: verde, sin tests nuevos (85, `fail 0`).

- [x] **Paso 6: commit**

```bash
git add src/app/pages/login/login.ts src/app/pages/runs/runs.ts
git commit -m "login y runs pasan a tokens semanticos

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Tarea 6: Migrar `brief`, matar los dos hex incrustados, e imponerlo con un test

**Archivos:**
- Modificar: `portal/src/app/pages/brief/brief.ts` (37 ocurrencias + 2 hex incrustados)
- Modificar: `portal/src/app/core/contraste.test.ts` (agregar el test anti-color-incrustado)

**Interfaces:** consume las clases de la Tarea 2 y `PARES` de `contraste.ts`.

`brief` es el **44%** de la migración y es donde vive el argumento de venta. Va último, con el resto
ya hecho.

- [x] **Paso 1: escribir el test que falla (rojo primero, y hoy ya está rojo)**

Agregar al final de `portal/src/app/core/contraste.test.ts`:

```typescript
/**
 * Un color incrustado en una plantilla es, por definición, un color que el tema **no puede cambiar**.
 * Había dos —los títulos ✅ y ⚠️, justo el argumento de venta— en un `style` inline: en oscuro
 * quedaban congelados en el tema claro, a 3.38:1 y 3.37:1, por debajo de AA.
 *
 * El test de contraste de arriba verifica la TABLA de tokens; este verifica que la UI **use** la
 * tabla. Sin él, la garantía era un comentario.
 */
const PLANTILLAS = [
  '../app.html',
  '../pages/login/login.ts',
  '../pages/runs/runs.ts',
  '../pages/brief/brief.ts',
] as const;

test('🔴 ninguna plantilla incrusta un color: todo pasa por un token', () => {
  const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
  const ESTILO_COLOR = /style="[^"]*color\s*:/g;
  const FUNCION_COLOR = /\b(?:rgb|rgba|hsl|hsla)\(/g;

  for (const ruta of PLANTILLAS) {
    const texto = readFileSync(new URL(ruta, import.meta.url), 'utf8');
    for (const [nombre, patron] of [
      ['un hex', HEX],
      ['un color en un style inline', ESTILO_COLOR],
      ['una función de color', FUNCION_COLOR],
    ] as const) {
      const hallados = [...texto.matchAll(patron)].map((m) => m[0]);
      assert.deepEqual(
        hallados,
        [],
        `${ruta} tiene ${nombre}: ${hallados.join(', ')} — usá un token, o el tema no lo puede cambiar`,
      );
    }
  }
});
```

- [x] **Paso 2: correr el test y confirmar que falla**

```bash
npm test
```

Esperado: **FALLA** el test `🔴 ninguna plantilla incrusta un color`, nombrando
`../pages/brief/brief.ts tiene un hex: #15803d, #b45309`. Los otros tres archivos **no** deben
aparecer (la Tarea 5 ya los dejó limpios).

> **Corregido durante la ejecución.** Este paso decía que se verían **dos** mensajes (el del hex y el
> del `style` inline). Se ve **uno**: `assert.deepEqual` lanza en la primera aserción que falla, así
> que corta antes de llegar al patrón del `style`. No es un defecto del test —los dos patrones siguen
> activos, y el segundo salta apenas se arregla el primero—, pero la predicción estaba mal escrita.

- [x] **Paso 3: matar los dos hex (líneas 53 y 66)**

```html
        <section>
          <h2 class="text-sm font-semibold mb-2 text-respaldo">
            ✅ Respaldadas por datos ({{ respaldadas().length }})
          </h2>
```

```html
        <section>
          <h2 class="text-sm font-semibold mb-2 text-alerta">
            ⚠️ Sin validar ({{ sinValidar().length }})
          </h2>
```

Estos dos títulos son la razón por la que `PARES` incluye `respaldo`/`fondo` y `alerta`/`fondo`: van
sobre el fondo de página, no sobre una tarjeta.

- [x] **Paso 4: migrar las 37 clases de `brief.ts`**

| Línea | Antes | Después |
| --- | --- | --- |
| 19 | `text-gray-500 hover:text-gray-900` | `text-texto-tenue hover:text-texto` |
| 22 | `text-gray-500` | `text-texto-tenue` |
| 24 | `text-red-600` | `text-error` |
| 26 | `bg-white` … `border-gray-200` | `bg-superficie` … `border-borde` |
| 27 | `text-gray-900` | `text-texto` |
| 28 | `text-gray-500` | `text-texto-tenue` |
| 35 | `bg-green-700 text-white` … `hover:bg-green-800` | `bg-respaldo text-texto-invertido` … `hover:opacity-90` |
| 40 | `text-gray-500` | `text-texto-tenue` |
| 46 | `bg-white` … `border-gray-200` … `text-gray-600` | `bg-superficie` … `border-borde` … `text-texto-medio` |
| 47 | `bg-amber-500` | `bg-alerta` |
| 57 | `text-gray-400` | `text-texto-tenue` |
| 69 | `text-gray-500` | `text-texto-tenue` |
| 82 | `bg-white` … `border-gray-200` | `bg-superficie` … `border-borde` |
| 85 | `text-gray-900` | `text-texto` |
| 86 | `text-gray-500` | `text-texto-tenue` |
| 87 | `text-gray-500` | `text-texto-tenue` |
| 94 | `bg-green-100 text-green-800` / `bg-gray-100 text-gray-600` | `bg-respaldo-suave text-respaldo` / `bg-superficie-2 text-texto-medio` |
| 102 | `border-gray-100` | `border-borde` |
| 107 | `border-gray-300` | `border-borde-fuerte bg-superficie text-texto` |
| 113 | `border-gray-300` | `border-borde-fuerte bg-superficie text-texto` |
| 115 | `text-amber-700` | `text-alerta` |
| 120 | `bg-gray-900 text-white` … `hover:bg-gray-800` | `bg-accion text-texto-invertido` … `hover:opacity-90` |
| 133 | `bg-green-700 text-white` … `hover:bg-green-800` | `bg-respaldo text-texto-invertido` … `hover:opacity-90` |

La de la línea 94 está **dentro de un `[class]` con un ternario**, no en el HTML plano:

```html
            [class]="p.approved ? 'bg-respaldo-suave text-respaldo' : 'bg-superficie-2 text-texto-medio'"
```

**Las líneas 124 y 138 (`class="rounded-md border px-3 py-1 text-sm"`, los botones «Cancelar» y
«Editar») NO se tocan.** Su color de borde ahora sale de `borderColor.DEFAULT` = `var(--borde)`, que
puso la Tarea 2. Ponerles una clase explícita dejaría el default roto para el próximo botón.

- [x] **Paso 5: confirmar que no quedó paleta cruda**

```bash
grep -nE '(bg|text|border|ring|divide|placeholder)-(gray|slate|red|orange|amber|yellow|green|emerald|teal|blue|indigo|white|black)(-[0-9]{2,3})?\b' src/app/app.html src/app/pages/login/login.ts src/app/pages/runs/runs.ts src/app/pages/brief/brief.ts
```

Esperado: **cero líneas**, en los cuatro archivos.

- [x] **Paso 6: correr los tests y el typecheck**

```bash
npm test
npm run typecheck
```

Esperado: verde, con **1 test nuevo** (85 → 86), `fail 0`. **Anotar los números reales del runner.**

- [x] **Paso 7: verificación por mutación**

| # | Mutación | Debe caer |
| --- | --- | --- |
| 1 | Reponer `style="color:#15803d"` en el `<h2>` de la línea 53 | **solo** `🔴 ninguna plantilla incrusta un color`, y el mensaje tiene que nombrar `#15803d` |
| 2 | En un `<h2>`, `text-respaldo` → `text-green-700` (una clase cruda, no un hex) | **ningún** test cae. Es el límite conocido de este test: caza colores *incrustados*, no clases de la paleta cruda. Eso lo caza el `grep` del Paso 5, que no es un test. **Anotarlo, no taparlo** |

- [x] **Paso 8: commit**

```bash
git add src/app/pages/brief/brief.ts src/app/core/contraste.test.ts
git commit -m "brief pasa a tokens, y un test prohibe volver a incrustar un color

...

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Lo que ningún test de acá ve: manejar la app en el navegador

**No es opcional** (`CLAUDE.md`), y en la pieza A se cobró dos veces. Con MCP chrome-devtools, sobre
`npm start` desde `portal/`.

Nada de esto lo cubren los 20 tests nuevos: el typecheck compila `bg-fnodo` sin quejarse, y el test de
contraste verifica la tabla, no qué clase quedó en cada elemento.

- [x] **Las tres posiciones del botón**, y que el icono/tooltip digan en cuál está.
- [x] **Los dos temas en las tres páginas** (login, runs, brief). Mirar en particular: los inputs (que
      no queden blancos en oscuro), los badges de estado, los botones «Aprobar» y «Cancelar»/«Editar»
      (el borde), y los dos títulos ✅/⚠️.
- [x] **Una recarga dura (Ctrl+Shift+R) con el tema en oscuro**: no puede haber flash blanco. Es lo
      único que prueba que el script inline de `index.html` está donde tiene que estar.
- [x] **Cambiar el tema del sistema operativo** con el portal en `auto`: tiene que seguirlo. Repetirlo
      con el portal en `claro` explícito: **no se puede mover**.
- [x] La consola, sin errores.

## Al cerrar

- [x] `npm test` y `npm run typecheck` desde `portal/`, **y** `npm test` + `npm run typecheck` desde la
      raíz (los 6 paquetes siguen en 466; esta pieza no los toca, y confirmarlo es gratis).
- [x] Actualizar `docs/proyecto/09-estado-y-roadmap.md` y `11-plan-fase-2.md`: pieza B hecha, y **la
      cifra real de tests del portal** (66 + los que hayan salido), no la estimada.
- [x] Actualizar el spec si algo se implementó distinto de lo escrito, diciendo **qué** y **por qué**.
- [x] Anotar en la deuda conocida: **los `.test.ts` no los typechequea nada** (`tsconfig.app.json` los
      excluye y `tsconfig.spec.json` solo mira `*.spec.ts`).
- [x] Merge de `feat/modo-oscuro-portal` a `main` y push — **recién después** de la verificación en el
      navegador, porque el push despliega el portal a producción.

---

## Autorrevisión de este plan

**Cobertura del spec**, sección por sección:

| Sección del spec | Tarea |
| --- | --- |
| Vocabulario de 16 tokens | 2 (`styles.css`, `tailwind.config.js`, `TOKENS`) |
| `core/tema.ts` (`parseTema`, `siguienteTema`, `temaEfectivo`) | 1 |
| `services/tema.ts` (persistencia, clase, listener condicionado) | 3 |
| La clase en `<html>` | 1 (script) y 3 (servicio) |
| Script anti-fogonazo | 1 |
| Tailwind sobre `var()`, hex plano | 2 |
| `borderColor.DEFAULT` | 2 |
| Barra siempre visible + botón de tres estados | 4 |
| Test de contraste (17 pares × 2) | 2 |
| Test de los mismos 16 tokens en los dos temas | 2 |
| Test de que el parser no confunda una mención en un comentario con la regla | 2 *(no está en el spec: salió de medir el parser antes de escribirlo)* |
| Test de acoplamiento con `index.html` | 1 |
| Test anti-color-incrustado | 6 |
| Migrar las 84 clases (7 + 15 + 25 + 37) | 4, 5, 6 |
| Los 2 hex incrustados | 6 |
| Los 2 `border` sin color | 2 (en el default) |
| Clases dentro de strings de TS | 5 (`estadoClase`) y 6 (el ternario de la línea 94) |
| Verificación por mutación | 1, 2, 3, 6 |
| Verificación en el navegador | §Lo que ningún test ve |

**Fuera de alcance, y sigue afuera:** el renderizador, los tests de componente (karma), y subir el
contraste de los bordes a 3:1.

**Tres cosas que este plan admite que NO puede garantizar**, y que por eso están escritas como
límites en vez de omitidas:

1. **Una clase mal escrita compila igual.** `bg-fnodo` pasa el typecheck y no pinta nada. Lo caza el
   `grep` de los pasos 4/5 (que no es un test) y el navegador. No hay test de componente que lo cierre.
2. **El umbral 4.5 no tiene test propio** (mutación 3 de la Tarea 2): bajarlo a 3 deja todo verde.
3. ~~El script inline y `temaEfectivo` pueden divergir en la lógica.~~ **Cerrado durante la Tarea 1**
   (commit `beed837`): el test ejecuta el script en `node:vm` y compara su decisión con la función
   pura en los 20 casos. Se cerró porque **ya había divergido**: la condición que este plan traía
   escrita fallaba en 5 de esos 20 casos. Quedó como recordatorio de que "duplicación deliberada" no
   quiere decir "duplicación correcta".

**Consistencia de tipos:** `Tema` y `TemaEfectivo` se definen en la Tarea 1 y se consumen con esos
nombres exactos en las tareas 3 y 4. `TemaService` expone `tema`, `efectivo` y `alternar()`, y la
Tarea 4 usa exactamente esos tres. `parsearTokens`, `PARES`, `TOKENS`, `AA_TEXTO_NORMAL`, `luminancia`
y `ratio` se definen y se usan solo dentro de la Tarea 2 (más el test de la Tarea 6, que reusa el
`readFileSync` ya importado en ese archivo).
