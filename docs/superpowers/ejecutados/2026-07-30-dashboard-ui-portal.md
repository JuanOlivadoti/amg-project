# Shell + Dashboard de cartera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El portal gana un shell de layout (sidebar + header) que envuelve todas las rutas autenticadas, y una pantalla nueva "Dashboard de cartera" (`/cartera`) construida con componentes propios (no una librería genérica sin uso) sobre datos de muestra.

**Architecture:** Cada pieza (servicio, componente de shell, función de agregación, componente de página) se construye y se prueba **de forma aislada primero** — no se toca el ruteo hasta el último task. Así cada task deja algo comprobable por sí solo, y recién al final se cablea todo junto, evitando el error de la v1 del spec (un shell a medio enganchar que duplicaba el header). Los colores nunca son literales: todo pasa por los tokens semánticos del portal, verificado por el test `'ninguna plantilla incrusta un color'` que ya existe.

**Tech Stack:** Angular 20.3 (standalone, signals), Tailwind v4 (ya migrado — depende de `docs/superpowers/plans/2026-07-30-tailwind-v4-migracion-portal.md`), `ng-apexcharts`, `node:test`, Karma.

## Global Constraints

- **Requisito previo:** este plan asume `docs/superpowers/plans/2026-07-30-tailwind-v4-migracion-portal.md` ya ejecutado y en `main` (Tailwind v4, `@theme inline`, `contraste.test.ts` adaptado).
- Rama de trabajo: `feat/dashboard-ui-portal` desde `main`.
- `portal` no está en los `workspaces` de la raíz — todos los comandos usan `npm --prefix portal ...`.
- **Sin NgRx, sin Firebase, sin `SafeHtmlPipe`/`bypassSecurityTrustHtml`, sin clases `className` de paso libre.** Íconos son SVG literal en el template, nunca un string bindeado con `[innerHTML]`.
- **Ningún color literal** (`#hex`, `rgb()`, clases `bg-gray-*`/`text-blue-*`/etc de la paleta cruda de Tailwind) en ningún `.ts`/`.html` de `src/app` — lo hace cumplir `portal/src/app/core/contraste.test.ts` (`'🔴 ninguna plantilla incrusta un color'`), que escanea el árbol entero. Los componentes que grafican (`bar-chart`, `line-chart`) leen el color con `getComputedStyle` en tiempo de ejecución — nunca un hex en el código fuente.
- No se portan `tabs/`, `modal/`, `button/`, `badge/`, `avatar/`, `dropdown/`, `pagination/` genéricos: no tienen consumidor real en `/cartera` (ver spec, sección "Estructura de carpetas nueva").
- Convención del portal: templates **inline** en el `.ts` del componente (no `.html` separado), salvo `app.html` que ya existe. Nombres de dominio en español.
- Mensajes de commit en español, terminan con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Instalar `ng-apexcharts` y confirmar compatibilidad con Angular 20.3

**Files:**
- Modify: `portal/package.json`, `portal/package-lock.json`

**Interfaces:**
- Produces: `ng-apexcharts`/`apexcharts` disponibles para los Tasks 10 (charts). Si la instalación falla o `ng build` no compila con la versión instalada, este task se resuelve antes de seguir — es un requisito bloqueante para el resto del plan de charts, no un detalle a resolver después.

- [ ] **Step 1: Crear la rama**

```bash
git checkout main
git pull origin main
git checkout -b feat/dashboard-ui-portal
```

- [ ] **Step 2: Instalar**

Run: `npm --prefix portal install ng-apexcharts apexcharts`
Expected: instala sin error de peer dependencies. Si `npm` reporta un conflicto de peer deps contra Angular 20, revisar la versión instalada de `ng-apexcharts` en `portal/node_modules/ng-apexcharts/package.json` (campo `peerDependencies`) — si no soporta Angular 20 todavía, evaluar instalar con `--legacy-peer-deps` (documentando por qué en el commit) o fijar una versión específica que sí lo soporte.

- [ ] **Step 3: Smoke test de compilación**

Run: `npm --prefix portal run typecheck`
Expected: sin errores nuevos (la librería no se usa todavía, así que esto solo confirma que la instalación no rompió nada).

- [ ] **Step 4: Commit**

```bash
git add portal/package.json portal/package-lock.json
git commit -m "$(cat <<'EOF'
Portal: instala ng-apexcharts para los charts del dashboard de cartera

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `SidebarService` — estado del drawer mobile

**Files:**
- Create: `portal/src/app/shared/services/sidebar.ts`
- Test: `portal/src/app/shared/services/sidebar.test.ts`

**Interfaces:**
- Produces: `SidebarService` con `mobileAbierto: Signal<boolean>`, `alternarMobile(): void`, `cerrarMobile(): void`. Lo consumen `AppSidebarComponent`, `AppHeaderComponent` y `BackdropComponent` (Tasks 4-6).

No hay modo "colapsado a íconos" del template original: con 2 ítems de navegación no hay nada que colapsar — YAGNI. Solo existe el estado del drawer mobile.

- [ ] **Step 1: Escribir el test (falla porque el archivo no existe)**

```ts
// portal/src/app/shared/services/sidebar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidebarService } from './sidebar';

test('el drawer mobile arranca cerrado', () => {
  const s = new SidebarService();
  assert.equal(s.mobileAbierto(), false);
});

test('alternarMobile invierte el estado', () => {
  const s = new SidebarService();
  s.alternarMobile();
  assert.equal(s.mobileAbierto(), true);
  s.alternarMobile();
  assert.equal(s.mobileAbierto(), false);
});

test('cerrarMobile fuerza a cerrado sin importar el estado previo', () => {
  const s = new SidebarService();
  s.alternarMobile();
  s.cerrarMobile();
  assert.equal(s.mobileAbierto(), false);
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal test`
Expected: FALLA — `Cannot find module './sidebar'`.

- [ ] **Step 3: Implementar**

```ts
// portal/src/app/shared/services/sidebar.ts
import { Injectable, signal } from '@angular/core';

/**
 * Solo el estado del drawer mobile: el sidebar de escritorio queda siempre visible (2 ítems de
 * navegación no justifican el modo colapsado-a-íconos del template original — YAGNI).
 */
@Injectable({ providedIn: 'root' })
export class SidebarService {
  private readonly _mobileAbierto = signal(false);
  readonly mobileAbierto = this._mobileAbierto.asReadonly();

  alternarMobile(): void {
    this._mobileAbierto.update((v) => !v);
  }

  cerrarMobile(): void {
    this._mobileAbierto.set(false);
  }
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm --prefix portal test`
Expected: los 3 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/shared/services/sidebar.ts portal/src/app/shared/services/sidebar.test.ts
git commit -m "$(cat <<'EOF'
Portal: SidebarService — estado del drawer mobile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Token `--velo` + `BackdropComponent`

**Files:**
- Modify: `portal/src/app/core/contraste.ts` (array `TOKENS`)
- Modify: `portal/src/styles.css` (`:root`, `.oscuro`, `@theme inline`)
- Create: `portal/src/app/shared/layout/backdrop.ts`
- Test: `portal/src/app/shared/layout/backdrop.spec.ts`

**Interfaces:**
- Consumes: `SidebarService.mobileAbierto`/`cerrarMobile()` (Task 2).
- Produces: `BackdropComponent` (overlay mobile), usado por `AppShellComponent` (Task 6). Utilidad Tailwind `bg-velo` disponible para cualquier overlay futuro.

Ningún token existente sirve para un velo/scrim: `texto`/`accion` se invierten entre temas (claro↔oscuro), así que un overlay que use cualquiera de esos dos se pintaría **blanco** en tema oscuro — lo opuesto de lo que un scrim necesita (oscurecer el fondo, sin importar el tema). Y una clase cruda (`bg-black`) la prohíbe el test `'ninguna plantilla incrusta un color'`. Se agrega un token nuevo, con el mismo valor en los dos temas — un scrim se ve igual sin importar el tema activo.

- [ ] **Step 1: Agregar el token `velo` a `TOKENS`**

En `portal/src/app/core/contraste.ts`, en el array `TOKENS` (17 líneas después de `'error-suave',`), agregar:

```ts
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
  'velo',
];
```

- [ ] **Step 2: Agregar el valor en `:root`, `.oscuro` y `@theme inline` de `styles.css`**

En `portal/src/styles.css`, agregar `--velo: #0f1419;` al final del bloque `:root` (después de `--error-suave: #fee2e2;`) y **el mismo valor** al final de `.oscuro` (después de `--error-suave: #451a1a;`) — mismo hex en los dos temas, a propósito (ver arriba). Y en el bloque `@theme inline`, agregar `--color-velo: var(--velo);`.

- [ ] **Step 2.5: Corregir el "16" hardcodeado en `contraste.test.ts` — ahora son 17 tokens**

`TOKENS.length` ya es dinámico (el test compara contra `[...TOKENS].sort()`), pero el **nombre del test** y su mensaje de error todavía dicen "16" en texto literal. En `portal/src/app/core/contraste.test.ts`, cambiar:

```ts
test('🔴 los dos temas definen exactamente los mismos 16 tokens', () => {
```
por
```ts
test('🔴 los dos temas definen exactamente los mismos tokens', () => {
```

y dentro de ese test, el mensaje:
```ts
`el tema ${nombre} no define los 16 tokens exactos`,
```
por
```ts
`el tema ${nombre} no define los ${TOKENS.length} tokens exactos`,
```

Así el mensaje no vuelve a quedar desactualizado si se agrega un token 18 más adelante.

- [ ] **Step 3: Verificación por mutación del test de tokens — confirmar que ata**

Run: `npm --prefix portal test`
Expected: el test `'🔴 los dos temas definen exactamente los mismos 16 tokens'` de `contraste.test.ts` (ahora compara contra 17) debe seguir en VERDE si el Step 2 se hizo en los dos bloques. Para confirmar que realmente ata: borrar temporalmente `--velo: #0f1419;` solo de `.oscuro`, correr `npm --prefix portal test`, confirmar que FALLA con "el tema oscuro no define los 16 tokens exactos" (el mensaje sigue diciendo "16" porque es el `TOKENS.length` de cuando se escribió el string — no hace falta tocar el mensaje). Revertir.

- [ ] **Step 4: Escribir el spec de `BackdropComponent` (falla porque no existe)**

```ts
// portal/src/app/shared/layout/backdrop.spec.ts
import { TestBed } from '@angular/core/testing';
import { BackdropComponent } from './backdrop';
import { SidebarService } from '../services/sidebar';

describe('BackdropComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [BackdropComponent] });
    const fixture = TestBed.createComponent(BackdropComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('con el drawer cerrado, no renderiza nada', () => {
    const fixture = render();
    expect((fixture.nativeElement as HTMLElement).querySelector('div')).toBeNull();
  });

  it('con el drawer abierto, renderiza el overlay', () => {
    const fixture = render();
    TestBed.inject(SidebarService).alternarMobile();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('div')).not.toBeNull();
  });

  it('clickear el overlay cierra el drawer', () => {
    const fixture = render();
    const sidebar = TestBed.inject(SidebarService);
    sidebar.alternarMobile();
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector('div')!.dispatchEvent(new MouseEvent('click'));
    expect(sidebar.mobileAbierto()).toBe(false);
  });
});
```

- [ ] **Step 5: Correr y confirmar que falla**

Run: `npm --prefix portal run test:components`
Expected: FALLA — `Cannot find module './backdrop'`.

- [ ] **Step 6: Implementar**

```ts
// portal/src/app/shared/layout/backdrop.ts
import { Component, inject } from '@angular/core';
import { SidebarService } from '../services/sidebar';

@Component({
  selector: 'app-backdrop',
  template: `
    @if (sidebar.mobileAbierto()) {
      <div class="fixed inset-0 z-40 bg-velo opacity-50 lg:hidden" (click)="sidebar.cerrarMobile()"></div>
    }
  `,
})
export class BackdropComponent {
  readonly sidebar = inject(SidebarService);
}
```

- [ ] **Step 7: Correr y confirmar que pasa**

Run: `npm --prefix portal run test:components`
Expected: los 3 tests de `backdrop.spec.ts` en verde.

- [ ] **Step 8: Suite completa + commit**

Run: `npm --prefix portal test && npm --prefix portal run typecheck`
Expected: todo verde (incluidas las 34+1 aserciones de contraste con el token nuevo).

```bash
git add portal/src/app/core/contraste.ts portal/src/styles.css portal/src/app/shared/layout/backdrop.ts portal/src/app/shared/layout/backdrop.spec.ts
git commit -m "$(cat <<'EOF'
Portal: token --velo + BackdropComponent (overlay del drawer mobile)

Ningún token existente sirve de scrim: texto/accion se invierten entre
temas, así que se pintarían blancos en oscuro. --velo tiene el mismo
valor en los dos temas a propósito.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `AppSidebarComponent`

**Files:**
- Create: `portal/src/app/shared/layout/app-sidebar.ts`
- Test: `portal/src/app/shared/layout/app-sidebar.spec.ts`

**Interfaces:**
- Consumes: `SidebarService` (Task 2).
- Produces: `AppSidebarComponent`, usado por `AppShellComponent` (Task 6). Los ítems de navegación son `/runs` y `/cartera` — no hay submenús (el template original los soporta para 15+ ítems; acá son 2, sin anidamiento — YAGNI).

- [ ] **Step 1: Escribir el spec (falla porque no existe)**

```ts
// portal/src/app/shared/layout/app-sidebar.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppSidebarComponent } from './app-sidebar';
import { SidebarService } from '../services/sidebar';

describe('AppSidebarComponent', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AppSidebarComponent],
      providers: [provideRouter([{ path: 'runs', children: [] }, { path: 'cartera', children: [] }])],
    });
    const fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza los dos ítems de navegación', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Research');
    expect(el.textContent).toContain('Cartera');
  });

  it('clickear un ítem cierra el drawer mobile', () => {
    const fixture = render();
    const sidebar = TestBed.inject(SidebarService);
    sidebar.alternarMobile();
    expect(sidebar.mobileAbierto()).toBe(true);
    (fixture.nativeElement as HTMLElement).querySelector('a')!.dispatchEvent(new MouseEvent('click'));
    expect(sidebar.mobileAbierto()).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal run test:components`
Expected: FALLA — `Cannot find module './app-sidebar'`.

- [ ] **Step 3: Implementar**

```ts
// portal/src/app/shared/layout/app-sidebar.ts
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SidebarService } from '../services/sidebar';

interface ItemNav {
  readonly etiqueta: string;
  readonly ruta: string;
  readonly icono: 'research' | 'cartera';
}

const ITEMS_NAV: readonly ItemNav[] = [
  { etiqueta: 'Research', ruta: '/runs', icono: 'research' },
  { etiqueta: 'Cartera', ruta: '/cartera', icono: 'cartera' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside
      class="fixed inset-y-0 left-0 z-50 w-64 bg-superficie border-r border-borde flex flex-col transition-transform lg:translate-x-0"
      [class.-translate-x-full]="!sidebar.mobileAbierto()"
    >
      <div class="h-11 flex items-center px-4 border-b border-borde">
        <span class="text-sm font-semibold text-texto">AMG OS</span>
      </div>
      <nav class="flex-1 px-2 py-3 space-y-1">
        @for (item of items; track item.ruta) {
          <a
            [routerLink]="item.ruta"
            routerLinkActive="bg-superficie-2 text-texto"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-texto-tenue hover:text-texto hover:bg-superficie-2"
            (click)="sidebar.cerrarMobile()"
          >
            @switch (item.icono) {
              @case ('research') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35" />
                </svg>
              }
              @case ('cartera') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 13h4v7H3zM10 8h4v12h-4zM17 3h4v17h-4z" />
                </svg>
              }
            }
            <span>{{ item.etiqueta }}</span>
          </a>
        }
      </nav>
    </aside>
  `,
})
export class AppSidebarComponent {
  readonly sidebar = inject(SidebarService);
  readonly items = ITEMS_NAV;
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm --prefix portal run test:components`
Expected: los 2 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/shared/layout/app-sidebar.ts portal/src/app/shared/layout/app-sidebar.spec.ts
git commit -m "$(cat <<'EOF'
Portal: AppSidebarComponent — nav plana de 2 ítems, sin submenús

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ICONO`/`ETIQUETA` a `core/tema.ts` + `AppHeaderComponent`

**Files:**
- Modify: `portal/src/app/core/tema.ts` (agrega `ICONO`, `ETIQUETA`)
- Create: `portal/src/app/shared/layout/app-header.ts`
- Test: `portal/src/app/shared/layout/app-header.spec.ts`

**Interfaces:**
- Consumes: `AuthService` (`autenticado()`, `email()`, `logout()` — ya existen), `TemaService` (`tema()`, `alternar()` — ya existe), `SidebarService.alternarMobile()` (Task 2).
- Produces: `AppHeaderComponent`, usado por `AppShellComponent` (Task 6). **No existe** un modelo `Usuario` en el portal (la v1 del spec lo inventó) — el header consume `AuthService` directo.

`ICONO`/`ETIQUETA` vivían en `App` (`app.ts`) porque el header era parte del componente raíz. Al mover el header a su propio componente, la mapeo de `Tema` → ícono/etiqueta se muda a `core/tema.ts` (es una función pura del tipo `Tema`, no algo específico de qué componente la use).

- [ ] **Step 1: Mover `ICONO`/`ETIQUETA` a `core/tema.ts`**

Agregar al final de `portal/src/app/core/tema.ts` (después de `temaEfectivo`):

```ts
/**
 * El icono tiene que decir en qué posición está el botón, no qué va a hacer si lo toco: son tres
 * estados, y "auto" no se adivina. `ETIQUETA` (el `aria-label`) lo dice con palabras, que es lo que
 * lee un lector de pantalla y lo que aparece en el tooltip.
 *
 * `︎` es el selector de variación TEXTO. Sin él, el navegador pinta U+2600 como emoji de color —un
 * sol naranja— que ignora `text-texto-tenue` y no cambia con el tema. `◐` y `☾` no tienen forma
 * emoji, así que no lo necesitan.
 */
export const ICONO: Record<Tema, string> = { auto: '◐', claro: '☀︎', oscuro: '☾' };
export const ETIQUETA: Record<Tema, string> = {
  auto: 'Tema: automático (sigue al sistema). Tocar para pasar a claro',
  claro: 'Tema: claro. Tocar para pasar a oscuro',
  oscuro: 'Tema: oscuro. Tocar para volver a automático',
};
```

- [ ] **Step 2: Confirmar que `tema.test.ts` sigue en verde (no debería verse afectado)**

Run: `npm --prefix portal test`
Expected: verde — `ICONO`/`ETIQUETA` son exports nuevos, no tocan nada existente.

- [ ] **Step 3: Escribir el spec de `AppHeaderComponent` (falla porque no existe)**

```ts
// portal/src/app/shared/layout/app-header.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppHeaderComponent } from './app-header';
import { AuthService } from '../../services/auth';
import { SidebarService } from '../services/sidebar';

describe('AppHeaderComponent', () => {
  function render(autenticado: boolean) {
    TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            autenticado: () => autenticado,
            email: () => 'ana@amg.test',
            logout: async () => {},
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppHeaderComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('autenticado: muestra el email y el botón Salir', () => {
    const el = render(true).nativeElement as HTMLElement;
    expect(el.textContent).toContain('ana@amg.test');
    expect(el.textContent).toContain('Salir');
  });

  it('no autenticado: no muestra email ni Salir', () => {
    const el = render(false).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('ana@amg.test');
    expect(el.textContent).not.toContain('Salir');
  });

  it('el botón de menú alterna el drawer mobile', () => {
    const fixture = render(true);
    const sidebar = TestBed.inject(SidebarService);
    expect(sidebar.mobileAbierto()).toBe(false);
    (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Abrir menú"]')!.dispatchEvent(new MouseEvent('click'));
    expect(sidebar.mobileAbierto()).toBe(true);
  });
});
```

- [ ] **Step 4: Correr y confirmar que falla**

Run: `npm --prefix portal run test:components`
Expected: FALLA — `Cannot find module './app-header'`.

- [ ] **Step 5: Implementar**

```ts
// portal/src/app/shared/layout/app-header.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { TemaService } from '../../services/tema';
import { ICONO, ETIQUETA } from '../../core/tema';
import { SidebarService } from '../services/sidebar';

@Component({
  selector: 'app-header',
  template: `
    <header class="h-11 bg-superficie border-b border-borde flex items-center justify-between px-4">
      <button
        type="button"
        class="lg:hidden h-8 w-8 flex items-center justify-center text-texto-tenue hover:text-texto"
        aria-label="Abrir menú"
        (click)="sidebar.alternarMobile()"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div class="flex items-center gap-3 text-sm text-texto-tenue">
        @if (auth.autenticado()) {
          <span>{{ auth.email() }}</span>
          <button type="button" (click)="salir()" class="text-texto-tenue hover:text-texto">Salir</button>
        }
        <button
          type="button"
          (click)="tema.alternar()"
          [attr.aria-label]="ETIQUETA[tema.tema()]"
          [title]="ETIQUETA[tema.tema()]"
          class="h-11 w-11 -mr-2 flex items-center justify-center text-base leading-none text-texto-tenue hover:text-texto"
        >
          {{ ICONO[tema.tema()] }}
        </button>
      </div>
    </header>
  `,
})
export class AppHeaderComponent {
  readonly auth = inject(AuthService);
  readonly tema = inject(TemaService);
  readonly sidebar = inject(SidebarService);
  private readonly router = inject(Router);

  readonly ICONO = ICONO;
  readonly ETIQUETA = ETIQUETA;

  async salir(): Promise<void> {
    void this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
```

- [ ] **Step 6: Correr y confirmar que pasa**

Run: `npm --prefix portal run test:components`
Expected: los 3 tests en verde.

- [ ] **Step 7: Commit**

```bash
git add portal/src/app/core/tema.ts portal/src/app/shared/layout/app-header.ts portal/src/app/shared/layout/app-header.spec.ts
git commit -m "$(cat <<'EOF'
Portal: AppHeaderComponent sobre AuthService/TemaService

No existe un modelo Usuario en el portal — el header consume
AuthService directo, no un @Input de usuario. ICONO/ETIQUETA se mudan
de App (app.ts) a core/tema.ts: son una función pura del tipo Tema,
no algo específico de qué componente las use.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `AppShellComponent`

**Files:**
- Create: `portal/src/app/shared/layout/app-shell.ts`

**Interfaces:**
- Consumes: `AppSidebarComponent` (Task 4), `AppHeaderComponent` (Task 5), `BackdropComponent` (Task 3).
- Produces: `AppShellComponent`, con un `<router-outlet />` propio para las rutas hijas. Lo consume `app.routes.ts` en el Task 13 (último) como componente de la ruta padre autenticada.

No lleva spec propio: es pura composición sin lógica condicional (cada pieza que compone ya tiene su test). Se verifica al final, en el Task 13, con el test de topología de rutas y a mano en el navegador.

- [ ] **Step 1: Implementar**

```ts
// portal/src/app/shared/layout/app-shell.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppSidebarComponent } from './app-sidebar';
import { AppHeaderComponent } from './app-header';
import { BackdropComponent } from './backdrop';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AppSidebarComponent, AppHeaderComponent, BackdropComponent],
  template: `
    <div class="min-h-screen bg-fondo">
      <app-sidebar />
      <app-backdrop />
      <div class="lg:pl-64">
        <app-header />
        <main class="p-4">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AppShellComponent {}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix portal run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/shared/layout/app-shell.ts
git commit -m "$(cat <<'EOF'
Portal: AppShellComponent — compone sidebar + header + backdrop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `core/cartera-mock.ts` — datos de muestra

**Files:**
- Create: `portal/src/app/core/cartera-mock.ts`
- Test: `portal/src/app/core/cartera-mock.test.ts`

**Interfaces:**
- Consumes: `RunSummary`, `PaginaPropuesta` (`portal/src/app/core/models.ts`, sin cambios), `EVIDENCIA_RESPALDADA` (`portal/src/app/core/evidence.ts:16`, sin cambios).
- Produces: `ClienteCartera`, `CarteraDashboard`, `generarCarteraMock(): CarteraDashboard`. Los consume `core/cartera.ts` (Task 8) y `CarteraPage` (Task 12).

**Determinístico a propósito** (sin `Math.random`): los tests necesitan valores exactos, no rangos. 6 clientes (roadmap: "seed de 4-6 restaurantes"), 2 corridas cada uno, 3 páginas por corrida — 12 runs, 36 páginas.

- [ ] **Step 1: Escribir el test (falla porque el archivo no existe)**

```ts
// portal/src/app/core/cartera-mock.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock } from './cartera-mock';
import { EVIDENCIA_RESPALDADA } from './evidence';

test('genera entre 4 y 6 clientes, según el roadmap (seed de 4-6 restaurantes)', () => {
  const d = generarCarteraMock();
  assert.ok(d.clientes.length >= 4 && d.clientes.length <= 6, `esperaba 4-6 clientes, obtuve ${d.clientes.length}`);
});

test('cada cliente tiene al menos 2 runs, para poder armar una serie temporal', () => {
  const d = generarCarteraMock();
  for (const c of d.clientes) assert.ok(c.runs.length >= 2, `${c.nombre} tiene menos de 2 runs`);
});

test('todas las páginas referencian un client_id de algún run existente', () => {
  const d = generarCarteraMock();
  const runIds = new Set(d.clientes.flatMap((c) => c.runs.map((r) => r.id)));
  // las páginas no llevan client_id directo (PaginaPropuesta no lo tiene) — se valida indirectamente
  // por convención de id: `${runId}-pagina-N`
  for (const p of d.pages) {
    const runId = p.id.replace(/-pagina-\d+$/, '');
    assert.ok(runIds.has(runId), `la página ${p.id} no corresponde a ningún run generado`);
  }
});

test('es determinístico: dos llamadas producen exactamente los mismos datos', () => {
  const a = generarCarteraMock();
  const b = generarCarteraMock();
  assert.deepEqual(a, b);
});

test('usa EVIDENCIA_RESPALDADA para marcar páginas respaldadas, no un string suelto', () => {
  const d = generarCarteraMock();
  assert.ok(
    d.pages.some((p) => p.evidencia === EVIDENCIA_RESPALDADA),
    'ninguna página de muestra usa el criterio real de "respaldada"',
  );
  assert.ok(
    d.pages.some((p) => p.evidencia !== EVIDENCIA_RESPALDADA),
    'el mock debería tener también páginas sin validar, para probar los dos estados de la UI',
  );
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal test`
Expected: FALLA — `Cannot find module './cartera-mock'`.

- [ ] **Step 3: Implementar**

```ts
// portal/src/app/core/cartera-mock.ts
import type { PaginaPropuesta, RunSummary } from './models';
import { EVIDENCIA_RESPALDADA } from './evidence';

export interface ClienteCartera {
  readonly client_id: string;
  /** La API no expone nombre de cliente hoy (solo `client_id`) — 100% mock, documentado acá. */
  readonly nombre: string;
  readonly runs: readonly RunSummary[];
}

export interface CarteraDashboard {
  readonly clientes: readonly ClienteCartera[];
  readonly pages: readonly PaginaPropuesta[];
}

const NOMBRES: readonly string[] = [
  'Trattoria Novecento',
  'Sushi Kamon',
  'Parrilla del Puerto',
  'La Tapería',
  'Verde Bowl',
  'Café Andén',
];

function runMock(clientIdx: number, runIdx: number, clientId: string): RunSummary {
  const dia = 1 + clientIdx * 5 + runIdx * 2;
  return {
    id: `run-${clientIdx}-${runIdx}`,
    client_id: clientId,
    status: 'approved',
    prompt: `Research ${NOMBRES[clientIdx]}`,
    schema_version: 'kr.v0.5',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: 250_000 + clientIdx * 40_000 + runIdx * 15_000,
    calidad_datos: {},
    config: {},
    created_at: new Date(Date.UTC(2026, 6, dia)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 6, dia, 0, 20)).toISOString(),
  };
}

function paginaMock(runId: string, pageIdx: number, semillaBase: number): PaginaPropuesta {
  const semilla = semillaBase + pageIdx * 3;
  return {
    id: `${runId}-pagina-${pageIdx}`,
    approved: pageIdx % 3 !== 0,
    cluster_id: `cluster-${runId}-${pageIdx % 3}`,
    tipo: 'comercial',
    page_strategy: null,
    url_slug: `/pagina-${runId}-${pageIdx}`,
    keyword_principal: `keyword ${runId} ${pageIdx}`,
    keywords_secundarias: [],
    intencion: pageIdx % 2 === 0 ? 'comercial' : 'informacional',
    local: true,
    volumen: 100 + semilla * 37,
    dificultad: 10 + (semilla % 60),
    evidencia: pageIdx % 3 === 0 ? 'sin_datos' : EVIDENCIA_RESPALDADA,
    opportunity_score: Math.round(((semilla * 13) % 100) * 10) / 10,
    score_confidence: Math.round((semilla * 17) % 100) / 100,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
  };
}

export function generarCarteraMock(): CarteraDashboard {
  const clientes: ClienteCartera[] = [];
  const pages: PaginaPropuesta[] = [];

  NOMBRES.forEach((nombre, clientIdx) => {
    const clientId = `cliente-${clientIdx}`;
    const runs = [0, 1].map((runIdx) => runMock(clientIdx, runIdx, clientId));
    runs.forEach((run, runIdx) => {
      for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
        pages.push(paginaMock(run.id, pageIdx, clientIdx * 7 + runIdx * 11));
      }
    });
    clientes.push({ client_id: clientId, nombre, runs });
  });

  return { clientes, pages };
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm --prefix portal test`
Expected: los 5 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/core/cartera-mock.ts portal/src/app/core/cartera-mock.test.ts
git commit -m "$(cat <<'EOF'
Portal: datos de muestra de cartera — 6 clientes, determinístico

Misma forma que RunSummary/PaginaPropuesta reales. El nombre del
cliente es 100% mock: la API no expone nombre, solo client_id.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `core/cartera.ts` — agregaciones puras

**Files:**
- Create: `portal/src/app/core/cartera.ts`
- Test: `portal/src/app/core/cartera.test.ts`

**Interfaces:**
- Consumes: `CarteraDashboard` (Task 7).
- Produces: `kpisDeCartera(dashboard, mesReferencia?): KpisCartera`, `topOportunidades(pages, n): OportunidadTop[]`, `serieTemporalCoste(dashboard): PuntoCosteRun[]`. Los consume `CarteraPage` (Task 12).

- [ ] **Step 1: Escribir el test (falla porque el archivo no existe)**

```ts
// portal/src/app/core/cartera.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCarteraMock } from './cartera-mock';
import { kpisDeCartera, topOportunidades, serieTemporalCoste } from './cartera';

test('kpisDeCartera: sitiosActivos es la cantidad de clientes', () => {
  const d = generarCarteraMock();
  assert.equal(kpisDeCartera(d).sitiosActivos, d.clientes.length);
});

test('kpisDeCartera: opportunityScorePromedio es el promedio simple de todas las páginas', () => {
  const d = generarCarteraMock();
  const esperado = d.pages.reduce((a, p) => a + p.opportunity_score, 0) / d.pages.length;
  assert.equal(kpisDeCartera(d).opportunityScorePromedio, Math.round(esperado * 10) / 10);
});

test('kpisDeCartera: costeDelMesUsd solo suma runs de julio 2026 cuando se referencia ese mes', () => {
  const d = generarCarteraMock();
  const kpis = kpisDeCartera(d, new Date(Date.UTC(2026, 6, 15)));
  const esperadoMicros = d.clientes.flatMap((c) => c.runs).reduce((acc, r) => acc + r.coste_micros_usd, 0);
  assert.equal(kpis.costeDelMesUsd, Math.round((esperadoMicros / 1_000_000) * 100) / 100);
});

test('kpisDeCartera: un mes sin runs da coste 0, no undefined ni NaN', () => {
  const d = generarCarteraMock();
  const kpis = kpisDeCartera(d, new Date(Date.UTC(2020, 0, 1)));
  assert.equal(kpis.costeDelMesUsd, 0);
});

test('topOportunidades: devuelve las N páginas de mayor opportunity_score, ordenadas desc', () => {
  const d = generarCarteraMock();
  const top3 = topOportunidades(d.pages, 3);
  assert.equal(top3.length, 3);
  const scoresOrdenados = [...d.pages].map((p) => p.opportunity_score).sort((a, b) => b - a);
  assert.deepEqual(top3.map((t) => t.score), scoresOrdenados.slice(0, 3));
});

test('serieTemporalCoste: un punto por run, ordenados por fecha ascendente', () => {
  const d = generarCarteraMock();
  const serie = serieTemporalCoste(d);
  const totalRuns = d.clientes.reduce((acc, c) => acc + c.runs.length, 0);
  assert.equal(serie.length, totalRuns);
  const fechas = serie.map((p) => p.fecha);
  assert.deepEqual(fechas, [...fechas].sort());
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal test`
Expected: FALLA — `Cannot find module './cartera'`.

- [ ] **Step 3: Implementar**

```ts
// portal/src/app/core/cartera.ts
import type { CarteraDashboard } from './cartera-mock';

export interface KpisCartera {
  readonly sitiosActivos: number;
  readonly opportunityScorePromedio: number;
  readonly costeDelMesUsd: number;
}

export function kpisDeCartera(dashboard: CarteraDashboard, mesReferencia: Date = new Date()): KpisCartera {
  const scores = dashboard.pages.map((p) => p.opportunity_score);
  const promedio = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const runsDelMes = dashboard.clientes.flatMap((c) => c.runs).filter((r) => {
    const fecha = new Date(r.created_at);
    return (
      fecha.getUTCFullYear() === mesReferencia.getUTCFullYear() &&
      fecha.getUTCMonth() === mesReferencia.getUTCMonth()
    );
  });
  const costeMicros = runsDelMes.reduce((acc, r) => acc + r.coste_micros_usd, 0);

  return {
    sitiosActivos: dashboard.clientes.length,
    opportunityScorePromedio: Math.round(promedio * 10) / 10,
    costeDelMesUsd: Math.round((costeMicros / 1_000_000) * 100) / 100,
  };
}

export interface OportunidadTop {
  readonly keyword: string;
  readonly score: number;
}

export function topOportunidades(pages: CarteraDashboard['pages'], n: number): OportunidadTop[] {
  return [...pages]
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, n)
    .map((p) => ({ keyword: p.keyword_principal, score: p.opportunity_score }));
}

export interface PuntoCosteRun {
  readonly fecha: string;
  readonly costeUsd: number;
}

export function serieTemporalCoste(dashboard: CarteraDashboard): PuntoCosteRun[] {
  return dashboard.clientes
    .flatMap((c) => c.runs)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      fecha: r.created_at.slice(0, 10),
      costeUsd: Math.round((r.coste_micros_usd / 1_000_000) * 100) / 100,
    }));
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm --prefix portal test`
Expected: los 6 tests en verde.

- [ ] **Step 5: Verificación por mutación — confirmar que `topOportunidades` realmente ordena**

Editar temporalmente el `.sort((a, b) => b.opportunity_score - a.opportunity_score)` a `.sort((a, b) => a.opportunity_score - b.opportunity_score)` (orden ascendente, el bug de invertir el signo).
Run: `npm --prefix portal test`
Expected: FALLA el test `'topOportunidades: devuelve las N páginas de mayor opportunity_score, ordenadas desc'`.
Revertir y confirmar verde de nuevo.

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/core/cartera.ts portal/src/app/core/cartera.test.ts
git commit -m "$(cat <<'EOF'
Portal: agregaciones puras de cartera (KPIs, top oportunidades, serie de coste)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `StatBoxComponent`

**Files:**
- Create: `portal/src/app/shared/components/stat-box.ts`

**Interfaces:**
- Produces: `StatBoxComponent` con `titulo: InputSignal<string>`, `valor: InputSignal<number>`. Lo consume `CarteraPage` (Task 12).

Sin lógica condicional — no lleva spec dedicado (se verifica a mano en el navegador junto con el resto de `/cartera` en el Task 13).

- [ ] **Step 1: Implementar**

```ts
// portal/src/app/shared/components/stat-box.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-box',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-4">
      <p class="text-xs text-texto-tenue">{{ titulo() }}</p>
      <p class="mt-1 text-2xl font-semibold text-texto">{{ valor() }}</p>
    </div>
  `,
})
export class StatBoxComponent {
  readonly titulo = input.required<string>();
  readonly valor = input.required<number>();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix portal run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/shared/components/stat-box.ts
git commit -m "$(cat <<'EOF'
Portal: StatBoxComponent — tile de KPI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `BarChartComponent` y `LineChartComponent`

**Files:**
- Create: `portal/src/app/shared/components/bar-chart.ts`
- Create: `portal/src/app/shared/components/line-chart.ts`

**Interfaces:**
- Consumes: `ng-apexcharts` (Task 1), `TemaService.efectivo` (ya existe).
- Produces: `BarChartComponent` (`datos: InputSignal<readonly BarraDatos[]>`, `titulo: InputSignal<string>`), `LineChartComponent` (`puntos: InputSignal<readonly PuntoSerie[]>`, `titulo: InputSignal<string>`). Los consume `CarteraPage` (Task 12).

**No se grafica por `cluster_id`** (es un `randomUUID()`, ilegible como categoría — ver spec). `BarChartComponent` recibe pares etiqueta/valor ya resueltos por quien lo use (en `/cartera`: `keyword_principal` + `opportunity_score`, vía `topOportunidades`). El color **nunca es un hex en el código fuente** — se lee de `getComputedStyle` en cada recomputación, y se recomputa cuando `tema.efectivo()` cambia, así el chart sigue al tema sin quedar pintado con el color del tema con el que se montó.

- [ ] **Step 1: Implementar `BarChartComponent`**

```ts
// portal/src/app/shared/components/bar-chart.ts
import { Component, computed, inject, input } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import type { ApexAxisChartSeries, ApexChart, ApexXAxis } from 'ng-apexcharts';
import { TemaService } from '../../services/tema';

export interface BarraDatos {
  readonly etiqueta: string;
  readonly valor: number;
}

@Component({
  selector: 'app-bar-chart',
  imports: [NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series()"
      [chart]="chart"
      [xaxis]="xaxis()"
      [colors]="colores()"
      [plotOptions]="plotOptions"
      [dataLabels]="dataLabels"
    />
  `,
})
export class BarChartComponent {
  readonly datos = input.required<readonly BarraDatos[]>();
  readonly titulo = input<string>('');

  private readonly tema = inject(TemaService);

  readonly chart: ApexChart = { type: 'bar', height: 280, toolbar: { show: false } };
  readonly plotOptions = { bar: { horizontal: true, borderRadius: 4 } };
  readonly dataLabels = { enabled: false };

  readonly series = computed<ApexAxisChartSeries>(() => [
    { name: this.titulo(), data: this.datos().map((d) => d.valor) },
  ]);

  readonly xaxis = computed<ApexXAxis>(() => ({ categories: this.datos().map((d) => d.etiqueta) }));

  /**
   * Lee el token `--accion` ya resuelto por el navegador — nunca un hex fijo en el código fuente:
   * `contraste.test.ts` prohíbe incrustar colores, y esto lee el que el tema tenga en cada momento.
   * `tema.efectivo()` se lee acá adentro a propósito: es lo que hace que `colores` se recalcule
   * cuando cambia el tema (Angular rastrea qué signals lee un `computed` para saber cuándo invalidarlo).
   */
  readonly colores = computed<string[]>(() => {
    this.tema.efectivo();
    if (typeof document === 'undefined') return ['#000000'];
    const valor = getComputedStyle(document.documentElement).getPropertyValue('--accion').trim();
    return [valor || '#000000'];
  });
}
```

- [ ] **Step 2: Implementar `LineChartComponent`**

```ts
// portal/src/app/shared/components/line-chart.ts
import { Component, computed, inject, input } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import type { ApexAxisChartSeries, ApexChart, ApexStroke, ApexXAxis } from 'ng-apexcharts';
import { TemaService } from '../../services/tema';

export interface PuntoSerie {
  readonly fecha: string;
  readonly valor: number;
}

@Component({
  selector: 'app-line-chart',
  imports: [NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series()"
      [chart]="chart"
      [xaxis]="xaxis()"
      [colors]="colores()"
      [stroke]="stroke"
      [dataLabels]="dataLabels"
    />
  `,
})
export class LineChartComponent {
  readonly puntos = input.required<readonly PuntoSerie[]>();
  readonly titulo = input<string>('');

  private readonly tema = inject(TemaService);

  readonly chart: ApexChart = { type: 'line', height: 280, toolbar: { show: false } };
  readonly stroke: ApexStroke = { curve: 'smooth', width: 2 };
  readonly dataLabels = { enabled: false };

  readonly series = computed<ApexAxisChartSeries>(() => [
    { name: this.titulo(), data: this.puntos().map((p) => p.valor) },
  ]);

  readonly xaxis = computed<ApexXAxis>(() => ({ categories: this.puntos().map((p) => p.fecha) }));

  readonly colores = computed<string[]>(() => {
    this.tema.efectivo();
    if (typeof document === 'undefined') return ['#000000'];
    const valor = getComputedStyle(document.documentElement).getPropertyValue('--respaldo').trim();
    return [valor || '#000000'];
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix portal run typecheck`
Expected: sin errores. Si `ng-apexcharts` no exporta alguno de estos tipos con ese nombre exacto en la versión instalada (Task 1), ajustar los imports contra `portal/node_modules/ng-apexcharts/public-api.d.ts` — la forma de los `@Input`/plantilla del componente no cambia, solo los nombres de tipo importados.

- [ ] **Step 4: Verificar que ningún color quedó incrustado**

Run: `npm --prefix portal test`
Expected: el test `'🔴 ninguna plantilla incrusta un color: todo pasa por un token'` de `contraste.test.ts` sigue en verde — si alguno de los dos componentes tiene un `#hex` literal en vez de `getComputedStyle`, este test lo va a marcar. Confirmar que el resto de la suite también sigue verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/shared/components/bar-chart.ts portal/src/app/shared/components/line-chart.ts
git commit -m "$(cat <<'EOF'
Portal: BarChartComponent y LineChartComponent — color leído del tema, no incrustado

No grafican por cluster_id (es un UUID). El color de la serie se lee
con getComputedStyle en cada recomputación, atada a tema.efectivo():
nunca hay un hex en el código fuente, así que sigue al tema sin
quedar pintado con el color del tema con el que se montó el chart.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `CarteraTablaComponent`

**Files:**
- Create: `portal/src/app/pages/cartera/cartera-tabla.ts`
- Test: `portal/src/app/pages/cartera/cartera-tabla.spec.ts`

**Interfaces:**
- Consumes: `PaginaPropuesta` (`core/models.ts`), `esRespaldada` (`core/evidence.ts:18`).
- Produces: `CarteraTablaComponent` con `paginas: InputSignal<readonly PaginaPropuesta[]>`. Lo consume `CarteraPage` (Task 12).

Vive junto a `cartera.ts` (no en `shared/components/`) porque tiene un único consumidor: la página de cartera, con columnas de ese dominio — no es una tabla genérica.

- [ ] **Step 1: Escribir el spec (falla porque no existe)**

```ts
// portal/src/app/pages/cartera/cartera-tabla.spec.ts
import { TestBed } from '@angular/core/testing';
import { CarteraTablaComponent } from './cartera-tabla';
import { EVIDENCIA_RESPALDADA } from '../../core/evidence';
import type { PaginaPropuesta } from '../../core/models';

function paginaDePrueba(overrides: Partial<PaginaPropuesta> = {}): PaginaPropuesta {
  return {
    id: 'p1',
    approved: false,
    cluster_id: 'c1',
    tipo: 'comercial',
    page_strategy: null,
    url_slug: '/x',
    keyword_principal: 'pizza a domicilio',
    keywords_secundarias: [],
    intencion: 'comercial',
    local: true,
    volumen: 100,
    dificultad: 20,
    evidencia: EVIDENCIA_RESPALDADA,
    opportunity_score: 75,
    score_confidence: 0.8,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
    ...overrides,
  };
}

describe('CarteraTablaComponent', () => {
  function render(paginas: PaginaPropuesta[]) {
    TestBed.configureTestingModule({ imports: [CarteraTablaComponent] });
    const fixture = TestBed.createComponent(CarteraTablaComponent);
    fixture.componentRef.setInput('paginas', paginas);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('sin páginas: muestra el estado vacío', () => {
    const el = render([]);
    expect(el.textContent).toContain('Todavía no hay páginas en la cartera.');
  });

  it('página respaldada: la pastilla dice ✅ Respaldada', () => {
    const el = render([paginaDePrueba({ evidencia: EVIDENCIA_RESPALDADA })]);
    expect(el.textContent).toContain('✅ Respaldada');
    expect(el.querySelector('.bg-respaldo-suave')).not.toBeNull();
  });

  it('página sin validar: la pastilla dice ⚠️ Sin validar', () => {
    const el = render([paginaDePrueba({ evidencia: 'sin_datos' })]);
    expect(el.textContent).toContain('⚠️ Sin validar');
    expect(el.querySelector('.bg-alerta-suave')).not.toBeNull();
  });

  it('renderiza el keyword de cada página', () => {
    const el = render([paginaDePrueba({ keyword_principal: 'sushi delivery' })]);
    expect(el.textContent).toContain('sushi delivery');
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal run test:components`
Expected: FALLA — `Cannot find module './cartera-tabla'`.

- [ ] **Step 3: Implementar**

```ts
// portal/src/app/pages/cartera/cartera-tabla.ts
import { Component, input } from '@angular/core';
import type { PaginaPropuesta } from '../../core/models';
import { esRespaldada } from '../../core/evidence';

@Component({
  selector: 'app-cartera-tabla',
  template: `
    <div class="bg-superficie rounded-xl border border-borde overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="text-left text-texto-tenue border-b border-borde">
            <th class="px-4 py-2 font-medium">Keyword</th>
            <th class="px-4 py-2 font-medium">Volumen</th>
            <th class="px-4 py-2 font-medium">Dificultad</th>
            <th class="px-4 py-2 font-medium">Score</th>
            <th class="px-4 py-2 font-medium">Confianza</th>
            <th class="px-4 py-2 font-medium">Intención</th>
            <th class="px-4 py-2 font-medium">Evidencia</th>
          </tr>
        </thead>
        <tbody>
          @for (p of paginas(); track p.id) {
            <tr class="border-b border-borde last:border-0">
              <td class="px-4 py-2 text-texto">{{ p.keyword_principal }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.volumen ?? 'n/d' }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.dificultad ?? 'n/d' }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.opportunity_score }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.score_confidence }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.intencion }}</td>
              <td class="px-4 py-2">
                <span
                  class="text-xs rounded-full px-2 py-0.5"
                  [class]="esRespaldada(p) ? 'bg-respaldo-suave text-respaldo' : 'bg-alerta-suave text-alerta'"
                >
                  {{ esRespaldada(p) ? '✅ Respaldada' : '⚠️ Sin validar' }}
                </span>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="px-4 py-6 text-center text-texto-tenue">
                Todavía no hay páginas en la cartera.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class CarteraTablaComponent {
  readonly paginas = input.required<readonly PaginaPropuesta[]>();
  readonly esRespaldada = esRespaldada;
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npm --prefix portal run test:components`
Expected: los 4 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/pages/cartera/cartera-tabla.ts portal/src/app/pages/cartera/cartera-tabla.spec.ts
git commit -m "$(cat <<'EOF'
Portal: CarteraTablaComponent — reusa esRespaldada, misma pastilla que brief

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `CarteraPage`

**Files:**
- Create: `portal/src/app/pages/cartera/cartera.ts`

**Interfaces:**
- Consumes: `generarCarteraMock` (Task 7), `kpisDeCartera`/`topOportunidades`/`serieTemporalCoste` (Task 8), `StatBoxComponent` (Task 9), `BarChartComponent`/`LineChartComponent` (Task 10), `CarteraTablaComponent` (Task 11).
- Produces: `CarteraPage`. Lo consume `app.routes.ts` en el Task 13 (última pieza que falta para que `/cartera` funcione de punta a punta).

- [ ] **Step 1: Implementar**

```ts
// portal/src/app/pages/cartera/cartera.ts
import { Component } from '@angular/core';
import { StatBoxComponent } from '../../shared/components/stat-box';
import { BarChartComponent } from '../../shared/components/bar-chart';
import { LineChartComponent } from '../../shared/components/line-chart';
import { CarteraTablaComponent } from './cartera-tabla';
import { generarCarteraMock } from '../../core/cartera-mock';
import { kpisDeCartera, topOportunidades, serieTemporalCoste } from '../../core/cartera';

@Component({
  selector: 'app-cartera',
  imports: [StatBoxComponent, BarChartComponent, LineChartComponent, CarteraTablaComponent],
  template: `
    <div class="space-y-6">
      <h1 class="text-lg font-semibold text-texto">Dashboard de cartera</h1>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <app-stat-box titulo="Sitios activos" [valor]="kpis.sitiosActivos" />
        <app-stat-box titulo="Opportunity score promedio" [valor]="kpis.opportunityScorePromedio" />
        <app-stat-box titulo="Coste del mes (USD)" [valor]="kpis.costeDelMesUsd" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-superficie rounded-xl border border-borde p-4">
          <h2 class="text-sm font-semibold text-texto mb-2">Top oportunidades</h2>
          <app-bar-chart [datos]="datosBarras" titulo="Opportunity score" />
        </div>
        <div class="bg-superficie rounded-xl border border-borde p-4">
          <h2 class="text-sm font-semibold text-texto mb-2">Coste por corrida</h2>
          <app-line-chart [puntos]="puntosLinea" titulo="Coste (USD)" />
        </div>
      </div>

      <app-cartera-tabla [paginas]="dashboard.pages" />
    </div>
  `,
})
export class CarteraPage {
  private readonly dashboard = generarCarteraMock();

  readonly kpis = kpisDeCartera(this.dashboard);
  readonly datosBarras = topOportunidades(this.dashboard.pages, 8).map((o) => ({
    etiqueta: o.keyword,
    valor: o.score,
  }));
  readonly puntosLinea = serieTemporalCoste(this.dashboard).map((p) => ({
    fecha: p.fecha,
    valor: p.costeUsd,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix portal run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/pages/cartera/cartera.ts
git commit -m "$(cat <<'EOF'
Portal: CarteraPage — arma la pantalla con datos de muestra

Todavía no está en app.routes.ts (próximo commit, junto con el
resto del cableado del shell).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Cablear todo — rutas, shell, `App` simplificado

**Files:**
- Modify: `portal/src/app/app.routes.ts`
- Modify: `portal/src/app/app.ts`
- Modify: `portal/src/app/app.html`
- Delete: `portal/src/app/app.css` (vacío)
- Test: `portal/src/app/app.routes.test.ts`

**Interfaces:**
- Consumes: `AppShellComponent` (Task 6), `CarteraPage` (Task 12), `authGuard` (ya existe, sin cambios).
- Produces: la app completa funcionando — `/login` sin shell, `/runs`, `/runs/:id`, `/cartera` dentro del `AppShellComponent`, protegidas por un único `authGuard` en la ruta padre.

Estado actual de `portal/src/app/app.routes.ts` (íntegro):

```ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'runs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/runs/runs').then((m) => m.RunsPage),
  },
  {
    path: 'runs/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'runs' },
  { path: '**', redirectTo: 'runs' },
];
```

Estado actual de `portal/src/app/app.ts` (post-merge de la pieza B, ya sin `ICONO`/`ETIQUETA` tras el Task 5):

```ts
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './services/auth';
import { TemaService } from './services/tema';

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

  constructor() {
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

- [ ] **Step 1: Escribir el test de topología de rutas (falla porque `app.routes.ts` todavía no tiene la ruta padre del shell)**

```ts
// portal/src/app/app.routes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from './app.routes';
import { authGuard } from './guards/auth-guard';

test('login es una ruta hermana, sin hijas — no vive dentro del shell', () => {
  const login = routes.find((r) => r.path === 'login');
  assert.ok(login, 'no encontré la ruta login');
  assert.equal(login?.children, undefined, '/login no debería tener rutas hijas de un shell');
});

test('runs, runs/:id y cartera son hijas de la ruta del shell, protegidas por authGuard', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  assert.ok(shell, 'no encontré la ruta padre del shell (path vacío con children)');
  assert.deepEqual(shell?.canActivate, [authGuard], 'el shell debe estar protegido por authGuard');
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(hijos.includes('runs'), 'runs debe ser hija del shell');
  assert.ok(hijos.includes('runs/:id'), 'runs/:id debe ser hija del shell');
  assert.ok(hijos.includes('cartera'), 'cartera debe ser hija del shell');
});

test('ninguna ruta hija repite su propio authGuard — lo hereda del padre', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  for (const hijo of shell?.children ?? []) {
    assert.equal(hijo.canActivate, undefined, `${hijo.path} no debería tener su propio canActivate`);
  }
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm --prefix portal test`
Expected: FALLA — hoy no hay ninguna ruta con `path === '' && children`.

- [ ] **Step 3: Reescribir `app.routes.ts`**

```ts
// portal/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/app-shell').then((m) => m.AppShellComponent),
    children: [
      { path: 'runs', loadComponent: () => import('./pages/runs/runs').then((m) => m.RunsPage) },
      {
        path: 'runs/:id',
        loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
      },
      {
        path: 'cartera',
        loadComponent: () => import('./pages/cartera/cartera').then((m) => m.CarteraPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'runs' },
    ],
  },
  { path: '**', redirectTo: 'runs' },
];
```

- [ ] **Step 4: Simplificar `app.ts` — el header se va al shell**

```ts
// portal/src/app/app.ts
import { Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // Si la sesión cae ESTANDO en una pantalla (el refresh falló, el token se revocó), el guard no
    // se entera —no hay navegación—. El effect sí: al quedar sin sesión, al login. En `/login` ya
    // estando deslogueado, navegar es un no-op.
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/login']);
    });
  }
}
```

- [ ] **Step 5: Simplificar `app.html`**

```html
<router-outlet />
```

- [ ] **Step 6: Borrar `app.css` (vacío, y ya no se referencia)**

```bash
git rm portal/src/app/app.css
```

- [ ] **Step 7: Correr y confirmar que el test de rutas pasa**

Run: `npm --prefix portal test`
Expected: los 3 tests de `app.routes.test.ts` en verde, y el resto de la suite (`cartera-mock.test.ts`, `cartera.test.ts`, `sidebar.test.ts`, `contraste.test.ts`, etc.) también.

- [ ] **Step 8: Suite de componentes**

Run: `npm --prefix portal run test:components`
Expected: todos los specs (`app-sidebar`, `app-header`, `backdrop`, `cartera-tabla`, y los `runs.spec.ts`/`brief.spec.ts` preexistentes) en verde. `runs.spec.ts`/`brief.spec.ts` no deberían necesitar cambios: siguen probando `RunsPage`/`BriefPage` en aislamiento, sin depender de qué los envuelve.

- [ ] **Step 9: Typecheck y build**

Run: `npm --prefix portal run typecheck && npm --prefix portal run build`
Expected: sin errores.

- [ ] **Step 10: Verificación manual en el navegador (chrome-devtools MCP)**

Levantar `npm --prefix portal start` y navegar:
- `/login` → sin sidebar, sin header nuevo (el layout propio de login, como antes).
- `/runs` → aparece el `AppShellComponent`: sidebar con Research/Cartera, header con email/Salir/toggle de tema. `RunsPage` se ve exactamente igual que antes (mismo contenido, ahora dentro del shell).
- Navegar `/runs` → `/cartera` → el sidebar **no desaparece ni parpadea** (es el mismo `AppShellComponent`, solo cambia el `<router-outlet>` interno).
- `/cartera`: los 3 KPI, los 2 charts y la tabla se ven, con datos de muestra. Cambiar el tema (claro/oscuro/auto) y confirmar que los charts cambian de color.
- Mobile (viewport angosto): el sidebar arranca oculto, el botón de hamburguesa en el header lo abre con el overlay oscuro detrás; click en el overlay o en un ítem de nav lo cierra.
- `/runs/:id` (un brief real) → mismo shell, `BriefPage` sin cambios visuales.

- [ ] **Step 11: Commit y push**

```bash
git add portal/src/app/app.routes.ts portal/src/app/app.ts portal/src/app/app.html portal/src/app/app.routes.test.ts
git rm portal/src/app/app.css
git commit -m "$(cat <<'EOF'
Portal: cablea el shell — runs/cartera dentro de AppShellComponent, login afuera

App (app.ts/app.html) deja de tener header propio: solo el
router-outlet raíz. Un único authGuard en la ruta padre protege a
runs/runs:id/cartera; login queda fuera del shell, como layout propio.
El test de topología prueba exactamente la forma del árbol de rutas,
no solo que la app "se vea bien".

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
git push origin feat/dashboard-ui-portal
```

## Self-Review

- **Cobertura del spec:** shell (Tasks 3-6, 13), `/cartera` (Tasks 7-12), sin NgRx/Firebase/SafeHtmlPipe (ningún task los usa), sin `tabs`/`modal`/`button`/`badge`/`avatar`/`dropdown`/`pagination` genéricos (no aparecen en ningún task), gráficos sin `cluster_id` y con color leído del tema (Task 10), header sobre `AuthService`/`TemaService` sin modelo `Usuario` (Task 5), comandos `--prefix portal` explícitos en cada task, Karma para lo interactivo (Tasks 3-5, 11) y `node:test` para lo puro (Tasks 2, 7, 8, 13) y para la forma de las rutas (Task 13) — cubre todo lo que el spec pedía.
- **Placeholders:** ninguno — cada Step con código o comando completo.
- **Consistencia de tipos:** `CarteraDashboard`/`ClienteCartera` (Task 7) se usan con la misma forma en `cartera.ts` (Task 8), `cartera-tabla.ts` recibe `PaginaPropuesta[]` (mismo tipo que exporta `core/models.ts`, sin redefinir), `CarteraPage` (Task 12) llama a `kpisDeCartera`/`topOportunidades`/`serieTemporalCoste` con las firmas exactas del Task 8, y a `StatBoxComponent`/`BarChartComponent`/`LineChartComponent`/`CarteraTablaComponent` con los `@Input`/`input()` exactos de los Tasks 9-11.
- **Orden de tasks:** cada uno hasta el 12 es independientemente verificable (servicio o componente probado en aislamiento, sin rutas todavía) — recién el Task 13 cablea todo, así que nunca hay un estado intermedio con un import roto a un módulo que no existe todavía.
