import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ClienteVistaPage } from './cliente-vista';
import { ClientesService } from '../../services/clientes';
import type { ClienteAgencia } from '../../core/models';

/**
 * Test de componente (Karma) de `/clientes/:id/ver`. Mismo criterio que `cliente-perfil.spec.ts`
 * (Etapa 5c): se mockea `ClientesService` directamente, no `ApiService` — lo que fija acá es que
 * la pantalla llama a `verCliente(id)` para el header REAL, y que el signal de tab cambia qué lista
 * MOCK se muestra (ideas/Instagram/reviews), sin depender de ningún backend para esas tres.
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

function crear(
  cliente: ClienteAgencia | null,
  verClienteSpy = jasmine.createSpy('verCliente').and.callFake(async () => undefined),
): { fixture: ComponentFixture<ClienteVistaPage>; router: Router; verClienteSpy: jasmine.Spy } {
  const clienteSignal = signal<ClienteAgencia | null>(cliente);

  TestBed.configureTestingModule({
    imports: [ClienteVistaPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'c1' })) } },
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
  const fixture = TestBed.createComponent(ClienteVistaPage);
  const router = TestBed.inject(Router);
  return { fixture, router, verClienteSpy };
}

/**
 * Busca la tarjeta de idea por el título (un `<h3>`) y confirma que SU badge de estado (el hermano
 * anterior en el DOM) trae la clase de token esperada — no solo que la clase exista en algún lado de
 * la página, que no distinguiría "aprobada" y "rechazada" mapeadas al revés.
 */
function claseBadgeDe(el: HTMLElement, tituloIdea: string, claseEsperada: string, etiquetaEsperada: string): void {
  const titulo = Array.from(el.querySelectorAll('h3')).find((h) => h.textContent?.trim() === tituloIdea);
  expect(titulo).withContext(`no encontré la tarjeta de idea "${tituloIdea}"`).toBeDefined();
  const tarjeta = titulo!.closest('div');
  const badge = tarjeta?.querySelector('span');
  expect(badge?.textContent?.trim()).withContext(`badge de "${tituloIdea}"`).toBe(etiquetaEsperada);
  expect(badge?.classList.contains(claseEsperada))
    .withContext(`badge de "${tituloIdea}" (${etiquetaEsperada}) no tiene la clase ${claseEsperada}`)
    .toBeTrue();
}

async function estabilizar(fixture: ComponentFixture<ClienteVistaPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteVistaPage', () => {
  it('carga el cliente real por id (ClientesService.verCliente) y muestra su header', async () => {
    const { fixture, verClienteSpy } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    expect(verClienteSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Pizza Nonna');
    expect(el.textContent).toContain('restauración');
  });

  it('cliente no encontrado (`cliente()` queda en null tras verCliente): navega a /clientes', async () => {
    const { fixture, router } = crear(null);
    spyOn(router, 'navigate').and.resolveTo(true);
    await estabilizar(fixture);

    expect(router.navigate).toHaveBeenCalledWith(['/clientes']);
  });

  it('arranca en el tab "Ideas" y muestra las ideas de ejemplo', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Mis ideas');
    expect(el.textContent).toContain('Menú de temporada: platos de invierno');
    // Otros tabs no deberían estar montados a la vez.
    expect(el.textContent).not.toContain('Posts generados');
    expect(el.textContent).not.toContain('Reseñas de Google');

    // Los 4 estados de idea, cada uno con el token semántico que le corresponde a SU tarjeta (mismo
    // criterio que `clientes-tabla.ts`/`cartera-tabla.spec.ts`) — no solo "el token aparece en algún
    // lado" (eso pasaría igual si "aprobada" y "rechazada" se mapearan al revés).
    claseBadgeDe(el, 'Menú de temporada: platos de invierno', 'bg-superficie-2', 'Nueva');
    claseBadgeDe(el, 'Detrás de escena: la cocina en hora pico', 'bg-alerta-suave', 'En revisión');
    claseBadgeDe(el, 'Promo de aniversario del local', 'bg-respaldo-suave', 'Aprobada');
    claseBadgeDe(el, 'Reto de maridaje con clientes', 'bg-error-suave', 'Rechazada');
  });

  it('cambia al tab Instagram y muestra los posts de ejemplo, sin el botón "Generar Contenido"', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const botonInstagram = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Instagram',
    );
    expect(botonInstagram).withContext('no encontré el botón de tab "Instagram"').toBeDefined();
    botonInstagram!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.textContent).toContain('Posts generados');
    expect(el.textContent).toContain('#hamburguesagourmet');
    expect(el.textContent).not.toContain('Generar Contenido');
    expect(el.textContent).not.toContain('Mis ideas');
  });

  it('cambia al tab Reseñas y muestra las reseñas de ejemplo, con una pendiente de respuesta', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    const botonReviews = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reseñas Google',
    );
    expect(botonReviews).withContext('no encontré el botón de tab "Reseñas Google"').toBeDefined();
    botonReviews!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.textContent).toContain('Reseñas de Google');
    expect(el.textContent).toContain('María González');
    expect(el.textContent).toContain('Pendiente de respuesta.');
    expect(el.textContent).not.toContain('Posts generados');
  });

  it('el header muestra la calificación promedio calculada de las reseñas MOCK, no un campo del cliente', async () => {
    const { fixture } = crear(clienteDePrueba());
    const el = await estabilizar(fixture);

    // (5 + 4 + 5) / 3 = 4.666... -> 4.7, el mismo cálculo que cubre cliente-vista-mock.test.ts
    expect(el.textContent).toContain('4.7');
  });
});
