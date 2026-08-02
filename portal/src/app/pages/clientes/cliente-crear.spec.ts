import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ClienteCrearPage } from './cliente-crear';
import { ClientesService } from '../../services/clientes';
import { MembresiaService } from '../../services/membresia';
import type { NuevoClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) de `/clientes/nuevo`. A diferencia de `clientes.spec.ts` (Etapa 5a),
 * que sustituye solo `ApiService` y usa el `ClientesService` real, acá se mockea `ClientesService`
 * directamente (como pide el brief de la 5b) — lo que fija es el CONTRATO con el servicio (qué
 * `NuevoClienteAgencia` arma el formulario, cuándo navega), no el filtrado/estado interno del
 * servicio, que ya cubre su propio test.
 *
 * `render()` espera un `whenStable()` extra ANTES de tocar cualquier campo: `NgForm.addControl`
 * (Angular Forms) cablea `registerOnChange` del value accessor dentro de un microtask
 * (`resolvedPromise.then(...)`), así que escribir en un input inmediatamente después del primer
 * `detectChanges()` — sin dejar pasar ese microtask — hace que `(ngModelChange)` no dispare NADA,
 * en silencio (ni error en consola). Lo confirmé con un componente descartable de 3 líneas: el
 * mismo `[ngModel]`/`(ngModelChange)` funciona bien SIN `<form>`, y se rompe en cuanto se envuelve
 * en uno — hasta que se deja pasar un tick.
 */
function escribir(el: HTMLElement, id: string, valor: string): void {
  const campo = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  expect(campo).withContext(`no encontré #${id}`).not.toBeNull();
  campo!.value = valor;
  campo!.dispatchEvent(new Event('input'));
}

describe('ClienteCrearPage', () => {
  async function render(
    crearSpy: jasmine.Spy,
    errorSignal = signal(''),
  ): Promise<{ fixture: ComponentFixture<ClienteCrearPage>; el: HTMLElement; router: Router }> {
    TestBed.configureTestingModule({
      imports: [ClienteCrearPage],
      providers: [
        provideRouter([]),
        { provide: ClientesService, useValue: { crear: crearSpy, error: errorSignal } },
      ],
    });
    const fixture = TestBed.createComponent(ClienteCrearPage);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await fixture.whenStable(); // deja resolver el registro de NgForm antes de tocar los campos
    return { fixture, el: fixture.nativeElement as HTMLElement, router };
  }

  it('completa el nombre y otros campos, envía, y llama a ClientesService.crear con los datos esperados', async () => {
    const crearSpy = jasmine.createSpy('crear').and.resolveTo(undefined);
    const { fixture, el, router } = await render(crearSpy);
    spyOn(router, 'navigate').and.resolveTo(true);

    escribir(el, 'cliente-nombre', 'Pizza Nonna');
    escribir(el, 'cliente-etiquetas', 'premium, Madrid ,  ');
    escribir(el, 'cliente-email', 'hola@pizzanonna.es');
    escribir(el, 'cliente-ciudad', 'Madrid');
    fixture.detectChanges();
    await fixture.whenStable();

    const form = el.querySelector('form');
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(crearSpy).toHaveBeenCalledTimes(1);
    const datos = crearSpy.calls.mostRecent().args[0] as NuevoClienteAgencia;
    expect(datos.nombre).toBe('Pizza Nonna');
    // '.split(",").map(trim).filter(Boolean)': el mismo criterio que el origen, sin entradas vacías.
    expect(datos.etiquetas).toEqual(['premium', 'Madrid']);
    expect((datos.contacto as Record<string, unknown>)['email']).toBe('hola@pizzanonna.es');
    expect((datos.contacto as Record<string, { ciudad?: string }>)['direccion']).toEqual({ ciudad: 'Madrid' });
    // Nada de sucursales ni de preferencias: quedaron fuera de esta tanda (ver brief 5b).
    expect(Object.keys(datos)).not.toContain('branches');
    expect(Object.keys(datos)).not.toContain('preferences');

    expect(router.navigate).toHaveBeenCalledWith(['/clientes']);
  });

  it('nombre vacío: no llama a crear() ni navega, y muestra el error de validación en pantalla', async () => {
    const crearSpy = jasmine.createSpy('crear');
    const { fixture, el, router } = await render(crearSpy);
    spyOn(router, 'navigate');

    const form = el.querySelector('form');
    form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(crearSpy).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(el.textContent).toContain('El nombre es obligatorio');
  });

  it('si el servidor rechaza (queda un error en ClientesService), NO navega y muestra el mensaje', async () => {
    const errorSignal = signal('');
    const crearSpy = jasmine.createSpy('crear').and.callFake(async () => {
      errorSignal.set('ya existe un cliente con ese nombre');
    });
    const { fixture, el, router } = await render(crearSpy, errorSignal);
    spyOn(router, 'navigate');

    escribir(el, 'cliente-nombre', 'Pizza Nonna');
    fixture.detectChanges();
    await fixture.whenStable();

    const form = el.querySelector('form');
    form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(crearSpy).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(el.textContent).toContain('ya existe un cliente con ese nombre');
  });
});

describe('ClienteCrearPage — responsable (integración con la pieza 2)', () => {
  it('🔴 ya no se pide un uuid a mano: el responsable se elige de una lista', async () => {
    // Cierra el pendiente con el que se cerró la pieza 1. Si alguien vuelve a poner un `<input>` de
    // texto acá, este test cae: pegar uuids a mano es exactamente el problema que la pieza 2 resolvió.
    TestBed.configureTestingModule({
      imports: [ClienteCrearPage],
      providers: [
        provideRouter([]),
        { provide: ClientesService, useValue: { crear: jasmine.createSpy('crear'), error: signal('') } },
        {
          provide: MembresiaService,
          useValue: {
            miembros: signal([
              {
                id: 'm1',
                tenant_id: 't1',
                user_id: 'u-1',
                rol: 'equipo',
                client_id: null,
                created_at: '2026-08-02T00:00:00Z',
                email: 'ana@agencia.test',
                raw_app_meta_data: { name: 'Ana' },
              },
            ]),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ClienteCrearPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const campo = el.querySelector('#cliente-asignado-a')!;
    expect(campo.tagName).toBe('SELECT');
    expect(campo.textContent).toContain('Ana');
    expect(el.innerHTML).not.toContain('uuid del usuario responsable');
  });
});
