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
