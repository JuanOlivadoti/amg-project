import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RunsPage } from './runs';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

/**
 * Cierra el falso verde de la 10ª review (#4): los tests de `node:test` prueban la función pura, pero
 * NO renderizan el componente, así que no fijan el `@if (puedeLanzar())` del template. Muté el
 * template para ignorar `puedeLanzar()` y 39/39 seguían verdes. Este spec RENDERIZA `RunsPage` y
 * comprueba el DOM: si alguien borra el `@if`, o lo cablea a otra cosa, cae.
 *
 * El flag `environment.features.lanzarResearch` se muta en el test (es un objeto plano) para probar
 * los dos estados sin depender de qué environment compiló karma.
 */
describe('RunsPage — gate del formulario "lanzar research" (§A.5)', () => {
  const flagOriginal = environment.features.lanzarResearch;

  afterEach(() => {
    environment.features.lanzarResearch = flagOriginal;
  });

  function render(esEquipo: boolean, lanzarHabilitado: boolean): HTMLElement {
    environment.features.lanzarResearch = lanzarHabilitado;
    TestBed.configureTestingModule({
      imports: [RunsPage],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { listarRuns: async () => [], crearRun: async () => ({}) } },
        { provide: AuthService, useValue: { esEquipo: () => esEquipo } },
      ],
    });
    const fixture = TestBed.createComponent(RunsPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('Fase 1 (equipo, flag apagado): el formulario NO se renderiza', () => {
    const el = render(true, false);
    expect(el.querySelector('form')).toBeNull();
    expect(el.textContent).not.toContain('Lanzar un research');
  });

  it('dev/Fase 2 (equipo, flag encendido): el formulario SÍ se renderiza', () => {
    const el = render(true, true);
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.textContent).toContain('Lanzar un research');
  });

  it('cliente (no equipo): no se renderiza ni con el flag encendido', () => {
    const el = render(false, true);
    expect(el.querySelector('form')).toBeNull();
  });
});
