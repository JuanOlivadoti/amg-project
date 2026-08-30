import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClienteFichaComponent, tabsFicha } from './cliente-ficha';
import { ClientesService } from '../../services/clientes';
import type { ClienteAgencia } from '../../core/models';

/** Un tab cualquiera: lo único que importa de él es que se pueda ver si montó. */
@Component({ selector: 'app-tab-de-prueba', template: `<p>soy el tab montado en el outlet</p>` })
class TabDePrueba {}

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
    vertical: 'restauracion',
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
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `verCliente` a demanda: en vez de resolver sola, deja cada llamada colgada y devuelve el gatillo
 * para resolverla cuando el test quiera. Es lo que permite montar la carrera —pedir A, pedir B, y
 * recién entonces dejar que A conteste— que en la app real produce la respuesta que llega tarde.
 */
function verClienteDiferido() {
  const pendientes: Array<() => void> = [];
  const spy = jasmine
    .createSpy('verCliente')
    .and.callFake(() => new Promise<void>((resolve) => pendientes.push(resolve)));
  return { spy, resolver: (i: number) => pendientes[i]?.() , pendientes };
}

function crear(cliente: ClienteAgencia | null, verCliente?: jasmine.Spy) {
  const params = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
  const verClienteSpy = verCliente ?? jasmine.createSpy('verCliente').and.callFake(async () => undefined);
  const clienteSignal = signal<ClienteAgencia | null>(cliente);

  TestBed.configureTestingModule({
    imports: [ClienteFichaComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      {
        provide: ClientesService,
        useValue: {
          cliente: clienteSignal,
          cargando: signal(false),
          error: signal(''),
          verCliente: verClienteSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ClienteFichaComponent);
  return { fixture, router: TestBed.inject(Router), params, verClienteSpy, clienteSignal };
}

async function estabilizar(fixture: ComponentFixture<ClienteFichaComponent>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteFichaComponent', () => {
  it('carga el cliente por id y muestra su cabecera, con sus etiquetas', async () => {
    const { fixture, verClienteSpy } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    expect(verClienteSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Pizza Nonna');
    expect(el.textContent).toContain('restauración');
    // Los chips de `etiquetas` subieron desde `cliente-perfil.ts` con la ficha, y sus aserciones
    // vienen con ellos: el test que los cubría era uno de los dos que se repartieron al shell, y sin
    // esto el bloque entero de chips se podía borrar con la suite en verde.
    expect(el.textContent).toContain('premium');
    expect(el.textContent).toContain('Madrid');
  });

  it('🔴 monta el tab activo dentro de su <router-outlet>: es lo que lo hace un shell', async () => {
    /*
     * La única línea que convierte a este componente en un contenedor. `app.routes.test.ts` fija la
     * CONFIGURACIÓN (que `clientes/:id` tenga hijas, que `''` redirija a `perfil`); esto fija que el
     * shell RENDERICE el sitio donde esas hijas montan. Sin el outlet, `/clientes/:id/perfil` pinta
     * cabecera, chips y barra de tabs, y debajo no hay nada: cero cards, cero error en consola.
     *
     * Va con el Router de verdad (`RouterTestingHarness`) y una ruta hija real, no con un
     * `querySelector('router-outlet')`: lo que importa no es que el tag esté en el template, es que
     * el hijo aparezca DENTRO del shell. Por eso este test no usa `crear()` — con el harness el
     * `ActivatedRoute` es el auténtico, y mockearlo rompería el router.
     */
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'clientes/:id',
            component: ClienteFichaComponent,
            children: [{ path: 'perfil', component: TabDePrueba }],
          },
        ]),
        {
          provide: ClientesService,
          useValue: {
            cliente: signal<ClienteAgencia | null>(clienteDePrueba()),
            cargando: signal(false),
            error: signal(''),
            verCliente: jasmine.createSpy('verCliente').and.callFake(async () => undefined),
          },
        },
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/clientes/c1/perfil');
    harness.detectChanges();

    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-cliente-ficha app-tab-de-prueba'))
      .withContext('el tab hijo no se renderizó dentro del shell: ¿falta el <router-outlet />?')
      .not.toBeNull();
    expect(el.textContent).toContain('soy el tab montado en el outlet');
  });

  it('renderiza los cinco tabs apuntando al cliente de la ruta', async () => {
    /*
     * `toEqual` sobre el array entero y no cuatro `toContain`: el ORDEN de la barra es una decisión
     * (Perfil primero porque es el `redirectTo` por defecto), y un `toContain` la deja sin cubrir.
     *
     * El selector va por `aria-label` y no por `nav a` a secas, y eso lo destapó este mismo test al
     * escribirse: la ficha tiene DOS `<nav>` —el del breadcrumb, con su link «Clientes», y el de los
     * tabs— así que `nav a` devolvía tres anclas con `/clientes` a la cabeza. El `toContain` de antes
     * lo tapaba. Además de precisar el test, ponerle nombre al landmark es lo correcto: dos `<nav>`
     * sin nombre accesible se anuncian los dos como «navigation» y no hay forma de distinguirlos.
     */
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const tabs = el.querySelectorAll('nav[aria-label="Secciones del cliente"] a');
    const hrefs = [...tabs].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/clientes/c1/perfil',
      '/clientes/c1/research',
      '/clientes/c1/resenas',
      '/clientes/c1/ideas',
      '/clientes/c1/menu',
    ]);
  });

  it('cliente no encontrado (`cliente()` queda en null tras `verCliente`): navega a /clientes', async () => {
    const { fixture, router } = crear(null);
    spyOn(router, 'navigate').and.resolveTo(true); // ANTES del primer detectChanges
    await estabilizar(fixture);

    expect(router.navigate).toHaveBeenCalledWith(['/clientes']);
  });

  it('🔴 la respuesta que llega tarde NO redirige: cuando A contesta, el :id vigente ya es B', async () => {
    /*
     * La guardia de vigencia posterior al `await`, que es distinta de la de dedup: ésta no evita el
     * pedido, evita ACTUAR sobre uno viejo. Sin ella, navegar rápido de `/clientes/A/perfil` a
     * `/clientes/B/perfil` termina en `/clientes` — porque la carga de A vuelve, encuentra
     * `cliente()` en `null` (el signal es compartido y `verCliente` lo limpia al cambiar de id) y se
     * cree con derecho a mandar al listado, pisando una pantalla que ya estaba mostrando B.
     *
     * `cliente()` se deja en `null` a propósito: es el estado en el que la guardia es lo ÚNICO que
     * separa el comportamiento correcto del redirect. Y el pedido de B se deja sin resolver, así que
     * si alguien navega, solo pudo haber sido la rama de A.
     */
    const diferido = verClienteDiferido();
    const { params, fixture, router } = crear(null, diferido.spy);
    spyOn(router, 'navigate').and.resolveTo(true); // ANTES del primer detectChanges

    await estabilizar(fixture); // pide A ('c1'), queda colgado
    params.next(convertToParamMap({ id: 'c2' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(diferido.spy.calls.allArgs())
      .withContext('el escenario no se montó: tienen que haberse pedido los dos ids, en orden')
      .toEqual([['c1'], ['c2']]);

    diferido.resolver(0); // ahora sí, contesta A — tarde
    await estabilizar(fixture);

    expect(router.navigate)
      .withContext('la carga vieja de c1 mandó al listado aunque el :id vigente ya era c2')
      .not.toHaveBeenCalled();
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

  it('renderiza "Pólizas y coberturas" en el tab de catálogo para un cliente de correduría de seguros', async () => {
    // Mismo tab, misma ruta (`menu`) — solo cambia la ETIQUETA visible. `tabsFicha` ya lo cubre en
    // aislamiento (más abajo); esto fija que el componente de verdad la llama con el vertical del
    // cliente cargado, y no con la constante fija que tenía antes de esta task.
    const { fixture } = crear(clienteDePrueba({ vertical: 'correduria_seguros' }));
    const el = await estabilizar(fixture);

    const tabs = el.querySelectorAll('nav[aria-label="Secciones del cliente"] a');
    const etiquetas = [...tabs].map((a) => a.textContent?.trim());
    expect(etiquetas).toContain('Pólizas y coberturas');
    expect(etiquetas).not.toContain('Menú');

    const tabMenu = [...tabs].find((a) => a.getAttribute('href') === '/clientes/c1/menu');
    expect(tabMenu?.textContent?.trim())
      .withContext('la ruta interna sigue siendo `menu` para los dos verticales — solo cambia la etiqueta')
      .toBe('Pólizas y coberturas');
  });
});

describe('tabsFicha', () => {
  it('muestra el tab "Menú" para un cliente de restauración', () => {
    const tabs = tabsFicha('restauracion');
    expect(tabs.find((t) => t.ruta === 'menu')?.etiqueta).toBe('Menú');
  });

  it('muestra el tab "Pólizas y coberturas" para un cliente de correduría de seguros', () => {
    const tabs = tabsFicha('correduria_seguros');
    expect(tabs.find((t) => t.ruta === 'menu')?.etiqueta).toBe('Pólizas y coberturas');
  });

  it('sin vertical (cliente todavía no cargó): el tab de catálogo cae al default "Menú"', () => {
    // `ClienteFichaComponent` computa `tabs` desde `clientesService.cliente()?.vertical`, que es
    // `undefined` mientras el cliente todavía no llegó — la barra de tabs se renderiza igual, ANTES
    // de que exista `cliente`, así que el default tiene que ser seguro.
    const tabs = tabsFicha(undefined);
    expect(tabs.find((t) => t.ruta === 'menu')?.etiqueta).toBe('Menú');
  });

  it('los cuatro tabs fijos no cambian con el vertical, y el orden se conserva', () => {
    const tabs = tabsFicha('correduria_seguros');
    expect(tabs.map((t) => t.ruta)).toEqual(['perfil', 'research', 'resenas', 'ideas', 'menu']);
  });
});
