import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { ClienteMenuDetallePage, platoDesdeFormulario } from './cliente-menu-detalle';
import type { FormularioPlato } from './cliente-menu-detalle';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import type { Alergeno, ClienteAgencia, EtiquetaDietetica, MenuCarta, Vertical } from '../../core/models';

function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
    vertical: 'restauracion',
    tipo: 'empresa',
    industria: 'restauración',
    etiquetas: null,
    nivel_actividad: null,
    estado_contrato: null,
    contrato_vence_en: null,
    score: null,
    asignado_a: null,
    contacto: null,
    origen: null,
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
    /** `undefined` = `clientesService.cliente()` queda en `null`, como cuando la ficha todavía no
     *  terminó de cargar. Por defecto un cliente de restauración, para no cambiar el comportamiento
     *  de ningún test escrito antes de esta task. */
    vertical?: Vertical;
  } = {},
) {
  const obtenerMenuSpy = opciones.obtenerMenu ?? jasmine.createSpy('obtenerMenu').and.resolveTo(cartaDePrueba());
  const guardarMenuSpy = opciones.guardarMenu ?? jasmine.createSpy('guardarMenu').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1', index: '0' }));
  const clienteActual = signal<ClienteAgencia | null>(
    opciones.vertical === undefined ? clienteDePrueba() : clienteDePrueba({ vertical: opciones.vertical }),
  );

  TestBed.configureTestingModule({
    imports: [ClienteMenuDetallePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { obtenerMenu: obtenerMenuSpy, guardarMenu: guardarMenuSpy } },
      { provide: ClientesService, useValue: { cliente: clienteActual } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteMenuDetallePage);
  return { fixture, obtenerMenuSpy, guardarMenuSpy, params, clienteActual };
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

  it('🔴 índice no entero (solo alcanzable escribiendo la URL a mano) → "Plato no encontrado", sin reventar', async () => {
    // `0.5` no es negativo ni mayor que `carta.menu.length` (1 en `cartaDePrueba()`), así que sin la
    // guarda `!Number.isInteger` caía en la rama de "plato existente": `carta.menu[0.5]` es
    // `undefined`, y `formularioDesde(undefined!)` reventaba con un TypeError al leer `.price` de
    // `undefined` — nada que la propia app genere produce un índice así, pero es una URL válida que
    // alguien puede escribir a mano. (Un índice como `1.5`, mayor que `menu.length`, ya caía en la
    // rama "fuera de rango" aun sin este fix — por eso el valor de prueba tiene que estar DENTRO del
    // rango para ejercitar la guarda nueva.)
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '0.5' }));
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

  it('foto.alt sobrevive un guardado que no lo toca', async () => {
    const carta = cartaDePrueba({
      menu: [{ name: 'Margherita', foto: { src: 'https://a.storyblok.com/f/1/margherita.jpg', alt: 'Pizza margherita recién horneada' } }],
    });
    const { fixture, guardarMenuSpy } = crear({ obtenerMenu: jasmine.createSpy('obtenerMenu').and.resolveTo(carta) });
    const el = await estabilizar(fixture);

    expect(el.querySelector<HTMLInputElement>('input[name="fotoAlt"]')?.value).toBe(
      'Pizza margherita recién horneada',
    );

    // Se toca un campo cualquiera (no `fotoAlt`) para simular una edición real, y se guarda.
    const inputNota = el.querySelector<HTMLInputElement>('input[name="nota"]')!;
    inputNota.value = 'Recomendado';
    inputNota.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    const [, cartaGuardada] = guardarMenuSpy.calls.mostRecent().args as [string, MenuCarta];
    expect(cartaGuardada.menu[0]?.foto).toEqual({
      src: 'https://a.storyblok.com/f/1/margherita.jpg',
      alt: 'Pizza margherita recién horneada',
    });
  });

  it('🔴 el 400 estructurado (`campos`) se muestra como una lista de `ruta: mensaje`, sin depender del texto de `mensaje`', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const error = Object.assign(new Error('El menú no es válido.'), {
      status: 400,
      campos: [{ ruta: 'menu.0.name', mensaje: 'Requerido' }],
    });
    const guardarMenuSpy = jasmine.createSpy('guardarMenu').and.rejectWith(error);
    const { fixture } = crear({ params, guardarMenu: guardarMenuSpy });
    const el = await estabilizar(fixture);

    const inputNombre = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    inputNombre.value = 'Plato con error de campo';
    inputNombre.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(el.textContent).toContain('menu.0.name: Requerido');
  });

  it('oculta los controles de video/alergenos/nutricion para un cliente de seguros', async () => {
    const { fixture, clienteActual } = crear({ vertical: 'restauracion' });
    const el = await estabilizar(fixture);
    // Nace visible para restauración (chequeo previo, no es el foco de este test): confirma que el
    // `set` de más abajo de verdad cambia algo, en vez de pasar en verde porque nunca estuvo.
    expect(el.querySelector('[data-testid="campo-alergenos"]')).toBeTruthy();

    clienteActual.set(clienteDePrueba({ vertical: 'correduria_seguros' }));
    await estabilizar(fixture);

    expect(el.querySelector('[data-testid="campo-alergenos"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="campo-video"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="campo-etiquetas"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="campo-nutricion"]')).toBeFalsy();
  });

  it('muestra los controles de restauración para un cliente de restauración — sin regresión', async () => {
    const { fixture } = crear({ vertical: 'restauracion' });
    const el = await estabilizar(fixture);

    expect(el.querySelector('[data-testid="campo-alergenos"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="campo-video"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="campo-etiquetas"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="campo-nutricion"]')).toBeTruthy();
  });

  it('el <h1> de un ítem nuevo dice "Póliza nueva" para un cliente de seguros, no "Plato nuevo"', async () => {
    // Encontrado en la ronda de revisión: el <h1> REAL (visible) de esta pantalla —a diferencia del
    // sr-only de cliente-menu.ts— seguía hardcodeado a 'Plato nuevo' pase lo que pase con el
    // vertical. `cartaDePrueba()` trae 1 plato, así que índice 1 (=== menu.length) es "ítem nuevo".
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture } = crear({ params, vertical: 'correduria_seguros' });
    const el = await estabilizar(fixture);

    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Póliza nueva');
    expect(el.textContent).not.toContain('Plato nuevo');
  });

  it('sin regresión: el <h1> de un ítem nuevo sigue diciendo "Plato nuevo" para un cliente de restauración', async () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', index: '1' }));
    const { fixture } = crear({ params, vertical: 'restauracion' });
    const el = await estabilizar(fixture);

    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Plato nuevo');
  });
});

/** Un `FormularioPlato` con TODOS los campos de restauración cargados — simula un ítem que se guardó
 *  cuando el cliente todavía no era de seguros (o que llegó por otra vía) y ahora se reabre. Es
 *  justo el escenario que `platoDesdeFormulario` tiene que defender: los datos siguen en el
 *  formulario aunque el template ya no muestre los controles que los cargaron. */
function formularioConTodosLosCampos(): FormularioPlato {
  return {
    name: 'Margherita',
    description: 'Tomate San Marzano, mozzarella, albahaca.',
    category: 'Pizzas',
    nota: 'Recomendado',
    precios: [{ etiqueta: 'Media', importe: '9,00 €', comensales: '1 persona' }],
    fotoSrc: 'https://a.storyblok.com/f/1/margherita.jpg',
    fotoAlt: 'Margherita',
    videoSrc: 'https://a.storyblok.com/f/1/margherita.mp4',
    videoPosterSrc: 'https://a.storyblok.com/f/1/poster.jpg',
    videoPosterAlt: 'Margherita',
    alergenos: new Set<Alergeno>(['gluten', 'lacteos']),
    etiquetas: new Set<EtiquetaDietetica>(['vegetariano']),
    calorias: '620',
    proteinasG: '26',
    carbohidratosG: '80',
    grasasG: '18',
  };
}

describe('platoDesdeFormulario', () => {
  it('🔴 no incluye campos de restauracion para un cliente de seguros, aunque el formulario los traiga cargados', () => {
    // El formulario trae TODOS los campos de restauración, simulando datos viejos — es la trampa que
    // este test defiende: sin el `if (esSeguros) return plato;` de `platoDesdeFormulario`, un plato
    // legacy o un formulario que sobrevivió un cambio de vertical se guardaría con video/alérgenos/
    // etiquetas/nutrición aunque el cliente ya sea de seguros.
    const form = formularioConTodosLosCampos();
    const plato = platoDesdeFormulario(form, true);

    expect(plato.video).toBeUndefined();
    expect(plato.alergenos).toBeUndefined();
    expect(plato.etiquetas).toBeUndefined();
    expect(plato.nutricion).toBeUndefined();
    // Los campos base (los que sí aplican a una póliza) sobreviven: `esSeguros` no vacía el plato.
    expect(plato.name).toBe('Margherita');
    expect(plato.description).toBe('Tomate San Marzano, mozzarella, albahaca.');
    expect(plato.precios).toEqual([{ etiqueta: 'Media', importe: '9,00 €', comensales: '1 persona' }]);
  });

  it('sin regresión: SÍ incluye video/alergenos/etiquetas/nutricion para un cliente de restauración', () => {
    const form = formularioConTodosLosCampos();
    const plato = platoDesdeFormulario(form, false);

    expect(plato.video).toEqual({
      src: 'https://a.storyblok.com/f/1/margherita.mp4',
      poster: { src: 'https://a.storyblok.com/f/1/poster.jpg', alt: 'Margherita' },
    });
    expect(plato.alergenos).toEqual(['gluten', 'lacteos']);
    expect(plato.etiquetas).toEqual(['vegetariano']);
    expect(plato.nutricion).toEqual({ calorias: 620, proteinas_g: 26, carbohidratos_g: 80, grasas_g: 18 });
  });
});
