import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteMenuPage } from './cliente-menu';
import { ApiService } from '../../services/api';
import type { MenuCarta } from '../../core/models';

function cartaDePrueba(overrides: Partial<MenuCarta> = {}): MenuCarta {
  return {
    menu: [
      { name: 'Margherita', category: 'Pizzas', precios: [{ etiqueta: 'Media', importe: '9,00 €' }] },
      { name: 'Cacio e pepe', category: 'Pastas', precios: [{ etiqueta: 'Precio', importe: '13,00 €' }] },
    ],
    menu_categorias: [
      { nombre: 'Pizzas', orden: 0 },
      { nombre: 'Pastas', orden: 1 },
    ],
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
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));

  TestBed.configureTestingModule({
    imports: [ClienteMenuPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { obtenerMenu: obtenerMenuSpy, guardarMenu: guardarMenuSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteMenuPage);
  return { fixture, obtenerMenuSpy, guardarMenuSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteMenuPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function boton(el: HTMLElement, texto: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === texto);
}

describe('ClienteMenuPage', () => {
  it('lista las categorías y, debajo de cada una, sus platos', async () => {
    const { fixture, obtenerMenuSpy } = crear();
    const el = await estabilizar(fixture);

    expect(obtenerMenuSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Pizzas');
    expect(el.textContent).toContain('Margherita');
    expect(el.textContent).toContain('Pastas');
    expect(el.textContent).toContain('Cacio e pepe');
  });

  it('un plato con category que no está en menu_categorias aparece igual, agrupado aparte', async () => {
    const carta = cartaDePrueba({
      menu: [{ name: 'Huérfano', category: 'Postres' }],
      menu_categorias: [{ nombre: 'Pizzas' }],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Huérfano');
  });

  it('sin carta todavía: se ve un estado vacío, no una pantalla en blanco', async () => {
    const carta = cartaDePrueba({ menu: [], menu_categorias: [] });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Todavía no hay platos cargados.');
  });

  it('borrar un plato lo saca de la lista y guarda la carta sin él', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Borrar')!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [clientId, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(clientId).toBe('c1');
    expect(carta.menu.map((p) => p.name)).toEqual(['Cacio e pepe']);
    expect(el.textContent).not.toContain('Margherita');
  });

  it('borrar una categoría CON platos asignados queda bloqueado', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    const botonBorrarPizzas = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Borrar categoría' && b.closest('li')?.textContent?.includes('Pizzas'),
    );
    expect(botonBorrarPizzas?.disabled).withContext('Pizzas tiene un plato: no se puede borrar').toBeTrue();

    botonBorrarPizzas?.click();
    await estabilizar(fixture);
    expect(guardarMenuSpy).not.toHaveBeenCalled();
  });

  it('borrar una categoría SIN platos asignados funciona', async () => {
    const carta = cartaDePrueba({
      menu: [{ name: 'Margherita', category: 'Pizzas' }],
      menu_categorias: [
        { nombre: 'Pizzas', orden: 0 },
        { nombre: 'Bebidas', orden: 1 },
      ],
    });
    const { fixture, guardarMenuSpy } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    const botonBorrarBebidas = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Borrar categoría' && b.closest('li')?.textContent?.includes('Bebidas'),
    );
    expect(botonBorrarBebidas?.disabled).toBeFalse();
    botonBorrarBebidas!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [, cartaGuardada] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(cartaGuardada.menu_categorias.map((c) => c.nombre)).toEqual(['Pizzas']);
  });

  it('agregar categoría la agrega a la lista y la guarda', async () => {
    const { fixture, guardarMenuSpy } = crear();
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="nuevaCategoriaNombre"]')!;
    inputNombre.value = 'Postres';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    boton(el, 'Agregar categoría')!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(carta.menu_categorias.map((c) => c.nombre)).toContain('Postres');
    expect(el.textContent).toContain('Postres');
  });

  it('el link "Agregar plato" apunta al índice UNO PASADO EL FINAL del array actual', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);

    const link = el.querySelector<HTMLAnchorElement>('a[href$="/menu/2"]');
    expect(link).withContext('2 platos cargados (índices 0 y 1): agregar va al índice 2').toBeTruthy();
  });
});
