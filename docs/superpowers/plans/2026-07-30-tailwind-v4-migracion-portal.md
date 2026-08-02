# Migración de Tailwind v3→v4 en el portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mergear la pieza B (modo oscuro) a `main` y migrar el portal de Tailwind 3.4 a Tailwind 4 (CSS-first), sin romper la garantía de contraste que la pieza B impuso ni cambiar cómo se ve ninguna pantalla.

**Architecture:** Es una migración mecánica de config, no de producto. `tailwind.config.js` desaparece; sus 16 tokens de color pasan a un bloque `@theme inline` dentro de `portal/src/styles.css`, referenciando las mismas variables CSS de `:root`/`.oscuro` que ya existen. El test `contraste.test.ts` que hoy ata la garantía a `tailwind.config.js` se adapta para leer `@theme inline` en su lugar — sigue habiendo una sola fuente de verdad, solo cambia dónde vive.

**Tech Stack:** Angular 20.3, Tailwind CSS v4, `@tailwindcss/postcss`, `node:test`.

## Global Constraints

- El portal **no** está en los `workspaces` del `package.json` raíz — todos los comandos de este plan usan `npm --prefix portal ...`, nunca `npm test`/`npm run typecheck` de la raíz.
- Ningún cambio de este plan puede alterar cómo se ve `login`/`runs`/`brief` — es una migración de tooling, no de diseño. Se verifica visualmente al final.
- `contraste.test.ts` es la garantía real (no un comentario) de que ninguna pantalla incrusta un color fuera del sistema de tokens — no se toca su intención, solo su mecanismo de lectura de Tailwind.
- Mensajes de commit en español, terminan con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (ver `AGENTS.md`).

---

### Task 1: Mergear `feat/modo-oscuro-portal` a `main`

**Files:**
- Ninguno (operación de git).

**Interfaces:**
- Produces: `main` con la pieza B (modo oscuro) integrada — `portal/src/app/core/tema.ts`, `portal/src/app/services/tema.ts`, `portal/src/app/core/contraste.ts`, `portal/src/app/core/contraste.test.ts`, `portal/src/styles.css` con los 16 tokens, `portal/tailwind.config.js` con el mapeo de colores, `portal/src/index.html` con el script anti-fogonazo, y `app.ts`/`app.html`/`login`/`runs`/`brief` ya migrados a tokens.

- [ ] **Step 1: Verificar que la rama está verde**

Run: `git checkout feat/modo-oscuro-portal && npm --prefix portal test && npm --prefix portal run typecheck`
Expected: los 87 tests en verde, typecheck sin errores.

- [ ] **Step 2: Mergear a main**

```bash
git checkout main
git pull origin main
git merge feat/modo-oscuro-portal
```

Expected: merge sin conflictos (la rama viene de `main` sin cambios paralelos en `portal/`).

- [ ] **Step 3: Verificar main post-merge**

Run: `npm --prefix portal test && npm --prefix portal run typecheck`
Expected: mismo resultado verde que en el Step 1.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

### Task 2: Instalar Tailwind v4 y cambiar el plugin de PostCSS

**Files:**
- Modify: `portal/package.json` (dependencia `tailwindcss`, nueva `@tailwindcss/postcss`)
- Modify: `portal/.postcssrc.json`

**Interfaces:**
- Consumes: nada de tareas anteriores más allá del `main` post-merge.
- Produces: el pipeline de build del portal usando el plugin PostCSS de Tailwind v4. No hay cambio visible todavía (Task 3 mueve las directivas).

Estado actual verificado: `portal/.postcssrc.json` tiene `{ "plugins": { "tailwindcss": {}, "autoprefixer": {} } }`; `portal/package.json` tiene `"tailwindcss": "^3.4.19"` en `devDependencies`.

- [ ] **Step 1: Instalar las dependencias de v4**

Run: `npm --prefix portal install -D tailwindcss@^4 @tailwindcss/postcss@^4`
Expected: `portal/package.json` queda con `"tailwindcss": "^4.x.x"` y agrega `"@tailwindcss/postcss": "^4.x.x"` en `devDependencies`; `portal/package-lock.json` se actualiza.

- [ ] **Step 2: Cambiar el plugin de PostCSS**

Editar `portal/.postcssrc.json`:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {},
    "autoprefixer": {}
  }
}
```

- [ ] **Step 3: Confirmar que el build todavía falla de forma esperada**

Run: `npm --prefix portal run typecheck`
Expected: pasa igual (el typecheck de Angular no depende de PostCSS). El build real (`ng build`) puede fallar en este punto porque `styles.css` todavía tiene las directivas v3 — no hace falta correrlo acá, el Task 3 lo deja consistente.

- [ ] **Step 4: Commit**

```bash
git add portal/package.json portal/package-lock.json portal/.postcssrc.json
git commit -m "$(cat <<'EOF'
Portal: instala Tailwind v4 y cambia el plugin de PostCSS

Paso 1 de 2 de la migración v3→v4: el plugin ya es @tailwindcss/postcss.
styles.css todavía tiene la sintaxis v3 (el próximo commit la cambia),
así que el build no está consistente hasta el siguiente paso.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrar `styles.css` a la sintaxis CSS-first de v4 y borrar `tailwind.config.js`

**Files:**
- Modify: `portal/src/styles.css`
- Delete: `portal/tailwind.config.js`

**Interfaces:**
- Consumes: el plugin `@tailwindcss/postcss` del Task 2.
- Produces: las utilidades `bg-fondo`, `text-texto`, etc. generadas desde `@theme inline` en `styles.css`. Los nombres de clase generados **no cambian** (mismo `--color-<token>` → utilidad `<token>`), así que ningún template (`login`, `runs`, `brief`, `app.html`) necesita tocarse.

Estado actual completo de `portal/src/styles.css` (post-merge del Task 1):

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

/*
 * El preflight de Tailwind le clava theme('colors.gray.400') —#9ca3af— al placeholder de todo
 * input. Es un color que el tema NO puede cambiar: en claro da 2.54:1 sobre `superficie`, muy por
 * debajo del 4.5:1 de AA, y en oscuro pasa solo por casualidad (resulta ser el mismo hex que
 * `--texto-tenue` oscuro).
 *
 * Se arregla acá y no con `placeholderColor` en la config: esa clave genera utilidades, no toca el
 * preflight, que lee `colors.gray.400`. Y no se arregla poniéndole una clase a cada input, por lo
 * mismo que `borderColor.DEFAULT`: parchar los cuatro de hoy deja roto al quinto.
 *
 * El spec ya asignaba `texto-tenue` a "metadatos, placeholders"; esto lo cablea.
 */
input::placeholder,
textarea::placeholder {
  color: var(--texto-tenue);
}
```

Y `portal/tailwind.config.js` completo (a borrar):

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
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
    },
    borderColor: {
      DEFAULT: 'var(--borde)',
    },
  },
  plugins: [],
};
```

- [ ] **Step 1: Reescribir `portal/src/styles.css`**

Reemplazar las 3 directivas `@tailwind` por `@import "tailwindcss";`, y agregar el bloque `@theme inline` (los 16 tokens, mismo nombre que las utilidades de hoy) más el bloque de compatibilidad de `border-color` (Tailwind v4 no trae el default de v3; se repone explícito, mismo motivo que el comentario original: `class="border"` sin color no puede quedar en un gris que el tema no controla). El resto del archivo (`:root`, `.oscuro`, el fix de `placeholder`) **no cambia una sola línea** — es literalmente el mismo bloque de arriba, sin tocar.

```css
@import "tailwindcss";

@theme inline {
  --color-fondo: var(--fondo);
  --color-superficie: var(--superficie);
  --color-superficie-2: var(--superficie-2);
  --color-texto: var(--texto);
  --color-texto-medio: var(--texto-medio);
  --color-texto-tenue: var(--texto-tenue);
  --color-texto-invertido: var(--texto-invertido);
  --color-borde: var(--borde);
  --color-borde-fuerte: var(--borde-fuerte);
  --color-accion: var(--accion);
  --color-respaldo: var(--respaldo);
  --color-respaldo-suave: var(--respaldo-suave);
  --color-alerta: var(--alerta);
  --color-alerta-suave: var(--alerta-suave);
  --color-error: var(--error);
  --color-error-suave: var(--error-suave);
}

/*
 * Tailwind v3 ponía --borde como default de `class="border"` vía `borderColor.DEFAULT` en
 * tailwind.config.js. v4 no tiene ese archivo: se repone acá, mismo motivo que antes — sin esto,
 * un `border` sin color explícito cae en el default del navegador, que el tema no puede cambiar.
 */
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--borde);
  }
}

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

input::placeholder,
textarea::placeholder {
  color: var(--texto-tenue);
}
```

- [ ] **Step 2: Borrar `tailwind.config.js`**

```bash
git rm portal/tailwind.config.js
```

- [ ] **Step 3: Confirmar que el build genera las utilidades**

Run: `npm --prefix portal run build`
Expected: build exitoso. Buscar en el CSS generado (`portal/dist/**/*.css` o el output que indique la consola) que exista una regla `.bg-superficie` (o el nombre que Tailwind v4 emita para la clase) — confirma que `@theme inline` está generando las utilidades esperadas.

- [ ] **Step 4: Commit**

```bash
git add portal/src/styles.css
git rm portal/tailwind.config.js
git commit -m "$(cat <<'EOF'
Portal: styles.css pasa a la sintaxis CSS-first de Tailwind v4

Paso 2 de 2: @tailwind base/components/utilities → @import "tailwindcss",
los 16 tokens de color pasan de tailwind.config.js a un bloque @theme
inline en el mismo styles.css (mismo nombre de utilidad, :root/.oscuro
sin cambios). tailwind.config.js se borra — el próximo commit adapta
contraste.test.ts, que todavía lo referencia.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

**Nota:** este commit deja `contraste.test.ts` roto a propósito (el `require('../../../tailwind.config.js')` va a tirar "Cannot find module"). El Task 4 lo arregla en el commit siguiente — se separan porque son dos cambios verificables por separado (config vs. test), no porque main deba quedar roto: si este plan se ejecuta con `executing-plans`/`subagent-driven-development`, los Tasks 3 y 4 se hacen en la misma sesión sin pausa entre medio.

---

### Task 4: Adaptar `contraste.test.ts` para leer `@theme inline` en vez de `tailwind.config.js`

**Files:**
- Modify: `portal/src/app/core/contraste.test.ts:1-32` (imports y el test `'🔴 tailwind.config.js expone exactamente los mismos 16 tokens'`)

**Interfaces:**
- Consumes: `parsearTokens(css, selector)` de `portal/src/app/core/contraste.ts` (ya existe, sin cambios — genérica: extrae pares `--nombre: valor;` de cualquier bloque `selector { ... }`).
- Produces: la misma garantía de antes (el triángulo `TOKENS` ↔ `styles.css` no se separa), reubicada.

Estado actual (líneas 1-32 de `contraste.test.ts`, ver Task 3 del spec para el resto del archivo que no cambia):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AA_TEXTO_NORMAL, PARES, TOKENS, luminancia, parsearTokens, ratio } from './contraste';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const TEMAS = [
  ['claro', parsearTokens(css, ':root')],
  ['oscuro', parsearTokens(css, '.oscuro')],
] as const;
```

Y el test a reemplazar:

```ts
test('🔴 tailwind.config.js expone exactamente los mismos 16 tokens', () => {
  // El triángulo tiene tres lados: `TOKENS`, `styles.css` y la config de Tailwind. El test de abajo
  // ata los dos primeros; sin este, el tercero queda suelto — y borrar `respaldo` de la config deja
  // `text-respaldo` sin emitir, o sea el título "✅ Respaldadas por datos" en gris, con la suite en
  // verde y el typecheck limpio (`ng build` nunca falla por una clase de Tailwind inexistente).
  // `createRequire` porque `tailwind.config.js` es CommonJS (`module.exports`) y este test es ESM.
  const cargar = createRequire(import.meta.url);
  const config = cargar('../../../tailwind.config.js') as {
    theme: { extend: { colors: Record<string, string> } };
  };
  assert.deepEqual(
    Object.keys(config.theme.extend.colors).sort(),
    [...TOKENS].sort(),
    'la paleta de tailwind.config.js y TOKENS se separaron',
  );
});
```

- [ ] **Step 1: Quitar el import de `createRequire` (queda sin uso tras el Step 2)**

En `portal/src/app/core/contraste.test.ts:4`, quitar la línea `import { createRequire } from 'node:module';`.

- [ ] **Step 2: Reemplazar el test**

Reemplazar el test completo `'🔴 tailwind.config.js expone exactamente los mismos 16 tokens'` por:

```ts
test('🔴 @theme inline expone exactamente los mismos 16 tokens', () => {
  // El triángulo tiene tres lados: `TOKENS`, `styles.css` (:root/.oscuro) y el bloque `@theme
  // inline` que Tailwind v4 usa para emitir las utilidades (bg-fondo, text-texto, etc). El test de
  // abajo ata los dos primeros; sin este, el tercero queda suelto — y borrar `--color-respaldo` de
  // @theme inline deja `text-respaldo` sin emitir, con la suite en verde y el typecheck limpio.
  const tema = parsearTokens(css, '@theme inline');
  const nombres = Object.keys(tema)
    .filter((n) => n.startsWith('color-'))
    .map((n) => n.slice('color-'.length));
  assert.deepEqual(
    nombres.sort(),
    [...TOKENS].sort(),
    'el bloque @theme inline de styles.css y TOKENS se separaron',
  );
});
```

- [ ] **Step 3: Correr la suite y confirmar que pasa**

Run: `npm --prefix portal test`
Expected: todos los tests de `contraste.test.ts` en verde, incluido el nuevo. Los otros tests del archivo (`'🔴 los dos temas definen exactamente los mismos 16 tokens'`, `'🔴 los 17 pares de la UI llegan a AA en los dos temas'`, `'🔴 ninguna plantilla incrusta un color: todo pasa por un token'`) no se tocan y deben seguir en verde sin cambios — siguen parseando `:root`/`.oscuro`, que no cambiaron.

- [ ] **Step 4: Verificación por mutación — confirmar que el test nuevo realmente ata algo**

Editar temporalmente `portal/src/styles.css`: borrar la línea `--color-respaldo: var(--respaldo);` del bloque `@theme inline`.
Run: `npm --prefix portal test`
Expected: FALLA el test `'🔴 @theme inline expone exactamente los mismos 16 tokens'` con el mensaje "el bloque @theme inline de styles.css y TOKENS se separaron".
Revertir el borrado (`git checkout portal/src/styles.css`) y volver a correr `npm --prefix portal test` para confirmar que vuelve a verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/core/contraste.test.ts
git commit -m "$(cat <<'EOF'
Portal: contraste.test.ts lee @theme inline en vez de tailwind.config.js

tailwind.config.js ya no existe (Tailwind v4 es CSS-first). El test que
ataba TOKENS a la config de Tailwind ahora lee el bloque @theme inline
de styles.css con el mismo parsearTokens que ya usaban :root/.oscuro —
la garantía de la pieza B sigue siendo un test, no una promesa.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verificación visual — confirmar cero regresión

**Files:**
- Ninguno (solo verificación).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: confirmación de que la migración es 100% de tooling.

- [ ] **Step 1: Levantar el portal**

Run: `npm --prefix portal start` (o el comando de dev-server que use el proyecto)

- [ ] **Step 2: Verificar en el navegador (chrome-devtools MCP)**

Navegar a `/login`, `/runs` y `/runs/:id` (un brief existente), en los tres estados de tema (claro/oscuro/auto vía el botón de la esquina) y en dos anchos de viewport (desktop y mobile). Confirmar visualmente que **nada cambió** respecto de antes de este plan: mismos colores, mismo layout, mismo comportamiento del toggle de tema.

- [ ] **Step 3: Suite completa**

Run: `npm --prefix portal test && npm --prefix portal run typecheck && npm --prefix portal run build`
Expected: los tres en verde.

- [ ] **Step 4: Push**

```bash
git push origin main
```

## Self-Review

- **Cobertura del spec:** cubre íntegramente la sección "Migración de Tailwind: v3.4 → v4 (etapa separada)" del spec — los 7 pasos numerados ahí (instalar deps, plugin PostCSS, directivas, `@theme inline`, borrar config, adaptar `contraste.test.ts`, compatibilidad de navegadores) están en las Tasks 2-4. La compatibilidad mínima de navegadores (punto 6 del spec) no requiere una tarea propia: Tailwind v4 exige Safari 16.4+/Chrome 111+/Firefox 128+, y el portal no tiene hoy un target de navegadores más viejo declarado en `angular.json` — no hay nada que migrar ahí.
- **Placeholders:** ninguno — cada Step tiene comando o código completo.
- **Consistencia de tipos/nombres:** `parsearTokens`, `TOKENS`, `PARES`, `AA_TEXTO_NORMAL` se usan con la misma firma que ya existe en `contraste.ts` (no se modifica ese archivo, solo el test).
