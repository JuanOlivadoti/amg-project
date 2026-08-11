import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ClienteResearchPage } from './cliente-research';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { environment } from '../../../environments/environment';

/**
 * Test de componente (Karma) del tab `/clientes/:id/research`. Hereda de `runs.spec.ts` el gate del
 * formulario de lanzar (§A.5) y añade lo que da sentido a la mudanza: que la lista pida SOLO los
 * runs de este cliente, y que lanzar no necesite que nadie pegue un UUID a mano.
 */
function crear(esEquipo: boolean, flag: boolean) {
  const listarRunsSpy = jasmine.createSpy('listarRuns').and.resolveTo([]);
  const crearRunSpy = jasmine.createSpy('crearRun').and.resolveTo('run-1');
  environment.features.lanzarResearch = flag;

  TestBed.configureTestingModule({
    imports: [ClienteResearchPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'c1' })) } },
      { provide: ApiService, useValue: { listarRuns: listarRunsSpy, crearRun: crearRunSpy } },
      { provide: MembresiaService, useValue: { esEquipo: signal(esEquipo) } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteResearchPage);
  return { fixture, listarRunsSpy, crearRunSpy };
}

describe('ClienteResearchPage', () => {
  // `environment` es un objeto plano compartido por todo el bundle de Karma: sin esto, el último
  // valor que deje este describe viaja a los specs que corran después. Venía de `runs.spec.ts`.
  const flagOriginal = environment.features.lanzarResearch;
  afterEach(() => {
    environment.features.lanzarResearch = flagOriginal;
  });

  it('pide SOLO los runs de este cliente', async () => {
    const { fixture, listarRunsSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listarRunsSpy).toHaveBeenCalledWith('c1');
  });

  it('lanzar research toma el cliente de la ruta, sin input de UUID', async () => {
    const { fixture, crearRunSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // El input del UUID ya no existe: si vuelve, este test lo caza.
    expect(el.querySelector('input[name="clientId"]')).toBeNull();

    const prompt = el.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!;
    prompt.value = 'Hamburguesería gourmet en Madrid centro';
    prompt.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(crearRunSpy).toHaveBeenCalledWith({
      clientId: 'c1',
      prompt: 'Hamburguesería gourmet en Madrid centro',
    });
  });

  it('Fase 1 (equipo, flag apagado): el formulario NO se renderiza', () => {
    const { fixture } = crear(true, false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });

  it('dev/Fase 2 (equipo, flag encendido): el formulario SÍ se renderiza', () => {
    const { fixture } = crear(true, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
  });

  it('cliente (no equipo): no se renderiza ni con el flag encendido', () => {
    const { fixture } = crear(false, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });
});
