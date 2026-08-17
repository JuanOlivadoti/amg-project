import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteMenuDetallePage } from './cliente-menu-detalle';
import { ApiService } from '../../services/api';
import type { MenuCarta } from '../../core/models';

function cartaDePrueba(overrides: Partial<MenuCarta> = {}): MenuCarta {
  return {
    menu: [
      {
        name: 'Margherita',
        category: 'Pizzas',
        description: 'Tomate San Marzano, mozzarella, albahaca.',
        precios: [{ etiqueta: 'Media', importe: '9,00 €', comensales: '1 persona' }],
        alergenos: ['gluten', 'lacteos'],
        etiquetas: ['vegetariano'],
        nutricion: { calorias: 620, proteinas_g: 26 },
        foto: { src: 'https://a.storyblok.com/f/1/margherita.jpg' },
        video: {
          src: 'https://a.storyblok.com/f/1/margherita.mp4',
          poster: { src: 'https://a.storyblok.com/f/1/poster.jpg', alt: 'Margherita' },
        },
      },
    ],
    menu_categorias: [{ nombre: 'Pizzas' }],
    ...overrides,
  };
}

function crear(
  opciones: {
    obtenerMenu?: jasmine.Spy;
    guardarMenu?: jasmine.Spy;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const obtenerMenuSpy = opciones.obtenerMenu ?? jasmine.createSpy('obtenerMenu').and.resolveTo(cartaDePrueba());
  const guardarMenuSpy = opciones.guardarMenu ?? jasmine.createSpy('guardarMenu').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1', index: '0' }));

  TestBed.configureTestingModule({
    imports: [ClienteMenuDetallePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { obtenerMenu: obtenerMenuSpy, guardarMenu: guardarMenuSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteMenuDetallePage);
  return { fixture, obtenerMenuSpy, guardarMenuSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteMenuDetallePage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteMenuDetallePage', () => {
  it('carga el plato existente en el índice: nombre, descripción, precio, alérgenos, etiquetas, nutrición', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Margherita');
    expect(el.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toContain(
      'San Marzano',
    );
    expect(el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')?.value).toBe('9,00 €');
    expect(el.querySelector<HTMLInputElement>('input[name="alergeno-gluten"]')?.checked).toBeTrue();
    expect(el.querySelector<HTMLInputElement>('input[name="alergeno-pescado"]')?.checked).toBeFalse();
    expect(el.querySelector<HTMLInputElement>('input[name="etiqueta-vegetariano"]')?.checked).toBeTrue();
    expect(el.querySelector<HTMLInputElement>('input[name="nutricionCalorias"]')?.value).toBe('620');
  });

  it('índice igual a la longitud del array: formulario vacío para un plato NUEVO', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' })); // menu tiene 1 plato: índice 1 = nuevo
    const { fixture } = crear({ params });
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('');
    expect(el.textContent).toContain('Plato nuevo');
  });

  it('🔴 índice mayor a la longitud → "Plato no encontrado", sin excepción sin manejar', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '99' }));
    const { fixture } = crear({ params });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Plato no encontrado');
    expect(el.querySelector('input[name="name"]')).toBeFalsy();
  });

  it('un plato legacy con `price` suelto (sin `precios`) se migra a una fila de precios al abrirlo', async () => {
    const carta = cartaDePrueba({
      // `price` no está en el tipo `MenuItem` del portal (ver Task 4) — se simula tal como llega de
      // un cliente sembrado por SQL antes de este editor, con un cast a `unknown` para saltarse el
      // chequeo de tipos del test (el runtime SÍ puede traerlo).
      menu: [{ name: 'Cacio e pepe', price: '13,00 €' } as unknown as MenuCarta['menu'][number]],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')?.value).toBe('13,00 €');
  });

  it('guardar un plato nuevo lo agrega al final del array y llama a guardarMenu con la carta completa', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture, guardarMenuSpy } = crear({ params });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Diavola';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    const inputEtiqueta0 = el.querySelector<HTMLInputElement>('input[name="precio0Etiqueta"]')!;
    inputEtiqueta0.value = 'Precio';
    inputEtiqueta0.dispatchEvent(new Event('input'));
    const inputImporte0 = el.querySelector<HTMLInputElement>('input[name="precio0Importe"]')!;
    inputImporte0.value = '13,00 €';
    inputImporte0.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [clientId, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(clientId).toBe('c1');
    expect(carta.menu.map((p) => p.name)).toEqual(['Margherita', 'Diavola']);
  });

  it('guardar un plato existente lo reemplaza EN SU POSICIÓN, sin tocar los demás', async () => {
    const carta = cartaDePrueba({
      menu: [
        { name: 'Margherita' },
        { name: 'Diavola' },
      ],
    });
    const { fixture, guardarMenuSpy } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Margherita (editada)';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    const [, cartaGuardada] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(cartaGuardada.menu.map((p) => p.name)).toEqual(['Margherita (editada)', 'Diavola']);
  });

  it('el aviso de "sin poster no se muestra el video" aparece si hay video.src pero no video.poster.src', async () => {
    const carta = cartaDePrueba({ menu: [{ name: 'Margherita', video: { src: 'https://a.storyblok.com/f/1/x.mp4' } }] });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('sin imagen de portada, el video no se va a mostrar');
  });

  it('🔴 nombre vacío no se guarda: guardarMenu no se llama y se ve el error de validación', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture, guardarMenuSpy } = crear({ params });
    const el = await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(guardarMenuSpy).not.toHaveBeenCalled();
    expect(el.textContent).toContain('El nombre no puede quedar vacío.');
  });

  it('🔴 el error 400 del servidor (campos) se muestra sin que la pantalla quede en blanco', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const guardarMenuSpy = jasmine
      .createSpy('guardarMenu')
      .and.rejectWith(new Error('El menú no es válido.'));
    const { fixture } = crear({ params, guardarMenu: guardarMenuSpy });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Plato con error';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(el.textContent).toContain('El menú no es válido.');
  });
});
