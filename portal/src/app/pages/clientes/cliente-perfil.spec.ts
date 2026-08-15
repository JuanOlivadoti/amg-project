import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ClientePerfilPage } from './cliente-perfil';
import { ClientesService } from '../../services/clientes';
import type { CambiosClienteAgencia, ClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) del TAB `/clientes/:id/perfil`. Mismo criterio que `cliente-crear.spec.ts`
 * (Etapa 5b): se mockea `ClientesService` directamente (no `ApiService`) — lo que fija es el CONTRATO
 * con el servicio: qué `CambiosClienteAgencia` arma cada card al guardar, y sobre todo que el
 * `contacto` que manda cada card viene MERGEADO con el resto de las claves ya cargadas (el riesgo de
 * seguridad que señala el brief de la 5c: un card que mande `contacto` parcial borra lo que guardaron
 * los otros).
 *
 * Lo que ya NO se prueba acá: cargar el cliente y el redirect cuando no existe. Eso subió al shell
 * (`cliente-ficha.spec.ts`) cuando la ficha pasó a tener tabs — y en su lugar queda el test que fija
 * la frontera nueva, que este tab no pide nada.
 *
 * El mock de `ClientesService` es compartido por la página Y sus 4 cards (todos lo inyectan del
 * mismo `TestBed` — mismo mecanismo que en la app real, donde es un singleton `providedIn: 'root'`).
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
    contacto: {
      email: 'hola@pizzanonna.es',
      facebook: 'https://facebook.com/pizzanonna',
      direccion: { ciudad: 'Madrid', calle: 'Gran Vía' },
      recursos: 'Somos una pizzería artesanal.',
    },
    google_conectado_en: null,
    origen: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Mocks {
  /** Se conserva SOLO para afirmar que este tab no lo llama: cargar el cliente es del shell. */
  verClienteSpy: jasmine.Spy;
  actualizarSpy: jasmine.Spy;
  errorSignal: ReturnType<typeof signal<string>>;
}

/**
 * Crea el fixture SIN disparar `detectChanges`, para poder preparar el escenario antes del primer
 * ciclo. Ya no hace falta un `ActivatedRoute`: el tab no lee el `:id` (lo lee el shell), y el único
 * `routerLink` que queda —el «ver sitio» del meta-card— es absoluto y le alcanza `provideRouter([])`.
 */
function crear(
  cliente: ClienteAgencia | null,
  overrides: Partial<Mocks> = {},
): { fixture: ComponentFixture<ClientePerfilPage>; mocks: Mocks } {
  const clienteSignal = signal<ClienteAgencia | null>(cliente);
  const mocks: Mocks = {
    verClienteSpy: overrides.verClienteSpy ?? jasmine.createSpy('verCliente').and.callFake(async () => undefined),
    actualizarSpy: overrides.actualizarSpy ?? jasmine.createSpy('actualizar').and.callFake(async () => undefined),
    errorSignal: overrides.errorSignal ?? signal(''),
  };

  TestBed.configureTestingModule({
    imports: [ClientePerfilPage],
    providers: [
      provideRouter([]),
      {
        provide: ClientesService,
        useValue: {
          cliente: clienteSignal,
          cargando: signal(false),
          error: mocks.errorSignal,
          verCliente: mocks.verClienteSpy,
          actualizar: mocks.actualizarSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ClientePerfilPage);
  return { fixture, mocks };
}

async function estabilizar(fixture: ComponentFixture<ClientePerfilPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClientePerfilPage', () => {
  it('NO pide el cliente: cargarlo es del shell (cliente-ficha), no del tab', async () => {
    // Si este tab volviera a pedir el cliente, cada clic en la barra de tabs dispararía un GET.
    // Se afirma el CONTRATO observable —que no llama al servicio— y no la ausencia de `ngOnInit`,
    // que es un detalle de implementación y no diría nada si mañana la carga se mueve a un `effect`.
    const { fixture, mocks } = crear(clienteDePrueba());
    await estabilizar(fixture);

    expect(mocks.verClienteSpy).not.toHaveBeenCalled();
  });

  it(
    'el card de Información edita el nombre y guarda: el `contacto` que manda a ' +
      'ClientesService.actualizar conserva facebook/dirección aunque el card no los edite',
    async () => {
      const { fixture, mocks } = crear(clienteDePrueba());
      const el = await estabilizar(fixture);

      const botonEditar = Array.from(el.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Editar',
      );
      expect(botonEditar).withContext('no encontré el botón "Editar" del card de Información').toBeDefined();
      botonEditar!.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const nombre = el.querySelector<HTMLInputElement>('#info-nombre');
      expect(nombre).withContext('no encontré #info-nombre en modo edición').not.toBeNull();
      nombre!.value = 'Pizza Nonna SRL';
      nombre!.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();

      const form = el.querySelector('form');
      expect(form).not.toBeNull();
      form!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mocks.actualizarSpy).toHaveBeenCalledTimes(1);
      const [id, cambios] = mocks.actualizarSpy.calls.mostRecent().args as [string, CambiosClienteAgencia];
      expect(id).toBe('c1');
      expect(cambios.nombre).toBe('Pizza Nonna SRL');
      // El riesgo del brief: el card de Información NO edita facebook/dirección, pero como parte del
      // `contacto` COMPLETO ya cargado, esas claves tienen que seguir ahí en el PATCH.
      const contacto = cambios.contacto as Record<string, unknown>;
      expect(contacto['facebook']).toBe('https://facebook.com/pizzanonna');
      expect(contacto['direccion']).toEqual({ ciudad: 'Madrid', calle: 'Gran Vía' });
      expect(contacto['email']).toBe('hola@pizzanonna.es');
    },
  );

  it('el card de Dirección guarda solo `contacto.direccion`, sin borrar email/facebook de los otros cards', async () => {
    const { fixture, mocks } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const botonesEditar = Array.from(el.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Editar',
    );
    // Info, Dirección, Meta, Recursos: el de Dirección es el segundo botón "Editar" en el DOM.
    expect(botonesEditar.length).toBe(4);
    botonesEditar[1]!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const ciudad = el.querySelector<HTMLInputElement>('#direccion-ciudad');
    expect(ciudad).withContext('no encontré #direccion-ciudad en modo edición').not.toBeNull();
    ciudad!.value = 'Barcelona';
    ciudad!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // Solo Dirección quedó en modo edición: es el único `<form>` presente en este momento.
    const formDireccion = el.querySelector('form');
    expect(formDireccion).withContext('no encontré el form de Dirección').not.toBeNull();
    formDireccion!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mocks.actualizarSpy).toHaveBeenCalledTimes(1);
    const [, cambios] = mocks.actualizarSpy.calls.mostRecent().args as [string, CambiosClienteAgencia];
    // Solo `contacto` — nada de campos propios del cliente (nombre, tipo, etc.).
    expect(Object.keys(cambios)).toEqual(['contacto']);
    const contacto = cambios.contacto as Record<string, unknown>;
    expect(contacto['email']).toBe('hola@pizzanonna.es');
    expect(contacto['facebook']).toBe('https://facebook.com/pizzanonna');
    expect(contacto['direccion']).toEqual({ ciudad: 'Barcelona', calle: 'Gran Vía' });
  });

  it('el card de Meta guarda facebook sin borrar email/dirección de los otros cards', async () => {
    const { fixture, mocks } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const botonesEditar = Array.from(el.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Editar',
    );
    // Info, Dirección, Meta, Recursos: el de Meta es el tercer botón "Editar" en el DOM.
    expect(botonesEditar.length).toBe(4);
    botonesEditar[2]!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const facebook = el.querySelector<HTMLInputElement>('#meta-facebook');
    expect(facebook).withContext('no encontré #meta-facebook en modo edición').not.toBeNull();
    facebook!.value = 'https://facebook.com/pizzanonna-nueva';
    facebook!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // Solo Meta quedó en modo edición: es el único `<form>` presente en este momento.
    const formMeta = el.querySelector('form');
    expect(formMeta).withContext('no encontré el form de Meta').not.toBeNull();
    formMeta!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mocks.actualizarSpy).toHaveBeenCalledTimes(1);
    const [, cambios] = mocks.actualizarSpy.calls.mostRecent().args as [string, CambiosClienteAgencia];
    // Solo `contacto` — nada de campos propios del cliente.
    expect(Object.keys(cambios)).toEqual(['contacto']);
    const contacto = cambios.contacto as Record<string, unknown>;
    expect(contacto['facebook']).toBe('https://facebook.com/pizzanonna-nueva');
    // El riesgo del brief: el card de Meta NO edita email/dirección, pero como parte del `contacto`
    // COMPLETO ya cargado, esas claves tienen que seguir ahí en el PATCH.
    expect(contacto['email']).toBe('hola@pizzanonna.es');
    expect(contacto['direccion']).toEqual({ ciudad: 'Madrid', calle: 'Gran Vía' });
  });

  it('el card de Recursos guarda el texto sin borrar email/facebook/dirección de los otros cards', async () => {
    const { fixture, mocks } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const botonesEditar = Array.from(el.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Editar',
    );
    // Info, Dirección, Meta, Recursos: el de Recursos es el cuarto botón "Editar" en el DOM.
    expect(botonesEditar.length).toBe(4);
    botonesEditar[3]!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const recursos = el.querySelector<HTMLTextAreaElement>('#recursos-texto');
    expect(recursos).withContext('no encontré #recursos-texto en modo edición').not.toBeNull();
    recursos!.value = 'Nuevo texto de recursos.';
    recursos!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // Solo Recursos quedó en modo edición: es el único `<form>` presente en este momento.
    const formRecursos = el.querySelector('form');
    expect(formRecursos).withContext('no encontré el form de Recursos').not.toBeNull();
    formRecursos!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mocks.actualizarSpy).toHaveBeenCalledTimes(1);
    const [, cambios] = mocks.actualizarSpy.calls.mostRecent().args as [string, CambiosClienteAgencia];
    // Solo `contacto` — nada de campos propios del cliente.
    expect(Object.keys(cambios)).toEqual(['contacto']);
    const contacto = cambios.contacto as Record<string, unknown>;
    expect(contacto['recursos']).toBe('Nuevo texto de recursos.');
    // El riesgo del brief: el card de Recursos NO edita email/facebook/dirección, pero como parte
    // del `contacto` COMPLETO ya cargado, esas claves tienen que seguir ahí en el PATCH.
    expect(contacto['email']).toBe('hola@pizzanonna.es');
    expect(contacto['facebook']).toBe('https://facebook.com/pizzanonna');
    expect(contacto['direccion']).toEqual({ ciudad: 'Madrid', calle: 'Gran Vía' });
  });
});
