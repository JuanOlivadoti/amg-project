# Navegación cliente-céntrica — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todo lo que pertenece a un cliente se alcance desde su ficha —cuatro tabs como rutas
hijas— y que Research deje el menú de la plataforma.

**Architecture:** `/clientes/:id` deja de ser una hoja y pasa a ser un **shell** que carga el cliente
una vez y pinta una barra de tabs sobre un `<router-outlet>`. Cada tab es una ruta hija lazy. Las
tres pantallas de un run (brief, informe, entregable) se mudan bajo `/clientes/:id/research/:runId`.
La hoja del entregable se declara en la raíz, fuera del shell, porque es un documento para imprimir.

**Tech Stack:** Angular 20 standalone, signals, control flow `@if`/`@for`, Tailwind v4 con tokens de
color propios, tests en dos runners (`node:test` para `*.test.ts`, Karma/TestBed para `*.spec.ts`).

**Spec:** [`2026-08-11-ficha-cliente-navegacion-design.md`](../specs/2026-08-11-ficha-cliente-navegacion-design.md)

## Global Constraints

- **Solo `portal/`.** Cero cambios en `api/`, `db/`, `contrato/`. Si una tarea parece necesitar un
  endpoint nuevo, el plan está mal: parar y volver a la spec.
- **Angular 20 moderno:** control flow `@if`/`@for` (con `track`), signals, `input()`/`output()`,
  standalone. Nada de `*ngIf`, `*ngFor` ni `@Input()` decorador.
- **Nombres de dominio en español** (`cliente`, `ficha`, `resenas`). Los comentarios explican **por
  qué**, no qué.
- **Colores solo por token** (`text-texto`, `bg-superficie`, `border-borde`, `bg-accion`…). Nunca
  `text-gray-500` ni un hex: hay un test del portal que lo prohíbe en las plantillas.
- **Dos runners, dos sufijos.** `*.test.ts` corre en node (`npm --prefix portal test`) y **no puede
  importar componentes Angular sin `import '@angular/compiler'` primero**. `*.spec.ts` corre en Karma
  (`npm --prefix portal run test:components`).
- **Rojo primero, después el arreglo, después mutación:** reintroducir el bug y confirmar que cae
  *exactamente* su test.
- **Commits en español**, terminados en `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad | Tarea |
| --- | --- | --- |
| `pages/clientes/cliente-ficha.ts` **(nuevo)** | Shell: carga el cliente por `:id`, cabecera, barra de tabs, `<router-outlet>` | 1 |
| `pages/clientes/cliente-ficha.spec.ts` **(nuevo)** | Carga, redirect, no-recarga entre tabs, tabs renderizados | 1, 2, 4 |
| `pages/clientes/cliente-perfil.ts` | Solo presentación: pinta los 4 cards | 1 |
| `pages/clientes/cliente-research.ts` **(nuevo)** | Lista de runs del cliente + formulario de lanzar | 2 |
| `pages/clientes/cliente-research.spec.ts` **(nuevo)** | Gate del formulario + filtro por cliente | 2 |
| `pages/clientes/cliente-resenas.ts` **(nuevo)** | Placeholder del Bloque F | 4 |
| `pages/clientes/cliente-ideas.ts` **(nuevo)** | Placeholder de la pieza 3 | 4 |
| `app.config.ts` | `paramsInheritanceStrategy: 'always'` | 1 |
| `app.routes.ts` + `app.routes.test.ts` | La jerarquía y su contrato | 1, 2, 3, 4 |
| `shared/layout/app-sidebar.ts` + `.spec.ts` | 3 ítems en vez de 4 | 2 |
| `pages/brief/brief.ts`, `pages/informe/informe.ts`, `pages/entregable/entregable.ts` | Leen `runId`; enlazan al cliente | 3 |

**Se borran:** `pages/runs/` (tarea 2), `pages/clientes/cliente-vista.ts` + `.spec.ts` y
`core/cliente-vista-mock.ts` + `.test.ts` (tarea 4).

## Orden y por qué

Cuatro tareas. **Cada una deja el árbol verde y la app navegable** — no hay un punto intermedio con
un link roto:

1. **Shell + tab Perfil.** La barra de tabs nace con un solo tab; cada tarea siguiente agrega el suyo.
2. **Tab Research (lista).** `/runs` desaparece, así que el sidebar y la home cambian **en esta misma
   tarea**. Los enlaces de cada run siguen apuntando a `/runs/:id`, que todavía existe.
3. **El run se muda bajo el cliente.** `/runs/:id`, `/runs/:id/informe` y `/runs/:id/entregable`
   desaparecen.
4. **Tabs Reseñas e Ideas, y se retira `/clientes/:id/ver`.**

---

## Task 1: El shell de la ficha y el tab Perfil

**Files:**
- Create: `portal/src/app/pages/clientes/cliente-ficha.ts`
- Create: `portal/src/app/pages/clientes/cliente-ficha.spec.ts`
- Modify: `portal/src/app/app.config.ts:10`
- Modify: `portal/src/app/app.routes.ts:58-62`
- Modify: `portal/src/app/app.routes.test.ts`
- Modify: `portal/src/app/pages/clientes/cliente-perfil.ts` (adelgaza)
- Modify: `portal/src/app/pages/clientes/cliente-perfil.spec.ts` (se le quitan 2 tests)

**Interfaces:**
- Consumes: `ClientesService` — `cliente()` (signal `ClienteAgencia | null`), `cargando()` (signal
  `boolean`), `verCliente(id: string): Promise<void>`.
- Produces: `ClienteFichaComponent`, exportado desde `pages/clientes/cliente-ficha.ts`. Su template
  contiene el `<router-outlet>` donde montan los cuatro tabs. La constante `TABS_FICHA:
  readonly { etiqueta: string; ruta: string }[]` de ese archivo es lo que las tareas 2 y 4 amplían.

---

- [ ] **Step 1: Escribir el test que falla — el shell carga el cliente y pinta el tab Perfil**

Crear `portal/src/app/pages/clientes/cliente-ficha.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClienteFichaComponent } from './cliente-ficha';
import { ClientesService } from '../../services/clientes';
import type { ClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) del SHELL de `/clientes/:id`. Lo que fija es el contrato con
 * `ClientesService` —qué id pide y qué hace cuando el cliente no existe— más la garantía de que
 * saltar entre tabs NO vuelve a pedir el cliente: esa es la razón por la que la carga vive acá y no
 * en cada tab.
 *
 * `paramMap` es un BehaviorSubject y no un `of(...)`: hace falta poder EMITIR de nuevo para simular
 * la navegación entre tabs (Angular reutiliza la instancia del shell y `ngOnInit` no se repite).
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
    tipo: 'empresa',
    industria: 'restauración',
    etiquetas: ['premium', 'Madrid'],
    nivel_actividad: 'alto',
    estado_contrato: 'vigente',
    contrato_vence_en: null,
    score: 80,
    asignado_a: null,
    contacto: { email: 'hola@pizzanonna.es' },
    origen: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crear(cliente: ClienteAgencia | null) {
  const params = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
  const verClienteSpy = jasmine.createSpy('verCliente').and.callFake(async () => undefined);

  TestBed.configureTestingModule({
    imports: [ClienteFichaComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      {
        provide: ClientesService,
        useValue: {
          cliente: signal<ClienteAgencia | null>(cliente),
          cargando: signal(false),
          error: signal(''),
          verCliente: verClienteSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ClienteFichaComponent);
  return { fixture, router: TestBed.inject(Router), params, verClienteSpy };
}

async function estabilizar(fixture: ComponentFixture<ClienteFichaComponent>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteFichaComponent', () => {
  it('carga el cliente por id y muestra su cabecera', async () => {
    const { fixture, verClienteSpy } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    expect(verClienteSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Pizza Nonna');
    expect(el.textContent).toContain('restauración');
  });

  it('renderiza el tab Perfil apuntando a /clientes/c1/perfil', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const hrefs = [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/clientes/c1/perfil');
  });

  it('cliente no encontrado (`cliente()` queda en null tras `verCliente`): navega a /clientes', async () => {
    const { fixture, router } = crear(null);
    spyOn(router, 'navigate').and.resolveTo(true); // ANTES del primer detectChanges
    await estabilizar(fixture);

    expect(router.navigate).toHaveBeenCalledWith(['/clientes']);
  });

  it('saltar de tab NO vuelve a pedir el cliente: mismo :id, un solo verCliente', async () => {
    // El motivo de que la carga viva en el shell. Angular reutiliza la instancia y `paramMap` vuelve
    // a emitir el MISMO id al navegar entre tabs hijos; si el shell no lo filtrara, cada clic en la
    // barra de tabs dispararía un GET /clients/:id.
    const { fixture, params, verClienteSpy } = crear(clienteDePrueba());
    await estabilizar(fixture);
    params.next(convertToParamMap({ id: 'c1' }));
    await estabilizar(fixture);

    expect(verClienteSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix portal run test:components`
Expected: FAIL — `Cannot find module './cliente-ficha'` (el componente no existe todavía).

- [ ] **Step 3: Escribir el shell**

Crear `portal/src/app/pages/clientes/cliente-ficha.ts`:

```ts
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';

interface TabFicha {
  readonly etiqueta: string;
  readonly ruta: string;
}

/**
 * Los tabs de la ficha. Se amplía en las tareas 2 (Research) y 4 (Reseñas, Ideas) — y el orden acá
 * ES el orden en pantalla.
 */
export const TABS_FICHA: readonly TabFicha[] = [{ etiqueta: 'Perfil', ruta: 'perfil' }];

/**
 * Shell de `/clientes/:id`: la ficha del cliente como CONTENEDOR de sus secciones, no como pantalla.
 *
 * **La carga del cliente vive acá y no en cada tab**, y eso es lo que hace que saltar entre tabs no
 * dispare un `GET /clients/:id` por clic. Es la misma lógica que tenía `cliente-perfil.ts` antes de
 * esta refactorización, guardia de carrera incluida: se SUSCRIBE a `paramMap` (Angular reutiliza la
 * instancia al navegar de `/clientes/A/perfil` a `/clientes/B/perfil`, así que `ngOnInit` no vuelve
 * a dispararse) y compara contra `idActual` DESPUÉS del `await`, para no navegar por una respuesta
 * que ya quedó vieja.
 *
 * Los `routerLink` de los tabs se arman con la ruta ABSOLUTA (`['/clientes', id(), tab.ruta]`) y no
 * con el string relativo `tab.ruta`: el relativo funciona, pero depende de contra qué ruta activada
 * se resuelve, y eso es exactamente el tipo de magia que se rompe en silencio cuando alguien anida
 * un nivel más.
 */
@Component({
  selector: 'app-cliente-ficha',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, PageBreadcrumbComponent],
  template: `
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      @if (clientesService.cliente(); as cliente) {
        <app-page-breadcrumb [titulo]="cliente.nombre" rutaAtras="/clientes" etiquetaAtras="Clientes" />

        <div class="flex items-center gap-4">
          <div
            class="w-16 h-16 rounded-lg bg-superficie-2 flex items-center justify-center text-2xl font-bold text-texto-medio"
          >
            {{ cliente.nombre.charAt(0).toUpperCase() }}
          </div>
          <div>
            <h1 class="text-2xl font-bold text-texto">{{ cliente.nombre }}</h1>
            @if (cliente.industria) {
              <p class="text-sm text-texto-tenue mt-1">{{ cliente.industria }}</p>
            }
          </div>
        </div>

        @if (cliente.etiquetas && cliente.etiquetas.length > 0) {
          <div class="flex flex-wrap gap-2">
            @for (etiqueta of cliente.etiquetas; track etiqueta) {
              <span class="rounded-full bg-superficie-2 text-texto-medio px-3 py-1 text-xs font-medium">
                {{ etiqueta }}
              </span>
            }
          </div>
        }

        <div class="border-b border-borde">
          <nav class="-mb-px flex gap-8">
            @for (tab of tabs; track tab.ruta) {
              <a
                [routerLink]="['/clientes', id(), tab.ruta]"
                routerLinkActive="border-accion text-texto"
                class="pb-3 px-1 border-b-2 border-transparent text-texto-tenue font-medium text-sm hover:text-texto"
              >
                {{ tab.etiqueta }}
              </a>
            }
          </nav>
        </div>

        <router-outlet />
      } @else if (clientesService.cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      }
    </div>
  `,
})
export class ClienteFichaComponent implements OnInit, OnDestroy {
  readonly clientesService = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = TABS_FICHA;
  /** El `:id` de la URL, para armar los `routerLink` de los tabs. */
  readonly id = signal('');

  private sub: Subscription | null = null;
  /** A qué `:id` corresponde el último pedido — para no repetirlo si `paramMap` emite sin cambios. */
  private idActual = '';

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.idActual) return;
      this.idActual = id;
      this.id.set(id);
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async cargar(id: string): Promise<void> {
    if (!id) {
      await this.router.navigate(['/clientes']);
      return;
    }
    await this.clientesService.verCliente(id);
    // Si mientras tanto se navegó a OTRO :id, esa carga más nueva ya está en curso (o resuelta):
    // no toques nada acá, la suscripción de esa carga hace su propio chequeo.
    if (id !== this.idActual) return;
    if (!this.clientesService.cliente()) {
      // 404 (no existe / es de otro tenant) o cualquier otro fallo al traerlo.
      await this.router.navigate(['/clientes']);
    }
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix portal run test:components`
Expected: PASS — los 4 tests de `ClienteFichaComponent` en verde.

- [ ] **Step 5: Adelgazar `cliente-perfil.ts`**

Reemplazar el contenido de `portal/src/app/pages/clientes/cliente-perfil.ts` por:

```ts
import { Component, inject } from '@angular/core';
import { ClientesService } from '../../services/clientes';
import { ClienteInfoCardComponent } from './cliente-info-card';
import { ClienteDireccionCardComponent } from './cliente-direccion-card';
import { ClienteMetaCardComponent } from './cliente-meta-card';
import { ClienteRecursosCardComponent } from './cliente-recursos-card';

/**
 * Tab `/clientes/:id/perfil`: los cuatro cards editables del CRM.
 *
 * **No carga nada.** El cliente lo pide el shell (`cliente-ficha.ts`) una sola vez para los cuatro
 * tabs; acá solo se lee. Antes esta pantalla tenía la suscripción a `paramMap`, el redirect y la
 * guardia de carrera: todo eso subió al shell cuando la ficha pasó a tener tabs. Si algún día este
 * componente vuelve a necesitar el `:id`, sale de `route.paramMap` gracias a
 * `paramsInheritanceStrategy: 'always'` (ver `app.config.ts`) — no hace falta volver a cargar.
 *
 * El `@if` sobre `cliente()` es defensa, no lógica: el shell no monta el outlet sin cliente, pero un
 * componente que asume que su padre ya validó algo es un componente que se rompe cuando alguien
 * cambia el padre.
 */
@Component({
  selector: 'app-cliente-perfil',
  imports: [
    ClienteInfoCardComponent,
    ClienteDireccionCardComponent,
    ClienteMetaCardComponent,
    ClienteRecursosCardComponent,
  ],
  template: `
    @if (clientesService.cliente(); as cliente) {
      <div class="space-y-6">
        <app-cliente-info-card [cliente]="cliente" />
        <app-cliente-direccion-card [cliente]="cliente" />
        <app-cliente-meta-card [cliente]="cliente" />
        <app-cliente-recursos-card [cliente]="cliente" />
      </div>
    }
  `,
})
export class ClientePerfilPage {
  readonly clientesService = inject(ClientesService);
}
```

- [ ] **Step 6: Repartir `cliente-perfil.spec.ts`**

En `portal/src/app/pages/clientes/cliente-perfil.spec.ts`:

1. **Borrar** los dos tests que ahora pertenecen al shell:
   - `'carga el cliente por id (llama a ClientesService.verCliente) y lo muestra'` (líneas 94-103)
   - `'cliente no encontrado (`cliente()` queda en null tras `verCliente`): navega a /clientes'`
     (líneas 105-111)
2. **Quitar** de la firma de `crear()` el `router` que devuelve y el provider de `ActivatedRoute`
   (el componente ya no lo inyecta), y quitar `verClienteSpy` de `Mocks`.
3. **Añadir** al `describe`, en reemplazo del test de carga que se fue, uno que fije la nueva
   frontera:

```ts
  it('NO pide el cliente: cargarlo es del shell (cliente-ficha), no del tab', async () => {
    // Si este tab volviera a pedir el cliente, cada clic en la barra de tabs dispararía un GET.
    // Se afirma el CONTRATO observable —que no llama al servicio— y no la ausencia de `ngOnInit`,
    // que es un detalle de implementación y no diría nada si mañana la carga se mueve a un `effect`.
    const { fixture, mocks } = crear(clienteDePrueba());
    await estabilizar(fixture);

    expect(mocks.verClienteSpy).not.toHaveBeenCalled();
  });
```

`verClienteSpy` se conserva en `Mocks` y en el provider **solo para esto**: el componente ya no lo
llama, y ese es justamente el hecho que el test fija.

Los cuatro tests de los cards (Información, Dirección, Meta, Recursos) **se quedan tal cual**: siguen
probando el riesgo que fijaban —que cada card mande el `contacto` mergeado y no parcial— y ese
contrato no cambió.

- [ ] **Step 7: Añadir `paramsInheritanceStrategy` y su test**

Este es el paso que hace posible todo lo demás. Con el default (`'emptyOnly'`), una ruta hija con
path **no vacío** —`perfil`, `research`, `research/:runId`— **no hereda los parámetros del padre**, y
el tab Research nunca vería el `:id` del cliente.

Modificar `portal/src/app/app.config.ts`:

```ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    /*
     * `paramsInheritanceStrategy: 'always'` NO es cosmético: con el default (`'emptyOnly'`) una ruta
     * hija de path no vacío no ve los parámetros de su padre, así que `/clientes/:id/research` no
     * tendría `:id` en su `paramMap` y el tab no sabría de qué cliente está hablando. El modo de
     * fallo es silencioso —`params.get('id')` devuelve `null`, la pantalla se queda vacía— y por eso
     * lo cubre un test en `app.routes.test.ts`.
     */
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
  ],
};
```

Añadir a `portal/src/app/app.routes.test.ts`:

```ts
import { readFileSync } from 'node:fs';

test('el router hereda los params del padre: sin esto, /clientes/:id/research no ve el :id', () => {
  /*
   * Se lee el FUENTE y no se inspecciona el provider porque `provideRouter(routes, withRouterConfig(...))`
   * devuelve un `EnvironmentProviders` opaco: su configuración no se puede leer sin arrancar el
   * router. Es el mismo patrón que usa `core/sin-html-crudo.test.ts` para barrer plantillas.
   *
   * Lo que se protege es una garantía SILENCIOSA: con el default `'emptyOnly'`, `params.get('id')`
   * en un tab devuelve `null` y la pantalla se queda vacía sin un solo error en consola.
   */
  const fuente = readFileSync(new URL('./app.config.ts', import.meta.url), 'utf8');
  assert.match(
    fuente,
    /paramsInheritanceStrategy:\s*'always'/,
    "app.config.ts debe pasar `withRouterConfig({ paramsInheritanceStrategy: 'always' })`",
  );
});
```

Y el test de comportamiento que lo respalda, en `cliente-research.spec.ts` cuando exista (tarea 2):
el spec provee su propio `ActivatedRoute` con `{ id: 'c1' }`, así que **prueba el componente, no la
herencia**. La herencia real se comprueba en el navegador (paso 11) navegando a
`/clientes/<id>/research` y viendo que la lista no sale vacía.

- [ ] **Step 8: Cablear las rutas**

En `portal/src/app/app.routes.ts`, reemplazar el bloque de `clientes/:id` y `clientes/:id/ver`
(líneas 58-67) por:

```ts
      {
        /*
         * La ficha es un SHELL con tabs, no una pantalla: carga el cliente una vez y sus hijas se
         * montan en su `<router-outlet>`. Va DESPUÉS de `clientes/nuevo` y eso sí es load-bearing:
         * `:id` empareja la palabra literal "nuevo" y se tragaría el alta. Hay un test.
         */
        path: 'clientes/:id',
        loadComponent: () =>
          import('./pages/clientes/cliente-ficha').then((m) => m.ClienteFichaComponent),
        children: [
          {
            path: 'perfil',
            loadComponent: () =>
              import('./pages/clientes/cliente-perfil').then((m) => m.ClientePerfilPage),
          },
          { path: '', pathMatch: 'full', redirectTo: 'perfil' },
        ],
      },
```

`clientes/:id/ver` **se queda por ahora** (se retira en la tarea 4): moverlo acá sin haber construido
los tabs que lo reemplazan dejaría un agujero navegable.

- [ ] **Step 9: Extender `app.routes.test.ts`**

Añadir:

```ts
test('clientes/nuevo se declara ANTES que clientes/:id — si no, :id se traga la palabra "nuevo"', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  const iNuevo = hijos.indexOf('clientes/nuevo');
  const iFicha = hijos.indexOf('clientes/:id');
  assert.ok(iNuevo >= 0, 'no encontré clientes/nuevo');
  assert.ok(iFicha >= 0, 'no encontré clientes/:id');
  assert.ok(iNuevo < iFicha, 'clientes/nuevo debe declararse antes que clientes/:id');
});

test('clientes/:id es un shell con tabs: carga la ficha y redirige a perfil por defecto', async () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  assert.ok(ficha, 'clientes/:id debe ser hija del shell');
  assert.ok(ficha?.children, 'clientes/:id debe tener rutas hijas (los tabs)');

  const cargado = await ficha?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'ClienteFichaComponent');

  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.includes('perfil'), 'el tab perfil debe existir');

  const porDefecto = (ficha?.children ?? []).find((r) => r.path === '');
  assert.equal(porDefecto?.redirectTo, 'perfil');
  assert.equal(porDefecto?.pathMatch, 'full');
});
```

Y **extender** el test existente `'ninguna ruta hija repite su propio authGuard — lo hereda del
padre'` (líneas 42-47) para que baje también a los nietos, que antes no existían:

```ts
test('ninguna ruta hija ni nieta repite su propio authGuard — lo hereda del padre', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  for (const hijo of shell?.children ?? []) {
    assert.equal(hijo.canActivate, undefined, `${hijo.path} no debería tener su propio canActivate`);
    for (const nieto of hijo.children ?? []) {
      assert.equal(
        nieto.canActivate,
        undefined,
        `${hijo.path}/${nieto.path} no debería tener su propio canActivate`,
      );
    }
  }
});
```

- [ ] **Step 10: Verificar por mutación el test del orden**

Invertir a mano en `app.routes.ts` el orden de `clientes/nuevo` y `clientes/:id`.
Run: `npm --prefix portal test`
Expected: cae **exactamente** `'clientes/nuevo se declara ANTES que clientes/:id'` y ningún otro.
Devolver el orden correcto y confirmar verde.

- [ ] **Step 11: Verificación completa y navegador**

```bash
npm run verificar -- --con-portal
npm run dev:server -w api    # en otra terminal: npm --prefix portal start
```

En el navegador: `/clientes` → clic en un cliente → cae en `/clientes/<id>/perfil` con el tab Perfil
activo (subrayado) → editar un card y guardar → volver a `/clientes` con el breadcrumb.

- [ ] **Step 12: Commit**

```bash
git add portal/src/app/pages/clientes/cliente-ficha.ts \
        portal/src/app/pages/clientes/cliente-ficha.spec.ts \
        portal/src/app/pages/clientes/cliente-perfil.ts \
        portal/src/app/pages/clientes/cliente-perfil.spec.ts \
        portal/src/app/app.config.ts \
        portal/src/app/app.routes.ts \
        portal/src/app/app.routes.test.ts
git commit -m "$(cat <<'EOF'
La ficha del cliente pasa a ser un shell con tabs

`/clientes/:id` carga el cliente UNA vez y monta sus secciones en un
outlet; el perfil queda como el primer tab, sin lógica de carga.

`paramsInheritanceStrategy: 'always'` no es cosmético: sin él una ruta
hija de path no vacío no ve el `:id` del padre, y los tabs que vienen
no sabrían de qué cliente hablan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: El tab Research, y Research sale del menú

**Files:**
- Create: `portal/src/app/pages/clientes/cliente-research.ts` (desde `pages/runs/runs.ts`)
- Create: `portal/src/app/pages/clientes/cliente-research.spec.ts` (desde `pages/runs/runs.spec.ts`)
- Delete: `portal/src/app/pages/runs/runs.ts`, `portal/src/app/pages/runs/runs.spec.ts`
- Modify: `portal/src/app/pages/clientes/cliente-ficha.ts` (constante `TABS_FICHA`)
- Modify: `portal/src/app/pages/clientes/cliente-ficha.spec.ts`
- Modify: `portal/src/app/app.routes.ts`, `portal/src/app/app.routes.test.ts`
- Modify: `portal/src/app/shared/layout/app-sidebar.ts`, `app-sidebar.spec.ts`

**Interfaces:**
- Consumes: `ClienteFichaComponent` y `TABS_FICHA` (tarea 1). `ApiService.listarRuns(clientId?:
  string): Promise<RunSummary[]>` y `ApiService.crearRun({ clientId, prompt }): Promise<string>`, ya
  existentes. `mostrarLanzarResearch(esEquipo: boolean, flag: boolean): boolean` de `core/features`.
- Produces: `ClienteResearchPage`, exportada desde `pages/clientes/cliente-research.ts`. Enlaza cada
  run a `['/runs', run.id]` — la tarea 3 lo cambia a `['/clientes', id(), 'research', run.id]`.

---

- [ ] **Step 1: Escribir el test que falla — el filtro por cliente**

Crear `portal/src/app/pages/clientes/cliente-research.spec.ts`. Los tres tests del gate del
formulario se copian de `runs.spec.ts` (cambian el nombre de la clase y el `ActivatedRoute`), y el
cuarto es el nuevo:

```ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ClienteResearchPage } from './cliente-research';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { environment } from '../../../environments/environment';

/**
 * Test de componente (Karma) del tab `/clientes/:id/research`. Hereda de `runs.spec.ts` el gate del
 * formulario de lanzar (§A.5) y añade lo que da sentido a la mudanza: que la lista pida SOLO los
 * runs de este cliente, y que lanzar no necesite que nadie pegue un UUID a mano.
 */
function crear(esEquipo: boolean, flag: boolean) {
  const listarRunsSpy = jasmine.createSpy('listarRuns').and.resolveTo([]);
  const crearRunSpy = jasmine.createSpy('crearRun').and.resolveTo('run-1');
  environment.features.lanzarResearch = flag;

  TestBed.configureTestingModule({
    imports: [ClienteResearchPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'c1' })) } },
      { provide: ApiService, useValue: { listarRuns: listarRunsSpy, crearRun: crearRunSpy } },
      { provide: MembresiaService, useValue: { esEquipo: signal(esEquipo) } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteResearchPage);
  return { fixture, listarRunsSpy, crearRunSpy };
}

describe('ClienteResearchPage', () => {
  it('pide SOLO los runs de este cliente', async () => {
    const { fixture, listarRunsSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listarRunsSpy).toHaveBeenCalledWith('c1');
  });

  it('lanzar research toma el cliente de la ruta, sin input de UUID', async () => {
    const { fixture, crearRunSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // El input del UUID ya no existe: si vuelve, este test lo caza.
    expect(el.querySelector('input[name="clientId"]')).toBeNull();

    const prompt = el.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!;
    prompt.value = 'Hamburguesería gourmet en Madrid centro';
    prompt.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(crearRunSpy).toHaveBeenCalledWith({
      clientId: 'c1',
      prompt: 'Hamburguesería gourmet en Madrid centro',
    });
  });

  it('Fase 1 (equipo, flag apagado): el formulario NO se renderiza', () => {
    const { fixture } = crear(true, false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });

  it('dev/Fase 2 (equipo, flag encendido): el formulario SÍ se renderiza', () => {
    const { fixture } = crear(true, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
  });

  it('cliente (no equipo): no se renderiza ni con el flag encendido', () => {
    const { fixture } = crear(false, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm --prefix portal run test:components`
Expected: FAIL — `Cannot find module './cliente-research'`.

- [ ] **Step 3: Crear `cliente-research.ts` desde `runs.ts`**

`git mv portal/src/app/pages/runs/runs.ts portal/src/app/pages/clientes/cliente-research.ts` y aplicar
estos cambios (el resto del archivo —`ETIQUETA`, `estadoClase`, `usd`, el listado— queda igual):

1. Renombrar la clase a `ClienteResearchPage` y el selector a `app-cliente-research`.
2. Inyectar la ruta y leer el cliente:

```ts
  private readonly route = inject(ActivatedRoute);
  /** El cliente del que es esta pantalla. Viene del `:id` del shell — ver `paramsInheritanceStrategy`. */
  readonly clienteId = signal('');
```

3. Reemplazar `ngOnInit` por la suscripción (el shell puede reutilizar la instancia si algún día se
   navega entre clientes sin desmontar el tab):

```ts
  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.clienteId()) return;
      this.clienteId.set(id);
      this.runs.set([]);
      void this.cargar();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
```

   con `private sub: Subscription | null = null;` y `implements OnInit, OnDestroy`.

4. En `cargar()`, pasar el filtro:

```ts
      this.runs.set(await this.api.listarRuns(this.clienteId()));
```

5. Borrar el signal `clientId` y el `<input name="clientId">` del template. En `lanzar()`:

```ts
  async lanzar(): Promise<void> {
    if (!this.prompt()) return;
    this.lanzando.set(true);
    this.error.set('');
    try {
      await this.api.crearRun({ clientId: this.clienteId(), prompt: this.prompt() });
      this.prompt.set('');
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.lanzando.set(false);
    }
  }
```

6. Quitar el `<div class="max-w-3xl mx-auto px-4 py-8 space-y-8">` que envuelve el template: ahora
   está dentro del contenedor del shell y anidar dos `max-w` produce una columna más angosta de lo
   que nadie pidió. Dejar `<div class="space-y-8">`.
7. Quitar el `<h2>Research</h2>` del listado: el tab activo ya dice dónde estás.

Borrar `portal/src/app/pages/runs/runs.spec.ts` (sus tres tests viven ahora en el spec nuevo) y la
carpeta `pages/runs/` si queda vacía.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm --prefix portal run test:components`
Expected: PASS — los 5 tests de `ClienteResearchPage`.

- [ ] **Step 5: Añadir el tab y su ruta**

En `cliente-ficha.ts`:

```ts
export const TABS_FICHA: readonly TabFicha[] = [
  { etiqueta: 'Perfil', ruta: 'perfil' },
  { etiqueta: 'Research', ruta: 'research' },
];
```

En `app.routes.ts`, dentro de `children` de `clientes/:id`, **antes** del redirect:

```ts
          {
            path: 'research',
            loadComponent: () =>
              import('./pages/clientes/cliente-research').then((m) => m.ClienteResearchPage),
          },
```

Y **quitar** la ruta `runs` (la lista global) de los hijos del shell. `runs/:id` y `runs/:id/informe`
**se quedan**: la lista sigue enlazando ahí hasta la tarea 3.

En `cliente-ficha.spec.ts`, extender el test de los tabs:

```ts
  it('renderiza los tabs Perfil y Research apuntando al cliente de la ruta', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const hrefs = [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/clientes/c1/perfil');
    expect(hrefs).toContain('/clientes/c1/research');
  });
```

- [ ] **Step 6: Sacar Research del sidebar y cambiar la home**

En `shared/layout/app-sidebar.ts`: borrar el ítem `{ etiqueta: 'Research', ruta: '/runs', icono:
'research' }` de `ITEMS_NAV`, el `'research'` de la unión de `icono`, y su `@case ('research')` con el
SVG de la lupa.

En `app.routes.ts`, los dos redirects a `runs`:

```ts
      { path: '', pathMatch: 'full', redirectTo: 'clientes' },
```

```ts
  { path: '**', redirectTo: 'clientes' },
```

En `app-sidebar.spec.ts`, ajustar el `provideRouter` (quitar `{ path: 'runs', children: [] }`) y el
primer test:

```ts
  it('renderiza los ítems de navegación', () => {
    const el = render().nativeElement as HTMLElement;
    // Research YA NO está: el research de un cliente se alcanza desde su ficha, no desde el menú.
    expect(el.textContent).not.toContain('Research');
    expect(el.textContent).toContain('Cartera');
    expect(el.textContent).toContain('Clientes');
    expect(el.textContent).toContain('Usuarios');
  });
```

En `app.routes.test.ts`, el test `'runs, runs/:id y cartera son hijas…'` pasa a:

```ts
test('la lista global de runs ya no existe; runs/:id y cartera siguen siendo hijas del shell', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  assert.ok(shell, 'no encontré la ruta padre del shell (path vacío con children)');
  assert.deepEqual(shell?.canActivate, [authGuard], 'el shell debe estar protegido por authGuard');
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(!hijos.includes('runs'), 'la lista global de runs se retiró: vive en el tab del cliente');
  assert.ok(hijos.includes('runs/:id'), 'runs/:id sigue siendo hija del shell (se muda en la tarea 3)');
  assert.ok(hijos.includes('cartera'), 'cartera debe ser hija del shell');
});
```

y en `'usuarios y usuarios/:id…'`, el default de la home:

```ts
  // El default cambió de `runs` a `clientes` cuando Research dejó el menú: la home del portal es
  // ahora la cartera de clientes, que es por donde empieza cualquier recorrido.
  assert.equal(raiz?.redirectTo, 'clientes');
```

- [ ] **Step 7: Verificar por mutación el filtro por cliente**

Cambiar a mano `this.api.listarRuns(this.clienteId())` por `this.api.listarRuns()`.
Run: `npm --prefix portal run test:components`
Expected: cae **exactamente** `'pide SOLO los runs de este cliente'`. Restaurar y confirmar verde.

- [ ] **Step 8: Verificación completa y navegador**

```bash
npm run verificar -- --con-portal
```

En el navegador: el sidebar tiene **3** ítems · la home abre en `/clientes` · ficha → tab Research →
la lista muestra solo los runs de ese cliente · lanzar uno sin pegar ningún UUID · clic en un run
lleva a `/runs/<id>` (todavía; se muda en la tarea 3).

- [ ] **Step 9: Commit**

```bash
git add -A portal/src/app
git commit -m "$(cat <<'EOF'
El research de un cliente se alcanza desde su ficha

Nuevo tab `/clientes/:id/research`: la lista filtrada por cliente y el
formulario de lanzar sin el input donde había que pegar el UUID a mano.
Research deja el menú y la home del portal pasa a ser /clientes.

El filtro `GET /runs?clientId=` ya existía de punta a punta; lo único
que faltaba era que alguien se lo pasara.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: El run se muda bajo el cliente

**Files:**
- Modify: `portal/src/app/app.routes.ts`, `portal/src/app/app.routes.test.ts`
- Modify: `portal/src/app/pages/brief/brief.ts` (líneas 22, 57, 104, 334-346)
- Modify: `portal/src/app/pages/brief/brief.spec.ts`
- Modify: `portal/src/app/pages/informe/informe.ts` (líneas 39, 230-244)
- Modify: `portal/src/app/pages/entregable/entregable.ts` (líneas 67, 107, 298-311)
- Modify: `portal/src/app/pages/clientes/cliente-research.ts` (el `routerLink` de cada run)

**Interfaces:**
- Consumes: la ruta `clientes/:id/research` de la tarea 2. `Brief` de `core/models`, cuyo
  `brief.run.client_id: string` es el dato con el que se detecta el mismatch.
- Produces: las rutas `clientes/:id/research/:runId`, `clientes/:id/research/:runId/informe` y
  `clientes/:id/research/:runId/entregable` (esta última en la raíz).

**El cambio silencioso de esta tarea:** los tres componentes leen hoy `params.get('id')` esperando el
RUN. Bajo la ruta nueva ese `id` es el CLIENTE. Los tres pasan a `params.get('runId')`, y usan
`params.get('id')` para armar los enlaces de vuelta.

---

- [ ] **Step 1: Escribir el test que falla — el brief detecta el cliente equivocado**

En `portal/src/app/pages/brief/brief.spec.ts`, primero **extender `renderFixture`** (línea 75) para
que acepte los parámetros de ruta, que hasta ahora estaban clavados en `{ id: 'run-1' }` (línea 89):

```ts
  async function renderFixture(
    esEquipo: boolean,
    aprobarHabilitado: boolean,
    brief: Brief = BRIEF,
    api: ApiDoble = {},
    // El run vive bajo su cliente: la ruta lleva DOS parámetros y el componente los distingue.
    // `c1` es el `client_id` de `BRIEF`, así que por defecto coinciden y nada redirige.
    params: { id: string; runId: string } = { id: 'c1', runId: 'run-1' },
  ): Promise<ComponentFixture<BriefPage>> {
```

y en su lista de providers:

```ts
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(params)) } },
```

Los otros dos usos de `convertToParamMap` del archivo (líneas 353 y 387, el `BehaviorSubject` que
prueba el cambio de run) pasan de `{ id: 'run-1' }` / `{ id: 'run-2' }` a
`{ id: 'c1', runId: 'run-1' }` / `{ id: 'c1', runId: 'run-2' }`.

Recién entonces, el test nuevo:

```ts
  it('run de OTRO cliente que el de la URL: corrige la URL a la ficha del dueño', async () => {
    // RLS impide ver runs de otro TENANT, pero no impide abrir /clientes/<A>/research/<run-de-B>
    // dentro del mismo tenant: la API devolvería el brief bueno y la cabecera diría el cliente
    // equivocado. No es una fuga; es una pantalla que miente sobre de quién es el trabajo.
    TestBed.resetTestingModule();
    const fixture = await renderFixture(true, true, BRIEF, {}, { id: 'otro-cliente', runId: 'run-1' });
    const router = TestBed.inject(Router);
    const navegar = spyOn(router, 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // `BRIEF.run.client_id` es 'c1' y la URL dice 'otro-cliente'.
    expect(navegar).toHaveBeenCalledWith(['/clientes', 'c1', 'research', 'run-1']);
  });
```

> El `spyOn` va después de `renderFixture` porque ese helper ya hace `detectChanges()` adentro; si la
> redirección resultara dispararse antes de instalar el spy, extraer una variante de `renderFixture`
> que no llame a `detectChanges` (mismo criterio que `crear()` en `cliente-perfil.spec.ts`, que
> existe justamente para poder espiar el router antes del primer ciclo).

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm --prefix portal run test:components`
Expected: FAIL — `router.navigate` no fue llamado (el componente todavía no compara nada).

- [ ] **Step 3: Cambiar `brief.ts`**

En `ngOnInit`, leer los dos parámetros:

```ts
  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      // OJO: `id` es el CLIENTE y `runId` el run. Antes de que el run se mudara bajo la ficha, `id`
      // era el run — leerlo mal acá pide el brief de un uuid de cliente y devuelve 404.
      this.clienteId.set(params.get('id') ?? '');
      const id = params.get('runId') ?? '';
      if (id === this.runId) return;
      this.vigencia.cambiarA(id);
      this.pararPolling();
      this.brief.set(null);
      this.editando.set(null);
      this.error.set('');
      this.rechazadoSinWorkflow.set(false);
      void this.cargar();
    });
  }
```

con `readonly clienteId = signal('');` junto a los demás signals.

Al final de `cargar()`, después de asignar el brief, añadir la conciliación:

```ts
    // El `:id` de la URL y el dueño real del run son dos afirmaciones independientes: nada obliga a
    // que coincidan. Si no coinciden, la cabecera de la ficha estaría diciendo un cliente y el
    // contenido perteneciendo a otro — en una agencia con cartera, eso es un error de facturación
    // esperando. Se corrige la URL, no se oculta el run.
    const duenio = this.brief()?.run.client_id;
    if (duenio && duenio !== this.clienteId()) {
      await this.router.navigate(['/clientes', duenio, 'research', this.runId]);
      return;
    }
```

inyectando `private readonly router = inject(Router);`.

Y los tres `routerLink` del template:

```html
      <a [routerLink]="['/clientes', clienteId(), 'research']" class="text-sm text-texto-tenue hover:text-texto">← Volver</a>
```

```html
            [routerLink]="['/clientes', clienteId(), 'research', b.run.id, 'informe']"
```

```html
                [routerLink]="['/clientes', clienteId(), 'research', b.run.id, 'entregable']"
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm --prefix portal run test:components`
Expected: PASS.

- [ ] **Step 5: Cambiar `informe.ts` y `entregable.ts`**

En los dos, dentro de `ngOnInit`: añadir `this.clienteId.set(params.get('id') ?? '');` como primera
línea y cambiar `const id = params.get('id') ?? '';` por `const id = params.get('runId') ?? '';`. En
los dos, añadir `readonly clienteId = signal('');`.

Los `routerLink` de vuelta al brief:

- `informe.ts:39` → `[routerLink]="['/clientes', clienteId(), 'research', runId()]"`
- `entregable.ts:67` y `:107` → `[routerLink]="['/clientes', clienteId(), 'research', runId()]"`

Y sus specs, que clavan el paramMap viejo — **si se olvidan, los tests pasan a cargar el run `null` y
fallan con un mensaje que no dice por qué**:

- `informe.spec.ts:49`: `convertToParamMap({ id: 'run-1' })` → `convertToParamMap({ id: 'c1', runId: 'run-1' })`
- `entregable.spec.ts:58`: igual.
- `entregable.spec.ts:249` y `:272` (el `BehaviorSubject` que prueba el cambio de run):
  `{ id: 'run-1' }` → `{ id: 'c1', runId: 'run-1' }` y `{ id: 'run-2' }` → `{ id: 'c1', runId: 'run-2' }`.

Ninguno de los dos necesita la conciliación de cliente que sí lleva el brief: se llega a ellos desde
el brief, que ya la hizo. Anotarlo en un comentario donde leen `clienteId`, para que el próximo que
pase no crea que es un olvido.

- [ ] **Step 6: Cambiar el enlace de cada run en la lista**

En `cliente-research.ts`:

```html
                  [routerLink]="['/clientes', clienteId(), 'research', run.id]"
```

- [ ] **Step 7: Mover las rutas**

En `app.routes.ts`: **borrar** las hijas `runs/:id` y `runs/:id/informe` del shell, y **borrar** la
ruta de raíz `runs/:id/entregable`.

Dentro de `children` de `clientes/:id`, después de `research`:

```ts
          {
            path: 'research/:runId',
            loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
          },
          {
            // Va DESPUÉS de `research/:runId` por legibilidad, no por precedencia: el router no hace
            // prefijo parcial con una ruta sin hijas, así que `research/x/informe` no lo puede
            // atrapar `research/:runId`.
            path: 'research/:runId/informe',
            loadComponent: () => import('./pages/informe/informe').then((m) => m.InformePage),
          },
```

Y en la **raíz**, reemplazando la vieja ruta del entregable (manteniendo su comentario, con el path
actualizado):

```ts
  {
    /*
     * El entregable del restaurante cuelga de la RAÍZ, no del shell, y el orden acá **sí** es
     * load-bearing: tiene que ir ANTES de la ruta `''`, que intenta emparejar todo lo demás.
     *
     * Fuera del shell porque es una HOJA, no una pantalla: sin sidebar, sin header y sin el
     * `lg:pl-64` del contenedor. La spec pedía eso «con `@media print`»; sacarlo del shell lo hace
     * verdad de estructura en vez de verdad de CSS. Anidarlo bajo la ficha del cliente lo devolvería
     * al shell y reintroduciría los bugs de impresión — por eso lleva la URL del cliente pero no su
     * jerarquía.
     *
     * Lleva `authGuard` propio: al salir del shell, deja de heredar el suyo. Sin esta línea la hoja
     * sería alcanzable sin sesión (la API igual respondería 401, pero la pantalla sería una promesa
     * rota en vez de un redirect al login).
     */
    path: 'clientes/:id/research/:runId/entregable',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/entregable/entregable').then((m) => m.EntregablePage),
  },
```

- [ ] **Step 8: Actualizar `app.routes.test.ts`**

Reemplazar los dos tests que nombran `runs/:id`:

```ts
test('las tres pantallas de un run cuelgan del cliente; la lista global de runs ya no existe', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(!hijos.includes('runs'), 'la lista global de runs se retiró');
  assert.ok(!hijos.includes('runs/:id'), 'el brief se mudó bajo el cliente');
  assert.ok(!hijos.includes('runs/:id/informe'), 'el informe se mudó bajo el cliente');

  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.includes('research/:runId'), 'el brief debe colgar del tab research');
  assert.ok(tabs.includes('research/:runId/informe'), 'el informe debe colgar del brief');
});

test('el informe hereda el authGuard del shell y carga la pantalla del informe', async () => {
  // El informe lleva el desglose de lo que la agencia le paga a DataForSEO. Que la ruta cuelgue del
  // shell no es lo que lo protege —eso lo hace la política `informe_staff` (0016) dentro de
  // Postgres— pero una ruta fuera del shell quedaría sin authGuard.
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const informe = (ficha?.children ?? []).find((r) => r.path === 'research/:runId/informe');
  assert.ok(informe, 'no encontré la ruta del informe');
  assert.equal(informe?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');

  const cargado = await informe?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'InformePage');
});

test('el entregable vive en la RAÍZ con la URL del cliente, y lleva su propio authGuard', () => {
  // Fuera del shell para poder imprimirse (sin sidebar `fixed`, sin `lg:pl-64`), pero con la URL
  // anidada para que el enlace sea coherente con el resto. Las dos cosas a la vez, a propósito.
  const i = routes.findIndex((r) => r.path === 'clientes/:id/research/:runId/entregable');
  const iShell = routes.findIndex((r) => r.path === '' && r.children);
  assert.ok(i >= 0, 'no encontré la ruta del entregable en la raíz');
  assert.ok(i < iShell, 'el entregable debe declararse ANTES de la ruta del shell');
  assert.deepEqual(routes[i]?.canActivate, [authGuard], 'fuera del shell no hereda: necesita el suyo');
});
```

- [ ] **Step 9: Verificar por mutación los dos riesgos de esta tarea**

Mutación A — el parámetro: en `brief.ts`, volver a `params.get('id')` para el run.
Run: `npm --prefix portal run test:components` → deben caer los tests del brief que cargan por
`runId`. Restaurar.

Mutación B — la conciliación: borrar el bloque del `duenio` en `cargar()`.
Run: `npm --prefix portal run test:components` → cae **exactamente** `'run de OTRO cliente que el de
la URL: redirige a la ficha correcta'`. Restaurar y confirmar verde.

- [ ] **Step 10: Verificación completa y navegador**

```bash
npm run verificar -- --con-portal
```

Recorrido: ficha → Research → abrir un run → `/clientes/<id>/research/<run>` → informe → volver →
entregable → **comprobar que la hoja no tiene sidebar** y que imprimir (Cmd+P) da una hoja limpia →
back del navegador en cada salto → escribir a mano `/clientes/<OTRO-cliente>/research/<run>` y
comprobar que la URL se corrige sola.

- [ ] **Step 11: Commit**

```bash
git add -A portal/src/app
git commit -m "$(cat <<'EOF'
Las tres pantallas de un run cuelgan de su cliente

`/clientes/:id/research/:runId` y su informe; el entregable conserva la
URL anidada pero se queda FUERA del shell, que es lo que lo hace
imprimible. Se retiran las rutas `/runs/*`.

Con dos parámetros en la URL, el cliente y el dueño real del run son dos
afirmaciones independientes: el brief las concilia y corrige la URL en
vez de mostrar la cabecera de un cliente sobre el trabajo de otro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Los tabs Reseñas e Ideas, y se retira "Mi Portal"

**Files:**
- Create: `portal/src/app/pages/clientes/cliente-resenas.ts`
- Create: `portal/src/app/pages/clientes/cliente-ideas.ts`
- Delete: `portal/src/app/pages/clientes/cliente-vista.ts`, `cliente-vista.spec.ts`,
  `portal/src/app/core/cliente-vista-mock.ts`, `cliente-vista-mock.test.ts`
- Modify: `portal/src/app/pages/clientes/cliente-ficha.ts` + `.spec.ts`
- Modify: `portal/src/app/pages/clientes/clientes-tabla.ts:86-92` (quitar la acción "Ver")
- Modify: `portal/src/app/pages/clientes/cliente-meta-card.ts:112` (quitar el enlace a `/ver`)
- Modify: `portal/src/app/app.routes.ts`, `portal/src/app/app.routes.test.ts`
- Modify: `portal/src/app/pages/clientes/clientes.spec.ts` (si afirma dos acciones por fila)

**Interfaces:**
- Consumes: `TABS_FICHA` y `ClienteFichaComponent` (tarea 1).
- Produces: `ClienteResenasPage` y `ClienteIdeasPage`, cada una exportada desde su archivo. Son los
  huecos donde caerán el Bloque F y las etapas 5-7 de la pieza 3.

---

- [ ] **Step 1: Escribir el test que falla — los cuatro tabs**

En `cliente-ficha.spec.ts`, reemplazar el test de los tabs por:

```ts
  it('renderiza los cuatro tabs apuntando al cliente de la ruta', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const hrefs = [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/clientes/c1/perfil',
      '/clientes/c1/research',
      '/clientes/c1/resenas',
      '/clientes/c1/ideas',
    ]);
  });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm --prefix portal run test:components`
Expected: FAIL — el array tiene 2 elementos, no 4.

- [ ] **Step 3: Escribir los dos placeholders**

Crear `portal/src/app/pages/clientes/cliente-resenas.ts`:

```ts
import { Component } from '@angular/core';

/**
 * Tab `/clientes/:id/resenas`. **Placeholder deliberado, no un "próximamente" decorativo.**
 *
 * El respondedor de reseñas de Google es el Bloque F del plan de plataforma y no tiene ni una línea
 * de código ni spec: antes de construirlo hay que decidir qué reseñas, con qué autorización de
 * Google, con qué compuerta humana (¿se publica sola una respuesta generada por IA en el perfil de
 * un cliente?) y qué pasa con el multi-tenancy de las credenciales.
 *
 * Lo que se muestra dice QUÉ FALTA. La alternativa —reciclar las tres reseñas inventadas que tenía
 * `cliente-vista.ts`— es peor que un tab vacío: miente con más detalle.
 */
@Component({
  selector: 'app-cliente-resenas',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
      <h2 class="text-sm font-semibold text-texto">Reseñas de Google</h2>
      <p class="mt-2 text-sm text-texto-tenue max-w-md mx-auto">
        Todavía no disponible. El módulo de reseñas necesita antes una decisión de diseño: con qué
        autorización de Google se leen, y quién aprueba una respuesta antes de que se publique.
      </p>
    </div>
  `,
})
export class ClienteResenasPage {}
```

Crear `portal/src/app/pages/clientes/cliente-ideas.ts`:

```ts
import { Component } from '@angular/core';

/**
 * Tab `/clientes/:id/ideas`. **Placeholder deliberado**, y el más corto de los dos en vida útil: el
 * backend YA existe —la migración `0013`, `PgIdeas` con sus transiciones y los tres endpoints, más
 * el seed de ejemplo— y lo que falta son las pantallas (etapas 5-7 de la pieza 3 del programa del
 * portal, con plan propio ya escrito). Este tab es el hueco donde caen.
 */
@Component({
  selector: 'app-cliente-ideas',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
      <h2 class="text-sm font-semibold text-texto">Ideas</h2>
      <p class="mt-2 text-sm text-texto-tenue max-w-md mx-auto">
        Todavía no disponible en el portal. Los datos y la API del módulo de ideas ya existen; faltan
        las pantallas.
      </p>
    </div>
  `,
})
export class ClienteIdeasPage {}
```

- [ ] **Step 4: Añadir los tabs y sus rutas**

En `cliente-ficha.ts`:

```ts
export const TABS_FICHA: readonly TabFicha[] = [
  { etiqueta: 'Perfil', ruta: 'perfil' },
  { etiqueta: 'Research', ruta: 'research' },
  { etiqueta: 'Reseñas', ruta: 'resenas' },
  { etiqueta: 'Ideas', ruta: 'ideas' },
];
```

En `app.routes.ts`, dentro de `children` de `clientes/:id`, antes del redirect:

```ts
          {
            path: 'resenas',
            loadComponent: () =>
              import('./pages/clientes/cliente-resenas').then((m) => m.ClienteResenasPage),
          },
          {
            path: 'ideas',
            loadComponent: () =>
              import('./pages/clientes/cliente-ideas').then((m) => m.ClienteIdeasPage),
          },
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm --prefix portal run test:components`
Expected: PASS — el array de hrefs tiene los cuatro, en orden.

- [ ] **Step 6: Retirar "Mi Portal" y sus mocks**

```bash
git rm portal/src/app/pages/clientes/cliente-vista.ts \
       portal/src/app/pages/clientes/cliente-vista.spec.ts \
       portal/src/app/core/cliente-vista-mock.ts \
       portal/src/app/core/cliente-vista-mock.test.ts
```

En `app.routes.ts`, borrar la ruta `clientes/:id/ver`.

En `clientes-tabla.ts`, borrar el `<a menu [routerLink]="['/clientes', c.id, 'ver']">Ver</a>`
(líneas 86-92) y renombrar la acción que queda de `Editar` a `Abrir` — con una sola acción, "Editar"
describe mal lo que hace (lleva a la ficha entera, no a un formulario).

En `cliente-meta-card.ts`, borrar el enlace de la línea 112 y el botón que lo envuelve.

`clientes.spec.ts` **no se toca**: sus cuatro tests son de filas, filtro y archivados — ninguno
afirma cuántas acciones tiene el menú de cada fila (verificado antes de escribir este plan).

- [ ] **Step 7: Añadir el test de que la pantalla no vuelve**

En `app.routes.test.ts`:

```ts
test('«Mi Portal» (clientes/:id/ver) se retiró: sus secciones son tabs de la ficha', () => {
  // Sus tres tabs eran datos inventados para una audiencia que no existe (no hay login de cliente).
  // Reseñas e Ideas viven ahora como tabs de la ficha, con un placeholder que dice qué falta.
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(!hijos.includes('clientes/:id/ver'), 'clientes/:id/ver no debe existir');

  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.deepEqual(tabs, ['perfil', 'research', 'research/:runId', 'research/:runId/informe', 'resenas', 'ideas', '']);
});
```

Ese orden es el que resulta de seguir el plan: `perfil` (tarea 1), `research` (tarea 2),
`research/:runId` y `research/:runId/informe` (tarea 3), `resenas` e `ideas` (tarea 4), y el
`redirectTo` al final. **El test fija el orden a propósito**: en un array de rutas el orden es
semántica, no estilo. Si al llegar acá el orden real es otro, actualizar el `deepEqual` —pero
mirando antes si esa diferencia cambia qué ruta empareja primero.

- [ ] **Step 8: Verificación completa y navegador**

```bash
npm run verificar -- --con-portal
grep -rn "cliente-vista\|/ver'" portal/src   # debe no devolver nada
```

En el navegador: los cuatro tabs navegan y se subrayan · el listado tiene **una** acción por fila ·
`/clientes/<id>/ver` escrito a mano cae en el catch-all y vuelve a `/clientes`.

- [ ] **Step 9: Actualizar la documentación del proyecto**

Es el paso 3 del ritual de [`AGENTS.md`](../../../AGENTS.md), y va en un commit aparte del código:

- [`docs/proyecto/09-estado-y-roadmap.md`](../../proyecto/09-estado-y-roadmap.md) — la navegación del
  portal es cliente-céntrica; el mock de ideas de la pieza 1 quedó retirado (lo pedía el Bloque J).
- [`docs/proyecto/15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md) — Bloque J: las
  etapas 5-7 de Ideas caen en `/clientes/:id/ideas`. Bloque F: Reseñas cae en
  `/clientes/:id/resenas`.
- [`progress/history.md`](../../../progress/history.md) — la entrada del día, con lo que se aprendió
  (el `paramsInheritanceStrategy` y la conciliación cliente/run).
- Sincronizar las cifras de tests donde aparezcan.

- [ ] **Step 10: Commit**

```bash
git add -A portal/src/app
git commit -m "$(cat <<'EOF'
Reseñas e Ideas son tabs de la ficha; se retira «Mi Portal»

Los dos tabs nuevos van con un placeholder que dice QUÉ falta, no un
«próximamente»: reciclar las reseñas inventadas de la vista del cliente
habría sido mentir con más detalle.

Con esto cae `/clientes/:id/ver` y sus tres tabs mock, que el Bloque J
ya pedía retirar, y el listado queda con una sola acción por fila.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git add docs/ progress/
git commit -m "$(cat <<'EOF'
La documentación alcanza a la navegación nueva

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Cierre

Al terminar la tarea 4, antes de dar el trabajo por cerrado: pasar el agente `revisor` sobre el diff
completo (`CHECKPOINTS.md` contra los cuatro commits), y recién entonces `git push`.
