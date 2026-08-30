import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ClientesPage } from './clientes';
import { ApiService } from '../../services/api';
import type { ClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) del listado `/clientes`. Mismo criterio que
 * `pages/clientes/cliente-research.spec.ts`:
 * se renderiza la pantalla REAL con `ClientesService` real (no un mock del servicio) y solo se
 * sustituye `ApiService` — así el spec fija tanto el template como el cableado a
 * `ClientesService.filtrados`/`filtro`, no una reimplementación paralela del filtrado en el test.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
    vertical: 'restauracion',
    tipo: 'empresa',
    industria: 'restauración',
    etiquetas: [],
    nivel_actividad: 'alto',
    estado_contrato: 'vigente',
    contrato_vence_en: null,
    score: 80,
    asignado_a: null,
    contacto: {},
    origen: null,
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ClientesPage', () => {
  async function render(
    clientes: ClienteAgencia[],
  ): Promise<{ fixture: ComponentFixture<ClientesPage>; el: HTMLElement }> {
    TestBed.configureTestingModule({
      imports: [ClientesPage],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: {
            listarClientes: async () => clientes,
            archivarCliente: async () => undefined,
            desarchivarCliente: async () => undefined,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ClientesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renderiza una fila por cada cliente cargado', async () => {
    const { el } = await render([
      clienteDePrueba({ id: 'c1', nombre: 'Pizza Nonna' }),
      clienteDePrueba({ id: 'c2', nombre: 'Sushi Kato' }),
    ]);
    expect(el.textContent).toContain('Pizza Nonna');
    expect(el.textContent).toContain('Sushi Kato');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('sin clientes: la tabla muestra el estado vacío', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('No se encontraron clientes con los filtros aplicados.');
  });

  it('el filtro de texto reduce lo que muestra la tabla', async () => {
    const { fixture, el } = await render([
      clienteDePrueba({ id: 'c1', nombre: 'Pizza Nonna' }),
      clienteDePrueba({ id: 'c2', nombre: 'Sushi Kato' }),
    ]);

    const campoTexto = el.querySelector<HTMLInputElement>('#clientes-filtro-texto');
    expect(campoTexto).not.toBeNull();
    campoTexto!.value = 'sushi';
    campoTexto!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Pizza Nonna');
    expect(el.textContent).toContain('Sushi Kato');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('el menú de una fila tiene UNA sola acción de navegación, y dice «Abrir»', async () => {
    /*
     * La fila tenía DOS acciones de navegación —«Editar» a la ficha y «Ver» a `/clientes/:id/ver`— y
     * quedó con una cuando se retiró «Mi Portal». Nada lo fijaba: `app.routes.test.ts` impide que la
     * ruta vuelva, pero no que vuelva el LINK, y un `routerLink` a una ruta inexistente no rompe nada
     * —el Router no valida el destino hasta que se navega— así que el síntoma sería una entrada de
     * menú que manda al comodín y devuelve al listado, sin un error en consola.
     *
     * Se afirma sobre el `<a>` y no sobre el texto de la fila porque «acción de navegación» es
     * exactamente eso: los `<button>` del menú (archivar/desarchivar) no navegan y no compiten. Y se
     * comprueba también el `href`: «una sola acción» con el destino equivocado no es lo que se pidió.
     *
     * El menú se renderiza bajo un `@if (abierto())`, así que hay que abrirlo de verdad: sin el clic
     * el `[role="menu"]` no existe en el DOM y el test pasaría contando cero anclas.
     */
    const { fixture, el } = await render([clienteDePrueba({ id: 'c1', nombre: 'Pizza Nonna' })]);

    const disparador = el.querySelector<HTMLButtonElement>('tbody button[aria-label="Acciones"]');
    expect(disparador)
      .withContext('no encontré el botón que abre el menú de acciones de la fila')
      .not.toBeNull();
    disparador!.click();
    fixture.detectChanges();

    const menu = el.querySelector('[role="menu"]');
    expect(menu).withContext('el menú no se abrió: ¿cambió el disparador?').not.toBeNull();

    const navegacion = [...menu!.querySelectorAll('a')];
    expect(navegacion.length).toBe(1);
    expect(navegacion[0]!.textContent!.trim()).toBe('Abrir');
    expect(navegacion[0]!.getAttribute('href')).toBe('/clientes/c1');

    // Y que «una sola acción de navegación» no se cumpla vaciando el menú: la de estado sigue ahí.
    const botones = [...menu!.querySelectorAll('button')].map((b) => b.textContent!.trim());
    expect(botones).toEqual(['Archivar']);
  });

  it('click en la fila navega a la ficha del cliente, igual que «Abrir»', async () => {
    const { fixture, el } = await render([clienteDePrueba({ id: 'c1', nombre: 'Pizza Nonna' })]);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');

    const fila = el.querySelector<HTMLTableRowElement>('tbody tr');
    expect(fila).withContext('no encontré la fila de la tabla').not.toBeNull();
    fila!.click();
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/clientes', 'c1']);
  });

  it('click en el botón de acciones (⋮) NO dispara también la navegación de la fila', async () => {
    /*
     * El botón de acciones vive dentro de la fila, así que su click burbujea al `(click)` de la
     * fila salvo que se corte la propagación en la celda — si no se corta, abrir el menú también
     * navegaría a la ficha por debajo, y el usuario nunca vería el menú.
     */
    const { fixture, el } = await render([clienteDePrueba({ id: 'c1', nombre: 'Pizza Nonna' })]);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');

    const disparador = el.querySelector<HTMLButtonElement>('tbody button[aria-label="Acciones"]');
    disparador!.click();
    fixture.detectChanges();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(el.querySelector('[role="menu"]')).withContext('el menú debería haberse abierto').not.toBeNull();
  });

  it('archivados: se ocultan por default y aparecen con "Mostrar archivados"', async () => {
    const { fixture, el } = await render([
      clienteDePrueba({ id: 'c1', nombre: 'Activo SRL', archived_at: null }),
      clienteDePrueba({ id: 'c2', nombre: 'Viejo Cliente', archived_at: '2025-01-01T00:00:00.000Z' }),
    ]);

    expect(el.textContent).toContain('Activo SRL');
    expect(el.textContent).not.toContain('Viejo Cliente');

    const checksArchivados = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const mostrarArchivados = checksArchivados[checksArchivados.length - 1];
    expect(mostrarArchivados).toBeDefined();
    mostrarArchivados.checked = true;
    mostrarArchivados.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(el.textContent).toContain('Viejo Cliente');
  });
});
