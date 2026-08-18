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

  it('🔴 un guardarMenu fallido, tras la recarga de recuperación exitosa, no deja el error pegado para siempre', async () => {
    // guardarMenu SIEMPRE rechaza en este test, pero solo se llama una vez (un borrado); la recarga
    // de recuperación que dispara guardar() usa obtenerMenu, que sigue resolviendo bien.
    const guardarMenuSpy = jasmine.createSpy('guardarMenu').and.rejectWith(new Error('temporal'));
    const { fixture, obtenerMenuSpy } = crear({ guardarMenu: guardarMenuSpy });
    const el = await estabilizar(fixture);

    boton(el, 'Borrar')!.click();
    await estabilizar(fixture);

    // La recarga de recuperación (segundo obtenerMenu) trajo datos frescos con éxito: el mensaje de
    // error no puede seguir tapando la lista.
    expect(obtenerMenuSpy).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain('temporal');
    expect(el.textContent).toContain('Margherita');
  });

  it('🔴 agregar una categoría con un nombre ya existente NO la duplica ni dispara un guardado de más', async () => {
    const { fixture, guardarMenuSpy } = crear(); // carta de prueba trae 'Pizzas' y 'Pastas'
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="nuevaCategoriaNombre"]')!;
    inputNombre.value = '  pizzas  '; // mismo nombre, con mayúsculas/espacios distintos
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    boton(el, 'Agregar categoría')!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).not.toHaveBeenCalled();
    const nombres = Array.from(el.querySelectorAll('ul span')).map((s) => s.textContent!.trim());
    expect(nombres).toEqual(['Pizzas', 'Pastas']);
  });

  it('🔴 una categoría nueva sin `orden` va al final, no salta antes de una con orden explícito', async () => {
    const carta = cartaDePrueba({
      menu: [],
      menu_categorias: [{ nombre: 'Bebidas', orden: 5 }],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="nuevaCategoriaNombre"]')!;
    inputNombre.value = 'Postres';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    boton(el, 'Agregar categoría')!.click();
    await estabilizar(fixture);

    // Único <ul> presente: el de categorías (no hay platos en este test, así que no se renderiza
    // ningún <ul> de platos). Mismo criterio que el renderer público: `orden` ausente va al FINAL.
    const nombres = Array.from(el.querySelectorAll('ul span')).map((s) => s.textContent!.trim());
    expect(nombres).toEqual(['Bebidas', 'Postres']);
  });

  it('una categoría con foto/orden ya cargados muestra esos valores en los inputs al abrir', async () => {
    const carta = cartaDePrueba({
      menu_categorias: [
        { nombre: 'Pizzas', orden: 3, foto: { src: 'https://cdn.test/pizzas.jpg' } },
        { nombre: 'Pastas', orden: 1 },
      ],
    });
    const { fixture } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    // Ordenadas por `orden`: Pastas (1) queda en el índice 0 y Pizzas (3) en el índice 1.
    const fotoInput = el.querySelector<HTMLInputElement>('input[name="cat-foto-1"]')!;
    const ordenInput = el.querySelector<HTMLInputElement>('input[name="cat-orden-1"]')!;
    expect(fotoInput.value).toBe('https://cdn.test/pizzas.jpg');
    expect(ordenInput.value).toBe('3');
  });

  it('cambiar foto/orden de una categoría y click en "Guardar" aplica los dos campos juntos, sin tocar las demás', async () => {
    const { fixture, guardarMenuSpy } = crear(); // Pizzas orden 0 (índice 0), Pastas orden 1 (índice 1)
    const el = await estabilizar(fixture);

    const fotoInput = el.querySelector<HTMLInputElement>('input[name="cat-foto-0"]')!;
    const ordenInput = el.querySelector<HTMLInputElement>('input[name="cat-orden-0"]')!;
    fotoInput.value = 'https://cdn.test/nueva.jpg';
    ordenInput.value = '5';

    const botonGuardarPizzas = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Guardar' && b.closest('li')?.textContent?.includes('Pizzas'),
    );
    botonGuardarPizzas!.click();
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
    const [, carta] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(carta.menu_categorias).toEqual([
      { nombre: 'Pizzas', foto: { src: 'https://cdn.test/nueva.jpg' }, orden: 5 },
      { nombre: 'Pastas', orden: 1 },
    ]);
  });

  it('mientras hay un guardado en vuelo, los botones que disparan otro guardado quedan disabled', async () => {
    let resolver: (() => void) | undefined;
    const guardarMenuSpy = jasmine.createSpy('guardarMenu').and.callFake(
      () => new Promise<void>((resolve) => (resolver = resolve)),
    );
    const { fixture } = crear({ guardarMenu: guardarMenuSpy });
    const el = await estabilizar(fixture);

    boton(el, 'Borrar')!.click(); // dispara guardar(); la promesa queda sin resolver
    await estabilizar(fixture);

    // Margherita ya se sacó de la lista; el "Borrar" que queda es el de Cacio e pepe, y debe quedar
    // bloqueado mientras el guardado sigue en vuelo.
    expect(boton(el, 'Borrar')?.disabled).withContext('un guardado sigue en vuelo').toBeTrue();

    resolver!();
    await estabilizar(fixture);
  });

  it('🔴 dos clicks SINCRÓNICOS seguidos (el `[disabled]` del DOM no llega a tiempo en un doble click real) no disparan dos guardados', async () => {
    // Se encontró manejando la app: con `eventCoalescing`, la escritura del atributo `disabled` en
    // el DOM queda detrás de un límite de macrotarea, así que un doble click genuino puede procesar
    // el segundo `click` ANTES de que el botón se vea deshabilitado. Este test no pasa por el DOM
    // para reproducirlo (Karma no simula esa carrera de forma confiable) — llama al método del
    // componente dos veces seguidas, sin esperar entre medio, que es exactamente lo que le llega a
    // `guardar()` cuando el `[disabled]` del template todavía no corrió.
    const { fixture, guardarMenuSpy } = crear();
    const page = fixture.componentInstance;
    await estabilizar(fixture);

    page.borrarPlato(0);
    page.borrarPlato(0); // sin `await` entre medio: mismo escenario que un doble click real
    await estabilizar(fixture);

    expect(guardarMenuSpy).toHaveBeenCalledTimes(1);
  });
});
