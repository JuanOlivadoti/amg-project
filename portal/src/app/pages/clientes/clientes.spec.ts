import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClientesPage } from './clientes';
import { ApiService } from '../../services/api';
import type { ClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) del listado `/clientes`. Mismo criterio que `pages/runs/runs.spec.ts`:
 * se renderiza la pantalla REAL con `ClientesService` real (no un mock del servicio) y solo se
 * sustituye `ApiService` — así el spec fija tanto el template como el cableado a
 * `ClientesService.filtrados`/`filtro`, no una reimplementación paralela del filtrado en el test.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
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
